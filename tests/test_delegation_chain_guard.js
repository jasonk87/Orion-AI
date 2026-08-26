'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const fs = require('fs');
const path = require('path');
const taskOrchestration = require('../task-orchestration');
const registry = require('../specialist-registry');

const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');

// Real, code-enforced replacement for the old prose-only "don't create another handoff for the
// same completed child" instruction. These tests prove a handoff loop is actually stopped — not
// merely that the code runs — by asserting evaluateDelegationHandoff refuses to extend a chain
// that would revisit a role or exceed the registered specialist count, with a clear reason string
// a caller can surface as an error.

test('evaluateDelegationHandoff allows a fresh Dispatch-initiated handoff', t => {
  const result = taskOrchestration.evaluateDelegationHandoff([], 'coder');
  t.ok(result.allowed, 'an empty chain (Dispatch, no prior specialist) may hand off to any role');
  t.deepEqual(result.nextChain, ['coder'], 'the next chain records the one hop taken');
  t.end();
});

test('evaluateDelegationHandoff allows a genuine Coder -> Operator playtest-style hop', t => {
  const result = taskOrchestration.evaluateDelegationHandoff(['coder'], 'operator');
  t.ok(result.allowed, 'a first specialist may hand off to a different second specialist');
  t.deepEqual(result.nextChain, ['coder', 'operator']);
  t.end();
});

test('evaluateDelegationHandoff allows a three-hop chain that visits every distinct registered role once', t => {
  const result = taskOrchestration.evaluateDelegationHandoff(['coder', 'operator'], 'researcher');
  t.ok(result.allowed, 'a third distinct role may still be reached');
  t.deepEqual(result.nextChain, ['coder', 'operator', 'researcher']);
  t.end();
});

test('evaluateDelegationHandoff BLOCKS a role reappearing in its own chain (the actual infinite-loop shape)', t => {
  // This is the concrete coder -> operator -> coder cycle the guard exists to prevent.
  const result = taskOrchestration.evaluateDelegationHandoff(['coder', 'operator'], 'coder');
  t.notOk(result.allowed, 'handing back to a role already in the chain is refused, not merely discouraged');
  t.ok(/loop/i.test(result.reason), 'the refusal reason names the loop risk in plain language');
  t.ok(/coder/i.test(result.reason), 'the refusal reason names the specific role that would be revisited');
  t.deepEqual(result.nextChain, ['coder', 'operator'], 'a blocked handoff does not advance the chain');
  t.end();
});

test('evaluateDelegationHandoff BLOCKS immediate self-handoff (role handing off to itself)', t => {
  const result = taskOrchestration.evaluateDelegationHandoff(['coder'], 'coder');
  t.notOk(result.allowed, 'a role cannot hand off to itself even as the very next hop');
  t.end();
});

test('evaluateDelegationHandoff enforces a hard maximum chain depth as a second, independent safeguard', t => {
  // Even setting the cycle-detection question aside, a chain longer than the registered specialist
  // count is refused outright — belt-and-suspenders in case role-set logic alone ever has a gap.
  t.ok(taskOrchestration.MAX_DELEGATION_DEPTH > 0, 'a real numeric depth cap is configured');
  const tooLong = new Array(taskOrchestration.MAX_DELEGATION_DEPTH).fill(0).map((_, i) => `role-${i}`);
  const result = taskOrchestration.evaluateDelegationHandoff(tooLong, 'one-role-too-many');
  t.notOk(result.allowed, 'a chain already at the max depth cannot be extended further');
  t.ok(/depth|hops|maximum/i.test(result.reason), 'the refusal reason explains the depth limit');
  t.end();
});

test('evaluateDelegationHandoff refuses a handoff with no target role', t => {
  const result = taskOrchestration.evaluateDelegationHandoff(['coder'], '');
  t.notOk(result.allowed, 'an empty/missing target role is refused rather than silently no-op-ing');
  t.end();
});

test('evaluateDelegationHandoff normalizes case and dedupes so the guard cannot be bypassed by casing tricks', t => {
  const result = taskOrchestration.evaluateDelegationHandoff(['Coder', 'CODER', 'coder'], 'coder');
  t.notOk(result.allowed, 'differently-cased duplicate entries still trigger the same-role block');
  t.end();
});

test('the delegation-chain guard is actually wired into the shared handoff execution path, not just defined', t => {
  t.ok(agentJs.includes('TaskOrchestration.evaluateDelegationHandoff(currentDelegationChain, role)'),
    'executeSpecialistHandoff calls the real guard function before promoting a handoff');
  t.ok(agentJs.includes("blockedError.code = 'DELEGATION_CHAIN_BLOCKED'"),
    'a blocked handoff throws a distinctly-coded error the caller can recognize, not a generic failure');
  t.ok(agentJs.includes('if (!delegationGuard.allowed)') && agentJs.includes('throw blockedError'),
    'a disallowed handoff actually throws instead of logging and proceeding anyway');
  t.end();
});

test('delegationChain survives a full buildTaskPacket -> normalizeTaskRecord round trip (the real persistence path)', t => {
  const built = taskOrchestration.buildTaskPacket({
    originalUserMessage: 'Playtest the new level',
    objective: 'Playtest the new level',
    targetMode: 'operator',
    delegationChain: ['coder']
  });
  t.equal(built.success, true);
  t.deepEqual(built.task.delegationChain, ['coder'], 'buildTaskPacket stores the chain the caller computed, sanitized');

  // Simulate the task being read back from durable storage (normalizeTaskRecord is what runs on
  // every read/write in the real task store), which is what a later handoff decision actually
  // inspects via executionContext.claimedTaskRecord.delegationChain.
  const roundTripped = taskOrchestration.normalizeTaskRecord(built.task);
  t.deepEqual(roundTripped.delegationChain, ['coder'], 'the chain survives being renormalized as if freshly read from storage');
  t.end();
});

test('a malformed or missing delegationChain on a persisted record degrades to an empty chain, not a crash', t => {
  const normalized = taskOrchestration.normalizeTaskRecord({
    taskId: 'legacy_task_no_chain',
    title: 'Pre-existing task from before delegationChain existed',
    objective: 'Old work',
    status: 'pending',
    target: { mode: 'coder', conversationId: 'legacy-1' }
  });
  t.deepEqual(normalized.delegationChain, [], 'a legacy record with no delegationChain field normalizes to an empty chain');
  t.end();
});

test('specialist-registry.js exposes the generalized handoff-tool lookup the guard and allowlists both depend on', t => {
  t.equal(registry.handoffToolNameForRole('coder'), 'handoff_to_coder');
  t.equal(registry.handoffToolNameForRole('operator'), 'handoff_to_operator');
  t.equal(registry.handoffToolNameForRole('researcher'), 'handoff_to_researcher');
  t.equal(registry.roleForHandoffTool('handoff_to_researcher'), 'researcher');
  t.ok(registry.isHandoffTool('handoff_to_coder'));
  t.notOk(registry.isHandoffTool('read_file'));

  const coderTargets = registry.handoffToolNamesFor('coder');
  t.notOk(coderTargets.includes('handoff_to_coder'), 'a role never gets a handoff tool to itself');
  t.ok(coderTargets.includes('handoff_to_operator') && coderTargets.includes('handoff_to_researcher'),
    'a role gets a handoff tool to every OTHER registered specialist');

  const dispatchTargets = registry.handoffToolNamesFor('orion');
  t.equal(dispatchTargets.length, registry.list().length, 'Dispatch (not itself a specialist) gets a handoff tool to every registered specialist, none excluded');
  t.end();
});
