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

// web-push for phone notifications — loaded lazily so a missing install doesn't crash startup
let webPush = null;
try { webPush = require('web-push'); } catch (_) {}

// VAPID key pair — generated once, persisted in app config
function getOrCreateVapidKeys() {
  const config = readAppConfig();
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  }
  if (!webPush) return null;
  const keys = webPush.generateVAPIDKeys();
  config.vapidPublicKey = keys.publicKey;
  config.vapidPrivateKey = keys.privateKey;
  writeAppConfig(config);
  return keys;
}

let _vapidKeys = null;
function initVapid() {
  if (!webPush) return;
  _vapidKeys = getOrCreateVapidKeys();
  if (_vapidKeys) {
    webPush.setVapidDetails(
      'mailto:orion@local',
      _vapidKeys.publicKey,
      _vapidKeys.privateKey
    );
  }
}

function ensureVapidInitialized() {
  if (!webPush) return null;
  if (!_vapidKeys) initVapid();
  return _vapidKeys;
}

function notifyDesktop(Notification, title, body) {
  if (!Notification) return { success: false, reason: 'desktop notifications unavailable' };
  try {
    if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
      return { success: false, reason: 'desktop notifications not supported' };
    }
    const notification = new Notification({
      title: String(title || 'Orion AI'),
      body: String(body || '')
    });
    notification.show();
    return { success: true };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Send a push notification to a specific paired device (called from IPC or agent layer)
async function notifyPhoneDevice(deviceId, title, body) {
  if (!webPush || !ensureVapidInitialized()) return { success: false, reason: 'web-push not available' };
  const config = readAppConfig();
  const device = (config.phoneCompanionDevices || []).find(d => d.id === deviceId && !d.revoked);
  if (!device || !device.pushSubscription) return { success: false, reason: 'no subscription' };
  try {
    await webPush.sendNotification(device.pushSubscription, JSON.stringify({ title, body }));
    return { success: true };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Notify all active paired devices that have push subscriptions
async function notifyAllPhoneDevices(title, body) {
  if (!webPush || !ensureVapidInitialized()) {
    return { success: false, sent: 0, failed: 0, skipped: 0, reason: 'web-push not available' };
  }
  const config = readAppConfig();
  const active = (config.phoneCompanionDevices || []).filter(d => !d.revoked && d.pushSubscription);
  if (!active.length) return { success: false, sent: 0, failed: 0, skipped: 0, reason: 'no subscribed phone devices' };
  const results = await Promise.allSettled(active.map(d => notifyPhoneDevice(d.id, title, body)));
  let sent = 0;
  let failed = 0;
  for (const result of results) {
    const value = result.status === 'fulfilled' ? result.value : { success: false };
    if (value && value.success) sent += 1;
    else failed += 1;
  }
  return { success: sent > 0, sent, failed, skipped: 0 };
}

const companionIconPng = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.png'));
  } catch {
    return null;
  }
})();

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

// Tailscale uses the 100.64.0.0/10 CGNAT block (100.64.x.x – 100.127.x.x)
function getTailscaleAddress() {
  const nets = os.networkInterfaces();
  for (const interfaces of Object.values(nets)) {
    for (const net of interfaces || []) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.').map(Number);
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
          return net.address;
        }
      }
    }
  }
  return null;
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Simple sliding-window rate limiter. Keeps timestamps of recent requests per IP.
const _rateLimitWindows = new Map();
function isRateLimited(ip, maxRequests = 60, windowMs = 60000) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let timestamps = _rateLimitWindows.get(ip) || [];
  // Evict old entries
  timestamps = timestamps.filter(t => t > cutoff);
  if (timestamps.length >= maxRequests) {
    _rateLimitWindows.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  _rateLimitWindows.set(ip, timestamps);
  return false;
}
// Prune the map every 5 minutes to prevent unbounded growth.
// Do not keep tests or short-lived utility processes alive just for cleanup.
const rateLimitPruneInterval = setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, ts] of _rateLimitWindows.entries()) {
    if (!ts.some(t => t > cutoff)) _rateLimitWindows.delete(ip);
  }
}, 5 * 60 * 1000);
if (typeof rateLimitPruneInterval.unref === 'function') rateLimitPruneInterval.unref();

function normalizeCompanionHttpsOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function buildCompanionUrl(origin, pairingCode) {
  const base = String(origin || '').replace(/\/+$/, '');
  return {
    pairUrl: `${base}/?pair=${encodeURIComponent(pairingCode)}`,
    stableUrl: `${base}/`
  };
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

async function buildCompanionPairingAnnouncement({ address, port, pairingCode, expiresAt, secureOrigin }) {
  const localOrigin = `http://${address}:${port}`;
  const localUrl = buildCompanionUrl(localOrigin, pairingCode);
  const normalizedSecureOrigin = normalizeCompanionHttpsOrigin(secureOrigin);
  const secureUrl = normalizedSecureOrigin ? buildCompanionUrl(normalizedSecureOrigin, pairingCode) : null;
  const pairUrl = secureUrl ? secureUrl.pairUrl : localUrl.pairUrl;
  const stableUrl = secureUrl ? secureUrl.stableUrl : localUrl.stableUrl;
  const qrSvg = await QRCode.toString(pairUrl, {
    type: 'svg',
    margin: 1,
    width: 180,
    color: { dark: '#111827', light: '#ffffff' }
  });

  // Tailscale remote access — generate a second QR if Tailscale is active
  const tailscaleAddress = getTailscaleAddress();
  let tailscalePairUrl = null;
  let tailscaleStableUrl = null;
  let tailscaleQrSvg = null;
  if (tailscaleAddress) {
    tailscalePairUrl = `http://${tailscaleAddress}:${port}/?pair=${encodeURIComponent(pairingCode)}`;
    tailscaleStableUrl = `http://${tailscaleAddress}:${port}/`;
    tailscaleQrSvg = await QRCode.toString(tailscalePairUrl, {
      type: 'svg',
      margin: 1,
      width: 180,
      color: { dark: '#0d4c2c', light: '#ffffff' }
    });
  }

  return {
    type: 'phone-companion-pairing',
    pairUrl,
    stableUrl,
    localPairUrl: localUrl.pairUrl,
    localStableUrl: localUrl.stableUrl,
    secureOrigin: normalizedSecureOrigin,
    securePairUrl: secureUrl ? secureUrl.pairUrl : null,
    secureStableUrl: secureUrl ? secureUrl.stableUrl : null,
    preferredUrlType: secureUrl ? 'https' : 'local',
    phoneNotificationsAvailable: !!secureUrl,
    pairingCode,
    expiresAt: expiresAt || '',
    qrSvg,
    networkEnabled: address !== '127.0.0.1' && address !== 'localhost',
    tailscaleAddress,
    tailscalePairUrl,
    tailscaleStableUrl,
    tailscaleQrSvg,
    title: 'Pair Phone Companion',
    description: 'Scan once to trust this phone. After pairing, save the clean URL to your home screen.'
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

function createCompanionDeviceSession(config, deviceName, userAgent) {
  const now = new Date().toISOString();
  // Deduplicate: if an active device with same user-agent already exists, refresh it
  if (userAgent) {
    const existing = getCompanionDevices(config).find(d => !d.revoked && d.userAgent === userAgent);
    if (existing) {
      existing.lastSeenAt = now;
      existing.name = String(deviceName || existing.name || 'Phone').slice(0, 80);
      return saveCompanionDevice(config, existing);
    }
  }
  const device = {
    id: crypto.randomBytes(12).toString('base64url'),
    name: String(deviceName || 'Phone').slice(0, 80),
    secret: crypto.randomBytes(24).toString('base64url'),
    approved: true,
    revoked: false,
    pairedAt: now,
    lastSeenAt: now,
    userAgent: userAgent || null,
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
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#09090d',
    theme_color: '#2563eb',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
    ]
  };
}

function companionServiceWorker() {
  return `const CACHE = 'orion-phone-companion-v18';
const SHELL = ['/icon.svg', '/icon-192.png', '/icon-512.png', '/marked.min.js'];
self.addEventListener('install', event => {
  // Use Promise.allSettled so a 404 from /marked.min.js (when not installed) does not
  // permanently break the service worker install — the SW still activates fine without it.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(SHELL.map(url => cache.add(url)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname === '/manifest.webmanifest' || url.pathname === '/sw.js') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
self.addEventListener('push', event => {
  let data = { title: 'Orion AI', body: 'Task complete' };
  try { if (event.data) data = event.data.json(); } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Orion AI', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'orion-notify',
    renotify: true
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('/');
  }));
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
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const ALLOWED_RENDERER_FUNCTIONS = [
  'approvePhoneCompanionPairing', 'getPhoneCompanionState', 'denyPhoneCompanionPlan',
  'startPhoneCompanionTask', 'deletePhoneCompanionConversation', 'checkPhoneCompanionUpdate',
  'applyPhoneCompanionUpdate', 'restartApp', 'submitPhoneCompanionPrompt',
  'readWorkspaceFileForPhone', 'approvePhoneCompanionPlan', 'steerPhoneCompanionTask',
  'submitPhoneCompanionClarification', 'revisePhoneCompanionPlan', 'stopPhoneCompanionTask',
  'resumePhoneCompanionTask', 'getPhoneCompanionModels', 'setPhoneCompanionModel',
  'discoverPhoneCompanionSkills', 'runPhoneCompanionSkill'
];

async function callRendererFunction(functionName, arg) {
  if (!ALLOWED_RENDERER_FUNCTIONS.includes(functionName)) {
    throw new Error(`Security Error: Renderer function '${functionName}' is not in the allowlist.`);
  }
  if (!shared.mainWindow || shared.mainWindow.isDestroyed()) throw new Error('Orion window is not ready');
  const script = arg === undefined
    ? `window.${functionName} && window.${functionName}()`
    : `window.${functionName} && window.${functionName}(${JSON.stringify(arg)})`;
  const result = await shared.mainWindow.webContents.executeJavaScript(script, true);
  if (result === undefined || result === null) throw new Error('Phone companion bridge is not ready yet');
  return result;
}

// ── Phone companion server ────────────────────────────────────────────────────

let activeSseTriggers = [];

function triggerCompanionSync() {
  activeSseTriggers.forEach(fn => fn());
}

function startPhoneCompanionServer() {
  if (shared.companionServer) return;
  initVapid();
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 45678);
  const enableCompanion = config.enablePhoneCompanion !== false;
  const host = enableCompanion ? '0.0.0.0' : '127.0.0.1';
  shared.companionToken = ensureCompanionToken(config);
  const pairingCode = ensureCompanionPairingCode(config);

  shared.companionServer = http.createServer(async (req, res) => {
    try {
      const clientIp = req.socket.remoteAddress || 'unknown';
      // Stricter limit on pairing endpoint (5 attempts/min), normal limit elsewhere (60 req/min)
      const isPairEndpoint = (req.url || '').startsWith('/api/pair');
      const rateLimit = isPairEndpoint ? 5 : 60;
      if (isRateLimited(clientIp, rateLimit, 60000)) {
        sendJson(res, 429, { success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
        return;
      }

      const latestConfig = readAppConfig();
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/') {
        const freshPairingCode = ensureCompanionPairingCode(readAppConfig());
        const headers = {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        };
        if (url.searchParams.get('reset') === '1') {
          headers['Clear-Site-Data'] = '"cache", "storage"';
        }
        res.writeHead(200, headers);
        res.end(companionHtml(freshPairingCode, os.hostname()));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(companionIconSvg());
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png' || url.pathname === '/apple-touch-icon.png')) {
        if (!companionIconPng) {
          sendJson(res, 404, { success: false, error: 'Icon not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        res.end(companionIconPng);
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

      if (req.method === 'GET' && url.pathname === '/marked.min.js') {
        const markedPath = path.join(__dirname, '../node_modules/marked/marked.min.js');
        if (!fs.existsSync(markedPath)) {
          sendJson(res, 404, { success: false, error: 'Markdown renderer not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(markedPath).pipe(res);
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
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
        const device = createCompanionDeviceSession(writableConfig, deviceName, userAgent);
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

      if (req.method === 'POST' && url.pathname === '/api/devices/revoke-all') {
        const writableConfig = readAppConfig();
        const devices = getCompanionDevices(writableConfig).map(d => ({ ...d, revoked: true }));
        writableConfig.phoneCompanionDevices = devices;
        writeAppConfig(writableConfig);
        sendJson(res, 200, { success: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/vapid-public-key') {
        const keys = ensureVapidInitialized();
        const publicKey = (keys && keys.publicKey) || (readAppConfig().vapidPublicKey) || null;
        sendJson(res, 200, { success: true, enabled: !!publicKey, publicKey });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/push-subscribe') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        if (!body.subscription) { sendJson(res, 400, { success: false, error: 'Missing subscription' }); return; }
        const writableConfig = readAppConfig();
        const target = getCompanionDevices(writableConfig).find(d => d.id === device.id);
        if (target) {
          target.pushSubscription = body.subscription;
          writableConfig.phoneCompanionDevices = getCompanionDevices(writableConfig).map(d => d.id === device.id ? target : d);
          writeAppConfig(writableConfig);
        }
        sendJson(res, 200, { success: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        try {
          const state = await callRendererFunction('getPhoneCompanionState', device.selectedConversationId);
          if (state && state.conversationId && state.conversationId !== device.selectedConversationId) {
            device.selectedConversationId = state.conversationId;
            const writableConfig = readAppConfig();
            saveCompanionDevice(writableConfig, device);
          }
          sendJson(res, 200, { success: true, device: companionDevicePublic(device), ...state });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to get state' });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/preview') {
        try {
          const state = await callRendererFunction('getPhoneCompanionState', device.selectedConversationId);
          sendJson(res, 200, { success: true, preview: state.preview || {} });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to get preview' });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write(': connected\n\n');
        let lastSignature = '';
        let closed = false;
        const pushState = async () => {
          if (closed) return;
          try {
            const currentConfig = readAppConfig();
            const currentDevice = getCompanionDevices(currentConfig).find(d => d.id === device.id) || device;
            const targetId = currentDevice.selectedConversationId;
            const state = await callRendererFunction('getPhoneCompanionState', targetId);
            const payload = { success: true, device: companionDevicePublic(currentDevice), ...state };
            const signature = JSON.stringify(payload);
            if (signature !== lastSignature) {
              lastSignature = signature;
              res.write(`data: ${signature}\n\n`);
            }
          } catch (e) {
            if (!closed) res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
          }
        };
        await pushState();
        activeSseTriggers.push(pushState);
        // Keepalive ping every 20s — Android Chrome drops idle SSE connections without it
        const pingInterval = setInterval(() => {
          if (!closed) res.write(': ping\n\n');
        }, 20000);
        req.on('close', () => {
          closed = true;
          clearInterval(pingInterval);
          activeSseTriggers = activeSseTriggers.filter(fn => fn !== pushState);
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/deny-plan') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const targetId = String(body.conversationId || device.selectedConversationId || '');
        if (!targetId) { sendJson(res, 400, { success: false, error: 'Missing conversation id' }); return; }
        try {
          const result = await callRendererFunction('denyPhoneCompanionPlan', targetId);
          sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to deny plan' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/switch') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const targetId = String(body.conversationId || '');
        if (!targetId) {
          sendJson(res, 400, { success: false, error: 'Missing conversation id' });
          return;
        }
        device.selectedConversationId = targetId;
        const writableConfig = readAppConfig();
        saveCompanionDevice(writableConfig, device);
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

      if (req.method === 'POST' && url.pathname === '/api/conversations/delete') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const conversationId = String(body.conversationId || device.selectedConversationId || '');
        if (!conversationId) {
          sendJson(res, 400, { success: false, error: 'Missing conversation id' });
          return;
        }
        if (body.confirmed !== true) {
          sendJson(res, 400, { success: false, error: 'Delete confirmation required' });
          return;
        }
        const result = await callRendererFunction('deletePhoneCompanionConversation', conversationId);
        if (device.selectedConversationId === conversationId) {
          device.selectedConversationId = null;
          const writableConfig = readAppConfig();
          saveCompanionDevice(writableConfig, device);
        }
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/check-update') {
        try {
          const result = await callRendererFunction('checkPhoneCompanionUpdate');
          sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Update check failed' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/apply-update') {
        try {
          const result = await callRendererFunction('applyPhoneCompanionUpdate');
          sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Update failed' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/restart') {
        sendJson(res, 200, { success: true });
        // Small delay so response reaches the phone before Orion exits
        setTimeout(() => callRendererFunction('restartApp'), 400);
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
        // Image support: accept base64 imageData + imageMimeType from phone companion
        const imageData = typeof body.imageData === 'string' && body.imageData.length > 0 ? body.imageData : null;
        const imageMimeType = imageData ? (String(body.imageMimeType || 'image/jpeg')) : null;
        // File attachment: prepend file content to the prompt as context
        let finalPrompt = prompt;
        if (typeof body.fileContent === 'string' && body.fileContent.length > 0) {
          const fname = String(body.fileName || 'file.txt').replace(/[^\w.\-]/g, '_').slice(0, 80);
          const truncated = body.fileContent.length > 80000 ? body.fileContent.slice(0, 80000) + '\n[... truncated]' : body.fileContent;
          finalPrompt = '[Attached file: ' + fname + ']\n```\n' + truncated + '\n```\n\n' + prompt;
        }
        const result = await callRendererFunction('submitPhoneCompanionPrompt', {
          prompt: finalPrompt,
          conversationId: device.selectedConversationId,
          projectPath: String(body.projectPath || '').trim(),
          mode: body.mode === 'coder' ? 'coder' : 'orion',
          imageData,
          imageMimeType
        });
        if (result && result.success !== false && result.conversationId && result.conversationId !== device.selectedConversationId) {
          device.selectedConversationId = result.conversationId;
          const writableConfig = readAppConfig();
          saveCompanionDevice(writableConfig, device);
        }
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/files/read') {
        const filePath = url.searchParams.get('path');
        if (!filePath) { sendJson(res, 400, { success: false, error: 'Missing path' }); return; }
        const result = await callRendererFunction('readWorkspaceFileForPhone', filePath);
        if (!result || !result.success) {
          sendJson(res, 404, { success: false, error: (result && result.error) || 'File not found' });
          return;
        }
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() || 'file';
        const safeFileName = fileName.replace(/[^\w.\-]/g, '_');
        const contentType = result.mimeType || 'application/octet-stream';
        const buf = Buffer.from(result.content, result.encoding === 'base64' ? 'base64' : 'utf8');
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': 'attachment; filename="' + safeFileName + '"',
          'Content-Length': buf.length,
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(buf);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/approve-plan') {
        try {
          const result = await callRendererFunction('approvePhoneCompanionPlan', device.selectedConversationId);
          sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to approve plan' });
        }
        return;
      }

		if (req.method === 'POST' && url.pathname === '/api/steer') {
			try {
				const bodyText = await readRequestBody(req);
				const body = bodyText ? JSON.parse(bodyText) : {};
				const result = await callRendererFunction('steerPhoneCompanionTask', { prompt: String(body.prompt || body.feedback || '').trim(), conversationId: device.selectedConversationId });
				sendJson(res, 200, { success: true, ...result });
			} catch (e) {
				sendJson(res, 500, { success: false, error: e.message || 'Failed to send feedback' });
			}
			return;
		}

      if (req.method === 'POST' && url.pathname === '/api/deny-plan') {
        try {
          const result = await callRendererFunction('denyPhoneCompanionPlan', device.selectedConversationId);
          sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to deny plan' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/clarify') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        if (!Array.isArray(body.answers) || body.answers.length === 0) {
          sendJson(res, 400, { success: false, error: 'Missing answers' });
          return;
        }
        const result = await callRendererFunction('submitPhoneCompanionClarification', {
          answers: body.answers,
          conversationId: device.selectedConversationId
        });
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

      if (req.method === 'GET' && url.pathname === '/api/model') {
        const result = await callRendererFunction('getPhoneCompanionModels');
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/model') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const model = String(body.model || '').trim();
        if (!model) { sendJson(res, 400, { success: false, error: 'Missing model' }); return; }
        const result = await callRendererFunction('setPhoneCompanionModel', model);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/skills') {
        const group = url.searchParams.get('group') || null;
        const result = await callRendererFunction('discoverPhoneCompanionSkills', group);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/skills/run') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const name = String(body.name || '').trim();
        if (!name) {
          sendJson(res, 400, { success: false, error: 'Missing skill name' });
          return;
        }
        const result = await callRendererFunction('runPhoneCompanionSkill', { name, inputs: body.inputs || {} });
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
    const url = `http://${address}:${port}/?pair=${encodeURIComponent(pairingCode)}`;
    console.log(`Orion phone companion listening at ${url} (Host: ${host})`);
    const pairingAnnouncementTimer = setTimeout(async () => {
      if (shared.mainWindow && !shared.mainWindow.isDestroyed()) {
        try {
          const payload = await buildCompanionPairingAnnouncement({
            address,
            port,
            pairingCode,
            expiresAt: readAppConfig().phoneCompanionPairingExpiresAt || '',
            secureOrigin: readAppConfig().phoneCompanionHttpsOrigin || ''
          });
          shared.mainWindow.webContents.executeJavaScript(
            `window.showPhoneCompanionPairingCard && window.showPhoneCompanionPairingCard(${JSON.stringify(payload)}, { dedupeKey: 'phone-companion-pairing', windowMs: 60000 })`
          ).catch(() => {});
        } catch (e) {
          console.error('Failed to build phone companion pairing card:', e);
        }
      }
    }, 2500);
    if (typeof pairingAnnouncementTimer.unref === 'function') pairingAnnouncementTimer.unref();
  });

  shared.companionServer.on('error', (error) => {
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

async function getPhoneCompanionPairingPayload() {
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 45678);
  const enableCompanion = config.enablePhoneCompanion !== false;
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
      expiresAt: latestConfig.phoneCompanionPairingExpiresAt || '',
      secureOrigin: latestConfig.phoneCompanionHttpsOrigin || ''
    }))
  };
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain, deps = {}) {
  const Notification = deps.Notification;

  ipcMain.handle('get-phone-companion-devices', async () => {
    const config = readAppConfig();
    return getCompanionDevices(config).map(companionDevicePublic);
  });

  ipcMain.handle('revoke-phone-companion-device', async (event, deviceId) => {
    const targetId = String(deviceId || '').trim();
    if (!targetId) return { success: false, error: 'Missing device id' };
    const config = readAppConfig();
    const devices = getCompanionDevices(config);
    const found = devices.some(device => device.id === targetId);
    if (!found) return { success: false, error: 'Device not found' };
    config.phoneCompanionDevices = devices.map(device => device.id === targetId ? { ...device, revoked: true } : device);
    writeAppConfig(config);
    triggerCompanionSync();
    return { success: true, revoked: targetId };
  });

  ipcMain.handle('revoke-all-phone-companion-devices', async () => {
    const config = readAppConfig();
    config.phoneCompanionDevices = getCompanionDevices(config).map(device => ({ ...device, revoked: true }));
    writeAppConfig(config);
    triggerCompanionSync();
    return { success: true, revokedAll: true };
  });

  ipcMain.handle('notify-phone', async (event, { title, body } = {}) => {
    const normalizedTitle = String(title || 'Orion AI');
    const normalizedBody = String(body || '');
    const desktop = notifyDesktop(Notification, normalizedTitle, normalizedBody);
    const phone = await notifyAllPhoneDevices(normalizedTitle, normalizedBody);
    return { success: desktop.success || phone.success, desktop, phone };
  });

  ipcMain.on('orion:phone-companion-sync', () => {
    triggerCompanionSync();
  });
}

module.exports = {
  registerHandlers,
  startStaticWorkspaceServer,
  stopPhoneCompanionServer,
  startPhoneCompanionServer,
  getLocalWifiAddress,
  enablePhoneCompanionLanMode,
  getPhoneCompanionPairingPayload,
  buildCompanionPairingAnnouncement,
  ensureCompanionToken,
  triggerCompanionSync,
  callRendererFunction,
  ensureVapidInitialized,
  notifyDesktop,
  notifyPhoneDevice,
  notifyAllPhoneDevices
};
