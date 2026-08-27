(function attachDispatchExecutionRoute(root, factory) {
  const api = factory(
    root && root.OrionSemanticIntentRouter,
    root && root.OrionSpecialistRegistry
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrionDispatchExecutionRoute = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDispatchExecutionRoute(
  browserRouter,
  browserRegistry
) {
  'use strict';

  const SemanticIntentRouter = browserRouter
    || (typeof require === 'function' ? require('./semantic-intent-router') : null);
  const SpecialistRegistry = browserRegistry
    || (typeof require === 'function' ? require('./specialist-registry') : null);

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function taskTargetMode(task) {
    const role = clean(task && (task.targetMode || task.role)).toLowerCase();
    return SpecialistRegistry && SpecialistRegistry.has(role) ? role : '';
  }

  function resolveTarget(semanticIntent, options) {
    if (!semanticIntent || semanticIntent.requiresExecution !== true) return 'none';
    if (!SemanticIntentRouter || typeof SemanticIntentRouter.resolveExecutionTarget !== 'function') {
      return 'none';
    }
    const resolved = SemanticIntentRouter.resolveExecutionTarget(semanticIntent, {
      activeOwnedTask: options.activeOwnedTask || null,
      pendingOwnedTask: options.pendingOwnedTask || null,
      recentOwnedTask: options.recentOwnedTask || null
    });
    // delegatedInspection says the work must LEAVE Dispatch. It does not say who owns it.
    //
    // This used to `return 'coder'` BEFORE consulting the router, which meant an inspection the
    // semantic router had correctly understood as read-only investigation — Researcher's declared
    // capability — was silently converted back into Coder work. That is the same "a flag decides
    // the specialist" mistake as routing by evidence location: the inspection policy's job is to
    // decide whether to delegate, and the work's shape decides to whom.
    //
    // Coder remains the fallback ONLY when the router cannot place the work at all, which
    // preserves the previous behavior for that case without overriding a real decision.
    if (options.delegatedInspection === true && (resolved === 'none' || resolved === 'dispatch')) {
      return 'coder';
    }
    return resolved;
  }

  /**
   * Finalize the one route Dispatch and the execution layer will both consume.
   * This function only resolves meaning/capability facts. It performs no handoff and mutates no
   * task state; deterministic tool execution remains in agent.js/task-orchestration.js.
   */
  function finalize(semanticIntent = {}, options = {}) {
    const resolvedRequest = clean(options.resolvedRequest || semanticIntent.resolvedRequest);
    const effectiveTarget = resolveTarget(semanticIntent, options);
    const specialist = SpecialistRegistry && SpecialistRegistry.get(effectiveTarget);
    const executionSurface = clean(
      options.executionSurface || semanticIntent.executionSurface || 'none'
    ).toLowerCase() || 'none';
    const requiresExecution = semanticIntent.requiresExecution === true;
    const targetKind = effectiveTarget === 'dispatch'
      ? 'dispatch'
      : (specialist ? 'specialist' : 'none');
    const capabilityFacts = specialist
      ? [
          `${specialist.label} is the selected execution owner.`,
          ...specialist.capabilitySummary.map(fact => `${specialist.label} can handle ${fact}.`)
        ]
      : (effectiveTarget === 'dispatch'
          ? ['Dispatch owns this orchestration action directly.']
          : ['No execution handoff is authorized for this turn.']);

    return Object.freeze({
      requiresExecution,
      effectiveTarget,
      targetKind,
      targetLabel: specialist ? specialist.label : (effectiveTarget === 'dispatch' ? 'Dispatch' : ''),
      resolvedRequest,
      executionSurface,
      capabilityFacts: Object.freeze(capabilityFacts),
      delegatedInspection: options.delegatedInspection === true,
      activeOwnedTaskTarget: taskTargetMode(options.activeOwnedTask),
      pendingOwnedTaskTarget: taskTargetMode(options.pendingOwnedTask),
      recentOwnedTaskTarget: taskTargetMode(options.recentOwnedTask)
    });
  }

  function buildAcknowledgementDirective(route) {
    if (!route || route.requiresExecution !== true || route.targetKind !== 'specialist') return '';
    const facts = route.capabilityFacts.map(fact => `- ${fact}`).join('\n');
    return [
      '[FINALIZED DISPATCH EXECUTION ROUTE]',
      `Effective target: ${route.effectiveTarget}`,
      `Resolved request: ${route.resolvedRequest}`,
      `Execution surface: ${route.executionSurface}`,
      'Relevant capability facts:',
      facts,
      '',
      'This route is already finalized by deterministic capability and task-ownership code.',
      `Acknowledge the user's exact request naturally and consistently with ${route.targetLabel} performing it.`,
      'Do not claim a different specialist will do it. Do not claim Dispatch must do the execution.',
      'Do not refuse because Dispatch lacks the execution tools, ask the user to repeat the request,',
      'or ask what a contextual reference means when Resolved request already makes it explicit.',
      'You may call the matching handoff tool, but the runtime will execute this finalized route even',
      'if you only provide the acknowledgement. Do not inspect or redo the specialist work in Dispatch.'
    ].join('\n');
  }

  return Object.freeze({ finalize, buildAcknowledgementDirective });
});
