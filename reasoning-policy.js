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
    const risk = level(input.risk || hint.risk);
    const complexity = level(input.complexity || hint.complexity);
    const failures = Math.max(0, Number(input.failureCount || input.repeatedFailures) || 0);
    const broad = input.broadChange === true || risk === 'high' || complexity === 'high';
    let effort = 'medium';
    let contextScope = hint.contextNeed || 'task';
    let explorationScope = 'bounded';
    let verificationStrictness = 'standard';
    let requireSurfaceInventory = false;

    if (phase === 'casual_conversation') {
      // 'recent' and 'historical' are allowed; 'project'/'task' are not.
      //
      // 'historical' is a genuine recall request ("what did we talk about last week?") and routes
      // to the conversation-evidence search, which looks at actual past conversations. 'project'
      // and 'task' instead rank the global stored-fact corpus by similarity to the message, which
      // for a chatty remark returns whichever project has the most entries — that is how "I've
      // been working on you this morning" came back as a GRITLIFE status report.
      const requestedContext = ['recent', 'historical'].includes(hint.contextNeed) ? hint.contextNeed : '';
      // Current-conversation continuity is cheap and must not depend on a perfect classifier.
      // "Recent" means only this conversation's bounded visible exchange plus its private
      // compaction memory; it does not load unrelated sessions, project facts, or workspace state.
      effort = 'low';
      contextScope = requestedContext || 'recent';
      explorationScope = 'narrow';
      verificationStrictness = 'light';
    } else if (phase === 'intent_classification') {
      effort = 'low'; contextScope = 'recent'; explorationScope = 'narrow'; verificationStrictness = 'light';
    } else if (phase === 'context_resolution') {
      effort = maxLevel('medium', complexity);
      contextScope = ['task', 'project', 'historical'].includes(hint.contextNeed) ? hint.contextNeed : 'recent';
      explorationScope = 'bounded';
    } else if (phase === 'impact_analysis') {
      effort = broad ? 'high' : 'medium'; contextScope = broad ? 'project' : 'task'; explorationScope = broad ? 'broad' : 'bounded'; verificationStrictness = broad ? 'strict' : 'standard';
    } else if (phase === 'mechanical_execution') {
      effort = 'low'; contextScope = 'task'; explorationScope = 'narrow'; verificationStrictness = 'standard';
    } else if (phase === 'failure_diagnosis') {
      // Repeated failure means the current approach is wrong, not that the model has seen too
      // little — so exploration TIGHTENS as failures accumulate instead of widening. This used
      // to go straight to 'broad', which handed a thrashing model the whole project to search
      // and produced exactly the repeated-search loop it was supposed to escape.
      //
      // contextScope deliberately stays 'project': narrowing what the model can SEE would take
      // away evidence it needs to diagnose. Only new exploration is restrained.
      effort = failures >= 3 ? 'max' : 'high';
      contextScope = 'project';
      explorationScope = failures >= 3 ? 'narrow' : 'bounded';
      verificationStrictness = 'strict';
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
    // A user-forced effort level (picked next to the input box) wins over everything the phase
    // engine decided, including failure escalation — forced means forced.
    const forcedEffort = Object.prototype.hasOwnProperty.call(RANK, input.forcedEffort)
      ? input.forcedEffort
      : '';
    if (forcedEffort) effort = forcedEffort;

    let coverageRequired = broad && ['impact_analysis', 'implementation', 'failure_diagnosis', 'adversarial_review', 'final_response'].includes(phase);
    let adversarialReviewRequired = risk === 'high' && ['implementation', 'adversarial_review', 'final_response'].includes(phase);

    // Asking for the hardest thinking and getting a narrow look is the failure this prevents.
    // Effort alone only buys deeper reasoning about whatever the model already chose to look
    // at, so a forced high/max could think brilliantly about a self-selected corner while
    // never inventorying the surface it was asked to audit. Raising effort therefore raises
    // the RIGOUR knobs with it: how much evidence is required, and how hard a claim must be
    // proven before it counts.
    //
    // What it deliberately does NOT do is widen contextScope to the whole repository. "Think
    // as hard as possible" is not "read everything" — the blast radius still comes from the
    // task. Breadth is set by the caller declaring a broad audit (below), not by effort.
    const forcedHigh = forcedEffort === 'high' || forcedEffort === 'max';
    if (forcedHigh && phase !== 'intent_classification' && phase !== 'mechanical_execution') {
      verificationStrictness = 'strict';
      if (explorationScope === 'narrow') explorationScope = 'bounded';
      if (['impact_analysis', 'implementation', 'failure_diagnosis', 'adversarial_review', 'final_response', 'context_resolution'].includes(phase)) {
        coverageRequired = true;
      }
      if (forcedEffort === 'max' && ['implementation', 'adversarial_review', 'final_response', 'failure_diagnosis'].includes(phase)) {
        adversarialReviewRequired = true;
      }
    }

    // An explicitly broad request (a full audit, "review everything I changed") is the one case
    // where the blast radius itself must be comprehensive. Item 11 in practice: a review that
    // picked a few related files was excellent inside its chosen area and silently incomplete
    // outside it. Breadth is declared, then tracked — not inferred from effort.
    const auditBreadth = input.auditBreadth === 'comprehensive';
    if (auditBreadth) {
      contextScope = 'project';
      explorationScope = 'broad';
      verificationStrictness = 'strict';
      coverageRequired = true;
      requireSurfaceInventory = true;
    }

    return {
      phase,
      effort,
      effortSource: forcedEffort ? 'forced' : 'auto',
      contextScope,
      explorationScope,
      verificationStrictness,
      adversarialReviewRequired,
      coverageRequired,
      requireSurfaceInventory,
      auditBreadth: auditBreadth ? 'comprehensive' : 'task',
      restoreDefaultAfterPhase: true
    };
  }

  function providerControls(modelNameValue, policyValue = {}) {
    const modelName = String(modelNameValue || '').toLowerCase();
    const effort = level(policyValue.effort);
    if (modelName.startsWith('deepseek')) {
      // The policy engine resolves four levels, but this branch used to collapse medium into
      // 'high' — so every ordinary tool-selection turn ('implementation' resolves to at least
      // medium) paid high-effort reasoning just to decide to run a grep. Each level now maps
      // to itself, which is the difference between a fast loop and a slow one.
      return effort === 'low'
        ? { thinking: { type: 'disabled' } }
        : { thinking: { type: 'enabled' }, reasoning_effort: effort };
    }
    if (modelName.startsWith('groq:')) {
      // Groq's Chat Completions API exposes model-specific reasoning controls. GPT-OSS and
      // Qwen 3.8 accept low/medium/high; neither accepts Orion's "max", so Ultra maps to high.
      // Qwen 3.6 only supports the binary none/default control documented by Groq.
      if (modelName.includes('qwen/qwen3.6-27b')) {
        return { reasoning_effort: effort === 'low' ? 'none' : 'default' };
      }
      return { reasoning_effort: effort === 'max' ? 'high' : effort };
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
    // ChatGPT reasons under Orion's policy like every other provider. The effort levels this engine
    // resolves (low/medium/high/max) are all accepted by gpt-5.6 verbatim, so each maps to itself
    // and no level is silently collapsed into a neighbour.
    //
    // The shape matters: `reasoning: { effort }` is the Responses API field. It is NOT valid on
    // chat/completions alongside function tools - that combination is a hard 400 - which is
    // precisely why callOpenAIAPI targets /v1/responses. Anything that sends these controls to a
    // chat/completions endpoint must drop them instead.
    //
    // Checked before the Ollama gpt-oss pattern below, which would otherwise capture these names.
    if (/^gpt-(?!oss)/.test(modelName)) {
      return { reasoning: { effort } };
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
        : '',
      // The instruction that turns a broad request into an actually-comprehensive one. Without
      // it a model picks a plausible subset, reviews it well, and reports as though it covered
      // everything — thorough-looking and incomplete.
      policy.requireSurfaceInventory
        ? 'This is an explicitly comprehensive audit. Before analysing anything, ENUMERATE the full changed surface first (every materially changed file/module in scope) and state that inventory. Then work through it. You may judge an item low-risk and say so briefly, but you may not silently omit it. If you cannot enumerate the surface, say so instead of reviewing a self-selected subset.'
        : '',
      policy.effortSource === 'forced' && (policy.effort === 'high' || policy.effort === 'max')
        ? 'The user explicitly requested this reasoning depth. Spend it on rigour, not narration: for every load-bearing claim, trace it to the actual source text or a command result before asserting it, and state plainly which claims you verified versus inferred. Do not assert agreement with a finding you have not checked yourself.'
        : ''
    ].filter(Boolean).join('\n');
  }

  // The per-message override levels offered next to the input box. 'auto' means "no override:
  // let the phase engine decide" and is the default. 'max' is surfaced to the user as "Ultra".
  const EFFORT_OVERRIDES = Object.freeze([
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Ultra' }
  ]);

  function normalizeEffortOverride(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'ultra') return 'max';
    return EFFORT_OVERRIDES.some(option => option.value === normalized) ? normalized : 'auto';
  }

  const api = { PHASES, EFFORT_OVERRIDES, select, providerControls, promptDirective, normalizeEffortOverride };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionReasoningPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
