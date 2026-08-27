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
      // Which skill-registry operations this role may perform. Every role can author: create_skill
      // takes the implementation and test as STRING parameters and the main process writes and runs
      // them, so authoring never required the file/test tools only Coder has. What actually guards
      // a bad skill is the test gate plus provenance, not which role happened to call the tool.
      skillCapabilities: Object.freeze({ discover: true, run: true, propose: true, create: true }),
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
      skillCapabilities: Object.freeze({ discover: true, run: true, propose: true, create: true }),
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
      // Researcher may propose a skill but not author one. create_skill writes model-authored
      // JavaScript to disk and executes it, and its test gate cannot be a security gate because
      // passing the test REQUIRES running the untrusted code. Researcher is the role that ingests
      // untrusted web and source material, so it is the one place where a successful prompt
      // injection would otherwise have a route from read-only investigation to host code
      // execution. Coder already holds code-execution authority via run_command, so keeping
      // create there is no escalation.
      skillCapabilities: Object.freeze({ discover: true, run: true, propose: true, create: false }),
      capabilitySummary: Object.freeze([
        'read-only investigation that changes nothing',
        'gathering and cross-checking multiple sources',
        'historical and project evidence, including change history',
        // Explicitly named after a real misroute: a request to look at Orion's own prior
        // task/run history (not a project's files) was investigated as if it were project
        // source, because nothing told the router this evidence domain existed or that it
        // was Researcher-shaped work. Gathering and comparing several of Orion's own prior
        // runs to explain how something was accomplished before is the same investigation
        // shape as comparing several commits or sources - it just draws on Orion\'s own
        // execution/orchestration record as the evidence instead of a file.
        'Orion\'s own prior task, run, and orchestration history - comparing multiple past executions to explain how something was accomplished before',
        'comparison, synthesis, and explaining a trajectory or pattern',
        'provenance - saying where each finding came from'
      ])
    })
  });

  // Dispatch is not a specialist and is deliberately absent from DEFINITIONS, but it owns the
  // mission and must know which reusable procedures exist, so its skill capabilities live here
  // too. This function is the single authority on skill-tool visibility: four hand-maintained
  // allowlists is exactly the shape that let Researcher be a registered role the router could not
  // route to, and repeating it for skills would reproduce that bug class.
  //
  // Every role may author. The thing that keeps the registry trustworthy is not a role check -
  // it is the test gate in lib/ipc-skill.js plus the provenance recorded on each manifest, both of
  // which apply identically whoever called the tool. A controlled promotion path (detect repetition
  // -> propose -> human approval -> register) remains the intended long-term route, and would sit
  // in front of create_skill for every role rather than restricting it to one.
  const DISPATCH_SKILL_CAPABILITIES = Object.freeze({ discover: true, run: true, propose: true, create: true });
  const NO_SKILL_CAPABILITIES = Object.freeze({ discover: false, run: false, propose: false, create: false });

  function skillCapabilitiesFor(value) {
    const role = normalizeRole(value);
    if (!role || role === 'orion' || role === 'dispatch') return DISPATCH_SKILL_CAPABILITIES;
    const definition = get(role);
    if (!definition) return NO_SKILL_CAPABILITIES;
    return definition.skillCapabilities || NO_SKILL_CAPABILITIES;
  }

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
    skillCapabilitiesFor,
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
