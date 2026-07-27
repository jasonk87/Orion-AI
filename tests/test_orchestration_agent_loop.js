process.env.NODE_ENV = 'test';
const test = require('tape');

global.window = {};
const agent = require('../agent.js');
const runAgentLoop = global.window.runAgentLoop;
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
    if (serialized.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return geminiResponse([{ text: '{"mode":"direct","reason":"test"}' }]);
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

test('Dispatch loop ignores a quoted executable request inside a pushed-fix status report', async t => {
  const originalFetch = global.fetch;
  const handoffs = [];
  const prompt = 'The exact request:\n> Can you kill Claude and restart it again?\nis now covered by tests and the fix was pushed.';
  installHarness([
    [{ text: 'I am passing that request to Coder now.' }],
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

test('a direct executable request preflights once and preserves durable handoff provenance', async t => {
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
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-one-handoff',
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
      conv
    );
    t.equal(handoffs.length, 1, 'the genuine handoff creates exactly one durable Coder task');
    t.match(handoffs[0].prompt, /identify the intended local target/i, 'the deterministic packet requires safe target identification');
    t.match(handoffs[0].prompt, /verify the result/i, 'the deterministic packet requires verification');
    t.equal(handoffs[0].originalUserMessage, 'Can you kill Claude and restart it again?', 'the exact raw user utterance is retained separately from the expanded handoff prompt');
  } finally {
    restoreGlobals(originalFetch);
  }
  t.end();
});

test('Projects-root Claude restart creates one standalone Coder handoff with raw provenance', async t => {
  const originalFetch = global.fetch;
  const projectsRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const rawRequest = 'Can you kill Claude and restart it again?';
  const handoffs = [];
  installHarness([
    [{ text: "I can't control local processes from Dispatch. You'll need to restart Claude manually." }],
    [{ text: 'Coder has the standalone process task and will verify the replacement.' }]
  ], {
    workspace: projectsRoot,
    window: {
      promoteWorkspaceToCoder: async payload => {
        handoffs.push(payload);
        return {
          success: true,
          conversationId: 'coder-standalone-claude',
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
    await global.window.runAgentLoop(rawRequest, 'gemini-1', conv);
    t.equal(handoffs.length, 1, 'the direct process request creates exactly one handoff');
    t.equal(handoffs[0].path, projectsRoot, 'the generic Projects directory is retained only as the standalone execution workspace');
    t.equal(handoffs[0].standalone, true, 'the handoff is explicitly marked standalone rather than pretending Projects is the selected project');
    t.equal(handoffs[0].originalUserMessage, rawRequest, 'the exact latest utterance is carried as provenance');
    t.notEqual(handoffs[0].prompt, rawRequest, 'the resolved execution prompt may be expanded independently');
    t.ok(handoffs[0].prompt.includes(rawRequest), 'the expanded prompt still preserves the requested operation');
    t.match(handoffs[0].prompt, /identify the intended local target/i, 'Coder must identify the correct local process');
    t.match(handoffs[0].prompt, /verify the result/i, 'Coder must verify the replacement process');
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
    await global.window.runAgentLoop('Run npm test for the project.', 'gemini-1', conv);
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
    await global.window.runAgentLoop(prompt, 'gemini-1', conv);
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
    api: {
      searchConversationEvidence: async () => ({ success: true, evidence: [], queryTerms: ['intent'] })
    }
  });
  const conv = conversation('recall-failure');
  try {
    await global.window.runAgentLoop('Do you remember our earlier conversation about the intent system?', 'gemini-1', conv);
    const answer = conv.messages.find(message => message.role === 'assistant');
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
  let approvalClassifierRequest = '';
  const taskStates = new Map([
    ['task-plan-to-deny', 'pending'],
    ['task-unrelated', 'pending']
  ]);
  const finalized = [];
  installHarness([
    body => {
      approvalClassifierRequest = JSON.stringify(body);
      return [{ text: '{"intent":"deny","reason":"The user explicitly rejected the pending plan."}' }];
    }
  ], {
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
        source: 'user'
      }
    );

    t.match(approvalClassifierRequest, /No, cancel this plan/, 'the classifier receives the live denial reply');
    t.notOk(/Execute the original implementation objective now/.test(approvalClassifierRequest), 'the claimed task prompt does not overwrite the denial');
    t.notOk(/GRITLIFE|approved data model/.test(approvalClassifierRequest), 'canonical execution context is not mixed into denial classification');
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
        source: 'user'
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
    contextPacketIds: ['packet-1']
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
  const conv = conversation('auto-continue-origin');
  try {
    await global.window.runAgentLoop(
      'Execute both milestones.',
      'gemini-1',
      conv,
      { taskId: 'task-auto-continue' }
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
      conv
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
    await global.window.runAgentLoop('Cancel the Coder task I launched.', 'gemini-1', conv);
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
  ], { projects: [gritlifePath] });
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
