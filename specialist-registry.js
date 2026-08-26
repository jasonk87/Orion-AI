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
      canControlDesktop: false
    }),
    operator: Object.freeze({
      role: 'operator',
      label: 'Operator',
      promptKey: 'operator',
      toolPolicy: 'operator',
      standaloneWorkspaceRole: 'standalone_specialist',
      executionSurfaces: Object.freeze(['none', 'desktop', 'browser', 'process']),
      canEditWorkspace: false,
      canControlDesktop: true
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
      canControlDesktop: false
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
