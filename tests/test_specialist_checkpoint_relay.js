'use strict';

// Dispatch's relay to the user is the surface where the lifecycle bug was actually visible: a
// specialist would start a long-running suite, schedule a follow-up, checkpoint with "Pending:
// suite -> commit -> push", and Dispatch would still announce "Coder completed ...". Dispatch was
// not lying -- it trusts the durable task state, and the durable task state was wrong.
//
// The fix splits the two events apart. onOrchestrationTaskFinalized stays terminal-only
// (completed/failed/cancelled). A pending pass with real progress goes through a separate
// checkpoint relay instead. These tests exercise the real renderer against real task shapes, so a
// regression that reintroduces "completed" wording for pending work fails here.

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');

const DISPATCH_ID = 'dispatch-owner';

function dispatchConversation(overrides = {}) {
  return {
    id: DISPATCH_ID,
    title: 'Push all updates for Orion to GitHub',
    mode: 'orion',
    messages: [],
    tasks: [],
    ...overrides
  };
}

function specialistConversation(mode, overrides = {}) {
  return {
    id: mode + '-worker',
    title: mode + ' work',
    mode,
    messages: [],
    tasks: [],
    ...overrides
  };
}

function pendingScheduledTask(mode, overrides = {}) {
  return {
    taskId: 'task-checkpoint-1',
    title: 'Push all updates for Orion to GitHub',
    status: 'pending',
    origin: { conversationId: DISPATCH_ID, sessionId: '', messageId: '' },
    rootOriginConversationId: DISPATCH_ID,
    target: { conversationId: mode + '-worker', sessionId: '', messageId: '', mode },
    execution: {
      attempt: 1,
      executionId: 'exec-1',
      state: 'pending',
      reasonCode: 'scheduled_followup',
      resumePolicy: 'scheduled'
    },
    checkpoint: {
      checkpointId: 'task-checkpoint-1:checkpoint:1:1700000000000',
      attempt: 1,
      summary: 'Tests are still running and green so far.',
      result: { summary: 'Tests are still running and green so far.', verification: ['npm test active'] },
      reason: 'The suite has not finished yet.',
      reasonCode: 'scheduled_followup',
      resumePolicy: 'scheduled',
      schedule: {
        scheduleId: 'schedule-suite-check',
        sourceTaskId: 'task-checkpoint-1',
        dueAt: 1700000120000,
        nextRunAt: 1700000120000,
        purpose: 'test-progress'
      },
      checkpointedAt: 1700000000000
    },
    updatedAt: 1700000000000,
    ...overrides
  };
}

function bootRelay(t, { mode = 'coder', task = null, extraApi = {} } = {}) {
  const resolved = task || pendingScheduledTask(mode);
  const loaded = loadRenderer({
    t,
    set: {
      conversations: [dispatchConversation(), specialistConversation(mode)],
      activeConversationId: DISPATCH_ID
    },
    api: {
      getOrchestrationTask: async () => ({ success: true, task: resolved }),
      ...extraApi
    }
  });
  return { ...loaded, task: resolved };
}

function messagesFor(read, source) {
  const conversations = read('conversations') || [];
  const dispatch = conversations.find(item => item.id === DISPATCH_ID) || { messages: [] };
  return (dispatch.messages || []).filter(message => !source || message.source === source);
}

test('a pending checkpoint reaches Dispatch as progress, never as completion', async (t) => {
  const { win, read } = bootRelay(t);
  await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});

  const checkpoints = messagesFor(read, 'supervisor-checkpoint');
  t.equal(checkpoints.length, 1, 'Dispatch receives exactly one checkpoint message');

  const text = checkpoints[0].text;
  t.match(text, /Coder checkpoint/i, 'the message is labelled a checkpoint and names the role');
  t.match(text, /Push all updates for Orion to GitHub/, 'it names the mission it belongs to');
  t.match(text, /Tests are still running and green so far/, 'it carries the specialist summary');
  t.match(text, /remains pending/i, 'it states plainly that the mission is not finished');
  t.match(text, /Next check is scheduled/i, 'it says when the mission continues');

  // The regression itself.
  t.doesNotMatch(text, /Coder completed/i, 'a pending task is never announced as completed');
  t.doesNotMatch(text, /\bcompleted\b/i, 'the completion word does not appear at all for pending work');

  t.equal(messagesFor(read, 'supervisor-completion').length, 0,
    'no terminal completion receipt is written for a pending task');
  t.equal(checkpoints[0].orchestrationTaskId, 'task-checkpoint-1', 'the message is bound to the durable task');
  t.equal(checkpoints[0].checkpointReasonCode, 'scheduled_followup', 'the structured reason rides along');
  t.end();
});

test('the checkpoint relay is generic across specialist roles, with no Coder special case', async (t) => {
  for (const [mode, label] of [['coder', 'Coder'], ['operator', 'Operator'], ['researcher', 'Researcher']]) {
    const { win, read } = bootRelay(t, { mode });
    await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', mode + '-worker', {});
    const checkpoints = messagesFor(read, 'supervisor-checkpoint');
    t.equal(checkpoints.length, 1, label + ' gets one checkpoint message');
    t.match(checkpoints[0].text, new RegExp(label + ' checkpoint', 'i'), label + ' is named by its own role');
    t.doesNotMatch(checkpoints[0].text, new RegExp(label + ' completed', 'i'),
      label + ' pending work is never announced as completed');
    t.equal(checkpoints[0].specialistRole, mode, 'the relay records which specialist checkpointed');
  }
  t.end();
});

test('replaying the same checkpoint does not spam Dispatch with duplicates', async (t) => {
  const { win, read } = bootRelay(t);
  await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});
  await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});
  await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});
  t.equal(messagesFor(read, 'supervisor-checkpoint').length, 1,
    'one pass produces one checkpoint no matter how many times the relay is replayed');
  t.end();
});

test('a genuinely new checkpoint on the same task is still delivered', async (t) => {
  // The task the store returns changes between passes, exactly as it does live.
  let current = pendingScheduledTask('coder');
  const { win, read } = loadRenderer({
    t,
    set: {
      conversations: [dispatchConversation(), specialistConversation('coder')],
      activeConversationId: DISPATCH_ID
    },
    api: { getOrchestrationTask: async () => ({ success: true, task: current }) }
  });
  await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});

  // Second pass on the SAME task: new attempt, new checkpoint identity.
  const second = pendingScheduledTask('coder');
  second.execution.attempt = 2;
  second.checkpoint = {
    ...second.checkpoint,
    checkpointId: 'task-checkpoint-1:checkpoint:2:1700000300000',
    attempt: 2,
    summary: 'Suite finished; committing now.'
  };
  current = second;

  await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});
  const checkpoints = messagesFor(read, 'supervisor-checkpoint');
  t.equal(checkpoints.length, 2, 'a distinct later checkpoint is not swallowed by the duplicate guard');
  t.match(checkpoints[1].text, /Suite finished/, 'the newer progress is what Dispatch sees second');
  t.end();
});

test('the checkpoint relay refuses to run for a task that is no longer pending', async (t) => {
  for (const status of ['completed', 'failed', 'cancelled', 'active']) {
    const { win, read } = bootRelay(t, { task: pendingScheduledTask('coder', { status }) });
    await win.onOrchestrationTaskCheckpointed('task-checkpoint-1', 'coder-worker', {});
    t.equal(messagesFor(read, 'supervisor-checkpoint').length, 0,
      'a ' + status + ' task produces no checkpoint message');
  }
  t.end();
});

test('the terminal relay stays terminal-only and ignores a pending state', async (t) => {
  const { win, read } = bootRelay(t);
  for (const status of ['pending', 'checkpointed', '', 'active']) {
    await win.onOrchestrationTaskFinalized('task-checkpoint-1', 'coder-worker', status);
  }
  t.equal(messagesFor(read, 'supervisor-completion').length, 0,
    'no completion receipt is produced for any nonterminal state');
  t.end();
});

test('the completion receipt refuses to fire while the durable task is still pending', async (t) => {
  const loaded = loadRenderer({
    t,
    set: {
      conversations: [
        dispatchConversation({
          launchedCoderConvId: 'coder-worker',
          launchedCoderTaskId: 'task-checkpoint-1',
          launchedCoderTaskTitle: 'Push all updates for Orion to GitHub'
        }),
        specialistConversation('coder')
      ],
      activeConversationId: DISPATCH_ID
    },
    api: {
      getOrchestrationTask: async () => ({ success: true, task: pendingScheduledTask('coder') })
    }
  });
  await loaded.win.notifySupervisorOfCoderCompletion('coder-worker', 'task-checkpoint-1');
  const messages = messagesFor(loaded.read, 'supervisor-completion');
  t.equal(messages.length, 0,
    'Dispatch does not write a completion receipt for a durable task that is still pending');
  t.end();
});

test('cancelling a task also cancels the continuations that could resurrect it', async (t) => {
  const cancelledTasks = [];
  const cancelledSchedules = [];
  const cancelledTask = pendingScheduledTask('coder', { status: 'cancelled' });
  const loaded = loadRenderer({
    t,
    set: {
      conversations: [dispatchConversation(), specialistConversation('coder')],
      activeConversationId: DISPATCH_ID
    },
    api: {
      getOrchestrationTask: async () => ({ success: true, task: cancelledTask }),
      cancelOrchestrationTask: async (taskId) => {
        cancelledTasks.push(taskId);
        return { success: true, task: cancelledTask };
      },
      cancelTaskSchedules: async (sourceTaskId) => {
        cancelledSchedules.push(sourceTaskId);
        return { success: true, cancelled: 1, scheduleIds: ['schedule-suite-check'] };
      }
    }
  });
  await loaded.win.cancelOwnedOrchestrationTask('task-checkpoint-1', DISPATCH_ID, 'Cancelled by user.');
  t.deepEqual(cancelledTasks, ['task-checkpoint-1'], 'the durable task is cancelled');
  t.deepEqual(cancelledSchedules, ['task-checkpoint-1'],
    'its task-owned schedules are cancelled in the same operation, by source task');
  t.end();
});

test('the preload bridge exposes task-scoped schedule cancellation', (t) => {
  const fs = require('fs');
  const path = require('path');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  t.ok(preload.includes('cancelTaskSchedules'),
    'the renderer can reach task-scoped cancellation through the bridge');
  t.ok(preload.includes('orion:cancel-task-schedules'),
    'it is routed to the main-process schedule store, not reimplemented in the renderer');
  t.end();
});
