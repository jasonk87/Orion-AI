'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const policy = require('../operator-execution-policy');
const computerUse = require('../lib/ipc-computer-use');
const shared = require('../lib/shared');
const agent = require('../agent');

test('visual Operator work is screen-first and raw diagnostics are bounded', t => {
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
  for (let index = 0; index < policy.MAX_RAW_DIAGNOSTIC_CALLS; index += 1) {
    gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', state });
    t.equal(gate.allowed, true, `diagnostic ${index + 1} is allowed after inspection`);
    policy.recordToolResult(state, 'run_command', { success: true });
  }
  gate = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', state });
  t.equal(gate.allowed, false, 'a fourth diagnostic is blocked');
  t.equal(gate.code, 'operator_diagnostic_budget_exhausted');
  t.end();
});

test('Operator cannot judge a later visible result from the same screenshot', t => {
  const state = policy.createState('desktop');
  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'orion-artifact://conv/screenshots/before.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', {
    success: true,
    status: 'not_satisfied',
    path: 'orion-artifact://conv/screenshots/before.png'
  });
  const gate = policy.gateTool({
    mode: 'operator',
    surface: 'desktop',
    toolName: 'inspect_screenshot_with_model',
    args: {
      path: 'screenshots/before.png',
      goal: 'Check whether the player moved after input.'
    },
    state
  });
  t.equal(gate.allowed, false, 'the already-inspected image cannot be reused as later-state evidence');
  t.equal(gate.code, 'operator_stale_screenshot_reinspection');
  t.match(gate.reason, /fresh screen/i, 'recovery requires a new capture');
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
  t.equal(state.rawDiagnosticCalls, 0, 'launching a project is not charged against the raw-diagnostic budget');

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

test('open_application treats the requested app name as data rather than a wildcard or script fragment', t => {
  const script = computerUse.buildOpenApplicationScript('Codex*; Stop-Process');
  t.notOk(script.includes('Codex*; Stop-Process'), 'the literal app name is not interpolated into PowerShell source');
  t.notOk(script.includes('-like "*$name*"'), 'matching does not give app-name wildcard characters special meaning');
  t.ok(script.includes('.IndexOf($name, [StringComparison]::OrdinalIgnoreCase)'), 'matching uses literal case-insensitive containment');
  t.end();
});

test('open_application is exposed only to Operator and requires inspected screen evidence', async t => {
  agent.__setActiveConversationModeForTest('operator');
  const operatorTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  agent.__setActiveConversationModeForTest('coder');
  const coderTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  t.ok(operatorTools.includes('open_application'), 'Operator receives the bounded app primitive');
  t.notOk(coderTools.includes('open_application'), 'Coder does not receive Operator-only app control');

  const oldApi = global.window.api;
  let openCalls = 0;
  global.window.api = {
    openApplication: async () => {
      openCalls += 1;
      return { success: true, path: 'after.png', width: 100, height: 80 };
    }
  };
  const executionContext = {
    lastDesktopSnapshot: { path: 'before.png', width: 100, height: 80, capturedAt: Date.now(), inspectedAt: 0 },
    operatorExecutionSurface: 'desktop',
    operatorPolicyState: policy.createState('desktop')
  };
  policy.recordToolResult(executionContext.operatorPolicyState, 'capture_screen', { success: true, path: 'before.png' });
  policy.recordToolResult(executionContext.operatorPolicyState, 'inspect_screenshot_with_model', { success: true, status: 'not_satisfied' });
  let error = null;
  try {
    await agent.executeTool('open_application', { appName: 'Codex' }, '', {}, { id: 'operator-1', mode: 'operator' }, executionContext);
  } catch (caught) {
    error = caught;
  }
  t.match(String(error && error.message || ''), /captured and inspected screen/, 'blind duplicate launch is rejected');
  t.equal(openCalls, 0, 'the IPC action did not run');
  global.window.api = oldApi;
  agent.__setActiveConversationModeForTest('orion');
  t.end();
});
