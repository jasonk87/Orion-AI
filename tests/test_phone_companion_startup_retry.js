process.env.NODE_ENV = 'test';

// Characterizes and covers the fix for: startPhoneCompanionServer() used to be tried exactly
// once at app launch. If server.listen() failed (most plausibly EADDRINUSE from a process left
// over after a crash), the companion stayed down for the rest of the session with only a
// one-time desktop notification — the only recovery was a full app restart. See main.js's
// app.whenReady() handler and lib/ipc-server.js's startPhoneCompanionServerWithRetry.

const test = require('tape');
const http = require('http');
const proxyquire = require('proxyquire').noPreserveCache();

function loadIpcServer(port, extraConfig) {
  const configData = {
    phoneCompanionPort: port,
    phoneCompanionPairingCode: 'pair-code-123456',
    phoneCompanionPairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    phoneCompanionDevices: [],
    enablePhoneCompanion: false, // bind 127.0.0.1 only — avoids LAN/firewall prompts in tests
    ...extraConfig
  };
  const configMock = {
    readAppConfig: () => ({ ...configData }),
    writeAppConfig: (cfg) => { Object.assign(configData, cfg); },
    updateAppConfig: async (mutator) => {
      Object.assign(configData, mutator({ ...configData }) || {});
      return { ...configData };
    },
    '@global': true,
    '@noCallThru': true
  };
  return proxyquire('../lib/ipc-server', { './config': configMock });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('CHAR: a single failed bind leaves the companion server down with no further attempt', async (t) => {
  const port = await getFreePort();
  const blocker = http.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', resolve);
  });

  const ipcServer = loadIpcServer(port);
  let threw = false;
  try {
    await ipcServer.startPhoneCompanionServer();
  } catch (error) {
    threw = true;
    t.ok(/EADDRINUSE|already in use/i.test(error.message || error.code || ''),
      'fails with the port-in-use error, exactly once, with nothing left retrying');
  }
  t.ok(threw, 'a single call rejects outright rather than retrying on its own — this is the bug main.js used to hit unguarded');

  await new Promise(resolve => blocker.close(resolve));
  await ipcServer.stopPhoneCompanionServer();
  t.end();
});

test('FIX: startPhoneCompanionServerWithRetry recovers automatically once a blocked port frees up', async (t) => {
  const port = await getFreePort();
  const blocker = http.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', resolve);
  });

  const ipcServer = loadIpcServer(port);
  let failureNotified = false;
  let recovered = null;

  const result = await ipcServer.startPhoneCompanionServerWithRetry({
    fastRetryDelaysMs: [40, 40], // keep the test fast; production uses longer real delays
    backgroundRetryMs: 150,
    onFailure: () => { failureNotified = true; },
    onRecovered: (payload) => { recovered = payload; }
  });

  t.equal(result.retrying, true, 'reports it is retrying in the background instead of giving up for the session');
  t.ok(failureNotified, 'the caller is told once, after the fast retries are exhausted');
  t.notOk(recovered, 'recovery has not happened yet — the blocker is still holding the port');

  // Release the port; the background retry loop should pick it up on its next tick, with no
  // app restart and no further action from the user.
  await new Promise(resolve => blocker.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 400));

  t.ok(recovered, 'the background retry loop recovers once the port frees up');
  t.equal(recovered.port, port, 'the recovered server is bound to the originally configured port');

  await ipcServer.stopPhoneCompanionServer();
  t.end();
});

test('FIX: startPhoneCompanionServerWithRetry succeeds immediately when the port is already free', async (t) => {
  const port = await getFreePort();
  const ipcServer = loadIpcServer(port);

  const result = await ipcServer.startPhoneCompanionServerWithRetry({
    fastRetryDelaysMs: [40],
    backgroundRetryMs: 150
  });

  t.ok(result && result.port === port, 'starts normally, with no retries needed, exactly like a plain startPhoneCompanionServer() call');
  await ipcServer.stopPhoneCompanionServer();
  t.end();
});
