'use strict';

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  TASK_STATES,
  isContextDependentRequest,
  buildTaskPacket,
  normalizeTaskRecord,
  transitionTask,
  canRequesterControlTask,
  renderTaskPrompt,
  describeTaskStatus
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

test('context-dependent request detection covers durable-reference phrases', t => {
  ['Let\'s do it', 'Go ahead', 'Fix that', 'Use the second one', 'Make it like we discussed', 'Continue', 'Ship it',
    'Yes', 'yes.', 'Yeah, do it', 'Yes, go ahead', 'Route it', 'Confirmed']
    .forEach(value => t.equal(isContextDependentRequest(value), true, `${value} depends on earlier context`));
  t.equal(isContextDependentRequest('Implement a CSV export for account reports.'), false, 'self-contained work is not marked contextual');
  t.equal(isContextDependentRequest('How do I fix that kind of error in general?'), false, 'a general instructional question is not mistaken for a queued reference');
  t.equal(isContextDependentRequest('Yesterday the build failed'), false, 'words that merely start with an affirmation are not confirmations');
  t.end();
});

test('GRITLIFE contextual approval resolves to a self-contained task packet', t => {
  const projectPath = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';
  const result = buildTaskPacket({
    taskId: 'task_gritlife_enrollments',
    originalUserMessage: "Let's do it",
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

test('unresolvable option reference asks a targeted question and creates no task', t => {
  const result = buildTaskPacket({
    originalUserMessage: 'Use the second one',
    precedingMessages: []
  });
  t.equal(result.success, false, 'resolution fails honestly');
  t.equal(result.needsClarification, true, 'clarification is required');
  t.equal(result.task, null, 'no invented task is returned');
  t.ok(/Which option/i.test(result.clarification), 'question targets the missing choice');
  t.ok(/do not have the referenced choices/i.test(result.clarification), 'question explains the evidence gap');
  t.end();
});

test('option reference resolves when the preceding choices are present', t => {
  const result = buildTaskPacket({
    taskId: 'task_option_two',
    originalUserMessage: 'Use the second one',
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
  t.equal(task.schemaVersion, 1, 'current schema version is applied');
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
  t.equal(persisted.schemaVersion, 1, 'store persists its schema');
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
  t.equal(persisted.schemaVersion, 1, 'migrated store uses current schema');
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
