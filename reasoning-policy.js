(function initReasoningPolicy(globalScope) {
  'use strict';

  const PHASES = Object.freeze([
    'casual_conversation',
    'intent_classification',
    'context_resolution',
    'impact_analysis',
    'implementation',
    'mechanical_execution',
    'failure_diagnosis',
    'adversarial_review',
    'final_response'
  ]);
  const RANK = Object.freeze({ low: 0, medium: 1, high: 2, max: 3 });

  function level(value, fallback = 'low') {
    return Object.prototype.hasOwnProperty.call(RANK, value) ? value : fallback;
  }

  function maxLevel(...values) {
    return values.map(value => level(value)).sort((left, right) => RANK[right] - RANK[left])[0] || 'low';
  }

  function select(input = {}) {
    const phase = PHASES.includes(input.phase) ? input.phase : 'implementation';
    const hint = input.hint && typeof input.hint === 'object' ? input.hint : {};
    const contextDependent = input.contextDependent === true;
    const risk = level(input.risk || hint.risk);
    const complexity = level(input.complexity || hint.complexity);
    const failures = Math.max(0, Number(input.failureCount || input.repeatedFailures) || 0);
    const broad = input.broadChange === true || risk === 'high' || complexity === 'high';
    let effort = 'medium';
    let contextScope = hint.contextNeed || 'task';
    let explorationScope = 'bounded';
    let verificationStrictness = 'standard';

    if (phase === 'casual_conversation') {
      const requestedContext = ['recent', 'task', 'project', 'historical'].includes(hint.contextNeed)
        ? hint.contextNeed
        : '';
      // Standalone greetings remain context-free. A reaction or acknowledgment that the semantic
      // classifier bound to the immediately preceding exchange still receives that recent view.
      effort = 'low';
      contextScope = requestedContext || (contextDependent ? 'recent' : 'none');
      explorationScope = 'narrow';
      verificationStrictness = 'light';
    } else if (phase === 'intent_classification') {
      effort = 'low'; contextScope = 'recent'; explorationScope = 'narrow'; verificationStrictness = 'light';
    } else if (phase === 'context_resolution') {
      effort = maxLevel('medium', complexity); contextScope = hint.contextNeed || 'recent'; explorationScope = 'bounded';
    } else if (phase === 'impact_analysis') {
      effort = broad ? 'high' : 'medium'; contextScope = broad ? 'project' : 'task'; explorationScope = broad ? 'broad' : 'bounded'; verificationStrictness = broad ? 'strict' : 'standard';
    } else if (phase === 'mechanical_execution') {
      effort = 'low'; contextScope = 'task'; explorationScope = 'narrow'; verificationStrictness = 'standard';
    } else if (phase === 'failure_diagnosis') {
      effort = failures >= 3 ? 'max' : 'high'; contextScope = 'project'; explorationScope = 'broad'; verificationStrictness = 'strict';
    } else if (phase === 'adversarial_review') {
      effort = broad ? 'max' : 'high'; contextScope = 'project'; explorationScope = 'bounded'; verificationStrictness = 'strict';
    } else if (phase === 'final_response') {
      effort = broad ? 'high' : 'medium'; contextScope = 'task'; explorationScope = 'narrow'; verificationStrictness = broad ? 'strict' : 'standard';
    } else {
      effort = maxLevel('medium', complexity, risk); contextScope = broad ? 'project' : 'task'; verificationStrictness = broad ? 'strict' : 'standard';
    }

    if (failures >= 2 && phase !== 'mechanical_execution' && phase !== 'intent_classification') {
      effort = failures >= 3 ? 'max' : maxLevel(effort, 'high');
      verificationStrictness = 'strict';
    }
    const coverageRequired = broad && ['impact_analysis', 'implementation', 'failure_diagnosis', 'adversarial_review', 'final_response'].includes(phase);
    return {
      phase,
      effort,
      contextScope,
      explorationScope,
      verificationStrictness,
      adversarialReviewRequired: risk === 'high' && ['implementation', 'adversarial_review', 'final_response'].includes(phase),
      coverageRequired,
      restoreDefaultAfterPhase: true
    };
  }

  function providerControls(modelNameValue, policyValue = {}) {
    const modelName = String(modelNameValue || '').toLowerCase();
    const effort = level(policyValue.effort);
    if (modelName.startsWith('deepseek')) {
      return effort === 'low'
        ? { thinking: { type: 'disabled' } }
        : { thinking: { type: 'enabled' }, reasoning_effort: effort === 'max' ? 'max' : 'high' };
    }
    if (modelName.startsWith('gemini-3')) {
      return { thinkingConfig: { thinkingLevel: effort === 'max' ? 'high' : effort } };
    }
    if (modelName.startsWith('gemini-2.5')) {
      const isPro = modelName.includes('pro');
      const budgets = isPro
        ? { low: 128, medium: 4096, high: 16384, max: 32768 }
        : { low: 0, medium: 2048, high: 8192, max: 24576 };
      return { thinkingConfig: { thinkingBudget: budgets[effort] } };
    }
    if (modelName.startsWith('claude')) {
      // Official Claude model names that currently expose request-scoped output_config.effort.
      // Unknown/older Claude models receive no speculative provider field.
      const supportsEffort = /(?:fable-5|mythos(?:-5|-preview)|opus-(?:4-5|4-6|4-7|4-8|5)|sonnet-(?:4-6|5))/.test(modelName);
      return supportsEffort ? { output_config: { effort } } : {};
    }
    if (/(?:qwen3|gpt-oss|deepseek-r1|deepseek-v3\.1)/.test(modelName)) {
      const ollamaEffort = modelName.includes('gpt-oss') && effort === 'max' ? 'high' : effort;
      return { think: ollamaEffort };
    }
    return {};
  }

  function promptDirective(policy = {}) {
    return [
      `[REASONING POLICY: ${policy.phase || 'implementation'}]`,
      `Effort: ${policy.effort || 'medium'}. Context: ${policy.contextScope || 'task'}. Exploration: ${policy.explorationScope || 'bounded'}. Verification: ${policy.verificationStrictness || 'standard'}.`,
      policy.coverageRequired
        ? 'Maintain the existing coverage frontier for the task blast radius; inspect and verify required surfaces instead of inferring end-to-end coverage.'
        : '',
      policy.adversarialReviewRequired
        ? 'Before finalizing, perform a bounded adversarial review of the current task blast radius.'
        : ''
    ].filter(Boolean).join('\n');
  }

  const api = { PHASES, select, providerControls, promptDirective };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionReasoningPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
