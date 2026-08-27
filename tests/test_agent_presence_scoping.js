'use strict';

// Reported symptom: after a specialist task finished, the Dispatch view stayed stuck on
// "Verifying — Saving the response and recording the canonical task state" forever, even though
// Dispatch had already printed "Operator completed Check DeepSeek balance (1m)" and the task was
// terminal.
//
// Mechanism: the two halves of end-of-run presence are scoped differently.
//   - onAgentStatusChange(false, { status: 'finalizing', conversationId }) renders the "Verifying"
//     pill GLOBALLY. It receives conversationId but ignores it.
//   - onAgentRunFinalized(conversationId, status) CLEARS the pill, but early-returns unless that
//     conversation is the active one.
// So whenever you are watching Dispatch while a specialist finalizes, the set fires and the clear
// does not, and the pill is stranded. It has nothing to do with the task state, which is why the
// transcript correctly said "completed" while the header said "Verifying".

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');

const DISPATCH = 'conv_dispatch_1';
const OPERATOR = 'conv_operator_1';

function boot(t, activeId = DISPATCH) {
  const loaded = loadRenderer({
    t,
    set: {
      activeConversationId: activeId,
      conversations: [
        { id: DISPATCH, mode: 'orion', title: 'Dispatch', messages: [], tasks: [] },
        { id: OPERATOR, mode: 'operator', title: 'Check DeepSeek balance', messages: [], tasks: [] }
      ]
    }
  });
  return loaded;
}

function pill(win) {
  const label = win.document.getElementById('agent-state-text');
  const detail = win.document.getElementById('agent-state-detail');
  return {
    label: (label && label.textContent) || '',
    detail: (detail && detail.textContent) || ''
  };
}

test('a specialist finalizing does not hijack the presence of the conversation you are watching', async (t) => {
  const { win } = boot(t, DISPATCH);
  win.renderAgentPresence('idle', 'Ready', '');

  // Operator finishes its model loop and enters finalization while Dispatch is on screen.
  win.onAgentStatusChange(false, { status: 'finalizing', conversationId: OPERATOR, taskId: 'task_1' });

  const shown = pill(win);
  t.notEqual(shown.label, 'Verifying',
    'Dispatch does not display another conversation\'s finalization state');
  t.doesNotMatch(shown.detail, /Saving the response and recording the canonical task state/,
    'and does not show its finalization detail line');
  t.end();
});

test('the stuck pill is cleared even when the finished run is not the conversation on screen', async (t) => {
  const { win } = boot(t, DISPATCH);

  // Reproduce the exact reported sequence: finalize the specialist, then complete it, all while
  // Dispatch is the active view.
  win.onAgentStatusChange(false, { status: 'finalizing', conversationId: OPERATOR, taskId: 'task_1' });
  await win.onAgentRunFinalized(OPERATOR, 'completed', { taskId: 'task_1' });

  const shown = pill(win);
  t.doesNotMatch(shown.detail, /Saving the response and recording the canonical task state/,
    'the Verifying detail is not left stranded after the task reaches a terminal state');
  t.notEqual(shown.label, 'Verifying',
    'the pill does not sit on Verifying after the run is over');
  t.end();
});

test('watching the specialist itself still shows its finalization and then its completion', async (t) => {
  const { win } = boot(t, OPERATOR);
  win.onAgentStatusChange(false, { status: 'finalizing', conversationId: OPERATOR, taskId: 'task_1' });
  t.equal(pill(win).label, 'Verifying',
    'the conversation actually finalizing still reports it');
  t.match(pill(win).detail, /Saving the response/,
    'with its detail line intact');

  await win.onAgentRunFinalized(OPERATOR, 'completed', { taskId: 'task_1' });
  t.equal(pill(win).label, 'Complete', 'and then reports completion');
  t.end();
});

test('a status change with no conversationId still drives the active presence', async (t) => {
  // Older/global callers omit conversationId. Those must keep working rather than being
  // silently dropped, or the pill would stop updating for ordinary local runs.
  const { win } = boot(t, DISPATCH);
  win.renderAgentPresence('idle', 'Ready', '');
  win.onAgentStatusChange(false, { status: 'finalizing' });
  t.equal(pill(win).label, 'Verifying',
    'an unscoped finalization still applies to whatever is on screen');
  t.end();
});
