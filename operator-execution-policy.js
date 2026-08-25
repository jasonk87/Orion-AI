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
  const SCREEN_ACTION_TOOLS = new Set(['computer_action', 'open_application', 'click_ui_element', 'open_chrome_favorite']);
  const PROCESS_ACTION_TOOLS = new Set(['start_command', 'kill_command']);
  const MAX_UNPRODUCTIVE_DIAGNOSTICS = 3;

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
      screenActions: 0
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

  function recordToolResult(stateValue, toolName, result, args = {}) {
    const state = stateValue || createState();
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
    if (SCREEN_OBSERVATION_TOOLS.has(toolName)) state.unproductiveDiagnosticStreak = 0;
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

    if (SCREEN_ACTION_TOOLS.has(toolName) && toolName !== 'computer_action' && VISUAL_SURFACES.has(surface) && !state.inspected) {
      return {
        allowed: false,
        code: 'operator_open_requires_observation',
        reason: 'Capture and inspect the screen before activating an application or labeled desktop control. The current visible state may already satisfy the request.'
      };
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
    PROCESS_ACTION_TOOLS,
    normalizeSurface,
    createState,
    recordToolResult,
    recordToolAttempt,
    gateTool,
    liveStatus,
    resolveSnapshotReference
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionOperatorExecutionPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
