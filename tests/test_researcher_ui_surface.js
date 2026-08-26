'use strict';

// Follow-up to the Researcher backend build: Researcher had a full prompt, tool allowlist, and
// handoff wiring, but no sidebar entry point at all -- a user could never start a standalone
// Researcher conversation directly, only reach one via a mid-task handoff. This is the regression
// suite for the fix, built the same way Operator's tab was (tests/test_operator_ui_surface.js):
// a real fourth sidebar tab (flat, no "Projects" concept, matching Researcher's
// standaloneWorkspaceRole of 'standalone_specialist') plus the setAppMode/createNewConversation/
// conversationMode/renderConversationList generalization that makes it actually work end to end.

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');

async function bootRenderer(t, options = {}) {
  const loaded = loadRenderer({ t, trap: true, ...options });
  await loaded.boot();
  return loaded;
}

test('index.html defines the Researcher sidebar tab, content section, and conversation list', (t) => {
  const { win } = loadRenderer({ t });
  const doc = win.document;
  t.ok(doc.getElementById('btn-mode-researcher'), 'sidebar nav has a Researcher button');
  t.ok(doc.getElementById('sidebar-researcher-content'), 'sidebar has a Researcher content section');
  t.ok(doc.getElementById('conversation-list-researcher'), 'Researcher has its own conversation list container');
  t.ok(doc.getElementById('btn-new-conversation-researcher'), 'Researcher has a primary new-conversation button');
  t.ok(doc.getElementById('btn-add-conversation-researcher'), 'Researcher has a section-header new-conversation button');
  t.ok(doc.getElementById('conversation-search-researcher'), 'Researcher has its own search input');
  t.notOk(doc.querySelector('#sidebar-researcher-content .project-list'), 'Researcher is flat, like Operator - no Projects concept');
  t.end();
});

test('conversationMode recognizes an explicitly-tagged researcher conversation directly, not via a projectPath guess', (t) => {
  const { win } = loadRenderer({ t });
  t.equal(win.conversationMode({ mode: 'researcher' }), 'researcher', 'an explicit researcher tag is returned directly');
  t.notEqual(win.conversationMode({ mode: 'researcher' }), 'orion', 'it does not fall through to the orion/coder projectPath guess');
  t.end();
});

test('setAppMode("researcher") activates the Researcher nav button and content, and deactivates the others', (t) => {
  const { win } = loadRenderer({
    t,
    set: { conversations: [{ id: 'conv_res', mode: 'researcher', title: 'Research task', messages: [], workspace: 'C:\\Research' }] }
  });
  win.setAppMode('researcher', false);
  const doc = win.document;
  t.ok(doc.getElementById('btn-mode-researcher').classList.contains('active'), 'Researcher nav button is active');
  t.notOk(doc.getElementById('btn-mode-coder').classList.contains('active'), 'Coder nav button is not active');
  t.notOk(doc.getElementById('btn-mode-operator').classList.contains('active'), 'Operator nav button is not active');
  t.notOk(doc.getElementById('btn-mode-orion').classList.contains('active'), 'Orion nav button is not active');
  t.ok(doc.getElementById('sidebar-researcher-content').classList.contains('active'), 'Researcher sidebar content is shown');
  t.notOk(doc.getElementById('sidebar-operator-content').classList.contains('active'), 'Operator sidebar content is hidden');
  t.equal(doc.body.getAttribute('data-mode'), 'researcher', 'body data-mode reflects researcher');
  t.end();
});

test('setAppMode("researcher") selects an existing researcher conversation instead of bouncing to Coder or Orion', (t) => {
  const researcherConv = { id: 'conv_res', mode: 'researcher', title: 'Competitor pricing research', messages: [], workspace: 'C:\\Research' };
  const coderConv = { id: 'conv_coder', mode: 'coder', title: 'Fix bug', messages: [], projectPath: '' };
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [coderConv, researcherConv], activeConversationId: 'conv_coder' }
  });
  win.setAppMode('researcher', false);
  t.equal(read('activeConversationId'), 'conv_res', 'the existing Researcher conversation is selected, not a Coder one');
  t.equal(read('appMode'), 'researcher', 'appMode actually lands on researcher, not coder');
  t.end();
});

test('setAppMode("researcher") creates a real researcher conversation when none exists yet, not a Coder or Dispatch one', (t) => {
  const { win, read } = loadRenderer({ t, set: { conversations: [] } });
  win.setAppMode('researcher', false);
  const convs = read('conversations');
  t.equal(convs.length, 1, 'exactly one conversation was created');
  t.equal(convs[0].mode, 'researcher', 'the created conversation is tagged researcher, not coder or orion');
  t.end();
});

test('createNewConversation("researcher") creates a researcher-mode conversation, not a Dispatch draft', async (t) => {
  const { win, read } = loadRenderer({ t, set: { conversations: [] } });
  await win.createNewConversation('researcher');
  const convs = read('conversations');
  t.equal(convs.length, 1, 'a conversation record was actually created (not routed into the Dispatch-draft path)');
  t.equal(convs[0].mode, 'researcher', 'tagged researcher');
  t.equal(convs[0].projectPath, '', 'no project path - Researcher standalone conversations are not project-bound');
  t.end();
});

test('a phone-created Researcher conversation remains Researcher through the real renderer intake path', async (t) => {
  const { win, read } = await bootRenderer(t, {
    set: { conversations: [] },
    globals: { OrionSpecialistRegistry: require('../specialist-registry') }
  });
  const accepted = await win.startPhoneCompanionTask({ mode: 'researcher' });
  t.equal(accepted.success, true, 'phone intake accepts a blank specialist conversation');
  t.ok(accepted.conversationId, 'phone intake returns the durable Researcher conversation identity');
  const created = read('conversations').find(conversation => conversation.id === accepted.conversationId);
  t.ok(created, 'the accepted phone conversation exists in renderer state');
  t.equal(created.mode, 'researcher', 'the phone-created conversation is not coerced to Dispatch');
  t.equal(created.projectPath, '', 'standalone Researcher does not inherit a Coder project');
  t.end();
});

test('createNewConversation("coder") and ("operator") are unaffected by the researcher branch addition', async (t) => {
  const { win, read } = loadRenderer({ t, set: { conversations: [] } });
  await win.createNewConversation('coder');
  await win.createNewConversation('operator');
  const convs = read('conversations');
  t.equal(convs.length, 2);
  t.ok(convs.some(c => c.mode === 'coder'), 'Coder creation still works exactly as before');
  t.ok(convs.some(c => c.mode === 'operator'), 'Operator creation still works exactly as before');
  t.end();
});

test('renderConversationList populates the Researcher list independently of Orion, Coder, and Operator', (t) => {
  const conversations = [
    { id: 'c1', mode: 'orion', title: 'Dispatch chat', messages: [] },
    { id: 'c2', mode: 'coder', title: 'Coder standalone', messages: [], projectPath: '' },
    { id: 'c3', mode: 'operator', title: 'Operator task', messages: [], workspace: 'C:\\Ops' },
    { id: 'c4', mode: 'researcher', title: 'Research task one', messages: [], workspace: 'C:\\Research1' },
    { id: 'c5', mode: 'researcher', title: 'Research task two', messages: [], workspace: 'C:\\Research2' }
  ];
  const { win } = loadRenderer({ t, set: { conversations } });
  win.renderConversationList();
  const doc = win.document;
  const researcherList = doc.getElementById('conversation-list-researcher');
  const operatorList = doc.getElementById('conversation-list-operator');
  const coderList = doc.getElementById('conversation-list-coder');
  const orionList = doc.getElementById('conversation-list');
  t.equal(researcherList.querySelectorAll('.conversation-item').length, 2, 'both researcher conversations appear in the Researcher list');
  t.ok(researcherList.textContent.includes('Research task one') && researcherList.textContent.includes('Research task two'));
  t.notOk(researcherList.textContent.includes('Operator task'), 'Operator conversations do not leak into the Researcher list');
  t.notOk(operatorList.textContent.includes('Research task one'), 'Researcher conversations do not leak into the Operator list');
  t.notOk(coderList.textContent.includes('Research task one'), 'Researcher conversations do not leak into the Coder list');
  t.notOk(orionList.textContent.includes('Research task one'), 'Researcher conversations do not leak into the Dispatch list');
  t.end();
});

test('the chat input placeholder distinguishes Researcher from Coder and Operator', (t) => {
  const { win } = loadRenderer({
    t,
    set: { conversations: [{ id: 'conv_res', mode: 'researcher', title: 'Res', messages: [], workspace: 'C:\\Research' }] }
  });
  win.setAppMode('researcher', false);
  const placeholder = win.document.getElementById('chat-input').placeholder;
  t.match(placeholder, /Researcher/, 'the placeholder names Researcher, not a generic Coder/Operator-worded prompt');
  t.end();
});

test('a conversation created via handoff (mode tagged researcher, no explicit UI action) survives migrateConversations on reload without being stomped back to coder/orion', (t) => {
  // Guards the exact bug class this whole build fixes: migrateConversations runs on every load and
  // used to only recognize orion/coder/operator as "already explicit," silently reassigning any
  // other tag (including a handoff-created researcher conversation) back to coder/orion.
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [{ id: 'conv_res', mode: 'researcher', title: 'Handoff research', messages: [], workspace: 'C:\\Research' }] }
  });
  if (typeof win.migrateConversations === 'function') win.migrateConversations();
  const convs = read('conversations');
  t.equal(convs.find(c => c.id === 'conv_res').mode, 'researcher', 'the researcher tag survives migration unchanged');
  t.end();
});

test('clicking the Researcher nav button in a fully booted renderer actually switches into Researcher mode', async (t) => {
  // Proves the real click-listener wiring (registered inside the DOMContentLoaded boot sequence),
  // not just that setAppMode itself works when called directly.
  const { win, expose, read } = await bootRenderer(t, { expose: ['el'] });
  t.ok(expose.el.btnNewConversationResearcher, 'the researcher new-conversation button is present in the exposed el map');

  win.document.getElementById('btn-mode-researcher').click();
  t.equal(read('appMode'), 'researcher', 'clicking the Researcher tab actually switched appMode to researcher');
  t.ok(win.document.getElementById('sidebar-researcher-content').classList.contains('active'), 'the Researcher sidebar content is now shown');
  t.end();
});

test('clicking "New Conversation" inside the booted Researcher tab creates and selects a real researcher conversation', async (t) => {
  const { win, read } = await bootRenderer(t, { set: { conversations: [] } });
  win.document.getElementById('btn-mode-researcher').click();
  const createdByModeSwitch = read('conversations');
  t.equal(createdByModeSwitch.length, 1, 'switching into an empty Researcher tab already created one conversation');

  win.document.getElementById('btn-new-conversation-researcher').click();
  // createNewConversation is async; give its microtask queue a turn to settle before reading state.
  await new Promise(resolve => setTimeout(resolve, 0));
  const convs = read('conversations');
  t.equal(convs.length, 2, 'clicking New Conversation added a second real conversation record');
  t.equal(convs[0].mode, 'researcher', 'the newly created (and selected) conversation is tagged researcher');
  t.equal(read('activeConversationId'), convs[0].id, 'the new researcher conversation is actually selected, not just created');
  t.end();
});
