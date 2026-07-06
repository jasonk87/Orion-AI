'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { app, BrowserWindow } = require('electron');
const { readAppConfig } = require('./config');
const shared = require('./shared');

// ── Auto-update system ────────────────────────────────────────────────────────
// The packaged .exe loads its code from resources/app. When the developer updates
// the source tree, the running app would otherwise stay frozen at build time.
// On startup the packaged app checks the source tree for newer runtime files,
// copies any that differ, and relaunches so the new code takes effect.

const AUTO_UPDATE_FILES = [
  'main.js', 'preload.js', 'agent.js', 'renderer.js', 'styles.css', 'index.html',
  'operational-context.js', 'safety.js', 'package.json',
  'lib/ipc-file-tools.js', 'lib/ipc-shell.js', 'lib/ipc-workspace.js',
  'lib/ipc-server.js', 'lib/ipc-ui.js', 'lib/ipc-skill.js', 'lib/ipc-memory.js',
  'lib/companion-html.js', 'lib/shared.js', 'lib/config.js', 'lib/symbol-index.js',
  'lib/project-memory.js', 'lib/memory-manager.js', 'lib/skill-loader.js'
];

function isLikelySourceDir(dir) {
  try {
    return !!dir
      && fs.existsSync(path.join(dir, 'agent.js'))
      && fs.existsSync(path.join(dir, 'renderer.js'))
      && fs.existsSync(path.join(dir, 'package.json'));
  } catch (_) {
    return false;
  }
}

function uniqueExistingCandidates(candidates) {
  const seen = new Set();
  return candidates
    .filter(Boolean)
    .map(candidate => path.resolve(candidate))
    .filter(candidate => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resolveUpdateSourceDir(baseDir = __dirname) {
  try {
    const cfg = readAppConfig();
    const configured = (cfg.updateSourceDir || '').trim();
    if (configured && isLikelySourceDir(configured)) return configured;
    const envSourceDir = (process.env.ORION_UPDATE_SOURCE_DIR || '').trim();
    if (envSourceDir && isLikelySourceDir(envSourceDir)) return envSourceDir;
    const candidates = uniqueExistingCandidates([
      // Packaged layout: <repo>/dist/OrionAI-win32-x64/resources/app/lib
      path.resolve(baseDir, '..', '..', '..', '..', '..'),
      // Legacy/staging layout used by early updater builds.
      path.resolve(baseDir, '..', '..', '..', '..'),
      process.cwd()
    ]);
    for (const candidate of candidates) {
      if (isLikelySourceDir(candidate)) return candidate;
    }
  } catch (_) {}
  return '';
}

function computeSourceUpdates(srcDir, destDir, files = AUTO_UPDATE_FILES) {
  const changed = [];
  if (!srcDir || !destDir || path.resolve(srcDir) === path.resolve(destDir)) return changed;
  for (const f of files) {
    try {
      const srcPath = path.join(srcDir, f);
      if (!fs.existsSync(srcPath)) continue;
      const srcBuf = fs.readFileSync(srcPath);
      let destBuf = null;
      try { destBuf = fs.readFileSync(path.join(destDir, f)); } catch (_) {}
      if (!destBuf || !srcBuf.equals(destBuf)) changed.push(f);
    } catch (_) {}
  }
  return changed;
}

function readPackageMetadata(baseDir = __dirname) {
  try {
    return JSON.parse(fs.readFileSync(path.join(baseDir, '..', 'package.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

function getLatestRuntimeMtime(baseDir, files = AUTO_UPDATE_FILES) {
  const base = baseDir || path.join(__dirname, '..');
  let latest = 0;
  for (const f of files) {
    try {
      const stat = fs.statSync(path.join(base, f));
      latest = Math.max(latest, stat.mtimeMs || 0);
    } catch (_) {}
  }
  return latest ? new Date(latest) : null;
}

function formatRuntimeDate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getAppRuntimeInfo() {
  const pkg = readPackageMetadata();
  const appRoot = path.join(__dirname, '..');
  const runtimeDate = getLatestRuntimeMtime(appRoot);
  const version = (app && app.getVersion ? app.getVersion() : '') || pkg.version || '0.0.0';
  return {
    name: pkg.productName || pkg.name || 'Orion AI',
    version,
    runtimeDate: runtimeDate ? runtimeDate.toISOString() : '',
    runtimeDateLabel: formatRuntimeDate(runtimeDate),
    isPackaged: !!(app && app.isPackaged)
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildUpdateSplashHtml({ changed = [] } = {}) {
  const info = getAppRuntimeInfo();
  const changedText = changed.length
    ? changed.slice(0, 4).join(', ') + (changed.length > 4 ? ` +${changed.length - 4} more` : '')
    : 'runtime files';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Updating Orion AI</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07090f;
      --panel: rgba(17, 23, 36, 0.92);
      --border: rgba(151,164,196,.18);
      --text: #f1f1f4;
      --muted: #8f98b8;
      --accent: #8273f4;
      --success: #46d59b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% -18%, rgba(130,115,244,.22), transparent 38%),
        linear-gradient(180deg, #0b0f18 0%, var(--bg) 100%);
      color: var(--text);
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      user-select: none;
    }
    .shell {
      width: min(560px, calc(100vw - 44px));
      padding: 28px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--panel);
      box-shadow: 0 30px 90px rgba(0,0,0,.48), inset 0 1px rgba(255,255,255,.03);
    }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .orb {
      width: 34px;
      height: 34px;
      border: 1px solid rgba(130,115,244,.55);
      border-radius: 50%;
      background: radial-gradient(circle, rgba(190,181,255,.72), rgba(130,115,244,.36) 42%, rgba(28,24,72,.7) 58%, transparent 60%);
      box-shadow: 0 0 34px rgba(130,115,244,.22), inset 0 0 16px rgba(190,181,255,.16);
      animation: breathe 1.6s ease-in-out infinite;
    }
    .title { font-size: 13px; font-weight: 700; letter-spacing: .02em; }
    .meta { margin-top: 2px; color: var(--muted); font-size: 11px; }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.18;
      letter-spacing: -0.02em;
    }
    p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .status {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 22px;
      padding: 12px 13px;
      border: 1px solid rgba(151,164,196,.14);
      border-radius: 10px;
      background: rgba(255,255,255,.025);
      color: #c7ccec;
      font-size: 12px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 12px rgba(130,115,244,.5);
      animation: pulse 1s ease-in-out infinite;
    }
    .bar {
      position: relative;
      height: 3px;
      margin-top: 18px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(151,164,196,.12);
    }
    .bar::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 38%;
      border-radius: inherit;
      background: linear-gradient(90deg, transparent, var(--accent), var(--success));
      animation: sweep 1.2s ease-in-out infinite;
    }
    body[data-phase="relaunch"] .dot {
      background: var(--success);
      box-shadow: 0 0 12px rgba(70,213,155,.45);
    }
    @keyframes breathe { 50% { transform: scale(1.05); filter: brightness(1.18); } }
    @keyframes pulse { 50% { transform: scale(.72); opacity: .68; } }
    @keyframes sweep { 0% { transform: translateX(-110%); } 100% { transform: translateX(280%); } }
    @media (prefers-reduced-motion: reduce) {
      .orb, .dot, .bar::before { animation: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand">
      <div class="orb" aria-hidden="true"></div>
      <div>
        <div class="title">Orion AI</div>
        <div class="meta">v${escapeHtml(info.version)}${info.runtimeDateLabel ? ` · ${escapeHtml(info.runtimeDateLabel)}` : ''}</div>
      </div>
    </div>
    <h1>Updating local build</h1>
    <p>Orion found newer source files and is syncing the packaged app before opening the workspace.</p>
    <div class="status" aria-live="polite">
      <span class="dot"></span>
      <span id="status-text">Applying ${escapeHtml(changedText)} from the local source tree...</span>
    </div>
    <div class="bar" aria-hidden="true"></div>
  </main>
  <script>
    var relaunchText = "Update applied. Relaunching Orion with the latest local code...";
    window.setUpdatePhase = function (phase, text) {
      document.body.dataset.phase = phase || "";
      var status = document.getElementById("status-text");
      if (!text && phase === "relaunch") text = relaunchText;
      if (status && text) status.textContent = text;
    };
  </script>
</body>
</html>`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showUpdateSplashWindow(updateInfo) {
  const updateWindow = new BrowserWindow({
    width: 560,
    height: 360,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    backgroundColor: '#07090f',
    title: 'Updating Orion AI',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  updateWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildUpdateSplashHtml(updateInfo))}`);
  return updateWindow;
}

function syncSourceUpdateFiles(srcDir, destDir, changed) {
  for (const f of changed) {
    const srcPath = path.join(srcDir, f);
    const destPath = path.join(destDir, f);
    // Ensure subdirectory exists (e.g., lib/)
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, fs.readFileSync(srcPath));
    try {
      const stat = fs.statSync(srcPath);
      fs.utimesSync(destPath, stat.atime, stat.mtime);
    } catch (_) {}
  }
}

async function checkForSourceUpdatesAndRelaunch() {
  let updateWindow = null;
  try {
    if (!app || !app.isPackaged) return false;
    const srcDir = resolveUpdateSourceDir();
    if (!srcDir) return false;
    const appRoot = path.join(__dirname, '..');
    const changed = computeSourceUpdates(srcDir, appRoot);
    if (!changed.length) return false;
    updateWindow = showUpdateSplashWindow({ changed });
    await Promise.race([
      new Promise(resolve => updateWindow.webContents.once('did-finish-load', resolve)),
      sleep(800)
    ]);

    syncSourceUpdateFiles(srcDir, appRoot, changed);
    try {
      await updateWindow.webContents.executeJavaScript(
        `window.setUpdatePhase("relaunch", "Update applied. Relaunching Orion with the latest local code...")`
      );
    } catch (_) {}
    await sleep(900);
    console.log('Auto-update: synced newer files and relaunching ->', changed.join(', '));
    app.relaunch();
    app.exit(0);
    return true;
  } catch (e) {
    if (updateWindow && !updateWindow.isDestroyed()) {
      try { updateWindow.close(); } catch (_) {}
    }
    console.error('Auto-update check failed:', e);
    return false;
  }
}

// ── Git remote update checker ─────────────────────────────────────────────────

/**
 * Checks whether the source git repository has new commits on the remote.
 * Returns { hasUpdate, commitsBehind, localHash, remoteHash } or { hasUpdate: false, offline: true }.
 */
async function checkGitRemoteForUpdates(srcDir) {
  if (!srcDir) return { hasUpdate: false, error: 'No source directory' };
  try {
    // Fetch latest refs from remote (quiet, no merge)
    execSync('git fetch --quiet', { cwd: srcDir, timeout: 12000, stdio: 'pipe' });

    const localHash = execSync('git rev-parse HEAD', { cwd: srcDir, timeout: 5000, stdio: 'pipe' })
      .toString().trim();

    let remoteHash = '';
    try {
      remoteHash = execSync('git rev-parse @{u}', { cwd: srcDir, timeout: 5000, stdio: 'pipe' })
        .toString().trim();
    } catch (_) {
      // No upstream configured — fall back to origin/HEAD
      remoteHash = execSync('git rev-parse origin/HEAD', { cwd: srcDir, timeout: 5000, stdio: 'pipe' })
        .toString().trim();
    }

    if (!remoteHash || localHash === remoteHash) return { hasUpdate: false };

    const behindStr = execSync('git rev-list --count HEAD..@{u} 2>/dev/null || git rev-list --count HEAD..origin/HEAD', {
      cwd: srcDir, timeout: 5000, stdio: 'pipe', shell: true
    }).toString().trim();
    const commitsBehind = parseInt(behind