process.env.NODE_ENV = 'test';
const test = require('tape');

global.window = {};
const agent = require('../agent.js');
const runAgentLoop = global.window.runAgentLoop;
const runDurableSchedule = global.window.runDurableSchedule;
const stopAgentExecution = global.window.stopAgentExecution;
const isAgentRunning = global.window.isAgentRunning;
const getRunningConversationId = global.window.getRunningConversationId;
const getActiveRunTaskId = global.window.getActiveRunTaskId;
const nativeSetTimeout = global.setTimeout;

function geminiResponse(parts) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ finishReason: 'STOP', content: { parts } }]
    })
  };
}

function semanticClassification(overrides = {}) {
  return {
    intent: 'conversation',
    requiresExecution: false,
    target: 'none',
    resolvedRequest: '',
    contextDependent: false,
    confidence: 1,
    needsClarification: false,
    clarificationQuestion: '',
    reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'none' },
    memoryIntent: 'none',
    memoryContext: { needed: false, query: '', confidence: 0 },
    taskResolution: { title: '', requirements: [], constraints: [], unresolvedDecisions: [] },
    executionScope: 'none',
    executionTarget: 'none',
    inspectionTarget: 'none',
    standaloneSystemOperation: false,
    ...overrides
  };
}

function installHarness(modelTurns, options = {}) {
  const systemMessages = [];
  const rendered = [];
  const projects = options.projects || [];
  const api = {
    listFiles: async () => [],
    readFile: async () => '',
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
    ...(options.api || {})
  };
  for (const key of Object.keys(global.window)) {
    if (key !== 'runAgentLoop') delete global.window[key];
  }
  Object.assign(global.window, {
    runAgentLoop,
    runDurableSchedule,
    stopAgentExecution,
    isAgentRunning,
    getRunningConversationId,
    getActiveRunTaskId,
    appendSystemMessage: text => systemMessages.push(String(text || '')),
    renderAiMessage: text => rendered.push(String(text || '')),
    getAppConfig: () => ({
      planningMode: false,
      geminiApiKey: 'test-key',
      modelCallDelayMs: 0,
      autoTest: false
    }),
    getCurrentWorkspace: () => options.workspace || 'C:\\Users\\Owner\\Desktop\\Projects',
    getKnownProjects: () => projects,
    getRecentProjectCandidates: () => options.recentProjects || [],
    getDispatchWorkspaceRoot: () => 'C:\\Users\\Owner\\Desktop\\Projects',
    clearActiveAiBubble: () => {},
    saveConversationsToStorage: () => {},
    flushConversationsToStorage: async () => ({ success: true }),
    markConversationDirty: () => {},
    onAgentStatusChange: () => {},
    changeActiveWorkspace: path => {
      global.window.changedWorkspace = path;
    },
    api,
    ...(options.window || {})
  });

  let turnIndex = 0;
  global.fetch = async (url, request = {}) => {
    const body = request.body ? JSON.parse(request.body) : {};
    const serialized = JSON.stringify(body);
    if (String(url).includes(':countTokens')) {
      return { ok: true, json: async () => ({ totalTokens: 100 }) };
    }
    if (serialized.includes('Classify the current user turn. Return JSON only.')) {
      return geminiResponse([{ text: JSON.stringify(semanticClassification(options.semanticClassification)) }]);
    }
    if (serialized.includes('bounded supervisor for an autonomous local coding agent')
        && Object.prototype.hasOwnProperty.call(options, 'supervisorResponse')) {
      return geminiResponse([{ text: String(options.supervisorResponse || '') }]);
    }
    const next = modelTurns[Math.min(turnIndex, modelTurns.length - 1)];
    turnIndex += 1;
    return geminiResponse(typeof next === 'function' ? next(body) : next);
  };

  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 500) return null;
    return nativeSetTimeout(fn, delay, ...args);
  };
  return { systemMessages, rendered, get modelTurns() { return turnIndex; } };
}

function conversation(id, overrides = {}) {
  return {
    id,
    title: 'Orchestration regression',
    mode: 'orion',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects',
    messages: [],
    tasks: [],
    awaitingPlanApproval: false,
    planApproved: false,
    ...overrides
  };
}

function restoreGlobals(originalFetch) {
  global.fetch = originalFetch;
  global.setTimeout = nativeSetTimeout;
}

test('Dispatch keeps the immediately preceding completion in context for a conversational reaction', async t => {
  const originalFetch = global.fetch;
  let completionReachedModel = false;
  installHarness([
    body => {
      const serialized = JSON.stringify(body);
      completionReachedModel = serialized.includes('Full Polish Pass is complete and 534 tests pass.');
      return [{ text: 'Absolutely — the Full Polish Pass is complete and the verified result is still in context.' }];
    }
  ], {
    semanticClassification: semanticClassification({
      intent: 'conversation',
      contextDependent: true,
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'recent' }
    })
  });
  const conv = conversation('dispatch-completion-reaction', {
    messages: [
      {
        id: 'completion-message',
        role: 'assistant',
        source: 'supervisor-completion',
        text: 'Full Polish Pass is complete and 534 tests pass.',
        createdAt: 1000
      },
      {
        id: 'reaction-message',
        role: 'user',
        source: 'phone',
        text: 'Awesome',
        createdAt: 1100
      }
    ]
  });
  try {
    await global.window.runAgentLoop('Awesome', 'gemini-1', conv);
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.equal(completionReachedModel, true, 'the direct completion message reaches the actual Dispatch model call');
    t.match(finalAssistant.text, /Full Polish Pass is complete/i, 'Dispatch responds to the real preceding result');
    t.notOk(
      /no pending task|what are we working on/i.test(finalAssistant.text),
      'Dispatch does not reset to a new-chat greeting'
    );
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch accepts the first concise casual answer without a planning-gate rewrite', async t => {
  const originalFetch = global.fetch;
  const firstAnswer = "Hey Jason — I'm here. What's going on?";
  const harness = installHarness([
    [{ text: firstAnswer }],
    [{ text: "Just a casual check-in — nothing to plan or build. What's up?" }]
  ], {
    semanticClassification: semanticClassification({
      intent: 'conversation',
      requiresExecution: false,
      target: 'none',
      executionScope: 'none',
      inspectionTarget: 'none',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'none' }
    }),
    window: {
      getAppConfig: () => ({
        planningMode: true,
        geminiApiKey: 'test-key',
        modelCallDelayMs: 0,
        autoTest: false
      })
    }
  });
  const conv = conversation('dispatch-casual-first-answer');
  try {
    await global.window.runAgentLoop("What's up?", 'gemini-1', conv);
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.equal(harness.modelTurns, 1, 'the answer is accepted on the first model turn');
    t.equal(finalAssistant.text, firstAnswer, 'the original natural answer is preserved exactly');
    t.notOk(/nothing to plan or build/i.test(finalAssistant.text), 'planning-gate language never replaces the answer');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch first reply receives the exact statement and a no-greeting-only response contract', async t => {
  const originalFetch = global.fetch;
  let sawExactStatement = false;
  let sawFirstReplyContract = false;
  const harness = installHarness([
    body => {
      const serialized = JSON.stringify(body);
      sawExactStatement = serialized.includes('You have received some more updates');
      sawFirstReplyContract = serialized.includes('FIRST REPLY:')
        && serialized.includes("Respond to the substance of Jason's exact message immediately")
        && serialized.includes('a greeting alone is never an answer');
      return [{ text: 'I have — and the new Researcher role is one of the latest additions.' }];
    }
  ], {
    semanticClassification: semanticClassification({
      intent: 'conversation',
      requiresExecution: false,
      target: 'none',
      resolvedRequest: 'Acknowledge and discuss the additional Orion updates.',
      executionScope: 'none',
      inspectionTarget: 'none',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'none' }
    })
  });
  const conv = conversation('dispatch-first-statement-acknowledgment');
  try {
    await global.window.runAgentLoop('You have received some more updates', 'gemini-1', conv);
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.equal(harness.modelTurns, 1, 'the first response is produced in one answer turn without a corrective gate');
    t.ok(sawExactStatement, 'the exact first statement reaches the answer model');
    t.ok(sawFirstReplyContract, 'the answer model is told that a greeting alone is not a response');
    t.equal(finalAssistant.text, 'I have — and the new Researcher role is one of the latest additions.',
      'the substantive first response remains canonical');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a completed phone-style run releases run-scoped leases without throwing after the answer', async t => {
  const originalFetch = global.fetch;
  const releaseCalls = [];
  installHarness([
    [{ text: 'Got it — noted.' }]
  ], {
    semanticClassification: semanticClassification({ intent: 'conversation' }),
    api: {
      releaseResourceLease: async payload => {
        releaseCalls.push(payload);
        return { success: true };
      }
    }
  });
  const conv = conversation('phone-cleanup-regression');
  let error = null;
  try {
    await global.window.runAgentLoop('You should have quite a bit of upgrades', 'gemini-1', conv, { source: 'phone' });
    await new Promise(resolve => setTimeout(resolve, 0));
  } catch (caught) {
    error = caught;
  } finally {
    restoreGlobals(originalFetch);
  }
  t.error(error, 'successful answer cleanup does not throw a workspacePath ReferenceError');
  const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
  t.equal(finalAssistant && finalAssistant.text, 'Got it — noted.', 'the completed answer remains canonical after cleanup');
  t.deepEqual(
    releaseCalls.map(call => call.resourceType),
    ['desktop', 'browser', 'workspace'],
    'desktop, browser, and resolved-workspace leases are all released after the run'
  );
  t.end();
});

test('Dispatch retains immediate conversation even when semantic classification misses the reference', async t => {
  const originalFetch = global.fetch;
  let priorStatementReachedModel = false;
  installHarness([
    body => {
      const serialized = JSON.stringify(body);
      priorStatementReachedModel = serialized.includes('Just getting ready for another day of work');
      return [{ text: 'Right — you said you are getting ready for another day of work. I am with you.' }];
    }
  ], {
    semanticClassification: semanticClassification({
      intent: 'conversation',
      contextDependent: false,
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'none' }
    })
  });
  const conv = conversation('dispatch-immediate-chat-memory', {
    messages: [
      { role: 'user', text: "What's up?", createdAt: 1 },
      { role: 'assistant', text: "Morning. What's on the docket today?", createdAt: 2 },
      { role: 'user', text: 'Just getting ready for another day of work', createdAt: 3 },
      { role: 'assistant', text: "Morning. What's on the docket today?", createdAt: 4 },
      { role: 'user', text: 'As I just said getting ready for another day of work', createdAt: 5 }
    ]
  });

  try {
    await global.window.runAgentLoop('As I just said getting ready for another day of work', 'gemini-1', conv);
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.equal(priorStatementReachedModel, true, 'the active conversation reaches the real provider request independently of classifier accuracy');
    t.match(finalAssistant.text, /you said you are getting ready/i, 'the reply can acknowledge the actual preceding statement');
    t.notEqual(finalAssistant.text, "Morning. What's on the docket today?", 'the stale generic answer is not repeated');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch answers safely when the semantic classifier times out', async t => {
  const originalFetch = global.fetch;
  let toolsWereExposed = null;
  let offeredToolNames = [];
  const harness = installHarness([
    [{ text: "Hey Jason — I'm here. What's going on?" }]
  ], {
    window: {
      getAppConfig: () => ({
        planningMode: true,
        geminiApiKey: 'test-key',
        utilityModelTimeoutMs: 20,
        modelCallDelayMs: 0,
        autoTest: false
      })
    }
  });
  const workingFetch = global.fetch;
  global.fetch = async (url, request = {}) => {
    const body = request.body ? JSON.parse(request.body) : {};
    if (JSON.stringify(body).includes('Classify the current user turn. Return JSON only.')) {
      return new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    if (String(url).includes(':generateContent')) {
      toolsWereExposed = Object.prototype.hasOwnProperty.call(body, 'tools');
      offeredToolNames = ((body.tools || [])[0] && (body.tools || [])[0].functionDeclarations || [])
        .map(tool => tool.name);
    }
    return workingFetch(url, request);
  };
  const conv = conversation('dispatch-classifier-timeout');
  const startedAt = Date.now();

  try {
    await global.window.runAgentLoop("What's up?", 'gemini-1', conv);
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.ok(Date.now() - startedAt < 1000, 'the stalled preflight is bounded');
    t.equal(harness.modelTurns, 1, 'the normal answer model still runs once');
    t.equal(toolsWereExposed, true, 'classifier failure retains a deliberately narrow evidence surface');
    t.ok(offeredToolNames.includes('read_file'), 'the fallback can still inspect the named project');
    t.notOk(offeredToolNames.includes('handoff_to_coder'), 'the fallback cannot create executable work');
    t.notOk(offeredToolNames.includes('cancel_coder_task'), 'the fallback cannot mutate task lifecycle state');
    t.equal(finalAssistant.text, "Hey Jason — I'm here. What's going on?", 'classifier failure does not replace conversation with an error gate');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('exact unchanged source ranges are not reread repeatedly inside one recent context window', t => {
  const ledger = agent.createContextAcquisitionLedger();
  const args = { path: 'systems/retirement.py', startLine: 139, endLine: 220 };
  agent.recordContextAcquisitionToolResult(ledger, 'read_file', args, {
    content: Array.from({ length: 82 }, (_, index) => `line ${139 + index}`).join('\n')
  });

  const redundant = agent.getRecentRedundantContextRead(ledger, 'read_file', args);
  t.equal(redundant && redundant.redundantContext, true, 'an immediate identical range read returns a bounded reuse receipt');
  t.equal(redundant && redundant.reusedEvidence, true, 'the first duplicate replays the exact cached evidence');
  t.match(redundant && redundant.content, /line 139/, 'the cached response actually contains the requested source');
  t.match(redundant.message, /included|move to analysis/i, 'the receipt tells Coder to use evidence and advance');

  const repeatedAgain = agent.getRecentRedundantContextRead(ledger, 'read_file', args);
  t.equal(repeatedAgain && repeatedAgain.success, false, 'a second identical retry is rejected instead of posing as useful work');
  t.equal(repeatedAgain && repeatedAgain.failureCategory, 'redundant_context_loop', 'the repeated retry has a machine-readable loop category');
  t.equal(repeatedAgain && repeatedAgain.retryable, false, 'the model is explicitly told not to retry the same read');

  agent.invalidateContextAcquisitionForFile(ledger, 'systems/retirement.py', 'modify_file');
  t.equal(
    agent.getRecentRedundantContextRead(ledger, 'read_file', args),
    null,
    'a real file mutation invalidates the reuse guard and permits a fresh read'
  );
  t.end();
});

test('Coder escapes repeated unchanged read_file calls without exhausting its action budget', async t => {
  const originalFetch = global.fetch;
  let physicalReadCalls = 0;
  let physicalReadCallsAfterInitial = 0;
  let cachedSourceReachedModel = false;
  let correctionReachedModel = false;
  const repeatedRead = {
    functionCall: {
      name: 'read_file',
      args: { path: 'render/screens.py', startLine: 58, endLine: 200 }
    }
  };
  installHarness([
    [{ text: 'I will inspect the StatPanel layout.' }, repeatedRead, repeatedRead],
    body => {
      const serialized = JSON.stringify(body);
      t.ok(serialized.includes('class StatPanel'), 'the initial physical read reaches the next model turn');
      cachedSourceReachedModel = serialized.includes('reusedEvidence') && serialized.includes('class StatPanel');
      physicalReadCallsAfterInitial = physicalReadCalls;
      return [{ text: 'Let me request it once more.' }, repeatedRead];
    },
    body => {
      const serialized = JSON.stringify(body);
      correctionReachedModel = serialized.includes('redundant_context_loop')
        && serialized.includes('Do not call that same read again');
      return [{ text: 'The StatPanel source is clear now. I can proceed without rereading it.' }];
    },
    [{ text: 'The StatPanel source is clear now. I can proceed without rereading it.' }]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    api: {
      readFile: async (_workspace, requestedPath) => {
        if (requestedPath === 'render/screens.py') physicalReadCalls += 1;
        return '58: class StatPanel:\\n59:     def render(self):\\n60:         return \"ready\"';
      }
    },
    semanticClassification: semanticClassification({
      intent: 'new_task',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: 'Inspect the StatPanel layout and continue the requested implementation.',
      reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'project' },
      executionScope: 'workspace',
      inspectionTarget: 'project'
    })
  });
  const conv = conversation('coder-redundant-read-loop', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
  });
  try {
    await global.window.runAgentLoop(
      'Inspect the StatPanel layout and continue the requested implementation.',
      'gemini-1',
      conv
    );
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.ok(physicalReadCallsAfterInitial > 0, 'the initial logical read reaches the filesystem');
    t.equal(physicalReadCalls, physicalReadCallsAfterInitial, 'identical retries cause no additional filesystem reads');
    t.equal(cachedSourceReachedModel, true, 'the first duplicate receives the cached exact source');
    t.equal(correctionReachedModel, true, 'a further retry receives a deterministic strategy correction');
    t.notOk(/per-turn action limit/i.test(finalAssistant.text || ''), 'the run advances before exhausting its action budget');
    t.match(finalAssistant.text || '', /proceed without rereading/i, 'Coder advances using the evidence already supplied');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('agent loop repairs a run-owned assistant message whose turns array is lost during live reconciliation', async t => {
  const originalFetch = global.fetch;
  let strippedTurns = false;
  installHarness([
    [
      { text: 'I will inspect the current file first.' },
      { functionCall: { name: 'read_file', args: { path: 'engine/controller.py', startLine: 1, endLine: 20 } } }
    ],
    [{ text: 'The file was inspected and the task can continue safely.' }]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    api: {
      readFile: async () => '1: class GritLife:\\n2:     pass'
    },
    window: {
      renderAiMessage: (_text, _logs, _conversationId, message) => {
        if (!strippedTurns && message && Array.isArray(message.turns) && message.turns.length === 1) {
          delete message.turns;
          strippedTurns = true;
        }
      }
    },
    semanticClassification: semanticClassification({
      intent: 'new_task',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: 'Inspect engine/controller.py.',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'project' },
      executionScope: 'workspace',
      inspectionTarget: 'project'
    })
  });
  const conv = conversation('run-message-reconciliation', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
  });
  try {
    const result = await global.window.runAgentLoop('Inspect engine/controller.py.', 'gemini-1', conv);
    const assistant = conv.messages.find(message => message && message._agentRunToken);
    t.equal(strippedTurns, true, 'the test reproduced a live message-shape replacement');
    t.notOk(result && result.status === 'failed', 'the run does not fail after the turns array disappears');
    t.ok(assistant && Array.isArray(assistant.turns), 'the run-owned assistant message repairs its turns array');
    t.match(assistant && assistant.text, /inspected|continue safely/i, 'the next model turn is preserved as the final response');
    t.notOk(conv.lastAgentError, 'no critical agent error is recorded');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop ignores a quoted executable request inside a pushed-fix status report', async t => {
  const originalFetch = global.fetch;
  const handoffs = [];
  const prompt = 'The exact request:\n> Can you kill Claude and restart it again?\nis now covered by tests and the fix was pushed.';
  installHarness([
    [
      { text: 'I am passing that request to Coder now.' },
      { functionCall: { name: 'handoff_to_coder', args: { prompt: 'Restart Claude.' } } }
    ],
    [{ text: 'Thanks for the update. The report says that scenario is covered and the fix was pushed.' }]
  ], {
    window: {
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return { success: true, conversationId: 'unexpected' };
      }
    }
  });
  const conv = conversation('quoted-status');
  try {
    await global.window.runAgentLoop(prompt, 'gemini-1', conv);
    t.equal(handoffs.length, 0, 'reported request causes no Coder handoff');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /covered|pushed/i, 'the surrounding status report is acknowledged');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop ignores a quoted Operator command inside a transcript report', async t => {
  const originalFetch = global.fetch;
  const operatorHandoffs = [];
  const prompt = 'Transcript from the regression test:\n> Open Codex and take a screenshot.\nExpected: analyze this report without executing the quoted command.';
  installHarness([
    [
      { text: 'I will open Codex now.' },
      { functionCall: { name: 'handoff_to_operator', args: { prompt: 'Open Codex and take a screenshot.' } } }
    ],
    [{ text: 'The transcript describes a covered Operator scenario; it does not request execution.' }]
  ], {
    window: {
      promoteWorkspaceToOperator: async payload => {
        operatorHandoffs.push(payload);
        return { success: true, conversationId: 'unexpected-operator' };
      }
    }
  });
  const conv = conversation('quoted-operator-transcript');
  try {
    await global.window.runAgentLoop(prompt, 'gemini-1', conv);
    t.equal(operatorHandoffs.length, 0, 'reported desktop command causes no Operator handoff');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /transcript|does not request execution/i, 'the surrounding report is analyzed');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch adjudicates an explicit contextual handoff and commits exactly one proposed Coder task', async t => {
  const originalFetch = global.fetch;
  const handoffs = [];
  const resolvedObjective = 'Wire RetirementSystem into the GRITLIFE controller and verify the integration.';
  installHarness([
    [
      { text: 'I will send the agreed retirement wiring fix to Coder.' },
      {
        functionCall: {
          name: 'handoff_to_coder',
          args: {
            prompt: resolvedObjective,
            title: 'GRITLIFE retirement wiring',
            open: false
          }
        }
      }
    ]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    projects: ['C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'],
    semanticClassification: semanticClassification({
      intent: 'context_followup',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: resolvedObjective,
      contextDependent: true,
      reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'task' },
      taskResolution: {
        title: 'GRITLIFE retirement wiring',
        requirements: ['Wire RetirementSystem into the controller.'],
        constraints: [],
        unresolvedDecisions: []
      },
      executionScope: 'mutating',
      inspectionTarget: 'project'
    }),
    window: {
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-retirement-retry',
          taskId: 'task-retirement-retry',
          title: 'GRITLIFE retirement wiring',
          status: 'pending'
        };
      },
      startCoderTaskMonitor: () => {}
    }
  });
  const conv = conversation('dispatch-retirement-retry', {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    projectPath: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    lastDelegatedWork: {
      taskId: 'task-retirement-failed',
      coderConversationId: 'coder-retirement-failed',
      title: 'GRITLIFE retirement wiring',
      objective: resolvedObjective,
      status: 'failed'
    },
    messages: [
      {
        role: 'assistant',
        text: 'The previous task failed. Want me to send the retirement wiring fix to Coder now?'
      },
      { role: 'user', text: 'Do the handoff' }
    ]
  });
  const initiallyRejectedIntent = semanticClassification({
    intent: 'conversation',
    requiresExecution: false,
    target: 'none',
    resolvedRequest: '',
    contextDependent: false
  });

  try {
    await global.window.runAgentLoop('Do the handoff', 'gemini-1', conv, {
      semanticIntent: initiallyRejectedIntent
    });
    t.equal(handoffs.length, 1, 'semantic disagreement produces exactly one real handoff');
    t.equal(handoffs[0].originalUserMessage, 'Do the handoff', 'the exact user instruction is retained as provenance');
    t.equal(handoffs[0].semanticIntent.intent, 'context_followup', 'the adjudicated structured intent reaches durable task creation');
    t.equal(handoffs[0].semanticIntent.requiresExecution, true, 'downstream code does not reclassify the approved handoff as conversation');
    t.match(handoffs[0].prompt, /Wire RetirementSystem/i, 'the resolved objective, not the raw approval phrase, is handed off');
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.match(finalAssistant.text, /task-retirement-retry|queued/i, 'Dispatch reports the committed task rather than narrating future intent');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('semantic adjudication corrects a model-selected Coder handoff to Operator', async t => {
  const originalFetch = global.fetch;
  const operatorHandoffs = [];
  const coderHandoffs = [];
  const resolvedObjective = 'Open Codex, inspect its visible state, capture a screenshot, and return the image with a concise report.';
  installHarness([
    [
      { text: 'I will send that to Coder.' },
      {
        functionCall: {
          name: 'handoff_to_coder',
          args: { prompt: resolvedObjective, title: 'Inspect Codex', open: false }
        }
      }
    ]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects',
    semanticClassification: semanticClassification({
      intent: 'context_followup',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: resolvedObjective,
      contextDependent: true,
      reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'recent' },
      executionScope: 'read_only',
      executionTarget: 'operator',
      inspectionTarget: 'local_system',
      standaloneSystemOperation: true,
      taskResolution: { title: 'Inspect Codex', requirements: ['Return a screenshot'], constraints: [], unresolvedDecisions: [] }
    }),
    window: {
      promoteWorkspaceToOperator: async payload => {
        operatorHandoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-corrected-target',
          taskId: 'task-operator-corrected-target',
          title: payload.title,
          status: 'pending'
        };
      },
      promoteWorkspaceToCoder: async payload => {
        coderHandoffs.push(payload);
        return { success: true, conversationId: 'wrong-coder', taskId: 'wrong-coder-task', status: 'pending' };
      }
    }
  });
  const conv = conversation('dispatch-correct-specialist', {
    messages: [
      { role: 'assistant', text: 'Want me to have Operator open Codex, inspect it, and send back a screenshot?' },
      { role: 'user', text: 'Yes, do that.' }
    ]
  });
  try {
    await global.window.runAgentLoop('Yes, do that.', 'gemini-1', conv, {
      semanticIntent: semanticClassification({
        intent: 'conversation',
        requiresExecution: false,
        target: 'none',
        contextDependent: true
      })
    });
    t.equal(operatorHandoffs.length, 1, 'the adjudicated task reaches Operator exactly once');
    t.equal(coderHandoffs.length, 0, 'the model-selected wrong Coder target is never executed');
    t.equal(operatorHandoffs[0].originalUserMessage, 'Yes, do that.', 'contextual provenance remains exact');
    t.equal(operatorHandoffs[0].semanticIntent.executionTarget, 'operator', 'the durable task carries the adjudicated specialist');
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.match(finalAssistant.text, /Operator has task .* queued/i, 'the committed result names the corrected specialist');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch schedules a one-time app reminder directly without creating a specialist task', async t => {
  const originalFetch = global.fetch;
  const createdSchedules = [];
  const coderHandoffs = [];
  const operatorHandoffs = [];
  const forbiddenCalls = [];
  const future = new Date(Date.now() + (2 * 60 * 60 * 1000));
  const atTime = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
  installHarness([
    [{ text: `Done. I set a one-time reminder for ${atTime}.` }]
  ], {
    semanticClassification: semanticClassification({
      intent: 'new_task',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: `Set a one-time reminder for ${atTime} to start OpenAI.`,
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'none' },
      executionScope: 'mutating',
      executionTarget: 'dispatch',
      orchestrationAction: 'schedule_followup',
      scheduledRequest: {
        prompt: 'Remind Jason that it is time to start OpenAI. This is a reminder only; do not launch or operate OpenAI unless Jason asks after receiving it.',
        purpose: 'start-openai-reminder',
        delaySeconds: 0,
        repeatEverySeconds: 0,
        atTime,
        onDays: '',
        recurring: false,
        deliveryOnly: true
      },
      inspectionTarget: 'local_system',
      standaloneSystemOperation: true,
      taskResolution: { title: 'Reminder to start OpenAI', requirements: [], constraints: [], unresolvedDecisions: [] }
    }),
    api: {
      createSchedule: async input => {
        createdSchedules.push(input);
        return {
          success: true,
          schedule: {
            scheduleId: 'sched-direct-reminder',
            dueAt: Date.now() + input.delayMs,
            calendar: input.calendar || null
          },
          supersededScheduleIds: []
        };
      }
    },
    window: {
      promoteWorkspaceToCoder: async payload => { coderHandoffs.push(payload); return { success: true }; },
      promoteWorkspaceToOperator: async payload => { operatorHandoffs.push(payload); return { success: true }; },
      captureScreen: async (...args) => { forbiddenCalls.push(['captureScreen', ...args]); return { success: false }; },
      runCommand: async (...args) => { forbiddenCalls.push(['runCommand', ...args]); return { success: false }; }
    }
  });
  const conv = conversation('dispatch-direct-reminder', {
    messages: [{ role: 'user', text: `Remind me at ${atTime} to start OpenAI.` }]
  });

  try {
    await global.window.runAgentLoop(`Remind me at ${atTime} to start OpenAI.`, 'gemini-1', conv, {
      semanticIntent: semanticClassification({
        intent: 'new_task',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: `Set a one-time reminder for ${atTime} to start OpenAI.`,
        executionScope: 'mutating',
        executionTarget: 'dispatch',
        orchestrationAction: 'schedule_followup',
        scheduledRequest: {
          prompt: 'Remind Jason that it is time to start OpenAI. This is a reminder only; do not launch or operate OpenAI unless Jason asks after receiving it.',
          purpose: 'start-openai-reminder',
          atTime,
          recurring: false,
          deliveryOnly: true
        },
        inspectionTarget: 'local_system',
        standaloneSystemOperation: true
      })
    });
    t.equal(createdSchedules.length, 1, 'exactly one durable schedule is created');
    t.equal(coderHandoffs.length, 0, 'Coder is not involved');
    t.equal(operatorHandoffs.length, 0, 'Operator is not involved');
    t.equal(forbiddenCalls.length, 0, 'no screen or shell probing is attempted');
    t.equal(createdSchedules[0].conversationId, conv.id, 'the reminder remains owned by the visible Dispatch conversation');
    t.equal(createdSchedules[0].deliveryOnly, true, 'the future event is persisted as conversation delivery, not specialist execution');
    t.equal(createdSchedules[0].calendar, null, 'the clock-time reminder is persisted as a one-shot, not a daily calendar recurrence');
    t.ok(createdSchedules[0].delayMs > 0 && createdSchedules[0].delayMs <= 24 * 60 * 60 * 1000,
      'local calendar math produces the next occurrence without a network time lookup');
    t.match(createdSchedules[0].prompt, /reminder only; do not launch/i,
      'the future app action is payload, not unattended execution authority');
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.match(finalAssistant && finalAssistant.text, /one-time reminder/i, 'the user receives a normal scheduling confirmation');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('an unquoted but unauthorized handoff cannot end as narrated future action', async t => {
  const originalFetch = global.fetch;
  const handoffs = [];
  installHarness([
    [
      { text: 'I will hand that to Coder now.' },
      {
        functionCall: {
          name: 'handoff_to_coder',
          args: { prompt: 'Make an unspecified change.', title: 'Unspecified change' }
        }
      }
    ]
  ], {
    semanticClassification: semanticClassification({
      intent: 'conversation',
      requiresExecution: false,
      target: 'none',
      resolvedRequest: '',
      contextDependent: true,
      needsClarification: true,
      clarificationQuestion: 'What exact work should I send to Coder?'
    }),
    window: {
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return { success: true, conversationId: 'unexpected' };
      }
    }
  });
  const conv = conversation('dispatch-ambiguous-handoff', {
    messages: [{ role: 'user', text: 'Okay.' }]
  });
  try {
    await global.window.runAgentLoop('Okay.', 'gemini-1', conv, {
      semanticIntent: semanticClassification({
        intent: 'conversation',
        requiresExecution: false,
        target: 'none',
        resolvedRequest: '',
        contextDependent: true
      })
    });
    t.equal(handoffs.length, 0, 'an unresolved approval creates no task');
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.equal(finalAssistant.text, 'What exact work should I send to Coder?', 'the final answer is a targeted clarification');
    t.notOk(/hand.*off.*now|send.*now/i.test(finalAssistant.text), 'future-action narration is never accepted as the result');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('agent start reservation prevents two distinct durable tasks from launching concurrently', async t => {
  const originalFetch = global.fetch;
  let releaseFirstClaim;
  let claimCalls = 0;
  installHarness([[{ text: 'First task finished.' }]], {
    window: {
      claimOrchestrationTask: async taskId => {
        claimCalls += 1;
        if (taskId !== 'task-first') throw new Error(`Unexpected claim for ${taskId}`);
        return new Promise(resolve => {
          releaseFirstClaim = () => resolve({
            success: true,
            task: { taskId, status: 'active', execution: { executionId: 'exec-first' } },
            prompt: 'Execute the first durable task.'
          });
        });
      }
    }
  });
  const firstConversation = conversation('start-race-first');
  const secondConversation = conversation('start-race-second');
  try {
    const firstRun = global.window.runAgentLoop('First', 'gemini-1', firstConversation, { taskId: 'task-first' });
    await Promise.resolve();
    const secondResult = await global.window.runAgentLoop('Second', 'gemini-1', secondConversation, { taskId: 'task-second' });
    t.equal(secondResult.reason, 'agent_busy', 'the second launch is rejected while the first claim is awaiting persistence');
    t.equal(claimCalls, 1, 'the second task never reaches the claim operation');
    releaseFirstClaim();
    await firstRun;
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('agent keeps the global run reservation until durable finalization finishes', async t => {
  const originalFetch = global.fetch;
  let releaseFinalFlush;
  let announceFinalizing;
  let finalizing = false;
  const finalizingStarted = new Promise(resolve => {
    announceFinalizing = resolve;
  });
  const finalFlushReleased = new Promise(resolve => {
    releaseFinalFlush = resolve;
  });
  installHarness([[{ text: 'First task finished.' }], [{ text: 'Second task finished.' }]], {
    window: {
      onAgentStatusChange: (_running, details = {}) => {
        if (details.status === 'finalizing') {
          finalizing = true;
          announceFinalizing();
        }
      },
      flushConversationsToStorage: async () => {
        if (finalizing) await finalFlushReleased;
        return { success: true };
      }
    }
  });
  const firstConversation = conversation('finalization-lock-first');
  const secondConversation = conversation('finalization-lock-second');
  try {
    const firstRun = global.window.runAgentLoop('First', 'gemini-1', firstConversation);
    await finalizingStarted;
    const secondResult = await global.window.runAgentLoop('Second', 'gemini-1', secondConversation);
    t.equal(secondResult.reason, 'agent_busy', 'a second run cannot start while the first run is durably finalizing');
    t.equal(global.window.getRunningConversationId(), firstConversation.id, 'the original run owns the reservation through finalization');
    releaseFinalFlush();
    await firstRun;
    t.equal(global.window.isAgentRunning(), false, 'the reservation is released after finalization completes');
  } finally {
    releaseFinalFlush();
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('cancellation during finalization reconciles the transcript and phone status before release', async t => {
  const originalFetch = global.fetch;
  let releaseFirstFlush;
  let announceFirstFlush;
  let flushCount = 0;
  const firstFlushStarted = new Promise(resolve => {
    announceFirstFlush = resolve;
  });
  const firstFlushReleased = new Promise(resolve => {
    releaseFirstFlush = resolve;
  });
  const finalized = [];
  const lifecycleStates = [];
  const phoneNotifications = [];
  installHarness([[{ text: 'Task completed successfully.' }]], {
    api: {
      notifyPhone: async (title, body) => {
        phoneNotifications.push({ title, body });
        return { success: true };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-finalization-cancel' } },
        prompt: 'Execute the durable task.'
      }),
      flushConversationsToStorage: async () => {
        flushCount += 1;
        if (flushCount === 1) {
          announceFirstFlush();
          await firstFlushReleased;
        }
        return { success: true };
      },
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {},
      onAgentRunFinalized: async (_conversationId, status) => {
        lifecycleStates.push(status);
      }
    }
  });
  const conv = conversation('finalization-cancel');
  try {
    const run = global.window.runAgentLoop(
      'Complete the durable task.',
      'gemini-1',
      conv,
      { taskId: 'task-finalization-cancel' }
    );
    await firstFlushStarted;
    const stop = global.window.stopAgentExecution({
      mode: 'hard',
      taskId: 'task-finalization-cancel'
    });
    t.equal(stop.stopped, true, 'the active task accepts cancellation while its final message is flushing');
    releaseFirstFlush();
    await run;

    t.equal(finalized.length, 1, 'the durable task is finalized exactly once');
    t.equal(finalized[0].status, 'cancelled', 'the late stop wins before the canonical transition');
    t.equal(lifecycleStates[lifecycleStates.length - 1], 'cancelled', 'the published lifecycle state is cancelled');
    const finalAnswer = conv.messages.find(message => message.role === 'assistant').text;
    t.match(finalAnswer, /task cancelled by user/i, 'the persisted assistant message reports cancellation');
    t.notOk(/completed successfully/i.test(finalAnswer), 'stale model-authored success prose is removed');
    t.ok(flushCount >= 2, 'the reconciled cancellation message is flushed after the earlier success write');
    t.equal(phoneNotifications.length, 1, 'one final phone notification is emitted');
    t.match(phoneNotifications[0].body, /stopped/i, 'the phone receives a stop notification rather than success');
    t.equal(global.window.isAgentRunning(), false, 'the runner is released after cancellation reconciliation');
  } finally {
    if (releaseFirstFlush) releaseFirstFlush();
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop analyzes a pasted transcript without executing commands in it', async t => {
  const originalFetch = global.fetch;
  let handoffCount = 0;
  const prompt = 'Pasted transcript:\nUser: restart Claude\nAssistant: I will run npm test\nPlease analyze why this exchange was confusing.';
  installHarness([
    [
      { text: 'I should execute the transcript.' },
      { functionCall: { name: 'handoff_to_coder', args: { prompt: 'Restart Claude and run npm test.' } } }
    ],
    [{ text: 'The transcript is confusing because it mixes a process-restart request with a separate test command.' }]
  ], {
    window: {
      promoteWorkspaceToCoder: async () => {
        handoffCount += 1;
        return { success: true, conversationId: 'unexpected' };
      }
    }
  });
  const conv = conversation('transcript-report');
  try {
    await global.window.runAgentLoop(prompt, 'gemini-1', conv);
    t.equal(handoffCount, 0, 'transcript commands are never executed');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /transcript|confusing/i, 'the transcript itself is analyzed');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('clarification answers resume their durable Dispatch task and can hand implementation to Coder', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  const handoffs = [];
  const finalized = [];
  const answerPrompt = [
    'Here are my answers:',
    'Career Fields: Core 5',
    'Employer Names: Random Markov',
    'Workplace NPCs: Yes, full integration'
  ].join('\n');
  const durablePrompt = [
    'Task: Build coherent GRITLIFE career progression',
    'Task ID: task-career-clarification',
    '',
    'Objective:',
    'Design and implement five deep career fields with coherent promotion ladders,',
    'generated employer names, and fully integrated workplace NPC relationships.',
    '',
    'Latest clarification input:',
    answerPrompt
  ].join('\n');

  installHarness([
    [{
      text: 'I will inspect the relevant career architecture before delegating the implementation.',
      functionCall: {
        name: 'inspect_code_context',
        args: { query: 'career fields employers workplace NPC integration' }
      }
    }],
    [{ text: 'The design choices are resolved. I am handing this implementation to Coder now.' }],
    [{ text: 'Coder has the resolved career-system task and the selected GRITLIFE workspace.' }]
  ], {
    workspace,
    projects: [workspace],
    api: {
      inspectCodeContext: async () => ({
        success: true,
        sections: [{ path: 'systems/career.py', content: 'class CareerSystem: pass' }]
      })
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          title: 'Build coherent GRITLIFE career progression',
          source: 'clarification-answers',
          status: 'active',
          execution: { executionId: 'exec-career-clarification' }
        },
        prompt: durablePrompt
      }),
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-career-clarification',
          taskId: 'task-coder-career-clarification',
          title: payload.title,
          status: 'pending'
        };
      },
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('clarification-handoff', {
    workspace,
    dispatchProjectPath: workspace
  });

  try {
    await global.window.runAgentLoop(answerPrompt, 'gemini-1', conv, {
      taskId: 'task-career-clarification',
      source: 'clarification-answers',
      internalPrompt: true,
      preserveUserPrompt: true
    });

    t.equal(handoffs.length, 1, 'the resumed clarification creates exactly one real Coder handoff');
    t.match(handoffs[0].prompt, /five deep career fields/i, 'the durable implementation objective authorizes and informs the handoff');
    t.match(handoffs[0].prompt, /workplace NPC/i, 'the resolved clarification requirements survive delegation');
    t.equal(handoffs[0].originalUserMessage, answerPrompt, 'the generated clarification answer remains exact provenance');
    t.equal(finalized.length, 1, 'the claimed Dispatch continuation is finalized once');
    const finalText = conv.messages.find(message => message.role === 'assistant').text;
    t.match(finalText, /Coder has task .* queued/i, 'Dispatch reports the actual durable handoff result');
    t.notOk(/report about a covered scenario|quoted command/i.test(finalText), 'the quoted-report fallback never replaces the active continuation');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch routes the exact Codex screenshot request to Operator once without a Coder detour', async t => {
  const originalFetch = global.fetch;
  const rawRequest = "Let's test it out. Let's see if we can get the operator to open codex and take a picture and see what it's up to";
  const operatorHandoffs = [];
  const coderHandoffs = [];
  const monitorCalls = [];
  const harness = installHarness([], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects',
    window: {
      promoteWorkspaceToOperator: async payload => {
        operatorHandoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-codex-screenshot',
          taskId: 'task-operator-codex-screenshot',
          title: payload.title,
          status: 'pending',
          workspacePath: payload.path
        };
      },
      promoteWorkspaceToCoder: async payload => {
        coderHandoffs.push(payload);
        return { success: true, conversationId: 'wrong-coder', taskId: 'wrong-coder-task', status: 'pending' };
      },
      startOperatorTaskMonitor: (...args) => monitorCalls.push(args)
    }
  });
  const conv = conversation('dispatch-operator-codex-screenshot');
  try {
    await global.window.runAgentLoop(rawRequest, 'gemini-1', conv, {
      semanticIntent: semanticClassification({
        intent: 'new_task',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: 'Open Codex, inspect what it is visibly doing right now, capture a screenshot, and return the screenshot with a useful report.',
        reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'none' },
        executionScope: 'read_only',
        executionTarget: 'operator',
        inspectionTarget: 'local_system',
        standaloneSystemOperation: true,
        taskResolution: {
          title: 'Inspect Codex and capture its screen',
          requirements: ['Open Codex', 'Inspect the visible state', 'Capture and return a screenshot'],
          constraints: [],
          unresolvedDecisions: []
        }
      })
    });

    t.equal(harness.modelTurns, 1, 'the response model receives the finalized route for one natural acknowledgement turn');
    t.equal(operatorHandoffs.length, 1, 'exactly one Operator task is created');
    t.equal(coderHandoffs.length, 0, 'Coder is never used for native desktop inspection');
    t.equal(operatorHandoffs[0].standalone, true, 'the desktop task does not invent a project dependency');
    t.equal(operatorHandoffs[0].path, 'C:\\Users\\Owner', 'native desktop work is rooted at the local user environment');
    t.equal(operatorHandoffs[0].originalUserMessage, rawRequest, 'the exact user request is retained as provenance');
    t.match(operatorHandoffs[0].prompt, /open codex/i, 'the resolved task preserves the requested application');
    t.match(operatorHandoffs[0].prompt, /screenshot|picture/i, 'the resolved task preserves the screenshot deliverable');
    t.equal(monitorCalls.length, 1, 'the Operator supervisor monitor starts once');
    t.equal(conv.launchedTaskRole, 'operator', 'the Dispatch ownership pointer records the real specialist');
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.match(finalAssistant.text, /Operator has task .* queued/i, 'the user-facing result names Operator');
    t.notOk(/Coder has task/i.test(finalAssistant.text), 'the user-facing result never claims Coder owns it');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch routes a project-bound interactive playtest directly to Operator', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\This is Life';
  const rawRequest = 'Can we have operator playtest our This is Life project?';
  const operatorHandoffs = [];
  const coderHandoffs = [];
  const harness = installHarness([], {
    workspace,
    projects: [workspace],
    window: {
      promoteWorkspaceToOperator: async payload => {
        operatorHandoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-this-is-life-playtest',
          taskId: 'task-operator-this-is-life-playtest',
          title: payload.title,
          status: 'pending',
          workspacePath: payload.path
        };
      },
      promoteWorkspaceToCoder: async payload => {
        coderHandoffs.push(payload);
        return { success: true, conversationId: 'wrong-coder', taskId: 'wrong-coder-task', status: 'pending' };
      },
      startOperatorTaskMonitor: () => {}
    }
  });
  const conv = conversation('dispatch-project-playtest', {
    workspace,
    dispatchProjectPath: workspace
  });
  try {
    await global.window.runAgentLoop(rawRequest, 'gemini-1', conv, {
      semanticIntent: semanticClassification({
        intent: 'new_task',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: 'Launch This is Life, interactively playtest it through its visible desktop UI, and report verified findings with screenshots.',
        reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'project' },
        executionScope: 'read_only',
        executionTarget: 'operator',
        executionSurface: 'desktop',
        inspectionTarget: 'project',
        standaloneSystemOperation: false,
        taskResolution: {
          title: 'Playtest This is Life',
          requirements: ['Launch the game', 'Interact through the visible UI', 'Return screenshots and verified findings'],
          constraints: [],
          unresolvedDecisions: []
        }
      })
    });

    t.equal(harness.modelTurns, 1, 'the structured execution target reaches one route-aware acknowledgement turn');
    t.equal(operatorHandoffs.length, 1, 'the project playtest creates exactly one Operator task');
    t.equal(coderHandoffs.length, 0, 'the project binding does not force a redundant Coder task');
    t.equal(operatorHandoffs[0].path, workspace, 'Operator receives the exact project workspace');
    t.equal(operatorHandoffs[0].standalone, false, 'the project playtest retains its project binding');
    t.equal(operatorHandoffs[0].executionSurface, 'desktop', 'the visible execution surface survives routing');
    t.equal(operatorHandoffs[0].originalUserMessage, rawRequest, 'the original request remains provenance');
    const finalAssistant = [...conv.messages].reverse().find(message => message.role === 'assistant');
    t.match(finalAssistant.text, /Operator has task .* queued/i, 'Dispatch reports the real specialist owner');
    t.notOk(/Coder has task/i.test(finalAssistant.text), 'Dispatch does not report a redundant Coder hop');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Coder delegation to Operator keeps the same parent task pending until child evidence returns', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\This is Life';
  const parentTaskId = 'task-coder-parent-playtest';
  const childTaskId = 'task-operator-child-playtest';
  const operatorHandoffs = [];
  const parentUpdates = [];
  const finalized = [];
  installHarness([
    [{
      functionCall: {
        name: 'handoff_to_operator',
        args: {
          path: workspace,
          prompt: 'Launch This is Life, play it through the visible desktop UI, verify movement with fresh screenshots, and return findings.',
          title: 'Playtest This is Life',
          executionSurface: 'desktop'
        }
      }
    }]
  ], {
    workspace,
    projects: [workspace],
    api: {
      updateOrchestrationTask: async (taskId, patch) => {
        parentUpdates.push({ taskId, patch });
        return { success: true };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          schemaVersion: 4,
          taskId,
          title: 'Playtest This is Life project',
          objective: 'Use Operator to playtest This is Life at its visible desktop interface.',
          originalUserMessage: 'Can we have operator playtest our This is Life project?',
          precedingConversationSummary: 'The user asked Dispatch for an interactive playtest of This is Life.',
          workspacePath: workspace,
          rootOriginConversationId: 'dispatch-playtest-origin',
          origin: { conversationId: 'dispatch-playtest-origin' },
          target: { conversationId: 'coder-playtest-worker', mode: 'coder' },
          status: 'active',
          execution: { executionId: 'exec-coder-parent-playtest' }
        },
        prompt: 'Use Operator to playtest This is Life at its visible desktop interface.'
      }),
      promoteWorkspaceToOperator: async payload => {
        operatorHandoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-playtest-worker',
          taskId: childTaskId,
          title: payload.title,
          status: 'pending',
          workspacePath: payload.path,
          task: {
            taskId: childTaskId,
            title: payload.title,
            parentTaskId: payload.parentTaskId,
            rootOriginConversationId: payload.rootOriginConversationId,
            target: { conversationId: 'operator-playtest-worker', mode: 'operator' }
          }
        };
      },
      startOperatorTaskMonitor: () => {},
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status, delegation: { childTaskId } };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('coder-playtest-worker', {
    mode: 'coder',
    workspace,
    dispatchProjectPath: workspace
  });
  try {
    await global.window.runAgentLoop(
      'Use Operator to playtest This is Life at its visible desktop interface.',
      'gemini-1',
      conv,
      { taskId: parentTaskId, internalPrompt: true }
    );

    t.equal(operatorHandoffs.length, 1, 'Coder creates one Operator child task');
    t.equal(operatorHandoffs[0].parentTaskId, parentTaskId, 'the child is linked to the durable Coder parent');
    t.equal(operatorHandoffs[0].rootOriginConversationId, 'dispatch-playtest-origin', 'root Dispatch ownership survives the second handoff');
    t.equal(operatorHandoffs[0].originalUserMessage, 'Can we have operator playtest our This is Life project?', 'the child retains the original user request instead of the rendered parent packet');
    t.match(operatorHandoffs[0].precedingConversationSummary, /Parent task task-coder-parent-playtest/i, 'the child gets a compact parent summary');
    t.notOk(/Relevant preceding conversation:\s*Task:/i.test(operatorHandoffs[0].precedingConversationSummary), 'the child packet does not recursively embed the rendered parent packet');
    t.equal(parentUpdates.length, 1, 'the parent records one durable child relationship');
    t.equal(parentUpdates[0].patch.delegation.childTaskId, childTaskId, 'the relationship points at the exact Operator child');
    t.equal(finalized.length, 1, 'the Coder parent is finalized once');
    t.equal(finalized[0].status, 'pending', 'queueing Operator is not treated as parent completion');
    t.equal(finalized[0].details.reasonCode, 'awaiting_delegated_task', 'the parent records why it is pending');
    t.match(finalized[0].details.reason, /Waiting for delegated Operator task/i, 'the pending reason names the actual specialist');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a task-bound handoff to Coder preserves parent and root Dispatch ownership', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI';
  const parentTaskId = 'task-coder-parent-push';
  const childTaskId = 'task-coder-child-push';
  const coderHandoffs = [];
  const parentUpdates = [];
  const finalized = [];
  installHarness([[{
    functionCall: {
      name: 'handoff_to_coder',
      args: {
        path: workspace,
        prompt: 'Push the verified Orion changes and report the exact commit.',
        title: 'Push verified Orion changes'
      }
    }
  }]], {
    workspace,
    projects: [workspace],
    api: {
      updateOrchestrationTask: async (taskId, patch) => {
        parentUpdates.push({ taskId, patch });
        return { success: true };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          schemaVersion: 4,
          taskId,
          title: 'Publish Orion reliability fixes',
          objective: 'Verify and publish the current Orion reliability fixes.',
          originalUserMessage: 'Can you push all Orion changes to GitHub?',
          precedingConversationSummary: 'The user approved publishing all verified Orion changes.',
          workspacePath: workspace,
          rootOriginConversationId: 'dispatch-push-origin',
          origin: { conversationId: 'dispatch-push-origin' },
          target: { conversationId: 'coder-push-parent', mode: 'coder' },
          status: 'active',
          execution: { executionId: 'exec-coder-parent-push' }
        },
        prompt: 'Verify and publish the current Orion reliability fixes.'
      }),
      promoteWorkspaceToCoder: async payload => {
        coderHandoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-push-child',
          taskId: childTaskId,
          title: payload.title,
          status: 'pending',
          task: {
            taskId: childTaskId,
            parentTaskId: payload.parentTaskId,
            rootOriginConversationId: payload.rootOriginConversationId,
            target: { conversationId: 'coder-push-child', mode: 'coder' }
          }
        };
      },
      startCoderTaskMonitor: () => {},
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status, delegation: { childTaskId } };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('coder-push-parent', { mode: 'coder', workspace });
  try {
    await global.window.runAgentLoop(
      'Verify and publish the current Orion reliability fixes.',
      'gemini-1',
      conv,
      { taskId: parentTaskId, internalPrompt: true }
    );

    t.equal(coderHandoffs.length, 1, 'the parent creates exactly one Coder child');
    t.equal(coderHandoffs[0].parentTaskId, parentTaskId, 'the new Coder task names its exact parent');
    t.equal(coderHandoffs[0].rootOriginConversationId, 'dispatch-push-origin', 'the root Dispatch owner survives the handoff');
    t.equal(coderHandoffs[0].originalUserMessage, 'Can you push all Orion changes to GitHub?', 'original user intent survives as provenance');
    t.match(coderHandoffs[0].precedingConversationSummary, /Parent task task-coder-parent-push/i, 'the child receives a bounded parent summary');
    t.equal(parentUpdates[0].patch.delegation.childTaskId, childTaskId, 'the parent records the exact child receipt');
    t.equal(finalized[0].status, 'pending', 'delegation parks rather than completes the parent');
    t.equal(finalized[0].details.reasonCode, 'awaiting_delegated_task', 'the pending reason remains structured');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

// Real bug report: right after a real handoff, the task status badge briefly showed FAILED
// instead of reflecting delegation. Investigation found two independent bugs, of which this test
// covers one: agent.js's parent-task delegation bookkeeping (persisting the child relationship and
// leaving the parent pending until the child's result returns) required `runMode !== 'orion'` — so
// it only ever ran when a SPECIALIST delegates onward mid-task (the Coder->Operator case covered by
// the test directly above, where the specialist's own durable task is the parent). Dispatch's own
// conversation mode is 'orion'. For a fresh Dispatch chat turn this bug is latent (Dispatch has no
// durable task of its own to mismanage in that case), but whenever Dispatch DOES already own a
// durable task and hands off from within it — resuming after a clarification answer, a scheduled
// continuation, or any other reentry into an existing Dispatch task — that parent task finalized
// straight to 'completed' the instant the child was merely queued, before the child had done any
// work, instead of staying 'pending: awaiting_delegated_task' like the Coder->Operator case does.
// This is the same test shape as 'a task-bound handoff to Coder preserves parent and root Dispatch
// ownership' above, with the one variable that actually matters here changed: mode: 'orion'.
test('a Dispatch-initiated handoff from an existing durable Dispatch task keeps that task pending until child evidence returns, exactly like a specialist-initiated one', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI';
  const parentTaskId = 'task-dispatch-parent-research';
  const childTaskId = 'task-researcher-child-research';
  const researcherHandoffs = [];
  const parentUpdates = [];
  const finalized = [];
  installHarness([[{
    functionCall: {
      name: 'handoff_to_researcher',
      args: {
        path: workspace,
        prompt: 'Find the latest updates for Crimson Desert and report verified findings with sources.',
        title: 'Research Crimson Desert updates'
      }
    }
  }]], {
    workspace,
    projects: [workspace],
    api: {
      updateOrchestrationTask: async (taskId, patch) => {
        parentUpdates.push({ taskId, patch });
        return { success: true };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          schemaVersion: 4,
          taskId,
          title: 'Research Crimson Desert updates',
          objective: 'Find and report the latest verified updates for Crimson Desert.',
          originalUserMessage: 'What are the latest updates for Crimson Desert?',
          precedingConversationSummary: 'The user asked Dispatch for the latest Crimson Desert updates.',
          workspacePath: workspace,
          rootOriginConversationId: 'dispatch-research-origin',
          origin: { conversationId: 'dispatch-research-origin' },
          target: { conversationId: 'dispatch-research-origin', mode: 'orion' },
          status: 'active',
          execution: { executionId: 'exec-dispatch-parent-research' }
        },
        prompt: 'Find and report the latest verified updates for Crimson Desert.'
      }),
      promoteWorkspaceToResearcher: async payload => {
        researcherHandoffs.push(payload);
        return {
          success: true,
          conversationId: 'researcher-research-worker',
          taskId: childTaskId,
          title: payload.title,
          status: 'pending',
          workspacePath: payload.path,
          task: {
            taskId: childTaskId,
            title: payload.title,
            parentTaskId: payload.parentTaskId,
            rootOriginConversationId: payload.rootOriginConversationId,
            target: { conversationId: 'researcher-research-worker', mode: 'researcher' }
          }
        };
      },
      startResearcherTaskMonitor: () => {},
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status, delegation: { childTaskId } };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('dispatch-research-origin', { mode: 'orion', workspace });
  try {
    await global.window.runAgentLoop(
      'What are the latest updates for Crimson Desert?',
      'gemini-1',
      conv,
      {
        taskId: parentTaskId,
        internalPrompt: true,
        semanticIntent: semanticClassification({
          intent: 'new_task',
          requiresExecution: true,
          target: 'current_conversation',
          resolvedRequest: 'Find the latest updates for Crimson Desert and report verified findings with sources.',
          reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'none' },
          executionScope: 'read_only',
          executionTarget: 'researcher'
        })
      }
    );

    t.equal(researcherHandoffs.length, 1, 'Dispatch creates exactly one Researcher child task');
    t.equal(researcherHandoffs[0].parentTaskId, parentTaskId, 'the child is linked to the durable Dispatch parent');
    t.equal(parentUpdates.length, 1, 'the parent records one durable child relationship, matching the Coder->Operator case');
    t.equal(parentUpdates[0].patch.delegation.childTaskId, childTaskId, 'the relationship points at the exact Researcher child');
    t.equal(finalized.length, 1, 'the Dispatch parent is finalized once');
    t.equal(finalized[0].status, 'pending', 'queueing Researcher is not treated as Dispatch parent completion - the exact reported bug');
    t.notEqual(finalized[0].status, 'completed', 'this must never silently become completed the instant the child is merely queued');
    t.equal(finalized[0].details.reasonCode, 'awaiting_delegated_task', 'the parent records why it is pending, same as a specialist-initiated handoff');
    t.match(finalized[0].details.reason, /Waiting for delegated Researcher task/i, 'the pending reason names the actual specialist');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a direct executable request preflights once to Operator and preserves durable handoff provenance', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  const handoffs = [];
  installHarness([
    [{
      functionCall: {
        name: 'handoff_to_coder',
        args: {
          path: workspace,
          prompt: 'Identify the running Claude process, restart it safely, and verify the replacement.',
          title: 'Restart Claude',
          open: true
        }
      }
    }],
    [{ text: "I can't execute that from Dispatch, so I'm passing it to Coder." }]
  ], {
    projects: [workspace],
    workspace,
    window: {
      promoteWorkspaceToOperator: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-one-handoff',
          taskId: 'task-one-handoff',
          title: payload.title,
          status: 'pending'
        };
      }
    }
  });
  const conv = conversation('one-genuine-handoff', {
    workspace,
    dispatchProjectPath: workspace
  });
  try {
    await global.window.runAgentLoop(
      'Can you kill Claude and restart it again?',
      'gemini-1',
      conv,
      {
        semanticIntent: {
          intent: 'new_task',
          requiresExecution: true,
          target: 'current_conversation',
          resolvedRequest: 'Identify the running Claude process, restart it safely, and verify the replacement.',
          contextDependent: false,
          confidence: 1,
          needsClarification: false,
          reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'none' },
          executionScope: 'mutating',
          executionTarget: 'operator',
          inspectionTarget: 'local_system',
          standaloneSystemOperation: true
        }
      }
    );
    t.equal(handoffs.length, 1, 'the genuine handoff creates exactly one durable Operator task');
    t.equal(handoffs[0].standalone, true, 'local-system work remains standalone even with an active project selected');
    t.equal(handoffs[0].path, 'C:\\Users\\Owner', 'the standalone task is rooted at the user home, not the selected project');
    t.match(handoffs[0].prompt, /identify the intended local target/i, 'the deterministic packet requires safe target identification');
    t.match(handoffs[0].prompt, /verify the result/i, 'the deterministic packet requires verification');
    t.equal(handoffs[0].originalUserMessage, 'Can you kill Claude and restart it again?', 'the exact raw user utterance is retained separately from the expanded handoff prompt');
    t.match(handoffs[0].title, /Claude|running process/i, 'the handoff receives a human title derived from the resolved objective');
    t.notOk(/^GRITLIFE\b/i.test(handoffs[0].title), 'a standalone desktop task is not mislabeled as project work');
    t.notEqual(handoffs[0].title, 'Execute Dispatch request', 'the internal Dispatch placeholder is never exposed as a task title');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Coder finalization keeps the user-facing result separate from the generated tool walkthrough', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  installHarness([
    [{ text: 'I will inspect the visible state.' }, { functionCall: { name: 'read_file', args: { path: 'status.txt' } } }],
    [{ text: '## Work Walkthrough\n\n**Result:** Codex is open, idle, and showing the completed Orion report.' }]
  ], {
    workspace: 'C:\\Users\\Owner',
    api: { readFile: async () => 'Codex: idle' },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-summary-separation' } },
        prompt: 'Open Codex and report what it is doing.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('coder-summary-separation', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner'
  });
  try {
    await global.window.runAgentLoop(
      'Open Codex and report what it is doing.',
      'gemini-1',
      conv,
      { taskId: 'task-summary-separation' }
    );
    t.equal(finalized.length, 1, 'the durable task finalizes once');
    t.equal(finalized[0].status, 'completed', 'the task reaches the real completed state');
    t.match(finalized[0].details.result.summary, /^## Work Walkthrough/, 'the authored answer heading is retained');
    t.match(finalized[0].details.result.summary, /Codex is open, idle/, 'the user-facing result is recorded');
    t.notOk(/\*\*Done:\*\*/.test(finalized[0].details.result.summary), 'generated tool rows are not stored in the relay summary');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a broad read-only project inspection preflights once to Coder without duplicate Dispatch discovery', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  const handoffs = [];
  const harness = installHarness([[{ text: 'This fallback model turn should not run.' }]], {
    projects: [workspace],
    workspace,
    window: {
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-broad-inspection',
          taskId: 'task-broad-inspection',
          title: payload.title,
          status: 'pending'
        };
      }
    }
  });
  const conv = conversation('dispatch-broad-inspection', {
    workspace,
    dispatchProjectPath: workspace
  });
  try {
    await global.window.runAgentLoop(
      'Review how persistence, reload, and the phone UI fit together across the project.',
      'gemini-1',
      conv,
      {
        semanticIntent: {
          intent: 'new_task',
          requiresExecution: true,
          target: 'current_conversation',
          resolvedRequest: 'Review persistence, reload, and phone UI integration across GRITLIFE.',
          contextDependent: false,
          confidence: 1,
          needsClarification: false,
          reasoningPolicyHint: { complexity: 'high', risk: 'medium', contextNeed: 'project' },
          executionScope: 'read_only',
          inspectionTarget: 'project',
          inspectionBreadth: 'broad',
          standaloneSystemOperation: false
        }
      }
    );
    t.equal(handoffs.length, 1, 'the broad inspection creates exactly one Coder task');
    t.equal(harness.modelTurns, 1, 'Dispatch spends one route-aware acknowledgement turn without duplicating discovery');
    t.match(handoffs[0].prompt, /delegated read-only project inspection/i, 'Coder receives explicit read-only ownership');
    t.match(handoffs[0].prompt, /remember_file_notes/i, 'the task requires reusable file understanding');
    t.match(handoffs[0].prompt, /Review persistence, reload, and phone UI integration/i, 'the resolved review objective is preserved');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Projects-root Claude restart creates one standalone Operator handoff with raw provenance', async t => {
  const originalFetch = global.fetch;
  const projectsRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const rawRequest = 'Can you kill Claude and restart it again?';
  const handoffs = [];
  installHarness([
    [{ text: "I can't control local processes from Dispatch. You'll need to restart Claude manually." }],
    [{ text: 'Operator has the standalone process task and will verify the replacement.' }]
  ], {
    workspace: projectsRoot,
    window: {
      promoteWorkspaceToOperator: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-standalone-claude',
          taskId: 'task-standalone-claude',
          title: 'Restart Claude',
          status: 'pending'
        };
      }
    }
  });
  const conv = conversation('projects-root-claude-restart', {
    workspace: projectsRoot,
    dispatchProjectPath: ''
  });
  try {
    await global.window.runAgentLoop(rawRequest, 'gemini-1', conv, {
      semanticIntent: {
        intent: 'new_task',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: rawRequest,
        contextDependent: false,
        confidence: 1,
        needsClarification: false,
        reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'none' },
        executionScope: 'mutating',
        executionTarget: 'operator',
        inspectionTarget: 'local_system',
        standaloneSystemOperation: true
      }
    });
    t.equal(handoffs.length, 1, 'the direct process request creates exactly one handoff');
    t.equal(handoffs[0].path, 'C:\\Users\\Owner', 'standalone execution uses the user home instead of misrepresenting Projects as a selected project');
    t.equal(handoffs[0].standalone, true, 'the handoff is explicitly marked standalone rather than pretending Projects is the selected project');
    t.equal(handoffs[0].originalUserMessage, rawRequest, 'the exact latest utterance is carried as provenance');
    t.notEqual(handoffs[0].prompt, rawRequest, 'the resolved execution prompt may be expanded independently');
    t.ok(handoffs[0].prompt.includes(rawRequest), 'the expanded prompt still preserves the requested operation');
    t.match(handoffs[0].prompt, /identify the intended local target/i, 'Operator must identify the correct local process');
    t.match(handoffs[0].prompt, /verify the result/i, 'Operator must verify the replacement process');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('contextual restart acknowledgement and execution consume the same finalized Operator route', async t => {
  const originalFetch = global.fetch;
  const projectsRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const resolvedRequest = 'Restart the Orion desktop application using its established launch method and verify it reconnects.';
  const handoffs = [];
  let routeReachedResponseModel = false;
  installHarness([
    body => {
      const serialized = JSON.stringify(body);
      routeReachedResponseModel = serialized.includes('[FINALIZED DISPATCH EXECUTION ROUTE]')
        && serialized.includes('Effective target: operator')
        && serialized.includes(resolvedRequest)
        && serialized.includes('Execution surface: process');
      return [{ text: "Got it - I'll have Operator restart Orion with the established launch method and verify it reconnects." }];
    }
  ], {
    workspace: projectsRoot,
    window: {
      promoteWorkspaceToOperator: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'operator-contextual-restart',
          taskId: 'task-contextual-restart',
          title: 'Restart Orion',
          status: 'pending'
        };
      }
    }
  });
  const conv = conversation('contextual-restart-route', {
    workspace: projectsRoot,
    dispatchProjectPath: '',
    messages: [
      { role: 'user', text: 'Orion is not reconnecting after the update.' },
      { role: 'assistant', text: 'I can restart Orion using the existing launch method and verify the phone reconnects.' },
      { role: 'user', text: 'Restart it.' }
    ]
  });
  try {
    await global.window.runAgentLoop('Restart it.', 'gemini-1', conv, {
      semanticIntent: semanticClassification({
        intent: 'context_followup',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest,
        contextDependent: true,
        reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'recent' },
        executionScope: 'mutating',
        executionTarget: 'operator',
        executionSurface: 'process',
        inspectionTarget: 'local_system',
        standaloneSystemOperation: true
      })
    });
    t.ok(routeReachedResponseModel, 'the acknowledgement model receives the finalized target, meaning, and surface');
    t.equal(handoffs.length, 1, 'the contextual request creates exactly one real handoff');
    t.match(handoffs[0].prompt, /Restart the Orion desktop application/, 'execution consumes the same resolved request shown to the response model');
    t.equal(handoffs[0].originalUserMessage, 'Restart it.', 'the short utterance is retained only as provenance');
    t.equal(handoffs[0].standalone, true, 'local process work stays standalone');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Projects-root self-contained artifact work uses one isolated standalone Coder handoff', async t => {
  const originalFetch = global.fetch;
  const projectsRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const rawRequest = 'Create a cohesive SVG icon family for Coder, Dispatch, phone, desktop, and notifications.';
  const handoffs = [];
  const iconTaskIntent = semanticClassification({
    intent: 'new_task',
    requiresExecution: true,
    target: 'current_conversation',
    resolvedRequest: rawRequest,
    contextDependent: false,
    confidence: 1,
    needsClarification: false,
    reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'none' },
    executionScope: 'mutating',
    inspectionTarget: 'none',
    inspectionBreadth: 'none',
    standaloneSystemOperation: false,
    taskResolution: { title: 'Design Orion icon family', requirements: [], constraints: [], unresolvedDecisions: [] }
  });
  installHarness([
    [{
      functionCall: {
        name: 'handoff_to_coder',
        args: {
          prompt: rawRequest,
          title: 'Design Orion icon family',
          standalone: false
        }
      }
    }],
    [{ text: 'Coder has the standalone icon-design task.' }]
  ], {
    workspace: projectsRoot,
    semanticClassification: iconTaskIntent,
    api: {
      listFiles: async pathValue => String(pathValue || '').endsWith('\\SVG')
        ? { error: 'Directory does not exist' }
        : []
    },
    window: {
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-standalone-icons',
          taskId: 'task-standalone-icons',
          title: payload.title,
          workspacePath: 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI\\standalone-workspaces\\design-orion-icons-1234',
          status: 'pending'
        };
      }
    }
  });
  const conv = conversation('projects-root-icon-design', {
    workspace: projectsRoot,
    dispatchProjectPath: ''
  });
  try {
    await global.window.runAgentLoop(rawRequest, 'gemini-1', conv, {
      semanticIntent: iconTaskIntent
    });
    t.equal(handoffs.length, 1, 'the self-contained request creates exactly one Coder handoff');
    t.equal(handoffs[0].standalone, true, 'the generic Projects root is replaced by standalone task scope');
    t.equal(handoffs[0].standaloneSystemOperation, false, 'creative artifact work is isolated rather than rooted at the user home');
    t.equal(handoffs[0].path, '', 'the renderer is allowed to allocate the isolated workspace');
    t.equal(handoffs[0].originalUserMessage, rawRequest, 'raw provenance survives the standalone handoff');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Projects-root project work cannot misuse standalone Coder routing', async t => {
  const originalFetch = global.fetch;
  const projectsRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  let promoteCalls = 0;
  installHarness([
    [{
      functionCall: {
        name: 'handoff_to_coder',
        args: {
          prompt: 'Run npm test for the project and report the result.',
          title: 'Run project tests',
          standalone: true
        }
      }
    }],
    [{ text: 'The test request needs a resolved project workspace before it can be queued.' }]
  ], {
    workspace: projectsRoot,
    window: {
      promoteWorkspaceToCoder: async () => {
        promoteCalls += 1;
        return { success: true, conversationId: 'unexpected-project-root' };
      }
    }
  });
  const conv = conversation('projects-root-project-tests', {
    workspace: projectsRoot,
    dispatchProjectPath: ''
  });
  try {
    await global.window.runAgentLoop('Run npm test for the project.', 'gemini-1', conv, {
      semanticIntent: {
        intent: 'new_task',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: 'Run npm test for the selected project.',
        contextDependent: false,
        confidence: 1,
        needsClarification: false,
        reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'project' },
        executionScope: 'read_only',
        inspectionTarget: 'project',
        standaloneSystemOperation: false
      }
    });
    t.equal(promoteCalls, 0, 'project-bound test work never promotes the generic Projects root');
    const assistant = conv.messages.find(message => message.role === 'assistant');
    const toolErrors = (assistant.turns || [])
      .flatMap(turn => turn.toolResponseParts || [])
      .map(part => part.functionResponse && part.functionResponse.response && part.functionResponse.response.error)
      .filter(Boolean);
    // The loop pre-sanitizes standalone=false for project work (agent.js recomputes it from the
    // real request so a model cannot force standalone routing), so the workspace-resolution guard
    // — not the standalone-misuse guard — is what refuses the generic Projects root here.
    t.ok(toolErrors.some(error => /search root|resolve a specific project/i.test(error)), 'the tool result explains the project-work boundary');
    t.match(assistant.text, /resolved project workspace/i, 'the final response requests the missing project selection');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('committed Coder handoff remains successful when supervisor UI persistence fails afterward', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  let promoteCalls = 0;
  installHarness([], {
    projects: [workspace],
    workspace,
    window: {
      promoteWorkspaceToCoder: async () => {
        promoteCalls += 1;
        return {
          success: true,
          conversationId: 'coder-committed-handoff',
          taskId: 'task-committed-handoff',
          title: 'Committed Coder task',
          status: 'pending'
        };
      },
      saveConversationsToStorage: () => {
        throw new Error('injected supervisor pointer save failure');
      },
      startCoderTaskMonitor: () => {
        throw new Error('injected monitor start failure');
      }
    }
  });
  const conv = conversation('dispatch-committed-handoff', {
    workspace,
    dispatchProjectPath: workspace
  });
  try {
    const result = await agent.executeTool(
      'handoff_to_coder',
      {
        path: workspace,
        prompt: 'Implement the verified GRITLIFE change.',
        title: 'Committed Coder task'
      },
      workspace,
      {},
      conv
    );

    t.equal(promoteCalls, 1, 'the durable handoff is created exactly once');
    t.equal(result.success, true, 'post-commit UI failures do not turn the tool result into failure');
    t.equal(result.taskId, 'task-committed-handoff', 'the committed task ID remains authoritative');
    t.equal(result.committedWithWarning, true, 'nonfatal post-commit failures are marked explicitly');
    t.match(result.warning, /supervisor pointer/i, 'conversation persistence failure is reported as a warning');
    t.match(result.warning, /monitor/i, 'monitor startup failure is reported as a warning');
    t.equal(conv.launchedCoderTaskId, 'task-committed-handoff', 'Dispatch retains ownership of the committed task');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch explains memory behavior without entering the conversation-recall gate', async t => {
  const originalFetch = global.fetch;
  let searchCalls = 0;
  let memoryPolicyReachedModel = false;
  const answerText = 'I save conversations automatically and selectively keep durable facts or preferences when they are likely to matter again. You do not have to ask every time, but an explicit request makes it unambiguous; not every statement becomes permanent memory.';
  const harness = installHarness([
    body => {
      memoryPolicyReachedModel = JSON.stringify(body).includes('[ORION MEMORY BEHAVIOR]');
      return [{ text: answerText }];
    }
  ], {
    semanticClassification: {
      intent: 'conversation',
      requiresExecution: false,
      target: 'current_conversation',
      memoryIntent: 'memory_policy',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
    },
    api: {
      searchConversationEvidence: async () => {
        searchCalls += 1;
        return { success: true, evidence: [], queryTerms: [] };
      }
    }
  });
  const prompt = 'By the way, do you ever save anything I tell you or only when I specifically ask?';
  const conv = conversation('memory-policy-question');
  try {
    await global.window.runAgentLoop(prompt, 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant');
    t.equal(searchCalls, 0, 'a memory-policy question does not search for an allegedly earlier conversation');
    t.equal(harness.modelTurns, 1, 'the natural first answer is not replaced by a recall correction turn');
    t.equal(memoryPolicyReachedModel, true, 'the response model receives authoritative memory-mechanism context');
    t.equal(answer.text, answerText, 'the direct answer survives without an unrelated retrieval fallback');
    t.notOk(/couldn.?t retrieve that specific earlier conversation/i.test(answer.text), 'the conversation-recall fallback is absent');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch resolves an implicit personal-fact dependency before answering ordinary conversation', async t => {
  const originalFetch = global.fetch;
  const rankQueries = [];
  let answerRequestSawLocation = false;
  const harness = installHarness([
    body => {
      answerRequestSawLocation = JSON.stringify(body).includes('Jason lives in south-central Kentucky');
      return [{ text: 'For your area around Glasgow and Bowling Green, I can pull the current forecast now.' }];
    }
  ], {
    semanticClassification: {
      intent: 'conversation',
      target: 'current_conversation',
      resolvedRequest: "Answer the user's weather question using their known home location if available.",
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'recent' },
      memoryContext: {
        needed: true,
        query: 'user home location',
        confidence: 0.98
      }
    },
    api: {
      readGlobalMemory: async () => ({
        success: true,
        user: { name: 'Jason', preferences: [] },
        facts: [{ text: 'Jason lives in south-central Kentucky', category: 'personal' }]
      }),
      rankMemoryFacts: async query => {
        rankQueries.push(query);
        return query === 'user home location'
          ? {
              success: true,
              results: [{
                type: 'fact',
                text: 'Jason lives in south-central Kentucky',
                category: 'personal'
              }]
            }
          : { success: true, results: [] };
      }
    }
  });
  const conv = conversation('implicit-personal-memory');
  try {
    await global.window.runAgentLoop("What's the weather today?", 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant');
    t.deepEqual(rankQueries, ['user home location'], 'the integrated loop retrieves the concept required by the answer');
    t.equal(answerRequestSawLocation, true, 'the stored fact reaches the response model before its first answer');
    t.equal(harness.modelTurns, 1, 'the first answer is grounded without a correction or second user prompt');
    t.match(answer.text, /Glasgow and Bowling Green/i, 'the answer uses the retrieved location naturally');
    t.notOk(/where are you located/i.test(answer.text), 'Orion does not ask for a fact it already retrieved');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop permits an explicit recall claim only when exact evidence was retrieved', async t => {
  const originalFetch = global.fetch;
  let searchCalls = 0;
  const evidence = [{
    id: 'conversation:gritlife:msg-42',
    sourceKind: 'conversation',
    provenance: {
      conversationId: 'gritlife-earlier',
      messageId: 'msg-42',
      workspacePath: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
    },
    role: 'user',
    timestamp: new Date().toISOString(),
    excerpt: 'Replace or evolve the intent system with paid subscriptions and enrollments organized by locations: gym, yoga, massage, therapy, and classes.',
    scores: { total: 0.94 },
    matchedTerms: ['intent', 'subscriptions', 'locations']
  }];
  installHarness([
    [{ text: 'I remember our earlier discussion: the intent system would become paid subscriptions and enrollments organized by locations, including gyms, yoga, massages, therapy, and classes.' }]
  ], {
    projects: ['C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'],
    semanticClassification: {
      contextDependent: true,
      target: 'current_conversation',
      memoryIntent: 'conversation_recall',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' },
      inspectionTarget: 'project'
    },
    api: {
      searchConversationEvidence: async () => {
        searchCalls += 1;
        return {
          success: true,
          evidence,
          queryTerms: ['gritlife', 'intent', 'subscriptions', 'enrollments', 'locations', 'gym', 'yoga', 'massage']
        };
      }
    }
  });
  const prompt = 'Do you remember our earlier conversation about the GRITLIFE intent system?';
  const conv = conversation('recall-success', {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    dispatchProjectPath: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
  });
  try {
    await global.window.runAgentLoop(prompt, 'gemini-1', conv, {
      semanticIntent: {
        intent: 'conversation',
        requiresExecution: false,
        target: 'current_conversation',
        resolvedRequest: prompt,
        contextDependent: true,
        confidence: 1,
        needsClarification: false,
        memoryIntent: 'conversation_recall',
        reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' },
        executionScope: 'none',
        inspectionTarget: 'project',
        standaloneSystemOperation: false
      }
    });
    const answer = conv.messages.find(message => message.role === 'assistant');
    t.equal(searchCalls, 1, 'the exact-conversation search runs before answering');
    t.match(answer.text, /subscriptions.*enrollments|enrollments.*subscriptions/i, 'the actual retrieved subscription discussion is summarized');
    t.equal(answer.responseBasis.conversationEvidence.length, 1, 'response basis marks retrieved conversation evidence');
    t.equal(answer.responseBasis.conversationEvidence[0].conversationId, 'gritlife-earlier', 'exact retrieval provenance is retained');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop validates every recall answer and accepts a grounded semantic paraphrase', async t => {
  const originalFetch = global.fetch;
  const evidence = [{
    id: 'conversation:gritlife:semantic',
    sourceKind: 'conversation',
    provenance: {
      conversationId: 'gritlife-semantic-earlier',
      messageId: 'semantic-message',
      workspacePath: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
    },
    role: 'user',
    timestamp: new Date().toISOString(),
    excerpt: 'Replace or evolve intent with recurring paid subscriptions organized by location, including gym, yoga, massage, therapy, and classes.',
    scores: { total: 0.93 }
  }];
  const harness = installHarness([
    [{ text: 'The answer was combat colors, stamina streaks, and character traits.' }],
    [{ text: 'I found it. The proposal used ongoing paid memberships grouped by venues, with fitness, yoga, massage, therapy, and classes.' }]
  ], {
    projects: ['C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'],
    semanticClassification: {
      contextDependent: true,
      target: 'current_conversation',
      memoryIntent: 'conversation_recall',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' },
      inspectionTarget: 'project'
    },
    api: {
      searchConversationEvidence: async () => ({
        success: true,
        evidence,
        queryTerms: ['gritlife', 'intent', 'subscription', 'location']
      })
    }
  });
  const conv = conversation('recall-semantic-guard', {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    dispatchProjectPath: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
  });
  try {
    await global.window.runAgentLoop('Do you recall our earlier GRITLIFE intent design?', 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant').text;
    t.equal(harness.modelTurns, 2, 'the unlabeled fabrication is rejected and corrected');
    t.match(answer, /memberships grouped by venues/i, 'the grounded semantic paraphrase is accepted');
    t.notOk(/combat colors|stamina streaks|character traits/i.test(answer), 'unsupported recalled details do not survive');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop corrects an invented recollection when no evidence exists', async t => {
  const originalFetch = global.fetch;
  const harness = installHarness([
    [{ text: 'I remember we discussed traits and the Grind, Connect, and Survive systems.' }],
    [{ text: 'I could not retrieve that specific earlier conversation. I can reason from current project information if you want, but I should not reconstruct it as a memory.' }]
  ], {
    semanticClassification: {
      contextDependent: true,
      target: 'current_conversation',
      memoryIntent: 'conversation_recall',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
    },
    api: {
      searchConversationEvidence: async () => ({ success: true, evidence: [], queryTerms: ['intent'] })
    }
  });
  const conv = conversation('recall-failure');
  try {
    await global.window.runAgentLoop('Do you remember our earlier conversation about the intent system?', 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant');
    t.equal(harness.modelTurns, 2, 'the unsupported recall claim is rejected and corrected');
    t.match(answer.text, /could not retrieve/i, 'the final answer states the retrieval gap honestly');
    t.notOk(/\bI remember\b/i.test(answer.text), 'the invented recall claim is rejected');
    t.equal(answer.responseBasis.conversationEvidence.length, 0, 'response basis records that no conversation evidence was found');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop rejects an unlabeled reconstruction when recall evidence is absent', async t => {
  const originalFetch = global.fetch;
  installHarness([
    [{ text: 'The earlier discussion centered on Grind, Connect, and Survive shaping the intent system.' }],
    [{ text: 'I could not retrieve that specific earlier discussion. I am reasoning only from what is available now.' }]
  ], {
    semanticClassification: {
      contextDependent: true,
      target: 'current_conversation',
      memoryIntent: 'conversation_recall',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
    },
    api: {
      searchConversationEvidence: async () => ({ success: true, evidence: [], queryTerms: ['intent'] })
    }
  });
  const conv = conversation('recall-evasive-failure');
  try {
    await global.window.runAgentLoop('What did we decide earlier about the intent system?', 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant').text;
    t.match(answer, /could not retrieve/i, 'the answer discloses the retrieval gap');
    t.notOk(/discussion centered on Grind/i.test(answer), 'an evasive reconstruction is not accepted');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('an unresolved unbound turn answers naturally with inspection-only tools', async t => {
  const originalFetch = global.fetch;
  let writeCalls = 0;
  let offeredToolNames = [];
  const harness = installHarness([
    body => {
      offeredToolNames = ((body.tools || [])[0] && (body.tools || [])[0].functionDeclarations || [])
        .map(tool => tool.name);
      return [{ text: 'I can inspect the project safely, but which change do you want me to make?' }];
    }
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    api: {
      writeFile: async () => {
        writeCalls += 1;
        return { success: true };
      }
    }
  });
  const conv = conversation('unresolved-semantic-turn', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
  });
  try {
    await global.window.runAgentLoop('Do that.', 'gemini-1', conv, {
      semanticIntent: {
        intent: 'clarification_required',
        requiresExecution: false,
        target: 'current_conversation',
        resolvedRequest: '',
        contextDependent: true,
        confidence: 0,
        needsClarification: true,
        clarificationQuestion: 'Which change do you want me to make?',
        reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'recent' },
        executionScope: 'none',
        inspectionTarget: 'none',
        standaloneSystemOperation: false
      }
    });
    t.equal(harness.modelTurns, 1, 'the ordinary response model gets one chance to interpret the visible conversation');
    t.ok(offeredToolNames.includes('read_file'), 'read-only inspection remains available');
    t.notOk(offeredToolNames.includes('write_file'), 'writes are absent from the offered schema');
    t.notOk(offeredToolNames.includes('handoff_to_coder'), 'handoff is absent until executable intent is established');
    t.equal(writeCalls, 0, 'no mutation can leak through the safe fallback');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /inspect the project safely/i,
      'Orion returns the contextual model answer rather than a synthetic classifier gate');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('an unresolved task-bound turn parks the same durable task as pending', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  const harness = installHarness([
    [{ text: 'This tool-enabled model turn must not run.' }]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          status: 'active',
          execution: { executionId: 'exec-unresolved-bound' }
        },
        prompt: 'Continue the existing implementation.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('unresolved-bound-turn', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
  });
  try {
    await global.window.runAgentLoop('Use the second one.', 'gemini-1', conv, {
      taskId: 'task-unresolved-bound',
      preserveUserPrompt: true,
      semanticIntent: {
        intent: 'clarification_required',
        requiresExecution: false,
        target: 'current_conversation',
        resolvedRequest: '',
        contextDependent: true,
        confidence: 0.2,
        needsClarification: true,
        clarificationQuestion: 'Which second option do you mean?',
        reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'task' },
        executionScope: 'none',
        inspectionTarget: 'none',
        standaloneSystemOperation: false
      }
    });
    t.equal(harness.modelTurns, 0, 'the unresolved bound reply never enters normal execution');
    t.equal(finalized.length, 1, 'the claimed task is reconciled once');
    t.equal(finalized[0].taskId, 'task-unresolved-bound', 'the exact claimed task remains authoritative');
    t.equal(finalized[0].status, 'pending', 'clarification parks rather than completes the task');
    t.equal(finalized[0].details.awaitingUser, true, 'the durable receipt records that user input is required');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /which second option/i, 'the targeted question is persisted');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('cancellation during a durable task claim prevents the run from starting', async t => {
  const originalFetch = global.fetch;
  let releaseClaim;
  const finalized = [];
  installHarness([[{ text: 'This model turn must never run.' }]], {
    window: {
      claimOrchestrationTask: async taskId => new Promise(resolve => {
        releaseClaim = () => resolve({
          success: true,
          task: { taskId, status: 'active', execution: { executionId: 'exec-startup-cancel' } },
          prompt: 'Execute the claimed task.'
        });
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status, execution: { executionId: details.expectedExecutionId } };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('startup-cancel');
  try {
    const run = global.window.runAgentLoop('Start', 'gemini-1', conv, { taskId: 'task-startup-cancel' });
    await Promise.resolve();
    const stop = global.window.stopAgentExecution({ mode: 'hard', taskId: 'task-startup-cancel' });
    t.equal(stop.starting, true, 'the stop request attaches to the starting task');
    releaseClaim();
    const result = await run;
    t.equal(result.reason, 'cancelled_while_starting', 'the claimed task never enters the model loop');
    t.equal(finalized.length, 1, 'the cancellation is persisted exactly once');
    t.equal(finalized[0].status, 'cancelled', 'the canonical task state is cancelled');
    t.equal(finalized[0].details.expectedExecutionId, 'exec-startup-cancel', 'the cancellation targets the claimed execution generation');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('startup cancellation retains ownership and retries until the canonical task is terminal', async t => {
  const originalFetch = global.fetch;
  const originalTimeout = global.setTimeout;
  let releaseClaim;
  let finalizeAttempts = 0;
  let retryTimer = null;
  let retryTimerUnrefCount = 0;
  const finalizedHooks = [];
  const lifecycleStates = [];
  const harness = installHarness([[{ text: 'This model turn must never run.' }]], {
    window: {
      claimOrchestrationTask: async taskId => new Promise(resolve => {
        releaseClaim = () => resolve({
          success: true,
          task: { taskId, status: 'active', execution: { executionId: 'exec-startup-unverified' } },
          prompt: 'Execute the claimed task.'
        });
      }),
      finalizeOrchestrationTask: async (taskId, status) => {
        finalizeAttempts += 1;
        return finalizeAttempts >= 2 ? { taskId, status } : null;
      },
      getOrchestrationTaskStatus: async taskId => ({
        success: true,
        status: 'active',
        task: {
          taskId,
          status: 'active',
          execution: { executionId: 'exec-startup-unverified' }
        }
      }),
      onOrchestrationTaskFinalized: async (...args) => {
        finalizedHooks.push(args);
      },
      onAgentStatusChange: (_running, details = {}) => {
        lifecycleStates.push(details);
      }
    }
  });
  global.setTimeout = (callback, delay) => {
    if (delay === 250 && !retryTimer) {
      retryTimer = {
        callback,
        delay,
        unref: () => {
          retryTimerUnrefCount += 1;
        }
      };
      return retryTimer;
    }
    return null;
  };
  const conv = conversation('startup-cancel-unverified');
  try {
    const run = global.window.runAgentLoop(
      'Start',
      'gemini-1',
      conv,
      { taskId: 'task-startup-unverified' }
    );
    await Promise.resolve();
    global.window.stopAgentExecution({ mode: 'hard', taskId: 'task-startup-unverified' });
    releaseClaim();
    const result = await run;

    t.equal(result.reason, 'startup_cancellation_recovering', 'the result exposes an active cancellation-recovery state');
    t.equal(result.cancelled, false, 'an active canonical task is never labeled cancelled');
    t.equal(result.status, 'stopping', 'the user-facing state is explicitly stopping');
    t.equal(result.canonicalStatus, 'active', 'the unresolved canonical active state remains explicit');
    t.equal(result.recovery, true, 'the result confirms that deterministic recovery owns the task');
    t.equal(finalizedHooks.length, 0, 'no terminal-state hook is published for an active task');
    t.equal(harness.modelTurns, 0, 'the stopped startup never enters the model loop');
    t.ok(harness.systemMessages.some(message => /retaining ownership and retrying reconciliation/i.test(message)), 'the conversation records the recovery state explicitly');
    t.equal(global.window.isAgentRunning(), true, 'the startup reservation remains held while the canonical task is active');
    t.equal(global.window.getActiveRunTaskId(), 'task-startup-unverified', 'the exact active task remains owned during recovery');
    const recovery = agent.getStartupCancellationRecoveryState();
    t.equal(recovery.status, 'stopping', 'the recovery snapshot exposes stopping state');
    t.equal(recovery.canonicalStatus, 'active', 'the recovery snapshot preserves the observed canonical state');
    t.equal(retryTimerUnrefCount, 1, 'the single retry timer is unrefd and cannot keep Node alive');
    t.ok(retryTimer && typeof retryTimer.callback === 'function', 'one bounded retry is scheduled');
    t.ok(lifecycleStates.some(state => state.status === 'stopping' && state.cancellationRecovery), 'the lifecycle channel publishes stopping/recovery state');

    await retryTimer.callback();

    t.equal(finalizeAttempts, 2, 'the retry makes one additional canonical cancellation attempt');
    t.equal(finalizedHooks.length, 1, 'the recovered terminal state is published exactly once');
    t.equal(finalizedHooks[0][2], 'cancelled', 'the retry publishes the verified cancelled state');
    t.equal(agent.getStartupCancellationRecoveryState(), null, 'terminal reconciliation clears recovery state');
    t.equal(global.window.isAgentRunning(), false, 'the startup reservation releases only after a terminal state is verified');
  } finally {
    restoreGlobals(originalFetch);
    global.setTimeout = originalTimeout;
  }
  t.end();
});

test('task-bound continuation keeps the canonical packet after restart while preserving exact live input', async t => {
  const originalFetch = global.fetch;
  const workspace = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  const canonicalPrompt = [
    'Task: Implement location-based enrollments',
    'Objective: Replace or evolve intent with recurring location-based subscriptions.',
    `Workspace path: ${workspace}`,
    'Requirements:',
    '- Include gym, yoga, massage, therapy, and classes.',
    'Constraints:',
    '- Preserve existing player data.',
    '- Verify recurring costs and benefits.'
  ].join('\n');
  const liveReply = 'Use the second option, and continue.';
  let executionRequest = '';
  installHarness([
    body => {
      executionRequest = JSON.stringify(body);
      return [{ text: 'I retained the durable task packet and exact continuation.' }];
    }
  ], {
    workspace,
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          status: 'active',
          execution: { executionId: 'exec-restart-context' }
        },
        prompt: canonicalPrompt
      }),
      finalizeOrchestrationTask: async (taskId, status) => ({ taskId, status }),
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('restart-context-continuation', {
    mode: 'coder',
    workspace,
    compactedSummary: 'Older transcript was compacted before this continuation.',
    messages: []
  });
  try {
    await global.window.runAgentLoop(
      liveReply,
      'gemini-1',
      conv,
      {
        taskId: 'task-restart-context',
        preserveUserPrompt: true,
        source: 'task-continuation'
      }
    );
    t.match(executionRequest, /CANONICAL DURABLE TASK PACKET/, 'the model input identifies the canonical claimed packet');
    t.match(executionRequest, /Replace or evolve intent with recurring location-based subscriptions/, 'the objective survives restart and compaction');
    t.ok(executionRequest.includes(workspace.replace(/\\/g, '\\\\')), 'the exact workspace survives in the serialized model input');
    t.match(executionRequest, /Preserve existing player data/, 'durable constraints survive in the model input');
    t.match(executionRequest, /gym, yoga, massage, therapy, and classes/, 'durable requirements survive in the model input');
    t.match(executionRequest, /EXACT LIVE TASK-BOUND USER INPUT/, 'the live continuation has a separate typed section');
    t.match(executionRequest, /Use the second option, and continue/, 'the exact live continuation reaches execution alongside the packet');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('free-text plan denial preserves the live reply and cancels only its bound durable task', async t => {
  const originalFetch = global.fetch;
  const taskStates = new Map([
    ['task-plan-to-deny', 'pending'],
    ['task-unrelated', 'pending']
  ]);
  const finalized = [];
  installHarness([], {
    window: {
      claimOrchestrationTask: async taskId => {
        taskStates.set(taskId, 'active');
        return {
          success: true,
          task: {
            taskId,
            status: 'active',
            execution: { executionId: 'exec-plan-denial' }
          },
          prompt: [
            'Task: Implement the original objective',
            'Objective: Execute the original implementation objective now.',
            'Workspace path: C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
            'Constraints:',
            '- Do not discard the approved data model.'
          ].join('\n')
        };
      },
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        taskStates.set(taskId, status);
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('typed-plan-denial', {
    awaitingPlanApproval: true,
    awaitingPlanApprovalTaskId: 'task-plan-to-deny'
  });
  try {
    await global.window.runAgentLoop(
      'No, cancel this plan. Do not implement it.',
      'gemini-1',
      conv,
      {
        taskId: 'task-plan-to-deny',
        preserveUserPrompt: true,
        source: 'user',
        semanticIntent: {
          intent: 'deny_plan',
          requiresExecution: true,
          target: 'pending_plan',
          resolvedRequest: 'Deny the pending plan and cancel its bound task.',
          contextDependent: true,
          confidence: 1,
          needsClarification: false,
          reasoningPolicyHint: { complexity: 'low', risk: 'medium', contextNeed: 'task' },
          executionScope: 'mutating',
          inspectionTarget: 'none',
          standaloneSystemOperation: false
        }
      }
    );

    t.notOk(
      conv.messages.some(message => /Execute the original implementation objective now/.test(String(message.text || ''))),
      'the claimed execution objective never replaces the denial response'
    );
    t.equal(finalized.length, 1, 'one canonical task transition is attempted');
    t.equal(finalized[0].taskId, 'task-plan-to-deny', 'the approval-bound task ID is finalized');
    t.equal(finalized[0].status, 'cancelled', 'the denied plan task becomes explicitly cancelled');
    t.equal(finalized[0].details.expectedExecutionId, 'exec-plan-denial', 'the transition is scoped to the claimed execution generation');
    t.equal(taskStates.get('task-unrelated'), 'pending', 'an unrelated task in the same lifecycle remains untouched');
    t.equal(conv.awaitingPlanApproval, false, 'the approval gate clears only after targeting its bound task');
    t.equal(conv.awaitingPlanApprovalTaskId, '', 'the stale approval task pointer is removed');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /plan denied|plan was cancelled|task was cancelled/i, 'the final response reports the canonical cancellation');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('free-text plan denial restores the approval gate when canonical cancellation is unverified', async t => {
  const originalFetch = global.fetch;
  installHarness([
    [{ text: '{"intent":"deny","reason":"The user rejected the pending plan."}' }]
  ], {
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          status: 'active',
          execution: { executionId: 'exec-plan-denial-unverified' }
        },
        prompt: 'Execute the original implementation objective now.'
      }),
      finalizeOrchestrationTask: async () => null,
      getOrchestrationTaskStatus: async taskId => ({
        success: true,
        taskId,
        status: 'active',
        task: { taskId, status: 'active' }
      }),
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('typed-plan-denial-unverified', {
    awaitingPlanApproval: true,
    awaitingPlanApprovalTaskId: 'task-plan-still-active'
  });
  try {
    await global.window.runAgentLoop(
      'No, cancel this plan.',
      'gemini-1',
      conv,
      {
        taskId: 'task-plan-still-active',
        preserveUserPrompt: true,
        source: 'user',
        semanticIntent: {
          intent: 'deny_plan',
          requiresExecution: true,
          target: 'pending_plan',
          resolvedRequest: 'Deny the pending plan and cancel its bound task.',
          contextDependent: true,
          confidence: 1,
          needsClarification: false,
          reasoningPolicyHint: { complexity: 'low', risk: 'medium', contextNeed: 'task' },
          executionScope: 'mutating',
          inspectionTarget: 'none',
          standaloneSystemOperation: false
        }
      }
    );

    t.equal(conv.awaitingPlanApproval, true, 'the approval gate is restored instead of silently dropping control of active work');
    t.equal(conv.awaitingPlanApprovalTaskId, 'task-plan-still-active', 'the exact task pointer remains available for a retry');
    const finalAnswer = conv.messages.find(message => message.role === 'assistant').text;
    t.match(finalAnswer, /could not verify cancellation/i, 'the response discloses the failed canonical transition');
    t.notOk(/(?:^|\n)Task cancelled|associated task was cancelled/i.test(finalAnswer), 'the active task is never given an affirmative cancelled status');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('pre-loop initialization failure finalizes the task and releases the runner', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  installHarness([[{ text: 'A later run can start.' }]], {
    window: {
      getAppConfig: () => {
        throw new Error('injected setup failure');
      },
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-init-failure' } },
        prompt: 'Execute durable work.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const failedConv = conversation('init-failure');
  try {
    const failed = await global.window.runAgentLoop('Start', 'gemini-1', failedConv, { taskId: 'task-init-failure' });
    t.equal(failed.reason, 'lifecycle_error', 'setup rejection is returned as a lifecycle failure');
    t.equal(finalized.length, 1, 'the claimed durable task is finalized');
    t.equal(finalized[0].status, 'failed', 'setup failure cannot leave the task active');
    global.window.getAppConfig = () => ({
      planningMode: false,
      geminiApiKey: 'test-key',
      modelCallDelayMs: 0,
      autoTest: false
    });
    const next = await global.window.runAgentLoop('Try again', 'gemini-1', conversation('after-init-failure'));
    t.notEqual(next && next.reason, 'agent_busy', 'the global runner is released for later work');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a model API failure finalizes durable work as failed, never completed', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  installHarness([], {
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-provider-failure' } },
        prompt: 'Complete the durable work.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {},
      getAppConfig: () => ({
        planningMode: false,
        deepseekApiKey: '',
        modelCallDelayMs: 0,
        autoTest: false,
        reasoningEffort: 'auto'
      })
    }
  });
  const conv = conversation('provider-failure', { mode: 'coder' });
  try {
    await global.window.runAgentLoop(
      'Complete the durable work.',
      'deepseek-v4-flash',
      conv,
      {
        taskId: 'task-provider-failure',
        semanticIntent: semanticClassification({
          intent: 'new_task',
          requiresExecution: true,
          target: 'current_conversation',
          resolvedRequest: 'Complete the durable work.',
          reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'task' },
          executionScope: 'mutating',
          inspectionTarget: 'workspace'
        })
      }
    );

    t.equal(finalized.length, 1, 'the claimed task receives one canonical terminal transition');
    t.equal(finalized[0].status, 'failed', 'the provider failure is recorded as failed');
    t.notEqual(finalized[0].status, 'completed', 'an API error cannot be reported as completion');
    t.match(finalized[0].details.reason, /api key/i, 'the durable failure keeps the real provider reason');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('queue drain requeues an item when a competing start reports agent_busy', async t => {
  const originalRun = global.window.runAgentLoop;
  const originalConversations = global.conversations;
  const originalActiveConversationId = global.activeConversationId;
  const originalTimeout = global.setTimeout;
  let receivedRunOptions = null;
  const conv = conversation('queue-contention');
  global.conversations = [conv];
  global.activeConversationId = conv.id;
  global.window.promptQueue = [{
    taskId: 'task-requeue',
    conversationId: conv.id,
    prompt: 'Run the durable task.',
    preserveUserPrompt: true,
    images: [{ mimeType: 'image/png', data: 'abc' }],
    contextPacketIds: ['packet-1'],
    modelSelectValue: 'deepseek-v4-flash',
    reasoningEffort: 'max',
    executionProfile: {
      requestedModel: 'deepseek-v4-flash',
      requestedReasoning: 'max',
      allowEscalation: true,
      allowDowngrade: false,
      capturedAt: 1000
    }
  }];
  global.window.runAgentLoop = async (_prompt, _model, _conversation, runOptions) => {
    receivedRunOptions = runOptions;
    return { success: false, reason: 'agent_busy' };
  };
  global.setTimeout = () => null;
  try {
    await agent.drainNextQueuedTask();
    t.equal(global.window.promptQueue.length, 1, 'the queue item is not lost');
    t.equal(global.window.promptQueue[0].taskId, 'task-requeue', 'the same durable task is put back at the front');
    t.equal(global.window.promptQueue[0].contextPacketIds[0], 'packet-1', 'durable context references remain attached');
    t.equal(receivedRunOptions.preserveUserPrompt, true, 'task-bound live replies preserve their queued user text at claim time');
    t.equal(receivedRunOptions.reasoningEffort, 'max', 'the durable reasoning selection reaches the actual agent loop');
    t.equal(receivedRunOptions.executionProfile.requestedModel, 'deepseek-v4-flash', 'the durable model policy reaches the actual agent loop');
  } finally {
    global.window.runAgentLoop = originalRun;
    global.conversations = originalConversations;
    global.activeConversationId = originalActiveConversationId;
    global.setTimeout = originalTimeout;
  }
  t.end();
});

test('queue drain canonically fails a durable task whose target conversation is missing', async t => {
  const originalConversations = global.conversations;
  const originalTimeout = global.setTimeout;
  const originalFinalize = global.window.finalizeOrchestrationTask;
  const originalPublish = global.window.onOrchestrationTaskFinalized;
  const originalPersist = global.window.persistAssistantStatusMessage;
  const finalized = [];
  const published = [];
  const queued = {
    id: 'missing-target-queue-item',
    taskId: 'task-missing-target',
    conversationId: 'conversation-that-was-deleted',
    originConversationId: 'dispatch-owner',
    prompt: 'Execute this durable task.',
    source: 'user-queue'
  };
  global.conversations = [];
  global.window.promptQueue = [queued];
  global.window.finalizeOrchestrationTask = async (taskId, status, details) => {
    finalized.push({ taskId, status, details });
    return { taskId, status };
  };
  global.window.onOrchestrationTaskFinalized = async (...args) => {
    published.push(args);
  };
  global.window.persistAssistantStatusMessage = () => {};
  global.setTimeout = () => null;
  try {
    const result = await agent.drainNextQueuedTask();
    t.equal(result.reason, 'queued_task_target_missing', 'the missing target has a distinct lifecycle reason');
    t.equal(result.status, 'failed', 'the durable task records an explicit failed state');
    t.equal(finalized.length, 1, 'one canonical transition is attempted');
    t.equal(finalized[0].taskId, queued.taskId, 'the shifted durable task ID is preserved');
    t.equal(finalized[0].status, 'failed', 'the missing conversation is recorded as a task failure');
    t.equal(finalized[0].details.reasonCode, 'queued_task_target_missing', 'the canonical failure carries a machine-readable reason');
    t.equal(published.length, 1, 'the canonical failed state is published once');
    t.equal(global.window.promptQueue.length, 0, 'a canonically terminal task is not requeued');
  } finally {
    global.conversations = originalConversations;
    global.window.finalizeOrchestrationTask = originalFinalize;
    global.window.onOrchestrationTaskFinalized = originalPublish;
    global.window.persistAssistantStatusMessage = originalPersist;
    global.setTimeout = originalTimeout;
  }
  t.end();
});

test('queue drain retains the exact durable payload when a missing target cannot be finalized', async t => {
  const originalConversations = global.conversations;
  const originalTimeout = global.setTimeout;
  const originalFinalize = global.window.finalizeOrchestrationTask;
  const originalRead = global.window.getOrchestrationTaskStatus;
  const originalPersist = global.window.persistAssistantStatusMessage;
  const queued = {
    id: 'missing-target-retry-item',
    taskId: 'task-missing-target-retry',
    conversationId: 'missing-coder-conversation',
    originConversationId: 'dispatch-owner',
    prompt: 'Keep every part of this durable packet.',
    images: [{ mimeType: 'image/png', data: 'image-data' }],
    contextPacketIds: ['packet-a'],
    source: 'user-queue'
  };
  global.conversations = [];
  global.window.promptQueue = [queued];
  global.window.finalizeOrchestrationTask = async () => {
    throw new Error('injected task-store write failure');
  };
  global.window.getOrchestrationTaskStatus = async () => ({
    success: true,
    task: { taskId: queued.taskId, status: 'pending' }
  });
  global.window.persistAssistantStatusMessage = () => {};
  global.setTimeout = () => null;
  try {
    const result = await agent.drainNextQueuedTask();
    t.equal(result.reason, 'queued_task_target_missing', 'the target failure remains explicit');
    t.equal(result.requeued, true, 'an unconfirmed terminal transition retains the work');
    t.equal(global.window.promptQueue.length, 1, 'the shifted queue item is restored');
    t.equal(global.window.promptQueue[0], queued, 'the exact queue payload object is restored');
    t.equal(global.window.promptQueue[0].images[0].data, 'image-data', 'attachments survive the retry');
    t.equal(global.window.promptQueue[0].contextPacketIds[0], 'packet-a', 'context packet ownership survives the retry');
  } finally {
    global.conversations = originalConversations;
    global.window.finalizeOrchestrationTask = originalFinalize;
    global.window.getOrchestrationTaskStatus = originalRead;
    global.window.persistAssistantStatusMessage = originalPersist;
    global.setTimeout = originalTimeout;
  }
  t.end();
});

test('queue drain requeues the exact durable payload when task claim throws', async t => {
  const originalFetch = global.fetch;
  const originalConversations = global.conversations;
  const originalTimeout = global.setTimeout;
  const conv = conversation('claim-error-conversation');
  const queued = {
    id: 'claim-error-item',
    taskId: 'task-claim-error',
    conversationId: conv.id,
    originConversationId: conv.id,
    prompt: 'Run the durable task after the task store recovers.',
    preserveUserPrompt: true,
    images: [{ mimeType: 'image/png', data: 'claim-image' }],
    contextPacketIds: ['claim-packet'],
    source: 'user-queue'
  };
  installHarness([], {
    window: {
      claimOrchestrationTask: async () => {
        throw new Error('injected claim transaction failure');
      },
      persistAssistantStatusMessage: () => {}
    }
  });
  global.conversations = [conv];
  global.window.promptQueue = [queued];
  global.setTimeout = () => null;
  try {
    const result = await agent.drainNextQueuedTask();
    t.equal(result.reason, 'task_claim_error', 'claim exceptions use a stable machine-readable reason');
    t.match(result.error, /claim transaction failure/, 'the underlying claim error remains available');
    t.equal(global.window.promptQueue.length, 1, 'the task is retained for retry');
    t.equal(global.window.promptQueue[0], queued, 'the exact shifted queue payload is restored');
    t.equal(global.window.promptQueue[0].images[0].data, 'claim-image', 'claim retry keeps attachments');
    t.equal(global.window.promptQueue[0].contextPacketIds[0], 'claim-packet', 'claim retry keeps context packet references');
  } finally {
    global.conversations = originalConversations;
    restoreGlobals(originalFetch);
    global.setTimeout = originalTimeout;
  }
  t.end();
});

test('queue drain retains pending work when launch setup throws', async t => {
  const originalConversations = global.conversations;
  const originalTimeout = global.setTimeout;
  const originalAppend = global.window.appendSystemMessage;
  const originalRead = global.window.getOrchestrationTaskStatus;
  const originalPersist = global.window.persistAssistantStatusMessage;
  const conv = conversation('queue-setup-error');
  const queued = {
    id: 'queue-setup-error',
    taskId: 'task-setup-error',
    conversationId: conv.id,
    originConversationId: conv.id,
    prompt: 'Run the durable task.',
    source: 'user-queue'
  };
  global.conversations = [conv];
  global.window.promptQueue = [queued];
  global.window.appendSystemMessage = () => {
    throw new Error('injected queue UI failure');
  };
  global.window.getOrchestrationTaskStatus = async () => ({
    success: true,
    taskId: queued.taskId,
    status: 'pending'
  });
  global.window.persistAssistantStatusMessage = () => {};
  global.setTimeout = () => null;
  try {
    await agent.drainNextQueuedTask();
    t.equal(global.window.promptQueue.length, 1, 'the pending task remains queued after setup failure');
    t.equal(global.window.promptQueue[0].taskId, queued.taskId, 'the exact durable task is restored at the front');
  } finally {
    global.conversations = originalConversations;
    global.window.appendSystemMessage = originalAppend;
    global.window.getOrchestrationTaskStatus = originalRead;
    global.window.persistAssistantStatusMessage = originalPersist;
    global.setTimeout = originalTimeout;
  }
  t.end();
});

test('post-finalization presentation errors preserve the canonical durable task state', async t => {
  const originalFetch = global.fetch;
  const transitions = [];
  const publishedStates = [];
  installHarness([[{ text: 'The durable work is complete.' }]], {
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-post-finalization' } },
        prompt: 'Complete the durable work.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        transitions.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {},
      onAgentRunFinalized: async (_conversationId, status, details) => {
        publishedStates.push({ status, details });
      },
      renderConversationList: () => {
        throw new Error('injected post-finalization list render failure');
      }
    }
  });
  const conv = conversation('post-finalization-warning');
  try {
    const result = await global.window.runAgentLoop(
      'Complete the durable work.',
      'gemini-1',
      conv,
      { taskId: 'task-post-finalization' }
    );
    t.equal(result.reason, 'post_finalization_warning', 'the caller receives a post-finalization warning rather than a false lifecycle failure');
    t.equal(result.status, 'completed', 'the committed completed state remains authoritative');
    t.equal(result.canonicalStatusPreserved, true, 'the return value explicitly records preservation');
    t.equal(transitions.length, 1, 'no second failed transition is attempted');
    t.equal(transitions[0].status, 'completed', 'the sole transition is the original completed transition');
    t.notOk(publishedStates.some(item => item.status === 'failed'), 'the UI lifecycle hook never publishes a fabricated failed state');
    t.equal(publishedStates[publishedStates.length - 1].status, 'completed', 'the warning republishes the canonical completed state');
    t.equal(publishedStates[publishedStates.length - 1].details.postFinalizationWarning, true, 'the preserved-state publication is identified as a warning');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('automatic continuation stays queued behind existing user work instead of being stranded', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  installHarness([
    [{
      functionCall: {
        name: 'set_task_checklist',
        args: {
          tasks: [
            { title: 'Finish the first milestone', status: 'completed' },
            { title: 'Finish the second milestone', status: 'pending' }
          ]
        }
      }
    }],
    [{ text: 'Completed the first milestone.' }]
  ], {
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-auto-continue' } },
        prompt: 'Execute both milestones.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const waitingUserTask = {
    taskId: 'task-user-next',
    conversationId: 'queued-user-conversation',
    prompt: 'Handle this user request next.',
    source: 'queue'
  };
  global.window.promptQueue = [waitingUserTask];
  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 100 || delay === 500) return null;
    return nativeSetTimeout(fn, delay, ...args);
  };
  const conv = conversation('auto-continue-origin', { mode: 'coder' });
  try {
    await global.window.runAgentLoop(
      'Execute both milestones.',
      'gemini-1',
      conv,
      {
        taskId: 'task-auto-continue',
        semanticIntent: {
          intent: 'new_task',
          requiresExecution: true,
          target: 'current_conversation',
          resolvedRequest: 'Execute both milestones.',
          contextDependent: false,
          confidence: 1,
          needsClarification: false,
          reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'task' },
          executionScope: 'mutating',
          inspectionTarget: 'workspace',
          standaloneSystemOperation: false
        }
      }
    );

    t.equal(finalized.length, 1, 'the durable task receives one end-of-pass transition');
    t.equal(finalized[0].status, 'pending', 'unfinished work remains canonically pending');
    t.equal(global.window.promptQueue.length, 2, 'the queue keeps both the user work and the continuation');
    t.equal(global.window.promptQueue[0], waitingUserTask, 'existing user work retains priority');
    const continuation = global.window.promptQueue[1];
    t.equal(continuation.taskId, 'task-auto-continue', 'the continuation retains the originating durable task ID');
    t.equal(continuation.conversationId, conv.id, 'the continuation retains the originating conversation');
    t.equal(continuation.source, 'system', 'the continuation is explicitly internal');
    t.match(continuation.prompt, /ORION INTERNAL CONTINUATION/, 'the queued item is the actionable continuation packet');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('healthy durable direct task checkpoints and automatically continues when a pass hits its action boundary', async t => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const finalized = [];
  const finalizedRuns = [];
  const turns = Array.from({ length: 25 }, (_, index) => ([
    ...(index === 0 ? [{ text: 'I am updating the requested implementation now.' }] : []),
    {
      functionCall: {
        name: 'run_command',
        args: { command: `node -e "console.log(${index})"` }
      }
    }
  ]));
  installHarness(turns, {
    supervisorResponse: '',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    api: {
      runCommand: async () => ({ success: true, exitCode: 0, stdout: 'ok', stderr: '' })
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-boundary-rollover' } },
        prompt: 'Finish the durable direct task and verify the result.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {},
      onAgentRunFinalized: async (conversationId, status, details) => {
        finalizedRuns.push({ conversationId, status, details });
      }
    }
  });
  const waitingUserTask = {
    taskId: 'task-user-waiting',
    conversationId: 'another-conversation',
    prompt: 'Keep this user work ahead of internal continuation.',
    source: 'queue'
  };
  global.window.promptQueue = [waitingUserTask];
  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 100 || delay === 500) return null;
    return nativeSetTimeout(fn, delay, ...args);
  };
  const conv = conversation('durable-boundary-rollover', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    _planExecAutoContinues: 100
  });
  try {
    // Exercise the real provider/supervisor path. An empty supervisor reply reproduces the live
    // malformed-response fallback that grants one +5 wrap-up before the pass boundary closes.
    process.env.NODE_ENV = 'production';
    await global.window.runAgentLoop(
      'Finish the durable direct task and verify the result.',
      'gemini-1',
      conv,
      { taskId: 'task-boundary-rollover' }
    );

    t.equal(finalized.length, 1, 'the execution pass records one canonical transition');
    t.equal(finalized[0].taskId, 'task-boundary-rollover', 'the original durable task identity is preserved');
    t.equal(finalized[0].status, 'pending', 'the unfinished pass checkpoints as pending, not completed or failed');
    t.match(finalized[0].details.reason, /continue automatically/i, 'the pending reason records automatic continuation');
    t.equal(global.window.promptQueue.length, 2, 'existing user work and the internal continuation both remain queued');
    t.equal(global.window.promptQueue[0], waitingUserTask, 'existing user work retains queue priority');
    const continuation = global.window.promptQueue[1];
    t.equal(continuation.taskId, 'task-boundary-rollover', 'the next pass reuses the same task ID');
    t.equal(continuation.conversationId, conv.id, 'the next pass reuses the same Coder conversation');
    t.equal(continuation.preserveUserPrompt, true, 'the continuation directive is not replaced by the original task prompt');
    t.match(continuation.prompt, /per-pass action boundary/i, 'the next pass receives an explicit checkpoint continuation directive');
    const answer = conv.messages.find(message => message.role === 'assistant').text;
    t.match(answer, /continuing the same task automatically/i, 'the transcript explains that this is a checkpoint, not a final answer');
    t.notOk(/ask me to continue/i.test(answer), 'the user is not asked to babysit a healthy durable task');
    t.equal(finalizedRuns.length, 1, 'the renderer receives one end-of-pass lifecycle update');
    t.equal(finalizedRuns[0].details.automaticContinuation, true, 'the UI is told the same task is continuing');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('productive pre-approval planning checkpoints continue automatically under the same durable task', async t => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const finalized = [];
  const turns = Array.from({ length: 50 }, (_, index) => ([{
    functionCall: {
      name: 'read_file',
      args: {
        path: `systems/planning-surface-${index}.py`,
        startLine: 1,
        endLine: 40
      }
    }
  }]));
  installHarness(turns, {
    supervisorResponse: '',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    semanticClassification: {
      intent: 'new_task',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: 'Trace the retirement lifecycle, prepare the implementation plan, and verify every affected surface.',
      contextDependent: false,
      reasoningPolicyHint: { complexity: 'high', risk: 'high', contextNeed: 'project' },
      taskResolution: { title: 'Plan the GRITLIFE retirement lifecycle fix', requirements: [], constraints: [], unresolvedDecisions: [] },
      executionScope: 'mutating',
      inspectionTarget: 'project'
    },
    api: {
      readFile: async (_workspace, relativePath) => String(relativePath || '').includes('.orion/')
        ? ''
        : 'def relevant_surface():\\n    return True\\n',
      writeFile: async () => ({ success: true })
    },
    window: {
      getAppConfig: () => ({
        planningMode: true,
        geminiApiKey: 'test-key',
        modelCallDelayMs: 0,
        autoTest: false
      }),
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          status: 'active',
          title: 'Plan the GRITLIFE retirement lifecycle fix',
          execution: { executionId: 'exec-planning-boundary' }
        },
        prompt: 'Trace the retirement lifecycle, prepare the implementation plan, and verify every affected surface.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  global.window.promptQueue = [];
  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 100 || delay === 500) return null;
    return nativeSetTimeout(fn, delay, ...args);
  };
  const conv = conversation('planning-boundary-rollover', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    planApproved: false,
    awaitingPlanApproval: false
  });
  try {
    process.env.NODE_ENV = 'production';
    await global.window.runAgentLoop(
      'Trace the retirement lifecycle and prepare the implementation plan.',
      'gemini-1',
      conv,
      { taskId: 'task-planning-boundary' }
    );

    t.equal(finalized.length, 1, 'the planning pass records one canonical boundary transition');
    t.equal(finalized[0].status, 'pending', 'unfinished planning remains pending rather than falsely completing');
    t.equal(finalized[0].details.resumePolicy, 'automatic', 'pre-approval analysis records an automatic durable resume policy');
    t.match(finalized[0].details.continuation.input, /ORION INTERNAL CONTINUATION/, 'the next-pass directive is persisted with the task');
    t.equal(global.window.promptQueue.length, 1, 'the next planning pass is queued without user babysitting');
    t.equal(global.window.promptQueue[0].taskId, 'task-planning-boundary', 'automatic planning keeps the original task ID');
    const answer = conv.messages.find(message => message.role === 'assistant').text;
    t.match(answer, /continuing the same task automatically/i, 'the transcript reports a checkpoint rather than a pause');
    t.notOk(/ask me to continue/i.test(answer), 'productive planning never asks the user to restart it manually');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('repeated execution failure parks the same task pending with an honest final message', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  installHarness([
    [
      { text: 'Let me update project memory and finalize.' },
      { functionCall: { name: 'run_command', args: { command: 'python broken_validation.py' } } }
    ],
    [{ functionCall: { name: 'run_command', args: { command: 'python broken_validation.py' } } }],
    [{ functionCall: { name: 'run_command', args: { command: 'python broken_validation.py' } } }]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    api: {
      runCommand: async () => {
        throw new Error('SyntaxError: invalid validation expression');
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-repeated-failure' } },
        prompt: 'Finish the implementation and verify it.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  const conv = conversation('repeated-failure-task', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
    planApproved: true,
    tasks: [{ title: 'Verify the implementation', status: 'in-progress' }]
  });
  try {
    await global.window.runAgentLoop(
      'Finish the implementation and verify it.',
      'gemini-1',
      conv,
      { taskId: 'task-repeated-failure' }
    );
    t.equal(finalized.length, 1, 'one canonical end-of-pass transition is recorded');
    t.equal(finalized[0].taskId, 'task-repeated-failure', 'the original durable task identity is retained');
    t.equal(finalized[0].status, 'pending', 'the repeated failure parks work as pending rather than failed');
    t.match(finalized[0].details.reason, /repeated run_command failures/i, 'the durable pending reason records the failure boundary');
    t.match(finalized[0].details.result.summary, /paused before completion/i, 'the durable result replaces the stale pre-tool sentence');
    t.notOk(
      /^Let me update project memory and finalize\.$/i.test(finalized[0].details.result.summary),
      'the transitional promise is not accepted as final'
    );
    t.equal((global.window.promptQueue || []).length, 0, 'repeated failures do not create an automatic continuation loop');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a real clarification pass stays pending and sends the actionable question to the phone', async t => {
  const originalFetch = global.fetch;
  const finalized = [];
  const notifications = [];
  installHarness([
    [{
      functionCall: {
        name: 'ask_clarifying_questions',
        args: {
          intro: 'One decision before I continue:',
          questions: [{
            header: 'Delivery',
            question: 'Should I notify both paired phones?',
            options: [
              { label: 'Both phones', description: 'Notify every paired phone.', recommended: true },
              { label: 'This phone', description: 'Notify only the current phone.' }
            ]
          }]
        }
      }
    }]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI',
    api: {
      notifyPhone: async (title, body, context) => {
        notifications.push({ title, body, context });
        return { success: true, phone: { success: true, sent: 1 } };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: 'exec-clarification-notification' } },
        prompt: 'Resolve notification delivery behavior.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskCheckpointed: async () => {}
    }
  });
  const conv = conversation('clarification-notification-task', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI',
    planApproved: true
  });
  try {
    await global.window.runAgentLoop(
      'Resolve notification delivery behavior.',
      'gemini-1',
      conv,
      { taskId: 'task-clarification-notification' }
    );

    t.equal(finalized.length, 1, 'the execution pass records one durable transition');
    t.equal(finalized[0].status, 'pending', 'the mission remains pending while waiting for an answer');
    t.equal(finalized[0].details.reasonCode, 'awaiting_clarification', 'the actionable reason stays structured');
    t.equal(notifications.length, 1, 'the actionable pending state emits one phone notification');
    t.match(notifications[0].body, /Should I notify both paired phones\?/, 'the real question reaches the phone');
    t.notOk(/completed/i.test(notifications[0].body), 'the checkpoint is never presented as completion');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop preserves open and mergeable PR status without claiming merged', async t => {
  const originalFetch = global.fetch;
  installHarness([
    [{ text: 'PR #9 has now been merged and is synchronized.' }],
    [{ text: 'PR #9 remains open, clean, synchronized, and mergeable. It has not been merged.' }]
  ]);
  const conv = conversation('pr-status');
  try {
    await global.window.runAgentLoop('PR #9 is open, clean, synchronized, and mergeable.', 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant').text;
    t.match(answer, /open.*mergeable/i, 'open and mergeable are retained');
    t.match(answer, /not been merged/i, 'merged is explicitly denied');
    t.notOk(/PR #9 has now been merged/i.test(answer), 'the temporal false terminal status is removed');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Coder loop lets verified test-tool evidence supersede an earlier reported result', async t => {
  const originalFetch = global.fetch;
  installHarness([
    [{ functionCall: { name: 'run_tests', args: {} } }],
    [{ text: 'I just went ahead and ran npm test; it passed.' }]
  ], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI',
    window: {
      runRegressionTests: async () => ({ success: true, output: '124 tests passed' })
    }
  });
  const conv = conversation('verified-test-status', {
    mode: 'coder',
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI'
  });
  try {
    await global.window.runAgentLoop(
      'The user reports that all tests passed. Verify that result yourself.',
      'gemini-1',
      conv,
      {
        semanticIntent: {
          intent: 'new_task',
          requiresExecution: true,
          target: 'current_conversation',
          resolvedRequest: 'Run the project test suite and report the independently verified result.',
          contextDependent: false,
          confidence: 1,
          needsClarification: false,
          reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'project' },
          executionScope: 'read_only',
          inspectionTarget: 'project',
          standaloneSystemOperation: false
        }
      }
    );
    const assistantMessage = conv.messages.find(message => message.role === 'assistant');
    const answer = assistantMessage.text;
    t.match(answer, /I just went ahead and ran npm test/i, 'the verified execution claim survives');
    t.notOk(
      (assistantMessage.logs || []).some(item => /Structured-status guard/i.test(String(item && item.content || ''))),
      'no stale reported-status correction is injected after successful tool evidence'
    );
    t.equal(
      conv.messages.find(message => message.role === 'assistant').responseBasis.structuredStatuses[0].outcome,
      'verified_passing',
      'the saved response basis carries the latest verified test status'
    );
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop cancels its owned Coder task through the canonical task tool', async t => {
  const originalFetch = global.fetch;
  const cancellations = [];
  installHarness([
    [{ functionCall: { name: 'cancel_coder_task', args: { taskId: 'task-owned-1', reason: 'User asked to stop.' } } }],
    [{ text: 'Task task-owned-1 completed successfully.' }],
    [{ text: 'Task task-owned-1 is cancelled. It will not be reported as completed.' }]
  ], {
    window: {
      cancelOwnedOrchestrationTask: async (taskId, requesterConversationId, reason) => {
        cancellations.push({ taskId, requesterConversationId, reason });
        return {
          success: true,
          stopped: true,
          task: { taskId, title: 'Owned Coder task', status: 'cancelled' }
        };
      }
    }
  });
  const conv = conversation('dispatch-owner', {
    launchedCoderTaskId: 'task-owned-1',
    lastOwnedTaskId: 'task-owned-1'
  });
  try {
    await global.window.runAgentLoop('Cancel the Coder task I launched.', 'gemini-1', conv, {
      semanticIntent: {
        intent: 'cancel_active_task',
        requiresExecution: true,
        target: 'active_owned_task',
        resolvedRequest: 'Cancel task task-owned-1.',
        contextDependent: true,
        confidence: 1,
        needsClarification: false,
        reasoningPolicyHint: { complexity: 'low', risk: 'medium', contextNeed: 'task' },
        executionScope: 'mutating',
        inspectionTarget: 'none',
        standaloneSystemOperation: false
      }
    });
    t.equal(cancellations.length, 1, 'the canonical cancellation path is called once');
    t.equal(cancellations[0].requesterConversationId, conv.id, 'authority is scoped to the owning Dispatch conversation');
    t.match(conv.messages.find(message => message.role === 'assistant').text, /cancelled/i, 'the final response uses the explicit cancelled state');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Dispatch loop resolves a named project from the Projects search root before answering', async t => {
  const originalFetch = global.fetch;
  const gritlifePath = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  installHarness([
    [{ text: `GRITLIFE is attached to the exact project workspace ${gritlifePath}.` }]
  ], {
    projects: [gritlifePath],
    semanticClassification: {
      intent: 'status_check',
      target: 'current_conversation',
      resolvedRequest: 'Resolve the GRITLIFE workspace and report the selected path.',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'project' },
      inspectionTarget: 'project'
    }
  });
  const conv = conversation('workspace-resolution');
  try {
    await global.window.runAgentLoop('Open the GRITLIFE project context and tell me what workspace you selected.', 'gemini-1', conv);
    t.equal(conv.workspace, gritlifePath, 'conversation binds the exact project path');
    t.equal(conv.dispatchProjectPath, gritlifePath, 'Dispatch project binding is persisted separately from the search root');
    t.equal(global.window.changedWorkspace, gritlifePath, 'a real workspace change was requested');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a scheduled worker result is flushed into its visible conversation before notification', async t => {
  const originalFetch = global.fetch;
  const notifications = [];
  const flushedConversationIds = [];
  const worker = conversation('scheduled-operator-worker', { mode: 'operator' });
  const visible = conversation('scheduled-dispatch-origin', { mode: 'orion' });
  global.conversations = [worker, visible];
  installHarness([[{ text: 'The current weather is 78Â°F with rain arriving this evening.' }]], {
    api: {
      notifyPhone: async (title, body, context) => {
        notifications.push({ title, body, context });
        return { success: true, phone: { success: true, sent: 1 } };
      }
    },
    window: {
      flushConversationsToStorage: async conversationId => {
        flushedConversationIds.push(conversationId);
        return { success: true };
      }
    }
  });
  try {
    await global.window.runAgentLoop(
      'Give the user a weather update now.',
      'gemini-1',
      worker,
      {
        source: 'followup',
        internalPrompt: true,
        scheduleId: 'schedule-weather-1',
        scheduleDeliveryConversationId: visible.id
      }
    );
    const delivered = visible.messages.find(message =>
      message.source === 'scheduled-delivery' && message.scheduleId === 'schedule-weather-1'
    );
    t.ok(delivered, 'the visible conversation receives a durable scheduled-delivery message');
    t.match(delivered.text, /78Â°F/, 'the actual scheduled result is preserved, not just an alarm label');
    t.ok(flushedConversationIds.includes(visible.id), 'the visible transcript is flushed before the run finishes');
    t.equal(notifications.length, 1, 'the scheduled result emits one terminal notification');
    t.equal(notifications[0].context.conversationId, visible.id, 'the push deep-links to the visible conversation');
  } finally {
    delete global.conversations;
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a task-owned schedule resumes the same durable task instead of creating a new mission', async t => {
  const specialist = conversation('scheduled-source-coder', { mode: 'coder' });
  global.conversations = [specialist];
  const enqueued = [];
  const runs = [];
  installHarness([], {
    api: {
      getOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          status: 'pending',
          target: { conversationId: specialist.id, mode: 'coder' }
        }
      })
    },
    window: {
      enqueueOrchestrationTask: async input => {
        enqueued.push(input);
        return { success: false, error: 'must not enqueue' };
      }
    }
  });
  global.window.runAgentLoop = async (prompt, model, conv, options) => {
    runs.push({ prompt, model, conv, options });
  };
  const result = await global.window.runDurableSchedule({
    scheduleId: 'schedule-source-task',
    sourceTaskId: 'task-source-123',
    conversationId: specialist.id,
    deliveryConversationId: 'dispatch-owner',
    prompt: 'Check the running tests, then commit and push if they pass.',
    purpose: 'test-progress',
    modelSelectValue: 'gemini-1'
  });
  t.equal(result.ran, true, 'the scheduled continuation runs');
  t.equal(result.taskId, 'task-source-123', 'the same source task identity is returned');
  t.equal(enqueued.length, 0, 'no unrelated task is created');
  t.equal(runs.length, 1, 'one continuation pass starts');
  t.equal(runs[0].options.taskId, 'task-source-123', 'the agent loop claims the original task');
  t.equal(runs[0].options.scheduleId, 'schedule-source-task', 'the schedule remains correlated');
  delete global.conversations;
  t.end();
});

test('a fired task schedule cannot resurrect a cancelled task', async t => {
  const specialist = conversation('cancelled-source-coder', { mode: 'coder' });
  global.conversations = [specialist];
  let runCount = 0;
  installHarness([], {
    api: {
      getOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'cancelled', target: { conversationId: specialist.id, mode: 'coder' } }
      })
    }
  });
  global.window.runAgentLoop = async () => { runCount++; };
  const result = await global.window.runDurableSchedule({
    scheduleId: 'schedule-cancelled-task',
    sourceTaskId: 'task-cancelled',
    conversationId: specialist.id,
    prompt: 'Resume cancelled work.'
  });
  t.equal(result.skipped, true, 'the stale trigger is consumed without execution');
  t.equal(result.reason, 'source_task_cancelled', 'the canonical terminal state explains the skip');
  t.equal(runCount, 0, 'cancelled work never restarts');
  delete global.conversations;
  t.end();
});

test('a delivery-only reminder fires in Dispatch without creating specialist work', async t => {
  const originalFetch = global.fetch;
  const queuedTasks = [];
  const visible = conversation('scheduled-reminder-dispatch', { mode: 'orion' });
  global.conversations = [visible];
  installHarness([[{ text: 'It is 2:00 PM — time to start OpenAI.' }]], {
    window: {
      enqueueOrchestrationTask: async input => {
        queuedTasks.push(input);
        return { success: false, error: 'must not enqueue' };
      }
    }
  });
  try {
    const result = await global.window.runDurableSchedule({
      scheduleId: 'schedule-reminder-1',
      conversationId: visible.id,
      deliveryConversationId: visible.id,
      prompt: 'Tell Jason it is 2:00 PM and time to start OpenAI. Do not launch the application.',
      purpose: 'start-openai-reminder',
      title: 'Reminder to start OpenAI',
      modelSelectValue: 'gemini-1',
      deliveryOnly: true
    });
    t.equal(result && result.ran, true, 'the reminder runs through the normal conversation loop');
    t.equal(queuedTasks.length, 0, 'it does not create Coder or Operator work when it fires');
    const answer = visible.messages.find(message =>
      message.role === 'assistant' && /time to start OpenAI/i.test(message.text || '')
    );
    t.ok(answer, 'the reminder is saved as a real assistant response in the owning conversation');
  } finally {
    delete global.conversations;
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a delegated specialist completion notification opens the owning Dispatch conversation', async t => {
  const originalFetch = global.fetch;
  const notifications = [];
  const dispatchConversationId = 'delegated-notification-dispatch';
  const specialist = conversation('delegated-notification-coder', { mode: 'coder' });
  installHarness([[{ text: 'The requested documentation file is complete.' }]], {
    api: {
      notifyPhone: async (title, body, context) => {
        notifications.push({ title, body, context });
        return { success: true, phone: { success: true, sent: 1 } };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          status: 'active',
          execution: { executionId: 'delegated-notification-execution' },
          origin: { conversationId: dispatchConversationId }
        },
        prompt: 'Create the requested documentation file.'
      }),
      finalizeOrchestrationTask: async (taskId, status) => ({
        taskId,
        status,
        origin: { conversationId: dispatchConversationId }
      }),
      onOrchestrationTaskFinalized: async () => {}
    }
  });
  try {
    await global.window.runAgentLoop(
      'Create the requested documentation file.',
      'gemini-1',
      specialist,
      { taskId: 'task-delegated-notification' }
    );
    t.equal(notifications.length, 1, 'the specialist emits exactly one terminal push');
    t.equal(
      notifications[0].context.conversationId,
      dispatchConversationId,
      'the notification opens the Dispatch conversation that owns the task'
    );
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('a delegated child completion resumes its parent without sending an intermediate push', async t => {
  const originalFetch = global.fetch;
  const notifications = [];
  const finalizedCallbacks = [];
  const specialist = conversation('nested-notification-coder', { mode: 'coder' });
  installHarness([[{ text: 'The child operation completed successfully.' }]], {
    api: {
      notifyPhone: async (title, body, context) => {
        notifications.push({ title, body, context });
        return { success: true, phone: { success: true, sent: 1 } };
      }
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: {
          taskId,
          parentTaskId: 'task-visible-parent',
          rootOriginConversationId: 'dispatch-visible-owner',
          status: 'active',
          execution: { executionId: 'nested-child-execution' },
          origin: { conversationId: 'coder-parent' },
          target: { conversationId: specialist.id, mode: 'coder' }
        },
        prompt: 'Complete the delegated child operation.'
      }),
      finalizeOrchestrationTask: async (taskId, status) => ({
        taskId,
        parentTaskId: 'task-visible-parent',
        rootOriginConversationId: 'dispatch-visible-owner',
        status,
        origin: { conversationId: 'coder-parent' },
        target: { conversationId: specialist.id, mode: 'coder' }
      }),
      onOrchestrationTaskFinalized: async (...args) => finalizedCallbacks.push(args)
    }
  });
  try {
    await global.window.runAgentLoop(
      'Complete the delegated child operation.',
      'gemini-1',
      specialist,
      { taskId: 'task-nested-child' }
    );
    t.equal(finalizedCallbacks.length, 1, 'the renderer receives the child finalization for parent reconciliation');
    t.equal(notifications.length, 0, 'the child cannot race the final Dispatch result with an intermediate notification');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

// ── Scheduled continuations keep the durable mission alive ────────────────────
// The bug these cover: a specialist could start a long-running process, schedule a follow-up to
// check it, and end the execution pass. The finalizer did not consult the durable schedule store,
// so the pass fell through to "no continuation remains" and persisted the task as COMPLETED --
// which Dispatch then correctly relayed as "Coder completed ...", contradicting the specialist's
// own checkpoint. A specialist run ending is not the mission ending.

function scheduleStoreStub(schedules) {
  const listed = [];
  const cancelled = [];
  return {
    listed,
    cancelled,
    api: {
      listSchedules: async (filters = {}) => {
        listed.push(filters);
        const sourceTaskId = String(filters.sourceTaskId || '');
        return {
          success: true,
          schedules: schedules
            .filter(item => !sourceTaskId || item.sourceTaskId === sourceTaskId)
            .map(item => ({ ...item }))
        };
      },
      cancelTaskSchedules: async sourceTaskId => {
        cancelled.push(sourceTaskId);
        return { success: true, cancelled: 1, scheduleIds: schedules.map(item => item.scheduleId) };
      }
    }
  };
}

function ownedSchedule(sourceTaskId, overrides = {}) {
  return {
    scheduleId: 'schedule-suite-check',
    sourceTaskId,
    conversationId: 'ignored-by-the-finalizer',
    dueAt: 1700000120000,
    purpose: 'test-progress',
    prompt: 'Check the regression suite, then commit and push if it passed.',
    status: 'pending',
    ...overrides
  };
}

// One pass that does real work and then stops talking, which is exactly the shape that used to
// be misread as completion.
const PROGRESS_THEN_STOP = [
  [{ text: 'Starting the regression suite now.' }, { functionCall: { name: 'read_file', args: { path: 'status.txt' } } }],
  [{ text: '## Work Walkthrough\n\n**Result:** The regression suite is running and green so far.' }]
];

async function runTrackedPass(t, options = {}) {
  const finalized = [];
  const checkpointed = [];
  const terminalRelays = [];
  const runFinalizations = [];
  const store = scheduleStoreStub(options.schedules || []);
  installHarness(PROGRESS_THEN_STOP, {
    workspace: 'C:\\Users\\Owner',
    api: {
      readFile: async () => 'suite: running',
      ...store.api
    },
    window: {
      claimOrchestrationTask: async taskId => ({
        success: true,
        task: { taskId, status: 'active', execution: { executionId: options.executionId || 'exec-scheduled-pass' } },
        prompt: 'Run the regression suite and push once it passes.'
      }),
      finalizeOrchestrationTask: async (taskId, status, details) => {
        finalized.push({ taskId, status, details });
        return { taskId, status };
      },
      onOrchestrationTaskFinalized: async (taskId, conversationId, status) => {
        terminalRelays.push({ taskId, conversationId, status });
      },
      onOrchestrationTaskCheckpointed: async (taskId, conversationId, details) => {
        checkpointed.push({ taskId, conversationId, details });
      },
      onAgentRunFinalized: async (conversationId, status, details) => {
        runFinalizations.push({ conversationId, status, details });
      }
    }
  });
  const conv = conversation(options.conversationId || 'coder-scheduled-pass', {
    mode: options.mode || 'coder',
    workspace: 'C:\\Users\\Owner'
  });
  await global.window.runAgentLoop(
    'Run the regression suite and push once it passes.',
    'gemini-1',
    conv,
    { taskId: options.taskId || 'task-scheduled-pass', ...(options.runOptions || {}) }
  );
  return { finalized, checkpointed, terminalRelays, runFinalizations, store, conv };
}

test('a pass that scheduled a task-owned follow-up persists as pending, never completed', async t => {
  const originalFetch = global.fetch;
  try {
    const taskId = 'task-scheduled-pass';
    const run = await runTrackedPass(t, { schedules: [ownedSchedule(taskId)] });

    t.equal(run.finalized.length, 1, 'the execution pass records exactly one durable transition');
    t.equal(run.finalized[0].taskId, taskId, 'the original mission identity is preserved');
    t.equal(run.finalized[0].status, 'pending',
      'an outstanding task-owned schedule keeps the durable task nonterminal');
    t.notEqual(run.finalized[0].status, 'completed',
      'the pass ending is not treated as the mission ending');

    const details = run.finalized[0].details;
    t.equal(details.reasonCode, 'scheduled_followup', 'the pending reason is structured, not prose');
    t.equal(details.resumePolicy, 'scheduled', 'the clock owns resumption');
    t.equal(details.notificationKind, 'checkpoint', 'the pass publishes a checkpoint, not a terminal result');
    t.equal(details.pendingWork, true, 'the schedule counts as durable pending work');
    t.equal(details.schedule.scheduleId, 'schedule-suite-check',
      'the schedule keeping the task alive is recorded by identity');
    t.equal(details.schedule.sourceTaskId, taskId, 'the schedule is bound to this task');
    t.equal(details.schedule.dueAt, 1700000120000, 'the due time is retained for presentation and cancellation');
    t.equal(details.continuation.kind, 'scheduled', 'the continuation is typed as scheduled');
    t.equal(details.continuation.messageId, 'schedule-suite-check',
      'the continuation names the schedule that will deliver it');
    t.match(details.continuation.input, /commit and push/i,
      'the resumed pass will receive the remaining work, not a blank restart');

    // The store is consulted by task identity, not by conversation or by parsing the transcript.
    t.ok(run.store.listed.length >= 1, 'the durable schedule store is actually consulted');
    t.equal(run.store.listed[0].sourceTaskId, taskId, 'schedules are looked up by owning task');
    t.deepEqual(run.store.listed[0].status, ['pending', 'firing'],
      'only live schedules can hold a task open');
    t.end();
  } finally {
    restoreGlobals(originalFetch);
  }
});

test('a pending scheduled pass reports a checkpoint to Dispatch and never a terminal completion', async t => {
  const originalFetch = global.fetch;
  try {
    const taskId = 'task-scheduled-pass';
    const run = await runTrackedPass(t, { schedules: [ownedSchedule(taskId)] });

    t.equal(run.terminalRelays.length, 0,
      'the terminal relay stays terminal-only, so Dispatch cannot say the specialist completed');
    t.equal(run.checkpointed.length, 1, 'the separate checkpoint relay fires exactly once');
    t.equal(run.checkpointed[0].taskId, taskId, 'the checkpoint names the same durable task');
    t.equal(run.checkpointed[0].details.disposition.reasonCode, 'scheduled_followup',
      'the checkpoint carries the structured reason');
    t.equal(run.checkpointed[0].details.disposition.schedule.scheduleId, 'schedule-suite-check',
      'the checkpoint carries the owning schedule');
    t.ok(run.checkpointed[0].details.result, 'the checkpoint carries the pass evidence');

    t.equal(run.store.cancelled.length, 0,
      'a live continuation is not cancelled while the task is still pending');

    t.equal(run.runFinalizations.length, 1, 'the UI receives one end-of-pass update');
    t.equal(run.runFinalizations[0].status, 'pending', 'the UI is told the task is still pending');
    t.equal(run.runFinalizations[0].details.reasonCode, 'scheduled_followup',
      'the UI receives the same reason the durable task recorded');
    t.equal(run.runFinalizations[0].details.resumePolicy, 'scheduled',
      'desktop and phone presentation read the same resume policy as the task store');
    t.equal(run.runFinalizations[0].details.schedule.scheduleId, 'schedule-suite-check',
      'the UI can show when the next check happens');
    t.end();
  } finally {
    restoreGlobals(originalFetch);
  }
});

test('the scheduled-continuation lifecycle is generic across specialist roles', async t => {
  const originalFetch = global.fetch;
  try {
    for (const mode of ['coder', 'operator', 'researcher']) {
      const taskId = 'task-scheduled-' + mode;
      const run = await runTrackedPass(t, {
        mode,
        taskId,
        conversationId: mode + '-scheduled-pass',
        executionId: 'exec-scheduled-' + mode,
        schedules: [ownedSchedule(taskId)]
      });
      t.equal(run.finalized[0].status, 'pending', mode + ' keeps its durable task nonterminal');
      t.equal(run.finalized[0].details.reasonCode, 'scheduled_followup',
        mode + ' records the same structured reason');
      t.equal(run.terminalRelays.length, 0, mode + ' does not emit a terminal completion');
      t.equal(run.checkpointed.length, 1, mode + ' emits a checkpoint instead');
    }
    t.end();
  } finally {
    restoreGlobals(originalFetch);
  }
});

test('with no task-owned schedule outstanding the same pass completes and releases the task', async t => {
  const originalFetch = global.fetch;
  try {
    const run = await runTrackedPass(t, { schedules: [] });
    t.equal(run.finalized[0].status, 'completed',
      'a finished pass with nothing outstanding still reaches real completion');
    t.equal(run.finalized[0].details.notificationKind, 'terminal', 'and publishes a terminal result');
    t.equal(run.checkpointed.length, 0, 'no checkpoint is emitted for a finished mission');
    t.equal(run.terminalRelays.length, 1, 'Dispatch receives exactly one terminal completion');
    t.equal(run.terminalRelays[0].status, 'completed', 'and it reports the canonical durable state');
    t.deepEqual(run.store.cancelled, ['task-scheduled-pass'],
      'terminal work cancels any task-owned continuation so it cannot wake the task again');
    t.end();
  } finally {
    restoreGlobals(originalFetch);
  }
});

test('the schedule that woke a pass cannot hold that same pass open forever', async t => {
  const originalFetch = global.fetch;
  try {
    const taskId = 'task-scheduled-pass';
    // The firing schedule is still live in the store while the run it woke is executing. If it
    // counted as an outstanding continuation, a scheduled resume could never complete its task.
    const run = await runTrackedPass(t, {
      schedules: [ownedSchedule(taskId, { scheduleId: 'schedule-that-woke-us', status: 'firing' })],
      runOptions: { scheduleId: 'schedule-that-woke-us' }
    });
    t.equal(run.finalized[0].status, 'completed',
      'the resumed pass finishes the mission instead of rescheduling itself indefinitely');
    t.equal(run.terminalRelays.length, 1, 'Dispatch receives the one true completion');
    t.end();
  } finally {
    restoreGlobals(originalFetch);
  }
});

// Real bug: "Can you look at some of the past runs to see how you were able to get the balance?"
// had no deterministic tool for Orion's own execution history - window.api.listOrchestrationTasks
// already existed for the UI, but agent.js never called it, so the model fell back to inspecting
// whatever project was active and persisted mistaken remember_file_notes there. These tests exercise
// the new search_orion_task_history tool directly through the real executeTool dispatch, proving it
// reads the durable task store (not the workspace) and never touches file-inspection or
// file-knowledge APIs.
test('search_orion_task_history finds a matching prior run by keyword and role, ignoring unrelated tasks', async t => {
  const originalFetch = global.fetch;
  const listCalls = [];
  const fileToolCalls = [];
  installHarness([], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\Bot-GPT',
    api: {
      listOrchestrationTasks: async filters => {
        listCalls.push(filters);
        return {
          success: true,
          tasks: [
            {
              taskId: 'task-deepseek-1',
              title: 'Check DeepSeek balance',
              objective: 'Check the user\'s DeepSeek account balance and report it.',
              originalUserMessage: 'What is my DeepSeek balance?',
              status: 'completed',
              target: { mode: 'operator' },
              selectedProject: { name: '' },
              createdAt: 1000,
              updatedAt: 1010,
              result: { summary: 'Opened the DeepSeek dashboard in the browser and read the balance: $12.40.' }
            },
            {
              taskId: 'task-unrelated-1',
              title: 'Fix Bot-GPT login bug',
              objective: 'Fix the login redirect bug in Bot-GPT.',
              originalUserMessage: 'Fix the login bug.',
              status: 'completed',
              target: { mode: 'coder' },
              selectedProject: { name: 'Bot-GPT' },
              createdAt: 900,
              updatedAt: 950,
              result: { summary: 'Fixed the redirect in app.py.' }
            }
          ]
        };
      },
      listFiles: async () => { fileToolCalls.push('listFiles'); return []; },
      readFile: async () => { fileToolCalls.push('readFile'); return ''; },
      saveFileDigest: async () => { fileToolCalls.push('saveFileDigest'); return { success: true }; }
    }
  });
  try {
    const conv = conversation('dispatch-task-history-search');
    const result = await agent.executeTool(
      'search_orion_task_history',
      { query: 'DeepSeek balance', role: 'operator' },
      'C:\\Users\\Owner\\Desktop\\Projects\\Bot-GPT',
      {},
      conv
    );
    t.equal(listCalls.length, 1, 'the durable orchestration task store is queried');
    t.equal(result.success, true, 'the search succeeds');
    t.equal(result.matchedCount, 1, 'only the DeepSeek-balance task matches the query and role filter');
    t.equal(result.tasks[0].taskId, 'task-deepseek-1', 'the matched task is the real prior DeepSeek balance run');
    t.equal(result.tasks[0].role, 'operator', 'the executing specialist role is reported');
    t.match(result.tasks[0].resultSummary, /\$12\.40/, 'the recorded result is surfaced as real evidence');
    t.equal(result.tasks.some(task => task.taskId === 'task-unrelated-1'), false,
      'the unrelated Bot-GPT task is excluded by the query filter');
    t.deepEqual(fileToolCalls, [], 'no file-inspection or file-knowledge tool is ever touched by this tool - it only reads the task store');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('search_orion_task_history reports no match honestly instead of implying the active project is the answer', async t => {
  const originalFetch = global.fetch;
  installHarness([], {
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\Bot-GPT',
    api: {
      listOrchestrationTasks: async () => ({ success: true, tasks: [] })
    }
  });
  try {
    const conv = conversation('dispatch-task-history-empty');
    const result = await agent.executeTool(
      'search_orion_task_history',
      { query: 'DeepSeek balance' },
      'C:\\Users\\Owner\\Desktop\\Projects\\Bot-GPT',
      {},
      conv
    );
    t.equal(result.success, true, 'an empty history is a legitimate finding, not a tool failure');
    t.equal(result.matchedCount, 0, 'no prior run matched');
    t.match(result.note, /do not fall back to inspecting the active project/i,
      'the tool itself tells the model not to silently substitute the active workspace when history has no answer');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});
