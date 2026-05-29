const test = require('tape');
const http = require('http');
const proxyquire = require('proxyquire').noPreserveCache();

function request(method, port, path, body, session) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      method,
      hostname: '127.0.0.1',
      port,
      path,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(session ? { Authorization: `Bearer ${session.secret}`, 'X-Orion-Device-Id': session.deviceId } : {})
      }
    }, (res) => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ statusCode: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeFsMock(config) {
  let temp = '';
  return {
    existsSync: () => true,
    readFileSync: () => JSON.stringify(config),
    writeFileSync: (p, content) => { temp = content; },
    renameSync: () => { config = JSON.parse(temp); },
    unlinkSync: () => {},
    _config: () => config
  };
}

function makeElectronMock(handlers = {}) {
  const calls = [];
  return {
    calls,
    mock: {
      app: {
        whenReady: () => ({ then: (cb) => { cb(); } }),
        on: () => {}
      },
      BrowserWindow: class {
        constructor() {
          this.webContents = {
            executeJavaScript: async (script) => {
              calls.push(script);
              if (script.includes('approvePhoneCompanionPairing')) return handlers.pairingApproval || { approved: true };
              if (script.includes('getPhoneCompanionState')) return handlers.state || {
                conversationId: 'conv1',
                title: 'Task One',
                conversations: [{ id: 'conv1', title: 'Task One', active: true }],
                tasks: [{ title: 'Build', status: 'in-progress' }],
                messages: [],
                latestOutput: 'latest',
                preview: {
                  latestAssistantOutput: 'latest',
                  workWalkthrough: 'Done: test',
                  changedFiles: ['app.js'],
                  testResults: ['npm test passed'],
                  appLaunchUrl: 'http://localhost:3000'
                }
              };
              if (script.includes('switchPhoneCompanionConversation')) return { success: true, conversationId: 'conv2' };
              if (script.includes('startPhoneCompanionTask')) return { success: true, conversationId: 'new' };
              if (script.includes('submitPhoneCompanionPrompt')) return { success: true, queued: false };
              if (script.includes('steerPhoneCompanionTask')) return { success: true, steered: true };
              if (script.includes('approvePhoneCompanionPlan')) return { success: true, queued: false };
              if (script.includes('denyPhoneCompanionPlan')) return { success: true, denied: true };
              if (script.includes('revisePhoneCompanionPlan')) return { success: true, queued: true };
              if (script.includes('stopPhoneCompanionTask')) return { success: true, stopped: true };
              if (script.includes('resumePhoneCompanionTask')) return { success: true, queued: true };
              return { success: true };
            },
            send: () => {}
          };
        }
        loadFile() {}
        isDestroyed() { return false; }
        static getAllWindows() { return []; }
      },
      ipcMain: {
        on: () => {},
        handle: () => {}
      },
      dialog: {}
    }
  };
}

async function startMainWithConfig(port, config, handlers) {
  const fsMock = makeFsMock({
    enablePhoneCompanion: false,
    phoneCompanionPort: port,
    phoneCompanionPairingCode: 'pair-code-123456',
    phoneCompanionPairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    phoneCompanionDevices: [],
    ...config
  });
  const electron = makeElectronMock(handlers);
  const osMock = {
    networkInterfaces: () => ({
      WiFi: [{ family: 'IPv4', internal: false, address: '192.168.50.25' }],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
    })
  };
  const main = proxyquire('../main.js', { electron: electron.mock, fs: fsMock, os: osMock });
  main.resetCompanionServer();
  main.startPhoneCompanionServer();
  await new Promise(resolve => setTimeout(resolve, 150));
  return { main, fsMock, electron };
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

test('Phone Companion v2 serves pairing shell but protects APIs', async (t) => {
  const { main } = await startMainWithConfig(1131);

  const root = await request('GET', 1131, '/');
  t.equal(root.statusCode, 200, 'root shell is available without token-in-URL auth');
  t.notOk(root.text.includes('phoneCompanionToken'), 'root shell does not expose legacy token');

  const manifest = await request('GET', 1131, '/manifest.webmanifest');
  t.equal(manifest.statusCode, 200, 'manifest is available without token query string');

  const state = await request('GET', 1131, '/api/state');
  t.equal(state.statusCode, 401, 'state API rejects unpaired phones');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion startup announcement uses pairing QR metadata, not legacy token URL', async (t) => {
  const { main, electron } = await startMainWithConfig(1135);
  await new Promise(resolve => setTimeout(resolve, 2800));

  const announcement = electron.calls.find(call => call.includes('showPhoneCompanionPairingCard'));
  t.ok(announcement, 'startup uses structured pairing card renderer');
  t.notOk(electron.calls.some(call => call.includes('appendSystemMessage') && call.includes('Phone Companion')), 'startup does not use legacy appendSystemMessage announcement');
  t.notOk(announcement.includes('?token='), 'announcement does not include legacy token URL');
  t.ok(announcement.includes('?pair='), 'announcement includes short-lived pair URL');
  t.ok(announcement.includes('qrSvg'), 'announcement includes QR SVG metadata');
  t.ok(announcement.includes("dedupeKey: 'phone-companion-pairing'"), 'announcement carries stable pairing dedupe metadata');

  const payload = await main.buildCompanionPairingAnnouncement({
    address: '127.0.0.1',
    port: 1135,
    pairingCode: 'pair-code-123456',
    expiresAt: new Date(Date.now() + 60000).toISOString()
  });
  t.notOk(payload.pairUrl.includes('?token='), 'pairing payload never exposes token URL');
  t.ok(payload.pairUrl.includes('?pair='), 'pairing payload exposes pair URL');
  t.ok(payload.qrSvg.includes('<svg'), 'pairing payload contains scannable QR SVG');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion pairing payload is available through IPC for top-bar button startup', async (t) => {
  const { main } = await startMainWithConfig(1136);
  const payload = await main.getPhoneCompanionPairingForTest();
  t.equal(payload.success, true, 'IPC pairing payload succeeds');
  t.equal(payload.networkEnabled, false, 'initial top-bar payload does not pretend localhost is phone-reachable');
  t.notOk(payload.pairUrl, 'disabled LAN payload does not expose a localhost QR URL');
  await closeServer(main.getCompanionServer());
});

test('Phone Companion button enables LAN server before returning QR pairing URL', async (t) => {
  const { main, fsMock } = await startMainWithConfig(1137, { enablePhoneCompanion: false });
  t.equal(main.getCompanionServer().address().address, '127.0.0.1', 'server starts localhost-only by default');

  const payload = await main.enablePhoneCompanionLanMode();
  await new Promise(resolve => setTimeout(resolve, 150));
  const serverAddress = main.getCompanionServer().address();

  t.equal(fsMock._config().enablePhoneCompanion, true, 'button action persists LAN companion mode');
  t.equal(serverAddress.address, '0.0.0.0', 'button action restarts server on all interfaces');
  t.equal(payload.networkEnabled, true, 'enabled payload is marked network reachable');
  t.ok(payload.pairUrl.includes('http://192.168.50.25:1137/?pair='), 'enabled payload uses Wi-Fi address');
  t.notOk(payload.pairUrl.includes('?token='), 'enabled payload still does not expose token URL');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 pairing creates reusable sessions and revoked sessions lose access', async (t) => {
  const { main, fsMock } = await startMainWithConfig(1132);

  const pair = await request('POST', 1132, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'Pixel' });
  t.equal(pair.statusCode, 200, 'pairing succeeds after desktop approval');
  t.ok(pair.json.device.id, 'pairing returns device id');
  t.ok(pair.json.sessionSecret, 'pairing returns persistent session secret');
  t.equal(fsMock._config().phoneCompanionDevices.length, 1, 'approved device is stored');

  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };
  const state = await request('GET', 1132, '/api/state', null, session);
  t.equal(state.statusCode, 200, 'paired session can access state');

  const reused = await request('GET', 1132, '/api/state', null, session);
  t.equal(reused.statusCode, 200, 'paired session survives reload/reuse');

  const revoke = await request('POST', 1132, '/api/devices/revoke', { deviceId: session.deviceId }, session);
  t.equal(revoke.statusCode, 200, 'desktop/device revoke endpoint revokes device');

  const revoked = await request('GET', 1132, '/api/state', null, session);
  t.equal(revoked.statusCode, 401, 'revoked session cannot access state');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 task controls and preview endpoints reach desktop bridge', async (t) => {
  const { main, electron } = await startMainWithConfig(1133);
  const pair = await request('POST', 1133, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const switchRes = await request('POST', 1133, '/api/conversations/switch', { conversationId: 'conv2' }, session);
  t.equal(switchRes.statusCode, 200, 'task switching endpoint succeeds');

  const newTask = await request('POST', 1133, '/api/conversations/new', { prompt: 'new task' }, session);
  t.equal(newTask.statusCode, 200, 'new task endpoint succeeds');

  const prompt = await request('POST', 1133, '/api/prompt', { prompt: 'hello' }, session);
  t.equal(prompt.statusCode, 200, 'prompt submission succeeds');

  const steer = await request('POST', 1133, '/api/steer', { prompt: 'focus here' }, session);
  t.equal(steer.statusCode, 200, 'steering endpoint succeeds');

  const approve = await request('POST', 1133, '/api/approve-plan', {}, session);
  const deny = await request('POST', 1133, '/api/deny-plan', {}, session);
  const revise = await request('POST', 1133, '/api/revise-plan', { feedback: 'revise' }, session);
  t.equal(approve.statusCode, 200, 'plan approval succeeds');
  t.equal(deny.statusCode, 200, 'plan denial succeeds');
  t.equal(revise.statusCode, 200, 'plan revision succeeds');

  const stop = await request('POST', 1133, '/api/stop', {}, session);
  const resume = await request('POST', 1133, '/api/resume', {}, session);
  t.equal(stop.statusCode, 200, 'stop/pause succeeds');
  t.equal(resume.statusCode, 200, 'resume succeeds');

  const preview = await request('GET', 1133, '/api/preview', null, session);
  t.deepEqual(preview.json.preview.changedFiles, ['app.js'], 'preview exposes changed files');
  t.equal(preview.json.preview.appLaunchUrl, 'http://localhost:3000', 'preview exposes app launch URL');

  t.ok(!electron.calls.some(call => call.includes('switchPhoneCompanionConversation')), 'desktop bridge no longer switches global active conversation task');
  t.ok(electron.calls.some(call => call.includes('submitPhoneCompanionPrompt')), 'desktop bridge submitted prompt');
  t.ok(electron.calls.some(call => call.includes('approvePhoneCompanionPlan')), 'desktop bridge approved plan');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion LAN mode remains disabled by default', async (t) => {
  const { main } = await startMainWithConfig(1134, { enablePhoneCompanion: false });
  const server = main.getCompanionServer();
  const address = server.address();
  t.equal(address.address, '127.0.0.1', 'server binds localhost when companion LAN mode is disabled');
  await closeServer(server);
});
