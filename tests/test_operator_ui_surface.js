'use strict';

// Item 10 of the Operator architecture plan: Operator conversations existed (created via
// handoff_to_operator) but had no sidebar entry point at all. Worse, two real bugs meant Operator
// couldn't even be used indirectly:
//   - setAppMode's fallback branch treated any non-'orion' mode as 'coder', so selecting an
//     Operator conversation immediately bounced the view back to a Coder one.
//   - createNewConversation's fallback branch treated any non-'coder' mode as 'orion', so asking
//     for a new Operator conversation silently created a Dispatch draft instead.
// This file is the regression suite for the fix: a real third sidebar tab (mirroring Orion's flat
// structure, not Coder's project-structured one, since Operator has no "Projects" concept) plus
// the setAppMode/createNewConversation/renderConversationList generalization that makes it work.

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');

test('index.html defines the Operator sidebar tab, content section, and conversation list', (t) => {
  const { win } = loadRenderer({ t });
  const doc = win.document;
  t.ok(doc.getElementById('btn-mode-operator'), 'sidebar nav has an Operator button');
  t.ok(doc.getElementById('sidebar-operator-content'), 'sidebar has an Operator content section');
  t.ok(doc.getElementById('conversation-list-operator'), 'Operator has its own conversation list container');
  t.ok(doc.getElementById('btn-new-conversation-operator'), 'Operator has a primary new-conversation button');
  t.ok(doc.getElementById('btn-add-conversation-operator'), 'Operator has a section-header new-conversation button');
  t.end();
});

test('setAppMode("operator") activates the Operator nav button and content, and deactivates the others', (t) => {
  const { win } = loadRenderer({
    t,
    set: { conversations: [{ id: 'conv_op', mode: 'operator', title: 'Op task', messages: [], workspace: 'C:\\Ops' }] }
  });
  win.setAppMode('operator', false);
  const doc = win.document;
  t.ok(doc.getElementById('btn-mode-operator').classList.contains('active'), 'Operator nav button is active');
  t.notOk(doc.getElementById('btn-mode-coder').classList.contains('active'), 'Coder nav button is not active');
  t.notOk(doc.getElementById('btn-mode-orion').classList.contains('active'), 'Orion nav button is not active');
  t.ok(doc.getElementById('sidebar-operator-content').classList.contains('active'), 'Operator sidebar content is shown');
  t.notOk(doc.getElementById('sidebar-coder-content').classList.contains('active'), 'Coder sidebar content is hidden');
  t.equal(doc.body.getAttribute('data-mode'), 'operator', 'body data-mode reflects operator');
  t.end();
});

test('setAppMode("operator") selects an existing operator conversation instead of bouncing to Coder', (t) => {
  // This is the actual bug: the old fallback was "not orion => must be coder," so opening
  // Operator when an Operator conversation already existed would silently switch back to Coder.
  const operatorConv = { id: 'conv_op', mode: 'operator', title: 'Fill onboarding form', messages: [], workspace: 'C:\\Ops' };
  const coderConv = { id: 'conv_coder', mode: 'coder', title: 'Fix bug', messages: [], projectPath: '' };
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [coderConv, operatorConv], activeConversationId: 'conv_coder' }
  });
  win.setAppMode('operator', false);
  t.equal(read('activeConversationId'), 'conv_op', 'the existing Operator conversation is selected, not a Coder one');
  t.equal(read('appMode'), 'operator', 'appMode actually lands on operator, not coder');
  t.end();
});

test('setAppMode("operator") creates a real operator conversation when none exists yet, not a Coder or Dispatch one', (t) => {
  const { win, read } = loadRenderer({ t, set: { conversations: [] } });
  win.setAppMode('operator', false);
  const convs = read('conversations');
  t.equal(convs.length, 1, 'exactly one conversation was created');
  t.equal(convs[0].mode, 'operator', 'the created conversation is tagged operator, not coder or orion');
  t.end();
});

test('createNewConversation("operator") creates an operator-mode conversation, not a Dispatch draft', async (t) => {
  const { win, read } = loadRenderer({ t, set: { conversations: [] } });
  await win.createNewConversation('operator');
  const convs = read('conversations');
  t.equal(convs.length, 1, 'a conversation record was actually created (not routed into the Dispatch-draft path)');
  t.equal(convs[0].mode, 'operator', 'tagged operator');
  t.equal(convs[0].projectPath, '', 'no project path - Operator standalone conversations are not project-bound');
  t.end();
});

test('createNewConversation("coder") is unaffected by the operator branch addition', async (t) => {
  const { win, read } = loadRenderer({ t, set: { conversations: [] } });
  await win.createNewConversation('coder');
  const convs = read('conversations');
  t.equal(convs.length, 1);
  t.equal(convs[0].mode, 'coder', 'Coder creation still works exactly as before');
  t.end();
});

test('renderConversationList populates the Operator list independently of Orion and Coder', (t) => {
  const conversations = [
    { id: 'c1', mode: 'orion', title: 'Dispatch chat', messages: [] },
    { id: 'c2', mode: 'coder', title: 'Coder standalone', messages: [], projectPath: '' },
    { id: 'c3', mode: 'coder', title: 'Coder project task', messages: [], projectPath: 'C:\\Proj' },
    { id: 'c4', mode: 'operator', title: 'Operator task one', messages: [], workspace: 'C:\\Ops' },
    { id: 'c5', mode: 'operator', title: 'Operator task two', messages: [], workspace: 'C:\\Ops2' }
  ];
  const { win } = loadRenderer({ t, set: { conversations } });
  win.renderConversationList();
  const doc = win.document;
  const operatorList = doc.getElementById('conversation-list-operator');
  const coderList = doc.getElementById('conversation-list-coder');
  const orionList = doc.getElementById('conversation-list');
  t.equal(operatorList.querySelectorAll('.conversation-item').length, 2, 'both operator conversations appear in the Operator list');
  t.ok(operatorList.textContent.includes('Operator task one') && operatorList.textContent.includes('Operator task two'));
  t.notOk(operatorList.textContent.includes('Coder standalone'), 'Coder conversations do not leak into the Operator list');
  t.notOk(operatorList.textContent.includes('Dispatch chat'), 'Dispatch conversations do not leak into the Operator list');
  t.equal(coderList.querySelectorAll('.conversation-item').length, 1, 'only the standalone (non-project) Coder conversation appears in the Coder standalone list, same as before');
  t.notOk(coderList.textContent.includes('Operator task one'), 'Operator conversations do not leak into the Coder list');
  t.notOk(orionList.textContent.includes('Operator task one'), 'Operator conversations do not leak into the Dispatch list');
  t.end();
});

test('the chat input placeholder distinguishes Operator from Coder', (t) => {
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [{ id: 'conv_op', mode: 'operator', title: 'Op', messages: [], workspace: 'C:\\Ops' }] }
  });
  win.setAppMode('operator', false);
  const placeholder = win.document.getElementById('chat-input').placeholder;
  t.match(placeholder, /Operator/, 'the placeholder names Operator, not a generic Coder-worded prompt');
  t.end();
});
