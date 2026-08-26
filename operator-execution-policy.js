(function initOperatorExecutionPolicy(globalScope) {
  'use strict';

  const VISUAL_SURFACES = new Set(['desktop', 'browser']);
  const RAW_DIAGNOSTIC_TOOLS = new Set([
    'run_command',
    'terminal_exec',
    'get_command_status',
    'read_command_output'
  ]);
  const SCREEN_OBSERVATION_TOOLS = new Set([
    'capture_screen',
    'inspect_screenshot',
    'inspect_screenshot_with_model',
    'compare_screenshot_to_goal'
  ]);
  // Operator's actions are not one class, and grouping them made vision mandatory for work that
  // already carried its own target. Use the cheapest trustworthy grounding for the action class:
  //
  //   SEMANTIC_OPEN_ACTIONS  — the caller names the app or favorite. The implementation resolves
  //                            it deterministically: an already-open app is ACTIVATED rather than
  //                            duplicated, and an unmatched or ambiguous name is refused rather
  //                            than guessed. A screenshot cannot add to that.
  //   SEMANTIC_UI_ACTIONS    — the caller names a control that Windows accessibility resolves by
  //                            name/automation id. The tool itself refuses ambiguous matches, so
  //                            its own refusal is better evidence than a pre-emptive screenshot.
  //   RAW_VISUAL_ACTIONS     — coordinate control with no semantic target. Vision is the ONLY
  //                            grounding available, so the strict capture/inspect contract in
  //                            executeTool stays exactly as it was.
  const SEMANTIC_OPEN_ACTIONS = new Set(['open_application', 'open_chrome_favorite']);
  const SEMANTIC_UI_ACTIONS = new Set(['click_ui_element']);
  const RAW_VISUAL_ACTIONS = new Set(['computer_action']);
  const SEMANTIC_ACTION_TOOLS = new Set([...SEMANTIC_OPEN_ACTIONS, ...SEMANTIC_UI_ACTIONS]);
  // The union stays the visual-epoch set: every one of these mutates what is on screen, so all of
  // them must still invalidate prior visual authority even when they no longer require it first.
  const SCREEN_ACTION_TOOLS = new Set([...SEMANTIC_ACTION_TOOLS, ...RAW_VISUAL_ACTIONS]);
  // Which argument carries the caller's explicit semantic target, per tool.
  const SEMANTIC_TARGET_ARGS = Object.freeze({
    open_application: 'appName',
    open_chrome_favorite: 'name',
    click_ui_element: 'targetText'
  });
  const PROCESS_ACTION_TOOLS = new Set(['start_command', 'kill_command']);
  const MAX_UNPRODUCTIVE_DIAGNOSTICS = 3;
  const MAX_TRACKED_UNRESOLVED_TARGETS = 12;

  function normalizeSurface(value) {
    const surface = String(value || '').trim().toLowerCase();
    return ['none', 'desktop', 'browser', 'process'].includes(surface) ? surface : 'none';
  }

  function createState(surface = 'none') {
    return {
      surface: normalizeSurface(surface),
      diagnosticCalls: 0,
      unproductiveDiagnosticStreak: 0,
      lastDiagnosticRequestKey: '',
      lastDiagnosticEvidenceKey: '',
      captured: false,
      inspected: false,
      latestCapturePath: '',
      latestInspectedPath: '',
      latestInspectionStatus: '',
      visualActionEpoch: 0,
      latestCaptureEpoch: 0,
      screenActionAttempts: 0,
      screenActions: 0,
      // Semantic targets the implementation itself could not resolve (ambiguous, or no match).
      // This is the structural signal that semantic grounding was INSUFFICIENT for that target,
      // which is the one case where escalating to vision is genuinely worth its cost.
      unresolvedSemanticTargets: [],
      semanticActionFailures: 0
    };
  }

  function semanticActionTarget(toolName, args = {}) {
    const key = SEMANTIC_TARGET_ARGS[toolName];
    if (!key) return '';
    const source = args && typeof args === 'object' ? args : {};
    return String(source[key] == null ? '' : source[key]).trim();
  }

  function unresolvedTargetKey(toolName, target) {
    return `${toolName}:${String(target || '').trim().toLowerCase()}`;
  }

  function hasUnresolvedSemanticTarget(stateValue, toolName, target) {
    const tracked = stateValue && Array.isArray(stateValue.unresolvedSemanticTargets)
      ? stateValue.unresolvedSemanticTargets
      : [];
    return tracked.includes(unresolvedTargetKey(toolName, target));
  }

  function normalizeMatches(value) {
    if (Array.isArray(value)) return value;
    return value == null || value === '' ? [] : [value];
  }

  // Normalizes what a semantic tool ACTUALLY verified into a stable structured shape, so the model
  // is told the effect instead of having to infer it from a screenshot. Every field here is read
  // from something the implementation genuinely determined — nothing is asserted on its behalf.
  function describeSemanticEffect(toolName, result) {
    if (!SEMANTIC_ACTION_TOOLS.has(toolName)) return null;
    // A missing result is a failed call, not a silent success. isSuccessful({}) is true by design
    // for the diagnostic paths that share it, so absence is rejected here rather than there.
    if (!result || typeof result !== 'object') {
      return { effect: '', reasonCode: 'semantic_action_failed', grounding: 'semantic' };
    }
    const value = result;
    const declaredReason = String(value.reasonCode || '').trim();
    if (!isSuccessful(value)) {
      if (declaredReason) return { effect: '', reasonCode: declaredReason, grounding: 'semantic' };
      if (value.ambiguous === true) {
        return {
          effect: '',
          reasonCode: toolName === 'open_chrome_favorite' ? 'favorite_ambiguous'
            : (toolName === 'click_ui_element' ? 'control_ambiguous' : 'application_ambiguous'),
          grounding: 'semantic'
        };
      }
      if (value.notFound === true) {
        return {
          effect: '',
          reasonCode: toolName === 'open_chrome_favorite' ? 'favorite_not_found'
            : (toolName === 'click_ui_element' ? 'control_not_found' : 'application_not_found'),
          grounding: 'semantic'
        };
      }
      if (toolName === 'open_application') {
        // The launcher reports its candidate list: none means nothing matched, several means the
        // name was not specific enough. Both are resolution failures, not action failures.
        return {
          effect: '',
          reasonCode: normalizeMatches(value.matches).length > 0 ? 'application_ambiguous' : 'application_not_found',
          grounding: 'semantic'
        };
      }
      return { effect: '', reasonCode: 'semantic_action_failed', grounding: 'semantic' };
    }
    if (toolName === 'open_application') {
      const method = String(value.method || '').trim().toLowerCase();
      // 'activated' means a matching window already existed and was raised — the exact duplicate
      // launch a pre-action screenshot used to be required to prevent.
      if (method === 'activated') return { effect: 'activated_existing', reasonCode: '', grounding: 'semantic' };
      if (method === 'launched') return { effect: 'opened_new', reasonCode: '', grounding: 'semantic' };
      return { effect: 'application_opened', reasonCode: '', grounding: 'semantic' };
    }
    if (toolName === 'open_chrome_favorite') {
      return { effect: 'favorite_opened', reasonCode: '', grounding: 'semantic' };
    }
    // click_ui_element resolved one enabled, on-screen accessible element and invoked it.
    return {
      effect: 'control_activated',
      reasonCode: '',
      grounding: String(value.method || '').trim().toLowerCase() === 'bounded-click'
        ? 'accessibility_bounds'
        : 'accessibility'
    };
  }

  function isSuccessful(result) {
    return !!(result && typeof result === 'object' && result.success !== false && !result.error);
  }

  function stableObject(value) {
    if (Array.isArray(value)) return value.map(stableObject);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableObject(value[key]);
    return output;
  }

  function boundedFingerprint(value) {
    try { return JSON.stringify(stableObject(value)).slice(0, 12000); }
    catch (_) { return String(value || '').slice(0, 12000); }
  }

  function diagnosticEvidence(result) {
    const value = result && typeof result === 'object' ? result : { value: result };
    return {
      success: value.success !== false,
      status: value.status,
      exitCode: value.exitCode,
      timedOut: value.timedOut,
      killed: value.killed,
      pid: value.pid,
      stdout: value.stdout,
      stderr: value.stderr,
      output: value.output,
      error: value.error
    };
  }

  function recordSemanticTargetOutcome(state, toolName, result, args) {
    if (!SEMANTIC_ACTION_TOOLS.has(toolName)) return;
    const target = semanticActionTarget(toolName, args);
    if (!target) return;
    if (!Array.isArray(state.unresolvedSemanticTargets)) state.unresolvedSemanticTargets = [];
    const key = unresolvedTargetKey(toolName, target);
    const effect = describeSemanticEffect(toolName, result);
    const unresolved = !!(effect && effect.reasonCode && effect.reasonCode !== 'semantic_action_failed');
    if (unresolved) {
      // The tool proved that naming this target is not enough to act on it. Until the screen is
      // looked at again, repeating the identical call cannot produce a different answer.
      if (!state.unresolvedSemanticTargets.includes(key)) state.unresolvedSemanticTargets.push(key);
      if (state.unresolvedSemanticTargets.length > MAX_TRACKED_UNRESOLVED_TARGETS) {
        state.unresolvedSemanticTargets.shift();
      }
      state.semanticActionFailures = (Number(state.semanticActionFailures) || 0) + 1;
      return;
    }
    // Only a real success clears the escalation. A failure with no recognizable resolution reason
    // (a crashed helper, a missing result) must leave any existing escalation standing.
    if (!result || typeof result !== 'object' || !isSuccessful(result)) return;
    state.unresolvedSemanticTargets = state.unresolvedSemanticTargets.filter(item => item !== key);
    state.semanticActionFailures = 0;
  }

  function recordToolResult(stateValue, toolName, result, args = {}) {
    const state = stateValue || createState();
    recordSemanticTargetOutcome(state, toolName, result, args);
    if (RAW_DIAGNOSTIC_TOOLS.has(toolName)) {
      state.diagnosticCalls += 1;
      const requestKey = `${toolName}:${boundedFingerprint(args)}`;
      const evidenceKey = boundedFingerprint(diagnosticEvidence(result));
      if (requestKey === state.lastDiagnosticRequestKey && evidenceKey === state.lastDiagnosticEvidenceKey) {
        state.unproductiveDiagnosticStreak += 1;
      } else {
        state.unproductiveDiagnosticStreak = 0;
      }
      state.lastDiagnosticRequestKey = requestKey;
      state.lastDiagnosticEvidenceKey = evidenceKey;
    }
    if (!isSuccessful(result)) return state;
    if (toolName === 'capture_screen') {
      state.captured = true;
      state.inspected = result.inspectionSkipped === true;
      state.latestCapturePath = String(result.path || '').trim();
      state.latestCaptureEpoch = Number(state.visualActionEpoch) || 0;
      if (state.inspected) state.latestInspectedPath = state.latestCapturePath;
    }
    if (toolName === 'inspect_screenshot_with_model') {
      state.inspected = true;
      state.latestInspectedPath = String(result.path || state.latestCapturePath || '').trim();
      state.latestInspectionStatus = String(result.status || '').trim().toLowerCase();
    }
    if (toolName === 'inspect_screenshot' || toolName === 'compare_screenshot_to_goal') {
      state.inspected = true;
    }
    if (SCREEN_OBSERVATION_TOOLS.has(toolName)) {
      state.unproductiveDiagnosticStreak = 0;
      // Looking at the screen is exactly the escalation an unresolved semantic target called for.
      // Once it has happened, the model can name a better target, so the block is released.
      if (state.inspected) state.unresolvedSemanticTargets = [];
    }
    if (SCREEN_ACTION_TOOLS.has(toolName)) {
      state.visualActionEpoch = (Number(state.visualActionEpoch) || 0) + 1;
      state.screenActions += 1;
      state.captured = !!result.path;
      state.latestCapturePath = String(result.path || '').trim();
      state.latestCaptureEpoch = Number(state.visualActionEpoch) || 0;
      state.inspected = false;
      state.latestInspectionStatus = '';
      state.unproductiveDiagnosticStreak = 0;
    }
    if (PROCESS_ACTION_TOOLS.has(toolName)) {
      // A process launch/stop can change the visible desktop asynchronously. The previous image
      // remains historical evidence, but cannot authorize a later click or prove the new state.
      state.visualActionEpoch = (Number(state.visualActionEpoch) || 0) + 1;
      state.captured = false;
      state.inspected = false;
      state.latestInspectionStatus = '';
      state.unproductiveDiagnosticStreak = 0;
    }
    return state;
  }

  function recordToolAttempt(stateValue, toolName) {
    const state = stateValue || createState();
    if (SCREEN_ACTION_TOOLS.has(toolName)) {
      state.screenActionAttempts += 1;
    }
    return state;
  }

  function sameScreenReference(leftValue, rightValue) {
    const normalize = value => String(value || '').trim().replace(/\\/g, '/').toLowerCase();
    const left = normalize(leftValue);
    const right = normalize(rightValue);
    if (!left || !right) return false;
    if (left === right) return true;
    return left.split('/').pop() === right.split('/').pop();
  }

  function gateTool(input = {}) {
    if (String(input.mode || '').toLowerCase() !== 'operator') return { allowed: true };
    const toolName = String(input.toolName || '');
    const args = input.args && typeof input.args === 'object' ? input.args : {};
    const state = input.state || createState(input.surface);
    const surface = normalizeSurface(input.surface || state.surface);
    if (surface && state.surface === 'none') state.surface = surface;

    if (toolName === 'inspect_screenshot_with_model') {
      const requestedPath = resolveSnapshotReference(args.path, { path: state.latestCapturePath });
      const inspectingCurrentCapture = sameScreenReference(requestedPath, state.latestCapturePath);
      const actionEpoch = Number(state.visualActionEpoch) || 0;
      const captureEpoch = Number(state.latestCaptureEpoch) || 0;
      if (actionEpoch > 0 && (!state.captured || captureEpoch !== actionEpoch || !inspectingCurrentCapture)) {
        return {
          allowed: false,
          code: 'operator_stale_screenshot_reinspection',
          reason: 'That screenshot predates the latest visible action and cannot prove the resulting state. Capture and inspect the current screen instead.'
        };
      }
    }

    if (RAW_DIAGNOSTIC_TOOLS.has(toolName)) {
      if (VISUAL_SURFACES.has(surface) && !state.inspected) {
        return {
          allowed: false,
          code: 'operator_screen_first',
          reason: 'This is a visual desktop/browser task. Capture the screen and inspect that exact image before running shell diagnostics. If the requested state is already visible, attach the screenshot and answer instead of probing processes.'
        };
      }
      // A vision judgement applies only to the exact goal passed to that inspection call. It is
      // evidence, not a task-completion receipt: treating any `appears_satisfied` result as proof
      // that the whole playtest was done blocked legitimate later launch and verification steps.
      if (VISUAL_SURFACES.has(surface)
          && state.inspected
          && state.latestInspectionStatus === 'not_satisfied'
          && state.screenActionAttempts === 0) {
        return {
          allowed: false,
          code: 'operator_visible_action_required',
          reason: 'The screen has been inspected and the visible goal is not satisfied. Use open_application for a named app, open_chrome_favorite for a saved Chrome item, click_ui_element for a labeled accessible control, or computer_action only for a visual target with no accessible identity. Do not use PowerShell, WScript, SendKeys, or terminal commands as a substitute for visible input.'
        };
      }
      if (state.unproductiveDiagnosticStreak >= MAX_UNPRODUCTIVE_DIAGNOSTICS) {
        return {
          allowed: false,
          code: 'operator_unproductive_diagnostic_loop',
          reason: `Operator repeated the same diagnostic without gaining new evidence ${MAX_UNPRODUCTIVE_DIAGNOSTICS} times. Change the action or evidence source, use the dedicated screen/application tools, or report the concrete blocker. A changed process state, output, command, or screen action will allow useful monitoring to continue.`
        };
      }
    }

    if (toolName === 'start_command' && VISUAL_SURFACES.has(surface) && !state.inspected) {
      return {
        allowed: false,
        code: 'operator_process_launch_requires_observation',
        reason: 'Capture and inspect the current screen before launching a project-local process. If the app is absent, start_command is the correct launch action; then capture a fresh screen and verify the result.'
      };
    }

    // Semantic actions are allowed to run FIRST. They carry an explicit target, and their
    // implementations resolve it deterministically rather than guessing — so making vision
    // rediscover a target the caller already named is pure latency. What is still gated is the
    // case where semantic grounding is genuinely absent or has already been disproved.
    if (SEMANTIC_ACTION_TOOLS.has(toolName) && VISUAL_SURFACES.has(surface)) {
      const target = semanticActionTarget(toolName, args);
      if (!target) {
        return {
          allowed: false,
          code: 'operator_semantic_target_required',
          reason: 'This action needs an explicit target to be semantic. Name the application, Chrome favorite, or accessible control — or capture and inspect the screen first if you do not yet know which one you need.'
        };
      }
      if (!state.inspected && hasUnresolvedSemanticTarget(state, toolName, target)) {
        return {
          allowed: false,
          code: 'operator_semantic_target_unresolved',
          reason: `"${target}" could not be resolved by name on the last attempt, so repeating the identical call cannot succeed. Capture and inspect the screen to choose a target that exists, or narrow it with an application name, folder, control type, or occurrence.`
        };
      }
    }
    return { allowed: true };
  }

  function liveStatus(toolName, args = {}, mode = '') {
    if (String(mode || '').toLowerCase() !== 'operator') return `Running tool: ${toolName}...`;
    switch (toolName) {
      case 'capture_screen': return 'Operator is observing the screen...';
      case 'inspect_screenshot':
      case 'inspect_screenshot_with_model':
      case 'compare_screenshot_to_goal': return 'Operator is inspecting what is visible...';
      case 'computer_action': return `Operator is controlling the screen${args.targetDescription ? `: ${String(args.targetDescription).slice(0, 90)}` : ''}...`;
      case 'open_application': return `Operator is opening ${String(args.appName || 'the application').slice(0, 80)}...`;
      case 'click_ui_element': return `Operator is activating ${String(args.targetText || 'the labeled control').slice(0, 80)}...`;
      case 'open_chrome_favorite': return `Operator is opening Chrome favorite ${String(args.name || '').slice(0, 80)}...`;
      case 'attach_image': return 'Operator is attaching the verified screenshot...';
      case 'run_command':
      case 'terminal_exec': return 'Operator is checking a bounded system detail...';
      default: return `Operator is working: ${toolName}...`;
    }
  }

  function resolveSnapshotReference(value, snapshot) {
    const requested = String(value || '').trim();
    const actual = String(snapshot && snapshot.path || '').trim();
    if (!requested || !actual || requested === actual) return requested;
    const normalize = item => item.replace(/\\/g, '/').toLowerCase();
    const requestedNormalized = normalize(requested);
    const actualNormalized = normalize(actual);
    const requestedName = requestedNormalized.split('/').pop();
    const actualName = actualNormalized.split('/').pop();
    if (requestedName && requestedName === actualName) return actual;
    if (requestedNormalized.startsWith('screenshots/') && actualNormalized.endsWith(`/${requestedNormalized}`)) return actual;
    return requested;
  }

  const api = {
    MAX_UNPRODUCTIVE_DIAGNOSTICS,
    RAW_DIAGNOSTIC_TOOLS,
    SCREEN_OBSERVATION_TOOLS,
    SCREEN_ACTION_TOOLS,
    SEMANTIC_OPEN_ACTIONS,
    SEMANTIC_UI_ACTIONS,
    SEMANTIC_ACTION_TOOLS,
    RAW_VISUAL_ACTIONS,
    PROCESS_ACTION_TOOLS,
    normalizeSurface,
    createState,
    semanticActionTarget,
    hasUnresolvedSemanticTarget,
    describeSemanticEffect,
    recordToolResult,
    recordToolAttempt,
    gateTool,
    liveStatus,
    resolveSnapshotReference
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionOperatorExecutionPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
