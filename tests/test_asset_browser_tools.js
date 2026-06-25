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
    'inspect_screenshot',
    'compare_screenshot_to_goal'
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
