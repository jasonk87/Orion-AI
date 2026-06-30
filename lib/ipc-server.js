'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { readAppConfig, writeAppConfig } = require('./config');
const companionHtml = require('./companion-html');
const shared = require('./shared');

// ── Static workspace file server ──────────────────────────────────────────────

function getStaticMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}

function startStaticWorkspaceServer(workspacePath) {
  const key = path.resolve(workspacePath);
  const existing = shared.staticWorkspaceServers.get(key);
  if (existing && existing.server && existing.url) return Promise.resolve(existing.url);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const decodedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
        const requestedPath = path.resolve(key, `.${decodedPath}`);
        if (requestedPath !== key && !requestedPath.startsWith(`${key}${path.sep}`)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        fs.readFile(requestedPath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': getStaticMimeType(requestedPath) });
          res.end(data);
        });
      } catch (err) {
        res.writeHead(500);
        res.end('Server error');
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const url = `http://127.0.0.1:${address.port}/index.html`;
      shared.staticWorkspaceServers.set(key, { server, url });
      resolve(url);
    });
  });
}

function stopPhoneCompanionServer() {
  return new Promise(resolve => {
    if (!shared.companionServer) {
      resolve();
      return;
    }
    const server = shared.companionServer;
    shared.companionServer = null;
    server.close(() => resolve());
  });
}

// ── Phone companion helpers ────────────────────────────────────────────────────

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
    name: 'Orion AI',
    short_name: 'Orion',
    description: 'Control Orion AI from your phone on your local Wi-Fi.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#07070a',
    theme_color: '#60a5fa',
    orientation: 'portrait',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
}

// Pure-Node PNG generator (no external deps) — draws the Orion "O" ring icon
function makePng(size) {
  const zlib = require('zlib');
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (const b of data) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const cx = size / 2, cy = size / 2;
  // Rounded-rect mask (like an iOS icon) — corner radius = size * 0.22
  const rr = size * 0.22;
  // Ring: outer radius 42%, inner radius 26%
  const outerR = size * 0.42, innerR = size * 0.26;
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // PNG filter byte
    for (let x = 0; x < size; x++) {
      const px = x - cx, py = y - cy;
      // Rounded rect SDF
      const qx = Math.abs(px) - (size / 2 - rr), qy = Math.abs(py) - (size / 2 - rr);
      const inRect = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) + Math.min(Math.max(qx, qy), 0) < rr;
      const i = 1 + x * 3;
      if (!inRect) {
        // Transparent (background) — use --bg color
        row[i] = 7; row[i + 1] = 7; row[i + 2] = 10;
      } else {
        const d = Math.sqrt(px * px + py * py);
        if (d < outerR && d > innerR) {
          // Ring — accent blue #60a5fa
          row[i] = 96; row[i + 1] = 165; row[i + 2] = 250;
        } else {
          // Inside ring or outside ring but in rect — dark bg
          row[i] = 10; row[i + 1] = 10; row[i + 2] = 18;
        }
      }
    }
    rawRows.push(row);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rawRows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
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
      <stop offset="42%" stop-color="#2563eb"/>
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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

async function callRendererFunction(functionName, arg) {
  if (!shared.mainWindow || shared.mainWindow.isDestroyed()) throw new Error('Orion window is not ready');
  const script = arg === undefined
    ? `window.${functionName} && window.${functionName}()`
    : `window.${functionName} && window.${functionName}(${JSON.stringify(arg)})`;
  const result = await shared.mainWindow.webContents.executeJavaScript(script, true);
  if (!result) throw new Error('Phone companion bridge is not ready yet');
  return result;
}

// ── Phone companion server ────────────────────────────────────────────────────

function startPhoneCompanionServer() {
  if (shared.companionServer) return;
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 5000);
  const enableCompanion = config.enablePhoneCompanion !== false;
  const host = enableCompanion ? '0.0.0.0' : '127.0.0.1';
  shared.companionToken = ensureCompanionToken(config);
  const pairingCode = ensureCompanionPairingCode(config);

  shared.companionServer = http.createServer(async (req, res) => {
    try {
      const latestConfig = readAppConfig();
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/') {
        const freshPairingCode = ensureCompanionPairingCode(readAppConfig());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(companionHtml(freshPairingCode, os.hostname()));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(companionIconSvg());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/icon-192.png') {
        const png = makePng(192);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': png.length });
        res.end(png);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/icon-512.png') {
        const png = makePng(512);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': png.length });
        res.end(png);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/apple-touch-icon.png') {
        const png = makePng(180);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': png.length });
        res.end(png);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/manifest.webmanifest' || url.pathname === '/manifest.json')) {
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
        const submittedPairingCode = String(body.pairingCode || '');
        const configuredPairingCode = String(latestConfig.phoneCompanionPairingCode || pairingCode);
        const pairingExpired = Date.parse(latestConfig.phoneCompanionPairingExpiresAt || '') <= Date.now();
        const matchesConfiguredCode = submittedPairingCode === configuredPairingCode;
        const matchesServedCode = submittedPairingCode === String(pairingCode || '');
        if ((!matchesConfiguredCode || pairingExpired) && !matchesServedCode) {
          sendJson(res, 401, { success: false, error: 'Invalid pairing code' });
          return;
        }
        if (pairingExpired || !matchesConfiguredCode) {
          const writableConfig = readAppConfig();
          writableConfig.phoneCompanionPairingCode = submittedPairingCode;
          writableConfig.phoneCompanionPairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          writeAppConfig(writableConfig);
        }
        const deviceName = String(body.deviceName || 'Phone').slice(0, 80);
        const requireDesktopApproval = latestConfig.phoneCompanionRequireDesktopApproval === true;
        let approved = !requireDesktopApproval;
        let pending = false;
        if (requireDesktopApproval) {
          try {
            const approval = await callRendererFunction('approvePhoneCompanionPairing', { deviceName });
            approved = approval && approval.approved !== false;
            pending = approval && approval.pending === true;
          } catch (e) {
            approved = false;
          }
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

  shared.companionServer.listen(port, host, () => {
    const address = enableCompanion ? getLocalWifiAddress() : '127.0.0.1';
    const url = `http://${address}