'use strict';

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA_VERSION,
  TASK_STATES,
  isContextDependentRequest,
  isContinuationRequest,
  deriveTaskTitle,
  buildTaskPacket,
  normalizeTaskRecord,
  transitionTask,
  canRequesterControlTask,
  selectOwnedContinuationTask,
  cancelPendingOwnedTasks,
  renderTaskPrompt,
  describeTaskStatus,
  pendingTaskNeedsRuntimeQueue,
  findTaskSupersessions,
  filterSupersededTasks,
  selectSupervisedTask,
  describeSupervisedTaskPresentation
} = require('../task-orchestration');
const { OrchestrationTaskStore } = require('../lib/orchestration-task-store');
const { registerHandlers } = require('../lib/ipc-orchestration');

function makeTempStore(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-task-store-'));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'tasks.json');
  return {
    dir,
    filePath,
    store: new OrchestrationTaskStore({ filePath, ...options })
  };
}

function baseTask(overrides = {}) {
  return {
    taskId: 'task_base',
    title: 'Base task',
    objective: 'Implement and verify the requested change.',
    originalUserMessage: 'Please implement the requested change.',
    precedingConversationSummary: '',
    workspace: {
      role: 'active_project',
      path: 'C:\\Projects\\Orion',
      project: { name: 'Orion', path: 'C:\\Projects\\Orion' },
      source: 'registered_project'
    },
    requirements: ['Implement the change.'],
    constraints: ['Do not change unrelated files.'],
    unresolvedDecisions: [],
    origin: { conversationId: 'dispatch-1', sessionId: 'session-1', messageId: 'message-1' },
    target: { conversationId: 'coder-1', sessionId: '', messageId: '', mode: 'coder' },
    source: 'dispatch-handoff',
    status: 'pending',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  };
}

async function captureRejection(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

test('context-dependent request detection consumes structured semantic intent only', t => {
  t.equal(isContextDependentRequest({
    intent: 'context_followup',
    target: 'current_conversation',
    contextDependent: true
  }), true, 'the shared classifier can mark a resolved follow-up as contextual');
  t.equal(isContextDependentRequest({
    intent: 'new_task',
    target: 'current_conversation',
    contextDependent: false
  }), false, 'a self-contained task is not marked contextual');
  t.equal(isContextDependentRequest("Let's do it"), false, 'ordinary English is never classified by this deterministic task module');
  t.end();
});

test('task continuation detection requires a structured active-owned-task target', t => {
  t.equal(isContinuationRequest({
    intent: 'context_followup',
    target: 'active_owned_task',
    contextDependent: true
  }), true, 'the classified follow-up resumes owned work');
  t.equal(isContinuationRequest({
    intent: 'context_followup',
    target: 'current_conversation',
    contextDependent: true
  }), false, 'a discussion follow-up is not task continuation');
  t.equal(isContinuationRequest({
    intent: 'approve_plan',
    target: 'pending_plan',
    contextDependent: true
  }), false, 'plan approval is not confused with task continuation');
  t.equal(isContinuationRequest('Continue'), false, 'the task contract does not infer intent from a phrase');
  t.end();
});

test('resolved replacement packets retain deterministic predecessor provenance', t => {
  const result = buildTaskPacket({
    taskId: 'task_replacement',
    originalUserMessage: 'Continue',
    semanticIntent: {
      intent: 'context_followup',
      target: 'current_conversation',
      contextDependent: true,
      requiresExecution: true,
      resolvedRequest: 'Finish the verified remaining work.',
      supersedesTaskId: 'task_predecessor',
      taskResolution: {}
    },
    workspace: baseTask().workspace,
    origin: baseTask().origin,
    target: baseTask().target
  });
  t.equal(result.success, true, 'the replacement packet resolves normally');
  t.equal(result.task.supersedesTaskId, 'task_predecessor', 'the exact predecessor ID is durable');
  t.equal(
    normalizeTaskRecord(result.task).supersedesTaskId,
    'task_predecessor',
    'predecessor provenance survives normalization'
  );
  t.end();
});

test('Dispatch continuation deterministically reuses its one canonical Coder task', t => {
  const pending = normalizeTaskRecord(baseTask({
    taskId: 'task-pending',
    status: 'pending',
    updatedAt: 2000
  }));
  const active = normalizeTaskRecord(baseTask({
    taskId: 'task-active',
    status: 'active',
    target: { conversationId: 'coder-2', sessionId: '', messageId: '', mode: 'coder' },
    updatedAt: 3000
  }));
  const unrelated = normalizeTaskRecord(baseTask({
    taskId: 'task-unrelated',
    origin: { conversationId: 'dispatch-other', sessionId: '', messageId: '' },
    target: { conversationId: 'coder-other', sessionId: '', messageId: '', mode: 'coder' },
    status: 'pending',
    updatedAt: 4000
  }));

  const paused = selectOwnedContinuationTask([pending, unrelated], 'dispatch-1', ['task-pending']);
  t.equal(paused.action, 'resume_pending', 'one owned paused task is resumed');
  t.equal(paused.task.taskId, 'task-pending', 'the existing task ID is retained');

  const running = selectOwnedContinuationTask([pending, active, unrelated], 'dispatch-1', ['task-pending']);
  t.equal(running.action, 'already_active', 'active owned work prevents a second handoff');
  t.equal(running.task.taskId, 'task-active', 'the live Coder task remains authoritative');

  const ambiguous = selectOwnedContinuationTask([
    pending,
    normalizeTaskRecord(baseTask({
      taskId: 'task-pending-2',
      target: { conversationId: 'coder-3', sessionId: '', messageId: '', mode: 'coder' },
      status: 'pending',
      updatedAt: 2500
    }))
  ], 'dispatch-1');
  t.equal(ambiguous.action, 'ambiguous_pending', 'multiple paused tasks require a choice');
  t.equal(ambiguous.task, null, 'ambiguity never invents a task selection');
  t.end();
});

test('durable continuation input survives restart and is consumed by one claim', t => {
  const pending = normalizeTaskRecord(baseTask({
    continuation: {
      input: 'Here are my answers: Billing: monthly; Venue: gym.',
      source: 'clarification-answers',
      messageId: 'message-answer',
      createdAt: 1050
    }
  }));
  const prompt = renderTaskPrompt(pending);
  t.match(prompt, /Latest continuation input:/, 'the persisted continuation is rendered into the executable packet');
  t.match(prompt, /Billing: monthly; Venue: gym/, 'the exact follow-up input survives normalization');
  const active = transitionTask(pending, TASK_STATES.ACTIVE, {
    timestamp: 1100,
    consumeContinuation: true
  });
  t.equal(active.continuation, null, 'claiming the task consumes the continuation exactly once');
  t.notOk(/Latest continuation input:/.test(renderTaskPrompt(active)), 'later task passes do not replay an already-consumed answer');
  t.end();
});

test('New Focus fails closed when owned-task listing or cancellation is unverified', async t => {
  let cancelCalls = 0;
  const listFailure = await cancelPendingOwnedTasks({ conversationId: 'dispatch-1' }, {
    listTasks: async () => {
      throw new Error('store unavailable');
    },
    cancelTask: async () => {
      cancelCalls += 1;
    }
  });
  t.equal(listFailure.success, false, 'a list failure is not mistaken for an empty queue');
  t.match(listFailure.failures[0].error, /store unavailable/i, 'the real store failure is reported');
  t.equal(cancelCalls, 0, 'no guessed cancellation is attempted without a verified list');

  const task = normalizeTaskRecord(baseTask({ taskId: 'task-new-focus' }));
  const success = await cancelPendingOwnedTasks({ conversationId: 'dispatch-1' }, {
    listTasks: async () => [task],
    cancelTask: async taskId => ({
      success: true,
      task: { ...task, taskId, status: TASK_STATES.CANCELLED }
    })
  });
  t.equal(success.success, true, 'verified owned pending work can be cancelled');
  t.deepEqual(success.cancelled, ['task-new-focus'], 'the exact task ID is returned');
  t.equal(success.count, 1, 'the cancellation count is explicit');
  t.end();
});

test('GRITLIFE contextual approval resolves to a self-contained task packet', t => {
  const projectPath = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  const result = buildTaskPacket({
    taskId: 'task_gritlife_enrollments',
    originalUserMessage: "Let's do it",
    semanticIntent: {
      intent: 'context_followup',
      target: 'current_conversation',
      contextDependent: true,
      needsClarification: false,
      resolvedRequest: 'Design and implement a location-based commitment system for GRITLIFE using paid enrollments and subscriptions organized by Body & Physical, Medical, Community, Education, and Work. Include recurring gym memberships, yoga, massages, therapy, clubs, classes, and career development with recurring costs and benefits. Evaluate how this replaces, merges with, or derives the existing Grind, Connect, and Survive intent behavior.',
      taskResolution: {
        title: 'GRITLIFE location enrollments',
        requirements: [
          'Organize enrollments by Body & Physical, Medical, Community, Education, and Work.',
          'Support recurring costs and benefits.'
        ],
        constraints: [],
        unresolvedDecisions: [
          'Evaluate how the enrollment system replaces, merges with, or derives Grind, Connect, and Survive.'
        ]
      }
    },
    precedingMessages: [
      {
        role: 'user',
        text: 'For GRITLIFE, replace or evolve the intent system into paid enrollments and subscriptions organized by locations. Players should browse Body & Physical, Medical, Community, Education, and Work locations.'
      },
      {
        role: 'assistant',
        text: 'The location-based commitment system can include recurring gym memberships, yoga, massages, therapy, clubs, classes, and career development. Each enrollment can carry recurring costs and benefits. We still need to evaluate how this replaces, merges with, or derives the existing Grind, Connect, and Survive intent behavior.'
      },
      { role: 'user', text: "Let's do it" }
    ],
    workspace: {
      role: 'active_project',
      path: projectPath,
      project: { name: 'GRITLIFE', path: projectPath },
      source: 'registered_project'
    },
    constraints: ['Use the actual GRITLIFE project workspace.'],
    origin: { conversationId: 'dispatch-gritlife', sessionId: 'session-live', messageId: 'message-let-us-do-it' },
    target: { conversationId: 'coder-gritlife', mode: 'coder' },
    timestamp: 123456789
  });

  t.equal(result.success, true, 'context was resolved');
  const task = result.task;
  t.equal(task.taskId, 'task_gritlife_enrollments', 'stable task ID is retained');
  t.equal(task.originalUserMessage, "Let's do it", 'raw phrase is retained as provenance');
  t.notEqual(task.objective, "Let's do it", 'raw phrase is not the executable objective');
  t.ok(/paid enrollments and subscriptions/i.test(task.objective), 'objective carries the actual enrollment concept');
  t.ok(/Body & Physical/i.test(task.objective), 'objective carries location categories');
  t.ok(/gym memberships, yoga, massages, therapy/i.test(task.objective), 'objective carries recurring service examples');
  t.ok(/Grind, Connect, and Survive/i.test(task.objective), 'objective carries the intent-system design decision');
  t.equal(task.workspace.role, 'active_project', 'workspace role is explicit');
  t.equal(task.workspace.path, projectPath, 'exact project workspace is preserved');
  t.equal(task.selectedProject.name, 'GRITLIFE', 'selected project is structured');
  t.ok(task.requirements.some(value => /recurring costs and benefits/i.test(value)), 'known requirements were extracted');
  t.ok(task.unresolvedDecisions.some(value => /evaluate how/i.test(value)), 'unresolved design decision was extracted');
  t.deepEqual(task.origin, { conversationId: 'dispatch-gritlife', sessionId: 'session-live', messageId: 'message-let-us-do-it' }, 'origin provenance is complete');
  t.equal(task.status, TASK_STATES.PENDING, 'new task is pending, not running');
  const prompt = renderTaskPrompt(task);
  t.ok(prompt.includes(projectPath), 'Coder prompt carries the exact workspace');
  t.ok(prompt.indexOf('Objective:') < prompt.indexOf("Let's do it"), 'raw utterance appears only after the resolved task content');
  t.ok(/Original user message \(provenance only\)/.test(prompt), 'raw utterance is clearly labeled as provenance');
  t.end();
});

test('contextual task resolves a named registered project instead of queuing against Projects root', t => {
  const searchRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const projectPath = `${searchRoot}\\GRITLIFE`;
  const context = [{
    role: 'user',
    text: 'For GRITLIFE, implement recurring paid subscriptions and enrollments organized by locations such as gyms, yoga, massage, therapy, and classes.'
  }];
  const resolved = buildTaskPacket({
    originalUserMessage: "Let's do it",
    semanticIntent: {
      intent: 'context_followup',
      target: 'current_conversation',
      contextDependent: true,
      needsClarification: false,
      resolvedRequest: 'Implement recurring paid subscriptions and enrollments for GRITLIFE, organized by locations such as gyms, yoga, massage, therapy, and classes.',
      taskResolution: { title: 'GRITLIFE subscriptions', requirements: [], constraints: [], unresolvedDecisions: [] }
    },
    precedingMessages: context,
    workspace: {
      role: 'active_project',
      path: searchRoot,
      project: { name: 'Projects', path: searchRoot },
      source: 'stale_dispatch_binding'
    },
    searchRoot,
    knownProjects: [
      { name: 'Projects', path: searchRoot, source: 'stale_registration' },
      { name: 'LIFE', path: `${searchRoot}\\LIFE`, source: 'registered_project' },
      { name: 'GRITLIFE', path: projectPath, source: 'registered_project' }
    ],
    originConversationId: 'dispatch-gritlife-root'
  });

  t.equal(resolved.success, true, 'the known project name in preceding context resolves the task');
  t.equal(resolved.task.workspace.role, 'active_project', 'the resolved task has a concrete project role');
  t.equal(resolved.task.workspace.path, projectPath, 'the packet carries the exact GRITLIFE workspace');
  t.equal(resolved.task.selectedProject.name, 'GRITLIFE', 'the stale Projects pseudo-project is discarded');
  t.notEqual(resolved.task.workspace.path, `${searchRoot}\\LIFE`, 'a shorter project name embedded inside GRITLIFE cannot steal the match');

  const unresolved = buildTaskPacket({
    originalUserMessage: "Let's do it",
    semanticIntent: {
      intent: 'context_followup',
      target: 'current_conversation',
      contextDependent: true,
      needsClarification: false,
      resolvedRequest: 'Implement recurring paid subscriptions and enrollments for GRITLIFE.',
      taskResolution: { title: 'GRITLIFE subscriptions', requirements: [], constraints: [], unresolvedDecisions: [] }
    },
    precedingMessages: context,
    workspace: {
      role: 'project_search_root',
      path: searchRoot,
      project: { name: '', path: '' }
    },
    searchRoot,
    knownProjects: [],
    originConversationId: 'dispatch-unresolved-root'
  });
  t.equal(unresolved.success, false, 'a contextual executable task cannot target only the search root');
  t.equal(unresolved.needsClarification, true, 'the caller receives a targeted project clarification');
  t.equal(unresolved.task, null, 'no ambiguous root-scoped task is created');
  t.match(unresolved.clarification, /specific project workspace/i, 'the clarification explains the missing scope');
  t.end();
});

test('task image attachments and context packet references survive a durable store reload', async t => {
  const { filePath, store } = makeTempStore(t, { now: () => 123456790 });
  const image = {
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    mimeType: 'image/png',
    name: 'storm-damage.png',
    previewUrl: 'blob:renderer-only-preview'
  };
  const packet = buildTaskPacket({
    taskId: 'task_durable_context',
    originalUserMessage: 'Inspect the attached storm photo and use the selected source context.',
    images: [image],
    contextPacketIds: ['context-2', 'context-1', 'context-2'],
    workspacePath: 'C:\\Projects\\Storm',
    projectPath: 'C:\\Projects\\Storm',
    projectName: 'Storm',
    originConversationId: 'dispatch-storm',
    targetConversationId: 'coder-storm',
    timestamp: 123456790
  });

  t.equal(packet.success, true, 'task packet is created');
  t.deepEqual(packet.task.images, [{
    data: image.data,
    mimeType: image.mimeType,
    name: image.name
  }], 'the durable packet retains image data and strips renderer-only preview state');
  t.deepEqual(packet.task.contextPacketIds, ['context-2', 'context-1'], 'context packet IDs are retained and de-duplicated');

  await store.create(packet.task);
  const reloaded = new OrchestrationTaskStore({ filePath, now: () => 123456791 });
  const task = await reloaded.get('task_durable_context');
  t.deepEqual(task.images, packet.task.images, 'image attachment survives JSON persistence and a fresh store instance');
  t.deepEqual(task.contextPacketIds, packet.task.contextPacketIds, 'context packet references survive JSON persistence and reload');

  const legacyWithoutAttachments = normalizeTaskRecord(baseTask({ taskId: 'task_legacy_without_attachments' }));
  t.deepEqual(legacyWithoutAttachments.images, [], 'legacy records without images receive a safe empty default');
  t.deepEqual(legacyWithoutAttachments.contextPacketIds, [], 'legacy records without context references receive a safe empty default');

  const legacyImageAlias = normalizeTaskRecord(baseTask({
    taskId: 'task_legacy_image_alias',
    attachments: [image],
    contextPacketId: 'context-legacy'
  }));
  t.deepEqual(legacyImageAlias.images, packet.task.images, 'legacy image-attachment aliases migrate into the canonical images field');
  t.deepEqual(legacyImageAlias.contextPacketIds, ['context-legacy'], 'a legacy singular context reference migrates into the canonical list');
  t.end();
});

test('unresolvable option reference asks a targeted question and creates no task', t => {
  const result = buildTaskPacket({
    originalUserMessage: 'Use the second one',
    precedingMessages: [],
    semanticIntent: {
      intent: 'clarification_required',
      target: 'current_conversation',
      contextDependent: true,
      needsClarification: true,
      resolvedRequest: '',
      clarificationQuestion: 'Which second option do you mean? I do not have the referenced choices.'
    }
  });
  t.equal(result.success, false, 'resolution fails honestly');
  t.equal(result.needsClarification, true, 'clarification is required');
  t.equal(result.task, null, 'no invented task is returned');
  t.ok(/Which (?:second )?option/i.test(result.clarification), 'question targets the missing choice');
  t.ok(/do not have the referenced choices/i.test(result.clarification), 'question explains the evidence gap');
  t.end();
});

test('option reference resolves when the preceding choices are present', t => {
  const result = buildTaskPacket({
    taskId: 'task_option_two',
    originalUserMessage: 'Use the second one',
    semanticIntent: {
      intent: 'context_followup',
      target: 'current_conversation',
      contextDependent: true,
      needsClarification: false,
      resolvedRequest: 'Move imports to a bounded background worker with cancellation.',
      taskResolution: {
        title: 'Move imports to a worker',
        requirements: ['Use a bounded background worker with cancellation.'],
        constraints: [],
        unresolvedDecisions: []
      }
    },
    options: [
      'Keep the current synchronous importer.',
      'Move imports to a bounded background worker with cancellation.',
      'Remove importing entirely.'
    ],
    precedingMessages: [{ role: 'assistant', text: 'I outlined three implementation options for the importer.' }],
    originConversationId: 'dispatch-options',
    timestamp: 2000
  });
  t.equal(result.success, true, 'available options resolve the reference');
  t.ok(/bounded background worker with cancellation/i.test(result.task.objective), 'the selected option becomes the durable objective');
  t.notOk(/synchronous importer/.test(result.task.objective), 'the wrong option is not selected');
  t.end();
});

test('legacy queue records migrate into the canonical packet shape', t => {
  const task = normalizeTaskRecord({
    id: 'queue_legacy',
    prompt: 'Run npm test and report the real result.',
    conversationId: 'coder-legacy',
    originConversationId: 'dispatch-legacy',
    workspacePath: 'C:\\Projects\\Legacy',
    projectPath: 'C:\\Projects\\Legacy',
    projectName: 'Legacy',
    state: 'queued',
    createdAt: 500
  });
  t.equal(task.schemaVersion, SCHEMA_VERSION, 'current schema version is applied');
  t.equal(task.taskId, 'queue_legacy', 'legacy queue id becomes the task id');
  t.equal(task.objective, 'Run npm test and report the real result.', 'legacy prompt is retained');
  t.equal(task.status, TASK_STATES.PENDING, 'queued remains pending');
  t.equal(task.origin.conversationId, 'dispatch-legacy', 'legacy owner is migrated');
  t.equal(task.target.conversationId, 'coder-legacy', 'legacy target is migrated');
  t.equal(task.workspace.role, 'active_project', 'project workspace role is inferred');
  t.notOk(Object.prototype.hasOwnProperty.call(task, 'prompt'), 'legacy raw prompt field is removed');
  const idless = { prompt: 'A legacy queue item without an ID.', conversationId: 'coder-idless', createdAt: 500 };
  t.equal(
    normalizeTaskRecord(idless).taskId,
    normalizeTaskRecord(idless).taskId,
    'idless legacy records receive a deterministic migration ID'
  );
  t.end();
});

test('task transitions and status descriptions preserve factual state', t => {
  const pending = normalizeTaskRecord(baseTask());
  const active = transitionTask(pending, TASK_STATES.ACTIVE, { timestamp: 1100 });
  const cancelled = transitionTask(active, TASK_STATES.CANCELLED, {
    timestamp: 1200,
    reason: 'User stopped this task.',
    requestedByConversationId: 'dispatch-1'
  });
  t.equal(active.status, TASK_STATES.ACTIVE, 'pending task becomes active');
  t.equal(cancelled.status, TASK_STATES.CANCELLED, 'active task becomes cancelled');
  t.equal(cancelled.cancellation.requestedByConversationId, 'dispatch-1', 'cancellation provenance is retained');
  t.equal(describeTaskStatus(pending), 'Queued — waiting to start.', 'queued is not described as running');
  t.equal(describeTaskStatus(active), 'Running.', 'active is described as running');
  t.ok(/^Cancelled/.test(describeTaskStatus(cancelled)), 'cancelled is not described as completed');
  t.throws(() => transitionTask(cancelled, TASK_STATES.COMPLETED), /Invalid task transition/, 'cancelled work cannot later complete');
  t.throws(() => transitionTask(pending, 'mystery'), /Unknown task state/, 'unknown states cannot silently become pending');
  t.end();
});

test('automatic action-boundary checkpoints persist their restart policy and continuation packet', t => {
  const active = transitionTask(normalizeTaskRecord(baseTask()), TASK_STATES.ACTIVE, {
    timestamp: 1100,
    executionId: 'exec-auto-boundary'
  });
  const pending = transitionTask(active, TASK_STATES.PENDING, {
    timestamp: 1200,
    expectedExecutionId: 'exec-auto-boundary',
    reason: 'Execution pass checkpointed after verified progress.',
    reasonCode: 'automatic_action_boundary',
    resumePolicy: 'automatic',
    continuation: {
      input: '[ORION INTERNAL CONTINUATION] Continue from the durable checkpoint.',
      source: 'automatic-action-boundary',
      createdAt: 1200
    }
  });

  t.equal(pending.status, TASK_STATES.PENDING, 'the boundary remains a non-terminal pending state');
  t.equal(pending.execution.resumePolicy, 'automatic', 'the durable task distinguishes automatic continuation from a user pause');
  t.equal(pending.execution.reasonCode, 'automatic_action_boundary', 'the pending reason is machine-readable');
  t.match(pending.continuation.input, /durable checkpoint/i, 'the next-pass directive survives outside the renderer queue');
  t.equal(pending.continuation.source, 'automatic-action-boundary', 'continuation provenance is retained');
  t.equal(pendingTaskNeedsRuntimeQueue(pending), true, 'restart recovery requeues an automatic checkpoint');
  t.equal(
    pendingTaskNeedsRuntimeQueue({ ...pending, execution: { ...pending.execution, resumePolicy: 'user' } }),
    false,
    'restart recovery does not launch work that is waiting for the user'
  );
  t.equal(
    pendingTaskNeedsRuntimeQueue(normalizeTaskRecord(baseTask({ taskId: 'fresh-pending' }))),
    true,
    'a fresh never-claimed pending task is restored to the runtime queue'
  );
  t.equal(
    deriveTaskTitle('Fix the retirement controller integration and verify the end-to-end flow.', 'GRITLIFE'),
    'GRITLIFE — Fix the retirement controller integration and verify the end-to-end flow',
    'resolved objectives produce useful human task titles without a generic Dispatch placeholder'
  );
  const migratedTitle = normalizeTaskRecord(baseTask({
    title: 'Execute Dispatch request',
    objective: 'Fix the retirement controller integration and verify it.'
  })).title;
  t.match(migratedTitle, /retirement controller integration/i, 'persisted generic titles migrate from their durable objective');
  t.notEqual(migratedTitle, 'Execute Dispatch request', 'an existing generic title no longer survives reload');
  t.end();
});

test('Dispatch task presentation follows one durable task from queued through planning and review', t => {
  const pending = normalizeTaskRecord(baseTask({
    taskId: 'task_dispatch_phone_lifecycle',
    origin: { conversationId: 'dispatch-1', sessionId: 'dispatch-1', messageId: 'message-1' },
    target: { conversationId: 'coder-1', sessionId: 'coder-1', mode: 'coder' }
  }));
  const selectedPending = selectSupervisedTask([pending], 'dispatch-1', pending.taskId);
  const queued = describeSupervisedTaskPresentation(selectedPending);
  t.equal(selectedPending.taskId, pending.taskId, 'Dispatch selects the durable task by task ID');
  t.equal(queued.label, 'Coder queued', 'pending is presented as Coder queued');

  const autoPending = {
    ...pending,
    execution: { attempt: 1, state: 'pending', resumePolicy: 'automatic' }
  };
  const continuing = describeSupervisedTaskPresentation(autoPending);
  t.equal(continuing.label, 'Coder continuing', 'automatic pending work is not presented as a manual pause');
  t.equal(continuing.phase, 'continuing', 'the UI receives an explicit automatic-continuation phase');

  const active = transitionTask(pending, TASK_STATES.ACTIVE, { timestamp: 1100 });
  const selectedActive = selectSupervisedTask([active], 'dispatch-1', active.taskId);
  const planning = describeSupervisedTaskPresentation(selectedActive);
  t.equal(selectedActive.taskId, pending.taskId, 'claiming work preserves the task identity');
  t.equal(planning.label, 'Coder planning', 'active pre-approval work is presented as Coder planning');

  const yieldedForReview = transitionTask(active, TASK_STATES.PENDING, {
    timestamp: 1200,
    expectedExecutionId: active.execution.executionId,
    reason: 'Waiting for plan approval.'
  });
  const selectedReview = selectSupervisedTask([yieldedForReview], 'dispatch-1', yieldedForReview.taskId);
  const review = describeSupervisedTaskPresentation(selectedReview, { awaitingReview: true });
  t.equal(selectedReview.taskId, pending.taskId, 'review remains attached to the original task');
  t.equal(review.label, 'Review', 'the same task transitions to Review when the plan arrives');

  const implementing = describeSupervisedTaskPresentation(active, { planApproved: true });
  t.equal(implementing.label, 'Coder implementing', 'approved active work is presented as Coder implementing');
  t.end();
});

test('newer continuation tasks supersede exact pending predecessors without title guessing', t => {
  const predecessor = normalizeTaskRecord(baseTask({
    taskId: 'task_polish_original',
    title: 'Full Polish Pass',
    createdAt: 1000,
    updatedAt: 1200
  }));
  const structuredSuccessor = normalizeTaskRecord(baseTask({
    taskId: 'task_polish_continuation',
    title: 'Full Polish Pass',
    objective: 'Finish the remaining polish work.',
    supersedesTaskId: predecessor.taskId,
    status: 'completed',
    createdAt: 2000,
    updatedAt: 3000
  }));
  const unrelatedSameTitle = normalizeTaskRecord(baseTask({
    taskId: 'task_polish_unrelated',
    title: 'Full Polish Pass',
    origin: { conversationId: 'dispatch-other', sessionId: 'dispatch-other', messageId: 'message-other' },
    createdAt: 4000,
    updatedAt: 4000
  }));
  const tasks = [predecessor, structuredSuccessor, unrelatedSameTitle];

  const supersessions = findTaskSupersessions(tasks);
  t.equal(supersessions.length, 1, 'only an exact same-owner predecessor relationship is recognized');
  t.equal(supersessions[0].task.taskId, predecessor.taskId, 'the stale pending predecessor is identified');
  t.equal(supersessions[0].supersedingTask.taskId, structuredSuccessor.taskId, 'the replacement task remains authoritative');
  t.deepEqual(
    filterSupersededTasks(tasks).map(task => task.taskId).sort(),
    [structuredSuccessor.taskId, unrelatedSameTitle.taskId].sort(),
    'same-title work is preserved unless exact provenance links it'
  );
  t.equal(
    selectSupervisedTask(tasks, 'dispatch-1', predecessor.taskId).taskId,
    structuredSuccessor.taskId,
    'an obsolete preferred task ID cannot override its newer completed continuation'
  );
  t.end();
});

test('schema-v1 replacement objectives recover exact predecessor task IDs mechanically', t => {
  const predecessor = normalizeTaskRecord(baseTask({
    taskId: 'task_legacy_polish',
    createdAt: 1000,
    updatedAt: 1500
  }));
  const successor = normalizeTaskRecord(baseTask({
    taskId: 'task_legacy_polish_resume',
    objective: `Resume the Full Polish Pass task (${predecessor.taskId}) and finish verification.`,
    status: 'completed',
    createdAt: 2000,
    updatedAt: 2500
  }));
  const supersessions = findTaskSupersessions([predecessor, successor]);
  t.equal(supersessions.length, 1, 'an exact machine task ID migrates legacy continuation lineage');
  t.equal(supersessions[0].source, 'legacy_exact_task_id', 'legacy recovery is recorded as format parsing');
  t.end();
});

test('active tasks can yield and resume under a new execution generation', t => {
  const pending = normalizeTaskRecord(baseTask({ taskId: 'task_yield_resume' }));
  const firstRun = transitionTask(pending, TASK_STATES.ACTIVE, { timestamp: 1100 });
  t.equal(firstRun.execution.attempt, 1, 'first claim records execution attempt one');
  t.equal(firstRun.execution.executionId, 'task_yield_resume:run:1', 'first claim has a stable execution ID');
  t.throws(
    () => transitionTask(firstRun, TASK_STATES.ACTIVE, { timestamp: 1101 }),
    error => error && error.code === 'TASK_ALREADY_ACTIVE',
    'a second runner cannot claim an already active task'
  );

  const yielded = transitionTask(firstRun, TASK_STATES.PENDING, {
    timestamp: 1200,
    expectedExecutionId: firstRun.execution.executionId,
    reason: 'Waiting for plan approval.'
  });
  t.equal(yielded.status, TASK_STATES.PENDING, 'active work can return to pending at a meaningful boundary');
  t.equal(yielded.execution.state, TASK_STATES.PENDING, 'execution metadata records the yield');
  t.equal(yielded.execution.reason, 'Waiting for plan approval.', 'yield reason is durable');

  const secondRun = transitionTask(yielded, TASK_STATES.ACTIVE, { timestamp: 1300 });
  t.equal(secondRun.execution.attempt, 2, 'resumption increments the execution generation');
  t.equal(secondRun.execution.executionId, 'task_yield_resume:run:2', 'resumption receives a distinct execution ID');
  t.throws(
    () => transitionTask(secondRun, TASK_STATES.COMPLETED, { timestamp: 1350, result: 'unowned result' }),
    error => error && error.code === 'TASK_EXECUTION_ID_REQUIRED',
    'an unscoped callback cannot finalize active work'
  );
  t.throws(
    () => transitionTask(secondRun, TASK_STATES.COMPLETED, {
      timestamp: 1400,
      expectedExecutionId: firstRun.execution.executionId,
      result: 'stale result'
    }),
    error => error && error.code === 'STALE_TASK_EXECUTION',
    'a callback from the earlier execution cannot complete the resumed task'
  );
  const completed = transitionTask(secondRun, TASK_STATES.COMPLETED, {
    timestamp: 1500,
    expectedExecutionId: secondRun.execution.executionId,
    result: 'verified result'
  });
  t.equal(completed.result, 'verified result', 'the current execution can record its verified result');
  const replayed = transitionTask(completed, TASK_STATES.COMPLETED, {
    timestamp: 1600,
    result: 'late replacement'
  });
  t.equal(replayed.result, 'verified result', 'a replayed terminal transition cannot overwrite the original result');
  t.equal(replayed.updatedAt, completed.updatedAt, 'a replayed terminal transition does not falsify the completion time');
  t.end();
});

test('task control is scoped to origin, target, or origin session', t => {
  const task = normalizeTaskRecord(baseTask());
  t.equal(canRequesterControlTask(task, 'dispatch-1'), true, 'origin Dispatch conversation controls its task');
  t.equal(canRequesterControlTask(task, { conversationId: 'coder-1' }), true, 'target Coder conversation controls its task');
  t.equal(canRequesterControlTask(task, { sessionId: 'session-1' }), true, 'origin session can recover control when no conversation id is available');
  t.equal(canRequesterControlTask(task, { conversationId: 'dispatch-unrelated', sessionId: 'session-1' }), false, 'an unrelated conversation cannot borrow session authority');
  t.equal(canRequesterControlTask(task, 'coder-unrelated'), false, 'unrelated Coder cannot cancel the task');
  t.end();
});

test('task store serializes concurrent same-timestamp writes and reloads deterministically', async t => {
  const now = () => 9000;
  const { filePath, store } = makeTempStore(t, { now });
  const secondStore = new OrchestrationTaskStore({ filePath, now });
  const ids = ['task_delta', 'task_alpha', 'task_charlie', 'task_bravo'];
  await Promise.all(ids.map((taskId, index) => (index % 2 ? store : secondStore).create(baseTask({
    taskId,
    title: taskId,
    createdAt: 9000,
    updatedAt: 9000,
    origin: { conversationId: `dispatch-${index}`, sessionId: '', messageId: `message-${index}` },
    target: { conversationId: `coder-${index}`, mode: 'coder' }
  }))));

  const reloaded = new OrchestrationTaskStore({ filePath, now });
  const tasks = await reloaded.list();
  t.equal(tasks.length, 4, 'no concurrent write overwrote another task');
  t.deepEqual(tasks.map(task => task.taskId), [...ids].sort(), 'same-time records use task ID as deterministic tie-breaker');
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  t.equal(persisted.schemaVersion, SCHEMA_VERSION, 'store persists its schema');
  t.equal(persisted.tasks.length, 4, 'all records exist on disk');
  t.end();
});

test('same-millisecond task creation generates unique IDs without relying on legacy hashes', async t => {
  const { store } = makeTempStore(t, { now: () => 9100 });
  const record = baseTask({
    taskId: undefined,
    createdAt: 9100,
    updatedAt: 9100,
    title: 'Identical new task',
    objective: 'Run the same independently requested operation.'
  });
  const [first, second] = await Promise.all([store.create(record), store.create(record)]);
  t.notEqual(first.taskId, second.taskId, 'each new task receives a unique ID even with identical content and time');
  t.equal((await store.list()).length, 2, 'both same-millisecond tasks survive persistence');
  t.end();
});

test('concurrent store claims allow exactly one runner', async t => {
  const { filePath, store } = makeTempStore(t, { now: () => 9300 });
  const peer = new OrchestrationTaskStore({ filePath, now: () => 9300 });
  await store.create(baseTask({ taskId: 'task_single_claim' }));
  const results = await Promise.allSettled([
    store.transition('task_single_claim', TASK_STATES.ACTIVE),
    peer.transition('task_single_claim', TASK_STATES.ACTIVE)
  ]);
  t.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'one claim succeeds');
  t.equal(results.filter(result => result.status === 'rejected').length, 1, 'one duplicate claim is rejected');
  const rejected = results.find(result => result.status === 'rejected');
  t.equal(rejected.reason.code, 'TASK_ALREADY_ACTIVE', 'duplicate claim has an actionable error code');
  t.equal((await store.get('task_single_claim')).status, TASK_STATES.ACTIVE, 'the canonical task remains active once');
  t.end();
});

test('store rejects lifecycle bypasses and provenance rewrites', async t => {
  const { store } = makeTempStore(t, { now: () => 9400 });
  await store.create(baseTask({ taskId: 'task_guarded_update' }));
  const lifecycleError = await captureRejection(store.update('task_guarded_update', { status: TASK_STATES.COMPLETED }));
  t.equal(lifecycleError && lifecycleError.code, 'TASK_LIFECYCLE_UPDATE_FORBIDDEN', 'status cannot bypass transition validation');
  const provenanceError = await captureRejection(store.update('task_guarded_update', {
    origin: { conversationId: 'dispatch-stranger', sessionId: '', messageId: '' }
  }));
  t.equal(provenanceError && provenanceError.code, 'IMMUTABLE_TASK_PROVENANCE', 'ownership provenance cannot be reassigned');
  const updated = await store.update('task_guarded_update', { title: 'Clarified task title' });
  t.equal(updated.title, 'Clarified task title', 'safe descriptive metadata remains editable before completion');
  const active = await store.transition('task_guarded_update', TASK_STATES.ACTIVE);
  await store.transition('task_guarded_update', TASK_STATES.COMPLETED, {
    result: 'done',
    expectedExecutionId: active.execution.executionId
  });
  const terminalError = await captureRejection(store.update('task_guarded_update', { title: 'Late rewrite' }));
  t.equal(terminalError && terminalError.code, 'TASK_ALREADY_TERMINAL', 'terminal task records cannot be rewritten');
  t.end();
});

test('new task creation starts pending and persisted unknown states fail closed', async t => {
  const { filePath, store } = makeTempStore(t, { now: () => 9500 });
  const invalidInitial = await captureRejection(store.create(baseTask({ taskId: 'task_forged_done', status: 'completed' })));
  t.equal(invalidInitial && invalidInitial.code, 'INVALID_INITIAL_TASK_STATE', 'callers cannot create a task that pretends to be completed');
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    revision: 0,
    updatedAt: 9500,
    tasks: [baseTask({ taskId: 'task_unknown_state', status: 'finised' })]
  }));
  const corrupt = await store.get('task_unknown_state');
  t.equal(corrupt.status, TASK_STATES.FAILED, 'an unknown persisted state is not resurrected as pending work');
  t.equal(corrupt.failure.code, 'invalid_persisted_status', 'the corruption remains explicit and inspectable');
  const filterError = await captureRejection(store.list({ status: 'finised' }));
  t.equal(filterError && filterError.code, 'UNKNOWN_TASK_STATE', 'unknown status filters fail instead of being treated as pending');
  t.end();
});

test('store cancellation enforces ownership for pending and active tasks', async t => {
  let now = 10000;
  const { store } = makeTempStore(t, { now: () => ++now });
  await store.create(baseTask({ taskId: 'task_pending_cancel' }));
  await store.create(baseTask({ taskId: 'task_active_cancel' }));
  await store.transition('task_active_cancel', TASK_STATES.ACTIVE);

  const forbidden = await captureRejection(
    store.cancel('task_pending_cancel', { conversationId: 'dispatch-stranger' }, 'Not mine.')
  );
  t.equal(forbidden && forbidden.code, 'TASK_CONTROL_FORBIDDEN', 'unrelated conversation cannot cancel pending work');
  const pendingResult = await store.cancel('task_pending_cancel', 'dispatch-1', 'New focus superseded it.');
  t.equal(pendingResult.wasActive, false, 'pending cancellation does not claim a running process');
  t.equal(pendingResult.task.status, TASK_STATES.CANCELLED, 'pending task is terminally cancelled');

  const activeResult = await store.cancel('task_active_cancel', { conversationId: 'dispatch-1' }, 'Stop requested.');
  t.equal(activeResult.wasActive, true, 'caller is told cooperative abort is needed');
  t.equal(activeResult.task.status, TASK_STATES.CANCELLED, 'running task receives explicit cancelled state');
  t.throws(
    () => transitionTask(activeResult.task, TASK_STATES.COMPLETED),
    /Invalid task transition/,
    'stale completion cannot overwrite cancellation'
  );
  const repeatedCancel = await store.cancel('task_active_cancel', { conversationId: 'dispatch-1' }, 'Stop requested again.');
  t.equal(repeatedCancel.alreadyCancelled, true, 'repeated cancellation is idempotent and keeps a stable result shape');
  t.end();
});

test('store removes pending records but refuses to orphan active work', async t => {
  const { store } = makeTempStore(t, { now: () => 12000 });
  await store.create(baseTask({ taskId: 'task_remove_pending' }));
  await store.create(baseTask({ taskId: 'task_remove_active' }));
  await store.transition('task_remove_active', TASK_STATES.ACTIVE);
  const removed = await store.remove('task_remove_pending', 'dispatch-1');
  t.equal(removed.taskId, 'task_remove_pending', 'pending task is removable');
  const activeRemoval = await captureRejection(store.remove('task_remove_active', 'dispatch-1'));
  t.equal(activeRemoval && activeRemoval.code, 'TASK_ACTIVE', 'active task must be cancelled before removal');
  t.equal((await store.list()).length, 1, 'only the active record remains');
  t.end();
});

test('restart reconciliation fails interrupted active work without touching other states', async t => {
  let now = 15000;
  const { filePath, store } = makeTempStore(t, { now: () => ++now });
  await store.create(baseTask({ taskId: 'task_interrupted' }));
  await store.create(baseTask({ taskId: 'task_still_pending' }));
  await store.create(baseTask({ taskId: 'task_already_done' }));
  await store.transition('task_interrupted', TASK_STATES.ACTIVE);
  const activeDone = await store.transition('task_already_done', TASK_STATES.ACTIVE);
  await store.transition('task_already_done', TASK_STATES.COMPLETED, {
    result: 'Verified.',
    expectedExecutionId: activeDone.execution.executionId
  });

  const restarted = new OrchestrationTaskStore({ filePath, now: () => ++now });
  const reconciled = await restarted.reconcileInterrupted();
  t.deepEqual(reconciled.map(task => task.taskId), ['task_interrupted'], 'only active work is reconciled');
  const interrupted = await restarted.get('task_interrupted');
  t.equal(interrupted.status, TASK_STATES.FAILED, 'interrupted active task becomes failed, not completed');
  t.equal(interrupted.failure.code, 'interrupted', 'failure records restart interruption explicitly');
  t.equal((await restarted.get('task_still_pending')).status, TASK_STATES.PENDING, 'pending work stays pending');
  t.equal((await restarted.get('task_already_done')).status, TASK_STATES.COMPLETED, 'completed work stays completed');
  t.end();
});

test('restart reconciliation cancels a pending predecessor replaced by a newer completed continuation', async t => {
  let now = 17000;
  const { store } = makeTempStore(t, { now: () => ++now });
  await store.create(baseTask({
    taskId: 'task_stale_predecessor',
    createdAt: 1000,
    updatedAt: 1000
  }));
  await store.create(baseTask({
    taskId: 'task_completed_replacement',
    supersedesTaskId: 'task_stale_predecessor',
    createdAt: 2000,
    updatedAt: 2000
  }));
  const activeReplacement = await store.transition('task_completed_replacement', TASK_STATES.ACTIVE);
  await store.transition('task_completed_replacement', TASK_STATES.COMPLETED, {
    expectedExecutionId: activeReplacement.execution.executionId,
    result: { summary: 'Verified replacement completed.' }
  });

  const reconciled = await store.reconcileInterrupted();
  const predecessor = await store.get('task_stale_predecessor');
  t.equal(predecessor.status, TASK_STATES.CANCELLED, 'obsolete pending work cannot survive as queued');
  t.equal(predecessor.supersededByTaskId, 'task_completed_replacement', 'the authoritative replacement is recorded');
  t.match(predecessor.cancellation.reason, /Superseded by continuation task/, 'the terminal reason explains reconciliation');
  t.ok(reconciled.some(task => task.taskId === predecessor.taskId), 'the reconciliation receipt includes the changed predecessor');
  const reloadedStore = new OrchestrationTaskStore({
    filePath: store.filePath,
    now: () => ++now
  });
  t.equal(
    (await reloadedStore.get('task_stale_predecessor')).supersededByTaskId,
    'task_completed_replacement',
    'supersession provenance survives a process restart'
  );
  t.equal(
    selectSupervisedTask(await reloadedStore.list(), 'dispatch-1', '').taskId,
    'task_completed_replacement',
    'the cancelled predecessor cannot replace the completed successor in the UI after reconciliation'
  );
  t.end();
});

test('legacy array store migrates and preserves deterministic records', async t => {
  const { filePath, store } = makeTempStore(t, { now: () => 20000 });
  fs.writeFileSync(filePath, JSON.stringify([
    { id: 'legacy_b', prompt: 'Run tests.', conversationId: 'coder-b', state: 'running', createdAt: 100 },
    { id: 'legacy_a', prompt: 'Inspect status.', conversationId: 'coder-a', state: 'queued', createdAt: 100 }
  ]));
  const migration = await store.migrate();
  t.equal(migration.taskCount, 2, 'both legacy entries migrate');
  const tasks = await store.list();
  t.deepEqual(tasks.map(task => task.taskId), ['legacy_a', 'legacy_b'], 'migrated entries have deterministic order');
  t.deepEqual(tasks.map(task => task.status), [TASK_STATES.PENDING, TASK_STATES.ACTIVE], 'legacy statuses retain their real meaning');
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  t.ok(!Array.isArray(persisted), 'legacy array is replaced with schema envelope');
  t.equal(persisted.schemaVersion, SCHEMA_VERSION, 'migrated store uses current schema');
  t.end();
});

test('idless and string legacy tasks keep stable IDs until migration persists them', async t => {
  const { filePath, store } = makeTempStore(t, { now: () => 21000 });
  fs.writeFileSync(filePath, JSON.stringify([
    'Run the complete test suite.',
    { prompt: 'Inspect the pull request state.', conversationId: 'coder-legacy' }
  ]));
  const firstRead = await store.list();
  const secondRead = await store.list();
  t.equal(firstRead.length, 2, 'string-form legacy queue entries are retained');
  t.ok(firstRead[0].objective || firstRead[1].objective, 'string entry becomes a real task objective');
  t.deepEqual(
    secondRead.map(task => task.taskId),
    firstRead.map(task => task.taskId),
    'idless legacy IDs stay stable across read operations before migration'
  );
  await store.migrate();
  const migrated = await store.list();
  t.deepEqual(
    migrated.map(task => task.taskId),
    firstRead.map(task => task.taskId),
    'migration persists the same IDs that callers already observed'
  );
  t.ok(migrated.some(task => /complete test suite/i.test(task.objective)), 'string-form objective survives migration');
  t.end();
});

test('task store recovers an interrupted atomic replacement from a sibling file', async t => {
  const { filePath, store } = makeTempStore(t, { now: () => 22000 });
  await store.create(baseTask({ taskId: 'task_before_crash' }));
  const backupPath = `${filePath}.bak-simulated-crash`;
  fs.renameSync(filePath, backupPath);

  const recoveredStore = new OrchestrationTaskStore({ filePath, now: () => 22000 });
  const recovered = await recoveredStore.get('task_before_crash');
  t.equal(recovered && recovered.taskId, 'task_before_crash', 'a valid atomic-write sibling prevents silent queue loss');
  await recoveredStore.create(baseTask({ taskId: 'task_after_crash' }));
  t.deepEqual(
    (await recoveredStore.list()).map(task => task.taskId),
    ['task_after_crash', 'task_before_crash'],
    'the next mutation restores a canonical store containing recovered and new tasks'
  );
  t.ok(fs.existsSync(filePath), 'canonical task store is recreated');
  t.end();
});

test('IPC task lifecycle preserves ownership and reports claim races', async t => {
  const { filePath } = makeTempStore(t, { now: () => 23000 });
  const handlers = new Map();
  registerHandlers({
    handle(name, handler) { handlers.set(name, handler); }
  }, { filePath });
  const invoke = (name, payload) => handlers.get(name)({}, payload);

  const created = await invoke('orion:create-task', baseTask({ taskId: 'task_ipc_contract' }));
  t.equal(created.success, true, 'IPC creates the pending task');
  t.equal(created.task.status, TASK_STATES.PENDING, 'IPC does not claim queued work is running');
  const active = await invoke('orion:transition-task', {
    taskId: 'task_ipc_contract',
    status: TASK_STATES.ACTIVE,
    details: {}
  });
  t.equal(active.success, true, 'first IPC claim succeeds');
  const duplicate = await invoke('orion:transition-task', {
    taskId: 'task_ipc_contract',
    status: TASK_STATES.ACTIVE,
    details: {}
  });
  t.equal(duplicate.success, false, 'second IPC claim is rejected');
  t.equal(duplicate.code, 'TASK_ALREADY_ACTIVE', 'claim race is surfaced structurally');
  const forbidden = await invoke('orion:cancel-task', {
    taskId: 'task_ipc_contract',
    requester: { conversationId: 'dispatch-unrelated' },
    reason: 'Not mine.'
  });
  t.equal(forbidden.success, false, 'unrelated conversation cannot cancel through IPC');
  t.equal(forbidden.code, 'TASK_CONTROL_FORBIDDEN', 'IPC preserves ownership failure code');
  const cancelled = await invoke('orion:cancel-task', {
    taskId: 'task_ipc_contract',
    requester: { conversationId: 'dispatch-1' },
    reason: 'User stopped it.'
  });
  t.equal(cancelled.success, true, 'owning Dispatch can cancel through IPC');
  t.equal(cancelled.task.status, TASK_STATES.CANCELLED, 'IPC returns the explicit terminal cancellation state');
  t.end();
});
