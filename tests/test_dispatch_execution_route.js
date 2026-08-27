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
