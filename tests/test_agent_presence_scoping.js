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

test('run presence stays scoped to the conversation that owns it', async (t) => {
  // One Dispatch renderer covers all off-screen and legacy-unscoped transitions. Loading the
  // entire production renderer once per assertion made this small contract needlessly sensitive
  // to machine load in the full suite.
  const { win } = boot(t, DISPATCH);
  win.renderAgentPresence('idle', 'Ready', '');

  // Operator finishes its model loop and enters finalization while Dispatch is on screen.
  win.onAgentStatusChange(false, { status: 'finalizing', conversationId: OPERATOR, taskId: 'task_1' });

  const shown = pill(win);
  t.notEqual(shown.label, 'Verifying',
    'Dispatch does not display another conversation\'s finalization state');
  t.doesNotMatch(shown.detail, /Saving the response and recording the canonical task state/,
    'and does not show its finalization detail line');
  // Reproduce the exact reported sequence: finalize the specialist, then complete it, all while
  // Dispatch is the active view.
  win.onAgentStatusChange(false, { status: 'finalizing', conversationId: OPERATOR, taskId: 'task_1' });
  await win.onAgentRunFinalized(OPERATOR, 'completed', { taskId: 'task_1' });

  const afterCompletion = pill(win);
  t.doesNotMatch(afterCompletion.detail, /Saving the response and recording the canonical task state/,
    'the Verifying detail is not left stranded after the task reaches a terminal state');
  t.notEqual(afterCompletion.label, 'Verifying',
    'the pill does not sit on Verifying after the run is over');

  // Older/global callers omit conversationId. Those must keep working rather than being
  // silently dropped, or the pill would stop updating for ordinary local runs.
  win.renderAgentPresence('idle', 'Ready', '');
  win.onAgentStatusChange(false, { status: 'finalizing' });
  t.equal(pill(win).label, 'Verifying',
    'an unscoped finalization still applies to whatever is on screen');

  // A second renderer is necessary here because activeConversationId is module-scoped state:
  // verify the specialist's own UI still receives the same transitions that Dispatch ignores.
  const { win: specialistWin } = boot(t, OPERATOR);
  specialistWin.onAgentStatusChange(false, { status: 'finalizing', conversationId: OPERATOR, taskId: 'task_1' });
  t.equal(pill(specialistWin).label, 'Verifying',
    'the conversation actually finalizing still reports it');
  t.match(pill(specialistWin).detail, /Saving the response/,
    'with its detail line intact');

  await specialistWin.onAgentRunFinalized(OPERATOR, 'completed', { taskId: 'task_1' });
  t.equal(pill(specialistWin).label, 'Complete', 'and then reports completion');
  t.end();
});
