(function initDispatchInspectionPolicy(globalScope) {
  'use strict';

  // Kept as an exported compatibility value for older callers. Fresh project/source inspection
  // now belongs to Researcher from the first file; Dispatch discusses evidence already present in
  // the conversation but does not begin a parallel source survey of its own.
  const MAX_DISPATCH_SOURCE_FILES = 0;
  const INSPECTION_BREADTHS = Object.freeze(['none', 'single_file', 'focused', 'broad']);

  function normalizeBreadth(value) {
    return INSPECTION_BREADTHS.includes(value) ? value : 'none';
  }

  function isReadOnlyProjectInspection(intent) {
    return !!(
      intent
      && intent.executionScope === 'read_only'
      && ['workspace', 'project'].includes(intent.inspectionTarget)
    );
  }

  function isSourceInspectionIntent(intent) {
    return isReadOnlyProjectInspection(intent) && normalizeBreadth(intent.inspectionBreadth) !== 'none';
  }

  function inspectedPaths(ledger) {
    if (!ledger || !(ledger.files instanceof Map)) return [];
    return [...ledger.files.values()]
      .filter(file => file && file.path && Number(file.uniqueLines || 0) > 0)
      .sort((left, right) => Number(right.uniqueLines || 0) - Number(left.uniqueLines || 0))
      .map(file => String(file.path));
  }

  function shouldDelegate(options = {}) {
    if (String(options.mode || '').toLowerCase() !== 'orion') return false;
    return isSourceInspectionIntent(options.semanticIntent);
  }

  function buildDelegatedObjective(options = {}) {
    const request = String(options.resolvedRequest || options.userMessage || '').trim();
    const paths = [...new Set((options.inspectedPaths || []).map(String).filter(Boolean))]
      .slice(0, 12);
    const lines = [
      request || 'Inspect the selected project and report the requested findings.',
      '',
      'This is a delegated read-only project inspection. Do not modify application source merely because you own the inspection.',
      'Reuse transferred context and existing version-bound file knowledge before reading more source.',
      'As you materially inspect files, save concise version-bound notes with remember_file_notes. Persist only durable project-level architecture, constraints, or gotchas with project memory tools.',
      'Return a grounded report to Dispatch with the files/surfaces inspected, concrete findings, uncertainties, and any recommended next action.'
    ];
    if (paths.length) {
      lines.push('', `Dispatch already has validated evidence from these files: ${paths.join(', ')}. Continue from that evidence instead of restarting the review.`);
    }
    return lines.join('\n').trim();
  }

  function notedPaths(workWalkthrough = []) {
    return new Set((Array.isArray(workWalkthrough) ? workWalkthrough : [])
      .filter(item => item && item.status !== 'error' && item.toolName === 'remember_file_notes' && item.path)
      .map(item => String(item.path).replace(/\\/g, '/').toLowerCase()));
  }

  function missingFileNotes(ledger, workWalkthrough = [], limit = 8) {
    const noted = notedPaths(workWalkthrough);
    return inspectedPaths(ledger)
      .filter(filePath => !noted.has(String(filePath).replace(/\\/g, '/').toLowerCase()))
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  function buildKnowledgePersistencePrompt(options = {}) {
    const missing = missingFileNotes(options.ledger, options.workWalkthrough, options.limit || 8);
    if (!missing.length) return '';
    return [
      '[SYSTEM: Inspection knowledge gate. Before finalizing this code inspection, persist concise 1-3 line version-bound notes for the materially inspected files that still have no notes:',
      ...missing.map(filePath => `- ${filePath}`),
      'Call remember_file_notes once per listed file. Save roles, important responsibilities, and useful landmarks—not copied source or a transcript. If the inspection established a durable cross-file architecture fact or recurring gotcha, also save one concise project-scoped fact. Then give the user the complete grounded answer.]'
    ].join('\n');
  }

  const api = {
    MAX_DISPATCH_SOURCE_FILES,
    INSPECTION_BREADTHS,
    normalizeBreadth,
    isReadOnlyProjectInspection,
    isSourceInspectionIntent,
    inspectedPaths,
    shouldDelegate,
    buildDelegatedObjective,
    notedPaths,
    missingFileNotes,
    buildKnowledgePersistencePrompt
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionDispatchInspectionPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
