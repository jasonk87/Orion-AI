'use strict';

const { execFile } = require('child_process');

const CAPTURE_TIMEOUT_MS = 15000;
const MAX_CAPTURE_OUTPUT_BYTES = 32 * 1024 * 1024;

function encodeData(value) {
  return Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64');
}

function buildCaptureWindowScript(windowHint, options = {}) {
  const encodedHint = encodeData(windowHint);
  const selectionScript = options.foreground === true
    ? `$foregroundHandle = [OrionWindowCapture]::GetForegroundWindow()\n` +
      `if ($foregroundHandle -eq [IntPtr]::Zero) { [pscustomobject]@{ success=$false; reasonCode='foreground_not_found'; error='Windows did not report a foreground application window.' } | ConvertTo-Json -Compress; exit 0 }\n` +
      `$foregroundPid = 0; [void][OrionWindowCapture]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundPid)\n` +
      `$chosen = Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue\n` +
      `if ($null -eq $chosen -or $chosen.MainWindowHandle -eq 0) { [pscustomobject]@{ success=$false; reasonCode='foreground_not_capturable'; error='The foreground surface is not a capturable application window.' } | ConvertTo-Json -Compress; exit 0 }\n`
    : `$hint = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedHint}'))\n` +
      // $matches is a PowerShell automatic variable populated by -match; shadowing it is a latent
      // footgun, so this uses its own name.
      `$windowMatches = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName.IndexOf($hint, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.MainWindowTitle.IndexOf($hint, [StringComparison]::OrdinalIgnoreCase) -ge 0) })\n` +
      `if ($windowMatches.Count -eq 0) { [pscustomobject]@{ success=$false; reasonCode='window_not_found'; error="No visible application window matched '$hint'." } | ConvertTo-Json -Compress; exit 0 }\n` +
      `$scoreOf = { param($p) if ($p.ProcessName -ieq $hint -or $p.MainWindowTitle -ieq $hint) { 0 } else { 1 } }\n` +
      `$scored = @($windowMatches | Sort-Object @{Expression={ & $scoreOf $_ }}, StartTime)\n` +
      `$bestScore = & $scoreOf $scored[0]\n` +
      `$best = @($scored | Where-Object { (& $scoreOf $_) -eq $bestScore })\n` +
      `if ($best.Count -gt 1) {\n` +
      `  $summary = @($best | Select-Object -First 8 @{n='processName';e={$_.ProcessName}}, @{n='windowTitle';e={$_.MainWindowTitle}})\n` +
      `  [pscustomobject]@{ success=$false; ambiguous=$true; reasonCode='window_ambiguous'; error="More than one visible window matched '$hint'. Name the exact application or window title."; matches=$summary } | ConvertTo-Json -Compress -Depth 4; exit 0\n` +
      `}\n` +
      `$chosen = $best[0]\n`;
  return `$ErrorActionPreference = 'Stop'\n` +
    `Add-Type -AssemblyName System.Drawing\n` +
    `Add-Type -TypeDefinition @'\n` +
    `using System;\nusing System.Runtime.InteropServices;\n` +
    `public static class OrionWindowCapture {\n` +
    `  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }\n` +
    `  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);\n` +
    `  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);\n` +
    `  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n` +
    `  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);\n` +
    `}\n` +
    `'@\n` +
    selectionScript +
    `$rect = New-Object OrionWindowCapture+RECT\n` +
    `if (-not [OrionWindowCapture]::GetWindowRect($chosen.MainWindowHandle, [ref]$rect)) { throw 'Could not read the application window bounds.' }\n` +
    `$width = [int]($rect.Right - $rect.Left); $height = [int]($rect.Bottom - $rect.Top)\n` +
    `if ($width -lt 1 -or $height -lt 1 -or ([long]$width * [long]$height) -gt 67108864) { throw "Application window has invalid capture bounds: $width x $height." }\n` +
    `$bitmap = New-Object System.Drawing.Bitmap $width,$height\n` +
    `$graphics = [System.Drawing.Graphics]::FromImage($bitmap)\n` +
    `$hdc = $graphics.GetHdc()\n` +
    `try { $captured = [OrionWindowCapture]::PrintWindow($chosen.MainWindowHandle, $hdc, 2); if (-not $captured) { $captured = [OrionWindowCapture]::PrintWindow($chosen.MainWindowHandle, $hdc, 0) } } finally { $graphics.ReleaseHdc($hdc) }\n` +
    `try {\n` +
    `  if (-not $captured) { throw 'Windows could not render the application window.' }\n` +
    `  $stream = New-Object System.IO.MemoryStream\n` +
    `  try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); $png = [Convert]::ToBase64String($stream.ToArray()) } finally { $stream.Dispose() }\n` +
    // PrintWindow returning true is not proof that Windows rendered anything: a GPU-composited or
    // occluded window commonly yields a valid PNG that is entirely one colour. Sampling a small
    // grid distinguishes "captured" from "captured something", so the caller can treat a uniform
    // frame as a failed observation rather than as screen evidence.
    `  $sampleColor = $null; $uniform = $true\n` +
    `  foreach ($sx in 0,1,2,3,4) { foreach ($sy in 0,1,2,3,4) {\n` +
    `    $px = [int](($width - 1) * $sx / 4); $py = [int](($height - 1) * $sy / 4)\n` +
    `    $c = $bitmap.GetPixel($px, $py).ToArgb()\n` +
    `    if ($null -eq $sampleColor) { $sampleColor = $c } elseif ($c -ne $sampleColor) { $uniform = $false }\n` +
    `  } }\n` +
    `  [pscustomobject]@{ success=$true; width=$width; height=$height; windowTitle=$chosen.MainWindowTitle; processName=$chosen.ProcessName; blank=$uniform; pngBase64=$png } | ConvertTo-Json -Compress\n` +
    `} finally { $graphics.Dispose(); $bitmap.Dispose() }\n`;
}

function buildCaptureDisplayScript(boundsValue) {
  const bounds = boundsValue && typeof boundsValue === 'object' ? boundsValue : {};
  const payload = encodeData(JSON.stringify({
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Number(bounds.width) || 0,
    height: Number(bounds.height) || 0
  }));
  return `$ErrorActionPreference = 'Stop'\n` +
    `Add-Type -AssemblyName System.Drawing\n` +
    `Add-Type -TypeDefinition @'\n` +
    `using System;\nusing System.Runtime.InteropServices;\n` +
    `public static class OrionDesktopComposite {\n` +
    `  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }\n` +
    `  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr window);\n` +
    `  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);\n` +
    `  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);\n` +
    `  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);\n` +
    `  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);\n` +
    `  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);\n` +
    `}\n` +
    `'@\n` +
    `$captureBounds = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json\n` +
    `$left = [int]$captureBounds.x; $top = [int]$captureBounds.y; $width = [int]$captureBounds.width; $height = [int]$captureBounds.height\n` +
    `if ($width -lt 1 -or $height -lt 1 -or ([long]$width * [long]$height) -gt 67108864) { throw "Display has invalid capture bounds: $width x $height." }\n` +
    `$bitmap = New-Object System.Drawing.Bitmap $width,$height\n` +
    `$graphics = [System.Drawing.Graphics]::FromImage($bitmap)\n` +
    `try {\n` +
    `  $backend = 'copy_from_screen'; $compositedWindows = 0\n` +
    `  try {\n` +
    `    $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)\n` +
    `  } catch {\n` +
    // A locked, sleeping, or headless Desktop Duplication surface has no screen DC, but Windows can
    // still render ordinary top-level application windows via PrintWindow. Reconstruct the visible
    // desktop from those durable window surfaces instead of returning three identical empty frames.
    `    $backend = 'window_composite'; $graphics.Clear([System.Drawing.Color]::FromArgb(255, 10, 13, 22))\n` +
    `    $windows = New-Object System.Collections.ArrayList\n` +
    `    $cursor = [OrionDesktopComposite]::GetTopWindow([IntPtr]::Zero); $guard = 0\n` +
    `    while ($cursor -ne [IntPtr]::Zero -and $guard -lt 512) {\n` +
    `      $guard += 1; $rect = New-Object OrionDesktopComposite+RECT\n` +
    `      if ([OrionDesktopComposite]::IsWindowVisible($cursor) -and -not [OrionDesktopComposite]::IsIconic($cursor) -and [OrionDesktopComposite]::GetWindowRect($cursor, [ref]$rect)) {\n` +
    `        $windowWidth = [int]($rect.Right - $rect.Left); $windowHeight = [int]($rect.Bottom - $rect.Top)\n` +
    `        $intersects = $rect.Right -gt $left -and $rect.Left -lt ($left + $width) -and $rect.Bottom -gt $top -and $rect.Top -lt ($top + $height)\n` +
    `        if ($intersects -and $windowWidth -gt 1 -and $windowHeight -gt 1 -and ([long]$windowWidth * [long]$windowHeight) -le 67108864) {\n` +
    `          [void]$windows.Add([pscustomobject]@{ Handle=$cursor; Left=$rect.Left; Top=$rect.Top; Width=$windowWidth; Height=$windowHeight })\n` +
    `        }\n` +
    `      }\n` +
    `      $cursor = [OrionDesktopComposite]::GetWindow($cursor, 2)\n` +
    `    }\n` +
    `    for ($index = $windows.Count - 1; $index -ge 0; $index--) {\n` +
    `      $window = $windows[$index]; $surface = New-Object System.Drawing.Bitmap $window.Width,$window.Height\n` +
    `      $surfaceGraphics = [System.Drawing.Graphics]::FromImage($surface); $hdc = $surfaceGraphics.GetHdc()\n` +
    `      try { $rendered = [OrionDesktopComposite]::PrintWindow($window.Handle, $hdc, 2); if (-not $rendered) { $rendered = [OrionDesktopComposite]::PrintWindow($window.Handle, $hdc, 0) } } finally { $surfaceGraphics.ReleaseHdc($hdc); $surfaceGraphics.Dispose() }\n` +
    `      try { if ($rendered) { $graphics.DrawImageUnscaled($surface, [int]($window.Left - $left), [int]($window.Top - $top)); $compositedWindows += 1 } } finally { $surface.Dispose() }\n` +
    `    }\n` +
    `    if ($compositedWindows -eq 0) { throw 'Windows exposed neither desktop pixels nor any renderable application windows.' }\n` +
    `  }\n` +
    `  $sampleColor = $null; $uniform = $true\n` +
    `  foreach ($sx in 0,1,2,3,4) { foreach ($sy in 0,1,2,3,4) {\n` +
    `    $px = [int](($width - 1) * $sx / 4); $py = [int](($height - 1) * $sy / 4)\n` +
    `    $c = $bitmap.GetPixel($px, $py).ToArgb()\n` +
    `    if ($null -eq $sampleColor) { $sampleColor = $c } elseif ($c -ne $sampleColor) { $uniform = $false }\n` +
    `  } }\n` +
    `  $stream = New-Object System.IO.MemoryStream\n` +
    `  try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); $png = [Convert]::ToBase64String($stream.ToArray()) } finally { $stream.Dispose() }\n` +
    `  [pscustomobject]@{ success=$true; width=$width; height=$height; blank=$uniform; backend=$backend; compositedWindows=$compositedWindows; pngBase64=$png } | ConvertTo-Json -Compress\n` +
    `} finally { $graphics.Dispose(); $bitmap.Dispose() }\n`;
}

function runCaptureScript(script, options = {}, failureLabel) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const execFileImpl = options.execFile || execFile;
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
    ], {
      windowsHide: true,
      timeout: CAPTURE_TIMEOUT_MS,
      maxBuffer: MAX_CAPTURE_OUTPUT_BYTES
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || '').trim().slice(-2000);
        reject(new Error(detail || `${failureLabel} failed.`));
        return;
      }
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      let result;
      try {
        result = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
      } catch (_) {
        reject(new Error(`${failureLabel} returned an unreadable result.`));
        return;
      }
      if (!result || result.success !== true || !result.pngBase64) {
        reject(new Error(result && result.error || `${failureLabel} returned no image.`));
        return;
      }
      if (result.blank === true) {
        reject(new Error(`${failureLabel} rendered an empty or uniform frame.`));
        return;
      }
      let png;
      try { png = Buffer.from(result.pngBase64, 'base64'); } catch (_) { png = null; }
      if (!png || png.length < 8) {
        reject(new Error(`${failureLabel} returned an empty image.`));
        return;
      }
      resolve({ result, png });
    });
  });
}

function captureWindowByHint(windowHint, options = {}) {
  const hint = String(windowHint || '').trim();
  if (!hint) return Promise.reject(new Error('A named application window is required for window capture.'));
  if (process.platform !== 'win32' && !options.execFile) {
    return Promise.reject(new Error('Native application-window capture is currently supported only on Windows.'));
  }
  const script = buildCaptureWindowScript(hint);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const execFileImpl = options.execFile || execFile;
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
    ], {
      windowsHide: true,
      timeout: CAPTURE_TIMEOUT_MS,
      maxBuffer: MAX_CAPTURE_OUTPUT_BYTES
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || '').trim().slice(-2000);
        reject(new Error(detail || 'Native application-window capture failed.'));
        return;
      }
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      let result;
      try {
        result = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
      } catch (_) {
        reject(new Error('Native application-window capture returned an unreadable result.'));
        return;
      }
      if (!result || result.success !== true || !result.pngBase64) {
        reject(new Error(result && result.error || 'Native application-window capture returned no image.'));
        return;
      }
      if (result.blank === true) {
        reject(new Error('Native application-window capture rendered an empty or uniform frame.'));
        return;
      }
      let png;
      try { png = Buffer.from(result.pngBase64, 'base64'); } catch (_) { png = null; }
      if (!png || png.length < 8) {
        reject(new Error('Native application-window capture returned an empty image.'));
        return;
      }
      resolve({
        png,
        size: { width: Number(result.width) || 0, height: Number(result.height) || 0 },
        windowTitle: String(result.windowTitle || ''),
        processName: String(result.processName || '')
      });
    });
  });
}

async function captureDisplayByBounds(boundsValue, options = {}) {
  const bounds = boundsValue && typeof boundsValue === 'object' ? boundsValue : {};
  if (!(Number(bounds.width) > 0) || !(Number(bounds.height) > 0)) {
    throw new Error('Valid display bounds are required for native desktop capture.');
  }
  if (process.platform !== 'win32' && !options.execFile) {
    throw new Error('Native desktop capture is currently supported only on Windows.');
  }
  const { result, png } = await runCaptureScript(
    buildCaptureDisplayScript(bounds),
    options,
    'Native desktop capture'
  );
  return {
    png,
    size: { width: Number(result.width) || 0, height: Number(result.height) || 0 },
    backend: String(result.backend || 'copy_from_screen'),
    compositedWindows: Math.max(0, Number(result.compositedWindows) || 0)
  };
}

async function captureForegroundWindow(options = {}) {
  if (process.platform !== 'win32' && !options.execFile) {
    throw new Error('Native foreground-window capture is currently supported only on Windows.');
  }
  const { result, png } = await runCaptureScript(
    buildCaptureWindowScript('', { foreground: true }),
    options,
    'Native foreground-window capture'
  );
  return {
    png,
    size: { width: Number(result.width) || 0, height: Number(result.height) || 0 },
    windowTitle: String(result.windowTitle || ''),
    processName: String(result.processName || '')
  };
}

module.exports = {
  buildCaptureWindowScript,
  buildCaptureDisplayScript,
  captureWindowByHint,
  captureDisplayByBounds,
  captureForegroundWindow
};
