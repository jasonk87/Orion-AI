(function initRunExitDisposition(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrionRunExitDisposition = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildRunExitDisposition() {
  'use strict';

  const terminal = (state, reasonCode) => ({
    state,
    pendingWork: false,
    reasonCode,
    resumePolicy: 'none',
    notificationKind: 'terminal',
    schedule: null
  });

  const pending = (reasonCode, resumePolicy, schedule = null) => ({
    state: 'pending',
    pendingWork: true,
    reasonCode,
    resumePolicy,
    notificationKind: 'checkpoint',
    schedule
  });

  function normalizeSchedule(value) {
    if (!value || typeof value !== 'object') return null;
    const scheduleId = String(value.scheduleId || '').trim();
    const sourceTaskId = String(value.sourceTaskId || '').trim();
    if (!scheduleId || !sourceTaskId) return null;
    return {
      scheduleId,
      sourceTaskId,
      dueAt: Number(value.dueAt || value.nextRunAt) || 0,
      nextRunAt: Number(value.nextRunAt || value.dueAt) || 0,
      purpose: String(value.purpose || '').trim().slice(0, 300)
    };
  }

  // This is the sole mapping from an execution pass's observed state to the durable task state.
  // It deliberately accepts structured signals only; assistant prose never declares completion.
  function resolveRunExitDisposition(input = {}) {
    if (input.cancelled === true || input.planDenied === true) {
      return terminal('cancelled', input.planDenied ? 'plan_denied' : 'cancelled_by_user');
    }
    if (input.criticalError) return terminal('failed', 'execution_failed');

    if (input.delegatedChildTaskId) return pending('awaiting_delegated_task', 'manual');

    const schedule = normalizeSchedule(input.scheduledFollowup);
    if (schedule) return pending('scheduled_followup', 'scheduled', schedule);

    if (input.automaticContinuation === true) {
      return pending('automatic_action_boundary', 'automatic');
    }
    if (input.awaitingPlanApproval === true) return pending('awaiting_plan_approval', 'user');
    if (input.awaitingClarification === true) return pending('awaiting_clarification', 'user');
    if (input.repeatedToolFailure === true) return pending('repeated_tool_failure', 'manual');
    if (input.actionBoundary === true) return pending('action_boundary', 'manual');
    if (input.awaitingUser === true) return pending('awaiting_input', 'user');
    // pendingWork is UNSATISFIED durable work only — an open checklist item, an active subplan,
    // an unmet win condition. The mere existence of mission state is not pending work: a mission
    // statement and its win conditions survive being satisfied, so treating "a mission exists" as
    // a continuation would make every mission-tracked task permanently uncompletable.
    if (input.pendingWork === true) return pending('pending_work', 'manual');
    return terminal('completed', 'mission_complete');
  }

  return { resolveRunExitDisposition, normalizeSchedule };
});
