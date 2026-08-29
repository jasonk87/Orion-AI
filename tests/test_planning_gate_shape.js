'use strict';

// The other half of the ceremony problem. Asked to commit and push already-finished work, Coder
// produced a ~1500-word implementation plan - objective, five execution steps, a testing plan,
// repository-integrity checks, edge cases - and stopped at an approval gate. For three git
// commands the user had already asked for by name.
//
// The trigger was `requiresExecution && !readOnly && highImpact`, where highImpact is only the
// classifier's complexity/risk guess. 23 changed files scored high, so the run earned a plan. That
// sizes the diff instead of judging the work.
//
// A plan exists so the user can weigh in on HOW before the work commits to an approach. That is
// worth an approval gate when the how is genuinely open. It is ceremony for a known procedure over
// state that already exists - committing two hundred files decides nothing that committing two
// would not. So the gate now reads the SHAPE of the work, the same principle already used for
// specialist routing: the location (or here, the size) of the work does not determine the
// treatment; its shape does.

process.env.NODE_ENV = 'test';
global.window = {};

const test = require('tape');
const agent = require('../agent');

function intent(overrides = {}) {
  return {
    intent: 'task_request',
    requiresExecution: true,
    executionScope: 'mutating',
    inspectionTarget: 'project',
    inspectionBreadth: 'focused',
    reasoningPolicyHint: { complexity: 'high', risk: 'high' },
    ...overrides
  };
}

async function planningMode(semanticIntent) {
  const decision = await agent.classifyPlanningNeed('do the thing', 'gemini-2.5-flash-lite', {}, [], semanticIntent);
  return decision.mode;
}

test('high-impact AUTHORING work still gets a plan and an approval gate', async t => {
  t.equal(await planningMode(intent({ workShape: 'authoring' })), 'plan',
    'a real implementation change is exactly what the approval gate is for');
  t.end();
});

test('mechanical work of the same declared impact does not', async t => {
  t.equal(await planningMode(intent({ workShape: 'mechanical' })), 'direct',
    'committing and pushing finished work has no open question for a plan to answer');
  t.end();
});

test('size does not decide it - a huge mechanical job is still mechanical', async t => {
  t.equal(await planningMode(intent({ workShape: 'mechanical', reasoningPolicyHint: { complexity: 'high', risk: 'high' } })), 'direct',
    'the 23-file commit that triggered this is direct regardless of how it scored');
  t.equal(await planningMode(intent({ workShape: 'authoring', reasoningPolicyHint: { complexity: 'high', risk: 'low' } })), 'plan',
    'while a small-but-open authoring change still plans');
  t.end();
});

test('an absent or unrecognized shape keeps the stricter path', async t => {
  t.equal(await planningMode(intent()), 'plan',
    'no shape reported means the old behavior stands - a classifier failure cannot wave a change past review');
  t.equal(await planningMode(intent({ workShape: '' })), 'plan', 'an empty shape is not mechanical');
  t.equal(await planningMode(intent({ workShape: 'MECHANICAL_SOUNDING_GUESS' })), 'plan',
    'and neither is an unrecognized value');
  t.end();
});

test('skipping the plan is not skipping the work - execution is unchanged', async t => {
  const decision = await agent.classifyPlanningNeed('commit and push', 'gemini-2.5-flash-lite', {}, [],
    intent({ workShape: 'mechanical' }));
  t.equal(decision.mode, 'direct', 'it proceeds directly');
  t.notEqual(decision.mode, 'answer', 'it is NOT downgraded to a conversational reply - the work still runs');
  t.end();
});

test('low-impact work was already direct and is unaffected', async t => {
  t.equal(await planningMode(intent({ workShape: 'authoring', reasoningPolicyHint: { complexity: 'low', risk: 'low' } })), 'direct',
    'the shape rule only removes ceremony; it never adds any');
  t.end();
});

test('read-only work is still never planned, whatever its shape', async t => {
  t.equal(await planningMode(intent({ workShape: 'investigation', executionScope: 'read_only' })), 'direct',
    'inspection never needed an approval gate');
  t.end();
});

test('conversation is still answered rather than executed', async t => {
  t.equal(await planningMode({ intent: 'conversation', requiresExecution: false, workShape: 'none', reasoningPolicyHint: {} }), 'answer',
    'the conversational path is untouched');
  t.end();
});

// ── The classifier contract that feeds it ────────────────────────────────────

test('workShape is offered to the model and normalized defensively', t => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../semantic-intent-router.js'), 'utf8');
  t.ok(/workShape: 'none \| mechanical \| authoring \| investigation'/.test(source),
    'the model is offered the field in the response schema');
  t.ok(/workShape describes the SHAPE of the work, never its size/.test(source),
    'with guidance that separates shape from size, since size is what misfired');
  t.ok(/\['mechanical', 'authoring', 'investigation'\]\.includes/.test(source),
    'and only those exact values are accepted');
  t.end();
});

test('a classifier fallback reports no shape rather than guessing one', t => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../semantic-intent-router.js'), 'utf8');
  t.ok(/workShape: 'none',/.test(source),
    'the safe-fallback intent carries no shape, so a failed classification keeps the plan gate');
  t.ok(/: ''(?:,|\s*\n)/.test(source.slice(source.indexOf('workShape: [') || 0, source.indexOf('workShape: [') + 400)),
    'and the normalizer collapses anything unrecognized to empty rather than to a shape');
  t.end();
});

// ── Mechanical work also stops seeding a coverage frontier ───────────────────

test('mechanical work runs under the phase built for it, so it seeds no coverage frontier', t => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  t.ok(/workShape === 'mechanical' \? 'mechanical_execution' : 'implementation'/.test(source),
    'the run reasons under mechanical_execution, which already exists for a known command');

  const reasoningPolicy = require('../reasoning-policy');
  const mechanical = reasoningPolicy.select({ phase: 'mechanical_execution', hint: { complexity: 'high', risk: 'high' } });
  t.equal(mechanical.coverageRequired, false,
    'so no blast-radius frontier is seeded for work that decides nothing');
  const implementation = reasoningPolicy.select({ phase: 'implementation', hint: { complexity: 'high', risk: 'high' } });
  t.equal(implementation.coverageRequired, true,
    'while real implementation work still owes coverage');
  t.end();
});
