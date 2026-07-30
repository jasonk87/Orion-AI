'use strict';

const test = require('tape');
const policy = require('../reasoning-policy');

test('casual conversation stays lightweight and context-free', t => {
  const selected = policy.select({
    phase: 'casual_conversation',
    hint: { complexity: 'low', risk: 'low', contextNeed: 'none' }
  });
  t.equal(selected.effort, 'low', 'greetings use low effort');
  t.equal(selected.contextScope, 'none', 'unrelated history is not injected');
  t.equal(selected.explorationScope, 'narrow', 'casual chat does not explore the workspace');
  t.equal(selected.verificationStrictness, 'light', 'casual chat has light verification');
  t.equal(selected.coverageRequired, false, 'coverage accounting is not imposed on chat');
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
  t.equal(diagnosis.explorationScope, 'broad', 'diagnosis broadens inside the task blast radius');
  t.equal(diagnosis.verificationStrictness, 'strict', 'repeated failure raises verification');

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
