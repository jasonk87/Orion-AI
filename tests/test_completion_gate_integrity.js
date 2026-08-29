'use strict';

// From a real run: Coder was asked to commit and push, did it, verified it, and then spent ELEVEN
// more tool calls cycling evaluate_win_conditions -> update_coverage_frontier ->
// record_adversarial_review, each time told "continue_work". The gate demanded "impact analysis:
// identify the task-specific blast radius" for three git commands.
//
// It escaped by rewriting its own bar: set_coverage_frontier replaced the whole frontier, so the
// blast-radius requirement it could not satisfy was swapped for four things it had already
// finished, which it then declared verified. A gate the gated party can redefine is not a gate.
//
// Three defects, all covered here:
//   1. The bar was redefinable - by wholesale replacement, and by marking a required surface
//      out of scope, which the gate skipped.
//   2. The requirement came from a pre-run prediction rather than evidence. The run mutated zero
//      files, so there was no blast radius to cover and the surface was unsatisfiable by
//      construction.
//   3. The existing loop escape (shouldEscapeRepeatedCompletionGateBlock) compares gate
//      signatures - and never fired, because rewriting the frontier changed the signature every
//      cycle. Sealing the bar is what lets that escape work.

process.env.NODE_ENV = 'test';

const test = require('tape');
const context = require('../operational-context');

function seededState() {
  let state = context.createEmptyContext('2026-08-29T00:00:00.000Z');
  state = context.applyAction(state, 'update_mission_context', { mission: 'Commit and push the pending work.' }, '2026-08-29T00:00:00.000Z').state;
  state = context.applyAction(state, 'set_coverage_frontier', {
    risk: 'high',
    requiredSurfaces: ['impact analysis: identify the task-specific blast radius'],
    notInspected: ['impact analysis: identify the task-specific blast radius'],
    adversarialReviewRequired: true
  }, '2026-08-29T00:00:00.000Z').state;
  return state;
}

// ── 1. The bar cannot be redefined by the party it gates ────────────────────

test('a later set_coverage_frontier cannot drop the sealed surface', t => {
  let state = seededState();
  const result = context.applyAction(state, 'set_coverage_frontier', {
    risk: 'low',
    requiredSurfaces: ['staged diff integrity', 'regression test result'],
    adversarialReviewRequired: true
  }, '2026-08-29T00:01:00.000Z');
  const surfaces = result.state.coverageFrontier.requiredSurfaces.map(s => s.toLowerCase());
  t.ok(surfaces.includes('impact analysis: identify the task-specific blast radius'),
    'the originally required surface survives the rewrite that tried to replace it');
  t.ok(surfaces.includes('staged diff integrity'), 'and the newly named surfaces are ADDED');
  t.match(result.event.summary, /cannot be dropped/i, 'the attempt to narrow the bar is reported, not silent');
  t.end();
});

test('a sealed surface cannot be retired by marking it out of scope', t => {
  let state = seededState();
  state = context.applyAction(state, 'update_coverage_frontier', {
    outOfScope: ['impact analysis: identify the task-specific blast radius']
  }, '2026-08-29T00:02:00.000Z').state;
  const gate = context.evaluateCompletionGate(state, { explicitRequirements: [], recordedFileMutations: 3 });
  t.ok(gate.missingCoverage.some(entry => /blast radius/i.test(entry)),
    'the gate still requires it - out-of-scope was the second way a run rewrote its own bar');
  t.end();
});

test('a surface the model added for itself CAN still be scoped out', t => {
  let state = seededState();
  state = context.applyAction(state, 'set_coverage_frontier', {
    risk: 'high',
    requiredSurfaces: ['a surface the model added'],
    adversarialReviewRequired: true
  }, '2026-08-29T00:01:00.000Z').state;
  state = context.applyAction(state, 'update_coverage_frontier', {
    outOfScope: ['a surface the model added']
  }, '2026-08-29T00:02:00.000Z').state;
  const gate = context.evaluateCompletionGate(state, { explicitRequirements: [], recordedFileMutations: 3 });
  t.notOk(gate.missingCoverage.some(entry => /a surface the model added/i.test(entry)),
    'sealing constrains the seeded bar, not the model\'s own additions');
  t.end();
});

// ── 2. The requirement follows evidence, not a pre-run prediction ────────────

test('a run that mutated nothing is not held open by a blast-radius requirement', t => {
  const state = seededState();
  const gate = context.evaluateCompletionGate(state, { explicitRequirements: [], recordedFileMutations: 0 });
  t.notOk(gate.missingCoverage.some(entry => /blast radius/i.test(entry)),
    'no files changed means there is no blast radius to cover - the git task was held open by exactly this');
  t.end();
});

test('a run that DID mutate files is still held to the blast-radius requirement', t => {
  const state = seededState();
  const gate = context.evaluateCompletionGate(state, { explicitRequirements: [], recordedFileMutations: 4 });
  t.ok(gate.missingCoverage.some(entry => /blast radius/i.test(entry)),
    'real code changes still owe real coverage - this must not become a blanket exemption');
  t.end();
});

// ── 3. The valve: unsatisfiable is declared with a reason, and stays visible ──

test('declaring a surface unsatisfiable requires naming it and saying why', t => {
  const state = seededState();
  t.throws(() => context.applyAction(state, 'declare_coverage_unsatisfiable', { surface: '' }, '2026-08-29T00:03:00.000Z'),
    /naming the surface/i, 'an unnamed surface is refused');
  t.throws(() => context.applyAction(state, 'declare_coverage_unsatisfiable',
    { surface: 'impact analysis: identify the task-specific blast radius' }, '2026-08-29T00:03:00.000Z'),
    /reason is required/i, 'and a declaration without a reason is refused - the reason is what reaches the user');
  t.throws(() => context.applyAction(state, 'declare_coverage_unsatisfiable',
    { surface: 'something never required', reason: 'because' }, '2026-08-29T00:03:00.000Z'),
    /not a required surface/i, 'a surface that was never required cannot be "declared away"');
  t.end();
});

test('a declared-unsatisfiable surface unblocks the gate but is carried to the user', t => {
  let state = seededState();
  state = context.applyAction(state, 'declare_coverage_unsatisfiable', {
    surface: 'impact analysis: identify the task-specific blast radius',
    reason: 'This task commits and pushes existing work; it changes no source, so there is no blast radius.'
  }, '2026-08-29T00:03:00.000Z').state;
  const gate = context.evaluateCompletionGate(state, { explicitRequirements: [], recordedFileMutations: 3 });
  t.notOk(gate.missingCoverage.some(entry => /blast radius/i.test(entry)),
    'the run is not deadlocked by a requirement it genuinely cannot meet');
  t.ok(gate.unsatisfiableSurfaces && gate.unsatisfiableSurfaces.length === 1,
    'but the declaration rides on the gate result rather than disappearing');
  t.match(gate.unsatisfiableSurfaces[0].reason, /no blast radius/i, 'carrying the stated reason for review');
  t.end();
});

// ── The loop escape that sealing repairs ─────────────────────────────────────

test('with the bar sealed, a repeated evaluation produces a stable gate signature', t => {
  // The existing escape compares signatures across evaluations. It never fired in the real run
  // because rewriting the frontier changed the signature every cycle.
  let state = seededState();
  const first = context.evaluateCompletionGate(state, { explicitRequirements: [], recordedFileMutations: 3 });
  const rewritten = context.applyAction(state, 'set_coverage_frontier', {
    risk: 'low',
    requiredSurfaces: ['something easier'],
    adversarialReviewRequired: true
  }, '2026-08-29T00:04:00.000Z').state;
  const second = context.evaluateCompletionGate(rewritten, { explicitRequirements: [], recordedFileMutations: 3 });
  t.ok(second.missingCoverage.some(entry => /blast radius/i.test(entry)),
    'the rewrite cannot make the blocking reason disappear');
  t.ok(first.missingCoverage.some(entry => /blast radius/i.test(entry)),
    'so the blocking reason is stable across evaluations, which is what lets the loop escape fire');
  t.end();
});

test('the frontier survives a persistence round trip with its seal intact', t => {
  const state = seededState();
  const revived = context.normalizeContext(JSON.parse(JSON.stringify(state)));
  t.deepEqual(revived.coverageFrontier.sealedSurfaces, state.coverageFrontier.sealedSurfaces,
    'the seal is durable - a restart must not silently unseal the bar');
  const result = context.applyAction(revived, 'set_coverage_frontier', {
    risk: 'low', requiredSurfaces: ['something easier'], adversarialReviewRequired: false
  }, '2026-08-29T00:05:00.000Z');
  t.ok(result.state.coverageFrontier.requiredSurfaces.some(s => /blast radius/i.test(s)),
    'and it still cannot be dropped after reload');
  t.end();
});
