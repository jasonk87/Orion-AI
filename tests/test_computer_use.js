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

const DISPLAY = {
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  sourceWidth: 1920,
  sourceHeight: 1080
};

test('computer actions map screenshot pixels into the primary display coordinate space', t => {
  const action = computerUse.normalizeComputerAction({
    action: 'click',
    targetDescription: 'the visible project row',
    x: 960,
    y: 540,
    sourceWidth: 1920,
    sourceHeight: 1080
  }, DISPLAY);
  t.equal(action.x, 768, 'x maps from screenshot pixels to display coordinates');
  t.equal(action.y, 432, 'y maps from screenshot pixels to display coordinates');
  t.equal(action.button, 'left', 'left click is the safe default');
  t.equal(action.captureAfter, true, 'the resulting screen is captured by default');
  t.end();
});

test('computer action validation rejects blind, out-of-bounds, and unsafe system actions', t => {
  t.throws(() => computerUse.normalizeComputerAction({ action: 'click', x: 1, y: 1 }, DISPLAY),
    /targetDescription/, 'every action needs an auditable visible target');
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'click', targetDescription: 'outside', x: 1920, y: 1, sourceWidth: 1920, sourceHeight: 1080
  }, DISPLAY), /x must be between/, 'coordinates outside the captured image are refused');
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'key', targetDescription: 'system launcher', key: 'r', modifiers: ['win']
  }, DISPLAY), /Windows-key shortcuts are blocked/, 'Windows-key launch shortcuts cannot bypass tool safety');
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'key', targetDescription: 'close app', key: 'f4', modifiers: ['alt']
  }, DISPLAY), /Alt\+F4 is blocked/, 'a shortcut that may discard unsaved work is blocked');
  t.throws(() => computerUse.normalizeComputerAction({
    action: 'type', targetDescription: 'field', text: 'x'.repeat(4001)
  }, DISPLAY), /limited to 4000/, 'unbounded typing is refused');
  t.end();
});

test('typed text is base64-encoded before it enters the PowerShell script', t => {
  const action = computerUse.normalizeComputerAction({
    action: 'type',
    targetDescription: 'a visible text field',
    text: "hello'); Remove-Item C:\\important -Force; ('",
    intervalMs: 0
  }, DISPLAY);
  const script = computerUse.buildPowerShellInputScript(action);
  t.notOk(script.includes(action.text), 'literal text cannot break out into PowerShell source');
  t.ok(script.includes('FromBase64String'), 'the action payload is decoded as data at runtime');
  t.ok(script.includes('protected target process'), 'keyboard input is blocked for terminals and protected system targets');
  t.end();
});

test('conversation screenshot references cannot cross conversation boundaries', t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-chat-image-scope-'));
  const fileTools = proxyquire('../lib/ipc-file-tools', {
    electron: { app: { getPath: () => userData } }
  });
  const written = fileTools.writeConversationArtifactBuffer('conv_one', 'screenshots/result.png', Buffer.from('png'));
  const own = fileTools.readWorkspaceFileBase64('', written.artifactRef, 'conv_one');
  t.equal(own.mimeType, 'image/png', 'the owning conversation can load its screenshot');
  t.throws(
    () => fileTools.readWorkspaceFileBase64('', written.artifactRef, 'conv_two'),
    /different conversation/,
    'another conversation cannot reuse the artifact reference'
  );
  fs.rmSync(userData, { recursive: true, force: true });
  t.end();
});

test('computer action IPC hides Orion, performs one action, captures the result, and restores Orion', async t => {
  let handler = null;
  const calls = [];
  const oldWindow = shared.mainWindow;
  shared.mainWindow = {
    isDestroyed: () => false,
    hide: () => calls.push('hide'),
    showInactive: () => calls.push('showInactive')
  };
  computerUse.registerHandlers({
    handle: (name, fn) => {
      if (name === 'computer-action') handler = fn;
    }
  }, {
    screen: { getPrimaryDisplay: () => ({ bounds: DISPLAY.bounds, size: DISPLAY.bounds, scaleFactor: 1.25 }) },
    runInput: async action => {
      calls.push(`input:${action.action}`);
      return { success: true, targetProcess: 'Code', targetWindow: 'Codex' };
    },
    captureDesktopScreenshot: async (workspace, destination, prefix, options) => {
      calls.push(`capture:${options.conversationId}`);
      return {
        rel: 'orion-artifact://conv_1/screenshots/result.png',
        png: Buffer.from('png'),
        size: { width: 1920, height: 1080 },
        artifactPath: 'C:\\artifacts\\result.png',
        artifactRelativePath: 'screenshots/result.png'
      };
    }
  });

  const result = await handler(null, {
    workspacePath: 'C:\\workspace',
    conversationId: 'conv_1',
    action: {
      action: 'click', targetDescription: 'the Codex project', x: 100, y: 100,
      sourceWidth: 1920, sourceHeight: 1080, settleMs: 0
    }
  });
  shared.mainWindow = oldWindow;

  t.ok(result.success, 'the bounded action succeeds');
  t.equal(result.path, 'orion-artifact://conv_1/screenshots/result.png', 'the resulting screenshot stays conversation-scoped');
  t.deepEqual(calls, ['hide', 'input:click', 'capture:conv_1', 'showInactive'], 'Orion never overlays the target during input or capture');
  t.end();
});

test('an active task-scoped control session prevents per-action Orion restoration', async t => {
  let handler = null;
  const calls = [];
  const oldWindow = shared.mainWindow;
  const oldSession = shared.operatorControlSession;
  shared.operatorControlSession = { active: true, sessionId: 'task_operator_active' };
  shared.mainWindow = {
    isDestroyed: () => false,
    hide: () => calls.push('hide'),
    showInactive: () => calls.push('showInactive')
  };
  computerUse.registerHandlers({
    handle: (name, fn) => { if (name === 'computer-action') handler = fn; }
  }, {
    screen: { getPrimaryDisplay: () => ({ bounds: DISPLAY.bounds, size: DISPLAY.bounds, scaleFactor: 1.25 }) },
    runInput: async action => {
      calls.push(`input:${action.action}`);
      return { success: true, targetProcess: 'Game', targetWindow: 'This is Life' };
    },
    captureDesktopScreenshot: async () => {
      calls.push('capture');
      return {
        rel: 'orion-artifact://conv_1/screenshots/result.png',
        png: Buffer.from('png'),
        size: { width: 1920, height: 1080 },
        artifactPath: 'C:\\artifacts\\result.png',
        artifactRelativePath: 'screenshots/result.png'
      };
    }
  });
  try {
    const result = await handler(null, {
      workspacePath: 'C:\\workspace',
      conversationId: 'conv_1',
      action: {
        action: 'click', targetDescription: 'the visible game menu', x: 100, y: 100,
        sourceWidth: 1920, sourceHeight: 1080, settleMs: 0
      }
    });
    t.ok(result.success, 'the action still succeeds inside the control session');
    t.deepEqual(calls, ['input:click', 'capture'], 'the action neither re-hides nor restores Orion between controls');
  } finally {
    shared.mainWindow = oldWindow;
    shared.operatorControlSession = oldSession;
  }
  t.end();
});

test('attach_image records a safe reference with owning-conversation provenance', async t => {
  const oldApi = global.window.api;
  let readArgs = null;
  global.window.api = {
    readWorkspaceFileBase64: async (...args) => {
      readArgs = args;
      return { success: true, mimeType: 'image/png', data: Buffer.from('png').toString('base64') };
    }
  };
  const executionContext = { attachedResponseImages: [] };
  const result = await agent.executeTool(
    'attach_image',
    { path: 'orion-artifact://conv_one/screenshots/result.png', alt: 'Codex project opened' },
    'C:\\workspace',
    {},
    { id: 'conv_one', mode: 'coder' },
    executionContext
  );
  global.window.api = oldApi;

  t.ok(result.success, 'the image is attached by reference');
  t.equal(readArgs[2], 'conv_one', 'the file read is scoped to the owning conversation');
  t.equal(executionContext.attachedResponseImages[0].sourceConversationId, 'conv_one', 'provenance survives persistence and delegation');
  t.notOk(Object.prototype.hasOwnProperty.call(executionContext.attachedResponseImages[0], 'data'), 'base64 bytes are not copied into the conversation record');
  t.end();
});

test('agent refuses blind desktop input and resets inspection after every action', async t => {
  const oldApi = global.window.api;
  let sentAction = null;
  global.window.api = {
    computerAction: async (workspace, action, conversationId) => {
      sentAction = { workspace, action, conversationId };
      return { success: true, path: 'orion-artifact://conv_one/screenshots/after.png', width: 100, height: 80 };
    }
  };
  const snapshot = {
    path: 'orion-artifact://conv_one/screenshots/before.png',
    width: 100,
    height: 80,
    capturedAt: Date.now(),
    inspectedAt: 0
  };
  const executionContext = { lastDesktopSnapshot: snapshot };
  const args = { action: 'click', targetDescription: 'the visible project row', x: 50, y: 40 };

  let blindError = null;
  try {
    await agent.executeTool('computer_action', args, 'C:\\workspace', {}, { id: 'conv_one', mode: 'coder' }, executionContext);
  } catch (error) {
    blindError = error;
  }
  t.match(String(blindError && blindError.message || ''), /requires inspect_screenshot_with_model/,
    'a capture alone cannot authorize a blind click');
  snapshot.inspectedAt = Date.now();
  const result = await agent.executeTool('computer_action', args, 'C:\\workspace', {}, { id: 'conv_one', mode: 'coder' }, executionContext);
  global.window.api = oldApi;

  t.ok(result.success, 'an inspected target can receive one bounded action');
  t.equal(sentAction.conversationId, 'conv_one', 'the action stays bound to the Coder conversation');
  t.equal(sentAction.action.sourceWidth, 100, 'coordinates retain the inspected screenshot width');
  t.equal(executionContext.lastDesktopSnapshot.inspectedAt, 0, 'the resulting screen must be inspected before the next action');
  t.end();
});

test('tool contracts expose computer use only to Coder and image attachment to both modes', t => {
  agent.__setActiveConversationModeForTest('coder');
  const coderTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  agent.__setActiveConversationModeForTest('orion');
  const dispatchTools = agent.buildAgentToolDeclarations().map(tool => tool.name);

  t.ok(coderTools.includes('computer_action'), 'Coder receives native computer control');
  t.notOk(dispatchTools.includes('computer_action'), 'Dispatch cannot operate the native desktop');
  t.ok(coderTools.includes('attach_image'), 'Coder can attach a captured result to chat');
  t.ok(dispatchTools.includes('attach_image'), 'Dispatch can attach a browser screenshot or existing safe image');
  t.ok(agent.PLANNING_BLOCKED_TOOLS.includes('computer_action'), 'planning blocks native input');
  t.ok(agent.PLAN_REVISION_BLOCKED_TOOLS.includes('computer_action'), 'plan revision blocks native input');
  t.ok(agent.REVIEW_ONLY_BLOCKED_TOOLS.includes('computer_action'), 'review-only work blocks native input');
  agent.__setActiveConversationModeForTest('orion');
  t.end();
});
