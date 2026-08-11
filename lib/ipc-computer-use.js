'use strict';

const { execFile } = require('child_process');
const shared = require('./shared');
const operatorControlSession = require('./operator-control-session');

const MAX_TEXT_LENGTH = 4000;
const MAX_ACTION_DELAY_MS = 250;
const POWERSHELL_TIMEOUT_MS = 15000;
const BLOCKED_KEY_TARGETS = new Set([
  'cmd', 'conhost', 'powershell', 'pwsh', 'windowsterminal', 'wt',
  'regedit', 'taskmgr', 'credentialuibroker', 'consent', 'logonui'
]);

const KEY_CODES = Object.freeze({
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0D,
  escape: 0x1B,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  arrowleft: 0x25,
  arrowup: 0x26,
  arrowright: 0x27,
  arrowdown: 0x28,
  insert: 0x2D,
  delete: 0x2E,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7A,
  f12: 0x7B
});

const MODIFIER_CODES = Object.freeze({
  ctrl: 0x11,
  shift: 0x10,
  alt: 0x12
});

const WINDOWS_INPUT_CSHARP = String.raw`
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class OrionComputerInput {
  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public INPUTUNION data;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

  private static void Send(INPUT[] inputs) {
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
  }

  private static INPUT Mouse(uint flags, int data) {
    INPUT input = new INPUT();
    input.type = INPUT_MOUSE;
    input.data.mouse.mouseData = unchecked((uint)data);
    input.data.mouse.dwFlags = flags;
    return input;
  }

  private static INPUT Key(ushort virtualKey, ushort scanCode, uint flags) {
    INPUT input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.data.keyboard.wVk = virtualKey;
    input.data.keyboard.wScan = scanCode;
    input.data.keyboard.dwFlags = flags;
    return input;
  }

  public static void Move(int x, int y) {
    if (!SetCursorPos(x, y)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }

  public static void Click(int x, int y, string button, int count, int delayMs) {
    Move(x, y);
    uint down = MOUSEEVENTF_LEFTDOWN;
    uint up = MOUSEEVENTF_LEFTUP;
    if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
    if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
    for (int i = 0; i < count; i++) {
      Send(new INPUT[] { Mouse(down, 0), Mouse(up, 0) });
      if (delayMs > 0 && i + 1 < count) Thread.Sleep(delayMs);
    }
  }

  public static void Scroll(int x, int y, int amount) {
    Move(x, y);
    Send(new INPUT[] { Mouse(MOUSEEVENTF_WHEEL, amount) });
  }

  // A straight SetCursorPos jump from start to end followed by up/down does not register as a
  // drag in most apps (file managers, canvas/design tools, sliders) - they watch for a real
  // sequence of intermediate mouse-move events between the button-down and button-up, the same
  // way a physical mouse would produce them. Interpolating in small steps reproduces that.
  public static void Drag(int startX, int startY, int endX, int endY, int steps, int stepDelayMs) {
    Move(startX, startY);
    Send(new INPUT[] { Mouse(MOUSEEVENTF_LEFTDOWN, 0) });
    int actualSteps = steps > 0 ? steps : 1;
    for (int i = 1; i <= actualSteps; i++) {
      int x = startX + (endX - startX) * i / actualSteps;
      int y = startY + (endY - startY) * i / actualSteps;
      Move(x, y);
      if (stepDelayMs > 0) Thread.Sleep(stepDelayMs);
    }
    Send(new INPUT[] { Mouse(MOUSEEVENTF_LEFTUP, 0) });
  }

  public static void TypeText(string text, int intervalMs) {
    foreach (char value in text) {
      Send(new INPUT[] {
        Key(0, value, KEYEVENTF_UNICODE),
        Key(0, value, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
      });
      if (intervalMs > 0) Thread.Sleep(intervalMs);
    }
  }

  public static void PressKey(ushort virtualKey, ushort[] modifiers) {
    INPUT[] inputs = new INPUT[(modifiers.Length * 2) + 2];
    int index = 0;
    foreach (ushort modifier in modifiers) inputs[index++] = Key(modifier, 0, 0);
    inputs[index++] = Key(virtualKey, 0, 0);
    inputs[index++] = Key(virtualKey, 0, KEYEVENTF_KEYUP);
    for (int i = modifiers.Length - 1; i >= 0; i--) inputs[index++] = Key(modifiers[i], 0, KEYEVENTF_KEYUP);
    Send(inputs);
  }

  public static string ForegroundProcessName() {
    try {
      uint pid;
      GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      return Process.GetProcessById((int)pid).ProcessName;
    } catch { return ""; }
  }

  public static string ForegroundWindowTitle() {
    StringBuilder title = new StringBuilder(512);
    GetWindowText(GetForegroundWindow(), title, title.Capacity);
    return title.ToString();
  }
}
`;

function boundedInteger(value, name, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} must be a finite number.`);
  }
  const integer = Math.round(parsed);
  if (integer < minimum || integer > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return integer;
}

function normalizeKeyName(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (/^[a-z]$/.test(raw)) return { name: raw, code: raw.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(raw)) return { name: raw, code: raw.charCodeAt(0) };
  if (KEY_CODES[raw]) return { name: raw, code: KEY_CODES[raw] };
  throw new Error(`Unsupported key "${value}". Use a letter, digit, navigation key, Enter, Escape, Tab, Delete, or F1-F12.`);
}

function normalizeModifiers(values) {
  const requested = Array.isArray(values) ? values : (values ? [values] : []);
  const normalized = [];
  for (const value of requested) {
    const modifier = String(value || '').trim().toLowerCase();
    if (modifier === 'control') {
      if (!normalized.includes('ctrl')) normalized.push('ctrl');
      continue;
    }
    if (modifier === 'win' || modifier === 'windows' || modifier === 'meta' || modifier === 'super') {
      throw new Error('Windows-key shortcuts are blocked. Use Orion browser, file, or command tools instead of launching system surfaces through computer use.');
    }
    if (!Object.prototype.hasOwnProperty.call(MODIFIER_CODES, modifier)) {
      throw new Error(`Unsupported modifier "${value}". Allowed modifiers: ctrl, shift, alt.`);
    }
    if (!normalized.includes(modifier)) normalized.push(modifier);
  }
  return normalized;
}

function normalizeComputerAction(input = {}, display = {}) {
  const action = String(input.action || '').trim().toLowerCase();
  if (!['move', 'click', 'scroll', 'type', 'key', 'drag'].includes(action)) {
    throw new Error('computer_action requires action: move, click, scroll, type, key, or drag.');
  }
  const bounds = display.bounds || { x: 0, y: 0, width: 0, height: 0 };
  const sourceWidth = input.sourceWidth == null
    ? boundedInteger(display.sourceWidth || bounds.width, 'display width', 1, 32768)
    : boundedInteger(input.sourceWidth, 'sourceWidth', 1, 32768);
  const sourceHeight = input.sourceHeight == null
    ? boundedInteger(display.sourceHeight || bounds.height, 'display height', 1, 32768)
    : boundedInteger(input.sourceHeight, 'sourceHeight', 1, 32768);
  const normalized = {
    action,
    targetDescription: String(input.targetDescription || '').trim().slice(0, 240),
    captureAfter: input.captureAfter !== false,
    settleMs: boundedInteger(input.settleMs, 'settleMs', 0, 5000, 500),
    sourceWidth,
    sourceHeight
  };
  if (!normalized.targetDescription) throw new Error('computer_action requires targetDescription so the action is auditable.');

  if (['move', 'click', 'scroll', 'drag'].includes(action)) {
    const sourceX = boundedInteger(input.x, 'x', 0, sourceWidth - 1);
    const sourceY = boundedInteger(input.y, 'y', 0, sourceHeight - 1);
    normalized.x = Math.round(Number(bounds.x || 0) + (sourceX / sourceWidth) * Number(bounds.width || sourceWidth));
    normalized.y = Math.round(Number(bounds.y || 0) + (sourceY / sourceHeight) * Number(bounds.height || sourceHeight));
    normalized.sourceX = sourceX;
    normalized.sourceY = sourceY;
  }
  if (action === 'click') {
    normalized.button = String(input.button || 'left').trim().toLowerCase();
    if (!['left', 'right', 'middle'].includes(normalized.button)) throw new Error('button must be left, right, or middle.');
    normalized.clickCount = boundedInteger(input.clickCount, 'clickCount', 1, 3, 1);
    normalized.intervalMs = boundedInteger(input.intervalMs, 'intervalMs', 0, MAX_ACTION_DELAY_MS, 80);
  }
  if (action === 'scroll') {
    normalized.amount = boundedInteger(input.amount, 'amount', -2400, 2400);
    if (normalized.amount === 0) throw new Error('scroll amount cannot be zero. Positive scrolls up; negative scrolls down.');
  }
  if (action === 'type') {
    normalized.text = String(input.text == null ? '' : input.text);
    if (!normalized.text) throw new Error('type requires non-empty text.');
    if (normalized.text.length > MAX_TEXT_LENGTH) throw new Error(`type text is limited to ${MAX_TEXT_LENGTH} characters per action.`);
    normalized.intervalMs = boundedInteger(input.intervalMs, 'intervalMs', 0, MAX_ACTION_DELAY_MS, 10);
  }
  if (action === 'key') {
    const key = normalizeKeyName(input.key);
    normalized.key = key.name;
    normalized.keyCode = key.code;
    normalized.modifiers = normalizeModifiers(input.modifiers);
    normalized.modifierCodes = normalized.modifiers.map(modifier => MODIFIER_CODES[modifier]);
    if (normalized.key === 'f4' && normalized.modifiers.includes('alt')) {
      throw new Error('Alt+F4 is blocked because it can discard unsaved work. Close applications through a visible, verified UI flow instead.');
    }
    if (normalized.key === 'delete' && normalized.modifiers.includes('ctrl') && normalized.modifiers.includes('alt')) {
      throw new Error('Ctrl+Alt+Delete is a protected system action and is not available to Orion.');
    }
    if (normalized.key === 'escape' && normalized.modifiers.includes('ctrl') && normalized.modifiers.includes('shift')) {
      throw new Error('Ctrl+Shift+Escape is blocked. Orion must not open Task Manager through computer use.');
    }
  }
  if (action === 'drag') {
    const sourceEndX = boundedInteger(input.endX, 'endX', 0, sourceWidth - 1);
    const sourceEndY = boundedInteger(input.endY, 'endY', 0, sourceHeight - 1);
    normalized.endX = Math.round(Number(bounds.x || 0) + (sourceEndX / sourceWidth) * Number(bounds.width || sourceWidth));
    normalized.endY = Math.round(Number(bounds.y || 0) + (sourceEndY / sourceHeight) * Number(bounds.height || sourceHeight));
    normalized.sourceEndX = sourceEndX;
    normalized.sourceEndY = sourceEndY;
    // Interpolation steps between button-down and button-up - see the Drag() comment in
    // WINDOWS_INPUT_CSHARP for why a bare jump-and-release does not register as a drag in most apps.
    normalized.steps = boundedInteger(input.steps, 'steps', 1, 50, 12);
    normalized.stepDelayMs = boundedInteger(input.stepDelayMs, 'stepDelayMs', 0, MAX_ACTION_DELAY_MS, 15);
    if (normalized.sourceX === normalized.sourceEndX && normalized.sourceY === normalized.sourceEndY) {
      throw new Error('drag requires endX/endY different from the start position. Use click for a simple click.');
    }
  }
  return normalized;
}

function powershellLiteralBase64(value) {
  return Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64');
}

function buildPowerShellInputScript(action) {
  const payload = powershellLiteralBase64(JSON.stringify(action));
  const blocked = powershellLiteralBase64(JSON.stringify([...BLOCKED_KEY_TARGETS]));
  return `$ErrorActionPreference = 'Stop'\n` +
    `Add-Type -TypeDefinition @'\n${WINDOWS_INPUT_CSHARP}\n'@\n` +
    `$action = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')))\n` +
    `$blocked = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${blocked}')))\n` +
    `$processName = [OrionComputerInput]::ForegroundProcessName()\n` +
    `$windowTitle = [OrionComputerInput]::ForegroundWindowTitle()\n` +
    `if (($action.action -eq 'type' -or $action.action -eq 'key') -and ($blocked -contains $processName.ToLowerInvariant())) { throw "Keyboard input is blocked for protected target process '$processName'. Use Orion's dedicated command or system tools." }\n` +
    `switch ($action.action) {\n` +
    `  'move' { [OrionComputerInput]::Move([int]$action.x, [int]$action.y) }\n` +
    `  'click' { [OrionComputerInput]::Click([int]$action.x, [int]$action.y, [string]$action.button, [int]$action.clickCount, [int]$action.intervalMs) }\n` +
    `  'scroll' { [OrionComputerInput]::Scroll([int]$action.x, [int]$action.y, [int]$action.amount) }\n` +
    `  'type' { [OrionComputerInput]::TypeText([string]$action.text, [int]$action.intervalMs) }\n` +
    `  'key' { [OrionComputerInput]::PressKey([uint16]$action.keyCode, [uint16[]]$action.modifierCodes) }\n` +
    `  'drag' { [OrionComputerInput]::Drag([int]$action.x, [int]$action.y, [int]$action.endX, [int]$action.endY, [int]$action.steps, [int]$action.stepDelayMs) }\n` +
    `}\n` +
    `[pscustomobject]@{ success = $true; action = [string]$action.action; targetProcess = $processName; targetWindow = $windowTitle } | ConvertTo-Json -Compress\n`;
}

function runPowerShellInput(script, execFileImpl = execFile) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Computer use is currently supported only on Windows.'));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
    ], { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || '').trim().slice(-2000);
        reject(new Error(detail || 'Windows input action failed.'));
        return;
      }
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      try {
        resolve(lines.length ? JSON.parse(lines[lines.length - 1]) : { success: true });
      } catch (_) {
        resolve({ success: true, output: String(stdout || '').trim() });
      }
    });
  });
}

function normalizeApplicationName(value) {
  const appName = String(value || '').trim();
  if (!appName) throw new Error('open_application requires an application name.');
  if (appName.length > 120) throw new Error('Application names are limited to 120 characters.');
  return appName;
}

function buildOpenApplicationScript(appName) {
  const encodedName = powershellLiteralBase64(normalizeApplicationName(appName));
  return `$ErrorActionPreference = 'Stop'\n` +
    `Add-Type -TypeDefinition @'\n` +
    `using System;\nusing System.Runtime.InteropServices;\n` +
    `public static class OrionWindowActivation {\n` +
    `  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n` +
    `  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);\n` +
    `}\n` +
    `'@\n` +
    `$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedName}'))\n` +
    `$windowMatches = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.MainWindowTitle.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0) })\n` +
    `if ($windowMatches.Count -gt 0) {\n` +
    `  $chosen = @($windowMatches | Sort-Object @{Expression={ if ($_.ProcessName -ieq $name -or $_.MainWindowTitle -ieq $name) { 0 } else { 1 } }}, StartTime | Select-Object -First 1)[0]\n` +
    `  [OrionWindowActivation]::ShowWindowAsync($chosen.MainWindowHandle, 9) | Out-Null\n` +
    `  [OrionWindowActivation]::SetForegroundWindow($chosen.MainWindowHandle) | Out-Null\n` +
    `  [pscustomobject]@{ success=$true; method='activated'; appName=$name; processName=$chosen.ProcessName; windowTitle=$chosen.MainWindowTitle } | ConvertTo-Json -Compress\n` +
    `  exit 0\n` +
    `}\n` +
    `$startApps = @(Get-StartApps | Where-Object { [String]::Equals($_.Name, $name, [StringComparison]::OrdinalIgnoreCase) })\n` +
    `if ($startApps.Count -eq 0) { $startApps = @(Get-StartApps | Where-Object { $_.Name.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }\n` +
    `if ($startApps.Count -eq 0) { [pscustomobject]@{ success=$false; error="No installed Start-menu application matched '$name'."; matches=@() } | ConvertTo-Json -Compress; exit 0 }\n` +
    `if ($startApps.Count -gt 1) { [pscustomobject]@{ success=$false; error="More than one installed application matched '$name'. Use a more specific display name."; matches=@($startApps | Select-Object -First 8 -ExpandProperty Name) } | ConvertTo-Json -Compress; exit 0 }\n` +
    `$selected = $startApps[0]\n` +
    `Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\\" + $selected.AppID)\n` +
    `[pscustomobject]@{ success=$true; method='launched'; appName=$selected.Name; appId=$selected.AppID } | ConvertTo-Json -Compress\n`;
}

function runPowerShellJson(script, execFileImpl = execFile) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Application control is currently supported only on Windows.'));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
    ], { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || '').trim().slice(-2000);
        reject(new Error(detail || 'Application control failed.'));
        return;
      }
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      try {
        resolve(lines.length ? JSON.parse(lines[lines.length - 1]) : { success: false, error: 'Application control returned no result.' });
      } catch (_) {
        reject(new Error('Application control returned an unreadable result.'));
      }
    });
  });
}

async function openWindowsApplication(input = {}, options = {}) {
  const appName = normalizeApplicationName(input.appName);
  const runApplication = options.runApplication
    || (name => runPowerShellJson(buildOpenApplicationScript(name), options.execFile || execFile));
  return runApplication(appName);
}

// Resolves which physical display an action/capture should target. Defaults fail-safe to the
// primary display whenever the requested id is absent, blank, or does not match any currently
// connected display (e.g. a monitor was unplugged since the id was captured), rather than
// throwing - a stale displayId should degrade to "do it somewhere sane," not abort the action.
function resolveTargetDisplay(electronScreen, displayId) {
  const primary = electronScreen.getPrimaryDisplay();
  if (displayId === undefined || displayId === null || displayId === '') return primary;
  const all = typeof electronScreen.getAllDisplays === 'function' ? electronScreen.getAllDisplays() : [primary];
  return all.find(d => String(d.id) === String(displayId)) || primary;
}

async function performComputerAction(input, options = {}) {
  const electronScreen = options.screen || require('electron').screen;
  const target = resolveTargetDisplay(electronScreen, options.displayId);
  const scale = Number(target.scaleFactor) || 1;
  const display = {
    bounds: target.bounds || { x: 0, y: 0, width: target.size.width, height: target.size.height },
    sourceWidth: Math.round(target.size.width * scale),
    sourceHeight: Math.round(target.size.height * scale)
  };
  const action = normalizeComputerAction(input, display);
  const runInput = options.runInput || (normalized => runPowerShellInput(buildPowerShellInputScript(normalized)));
  const result = await runInput(action);
  return { ...result, normalizedAction: action, displayId: target.id };
}

function registerHandlers(ipcMain, options = {}) {
  const captureDesktopScreenshot = options.captureDesktopScreenshot;
  ipcMain.handle('open-application', async (event, payload = {}) => {
    if (process.platform !== 'win32' && !options.runApplication) {
      return { success: false, error: 'Application control is currently supported only on Windows.' };
    }
    const conversationId = String(payload.conversationId || '');
    if (!conversationId) return { success: false, error: 'Application control requires an owning Operator conversation.' };
    const mainWindow = shared.mainWindow;
    // A task-scoped control session already minimized Orion and owns restoration. Restoring the
    // main window after every individual click/open operation steals focus from the application
    // Operator is controlling, so per-action hiding is only the fallback for legacy callers.
    const shouldHide = !!(mainWindow && !mainWindow.isDestroyed() && !operatorControlSession.isControlSessionActive());
    if (shouldHide) {
      mainWindow.hide();
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    try {
      const applicationResult = await openWindowsApplication(payload, options);
      if (!applicationResult || applicationResult.success === false) return applicationResult;
      const settleMs = boundedInteger(payload.settleMs, 'settleMs', 0, 10000, 1200);
      if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs));
      let shot = null;
      if (typeof captureDesktopScreenshot === 'function') {
        shot = await captureDesktopScreenshot(payload.workspacePath || '', payload.destination || '', 'application', {
          hideOrion: false,
          conversationId,
          displayId: payload.displayId || ''
        });
      }
      return {
        ...applicationResult,
        success: true,
        path: shot ? shot.rel : '',
        artifactPath: shot ? shot.artifactPath : '',
        artifactRelativePath: shot ? shot.artifactRelativePath : '',
        width: shot ? shot.size.width : 0,
        height: shot ? shot.size.height : 0,
        size: shot ? shot.png.length : 0,
        displayId: payload.displayId || ''
      };
    } catch (error) {
      return { success: false, error: error.message || 'Application control failed.' };
    } finally {
      if (shouldHide) {
        if (typeof mainWindow.showInactive === 'function') mainWindow.showInactive();
        else mainWindow.show();
      }
    }
  });
  ipcMain.handle('computer-action', async (event, payload = {}) => {
    if (process.platform !== 'win32') return { success: false, error: 'Computer use is currently supported only on Windows.' };
    const input = payload.action || {};
    const workspacePath = payload.workspacePath || '';
    const conversationId = String(payload.conversationId || '');
    // Threaded from the capture_screen snapshot the model inspected (see agent.js's computer_action
    // case), never a freestanding model-supplied parameter - so an action always lands on exactly
    // the monitor that was captured and inspected, never a different one by mistake.
    const displayId = payload.displayId === undefined || payload.displayId === null ? '' : payload.displayId;
    if (!conversationId) return { success: false, error: 'Computer use requires an owning Coder conversation.' };

    const mainWindow = shared.mainWindow;
    const shouldHide = !!(mainWindow && !mainWindow.isDestroyed() && !operatorControlSession.isControlSessionActive());
    if (shouldHide) {
      mainWindow.hide();
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    try {
      const actionResult = await performComputerAction(input, { ...options, displayId });
      const normalized = actionResult.normalizedAction;
      if (normalized.settleMs > 0) await new Promise(resolve => setTimeout(resolve, normalized.settleMs));
      let shot = null;
      if (normalized.captureAfter && typeof captureDesktopScreenshot === 'function') {
        shot = await captureDesktopScreenshot(workspacePath, payload.destination || '', 'computer', {
          hideOrion: false,
          conversationId,
          displayId: actionResult.displayId
        });
      }
      return {
        success: true,
        action: normalized.action,
        targetDescription: normalized.targetDescription,
        targetProcess: actionResult.targetProcess || '',
        targetWindow: actionResult.targetWindow || '',
        displayId: actionResult.displayId,
        path: shot ? shot.rel : '',
        artifactPath: shot ? shot.artifactPath : '',
        artifactRelativePath: shot ? shot.artifactRelativePath : '',
        width: shot ? shot.size.width : 0,
        height: shot ? shot.size.height : 0,
        size: shot ? shot.png.length : 0,
        summary: `Performed ${normalized.action} on ${normalized.targetDescription}${shot ? ` and captured the resulting screen (${shot.size.width}x${shot.size.height}).` : '.'}`
      };
    } catch (error) {
      return { success: false, error: error.message || 'Computer action failed.' };
    } finally {
      if (shouldHide) {
        if (typeof mainWindow.showInactive === 'function') mainWindow.showInactive();
        else mainWindow.show();
      }
    }
  });
}

module.exports = {
  KEY_CODES,
  MODIFIER_CODES,
  BLOCKED_KEY_TARGETS,
  normalizeComputerAction,
  buildPowerShellInputScript,
  runPowerShellInput,
  normalizeApplicationName,
  buildOpenApplicationScript,
  runPowerShellJson,
  openWindowsApplication,
  performComputerAction,
  resolveTargetDisplay,
  registerHandlers
};
