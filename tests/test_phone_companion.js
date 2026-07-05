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
  const ipcHandlers = {};
  return {
    calls,
    ipcHandlers,
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
              if (script.includes('submitPhoneCompanionClarification')) return handlers.clarificationSubmit || { success: true, queued: false };
              if (script.includes('stopPhoneCompanionTask')) return { success: true, stopped: true };
              if (script.includes('resumePhoneCompanionTask')) return { success: true, queued: true };
              if (script.includes('discoverPhoneCompanionSkills')) return handlers.skills || { skills: [{ name: 'demo-skill', description: 'demo' }], count: 1 };
              if (script.includes('runPhoneCompanionSkill')) return handlers.skillRun || { success: true, outputs: { ok: true } };
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
    atomicWriteFileSync: require('fs').writeFileSync,
    getConfigPath: () => require('path').join(require('os').tmpdir(), 'orion-config-test.json'),
    '@global': true,
    '@noCallThru': true
  };
  const electron = makeElectronMock(handlers);
  // Make the os mock global so ipc-server.js uses the controlled network address.
  const osMock = {
    networkInterfaces: () => ({
      WiFi: [{ family: 'IPv4', internal: false, address: '192.168.50.25' }],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
    }),
    homedir: require('os').homedir,
    tmpdir: require('os').tmpdir,
    '@global': true
  };
  const main = proxyquire('../main.js', {
    electron: electron.mock,
    './lib/config': configMock,
    os: osMock
  });
  main.resetCompanionServer();
  main.startPhoneCompanionServer();
  await new Promise(resolve => setTimeout(resolve, 150));
  return { main, fsMock, electron };
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

test('Phone Companion v2 serves pairing shell but protects APIs', async (t) => {
  const { main } = await startMainWithConfig(1131);

  const root = await request('GET', 1131, '/');
  t.equal(root.statusCode, 200, 'root shell is available without token-in-URL auth');
  t.notOk(root.text.includes('phoneCompanionToken'), 'root shell does not expose legacy token');
  t.ok(root.text.includes('<title>Orion</title>'), 'root shell serves the Orion mobile UI');
  t.ok(root.text.includes('Recents'), 'root shell includes Codex-style recents');
  t.ok(root.text.includes('Projects'), 'root shell includes project selection');
  t.ok(root.text.includes('Mission Control'), 'root shell includes mobile mission context');
  t.ok(root.text.includes('state.operationalContext'), 'mobile shell renders operational context from state');
  t.notOk(root.text.includes('Start a new Orion task:'), 'new task no longer requires a prompt/name dialog');

  const manifest = await request('GET', 1131, '/manifest.webmanifest');
  t.equal(manifest.statusCode, 200, 'manifest is available without token query string');

  const marked = await request('GET', 1131, '/marked.min.js');
  t.equal(marked.statusCode, 200, 'Markdown parser asset is available before phone auth');
  t.ok(/marked/i.test(marked.text), 'Markdown parser asset returns JavaScript content');

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

test('Phone Companion v2 auto-pairs valid LAN pairing links by default', async (t) => {
  const { main, electron } = await startMainWithConfig(1142);

  const pair = await request('POST', 1142, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'Phone' });
  t.equal(pair.statusCode, 200, 'valid pairing code creates a session without desktop confirmation');
  t.ok(pair.json.sessionSecret, 'auto-pair returns a session secret');
  t.notOk(electron.calls.some(call => call.includes('approvePhoneCompanionPairing')), 'default pairing does not call desktop confirmation bridge');

  await closeServer(main.getCompanionServer());
});

test('Phone Companion v2 task controls and preview endpoints reach desktop bridge', async (t) => {
  const { main, electron } = await startMainWithConfig(1133);
  const pair = await request('POST', 1133, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'iPhone' });
  const session = { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };

  const switchRes = await request('POST', 1133, '/api/conversations/switch', { conversationId: 'conv2' }, session);
  t.equal(switchRes.statusCode, 200, 'task switching endpoint succeeds');

  const newTask = await request('POST', 1133, '/api/conversations/new', { prompt: 'new task', projectPath: 'C:\\Projects\\OrionTarget' }, session);
  t.equal(newTask.statusCode, 200, 'new task endpoint succeeds');

  const prompt = await request('POST', 1133, '/api/prompt', { prompt: 'hello', projectPath: 'C:\\Projects\\OrionTarget' }, session);
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
  t.ok(electron.calls.some(call => call.includes('C:\\\\Projects\\\\OrionTarget')), 'new task endpoint forwards selected project path');
  t.ok(electron.calls.some(call => call.includes('submitPhoneCompanionPrompt') && call.includes('C:\\\\Projects\\\\OrionTarget')), 'prompt endpoint forwards selected project path');
  t.ok(electron.calls.some(call => call.includes('submitPhoneCompanionPrompt')), 'desktop bridge submitted prompt');
  t.ok(electron.calls.some(call => call.includes('approvePhoneCompanionPlan')), 'desktop bridge approved plan');

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

