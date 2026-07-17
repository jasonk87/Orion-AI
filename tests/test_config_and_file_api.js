/**
 * Tests for:
 *   1. Config write queue — concurrent writeAppConfig calls must not race on the .tmp file
 *   2. atomicWriteFileSync — writes then renames; cleans up on error
 *   3. /api/files/read endpoint — path validation, content serving, auth
 *   4. /api/prompt file attachment — fileContent/fileName prepended to prompt
 */
const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire').noPreserveCache();
const http = require('http');
const { applyReadOptions, getBinaryReadError } = require('../lib/ipc-file-tools');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orion-cfg-test-'));
}

test('read-file applies maxChars after selecting a line range', (t) => {
  const source = Array.from({ length: 200 }, (_, index) => `line-${index + 1}-${'x'.repeat(20)}`).join('\n');
  const result = applyReadOptions(source, { startLine: 25, endLine: 175, maxChars: 300 });
  t.ok(result.startsWith('25: line-25-'), 'the requested range is still numbered from its real source line');
  t.ok(result.includes('Read truncated at 300 characters'), 'a large ranged read cannot bypass the context cap');
  t.ok(result.length < 600, 'the returned range remains bounded after adding the continuation note');
  t.end();
});

test('read-file redirects images and binary assets to safe inspection tools', (t) => {
  t.ok(/inspect_screenshot_with_model/.test(getBinaryReadError('public/concept.png')), 'images are routed to model vision instead of UTF-8 decoding');
  t.ok(/inspect_binary_asset/.test(getBinaryReadError('assets/model.glb') || getBinaryReadError('assets/archive.zip')), 'binary assets are routed to metadata inspection');
  t.equal(getBinaryReadError('assets/icon.svg'), '', 'text-based SVG source remains available to code inspection');
  t.equal(getBinaryReadError('src/app.js'), '', 'ordinary source files remain readable as text');
  t.end();
});

function makeConfigModule(tmpDir) {
  return proxyquire('../lib/config', {
    electron: { app: { getPath: () => tmpDir } }
  });
}

function request(method, port, urlPath, body, session) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      method,
      hostname: '127.0.0.1',
      port,
      path: urlPath,
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

function makeElectronMock(handlers = {}) {
  const calls = [];
  return {
    calls,
    mock: {
      app: { whenReady: () => ({ then: (cb) => { cb(); } }), on: () => {} },
      BrowserWindow: class {
        constructor() {
          this.webContents = {
            executeJavaScript: async (script) => {
              calls.push(script);
              if (script.includes('getPhoneCompanionState')) return handlers.state || {
                conversationId: 'conv1', title: 'T', conversations: [], tasks: [], messages: [],
                latestOutput: '', preview: {}
              };
              if (script.includes('readWorkspaceFileForPhone')) return handlers.readFile || { success: false, error: 'File not found' };
              if (script.includes('submitPhoneCompanionPrompt')) return handlers.prompt || { success: true, queued: false };
              return { success: true };
            },
            send: () => {}
          };
        }
        loadFile() {} on() {} isDestroyed() { return false; }
        static getAllWindows() { return []; }
      },
      ipcMain: { on: () => {}, handle: () => {} },
      dialog: {}
    }
  };
}

async function startServer(port, handlers = {}) {
  const configData = {
    phoneCompanionPort: port,
    phoneCompanionPairingCode: 'pair-code-123456',
    phoneCompanionPairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    phoneCompanionDevices: []
  };
  const configMock = {
    readAppConfig: () => ({ ...configData }),
    writeAppConfig: (cfg) => { Object.assign(configData, cfg); },
    atomicWriteFileSync: require('fs').writeFileSync,
    getConfigPath: () => path.join(os.tmpdir(), `orion-config-test-${port}.json`),
    '@global': true,
    '@noCallThru': true
  };
  const osMock = {
    networkInterfaces: () => ({ WiFi: [{ family: 'IPv4', internal: false, address: '127.0.0.1' }] }),
    homedir: os.homedir,
    tmpdir: os.tmpdir,
    '@global': true
  };
  const electron = makeElectronMock(handlers);
  const main = proxyquire('../main.js', {
    electron: electron.mock,
    './lib/config': configMock,
    os: osMock
  });
  main.resetCompanionServer();
  main.startPhoneCompanionServer();
  await new Promise(resolve => setTimeout(resolve, 150));
  return { main, electron };
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

async function pairDevice(port) {
  const pair = await request('POST', port, '/api/pair', { pairingCode: 'pair-code-123456', deviceName: 'TestPhone' });
  return { deviceId: pair.json.device.id, secret: pair.json.sessionSecret };
}

// ── atomicWriteFileSync ───────────────────────────────────────────────────────

test('atomicWriteFileSync: writes content and cleans up tmp file', (t) => {
  const tmpDir = makeTmpDir();
  const cfg = makeConfigModule(tmpDir);
  const targetPath = path.join(tmpDir, 'out.txt');
  cfg.atomicWriteFileSync(targetPath, 'hello world', 'utf8');
  t.equal(fs.readFileSync(targetPath, 'utf8'), 'hello world', 'file contains written content');
  t.notOk(fs.existsSync(targetPath + '.tmp'), 'temp file is cleaned up after successful write');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  t.end();
});

test('atomicWriteFileSync: overwrites existing file atomically', (t) => {
  const tmpDir = makeTmpDir();
  const cfg = makeConfigModule(tmpDir);
  const targetPath = path.join(tmpDir, 'out.txt');
  cfg.atomicWriteFileSync(targetPath, 'first', 'utf8');
  cfg.atomicWriteFileSync(targetPath, 'second', 'utf8');
  t.equal(fs.readFileSync(targetPath, 'utf8'), 'second', 'second write overwrites first');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  t.end();
});

// ── writeAppConfig serialization ──────────────────────────────────────────────

test('writeAppConfig: concurrent calls are serialized (no race corruption)', async (t) => {
  const tmpDir = makeTmpDir();
  const cfg = makeConfigModule(tmpDir);

  // Seed an initial config
  cfg.writeAppConfig({ geminiApiKey: 'key-seed', phoneCompanionPort: 45678 });
  await new Promise(resolve => setTimeout(resolve, 50));

  // Fire 10 concurrent writes with different keys
  const writes = Array.from({ length: 10 }, (_, i) =>
    cfg.writeAppConfig({ [`testKey${i}`]: `value${i}` })
  );
  await Promise.all(writes);

  // All keys should be present (no write should have been lost)
  const result = cfg.readAppConfig();
  for (let i = 0; i < 10; i++) {
    t.equal(result[`testKey${i}`], `value${i}`, `key testKey${i} survived concurrent write`);
  }

  // API key must survive (protected field not wiped by partial writes)
  t.equal(result.geminiApiKey, 'key-seed', 'protected API key survives concurrent writes');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  t.end();
});

test('writeAppConfig: phoneCompanionPort 5000 is migrated to default', async (t) => {
  const tmpDir = makeTmpDir();
  const cfg = makeConfigModule(tmpDir);
  cfg.writeAppConfig({ phoneCompanionPort: 5000 });
  await new Promise(resolve => setTimeout(resolve, 30));
  const result = cfg.readAppConfig();
  t.notEqual(result.phoneCompanionPort, 5000, 'legacy port 5000 is migrated away');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  t.end();
});

// ── /api/files/read ───────────────────────────────────────────────────────────

test('/api/files/read: requires auth', async (t) => {
  const { main } = await startServer(1230);
  const res = await request('GET', 1230, '/api/files/read?path=/tmp/anything');
  t.equal(res.statusCode, 401, 'unauthenticated request is rejected');
  await closeServer(main.getCompanionServer());
  t.end();
});

test('/api/files/read: missing path returns 400', async (t) => {
  const { main } = await startServer(1231);
  const session = await pairDevice(1231);
  const res = await request('GET', 1231, '/api/files/read', null, session);
  t.equal(res.statusCode, 400, 'missing path returns 400');
  t.ok(res.json && res.json.error, 'error message is included');
  await closeServer(main.getCompanionServer());
  t.end();
});

test('/api/files/read: returns 404 when renderer reports file not found', async (t) => {
  const { main } = await startServer(1232, {
    readFile: { success: false, error: 'File not found' }
  });
  const session = await pairDevice(1232);
  const res = await request('GET', 1232, '/api/files/read?path=/some/file.txt', null, session);
  t.equal(res.statusCode, 404, 'renderer failure → 404');
  await closeServer(main.getCompanionServer());
  t.end();
});

test('/api/files/read: serves text file content with correct headers', async (t) => {
  const { main, electron } = await startServer(1233, {
    readFile: { success: true, content: 'hello file', encoding: 'utf8', mimeType: 'text/plain' }
  });
  const session = await pairDevice(1233);
  const res = await request('GET', 1233, '/api/files/read?path=/workspace/readme.txt', null, session);
  t.equal(res.statusCode, 200, 'successful read returns 200');
  t.equal(res.text, 'hello file', 'response body contains file content');
  t.ok(electron.calls.some(c => c.includes('readWorkspaceFileForPhone')), 'renderer function was called');
  await closeServer(main.getCompanionServer());
  t.end();
});

// ── /api/prompt with file attachment ─────────────────────────────────────────

test('/api/prompt: file attachment is prepended to prompt sent to renderer', async (t) => {
  const { main, electron } = await startServer(1234, {
    prompt: { success: true, queued: false }
  });
  const session = await pairDevice(1234);

  const res = await request('POST', 1234, '/api/prompt', {
    prompt: 'what does this file do?',
    fileContent: 'console.log("hello");',
    fileName: 'hello.js'
  }, session);

  t.equal(res.statusCode, 200, 'prompt with attachment succeeds');
  const promptCall = electron.calls.find(c => c.includes('submitPhoneCompanionPrompt'));
  t.ok(promptCall, 'submitPhoneCompanionPrompt was called');
  t.ok(promptCall.includes('hello.js'), 'file name appears in prompt forwarded to renderer');
  t.ok(promptCall.includes('console.log'), 'file content appears in prompt forwarded to renderer');
  t.ok(promptCall.includes('what does this file do'), 'original user prompt is preserved');
  await closeServer(main.getCompanionServer());
  t.end();
});

test('/api/prompt: oversized file attachment is truncated', async (t) => {
  const { main, electron } = await startServer(1235, {
    prompt: { success: true, queued: false }
  });
  const session = await pairDevice(1235);

  const bigContent = 'x'.repeat(90000); // > 80000 char limit
  const res = await request('POST', 1235, '/api/prompt', {
    prompt: 'review this',
    fileContent: bigContent,
    fileName: 'big.txt'
  }, session);

  t.equal(res.statusCode, 200, 'oversized attachment still succeeds');
  const promptCall = electron.calls.find(c => c.includes('submitPhoneCompanionPrompt'));
  t.ok(promptCall.includes('truncated'), 'truncation marker appears in prompt');
  await closeServer(main.getCompanionServer());
  t.end();
});

test('/api/prompt: prompt without file attachment is not modified', async (t) => {
  const { main, electron } = await startServer(1236, {
    prompt: { success: true, queued: false }
  });
  const session = await pairDevice(1236);

  await request('POST', 1236, '/api/prompt', { prompt: 'just a plain prompt' }, session);
  const promptCall = electron.calls.find(c => c.includes('submitPhoneCompanionPrompt'));
  t.ok(promptCall, 'submitPhoneCompanionPrompt was called');
  t.notOk(promptCall.includes('Attached file'), 'no attachment prefix when no file is sent');
  t.ok(promptCall.includes('just a plain prompt'), 'original prompt is preserved');
  await closeServer(main.getCompanionServer());
  t.end();
});
