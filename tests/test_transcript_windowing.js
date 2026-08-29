'use strict';

// A long conversation used to render EVERY visible message on open - every bubble, tool log,
// markdown block and image. Jason reported the desktop lagging and struggling to scroll once a
// conversation got long, which is exactly that cost: it grows without bound while the newest
// messages, the ones actually being read, stay the same handful.
//
// The window bounds RENDERING only. Nothing is removed from conv.messages, from disk, or from what
// the model receives - so these tests check both halves: that the DOM stays bounded, and that the
// underlying transcript is untouched and fully reachable.
//
// The phone already transported only the newest 40 (renderer.js), so the desktop was the one
// surface with no bound at all. Both now use one named constant rather than two magic numbers.

process.env.NODE_ENV = 'test';

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');

const CONV_ID = 'conv-long-transcript';

function longConversation(pairs) {
  const messages = [];
  for (let i = 0; i < pairs; i += 1) {
    messages.push({ role: 'user', text: `question ${i}`, createdAt: 1700000000000 + i * 2 });
    messages.push({ role: 'assistant', text: `answer ${i}`, createdAt: 1700000000000 + i * 2 + 1 });
  }
  return { id: CONV_ID, title: 'Long one', mode: 'coder', workspace: 'C:\\ws', messages, tasks: [] };
}

async function openConversation(t, conv) {
  const harness = loadRenderer({
    t,
    set: { conversations: [conv], activeConversationId: null },
    api: {}
  });
  await harness.win.selectConversation(conv.id);
  return harness;
}

function bubbleCount(win) {
  const container = win.document.getElementById('messages-container');
  return container ? container.querySelectorAll('.message-bubble').length : 0;
}

function clickShowEarlier(win) {
  const button = controlButton(win);
  if (!button) throw new Error('no "show earlier" control is present to click');
  win.handleShowEarlierMessagesClick({ target: button });
}

function controlButton(win) {
  const container = win.document.getElementById('messages-container');
  return container ? container.querySelector('[data-transcript-show-earlier]') : null;
}

function renderedText(win) {
  const container = win.document.getElementById('messages-container');
  return container ? container.textContent : '';
}

test('a short conversation renders completely, with no window control', async t => {
  const conv = longConversation(5); // 10 messages, under the window
  const { win } = await openConversation(t, conv);
  t.ok(/question 0/.test(renderedText(win)), 'the very first message is rendered');
  t.ok(/answer 4/.test(renderedText(win)), 'and so is the last');
  t.notOk(controlButton(win), 'nothing is hidden, so no "show earlier" control appears');
  t.end();
});

test('a long conversation renders a bounded window instead of every message', async t => {
  const conv = longConversation(200); // 400 messages
  const { win } = await openConversation(t, conv);
  const bubbles = bubbleCount(win);
  t.ok(bubbles < 60, `the DOM stays bounded (${bubbles} bubbles for a 400-message conversation)`);
  t.ok(controlButton(win), 'a control is offered for the messages above the window');
  t.end();
});

test('the window keeps the NEWEST messages, which are the ones being read', async t => {
  const conv = longConversation(200);
  const { win } = await openConversation(t, conv);
  const text = renderedText(win);
  t.ok(/answer 199/.test(text), 'the most recent exchange is present');
  t.notOk(/question 0\b/.test(text), 'the oldest is not rendered');
  t.end();
});

test('the control states how many messages are above the window, so nothing looks lost', async t => {
  const conv = longConversation(200);
  const { win } = await openConversation(t, conv);
  const container = win.document.getElementById('messages-container');
  const control = container.querySelector('[data-transcript-window-control]');
  t.ok(control, 'the control is rendered');
  t.match(control.textContent, /\d+ earlier messages? in this conversation/,
    'and reports the real remaining count rather than a vague "older messages"');
  t.end();
});

test('the underlying transcript is never truncated - this bounds rendering, not history', async t => {
  const conv = longConversation(200);
  const { win, read } = await openConversation(t, conv);
  const stored = (read('conversations') || []).find(c => c.id === CONV_ID);
  t.equal(stored.messages.length, 400, 'every message is still in the conversation record');
  t.equal(stored.messages[0].text, 'question 0', 'including the oldest, untouched');
  t.ok(bubbleCount(win) < stored.messages.length, 'only the rendering was bounded');
  t.end();
});

test('"show earlier" reveals more of the same conversation', async t => {
  const conv = longConversation(200);
  const { win } = await openConversation(t, conv);
  const before = bubbleCount(win);
  clickShowEarlier(win);
  const after = bubbleCount(win);
  t.ok(after > before, `more history is rendered after expanding (${before} -> ${after})`);
  t.ok(controlButton(win), 'and the control remains while there is still more above');
  t.end();
});

test('expanding repeatedly reaches the very beginning and then stops offering', async t => {
  const conv = longConversation(30); // 60 messages: one expansion clears the remainder
  const { win } = await openConversation(t, conv);
  t.ok(controlButton(win), 'precondition: some history starts hidden');
  clickShowEarlier(win);
  t.ok(/question 0/.test(renderedText(win)), 'the first message of the conversation is now rendered');
  t.notOk(controlButton(win), 'and the control disappears once nothing is left above');
  t.end();
});

test('reopening a different conversation starts bounded again', async t => {
  const longConv = longConversation(200);
  const shortConv = { id: 'conv-short', title: 'Short', mode: 'coder', workspace: 'C:\\ws', messages: [{ role: 'user', text: 'hi' }], tasks: [] };
  const harness = loadRenderer({
    t,
    set: { conversations: [longConv, shortConv], activeConversationId: null },
    api: {}
  });
  await harness.win.selectConversation(CONV_ID);
  clickShowEarlier(harness.win);
  const expanded = bubbleCount(harness.win);

  await harness.win.selectConversation('conv-short');
  await harness.win.selectConversation(CONV_ID);
  const reopened = bubbleCount(harness.win);
  t.ok(reopened < expanded,
    `a fresh open is bounded again rather than inheriting the previous expansion (${expanded} -> ${reopened})`);
  t.end();
});

test('the control is actually wired into the transcript, not just defined', t => {
  // These tests invoke the handler directly, because booting the renderer would clobber the
  // injected conversations. So the delegation itself is asserted here: without this listener the
  // button would render and do nothing.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  t.ok(/messagesContainer\.addEventListener\('click', handleShowEarlierMessagesClick\)/.test(source),
    'the click is delegated on the messages container');
  t.ok(/function handleShowEarlierMessagesClick/.test(source), 'and the handler it names exists');
  t.end();
});

test('the desktop and the phone share one window size instead of two magic numbers', t => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  t.ok(/const TRANSCRIPT_WINDOW_MESSAGES = \d+/.test(source), 'the window is a named constant');
  t.ok(/slice\(-TRANSCRIPT_WINDOW_MESSAGES\)/.test(source),
    'the phone transport uses that same constant rather than a second hardcoded 40');
  t.end();
});

test('expanding works even when background navigation has moved activeConversationId', async t => {
  // The regression this guards: the handler used to look the conversation up by
  // activeConversationId, which is also written by background navigation sync. When it had moved
  // on, the button rendered and silently did nothing - reproduced live in the packaged app.
  const conv = longConversation(200);
  const other = { id: 'conv-elsewhere', title: 'Elsewhere', mode: 'coder', workspace: 'C:\ws', messages: [], tasks: [] };
  const harness = loadRenderer({
    t,
    set: { conversations: [conv, other], activeConversationId: null },
    api: {}
  });
  await harness.win.selectConversation(CONV_ID);
  const before = bubbleCount(harness.win);

  // Simulate background sync pointing activeConversationId somewhere else while the reader is
  // still looking at the long transcript.
  harness.read("activeConversationId = 'conv-elsewhere'");

  clickShowEarlier(harness.win);
  t.ok(bubbleCount(harness.win) > before,
    `the conversation on screen still expands (${before} -> ${bubbleCount(harness.win)})`);
  t.end();
});
