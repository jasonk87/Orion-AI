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

  return Object.freeze({ DEFINITIONS, normalizeRole, get, has, requireRole, list });
});
