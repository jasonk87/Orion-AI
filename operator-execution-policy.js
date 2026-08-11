(function initOperatorExecutionPolicy(globalScope) {
  'use strict';

  const VISUAL_SURFACES = new Set(['desktop', 'browser']);
  const RAW_DIAGNOSTIC_TOOLS = new Set([
    'run_command',
    'terminal_exec',
    'start_command',
    'get_command_status',
    'read_command_output',
    'kill_command'
  ]);
  const SCREEN_OBSERVATION_TOOLS = new Set([
    'capture_screen',
    'inspect_screenshot',
    'inspect_screenshot_with_model',
    'compare_screenshot_to_goal'
  ]);
  const SCREEN_ACTION_TOOLS = new Set(['computer_action', 'open_application']);
  const MAX_RAW_DIAGNOSTIC_CALLS = 3;

  function normalizeSurface(value) {
    const surface = String(value || '').trim().toLowerCase();
    return ['none', 'desktop', 'browser', 'process'].includes(surface) ? surface : 'none';
  }

  function createState(surface = 'none') {
    return {
      surface: normalizeSurface(surface),
      rawDiagnosticCalls: 0,
      captured: false,
      inspected: false,
      latestInspectionStatus: '',
      screenActions: 0
    };
  }

  function isSuccessful(result) {
    return !!(result && typeof result === 'object' && result.success !== false && !result.error);
  }

  function recordToolResult(stateValue, toolName, result) {
    const state = stateValue || createState();
    if (RAW_DIAGNOSTIC_TOOLS.has(toolName)) state.rawDiagnosticCalls += 1;
    if (!isSuccessful(result)) return state;
    if (toolName === 'capture_screen') {
      state.captured = true;
      state.inspected = result.inspectionSkipped === true;
    }
    if (toolName === 'inspect_screenshot_with_model') {
      state.inspected = true;
      state.latestInspectionStatus = String(result.status || '').trim().toLowerCase();
    }
    if (toolName === 'inspect_screenshot' || toolName === 'compare_screenshot_to_goal') {
      state.inspected = true;
    }
    if (SCREEN_ACTION_TOOLS.has(toolName)) {
      state.screenActions += 1;
      state.captured = !!result.path;
      state.inspected = false;
      state.latestInspectionStatus = '';
    }
    return state;
  }

  function gateTool(input = {}) {
    if (String(input.mode || '').toLowerCase() !== 'operator') return { allowed: true };
    const toolName = String(input.toolName || '');
    const state = input.state || createState(input.surface);
    const surface = normalizeSurface(input.surface || state.surface);
    if (surface && state.surface === 'none') state.surface = surface;

    if (RAW_DIAGNOSTIC_TOOLS.has(toolName)) {
      if (VISUAL_SURFACES.has(surface) && !state.inspected) {
        return {
          allowed: false,
          code: 'operator_screen_first',
          reason: 'This is a visual desktop/browser task. Capture the screen and inspect that exact image before running shell diagnostics. If the requested state is already visible, attach the screenshot and answer instead of probing processes.'
        };
      }
      if (state.latestInspectionStatus === 'appears_satisfied') {
        return {
          allowed: false,
          code: 'operator_goal_already_visible',
          reason: 'The latest visual inspection says the requested state already appears satisfied. Stop diagnosing internals; attach the verified screenshot when requested and report the observed result.'
        };
      }
      if (state.rawDiagnosticCalls >= MAX_RAW_DIAGNOSTIC_CALLS) {
        return {
          allowed: false,
          code: 'operator_diagnostic_budget_exhausted',
          reason: `Operator has already used ${MAX_RAW_DIAGNOSTIC_CALLS} raw diagnostic calls. Do not keep digging through processes or installation metadata. Use the dedicated screen/application tools, act from visible evidence, or report the concrete blocker.`
        };
      }
    }

    if (toolName === 'open_application' && VISUAL_SURFACES.has(surface) && !state.inspected) {
      return {
        allowed: false,
        code: 'operator_open_requires_observation',
        reason: 'Capture and inspect the screen before opening another app instance. The requested application may already be visible.'
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
    MAX_RAW_DIAGNOSTIC_CALLS,
    RAW_DIAGNOSTIC_TOOLS,
    SCREEN_OBSERVATION_TOOLS,
    SCREEN_ACTION_TOOLS,
    normalizeSurface,
    createState,
    recordToolResult,
    gateTool,
    liveStatus,
    resolveSnapshotReference
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionOperatorExecutionPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
