process.env.NODE_ENV = 'test';

const test = require('tape');
const http = require('http');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const proxyquire = require('proxyquire').noPreserveCache();
const companionHtml = require('../lib/companion-html');

const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').replace(/\r\n/g, '\n');

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
        resolve({ statusCode: res.statusCode, headers: res.headers, text, json });
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
  const ipcHandlers = {};
  const notifications = [];
  class NotificationMock {
    static isSupported() { return handlers.desktopNotificationsSupported !== false; }
    constructor(payload) {
      this.payload = payload;
      notifications.push(payload);
    }
    show() {
      this.shown = true;
    }
  }
  return {
    calls,
    ipcHandlers,
    notifications,
    mock: {
      app: {
        whenReady: () => ({ then: (cb) => { cb(); } }),
        on: () => {},
        setAppUserModelId: () => {},
        getPath: () => require('os').tmpdir()
      },
      Notification: NotificationMock,
      BrowserWindow: class {
        constructor() {
          this.webContents = {
            executeJavaScript: async (script) => {
              calls.push(script);
              if (script.includes('approvePhoneCompanionPairing')) return handlers.pairingApproval || { approved: true };
              if (script.includes('getPhoneCompanionState')) {
                // stateProvider lets a test control timing/sequencing per call (e.g. to hold the
                // Nth call open until a concurrent triggerCompanionSync() has had a chance to fire,
                // reproducing races between a state change landing and an SSE connection assembling
                // its snapshot). Falls through to the static handlers.state used by most tests.
                if (typeof handlers.stateProvider === 'function') return handlers.stateProvider();
                return handlers.state || {
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
              }
              if (script.includes('switchPhoneCompanionConversation')) return { success: true, conversationId: 'conv2' };
              if (script.includes('startPhoneCompanionTask')) return { success: true, conversationId: 'new' };
              if (script.includes('beginNewFocus')) return handlers.newFocus || { cancelled: ['task-pending'], count: 1 };
              if (script.includes('submitPhoneCompanionPrompt')) return { success: true, queued: false };
              if (script.includes('steerPhoneCompanionTask')) return { success: true, steered: true };
              if (script.includes('approvePhoneCompanionPlan')) return { success: true, queued: false };
              if (script.includes('denyPhoneCompanionPlan')) return { success: true, denied: true };
              if (script.includes('revisePhoneCompanionPlan')) return { success: true, queued: true };
              if (script.includes('submitPhoneCompanionClarification')) return handlers.clarificationSubmit || { success: true, queued: false };
              if (script.includes('stopPhoneCompanionTask')) return { success: true, stopped: true };
              if (script.includes('resumePhoneCompanionTask')) return { success: true, queued: true };
              if (script.includes('discoverPhoneCompanionSkills')) return handlers.skills || { skills: [{ name: 'demo-skill', description: 'demo' }], count: 1 };
              if (script.includes('runPhoneCompanionSkill')) return handlers.skillRun || { success: true, outputs: { ok: true } };
              if (script.includes('readChatImageForPhone')) return handlers.chatImage || {
                success: true,
                data: Buffer.from('phone-image').toString('base64'),
                mimeType: 'image/png'
              };
              return { success: true };
            },
            send: () => {}
          };
        }
        loadFile() {}
        on() {}
        isDestroyed() { return false; }
        static getAllWindows() { return []; }
      },
      ipcMain: {
        on: () => {},
        handle: (channel, fn) => {
          ipcHandlers[channel] = fn;
        }
      },
      dialog: {}
    }
  };
}

async function startMainWithConfig(port, config, handlers) {
  const configData = {
    phoneCompanionPort: port,
    phoneCompanionPairingCode: 'pair-code-123456',
    phoneCompanionPairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    phoneCompanionDevices: [],
    ...config
  };
  // fsMock kept for backward-compat with test assertions that call fsMock._config()
  const fsMock = { _config: () => configData };
  // Use a global config stub so readAppConfig/writeAppConfig in all modules (including
  // ipc-server.js) use the in-memory configData rather than the real config file.
  const configMock = {
    readAppConfig: () => ({ ...configData }),
    writeAppConfig: (cfg) => { Object.assign(configData, cfg); },
    updateAppConfig: async (mutator) => {
      const updated = mutator({ ...configData });
      Object.assign(configData, updated || {});
      return { ...configData };
    },
    atomicWriteFileSync: require('fs').writeFileSync,
    getConfigPath: () => require('path').join(require('os').tmpdir(), 'orion-config-test.json'),
    '@global': true,
    '@noCallThru': true
  };
  const electron = makeElectronMock(handlers);
  const webPushCalls = [];
  const webPushMock = handlers && handlers.webPush ? handlers.webPush : {
    generateVAPIDKeys: () => ({ publicKey: 'test-public-key', privateKey: 'test-private-key' }),
    setVapidDetails: (mailto, publicKey, privateKey) => {
      webPushCalls.push({ type: 'setVapidDetails', mailto, publicKey, privateKey });
    },
    sendNotification: async (subscription, payload) => {
      webPushCalls.push({ type: 'sendNotification', subscription, payload });
    },
    '@global': true,
    '@noCallThru': true
  };
  // Make the os mock global so ipc-server.js uses the controlled network address.
  const osMock = {
    networkInterfaces: () => ({
      WiFi: [{ family: 'IPv4', internal: false, address: '192.168.50.25' }],
      ...(handlers && handlers.tailscaleAddress
        ? { Tailscale: [{ family: 'IPv4', internal: false, address: handlers.tailscaleAddress }] }
        : {}),
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
    }),
    homedir: require('os').homedir,
    tmpdir: require('os').tmpdir,
    '@global': true
  };
  const httpsMock = {
    get: (url, options, callback) => {
      const EventEmitter = require('events');
      const request = new EventEmitter();
      request.destroy = (error) => {
        if (error) process.nextTick(() => request.emit('error', error));
      };
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = handlers && handlers.secureOriginReachable === false ? 503 : 200;
        response.setEncoding = () => {};
        callback(response);
        if (response.statusCode === 200) {
          response.emit('data', JSON.stringify({ success: true, service: 'orion-phone-companion' }));
        }
        response.emit('end');
      });
      return request;
    },
    '@global': true,
    '@noCallThru': true
  };
  const main = proxyquire('../main.js', {
    electron: electron.mock,
    './lib/config': configMock,
    'web-push': webPushMock,
    https: httpsMock,
    os: osMock
  });
  main.resetCompanionServer();
  main.startPhoneCompanionServer();
  await new Promise(resolve => setTimeout(resolve, 150));
  return { main, fsMock, electron, webPushCalls };
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

// Reads the first SSE frame from a streaming response, then destroys the socket (the connection
// is otherwise held open indefinitely by the server's push interval).
function requestFirstSseFrame(port, path, session) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET',
      hostname: '127.0.0.1',
      port,
      path,
      headers: session ? { Authorization: `Bearer ${session.secret}`, 'X-Orion-Device-Id': session.deviceId } : {}
    }, (res) => {
      let text = '';
      res.on('data', chunk => {
        text += chunk;
        // Skip the initial ": connected" heartbeat comment and wait for a real data frame.
        if (/^data: /m.test(text) && text.includes('\n\n')) {
          req.destroy();
          resolve({ statusCode: res.statusCode, headers: res.headers, text });
        }
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', (err) => {
      // Destroying the socket to stop reading legitimately raises ECONNRESET/aborted here.
      if (/ECONNRESET|aborted/i.test(err.message)) return;
      reject(err);
    });
    req.end();
  });
}

// Opens an SSE connection and keeps collecting parsed `data:` frames for as long as the caller
// holds it open (unlike requestFirstSseFrame, which destroys the socket after the first one).
// Used to observe a *sequence* of pushes on a single connection -- e.g. an initial snapshot
// followed by a later update that arrives while the connection is still open.
function openSseConnection(port, path, session) {
  const frames = [];
  let notify = null;
  const req = http.request({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path,
    headers: session ? { Authorization: `Bearer ${session.secret}`, 'X-Orion-Device-Id': session.deviceId } : {}
  });
  const responsePromise = new Promise((resolve, reject) => {
    req.on('response', (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        let sepIndex;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const dataLines = rawEvent.split('\n').filter(line => line.startsWith('data:'));
          if (dataLines.length) {
            try {
              frames.push(JSON.parse(dataLines.map(line => line.slice(5).trim()).join('\n')));
              if (notify) notify();
            } catch (e) {}
          }
        }
      });
      resolve(res);
    });
    req.on('error', (err) => {
      if (!/ECONNRESET|aborted/i.test(err.message)) reject(err);
    });
  });
  req.end();
  return {
    frames,
    responsePromise,
    waitForFrameCount(count, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        if (frames.length >= count) { resolve(frames); return; }
        const timer = setTimeout(() => {
          notify = null;
          reject(new Error(`Timed out waiting for ${count} SSE frame(s); got ${frames.length}`));
        }, timeoutMs);
        notify = () => {
          if (frames.length >= count) {
            clearTimeout(timer);
            notify = null;
            resolve(frames);
          }
        };
      });
    },
    close() {
      req.destroy();
    }
  };
}

test('Phone Companion generated inline script is valid JavaScript', (t) => {
  const html = companionHtml('DESKTOP-TEST');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  t.ok(inlineScripts.length > 0, 'phone shell includes inline boot script');
  inlineScripts.forEach((match, index) => {
    t.doesNotThrow(
      () => new vm.Script(match[1], { filename: `phone-companion-inline-${index + 1}.js` }),
      `inline phone script ${index + 1} compiles`
    );
  });
  t.end();
});

test('Phone Companion v2 serves pairing shell but protects APIs', async (t) => {
  const { main } = await startMainWithConfig(1131);

  const root = await request('GET', 1131, '/');
  t.equal(root.statusCode, 200, 'root shell is available without token-in-URL auth');
  t.notOk(root.text.includes('phoneCompanionToken'), 'root shell does not expose legacy token');
  t.notOk(root.text.includes('pair-code-123456'), 'clean phone shell does not embed the current setup code');
  t.ok(root.text.includes('<title>Orion</title>'), 'root shell serves the Orion mobile UI');
  t.notOk(root.text.includes('data-drawer-destination="history"'), 'root shell does not expose History as a top-level mode');
  t.ok(root.text.includes('data-drawer-destination="operator"'), 'root shell exposes Operator in the app drawer');
  t.ok(root.text.includes('id="mode-toggle-operator"'), 'root shell includes Operator in the specialist mode control');
  t.ok(root.text.includes('function enterDispatch'), 'root shell enters Dispatch through the chat-first route');
  t.ok(root.text.includes("companionFetch('/api/new-focus'"), 'phone New Focus asks the desktop to cancel pending owned work');
  t.ok(root.text.includes('permanentCredentialFailureCodes'), 'phone distinguishes durable auth revocation from transient transport failures');
  t.ok(root.text.includes('confirmedCredentialFailures < 2'), 'phone confirms a permanent credential failure before erasing saved access');
  t.ok(root.text.includes('Connection interrupted. Retrying saved phone access...'), 'generic auth interruptions retain the durable device credential');
  t.ok(root.text.includes('This browser has no saved Orion phone access.'), 'clean URLs do not silently reuse a short-lived setup code');
  t.ok(root.text.includes('await cancelPendingTasksForNewFocus();'), 'phone waits for cancellation before opening a fresh Dispatch draft');
  t.ok(root.text.includes('id="dispatch-browser-overlay"'), 'root shell keeps saved discussions in an in-Dispatch browser');
  t.notOk(root.text.includes('<span>Pick up a project</span>'), 'root shell keeps project rows off the Dispatch landing');
  t.ok(root.text.includes('Your Dispatch history, newest first.'), 'root shell presents a flat Dispatch discussion browser');
  t.ok(root.text.includes('No task is too large. What are we taking on?'), 'root shell uses the focused Dispatch motto');
  t.ok(root.text.includes('Task List'), 'root shell includes mobile task list status');
  t.ok(root.text.includes('renderPhoneTaskList'), 'mobile shell renders the conversation checklist from state');
  t.ok(root.text.includes('data-drawer-destination="settings"'), 'root shell exposes app-level Settings through the drawer');
  t.notOk(root.text.includes('Skill Registry'), 'root shell does not expose the Skills tab');
  t.notOk(root.text.includes('Start a new Orion task:'), 'new task no longer requires a prompt/name dialog');

  const manifest = await request('GET', 1131, '/manifest.webmanifest');
  t.equal(manifest.statusCode, 200, 'manifest is available without token query string');

  const marked = await request('GET', 1131, '/marked.min.js');
  t.equal(marked.statusCode, 200, 'Markdown parser asset is available before phone auth');
  t.ok(/marked/i.test(marked.text), 'Markdown parser asset returns JavaScript content');

  const taskPresentation = await request('GET', 1131, '/task-orchestration.js');
  t.equal(taskPresentation.statusCode, 200, 'shared durable-task presentation contract is available before phone auth');
  t.ok(taskPresentation.text.includes('selectSupervisedTask'), 'shared task asset includes canonical task selection');

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
  t.equal(payload.networkEnabled, true, 'initial top-bar payload is phone-reachable on LAN');
  t.ok(payload.pairUrl.includes('http://192.168.50.25:1136/?pair='), 'enabled payload exposes Wi-Fi pairing URL');
  await closeServer(main.getCompanionServer());
});

test('Phone Companion pairing prefers configured HTTPS origin for mobile notifications', async (t) => {
  const { main } = await startMainWithConfig(1147, {
    phoneCompanionHttpsOrigin: 'https://orion-owner.example.test/some/path'
  });

  const payload = await main.getPhoneCompanionPairingForTest();
  t.equal(payload.preferredUrlType, 'https', 'HTTPS origin becomes the preferred phone URL');
  t.equal(payload.secureOrigin, 'https://orion-owner.example.test', 'HTTPS origin is normalized to the origin');
  t.ok(payload.pairUrl.startsWith('https://orion-owner.example.test/?pair='), 'primary pairing URL uses HTTPS');
  t.equal(payload.stableUrl, 'https://orion-owner.example.test/', 'stable phone URL uses HTTPS');
  t.ok(payload.localPairUrl.includes('http://192.168.50.25:1147/?pair='), 'local fallback pairing URL is still available');
  t.equal(payload.phoneNotificationsAvailable, true, 'payload advertises notification-capable pairing');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion does not advertise an unreachable configured HTTPS origin as the stable app URL', async (t) => {
  const { main } = await startMainWithConfig(1151, {
    phoneCompanionHttpsOrigin: 'https://desktop-owner.example.test'
  }, {
    secureOriginReachable: false
  });

  const payload = await main.getPhoneCompanionPairingForTest();
  t.equal(payload.preferredUrlType, 'local', 'an unreachable HTTPS route is not selected');
  t.equal(payload.secureOriginReachable, false, 'payload reports the failed secure-route check');
  t.ok(payload.pairUrl.startsWith('http://192.168.50.25:1151/?pair='), 'pairing falls back to the reachable direct server');
  t.equal(payload.phoneNotificationsAvailable, false, 'unreachable HTTPS is not presented as notification capable');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion uses stable Tailscale MagicDNS instead of an origin-changing device IP', async (t) => {
  const { main } = await startMainWithConfig(1154, {
    phoneCompanionHttpsOrigin: 'https://desktop-owner.tailnet-name.ts.net'
  }, {
    secureOriginReachable: false,
    tailscaleAddress: '100.122.183.97'
  });

  const payload = await main.getPhoneCompanionPairingForTest();
  t.equal(
    payload.tailscaleStableUrl,
    'http://desktop-owner.tailnet-name.ts.net:1154/',
    'stable direct URL uses MagicDNS and the companion port'
  );
  t.ok(
    payload.tailscalePairUrl.startsWith('http://desktop-owner.tailnet-name.ts.net:1154/?pair='),
    'Tailscale pairing establishes storage on the same stable origin used by the shortcut'
  );
  t.notOk(payload.tailscaleStableUrl.includes('100.122.183.97'), 'the permanent shortcut is not bound to a rotatable Tailscale IP');

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
  t.equal(revoked.json.code, 'COMPANION_DEVICE_REVOKED', 'revocation has a machine-readable permanent failure code');
  t.equal(revoked.json.rePairRequired, true, 'revocation explicitly authorizes clearing the saved credential');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion durable session remains valid after the short-lived pairing link expires', async (t) => {
  const pairedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const device = {
    id: 'durable-phone',
    name: 'Pixel',
    secret: 'durable-secret',
    approved: true,
    revoked: false,
    pairedAt,
    lastSeenAt: pairedAt,
    userAgent: 'test-phone'
  };
  const { main } = await startMainWithConfig(1152, {
    phoneCompanionPairingExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    phoneCompanionDevices: [device]
  });

  const state = await request('GET', 1152, '/api/state', null, {
    deviceId: device.id,
    secret: device.secret
  });
  t.equal(state.statusCode, 200, 'device credential is independent of pairing-link expiry');
  t.equal(state.json.success, true, 'expired setup link does not expire the paired phone');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion rejects an expired setup code while preserving durable device sessions', async (t) => {
  const { main } = await startMainWithConfig(1155, {
    phoneCompanionPairingCode: 'expired-pair-code',
    phoneCompanionPairingExpiresAt: new Date(Date.now() - 60 * 1000).toISOString()
  });

  const expiredPair = await request('POST', 1155, '/api/pair', {
    pairingCode: 'expired-pair-code',
    deviceName: 'New phone'
  });
  t.equal(expiredPair.statusCode, 401, 'expired setup code cannot create another device session');
  t.equal(expiredPair.json.error, 'Invalid pairing code', 'expired setup link receives a clear rejection');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion auth failures distinguish transient missing headers from invalid durable credentials', async (t) => {
  const { main } = await startMainWithConfig(1153);

  const missing = await request('GET', 1153, '/api/state');
  t.equal(missing.statusCode, 401, 'missing auth is rejected');
  t.equal(missing.json.code, 'COMPANION_CREDENTIAL_MISSING', 'missing headers have an explicit code');
  t.equal(missing.json.rePairRequired, false, 'generic missing auth does not tell a client to erase durable access');

  const unknown = await request('GET', 1153, '/api/state', null, {
    deviceId: 'unknown-device',
    secret: 'unknown-secret'
  });
  t.equal(unknown.statusCode, 401, 'unknown device is rejected');
  t.equal(unknown.json.code, 'COMPANION_DEVICE_UNKNOWN', 'unknown device has a permanent failure code');
  t.equal(unknown.json.rePairRequired, true, 'unknown durable credential eventually requires a new pairing');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion page traffic does not consume the pairing-attempt budget', async (t) => {
  const { main } = await startMainWithConfig(1150);

  for (let index = 0; index < 8; index += 1) {
    const asset = await request('GET', 1150, index % 2 === 0 ? '/icon.svg' : '/manifest.webmanifest');
    t.equal(asset.statusCode, 200, `ordinary page request ${index + 1} succeeds`);
  }

  const pair = await request('POST', 1150, '/api/pair', {
    pairingCode: 'pair-code-123456',
    deviceName: 'Phone'
  });
  t.equal(pair.statusCode, 200, 'the first real pairing attempt retains its separate rate-limit budget');
  t.ok(pair.json.sessionSecret, 'successful pairing still creates a reusable session');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 auto-pairs valid LAN pairing links by default', async (t) => {
  const { main, electron } = await startMainWithConfig(1142);

  const pair = await request('POST', 1142, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'Phone' });
  t.equal(pair.statusCode, 200, 'valid pairing code creates a session without desktop confirmation');
  t.ok(pair.json.sessionSecret, 'auto-pair returns a session secret');
  t.notOk(electron.calls.some(call => call.includes('approvePhoneCompanionPairing')), 'default pairing does not call desktop confirmation bridge');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 task controls and preview endpoints reach desktop bridge', async (t) => {
  const { main, electron, fsMock } = await startMainWithConfig(1133);
  const pair = await request('POST', 1133, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const switchRes = await request('POST', 1133, '/api/conversations/switch', { conversationId: 'conv2' }, session);
  t.equal(switchRes.statusCode, 200, 'task switching endpoint succeeds');
  t.ok(switchRes.json.selectionRevision > 0, 'an explicit switch advances the durable device selection revision');
  t.equal(
    fsMock._config().phoneCompanionDevices[0].selectedConversationId,
    'conv2',
    'the phone selection is persisted independently of desktop activity'
  );

  const promptCallsBeforeStaleSubmit = electron.calls.filter(call => call.includes('submitPhoneCompanionPrompt')).length;
  const stalePrompt = await request('POST', 1133, '/api/prompt', {
    prompt: 'this belongs to the old transcript',
    conversationId: 'conv1',
    selectionRevision: switchRes.json.selectionRevision
  }, session);
  t.equal(stalePrompt.statusCode, 409, 'a prompt submitted from a stale visible conversation is rejected');
  t.equal(
    electron.calls.filter(call => call.includes('submitPhoneCompanionPrompt')).length,
    promptCallsBeforeStaleSubmit,
    'a stale prompt never reaches the renderer or another conversation'
  );

  const staleRevisionPrompt = await request('POST', 1133, '/api/prompt', {
    prompt: 'same conversation, obsolete view',
    conversationId: 'conv2',
    selectionRevision: Math.max(0, switchRes.json.selectionRevision - 1)
  }, session);
  t.equal(staleRevisionPrompt.statusCode, 409, 'an obsolete revision of the same conversation is rejected');

  const unboundPrompt = await request('POST', 1133, '/api/prompt', { prompt: 'unbound turn' }, session);
  t.equal(unboundPrompt.statusCode, 409, 'an existing-conversation prompt must identify its visible transcript');

  const currentPrompt = await request('POST', 1133, '/api/prompt', {
    prompt: 'this belongs here',
    conversationId: 'conv2',
    selectionRevision: switchRes.json.selectionRevision
  }, session);
  t.equal(currentPrompt.statusCode, 200, 'a prompt bound to the visible conversation succeeds');
  t.ok(
    electron.calls.some(call => call.includes('submitPhoneCompanionPrompt') && call.includes('conv2') && call.includes('this belongs here')),
    'the renderer receives the exact visible conversation identity'
  );

  const newTask = await request('POST', 1133, '/api/conversations/new', { prompt: 'new task', projectPath: 'C:\\Projects\\OrionTarget' }, session);
  t.equal(newTask.statusCode, 200, 'new task endpoint succeeds');

  const dispatchStart = await request('POST', 1133, '/api/conversations/new', {
    prompt: 'continue the architecture discussion',
    mode: 'orion',
    dispatchProjectPath: 'C:\\Projects\\Chronicle',
    contextSummary: 'Last discussed expedition progression.'
  }, session);
  t.equal(dispatchStart.statusCode, 200, 'first Dispatch message creates its conversation through one request');

  const operatorStart = await request('POST', 1133, '/api/conversations/new', {
    prompt: 'open the browser and inspect the page',
    mode: 'operator'
  }, session);
  t.equal(operatorStart.statusCode, 200, 'new Operator task endpoint succeeds');

  const prompt = await request('POST', 1133, '/api/prompt', {
    prompt: 'hello',
    conversationId: operatorStart.json.conversationId,
    selectionRevision: operatorStart.json.selectionRevision,
    projectPath: 'C:\\Projects\\OrionTarget'
  }, session);
  t.equal(prompt.statusCode, 200, 'prompt submission succeeds');

  const operatorPrompt = await request('POST', 1133, '/api/prompt', {
    prompt: 'inspect the desktop',
    conversationId: operatorStart.json.conversationId,
    selectionRevision: operatorStart.json.selectionRevision,
    mode: 'operator'
  }, session);
  t.equal(operatorPrompt.statusCode, 200, 'Operator prompt submission succeeds');

  const steer = await request('POST', 1133, '/api/steer', {
    prompt: 'focus here',
    conversationId: operatorStart.json.conversationId,
    selectionRevision: operatorStart.json.selectionRevision
  }, session);
  t.equal(steer.statusCode, 200, 'steering endpoint succeeds');

  const approve = await request('POST', 1133, '/api/approve-plan', {}, session);
  const deny = await request('POST', 1133, '/api/deny-plan', {}, session);
  const revise = await request('POST', 1133, '/api/revise-plan', { feedback: 'revise' }, session);
  t.equal(approve.statusCode, 200, 'plan approval succeeds');
  t.equal(deny.statusCode, 200, 'plan denial succeeds');
  t.equal(revise.statusCode, 200, 'plan revision succeeds');
  const approvalCallsBeforeStaleAction = electron.calls.filter(call => call.includes('approvePhoneCompanionPlan')).length;
  const staleApprove = await request('POST', 1133, '/api/approve-plan', {
    conversationId: 'a-different-conversation'
  }, session);
  t.equal(staleApprove.statusCode, 409, 'a plan control from a stale or unrelated view is rejected');
  t.equal(
    electron.calls.filter(call => call.includes('approvePhoneCompanionPlan')).length,
    approvalCallsBeforeStaleAction,
    'a stale approval never reaches the desktop conversation'
  );

  const stop = await request('POST', 1133, '/api/stop', {}, session);
  const resume = await request('POST', 1133, '/api/resume', {}, session);
  t.equal(stop.statusCode, 200, 'stop/pause succeeds');
  t.equal(resume.statusCode, 200, 'resume succeeds');

  const preview = await request('GET', 1133, '/api/preview', null, session);
  t.deepEqual(preview.json.preview.changedFiles, ['app.js'], 'preview exposes changed files');
  t.equal(preview.json.preview.appLaunchUrl, 'http://localhost:3000', 'preview exposes app launch URL');

  t.ok(!electron.calls.some(call => call.includes('switchPhoneCompanionConversation')), 'desktop bridge no longer switches global active conversation task');
  t.ok(electron.calls.some(call => call.includes('C:\\\\Projects\\\\OrionTarget')), 'new task endpoint forwards selected project path');
  t.ok(electron.calls.some(call => call.includes('C:\\\\Projects\\\\Chronicle') && call.includes('Last discussed expedition progression.')), 'Dispatch creation forwards project association and compact re-entry context');
  t.ok(
    electron.calls.some(call => call.includes('startPhoneCompanionTask') && call.includes('"mode":"operator"')),
    'Operator creation preserves its role across the real phone-to-renderer bridge'
  );
  t.ok(
    electron.calls.some(call => call.includes('submitPhoneCompanionPrompt') && call.includes('"mode":"operator"')),
    'existing phone prompts preserve Operator mode across the server bridge'
  );
  t.ok(electron.calls.some(call => call.includes('submitPhoneCompanionPrompt') && call.includes('C:\\\\Projects\\\\OrionTarget')), 'prompt endpoint forwards selected project path');
  t.ok(electron.calls.some(call => call.includes('submitPhoneCompanionPrompt')), 'desktop bridge submitted prompt');
  t.ok(electron.calls.some(call => call.includes('approvePhoneCompanionPlan')), 'desktop bridge approved plan');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion New Focus cancels only pending tasks owned by the selected conversation', async (t) => {
  const { main, electron } = await startMainWithConfig(1148, {}, {
    newFocus: { cancelled: ['task-old-focus'], count: 1 }
  });
  const pair = await request('POST', 1148, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  await request('POST', 1148, '/api/conversations/switch', { conversationId: 'dispatch-owned' }, session);
  const result = await request('POST', 1148, '/api/new-focus', { conversationId: 'unrelated-conversation' }, session);

  t.equal(result.statusCode, 200, 'new-focus endpoint succeeds');
  t.same(result.json.cancelled, ['task-old-focus'], 'returns the renderer cancellation result');
  t.equal(result.json.count, 1, 'reports the number of cancelled pending tasks');
  const bridgeCall = electron.calls.find(call => call.includes('beginNewFocus'));
  t.ok(bridgeCall, 'new-focus endpoint invokes the renderer cancellation primitive');
  t.ok(bridgeCall.includes('dispatch-owned'), 'cancellation is scoped to the phone selected conversation');
  t.notOk(bridgeCall.includes('unrelated-conversation'), 'caller cannot cancel another conversation by supplying an id');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion New Focus reports cancellation failure and preserves the selected focus', async (t) => {
  const { main, electron } = await startMainWithConfig(1149, {}, {
    newFocus: {
      success: false,
      cancelled: [],
      failures: [{ taskId: 'task-still-pending', error: 'store unavailable' }],
      count: 0
    }
  });
  const pair = await request('POST', 1149, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  await request('POST', 1149, '/api/conversations/switch', { conversationId: 'dispatch-owned' }, session);
  const result = await request('POST', 1149, '/api/new-focus', {}, session);

  t.equal(result.statusCode, 200, 'the bridge returns the structured renderer result');
  t.equal(result.json.success, false, 'the phone is told not to open a fresh focus');
  t.equal(result.json.failures[0].taskId, 'task-still-pending', 'the failed pending task remains identifiable');
  const bridgeCall = electron.calls.find(call => call.includes('beginNewFocus'));
  t.ok(bridgeCall && bridgeCall.includes('dispatch-owned'), 'the failed attempt remains scoped to the selected conversation');

  await closeServer(main.getCompanionServer());
});

// Regression: ask_clarifying_questions' interactive card (conversation.awaitingClarification —
// intro + questions[].header/question/options[].label/description/recommended) was stored on the
// desktop conversation object but never included in the phone's /api/state payload at all, and
// lib/companion-html.js had zero rendering logic for it — the phone just showed generic text with
// no way to actually answer the questions.
test('Phone Companion surfaces and accepts answers to clarifying questions', async (t) => {
  const clarificationPayload = {
    conversationId: 'conv1',
    title: 'Task One',
    conversations: [{ id: 'conv1', title: 'Task One', active: true }],
    tasks: [],
    messages: [],
    latestOutput: '',
    awaitingClarification: {
      intro: 'A few quick design questions before I proceed:',
      questions: [
        {
          header: 'Simulation Depth',
          question: 'How detailed should the physics be?',
          options: [
            { label: 'Arcade', description: 'Simplified, fun-first physics.', recommended: true },
            { label: 'Full simulation', description: 'Realistic tire wear and fuel management.' }
          ]
        }
      ]
    },
    preview: { latestAssistantOutput: '', workWalkthrough: '', changedFiles: [], testResults: [] }
  };
  const { main, electron } = await startMainWithConfig(1145, {}, { state: clarificationPayload });
  const pair = await request('POST', 1145, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const state = await request('GET', 1145, '/api/state', null, session);
  t.equal(state.statusCode, 200, 'state endpoint succeeds');
  t.ok(state.json.awaitingClarification, 'state payload carries the clarification question data');
  t.equal(state.json.awaitingClarification.questions[0].header, 'Simulation Depth', 'question header is present');
  t.equal(state.json.awaitingClarification.questions[0].options[0].recommended, true, 'recommended flag survives to the phone payload');

  const missingAnswers = await request('POST', 1145, '/api/clarify', {}, session);
  t.equal(missingAnswers.statusCode, 400, 'submitting with no answers is rejected');

  const submit = await request('POST', 1145, '/api/clarify', {
    answers: [{ header: 'Simulation Depth', question: 'How detailed should the physics be?', answer: 'Arcade' }]
  }, session);
  t.equal(submit.statusCode, 200, 'answer submission succeeds');
  t.ok(electron.calls.some(call => call.includes('submitPhoneCompanionClarification') && call.includes('Simulation Depth')), 'desktop bridge received the clarification answers');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion exposes the skill system to paired phones', async (t) => {
  const { main, electron } = await startMainWithConfig(1144, {}, {
    skills: { skills: [{ name: 'demo-skill', description: 'demo' }], count: 1 },
    skillRun: { success: true, outputs: { message: 'done' } }
  });
  const pair = await request('POST', 1144, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const unauthorized = await request('GET', 1144, '/api/skills');
  t.equal(unauthorized.statusCode, 401, 'skills listing requires a paired session like other endpoints');

  const list = await request('GET', 1144, '/api/skills', null, session);
  t.equal(list.statusCode, 200, 'skills listing succeeds for a paired phone');
  t.deepEqual(list.json.skills, [{ name: 'demo-skill', description: 'demo' }], 'skills listing forwards discovered skills');

  const missingName = await request('POST', 1144, '/api/skills/run', {}, session);
  t.equal(missingName.statusCode, 400, 'running a skill without a name is rejected');

  const run = await request('POST', 1144, '/api/skills/run', { name: 'demo-skill', inputs: { x: 1 } }, session);
  t.equal(run.statusCode, 200, 'running a named skill succeeds');
  t.deepEqual(run.json.outputs, { message: 'done' }, 'skill run response forwards outputs');
  t.ok(electron.calls.some(call => call.includes('runPhoneCompanionSkill') && call.includes('demo-skill')), 'desktop bridge received the skill run request');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion pushes state over SSE instead of only polling', async (t) => {
  const { main } = await startMainWithConfig(1145);
  try {
    const pair = await request('POST', 1145, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
    const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

    const unauthorized = await requestFirstSseFrame(1145, '/api/events');
    t.equal(unauthorized.statusCode, 401, 'event stream requires a paired session');

    const stream = await requestFirstSseFrame(1145, '/api/events', session);
    t.equal(stream.statusCode, 200, 'event stream opens for a paired phone');
    t.equal(stream.headers['content-type'], 'text/event-stream; charset=utf-8', 'event stream uses the SSE content type');
    t.ok(stream.text.includes('data: '), 'event stream pushes a state frame without the phone polling');
    const dataLine = stream.text.split('\n').find(line => line.startsWith('data: '));
    const framePayload = JSON.parse(dataLine.slice('data: '.length));
    t.equal(framePayload.success, true, 'pushed frame carries the same state shape as /api/state');
  } finally {
    await closeServer(main.getCompanionServer());
  }
});

test('Phone Companion does not drop a state update that lands while an SSE connection is (re)establishing', async (t) => {
  // Regression test for a state-sync gap: a phone reconnecting (e.g. coming back from
  // backgrounded/inactive) registers its SSE connection AFTER assembling its first snapshot.
  // If a message finishes processing (persistConversations -> triggerCompanionSync) in that
  // window, the sync had nowhere to land -- the connection wasn't registered in
  // activeSseTriggers yet -- and the phone showed nothing new until an unrelated later event or a
  // full app reopen. The message itself sent and was processed correctly; only the push that was
  // supposed to tell the UI about it was silently lost.
  let resolveFirstSnapshot = null;
  let stateCalls = 0;
  const stateV1 = {
    conversationId: 'conv1', title: 'Before reply', conversations: [], tasks: [], messages: [],
    latestOutput: 'v1', preview: {}
  };
  const stateV2 = {
    conversationId: 'conv1', title: 'After reply', conversations: [], tasks: [], messages: [],
    latestOutput: 'v2', preview: {}
  };
  const { main } = await startMainWithConfig(1199, {}, {
    stateProvider: () => {
      stateCalls += 1;
      // Hold the connection's first snapshot open until the test explicitly resolves it, so a
      // triggerCompanionSync() can be fired while this connection is still assembling that
      // snapshot -- mirroring a message finishing right as the phone's SSE stream reconnects.
      if (stateCalls === 1) {
        return new Promise(resolve => { resolveFirstSnapshot = () => resolve(stateV1); });
      }
      return stateV2;
    }
  });
  let live = null;
  try {
    const pair = await request('POST', 1199, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
    const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

    live = openSseConnection(1199, '/api/events', session);
    await live.responsePromise;

    // Wait for the server to have entered its first getPhoneCompanionState() call (proving the
    // snapshot is genuinely in flight) before simulating the race.
    await new Promise(resolve => {
      (function check() { stateCalls >= 1 ? resolve() : setImmediate(check); })();
    });
    t.equal(stateCalls, 1, 'the connection began assembling its initial snapshot');
    t.ok(typeof resolveFirstSnapshot === 'function', 'the first snapshot call is genuinely pending, not already resolved');

    // A message finishes processing concurrently with this connection's setup.
    main.triggerCompanionSync();
    // Now let the held-open initial snapshot resolve.
    resolveFirstSnapshot();

    const frames = await live.waitForFrameCount(2, 2000);
    t.equal(frames.length, 2, 'the connection receives both its initial snapshot and the update that raced its setup');
    t.equal(frames[0].title, 'Before reply', 'first frame is the state as of connection time');
    t.equal(frames[1].title, 'After reply', 'second frame reflects the concurrent update -- it was not silently dropped');
  } finally {
    // Always tear down the still-open SSE socket before closing the server -- server.close()
    // waits for existing keep-alive connections to end on their own, and this connection's
    // 20s ping keeps it alive indefinitely. Skipping this step (e.g. on an assertion failure
    // above) would hang the whole test run instead of just failing this one test.
    if (live) live.close();
    await closeServer(main.getCompanionServer());
  }
});

test('Phone Companion replaces suspended mobile connections immediately on foreground', t => {
  const html = companionHtml();
  const ipcServerSource = fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  t.ok(html.includes("if (document.hidden) suspendBackgroundConnection();"),
    'backgrounding proactively retires the stream instead of leaving a ghost active connection');
  t.ok(html.includes("startEventStream({ force: true });"),
    'foreground recovery always replaces the pre-suspension stream');
  t.ok(html.includes("window.addEventListener('pageshow', recoverForegroundConnection)"),
    'PWA restoration and back-forward cache restoration recover immediately');
  t.ok(html.includes("window.addEventListener('online', recoverForegroundConnection)"),
    'a network handoff recovers immediately without waiting for the poll interval');
  t.ok(html.includes("window.addEventListener('focus', recoverForegroundConnection)"),
    'returning focus also recovers browsers with unreliable visibility events');
  t.ok(html.includes("if (!sseStateReceived || lastSseMessageAt < recoveryStartedAt) loadState({ force: true });"),
    'a bounded fallback state request runs when the replacement stream has not delivered state');
  t.ok(html.includes("requestTimeout = setTimeout(() => requestController.abort(), 7000)"),
    'a stalled state request cannot block foreground recovery indefinitely');
  t.ok(html.includes("lastSseActivityAt = Date.now();"),
    'SSE keepalive bytes count as live activity and suppress redundant status polling');
  t.ok(ipcServerSource.includes('if (pushInFlight)') && ipcServerSource.includes('pushAgain = true'),
    'server state pushes are coalesced while a renderer snapshot is in flight');
  t.ok(mainSource.includes('backgroundThrottling: false'),
    'the canonical desktop state bridge remains responsive while the desktop window is minimized');
  t.end();
});

test('phone state transports only the activity the mobile UI can display', t => {
  const start = rendererSource.indexOf('function truncatePhoneTransportText(');
  const end = rendererSource.indexOf('function scrubLegacyPhoneCompanionTokenMessages', start);
  t.ok(start > 0 && end > start, 'phone transport compaction helpers are independently testable');
  const source = rendererSource.slice(start, end);
  const compactPhoneToolLogs = new Function(
    `${source}; return compactPhoneToolLogs;`
  )();
  const logs = Array.from({ length: 20 }, (_, index) => ({
    type: 'tool_call',
    tool: `tool-${index}`,
    status: 'completed',
    params: { path: `file-${index}.js`, content: 'p'.repeat(4000) },
    result: 'r'.repeat(12000)
  }));
  const compact = compactPhoneToolLogs(logs, 8);

  t.equal(compact.length, 8, 'transport matches the eight operations the phone renderer shows');
  t.equal(compact[0].tool, 'tool-12', 'the newest visible operations are preserved');
  t.ok(compact.every(log => log.result.length < 2500), 'large invisible tool results are bounded before network transfer');
  t.ok(compact.every(log => log.params.content.length < 900), 'large tool parameters are bounded before network transfer');
  t.ok(rendererSource.includes('const text = replayMsg.text;')
      && rendererSource.includes('logs: replayMsg.role === \'assistant\' ? replayLogs : []'),
    'assistant answer text remains intact while only execution logs are compacted');
  t.end();
});

test('phone renders an outgoing message before waiting for Orion to answer', t => {
  const html = companionHtml();
  const submitStart = html.indexOf('async function handlePromptSubmit()');
  const submitEnd = html.indexOf("document.getElementById('send').addEventListener", submitStart);
  const flow = html.slice(submitStart, submitEnd);
  const optimisticIndex = flow.indexOf('appendOptimisticPhoneMessage(text, optimisticImages, promptPayload.requestId)');
  const existingConversationPost = flow.indexOf("companionFetch('/api/prompt'");
  const newConversationPost = flow.indexOf("companionFetch('/api/conversations/new'");

  t.ok(optimisticIndex > 0, 'the phone creates its local user bubble in the real submit path');
  t.ok(optimisticIndex < existingConversationPost, 'an existing-conversation bubble renders before its POST can wait on classification or an answer');
  t.ok(optimisticIndex < newConversationPost, 'a first-message bubble also renders before conversation creation waits');
  t.ok(flow.indexOf("promptEl.value = '';", optimisticIndex) < existingConversationPost,
    'the composer clears immediately rather than looking unsent while Orion works');
  t.ok(flow.includes('conversationId: currentConversationId'),
    'every existing-conversation prompt names the transcript visible on the phone');
  t.ok(flow.includes('selectionRevision: acceptedConversationSelectionRevision'),
    'every existing-conversation prompt carries the accepted view revision');
  t.ok(html.includes('optimisticPhoneSend') && html.includes('canonicalMessageArrived'),
    'intermediate state snapshots preserve the local bubble until its canonical message arrives');
  t.ok(rendererSource.includes("requestId: replayMsg.requestId || ''"),
    'the canonical phone state echoes the idempotency receipt used to reconcile the local bubble');
  t.ok(rendererSource.includes("requestId: phoneRequestId"),
    'the persisted user message carries that exact receipt through the real renderer route');
  t.end();
});

test('Phone Companion delete requires explicit UI confirmation flag', async (t) => {
  const { main, electron } = await startMainWithConfig(1143);
  const pair = await request('POST', 1143, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const missingConfirm = await request('POST', 1143, '/api/conversations/delete', { conversationId: 'conv1' }, session);
  t.equal(missingConfirm.statusCode, 400, 'delete without confirmation is rejected');
  t.equal(missingConfirm.json.error, 'Delete confirmation required', 'rejection explains confirmation requirement');
  t.notOk(electron.calls.some(call => call.includes('deletePhoneCompanionConversation')), 'desktop delete bridge is not called without confirmation');

  const confirmed = await request('POST', 1143, '/api/conversations/delete', { conversationId: 'conv1', confirmed: true }, session);
  t.equal(confirmed.statusCode, 200, 'confirmed delete succeeds');
  t.ok(electron.calls.some(call => call.includes('deletePhoneCompanionConversation')), 'confirmed delete reaches desktop bridge');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion LAN mode can still be explicitly disabled', async (t) => {
  const { main } = await startMainWithConfig(1134, { enablePhoneCompanion: false });
  const server = main.getCompanionServer();
  const address = server.address();
  t.equal(address.address, '127.0.0.1', 'server binds localhost when companion LAN mode is explicitly disabled');
  await closeServer(server);
});

test('Phone Companion v2 task dashboard carries global running, viewed state, queued prompts, and activity panel details', async (t) => {
  const customState = {
    conversationId: 'conv1',
    title: 'Task One',
    conversations: [
      { id: 'conv1', title: 'Task One', active: true, awaitingPlanApproval: true },
      { id: 'conv2', title: 'Task Two', active: false }
    ],
    tasks: [{ title: 'Build', status: 'in-progress' }],
    messages: [],
    latestOutput: 'latest',
    globalRunning: true,
    runningConversationId: 'conv2',
    queuedPrompts: 2,
    queuedPromptPreview: ['npm test', 'git status'],
    subStatus: 'Running webpack...',
    executionMode: 'executing',
    operationalContext: {
      revision: 4,
      mission: 'Build a deep colony simulation.',
      activeObjective: 'Create the playable loop.',
      activeSubplan: { title: 'Implement economy', status: 'active', nextAction: 'Run balance test.' },
      winConditions: [{ id: 'economy', title: 'Working economy', status: 'in_progress', evidenceCount: 1 }],
      blockers: [{ id: 'save', title: 'Save format mismatch', details: 'Old schema.' }],
      lastDistillation: null
    },
    preview: {
      latestAssistantOutput: 'latest',
      workWalkthrough: 'Done: test',
      changedFiles: ['app.js'],
      testResults: ['npm test passed'],
      appLaunchUrl: 'http://localhost:3000',
      appLaunchLogs: 'Server listening on port 3000'
    }
  };

  const { main } = await startMainWithConfig(1138, {}, { state: customState });
  const pair = await request('POST', 1138, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const stateRes = await request('GET', 1138, '/api/state', null, session);
  t.equal(stateRes.statusCode, 200, 'state retrieval succeeds');
  
  const state = stateRes.json;
  t.equal(state.globalRunning, true, 'carries globalRunning');
  t.equal(state.runningConversationId, 'conv2', 'carries runningConversationId');
  t.equal(state.queuedPrompts, 2, 'carries queuedPrompts count');
  t.deepEqual(state.queuedPromptPreview, ['npm test', 'git status'], 'carries queuedPromptPreview');
  t.equal(state.subStatus, 'Running webpack...', 'carries subStatus');
  t.equal(state.executionMode, 'executing', 'carries agent execution mode');
  t.equal(state.operationalContext.mission, 'Build a deep colony simulation.', 'carries mission context');
  t.equal(state.operationalContext.activeSubplan.title, 'Implement economy', 'carries active subplan');
  t.equal(state.operationalContext.blockers[0].title, 'Save format mismatch', 'carries active blockers');
  
  t.equal(state.preview.appLaunchLogs, 'Server listening on port 3000', 'carries appLaunchLogs in activity panel');
  t.equal(state.preview.appLaunchUrl, 'http://localhost:3000', 'carries appLaunchUrl');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 desktop device list and revoke IPC endpoints', async (t) => {
  const initialDevices = [
    { id: 'dev1', name: 'iPhone', secret: 'sec1', approved: true, revoked: false },
    { id: 'dev2', name: 'Android', secret: 'sec2', approved: true, revoked: false }
  ];
  
  const { main, fsMock, electron } = await startMainWithConfig(1139, {
    phoneCompanionDevices: initialDevices
  });

  const getDevicesHandler = electron.ipcHandlers['get-phone-companion-devices'];
  const revokeDeviceHandler = electron.ipcHandlers['revoke-phone-companion-device'];

  t.ok(getDevicesHandler, 'get-phone-companion-devices IPC handler is registered');
  t.ok(revokeDeviceHandler, 'revoke-phone-companion-device IPC handler is registered');

  // Invoke get-phone-companion-devices
  const devices = await getDevicesHandler();
  t.equal(devices.length, 2, 'returns correct number of devices');
  t.equal(devices[0].name, 'iPhone', 'carries device details');

  // Invoke revoke-phone-companion-device
  const revokeResult = await revokeDeviceHandler(null, 'dev1');
  t.equal(revokeResult.success, true, 'revoke operation returns success');
  t.equal(revokeResult.revoked, 'dev1', 'returns revoked deviceId');

  const updatedDevices = await getDevicesHandler();
  const dev1 = updatedDevices.find(d => d.id === 'dev1');
  t.equal(dev1.revoked, true, 'device status is updated to revoked');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 notify IPC reports desktop and phone delivery', async (t) => {
  const pushSubscription = { endpoint: 'https://push.example.test/sub', keys: { p256dh: 'p256dh', auth: 'auth' } };
  const { main, electron, webPushCalls } = await startMainWithConfig(1146, {
    phoneCompanionDevices: [
      { id: 'dev1', name: 'iPhone', secret: 'sec1', approved: true, revoked: false, pushSubscription }
    ]
  });

  const notifyHandler = electron.ipcHandlers['notify-phone'];
  t.ok(notifyHandler, 'notify-phone IPC handler is registered');

  const result = await notifyHandler(null, {
    title: 'Orion AI',
    body: 'Task complete',
    conversationId: 'dispatch-reminder-conversation'
  });
  t.equal(result.success, true, 'notification handler reports overall success');
  t.equal(result.desktop.success, true, 'desktop notification succeeds');
  t.equal(result.phone.sent, 1, 'phone push sends to the subscribed device');
  t.equal(electron.notifications[0].title, 'Orion AI', 'desktop notification carries title');
  t.equal(electron.notifications[0].body, 'Task complete', 'desktop notification carries body');

  const pushSend = webPushCalls.find(call => call.type === 'sendNotification');
  t.ok(pushSend, 'web-push sendNotification is called');
  t.deepEqual(pushSend.subscription, pushSubscription, 'web-push receives the stored subscription');
  t.deepEqual(JSON.parse(pushSend.payload), {
    title: 'Orion AI',
    body: 'Task complete',
    conversationId: 'dispatch-reminder-conversation'
  }, 'web-push payload carries the visible conversation deep-link target');

  const serviceWorker = await request('GET', 1146, '/sw.js');
  t.equal(serviceWorker.statusCode, 200, 'the companion service worker is available');
  t.ok(serviceWorker.text.includes("data: {\n      conversationId"), 'the notification stores its conversation target');
  t.ok(serviceWorker.text.includes("type: 'orion-notification-open'"), 'an already-open companion receives the exact conversation target');
  t.ok(serviceWorker.text.includes("/?conversation="), 'a closed companion opens on a conversation deep link');

  await closeServer(main.getCompanionServer());
});

test('paired phone authenticates VAPID setup, persists its subscription, and receives push', async (t) => {
  const session = { deviceId: 'dev1', secret: 'sec1' };
  const pushSubscription = {
    endpoint: 'https://push.example.test/live-subscription',
    keys: { p256dh: 'phone-p256dh', auth: 'phone-auth' }
  };
  const { main, electron, webPushCalls } = await startMainWithConfig(1156, {
    phoneCompanionDevices: [
      { id: session.deviceId, name: 'Phone', secret: session.secret, approved: true, revoked: false }
    ]
  });

  const unauthenticatedKey = await request('GET', 1156, '/api/vapid-public-key');
  t.equal(unauthenticatedKey.statusCode, 401, 'the protected VAPID endpoint rejects a bare fetch');

  const authenticatedKey = await request('GET', 1156, '/api/vapid-public-key', null, session);
  t.equal(authenticatedKey.statusCode, 200, 'the paired-device request can retrieve the VAPID key');
  t.equal(authenticatedKey.json.enabled, true, 'push is advertised as enabled');
  t.equal(authenticatedKey.json.publicKey, 'test-public-key', 'the browser receives the configured application key');

  const saved = await request('POST', 1156, '/api/push-subscribe', { subscription: pushSubscription }, session);
  t.equal(saved.statusCode, 200, 'the authenticated subscription is persisted');
  t.equal(saved.json.success, true, 'the server confirms subscription persistence');

  const notifyHandler = electron.ipcHandlers['notify-phone'];
  const delivered = await notifyHandler(null, { title: 'Orion AI', body: 'Verified live chain' });
  t.equal(delivered.phone.sent, 1, 'the newly persisted subscription receives the next push');
  const pushSend = webPushCalls.find(call => call.type === 'sendNotification');
  t.deepEqual(pushSend.subscription, pushSubscription, 'delivery uses the subscription saved by the phone endpoint');

  await closeServer(main.getCompanionServer());
});

test('expired push subscription renews without pairing and replays the missed completion', async (t) => {
  const session = { deviceId: 'dev-expired', secret: 'sec-expired' };
  const staleSubscription = {
    endpoint: 'https://fcm.googleapis.com/expired-subscription',
    keys: { p256dh: 'stale-p256dh', auth: 'stale-auth' }
  };
  const freshSubscription = {
    endpoint: 'https://fcm.googleapis.com/fresh-subscription',
    keys: { p256dh: 'fresh-p256dh', auth: 'fresh-auth' }
  };
  const pushCalls = [];
  const expiredError = new Error('Received unexpected response code');
  expiredError.statusCode = 410;
  expiredError.body = 'push subscription has unsubscribed or expired.';
  const webPush = {
    generateVAPIDKeys: () => ({ publicKey: 'test-public-key', privateKey: 'test-private-key' }),
    setVapidDetails: () => {},
    sendNotification: async (subscription, payload) => {
      pushCalls.push({ subscription, payload });
      if (subscription.endpoint === staleSubscription.endpoint) throw expiredError;
    },
    '@global': true,
    '@noCallThru': true
  };
  const { main, electron, fsMock } = await startMainWithConfig(1157, {
    phoneCompanionDevices: [{
      id: session.deviceId,
      name: 'Phone',
      secret: session.secret,
      approved: true,
      revoked: false,
      pushSubscription: staleSubscription,
      pushSubscriptionSavedAt: '2026-08-10T00:00:00.000Z'
    }]
  }, { webPush });

  const notifyHandler = electron.ipcHandlers['notify-phone'];
  const missed = await notifyHandler(null, {
    title: 'Orion AI',
    body: 'Coder completed the task.',
    conversationId: 'dispatch-origin'
  });
  t.equal(missed.phone.sent, 0, 'the expired endpoint is not reported as delivered');
  t.equal(missed.phone.failed, 1, 'the failed device is counted');
  t.match(missed.phone.reason, /expired/i, 'the provider failure is preserved instead of discarded');

  const invalidated = fsMock._config().phoneCompanionDevices.find(device => device.id === session.deviceId);
  t.notOk(invalidated.pushSubscription, 'the expired endpoint is removed');
  t.equal(invalidated.pushSubscriptionNeedsRefresh, true, 'the paired phone is marked for silent renewal');
  t.equal(invalidated.pendingPushNotification.context.conversationId, 'dispatch-origin', 'the missed deep-link notification is retained for replay');

  const state = await request('GET', 1157, '/api/state', null, session);
  t.equal(state.statusCode, 200, 'the existing paired session remains valid');
  t.equal(state.json.device.pushSubscriptionNeedsRefresh, true, 'the phone learns that only its push subscription needs renewal');

  const staleSync = await request('POST', 1157, '/api/push-subscribe', { subscription: staleSubscription }, session);
  t.equal(staleSync.statusCode, 409, 'blindly re-saving the known-dead endpoint is rejected');
  t.equal(staleSync.json.code, 'PUSH_SUBSCRIPTION_REFRESH_REQUIRED', 'the response requests subscription renewal, not re-pairing');

  const renewed = await request('POST', 1157, '/api/push-subscribe', {
    subscription: freshSubscription,
    refreshed: true
  }, session);
  t.equal(renewed.statusCode, 200, 'a fresh subscription is accepted using the existing device session');
  t.equal(renewed.json.replayedNotification, true, 'the missed completion is replayed after renewal');
  t.equal(pushCalls.length, 2, 'one failed delivery and one successful replay occur');
  t.deepEqual(JSON.parse(pushCalls[1].payload), {
    title: 'Orion AI',
    body: 'Coder completed the task.',
    conversationId: 'dispatch-origin'
  }, 'the replay preserves the original completion and conversation target');

  const recovered = fsMock._config().phoneCompanionDevices.find(device => device.id === session.deviceId);
  t.deepEqual(recovered.pushSubscription, freshSubscription, 'the fresh endpoint replaces the expired endpoint');
  t.equal(recovered.pushSubscriptionNeedsRefresh, false, 'the refresh marker clears after renewal');
  t.notOk(recovered.pendingPushNotification, 'the replay receipt clears after successful delivery');

  await closeServer(main.getCompanionServer());
});

test('legacy paired push state gets one silent subscription refresh', async (t) => {
  const session = { deviceId: 'dev-legacy-push', secret: 'sec-legacy-push' };
  const legacySubscription = {
    endpoint: 'https://fcm.googleapis.com/legacy-subscription',
    keys: { p256dh: 'legacy-p256dh', auth: 'legacy-auth' }
  };
  const refreshedSubscription = {
    endpoint: 'https://fcm.googleapis.com/refreshed-subscription',
    keys: { p256dh: 'refreshed-p256dh', auth: 'refreshed-auth' }
  };
  const { main } = await startMainWithConfig(1158, {
    phoneCompanionDevices: [{
      id: session.deviceId,
      name: 'Existing paired phone',
      secret: session.secret,
      approved: true,
      revoked: false,
      pushSubscription: legacySubscription
    }]
  });

  const state = await request('GET', 1158, '/api/state', null, session);
  t.equal(state.statusCode, 200, 'the durable device session is still authenticated');
  t.equal(state.json.device.pushSubscriptionNeedsRefresh, true, 'a legacy endpoint is selected for one silent refresh');
  t.ok(state.json.device.pushSubscriptionRefreshToken, 'the phone receives a stable refresh trigger');

  const blindSync = await request('POST', 1158, '/api/push-subscribe', { subscription: legacySubscription }, session);
  t.equal(blindSync.statusCode, 409, 'the stale endpoint cannot be re-saved as though it were renewed');

  const refreshed = await request('POST', 1158, '/api/push-subscribe', {
    subscription: refreshedSubscription,
    refreshed: true
  }, session);
  t.equal(refreshed.statusCode, 200, 'the same pairing accepts the replacement endpoint');
  const recoveredState = await request('GET', 1158, '/api/state', null, session);
  t.equal(recoveredState.json.device.pushSubscriptionNeedsRefresh, false, 'one successful renewal clears the migration trigger');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 pairing pending and denied states', async (t) => {
  // Test pending (desktop approval required / rate-limited)
  const { main: mainPending } = await startMainWithConfig(1140, { phoneCompanionRequireDesktopApproval: true }, {
    pairingApproval: { approved: false, pending: true }
  });
  const resPending = await request('POST', 1140, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  t.equal(resPending.statusCode, 403, 'pairing pending returns 403');
  t.equal(resPending.json.success, false, 'pairing pending is unsuccessful');
  t.equal(resPending.json.pending, true, 'pairing pending carries pending: true');
  t.equal(resPending.json.error, 'Desktop approval required', 'pairing pending carries desktop approval required error message');
  await closeServer(mainPending.getCompanionServer());

  // Test denied (user rejected pairing request)
  const { main: mainDenied } = await startMainWithConfig(1141, { phoneCompanionRequireDesktopApproval: true }, {
    pairingApproval: { approved: false, pending: false }
  });
  const resDenied = await request('POST', 1141, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  t.equal(resDenied.statusCode, 403, 'pairing denied returns 403');
  t.equal(resDenied.json.success, false, 'pairing denied is unsuccessful');
  t.equal(resDenied.json.pending, false, 'pairing denied carries pending: false');
  t.equal(resDenied.json.error, 'Pairing denied', 'pairing denied carries pairing denied error message');
  await closeServer(mainDenied.getCompanionServer());
});

test('phone Dispatch cancellation and supervisor failures preserve truthful outcomes', (t) => {
  const submitStart = rendererSource.indexOf('async function submitPhoneCompanionPromptOnce');
  const submitEnd = rendererSource.indexOf('\nwindow.steerPhoneCompanionTask', submitStart);
  const submitPath = rendererSource.slice(submitStart, submitEnd);
  const classifyIndex = submitPath.indexOf('const semanticIntent = await classifyCurrentConversationIntent');
  const cancelIndex = submitPath.indexOf('await cancelOwnedTaskRequestedInPrompt(');
  const clarificationIndex = submitPath.indexOf('if (conv.awaitingClarification && pendingReplyTaskId)');
  const busyIndex = submitPath.indexOf('if (isGlobalRunning)');

  t.ok(
    classifyIndex >= 0
      && cancelIndex > classifyIndex
      && submitPath.slice(cancelIndex, cancelIndex + 220).includes('semanticIntent'),
    'phone prompt uses the shared structured classification for owned-task cancellation'
  );
  t.ok(
    cancelIndex < clarificationIndex && cancelIndex < busyIndex,
    'phone cancellation runs before continuation or global busy routing'
  );
  t.ok(
    submitPath.includes('if (supervisorResult && supervisorResult.success === false)'),
    'phone does not turn a structured supervisor failure into success'
  );
  t.ok(
    submitPath.includes('activeRunTaskId === launchedTaskId')
      || rendererSource.includes('activeRunTaskId === launchedTaskId'),
    'phone supervision is gated by the exact active task identity'
  );
  t.ok(
    submitPath.includes("RendererSemanticIntentRouter.canRespondDuringActiveRun(semanticIntent, 'orion')")
      && submitPath.includes('await respondOrionConversationally('),
    'a conversational phone turn uses the lightweight Dispatch response while another run is active'
  );
  t.ok(
    submitPath.includes('queued: false')
      && submitPath.indexOf('await respondOrionConversationally(') < submitPath.indexOf('const queued = pendingReplyTaskId'),
    'the conversational branch returns before durable task creation'
  );
  t.end();
});

test('new phone Coder conversations submit their initial prompt exactly once', t => {
  const html = companionHtml();
  const start = html.indexOf('async function startNewPhoneChat');
  const end = html.indexOf('// New Chat: send', start);
  const flow = html.slice(start, end);
  t.ok(flow.includes("companionFetch('/api/conversations/new'"), 'new chat sends through the create endpoint');
  t.equal((flow.match(/companionFetch\('\/api\/prompt'/g) || []).length, 0,
    'new Coder flow does not post the same prompt again');
  t.ok(flow.includes('requestId:'), 'new chat supplies an idempotency key');
  t.end();
});

test('phone Operator mode remains Operator across navigation, creation, and specialist controls', t => {
  const html = companionHtml();
  t.ok(html.includes('data-drawer-destination="operator"'), 'Operator is reachable from the phone drawer');
  t.ok(html.includes('id="mode-toggle-operator"'), 'Operator has a phone mode control');
  t.ok(
    html.includes("return mode === 'coder' || mode === 'operator' ? mode : 'orion';"),
    'phone navigation normalizes the complete three-role mode enum'
  );
  t.ok(
    html.includes("companionMode = normalizeCompanionMode(target.mode || 'orion');"),
    'opening an Operator conversation does not bounce it into Dispatch'
  );
  t.ok(
    html.includes("const isSpecialist = mode === 'coder' || mode === 'operator';"),
    'Operator receives the same task status and logs navigation as Coder'
  );
  t.ok(
    rendererSource.includes("mode: requestedMode === 'operator' ? 'operator' : (normalizedProjectPath ? 'coder' : requestedMode)"),
    'the renderer persists an explicitly requested Operator conversation as Operator'
  );
  t.ok(
    rendererSource.includes("conversationMode(conv) === 'coder' || conversationMode(conv) === 'operator'"),
    'standalone Operator conversations receive a durable standalone workspace'
  );
  t.end();
});

test('phone Dispatch status derives queued, active, and review presentation from the durable task', t => {
  const html = companionHtml();
  const stateRenderStart = html.indexOf('const supervisedTask = activeConversationMode');
  const stateRenderEnd = html.indexOf('// Needs-attention cards', stateRenderStart);
  const stateRender = html.slice(stateRenderStart, stateRenderEnd);
  t.ok(stateRender.includes('selectSupervisedTask('), 'phone selects the supervised task from orchestrationTasks');
  t.ok(stateRender.includes('{ delegatedOnly: true }'), 'phone presents only cross-conversation Coder tasks as supervised work');
  t.ok(stateRender.includes('state.activeTaskId'), 'phone preserves taskId as the presentation identity');
  t.ok(stateRender.includes('describeSupervisedTaskPresentation'), 'phone uses the shared lifecycle presentation contract');
  t.ok(stateRender.includes('supervisedPresentation.agentState'), 'header state follows the durable task presentation');
  t.ok(stateRender.includes('supervisedPresentation.label'), 'current task card follows the durable task presentation');
  t.ok(stateRender.includes('supervisedTask.targetConversationId'), 'Coder navigation is enriched from the durable task target');
  t.notOk(stateRender.includes('coderTaskStillOwned'), 'background Coder visibility no longer requires a fragile launched-conversation pointer');
  t.ok(
    stateRender.includes('supervisedPresentation.isOngoing'),
    'queued and active tasks remain visible even when globalRunning briefly becomes false'
  );
  t.end();
});

// ── Phone model + reasoning pickers at the composer ────────────────────────────
// Both selections must be reachable at the input box on the phone, not buried in the Status
// tab, and must proxy the desktop's state so the two surfaces never disagree.

test('phone composer carries model and reasoning pickers next to the input', t => {
  const html = companionHtml();
  const composerStart = html.indexOf('<div class="composer-model-bar">');
  t.ok(composerStart > 0, 'a picker bar exists in the composer area');
  const formStart = html.indexOf('<form id="prompt-form">');
  t.ok(composerStart < formStart, 'the pickers sit directly above the prompt form');
  const bar = html.slice(composerStart, formStart);
  t.ok(bar.includes('id="composer-model-select"'), 'the model picker is at the composer');
  t.ok(bar.includes('id="composer-reasoning-select"'), 'the reasoning picker is at the composer');
  t.ok(html.includes('.composer-model-bar select.reasoning-forced'),
    'a forced reasoning level gets distinct styling so the cost is visible');
  t.end();
});

test('phone pickers proxy the desktop selection through /api/model', t => {
  const html = companionHtml();
  const start = html.indexOf('async function loadPhoneModelList');
  const end = html.indexOf('// ── Clarifying-questions chat card', start);
  const flow = html.slice(start, end);

  t.ok(flow.includes('fillModelOptions(composerModelSelect'), 'the composer model list is populated');
  t.ok(flow.includes('data.reasoningLevels'), 'reasoning levels come from the desktop, not hardcoded twice');
  t.ok(flow.includes("postModelSelection({ reasoning }"), 'a reasoning change posts to the shared endpoint');
  t.ok(flow.includes("postModelSelection({ model }"), 'a model change posts to the shared endpoint');
  t.ok(flow.includes('await loadPhoneModelList(); // revert to the desktop\'s actual state'),
    'a rejected change reverts to the desktop truth instead of lying');
  t.ok(flow.includes('wirePhoneModelSelect(phoneModelSelect, composerModelSelect)')
    && flow.includes('wirePhoneModelSelect(composerModelSelect, phoneModelSelect)'),
    'the Status-tab and composer model selects stay mirrored');
  t.end();
});

test('paired phone can change the desktop reasoning level through the real model endpoint', async t => {
  const port = 1157;
  const { main, electron } = await startMainWithConfig(port);
  try {
    const pair = await request('POST', port, '/api/pair', {
      pairingCode: 'pair-code-123456',
      deviceName: 'Pixel'
    });
    const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };
    const response = await request('POST', port, '/api/model', { reasoning: 'high' }, session);

    t.equal(response.statusCode, 200, 'the authenticated reasoning update succeeds');
    t.equal(response.json && response.json.success, true, 'the endpoint reports success');
    t.ok(
      electron.calls.some(script => script.includes('setPhoneCompanionReasoning') && script.includes('"high"')),
      'the endpoint invokes the allowlisted desktop reasoning bridge with the selected level'
    );
  } finally {
    await closeServer(main.getCompanionServer());
  }
  t.end();
});

test('a reasoning level picked on the desktop reaches the phone through status sync', t => {
  const html = companionHtml();
  // Guarded, not unconditional: an unguarded reflect let a poll issued before the user's own
  // POST landed carry the desktop's stale value back down and revert their selection.
  t.ok(/if \(state\.reasoning && !syncSuppressed\('reasoning', state\.reasoning, state\.selectionRevisions\)\)/.test(html),
    'status polling reflects a desktop-side reasoning change, unless the phone has an unechoed local pick');
  t.ok(html.includes('composerModelSelect].forEach(select =>'),
    'status polling syncs both model selects');
  t.ok(/if \(state\.model && !syncSuppressed\('model', state\.model, state\.selectionRevisions\)\)/.test(html),
    'and the model sync carries the same guard');
  t.ok(html.includes('shouldRejectSelectionRevision(acceptedSelectionRevision[field], revision)'),
    'an older poll remains rejected even after a newer POST has been acknowledged');
  t.ok(html.includes('acknowledgeSelectionResponse(body.model ? \'model\' : \'reasoning\', data)'),
    'the successful POST advances the phone-side accepted revision before forced refresh');
  t.end();
});

test('a pre-save revision-zero poll cannot overwrite an acknowledged phone selection', t => {
  const html = companionHtml();
  const start = html.indexOf('function shouldRejectSelectionRevision(');
  const end = html.indexOf('\n  }', start);
  t.ok(start > 0 && end > start, 'the generated phone client contains the revision-ordering guard');
  const source = html.slice(start, end + 4);
  const shouldReject = new Function(`${source}; return shouldRejectSelectionRevision;`)();

  t.equal(shouldReject(0, 0), false, 'an unversioned initial state remains compatible');
  t.equal(shouldReject(100, 0), true, 'revision zero is stale after a saved selection is acknowledged');
  t.equal(shouldReject(100, 99), true, 'any older positive revision is also stale');
  t.equal(shouldReject(100, 100), false, 'the acknowledged revision may be rendered');
  t.equal(shouldReject(100, 101), false, 'a genuinely newer desktop change may win');
  t.end();
});

test('assistant screenshot references render directly in phone chat through the authenticated image endpoint', t => {
  const html = companionHtml();
  t.ok(html.includes('data-chat-image-path'), 'conversation-scoped image references get an inline image element');
  t.ok(html.includes("companionFetch('/api/chat-image?conversationId='"), 'image bytes use the paired companion fetch path');
  t.ok(html.includes('URL.createObjectURL(await response.blob())'), 'the fetched image is displayed without persisting base64 in state');
  t.ok(html.includes('releaseChatImageObjectUrls()'), 'object URLs are released when the transcript rerenders');
  t.ok(html.includes('attempt < 2'), 'transient image fetch failures receive bounded retries');
  t.ok(html.includes('Image unavailable — tap to retry'), 'a persistent failure stays visible and user-retryable');
  t.notOk(html.includes("figure.style.display = 'none'"), 'a failed first fetch cannot silently erase the attachment');
  t.end();
});

test('paired phone retrieves a conversation-scoped Coder screenshot through the real image route', async t => {
  const port = 1156;
  const bytes = Buffer.from('real-phone-image-bytes');
  const { main } = await startMainWithConfig(port, {}, {
    state: {
      conversationId: 'dispatch-image',
      title: 'Desktop inspection',
      conversations: [{ id: 'dispatch-image', title: 'Desktop inspection', active: true }],
      messages: []
    },
    chatImage: {
      success: true,
      data: bytes.toString('base64'),
      mimeType: 'image/png'
    }
  });
  try {
    const pair = await request('POST', port, '/api/pair', {
      pairingCode: 'pair-code-123456',
      deviceName: 'Pixel'
    });
    const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };
    await request('GET', port, '/api/state', null, session);
    const image = await request(
      'GET',
      port,
      '/api/chat-image?conversationId=dispatch-image&path=' + encodeURIComponent('orion-artifact://coder/codex.png'),
      null,
      session
    );
    t.equal(image.statusCode, 200, 'the authenticated image route serves the attachment');
    t.equal(image.headers['content-type'], 'image/png', 'the original image MIME type is preserved');
    t.equal(Buffer.from(image.text, 'binary').toString(), bytes.toString(), 'the relayed screenshot bytes are intact');
  } finally {
    await closeServer(main.getCompanionServer());
  }
  t.end();
});
