'use strict';

// Operator used to treat every screen-affecting tool as one class, so a semantic action that
// already carried its own target still had to pay for a screenshot and a vision call first. The
// observed cost, for a request as simple as "open my DeepSeek favorite":
//
//   open_chrome_favorite  -> REJECTED (no inspected screenshot yet)
//   [model turn spent processing the rejection]
//   capture_screen        -> an irrelevant desktop
//   inspect_screenshot_with_model -> confirms DeepSeek is not already open
//   open_chrome_favorite  -> the same call, now allowed
//   capture_screen        -> the page that was actually wanted
//
// Four of those six steps existed only to rediscover a target the caller had already named.
//
// The rule now matches the action class: use the cheapest grounding that is actually trustworthy.
// A named app/favorite/control is grounded by its own name plus a deterministic resolver that
// REFUSES ambiguity; raw coordinates have no semantic target at all, so they keep the strict
// capture-inspect-act-invalidate contract untouched.
//
// Everything below asserts behavior against real policy state and real executeTool calls.

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const policy = require('../operator-execution-policy');
const agent = require('../agent');

function operatorConversation() {
  return { id: 'operator-1', mode: 'operator' };
}

function freshContext(surface = 'desktop') {
  return {
    operatorExecutionSurface: surface,
    operatorPolicyState: policy.createState(surface)
  };
}

// A screen that was captured AND inspected, i.e. the strongest visual evidence a run can hold.
function inspectedContext(surface = 'desktop', at = Date.now()) {
  const context = freshContext(surface);
  context.lastDesktopSnapshot = {
    path: 'before.png', width: 1920, height: 1080,
    capturedAt: at, inspectedAt: at, displayId: '1', availableDisplays: []
  };
  policy.recordToolResult(context.operatorPolicyState, 'capture_screen', { success: true, path: 'before.png' });
  policy.recordToolResult(context.operatorPolicyState, 'inspect_screenshot_with_model', { success: true, path: 'before.png', status: 'not_satisfied' });
  return context;
}

async function callTool(name, args, context, conversation = operatorConversation()) {
  return agent.executeTool(name, args, 'C:\\workspace', {}, conversation, context);
}

function withApi(api, run) {
  const previous = global.window.api;
  global.window.api = api;
  return Promise.resolve()
    .then(run)
    .finally(() => { global.window.api = previous; });
}

// ── 1-2: named semantic targets execute immediately ───────────────────────────

test('a named Chrome favorite opens on the first call, with no screenshot round trip first', async t => {
  const calls = [];
  await withApi({
    openChromeFavorite: async payload => {
      calls.push(payload);
      return {
        success: true, favorite: { name: 'DeepSeek Platform', url: 'https://platform.deepseek.com' },
        matchKind: 'exact', path: 'deepseek.png', width: 1920, height: 1080
      };
    }
  }, async () => {
    const context = freshContext('browser');
    const result = await callTool('open_chrome_favorite', { name: 'deepseek platform' }, context);
    t.equal(result.success, true, 'the favorite opens');
    t.equal(calls.length, 1, 'exactly one favorite call - the rejected pre-observation attempt is gone');
    t.equal(result.effect, 'favorite_opened', 'the verified effect is reported structurally');
    t.equal(result.grounding, 'semantic', 'and it says the grounding was semantic, not visual');
  });
  t.end();
});

test('a named application opens on the first call, with no screenshot round trip first', async t => {
  const calls = [];
  await withApi({
    openApplication: async payload => {
      calls.push(payload);
      return { success: true, method: 'launched', appName: 'Calculator', path: 'calc.png', width: 1920, height: 1080 };
    }
  }, async () => {
    const context = freshContext('desktop');
    const result = await callTool('open_application', { appName: 'Calculator' }, context);
    t.equal(result.success, true, 'the application opens');
    t.equal(calls.length, 1, 'one call, no pre-observation rejection');
    t.equal(result.effect, 'opened_new', 'a real launch is reported as a new open');
  });
  t.end();
});

test('the policy allows named semantic actions on an unobserved screen and blocks unnamed ones', t => {
  const state = policy.createState('desktop');
  const gate = (toolName, args) => policy.gateTool({ mode: 'operator', surface: 'desktop', toolName, args, state });
  t.equal(gate('open_chrome_favorite', { name: 'deepseek platform' }).allowed, true, 'a named favorite is grounded');
  t.equal(gate('open_application', { appName: 'Chrome' }).allowed, true, 'a named application is grounded');
  t.equal(gate('click_ui_element', { targetText: 'Settings' }).allowed, true, 'a named control is grounded');

  // Without a target there is nothing semantic about the call, so vision is the only grounding left.
  const unnamed = gate('open_application', { appName: '   ' });
  t.equal(unnamed.allowed, false, 'an unnamed application is not a semantic action');
  t.equal(unnamed.code, 'operator_semantic_target_required', 'and it is refused for that specific reason');
  t.equal(gate('open_chrome_favorite', {}).code, 'operator_semantic_target_required', 'so is a favorite with no name');
  t.equal(gate('click_ui_element', { targetText: '' }).code, 'operator_semantic_target_required', 'so is an unlabelled control');
  t.end();
});

// ── 3-4: raw coordinate control keeps the strict contract ─────────────────────

test('computer_action still refuses to act without a fresh capture and its own inspection', async t => {
  let actions = 0;
  await withApi({
    computerAction: async () => { actions += 1; return { success: true }; }
  }, async () => {
    const noCapture = freshContext('desktop');
    let error = null;
    try { await callTool('computer_action', { action: 'left_click', x: 10, y: 10 }, noCapture); }
    catch (caught) { error = caught; }
    t.match(String(error && error.message || ''), /requires a fresh capture_screen/i,
      'raw coordinate control with no capture is refused');

    const capturedOnly = freshContext('desktop');
    capturedOnly.lastDesktopSnapshot = {
      path: 'shot.png', width: 1920, height: 1080, capturedAt: Date.now(), inspectedAt: 0
    };
    error = null;
    try { await callTool('computer_action', { action: 'left_click', x: 10, y: 10 }, capturedOnly); }
    catch (caught) { error = caught; }
    t.match(String(error && error.message || ''), /inspect_screenshot_with_model/i,
      'an uninspected capture is still not permission to click');
    t.equal(actions, 0, 'the raw action never reached the OS');
  });
  t.end();
});

test('computer_action succeeds once the capture-then-inspect sequence is genuinely complete', async t => {
  let actions = 0;
  await withApi({
    computerAction: async () => { actions += 1; return { success: true, path: 'after.png', width: 1920, height: 1080 }; }
  }, async () => {
    const context = inspectedContext('desktop');
    const result = await callTool('computer_action', { action: 'left_click', x: 10, y: 10 }, context);
    t.equal(result.success, true, 'a properly grounded action runs');
    t.equal(actions, 1, 'and reaches the OS exactly once');
    t.equal(context.lastDesktopSnapshot.inspectedAt, 0,
      'its own result is uninspected, so a second action needs a second inspection');
  });
  t.end();
});

test('raw coordinate control remains strict even immediately after a successful semantic action', async t => {
  let actions = 0;
  await withApi({
    openApplication: async () => ({ success: true, method: 'launched', path: 'app.png', width: 1920, height: 1080 }),
    computerAction: async () => { actions += 1; return { success: true }; }
  }, async () => {
    const context = inspectedContext('desktop');
    await callTool('open_application', { appName: 'Calculator' }, context);
    let error = null;
    try { await callTool('computer_action', { action: 'left_click', x: 5, y: 5 }, context); }
    catch (caught) { error = caught; }
    t.match(String(error && error.message || ''), /inspect_screenshot_with_model/i,
      'the semantic action consumed the old inspection rather than inheriting it');
    t.equal(actions, 0, 'no click landed on a screen nobody had looked at');
  });
  t.end();
});

// ── 5-8: post-action evidence, and what a pre-action image may not prove ──────

test('a screenshot taken before a semantic open cannot verify the resulting state', async t => {
  for (const scenario of [
    { tool: 'open_application', args: { appName: 'Chrome' }, apiKey: 'openApplication', after: 'app-after.png' },
    { tool: 'open_chrome_favorite', args: { name: 'deepseek platform' }, apiKey: 'openChromeFavorite', after: 'page-after.png' }
  ]) {
    await withApi({
      [scenario.apiKey]: async () => ({
        success: true, method: 'launched', path: scenario.after, width: 1920, height: 1080
      })
    }, async () => {
      const context = inspectedContext('desktop');
      const beforePath = context.lastDesktopSnapshot.path;
      const epochBefore = context.operatorPolicyState.visualActionEpoch;

      await callTool(scenario.tool, scenario.args, context);

      t.notEqual(context.lastDesktopSnapshot.path, beforePath,
        scenario.tool + ': the pre-action image is no longer the current screen');
      t.equal(context.lastDesktopSnapshot.inspectedAt, 0,
        scenario.tool + ': the resulting screen is uninspected');
      t.ok(context.operatorPolicyState.visualActionEpoch > epochBefore,
        scenario.tool + ': the visual epoch advanced, invalidating prior visual authority');

      // Re-inspecting the OLD image is refused: it predates the action.
      const stale = policy.gateTool({
        mode: 'operator', surface: 'desktop', toolName: 'inspect_screenshot_with_model',
        args: { path: beforePath }, state: context.operatorPolicyState
      });
      t.equal(stale.allowed, false, scenario.tool + ': the pre-action screenshot cannot be used to prove the result');
      t.equal(stale.code, 'operator_stale_screenshot_reinspection',
        scenario.tool + ': and it is refused as a stale re-inspection');
    });
  }
  t.end();
});

test('a fresh inspection of the post-action screen is accepted and answers the question', async t => {
  await withApi({
    openChromeFavorite: async () => ({ success: true, path: 'deepseek.png', width: 1920, height: 1080 })
  }, async () => {
    const context = inspectedContext('browser');
    await callTool('open_chrome_favorite', { name: 'deepseek platform' }, context);

    const state = context.operatorPolicyState;
    // The action's own capture IS the current screen, so inspecting it is allowed.
    const gate = policy.gateTool({
      mode: 'operator', surface: 'browser', toolName: 'inspect_screenshot_with_model',
      args: { path: 'deepseek.png' }, state
    });
    t.equal(gate.allowed, true, 'inspecting the page the action produced is permitted');
    policy.recordToolResult(state, 'inspect_screenshot_with_model', { success: true, path: 'deepseek.png', status: 'appears_satisfied' });
    t.equal(state.inspected, true, 'the resulting page is now genuinely observed');
    t.equal(state.latestInspectedPath, 'deepseek.png', 'and the evidence points at the post-action image');
  });
  t.end();
});

test('action success is never mission success - the semantic result carries no page claim', async t => {
  await withApi({
    openChromeFavorite: async () => ({
      success: true, favorite: { name: 'DeepSeek Platform' }, path: 'deepseek.png', width: 1920, height: 1080
    })
  }, async () => {
    const context = freshContext('browser');
    const result = await callTool('open_chrome_favorite', { name: 'deepseek platform' }, context);
    t.equal(result.effect, 'favorite_opened', 'the tool reports only that the favorite was opened');
    t.equal(context.operatorPolicyState.inspected, false,
      'opening the page is not observing it - the balance question still needs a look');
  });
  t.end();
});

// ── 9-10: accessibility grounding, and when it is not enough ──────────────────

test('click_ui_element is grounded by accessibility rather than a forced vision call', async t => {
  const calls = [];
  await withApi({
    clickAccessibleUi: async payload => {
      calls.push(payload);
      return {
        success: true, method: 'invoke', name: 'Settings', automationId: 'settingsButton',
        controlType: 'Button', path: 'after.png', width: 1920, height: 1080
      };
    }
  }, async () => {
    const context = freshContext('desktop');
    const result = await callTool('click_ui_element', { targetText: 'Settings', appName: 'Chrome' }, context);
    t.equal(result.success, true, 'the labeled control activates without a preceding screenshot');
    t.equal(calls.length, 1, 'one accessibility call, no vision round trip');
    t.equal(result.effect, 'control_activated', 'the effect is structural');
    t.equal(result.grounding, 'accessibility', 'and it names accessibility as the grounding used');
    t.equal(result.name, 'Settings', 'the resolved element identity is reported back');
  });
  t.end();
});

test('an ambiguous control is refused by the resolver, and the retry then requires a real look', async t => {
  let clicks = 0;
  await withApi({
    clickAccessibleUi: async () => {
      clicks += 1;
      return {
        success: false, ambiguous: true, reasonCode: 'control_ambiguous',
        error: 'More than one visible accessible control matched "Open".',
        matches: [{ Name: 'Open', ControlType: 'Button' }, { Name: 'Open', ControlType: 'MenuItem' }]
      };
    }
  }, async () => {
    const context = freshContext('desktop');
    let error = null;
    try { await callTool('click_ui_element', { targetText: 'Open' }, context); }
    catch (caught) { error = caught; }
    t.match(String(error && error.message || ''), /more than one visible accessible control/i,
      'the resolver refuses to guess between equally good matches');
    t.match(String(error && error.message || ''), /Matches:/,
      'and hands back the candidates so the next attempt can be specific');
    t.equal(clicks, 1, 'nothing was clicked');

    // Ambiguity is the structural proof that naming alone was insufficient for THIS target, so the
    // identical retry escalates to vision instead of looping.
    const retry = policy.gateTool({
      mode: 'operator', surface: 'desktop', toolName: 'click_ui_element',
      args: { targetText: 'Open' }, state: context.operatorPolicyState
    });
    t.equal(retry.allowed, false, 'repeating the identical ambiguous call is refused');
    t.equal(retry.code, 'operator_semantic_target_unresolved', 'for the specific unresolved-target reason');

    // A narrower target was never disproved, so it is still allowed without vision.
    const narrowed = policy.gateTool({
      mode: 'operator', surface: 'desktop', toolName: 'click_ui_element',
      args: { targetText: 'Open File' }, state: context.operatorPolicyState
    });
    t.equal(narrowed.allowed, true, 'a different, more specific target is still cheap');
  });
  t.end();
});

test('looking at the screen releases an unresolved target, which is exactly the escalation asked for', t => {
  const state = policy.createState('desktop');
  policy.recordToolResult(state, 'open_chrome_favorite', { success: false, notFound: true }, { name: 'deepseek platform' });
  t.equal(
    policy.gateTool({ mode: 'operator', surface: 'browser', toolName: 'open_chrome_favorite', args: { name: 'deepseek platform' }, state }).code,
    'operator_semantic_target_unresolved',
    'the unresolvable name is blocked from repeating'
  );
  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'look.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', { success: true, path: 'look.png', status: 'not_satisfied' });
  t.equal(
    policy.gateTool({ mode: 'operator', surface: 'browser', toolName: 'open_chrome_favorite', args: { name: 'deepseek platform' }, state }).allowed,
    true,
    'after actually looking, the model may act on what it now knows'
  );
  t.deepEqual(state.unresolvedSemanticTargets, [], 'the escalation record is cleared once it has been honoured');
  t.end();
});

// ── 12-13: substitution and loop protections are untouched ────────────────────

test('Operator still cannot substitute shell input for real semantic or visual control', t => {
  const state = policy.createState('desktop');
  const blockedBeforeLooking = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', args: { command: 'Get-Process' }, state });
  t.equal(blockedBeforeLooking.code, 'operator_screen_first', 'shell probing still comes after looking, not before');

  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'shot.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', { success: true, path: 'shot.png', status: 'not_satisfied' });
  const substituting = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'run_command', args: { command: 'SendKeys' }, state });
  t.equal(substituting.allowed, false, 'shell is refused as a stand-in for the visible action');
  t.equal(substituting.code, 'operator_visible_action_required', 'with the substitution-specific reason');
  t.match(substituting.reason, /Do not use PowerShell, WScript, SendKeys/i, 'and it names the exact prohibited routes');
  t.end();
});

test('repeated semantic failures are counted, so a failing loop cannot run unbounded', t => {
  const state = policy.createState('desktop');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    policy.recordToolResult(state, 'open_application', { success: false, notFound: true, matches: [] }, { appName: 'Nonexistent App' });
  }
  t.equal(state.semanticActionFailures, 3, 'the failures are recorded rather than silently swallowed');
  t.equal(state.unresolvedSemanticTargets.length, 1, 'one unresolvable target is tracked once, not three times');
  policy.recordToolResult(state, 'open_application', { success: true, method: 'launched' }, { appName: 'Calculator' });
  t.equal(state.semanticActionFailures, 0, 'a genuine success clears the failure streak');
  t.end();
});

// ── 14: existing screenshot reuse rules are unchanged ─────────────────────────

test('one untouched screenshot still answers several questions, and still cannot outlive an action', t => {
  const state = policy.createState('desktop');
  policy.recordToolResult(state, 'capture_screen', { success: true, path: 'shot.png' });
  policy.recordToolResult(state, 'inspect_screenshot_with_model', { success: true, path: 'shot.png', status: 'appears_satisfied' });
  for (const question of ['first', 'second', 'third']) {
    t.equal(
      policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'inspect_screenshot_with_model', args: { path: 'shot.png' }, state }).allowed,
      true,
      'the same immutable image answers the ' + question + ' static question'
    );
  }
  policy.recordToolResult(state, 'open_chrome_favorite', { success: true, path: 'newpage.png' }, { name: 'deepseek platform' });
  const stale = policy.gateTool({ mode: 'operator', surface: 'desktop', toolName: 'inspect_screenshot_with_model', args: { path: 'shot.png' }, state });
  t.equal(stale.allowed, false, 'but once an action changed the screen it proves nothing about the new state');
  t.equal(stale.code, 'operator_stale_screenshot_reinspection', 'and is refused as stale');
  t.end();
});

test('the action classes are distinct and the visual-epoch set is still their union', t => {
  const names = set => [...set].sort();
  t.deepEqual(names(policy.SEMANTIC_OPEN_ACTIONS), ['open_application', 'open_chrome_favorite'],
    'semantic opens are their own class');
  t.deepEqual(names(policy.SEMANTIC_UI_ACTIONS), ['click_ui_element'], 'accessible control activation is its own class');
  t.deepEqual(names(policy.RAW_VISUAL_ACTIONS), ['computer_action'], 'raw coordinate control is its own class');
  t.deepEqual(
    names(policy.SCREEN_ACTION_TOOLS),
    ['click_ui_element', 'computer_action', 'open_application', 'open_chrome_favorite'],
    'every screen-affecting action still advances the visual epoch, whatever grounding it needed'
  );
  t.equal(policy.RAW_VISUAL_ACTIONS.has('computer_action'), true, 'computer_action is never reclassified as semantic');
  t.equal(policy.SEMANTIC_ACTION_TOOLS.has('computer_action'), false, 'and cannot be granted semantic grounding');
  t.end();
});
