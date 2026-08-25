'use strict';

// Regression coverage for a real playtest bug: Operator handed off to play "This is Life" (a
// separate tcod roguelike), confirmed via inspect_screenshot_with_model that it was in real
// gameplay, then - without calling capture_screen again - called inspect_screenshot_with_model a
// SECOND time on the exact same screenshot path with a new goal ("did movement happen?"). That
// judged an image against itself: meaningless, but nothing in the code stopped it.
//
// The existing state-freshness gate (lib/screenshot-similarity.js, operator-execution-policy.js's
// 'operator_stale_screenshot_reinspection' check) protects a different, narrower case: it only
// treats a screenshot as stale once a SCREEN_ACTION_TOOLS call (computer_action, open_application,
// click_ui_element, open_chrome_favorite) has been recorded. It does not fire when zero screen
// actions have been recorded yet - which is exactly the reported scenario, and is also exactly
// what happens whenever real input bypasses those tools entirely (the second bug in this pair:
// Operator shelling out to PowerShell for keystrokes, invisible to that policy layer). That gate
// is also Operator-mode-only; Coder has the same computer_action/inspect_screenshot_with_model
// pair available to it with no equivalent protection at all.
//
// This file covers the fix: a mode-agnostic, path-identity-based hard gate directly in agent.js's
// inspect_screenshot_with_model case. It tracks which resolved screenshot paths have already had a
// COMPLETED inspect_screenshot_with_model call in this run (executionContext.inspectedScreenshotPaths,
// a Set) and refuses to inspect the same path again until a fresh capture_screen (which always
// writes a new, uniquely timestamped path - see lib/ipc-shell.js's captureDesktopScreenshot) produces
// a new one. This is real state tracking keyed on file identity, never on parsing or pattern-matching
// the goal text, so it cannot be defeated by rephrasing the goal and cannot misfire on two genuinely
// different screenshots.

global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const agent = require('../agent');

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

test('a second inspect_screenshot_with_model call on the identical resolved path is refused without a fresh capture_screen in between', async t => {
  stubWindowForInspection();
  const conversation = { id: 'conv_stale_1', mode: 'operator' };
  const executionContext = {};

  const first = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/gameplay.png', goal: 'Confirm the game is in real gameplay, not a menu.' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' },
    conversation, executionContext
  );
  t.ok(first && first.success !== false, 'the first inspection of a never-before-seen path succeeds');

  let threw = null;
  try {
    await agent.executeTool(
      'inspect_screenshot_with_model', { path: 'screenshots/gameplay.png', goal: 'Did movement happen after the key press?' },
      'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' },
      conversation, executionContext
    );
  } catch (error) { threw = error; }

  t.ok(threw, 'inspecting the exact same path a second time throws instead of silently judging a picture against itself');
  t.match(threw.message, /already been inspected/i, 'the error explains the screenshot was already judged');
  t.match(threw.message, /capture_screen/i, 'the error tells the model what to do instead: capture again');
  t.end();
});

test('the block is keyed on the different GOAL TEXT, not on file identity - rephrasing the question does not bypass it', async t => {
  // This is the "no regex/string-matching on goal text" requirement made concrete: two calls with
  // completely different, unrelated goal strings against the same path are both still refused.
  stubWindowForInspection();
  const conversation = { id: 'conv_stale_2', mode: 'operator' };
  const executionContext = {};
  await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/x.png', goal: 'What color is the background?' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  let threw = null;
  try {
    await agent.executeTool(
      'inspect_screenshot_with_model', { path: 'screenshots/x.png', goal: 'Completely unrelated question about a totally different detail.' },
      'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
    );
  } catch (error) { threw = error; }
  t.ok(threw, 'a wildly different goal on the same path is still refused - the gate does not read or match goal text at all');
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

test('path identity is normalized so a trivial backslash/case rewrite of the same file cannot bypass the gate', async t => {
  stubWindowForInspection();
  const conversation = { id: 'conv_stale_5', mode: 'operator' };
  const executionContext = {};
  await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/Case.png', goal: 'first look' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
  );
  let threw = null;
  try {
    await agent.executeTool(
      // Same file, different slash direction and casing - resolveSnapshotReference would not
      // necessarily normalize this on its own since it only rewrites references back to the
      // *current* lastDesktopSnapshot path; the already-inspected-paths check must normalize
      // independently.
      'inspect_screenshot_with_model', { path: 'screenshots\\CASE.PNG', goal: 'second look, same file' },
      'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' }, conversation, executionContext
    );
  } catch (error) { threw = error; }
  t.ok(threw, 'a case/slash rewrite of an already-inspected path is still recognized as the same file');
  t.end();
});

test('two different conversations do not share the already-inspected set (each run tracks its own state)', async t => {
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
