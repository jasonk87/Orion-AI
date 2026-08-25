process.env.NODE_ENV = 'test';

// Characterizes and covers the fix for: a failed Tailscale serve route (cert provisioning stuck,
// tailscaled down, a transient CLI hiccup, etc.) used to only ever reach crash.log via
// recordSwallowedFault — nothing told the user their phone push notifications / off-network
// pairing had silently degraded to LAN-only. See main.js's ensureTailscaleServeRouteWithRetry.

const test = require('tape');
const os = require('os');
const proxyquire = require('proxyquire').noPreserveCache();
const realIpcServer = require('../lib/ipc-server');

function loadMain({ config, ensureTailscaleServeRoute }) {
  const configData = { phoneCompanionPort: 45678, ...config };
  const notifications = [];
  class NotificationMock {
    static isSupported() { return true; }
    constructor(payload) { this.payload = payload; notifications.push(payload); }
    show() { this.shown = true; }
  }
  const electronMock = {
    app: {
      whenReady: () => ({ then: (cb) => { cb(); } }),
      on: () => {},
      setAppUserModelId: () => {},
      getPath: () => os.tmpdir(),
      isPackaged: false
    },
    Notification: NotificationMock,
    BrowserWindow: class {
      constructor() { this.webContents = { executeJavaScript: async () => null, send: () => {} }; }
      loadFile() {}
      on() {}
      isDestroyed() { return false; }
      static getAllWindows() { return []; }
    },
    ipcMain: { on: () => {}, handle: () => {} }
  };
  const configMock = {
    readAppConfig: () => ({ ...configData }),
    writeAppConfig: (cfg) => { Object.assign(configData, cfg); },
    updateAppConfig: async (mutator) => { Object.assign(configData, mutator({ ...configData }) || {}); return { ...configData }; },
    atomicWriteFileSync: require('fs').writeFileSync,
    '@global': true,
    '@noCallThru': true
  };
  const ipcServerStub = {
    ...realIpcServer,
    ensureTailscaleServeRoute: ensureTailscaleServeRoute || realIpcServer.ensureTailscaleServeRoute
  };
  const main = proxyquire('../main.js', {
    electron: electronMock,
    './lib/config': configMock,
    './lib/ipc-server': ipcServerStub
  });
  return { main, notifications };
}

test('FIX: a persistently failing, opted-in Tailscale route retries then notifies the user', async (t) => {
  let calls = 0;
  const { main, notifications } = loadMain({
    config: { phoneCompanionHttpsOrigin: 'https://desktop-test.tailnet.ts.net' },
    ensureTailscaleServeRoute: async () => {
      calls += 1;
      return { applied: false, reason: 'tailscale cert failed: HTTPS certificates are not enabled for this tailnet' };
    }
  });

  const result = await main.ensureTailscaleServeRouteWithRetry({ retryDelaysMs: [10, 10] });

  t.equal(calls, 3, 'retries twice after the first failure (3 attempts total) before giving up');
  t.equal(result.applied, false, 'still reports the failure to the caller');
  t.equal(notifications.length, 1, 'the user is notified exactly once after retries are exhausted');
  t.ok(/tailscale/i.test(notifications[0].title), 'the notification names the Tailscale route as the problem');
  t.ok(/certificates are not enabled/i.test(notifications[0].body), 'the real diagnosis is carried through to the user, not a generic message');
  t.end();
});

test('FIX: a route that recovers on retry never bothers the user', async (t) => {
  let calls = 0;
  const { main, notifications } = loadMain({
    config: { phoneCompanionHttpsOrigin: 'https://desktop-test.tailnet.ts.net' },
    ensureTailscaleServeRoute: async () => {
      calls += 1;
      if (calls < 2) return { applied: false, reason: 'tailscale serve timed out' };
      return { applied: true, origin: 'https://desktop-test.tailnet.ts.net', target: 'http://127.0.0.1:45678' };
    }
  });

  const result = await main.ensureTailscaleServeRouteWithRetry({ retryDelaysMs: [10, 10] });

  t.equal(result.applied, true, 'succeeds once the transient failure clears on retry');
  t.equal(notifications.length, 0, 'no notification fires when a retry recovers the route');
  t.end();
});

test('FIX: an unconfigured (opted-out) origin is never retried or surfaced as a failure', async (t) => {
  let calls = 0;
  const { main, notifications } = loadMain({
    config: {}, // no phoneCompanionHttpsOrigin — the majority-case, unopted-in install
    ensureTailscaleServeRoute: async () => {
      calls += 1;
      return { applied: false, reason: 'no phoneCompanionHttpsOrigin configured' };
    }
  });

  const result = await main.ensureTailscaleServeRouteWithRetry({ retryDelaysMs: [10, 10] });

  t.equal(calls, 1, 'a single attempt is made, with no retries wasted on an install that never opted in');
  t.equal(result.applied, false, 'reports the expected no-op result');
  t.equal(notifications.length, 0, 'an unconfigured origin never surfaces as a user-facing failure — it is normal, not broken');
  t.end();
});
