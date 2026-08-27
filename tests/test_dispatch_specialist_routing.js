'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const fs = require('fs');
const path = require('path');
const agent = require('../agent');
const router = require('../semantic-intent-router');
const registry = require('../specialist-registry');

const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');

// Real bug report: Jason asked Dispatch "What are the latest updates for Crimson Desert?" (a video
// game - pure multi-source information lookup, textbook Researcher work per DISPATCHER_INSTRUCTION's
// own "Route to the researcher" guidance). Dispatch handed it to Coder via handoff_to_coder instead,
// and the Coder task failed outright, because Coder has no research capability.
//
// DISPATCHER_INSTRUCTION already documents Researcher's use case in full. specialist-registry.js
// already gives Researcher a real capabilitySummary. semantic-intent-router.js's
// resolveExecutionTarget is already registry-driven and correctly resolves this exact shape of
// classification to 'researcher' (see tests/test_specialist_routing_registry.js). The actual bug was
// one level up: agent.js's resolveDispatchHandoffRole is the function that turns the router's
// decision into which handoff tool Dispatch's forced-preflight path actually calls (and, in the
// call-site around line 3500, the function that REWRITES a handoff tool the model itself already
// chose) - and it only ever accepted its two oldest possible answers, 'operator' or 'coder',
// silently discarding any other registered role and falling through to the coder/operator default.
// So even a perfectly correct router decision of 'researcher' got collapsed back to 'coder' here,
// and a model that correctly called handoff_to_researcher on its own would have had that call
// forcibly renamed to handoff_to_coder.
//
// This is exactly the "mechanical plumbing exists, but the decision-making bridge never learned
// about the third role" bug shape - just located one function later in the pipeline than the two
// files (DISPATCHER_INSTRUCTION, semantic-intent-router.js) that were the first, reasonable places
// to suspect it.

function classification(overrides = {}) {
  return {
    intent: 'new_task',
    requiresExecution: true,
    executionScope: 'read_only',
    executionTarget: 'none',
    executionSurface: 'none',
    inspectionTarget: 'none',
    inspectionBreadth: 'none',
    standaloneSystemOperation: false,
    orchestrationAction: 'none',
    ...overrides
  };
}

test('the reported bug: a pure information-lookup research classification reaches Researcher, not Coder', t => {
  // The exact structured shape a competent semantic classifier returns for "What are the latest
  // updates for Crimson Desert?" - single-topic but genuinely investigative, no local system, no
  // project/workspace evidence, no desktop surface. This is what the router already resolves
  // correctly on its own (see test_specialist_routing_registry.js); the assertion here is that
  // agent.js's bridging function honors that answer instead of discarding it.
  const crimsonDesertIntent = classification({
    executionTarget: 'researcher',
    executionScope: 'read_only',
    inspectionTarget: 'none',
    reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'none' }
  });

  t.equal(router.resolveExecutionTarget(crimsonDesertIntent), 'researcher',
    'sanity check: the router itself already resolves this shape to researcher');
  t.equal(agent.resolveDispatchHandoffRole(crimsonDesertIntent), 'researcher',
    'and the Dispatch-facing bridge now honors that answer instead of collapsing it to coder');
  t.notEqual(agent.resolveDispatchHandoffRole(crimsonDesertIntent), 'coder',
    'the exact failure mode from the bug report: this must never silently become coder');
  t.end();
});
test('resolveDispatchHandoffRole accepts every registered specialist role the router can return, not a hardcoded pair', t => {
  registry.list().forEach(definition => {
    const intent = classification({ executionTarget: definition.role, executionScope: 'read_only' });
    // Only assert roles the router would actually hand back unmodified for a capability-neutral,
    // read-only request (Researcher/Coder do; Operator's own capability needs executionSurface -
    // covered separately below and already proven in test_specialist_routing_registry.js).
    if (definition.role === 'operator') return;
    t.equal(agent.resolveDispatchHandoffRole(intent), definition.role,
      definition.role + ' survives the bridge unmodified, the same as coder always did');
  });
  t.end();
});

test('resolveDispatchHandoffRole still resolves Operator correctly (no regression from the fix)', t => {
  const desktopIntent = classification({
    executionTarget: 'operator',
    executionSurface: 'desktop',
    standaloneSystemOperation: true
  });
  t.equal(agent.resolveDispatchHandoffRole(desktopIntent), 'operator', 'Operator routing is unaffected');
  t.end();
});

test('resolveDispatchHandoffRole still defaults unclassified executable work to Coder (no regression)', t => {
  const unclassified = classification({ executionTarget: 'none' });
  t.equal(agent.resolveDispatchHandoffRole(unclassified), 'coder',
    'the old default behavior for a genuinely unclassified request is unchanged');
  t.end();
});

// Deliberate contract change. delegatedInspection used to short-circuit to Coder BEFORE the router
// ran, so a read-only survey the router correctly resolved to Researcher was converted back into
// Coder work purely because it carried the flag. That is the same "a flag decides the specialist"
// mistake as routing by evidence location: the inspection policy decides WHETHER to delegate, and
// the shape of the work decides TO WHOM.
test('a delegated inspection leaves Dispatch, but the router still chooses which specialist owns it', t => {
  const researchShaped = classification({
    executionTarget: 'researcher', executionScope: 'read_only',
    inspectionTarget: 'project', inspectionBreadth: 'broad'
  });
  t.equal(
    agent.resolveDispatchHandoffRole(researchShaped, { delegatedInspection: true }),
    'researcher',
    'a read-only survey delegated for inspection stays Researcher work'
  );

  const codeShaped = classification({
    executionTarget: 'coder', executionScope: 'mutating',
    inspectionTarget: 'project', inspectionBreadth: 'broad'
  });
  t.equal(
    agent.resolveDispatchHandoffRole(codeShaped, { delegatedInspection: true }),
    'coder',
    'and diagnosis-before-a-change over the same evidence is still Coder work'
  );

  // The flag must still guarantee the work leaves Dispatch when nothing else places it.
  const unplaceable = classification({ executionTarget: 'none', inspectionTarget: 'none' });
  t.equal(
    agent.resolveDispatchHandoffRole(unplaceable, { delegatedInspection: true }),
    'coder',
    'an unplaceable delegated inspection still falls back to a specialist rather than staying in Dispatch'
  );
  t.end();
});

test('the fix is a registry membership check, not a hardcoded role list', t => {
  t.ok(agentJs.includes('OrionSpecialistRegistry.has(resolved)'),
    'resolveDispatchHandoffRole checks registry membership, so a future fourth specialist needs no change here');
  t.notOk(agentJs.includes("resolved === 'operator' || resolved === 'coder'"),
    'the old two-role literal check is gone, not just supplemented');
  t.end();
});
