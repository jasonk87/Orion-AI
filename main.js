const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

let mainWindow;
let companionServer = null;
let companionToken = '';

function resolveWorkspacePath(workspacePath, relativePath = '') {
  if (!workspacePath) throw new Error('Missing workspace path');
  const workspaceRoot = path.resolve(workspacePath);
  const fullPath = path.resolve(workspaceRoot, relativePath || '');
  const relative = path.relative(workspaceRoot, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the active workspace');
  }
  return fullPath;
}

function createFileBackup(fullPath, workspaceRoot) {
  if (!fs.existsSync(fullPath)) return null;
  const backupRoot = path.join(workspaceRoot, '.orion', 'backups');
  const relative = path.relative(workspaceRoot, fullPath);
  const safeRelative = relative.replace(/[:<>|"?*]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupRoot, `${safeRelative}.${timestamp}.bak`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.cpSync(fullPath, backupPath, { recursive: true });
  } else {
    fs.copyFileSync(fullPath, backupPath);
  }
  return path.relative(workspaceRoot, backupPath);
}

function getArtifactRoot() {
  const base = app && app.getPath ? app.getPath('userData') : __dirname;
  return path.join(base, 'artifacts');
}

function sanitizeArtifactSegment(value) {
  return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';
}

function writeRunArtifact(payload = {}) {
  const conversationId = sanitizeArtifactSegment(payload.conversationId);
  const runId = sanitizeArtifactSegment(payload.runId || new Date().toISOString());
  const artifactDir = path.join(getArtifactRoot(), conversationId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${runId}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    ...payload
  }, null, 2), 'utf8');
  return artifactPath;
}

function listRunArtifacts(conversationId) {
  const root = getArtifactRoot();
  const entries = [];
  if (!fs.existsSync(root)) return entries;
  const conversationDirs = conversationId
    ? [sanitizeArtifactSegment(conversationId)]
    : fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isDirectory());
  conversationDirs.forEach(dirName => {
    const dirPath = path.join(root, dirName);
    if (!fs.existsSync(dirPath)) return;
    fs.readdirSync(dirPath).filter(name => name.endsWith('.json')).forEach(fileName => {
      const fullPath = path.join(dirPath, fileName);
      const stat = fs.statSync(fullPath);
      entries.push({
        conversationId: dirName,
        fileName,
        artifactPath: fullPath,
        createdAt: stat.mtime.toISOString(),
        size: stat.size
      });
    });
  });
  return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
}

function deleteWorkspacePath(workspacePath, relativePath) {
  const workspaceRoot = path.resolve(workspacePath);
  const fullPath = resolveWorkspacePath(workspacePath, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('Path does not exist');
  const backupPath = createFileBackup(fullPath, workspaceRoot);
  fs.rmSync(fullPath, { recursive: true, force: false });
  return { success: true, backupPath };
}

function moveWorkspacePath(workspacePath, fromPath, toPath) {
  const fromFullPath = resolveWorkspacePath(workspacePath, fromPath);
  const toFullPath = resolveWorkspacePath(workspacePath, toPath);
  if (!fs.existsSync(fromFullPath)) throw new Error('Source path does not exist');
  if (fs.existsSync(toFullPath)) throw new Error('Destination already exists');
  fs.mkdirSync(path.dirname(toFullPath), { recursive: true });
  fs.renameSync(fromFullPath, toFullPath);
  return { success: true };
}

function copyWorkspacePath(workspacePath, fromPath, toPath) {
  const fromFullPath = resolveWorkspacePath(workspacePath, fromPath);
  const toFullPath = resolveWorkspacePath(workspacePath, toPath);
  if (!fs.existsSync(fromFullPath)) throw new Error('Source path does not exist');
  if (fs.existsSync(toFullPath)) throw new Error('Destination already exists');
  fs.mkdirSync(path.dirname(toFullPath), { recursive: true });
  const stat = fs.statSync(fromFullPath);
  if (stat.isDirectory()) {
    fs.cpSync(fromFullPath, toFullPath, { recursive: true });
  } else {
    fs.copyFileSync(fromFullPath, toFullPath);
  }
  return { success: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true, // Launch in fullscreen mode
    frame: false, // Borderless window to enable custom title bar matching screenshot
    backgroundColor: '#0c0c0e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Open DevTools in development if needed
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  startPhoneCompanionServer();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (companionServer) {
    companionServer.close();
    companionServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

function readAppConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading config:', e);
  }
  return {};
}

function writeAppConfig(config) {
  const configPath = path.join(__dirname, 'config.json');
  const tempPath = path.join(__dirname, 'config.tmp.json');
  try {
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tempPath, configPath);
  } catch (e) {
    console.error('Error writing config:', e);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch(err) {}
    }
  }
}

function getLocalWifiAddress() {
  const nets = os.networkInterfaces();
  for (const interfaces of Object.values(nets)) {
    for (const net of interfaces || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function ensureCompanionToken(config) {
  if (config.phoneCompanionToken && String(config.phoneCompanionToken).length >= 16) {
    return config.phoneCompanionToken;
  }
  config.phoneCompanionToken = crypto.randomBytes(18).toString('base64url');
  writeAppConfig(config);
  return config.phoneCompanionToken;
}

function ensureCompanionPairingCode(config) {
  if (config.phoneCompanionPairingCode && String(config.phoneCompanionPairingCode).length >= 12) {
    return config.phoneCompanionPairingCode;
  }
  config.phoneCompanionPairingCode = crypto.randomBytes(12).toString('base64url');
  writeAppConfig(config);
  return config.phoneCompanionPairingCode;
}

function getCompanionDevices(config) {
  return Array.isArray(config.phoneCompanionDevices) ? config.phoneCompanionDevices : [];
}

function saveCompanionDevice(config, device) {
  const devices = getCompanionDevices(config).filter(d => d.id !== device.id);
  devices.push(device);
  config.phoneCompanionDevices = devices;
  writeAppConfig(config);
  return device;
}

function createCompanionDeviceSession(config, deviceName) {
  const now = new Date().toISOString();
  const device = {
    id: crypto.randomBytes(12).toString('base64url'),
    name: String(deviceName || 'Phone').slice(0, 80),
    secret: crypto.randomBytes(24).toString('base64url'),
    approved: true,
    revoked: false,
    pairedAt: now,
    lastSeenAt: now
  };
  return saveCompanionDevice(config, device);
}

function authenticateCompanionRequest(req, config) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const session = bearer ? bearer[1] : String(req.headers['x-orion-session'] || '');
  const deviceId = String(req.headers['x-orion-device-id'] || '');
  if (!session || !deviceId) return null;
  const device = getCompanionDevices(config).find(d => d.id === deviceId && d.secret === session && d.approved && !d.revoked);
  if (!device) return null;
  device.lastSeenAt = new Date().toISOString();
  saveCompanionDevice(config, device);
  return device;
}

function companionDevicePublic(device) {
  return {
    id: device.id,
    name: device.name,
    approved: !!device.approved,
    revoked: !!device.revoked,
    pairedAt: device.pairedAt || '',
    lastSeenAt: device.lastSeenAt || ''
  };
}

function companionManifest() {
  return {
    name: 'Orion AI Phone Companion',
    short_name: 'Orion',
    description: 'Control Orion AI from your phone on your local Wi-Fi.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#09090d',
    theme_color: '#8b5cf6',
    orientation: 'portrait',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
    ]
  };
}

function companionServiceWorker() {
  return `const CACHE = 'orion-phone-companion-v1';
const SHELL = ['/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname === '/manifest.webmanifest' || url.pathname === '/sw.js') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});`;
}

function companionIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="42%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#111827"/>
    </radialGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".35"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="#09090d"/>
  <path filter="url(#s)" d="M256 68c103.8 0 188 84.2 188 188s-84.2 188-188 188S68 359.8 68 256 152.2 68 256 68Z" fill="url(#g)"/>
  <path d="M258 134c64 0 117 50 121 113 4 70-52 132-123 132-37 0-70-16-93-42l50-50c9 13 24 22 42 22 29 0 53-24 53-53s-24-53-53-53c-18 0-34 9-44 23l-50-50c23-26 57-42 97-42Z" fill="#fff"/>
</svg>`;
}

function companionHtml(pairingCode) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Orion AI Phone Companion</title>
  <meta name="theme-color" content="#8b5cf6">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg">
  <style>
    :root { color-scheme: dark; --bg:#08080d; --panel:rgba(18,17,28,.78); --panel-strong:rgba(24,23,36,.96); --line:rgba(167,139,250,.18); --text:#f7f4ff; --muted:#a7a0c4; --accent:#a78bfa; --accent-strong:#8b5cf6; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background: radial-gradient(circle at 16% -8%, rgba(96,165,250,.24), transparent 34%), radial-gradient(circle at 86% 0%, rgba(167,139,250,.22), transparent 36%), linear-gradient(180deg,#0b0b12 0%,#08080d 45%,#06060a 100%); overflow-x:hidden; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; background-image:linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px); background-size:32px 32px; mask-image:linear-gradient(to bottom, rgba(0,0,0,.9), transparent 65%); }
    .app-shell { min-height:100vh; padding-bottom:calc(164px + env(safe-area-inset-bottom)); }
    header { position:sticky; top:0; z-index:5; padding:calc(14px + env(safe-area-inset-top)) 16px 12px; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(8,8,13,.82); backdrop-filter:blur(20px); }
    .topline { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .brand { display:flex; align-items:center; min-width:0; gap:10px; }
    .mark { width:36px; height:36px; border-radius:12px; display:grid; place-items:center; background:linear-gradient(145deg,#60a5fa,#8b5cf6 55%,#171827); box-shadow:0 10px 30px rgba(139,92,246,.28); font-weight:900; }
    h1 { margin:0; font-size:1.02rem; letter-spacing:0; line-height:1.1; }
    .meta { margin-top:4px; color:var(--muted); font-size:.76rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:68vw; }
    .status-pill { flex:0 0 auto; padding:7px 9px; border-radius:999px; border:1px solid var(--line); background:rgba(18,17,28,.66); color:var(--muted); font-size:.72rem; font-weight:700; }
    .status-pill.running { color:#e8ddff; border-color:rgba(52,211,153,.28); background:rgba(52,211,153,.12); }
    .context-card { margin-top:12px; padding:12px; border:1px solid rgba(255,255,255,.08); border-radius:14px; background:linear-gradient(180deg,rgba(24,23,36,.86),rgba(13,13,20,.7)); }
    .context-row { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--muted); font-size:.75rem; }
    .model { color:var(--text); font-weight:700; }
    .substatus { margin-top:8px; color:var(--accent); font-size:.76rem; min-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .queue-line { margin-top:6px; color:var(--muted); font-size:.72rem; }
    .output-panel { margin-bottom:12px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:12px; background:rgba(12,12,18,.72); color:var(--muted); font-size:.74rem; line-height:1.35; max-height:120px; overflow:auto; white-space:pre-wrap; }
    .preview-panel, .conversation-panel { margin-bottom:12px; padding:11px; border:1px solid rgba(255,255,255,.08); border-radius:12px; background:rgba(12,12,18,.72); }
    .panel-title { margin-bottom:8px; font-size:.72rem; color:#c4b5fd; font-weight:850; text-transform:uppercase; letter-spacing:.08em; }
    select { width:100%; min-height:38px; border:1px solid rgba(167,139,250,.25); border-radius:10px; padding:0 9px; background:rgba(18,17,28,.94); color:var(--text); }
    .preview-grid { display:grid; gap:8px; }
    .preview-item { color:var(--muted); font-size:.72rem; white-space:pre-wrap; max-height:92px; overflow:auto; }
    .install-tip { display:none; margin-top:10px; padding:9px 10px; border:1px dashed rgba(167,139,250,.36); border-radius:12px; color:#ddd6fe; background:rgba(167,139,250,.09); font-size:.76rem; line-height:1.35; }
    .install-tip.visible { display:block; }
    main { position:relative; z-index:1; padding:14px; }
    .plan-panel { display:none; margin-bottom:12px; padding:13px; border-radius:16px; border:1px solid rgba(251,191,36,.28); background:linear-gradient(135deg,rgba(251,191,36,.12),rgba(167,139,250,.08)); }
    .plan-panel.visible { display:block; }
    .plan-title { font-size:.86rem; font-weight:800; margin-bottom:4px; }
    .plan-copy { color:var(--muted); font-size:.78rem; line-height:1.35; margin-bottom:10px; }
    .task-strip { display:flex; gap:8px; overflow-x:auto; padding:2px 0 10px; margin-bottom:4px; }
    .task-chip { flex:0 0 auto; max-width:220px; padding:7px 9px; border:1px solid rgba(255,255,255,.08); border-radius:999px; color:var(--muted); background:rgba(18,17,28,.76); font-size:.72rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .task-chip.completed { color:rgba(209,250,229,.9); border-color:rgba(52,211,153,.25); }
    .task-chip.in-progress { color:#ddd6fe; border-color:rgba(167,139,250,.36); }
    .messages { display:flex; flex-direction:column; gap:12px; }
    .message { max-width:92%; padding:12px 13px; border:1px solid rgba(255,255,255,.08); border-radius:17px; line-height:1.48; white-space:pre-wrap; word-break:break-word; background:rgba(17,16,25,.86); box-shadow:0 12px 30px rgba(0,0,0,.12); }
    .message.user { align-self:flex-end; border-color:rgba(167,139,250,.36); background:linear-gradient(135deg,rgba(139,92,246,.22),rgba(37,34,58,.92)); }
    .message.assistant { align-self:flex-start; border-color:rgba(52,211,153,.18); }
    .message.system { align-self:center; max-width:100%; color:var(--muted); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.75rem; background:rgba(12,12,18,.72); }
    .role { display:block; margin-bottom:6px; color:#c4b5fd; font-size:.66rem; font-weight:850; text-transform:uppercase; letter-spacing:.08em; }
    form { position:fixed; z-index:8; left:0; right:0; bottom:0; padding:12px 12px calc(12px + env(safe-area-inset-bottom)); border-top:1px solid rgba(255,255,255,.08); background:rgba(8,8,13,.9); backdrop-filter:blur(22px); }
    .composer { display:flex; gap:10px; align-items:flex-end; }
    textarea { width:100%; min-height:54px; max-height:132px; resize:none; border:1px solid rgba(167,139,250,.25); border-radius:15px; padding:12px 13px; background:rgba(18,17,28,.94); color:var(--text); font:inherit; line-height:1.35; outline:none; }
    textarea:focus { border-color:rgba(167,139,250,.58); box-shadow:0 0 0 3px rgba(167,139,250,.12); }
    button { border:0; border-radius:14px; background:var(--accent-strong); color:#fff; font-weight:850; font-size:.9rem; min-height:48px; padding:0 15px; box-shadow:0 12px 26px rgba(139,92,246,.28); }
    .send-button { flex:0 0 auto; min-width:72px; }
    .control-row { display:flex; gap:8px; margin-bottom:12px; }
    .control-row button { flex:1; min-height:38px; border-radius:12px; background:rgba(18,17,28,.94); border:1px solid rgba(167,139,250,.22); color:var(--text); box-shadow:none; }
    .approve-button { width:100%; background:#f59e0b; box-shadow:0 12px 26px rgba(245,158,11,.18); }
    button:disabled { opacity:.55; }
    .empty { color:var(--muted); text-align:center; padding:54px 12px; }
    @media (min-width:700px) { .app-shell { max-width:760px; margin:0 auto; border-left:1px solid rgba(255,255,255,.06); border-right:1px solid rgba(255,255,255,.06); } form { left:50%; transform:translateX(-50%); max-width:760px; } .meta { max-width:520px; } }
  </style>
</head>
<body>
  <div class="app-shell">
    <header>
      <div class="topline">
        <div class="brand"><div class="mark">O</div><div><h1>Orion AI</h1><div class="meta" id="meta">Connecting...</div></div></div>
        <div class="status-pill" id="status-pill">Offline</div>
      </div>
      <div class="context-card">
        <div class="context-row"><span>Model</span><span class="model" id="model">-</span></div>
        <div class="substatus" id="status"></div>
        <div class="install-tip" id="install-tip">Install this companion from your browser menu with Add to Home Screen. Full PWA install support may require HTTPS on some phones.</div>
      </div>
    </header>
    <main>
      <section class="plan-panel" id="plan-panel"><div class="plan-title">Plan waiting for approval</div><div class="plan-copy">Review the latest plan in chat. Start it here when the direction looks right.</div><button class="approve-button" id="approve-plan" type="button">Start Implementation</button><div class="control-row"><button id="deny-plan" type="button">Deny</button><button id="revise-plan" type="button">Revise</button></div></section>
      <section class="conversation-panel"><div class="panel-title">Tasks</div><select id="conversation-select"></select><div class="control-row" style="margin-top:8px"><button id="new-task" type="button">New Task</button><button id="steer-task" type="button">Steer</button></div></section>
      <div class="control-row"><button id="refresh-state" type="button">Refresh</button><button id="stop-task" type="button">Pause / Stop</button><button id="resume-task" type="button">Resume</button></div>
      <div class="queue-line" id="queue-line"></div>
      <div class="output-panel" id="latest-output">Latest output will appear here.</div>
      <section class="preview-panel"><div class="panel-title">Preview</div><div class="preview-grid" id="preview-panel"></div></section>
      <div class="task-strip" id="tasks"></div>
      <div class="messages" id="messages"><div class="empty">Loading conversation...</div></div>
    </main>
  </div>
  <form id="prompt-form"><div class="composer"><textarea id="prompt" placeholder="Ask Orion..." autocomplete="off" rows="2"></textarea><button class="send-button" id="send" type="submit">Send</button></div></form>
  <script>
    const pairingCode = ${JSON.stringify(pairingCode)};
    const sessionKey = 'orionPhoneCompanionSession';
    let deviceSession = null;
    try { deviceSession = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch (e) { deviceSession = null; }
    const messagesEl = document.getElementById('messages');
    const metaEl = document.getElementById('meta');
    const modelEl = document.getElementById('model');
    const statusEl = document.getElementById('status');
    const statusPillEl = document.getElementById('status-pill');
    const installTipEl = document.getElementById('install-tip');
    const planPanelEl = document.getElementById('plan-panel');
    const approvePlanEl = document.getElementById('approve-plan');
    const denyPlanEl = document.getElementById('deny-plan');
    const revisePlanEl = document.getElementById('revise-plan');
    const refreshStateEl = document.getElementById('refresh-state');
    const stopTaskEl = document.getElementById('stop-task');
    const resumeTaskEl = document.getElementById('resume-task');
    const newTaskEl = document.getElementById('new-task');
    const steerTaskEl = document.getElementById('steer-task');
    const conversationSelectEl = document.getElementById('conversation-select');
    const previewPanelEl = document.getElementById('preview-panel');
    const tasksEl = document.getElementById('tasks');
    const queueLineEl = document.getElementById('queue-line');
    const latestOutputEl = document.getElementById('latest-output');
    const form = document.getElementById('prompt-form');
    const promptEl = document.getElementById('prompt');
    const sendEl = document.getElementById('send');
    let lastSignature = '';
    function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
    function taskClass(status) { return String(status || '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase(); }
    async function loadState() {
      try {
        if (!deviceSession) {
          statusEl.textContent = 'Pair this phone from Orion desktop approval.';
          statusPillEl.textContent = 'Pairing';
          return;
        }
        const res = await companionFetch('/api/state');
        const state = await res.json();
        if (!state.success) throw new Error(state.error || 'Failed to load state');
        metaEl.textContent = state.title || 'No active conversation';
        modelEl.textContent = state.model || '-';
        statusPillEl.textContent = state.running ? 'Working' : 'Ready';
        statusPillEl.classList.toggle('running', !!state.running);
        statusEl.textContent = state.subStatus || state.workspace || '';
        queueLineEl.textContent = state.queuedPrompts ? (state.queuedPrompts + ' queued prompt(s): ' + (state.queuedPromptPreview || []).join(' | ')) : '';
        latestOutputEl.textContent = state.latestOutput || 'Latest output will appear here.';
        planPanelEl.classList.toggle('visible', !!state.awaitingPlanApproval);
        conversationSelectEl.innerHTML = Array.isArray(state.conversations) && state.conversations.length ? state.conversations.map(conv => '<option value="' + escapeHtml(conv.id) + '"' + (conv.active ? ' selected' : '') + '>' + escapeHtml(conv.title || conv.id) + '</option>').join('') : '<option>No conversations</option>';
        const preview = state.preview || {};
        previewPanelEl.innerHTML = [
          ['Latest', preview.latestAssistantOutput || 'No assistant output yet.'],
          ['Walkthrough', preview.workWalkthrough || 'No walkthrough yet.'],
          ['Files', Array.isArray(preview.changedFiles) && preview.changedFiles.length ? preview.changedFiles.join('\\n') : 'No changed files recorded.'],
          ['Tests', Array.isArray(preview.testResults) && preview.testResults.length ? preview.testResults.join('\\n---\\n') : 'No test results recorded.'],
          ['Launch', preview.appLaunchUrl || 'No app launch URL recorded.']
        ].map(item => '<div><div class="panel-title">' + escapeHtml(item[0]) + '</div><div class="preview-item">' + escapeHtml(item[1]) + '</div></div>').join('');
        tasksEl.innerHTML = Array.isArray(state.tasks) && state.tasks.length ? state.tasks.map(task => '<span class="task-chip ' + taskClass(task.status) + '">' + escapeHtml(task.title || 'Task') + '</span>').join('') : '';
        const signature = JSON.stringify({ running: state.running, subStatus: state.subStatus, plan: state.awaitingPlanApproval, tasks: state.tasks, messages: state.messages });
        if (signature !== lastSignature) {
          lastSignature = signature;
          messagesEl.innerHTML = !state.messages || state.messages.length === 0 ? '<div class="empty">No messages yet.</div>' : state.messages.map(msg => '<div class="message ' + escapeHtml(msg.role) + '"><span class="role">' + escapeHtml(msg.role) + '</span>' + escapeHtml(msg.text) + '</div>').join('');
          window.scrollTo(0, document.body.scrollHeight);
        }
      } catch (error) {
        statusEl.textContent = error.message;
        statusPillEl.textContent = 'Offline';
        statusPillEl.classList.remove('running');
      }
    }
    approvePlanEl.addEventListener('click', async () => {
      approvePlanEl.disabled = true;
      statusEl.textContent = 'Starting approved plan...';
      try {
        const res = await companionFetch('/api/approve-plan', { method: 'POST' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Approval failed');
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      } finally {
        approvePlanEl.disabled = false;
      }
    });
    denyPlanEl.addEventListener('click', async () => {
      const res = await companionFetch('/api/deny-plan', { method: 'POST' });
      const data = await res.json();
      if (!data.success) statusEl.textContent = data.error || 'Deny failed';
      await loadState();
    });
    revisePlanEl.addEventListener('click', async () => {
      const feedback = prompt('Revision note for Orion:', 'Revise the plan before implementing.');
      if (!feedback) return;
      const res = await companionFetch('/api/revise-plan', { method: 'POST', body: JSON.stringify({ feedback }) });
      const data = await res.json();
      if (!data.success) statusEl.textContent = data.error || 'Revision failed';
      await loadState();
    });
    refreshStateEl.addEventListener('click', loadState);
    conversationSelectEl.addEventListener('change', async () => {
      if (!conversationSelectEl.value) return;
      const res = await companionFetch('/api/conversations/switch', { method:'POST', body: JSON.stringify({ conversationId: conversationSelectEl.value }) });
      const data = await res.json();
      if (!data.success) statusEl.textContent = data.error || 'Switch failed';
      await loadState();
    });
    newTaskEl.addEventListener('click', async () => {
      const prompt = window.prompt('Start a new Orion task:', '');
      const res = await companionFetch('/api/conversations/new', { method:'POST', body: JSON.stringify({ prompt: prompt || '' }) });
      const data = await res.json();
      if (!data.success) statusEl.textContent = data.error || 'New task failed';
      await loadState();
    });
    steerTaskEl.addEventListener('click', async () => {
      const prompt = window.prompt('Steer active work:', '');
      if (!prompt) return;
      const res = await companionFetch('/api/steer', { method:'POST', body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (!data.success) statusEl.textContent = data.error || 'Steer failed';
      await loadState();
    });
    stopTaskEl.addEventListener('click', async () => {
      stopTaskEl.disabled = true;
      statusEl.textContent = 'Stopping active work...';
      try {
        const res = await companionFetch('/api/stop', { method: 'POST' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Stop failed');
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      } finally {
        stopTaskEl.disabled = false;
      }
    });
    resumeTaskEl.addEventListener('click', async () => {
      resumeTaskEl.disabled = true;
      statusEl.textContent = 'Resuming work...';
      try {
        const res = await companionFetch('/api/resume', { method: 'POST' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Resume failed');
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      } finally {
        resumeTaskEl.disabled = false;
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const prompt = promptEl.value.trim();
      if (!prompt) return;
      sendEl.disabled = true;
      statusEl.textContent = 'Sending...';
      try {
        const res = await companionFetch('/api/prompt', { method: 'POST', body: JSON.stringify({ prompt }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Send failed');
        promptEl.value = '';
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      } finally {
        sendEl.disabled = false;
      }
    });
    promptEl.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installTipEl.classList.add('visible'); installTipEl.textContent = 'This companion is installable. Open your browser menu and choose Install app or Add to Home Screen.'; });
    async function companionFetch(url, options = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      if (deviceSession) {
        headers.Authorization = 'Bearer ' + deviceSession.secret;
        headers['X-Orion-Device-Id'] = deviceSession.deviceId;
      }
      return fetch(url, Object.assign({}, options, { headers }));
    }
    async function pairIfNeeded() {
      if (deviceSession) return true;
      const code = new URLSearchParams(location.search).get('pair') || pairingCode;
      const name = (navigator.userAgent || 'Phone').slice(0, 64);
      const res = await fetch('/api/pair', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ pairingCode: code, deviceName: name }) });
      const data = await res.json();
      if (!data.success) {
        statusEl.textContent = data.error || 'Pairing pending or denied';
        return false;
      }
      deviceSession = { deviceId: data.device.id, secret: data.sessionSecret };
      localStorage.setItem(sessionKey, JSON.stringify(deviceSession));
      return true;
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    pairIfNeeded().then(loadState);
    setInterval(loadState, 1500);
  </script>
</body>
</html>`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function runGitCommand(cwd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, PAGER: 'cat' },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      killProcessTree(child);
      resolve({ success: false, stdout, stderr, error: `git ${args.join(' ')} timed out after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ success: code === 0, exitCode: code, stdout, stderr, error: code === 0 ? '' : stderr || stdout });
    });
    child.on('error', error => {
      clearTimeout(timeout);
      resolve({ success: false, stdout, stderr, error: error.message });
    });
  });
}

function spawnInternalCommand(workspacePath, executable, args = []) {
  if (!executable) throw new Error('Missing executable');
  const child = spawn(executable, args, {
    cwd: workspacePath,
    env: { ...process.env, PAGER: 'cat' },
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return child;
}

async function callRendererFunction(functionName, arg) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Orion window is not ready');
  const script = arg === undefined
    ? `window.${functionName} && window.${functionName}()`
    : `window.${functionName} && window.${functionName}(${JSON.stringify(arg)})`;
  const result = await mainWindow.webContents.executeJavaScript(script, true);
  if (!result) throw new Error('Phone companion bridge is not ready yet');
  return result;
}

function startPhoneCompanionServer() {
  if (companionServer) return;
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 1122);
  const enableCompanion = config.enablePhoneCompanion === true;
  const host = enableCompanion ? '0.0.0.0' : '127.0.0.1';
  companionToken = ensureCompanionToken(config);
  const pairingCode = ensureCompanionPairingCode(config);

  companionServer = http.createServer(async (req, res) => {
    try {
      const latestConfig = readAppConfig();
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(companionHtml(pairingCode));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(companionIconSvg());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(companionManifest(), null, 2));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
        res.end(companionServiceWorker());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pair') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        if (String(body.pairingCode || '') !== String(latestConfig.phoneCompanionPairingCode || pairingCode)) {
          sendJson(res, 401, { success: false, error: 'Invalid pairing code' });
          return;
        }
        const deviceName = String(body.deviceName || 'Phone').slice(0, 80);
        let approved = false;
        try {
          const approval = await callRendererFunction('approvePhoneCompanionPairing', { deviceName });
          approved = approval && approval.approved !== false;
        } catch (e) {
          approved = false;
        }
        if (!approved) {
          sendJson(res, 403, { success: false, error: 'Desktop approval required' });
          return;
        }
        const writableConfig = readAppConfig();
        const device = createCompanionDeviceSession(writableConfig, deviceName);
        sendJson(res, 200, { success: true, device: companionDevicePublic(device), sessionSecret: device.secret });
        return;
      }

      const device = authenticateCompanionRequest(req, latestConfig);
      if (!device) {
        sendJson(res, 401, { success: false, error: 'Unauthorized companion request' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/devices') {
        sendJson(res, 200, { success: true, devices: getCompanionDevices(latestConfig).map(companionDevicePublic) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/devices/revoke') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const revokeId = String(body.deviceId || device.id);
        const writableConfig = readAppConfig();
        const devices = getCompanionDevices(writableConfig).map(d => d.id === revokeId ? { ...d, revoked: true } : d);
        writableConfig.phoneCompanionDevices = devices;
        writeAppConfig(writableConfig);
        sendJson(res, 200, { success: true, revoked: revokeId });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const state = await callRendererFunction('getPhoneCompanionState');
        sendJson(res, 200, { success: true, device: companionDevicePublic(device), ...state });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const state = await callRendererFunction('getPhoneCompanionState');
        sendJson(res, 200, { success: true, preview: state.preview || {} });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/switch') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('switchPhoneCompanionConversation', String(body.conversationId || ''));
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/new') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('startPhoneCompanionTask', body);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/prompt') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const prompt = String(body.prompt || '').trim();
        if (!prompt) {
          sendJson(res, 400, { success: false, error: 'Missing prompt' });
          return;
        }
        const result = await callRendererFunction('submitPhoneCompanionPrompt', prompt);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/approve-plan') {
        const result = await callRendererFunction('approvePhoneCompanionPlan');
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/steer') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('steerPhoneCompanionTask', String(body.prompt || body.feedback || '').trim());
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/deny-plan') {
        const result = await callRendererFunction('denyPhoneCompanionPlan');
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/revise-plan') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('revisePhoneCompanionPlan', String(body.feedback || '').trim());
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/api/stop' || url.pathname === '/api/pause')) {
        const result = await callRendererFunction('stopPhoneCompanionTask');
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/resume') {
        const result = await callRendererFunction('resumePhoneCompanionTask');
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
  });

  companionServer.listen(port, host, () => {
    const address = enableCompanion ? getLocalWifiAddress() : '127.0.0.1';
    const url = `http://${address}:${port}/?pair=${encodeURIComponent(pairingCode)}`;
    console.log(`Orion phone companion listening at ${url} (Host: ${host})`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          `window.appendSystemMessage && window.appendSystemMessage(${JSON.stringify(`Phone Companion is available on this Wi-Fi at ${url}`)}, { dedupeKey: 'phone-companion-url', windowMs: 60000 })`
        ).catch(() => {});
      }
    }, 2500);
  });

  companionServer.on('error', (error) => {
    console.error('Phone companion server failed:', error);
  });
}

// --- IPC WINDOW CONTROLS ---
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isFullscreen()) {
      mainWindow.setFullScreen(false);
      mainWindow.maximize();
    } else if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// --- IPC WORKSPACE SELECTION ---
ipcMain.handle('select-workspace', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('show-confirm-dialog', async (event, { message, title }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    title: title || 'Confirm',
    message: message
  });
  return result.response === 0;
});

ipcMain.handle('launch-workspace-app', async (event, workspacePath) => {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: 'No active workspace directory found.' };
    }
    const configuredEntry = getWorkspaceEntrypoint(readAppConfig(), workspacePath);
    if (configuredEntry && configuredEntry.command) {
      launchCommandInWorkspace(workspacePath, configuredEntry.command);
      return {
        success: true,
        message: `Started configured entry point: "${configuredEntry.command}"`,
        entrypoint: configuredEntry
      };
    }
    
    const files = fs.readdirSync(workspacePath);
    
    // 1. Check for index.html (standard web games/apps)
    if (files.includes('index.html')) {
      const fullPath = path.join(workspacePath, 'index.html');
      const { shell } = require('electron');
      await shell.openPath(fullPath);
      return { success: true, message: 'Opened index.html in default browser.' };
    }
    
    // 2. Check for package.json
    if (files.includes('package.json')) {
      const pkgPath = path.join(workspacePath, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      
      let cmd = '';
      if (scripts.start) {
        cmd = 'npm start';
      } else if (scripts.dev) {
        cmd = 'npm run dev';
      }
      
      if (cmd) {
        if (cmd === 'npm start') {
          launchInternalCommandInWorkspace(workspacePath, 'npm', ['start']);
        } else {
          launchInternalCommandInWorkspace(workspacePath, 'npm', ['run', 'dev']);
        }
        return { success: true, message: `Started background server with command: "${cmd}"` };
      }
    }
    
    // 3. Check for Python main files
    const pythonFiles = ['main.py', 'app.py', 'index.py', 'game.py'];
    const foundPy = pythonFiles.find(f => files.includes(f));
    if (foundPy) {
      launchInternalCommandInWorkspace(workspacePath, 'python', [foundPy]);
      return { success: true, message: `Started Python application: "python ${foundPy}"` };
    }
    
    // 4. Check for Cargo.toml (Rust)
    if (files.includes('Cargo.toml')) {
      launchInternalCommandInWorkspace(workspacePath, 'cargo', ['run']);
      return { success: true, message: 'Started Cargo application: "cargo run"' };
    }
    
    // 5. Check for Go files
    if (files.includes('go.mod') || files.some(f => f.endsWith('.go'))) {
      launchInternalCommandInWorkspace(workspacePath, 'go', ['run', '.']);
      return { success: true, message: 'Started Go application: "go run ."' };
    }
    
    return { success: false, error: 'Could not auto-detect a runnable entry point (index.html, package.json, main.py, Cargo.toml, etc.).' };
    
  } catch (e) {
    console.error('Error launching workspace app:', e);
    return { success: false, error: e.message };
  }
});

function workspaceKey(workspacePath) {
  return path.resolve(workspacePath || '').toLowerCase();
}

function getWorkspaceEntrypoint(config, workspacePath) {
  const map = config.workspaceEntrypoints || {};
  return map[workspaceKey(workspacePath)] || null;
}

function setWorkspaceEntrypoint(config, workspacePath, entrypoint) {
  config.workspaceEntrypoints = config.workspaceEntrypoints || {};
  const key = workspaceKey(workspacePath);
  if (!entrypoint || !String(entrypoint.command || '').trim()) {
    delete config.workspaceEntrypoints[key];
  } else {
    config.workspaceEntrypoints[key] = {
      command: String(entrypoint.command).trim(),
      label: entrypoint.label ? String(entrypoint.label).trim() : '',
      updatedAt: new Date().toISOString()
    };
  }
  writeAppConfig(config);
  return config.workspaceEntrypoints[key] || null;
}

function escapePowerShellSingle(value) {
  return String(value).replace(/'/g, "''");
}

function launchCommandInWorkspace(workspacePath, command) {
  if (!command) throw new Error('Missing command');
  if (isDestructiveCommand(command)) {
    throw new Error('Command is in the deny-list and cannot be executed.');
  }

  if (process.platform === 'win32') {
    const commandText = `Set-Location -LiteralPath '${escapePowerShellSingle(workspacePath)}'; ${command}`;
    spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Start-Process powershell -ArgumentList '-NoExit', '-Command', '${escapePowerShellSingle(commandText)}'`
    ], { windowsHide: true, detached: true, stdio: 'ignore' });
  } else {
    spawn('bash', ['-lc', command], { cwd: workspacePath, detached: true, stdio: 'ignore' });
  }
}

function launchInternalCommandInWorkspace(workspacePath, executable, args = []) {
  spawnInternalCommand(workspacePath, executable, args);
}

ipcMain.handle('get-workspace-entrypoint', async (event, workspacePath) => {
  try {
    return { success: true, entrypoint: getWorkspaceEntrypoint(readAppConfig(), workspacePath) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-workspace-entrypoint', async (event, { workspacePath, entrypoint }) => {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: 'No active workspace directory found.' };
    }
    const saved = setWorkspaceEntrypoint(readAppConfig(), workspacePath, entrypoint);
    return { success: true, entrypoint: saved };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-workspace-folder', async (event, workspacePath) => {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: 'No active workspace directory found.' };
    }
    const { shell } = require('electron');
    await shell.openPath(workspacePath);
    return { success: true, path: workspacePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-push', async (event, { workspacePath, remote, branch, setUpstream }) => {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: 'No active workspace directory found.' };
    }
    const resolvedRemote = remote || 'origin';
    const branchResult = await runGitCommand(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branchResult.success) return branchResult;
    const currentBranch = branchResult.stdout.trim();
    const targetBranch = branch || currentBranch;
    const args = ['push'];
    if (setUpstream !== false) args.push('-u');
    args.push(resolvedRemote, `${currentBranch}:${targetBranch}`);
    const pushResult = await runGitCommand(workspacePath, args, 120000);
    return {
      ...pushResult,
      remote: resolvedRemote,
      currentBranch,
      targetBranch,
      command: `git ${args.join(' ')}`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- IPC FILE SYSTEM OPERATIONS ---
ipcMain.handle('read-config', async () => {
  return readAppConfig();
});

ipcMain.handle('write-config', async (event, config) => {
  try {
    writeAppConfig(config);
    return true;
  } catch (e) {
    console.error('Error writing config:', e);
    return false;
  }
});

ipcMain.handle('list-files', async (event, dirPath) => {
  try {
    if (!dirPath) return [];
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Recursive directory helper, excluding node_modules, .git, etc.
    const getFiles = (dir, rootDir) => {
      let results = [];
      const list = fs.readdirSync(dir);
      
      list.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const relPath = path.relative(rootDir, filePath);
        
        // Exclude common build/version control folders
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.gemini' || file === 'build') {
          return;
        }
        
        if (stat.isDirectory()) {
          results.push({ name: file, path: relPath, isDir: true });
          results = results.concat(getFiles(filePath, rootDir));
        } else {
          results.push({ name: file, path: relPath, isDir: false, size: stat.size });
        }
      });
      return results;
    };
    
    return getFiles(dirPath, dirPath);
  } catch (e) {
    console.error('Error listing files:', e);
    return [];
  }
});

ipcMain.handle('read-file', async (event, { workspacePath, relativePath, options }) => {
  try {
    const fullPath = resolveWorkspacePath(workspacePath, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error('File does not exist');
    const content = fs.readFileSync(fullPath, 'utf8');
    const readOptions = options || {};
    const startLine = parseInt(readOptions.startLine, 10);
    const endLine = parseInt(readOptions.endLine, 10);
    if (Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine) {
      const lines = content.split(/\r?\n/);
      const selected = lines.slice(startLine - 1, endLine);
      return selected.map((line, index) => `${startLine + index}: ${line}`).join('\n');
    }
    const maxChars = parseInt(readOptions.maxChars, 10);
    if (Number.isInteger(maxChars) && maxChars > 0 && content.length > maxChars) {
      return content.slice(0, maxChars) + `\n\n[Orion] File truncated at ${maxChars} characters. Use startLine/endLine to inspect targeted sections.`;
    }
    return content;
  } catch (e) {
    console.error('Error reading file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('delete-path', async (event, { workspacePath, relativePath }) => {
  try {
    return deleteWorkspacePath(workspacePath, relativePath);
  } catch (e) {
    console.error('Error deleting path:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('move-path', async (event, { workspacePath, fromPath, toPath }) => {
  try {
    return moveWorkspacePath(workspacePath, fromPath, toPath);
  } catch (e) {
    console.error('Error moving path:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('rename-path', async (event, { workspacePath, relativePath, newName }) => {
  try {
    const safeName = String(newName || '').trim();
    if (!safeName || /[\\/]/.test(safeName)) throw new Error('Rename requires a plain file or folder name');
    const parent = path.dirname(relativePath);
    const toPath = parent === '.' ? safeName : path.join(parent, safeName);
    return moveWorkspacePath(workspacePath, relativePath, toPath);
  } catch (e) {
    console.error('Error renaming path:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('copy-path', async (event, { workspacePath, fromPath, toPath }) => {
  try {
    return copyWorkspacePath(workspacePath, fromPath, toPath);
  } catch (e) {
    console.error('Error copying path:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('write-file', async (event, { workspacePath, relativePath, content }) => {
  try {
    const workspaceRoot = path.resolve(workspacePath);
    const fullPath = resolveWorkspacePath(workspacePath, relativePath);
    const backupPath = createFileBackup(fullPath, workspaceRoot);
    // Create folder structure if it doesn't exist
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    return { success: true, backupPath };
  } catch (e) {
    console.error('Error writing file:', e);
    return { error: e.message };
  }
});

function applyPatch(original, operation) {
  let updated = original;
  let details = {};

  if (operation.type === 'replace') {
    if (!operation.target) throw new Error('replace requires target');
    if (operation.replacement === undefined) throw new Error('replace requires replacement');
    const count = Math.max(parseInt(operation.count, 10) || 1, 1);
    let replacements = 0;
    while (replacements < count) {
      const index = updated.indexOf(operation.target);
      if (index === -1) break;
      updated = updated.slice(0, index) + operation.replacement + updated.slice(index + operation.target.length);
      replacements++;
    }
    if (replacements === 0) throw new Error('Target content block not found');
    details = { replacements };
  } else if (operation.type === 'replace_regex') {
    if (!operation.pattern) throw new Error('replace_regex requires pattern');
    if (operation.replacement === undefined) throw new Error('replace_regex requires replacement');
    const flags = operation.flags || '';
    const safeFlags = Array.from(new Set(flags.replace(/[^gimsuy]/g, '').split(''))).join('');
    const regex = new RegExp(operation.pattern, safeFlags.includes('g') ? safeFlags : safeFlags + 'g');
    const matches = updated.match(regex);
    const replacements = matches ? matches.length : 0;
    updated = updated.replace(regex, operation.replacement);
    if (replacements === 0) throw new Error('Regex pattern did not match');
    details = { replacements };
  } else if (operation.type === 'insert') {
    if (!operation.anchor) throw new Error('insert requires anchor');
    if (operation.content === undefined) throw new Error('insert requires content');
    const position = operation.position === 'before' ? 'before' : 'after';
    const index = updated.indexOf(operation.anchor);
    if (index === -1) throw new Error('Anchor content not found');
    const insertAt = position === 'before' ? index : index + operation.anchor.length;
    updated = updated.slice(0, insertAt) + operation.content + updated.slice(insertAt);
    details = { position };
  } else if (operation.type === 'replace_range') {
    const startLine = parseInt(operation.startLine, 10);
    const endLine = parseInt(operation.endLine, 10);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      throw new Error('replace_range requires valid 1-based startLine and endLine');
    }
    if (operation.content === undefined) throw new Error('replace_range requires content');
    const hasFinalNewline = updated.endsWith('\n');
    const lines = updated.split(/\r?\n/);
    if (hasFinalNewline) lines.pop();
    if (endLine > lines.length) throw new Error(`Line range exceeds file length (${lines.length} lines)`);
    const newLines = String(operation.content).split(/\r?\n/);
    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
    updated = lines.join('\n') + (hasFinalNewline ? '\n' : '');
    details = { startLine, endLine };
  } else {
    throw new Error(`Unsupported patch operation: ${operation.type}`);
  }

  return { updated, details };
}

function buildPatchProof(original, updated) {
  const originalLines = String(original).split(/\r?\n/);
  const updatedLines = String(updated).split(/\r?\n/);
  let start = 0;
  while (start < originalLines.length && start < updatedLines.length && originalLines[start] === updatedLines[start]) {
    start++;
  }
  let endOriginal = originalLines.length - 1;
  let endUpdated = updatedLines.length - 1;
  while (endOriginal >= start && endUpdated >= start && originalLines[endOriginal] === updatedLines[endUpdated]) {
    endOriginal--;
    endUpdated--;
  }
  const contextStart = Math.max(start - 2, 0);
  const contextEndOriginal = Math.min(endOriginal + 2, originalLines.length - 1);
  const contextEndUpdated = Math.min(endUpdated + 2, updatedLines.length - 1);
  return {
    startLine: start + 1,
    originalEndLine: Math.max(endOriginal + 1, start + 1),
    updatedEndLine: Math.max(endUpdated + 1, start + 1),
    originalSnippet: originalLines.slice(contextStart, contextEndOriginal + 1).join('\n'),
    updatedSnippet: updatedLines.slice(contextStart, contextEndUpdated + 1).join('\n')
  };
}

ipcMain.handle('patch-file', async (event, { workspacePath, relativePath, operation }) => {
  try {
    if (!operation || !operation.type) throw new Error('Missing patch operation');
    const workspaceRoot = path.resolve(workspacePath);
    const fullPath = resolveWorkspacePath(workspacePath, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error('File does not exist');

    const original = fs.readFileSync(fullPath, 'utf8');
    const { updated, details } = applyPatch(original, operation);

    if (updated === original) {
      return { success: true, changed: false, message: 'Patch produced no content changes.', details };
    }

    const backupPath = createFileBackup(fullPath, workspaceRoot);
    fs.writeFileSync(fullPath, updated, 'utf8');
    return { success: true, changed: true, message: `Patched ${relativePath} successfully.`, details, proof: buildPatchProof(original, updated), backupPath };
  } catch (e) {
    console.error('Error patching file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('write-run-artifact', async (event, payload) => {
  try {
    const artifactPath = writeRunArtifact(payload || {});
    return { success: true, artifactPath };
  } catch (e) {
    console.error('Error writing run artifact:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('list-run-artifacts', async (event, conversationId) => {
  try {
    return { success: true, artifacts: listRunArtifacts(conversationId) };
  } catch (e) {
    console.error('Error listing run artifacts:', e);
    return { success: false, error: e.message, artifacts: [] };
  }
});

// --- IPC WEB RESEARCH ---
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
      headers: {
        'User-Agent': 'OrionAI/2.0 (+https://localhost)'
      }
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
    
    return {
      success: true,
      url,
      contentType,
      text: text.slice(0, 12000)
    };
  } catch (e) {
    console.error('Web page fetch failed:', e);
    return { success: false, error: e.message };
  }
});

// --- IPC SHELL COMMAND EXECUTION ---
// Spawns shell command and streams updates through mainWindow.webContents
let activeProcesses = {};
let commandSessions = {};
let commandAliases = {};

function registerCommandSession(processId, session, child) {
  commandSessions[processId] = session;
  activeProcesses[processId] = child;

  const match = processId.match(/^cmd_(conv_\d+)_(.+)$/);
  if (match && match[2]) {
    commandAliases[match[2]] = processId;
  }
}

function resolveCommandSessionId(processId) {
  return commandSessions[processId] ? processId : commandAliases[processId];
}

function killProcessTree(child, callback) {
  if (!child || !child.pid) {
    if (callback) callback();
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', child.pid, '/T', '/F'], { windowsHide: true }).on('close', (code) => {
      if (code !== 0) {
        try { child.kill(); } catch (e) {}
      }
      if (callback) callback(code !== 0 ? new Error('Taskkill failed') : null);
    });
    return;
  }

  try {
    if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {
    try { child.kill('SIGTERM'); } catch(e2) {}
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
    } catch (e) {}
    if (callback) callback();
  }, 1000);
}

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-r[fF]?\b/i,          // rm -rf anywhere
  /\bdel\s+\/s\s+\/q\b/i,       // del /s /q anywhere
  /\bRemove-Item\s+-Recurse\b/i,// PowerShell Remove-Item -Recurse
  /\bgit\s+reset\s+--hard\b/i,  // git reset --hard
  /\bgit\s+clean\s+-fdx\b/i,    // git clean -fdx
  /\bmkfs\b/i,                  // mkfs
  /\bformat\b/i                 // format
];

function isDestructiveCommand(command) {
  // Split commands by chaining operators to check parts, or check entire string.
  // Actually, checking the full string is safer to catch chained destructive commands.
  return DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(command));
}

function classifyCommandRequest(command, options = {}) {
  const text = String(command || '');
  const source = options.source || 'freeform';
  if (!text.trim()) return { category: source, allowed: false, reason: 'Missing command' };
  if (source === 'internal') return { category: 'internal', allowed: true, reason: 'Internal executable/args command' };
  if (isDestructiveCommand(text)) return { category: 'destructive', allowed: false, reason: 'Command matches destructive deny rules' };
  return { category: 'freeform', allowed: true, reason: 'Allowed freeform terminal command' };
}

function startCommandSession({ command, cwd, processId, timeoutMs }) {
  if (!command) throw new Error('Missing command');

  const classification = classifyCommandRequest(command, { source: 'freeform' });
  if (!classification.allowed) {
    throw new Error(classification.reason);
  }

  if (!processId) processId = 'cmd_' + Date.now();
  
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command'] : ['-c'];
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
  const child = spawn(shell, [...shellArgs, command], {
    cwd: cwd,
    env: { ...process.env, PAGER: 'cat' },
    windowsHide: true,
    detached: process.platform !== 'win32'
  });
  
  registerCommandSession(processId, session, child);
  
  const appendOutput = (type, text) => {
    if (type === 'stderr') {
      session.stderr += text;
    } else {
      session.stdout += text;
    }
    mainWindow.webContents.send(`cmd-output-${processId}`, { type, text });
  };
  
  const timeout = setTimeout(() => {
    if (activeProcesses[processId]) {
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
    delete activeProcesses[processId];
    session.exitCode = code;
    session.finishedAt = Date.now();
    if (session.timedOut) {
      session.status = 'timed_out';
    } else if (session.killed) {
      session.status = 'killed';
    } else {
      session.status = code === 0 ? 'completed' : 'failed';
    }
  });
  
  child.on('error', (err) => {
    clearTimeout(timeout);
    delete activeProcesses[processId];
    session.error = err.message;
    session.finishedAt = Date.now();
    session.status = 'error';
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
    output: output.slice(-maxChars)
  };
}

ipcMain.handle('run-command', (event, { command, cwd, processId, timeoutMs }) => {
  return new Promise((resolve) => {
    try {
      const session = startCommandSession({ command, cwd, processId, timeoutMs });
      const poll = setInterval(() => {
        if (session.status !== 'running') {
          clearInterval(poll);
          resolve({
            code: session.exitCode,
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
  const session = commandSessions[resolvedId];
  if (!session) return { success: false, error: 'Unknown command session' };
  return { success: true, ...commandSessionSummary(session, 2000) };
});

ipcMain.handle('read-command-output', (event, { processId, maxChars }) => {
  const resolvedId = resolveCommandSessionId(processId);
  const session = commandSessions[resolvedId];
  if (!session) return { success: false, error: 'Unknown command session' };
  return { success: true, ...commandSessionSummary(session, parseInt(maxChars, 10) || 12000) };
});

ipcMain.handle('kill-command', (event, processId) => {
  const resolvedId = resolveCommandSessionId(processId);
  if (activeProcesses[resolvedId]) {
    try {
      if (commandSessions[resolvedId]) {
        commandSessions[resolvedId].killed = true;
        commandSessions[resolvedId].status = 'killed';
      }
      killProcessTree(activeProcesses[resolvedId]);
      return { success: true };
    } catch (e) {
      console.error('Failed to kill process:', e);
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'No running process found for that session.' };
});

ipcMain.handle('kill-commands-for-conversation', (event, conversationId) => {
  if (!conversationId) return { success: false, error: 'Missing conversation id' };
  let killed = 0;
  Object.keys(activeProcesses).forEach((processId) => {
    if (processId.includes(`_${conversationId}_`)) {
      const session = commandSessions[processId];
      if (session) {
        session.killed = true;
        session.status = 'killed';
      }
      killProcessTree(activeProcesses[processId]);
      killed++;
    }
  });
  return { success: true, killed };
});

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    escapePowerShellSingle,
    startCommandSession,
    killProcessTree,
    startPhoneCompanionServer,
    ensureCompanionToken,
    writeRunArtifact,
    resolveWorkspacePath,
    deleteWorkspacePath,
    moveWorkspacePath,
    copyWorkspacePath,
    listRunArtifacts,
    classifyCommandRequest,
    spawnInternalCommand,
    getCompanionServer: () => companionServer
  };
}

if (process.env.NODE_ENV === 'test') {
  module.exports.applyPatch = applyPatch;
  module.exports.buildPatchProof = buildPatchProof;
}

if (process.env.NODE_ENV === 'test') {
  module.exports.isDestructiveCommand = isDestructiveCommand;
}

if (process.env.NODE_ENV === 'test') {
  module.exports.activeProcesses = activeProcesses;
  module.exports.commandSessions = commandSessions;
}

if (process.env.NODE_ENV === 'test') {
  module.exports.getCompanionServer = () => companionServer;
}

if (process.env.NODE_ENV === 'test') {
  module.exports.resetCompanionServer = () => {
    if (companionServer) {
      try { companionServer.close(); } catch (e) {}
    }
    companionServer = null;
  };
}
