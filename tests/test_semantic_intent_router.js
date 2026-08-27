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
        // "Go for it" directly answers the immediately preceding assistant offer to retry this
        // exact failed task - a real retry, so the model correctly marks it as resuming
        // recentOwnedTask, not merely a bare confirmation that happens to have one in context.
        resumesRecentFailedTask: true,
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

// Real bug: "Can you look at some of the past runs to see how you were able to get the balance?"
// was answered by inspecting an unrelated active project (Bot-GPT) instead of Orion's own prior
// task/run history, then persisted mistaken file notes into that project. Root cause:
// inspectionTarget only ever named local_system/workspace/project - there was no evidence domain
// for "what Orion itself previously did," so a historical-investigation request had nowhere honest
// to resolve except the active workspace, which the classifier prompt already primes as "the
// project target already resolved." evidenceTarget now names WHOSE evidence answers the request,
// and normalizeClassification deterministically enforces that once evidenceTarget resolves to
// prior_orion_runs, inspectionTarget cannot silently stay on workspace/project - the model decides
// meaning, this code enforces the invariant. These tests exercise paraphrases of the real report,
// not the one literal sentence, and prove the correction fires regardless of what the raw model
// output tried to put in inspectionTarget.

// Overrides only (never a full baseContext() result) - this is spread as the SECOND argument to
// baseContext(message, overrides) below, and baseContext spreads overrides last, so a fragment
// that itself carried a userMessage would silently clobber whichever paraphrase each test passed.
const UNRELATED_WORKSPACE_OVERRIDES = {
  // Deliberately an unrelated active project, mirroring the real report exactly: the selected
  // project shares no relationship to the DeepSeek-balance history being asked about.
  workspace: { role: 'active_project', path: 'C:\\Projects\\Bot-GPT', project: { name: 'Bot-GPT', path: 'C:\\Projects\\Bot-GPT' } },
  recentVisibleConversation: [
    { id: 'm1', role: 'user', text: 'What do you remember about how I check my DeepSeek balance?', createdAt: 1 },
    { id: 'm2', role: 'assistant', text: 'I have no durable memory of that procedure yet.', createdAt: 2 }
  ]
};

const HISTORY_PARAPHRASES = [
  'How did you do this last time?',
  'Look at your previous runs and tell me how you got the balance.',
  'What did Operator do the last couple times I asked for my DeepSeek balance?',
  'Can you check the history and see how you handled this before?',
  'What happened in the previous attempt?'
];

HISTORY_PARAPHRASES.forEach(phrase => {
  test(`evidence resolution: "${phrase}" resolves to Orion's own run history, never the active workspace`, async t => {
    // The mocked classify() stands in for the model and is allowed to make the OLD mistake (an
    // inspectionTarget of workspace/project) to prove the deterministic layer - not the model's
    // good behavior - is what actually prevents the active-workspace substitution.
    const result = await router.classify(baseContext(phrase, UNRELATED_WORKSPACE_OVERRIDES), {
      structureApi,
      classify: async () => classification('context_followup', {
        requiresExecution: true,
        resolvedRequest: 'Find how Orion previously checked the user\'s DeepSeek balance by reviewing its own prior runs.',
        contextDependent: true,
        executionScope: 'read_only',
        executionTarget: 'coder',
        evidenceTarget: 'prior_orion_runs',
        evidenceBroadenReason: '',
        inspectionTarget: 'workspace',
        inspectionBreadth: 'broad'
      })
    });
    t.equal(result.evidenceTarget, 'prior_orion_runs', 'evidence resolves to Orion\'s own run history');
    t.equal(result.inspectionTarget, 'task_history', 'inspectionTarget is corrected to task_history even though the raw output said workspace');
    t.notEqual(result.inspectionTarget, 'workspace', 'the active project is never silently substituted as the evidence target');
    t.notEqual(result.inspectionTarget, 'project', 'nor is it substituted as a project inspection');
    t.end();
  });
});

const WORKSPACE_PARAPHRASES = [
  'How does Bot-GPT handle DeepSeek?',
  'Search Bot-GPT for balance code.',
  'Did I write a DeepSeek balance script in this project?'
];

WORKSPACE_PARAPHRASES.forEach(phrase => {
  test(`evidence resolution: "${phrase}" legitimately resolves to the active project workspace`, async t => {
    const result = await router.classify(baseContext(phrase, UNRELATED_WORKSPACE_OVERRIDES), {
      structureApi,
      classify: async () => classification('new_task', {
        requiresExecution: true,
        resolvedRequest: phrase,
        executionScope: 'read_only',
        executionTarget: 'coder',
        evidenceTarget: 'active_workspace',
        evidenceBroadenReason: '',
        inspectionTarget: 'project',
        inspectionBreadth: 'focused'
      })
    });
    t.equal(result.evidenceTarget, 'active_workspace', 'evidence resolves to the project itself, same named entity, different referent');
    t.equal(result.inspectionTarget, 'project', 'project inspection is preserved unchanged - the correction only fires for prior_orion_runs');
    t.end();
  });
});

test('mixed case: "look at the previous run and tell me which project/file it used" starts from history', async t => {
  const result = await router.classify(baseContext(
    'Look at the previous run and tell me which project/file it used.',
    UNRELATED_WORKSPACE_OVERRIDES
  ), {
    structureApi,
    classify: async () => classification('context_followup', {
      requiresExecution: true,
      resolvedRequest: 'Identify which project/file the previous relevant Orion run used.',
      contextDependent: true,
      executionScope: 'read_only',
      executionTarget: 'coder',
      evidenceTarget: 'prior_orion_runs',
      evidenceBroadenReason: '',
      inspectionTarget: 'task_history',
      inspectionBreadth: 'focused'
    })
  });
  t.equal(result.evidenceTarget, 'prior_orion_runs', 'history is consulted first');
  t.equal(result.inspectionTarget, 'task_history', 'not the active project, until history actually names one');
  t.end();
});

test('mixed case: a stated evidenceBroadenReason is the only way historical investigation may widen into a project', t => {
  const input = router.buildInput(baseContext(
    'Look at the previous run and tell me which project/file it used.',
    UNRELATED_WORKSPACE_OVERRIDES
  ), structureApi);
  const broadened = router.normalizeClassification(classification('context_followup', {
    requiresExecution: true,
    resolvedRequest: 'Identify which project/file the previous relevant Orion run used, then confirm the script.',
    contextDependent: true,
    executionScope: 'read_only',
    executionTarget: 'coder',
    evidenceTarget: 'prior_orion_runs',
    evidenceBroadenReason: 'The matched prior task\'s own recorded result explicitly names Bot-GPT/tools/ai_service.py as the script that checked the balance.',
    inspectionTarget: 'project',
    inspectionBreadth: 'single_file'
  }), input);
  t.equal(broadened.inspectionTarget, 'project', 'a real, stated reason is honored - history explicitly pointed at a project artifact');
  t.equal(broadened.evidenceBroadenReason.length > 0, true, 'the justification is preserved and auditable, not discarded');
  t.end();
});

test('an empty, missing, or whitespace-only evidenceBroadenReason can never silently authorize a workspace substitution', t => {
  const input = router.buildInput(baseContext('How did you do this last time?', UNRELATED_WORKSPACE_OVERRIDES), structureApi);
  const variants = [
    { evidenceBroadenReason: '' },
    { evidenceBroadenReason: '   ' },
    {} // evidenceBroadenReason omitted entirely, the exact shape an older/non-compliant provider would emit
  ];
  variants.forEach((overrides, index) => {
    const result = router.normalizeClassification(classification('context_followup', {
      requiresExecution: true,
      resolvedRequest: 'Find how Orion previously checked the DeepSeek balance.',
      contextDependent: true,
      executionScope: 'read_only',
      executionTarget: 'coder',
      evidenceTarget: 'prior_orion_runs',
      inspectionTarget: 'workspace',
      inspectionBreadth: 'broad',
      ...overrides
    }), input);
    t.equal(result.inspectionTarget, 'task_history', `variant ${index}: no usable reason means the correction still fires`);
  });
  t.end();
});

test('evidence resolution: an unrelated active workspace never leaks into a historical request, and a missing workspace behaves the same', t => {
  const noWorkspaceContext = baseContext('What happened in the previous attempt?', {
    workspace: null,
    recentVisibleConversation: UNRELATED_WORKSPACE_OVERRIDES.recentVisibleConversation
  });
  const input = router.buildInput(noWorkspaceContext, structureApi);
  const result = router.normalizeClassification(classification('context_followup', {
    requiresExecution: true,
    resolvedRequest: 'Find what happened in the previous relevant Orion run.',
    contextDependent: true,
    executionScope: 'read_only',
    executionTarget: 'coder',
    evidenceTarget: 'prior_orion_runs',
    evidenceBroadenReason: '',
    inspectionTarget: 'project',
    inspectionBreadth: 'focused'
  }), input);
  t.equal(result.inspectionTarget, 'task_history', 'with no active workspace at all, the request still resolves to task history, never an invented project');
  t.end();
});

test('a task-history investigation never requires a project workspace and is eligible for a standalone specialist task', t => {
  const historyTask = classification('context_followup', {
    requiresExecution: true,
    executionScope: 'read_only',
    evidenceTarget: 'prior_orion_runs',
    inspectionTarget: 'task_history',
    inspectionBreadth: 'broad',
    reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'historical' }
  });
  t.equal(router.requiresProjectWorkspace(historyTask), false,
    'task_history is not workspace or project, so no project binding is invented for it');
  t.equal(router.canUseStandaloneSpecialistWorkspace(historyTask), true,
    'a historical investigation may run as a standalone specialist task, not bound to whichever project is active');
  t.end();
});

test('a multi-run historical synthesis explicitly requesting Researcher resolves to Researcher, decided by capability not keywords', t => {
  const historySynthesis = classification('context_followup', {
    requiresExecution: true,
    executionScope: 'read_only',
    executionTarget: 'researcher',
    evidenceTarget: 'prior_orion_runs',
    inspectionTarget: 'task_history',
    inspectionBreadth: 'broad'
  });
  const input = router.buildInput(baseContext('Compare the last three times you checked my DeepSeek balance and explain what changed.'), structureApi);
  t.equal(router.resolveExecutionTarget(historySynthesis, input), 'researcher',
    'Researcher is read-only capable (no workspace mutation, no desktop control needed), so the explicit shape-based choice is honored');
  t.end();
});

// Real bug: Dispatch built a task titled "Check DeepSeek balance + screenshot" from a bare "Yes"
// that was actually accepting a completely different, more recent offer ("pull up the actual
// memory entries and show Jason what's stored"). recentOwnedTask (conversation.lastDelegatedWork)
// is whatever was delegated most recently, EVER - never aged out, only overwritten by a newer
// delegation - so a stale failed task from an earlier, unrelated exchange silently intercepted an
// unrelated confirmation. resumesRecentFailedTask is the model's own judgment of whether the
// CURRENT reply is actually about that failed task; the deterministic override now requires it.
const STALE_FAILED_DEEPSEEK_TASK = {
  taskId: 'task-deepseek-balance-1',
  title: 'Check DeepSeek balance + screenshot',
  objective: 'Check the DeepSeek account balance and take a screenshot as proof.',
  status: 'failed',
  origin: { conversationId: 'dispatch-1' },
  target: { conversationId: 'operator-1' }
};

test('a bare "Yes" confirming a new, unrelated offer is never rebound to a stale failed task', async t => {
  const result = await router.classify(baseContext('Yes', {
    recentOwnedTask: STALE_FAILED_DEEPSEEK_TASK,
    recentVisibleConversation: [
      { role: 'assistant', text: 'Want me to pull up the actual memory entries and show you what is stored?' }
    ]
  }), {
    structureApi,
    classify: async () => classification('context_followup', {
      requiresExecution: true,
      resolvedRequest: 'Pull up the actual stored memory entries and show Jason what is stored.',
      contextDependent: true,
      // The model correctly recognizes this "Yes" answers the memory-entries offer, not the old
      // failed DeepSeek task - it must not claim resumesRecentFailedTask here.
      resumesRecentFailedTask: false,
      executionScope: 'read_only'
    })
  });
  t.equal(result.resolvedRequest, 'Pull up the actual stored memory entries and show Jason what is stored.',
    'the correctly-resolved new request survives instead of being overwritten');
  t.notEqual(result.resolvedRequest, STALE_FAILED_DEEPSEEK_TASK.objective,
    'the stale DeepSeek task never becomes the task payload for an unrelated confirmation');
  t.equal(result.resumesRecentFailedTask, false, 'no retry override is recorded, because none fired');
  t.end();
});

test('a genuine retry confirmation ("try that again") still preserves the exact failed-task objective', async t => {
  const result = await router.classify(baseContext('Yes, try that again', {
    recentOwnedTask: STALE_FAILED_DEEPSEEK_TASK,
    recentVisibleConversation: [
      { role: 'assistant', text: 'That DeepSeek balance check failed. Want me to try it again?' }
    ]
  }), {
    structureApi,
    classify: async () => classification('context_followup', {
      requiresExecution: true,
      resolvedRequest: 'Retry checking the DeepSeek balance.',
      contextDependent: true,
      resumesRecentFailedTask: true,
      executionScope: 'read_only'
    })
  });
  t.equal(result.resolvedRequest, STALE_FAILED_DEEPSEEK_TASK.objective,
    'a real retry still gets the exact durable objective instead of a routing paraphrase');
  t.equal(result.resumesRecentFailedTask, true, 'the retry override is recorded as having fired');
  t.end();
});

test('resumesRecentFailedTask alone cannot manufacture a retry without the other structural conditions', t => {
  const input = router.buildInput(baseContext('Yes', { recentOwnedTask: STALE_FAILED_DEEPSEEK_TASK }), structureApi);
  // A model claiming resumesRecentFailedTask=true on a NEW task (not context_followup) must not
  // retroactively turn it into a retry of the stale failed task.
  const asNewTask = router.normalizeClassification(classification('new_task', {
    requiresExecution: true,
    resolvedRequest: 'Check the weather today.',
    resumesRecentFailedTask: true,
    executionScope: 'read_only'
  }), input);
  t.notEqual(asNewTask.resolvedRequest, STALE_FAILED_DEEPSEEK_TASK.objective,
    'a genuinely new task is never silently rewritten into the old failed task, even if resumesRecentFailedTask is (incorrectly) true');
  t.end();
});

// Real bug: "what do you actually remember about me" was task-constructed bound to whatever
// project happened to be active (GRITLIFE) instead of staying a plain personal-memory answer -
// the same class of context leak as the Bot-GPT bug, but at task-construction time for memory
// questions specifically. A memory question is always answered through recall_memory's own
// global/project/conversation scope, never by inspecting the active project's files.
const ACTIVE_PROJECT_OVERRIDES = {
  workspace: { role: 'active_project', path: 'C:\\Projects\\GRITLIFE', project: { name: 'GRITLIFE', path: 'C:\\Projects\\GRITLIFE' } }
};

test('"what do you actually remember about me" never binds to the active project', async t => {
  const result = await router.classify(baseContext('What do you actually remember about me?', ACTIVE_PROJECT_OVERRIDES), {
    structureApi,
    classify: async () => classification('conversation', {
      requiresExecution: false,
      resolvedRequest: 'Report what Orion has stored about Jason.',
      memoryIntent: 'stored_memory_lookup',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' },
      // A model reflexively treating the active project as "already resolved" for this turn -
      // exactly the mistake the real bug made.
      inspectionTarget: 'project',
      inspectionBreadth: 'broad'
    })
  });
  t.equal(result.memoryIntent, 'stored_memory_lookup', 'the memory question is classified correctly');
  t.equal(result.inspectionTarget, 'none', 'inspectionTarget is corrected to none even though the raw output said project');
  t.notEqual(result.inspectionTarget, 'project', 'GRITLIFE is never silently made the evidence source for a personal-memory question');
  t.equal(router.requiresProjectWorkspace(result), false, 'no project binding is invented for the memory question');
  t.end();
});

test('a conversation-recall question is also never bound to the active project, even when it names the project', async t => {
  const result = await router.classify(baseContext('What did we discuss about GRITLIFE last time?', ACTIVE_PROJECT_OVERRIDES), {
    structureApi,
    classify: async () => classification('conversation', {
      requiresExecution: false,
      resolvedRequest: 'Recall what was previously discussed about GRITLIFE.',
      memoryIntent: 'conversation_recall',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' },
      inspectionTarget: 'project'
    })
  });
  t.equal(result.inspectionTarget, 'none',
    'even a project-specific memory question is answered through recall_memory scope, not file inspection');
  t.end();
});

// Jason's follow-up: inspectionTarget='none' was doing double duty - "no file investigation
// needed" AND, silently, "this is actually a memory question" - a value collecting a second,
// unwritten meaning. evidenceTarget: personal_memory gives that second meaning its own explicit
// name, mirroring how prior_orion_runs already names "the evidence is Orion's own run history"
// instead of leaving inspectionTarget to carry that meaning alone.

test('a personal memory question resolves evidenceTarget to personal_memory, not just inspectionTarget to none', async t => {
  const result = await router.classify(baseContext('What do you actually remember about me?', ACTIVE_PROJECT_OVERRIDES), {
    structureApi,
    classify: async () => classification('conversation', {
      requiresExecution: false,
      resolvedRequest: 'Report what Orion has stored about Jason.',
      memoryIntent: 'stored_memory_lookup',
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' },
      // The raw model output never even mentions evidenceTarget/personal_memory here - proving the
      // deterministic layer supplies it, not just a lucky model guess.
      inspectionTarget: 'none'
    })
  });
  t.equal(result.evidenceTarget, 'personal_memory', 'evidenceTarget explicitly names the memory-store evidence domain');
  t.equal(result.inspectionTarget, 'none', 'inspectionTarget still correctly means no file investigation is needed');
  t.end();
});

test('evidenceTarget is corrected to personal_memory even when the raw model output guessed active_workspace or prior_orion_runs', async t => {
  const asActiveWorkspace = await router.classify(baseContext('What have I told you about GRITLIFE before?', ACTIVE_PROJECT_OVERRIDES), {
    structureApi,
    classify: async () => classification('conversation', {
      requiresExecution: false,
      resolvedRequest: 'Recall what Jason has told Orion about GRITLIFE.',
      memoryIntent: 'stored_memory_lookup',
      // A model reflexively pattern-matching "GRITLIFE" to the active project - exactly the
      // mistake that caused the original bug - must still be corrected.
      evidenceTarget: 'active_workspace',
      inspectionTarget: 'project'
    })
  });
  t.equal(asActiveWorkspace.evidenceTarget, 'personal_memory', 'a wrong active_workspace guess is corrected for a memory question');
  t.equal(asActiveWorkspace.inspectionTarget, 'none', 'and inspectionTarget is corrected alongside it');

  const asPriorRuns = await router.classify(baseContext('What do you remember discussing with me about the balance check?', {}), {
    structureApi,
    classify: async () => classification('conversation', {
      requiresExecution: false,
      resolvedRequest: 'Recall what was discussed about the balance check.',
      memoryIntent: 'conversation_recall',
      // A model conflating "what do you remember discussing" with "what did you previously run" -
      // memoryIntent already commits this to recall_memory, so prior_orion_runs must not survive.
      evidenceTarget: 'prior_orion_runs',
      inspectionTarget: 'task_history'
    })
  });
  t.equal(asPriorRuns.evidenceTarget, 'personal_memory', 'memoryIntent wins over a prior_orion_runs guess for a genuine memory question');
  t.equal(asPriorRuns.inspectionTarget, 'none', 'and inspectionTarget is not left on task_history');
  t.end();
});

test('a real task-history question keeps evidenceTarget as prior_orion_runs, unaffected by the personal_memory correction', async t => {
  const result = await router.classify(baseContext('Look at your previous runs and tell me how you got the DeepSeek balance last time.', {}), {
    structureApi,
    classify: async () => classification('conversation', {
      requiresExecution: true,
      resolvedRequest: "Review Orion's prior runs to explain how the DeepSeek balance was retrieved last time.",
      memoryIntent: 'none',
      evidenceTarget: 'prior_orion_runs',
      inspectionTarget: 'workspace'
    })
  });
  t.equal(result.evidenceTarget, 'prior_orion_runs', 'a non-memory historical question is untouched by the personal_memory correction');
  t.equal(result.inspectionTarget, 'task_history', 'and the existing prior_orion_runs correction still applies on its own');
  t.end();
});

test('an ordinary project question (not a memory question) still legitimately uses the active project', async t => {
  const result = await router.classify(baseContext('How does GRITLIFE handle retirement calculations?', ACTIVE_PROJECT_OVERRIDES), {
    structureApi,
    classify: async () => classification('new_task', {
      requiresExecution: true,
      resolvedRequest: 'Explain how GRITLIFE handles retirement calculations.',
      executionScope: 'read_only',
      memoryIntent: 'none',
      inspectionTarget: 'project',
      inspectionBreadth: 'focused'
    })
  });
  t.equal(result.inspectionTarget, 'project',
    'the correction is scoped to memory questions only - an ordinary project question is unaffected');
  t.end();
});
