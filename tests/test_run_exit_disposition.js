'use strict';

const test = require('tape');
const { resolveRunExitDisposition, resolveRunNotificationPolicy } = require('../run-exit-disposition');

test('task-owned scheduled work keeps an execution pass pending', t => {
  const schedule = {
    scheduleId: 'schedule-1',
    sourceTaskId: 'task-1',
    dueAt: 1700000120000,
    purpose: 'test completion check'
  };
  const result = resolveRunExitDisposition({ scheduledFollowup: schedule });
  t.equal(result.state, 'pending', 'the durable mission remains nonterminal');
  t.equal(result.pendingWork, true, 'scheduled work is durable pending work');
  t.equal(result.reasonCode, 'scheduled_followup', 'the reason is structured');
  t.equal(result.resumePolicy, 'scheduled', 'the clock owns resumption');
  t.equal(result.notificationKind, 'checkpoint', 'the pass emits a checkpoint, not completion');
  t.deepEqual(result.schedule, {
    scheduleId: 'schedule-1',
    sourceTaskId: 'task-1',
    dueAt: 1700000120000,
    nextRunAt: 1700000120000,
    purpose: 'test completion check'
  }, 'the schedule identity and due time remain attached');
  t.end();
});

test('terminal authority outranks a stale schedule signal', t => {
  const schedule = { scheduleId: 'schedule-1', sourceTaskId: 'task-1', dueAt: Date.now() };
  t.equal(resolveRunExitDisposition({ cancelled: true, scheduledFollowup: schedule }).state, 'cancelled',
    'cancellation remains authoritative');
  t.equal(resolveRunExitDisposition({ criticalError: new Error('boom'), scheduledFollowup: schedule }).state, 'failed',
    'a genuine run failure remains terminal');
  t.equal(resolveRunExitDisposition({}).state, 'completed',
    'mission completion is allowed only when no continuation remains');
  t.end();
});

test('existing nonterminal reasons keep their established policies', t => {
  t.deepEqual(
    resolveRunExitDisposition({ automaticContinuation: true }),
    {
      state: 'pending', pendingWork: true, reasonCode: 'automatic_action_boundary',
      resumePolicy: 'automatic', notificationKind: 'checkpoint', schedule: null
    },
    'automatic action boundaries stay pending'
  );
  t.equal(resolveRunExitDisposition({ delegatedChildTaskId: 'child-1' }).reasonCode, 'awaiting_delegated_task',
    'delegated child work stays pending');
  t.equal(resolveRunExitDisposition({ awaitingPlanApproval: true }).reasonCode, 'awaiting_plan_approval',
    'plan approval stays pending');
  t.equal(resolveRunExitDisposition({ awaitingClarification: true }).reasonCode, 'awaiting_clarification',
    'clarification stays pending');
  t.end();
});

test('user-attention reasons outrank stale background continuation signals', t => {
  t.equal(
    resolveRunExitDisposition({ awaitingClarification: true, automaticContinuation: true }).reasonCode,
    'awaiting_clarification',
    'a clarifying question cannot be hidden by auto-continuation'
  );
  t.equal(
    resolveRunExitDisposition({ awaitingPlanApproval: true, scheduledFollowup: {
      scheduleId: 'schedule-plan', sourceTaskId: 'task-plan'
    } }).reasonCode,
    'awaiting_plan_approval',
    'plan approval cannot be hidden by a scheduled follow-up'
  );
  t.equal(
    resolveRunExitDisposition({ repeatedToolFailure: true, delegatedChildTaskId: 'child-1' }).reasonCode,
    'repeated_tool_failure',
    'an actionable repeated failure cannot be hidden by delegated work'
  );
  t.equal(
    resolveRunExitDisposition({
      awaitingClarification: { questions: [{ question: 'Which device?' }] }
    }).reasonCode,
    'awaiting_clarification',
    'the structured clarification shape used by the real conversation is recognized'
  );
  t.equal(
    resolveRunExitDisposition({ awaitingClarification: {} }).reasonCode,
    'mission_complete',
    'an arbitrary truthy object cannot manufacture a clarification boundary'
  );
  t.end();
});

test('notification policy distinguishes user attention from background pending work', t => {
  const question = resolveRunNotificationPolicy(resolveRunExitDisposition({ awaitingClarification: true }));
  t.deepEqual(
    question,
    { notify: true, kind: 'question', reasonCode: 'awaiting_clarification', state: 'pending' },
    'clarification is pending and still notifies'
  );

  const approval = resolveRunNotificationPolicy(resolveRunExitDisposition({ awaitingPlanApproval: true }));
  t.equal(approval.kind, 'plan-approval', 'plan approval is actionable');
  t.equal(approval.notify, true, 'plan approval notifies');

  const scheduled = resolveRunNotificationPolicy(resolveRunExitDisposition({
    scheduledFollowup: { scheduleId: 'schedule-2', sourceTaskId: 'task-2' }
  }));
  t.equal(scheduled.notify, false, 'scheduled continuation stays silent');

  const automatic = resolveRunNotificationPolicy(resolveRunExitDisposition({ automaticContinuation: true }));
  t.equal(automatic.notify, false, 'automatic continuation stays silent');

  const completed = resolveRunNotificationPolicy(resolveRunExitDisposition({}));
  t.equal(completed.notify, true, 'terminal completion notifies');
  t.equal(completed.kind, 'completed', 'terminal completion keeps its state');

  const unknownPending = resolveRunNotificationPolicy({ state: 'pending', reasonCode: 'new_manual_boundary', resumePolicy: 'manual' });
  t.equal(unknownPending.notify, true, 'unknown manual pending work fails toward user visibility');
  t.equal(unknownPending.kind, 'paused', 'unknown manual pending work has an explicit presentation');
  t.end();
});

// The centralized disposition replaced several open-coded pending/completed decisions. The one
// signal that must NOT join it is "the model is tracking a mission": a mission statement and its
// win conditions persist after they are satisfied, so treating their presence as a continuation
// would leave every mission-tracked task permanently uncompletable. Only genuinely unsatisfied
// work — an open checklist item, an active subplan, an unmet win condition — is pending work, and
// the caller collapses those into pendingWork before calling in.
test('a satisfied mission completes instead of being held open by its own bookkeeping', t => {
  t.equal(resolveRunExitDisposition({ pendingWork: false }).state, 'completed',
    'a finished pass with no outstanding work completes');
  t.equal(resolveRunExitDisposition({ pendingWork: true }).state, 'pending',
    'genuinely unsatisfied work still holds the task open');
  t.equal(resolveRunExitDisposition({ pendingWork: true }).reasonCode, 'pending_work',
    'the reason names the outstanding work');
  // Guards the exact regression: mission bookkeeping passed alongside a finished pass.
  t.equal(resolveRunExitDisposition({ pendingWork: false, durableMissionState: true }).state, 'completed',
    'mission bookkeeping alone is not a continuation and cannot block completion');
  t.end();
});

test('only structured signals move the disposition, never prose or stray fields', t => {
  t.equal(resolveRunExitDisposition({ summary: 'All done! Pending: nothing.' }).state, 'completed',
    'assistant prose in an unrelated field cannot declare state');
  t.equal(resolveRunExitDisposition({ summary: 'I will check again in 120 seconds.' }).state, 'completed',
    'a promise to check later is not a durable continuation - only a real schedule is');
  // Truthy-but-not-true values must not be read as assertions of pending work.
  t.equal(resolveRunExitDisposition({ pendingWork: 'yes' }).state, 'completed',
    'a non-boolean is not a structured pending signal');
  t.equal(resolveRunExitDisposition({ scheduledFollowup: { scheduleId: 'schedule-1' } }).state, 'completed',
    'a schedule missing its source task is not a task continuation');
  t.equal(resolveRunExitDisposition({ scheduledFollowup: { sourceTaskId: 'task-1' } }).state, 'completed',
    'a schedule missing its own identity is not a task continuation');
  t.end();
});

test('a scheduled continuation outranks the weaker pending reasons it supersedes', t => {
  const schedule = { scheduleId: 'schedule-9', sourceTaskId: 'task-9', dueAt: 1700000000000 };
  const result = resolveRunExitDisposition({
    scheduledFollowup: schedule,
    automaticContinuation: true,
    pendingWork: true,
    actionBoundary: true
  });
  t.equal(result.reasonCode, 'scheduled_followup',
    'the clock owns resumption when a real schedule exists, so the reason is the schedule');
  t.equal(result.resumePolicy, 'scheduled', 'and nothing else claims resumption');
  t.equal(result.schedule.scheduleId, 'schedule-9', 'the owning schedule stays attached for cancellation');
  // A delegated child is the one continuation a schedule must not mask: the child owns the work.
  t.equal(
    resolveRunExitDisposition({ scheduledFollowup: schedule, delegatedChildTaskId: 'child-9' }).reasonCode,
    'awaiting_delegated_task',
    'delegated work still outranks a schedule'
  );
  t.end();
});
