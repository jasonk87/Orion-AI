'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { readAppConfig, writeAppConfig, updateAppConfig } = require('./config');
const companionHtml = require('./companion-html');
const shared = require('./shared');
const specialistRegistry = require('../specialist-registry');

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
async function notifyPhoneDevice(deviceId, title, body, context = {}) {
  if (!webPush || !ensureVapidInitialized()) return { success: false, reason: 'web-push not available' };
  const config = readAppConfig();
  const device = (config.phoneCompanionDevices || []).find(d => d.id === deviceId && !d.revoked);
  if (!device || !device.pushSubscription) return { success: false, reason: 'no subscription' };
  const subscriptionEndpoint = String(device.pushSubscription.endpoint || '');
  try {
    await webPush.sendNotification(device.pushSubscription, JSON.stringify({
      title,
      body,
      conversationId: String(context.conversationId || '')
    }));
    return { success: true };
  } catch (e) {
    const statusCode = Number(e && e.statusCode) || 0;
    const responseBody = String(e && e.body || '').trim();
    const reason = [String(e && e.message || 'Push delivery failed'), responseBody]
      .filter(Boolean)
      .join(': ')
      .slice(0, 500);
    const subscriptionExpired = statusCode === 404 || statusCode === 410;
    if (subscriptionExpired) {
      const invalidatedAt = new Date().toISOString();
      const pendingNotification = {
        title: String(title || 'Orion AI').slice(0, 160),
        body: String(body || '').slice(0, 500),
        context: { conversationId: String(context.conversationId || '') },
        createdAt: invalidatedAt,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      };
      // Only invalidate the endpoint that actually failed. A phone can renew while this request
      // is in flight; removing a different, newer endpoint would turn recovery into a race.
      await updateAppConfig(latest => {
        latest.phoneCompanionDevices = getCompanionDevices(latest).map(candidate => {
          if (candidate.id !== deviceId) return candidate;
          if (String(candidate.pushSubscription && candidate.pushSubscription.endpoint || '') !== subscriptionEndpoint) {
            return candidate;
          }
          return {
            ...candidate,
            pushSubscription: null,
            pushSubscriptionSavedAt: '',
            pushSubscriptionNeedsRefresh: true,
            invalidatedPushEndpoint: subscriptionEndpoint,
            pushSubscriptionInvalidatedAt: invalidatedAt,
            pendingPushNotification: pendingNotification
          };
        });
        return latest;
      });
    }
    return { success: false, reason, statusCode, subscriptionExpired };
  }
}

// ── Tailscale HTTPS route ──────────────────────────────────────────────────────
// Web Push will not subscribe outside a secure context, so the phone must reach the companion
// over real HTTPS. Tailscale provides that (a genuine cert for *.ts.net) but only if a serve
// route forwards the tailnet hostname to the local companion port — and that route has to exist
// before the phone can ever register a subscription.
//
// Doing it here rather than in a .bat means it follows the app: it re-asserts on every launch,
// uses whatever port the companion actually bound, and cannot drift out of sync with config.
// `tailscale serve --bg` persists in tailscaled's own state, so this is normally a no-op after
// the first run — it is re-run because a no-op is cheaper than a silently missing route.
//
// Strictly best-effort: a missing Tailscale CLI, a logged-out node, or a non-zero exit must
// never block Orion from starting.
function runTailscaleCommand(args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('tailscale', args, { windowsHide: true });
    } catch (error) {
      resolve({ ok: false, reason: `tailscale CLI unavailable: ${error.message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      done({ ok: false, reason: `tailscale ${args[0]} timed out` });
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      done({ ok: false, reason: `tailscale CLI unavailable: ${error.message}` });
    });
    child.on('close', code => {
      clearTimeout(timer);
      done({ ok: code === 0, code, stdout, stderr: stderr.trim() });
    });
  });
}

function findExistingTailscaleHttpsOrigin(statusPayload, port) {
  const target = `http://127.0.0.1:${Number(port)}`;
  const web = statusPayload && typeof statusPayload.Web === 'object' ? statusPayload.Web : {};
  for (const [hostPort, route] of Object.entries(web)) {
    const handlers = route && typeof route.Handlers === 'object' ? route.Handlers : {};
    const proxiesToCompanion = Object.values(handlers).some(handler => (
      handler && String(handler.Proxy || '').replace(/\/+$/, '') === target
    ));
    if (!proxiesToCompanion) continue;
    const hostname = String(hostPort || '').replace(/:443$/, '').replace(/\.$/, '');
    if (/^[a-z0-9.-]+\.ts\.net$/i.test(hostname)) return `https://${hostname}`;
  }
  return '';
}

async function resolveCompanionHttpsOrigin(config, port) {
  const configured = String(config && config.phoneCompanionHttpsOrigin || '').trim();
  if (configured) return configured;
  // Do not publish a new tailnet route without an explicit setting. If the user already has a
  // working HTTPS route for this exact companion port, however, prefer that stable secure origin
  // over LAN/Tailscale IP variants so pairing and the installed shortcut share one storage scope.
  const status = await runTailscaleCommand(['serve', 'status', '--json']);
  if (!status.ok) return '';
  try {
    return findExistingTailscaleHttpsOrigin(JSON.parse(status.stdout || '{}'), port);
  } catch (_) {
    return '';
  }
}

async function ensureTailscaleServeRoute(port, options = {}) {
  const config = options.config || readAppConfig();
  const secureOrigin = String(config.phoneCompanionHttpsOrigin || '').trim();
  // Opt-in: without a configured HTTPS origin the user has not asked for a tailnet route, and
  // silently publishing the companion onto their tailnet would be a surprise.
  if (!secureOrigin) return { applied: false, reason: 'no phoneCompanionHttpsOrigin configured' };
  if (!/\.ts\.net$/i.test(new URL(secureOrigin).hostname)) {
    return { applied: false, reason: 'configured HTTPS origin is not a Tailscale hostname' };
  }
  if (!port) return { applied: false, reason: 'companion port unknown' };

  const target = `http://127.0.0.1:${port}`;
  const status = await runTailscaleCommand(['serve', 'status']);
  if (!status.ok && /unavailable/i.test(status.reason || '')) {
    return { applied: false, reason: status.reason };
  }
  if (status.ok && String(status.stdout || '').includes(target)) {
    return { applied: false, alreadyRouted: true, reason: 'route already present' };
  }

  // 45s, not 10s: legitimate first-run cert provisioning genuinely takes tens of seconds.
  // Overridable so tests can exercise the hang without waiting out the real budget.
  const serveTimeoutMs = Number(options.serveTimeoutMs) > 0 ? Number(options.serveTimeoutMs) : 45000;
  const applied = await runTailscaleCommand(['serve', '--bg', '--https=443', target], serveTimeoutMs);
  if (applied.ok) return { applied: true, target, origin: secureOrigin };

  // "tailscale serve timed out" is useless on its own. `serve --https` blocks indefinitely when
  // the tailnet cannot issue a TLS certificate, and the ONLY place that says so is `tailscale
  // cert`, which fails fast with the real reason. Ask it, so the failure names its own fix.
  const diagnosis = await diagnoseTailscaleHttps(secureOrigin);
  return {
    applied: false,
    reason: diagnosis || applied.stderr || applied.reason || `tailscale serve exited ${applied.code}`
  };
}

// Turns a hung/failed `serve` into an actionable sentence. Certificate provisioning is a tailnet
// setting, not something Orion can fix, so the message has to name the console toggle.
async function diagnoseTailscaleHttps(secureOrigin) {
  let hostname = '';
  try {
    hostname = new URL(secureOrigin).hostname;
  } catch (_) {
    return '';
  }
  const cert = await runTailscaleCommand(['cert', hostname], 20000);
  if (cert.ok) return '';
  const message = `${cert.stderr || ''} ${cert.reason || ''}`.trim();
  if (/does not support getting TLS certs|HTTPS.*not enabled|certs are not enabled/i.test(message)) {
    return 'Tailscale HTTPS certificates are not enabled for this tailnet, so no secure origin can exist '
      + 'and the phone can never subscribe to push. Enable them at login.tailscale.com → Settings → '
      + 'Features → HTTPS Certificates, then restart Orion.';
  }
  return message ? `tailscale cert failed: ${message}` : '';
}

// Notify all active paired devices that have push subscriptions
async function notifyAllPhoneDevices(title, body, context = {}) {
  if (!webPush || !ensureVapidInitialized()) {
    return { success: false, sent: 0, failed: 0, skipped: 0, reason: 'web-push not available' };
  }
  const config = readAppConfig();
  const active = (config.phoneCompanionDevices || []).filter(d => !d.revoked && d.pushSubscription);
  if (!active.length) return { success: false, sent: 0, failed: 0, skipped: 0, reason: 'no subscribed phone devices' };
  const results = await Promise.allSettled(active.map(d => notifyPhoneDevice(d.id, title, body, context)));
  let sent = 0;
  let failed = 0;
  const failureReasons = [];
  for (const result of results) {
    const value = result.status === 'fulfilled' ? result.value : { success: false };
    if (value && value.success) sent += 1;
    else {
      failed += 1;
      const reason = result.status === 'rejected'
        ? String(result.reason && result.reason.message || result.reason || 'Push request rejected')
        : String(value && value.reason || 'Push delivery failed');
      if (reason && !failureReasons.includes(reason)) failureReasons.push(reason);
    }
  }
  return {
    success: sent > 0,
    sent,
    failed,
    skipped: 0,
    reason: failed > 0 ? failureReasons.join('; ').slice(0, 800) : ''
  };
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
    resetCompanionStateSnapshots();
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

const secureOriginHealthCache = new Map();

function verifyCompanionHttpsOrigin(origin, timeoutMs = 1800) {
  const normalized = normalizeCompanionHttpsOrigin(origin);
  if (!normalized) return Promise.resolve(false);
  const cached = secureOriginHealthCache.get(normalized);
  if (cached && Date.now() - cached.checkedAt < 30000) return Promise.resolve(cached.reachable);

  return new Promise(resolve => {
    let settled = false;
    const finish = reachable => {
      if (settled) return;
      settled = true;
      secureOriginHealthCache.set(normalized, { checkedAt: Date.now(), reachable });
      resolve(reachable);
    };
    let req;
    try {
      req = https.get(`${normalized}/api/health`, {
        timeout: timeoutMs,
        headers: { 'User-Agent': 'Orion-Companion-Health/1' }
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (body.length < 512) body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            finish(false);
            return;
          }
          try {
            const payload = JSON.parse(body);
            finish(payload && payload.service === 'orion-phone-companion');
          } catch (_) {
            finish(false);
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Secure companion origin probe timed out')));
      req.on('error', () => finish(false));
    } catch (_) {
      finish(false);
    }
  });
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

async function ensureCompanionPairingCode(config) {
  const expiresAt = Date.parse(config.phoneCompanionPairingExpiresAt || '');
  if (config.phoneCompanionPairingCode && String(config.phoneCompanionPairingCode).length >= 12 && expiresAt > Date.now()) {
    return config.phoneCompanionPairingCode;
  }
  config.phoneCompanionPairingCode = crypto.randomBytes(12).toString('base64url');
  config.phoneCompanionPairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await writeAppConfig(config);
  return config.phoneCompanionPairingCode;
}

async function buildCompanionPairingAnnouncement({
  address,
  port,
  pairingCode,
  expiresAt,
  secureOrigin,
  secureOriginReachable = true
}) {
  const localOrigin = `http://${address}:${port}`;
  const localUrl = buildCompanionUrl(localOrigin, pairingCode);
  const normalizedSecureOrigin = normalizeCompanionHttpsOrigin(secureOrigin);
  const secureUrl = normalizedSecureOrigin && secureOriginReachable
    ? buildCompanionUrl(normalizedSecureOrigin, pairingCode)
    : null;
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
    let tailscaleHost = tailscaleAddress;
    if (normalizedSecureOrigin) {
      try {
        const configuredHostname = new URL(normalizedSecureOrigin).hostname;
        if (/\.ts\.net$/i.test(configuredHostname)) tailscaleHost = configuredHostname;
      } catch (_) {}
    }
    // A direct MagicDNS URL stays stable if Tailscale rotates the device IP and does not depend on
    // an optional `tailscale serve` mapping. The existing device credential remains origin-bound.
    tailscalePairUrl = `http://${tailscaleHost}:${port}/?pair=${encodeURIComponent(pairingCode)}`;
    tailscaleStableUrl = `http://${tailscaleHost}:${port}/`;
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
    secureOriginReachable: !!secureUrl,
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

async function saveCompanionDeviceSelection(device) {
  if (!device || !device.id) throw new Error('Cannot save companion selection without a device id');
  await updateAppConfig(config => {
    const devices = getCompanionDevices(config);
    config.phoneCompanionDevices = devices.map(candidate => (
      candidate.id === device.id
        ? {
            ...candidate,
            selectedConversationId: device.selectedConversationId || null,
            selectionRevision: Math.max(0, Number(device.selectionRevision) || 0)
          }
        : candidate
    ));
    return config;
  });
  return device;
}

async function createCompanionDeviceSession(deviceName, userAgent) {
  const now = new Date().toISOString();
  let savedDevice = null;
  await updateAppConfig(config => {
    // Deduplicate inside the serialized config update. Computing this from a pre-queue snapshot
    // allowed simultaneous phone requests to replace a newly paired device with stale records.
    const existing = userAgent
      ? getCompanionDevices(config).find(d => !d.revoked && d.userAgent === userAgent)
      : null;
    if (existing) {
      savedDevice = {
        ...existing,
        lastSeenAt: now,
        name: String(deviceName || existing.name || 'Phone').slice(0, 80)
      };
    } else {
      savedDevice = {
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
    }
    config.phoneCompanionDevices = getCompanionDevices(config)
      .filter(device => device.id !== savedDevice.id);
    config.phoneCompanionDevices.push(savedDevice);
    return config;
  });
  return savedDevice;
}

function authenticateCompanionRequest(req, config) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const session = bearer ? bearer[1] : String(req.headers['x-orion-session'] || '');
  const deviceId = String(req.headers['x-orion-device-id'] || '');
  if (!session || !deviceId) {
    return { device: null, code: 'COMPANION_CREDENTIAL_MISSING', rePairRequired: false };
  }
  const device = getCompanionDevices(config).find(candidate => candidate.id === deviceId);
  if (!device) {
    return { device: null, code: 'COMPANION_DEVICE_UNKNOWN', rePairRequired: true };
  }
  if (device.revoked) {
    return { device: null, code: 'COMPANION_DEVICE_REVOKED', rePairRequired: true };
  }
  if (!device.approved) {
    return { device: null, code: 'COMPANION_DEVICE_NOT_APPROVED', rePairRequired: true };
  }
  const expected = Buffer.from(String(device.secret || ''));
  const presented = Buffer.from(session);
  if (expected.length !== presented.length || !crypto.timingSafeEqual(expected, presented)) {
    return { device: null, code: 'COMPANION_CREDENTIAL_INVALID', rePairRequired: true };
  }
  touchCompanionDevice(device);
  return { device, code: '', rePairRequired: false };
}

const companionLastSeenWrites = new Map();

function touchCompanionDevice(device) {
  if (!device || !device.id) return;
  const now = Date.now();
  const lastQueued = companionLastSeenWrites.get(device.id) || 0;
  const lastPersisted = Date.parse(device.lastSeenAt || '') || 0;
  if (now - Math.max(lastQueued, lastPersisted) < 60000) return;
  companionLastSeenWrites.set(device.id, now);
  updateAppConfig(config => {
    const devices = getCompanionDevices(config);
    const index = devices.findIndex(candidate => candidate.id === device.id);
    if (index < 0 || devices[index].revoked) return config;
    const nextDevices = [...devices];
    nextDevices[index] = { ...devices[index], lastSeenAt: new Date(now).toISOString() };
    config.phoneCompanionDevices = nextDevices;
    return config;
  }).catch(error => {
    companionLastSeenWrites.delete(device.id);
    console.warn('Failed to persist phone companion last-seen time:', error.message);
  });
}

function companionDevicePublic(device) {
  const hasSubscription = !!device.pushSubscription;
  const needsSubscriptionRefresh = device.pushSubscriptionNeedsRefresh === true
    || (hasSubscription && !device.pushSubscriptionSavedAt);
  return {
    id: device.id,
    name: device.name,
    approved: !!device.approved,
    revoked: !!device.revoked,
    pairedAt: device.pairedAt || '',
    lastSeenAt: device.lastSeenAt || '',
    selectedConversationId: String(device.selectedConversationId || ''),
    selectionRevision: Math.max(0, Number(device.selectionRevision) || 0),
    pushSubscriptionConfigured: hasSubscription,
    pushSubscriptionNeedsRefresh: needsSubscriptionRefresh,
    pushSubscriptionInvalidatedAt: String(device.pushSubscriptionInvalidatedAt || ''),
    pushSubscriptionRefreshToken: needsSubscriptionRefresh
      ? String(device.pushSubscriptionInvalidatedAt || `legacy-${device.id || 'phone'}`)
      : ''
  };
}

function setCompanionDeviceSelection(device, conversationId, options = {}) {
  if (!device) return 0;
  const nextId = String(conversationId || '');
  const changed = String(device.selectedConversationId || '') !== nextId;
  device.selectedConversationId = nextId || null;
  if (changed || options.forceRevision === true) {
    device.selectionRevision = Math.max(0, Number(device.selectionRevision) || 0) + 1;
  }
  return Math.max(0, Number(device.selectionRevision) || 0);
}

function resolveCompanionActionConversation(device, requestedConversationId, requestedSelectionRevision) {
  const selectedConversationId = String(device && device.selectedConversationId || '');
  const requestedId = String(requestedConversationId || '');
  const currentRevision = Math.max(0, Number(device && device.selectionRevision) || 0);
  const hasRequestedRevision = requestedSelectionRevision !== undefined
    && requestedSelectionRevision !== null
    && requestedSelectionRevision !== '';
  const requestedRevision = Math.max(0, Number(requestedSelectionRevision) || 0);
  if (hasRequestedRevision && requestedRevision !== currentRevision) {
    return {
      success: false,
      statusCode: 409,
      error: 'The phone view changed before this action was submitted. Reopen the conversation and try again.'
    };
  }
  if (requestedId && requestedId !== selectedConversationId) {
    return {
      success: false,
      statusCode: 409,
      error: 'The phone view changed before this action was submitted. Reopen the conversation and try again.'
    };
  }
  if (!selectedConversationId) {
    return {
      success: false,
      statusCode: 409,
      error: 'No conversation is selected for this action.'
    };
  }
  return { success: true, conversationId: selectedConversationId };
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
  return `const CACHE = 'orion-phone-companion-v33';
const SHELL = ['/icon.svg', '/icon-192.png', '/icon-512.png', '/marked.min.js', '/task-orchestration.js', '/prism.js', '/prism-components/prism-javascript.min.js', '/prism-components/prism-css.min.js', '/prism-components/prism-json.min.js', '/prism-theme.css'];
self.addEventListener('install', event => {
  // Use Promise.allSettled so a 404 from /marked.min.js (or any other optional shell asset, e.g.
  // Prism not being installed) does not permanently break the service worker install — the SW
  // still activates fine without it.
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
    renotify: true,
    data: {
      conversationId: String(data.conversationId || ''),
      url: data.conversationId ? '/?conversation=' + encodeURIComponent(data.conversationId) : '/'
    }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const conversationId = String(data.conversationId || '');
  const targetUrl = String(data.url || (conversationId ? '/?conversation=' + encodeURIComponent(conversationId) : '/'));
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (list.length) {
      list[0].postMessage({ type: 'orion-notification-open', conversationId });
      return list[0].focus();
    }
    return clients.openWindow(targetUrl);
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

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function isLoopbackAddress(address) {
  const normalized = String(address || '').trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function getVerifiedTailscaleIdentity(req) {
  // Tailscale Serve strips caller-supplied identity headers and adds its own before proxying to
  // localhost. Because the companion also listens on the LAN, trust those headers only when the
  // TCP peer is loopback; a direct LAN/tailnet caller must never be able to forge recovery access.
  if (!req || !isLoopbackAddress(req.socket && req.socket.remoteAddress)) return '';
  return String(req.headers['tailscale-user-login'] || '').trim().slice(0, 320);
}

async function bindCompanionDeviceTailscaleIdentity(deviceId, tailscaleUserLogin) {
  const normalizedDeviceId = String(deviceId || '');
  const normalizedLogin = String(tailscaleUserLogin || '').trim().slice(0, 320);
  if (!normalizedDeviceId || !normalizedLogin) return null;
  let saved = null;
  await updateAppConfig(config => {
    config.phoneCompanionDevices = getCompanionDevices(config).map(device => {
      if (device.id !== normalizedDeviceId || device.revoked || !device.approved) return device;
      saved = {
        ...device,
        tailscaleUserLogin: normalizedLogin,
        lastSeenAt: new Date().toISOString()
      };
      return saved;
    });
    return config;
  });
  return saved;
}

async function recoverCompanionDeviceSession(req) {
  const tailscaleUserLogin = getVerifiedTailscaleIdentity(req);
  if (!tailscaleUserLogin) {
    return {
      success: false,
      status: 403,
      code: 'COMPANION_TRUSTED_ORIGIN_REQUIRED',
      error: 'Saved access recovery is only available through the private Tailscale HTTPS address.'
    };
  }

  const config = readAppConfig();
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
  const eligible = getCompanionDevices(config).filter(device => device.approved && !device.revoked);
  const identityMatches = eligible.filter(device => (
    String(device.tailscaleUserLogin || '').toLowerCase() === tailscaleUserLogin.toLowerCase()
  ));
  const exactUserAgentMatches = eligible.filter(device => (
    userAgent && String(device.userAgent || '') === userAgent
  ));

  // Once an identity is bound, it is authoritative and survives browser/Chrome version changes.
  // For pre-upgrade devices, bootstrap the binding only when the exact browser fingerprint maps to
  // one approved device. Ambiguity fails closed and falls back to the normal one-time pair link.
  const candidates = identityMatches.length
    ? identityMatches
    : (exactUserAgentMatches.length === 1 ? exactUserAgentMatches : []);
  if (!candidates.length) {
    return {
      success: false,
      status: 404,
      code: 'COMPANION_RECOVERY_NOT_FOUND',
      error: 'No unambiguous saved phone access matched this private tailnet identity.'
    };
  }

  const device = candidates
    .slice()
    .sort((a, b) => Date.parse(b.lastSeenAt || b.pairedAt || '') - Date.parse(a.lastSeenAt || a.pairedAt || ''))[0];
  const savedDevice = await bindCompanionDeviceTailscaleIdentity(device.id, tailscaleUserLogin);
  if (!savedDevice) {
    return {
      success: false,
      status: 409,
      code: 'COMPANION_RECOVERY_STALE',
      error: 'Saved phone access changed while recovery was in progress.'
    };
  }
  return { success: true, status: 200, device: savedDevice };
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
  'readWorkspaceFileForPhone', 'readChatImageForPhone', 'approvePhoneCompanionPlan', 'steerPhoneCompanionTask',
  'submitPhoneCompanionClarification', 'revisePhoneCompanionPlan', 'stopPhoneCompanionTask',
  'resumePhoneCompanionTask', 'getPhoneCompanionModels', 'setPhoneCompanionModel',
  'setPhoneCompanionReasoning',
  'discoverPhoneCompanionSkills', 'runPhoneCompanionSkill', 'beginNewFocus'
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
const companionStateSnapshots = new Map();
const COMPANION_STATE_SNAPSHOT_MAX_AGE_MS = 750;
const COMPANION_STATE_SNAPSHOT_CACHE_LIMIT = 32;

function companionStateSnapshotKey(conversationId) {
  return String(conversationId || '__default__');
}

function pruneCompanionStateSnapshots() {
  if (companionStateSnapshots.size <= COMPANION_STATE_SNAPSHOT_CACHE_LIMIT) return;
  const oldest = [...companionStateSnapshots.entries()]
    .filter(([, entry]) => !entry.inFlight)
    .sort((a, b) => Number(a[1].updatedAt || 0) - Number(b[1].updatedAt || 0));
  while (companionStateSnapshots.size > COMPANION_STATE_SNAPSHOT_CACHE_LIMIT && oldest.length) {
    companionStateSnapshots.delete(oldest.shift()[0]);
  }
}

function resetCompanionStateSnapshots() {
  companionStateSnapshots.clear();
  activeSseTriggers = [];
}

async function getCompanionStateSnapshot(conversationId, options = {}) {
  const key = companionStateSnapshotKey(conversationId);
  const now = Date.now();
  let entry = companionStateSnapshots.get(key);
  if (!entry) {
    entry = { state: null, updatedAt: 0, inFlight: null };
    companionStateSnapshots.set(key, entry);
  }

  const isFresh = entry.state
    && now - Number(entry.updatedAt || 0) <= Number(options.maxAgeMs || COMPANION_STATE_SNAPSHOT_MAX_AGE_MS);
  if (!options.force && isFresh) return entry.state;
  if (entry.inFlight) {
    if (options.allowStale && entry.state) return entry.state;
    return entry.inFlight;
  }

  const refresh = callRendererFunction('getPhoneCompanionState', conversationId)
    .then(state => {
      entry.state = state;
      entry.updatedAt = Date.now();
      const resolvedKey = companionStateSnapshotKey(state && state.conversationId);
      if (resolvedKey !== key) companionStateSnapshots.set(resolvedKey, entry);
      pruneCompanionStateSnapshots();
      return state;
    })
    .finally(() => {
      if (entry.inFlight === refresh) entry.inFlight = null;
    });
  entry.inFlight = refresh;

  if (options.allowStale && entry.state) {
    refresh.catch(() => {});
    return entry.state;
  }
  return refresh;
}

function triggerCompanionSync() {
  activeSseTriggers.forEach(fn => fn({ force: true }));
}

async function startPhoneCompanionServer() {
  if (shared.companionServer) return Promise.resolve({ alreadyRunning: true });
  resetCompanionStateSnapshots();
  initVapid();
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 45678);
  const enableCompanion = config.enablePhoneCompanion !== false;
  const host = enableCompanion ? '0.0.0.0' : '127.0.0.1';
  shared.companionToken = ensureCompanionToken(config);
  const pairingCode = await ensureCompanionPairingCode(config);

  shared.companionServer = http.createServer(async (req, res) => {
    try {
      const clientIp = req.socket.remoteAddress || 'unknown';
      // Stricter limit on pairing endpoint (5 attempts/min), normal limit elsewhere (600 req/min)
      const isPairEndpoint = (req.url || '').startsWith('/api/pair')
        || (req.url || '').startsWith('/api/session/recover');
      const rateLimit = isPairEndpoint ? 5 : 600;
      const rateLimitKey = `${clientIp}:${isPairEndpoint ? 'pair' : 'general'}`;
      if (isRateLimited(rateLimitKey, rateLimit, 60000)) {
        sendJson(res, 429, { success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
        return;
      }

      const latestConfig = readAppConfig();
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/') {
        await ensureCompanionPairingCode(readAppConfig());
        // Content-Security-Policy for the phone client.
        //
        // Same reasoning as the desktop renderer, different threat surface: this page is served
        // over the network to a real mobile browser, renders model-authored markdown, and holds a
        // bearer token that can drive the desktop. An XSS here is remote-controllable.
        //
        // Delivered as a RESPONSE HEADER rather than a <meta> tag: the header is applied before any
        // markup is parsed and cannot be displaced by injected content.
        //
        // script-src uses a per-response nonce because the document is templated per request, so a
        // hash would need recomputing every time anyway. No 'unsafe-inline', no 'unsafe-eval' — the
        // two inline onclick attributes that would have required them are now real listeners.
        //
        // connect-src is 'self' alone: every call the client makes is a same-origin /api/* path,
        // including the /api/events SSE stream.
        //
        // style-src keeps 'unsafe-inline' deliberately. A nonce would NOT help here: nonces apply
        // to <style> elements, not to the inline style="" attributes this UI uses throughout, and
        // adding a nonce would actually disable 'unsafe-inline' and break them.
        const scriptNonce = crypto.randomBytes(16).toString('base64');
        const headers = {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Content-Security-Policy': [
            "default-src 'self'",
            `script-src 'self' 'nonce-${scriptNonce}'`,
            "style-src 'self' 'unsafe-inline'",
            // Authenticated chat images are deliberately fetched as bytes and exposed to the
            // page through a short-lived blob: URL. Keeping the bearer credential out of an
            // <img src> is the right boundary, but the CSP must permit the display URL that the
            // client creates. Without blob: the request succeeds with a valid PNG and Chrome then
            // blocks the image locally, leaving a broken icon even though Orion reports success.
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "media-src 'self' data:",
            "connect-src 'self'",
            "manifest-src 'self'",
            "worker-src 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; '),
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer'
        };
        if (url.searchParams.get('reset') === '1') {
          headers['Clear-Site-Data'] = '"cache", "storage"';
        }
        res.writeHead(200, headers);
        res.end(companionHtml(os.hostname(), scriptNonce));
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

      // Markdown-rendering cleanup: the phone companion has always run message text through the
      // same marked.js pipeline as desktop (see /marked.min.js above), but desktop additionally
      // runs Prism.highlightAllUnder() on the result for real syntax-highlighted code blocks
      // (index.html loads prism.js + language components + the tomorrow theme locally) while the
      // phone companion never loaded Prism at all — code blocks rendered as plain monospace text
      // with no highlighting. These routes mirror index.html's exact prismjs file set so
      // companion-html.js can load the same script/theme the desktop UI already uses.
      if (req.method === 'GET' && url.pathname === '/prism.js') {
        const prismPath = path.join(__dirname, '../node_modules/prismjs/prism.js');
        if (!fs.existsSync(prismPath)) {
          sendJson(res, 404, { success: false, error: 'Syntax highlighter not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(prismPath).pipe(res);
        return;
      }

      if (req.method === 'GET' && /^\/prism-components\/[a-z0-9-]+\.min\.js$/.test(url.pathname)) {
        const componentFile = url.pathname.replace('/prism-components/', '');
        const componentPath = path.join(__dirname, '../node_modules/prismjs/components', componentFile);
        if (!fs.existsSync(componentPath)) {
          sendJson(res, 404, { success: false, error: 'Syntax highlighter language component not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(componentPath).pipe(res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/prism-theme.css') {
        const themePath = path.join(__dirname, '../node_modules/prismjs/themes/prism-tomorrow.min.css');
        if (!fs.existsSync(themePath)) {
          sendJson(res, 404, { success: false, error: 'Syntax highlighter theme not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(themePath).pipe(res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/task-orchestration.js') {
        const taskOrchestrationPath = path.join(__dirname, '../task-orchestration.js');
        if (!fs.existsSync(taskOrchestrationPath)) {
          sendJson(res, 404, { success: false, error: 'Task presentation contracts not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        fs.createReadStream(taskOrchestrationPath).pipe(res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pair') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const submittedPairingCode = String(body.pairingCode || '');
        const pairingConfig = readAppConfig();
        const configuredPairingCode = String(pairingConfig.phoneCompanionPairingCode || '');
        const pairingExpired = Date.parse(pairingConfig.phoneCompanionPairingExpiresAt || '') <= Date.now();
        const matchesConfiguredCode = submittedPairingCode === configuredPairingCode;
        if (!matchesConfiguredCode || pairingExpired) {
          sendJson(res, 401, {
            success: false,
            error: 'Pairing link expired or is no longer current',
            code: 'COMPANION_PAIRING_CODE_INVALID',
            needsPairingLink: true
          });
          return;
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
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
        let device = await createCompanionDeviceSession(deviceName, userAgent);
        const tailscaleUserLogin = getVerifiedTailscaleIdentity(req);
        if (tailscaleUserLogin) {
          device = await bindCompanionDeviceTailscaleIdentity(device.id, tailscaleUserLogin) || device;
        }
        sendJson(res, 200, { success: true, device: companionDevicePublic(device), sessionSecret: device.secret });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/session/recover') {
        const recovered = await recoverCompanionDeviceSession(req);
        if (!recovered.success) {
          sendJson(res, recovered.status, {
            success: false,
            error: recovered.error,
            code: recovered.code,
            rePairRequired: false
          });
          return;
        }
        sendJson(res, 200, {
          success: true,
          recovered: true,
          device: companionDevicePublic(recovered.device),
          sessionSecret: recovered.device.secret
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, {
          success: true,
          service: 'orion-phone-companion',
          machine: os.hostname()
        });
        return;
      }

      const authentication = authenticateCompanionRequest(req, latestConfig);
      const device = authentication.device;
      if (!device) {
        sendJson(res, 401, {
          success: false,
          error: 'Unauthorized companion request',
          code: authentication.code,
          rePairRequired: authentication.rePairRequired === true
        });
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
        await updateAppConfig(config => {
          config.phoneCompanionDevices = getCompanionDevices(config)
            .map(candidate => candidate.id === revokeId ? { ...candidate, revoked: true } : candidate);
          return config;
        });
        sendJson(res, 200, { success: true, revoked: revokeId });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/devices/revoke-all') {
        await updateAppConfig(config => {
          config.phoneCompanionDevices = getCompanionDevices(config)
            .map(candidate => ({ ...candidate, revoked: true }));
          return config;
        });
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
        const incomingEndpoint = String(body.subscription.endpoint || '');
        const currentDevice = getCompanionDevices(readAppConfig()).find(candidate => candidate.id === device.id) || device;
        const invalidatedEndpoint = String(currentDevice.invalidatedPushEndpoint || '');
        const currentEndpoint = String(currentDevice.pushSubscription && currentDevice.pushSubscription.endpoint || '');
        const subscriptionNeedsRefresh = currentDevice.pushSubscriptionNeedsRefresh === true
          || (!!currentDevice.pushSubscription && !currentDevice.pushSubscriptionSavedAt);
        const knownEndpoint = invalidatedEndpoint || currentEndpoint;
        if (subscriptionNeedsRefresh
            && knownEndpoint
            && incomingEndpoint === knownEndpoint
            && body.refreshed !== true) {
          sendJson(res, 409, {
            success: false,
            code: 'PUSH_SUBSCRIPTION_REFRESH_REQUIRED',
            error: 'The previous push subscription expired and must be renewed.'
          });
          return;
        }
        const pendingNotification = currentDevice.pendingPushNotification
          && Date.parse(currentDevice.pendingPushNotification.expiresAt || '') > Date.now()
          ? currentDevice.pendingPushNotification
          : null;
        await updateAppConfig(config => {
          config.phoneCompanionDevices = getCompanionDevices(config).map(candidate => (
            candidate.id === device.id
              ? {
                  ...candidate,
                  pushSubscription: body.subscription,
                  pushSubscriptionSavedAt: new Date().toISOString(),
                  pushSubscriptionNeedsRefresh: false,
                  invalidatedPushEndpoint: '',
                  pushSubscriptionInvalidatedAt: '',
                  pendingPushNotification: pendingNotification || null
                }
              : candidate
          ));
          return config;
        });
        let replayedNotification = false;
        if (pendingNotification) {
          const replay = await notifyPhoneDevice(
            device.id,
            pendingNotification.title,
            pendingNotification.body,
            pendingNotification.context || {}
          );
          replayedNotification = !!(replay && replay.success);
          if (replayedNotification) {
            await updateAppConfig(config => {
              config.phoneCompanionDevices = getCompanionDevices(config).map(candidate => (
                candidate.id === device.id
                  ? { ...candidate, pendingPushNotification: null }
                  : candidate
              ));
              return config;
            });
          }
        }
        sendJson(res, 200, { success: true, replayedNotification });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        try {
          const state = await getCompanionStateSnapshot(device.selectedConversationId, { allowStale: true });
          if (state && state.conversationId && state.conversationId !== device.selectedConversationId) {
            setCompanionDeviceSelection(device, state.conversationId);
            await saveCompanionDeviceSelection(device);
          }
          sendJson(res, 200, { success: true, device: companionDevicePublic(device), ...state });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to get state' });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/preview') {
        try {
          const state = await getCompanionStateSnapshot(device.selectedConversationId, { allowStale: true });
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
        let pushInFlight = false;
        let pushAgain = false;
        let forceNextPush = false;
        let pingInterval = null;
        const pushState = async (options = {}) => {
          if (closed) return;
          // A running agent can persist several times while one renderer snapshot is still being
          // assembled. Previously every notification launched another executeJavaScript call,
          // producing an unbounded queue of increasingly stale phone states. Coalesce that burst
          // into the current snapshot plus, at most, one fresh follow-up snapshot.
          if (pushInFlight) {
            pushAgain = true;
            if (options.force) forceNextPush = true;
            return;
          }
          pushInFlight = true;
          if (options.force) forceNextPush = true;
          try {
            do {
              pushAgain = false;
              const forceRefresh = forceNextPush;
              forceNextPush = false;
              const currentConfig = readAppConfig();
              const currentDevice = getCompanionDevices(currentConfig).find(d => d.id === device.id) || device;
              const targetId = currentDevice.selectedConversationId;
              const state = await getCompanionStateSnapshot(targetId, { force: forceRefresh });
              if (closed) return;
              const payload = { success: true, device: companionDevicePublic(currentDevice), ...state };
              const signature = JSON.stringify(payload);
              if (signature !== lastSignature) {
                lastSignature = signature;
                res.write(`data: ${signature}\n\n`);
              }
            } while (pushAgain && !closed);
          } catch (e) {
            if (!closed) res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
          } finally {
            pushInFlight = false;
          }
        };
        // Register before the first snapshot is assembled, not after. getPhoneCompanionState()
        // awaits into the renderer and can take a while; a message that finishes processing and
        // calls triggerCompanionSync() during that window must still reach this connection. If
        // registration happened after the initial `await pushState()` (as it used to), a sync
        // that lands in that window iterates activeSseTriggers, does not find this connection yet,
        // and the update is silently dropped -- the phone shows nothing new until some unrelated
        // later event happens to trigger another push, or the app is closed and reopened. Pushing
        // first means a concurrent triggerCompanionSync() call reaches the already-registered
        // pushState(), which is mid-flight and simply sets pushAgain (see below), so the in-flight
        // call loops once more and delivers the fresh state before this request's first frame ever
        // reaches the phone.
        activeSseTriggers.push(pushState);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (pingInterval) clearInterval(pingInterval);
          activeSseTriggers = activeSseTriggers.filter(fn => fn !== pushState);
        };
        // A suspended mobile browser can abandon this fetch while the initial renderer snapshot
        // is still pending. Cleanup must be active before that await or dead streams keep receiving
        // sync triggers and multiply the renderer work that delayed reconnection in the first place.
        req.once('aborted', cleanup);
        res.once('close', cleanup);
        await pushState();
        if (closed) return;
        // Keepalive ping every 20s — Android Chrome drops idle SSE connections without it
        pingInterval = setInterval(() => {
          if (!closed) res.write(': ping\n\n');
        }, 20000);
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
        const selectionRevision = setCompanionDeviceSelection(device, targetId, { forceRevision: true });
        await saveCompanionDeviceSelection(device);
        sendJson(res, 200, { success: true, conversationId: targetId, selectionRevision });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/new-focus') {
        const targetId = String(device.selectedConversationId || '');
        if (!targetId) {
          sendJson(res, 200, { success: true, cancelled: [], count: 0, conversationId: '' });
          return;
        }
        try {
          // The renderer scopes cancellation to tasks owned by this conversation. Do not accept a
          // caller-provided conversation id here: a paired phone may only abandon its own focus.
          const result = await callRendererFunction('beginNewFocus', targetId);
          triggerCompanionSync();
          sendJson(res, 200, { success: true, conversationId: targetId, ...result });
        } catch (e) {
          sendJson(res, 500, { success: false, error: e.message || 'Failed to start a new focus' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations/new') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await callRendererFunction('startPhoneCompanionTask', body);
        if (result && result.success && result.conversationId) {
          setCompanionDeviceSelection(device, result.conversationId, { forceRevision: true });
          await saveCompanionDeviceSelection(device);
        }
        sendJson(res, 200, {
          success: true,
          ...result,
          selectionRevision: Math.max(0, Number(device.selectionRevision) || 0)
        });
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
          setCompanionDeviceSelection(device, '', { forceRevision: true });
          await saveCompanionDeviceSelection(device);
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
        if (!String(body.conversationId || '').trim()) {
          sendJson(res, 409, {
            success: false,
            error: 'No visible conversation was supplied for this prompt. Reopen the conversation and try again.'
          });
          return;
        }
        const scope = resolveCompanionActionConversation(
          device,
          body.conversationId,
          body.selectionRevision
        );
        if (!scope.success) {
          sendJson(res, scope.statusCode, scope);
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
        const requestedMode = String(body.mode || '').trim().toLowerCase();
        const result = await callRendererFunction('submitPhoneCompanionPrompt', {
          prompt: finalPrompt,
          conversationId: scope.conversationId,
          projectPath: String(body.projectPath || '').trim(),
          dispatchProjectPath: String(body.dispatchProjectPath || '').trim(),
          contextSummary: String(body.contextSummary || '').trim(),
          mode: requestedMode === 'orion' || specialistRegistry.has(requestedMode) ? requestedMode : 'orion',
          requestId: String(body.requestId || '').trim(),
          imageData,
          imageMimeType
        });
        if (result && result.success !== false && result.conversationId && result.conversationId !== device.selectedConversationId) {
          setCompanionDeviceSelection(device, result.conversationId);
          await saveCompanionDeviceSelection(device);
        }
        sendJson(res, 200, {
          success: true,
          ...result,
          selectionRevision: Math.max(0, Number(device.selectionRevision) || 0)
        });
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

      if (req.method === 'GET' && url.pathname === '/api/chat-image') {
        const requestedConversationId = url.searchParams.get('conversationId') || '';
        const imagePath = url.searchParams.get('path') || '';
        if (!requestedConversationId) {
          sendJson(res, 400, { success: false, error: 'Missing conversation id.' });
          return;
        }
        if (!imagePath) {
          sendJson(res, 400, { success: false, error: 'Missing image path.' });
          return;
        }
        // Unlike steer/approve-plan, this is a passive read of an already-attached image, not an
        // action that could race a changed phone view - resolveCompanionActionConversation's
        // "matches the currently selected conversation" rule does not apply here. An image
        // attachment request can outlive a phone navigation or state refresh, so a legitimate
        // request may name a conversation other than the one currently selected. Requiring them
        // to match rejected an otherwise valid in-flight image with a permanent 409. The device is
        // already authenticated above, and readChatImageForPhone independently verifies both that
        // this exact conversation exists and that this exact path is actually attached to one of
        // its messages, so the real authorization boundary is preserved without the stale-view
        // check. For a relayed specialist image, the containing Dispatch transcript authorizes the
        // attachment; sourceConversationId remains provenance used by the file reader.
        const result = await callRendererFunction('readChatImageForPhone', {
          conversationId: requestedConversationId,
          path: imagePath
        });
        if (!result || !result.success || !result.data || !String(result.mimeType || '').startsWith('image/')) {
          sendJson(res, 404, { success: false, error: (result && result.error) || 'Image not found.' });
          return;
        }
        const buffer = Buffer.from(result.data, 'base64');
        res.writeHead(200, {
          'Content-Type': result.mimeType,
          'Content-Length': buffer.length,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(buffer);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/approve-plan') {
        try {
          const bodyText = await readRequestBody(req);
          const body = bodyText ? JSON.parse(bodyText) : {};
          const scope = resolveCompanionActionConversation(device, body.conversationId);
          if (!scope.success) {
            sendJson(res, scope.statusCode, scope);
            return;
          }
          const result = await callRendererFunction('approvePhoneCompanionPlan', scope.conversationId);
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
				if (!String(body.conversationId || '').trim()) {
					sendJson(res, 409, { success: false, error: 'No visible conversation was supplied for this steering update.' });
					return;
				}
				const scope = resolveCompanionActionConversation(device, body.conversationId, body.selectionRevision);
				if (!scope.success) {
					sendJson(res, scope.statusCode, scope);
					return;
				}
				const result = await callRendererFunction('steerPhoneCompanionTask', { prompt: String(body.prompt || body.feedback || '').trim(), conversationId: scope.conversationId });
				sendJson(res, 200, { success: true, ...result });
			} catch (e) {
				sendJson(res, 500, { success: false, error: e.message || 'Failed to send feedback' });
			}
			return;
		}

      if (req.method === 'POST' && url.pathname === '/api/deny-plan') {
        try {
          const bodyText = await readRequestBody(req);
          const body = bodyText ? JSON.parse(bodyText) : {};
          const scope = resolveCompanionActionConversation(device, body.conversationId);
          if (!scope.success) {
            sendJson(res, scope.statusCode, scope);
            return;
          }
          const result = await callRendererFunction('denyPhoneCompanionPlan', scope.conversationId);
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
        const scope = resolveCompanionActionConversation(device, body.conversationId);
        if (!scope.success) {
          sendJson(res, scope.statusCode, scope);
          return;
        }
        const result = await callRendererFunction('revisePhoneCompanionPlan', { feedback: String(body.feedback || '').trim(), conversationId: scope.conversationId });
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
        const reasoning = String(body.reasoning || '').trim();
        if (!model && !reasoning) { sendJson(res, 400, { success: false, error: 'Missing model or reasoning' }); return; }
        // Either field may arrive alone; both selections live on the desktop renderer, which
        // owns persistence, so the phone and desktop pickers always agree.
        let result = { success: true };
        if (model) result = await callRendererFunction('setPhoneCompanionModel', model);
        if (reasoning && result && result.success !== false) {
          const reasoningResult = await callRendererFunction('setPhoneCompanionReasoning', reasoning);
          result = { ...result, ...reasoningResult };
        }
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

  return new Promise((resolve, reject) => {
    const server = shared.companionServer;
    const handleStartupError = (error) => {
      console.error('Phone companion server failed to start:', error);
      if (shared.companionServer === server) shared.companionServer = null;
      reject(error);
    };
    server.once('error', handleStartupError);
    server.listen(port, host, () => {
      server.removeListener('error', handleStartupError);
      server.on('error', (error) => console.error('Phone companion server failed:', error));
    const address = enableCompanion ? getLocalWifiAddress() : '127.0.0.1';
    const url = `http://${address}:${port}/?pair=${encodeURIComponent(pairingCode)}`;
    console.log(`Orion phone companion listening at ${url} (Host: ${host})`);
    const pairingAnnouncementTimer = setTimeout(async () => {
      if (shared.mainWindow && !shared.mainWindow.isDestroyed()) {
        try {
          const currentConfig = readAppConfig();
          const secureOrigin = await resolveCompanionHttpsOrigin(currentConfig, port);
          const secureOriginReachable = await verifyCompanionHttpsOrigin(secureOrigin);
          const payload = await buildCompanionPairingAnnouncement({
            address,
            port,
            pairingCode,
            expiresAt: currentConfig.phoneCompanionPairingExpiresAt || '',
            secureOrigin,
            secureOriginReachable
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
      resolve({ address, port, url });
    });
  });
}

// ── Phone companion startup retry ──────────────────────────────────────────────
// startPhoneCompanionServer() used to be tried exactly once, at app launch. If server.listen()
// failed — most plausibly EADDRINUSE from a process left over after a crash (the crash log shows
// real render-process-gone and child-process-gone events on this same install) — the companion
// stayed down for the rest of the session with only a one-time desktop notification. Nothing ever
// tried again, so the only recovery was a full app restart. This retries the fast path a few
// times (a stale holder can release the port within seconds), then keeps retrying quietly in the
// background so the companion recovers on its own once the port frees up.
const COMPANION_STARTUP_FAST_RETRY_DELAYS_MS = [1000, 3000, 8000];
const COMPANION_STARTUP_BACKGROUND_RETRY_MS = 60000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startPhoneCompanionServerWithRetry(options = {}) {
  const onFailure = typeof options.onFailure === 'function' ? options.onFailure : () => {};
  const onRecovered = typeof options.onRecovered === 'function' ? options.onRecovered : () => {};
  const fastRetryDelaysMs = Array.isArray(options.fastRetryDelaysMs)
    ? options.fastRetryDelaysMs : COMPANION_STARTUP_FAST_RETRY_DELAYS_MS;
  const backgroundRetryMs = Number(options.backgroundRetryMs) > 0
    ? Number(options.backgroundRetryMs) : COMPANION_STARTUP_BACKGROUND_RETRY_MS;

  let lastError = null;
  for (let attempt = 0; attempt <= fastRetryDelaysMs.length; attempt++) {
    try {
      return await startPhoneCompanionServer();
    } catch (error) {
      lastError = error;
      const delay = fastRetryDelaysMs[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }

  // Fast retries exhausted. Tell the caller once, then keep trying quietly in the background — a
  // stale process holding the port can release it minutes later for reasons that have nothing to
  // do with Orion (the user closing it, Windows reclaiming the handle, etc.), and the companion
  // should come back on its own rather than requiring a restart.
  onFailure(lastError);
  const backgroundTimer = setInterval(async () => {
    try {
      const result = await startPhoneCompanionServer();
      clearInterval(backgroundTimer);
      onRecovered(result);
    } catch (_) { /* still down; the next tick tries again */ }
  }, backgroundRetryMs);
  if (typeof backgroundTimer.unref === 'function') backgroundTimer.unref();

  return { success: false, retrying: true, error: lastError && lastError.message };
}

async function enablePhoneCompanionLanMode() {
  const config = readAppConfig();
  config.enablePhoneCompanion = true;
  await writeAppConfig(config);
  await stopPhoneCompanionServer();
  await startPhoneCompanionServer();
  return await getPhoneCompanionPairingPayload();
}

async function getPhoneCompanionPairingPayload() {
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 45678);
  const enableCompanion = config.enablePhoneCompanion !== false;
  const address = enableCompanion ? getLocalWifiAddress() : '127.0.0.1';
  const pairingCode = await ensureCompanionPairingCode(config);
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
  const secureOrigin = await resolveCompanionHttpsOrigin(latestConfig, port);
  const secureOriginReachable = await verifyCompanionHttpsOrigin(secureOrigin);
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
      secureOrigin,
      secureOriginReachable
    }))
  };
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain, deps = {}) {
  const Notification = deps.Notification;

  ipcMain.handle('get-phone-companion-pairing', async () => getPhoneCompanionPairingPayload());

  ipcMain.handle('enable-phone-companion-lan', async () => enablePhoneCompanionLanMode());

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
    await updateAppConfig(latest => {
      latest.phoneCompanionDevices = getCompanionDevices(latest)
        .map(device => device.id === targetId ? { ...device, revoked: true } : device);
      return latest;
    });
    triggerCompanionSync();
    return { success: true, revoked: targetId };
  });

  ipcMain.handle('revoke-all-phone-companion-devices', async () => {
    await updateAppConfig(config => {
      config.phoneCompanionDevices = getCompanionDevices(config)
        .map(device => ({ ...device, revoked: true }));
      return config;
    });
    triggerCompanionSync();
    return { success: true, revokedAll: true };
  });

  ipcMain.handle('notify-phone', async (event, { title, body, conversationId } = {}) => {
    const normalizedTitle = String(title || 'Orion AI');
    const normalizedBody = String(body || '');
    const normalizedContext = { conversationId: String(conversationId || '') };
    const desktop = notifyDesktop(Notification, normalizedTitle, normalizedBody);
    const phone = await notifyAllPhoneDevices(normalizedTitle, normalizedBody, normalizedContext);
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
  startPhoneCompanionServerWithRetry,
  getLocalWifiAddress,
  enablePhoneCompanionLanMode,
  getPhoneCompanionPairingPayload,
  buildCompanionPairingAnnouncement,
  findExistingTailscaleHttpsOrigin,
  resolveCompanionHttpsOrigin,
  getVerifiedTailscaleIdentity,
  recoverCompanionDeviceSession,
  ensureCompanionToken,
  triggerCompanionSync,
  callRendererFunction,
  ensureVapidInitialized,
  notifyDesktop,
  notifyPhoneDevice,
  notifyAllPhoneDevices,
  ensureTailscaleServeRoute,
  diagnoseTailscaleHttps,
  runTailscaleCommand
};
