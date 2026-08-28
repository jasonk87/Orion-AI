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

  const PENDING_ATTENTION_KINDS = Object.freeze({
    awaiting_clarification: 'question',
    awaiting_plan_approval: 'plan-approval',
    repeated_tool_failure: 'repeated-failure',
    action_boundary: 'action-limit',
    awaiting_input: 'paused',
    pending_work: 'paused'
  });

  const SILENT_PENDING_REASONS = new Set([
    'scheduled_followup',
    'automatic_action_boundary',
    'awaiting_delegated_task'
  ]);

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

  function hasAwaitingClarification(value) {
    if (value === true) return true;
    return !!(
      value
      && typeof value === 'object'
      && Array.isArray(value.questions)
      && value.questions.length > 0
    );
  }

  // This is the sole mapping from an execution pass's observed state to the durable task state.
  // It deliberately accepts structured signals only; assistant prose never declares completion.
  function resolveRunExitDisposition(input = {}) {
    if (input.cancelled === true || input.planDenied === true) {
      return terminal('cancelled', input.planDenied ? 'plan_denied' : 'cancelled_by_user');
    }
    if (input.criticalError) return terminal('failed', 'execution_failed');

    // A user-attention boundary outranks background continuation signals. Stale automatic or
    // scheduled state must never hide a question or approval request from the user.
    if (input.awaitingPlanApproval === true) return pending('awaiting_plan_approval', 'user');
    if (hasAwaitingClarification(input.awaitingClarification)) return pending('awaiting_clarification', 'user');
    if (input.repeatedToolFailure === true) return pending('repeated_tool_failure', 'manual');
    if (input.awaitingUser === true) return pending('awaiting_input', 'user');

    if (input.delegatedChildTaskId) return pending('awaiting_delegated_task', 'manual');

    const schedule = normalizeSchedule(input.scheduledFollowup);
    if (schedule) return pending('scheduled_followup', 'scheduled', schedule);

    if (input.automaticContinuation === true) {
      return pending('automatic_action_boundary', 'automatic');
    }
    if (input.actionBoundary === true) return pending('action_boundary', 'manual');
    // pendingWork is UNSATISFIED durable work only — an open checklist item, an active subplan,
    // an unmet win condition. The mere existence of mission state is not pending work: a mission
    // statement and its win conditions survive being satisfied, so treating "a mission exists" as
    // a continuation would make every mission-tracked task permanently uncompletable.
    if (input.pendingWork === true) return pending('pending_work', 'manual');
    return terminal('completed', 'mission_complete');
  }

  // Notification policy consumes the same disposition that owns durable task state. "Pending"
  // describes mission completion, not whether the user needs to be alerted. User-attention
  // boundaries notify; background continuations remain quiet; terminal outcomes always notify.
  function resolveRunNotificationPolicy(disposition = {}) {
    const state = String(disposition && disposition.state || '').trim().toLowerCase();
    const reasonCode = String(disposition && disposition.reasonCode || '').trim().toLowerCase();
    const resumePolicy = String(disposition && disposition.resumePolicy || '').trim().toLowerCase();

    if (['completed', 'failed', 'cancelled'].includes(state)) {
      return { notify: true, kind: state, reasonCode, state };
    }

    if (state !== 'pending') {
      return { notify: true, kind: 'unverified', reasonCode, state: state || 'unknown' };
    }

    if (PENDING_ATTENTION_KINDS[reasonCode]) {
      return { notify: true, kind: PENDING_ATTENTION_KINDS[reasonCode], reasonCode, state };
    }

    if (SILENT_PENDING_REASONS.has(reasonCode)
        || resumePolicy === 'automatic'
        || resumePolicy === 'scheduled') {
      return { notify: false, kind: 'checkpoint', reasonCode, state };
    }

    // An unknown/manual pending reason is actionable until proven otherwise. Silencing it would
    // recreate the original failure where Orion waits indefinitely without alerting the user.
    return { notify: true, kind: 'paused', reasonCode: reasonCode || 'pending', state };
  }

  return {
    resolveRunExitDisposition,
    resolveRunNotificationPolicy,
    normalizeSchedule,
    hasAwaitingClarification
  };
});
