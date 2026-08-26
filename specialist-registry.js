(function attachOrionSpecialistRegistry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrionSpecialistRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOrionSpecialistRegistry() {
  'use strict';

  // This registry is the canonical boundary between a durable task role and the agent runtime
  // that can execute it. Prompts remain in agent.js because they are large authored documents;
  // promptKey identifies the exact prompt, toolPolicy identifies the allowed capability surface,
  // and executionSurfaces documents what durable task surfaces the role may own.
  const DEFINITIONS = Object.freeze({
    coder: Object.freeze({
      role: 'coder',
      label: 'Coder',
      promptKey: 'coder',
      toolPolicy: 'coder',
      standaloneWorkspaceRole: 'standalone_specialist',
      executionSurfaces: Object.freeze(['none', 'browser', 'process']),
      canEditWorkspace: true,
      canControlDesktop: false,
      canInspectLocalSystem: false,
      // The work SHAPE this role owns, in the router's own vocabulary. The semantic classifier is
      // given these rather than a hand-maintained per-role paragraph, so adding a specialist to
      // this registry teaches the router about it automatically. Capability, not keywords: the
      // location of the evidence never decides the specialist, the kind of work does.
      capabilitySummary: Object.freeze([
        'source mutation and implementation',
        'builds, tests, installs, and commands bound to a codebase',
        'code debugging and regression diagnosis',
        'creating or editing local project artifacts'
      ])
    }),
    operator: Object.freeze({
      role: 'operator',
      label: 'Operator',
      promptKey: 'operator',
      toolPolicy: 'operator',
      standaloneWorkspaceRole: 'standalone_specialist',
      executionSurfaces: Object.freeze(['none', 'desktop', 'browser', 'process']),
      canEditWorkspace: false,
      canControlDesktop: true,
      canInspectLocalSystem: true,
      capabilitySummary: Object.freeze([
        'native desktop and application interaction',
        'live browser interaction driven through the screen',
        'process lifecycle and local machine state',
        'screen evidence and visual verification'
      ])
    }),
    // Third specialist role (handoff-generalization + Researcher build). Researcher investigates —
    // web search/fetch, source cross-checking, synthesis — and reports back through the same
    // pending/resume delegation chain Coder/Operator already use. It never edits the workspace or
    // controls the desktop; 'browser' is included in executionSurfaces because it uses the same
    // read-only browser-worker snapshot tools Dispatch already has (open_url/take_screenshot/etc.),
    // not because it drives GUI automation.
    researcher: Object.freeze({
      role: 'researcher',
      label: 'Researcher',
      promptKey: 'researcher',
      toolPolicy: 'researcher',
      standaloneWorkspaceRole: 'standalone_specialist',
      executionSurfaces: Object.freeze(['none', 'browser']),
      canEditWorkspace: false,
      canControlDesktop: false,
      canInspectLocalSystem: false,
      capabilitySummary: Object.freeze([
        'read-only investigation that changes nothing',
        'gathering and cross-checking multiple sources',
        'historical and project evidence, including change history',
        'comparison, synthesis, and explaining a trajectory or pattern',
        'provenance - saying where each finding came from'
      ])
    })
  });

  function normalizeRole(value) {
    return String(value || '').trim().toLowerCase();
  }

  function get(value) {
    return DEFINITIONS[normalizeRole(value)] || null;
  }

  function has(value) {
    return !!get(value);
  }

  function requireRole(value) {
    const role = normalizeRole(value);
    const definition = get(role);
    if (definition) return definition;
    const error = new Error(`Unknown Orion specialist role: ${role || '(empty)'}. Refusing to inherit another specialist's prompt or tools.`);
    error.code = 'UNKNOWN_SPECIALIST_ROLE';
    throw error;
  }

  function list() {
    return Object.values(DEFINITIONS);
  }

  // ── Generalized handoff-tool lookup (handoff-generalization piece) ─────────────────────────
  // Single source of truth for "what is the handoff tool named for role X" and "which roles can a
  // given role hand off to." Both agent.js (tool schemas/allowlists/execution) and
  // task-orchestration.js (clarification messages, target validation) read this instead of each
  // hand-rolling its own role<->tool naming convention, which is what produced the hardcoded
  // two-role ternaries this registry addition is meant to retire.
  function handoffToolNameForRole(value) {
    const role = normalizeRole(value);
    return role ? `handoff_to_${role}` : '';
  }

  const HANDOFF_TOOL_TO_ROLE = Object.freeze(
    list().reduce((map, definition) => {
      map[handoffToolNameForRole(definition.role)] = definition.role;
      return map;
    }, {})
  );

  function roleForHandoffTool(toolName) {
    return HANDOFF_TOOL_TO_ROLE[String(toolName || '').trim()] || '';
  }

  function isHandoffTool(toolName) {
    return !!roleForHandoffTool(toolName);
  }

  function allHandoffToolNames() {
    return Object.keys(HANDOFF_TOOL_TO_ROLE);
  }

  // Roles a given caller may hand off to: every registered specialist except itself. `callerRole`
  // may be a specialist role ('coder', 'operator', 'researcher') or 'orion'/'dispatch'/'' for
  // Dispatch, which is not itself a specialist and so is never excluded from its own results.
  function handoffTargetsFor(callerRole) {
    const caller = normalizeRole(callerRole);
    return list().filter(definition => definition.role !== caller);
  }

  function handoffToolNamesFor(callerRole) {
    return handoffTargetsFor(callerRole).map(definition => handoffToolNameForRole(definition.role));
  }

  return Object.freeze({
    DEFINITIONS,
    normalizeRole,
    get,
    has,
    requireRole,
    list,
    handoffToolNameForRole,
    roleForHandoffTool,
    isHandoffTool,
    allHandoffToolNames,
    handoffTargetsFor,
    handoffToolNamesFor
  });
});
