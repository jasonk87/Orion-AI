'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BrowserWindow } = require('electron');
const { classifyCommandRequest, resolveWorkspacePath } = require('../safety');
const { safeRelativeAssetPath, downloadFileToWorkspace, writeConversationArtifactBuffer } = require('./ipc-file-tools');
const { compareBitmaps } = require('./screenshot-similarity');
const shared = require('./shared');

const MAX_COMMAND_OUTPUT_CHARS = 200000;
const MAX_COMMAND_SESSIONS = 100;

// Item 6 (state-freshness optimization): a small, bounded in-memory cache of the last screenshot
// the model actually inspected per conversation, so a later capture_screen can be compared against
// it cheaply (see lib/screenshot-similarity.js) before asking for another full model-vision call.
// Deliberately RAM-only and per-process - it is not meant to survive an app restart, and it
// doesn't need to: after a restart the cache is empty, compareToLastInspectedScreenshot reports
// "no prior inspection available," and the existing hard gate in agent.js falls back to requiring
// a fresh inspection, exactly as before this optimization existed. Bounded to a handful of entries
// because each one holds a full raw bitmap (a 1080p capture is ~8MB, 4K is ~32MB).
const MAX_INSPECTION_CACHE_ENTRIES = 5;
const lastInspectedScreenshotCache = new Map(); // conversationId -> { bitmap, width, height, recordedAt }

function recordInspectedScreenshotBaseline(conversationId, bitmap, width, height) {
  const key = String(conversationId || '');
  if (!key || !bitmap || !width || !height) return;
  lastInspectedScreenshotCache.delete(key); // delete+set to bump this key to most-recently-used
  lastInspectedScreenshotCache.set(key, { bitmap, width, height, recordedAt: Date.now() });
  while (lastInspectedScreenshotCache.size > MAX_INSPECTION_CACHE_ENTRIES) {
    const oldestKey = lastInspectedScreenshotCache.keys().next().value;
    lastInspectedScreenshotCache.delete(oldestKey);
  }
}

function compareToLastInspectedScreenshot(conversationId, bitmap, width, height) {
  const key = String(conversationId || '');
  const baseline = key ? lastInspectedScreenshotCache.get(key) : null;
  if (!baseline || !bitmap) {
    return { available: false, unchanged: false, changedFraction: 1, reason: 'no_prior_inspection' };
  }
  const comparison = compareBitmaps(baseline.bitmap, baseline.width, baseline.height, bitmap, width, height);
  return {
    available: true,
    unchanged: !!comparison.identical,
    changedFraction: comparison.changedFraction,
    reason: comparison.reason
  };
}

// When PowerShell hosts a native command whose stderr is redirected (`2>&1`, or any pipeline
// that touches the error stream), it serializes its progress/error records as CLIXML instead of
// plain text — stderr fills with:
//
//   #< CLIXML
//   <Objs Version="1.1.0.1" xmlns="..."><Obj S="progress" .../></Objs>
//
// None of that is an error. It routinely arrived as the ONLY stderr content for commands that
// succeeded, so the agent saw a wall of XML, concluded the command failed, retried the same
// thing, and burned its repeated-failure budget on a phantom. Observed live on `git show`,
// `python main.py --smoke-test`, and a diagnostic script that had actually passed.
//
// Real messages embedded in CLIXML <S> elements are recovered; the envelope is dropped.
function stripPowerShellClixml(text) {
  const raw = String(text == null ? '' : text);
  if (!raw.includes('#< CLIXML')) return raw;

  let cleaned = raw;
  const recovered = [];
  // Pull any human-readable payload out before discarding the envelope.
  cleaned = cleaned.replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, (block) => {
    const strings = block.match(/<S[^>]*>([\s\S]*?)<\/S>/g) || [];
    for (const element of strings) {
      const inner = element.replace(/<[^>]+>/g, '');
      // PowerShell escapes newlines as _x000D__x000A_ inside CLIXML strings.
      const decoded = inner
        .replace(/_x000D__x000A_/g, '\n')
        .replace(/_x000D_/g, '')
        .replace(/_x000A_/g, '\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
      if (decoded) recovered.push(decoded);
    }
    return '';
  });
  // A truncated envelope (output cap hit mid-XML) leaves an unterminated header behind.
  cleaned = cleaned.replace(/#<\s*CLIXML[\s\S]*$/g, '');

  const combined = `${recovered.join('\n')}\n${cleaned}`.trim();
  return combined ? `${combined}\n` : '';
}

// ── Command session management ────────────────────────────────────────────────

function registerCommandSession(processId, session, child) {
  shared.commandSessions[processId] = session;
  shared.activeProcesses[processId] = child;

  const match = processId.match(/^cmd_(conv[_-][a-zA-Z0-9_-]+)_(.+)$/);
  if (match && match[2]) {
    shared.commandAliases[match[2]] = processId;
  }
}

function pruneCommandSessions() {
  const completedIds = Object.keys(shared.commandSessions)
    .filter(id => !shared.activeProcesses[id])
    .sort((a, b) => ((shared.commandSessions[a].finishedAt ?? shared.commandSessions[a].startedAt) || 0) - ((shared.commandSessions[b].finishedAt ?? shared.commandSessions[b].startedAt) || 0));
  while (completedIds.length > MAX_COMMAND_SESSIONS) {
    const id = completedIds.shift();
    delete shared.commandSessions[id];
    Object.keys(shared.commandAliases).forEach(alias => {
      if (shared.commandAliases[alias] === id) delete shared.commandAliases[alias];
    });
  }
}

function resolveCommandSessionId(processId) {
  return shared.commandSessions[processId] ? processId : shared.commandAliases[processId];
}

function killProcessTree(child, callback) {
  if (!child || !child.pid) {
    if (callback) callback();
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', child.pid, '/T', '/F'], { windowsHide: true });
    let settled = false;
    // A spawn failure here (e.g. taskkill unresolvable) would otherwise crash the entire Electron
    // main process via an unhandled 'error' event — fall back to a direct kill instead.
    killer.on('error', err => {
      if (settled) return;
      settled = true;
      console.error('taskkill failed to spawn:', err);
      try { child.kill(); } catch (_) {}
      if (callback) callback(err);
    });
    killer.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        if (callback) callback(null);
        return;
      }
      try { child.kill(); } catch (_) {}
      // taskkill exits 128 when the PID no longer exists. A process that already exited on
      // its own is the outcome the caller asked for, not a failure — reporting an error made
      // callers believe cleanup had failed, and made the lifecycle test flaky (~1 run in 5)
      // whenever the command finished before the kill landed.
      const alreadyExited = code === 128 || child.exitCode !== null || child.signalCode !== null;
      if (callback) callback(alreadyExited ? null : new Error(`Taskkill failed (exit ${code})`));
    });
    return;
  }

  try {
    if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch (_) {
    try { child.kill('SIGTERM'); } catch (_2) {}
  }
  setTimeout(() => {
    try {
      if (!child.killed) {
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      }
    } catch (_) {
      // Both kill attempts failed; forcibly remove the stale entry so it doesn't
      // leak in shared.activeProcesses forever if the close event never fires.
      for (const [id, proc] of Object.entries(shared.activeProcesses)) {
        if (proc === child) { delete shared.activeProcesses[id]; break; }
      }
    }
    if (callback) callback();
  }, 1000);
}

function getCommandShellSpec(command) {
  if (process.platform !== 'win32') {
    return { executable: 'bash', args: ['-c'] };
  }
  if (commandLooksPowerShellSpecific(command)) {
    // -EncodedCommand (base64 of UTF-16LE) instead of -Command: PowerShell's -Command mode
    // re-splits the raw command line through argv parsing and STRIPS the double quotes, so
    // `Get-Content -Path "C:\path with spaces\file"` arrives unquoted and fails with
    // "A positional parameter cannot be found that accepts argument ...". Base64 carries the
    // command through untouched regardless of quotes, spaces, or special characters.
    return {
      executable: resolveWindowsShellExecutable('powershell.exe'),
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'],
      encodeCommandUtf16Base64: true
    };
  }
  return {
    executable: resolveWindowsShellExecutable('cmd.exe'),
    args: ['/d', '/s', '/c']
  };
}

// cmd.exe does not treat `;` as a statement separator the way bash/PowerShell do — a command like
// `set PYTHONPATH=%PYTHONPATH%;. ; python foo.py` gets swallowed whole into the `set` command's
// value under cmd.exe, so the intended second command never runs at all. Worse, this fails
// *silently*: cmd.exe reports exit code 0 with empty output, giving no signal anything went wrong.
// Models frequently write `;`-chained commands (it's valid in bash and PowerShell), so route any
// command with a real, unquoted `;` to PowerShell, where it either executes as intended or fails
// loudly with a real parse error — both are better than a silent no-op.
function hasUnquotedSemicolon(command) {
  const text = String(command || '');
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ';' && !inSingle && !inDouble) return true;
  }
  return false;
}

function commandLooksPowerShellSpecific(command) {
  const text = String(command || '');
  return /\b(Get|Set|New|Remove|Select|Where|ForEach|Start|Stop|Test|Resolve|Copy|Move|Clear|Write|Read|Invoke|Import|Export|ConvertTo|Out)-[A-Za-z]/.test(text)
    || /(^|[^a-zA-Z0-9_])\$\w+/.test(text)
    || /\|\s*(Select-Object|Where-Object|ForEach-Object|Sort-Object|Format-Table|Format-List)\b/i.test(text)
    || /\b-NoProfile\b|\b-ExecutionPolicy\b/i.test(text)
    || hasUnquotedSemicolon(text);
}

function resolveWindowsShellExecutable(preferred = 'powershell.exe') {
  if (process.platform !== 'win32') return preferred;
  const windir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = preferred.toLowerCase().includes('cmd')
    ? [
        path.join(windir, 'System32', 'cmd.exe'),
        path.join(windir, 'Sysnative', 'cmd.exe'),
        'cmd.exe'
      ]
    : [
        path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        path.join(windir, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        'powershell.exe'
      ];
  return candidates.find(candidate => {
    try {
      return candidate.includes(path.sep) ? fs.existsSync(candidate) : true;
    } catch (_) {
      return false;
    }
  }) || preferred;
}

function startCommandSession({ command, cwd, processId, timeoutMs }) {
  if (!command) throw new Error('Missing command');

  const classification = classifyCommandRequest(command, { source: 'freeform' });
  if (!classification.allowed) {
    throw new Error(classification.reason);
  }

  if (!processId) processId = 'cmd_' + Date.now();

  const shellSpec = getCommandShellSpec(command);
  const shell = shellSpec.executable;
  const shellArgs = shellSpec.args;
  const resolvedTimeoutMs = Math.min(Math.max(parseInt(timeoutMs, 10) || 120000, 1000), 30 * 60 * 1000);

  const session = {
    id: processId,
    command,
    cwd,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    timeoutMs: resolvedTimeoutMs,
    exitCode: null,
    error: '',
    timedOut: false,
    killed: false,
    stdout: '',
    stderr: '',
    commandCategory: classification.category
  };

  if (cwd && !fs.existsSync(cwd)) {
    try {
      fs.mkdirSync(cwd, { recursive: true });
    } catch (e) {
      console.error('Failed to create command cwd directory:', e);
    }
  }

  const commandArg = shellSpec.encodeCommandUtf16Base64
    ? Buffer.from(String(command), 'utf16le').toString('base64')
    : command;

  const child = spawn(shell, [...shellArgs, commandArg], {
    cwd: cwd,
    env: { ...process.env, PAGER: 'cat' },
    windowsHide: true,
    detached: process.platform !== 'win32',
    // Without this, Node re-escapes the already-fully-formed `command` string when building the
    // Windows process command line, corrupting any command containing embedded quotes (e.g.
    // `python -c "...'literal'..."` gets truncated mid-string and fails with a syntax error before
    // the shell/interpreter ever sees the real command). `command` is one pre-quoted argv element
    // by design here, so it must be passed through verbatim.
    ...(process.platform === 'win32' ? { windowsVerbatimArguments: true } : {})
  });

  // Phase 3 (restart/recovery, item 12): the raw OS PID, not just the app-level processId string.
  // shared.commandSessions (this whole in-memory registry) does not survive an app restart, so
  // after a crash there is no session left to look up by processId — but the OS PID can still be
  // checked directly (see check-process-alive below) to tell "this background process is still
  // running" from "it died with the crash," which is what makes restart recovery for an
  // interrupted Operator/Coder task smarter than a blind fail.
  session.pid = child.pid || null;
  registerCommandSession(processId, session, child);

  const appendOutput = (type, text) => {
    if (type === 'stderr') {
      session.stderr += stripPowerShellClixml(text);
    } else {
      session.stdout += text;
    }
    if (session.stdout.length > MAX_COMMAND_OUTPUT_CHARS) session.stdout = session.stdout.slice(-MAX_COMMAND_OUTPUT_CHARS);
    if (session.stderr.length > MAX_COMMAND_OUTPUT_CHARS) session.stderr = session.stderr.slice(-MAX_COMMAND_OUTPUT_CHARS);
    if (shared.mainWindow && shared.mainWindow.webContents && !shared.mainWindow.isDestroyed()) {
      shared.mainWindow.webContents.send(`cmd-output-${processId}`, { type, text });
    }
  };

  const timeout = setTimeout(() => {
    if (shared.activeProcesses[processId]) {
      session.timedOut = true;
      session.status = 'timed_out';
      appendOutput('stderr', `\n[Orion] Command timed out after ${resolvedTimeoutMs}ms and was stopped.\n`);
      killProcessTree(child);
    }
  }, resolvedTimeoutMs);

  child.stdout.on('data', (data) => appendOutput('stdout', data.toString()));
  child.stderr.on('data', (data) => appendOutput('stderr', data.toString()));

  child.on('close', (code) => {
    clearTimeout(timeout);
    delete shared.activeProcesses[processId];
    session.exitCode = code;
    session.finishedAt = Date.now();
    if (session.timedOut) {
      session.status = 'timed_out';
    } else if (session.killed) {
      session.status = 'killed';
    } else {
      session.status = code === 0 ? 'completed' : 'failed';
    }
    pruneCommandSessions();
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    delete shared.activeProcesses[processId];
    session.error = err.message;
    session.finishedAt = Date.now();
    session.status = 'error';
    pruneCommandSessions();
  });

  return session;
}

function commandSessionSummary(session, maxChars = 8000) {
  if (!session) return null;
  const output = `${session.stdout || ''}${session.stderr || ''}`;
  return {
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    timeoutMs: session.timeoutMs,
    commandCategory: session.commandCategory,
    exitCode: session.exitCode,
    error: session.error,
    timedOut: session.timedOut,
    killed: session.killed,
    pid: session.pid || null,
    output: output.slice(-maxChars)
  };
}

// Phase 3 (restart/recovery, item 12): checks whether a raw OS PID is still alive, independent of
// shared.commandSessions (which is wiped on every app restart). process.kill(pid, 0) sends no
// signal - it only probes whether the OS still has a process at that PID and this process has
// permission to signal it. ESRCH means the PID does not exist (dead); EPERM means it exists but is
// owned by someone else (rare for a process this app itself spawned, but still "alive"); no throw
// also means alive.
function isProcessAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function normalizeConversationIdForCommandSession(conversationId) {
  return String(conversationId || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function commandBelongsToConversation(processId, conversationId) {
  const rawId = String(conversationId || '');
  if (!processId || !rawId) return false;
  const text = String(processId);
  const normalizedId = normalizeConversationIdForCommandSession(rawId);
  return text.includes(`_${rawId}_`) || text.includes(`_${normalizedId}_`);
}

// ── Browser worker ────────────────────────────────────────────────────────────

let browserWorker = null;

function ensureBrowserWorker() {
  if (browserWorker && !browserWorker.isDestroyed()) {
    browserWorker.show();
    return browserWorker;
  }
  browserWorker = new BrowserWindow({
    show: true,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  
  browserWorker.on('closed', () => {
    browserWorker = null;
  });
  
  return browserWorker;
}

function showAgentBrowser() {
  const win = ensureBrowserWorker();
  win.show();
  win.focus();
  return { success: true };
}

async function getBrowserSnapshot(win) {
  const data = await win.webContents.executeJavaScript(`(() => {
    const links = Array.from(document.querySelectorAll('a')).slice(0, 80).map((a, index) => ({
      index,
      text: (a.innerText || a.textContent || '').trim().slice(0, 160),
      href: a.href || ''
    }));
    return {
      url: location.href,
      title: document.title || '',
      text: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000),
      links
    };
  })()`);
  return { success: true, ...data };
}

async function browserOpenUrl(url) {
  if (!/^https?:\/\//i.test(String(url || '')) && !/^file:\/\//i.test(String(url || ''))) throw new Error('open_url requires http(s) or file URL');
  const win = ensureBrowserWorker();
  await win.loadURL(url);
  return await getBrowserSnapshot(win);
}

async function browserSearchWeb(query) {
  if (!String(query || '').trim()) throw new Error('search_web requires query');
  return await browserOpenUrl(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
}

// Multiple elements can share the same visible text — e.g. an auth-tab button labeled "Register"
// sitting right next to its form's actual submit button, also labeled "Register". Picking the
// first DOM match always landed on the tab (a no-op re-select) instead of the submit button,
// silently failing to submit the form with no error at all. Score candidates so an exact text
// match inside a real <form> wins over a partial match or a bare button outside any form; this
// runs inside the browser's own executeJavaScript context (see .toString() usage below), so it's
// exported here purely so its scoring logic can be unit tested directly against plain descriptors.
function pickBestClickCandidate(candidates, text) {
  const normalizedText = String(text || '').trim().toLowerCase();
  let best = null;
  let bestScore = -1;
  for (const candidate of (candidates || [])) {
    const candidateText = String(candidate.text || '').trim().toLowerCase();
    if (!normalizedText || !candidateText.includes(normalizedText)) continue;
    const score = (candidateText === normalizedText ? 2 : 0) + (candidate.insideForm ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

async function browserClickElement(selector, text) {
  const win = ensureBrowserWorker();
  const result = await win.webContents.executeJavaScript(`(() => {
    const selector = ${JSON.stringify(selector || '')};
    const text = ${JSON.stringify(text || '')};
    const pickBestClickCandidate = ${pickBestClickCandidate.toString()};
    let el = selector ? document.querySelector(selector) : null;
    if (!el && text) {
      const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"]'));
      const candidates = nodes.map(node => ({
        node,
        text: node.innerText || node.textContent || node.value || '',
        insideForm: !!node.closest('form')
      }));
      const best = pickBestClickCandidate(candidates, text);
      el = best ? best.node : null;
    }
    if (!el) return { clicked: false, error: 'Element not found' };
    el.click();
    return { clicked: true };
  })()`);
  if (!result.clicked) return { success: false, error: result.error };
  await new Promise(resolve => setTimeout(resolve, 1000));
  return await getBrowserSnapshot(win);
}

async function browserFillInput(selector, value) {
  const win = ensureBrowserWorker();
  const result = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector || '')});
    if (!el) return { filled: false, error: 'Input not found' };
    el.focus();
    el.value = ${JSON.stringify(String(value || ''))};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { filled: true };
  })()`);
  return result.filled ? await getBrowserSnapshot(win) : { success: false, error: result.error };
}

async function browserNavigateBack() {
  const win = ensureBrowserWorker();
  if (win.webContents.canGoBack()) {
    win.webContents.goBack();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return await getBrowserSnapshot(win);
}

async function browserDownloadFromPage(workspacePath, selector, url, destination) {
  let targetUrl = url;
  if (!targetUrl) {
    const win = ensureBrowserWorker();
    targetUrl = await win.webContents.executeJavaScript(`(() => {
      const selector = ${JSON.stringify(selector || '')};
      const el = selector ? document.querySelector(selector) : document.querySelector('a[href]');
      return el && (el.href || el.src) || '';
    })()`);
  }
  return await downloadFileToWorkspace(workspacePath, targetUrl, destination);
}

async function browserWaitForPage(timeoutMs) {
  const win = ensureBrowserWorker();
  await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(Number(timeoutMs) || 1000, 100), 30000)));
  return await getBrowserSnapshot(win);
}

function writeScreenshotBuffer({ workspacePath, conversationId, destination, fallback, png }) {
  const rel = safeRelativeAssetPath(destination, fallback);
  if (conversationId) {
    const artifact = writeConversationArtifactBuffer(conversationId, rel, png);
    return { rel: artifact.artifactRef, artifactPath: artifact.artifactPath, artifactRelativePath: artifact.relativePath };
  }
  const fullPath = resolveWorkspacePath(workspacePath, rel);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, png);
  return { rel };
}

async function takeBrowserScreenshot(workspacePath, destination, conversationId) {
  const win = ensureBrowserWorker();
  const image = await win.webContents.capturePage();
  const fallback = path.join('screenshots', `screenshot-${Date.now()}.png`);
  const png = image.toPNG();
  const written = writeScreenshotBuffer({ workspacePath, conversationId, destination, fallback, png });
  const size = image.getSize();
  return { success: true, path: written.rel, artifactPath: written.artifactPath, artifactRelativePath: written.artifactRelativePath, width: size.width, height: size.height, size: png.length, summary: `Captured screenshot ${written.rel} (${size.width}x${size.height}).` };
}

async function captureDesktopScreenshot(workspacePath, destination, prefix = 'preview', { hideOrion = false, conversationId = '' } = {}) {
  const { desktopCapturer, screen } = require('electron');

  const shouldHide = hideOrion && shared.mainWindow && !shared.mainWindow.isDestroyed();
  if (shouldHide) {
    shared.mainWindow.hide();
    await new Promise(r => setTimeout(r, 300));
  }

  try {
    const primary = screen.getPrimaryDisplay();
    const scale = primary.scaleFactor || 1;
    const thumbnailSize = {
      width: Math.round(primary.size.width * scale),
      height: Math.round(primary.size.height * scale)
    };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    if (!sources.length) throw new Error('No screen sources available for capture.');
    const primarySource = sources.find(s => String(s.display_id) === String(primary.id)) || sources[0];
    const image = primarySource.thumbnail;
    if (!image || image.isEmpty()) throw new Error('Captured screen image was empty.');
    const fallback = path.join('screenshots', `${prefix}-${Date.now()}.png`);
    const png = image.toPNG();
    const written = writeScreenshotBuffer({ workspacePath, conversationId, destination, fallback, png });
    const size = image.getSize();
    // Raw bitmap captured alongside the PNG so callers (capture_screen's freshness check) can do a
    // cheap pixel comparison without re-decoding the PNG they already have.
    let bitmap = null;
    try { bitmap = image.toBitmap(); } catch (_) { bitmap = null; }
    return { rel: written.rel, png, bitmap, size, artifactPath: written.artifactPath, artifactRelativePath: written.artifactRelativePath };
  } finally {
    if (shouldHide) shared.mainWindow.show();
  }
}

async function previewWorkspaceApp(workspacePath, { command, warmupMs, destination, processId, timeoutMs, conversationId } = {}, getWorkspaceEntrypoint, readAppConfigFn) {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return { success: false, error: 'No active workspace directory found.' };
  }

  let resolvedCommand = String(command || '').trim();
  if (!resolvedCommand) {
    const configuredEntry = getWorkspaceEntrypoint && readAppConfigFn
      ? getWorkspaceEntrypoint(readAppConfigFn(), workspacePath)
      : null;
    if (configuredEntry && configuredEntry.command) {
      resolvedCommand = configuredEntry.command;
    } else {
      const files = fs.readdirSync(workspacePath);
      const foundPy = ['main.py', 'app.py', 'index.py', 'game.py'].find(f => files.includes(f));
      if (foundPy) resolvedCommand = `python ${foundPy}`;
    }
  }
  if (!resolvedCommand) {
    return { success: false, error: 'Could not determine what to preview. Set a workspace entrypoint or pass an explicit command.' };
  }

  let knownWindowIds = new Set();
  try {
    const { desktopCapturer: dc } = require('electron');
    const pre = await dc.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
    knownWindowIds = new Set(pre.map(s => s.id));
  } catch (_) {}

  let session;
  try {
    session = startCommandSession({
      command: resolvedCommand,
      cwd: workspacePath,
      processId: processId || `preview_${Date.now()}`,
      timeoutMs: timeoutMs || 10 * 60 * 1000
    });
  } catch (e) {
    return { success: false, error: e.message };
  }

  const resolvedWarmup = Math.min(Math.max(parseInt(warmupMs, 10) || 4000, 1000), 60000);
  await new Promise(resolve => setTimeout(resolve, resolvedWarmup));

  const stillRunning = !!shared.activeProcesses[session.id];

  if (!stillRunning && session.exitCode !== 0 && session.status !== 'completed') {
    return {
      success: false,
      crashed: true,
      processId: session.id,
      command: resolvedCommand,
      exitCode: session.exitCode,
      stderr: (session.stderr || '').slice(-2000),
      error: `The app exited (code ${session.exitCode}) before a window could be captured — it likely crashed on startup. Inspect the error output and fix it.`
    };
  }

  let shot = null;
  let captureError = null;
  try {
    const { desktopCapturer: dc, screen } = require('electron');
    const primary = screen.getPrimaryDisplay();
    const scale = primary.scaleFactor || 1;
    const thumbSize = { width: Math.round(primary.size.width * scale), height: Math.round(primary.size.height * scale) };

    const post = await dc.getSources({ types: ['window'], thumbnailSize: thumbSize });
    const newWins = post.filter(s => !knownWindowIds.has(s.id) && !s.name.toLowerCase().includes('orion'));

    if (newWins.length > 0) {
      const appSource = newWins[0];
      const image = appSource.thumbnail;
      if (!image || image.isEmpty()) throw new Error('App window capture was empty.');
      const fallback = path.join('screenshots', `preview-${Date.now()}.png`);
      const png = image.toPNG();
      const written = writeScreenshotBuffer({ workspacePath, conversationId, destination, fallback, png });
      shot = { rel: written.rel, png, size: image.getSize(), artifactPath: written.artifactPath, artifactRelativePath: written.artifactRelativePath };
    } else {
      shot = await captureDesktopScreenshot(workspacePath, destination, 'preview', { hideOrion: true, conversationId });
    }
  } catch (err) {
    captureError = err.message;
  }

  const manageHint = `Process id "${session.id}" is left running — wait and capture_screen again to see later state, read_command_output to watch progress, or kill_command when done.`;
  return {
    success: true,
    processId: session.id,
    command: resolvedCommand,
    running: stillRunning,
    exitedDuringWarmup: !stillRunning,
    exitCode: stillRunning ? null : session.exitCode,
    path: shot ? shot.rel : '',
    artifactPath: shot ? shot.artifactPath : '',
    artifactRelativePath: shot ? shot.artifactRelativePath : '',
    width: shot ? shot.size.width : 0,
    height: shot ? shot.size.height : 0,
    size: shot ? shot.png.length : 0,
    warmupMs: resolvedWarmup,
    backstopTimeoutMs: session.timeoutMs,
    stderr: (session.stderr || '').slice(-2000),
    captureError: captureError || undefined,
    summary: shot
      ? `Previewed "${resolvedCommand}" (${stillRunning ? 'still running' : 'exited during warm-up'}); captured ${shot.rel} (${shot.size.width}x${shot.size.height}). ${manageHint}`
      : `Launched "${resolvedCommand}" but screen capture failed: ${captureError || 'unknown error'}. ${manageHint}`
  };
}

async function captureScreenForAgent(workspacePath, { destination, delayMs, conversationId } = {}) {
  if ((!workspacePath || !fs.existsSync(workspacePath)) && !conversationId) {
    return { success: false, error: 'No active workspace directory found.' };
  }
  const wait = Math.min(Math.max(parseInt(delayMs, 10) || 0, 0), 120000);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  try {
    const shot = await captureDesktopScreenshot(workspacePath, destination, 'capture', { hideOrion: true, conversationId });
    const freshnessCheck = compareToLastInspectedScreenshot(conversationId, shot.bitmap, shot.size.width, shot.size.height);
    return {
      success: true,
      path: shot.rel,
      artifactPath: shot.artifactPath,
      artifactRelativePath: shot.artifactRelativePath,
      width: shot.size.width,
      height: shot.size.height,
      size: shot.png.length,
      waitedMs: wait,
      freshnessCheck,
      summary: `Captured the current screen to ${shot.rel} (${shot.size.width}x${shot.size.height})${wait ? ` after waiting ${wait}ms` : ''}.`
    };
  } catch (err) {
    return { success: false, error: `Screen capture failed: ${err.message}` };
  }
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain, { getWorkspaceEntrypoint, readAppConfig: readAppConfigFn } = {}) {
  ipcMain.handle('run-command', (event, { command, cwd, processId, timeoutMs }) => {
    return new Promise((resolve) => {
      try {
        const session = startCommandSession({ command, cwd, processId, timeoutMs });
        const poll = setInterval(() => {
          if (session.status !== 'running') {
            clearInterval(poll);
            resolve({
              code: session.exitCode,
              stdout: session.stdout,
              stderr: session.stderr,
              error: session.error,
              timedOut: session.timedOut,
              killed: session.killed,
              timeoutMs: session.timeoutMs
            });
          }
        }, 200);
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  });

  ipcMain.handle('start-command', (event, { command, cwd, processId, timeoutMs }) => {
    try {
      const session = startCommandSession({ command, cwd, processId, timeoutMs });
      return { success: true, ...commandSessionSummary(session, 2000) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-command-status', (event, processId) => {
    const resolvedId = resolveCommandSessionId(processId);
    const session = shared.commandSessions[resolvedId];
    if (!session) return { success: false, error: `Unknown command session "${resolvedId}". The command was never started or the session ID is wrong — use start_command to launch it first.` };
    return { success: true, ...commandSessionSummary(session, 2000) };
  });

  ipcMain.handle('read-command-output', (event, { processId, maxChars }) => {
    const resolvedId = resolveCommandSessionId(processId);
    const session = shared.commandSessions[resolvedId];
    if (!session) return { success: false, error: `Unknown command session "${resolvedId}". The command was never started or the session ID is wrong — use start_command to launch it first.` };
    return { success: true, ...commandSessionSummary(session, parseInt(maxChars, 10) || 12000) };
  });

  ipcMain.handle('kill-command', (event, processId) => {
    const resolvedId = resolveCommandSessionId(processId);
    if (shared.activeProcesses[resolvedId]) {
      try {
        if (shared.commandSessions[resolvedId]) {
          shared.commandSessions[resolvedId].killed = true;
          shared.commandSessions[resolvedId].status = 'killed';
        }
        killProcessTree(shared.activeProcesses[resolvedId]);
        return { success: true };
      } catch (e) {
        console.error('Failed to kill process:', e);
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'No running process found for that session.' };
  });

  ipcMain.handle('check-process-alive', (event, pid) => {
    return { success: true, alive: isProcessAlive(pid) };
  });

  ipcMain.handle('kill-commands-for-conversation', (event, conversationId) => {
    if (!conversationId) return { success: false, error: 'Missing conversation id' };
    let killed = 0;
    Object.keys(shared.activeProcesses).forEach((processId) => {
      if (commandBelongsToConversation(processId, conversationId)) {
        const session = shared.commandSessions[processId];
        if (session) {
          session.killed = true;
          session.status = 'killed';
        }
        killProcessTree(shared.activeProcesses[processId]);
        killed++;
      }
    });
    return { success: true, killed };
  });

  ipcMain.handle('google-search', async (event, { query, apiKey, searchEngineId, numResults }) => {
    try {
      if (!query || !query.trim()) throw new Error('Missing search query');
      if (!apiKey || !apiKey.trim()) throw new Error('Missing Google Search API key');
      if (!searchEngineId || !searchEngineId.trim()) throw new Error('Missing Google Search Engine ID');
      const params = new URLSearchParams({
        key: apiKey.trim(),
        cx: searchEngineId.trim(),
        q: query.trim(),
        num: String(Math.min(Math.max(parseInt(numResults, 10) || 5, 1), 10))
      });
      const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return {
        success: true,
        items: (data.items || []).map((item) => ({
          title: item.title || '',
          link: item.link || '',
          snippet: item.snippet || '',
          displayLink: item.displayLink || ''
        }))
      };
    } catch (e) {
      console.error('Google search failed:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fetch-web-page', async (event, { url }) => {
    try {
      if (!url || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be fetched');
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OrionAI/2.0 (+https://localhost)' }
      });
      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
      let text = rawText;
      if (contentType.includes('html')) {
        text = rawText
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      }
      return { success: true, url, contentType, text: text.slice(0, 12000) };
    } catch (e) {
      console.error('Web page fetch failed:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('browser-open-url', async (event, { url }) => {
    try { return await browserOpenUrl(url); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('browser-search-web', async (event, { query }) => {
    try { return await browserSearchWeb(query); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('browser-click-element', async (event, { selector, text }) => {
    try { return await browserClickElement(selector, text); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('browser-fill-input', async (event, { selector, value }) => {
    try { return await browserFillInput(selector, value); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('browser-navigate-back', async () => {
    try { return await browserNavigateBack(); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('browser-download-from-page', async (event, { workspacePath, selector, url, destination }) => {
    try { return await browserDownloadFromPage(workspacePath, selector, url, destination); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('browser-wait-for-page', async (event, { timeoutMs }) => {
    try { return await browserWaitForPage(timeoutMs); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('take-screenshot', async (event, { workspacePath, destination, conversationId }) => {
    try { return await takeBrowserScreenshot(workspacePath, destination, conversationId); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('show-agent-browser', async () => {
    try { return showAgentBrowser(); } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('preview-workspace-app', async (event, { workspacePath, command, warmupMs, destination, processId, timeoutMs, conversationId }) => {
    try {
      return await previewWorkspaceApp(workspacePath, { command, warmupMs, destination, processId, timeoutMs, conversationId }, getWorkspaceEntrypoint, readAppConfigFn);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('capture-screen', async (event, { workspacePath, destination, delayMs, conversationId }) => {
    try { return await captureScreenForAgent(workspacePath, { destination, delayMs, conversationId }); } catch (e) { return { success: false, error: e.message }; }
  });

  // Called right after a real inspect_screenshot_with_model call succeeds, so the next
  // capture_screen has a baseline to cheaply compare against (see compareToLastInspectedScreenshot
  // above). Reads the exact file that was inspected, off the same workspace boundary every other
  // file tool uses, rather than trusting a bitmap handed back from the renderer.
  ipcMain.handle('record-inspected-screenshot', async (event, { workspacePath, path: relPath, conversationId }) => {
    try {
      if (!relPath) return { success: false, error: 'Missing path' };
      const fullPath = resolveWorkspacePath(workspacePath, relPath);
      if (!fs.existsSync(fullPath)) return { success: false, error: 'Screenshot file not found' };
      const { nativeImage } = require('electron');
      const buffer = fs.readFileSync(fullPath);
      const image = nativeImage.createFromBuffer(buffer);
      if (!image || image.isEmpty()) return { success: false, error: 'Could not decode screenshot image' };
      const size = image.getSize();
      recordInspectedScreenshotBaseline(conversationId, image.toBitmap(), size.width, size.height);
      return { success: true, width: size.width, height: size.height };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  registerHandlers,
  stripPowerShellClixml,
  startCommandSession,
  killProcessTree,
  commandBelongsToConversation,
  normalizeConversationIdForCommandSession,
  commandLooksPowerShellSpecific,
  hasUnquotedSemicolon,
  getCommandShellSpec,
  resolveWindowsShellExecutable,
  captureDesktopScreenshot,
  previewWorkspaceApp,
  pickBestClickCandidate,
  isProcessAlive,
  recordInspectedScreenshotBaseline,
  compareToLastInspectedScreenshot
};
