'use strict';

// Mechanical half of item 7 (Phase 3 Operator plan): computer_action gained two capabilities it
// previously lacked entirely.
//   - drag: normalizeComputerAction only accepted move/click/scroll/type/key. Dragging a file,
//     resizing a window, or moving a slider was impossible.
//   - multi-monitor targeting: capture and action both hardcoded the primary display. On a
//     multi-monitor machine, Orion could only ever see and act on one screen.
// Both are threaded through the same capture-then-inspect-then-act contract everything else in
// this area uses: displayId comes from a prior capture_screen, never a freestanding parameter the
// model invents, so an action can't land on a display the model never actually looked at.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire');

global.window = {};
global.fetch = async () => ({ ok: false });

const computerUse = require('../lib/ipc-computer-use');
const shared = require('../lib/shared');
const agent = require('../agent');

const PRIMARY_DISPLAY = {
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  sourceWidth: 1920,
  sourceHeight: 1080
};

// ── normalizeComputerAction: drag ─────────────────────────────────────────────────────────────

test('drag scales both the start and end point into display coordinates', t => {
  const action = computerUse.normalizeComputerAction({
    action: 'drag',
    targetDescription: 'drag the file icon onto the folder',
    x: 100, y: 100, endX: 900, endY: 500,
    sourceWidth: 1920, sourceHeight: 1080
  }, PRIMARY_DISPLAY);
  t.equal(action.x, 80, 'start x maps from screenshot pixels to display coordinates');
  t.equal(action.y, 80, 'start y maps from screenshot pixels to display coordinates');
  t.equal(action.endX, 720, 'end x maps independently from the start point');
  t.equal(action.endY, 400, 'end y maps independently from the start point');
  t.equal(action.steps, 12, 'a sane default step count is applied when unspecified');
  t.equal(action.stepDelayMs, 15, 'a sane default step delay is applied when unspecified');
  t.end();
});

test('drag rejects a start point identical to the end point', t => {
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'drag', targetDescription: 'no-op drag', x: 100, y: 100, endX: 100, endY: 100,
    sourceWidth: 1920, sourceHeight: 1080
  }, PRIMARY_DISPLAY), /endX\/endY different/, 'a drag with no movement is rejected in favor of click');
  t.end();
});

test('drag requires an end point, not just a start point', t => {
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'drag', targetDescription: 'missing end', x: 100, y: 100,
    sourceWidth: 1920, sourceHeight: 1080
  }, PRIMARY_DISPLAY), /endX must be/, 'endX/endY are validated the same way x/y are');
  t.end();
});

test('drag honors custom steps and stepDelayMs within their bounds', t => {
  const action = computerUse.normalizeComputerAction({
    action: 'drag', targetDescription: 'slow careful drag', x: 0, y: 0, endX: 500, endY: 500,
    steps: 30, stepDelayMs: 40, sourceWidth: 1920, sourceHeight: 1080
  }, PRIMARY_DISPLAY);
  t.equal(action.steps, 30);
  t.equal(action.stepDelayMs, 40);
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'drag', targetDescription: 'too many steps', x: 0, y: 0, endX: 500, endY: 500,
    steps: 999, sourceWidth: 1920, sourceHeight: 1080
  }, PRIMARY_DISPLAY), /steps must be between/, 'steps is bounded to prevent runaway PowerShell loops');
  t.end();
});

test('the PowerShell script dispatches drag to a real interpolated-motion method, not a bare jump', t => {
  const action = computerUse.normalizeComputerAction({
    action: 'drag', targetDescription: 'drag test', x: 10, y: 10, endX: 200, endY: 200,
    sourceWidth: 1920, sourceHeight: 1080
  }, PRIMARY_DISPLAY);
  const script = computerUse.buildPowerShellInputScript(action);
  t.ok(script.includes("'drag'"), 'the switch statement has a drag case');
  t.ok(script.includes('[OrionComputerInput]::Drag('), 'drag dispatches to a dedicated Drag method');
  t.ok(script.includes('public static void Drag('), 'the C# type defines Drag');
  t.ok(script.includes('MOUSEEVENTF_LEFTDOWN') && script.includes('MOUSEEVENTF_LEFTUP'),
    'Drag is built from real press/release events rather than a single teleport');
  t.end();
});

// ── resolveTargetDisplay ──────────────────────────────────────────────────────────────────────

test('resolveTargetDisplay defaults only omitted display ids to primary and rejects stale explicit ids', t => {
  const primary = { id: 1, label: 'Primary' };
  const secondary = { id: 2, label: 'Secondary' };
  const electronScreen = { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary, secondary] };
  t.equal(computerUse.resolveTargetDisplay(electronScreen, undefined), primary, 'undefined id -> primary');
  t.equal(computerUse.resolveTargetDisplay(electronScreen, ''), primary, 'empty string id -> primary');
  t.equal(computerUse.resolveTargetDisplay(electronScreen, null), primary, 'null id -> primary');
  t.throws(
    () => computerUse.resolveTargetDisplay(electronScreen, '999-unplugged'),
    error => error && error.code === 'STALE_DISPLAY_ID' && /fresh screen/i.test(error.message),
    'an explicit missing monitor fails closed and requires fresh evidence'
  );
  t.end();
});

test('resolveTargetDisplay picks the matching non-primary display when a valid id is given', t => {
  const primary = { id: 1, label: 'Primary' };
  const secondary = { id: 2, label: 'Secondary' };
  const electronScreen = { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary, secondary] };
  t.equal(computerUse.resolveTargetDisplay(electronScreen, 2), secondary, 'a numeric id matches');
  t.equal(computerUse.resolveTargetDisplay(electronScreen, '2'), secondary, 'a string id matches a numeric display id');
  t.end();
});

// ── performComputerAction: multi-monitor targeting ────────────────────────────────────────────

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, size: { width: 1536, height: 864 }, scaleFactor: 1.25 };
const SECONDARY = { id: 2, bounds: { x: 1536, y: 0, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 1 };
function twoDisplayScreen() {
  return { getPrimaryDisplay: () => PRIMARY, getAllDisplays: () => [PRIMARY, SECONDARY] };
}

test('performComputerAction targets the primary display when no displayId is given', async t => {
  let sentAction = null;
  const result = await computerUse.performComputerAction({
    action: 'click', targetDescription: 'primary target', x: 960, y: 540, sourceWidth: 1920, sourceHeight: 1080
  }, {
    screen: twoDisplayScreen(),
    runInput: async action => { sentAction = action; return { success: true }; }
  });
  t.equal(result.displayId, 1, 'the result reports which display it actually acted on');
  t.equal(sentAction.x, 768, 'coordinates map into the primary display bounds');
  t.end();
});

test('performComputerAction targets a named secondary display, mapping into its own bounds', async t => {
  let sentAction = null;
  const result = await computerUse.performComputerAction({
    action: 'click', targetDescription: 'secondary target', x: 640, y: 360, sourceWidth: 1280, sourceHeight: 720
  }, {
    screen: twoDisplayScreen(),
    displayId: 2,
    runInput: async action => { sentAction = action; return { success: true }; }
  });
  t.equal(result.displayId, 2, 'the result reports the secondary display');
  t.equal(sentAction.x, 1536 + 640, 'the click lands inside the secondary display bounds, offset from the primary');
  t.equal(sentAction.y, 360, 'y maps within the secondary display, unscaled since its scaleFactor is 1');
  t.end();
});

// ── registerHandlers: displayId threads from the IPC payload through to both input and capture ──

test('the computer-action IPC handler threads displayId to both the input action and the follow-up capture', async t => {
  let handler = null;
  const calls = [];
  const oldWindow = shared.mainWindow;
  shared.mainWindow = { isDestroyed: () => false, hide: () => calls.push('hide'), showInactive: () => calls.push('showInactive') };
  computerUse.registerHandlers({
    handle: (name, fn) => { if (name === 'computer-action') handler = fn; }
  }, {
    screen: twoDisplayScreen(),
    runInput: async action => { calls.push(`input@${action.x},${action.y}`); return { success: true }; },
    captureDesktopScreenshot: async (workspace, destination, prefix, options) => {
      calls.push(`capture:displayId=${options.displayId}`);
      return { rel: 'screenshots/after.png', png: Buffer.from('png'), size: { width: 1280, height: 720 }, artifactPath: 'C:\\x', artifactRelativePath: 'screenshots/after.png' };
    }
  });

  const result = await handler(null, {
    workspacePath: 'C:\\workspace',
    conversationId: 'conv_1',
    displayId: 2,
    action: { action: 'click', targetDescription: 'secondary monitor target', x: 100, y: 100, sourceWidth: 1280, sourceHeight: 720, settleMs: 0 }
  });
  shared.mainWindow = oldWindow;

  t.ok(result.success);
  t.equal(result.displayId, 2, 'the response reports which display was actually used');
  t.ok(calls.some(c => c === 'capture:displayId=2'), 'the after-action screenshot targets the same display the input action used, not the primary');
  t.end();
});

// ── lib/ipc-shell captureDesktopScreenshot: multi-monitor source selection ──────────────────────

test('captureDesktopScreenshot picks the source matching a requested displayId and reports availableDisplays', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-multimonitor-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-multimonitor-ws-'));
  const primary = { id: 'A', label: 'Built-in', bounds: { x: 0, y: 0, width: 1536, height: 864 }, size: { width: 1536, height: 864 }, scaleFactor: 1 };
  const secondary = { id: 'B', label: 'External', bounds: { x: 1536, y: 0, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 1 };
  const tinyPng = Buffer.from('89504e470d0a1a0a', 'hex');

  const ipcShell = proxyquire('../lib/ipc-shell', {
    electron: {
      screen: { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary, secondary] },
      desktopCapturer: {
        getSources: async () => [
          { display_id: 'A', thumbnail: { isEmpty: () => false, toPNG: () => tinyPng, getSize: () => ({ width: 1536, height: 864 }), toBitmap: () => Buffer.alloc(4) } },
          { display_id: 'B', thumbnail: { isEmpty: () => false, toPNG: () => tinyPng, getSize: () => ({ width: 1280, height: 720 }), toBitmap: () => Buffer.alloc(4) } }
        ]
      },
      app: { getPath: () => userData }
    }
  });

  const primaryShot = await ipcShell.captureDesktopScreenshot(workspace, '', 'test', {});
  t.equal(primaryShot.displayId, 'A', 'omitting displayId captures the primary display');
  t.equal(primaryShot.size.width, 1536, 'the primary source thumbnail dimensions are returned');

  const secondaryShot = await ipcShell.captureDesktopScreenshot(workspace, '', 'test', { displayId: 'B' });
  t.equal(secondaryShot.displayId, 'B', 'an explicit displayId captures the matching source');
  t.equal(secondaryShot.size.width, 1280, 'the secondary source thumbnail dimensions are returned, not the primary\'s');
  t.deepEqual(
    secondaryShot.availableDisplays.map(d => d.id).sort(),
    ['A', 'B'],
    'availableDisplays lists every connected monitor so a later capture_screen can target one by id'
  );
  t.ok(secondaryShot.availableDisplays.find(d => d.id === 'A').primary, 'the primary display is flagged as such in availableDisplays');

  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

test('captureDesktopScreenshot rejects a stale explicit displayId instead of capturing an uninspected monitor', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-multimonitor-stale-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-multimonitor-stale-ws-'));
  const primary = { id: 'A', label: 'Built-in', bounds: { x: 0, y: 0, width: 1536, height: 864 }, size: { width: 1536, height: 864 }, scaleFactor: 1 };
  const tinyPng = Buffer.from('89504e470d0a1a0a', 'hex');

  const ipcShell = proxyquire('../lib/ipc-shell', {
    electron: {
      screen: { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary] },
      desktopCapturer: {
        getSources: async () => [{ display_id: 'A', thumbnail: { isEmpty: () => false, toPNG: () => tinyPng, getSize: () => ({ width: 1536, height: 864 }), toBitmap: () => Buffer.alloc(4) } }]
      },
      app: { getPath: () => userData }
    }
  });

  try {
    await ipcShell.captureDesktopScreenshot(workspace, '', 'test', { displayId: 'unplugged-monitor' });
    t.fail('a disappeared inspected monitor must not fall back to primary');
  } catch (error) {
    t.match(error.message, /no longer connected/i,
      'a disappeared inspected monitor requires a new capture decision');
    t.equal(error.code, 'STALE_DISPLAY_ID', 'the failure has a stable machine-readable code');
  }

  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

// ── agent.js: capture_screen stores displayId; computer_action forwards and preserves it ────────

test('capture_screen stores the returned displayId and availableDisplays on the desktop snapshot', async t => {
  const oldApi = global.window.api;
  global.window.api = {
    captureScreen: async (workspace, options) => ({
      success: true, path: 'screenshots/a.png', width: 1280, height: 720,
      displayId: 'B', availableDisplays: [{ id: 'A', primary: true }, { id: 'B', primary: false }]
    })
  };
  const executionContext = {};
  const result = await agent.executeTool('capture_screen', {}, 'C:\\workspace', {}, { id: 'conv_x', mode: 'operator' }, executionContext);
  global.window.api = oldApi;

  t.ok(result.success);
  t.equal(executionContext.lastDesktopSnapshot.displayId, 'B', 'the snapshot remembers exactly which display was captured');
  t.equal(executionContext.lastDesktopSnapshot.availableDisplays.length, 2, 'the available-displays list is carried forward for a future capture_screen call');
  t.end();
});

test('computer_action forwards the inspected snapshot\'s displayId to window.api.computerAction and preserves it afterward', async t => {
  const oldApi = global.window.api;
  let forwardedDisplayId = null;
  global.window.api = {
    computerAction: async (workspace, action, conversationId, destination, displayId) => {
      forwardedDisplayId = displayId;
      return { success: true, path: 'screenshots/after.png', width: 1280, height: 720 };
    }
  };
  const snapshot = {
    path: 'screenshots/before.png', width: 1280, height: 720,
    capturedAt: Date.now(), inspectedAt: Date.now(), displayId: 'B', availableDisplays: [{ id: 'B', primary: false }]
  };
  const executionContext = { lastDesktopSnapshot: snapshot };
  const result = await agent.executeTool(
    'computer_action',
    { action: 'click', targetDescription: 'a control on the external monitor', x: 50, y: 40 },
    'C:\\workspace', {}, { id: 'conv_x', mode: 'operator' }, executionContext
  );
  global.window.api = oldApi;

  t.ok(result.success);
  t.equal(forwardedDisplayId, 'B', 'the action is sent to the same display the inspected screenshot came from, not the primary by default');
  t.equal(executionContext.lastDesktopSnapshot.displayId, 'B', 'the follow-up snapshot remembers the display too, since result.displayId was not echoed back in this mock');
  t.end();
});

test('computer_action tool declaration advertises drag with its endpoint parameters', t => {
  agent.__setActiveConversationModeForTest('coder');
  const tool = agent.buildAgentToolDeclarations().find(tool => tool.name === 'computer_action');
  agent.__setActiveConversationModeForTest('orion');
  t.ok(tool, 'computer_action is still declared');
  t.ok(tool.parameters.properties.action.enum.includes('drag'), 'drag is an offered action');
  t.ok(tool.parameters.properties.endX && tool.parameters.properties.endY, 'drag endpoint parameters are declared');
  t.end();
});

test('capture_screen tool declaration advertises displayId for multi-monitor targeting', t => {
  agent.__setActiveConversationModeForTest('coder');
  const tool = agent.buildAgentToolDeclarations().find(tool => tool.name === 'capture_screen');
  agent.__setActiveConversationModeForTest('orion');
  t.ok(tool, 'capture_screen is still declared');
  t.ok(tool.parameters.properties.displayId, 'displayId is an offered parameter');
  t.end();
});
