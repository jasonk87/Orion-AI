'use strict';

const test = require('tape');
const routeApi = require('../dispatch-execution-route');

function intent(overrides = {}) {
  return {
    intent: 'new_task',
    requiresExecution: true,
    executionTarget: 'operator',
    executionSurface: 'desktop',
    executionScope: 'mutating',
    inspectionTarget: 'local_system',
    resolvedRequest: 'Restart the Orion desktop application and verify it reconnects.',
    ...overrides
  };
}

test('finalized route carries the exact target, resolved request, surface, and registry capability facts', t => {
  const route = routeApi.finalize(intent(), {});
  t.equal(route.effectiveTarget, 'operator', 'Operator remains the authoritative target');
  t.equal(route.resolvedRequest, 'Restart the Orion desktop application and verify it reconnects.', 'resolved meaning is durable');
  t.equal(route.executionSurface, 'desktop', 'the execution surface reaches acknowledgement and execution');
  t.ok(route.capabilityFacts.some(fact => fact.includes('native desktop')), 'capability facts come from the specialist registry');
  t.ok(Object.isFrozen(route), 'the finalized route cannot drift after acknowledgement starts');
  t.end();
});

test('contextual follow-up preserves the target of the owned durable task', t => {
  const route = routeApi.finalize(intent({
    intent: 'context_followup',
    executionTarget: 'coder',
    executionSurface: 'process',
    resolvedRequest: 'Restart Claude using the launch method discussed in the preceding exchange.'
  }), {
    recentOwnedTask: { taskId: 'task-restart', targetMode: 'operator', status: 'pending' }
  });
  t.equal(route.effectiveTarget, 'operator', 'task ownership wins over a contradictory fresh target');
  t.match(route.resolvedRequest, /Restart Claude/, 'the explicit resolved referent survives instead of becoming "it"');
  t.end();
});

test('route directive gives the response model authoritative facts without asking it to route again', t => {
  const route = routeApi.finalize(intent(), {});
  const directive = routeApi.buildAcknowledgementDirective(route);
  t.match(directive, /Effective target: operator/, 'the exact target is visible');
  t.match(directive, /Resolved request: Restart the Orion desktop application/, 'the resolved request is visible');
  t.match(directive, /Execution surface: desktop/, 'the exact surface is visible');
  t.match(directive, /already finalized by deterministic capability and task-ownership code/, 'the model is not asked to decide routing again');
  t.match(directive, /Do not claim a different specialist/, 'the acknowledgement contract forbids contradiction');
  t.end();
});

test('compound execution route exposes the whole specialist chain while queuing only its first owner', t => {
  const route = routeApi.finalize(intent({
    resolvedRequest: 'Stop Music Life, then commit and push its repository changes.',
    executionTarget: 'operator',
    executionSurface: 'process',
    executionPlan: [
      {
        executionTarget: 'operator',
        resolvedRequest: 'Stop the running Music Life process and verify it exited.',
        executionScope: 'mutating',
        executionSurface: 'process',
        inspectionTarget: 'local_system',
        standaloneSystemOperation: true
      },
      {
        executionTarget: 'coder',
        resolvedRequest: 'Review, commit, and push the intended Music Life repository changes.',
        executionScope: 'mutating',
        executionSurface: 'none',
        inspectionTarget: 'project',
        standaloneSystemOperation: false
      }
    ]
  }), {});

  t.equal(route.effectiveTarget, 'operator', 'only the immediate dependency is selected for Dispatch handoff');
  t.deepEqual(route.executionPlan.map(stage => stage.executionTarget), ['operator', 'coder'], 'the complete ordered chain reaches execution');
  t.deepEqual(route.remainingExecutionPlan.map(stage => stage.executionTarget), ['coder'], 'remaining work is explicit rather than hidden in prose');
  const directive = routeApi.buildAcknowledgementDirective(route, { intent: 'new_task' });
  t.match(directive, /1\. Operator: Stop the running Music Life process/, 'Dispatch sees the first stage');
  t.match(directive, /2\. Coder: Review, commit, and push/, 'Dispatch sees the required continuation');
  t.match(directive, /Only the first stage is queued directly/, 'the directive forbids two unrelated root tasks');
  t.end();
});

test('non-executable conversation does not receive a handoff acknowledgement directive', t => {
  const route = routeApi.finalize(intent({
    intent: 'conversation',
    requiresExecution: false,
    executionTarget: 'none',
    executionSurface: 'none',
    resolvedRequest: 'What is up?'
  }), {});
  t.equal(route.effectiveTarget, 'none', 'no specialist is invented');
  t.equal(routeApi.buildAcknowledgementDirective(route), '', 'casual conversation stays lightweight');
  t.end();
});
