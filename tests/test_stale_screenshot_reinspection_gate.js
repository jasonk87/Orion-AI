'use strict';

process.env.NODE_ENV = 'test';

// Screenshot evidence is immutable and may answer multiple static questions. What it cannot do is
// prove a state transition that occurred after it was captured. These tests exercise that boundary
// through the real agent tool path: same-frame reuse is allowed before action, while
// OperatorExecutionPolicy rejects pre-action evidence after a visible action changes the epoch.

global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const agent = require('../agent');
const policy = require('../operator-execution-policy');

function stubWindowForInspection({ onRead, onInspectFetch } = {}) {
  global.window = {
    api: {
      readWorkspaceFileBase64: onRead || (async () => ({ success: true, data: 'ZmFrZQ==', mimeType: 'image/png' })),
      recordInspectedScreenshot: async () => ({ success: true })
    }
  };
  global.fetch = onInspectFetch || (async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'A blank desktop.', elements: [] }) }] } }]
    })
  }));
}

test('the same immutable screenshot can answer multiple static questions before any action', async t => {
  stubWindowForInspection();
  const conversation = { id: 'conv_stale_1', mode: 'operator' };
  const operatorPolicyState = policy.createState('desktop');
  policy.recordToolResult(operatorPolicyState, 'capture_screen', { success: true, path: 'screenshots/gameplay.png' });
  const executionContext = { operatorExecutionSurface: 'desktop', operatorPolicyState };

  const first = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/gameplay.png', goal: 'Confirm the game is in real gameplay, not a menu.' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' },
    conversation, executionContext
  );
  t.ok(first && first.success !== false, 'the first inspection of a never-before-seen path succeeds');

  const second = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/gameplay.png', goal: 'Read the visible controls in the upper-right corner.' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' },
    conversation, executionContext
  );
  t.ok(second && second.success !== false, 'a second static question can reuse the immutable evidence');
  t.end();
});

test('pre-action screenshot evidence cannot prove the result of a later visible action', async t => {
  stubWindowForInspection();
  const conversation = { id: 'conv_stale_2', mode: 'operator' };
  const operatorPolicyState = policy.createState('desktop');
  policy.recordToolResult(operatorPolicyState, 'capture_screen', { success: true, path: 'screenshots/before.png' });
  const executionContext = { operatorExecutionSurface: 'desktop', operatorPolicyState };
  await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/before.png', goal: 'Locate the player before movement.' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  policy.recordToolResult(operatorPolicyState, 'computer_action', {
    success: true,
    path: 'screenshots/after.png'
  });
  const blocked = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/before.png', goal: 'Did movement happen?' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  t.equal(blocked.success, false, 'the stale frame is refused after the screen action');
  t.equal(blocked.blocked, 'operator_stale_screenshot_reinspection', 'the action-aware freshness gate owns the refusal');
  t.match(blocked.error, /predates the latest visible action/i, 'the recovery guidance explains the real evidence boundary');
  t.end();
});

test('a fresh capture_screen producing a new path clears the way to inspect again', async t => {
  const oldWindow = global.window;
  let capturePath = 'screenshots/before.png';
  global.window = {
    api: {
      captureScreen: async () => ({ success: true, path: capturePath, width: 800, height: 600 }),
      readWorkspaceFileBase64: async () => ({ success: true, data: 'ZmFrZQ==', mimeType: 'image/png' }),
      recordInspectedScreenshot: async () => ({ success: true })
    }
  };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'desk', elements: [] }) }] } }]
    })
  });
  const conversation = { id: 'conv_stale_3', mode: 'operator' };
  const executionContext = {};

  await agent.executeTool('capture_screen', {}, 'C:\\workspace', {}, conversation, executionContext);
  await agent.executeTool(
    'inspect_screenshot_with_model', { path: capturePath, goal: 'confirm gameplay' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );

  // A real action (or, as here, simply a fresh capture_screen call) always produces a new,
  // uniquely timestamped path - see lib/ipc-shell.js. Simulate that by advancing capturePath.
  capturePath = 'screenshots/after.png';
  await agent.executeTool('capture_screen', {}, 'C:\\workspace', {}, conversation, executionContext);

  const secondInspection = await agent.executeTool(
    'inspect_screenshot_with_model', { path: capturePath, goal: 'did movement happen?' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  global.window = oldWindow;
  t.ok(secondInspection && secondInspection.success !== false, 'inspecting a genuinely new capture path succeeds even though a different path was inspected earlier');
  t.end();
});

test('a failed inspection does not permanently block retrying the same path', async t => {
  const conversation = { id: 'conv_stale_4', mode: 'operator' };
  const executionContext = {};
  stubWindowForInspection({
    onRead: async () => { throw new Error('disk read failed'); }
  });
  let threw = null;
  try {
    await agent.executeTool(
      'inspect_screenshot_with_model', { path: 'screenshots/flaky.png', goal: 'confirm state' },
      'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
    );
  } catch (error) { threw = error; }
  t.ok(threw, 'the first attempt genuinely failed (simulated read error)');

  // Now let the read succeed - the earlier failure must not have marked the path as "already judged".
  stubWindowForInspection();
  const retry = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/flaky.png', goal: 'confirm state' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  t.ok(retry && retry.success !== false, 'a retry after a failed (not completed) inspection is allowed, not permanently blocked');
  t.end();
});

test('a path alias does not prevent legitimate static reinspection', async t => {
  stubWindowForInspection();
  const conversation = { id: 'conv_stale_5', mode: 'operator' };
  const executionContext = {};
  await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/Case.png', goal: 'first look' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  const second = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots\\CASE.PNG', goal: 'second static detail, same file' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  t.ok(second && second.success !== false, 'path spelling is irrelevant when no intervening action made the evidence stale');
  t.end();
});

test('two different conversations may independently inspect the same immutable artifact name', async t => {
  stubWindowForInspection();
  const conversationA = { id: 'conv_stale_a', mode: 'operator' };
  const conversationB = { id: 'conv_stale_b', mode: 'operator' };
  const executionContextA = {};
  const executionContextB = {};
  await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/shared-name.png', goal: 'look' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversationA, executionContextA
  );
  const inOtherRun = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/shared-name.png', goal: 'look' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversationB, executionContextB
  );
  t.ok(inOtherRun && inOtherRun.success !== false, 'a separate executionContext (a separate run) is not blocked by another run inspecting a same-named path');
  t.end();
});
