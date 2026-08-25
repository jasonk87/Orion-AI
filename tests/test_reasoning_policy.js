'use strict';

const test = require('tape');
const policy = require('../reasoning-policy');

test('casual conversation stays lightweight while retaining the active conversation', t => {
  const selected = policy.select({
    phase: 'casual_conversation',
    hint: { complexity: 'low', risk: 'low', contextNeed: 'none' }
  });
  t.equal(selected.effort, 'low', 'greetings use low effort');
  t.equal(selected.contextScope, 'recent', 'the bounded active conversation is always available');
  t.equal(selected.explorationScope, 'narrow', 'casual chat does not explore the workspace');
  t.equal(selected.verificationStrictness, 'light', 'casual chat has light verification');
  t.equal(selected.coverageRequired, false, 'coverage accounting is not imposed on chat');
  t.end();
});

test('context resolution cannot erase immediate chat just because the classifier requests none', t => {
  const selected = policy.select({
    phase: 'context_resolution',
    hint: { complexity: 'low', risk: 'low', contextNeed: 'none' }
  });
  t.equal(selected.contextScope, 'recent', 'none falls back to recent current-conversation context');
  t.equal(selected.effort, 'medium', 'context resolution stays bounded rather than escalating');
  t.end();
});

test('context-bound conversational reactions retain recent context without broad history', t => {
  const selected = policy.select({
    phase: 'casual_conversation',
    contextDependent: true,
    hint: { complexity: 'low', risk: 'low', contextNeed: 'recent' }
  });
  t.equal(selected.effort, 'low', 'a reaction remains inexpensive');
  t.equal(selected.contextScope, 'recent', 'the directly relevant exchange remains available');
  t.equal(selected.explorationScope, 'narrow', 'a reaction does not expand into project exploration');
  t.equal(selected.coverageRequired, false, 'conversation context does not trigger task coverage');
  t.end();
});

test('historical conversation requests opt into historical context explicitly', t => {
  const selected = policy.select({
    phase: 'casual_conversation',
    hint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
  });
  t.equal(selected.contextScope, 'historical', 'an actual historical request may retrieve session context');
  t.equal(selected.effort, 'low', 'retrieval intent does not permanently raise all reasoning');
  t.end();
});

test('broad shared-state implementation escalates reasoning and coverage', t => {
  const selected = policy.select({
    phase: 'implementation',
    complexity: 'high',
    risk: 'high',
    broadChange: true
  });
  t.equal(selected.effort, 'high', 'cross-process state work uses high effort');
  t.equal(selected.contextScope, 'project', 'the relevant project blast radius is available');
  t.equal(selected.verificationStrictness, 'strict', 'verification is strict');
  t.equal(selected.coverageRequired, true, 'the coverage frontier is required');
  t.equal(selected.adversarialReviewRequired, true, 'high-risk implementation requires adversarial review');
  t.end();
});

test('repeated failed theories escalate diagnosis without affecting later mechanical work', t => {
  const diagnosis = policy.select({
    phase: 'failure_diagnosis',
    failureCount: 3,
    complexity: 'medium',
    risk: 'medium'
  });
  t.equal(diagnosis.effort, 'max', 'three failed theories trigger maximum supported diagnosis effort');
  // Deliberately inverted: this used to be 'broad'. Handing a model that has failed three times
  // the whole project to explore is what produced the repeated-search loop this phase exists to
  // escape. Reasoning escalates; exploration tightens.
  t.equal(diagnosis.explorationScope, 'narrow', 'repeated failure restrains new exploration instead of widening it');
  t.equal(diagnosis.contextScope, 'project', 'the model keeps the evidence it can already see');
  t.equal(diagnosis.verificationStrictness, 'strict', 'repeated failure raises verification');

  const earlyFailure = policy.select({ phase: 'failure_diagnosis', failureCount: 1 });
  t.equal(earlyFailure.explorationScope, 'bounded', 'a first failure still allows bounded exploration');
  t.equal(earlyFailure.effort, 'high', 'a first failure raises effort without maxing it');

  const command = policy.select({
    phase: 'mechanical_execution',
    failureCount: 3,
    complexity: 'high',
    risk: 'high'
  });
  t.equal(command.effort, 'low', 'running a known command de-escalates to low effort');
  t.equal(command.explorationScope, 'narrow', 'mechanical work does not inherit broad exploration');
  t.equal(command.restoreDefaultAfterPhase, true, 'phase controls are temporary');
  t.end();
});

test('adversarial review is strongest only for broad risky work', t => {
  const risky = policy.select({
    phase: 'adversarial_review',
    risk: 'high',
    complexity: 'high'
  });
  t.equal(risky.effort, 'max', 'broad high-risk review uses maximum supported effort');
  t.equal(risky.adversarialReviewRequired, true, 'the bounded challenge pass is required');

  const small = policy.select({
    phase: 'final_response',
    risk: 'low',
    complexity: 'low'
  });
  t.equal(small.effort, 'medium', 'a small final response does not remain globally escalated');
  t.equal(small.coverageRequired, false, 'small tasks stay lightweight');
  t.equal(small.adversarialReviewRequired, false, 'small tasks do not require a formal challenge pass');
  t.end();
});

test('provider controls map only documented model families and degrade safely', t => {
  t.deepEqual(
    policy.providerControls('deepseek-chat', { effort: 'low' }),
    { thinking: { type: 'disabled' } },
    'DeepSeek low-effort phases disable thinking'
  );
  t.deepEqual(
    policy.providerControls('deepseek-reasoner', { effort: 'max' }),
    { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
    'DeepSeek high-end phases use documented thinking controls'
  );
  t.deepEqual(
    policy.providerControls('gemini-3-pro-preview', { effort: 'high' }),
    { thinkingConfig: { thinkingLevel: 'high' } },
    'Gemini 3 uses thinkingLevel'
  );
  t.deepEqual(
    policy.providerControls('gemini-2.5-pro', { effort: 'low' }),
    { thinkingConfig: { thinkingBudget: 128 } },
    'Gemini 2.5 Pro preserves its documented minimum thinking budget'
  );
  t.deepEqual(
    policy.providerControls('claude-sonnet-4-6', { effort: 'high' }),
    { output_config: { effort: 'high' } },
    'supported current Claude models receive output effort'
  );
  t.deepEqual(
    policy.providerControls('claude-opus-4-8', { effort: 'max' }),
    { output_config: { effort: 'max' } },
    'current Claude Opus models receive supported max effort'
  );
  t.deepEqual(
    policy.providerControls('claude-sonnet-5', { effort: 'low' }),
    { output_config: { effort: 'low' } },
    'current Claude Sonnet models receive supported low effort'
  );
  t.deepEqual(
    policy.providerControls('claude-sonnet-4-0', { effort: 'high' }),
    {},
    'older Claude models are not sent guessed effort fields'
  );
  t.deepEqual(
    policy.providerControls('llama3.2', { effort: 'max' }),
    {},
    'unknown or non-thinking Ollama models receive no guessed control'
  );
  t.end();
});

// ── Per-message forced reasoning level ─────────────────────────────────────────
// The picker beside the input box sets a level for the next answers. 'auto' keeps the phase
// engine in charge; anything else is the user's explicit call and outranks every heuristic,
// including failure escalation — otherwise picking Low still paid max effort after a retry.

test('forced effort overrides the phase engine in both directions', t => {
  const autoImpl = policy.select({ phase: 'implementation' });
  t.equal(autoImpl.effortSource, 'auto', 'no override leaves the policy phase-driven');

  const forcedMax = policy.select({ phase: 'casual_conversation', forcedEffort: 'max' });
  t.equal(forcedMax.effort, 'max', 'a forced Ultra lifts even a casual turn');
  t.equal(forcedMax.effortSource, 'forced', 'the source records that the user chose it');

  const forcedLow = policy.select({ phase: 'adversarial_review', forcedEffort: 'low' });
  t.equal(forcedLow.effort, 'low', 'a forced Low lowers a phase that would otherwise be high');
  t.end();
});

test('a forced level outranks repeated-failure escalation', t => {
  const escalated = policy.select({ phase: 'failure_diagnosis', failureCount: 4 });
  t.equal(escalated.effort, 'max', 'repeated failures escalate on their own');

  const forced = policy.select({ phase: 'failure_diagnosis', failureCount: 4, forcedEffort: 'low' });
  t.equal(forced.effort, 'low', 'the user-picked level still wins after repeated failures');
  t.equal(forced.verificationStrictness, 'strict',
    'only effort is overridden — run governance stays phase-driven');
  t.end();
});

test('forced effort reaches the provider controls for each family', t => {
  const forcedUltra = policy.select({ phase: 'casual_conversation', forcedEffort: 'max' });
  t.deepEqual(
    policy.providerControls('deepseek-v4-pro', forcedUltra),
    { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
    'DeepSeek receives the forced ultra effort instead of the casual default'
  );
  const forcedLow = policy.select({ phase: 'adversarial_review', forcedEffort: 'low' });
  t.deepEqual(
    policy.providerControls('deepseek-v4-flash', forcedLow),
    { thinking: { type: 'disabled' } },
    'a forced Low disables DeepSeek thinking even for adversarial review'
  );
  t.end();
});

test('effort override values are normalized defensively', t => {
  t.equal(policy.normalizeEffortOverride('Ultra'), 'max', 'the Ultra label maps to the max level');
  t.equal(policy.normalizeEffortOverride('MAX'), 'max', 'levels are case-insensitive');
  t.equal(policy.normalizeEffortOverride(''), 'auto', 'empty falls back to auto');
  t.equal(policy.normalizeEffortOverride(null), 'auto', 'null falls back to auto');
  t.equal(policy.normalizeEffortOverride('warp9'), 'auto', 'an unknown level falls back to auto');
  t.equal(policy.select({ phase: 'implementation', forcedEffort: 'warp9' }).effortSource, 'auto',
    'an invalid forced level never becomes an override');
  t.ok(policy.EFFORT_OVERRIDES.some(o => o.value === 'auto' && o.label === 'Auto'),
    'the picker list is exported for the UI to render');
  t.equal(policy.EFFORT_OVERRIDES.length, 5, 'auto plus the four effort levels');
  t.end();
});
