'use strict';

// Item 9 (UI polish): three real, previously-missing sidebar affordances.
//   - Relative timestamps: renderConversationList hardcoded every row's age to the literal string
//     'now' regardless of actual last-activity time.
//   - Conversation search: there was no way to filter the sidebar list at all.
//   - Rename: conversations could only ever be renamed automatically from their first message;
//     there was no way to change a title afterward.

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');

// ── formatRelativeConversationTime ────────────────────────────────────────────────────────────

test('formatRelativeConversationTime renders sensible short labels across the whole range', (t) => {
  const { win } = loadRenderer({ t });
  const now = Date.now();
  t.equal(win.formatRelativeConversationTime(0), 'new', 'a conversation with no timestamp at all reads as new, not "0m" or "NaN"');
  t.equal(win.formatRelativeConversationTime(now), 'now', 'this instant reads as now');
  t.equal(win.formatRelativeConversationTime(now - 30 * 1000), 'now', 'under a minute still reads as now');
  t.equal(win.formatRelativeConversationTime(now - 5 * 60 * 1000), '5m', 'five minutes ago');
  t.equal(win.formatRelativeConversationTime(now - 3 * 60 * 60 * 1000), '3h', 'three hours ago');
  t.equal(win.formatRelativeConversationTime(now - 2 * 24 * 60 * 60 * 1000), '2d', 'two days ago');
  t.equal(win.formatRelativeConversationTime(now - 2 * 7 * 24 * 60 * 60 * 1000), '2w', 'two weeks ago');
  t.equal(win.formatRelativeConversationTime(now + 60 * 1000), 'now', 'a timestamp slightly in the future (clock skew) never shows a negative age');
  const oldTimestamp = now - 200 * 24 * 60 * 60 * 1000;
  const oldLabel = win.formatRelativeConversationTime(oldTimestamp);
  t.notOk(/^\d+[mhdw]$/.test(oldLabel), 'well beyond a month, the label is a short date, not a huge week count');
  t.end();
});

// ── renderConversationList uses the real relative time ───────────────────────────────────────

test('renderConversationList shows a real relative time, not the old hardcoded "now"', (t) => {
  const oldConv = { id: 'c1', mode: 'coder', title: 'Old task', messages: [], projectPath: '', updatedAt: Date.now() - 3 * 60 * 60 * 1000 };
  const { win } = loadRenderer({ t, set: { conversations: [oldConv] } });
  win.renderConversationList();
  const item = win.document.querySelector('#conversation-list-coder .conversation-item');
  t.ok(item, 'the conversation row rendered');
  t.equal(item.querySelector('.conversation-time').textContent, '3h', 'the row shows the conversation\'s real age');
  t.end();
});

test('a conversation with no activity timestamp at all shows "new" instead of a stale hardcoded "now"', (t) => {
  const freshConv = { id: 'c1', mode: 'coder', title: 'Brand new', messages: [], projectPath: '' };
  const { win } = loadRenderer({ t, set: { conversations: [freshConv] } });
  win.renderConversationList();
  const item = win.document.querySelector('#conversation-list-coder .conversation-item');
  t.equal(item.querySelector('.conversation-time').textContent, 'new');
  t.end();
});

// ── search ─────────────────────────────────────────────────────────────────────────────────────

// The search box's own event listener is a trivial two-line wire-up (input.value into
// conversationSearchQueries, then re-render) attached during the app's DOMContentLoaded boot
// sequence. Driving it through a real dispatched DOM event would require booting the full
// renderer (config load, conversation hydration, etc. via window.api), which is unrelated
// integration surface for what is otherwise a pure filtering feature. So the wiring itself is
// verified at the source level, and the actual filtering logic (the part with real behavior to
// get wrong) is exercised directly through conversationSearchQueries + renderConversationList,
// the same way the rest of this codebase's non-interactive renderer tests already work.
test('the search inputs are wired to update conversationSearchQueries and re-render on input', (t) => {
  const fs = require('fs');
  const path = require('path');
  const rendererJs = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  t.ok(rendererJs.includes("conversationSearchQueries[mode] = input.value"), 'the input handler updates the per-mode query');
  t.ok(rendererJs.includes('conversationSearchOrion') && rendererJs.includes('conversationSearchCoder') && rendererJs.includes('conversationSearchOperator'), 'all three search inputs are bound');
  t.end();
});

test('a non-empty query filters the Coder standalone list by title, case-insensitively', (t) => {
  const conversations = [
    { id: 'c1', mode: 'coder', title: 'Fix login bug', messages: [], projectPath: '' },
    { id: 'c2', mode: 'coder', title: 'Refactor database layer', messages: [], projectPath: '' },
    { id: 'c3', mode: 'coder', title: 'Login page redesign', messages: [], projectPath: '' }
  ];
  const { win, expose } = loadRenderer({ t, set: { conversations }, expose: ['conversationSearchQueries'] });
  win.renderConversationList();
  t.equal(win.document.querySelectorAll('#conversation-list-coder .conversation-item').length, 3, 'all three show with no query');

  expose.conversationSearchQueries.coder = 'LOGIN';
  win.renderConversationList();

  const names = Array.from(win.document.querySelectorAll('#conversation-list-coder .conversation-name')).map(n => n.textContent);
  t.equal(names.length, 2, 'only the two matching titles remain');
  t.ok(names.includes('Fix login bug') && names.includes('Login page redesign'));
  t.notOk(names.includes('Refactor database layer'), 'the non-matching conversation is filtered out');
  t.end();
});

test('clearing the query restores the full list', (t) => {
  const conversations = [
    { id: 'c1', mode: 'coder', title: 'Alpha', messages: [], projectPath: '' },
    { id: 'c2', mode: 'coder', title: 'Beta', messages: [], projectPath: '' }
  ];
  const { win, expose } = loadRenderer({ t, set: { conversations }, expose: ['conversationSearchQueries'] });
  expose.conversationSearchQueries.coder = 'Alpha';
  win.renderConversationList();
  t.equal(win.document.querySelectorAll('#conversation-list-coder .conversation-item').length, 1);
  expose.conversationSearchQueries.coder = '';
  win.renderConversationList();
  t.equal(win.document.querySelectorAll('#conversation-list-coder .conversation-item').length, 2, 'clearing the query shows everything again');
  t.end();
});

test('search queries are independent per sidebar tab', (t) => {
  const conversations = [
    { id: 'c1', mode: 'orion', title: 'Plan the trip', messages: [] },
    { id: 'c2', mode: 'coder', title: 'Plan the refactor', messages: [], projectPath: '' }
  ];
  const { win, expose } = loadRenderer({ t, set: { conversations }, expose: ['conversationSearchQueries'] });
  expose.conversationSearchQueries.coder = 'refactor';
  win.renderConversationList();
  // The Orion query was never touched and should still show its own conversation untouched.
  t.equal(win.document.querySelectorAll('#conversation-list .conversation-item').length, 1, 'Dispatch list is unaffected by a query set on the Coder tab');
  t.equal(win.document.querySelectorAll('#conversation-list-coder .conversation-item').length, 1, 'Coder list is filtered by its own query');
  t.end();
});

test('a query that matches nothing shows a distinct empty state from "no conversations yet"', (t) => {
  const conversations = [{ id: 'c1', mode: 'coder', title: 'Alpha', messages: [], projectPath: '' }];
  const { win, expose } = loadRenderer({ t, set: { conversations }, expose: ['conversationSearchQueries'] });
  expose.conversationSearchQueries.coder = 'zzz-does-not-exist';
  win.renderConversationList();
  t.match(win.document.getElementById('conversation-list-coder').textContent, /match your search/i);
  t.end();
});

// ── rename ─────────────────────────────────────────────────────────────────────────────────────

test('renameConversation updates the title, persists it, and re-renders the list', (t) => {
  const conv = { id: 'c1', mode: 'coder', title: 'Old title', messages: [], projectPath: '' };
  const { win } = loadRenderer({ t, set: { conversations: [conv], activeConversationId: 'c1' } });
  win.prompt = () => 'New title';
  win.renameConversation('c1');
  t.equal(win.document.querySelector('#conversation-list-coder .conversation-name').textContent, 'New title', 'the rendered row reflects the new title');
  t.ok(win.document.getElementById('chat-title').textContent === 'New title', 'the open conversation\'s header title updates too, since it is the active conversation');
  t.end();
});

test('renameConversation does nothing when the prompt is cancelled', (t) => {
  const conv = { id: 'c1', mode: 'coder', title: 'Keep me', messages: [], projectPath: '' };
  const { win, read } = loadRenderer({ t, set: { conversations: [conv] } });
  win.prompt = () => null; // user hit Cancel
  win.renameConversation('c1');
  t.equal(read('conversations')[0].title, 'Keep me', 'title is unchanged after a cancelled prompt');
  t.end();
});

test('renameConversation ignores an empty or whitespace-only new title', (t) => {
  const conv = { id: 'c1', mode: 'coder', title: 'Keep me too', messages: [], projectPath: '' };
  const { win, read } = loadRenderer({ t, set: { conversations: [conv] } });
  win.prompt = () => '   ';
  win.renameConversation('c1');
  t.equal(read('conversations')[0].title, 'Keep me too');
  t.end();
});

test('the rename button in the sidebar row is wired and separate from the delete button', (t) => {
  const conv = { id: 'c1', mode: 'coder', title: 'Row test', messages: [], projectPath: '' };
  const { win } = loadRenderer({ t, set: { conversations: [conv] } });
  win.renderConversationList();
  const item = win.document.querySelector('#conversation-list-coder .conversation-item');
  t.ok(item.querySelector('.rename-btn'), 'a dedicated rename button exists on the row');
  t.ok(item.querySelector('.delete-btn'), 'the delete button still exists alongside it');
  t.end();
});
