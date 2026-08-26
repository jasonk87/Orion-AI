'use strict';

const test = require('tape');
const router = require('../semantic-intent-router');
const structureApi = require('../dispatch-intent');

function classification(intent, overrides = {}) {
  return {
    intent,
    requiresExecution: ['new_task', 'steer_active_task', 'cancel_active_task', 'approve_plan', 'deny_plan', 'revise_plan'].includes(intent),
    target: 'current_conversation',
    resolvedRequest: '',
    contextDependent: false,
    confidence: 0.96,
    needsClarification: false,
    clarificationQuestion: '',
    reasoningPolicyHint: {
      complexity: 'low',
      risk: 'low',
      contextNeed: 'none'
    },
    memoryIntent: 'none',
    memoryContext: { needed: false, query: '', confidence: 0 },
    taskResolution: {
      title: '',
      requirements: [],
      constraints: [],
      unresolvedDecisions: []
    },
    executionScope: 'none',
    executionTarget: 'none',
    executionSurface: 'none',
    inspectionTarget: 'none',
    inspectionBreadth: 'none',
    standaloneSystemOperation: false,
    ...overrides
  };
}

function baseContext(message, overrides = {}) {
  return {
    userMessage: message,
    conversationId: 'dispatch-1',
    mode: 'orion',
    workspace: {
      role: 'active_project',
      path: 'C:\\Projects\\OrionAI',
      project: { name: 'OrionAI', path: 'C:\\Projects\\OrionAI' }
    },
    recentVisibleConversation: [
      { id: 'm1', role: 'user', text: 'Please update the approval handling.', createdAt: 1 },
      { id: 'm2', role: 'assistant', text: 'I can cover stale approval actions too.', createdAt: 2 }
    ],
    ...overrides
  };
}

test('classifier resolves a durable-memory dependency without inventing the fact value', async t => {
  const result = await router.classify(baseContext("What's the weather today?", {
    recentVisibleConversation: []
  }), {
    structureApi,
    classify: async () => classification('conversation', {
      target: 'current_conversation',
      resolvedRequest: "Answer the user's weather question using their known home location if available.",
      memoryContext: {
        needed: true,
        query: 'user home location',
        confidence: 0.98
      }
    })
  });

  t.deepEqual(result.memoryContext, {
    needed: true,
    query: 'user home location',
    confidence: 0.98
  }, 'the normalized contract carries a semantic retrieval need, not a guessed location');
  t.equal(result.requiresExecution, false, 'requesting memory context does not authorize execution');
  t.end();
});

test('classifier disables malformed or empty durable-memory requests safely', t => {
  const input = router.buildInput(baseContext('Hello'), structureApi);
  const result = router.normalizeClassification(classification('conversation', {
    memoryContext: { needed: true, query: '', confidence: 4 }
  }), input);

  t.deepEqual(result.memoryContext, {
    needed: false,
    query: '',
    confidence: 1
  }, 'an empty retrieval concept cannot enable a memory lookup');
  t.end();
});

test('shared classifier receives the exact turn and all task-bound context', async t => {
  let seen;
  const activeOwnedTask = {
    taskId: 'task-1',
    title: 'Approval handling',
    objective: 'Update approval handling and reject stale actions.',
    status: 'active',
    origin: { conversationId: 'dispatch-1' },
    target: { conversationId: 'coder-1', mode: 'coder' }
  };
  const pendingPlan = {
    planId: 'plan-1',
    taskId: 'task-1',
    ownerConversationId: 'dispatch-1',
    coderConversationId: 'coder-1',
    status: 'pending'
  };
  const result = await router.classify(baseContext('While you are there, also cover stale actions.', {
    activeOwnedTask,
    pendingPlan,
    taskBound: true,
    durableTaskObjective: activeOwnedTask.objective
  }), {
    structureApi,
    classify: async request => {
      seen = request;
      return classification('steer_active_task', {
        requiresExecution: true,
        target: 'active_owned_task',
        resolvedRequest: 'Also cover stale approval actions in the active approval-handling task.',
        contextDependent: true,
        reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'task' },
        executionScope: 'mutating'
      });
    }
  });

  t.equal(seen.input.userMessage, 'While you are there, also cover stale actions.', 'the exact current turn is supplied');
  t.equal(seen.input.conversation.id, 'dispatch-1', 'conversation identity is supplied');
  t.equal(seen.input.conversation.mode, 'orion', 'conversation mode is supplied');
  t.equal(seen.input.conversation.workspace.path, 'C:\\Projects\\OrionAI', 'workspace binding is supplied');
  t.equal(seen.input.pendingPlan.planId, 'plan-1', 'pending plan identity is supplied');
  t.equal(seen.input.activeOwnedTask.taskId, 'task-1', 'owned task identity is supplied');
  t.equal(seen.input.activeOwnedTask.targetMode, 'coder', 'the owned task specialist is supplied');
  t.equal(seen.input.taskBound, true, 'task-bound state is explicit');
  t.equal(seen.input.durableTaskObjective, activeOwnedTask.objective, 'the durable objective is supplied');
  t.equal(seen.phase, 'intent_classification', 'the call is marked as a narrow classification phase');
  t.equal(seen.responseFormat, 'json', 'strict structured output is requested');
  t.ok(seen.prompt.includes('memoryContext'), 'the shared contract asks for semantic durable-memory dependencies');
  t.equal(result.intent, 'steer_active_task', 'the structured result is retained');
  t.equal(result.target, 'active_owned_task', 'the semantic target is retained without choosing a task ID');
  t.equal(result.executionTarget, 'coder', 'steering preserves the durable task specialist');
  t.end();
});

test('semantic contract covers conversational, status, execution, steering, cancellation, and plan paraphrases', async t => {
  const cases = [
    ["What's up?", classification('conversation')],
    ['How is Coder doing?', classification('status_check', {
      target: 'active_owned_task',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'task' }
    })],
    ['Please update the approval handling.', classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Update the approval handling.',
      executionScope: 'mutating',
      reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'project' }
    })],
    ['While you are there, also cover stale actions.', classification('steer_active_task', {
      requiresExecution: true,
      target: 'active_owned_task',
      resolvedRequest: 'Also cover stale actions in the active task.',
      contextDependent: true,
      executionScope: 'mutating',
      reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'task' }
    })],
    ['Please stop the work I launched.', classification('cancel_active_task', {
      requiresExecution: true,
      target: 'active_owned_task',
      resolvedRequest: 'Cancel the active owned task.',
      contextDependent: true
    })],
    ['Yes, start that plan.', classification('approve_plan', {
      requiresExecution: true,
      target: 'pending_plan',
      resolvedRequest: 'Approve the pending plan.',
      contextDependent: true
    })],
    ['No, do not run that plan.', classification('deny_plan', {
      requiresExecution: true,
      target: 'pending_plan',
      resolvedRequest: 'Deny the pending plan.',
      contextDependent: true
    })],
    ['No, revise the plan to include reload behavior.', classification('revise_plan', {
      requiresExecution: true,
      target: 'pending_plan',
      resolvedRequest: 'Revise the pending plan to include reload behavior.',
      contextDependent: true
    })]
  ];
  const activeOwnedTask = {
    taskId: 'task-1',
    objective: 'Update approval handling.',
    status: 'active',
    originConversationId: 'dispatch-1'
  };
  const pendingPlan = {
    planId: 'plan-1',
    taskId: 'task-1',
    ownerConversationId: 'dispatch-1',
    status: 'pending'
  };

  for (const [message, expected] of cases) {
    const result = await router.classify(baseContext(message, {
      activeOwnedTask,
      pendingPlan,
      taskBound: true
    }), {
      structureApi,
      classify: async () => expected
    });
    t.equal(result.intent, expected.intent, `${message} receives the classifier's normalized semantic intent`);
    t.equal(result.target, expected.target, `${message} retains its semantic target`);
  }
  t.end();
});

test('quoted commands, transcripts, bug reports, and test output are passed as reported structure', async t => {
  const messages = [
    ['The test says `restart Claude` but that should not execute.', 'inline code'],
    [['Analyze this transcript:', 'User: restart Claude', 'Assistant: okay'].join('\n'), 'transcript'],
    [['Bug report:', 'Input: delete the database', 'Expected: no execution'].join('\n'), 'bug report'],
    [['Test case:', '> run npm test', 'The handoff count should stay zero.'].join('\n'), 'quoted test output']
  ];

  for (const [message, label] of messages) {
    let input;
    const result = await router.classify(baseContext(message), {
      structureApi,
      classify: async request => {
        input = request.input;
        return classification('conversation');
      }
    });
    t.equal(result.intent, 'conversation', `${label} remains conversational`);
    t.equal(result.requiresExecution, false, `${label} does not request execution`);
    t.ok(
      input.documentStructure.containsQuotedText
        || input.documentStructure.containsTranscript
        || input.documentStructure.containsReportedMaterial,
      `${label} carries explicit structural evidence`
    );
  }
  t.end();
});

test('context-dependent follow-ups resolve durably or fail closed', async t => {
  const resolved = await router.classify(baseContext('Go ahead.', {
    recentVisibleConversation: [
      { role: 'user', text: 'Add stale-action rejection to approval handling.' },
      { role: 'assistant', text: 'I can implement that bounded change.' }
    ]
  }), {
    structureApi,
    classify: async () => classification('context_followup', {
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: 'Implement stale-action rejection in approval handling.',
      contextDependent: true,
      executionScope: 'mutating',
      reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'recent' }
    })
  });
  t.equal(resolved.intent, 'context_followup', 'a resolvable follow-up stays a follow-up');
  t.match(resolved.resolvedRequest, /stale-action rejection/i, 'the result carries a self-contained request');

  const unresolved = await router.classify(baseContext('Go ahead.', {
    recentVisibleConversation: []
  }), {
    structureApi,
    classify: async () => classification('clarification_required', {
      target: 'current_conversation',
      contextDependent: true,
      confidence: 0.4,
      needsClarification: true,
      clarificationQuestion: 'What would you like me to go ahead with?'
    })
  });
  t.equal(unresolved.intent, 'clarification_required', 'an unresolved reference cannot become executable work');
  t.equal(unresolved.needsClarification, true, 'clarification is explicit');
  t.match(unresolved.clarificationQuestion, /go ahead with/i, 'the question targets the missing referent');
  t.end();
});

test('classifier contract treats an already resolved named project as the concrete target', async t => {
  let prompt = '';
  await router.classify(baseContext('Look through This is Life and see for yourself.', {
    workspace: {
      role: 'active_project',
      path: 'C:\\Projects\\This is Life',
      projectPath: 'C:\\Projects\\This is Life',
      projectName: 'This is Life'
    }
  }), {
    structureApi,
    classify: async request => {
      prompt = request.prompt;
      return classification('new_task', {
        requiresExecution: true,
        resolvedRequest: 'Inspect the This is Life project and report its current state.',
        executionScope: 'read_only',
        inspectionTarget: 'project',
        inspectionBreadth: 'broad',
        reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'project' }
      });
    }
  });

  t.match(prompt, /workspace as the project target already resolved/i,
    'the language contract tells the model not to relitigate a deterministic workspace binding');
  t.match(prompt, /affirmative follow-up/i,
    'the language contract prevents repeated target-choice questions after confirmation');
  t.match(prompt, /more than two files or multiple architectural surfaces/i,
    'the classifier receives a semantic breadth contract instead of a filename keyword rule');
  t.end();
});

test('memory behavior questions are structurally distinct from conversation recall', async t => {
  let classifierPrompt = '';
  const policyQuestion = await router.classify(baseContext('Do you ever save anything I tell you or only when I specifically ask?'), {
    structureApi,
    classify: async request => {
      classifierPrompt = request.prompt;
      return classification('conversation', {
        memoryIntent: 'memory_policy',
        reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
      });
    }
  });
  t.equal(policyQuestion.memoryIntent, 'memory_policy', 'the memory mechanism question keeps its semantic category');
  t.equal(policyQuestion.reasoningPolicyHint.contextNeed, 'none', 'a policy explanation cannot accidentally trigger historical retrieval');
  t.match(classifierPrompt, /memory_policy asks how Orion saves/i, 'the shared classifier contract explains the distinction');

  const recall = await router.classify(baseContext('What did we decide in our earlier conversation?'), {
    structureApi,
    classify: async () => classification('conversation', {
      memoryIntent: 'conversation_recall',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'recent' }
    })
  });
  t.equal(recall.memoryIntent, 'conversation_recall', 'a genuine recall request remains explicit');
  t.equal(recall.reasoningPolicyHint.contextNeed, 'historical', 'genuine recall deterministically requests historical evidence');
  t.end();
});

test('inspection breadth survives strict normalization', async t => {
  const broad = await router.classify(baseContext('Review the project architecture.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      executionScope: 'read_only',
      inspectionTarget: 'project',
      inspectionBreadth: 'broad'
    })
  });
  t.equal(broad.inspectionBreadth, 'broad', 'a valid broad inspection scope is retained');

  const invalid = await router.classify(baseContext('Read the main file.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      executionScope: 'read_only',
      inspectionTarget: 'project',
      inspectionBreadth: 'everything_forever'
    })
  });
  t.equal(invalid.inspectionBreadth, 'none', 'unknown breadth values fail closed');
  t.end();
});

test('executable local-system follow-up normalizes to standalone without phrase matching', async t => {
  const result = await router.classify(baseContext('Yes, do that.', {
    recentVisibleConversation: [
      { role: 'assistant', text: 'I can ask Coder to open Codex and report what it is doing.' }
    ]
  }), {
    structureApi,
    classify: async () => classification('context_followup', {
      requiresExecution: true,
      resolvedRequest: 'Open Codex and report its current visible state.',
      contextDependent: true,
      executionScope: 'read_only',
      inspectionTarget: 'local_system',
      standaloneSystemOperation: false
    })
  });

  t.equal(result.inspectionTarget, 'local_system', 'the model-selected evidence domain is preserved');
  t.equal(result.standaloneSystemOperation, true,
    'a local-system execution request does not require a redundant boolean to avoid project resolution');
  t.equal(result.executionTarget, 'operator',
    'hands-on local-system work structurally routes to Operator even when an older model omits the field');
  t.end();
});

test('specialist selection distinguishes desktop operation from code and artifact work', async t => {
  const desktop = await router.classify(baseContext('Open Codex, inspect the window, and send me a screenshot.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Open Codex, inspect its current visible state, and return a screenshot.',
      executionScope: 'read_only',
      executionTarget: 'operator',
      executionSurface: 'desktop',
      inspectionTarget: 'local_system'
    })
  });
  t.equal(desktop.executionTarget, 'operator', 'native application and screenshot work selects Operator');
  t.equal(desktop.executionSurface, 'desktop', 'the classifier preserves the structured visible-control surface');

  const projectPlaytest = await router.classify(baseContext('Have Operator playtest the selected game project.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Use Operator to launch and interactively playtest the selected game project.',
      executionScope: 'read_only',
      executionTarget: 'operator',
      executionSurface: 'desktop',
      inspectionTarget: 'project'
    })
  });
  t.equal(projectPlaytest.executionTarget, 'operator', 'project-bound visible playtesting keeps the explicitly structured Operator target');
  t.equal(projectPlaytest.executionSurface, 'desktop', 'project metadata does not erase the desktop interaction surface');

  const project = await router.classify(baseContext('Update the approval handling and run its tests.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Update the approval handling and run its tests.',
      executionScope: 'mutating',
      executionTarget: 'operator',
      inspectionTarget: 'project'
    })
  });
  t.equal(project.executionTarget, 'coder', 'project structure deterministically prevents a wrong Operator target');

  const artifact = await router.classify(baseContext('Create a standalone SVG icon set.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Create a standalone SVG icon set.',
      executionScope: 'mutating',
      executionTarget: 'coder',
      inspectionTarget: 'none'
    })
  });
  t.equal(artifact.executionTarget, 'coder', 'self-contained local artifacts select Coder');
  t.end();
});

test('reminder payload actions remain Dispatch-owned scheduling instead of Operator work', async t => {
  const reminder = await router.classify(baseContext('Remind me at 2 PM to start OpenAI.'), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Set a one-time reminder for 2:00 PM to start OpenAI.',
      executionScope: 'mutating',
      executionTarget: 'dispatch',
      executionSurface: 'none',
      orchestrationAction: 'schedule_followup',
      scheduledRequest: {
        prompt: 'Remind Jason that it is time to start OpenAI. Do not launch it unless he asks after receiving the reminder.',
        purpose: 'start-openai-reminder',
        atTime: '14:00',
        recurring: false
      },
      // The future payload mentions a local app. Even if a provider redundantly marks that
      // evidence domain, the immediate requested action is still scheduling, not operating it.
      inspectionTarget: 'local_system',
      standaloneSystemOperation: true
    })
  });

  t.equal(reminder.executionTarget, 'dispatch', 'Dispatch owns the immediate scheduling operation');
  t.equal(reminder.orchestrationAction, 'schedule_followup', 'the durable scheduling primitive is explicit');
  t.equal(reminder.scheduledRequest.atTime, '14:00', 'the local wall-clock time remains structured');
  t.equal(reminder.scheduledRequest.recurring, false, 'a plain reminder is not upgraded to a daily recurrence');
  t.match(reminder.scheduledRequest.prompt, /do not launch/i, 'the future action remains reminder payload, not present authority');
  t.equal(router.canUseStandaloneSpecialistWorkspace(reminder), false, 'a reminder never creates a standalone specialist workspace');
  t.end();
});

test('contextual steering and retry preserve the specialist on the durable task', async t => {
  const activeOperatorTask = {
    taskId: 'task-operator-1',
    title: 'Inspect Codex',
    objective: 'Open Codex and inspect the visible state.',
    status: 'active',
    target: { conversationId: 'operator-1', mode: 'operator' }
  };
  const steering = await router.classify(baseContext('While you are there, capture the settings screen too.', {
    activeOwnedTask: activeOperatorTask,
    taskBound: true
  }), {
    structureApi,
    classify: async () => classification('steer_active_task', {
      requiresExecution: true,
      target: 'active_owned_task',
      resolvedRequest: 'Also capture the Codex settings screen.',
      contextDependent: true,
      executionTarget: 'coder',
      inspectionTarget: 'none'
    })
  });
  t.equal(steering.executionTarget, 'operator', 'steering cannot silently switch the owned task to Coder');

  const retry = await router.classify(baseContext('Try that again.', {
    recentOwnedTask: { ...activeOperatorTask, status: 'failed' }
  }), {
    structureApi,
    classify: async () => classification('context_followup', {
      requiresExecution: true,
      resolvedRequest: 'Retry the failed Codex inspection.',
      contextDependent: true,
      executionTarget: 'coder',
      inspectionTarget: 'none'
    })
  });
  t.equal(retry.executionTarget, 'operator', 'a contextual retry preserves the terminal task specialist');
  t.end();
});

test('contextual approval exposes the immediate proposal, terminal task, and candidate action', async t => {
  const failedTask = {
    taskId: 'task-retirement-wiring',
    title: 'Wire GRITLIFE retirement system',
    objective: 'Wire RetirementSystem into the GRITLIFE controller and verify the integration.',
    status: 'failed',
    origin: { conversationId: 'dispatch-gritlife' },
    target: { conversationId: 'coder-gritlife' }
  };
  let classifierInput = null;
  const result = await router.classify(baseContext('Go for it', {
    conversationId: 'dispatch-gritlife',
    recentVisibleConversation: [
      { role: 'assistant', text: 'The previous task failed. Want me to send the retirement wiring fix to Coder now?' }
    ],
    recentOwnedTask: failedTask,
    candidateAction: {
      type: 'handoff_to_coder',
      title: failedTask.title,
      resolvedRequest: failedTask.objective
    }
  }), {
    structureApi,
    classify: async request => {
      classifierInput = request.input;
      return classification('context_followup', {
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: 'Send the retirement wiring fix to Coder.',
        contextDependent: true,
        executionScope: 'mutating',
        reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'task' }
      });
    }
  });

  t.equal(classifierInput.userMessage, 'Go for it', 'the exact current user turn remains the active instruction');
  t.match(classifierInput.priorAssistantMessage.text, /send the retirement wiring fix to Coder/i, 'the immediate assistant proposal is explicit');
  t.equal(classifierInput.recentOwnedTask.taskId, failedTask.taskId, 'the terminal task survives as resolution context');
  t.equal(classifierInput.recentOwnedTask.status, 'failed', 'terminal status is preserved without pretending the task is active');
  t.equal(classifierInput.candidateAction.type, 'handoff_to_coder', 'the attempted action is available for adjudication');
  t.equal(result.intent, 'context_followup', 'accepting the concrete proposal resolves as a contextual follow-up');
  t.equal(result.requiresExecution, true, 'the accepted handoff requires execution');
  t.equal(result.resolvedRequest, failedTask.objective, 'a failed-task retry preserves the exact durable objective instead of routing prose');
  t.end();
});

test('normalization cannot manufacture task or plan authority', async t => {
  const cancel = await router.classify(baseContext('Cancel it.', {
    activeOwnedTask: null,
    pendingOwnedTask: null
  }), {
    structureApi,
    classify: async () => classification('cancel_active_task', {
      target: 'active_owned_task',
      contextDependent: true
    })
  });
  t.equal(cancel.intent, 'clarification_required', 'cancellation without an owned task is rejected');
  t.equal(cancel.target, 'current_conversation', 'no task identity is invented');

  const approve = await router.classify(baseContext('Approve it.', {
    pendingPlan: null
  }), {
    structureApi,
    classify: async () => classification('approve_plan', {
      target: 'pending_plan',
      contextDependent: true
    })
  });
  t.equal(approve.intent, 'clarification_required', 'approval without a pending plan is rejected');
  t.equal(approve.target, 'current_conversation', 'no plan identity is invented');
  t.end();
});

test('classifier failures fall back without execution or mutation', async t => {
  const unbound = await router.classify(baseContext('Do something.'), {
    structureApi,
    classify: async () => {
      throw new Error('provider unavailable');
    }
  });
  t.equal(unbound.intent, 'conversation', 'an unbound classifier failure keeps the non-executing conversation path usable');
  t.equal(unbound.requiresExecution, false, 'execution is never inferred on failure');
  t.equal(unbound.needsClarification, false, 'ordinary chat is not replaced by a classifier-error question');
  t.equal(unbound.reasoningPolicyHint.contextNeed, 'recent', 'the fallback retains active-conversation memory');
  t.equal(unbound.classifierUnavailable, true, 'diagnostics can distinguish fallback routing from a real classification');
  t.equal(unbound.executionTarget, 'none', 'classifier failure cannot select a specialist');
  t.match(unbound.classifierError, /provider unavailable/i, 'the failure is surfaced for diagnosis');

  const bound = await router.classify(baseContext('Do that.', {
    activeOwnedTask: { taskId: 'task-1', objective: 'Existing work', status: 'active' },
    taskBound: true
  }), {
    structureApi,
    classify: async () => '{invalid'
  });
  t.equal(bound.intent, 'clarification_required', 'a task-bound parse failure asks instead of acting');
  t.equal(bound.needsClarification, true, 'the safe fallback requires clarification');
  t.equal(bound.requiresExecution, false, 'the fallback cannot steer or cancel');
  t.end();
});

test('runtime placeholders never replace the real prior assistant message', async t => {
  let input;
  await router.classify(baseContext('As I just said, getting ready for work.', {
    recentVisibleConversation: [
      { role: 'assistant', text: 'What are you doing this morning?', createdAt: 1 },
      { role: 'user', text: 'Getting ready for another day of work.', createdAt: 2 },
      { role: 'assistant', text: 'Thinking...', createdAt: 3 },
      { role: 'assistant', source: 'queue-status', text: 'Queued behind another task.', createdAt: 4 }
    ],
    compactedConversationMemory: 'Earlier in this conversation Jason discussed storm restoration work.'
  }), {
    structureApi,
    classify: async request => {
      input = request.input;
      return classification('conversation', {
        contextDependent: true,
        reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'recent' }
      });
    }
  });

  t.equal(input.priorAssistantMessage.text, 'What are you doing this morning?', 'the real answer is the semantic referent');
  t.notOk(input.recentVisibleConversation.some(message => message.text === 'Thinking...'), 'thinking placeholder is absent');
  t.notOk(input.recentVisibleConversation.some(message => message.source === 'queue-status'), 'runtime status is absent');
  t.match(input.compactedConversationMemory, /storm restoration work/, 'private conversation memory is supplied separately');
  t.end();
});

test('active-run routing keeps conversation out of the durable execution queue', t => {
  t.equal(
    router.canRespondDuringActiveRun(classification('conversation'), 'orion'),
    true,
    'ordinary conversation can use the concurrent Dispatch response path'
  );
  t.equal(
    router.canRespondDuringActiveRun(classification('status_check'), 'orion'),
    true,
    'a non-mutating status question can use the concurrent Dispatch response path'
  );
  t.equal(
    router.canRespondDuringActiveRun(classification('new_task', {
      requiresExecution: true,
      executionScope: 'mutating'
    }), 'orion'),
    false,
    'executable work still enters the durable queue while another run owns execution'
  );
  t.equal(
    router.canRespondDuringActiveRun(classification('conversation'), 'coder'),
    false,
    'Coder conversations do not bypass the single execution owner'
  );
  t.end();
});

test('standalone Coder eligibility follows structured project dependency', t => {
  const creativeTask = classification('new_task', {
    requiresExecution: true,
    executionScope: 'mutating',
    inspectionTarget: 'none',
    reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'none' }
  });
  t.equal(router.requiresProjectWorkspace(creativeTask), false,
    'a self-contained artifact task does not invent a project dependency');
  t.equal(router.canUseStandaloneCoderWorkspace(creativeTask), true,
    'self-contained executable work may use an isolated standalone Coder workspace');

  const projectTask = classification('new_task', {
    requiresExecution: true,
    executionScope: 'mutating',
    inspectionTarget: 'project',
    reasoningPolicyHint: { complexity: 'medium', risk: 'medium', contextNeed: 'project' }
  });
  t.equal(router.requiresProjectWorkspace(projectTask), true,
    'structured project evidence keeps existing-project work project-bound');
  t.equal(router.canUseStandaloneCoderWorkspace(projectTask), false,
    'standalone routing cannot bypass a missing project for project-bound work');

  t.equal(router.canUseStandaloneCoderWorkspace(classification('conversation')), false,
    'ordinary conversation is never turned into a standalone task');
  t.end();
});
