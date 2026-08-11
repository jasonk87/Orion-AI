'use strict';

process.env.NODE_ENV = 'test';

// Phase 3 (item 15 - regression harness pass). Rather than re-testing every scenario on Jason's
// checklist from scratch, this file targets the specific gaps found by auditing existing coverage
// against that checklist:
//
//   handoff to each role           -> already covered (test_conversation_mode_generalization*.js,
//                                      test_task_orchestration.js)
//   restart mid-task, each role    -> generic reconciliation covered in test_resource_lease_wiring.js;
//                                      this file adds the Operator-specific notifier counterpart,
//                                      which that file only exercised for Coder
//   cancellation                   -> already covered (test_supervisor_orchestration.js and mode-
//                                      generalization tests are role-agnostic by construction)
//   steering                       -> already covered; steeringQueue is keyed per-conversationId,
//                                      not per-mode (test_interaction_guardrails.js)
//   process ownership/leases       -> already covered (test_resource_lease_store.js,
//                                      test_resource_lease_wiring.js)
//   stale screenshots              -> already covered (test_screenshot_freshness_wiring.js,
//                                      test_computer_use.js)
//   competing agents (lease clash) -> already covered - test_resource_lease_wiring.js's desktop-
//                                      lease-conflict test is literally a Coder-holds/Operator-
//                                      blocked scenario
//   late schedules                 -> covered by schedule-policy/durable-scheduling tests; this file
//                                      adds one assertion that the dispatch path itself never
//                                      branches on conversation.mode (source-level regression guard)
//   notification delivery          -> covered by test_phone_notifications.js; this file adds the
//                                      same mode-agnosticism guard for buildRunEndNotification
//   mid-interaction failure,       -> classifyAgentFailure is generic (toolName/errorText-keyed,
//   Operator specifically             not mode-keyed) so Operator's real refusal messages (lease
//                                      conflict, freshness gate) were never exercised through it -
//                                      genuinely untested until this file

global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const fs = require('fs');
const path = require('path');
const agent = require('../agent');
const { loadRenderer } = require('./helpers/renderer-harness');

const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');

// ── gap 1: classifyAgentFailure against Operator's real refusal messages ─────────────────────────

test('classifyAgentFailure handles a real desktop-lease-conflict refusal from computer_action sanely', t => {
  const errorText = 'Another conversation (coder) currently holds native desktop control. Wait for it to finish or ask the user before proceeding — acting now would collide with that conversation\'s in-progress work.';
  const first = agent.classifyAgentFailure({ toolName: 'computer_action', errorText, failureCount: 1 });
  t.equal(first.category, 'tool_failure', 'a single lease-conflict refusal is generic tool_failure, not misclassified as something actionable-sounding like auth_missing');
  t.equal(first.recommendedNature, 'fixable', 'treated as recoverable, not terminal - the conflict clears once the other run finishes');

  const third = agent.classifyAgentFailure({ toolName: 'computer_action', errorText, failureCount: 3 });
  t.equal(third.category, 'repeated_tool_failure', 'three consecutive lease conflicts still escalate to the repeated-failure circuit breaker exactly like any other tool');
  const guidance = agent.buildFailureRecoveryGuidance(third);
  t.ok(guidance && guidance.length > 20, 'recovery guidance text is produced for the escalated case');
  t.match(guidance, /pause|different strategy|inspect/i, 'guidance tells the model to stop and reassess rather than blindly retry');
  t.end();
});

test('classifyAgentFailure handles the computer_action freshness-gate refusal sanely', t => {
  const errorText = 'Computer use requires inspect_screenshot_with_model on the fresh capture before acting. Orion will not click or type against an uninspected screen.';
  const result = agent.classifyAgentFailure({ toolName: 'computer_action', errorText, failureCount: 1 });
  t.equal(result.category, 'tool_failure', 'the freshness gate refusal is generic tool_failure');
  t.equal(result.recommendedNature, 'fixable', 'recoverable - the model just needs to inspect before acting');
  t.end();
});

test('classifyAgentFailure escalates repeated Operator freshness-gate refusals the same way repeated Coder failures escalate', t => {
  const errorText = 'Computer use requires a fresh capture_screen from this run. Capture and inspect the visible target before acting.';
  const counts = [1, 2, 3, 4].map(n => agent.classifyAgentFailure({ toolName: 'computer_action', errorText, failureCount: n }).category);
  t.deepEqual(counts, ['tool_failure', 'tool_failure', 'repeated_tool_failure', 'repeated_tool_failure'],
    'escalation threshold behaves identically regardless of which tool or role produced the failures');
  t.end();
});

// ── gap 2: notifySupervisorOfOperatorCompletion liveness-note propagation ────────────────────────
// test_resource_lease_wiring.js only exercises this for notifySupervisorOfCoderCompletion. Both
// functions got the identical inserted block in the same commit; this closes the coverage gap on
// the Operator half so future edits to one can't silently desync from the other undetected.

test('a recorded liveness note is surfaced by notifySupervisorOfOperatorCompletion and cleared once consumed', async t => {
  const { win, expose, read } = loadRenderer({
    t,
    expose: ['interruptedTaskLivenessNotes'],
    api: {
      getOrchestrationTask: async () => ({
        success: true,
        task: { taskId: 'task_op_interrupted', title: 'Fill out onboarding form', status: 'failed', failure: { code: 'interrupted', message: 'restarted' } }
      })
    },
    set: {
      conversations: [
        { id: 'dispatch-1', mode: 'orion', launchedCoderConvId: 'operator-1', launchedCoderTaskId: 'task_op_interrupted', launchedCoderTaskTitle: 'Fill out onboarding form', launchedTaskRole: 'operator', messages: [] },
        { id: 'operator-1', mode: 'operator', title: 'Fill out onboarding form', messages: [] }
      ]
    }
  });
  expose.interruptedTaskLivenessNotes.set('task_op_interrupted', 'TEST-OPERATOR-LIVENESS-NOTE');
  await win.notifySupervisorOfOperatorCompletion('operator-1', 'task_op_interrupted');
  const reread = read('conversations').find(c => c.id === 'dispatch-1');
  const lastMsg = reread.messages[reread.messages.length - 1];
  t.ok(lastMsg && lastMsg.text.includes('TEST-OPERATOR-LIVENESS-NOTE'), 'the liveness note reaches the Operator completion notification text');
  t.ok(/^Operator (completed|finished|failed)/.test(lastMsg.text || ''), 'Operator phrasing is used, not Coder\'s');
  t.notOk(expose.interruptedTaskLivenessNotes.has('task_op_interrupted'), 'the note is cleared after being consumed so it cannot be shown twice');
  t.end();
});

test('cancelling an owned Operator task appends one terminal message to the Dispatch conversation', async t => {
  const cancelledTask = {
    taskId: 'task_op_cancelled',
    title: 'Test operator with Codex',
    objective: 'Open Codex and inspect the visible state.',
    status: 'cancelled',
    workspacePath: 'C:\\Users\\Owner',
    startedAt: 100,
    cancelledAt: 200,
    origin: { conversationId: 'dispatch-cancel' },
    target: { conversationId: 'operator-cancel', mode: 'operator' }
  };
  const { win, read } = loadRenderer({
    t,
    api: {
      cancelOrchestrationTask: async () => ({ success: true, wasActive: true, task: cancelledTask }),
      getOrchestrationTask: async () => ({ success: true, task: cancelledTask })
    },
    set: {
      activeConversationId: 'dispatch-cancel',
      conversations: [
        {
          id: 'dispatch-cancel',
          mode: 'orion',
          title: 'What do you think about Orion?',
          launchedCoderConvId: 'operator-cancel',
          launchedCoderTaskId: 'task_op_cancelled',
          launchedCoderTaskTitle: 'Test operator with Codex',
          launchedCoderTaskStart: 100,
          launchedTaskRole: 'operator',
          messages: [{ role: 'assistant', text: 'Operator has the task queued.', source: 'handoff' }]
        },
        { id: 'operator-cancel', mode: 'operator', title: 'Test operator with Codex', messages: [] }
      ]
    }
  });

  const result = await win.cancelOwnedOrchestrationTask(
    'task_op_cancelled',
    'dispatch-cancel',
    'Cancelled from the Stop control.'
  );
  t.equal(result.task.status, 'cancelled', 'the durable cancellation succeeds');
  let dispatch = read('conversations').find(conv => conv.id === 'dispatch-cancel');
  let cancellationMessages = dispatch.messages.filter(message =>
    message.source === 'supervisor-cancellation'
    && message.orchestrationTaskId === 'task_op_cancelled'
  );
  t.equal(cancellationMessages.length, 1, 'the owning transcript receives exactly one cancellation message');
  t.match(cancellationMessages[0].text, /Cancelled \*\*Test operator with Codex\*\*/i, 'the message names the cancelled task');
  t.match(cancellationMessages[0].text, /Operator .*not recorded as completed/i, 'the message names the real specialist and preserves terminal semantics');
  t.equal(dispatch.lastDelegatedWork.status, 'cancelled', 'the conversation receipt records the cancelled state');
  t.equal(dispatch.launchedCoderTaskId, null, 'the active task pointer is cleared after presentation is reconciled');

  await win.onOrchestrationTaskFinalized('task_op_cancelled', 'operator-cancel', 'cancelled');
  dispatch = read('conversations').find(conv => conv.id === 'dispatch-cancel');
  cancellationMessages = dispatch.messages.filter(message =>
    message.source === 'supervisor-cancellation'
    && message.orchestrationTaskId === 'task_op_cancelled'
  );
  t.equal(cancellationMessages.length, 1, 'a late finalization callback cannot duplicate the cancellation message');
  t.end();
});

// ── gap 3: late-schedule dispatch and run-end notification are mode-agnostic (source guards) ─────
// These passed on manual read during the item 1/14 gap-check; codified here as regression guards
// so a future edit that adds a mode branch to either path gets caught instead of silently
// reintroducing the Coder-only assumption Phase 2 spent significant effort removing.

test('window.runDurableSchedule never branches on conversation.mode - a fired schedule reaches whatever role the conversation actually is', t => {
  const fnSource = agentJs.slice(agentJs.indexOf('window.runDurableSchedule = async function'), agentJs.indexOf('window.runDurableSchedule = async function') + 2600);
  t.ok(fnSource.includes('conversations.find(c => c.id === conversationId)'), 'resolves the target conversation purely by id');
  t.notOk(/targetConv\.mode\s*===|targetConv\.mode\s*!==/.test(fnSource), 'does not gate execution on the target conversation\'s mode');
  t.ok(fnSource.includes('window.runAgentLoop('), 'hands off to the single shared run entry point regardless of role');
  t.end();
});

test('buildRunEndNotification does not read or branch on conversation.mode', t => {
  const start = agentJs.indexOf('function buildRunEndNotification(context = {})');
  const fnSource = agentJs.slice(start, start + 2200);
  t.ok(fnSource.length > 100, 'function body located');
  t.notOk(/conversation\.mode/.test(fnSource), 'run-end phone/desktop notification text does not vary by role - Coder and Operator runs are announced identically');
  t.end();
});

// ── gap 4 (light): explicit end-to-end proof that a completed Operator run produces a notification ──

test('buildRunEndNotification produces a normal completion notification for an operator-mode conversation', t => {
  const notification = agent.buildRunEndNotification({
    conversation: { id: 'operator-1', mode: 'operator', title: 'Fill out onboarding form' },
    finalizedTaskState: 'completed',
    lastTextResponse: 'Submitted the form successfully.'
  });
  t.ok(notification, 'a notification is produced');
  t.equal(notification.kind, 'completed');
  t.ok(notification.title.includes('Fill out onboarding form'));
  t.end();
});
