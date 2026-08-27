'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const policy = require('../operator-execution-policy');
const computerUse = require('../lib/ipc-computer-use');
const shared = require('../lib/shared');
const agent = require('../agent');

test('visual Operator work is screen-first and only repeated no-evidence diagnostics are bounded', t => {
  const state = policy.createState('desktop');
  let gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', state });
  t.equal(gate.allowed, false, 'shell probing is blocked before visual inspection');
  t.equal(gate.code, 'operator_screen_first');

  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'shot.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', { success: true, status: 'not_satisfied', path: 'shot.png' });
  gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', state });
  t.equal(gate.allowed, false, 'shell input is blocked until Operator attempts the dedicated visible action');
  t.equal(gate.code, 'operator_visible_action_required');
  policy.recordToolAttempt(state, 'computer_action');
  const args = { command: 'Get-Process Codex' };
  policy.recordToolResult(state, 'run_command', { success: true, stdout: 'pid 123' }, args);
  for (let index = 0; index < policy.MAX_UNPRODUCTIVE_DIAGNOSTICS; index += 1) {
    gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', state });
    t.equal(gate.allowed, true, `unchanged diagnostic repeat ${index + 1} is allowed before the loop threshold`);
    policy.recordToolResult(state, 'run_command', { success: true, stdout: 'pid 123' }, args);
  }
  gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', state });
  t.equal(gate.allowed, false, 'continued identical probing is blocked');
  t.equal(gate.code, 'operator_unproductive_diagnostic_loop');

  policy.recordToolResult(state, 'get_command_status', { success: true, status: 'completed', output: 'done' }, { processId: 'cmd_1' });
  gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'get_command_status', state });
  t.equal(gate.allowed, true, 'new process evidence resets the unproductive streak');
  policy.recordToolResult(state, 'run_command', { success: true, stdout: 'different evidence' }, args);
  t.equal(state.unproductiveDiagnosticStreak, 0, 'changed output is productive rather than mechanically charged');
  t.end();
});

test('Operator may ask a second question about immutable evidence but cannot reuse pre-action evidence as post-action proof', t => {
  const state = policy.createState('desktop');
  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'orion-artifact://conv/screenshots/before.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', {
    success: true,
    status: 'not_satisfied',
    path: 'orion-artifact://conv/screenshots/before.png'
  });
  let gate = policy.gateTool({
    mode: 'operator',
    surface: 'desktop',
    toolName: 'inspect_screenshot_with_model',
    args: {
      path: 'screenshots/before.png',
      goal: 'Read the controls shown in this immutable screenshot.'
    },
    state
  });
  t.equal(gate.allowed, true, 'the same screenshot may answer a genuinely different question before any action');

  policy.recordToolResult(state, 'computer_action', {
    success: true,
    path: 'orion-artifact://conv/screenshots/after.png'
  });
  gate = policy.gateTool({
    mode: 'operator',
    surface: 'desktop',
    toolName: 'inspect_screenshot_with_model',
    args: { path: 'screenshots/before.png', goal: 'Did the player move after input?' },
    state
  });
  t.equal(gate.allowed, false, 'pre-action evidence cannot prove post-action state');
  t.equal(gate.code, 'operator_stale_screenshot_reinspection');
  t.match(gate.reason, /predates the latest visible action/i);

  policy.recordToolResult(state, 'start_command', { success: true, processId: 'game-2' });
  gate = policy.gateTool({
    mode: 'operator',
    surface: 'desktop',
    toolName: 'inspect_screenshot_with_model',
    args: { path: 'orion-artifact://conv/screenshots/after.png', goal: 'Did the process relaunch change the window?' },
    state
  });
  t.equal(gate.allowed, false, 'a process lifecycle action also invalidates the prior capture epoch');
  t.equal(gate.code, 'operator_stale_screenshot_reinspection');
  t.end();
});

test('a visual sub-goal does not falsely complete the whole task and screenshot aliases still resolve', t => {
  const state = policy.createState('desktop');
  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'orion-artifact://conv/screenshots/capture.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', { success: true, status: 'appears_satisfied' });
  const gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'terminal_exec', state });
  t.equal(gate.allowed, true, 'a successful judgement for one screenshot goal is evidence, not a whole-task completion gate');
  t.equal(
    policy.resolveSnapshotReference('screenshots/capture.png', { path: 'orion-artifact://conv/screenshots/capture.png' }),
    'orion-artifact://conv/screenshots/capture.png',
    'a relative screenshot alias resolves to the exact conversation artifact'
  );
  t.end();
});

test('a project-local process launch is a first-class visible action after inspection', t => {
  const state = policy.createState('desktop');
  let gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'start_command', state });
  t.equal(gate.allowed, false, 'Operator still observes the desktop before launching another instance');
  t.equal(gate.code, 'operator_process_launch_requires_observation');

  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'desktop-before.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', {
    success: true,
    status: 'appears_satisfied',
    path: 'desktop-before.png'
  });
  gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'start_command', state });
  t.equal(gate.allowed, true, 'the inspected absence/presence sub-goal cannot block the requested project launch');
  t.equal(state.diagnosticCalls, 0, 'launching a project is not a diagnostic probe');

  policy.recordToolResult(state, 'start_command', { success: true, processId: 'game' });
  t.equal(state.inspected, false, 'launch invalidates the old screen so the resulting app must be observed fresh');
  t.end();
});

test('open_application activates or launches one named app and captures the visible result', async t => {
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
      if (name === 'open-application') handler = fn;
    }
  }, {
    runApplication: async appName => {
      calls.push(`open:${appName}`);
      return { success: true, method: 'activated', appName, windowTitle: 'Codex' };
    },
    captureDesktopScreenshot: async (workspace, destination, prefix, options) => {
      calls.push(`capture:${options.conversationId}`);
      t.equal(options.windowHint, 'Codex', 'the activated window identity is passed to the capture fallback');
      return {
        rel: 'orion-artifact://operator-1/screenshots/codex.png',
        png: Buffer.from('png'),
        size: { width: 1920, height: 1080 },
        artifactPath: 'C:\\artifacts\\codex.png',
        artifactRelativePath: 'screenshots/codex.png'
      };
    }
  });
  const result = await handler(null, {
    appName: 'Codex',
    settleMs: 0,
    workspacePath: 'C:\\Users\\Owner',
    conversationId: 'operator-1'
  });
  shared.mainWindow = oldWindow;

  t.ok(result.success, 'the dedicated app action succeeds');
  t.equal(result.method, 'activated', 'an existing window is preferred over a duplicate launch');
  t.equal(result.path, 'orion-artifact://operator-1/screenshots/codex.png', 'the resulting screen is captured for verification');
  t.deepEqual(calls, ['hide', 'open:Codex', 'capture:operator-1', 'showInactive']);
  t.end();
});

test('open_application keeps action success distinct from unavailable screenshot evidence', async t => {
  let handler = null;
  const oldWindow = shared.mainWindow;
  shared.mainWindow = { isDestroyed: () => false, hide: () => {}, showInactive: () => {} };
  computerUse.registerHandlers({
    handle: (name, fn) => { if (name === 'open-application') handler = fn; }
  }, {
    runApplication: async appName => ({ success: true, method: 'activated', appName, windowTitle: 'Claude' }),
    captureDesktopScreenshot: async () => { throw new Error('Captured screen image was empty.'); }
  });

  const result = await handler(null, {
    appName: 'Claude', settleMs: 0, workspacePath: 'C:\\Users\\Owner', conversationId: 'operator-1'
  });
  shared.mainWindow = oldWindow;

  t.equal(result.success, true, 'activating the named app remains a successful action');
  t.equal(result.method, 'activated', 'the verified action result is preserved');
  t.equal(result.captureSuccess, false, 'missing visual evidence is represented separately');
  t.match(result.captureError, /image was empty/i, 'the evidence failure remains explicit');
  t.match(result.summary, /^Activated "Claude", but could not capture/, 'the UI does not falsely claim visual verification');
  t.end();
});

test('open_application treats the requested app name as data rather than a wildcard or script fragment', t => {
  const script = computerUse.buildOpenApplicationScript('Codex*; Stop-Process');
  t.notOk(script.includes('Codex*; Stop-Process'), 'the literal app name is not interpolated into PowerShell source');
  t.notOk(script.includes('-like "*$name*"'), 'matching does not give app-name wildcard characters special meaning');
  t.ok(script.includes('.IndexOf($name, [StringComparison]::OrdinalIgnoreCase)'), 'matching uses literal case-insensitive containment');
  t.end();
});

// This used to assert that open_application was REJECTED without an inspected screenshot, on the
// theory that vision was needed to avoid launching a duplicate of an already-open app. It is not:
// the launcher enumerates existing windows itself and ACTIVATES a match instead of launching, and
// says which it did. The screenshot was buying nothing the implementation did not already
// guarantee, so it is gone - but the duplicate-launch guarantee it was standing in for is asserted
// directly here instead, which is a stronger test than the one it replaces.
test('open_application is Operator-only, runs without a pre-action screenshot, and reports which effect it had', async t => {
  agent.__setActiveConversationModeForTest('operator');
  const operatorTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  agent.__setActiveConversationModeForTest('coder');
  const coderTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  t.ok(operatorTools.includes('open_application'), 'Operator receives the bounded app primitive');
  t.notOk(coderTools.includes('open_application'), 'Coder does not receive Operator-only app control');

  const oldApi = global.window.api;
  let openCalls = 0;
  let method = 'activated';
  global.window.api = {
    openApplication: async () => {
      openCalls += 1;
      return { success: true, method, path: 'after.png', width: 100, height: 80 };
    }
  };
  // No prior capture and no prior inspection: the run has never looked at the screen.
  const executionContext = {
    operatorExecutionSurface: 'desktop',
    operatorPolicyState: policy.createState('desktop')
  };
  const activated = await agent.executeTool(
    'open_application', { appName: 'Codex' }, '', {}, { id: 'operator-1', mode: 'operator' }, executionContext
  );
  t.equal(openCalls, 1, 'the named application opens on the first call, with no rejected round trip');
  t.equal(activated.effect, 'activated_existing',
    'an already-open app is reported as activated - the duplicate launch the old gate guarded against cannot happen');
  t.equal(executionContext.lastDesktopSnapshot.path, 'after.png', 'the resulting screen replaces the old one');
  t.equal(executionContext.lastDesktopSnapshot.inspectedAt, 0,
    'and is uninspected, so nothing may describe it without looking');

  method = 'launched';
  const launched = await agent.executeTool(
    'open_application', { appName: 'Calculator' }, '', {}, { id: 'operator-1', mode: 'operator' }, executionContext
  );
  t.equal(launched.effect, 'opened_new', 'a genuinely absent app is reported as a new launch');
  global.window.api = oldApi;
  agent.__setActiveConversationModeForTest('orion');
  t.end();
});
