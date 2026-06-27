const test = require('tape');
const fs = require('fs');
const path = require('path');
const os = require('os');
const proxyquire = require('proxyquire');

global.window = {};
global.fetch = async () => ({ ok: false });
const agent = require('../agent.js');
const operational = require('../operational-context.js');

const main = proxyquire('../main.js', {
  electron: {
    app: {
      whenReady: () => ({ then: () => {} }),
      on: () => {},
      getPath: () => os.tmpdir()
    },
    BrowserWindow: class {
      constructor() {}
      loadFile() {}
      isDestroyed() { return true; }
      static getAllWindows() { return []; }
      get webContents() {
        return {
          send: () => {},
          executeJavaScript: async () => ({})
        };
      }
    },
    ipcMain: {
      on: () => {},
      handle: () => {}
    },
    dialog: {}
  }
});

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orion-assets-'));
}

test('agent exposes general asset, browser, and visual tools without hardcoded workflow', (t) => {
  const source = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  [
    'download_file',
    'inspect_archive',
    'extract_archive',
    'inspect_binary_asset',
    'list_asset_metadata',
    'open_url',
    'search_web',
    'click_element',
    'fill_input',
    'navigate_back',
    'download_from_page',
    'wait_for_page',
    'take_screenshot',
    'preview_app',
    'capture_screen',
    'inspect_screenshot',
    'compare_screenshot_to_goal',
    'inspect_screenshot_with_model'
  ].forEach(toolName => {
    t.ok(source.includes(`name: '${toolName}'`) || source.includes(`case '${toolName}'`), `${toolName} is registered as a general tool`);
  });

  t.ok(source.includes('...ASSET_BROWSER_VISUAL_TOOL_DECLARATIONS'), 'shared tool declarations are registered for providers');
  t.notOk(/campfire[_ -]?mode|MMORPG|search\s*→\s*download\s*→\s*import\s*→\s*place/i.test(source), 'source does not contain hardcoded campfire/MMORPG asset workflow');
  t.end();
});

test('binary asset inspection and metadata listing are generic workspace capabilities', (t) => {
  const workspace = makeWorkspace();
  const assetDir = path.join(workspace, 'assets');
  fs.mkdirSync(assetDir, { recursive: true });

  const glb = Buffer.alloc(20);
  glb.write('glTF', 0, 'utf8');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(20, 8);
  fs.writeFileSync(path.join(assetDir, 'campfire.glb'), glb);
  fs.writeFileSync(path.join(assetDir, 'texture.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

  const inspected = main.inspectBinaryAssetInWorkspace(workspace, 'assets/campfire.glb');
  t.equal(inspected.kind, 'glb', 'detects GLB asset generically');
  t.equal(inspected.details.version, 2, 'reads GLB version');

  const metadata = main.listAssetMetadataInWorkspace(workspace, 'assets');
  t.equal(metadata.count, 2, 'lists asset-like files');
  t.ok(metadata.assets.some(item => item.path.endsWith('campfire.glb')), 'metadata includes model asset');
  t.ok(metadata.assets.some(item => item.path.endsWith('texture.png')), 'metadata includes texture asset');
  t.end();
});

test('asset acquisition evidence can be promoted into operational context discoveries', (t) => {
  let state = operational.createEmptyContext(new Date('2026-06-25T00:00:00Z'));
  state = operational.applyAction(state, 'update_mission_context', {
    mission: 'Add a campfire to a fantasy village.',
    winConditions: ['Campfire asset acquired', 'Scene visually verified']
  }, '2026-06-25T00:00:01Z').state;

  state = operational.applyAction(state, 'record_tool_result', {
    toolName: 'search_web',
    success: true,
    summary: 'Search results found reusable campfire GLB assets.'
  }, '2026-06-25T00:00:02Z').state;

  const discovery = agent.buildDiscoveryFromToolOutcome(
    'download_file',
    { url: 'https://example.com/campfire.glb' },
    { success: true, url: 'https://example.com/campfire.glb', path: 'assets/downloads/campfire.glb', summary: 'Downloaded campfire GLB asset.' },
    { success: true, summary: 'Downloaded campfire GLB asset.' }
  );

  state = operational.applyAction(state, 'promote_discovery', discovery, '2026-06-25T00:00:03Z').state;

  t.equal(state.latestEvidence.length, 1, 'tool evidence is retained as latest evidence');
  t.ok(state.discoveries.some(item => item.category === 'asset_discovery'), 'asset discovery is retained generically');
  t.ok(state.discoveries.some(item => item.text.includes('assets/downloads/campfire.glb')), 'discovery records useful asset path');
  t.end();
});

test('visual verification tools can represent Three.js preview evidence without pretending certainty', (t) => {
  const workspace = makeWorkspace();
  fs.mkdirSync(path.join(workspace, '.orion', 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: { dev: 'vite' },
    dependencies: { three: '^0.170.0' }
  }, null, 2));
  fs.writeFileSync(path.join(workspace, '.orion', 'screenshots', 'preview.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

  const comparison = main.compareScreenshotToGoalInWorkspace(
    workspace,
    '.orion/screenshots/preview.png',
    'campfire appears in the fantasy village scene',
    'The screenshot shows a visible campfire model in the village plaza and it fits the warm fantasy scene.'
  );

  t.equal(comparison.status, 'appears_satisfied', 'can record a satisfied screenshot judgment from supplied visual observations');
  t.ok(comparison.evidence.includes('visible campfire'), 'keeps visual evidence');

  const uncertain = main.compareScreenshotToGoalInWorkspace(
    workspace,
    '.orion/screenshots/preview.png',
    'campfire appears in the fantasy village scene',
    ''
  );
  t.equal(uncertain.status, 'needs_more_visual_evidence', 'does not claim visual completion without observations');
  t.end();
});

test('active Gemini screenshot inspection sends inline image data and returns visual evidence', async (t) => {
  const originalFetch = global.fetch;
  let requestUrl = null;
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                status: 'appears_satisfied',
                confidence: 0.82,
                observations: ['A campfire is visible near the center of the village scene.'],
                missing: [],
                recommendation: 'Record visual evidence and continue polishing if needed.'
              })
            }]
          }
        }]
      })
    };
  };

  const result = await agent.inspectScreenshotWithModel({
    imageBase64: Buffer.from('fake-png').toString('base64'),
    mimeType: 'image/png',
    path: '.orion/screenshots/preview.png',
    goal: 'campfire appears in the fantasy village scene',
    modelName: 'gemini-2.5-flash',
    apiKey: 'test-key'
  });

  t.equal(result.status, 'appears_satisfied', 'returns structured Gemini visual status');
  t.equal(result.confidence, 0.82, 'returns structured confidence');
  t.ok(result.evidence.includes('campfire is visible'), 'returns visual evidence observations');
  t.ok(requestUrl.includes('/models/gemini-2.5-flash:generateContent'), 'uses the active chat model in the Gemini request URL');
  t.equal(requestBody.contents[0].parts[1].inline_data.mime_type, 'image/png', 'sends screenshot as Gemini inline image data');
  t.ok(requestBody.contents[0].parts[1].inline_data.data, 'includes base64 image data');

  global.fetch = originalFetch;
  t.end();
});

test('active Ollama screenshot inspection sends screenshot to the chat model', async (t) => {
  const originalFetch = global.fetch;
  let requestUrl = null;
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            status: 'appears_satisfied',
            confidence: 0.74,
            observations: ['The app window is visible in the desktop screenshot.'],
            missing: [],
            recommendation: 'Use this screenshot as visual evidence.'
          })
        }
      })
    };
  };

  const imageBase64 = Buffer.from('fake-png').toString('base64');
  const result = await agent.inspectScreenshotWithModel({
    imageBase64,
    mimeType: 'image/png',
    path: '.orion/screenshots/preview.png',
    goal: 'desktop app is visible',
    modelName: 'llava:latest'
  });

  t.equal(result.status, 'appears_satisfied', 'returns structured Ollama visual status');
  t.equal(requestUrl, 'http://localhost:11434/api/chat', 'uses Ollama chat endpoint for local chat models');
  t.equal(requestBody.model, 'llava:latest', 'uses the active Ollama chat model');
  t.equal(requestBody.messages[0].images[0], imageBase64, 'sends screenshot as Ollama image data');
  t.notOk(Object.prototype.hasOwnProperty.call(requestBody, 'modelName'), 'does not send a separate modelName argument');

  global.fetch = originalFetch;
  t.end();
});

test('Gemini fallback records the model actually used for the current response', async (t) => {
  const originalFetch = global.fetch;
  const requestUrls = [];
  const warnings = [];
  global.fetch = async (url, options) => {
    requestUrls.push(url);
    if (requestUrls.length === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({
          error: {
            message: 'The model is currently experiencing high demand. Please try again later.'
          }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'fallback response' }]
          }
        }]
      })
    };
  };

  const result = await agent.callGeminiAPI(
    [{ role: 'user', parts: [{ text: 'hello' }] }],
    'gemini-2.5-flash-lite',
    'test-key',
    warning => warnings.push(warning),
    true
  );

  t.ok(requestUrls[0].includes('/models/gemini-2.5-flash-lite:generateContent'), 'first request uses the selected model');
  t.ok(requestUrls[1].includes('/models/gemini-2.5-flash:generateContent'), 'fallback request uses the escalated model');
  t.equal(result._orionActiveModelName, 'gemini-2.5-flash', 'records the model that produced the response');
  t.ok(warnings.some(warning => warning.includes('Temporarily switching this request to gemini-2.5-flash')), 'emits fallback warning');

  global.fetch = originalFetch;
  t.end();
});

test('Gemini monthly spend cap fails fast instead of retrying', async (t) => {
  const originalFetch = global.fetch;
  const requestUrls = [];
  const warnings = [];
  global.fetch = async (url, options) => {
    requestUrls.push(url);
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.'
        }
      })
    };
  };

  try {
    await agent.callGeminiAPI(
      [{ role: 'user', parts: [{ text: 'hello' }] }],
      'gemini-2.5-flash',
      'test-key',
      warning => warnings.push(warning),
      true
    );
    t.fail('monthly spend cap should throw');
  } catch (error) {
    t.ok(error.message.includes('monthly spending cap'), 'throws the real spend-cap message');
  }

  t.equal(requestUrls.length, 1, 'does not retry a hard spend-cap 429');
  t.ok(warnings.some(warning => warning.includes('stopping retries')), 'warns that retries are stopped');

  global.fetch = originalFetch;
  t.end();
});

test('screenshot tool prefers the active run model over the selected default', async (t) => {
  const originalFetch = global.fetch;
  const originalApi = global.window.api;
  let requestUrl = null;
  global.window.api = {
    readWorkspaceFileBase64: async () => ({
      success: true,
      data: Buffer.from('fake-png').toString('base64'),
      mimeType: 'image/png'
    })
  };
  global.fetch = async (url, options) => {
    requestUrl = url;
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                status: 'appears_satisfied',
                confidence: 0.8,
                observations: ['The screenshot is readable.'],
                missing: [],
                recommendation: 'Continue.'
              })
            }]
          }
        }]
      })
    };
  };

  const result = await agent.executeTool(
    'inspect_screenshot_with_model',
    { path: '.orion/screenshots/preview.png', goal: 'desktop app is visible' },
    makeWorkspace(),
    {
      modelName: 'gemini-2.5-flash-lite',
      activeRunModelName: 'gemini-2.5-flash',
      geminiApiKey: 'test-key'
    },
    { id: 'conversation-1' }
  );

  t.equal(result.status, 'appears_satisfied', 'tool returns screenshot inspection result');
  t.ok(requestUrl.includes('/models/gemini-2.5-flash:generateContent'), 'uses the active run model instead of the selected default');

  global.fetch = originalFetch;
  global.window.api = originalApi;
  t.end();
});
