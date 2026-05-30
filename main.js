const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

let mainWindow;
let companionServer = null;
let companionToken = '';

function stopPhoneCompanionServer() {
  return new Promise(resolve => {
    if (!companionServer) {
      resolve();
      return;
    }
    const server = companionServer;
    companionServer = null;
    server.close(() => resolve());
  });
}

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
  const expiresAt = Date.parse(config.phoneCompanionPairingExpiresAt || '');
  if (config.phoneCompanionPairingCode && String(config.phoneCompanionPairingCode).length >= 12 && expiresAt > Date.now()) {
    return config.phoneCompanionPairingCode;
  }
  config.phoneCompanionPairingCode = crypto.randomBytes(12).toString('base64url');
  config.phoneCompanionPairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  writeAppConfig(config);
  return config.phoneCompanionPairingCode;
}

async function buildCompanionPairingAnnouncement({ address, port, pairingCode, expiresAt }) {
  const pairUrl = `http://${address}:${port}/?pair=${encodeURIComponent(pairingCode)}`;
  const qrSvg = await QRCode.toString(pairUrl, {
    type: 'svg',
    margin: 1,
    width: 180,
    color: { dark: '#111827', light: '#ffffff' }
  });
  return {
    type: 'phone-companion-pairing',
    pairUrl,
    pairingCode,
    expiresAt: expiresAt || '',
    qrSvg,
    networkEnabled: address !== '127.0.0.1' && address !== 'localhost',
    title: 'Pair Phone Companion',
    description: 'Scan this QR code from your phone, then approve the pairing on this desktop.'
  };
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
    lastSeenAt: now,
    selectedConversationId: null
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
  <title>Orion Operator Console</title>
  <meta name="theme-color" content="#8b5cf6">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Outfit:wght@100..900&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #07070a;
      --panel: rgba(20, 20, 31, 0.6);
      --panel-strong: rgba(28, 28, 43, 0.85);
      --line: rgba(167, 139, 250, 0.15);
      --text: #f3f1fe;
      --muted: #9f9aa7;
      --accent: #a78bfa;
      --accent-strong: #8b5cf6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 16% -8%, rgba(96,165,250,.18), transparent 34%), radial-gradient(circle at 86% 0%, rgba(167,139,250,.16), transparent 36%), linear-gradient(180deg,#0a0a10 0%,#07070a 45%,#050508 100%);
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px);
      background-size: 32px 32px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.8), transparent 65%);
    }
    .app-shell { min-height: 100vh; padding-bottom: calc(164px + env(safe-area-inset-bottom)); }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      padding: calc(14px + env(safe-area-inset-top)) 16px 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(7,7,10,.82);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .brand { display: flex; align-items: center; min-width: 0; gap: 10px; }
    .mark {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, #60a5fa, #8b5cf6 55%, #171827);
      box-shadow: 0 10px 30px rgba(139,92,246,.28);
      font-weight: 900;
      color: #fff;
    }
    h1 { margin: 0; font-size: 1.05rem; letter-spacing: 0; line-height: 1.1; font-weight: 700; }
    .meta { margin-top: 4px; color: var(--muted); font-size: .76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 68vw; }
    .status-pill {
      flex: 0 0 auto;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(20,20,31,.6);
      color: var(--muted);
      font-size: .72rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .status-pill.running {
      color: #e8ddff;
      border-color: rgba(16,185,129,.35);
      background: rgba(16,185,129,.12);
    }
    
    /* Indicator Banner */
    .indicator-banner {
      padding: 10px 14px;
      border-radius: 10px;
      margin-top: 12px;
      font-size: 0.78rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid transparent;
      font-weight: 500;
    }
    .indicator-banner.active-running {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    .indicator-banner.background-running {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.2);
      color: #fbbf24;
    }
    .indicator-banner.background-running button {
      background: #fbbf24;
      color: #0c0c0e;
      font-weight: 700;
      border: 0;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      cursor: pointer;
      font-family: inherit;
    }
    .indicator-banner.idle {
      background: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.05);
      color: var(--muted);
    }

    .context-card {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid rgba(255,255,255,.05);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(24,23,36,.5), rgba(13,13,20,.4));
    }
    .context-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: .75rem; }
    .model { color: var(--text); font-weight: 700; }
    .substatus { margin-top: 8px; color: var(--accent); font-size: .76rem; min-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    .install-tip { display: none; margin-top: 10px; padding: 9px 10px; border: 1px dashed rgba(167,139,250,.36); border-radius: 12px; color: #ddd6fe; background: rgba(167,139,250,.09); font-size: .76rem; line-height: 1.35; }
    .install-tip.visible { display: block; }
    
    main { position: relative; z-index: 1; padding: 14px; display: flex; flex-direction: column; gap: 16px; }
    
    /* Plan Panel */
    .plan-panel {
      display: none;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(245, 158, 11, 0.3);
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(167, 139, 250, 0.04));
      margin-bottom: 4px;
    }
    .plan-panel.visible { display: block; }
    .plan-title { font-size: .86rem; font-weight: 800; margin-bottom: 4px; color: #fbbf24; }
    .plan-copy { color: var(--muted); font-size: .78rem; line-height: 1.35; margin-bottom: 10px; }
    
    /* Dashboard and Cards */
    .dashboard-panel { display: flex; flex-direction: column; gap: 12px; }
    .panel-header-row { display: flex; align-items: center; justify-content: space-between; }
    .sub-panel-title { font-size: .74rem; color: #c4b5fd; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
    
    .btn-sm-primary {
      min-height: 32px;
      padding: 0 12px;
      font-size: 0.78rem;
      border-radius: 8px;
      font-weight: 700;
      background: var(--accent-strong);
      color: #fff;
      border: 0;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);
      cursor: pointer;
      font-family: inherit;
    }
    .btn-sm {
      min-height: 28px;
      padding: 0 10px;
      font-size: 0.75rem;
      border-radius: 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--text);
      cursor: pointer;
      font-family: inherit;
    }

    .dashboard-card {
      padding: 14px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: var(--panel);
    }
    .dashboard-card.active-card {
      border-left: 4px solid var(--accent);
      background: linear-gradient(180deg, rgba(139, 92, 246, 0.04), rgba(20, 20, 31, 0.6));
    }
    .dashboard-cards-grid { display: flex; flex-direction: column; gap: 8px; }
    .attention-card {
      border: 1px solid rgba(245, 158, 11, 0.25);
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.05), rgba(20, 20, 31, 0.6));
    }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .card-title { font-size: 0.94rem; font-weight: 700; color: var(--text); margin-bottom: 6px; }
    .substatus-text { font-size: 0.74rem; color: var(--muted); min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .badge { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; font-size: 0.64rem; font-weight: 700; text-transform: uppercase; }
    .badge.success { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }
    .badge.warning { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2); }
    .badge.danger { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); }
    .badge.muted { background: rgba(255, 255, 255, 0.04); color: var(--muted); border: 1px solid rgba(255, 255, 255, 0.06); }
    .badge.active-view { background: rgba(139, 92, 246, 0.12); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.2); }
    .badge.pulse { animation: status-pulse 1.8s infinite; }
    @keyframes status-pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }

    .queued-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .queued-item { font-size: 0.72rem; color: #d1d5db; background: rgba(255,255,255,0.02); padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); }

    .recent-tasks-list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; padding-right: 4px; }
    .task-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.05); background: rgba(255,255,255,0.01); cursor: pointer; transition: all 0.2s ease; }
    .task-row:hover { border-color: rgba(167, 139, 250, 0.18); background: rgba(167, 139, 250, 0.02); }
    .task-row.active-row { border-color: rgba(167, 139, 250, 0.3); background: rgba(167, 139, 250, 0.05); }
    .task-row-title { font-size: 0.82rem; font-weight: 600; color: var(--text); }
    .task-row-meta { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }

    /* Upgraded Activity Panel with Tabs */
    .activity-panel {
      padding: 14px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: var(--panel);
    }
    .tab-header { display: flex; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px; margin-bottom: 10px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .tab-btn {
      flex: 1;
      min-height: 30px;
      padding: 0 10px;
      font-size: 0.72rem;
      border-radius: 6px;
      background: transparent;
      border: 0;
      color: var(--muted);
      cursor: pointer;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
      box-shadow: none;
      font-family: inherit;
    }
    .tab-btn.active {
      background: rgba(139, 92, 246, 0.15);
      color: #c4b5fd;
      border: 1px solid rgba(139, 92, 246, 0.2);
    }
    .tab-content { position: relative; }
    .tab-pane { display: none; font-size: 0.74rem; color: var(--muted); white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto; line-height: 1.4; }
    .tab-pane.active { display: block; }
    .terminal-logs { font-family: 'JetBrains Mono', Consolas, monospace; background: #040406; color: #34d399; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); margin: 0; font-size: 0.68rem; line-height: 1.35; max-height: 140px; overflow: auto; }
    .test-result-block { border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 6px; margin-bottom: 6px; }
    .test-result-block:last-child { border-bottom: 0; }

    /* Action Grouping */
    .action-grouping { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
    .control-row { display: flex; gap: 8px; }
    .control-row button { flex: 1; min-height: 38px; border-radius: 12px; background: rgba(20,20,31,.6); border: 1px solid var(--line); color: var(--text); box-shadow: none; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
    .control-row button:hover { border-color: rgba(167, 139, 250, 0.35); background: rgba(167, 139, 250, 0.04); }
    .approve-button { width: 100%; background: #f59e0b; color: #0c0c0e; font-weight: 850; box-shadow: 0 12px 26px rgba(245,158,11,.18); cursor: pointer; }
    
    .messages { display: flex; flex-direction: column; gap: 12px; max-height: 320px; overflow-y: auto; padding-right: 4px; }
    .message { max-width: 92%; padding: 12px 13px; border: 1px solid rgba(255,255,255,.05); border-radius: 17px; line-height: 1.48; white-space: pre-wrap; word-break: break-word; background: rgba(20,20,31,.4); box-shadow: 0 12px 30px rgba(0,0,0,.12); font-size: 0.8rem; }
    .message.user { align-self: flex-end; border-color: rgba(167,139,250,.28); background: linear-gradient(135deg, rgba(139,92,246,.15), rgba(37,34,58,.82)); }
    .message.assistant { align-self: flex-start; border-color: rgba(52,211,153,.15); }
    .message.system { align-self: center; max-width: 100%; color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: .74rem; background: rgba(12,12,18,.5); }
    .role { display: block; margin-bottom: 6px; color: #c4b5fd; font-size: .64rem; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
    
    form { position: fixed; z-index: 8; left: 0; right: 0; bottom: 0; padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid rgba(255,255,255,.06); background: rgba(7,7,10,.9); backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px); }
    .composer { display: flex; gap: 10px; align-items: flex-end; }
    textarea { width: 100%; min-height: 54px; max-height: 132px; resize: none; border: 1px solid rgba(167,139,250,.2); border-radius: 15px; padding: 12px 13px; background: rgba(20,20,31,.9); color: var(--text); font: inherit; line-height: 1.35; outline: none; }
    textarea:focus { border-color: rgba(167,139,250,.5); box-shadow: 0 0 0 3px rgba(167,139,250,.08); }
    button.send-button { border: 0; border-radius: 14px; background: var(--accent-strong); color: #fff; font-weight: 850; font-size: .9rem; min-height: 48px; padding: 0 15px; box-shadow: 0 12px 26px rgba(139,92,246,.28); cursor: pointer; font-family: inherit; }
    .send-button { flex: 0 0 auto; min-width: 72px; }
    
    .empty { color: var(--muted); text-align: center; padding: 36px 12px; font-size: 0.76rem; }
    @media (min-width:700px) {
      .app-shell { max-width: 760px; margin: 0 auto; border-left: 1px solid rgba(255,255,255,.05); border-right: 1px solid rgba(255,255,255,.05); }
      form { left: 50%; transform: translateX(-50%); max-width: 760px; }
      .meta { max-width: 520px; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header>
      <div class="topline">
        <div class="brand"><div class="mark">O</div><div><h1>Orion Operator Console</h1><div class="meta" id="meta">Connecting...</div></div></div>
        <div class="status-pill" id="status-pill">Offline</div>
      </div>
      <div id="global-indicator-banner" class="indicator-banner idle">
        <span>Agent is currently idle</span>
      </div>
      <div class="context-card">
        <div class="context-row"><span>Model</span><span class="model" id="model">-</span></div>
        <div class="substatus" id="status"></div>
        <div class="install-tip" id="install-tip">Install this companion from your browser menu with Add to Home Screen. Full PWA install support may require HTTPS on some phones.</div>
      </div>
    </header>
    <main>
      <!-- Task console dashboard -->
      <section class="dashboard-panel">
        <div class="panel-header-row">
          <div class="sub-panel-title">Task Console</div>
          <button id="new-task" type="button" class="btn-sm-primary">+ New Task</button>
        </div>
        
        <div id="active-task-container" class="dashboard-card active-card">
          <div class="empty">Loading tasks...</div>
        </div>

        <section class="plan-panel" id="plan-panel">
          <div class="plan-title">Plan waiting for approval</div>
          <div class="plan-copy">Review the latest plan in chat. Start it here when the direction looks right.</div>
          <button class="approve-button" id="approve-plan" type="button">Start Implementation</button>
          <div class="control-row" style="margin-top: 8px;">
            <button id="deny-plan" type="button">Deny</button>
            <button id="revise-plan" type="button">Revise</button>
          </div>
        </section>

        <div class="action-grouping">
          <div class="control-row">
            <button id="steer-task" type="button">🎯 Steer Work</button>
          </div>
          <div class="control-row">
            <button id="stop-task" type="button">⏸ Pause / Stop</button>
            <button id="resume-task" type="button">▶ Resume</button>
            <button id="refresh-state" type="button">🔄 Refresh</button>
          </div>
        </div>

        <div id="attention-tasks-container" class="dashboard-cards-grid"></div>
        <div id="queued-prompts-container" class="dashboard-card" style="display: none;"></div>

        <div class="recent-tasks-section">
          <div class="sub-panel-title">All Workspace Tasks</div>
          <div id="recent-tasks-list" class="recent-tasks-list">
            <div class="empty">Loading...</div>
          </div>
        </div>
      </section>

      <!-- Upgraded Activity Panel -->
      <section class="activity-panel">
        <div class="sub-panel-title" style="margin-bottom: 8px;">Activity Panel</div>
        <div class="tab-header">
          <button class="tab-btn active" data-tab="tab-output">Output</button>
          <button class="tab-btn" data-tab="tab-walkthrough">Walkthrough</button>
          <button class="tab-btn" data-tab="tab-files">Files</button>
          <button class="tab-btn" data-tab="tab-tests">Tests</button>
          <button class="tab-btn" data-tab="tab-launch">Launch</button>
        </div>
        <div class="tab-content">
          <div id="tab-output" class="tab-pane active">Latest output will appear here.</div>
          <div id="tab-walkthrough" class="tab-pane">No walkthrough yet.</div>
          <div id="tab-files" class="tab-pane">No changed files.</div>
          <div id="tab-tests" class="tab-pane">No test results.</div>
          <div id="tab-launch" class="tab-pane">
            <div id="launch-url-container" style="margin-bottom: 8px; font-weight: 600;">No app launch URL recorded.</div>
            <pre id="launch-logs-container" class="terminal-logs">No launch logs yet.</pre>
          </div>
        </div>
      </section>

      <section class="chat-section">
        <div class="sub-panel-title" style="margin-bottom: 8px;">Conversation History</div>
        <div class="messages" id="messages"><div class="empty">Loading conversation...</div></div>
      </section>

      <!-- Hidden deprecated elements to maintain compatibility/avoid query errors -->
      <div style="display:none;">
        <select id="conversation-select"></select>
        <button id="new-task-dup"></button>
        <div id="queue-line"></div>
        <div id="latest-output"></div>
        <div id="preview-panel"></div>
        <div id="tasks"></div>
      </div>
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
    const planPanelEl = document.getElementById('plan-panel');
    const approvePlanEl = document.getElementById('approve-plan');
    const denyPlanEl = document.getElementById('deny-plan');
    const revisePlanEl = document.getElementById('revise-plan');
    const refreshStateEl = document.getElementById('refresh-state');
    const stopTaskEl = document.getElementById('stop-task');
    const resumeTaskEl = document.getElementById('resume-task');
    const newTaskEl = document.getElementById('new-task');
    const steerTaskEl = document.getElementById('steer-task');
    
    // New Console elements
    const globalIndicatorBanner = document.getElementById('global-indicator-banner');
    const activeTaskContainer = document.getElementById('active-task-container');
    const attentionTasksContainer = document.getElementById('attention-tasks-container');
    const queuedPromptsContainer = document.getElementById('queued-prompts-container');
    const recentTasksList = document.getElementById('recent-tasks-list');
    
    const installTipEl = document.getElementById('install-tip');
    const form = document.getElementById('prompt-form');
    
    let lastSignature = '';
    
    function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
    
    async function switchTask(taskId) {
      if (!taskId) return;
      statusEl.textContent = 'Switching console view...';
      try {
        const res = await companionFetch('/api/conversations/switch', { method:'POST', body: JSON.stringify({ conversationId: taskId }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Switch failed');
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      }
    }
    window.switchTask = switchTask;

    async function loadState() {
      try {
        if (!deviceSession) {
          statusEl.textContent = 'Pairing with Orion...';
          statusPillEl.textContent = 'Pairing';
          const pairResult = await pairIfNeeded();
          if (!pairResult.success) {
            statusPillEl.textContent = 'Pairing';
            if (!pairResult.pending) {
              statusEl.innerHTML = 'Pairing denied. <button class="btn-sm" onclick="location.reload()">Retry Pairing</button>';
              clearInterval(statePollInterval);
            }
            return;
          }
        }
        const res = await companionFetch('/api/state');
        if (res.status === 401) {
          localStorage.removeItem(sessionKey);
          deviceSession = null;
          statusEl.textContent = 'Session invalid or revoked. Re-pairing...';
          setTimeout(() => { location.reload(); }, 1500);
          return;
        }
        const state = await res.json();
        if (!state.success) throw new Error(state.error || 'Failed to load state');
        
        metaEl.textContent = state.title || 'No active conversation';
        modelEl.textContent = state.model || '-';
        statusPillEl.textContent = state.running ? 'Working' : 'Ready';
        statusPillEl.classList.toggle('running', !!state.running);
        statusEl.textContent = state.subStatus || state.workspace || '';
        
        planPanelEl.classList.toggle('visible', !!state.awaitingPlanApproval);
        
        // 1. Render Globally Running / View Indicator
        const viewingId = state.conversationId;
        const runningId = state.runningConversationId;
        const globalRunning = !!state.globalRunning;

        if (globalRunning) {
          if (viewingId === runningId) {
            globalIndicatorBanner.className = 'indicator-banner active-running';
            globalIndicatorBanner.innerHTML = '<span>⚡ Viewing Globally Running Task</span>';
          } else {
            const runningTaskObj = (state.conversations || []).find(c => c.id === runningId);
            const runningTitle = runningTaskObj ? runningTaskObj.title : 'Another Task';
            globalIndicatorBanner.className = 'indicator-banner background-running';
            globalIndicatorBanner.innerHTML = '<span>⚠️ Running: <strong>' + escapeHtml(runningTitle) + '</strong></span><button onclick="switchTask(\\\'' + escapeHtml(runningId) + '\\\')">Switch View</button>';
          }
        } else {
          globalIndicatorBanner.className = 'indicator-banner idle';
          globalIndicatorBanner.innerHTML = '<span>💤 Agent is currently idle</span>';
        }

        // 2. Render Active Task Card
        const activeConv = (state.conversations || []).find(c => c.id === viewingId);
        if (activeConv) {
          const isRunning = globalRunning && runningId === viewingId;
          const statusText = isRunning ? 'Running' : (activeConv.awaitingPlanApproval ? 'Needs Attention' : 'Idle');
          const badgeClass = isRunning ? 'success' : (activeConv.awaitingPlanApproval ? 'warning' : 'muted');
          
          activeTaskContainer.innerHTML = \`
            <div class="card-header">
              <span class="sub-panel-title">Current Task View</span>
              <div style="display:flex; gap:6px;">
                <span class="badge \${badgeClass} \${isRunning ? 'pulse' : ''}">\${statusText}</span>
                <span class="badge active-view">Viewing</span>
              </div>
            </div>
            <div class="card-title">\${escapeHtml(activeConv.title)}</div>
            <div class="substatus-text">\${escapeHtml(state.subStatus || state.workspace || '')}</div>
          \`;
        } else {
          activeTaskContainer.innerHTML = '<div class="empty">No task selected</div>';
        }

        // 3. Needs Attention / Plan Waiting Tasks
        const attentionTasks = (state.conversations || []).filter(c => c.awaitingPlanApproval);
        if (attentionTasks.length > 0) {
          attentionTasksContainer.innerHTML = attentionTasks.map(c => {
            const isViewing = c.id === viewingId;
            return '<div class="dashboard-card attention-card">' +
              '<div class="card-header">' +
                '<span class="badge warning">Plan Awaiting Approval</span>' +
                (isViewing ? '<span class="badge active-view">Viewing</span>' : '') +
              '</div>' +
              '<div class="card-title">' + escapeHtml(c.title) + '</div>' +
              '<div class="card-actions" style="margin-top: 8px;">' +
                (isViewing ? '' : '<button class="btn-sm" onclick="switchTask(\\\'' + escapeHtml(c.id) + '\\\')">Switch to Approve</button>') +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          attentionTasksContainer.innerHTML = '';
        }

        // 4. Queued Prompts
        if (state.queuedPrompts > 0) {
          queuedPromptsContainer.innerHTML = \`
            <div class="sub-panel-title">Queued Prompts (\${state.queuedPrompts})</div>
            <div class="queued-list">
              \${(state.queuedPromptPreview || []).map(p => '<div class="queued-item">⏳ ' + escapeHtml(p) + '</div>').join('')}
            </div>
          \`;
          queuedPromptsContainer.style.display = 'block';
        } else {
          queuedPromptsContainer.style.display = 'none';
        }

        // 5. Recent Tasks List
        if (state.conversations && state.conversations.length > 0) {
          recentTasksList.innerHTML = state.conversations.map(c => {
            const isViewing = c.id === viewingId;
            const isRunning = globalRunning && c.id === runningId;
            const isAwaiting = !!c.awaitingPlanApproval;
            
            let badgesHtml = '';
            if (isViewing) badgesHtml += '<span class="badge active-view" style="margin-left:4px;">Viewing</span>';
            if (isRunning) badgesHtml += '<span class="badge success pulse" style="margin-left:4px;">Running</span>';
            if (isAwaiting) badgesHtml += '<span class="badge warning" style="margin-left:4px;">Attention</span>';
            if (!isViewing && !isRunning && !isAwaiting) badgesHtml += '<span class="badge muted" style="margin-left:4px;">Ready</span>';

            const timeText = new Date(c.updatedAt || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return '<div class="task-row' + (isViewing ? ' active-row' : '') + '" onclick="switchTask(\\\'' + escapeHtml(c.id) + '\\\')">' +
              '<div class="task-row-left" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">' +
                '<div class="task-row-title" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(c.title) + '</div>' +
                '<div class="task-row-meta">Updated: ' + timeText + ' • ' + c.taskCount + ' items</div>' +
              '</div>' +
              '<div class="task-row-right" style="display:flex; align-items:center;">' +
                badgesHtml +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          recentTasksList.innerHTML = '<div class="empty">No tasks in workspace.</div>';
        }

        // 6. Upgraded Activity Tab Content
        const preview = state.preview || {};
        document.getElementById('tab-output').textContent = preview.latestAssistantOutput || 'No assistant output yet.';
        
        const walkthroughPane = document.getElementById('tab-walkthrough');
        walkthroughPane.textContent = preview.workWalkthrough || 'No walkthrough yet.';

        const filesPane = document.getElementById('tab-files');
        if (Array.isArray(preview.changedFiles) && preview.changedFiles.length) {
          filesPane.innerHTML = preview.changedFiles.map(f => '<div style="margin-bottom:4px; font-family: monospace; font-size: 0.72rem;">📄 ' + escapeHtml(f) + '</div>').join('');
        } else {
          filesPane.textContent = 'No changed files recorded.';
        }

        const testsPane = document.getElementById('tab-tests');
        if (Array.isArray(preview.testResults) && preview.testResults.length) {
          testsPane.innerHTML = preview.testResults.map(r => '<div class="test-result-block" style="font-family: monospace; white-space: pre-wrap;">' + escapeHtml(r) + '</div>').join('');
        } else {
          testsPane.textContent = 'No test results recorded.';
        }

        const launchUrlContainer = document.getElementById('launch-url-container');
        if (preview.appLaunchUrl) {
          launchUrlContainer.innerHTML = '🚀 <strong>Launch URL:</strong> <a href="' + escapeHtml(preview.appLaunchUrl) + '" target="_blank" style="color:var(--accent); text-decoration:underline;">' + escapeHtml(preview.appLaunchUrl) + '</a>';
        } else {
          launchUrlContainer.textContent = 'No app launch URL recorded.';
        }

        const launchLogsContainer = document.getElementById('launch-logs-container');
        launchLogsContainer.textContent = preview.appLaunchLogs || 'No launch logs yet.';

        // 7. Render Messages Feed
        const signature = JSON.stringify({ running: state.running, subStatus: state.subStatus, plan: state.awaitingPlanApproval, conversations: state.conversations, messages: state.messages });
        if (signature !== lastSignature) {
          lastSignature = signature;
          messagesEl.innerHTML = !state.messages || state.messages.length === 0 ? '<div class="empty">No messages yet.</div>' : state.messages.map(msg => '<div class="message ' + escapeHtml(msg.role) + '"><span class="role">' + escapeHtml(msg.role) + '</span>' + escapeHtml(msg.text) + '</div>').join('');
          messagesEl.scrollTop = messagesEl.scrollHeight;
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
    newTaskEl.addEventListener('click', async () => {
      const prompt = window.prompt('Start a new Orion task:', '');
      if (prompt === null) return;
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
      const prompt = document.getElementById('prompt').value.trim();
      if (!prompt) return;
      document.getElementById('send').disabled = true;
      statusEl.textContent = 'Sending...';
      try {
        const res = await companionFetch('/api/prompt', { method: 'POST', body: JSON.stringify({ prompt }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Send failed');
        document.getElementById('prompt').value = '';
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      } finally {
        document.getElementById('send').disabled = false;
      }
    });
    document.getElementById('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    
    // Wire tab clicks
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.activity-panel');
        parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        parent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
      });
    });

    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installTipEl.classList.add('visible'); installTipEl.textContent = 'This companion is installable. Open your browser menu and choose Install app or Add to Home Screen.'; });
    async function companionFetch(url, options = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      if (deviceSession) {
        headers.Authorization = 'Bearer ' + deviceSession.secret;
        headers['X-Orion-Device-Id'] = deviceSession.deviceId;
      }
      return fetch(url, Object.assign({}, options, { headers }));
    }
    let isPairing = false;
    async function pairIfNeeded() {
      if (deviceSession) return { success: true };
      if (isPairing) return { success: false, pending: true };
      isPairing = true;
      const code = new URLSearchParams(location.search).get('pair') || pairingCode;
      const name = (navigator.userAgent || 'Phone').slice(0, 64);
      try {
        const res = await fetch('/api/pair', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ pairingCode: code, deviceName: name }) });
        const data = await res.json();
        if (!data.success) {
          statusEl.textContent = data.error || 'Pairing pending or denied';
          return { success: false, pending: data.pending !== false };
        }
        deviceSession = { deviceId: data.device.id, secret: data.sessionSecret };
        localStorage.setItem(sessionKey, JSON.stringify(deviceSession));
        statusEl.textContent = 'Connected';
        return { success: true };
      } catch (err) {
        statusEl.textContent = 'Connection error: ' + err.message;
        return { success: false, pending: true };
      } finally {
        isPairing = false;
      }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    loadState();
    const statePollInterval = setInterval(loadState, 1500);
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

let lastLaunchLogs = '';

function appendLaunchLog(data) {
  lastLaunchLogs += data;
  if (lastLaunchLogs.length > 50000) {
    lastLaunchLogs = lastLaunchLogs.slice(-20000);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`window.lastLaunchLogs = ${JSON.stringify(lastLaunchLogs)}`).catch(() => {});
  }
}

function spawnInternalCommand(workspacePath, executable, args = []) {
  if (!executable) throw new Error('Missing executable');
  lastLaunchLogs = '';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`window.lastLaunchLogs = ''; window.lastLaunchUrl = '';`).catch(() => {});
  }
  const child = spawn(executable, args, {
    cwd: workspacePath,
    env: { ...process.env, PAGER: 'cat' },
    windowsHide: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => {
    const text = data.toString();
    appendLaunchLog(text);
    const match = text.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/i);
    if (match) {
      const url = match[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`window.lastLaunchUrl = ${JSON.stringify(url)}`).catch(() => {});
      }
    }
  });
  child.stderr.on('data', data => {
    appendLaunchLog(data.toString());
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
        const pairingExpired = Date.parse(latestConfig.phoneCompanionPairingExpiresAt || '') <= Date.now();
        if (pairingExpired || String(body.pairingCode || '') !== String(latestConfig.phoneCompanionPairingCode || pairingCode)) {
          sendJson(res, 401, { success: false, error: 'Invalid pairing code' });
          return;
        }
        const deviceName = String(body.deviceName || 'Phone').slice(0, 80);
        let approved = false;
        let pending = false;
        try {
          const approval = await callRendererFunction('approvePhoneCompanionPairing', { deviceName });
          approved = approval && approval.approved !== false;
          pending = approval && approval.pending === true;
        } catch (e) {
          approved = false;
        }
        if (!approved) {
          sendJson(res, 403, { success: false, error: pending ? 'Desktop approval required' : 'Pairing denied', pending });
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
        const state = await callRendererFunction('getPhoneCompanionState', device.selectedConversationId);
        sendJson(res, 200, { success: true, device: companionDevicePublic(device), ...state });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const state = await callRendererFunction('getPhoneCompanionState', device.selectedConversationId);
        sendJson(res, 200, { success: true, preview: state.preview || {} });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/switch') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const targetId = String(body.conversationId || '');
        if (targetId) {
          device.selectedConversationId = targetId;
          const writableConfig = readAppConfig();
          saveCompanionDevice(writableConfig, device);
        }
        sendJson(res, 200, { success: true, conversationId: targetId });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/new') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('startPhoneCompanionTask', body);
        if (result && result.success && result.conversationId) {
          device.selectedConversationId = result.conversationId;
          const writableConfig = readAppConfig();
          saveCompanionDevice(writableConfig, device);
        }
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
        const result = await callRendererFunction('submitPhoneCompanionPrompt', { prompt, conversationId: device.selectedConversationId });
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/approve-plan') {
        const result = await callRendererFunction('approvePhoneCompanionPlan', device.selectedConversationId);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/steer') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('steerPhoneCompanionTask', { prompt: String(body.prompt || body.feedback || '').trim(), conversationId: device.selectedConversationId });
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/deny-plan') {
        const result = await callRendererFunction('denyPhoneCompanionPlan', device.selectedConversationId);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/revise-plan') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('revisePhoneCompanionPlan', { feedback: String(body.feedback || '').trim(), conversationId: device.selectedConversationId });
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/api/stop' || url.pathname === '/api/pause')) {
        const result = await callRendererFunction('stopPhoneCompanionTask', device.selectedConversationId);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/resume') {
        const result = await callRendererFunction('resumePhoneCompanionTask', device.selectedConversationId);
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
    setTimeout(async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          const payload = await buildCompanionPairingAnnouncement({
            address,
            port,
            pairingCode,
            expiresAt: readAppConfig().phoneCompanionPairingExpiresAt || ''
          });
          mainWindow.webContents.executeJavaScript(
            `window.showPhoneCompanionPairingCard && window.showPhoneCompanionPairingCard(${JSON.stringify(payload)}, { dedupeKey: 'phone-companion-pairing', windowMs: 60000 })`
          ).catch(() => {});
        } catch (e) {
          console.error('Failed to build phone companion pairing card:', e);
        }
      }
    }, 2500);
  });

  companionServer.on('error', (error) => {
    console.error('Phone companion server failed:', error);
  });
}

async function enablePhoneCompanionLanMode() {
  const config = readAppConfig();
  config.enablePhoneCompanion = true;
  writeAppConfig(config);
  await stopPhoneCompanionServer();
  startPhoneCompanionServer();
  return await getPhoneCompanionPairingPayload();
}

ipcMain.handle('get-phone-companion-pairing', async () => {
  return await getPhoneCompanionPairingPayload();
});

ipcMain.handle('enable-phone-companion-lan', async () => {
  return await enablePhoneCompanionLanMode();
});

ipcMain.handle('get-phone-companion-devices', async () => {
  const config = readAppConfig();
  return getCompanionDevices(config).map(companionDevicePublic);
});

ipcMain.handle('revoke-phone-companion-device', async (event, deviceId) => {
  const config = readAppConfig();
  const devices = getCompanionDevices(config).map(d => d.id === deviceId ? { ...d, revoked: true } : d);
  config.phoneCompanionDevices = devices;
  writeAppConfig(config);
  return { success: true, revoked: deviceId };
});

async function getPhoneCompanionPairingPayload() {
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 1122);
  const enableCompanion = config.enablePhoneCompanion === true;
  const address = enableCompanion ? getLocalWifiAddress() : '127.0.0.1';
  const pairingCode = ensureCompanionPairingCode(config);
  const latestConfig = readAppConfig();
  if (!enableCompanion) {
    return {
      success: true,
      type: 'phone-companion-pairing',
      enabled: false,
      networkEnabled: false,
      bindHost: '127.0.0.1',
      address,
      port,
      title: 'Pair Phone Companion',
      description: 'Phone Companion is off. Use the Phone button to enable Wi-Fi pairing.'
    };
  }
  return {
    success: true,
    enabled: true,
    bindHost: '0.0.0.0',
    address,
    port,
    ...(await buildCompanionPairingAnnouncement({
      address,
      port,
      pairingCode,
      expiresAt: latestConfig.phoneCompanionPairingExpiresAt || ''
    }))
  };
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
      launchCommandInWorkspace(workspacePath, `python ${foundPy}`);
      return { success: true, message: `Started Python application in terminal: "python ${foundPy}"` };
    }
    
    // 4. Check for Cargo.toml (Rust)
    if (files.includes('Cargo.toml')) {
      launchCommandInWorkspace(workspacePath, 'cargo run');
      return { success: true, message: 'Started Cargo application in terminal: "cargo run"' };
    }
    
    // 5. Check for Go files
    if (files.includes('go.mod') || files.some(f => f.endsWith('.go'))) {
      launchCommandInWorkspace(workspacePath, 'go run .');
      return { success: true, message: 'Started Go application in terminal: "go run ."' };
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
      throw new Error(`Directory does not exist: ${dirPath}`);
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

  const match = processId.match(/^cmd_(conv[_-][a-zA-Z0-9_-]+)_(.+)$/);
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

// --- LOCAL SEMANTIC CODEBASE INDEXING (RAG) SYSTEM ---
function chunkText(text, maxChunkSize = 1200, overlap = 150) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunk.push(line);
    currentLength += line.length + 1;

    if (currentLength >= maxChunkSize) {
      chunks.push({
        text: currentChunk.join('\n'),
        startLine: startLine,
        endLine: i + 1
      });
      const backtrackLines = Math.min(currentChunk.length - 1, Math.ceil(overlap / 50));
      currentChunk = currentChunk.slice(-backtrackLines);
      currentLength = currentChunk.join('\n').length + 1;
      startLine = i + 1 - backtrackLines + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join('\n'),
      startLine: startLine,
      endLine: lines.length
    });
  }
  return chunks;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getGeminiEmbedding(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text }] }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API returned HTTP ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  if (!data.embedding || !data.embedding.values) {
    throw new Error('Embedding values missing in API response');
  }
  return data.embedding.values;
}

function listFilesRecursive(dirPath) {
  const getFiles = (dir, rootDir) => {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      const relPath = path.relative(rootDir, filePath);
      
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
}

const activeWorkspaceIndices = {};
async function runBackgroundIndexing(workspacePath, apiKey) {
  if (activeWorkspaceIndices[workspacePath]?.status === 'indexing') {
    return;
  }
  
  activeWorkspaceIndices[workspacePath] = { status: 'indexing', progress: 0, total: 0 };
  updateRagStatusInRenderer(workspacePath, 'Scanning...');

  try {
    const files = listFilesRecursive(workspacePath);
    const indexableFiles = files.filter(f => {
      if (f.isDir) return false;
      const ext = path.extname(f.name).toLowerCase();
      const codeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.json', '.md', '.txt', '.java', '.cpp', '.h', '.c', '.go', '.rs', '.sh', '.bat', '.env', '.yml', '.yaml'];
      return codeExtensions.includes(ext);
    });

    const indexDir = path.join(app.getPath('userData'), 'orion-embeddings');
    if (!fs.existsSync(indexDir)) {
      fs.mkdirSync(indexDir, { recursive: true });
    }
    const indexFilename = crypto.createHash('sha256').update(workspacePath).digest('hex') + '.json';
    const indexPath = path.join(indexDir, indexFilename);

    let indexData = { workspace: workspacePath, files: {}, chunks: [] };
    if (fs.existsSync(indexPath)) {
      try {
        indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      } catch (e) {
        indexData = { workspace: workspacePath, files: {}, chunks: [] };
      }
    }

    const relativePaths = new Set(indexableFiles.map(f => f.path));
    let indexChanged = false;
    for (const relPath of Object.keys(indexData.files)) {
      if (!relativePaths.has(relPath)) {
        delete indexData.files[relPath];
        indexData.chunks = indexData.chunks.filter(c => c.path !== relPath);
        indexChanged = true;
      }
    }

    const filesToEmbed = [];
    indexableFiles.forEach(f => {
      const fullPath = path.join(workspacePath, f.path);
      if (!fs.existsSync(fullPath)) return;
      const content = fs.readFileSync(fullPath, 'utf8');
      const hash = crypto.createHash('md5').update(content).digest('hex');
      const existingFile = indexData.files[f.path];

      if (!existingFile || existingFile.hash !== hash) {
        filesToEmbed.push({ relPath: f.path, fullPath, content, hash });
      }
    });

    if (filesToEmbed.length === 0) {
      if (indexChanged) {
        fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
      }
      activeWorkspaceIndices[workspacePath] = { status: 'ready', progress: indexableFiles.length, total: indexableFiles.length };
      updateRagStatusInRenderer(workspacePath, 'Semantic Ready');
      return;
    }

    let progress = 0;
    const total = filesToEmbed.length;
    activeWorkspaceIndices[workspacePath] = { status: 'indexing', progress, total };
    updateRagStatusInRenderer(workspacePath, `Indexing (0/${total})`);

    for (const file of filesToEmbed) {
      indexData.chunks = indexData.chunks.filter(c => c.path !== file.relPath);
      const chunks = chunkText(file.content);
      
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        try {
          const vector = await getGeminiEmbedding(chunk.text, apiKey);
          indexData.chunks.push({
            path: file.relPath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            text: chunk.text,
            vector
          });
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          console.error(`Failed to embed chunk ${idx} of ${file.relPath}:`, err);
        }
      }

      indexData.files[file.relPath] = { hash: file.hash };
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');

      progress++;
      activeWorkspaceIndices[workspacePath] = { status: 'indexing', progress, total };
      updateRagStatusInRenderer(workspacePath, `Indexing (${progress}/${total})`);
    }

    activeWorkspaceIndices[workspacePath] = { status: 'ready', progress: indexableFiles.length, total: indexableFiles.length };
    updateRagStatusInRenderer(workspacePath, 'Semantic Ready');

  } catch (err) {
    console.error('Error in background indexing:', err);
    updateRagStatusInRenderer(workspacePath, 'Indexing Failed');
  }
}

function updateRagStatusInRenderer(workspacePath, statusText) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.executeJavaScript(`if (window.onRagStatusChange) window.onRagStatusChange(${JSON.stringify(statusText)});`).catch(() => {});
    }
  });
}

ipcMain.handle('index-workspace', async (event, workspacePath) => {
  if (!workspacePath) return { success: false, error: 'No workspace path' };
  const config = readAppConfig();
  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    updateRagStatusInRenderer(workspacePath, 'Awaiting API Key');
    return { success: false, error: 'Awaiting API Key' };
  }
  
  runBackgroundIndexing(workspacePath, apiKey);
  return { success: true };
});

ipcMain.handle('search-embeddings', async (event, { query, limit }) => {
  try {
    const config = readAppConfig();
    const apiKey = config.geminiApiKey;
    if (!apiKey) throw new Error('API key is not configured');
    
    const queryVector = await getGeminiEmbedding(query, apiKey);
    
    const windows = BrowserWindow.getAllWindows();
    let currentWorkspacePath = '';
    if (windows.length > 0) {
      const activeProj = await windows[0].webContents.executeJavaScript('window.getCurrentProject ? window.getCurrentProject() : null').catch(() => null);
      currentWorkspacePath = activeProj || '';
    }
    if (!currentWorkspacePath) {
      currentWorkspacePath = config.defaultWorkspacePath || '';
    }
    if (!currentWorkspacePath) throw new Error('No active workspace');
    
    const indexDir = path.join(app.getPath('userData'), 'orion-embeddings');
    const indexFilename = crypto.createHash('sha256').update(currentWorkspacePath).digest('hex') + '.json';
    const indexPath = path.join(indexDir, indexFilename);
    
    if (!fs.existsSync(indexPath)) {
      return { success: true, results: [], message: 'No index built yet for this workspace.' };
    }
    
    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const chunks = indexData.chunks || [];
    
    const scoredChunks = chunks.map(chunk => {
      const sim = cosineSimilarity(queryVector, chunk.vector);
      return {
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        similarity: sim
      };
    });
    
    scoredChunks.sort((a, b) => b.similarity - a.similarity);
    const topResults = scoredChunks.slice(0, parseInt(limit, 10) || 5);
    
    return { success: true, results: topResults };
  } catch (err) {
    console.error('Error searching embeddings:', err);
    return { success: false, error: err.message };
  }
});

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    escapePowerShellSingle,
    startCommandSession,
    killProcessTree,
    startPhoneCompanionServer,
    ensureCompanionToken,
    stopPhoneCompanionServer,
    writeRunArtifact,
    resolveWorkspacePath,
    deleteWorkspacePath,
    moveWorkspacePath,
    copyWorkspacePath,
    listRunArtifacts,
    classifyCommandRequest,
    spawnInternalCommand,
    buildCompanionPairingAnnouncement,
    enablePhoneCompanionLanMode,
    getPhoneCompanionPairingForTest: getPhoneCompanionPairingPayload,
    getCompanionServer: () => companionServer,
    chunkText,
    cosineSimilarity,
    getGeminiEmbedding
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
