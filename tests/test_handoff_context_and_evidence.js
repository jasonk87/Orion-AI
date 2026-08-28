'use strict';

// Three defects from one real Operator run ("read my DeepSeek balance from a browser favorite"):
//
//   1. Dispatch handed Operator the ENTIRE preceding conversation as "Relevant preceding
//      conversation" — release-notes discussion, branch commentary, security debate, and a stale
//      claim the user had already corrected — in front of a task whose whole content was one
//      sentence. Every handoff paid for that.
//   2. open_chrome_favorite actually opened the favorite, but its post-action screenshot hit the
//      known empty-framebuffer failure, the throw propagated, and the tool reported
//      "Captured screen image was empty" as though OPENING had failed.
//   3. Operator then burned a second predictable failure on capture_screen before landing on
//      open_application("Chrome"), which worked only because that handler already passed a window
//      hint — so the named-window fallback could engage. The other handlers passed no hint.
//
// The principle: handoffs carry evidence, not chatter; actions report what happened, evidence
// reports what was verified.

process.env.NODE_ENV = 'test';
global.window = {};

const test = require('tape');
const taskOrchestration = require('../task-orchestration');
const computerUse = require('../lib/ipc-computer-use');

// ── 1. Handoff packets carry a brief, not a transcript ───────────────────────

function chatterConversation(turns) {
  const messages = [];
  for (let i = 0; i < turns; i += 1) {
    messages.push({ role: 'user', text: 'Unrelated question ' + i + ' about branches, commits, CSP and release notes. '.repeat(6) });
    messages.push({ role: 'assistant', text: 'Unrelated answer ' + i + ' about memory fixes, routing and branch hygiene. '.repeat(6) });
  }
  return messages;
}

function packetFor(messages, overrides = {}) {
  const built = taskOrchestration.buildTaskPacket({
    originalUserMessage: 'Have the operator get my balance? It is on my favorites tab.',
    objective: 'Read the DeepSeek account balance from the saved browser favorite.',
    precedingMessages: messages,
    target: { conversationId: 'operator-1', mode: 'operator' },
    origin: { conversationId: 'dispatch-1' },
    ...overrides
  });
  return built.task;
}

test('a handoff carries a short excerpt, not the whole preceding conversation', t => {
  const task = packetFor(chatterConversation(12)); // 24 messages of unrelated discussion
  const summary = task.precedingConversationSummary || '';
  t.ok(summary.length <= 1200,
    'the excerpt is bounded (' + summary.length + ' chars) rather than the old 8000-character transcript');
  t.ok(summary.split('\n').length <= 4,
    'at most the last two exchanges survive, which is what referent resolution actually needs');
  t.equal(task.objective, 'Read the DeepSeek account balance from the saved browser favorite.',
    'the actual brief is untouched - trimming context must not trim the task');
  t.end();
});

test('the most recent exchange is what survives, so referents still resolve', t => {
  const messages = chatterConversation(6).concat([
    { role: 'user', text: 'What about the DeepSeek one?' },
    { role: 'assistant', text: 'I can read that balance for you.' }
  ]);
  const summary = packetFor(messages).precedingConversationSummary || '';
  t.ok(/DeepSeek one/.test(summary), 'the immediately preceding turn is kept, so "that" can be resolved');
  t.notOk(/Unrelated question 0/.test(summary), 'the oldest chatter is dropped');
  t.end();
});

test('a caller passing a whole transcript through the explicit field is still capped', t => {
  const task = packetFor([], { precedingConversationSummary: 'x'.repeat(9000) });
  t.ok((task.precedingConversationSummary || '').length <= 1200,
    'the explicit path cannot reintroduce the bloat by routing around the excerpt builder');
  t.end();
});

test('a short conversation is unaffected', t => {
  const summary = packetFor([
    { role: 'user', text: 'Check my balance please.' },
    { role: 'assistant', text: 'Handing that to Operator.' }
  ]).precedingConversationSummary || '';
  t.ok(/Check my balance please/.test(summary), 'genuinely relevant recent context is preserved intact');
  t.end();
});

// ── 2 & 3. Action success and evidence capture are separate facts ────────────

function handlersWith(options) {
  const handlers = {};
  computerUse.registerHandlers({ handle: (name, fn) => { handlers[name] = fn; } }, options);
  return handlers;
}

const EMPTY_FRAME = 'Captured screen image was empty.';

test('opening a favorite still succeeds when the post-action screenshot fails', async t => {
  let hint = null;
  const handlers = handlersWith({
    captureDesktopScreenshot: async (workspacePath, destination, prefix, opts) => {
      hint = opts.windowHint;
      throw new Error(EMPTY_FRAME);
    },
    resolveChromeFavorite: async () => ({
      success: true, favorite: { name: 'DeepSeek Platform', url: 'https://platform.deepseek.com' }, matchKind: 'exact'
    }),
    openFavorite: async () => ({ success: true })
  });

  const result = await handlers['open-chrome-favorite'](null, {
    name: 'DeepSeek', conversationId: 'conv-1', workspacePath: 'C:\\ws'
  });

  t.equal(result.success, true,
    'the favorite really was opened, so the action is a success even though evidence capture failed');
  t.equal(result.favorite.name, 'DeepSeek Platform', 'and the action result is preserved rather than discarded');
  // captureSuccess/captureError/summary is the convention open_application already established for
  // exactly this split; the other two handlers now speak it too rather than inventing a second one.
  t.equal(result.captureSuccess, false, 'evidence is separately reported as NOT captured');
  t.match(result.captureError, /empty/i, 'with the underlying capture error kept explicit');
  t.match(result.summary, /^Opened Chrome favorite "DeepSeek Platform", but could not capture/,
    'and the summary states what happened and what could not be verified, in that order');
  t.equal(result.path, '', 'no screenshot path is claimed, so nothing can treat this as verified');
  t.end();
});

test('every semantic handler names a window, so the native fallback can engage', async t => {
  const hints = {};
  const handlers = handlersWith({
    captureDesktopScreenshot: async (workspacePath, destination, prefix, opts) => {
      hints[prefix] = opts.windowHint;
      throw new Error(EMPTY_FRAME);
    },
    resolveChromeFavorite: async () => ({ success: true, favorite: { name: 'DeepSeek', url: 'https://x' }, matchKind: 'exact' }),
    openFavorite: async () => ({ success: true }),
    runApplication: async () => ({ success: true, method: 'activated', appName: 'Chrome', windowTitle: 'Chrome' }),
    runUiAction: async () => ({ success: true, method: 'invoke', name: 'Settings' })
  });

  await handlers['open-chrome-favorite'](null, { name: 'DeepSeek', conversationId: 'c', workspacePath: 'C:\\ws' });
  await handlers['open-application'](null, { appName: 'Chrome', conversationId: 'c', workspacePath: 'C:\\ws' });
  await handlers['click-accessible-ui'](null, { targetText: 'Settings', appName: 'Chrome', conversationId: 'c', workspacePath: 'C:\\ws' });

  // This is the specific gap the live run hit: open_application worked because it already passed a
  // hint; the other two passed none, so captureDesktopScreenshot could not use the named-window
  // path and simply threw.
  t.equal(hints['chrome-favorite'], 'Chrome', 'a favorite opens in Chrome, so Chrome is the fallback window');
  t.ok(hints['application'], 'opening an application names that application');
  t.ok(hints['accessible-ui'], 'activating a control names the application it lives in');
  t.end();
});

test('a control activation with no known application does not invent a window to capture', async t => {
  let hint = 'unset';
  const handlers = handlersWith({
    captureDesktopScreenshot: async (workspacePath, destination, prefix, opts) => {
      hint = opts.windowHint;
      throw new Error(EMPTY_FRAME);
    },
    runUiAction: async () => ({ success: true, method: 'invoke', name: 'OK' })
  });
  await handlers['click-accessible-ui'](null, { targetText: 'OK', conversationId: 'c', workspacePath: 'C:\\ws' });
  t.equal(hint, '', 'with no app name there is genuinely no window to name, so the fallback is skipped rather than guessed');
  t.end();
});

test('a successful capture reports evidence as captured', async t => {
  const handlers = handlersWith({
    captureDesktopScreenshot: async () => ({
      rel: 'screenshots/x.png', artifactPath: 'a', artifactRelativePath: 'b',
      size: { width: 1216, height: 808 }, png: Buffer.alloc(64)
    }),
    resolveChromeFavorite: async () => ({ success: true, favorite: { name: 'DeepSeek', url: 'https://x' }, matchKind: 'exact' }),
    openFavorite: async () => ({ success: true })
  });
  const result = await handlers['open-chrome-favorite'](null, { name: 'DeepSeek', conversationId: 'c', workspacePath: 'C:\\ws' });
  t.equal(result.success, true, 'the action succeeded');
  t.equal(result.captureSuccess, true, 'and evidence was captured');
  t.equal(result.path, 'screenshots/x.png', 'with a real screenshot path to inspect');
  t.equal(result.width, 1216, 'and real dimensions');
  t.end();
});

test('a genuine action failure is still a failure, not an evidence problem', async t => {
  const handlers = handlersWith({
    captureDesktopScreenshot: async () => ({ rel: 'x.png', size: { width: 1, height: 1 }, png: Buffer.alloc(1) }),
    resolveChromeFavorite: async () => ({ success: false, notFound: true, reasonCode: 'favorite_not_found', error: 'No Chrome favorite matched "Nope".' })
  });
  const result = await handlers['open-chrome-favorite'](null, { name: 'Nope', conversationId: 'c', workspacePath: 'C:\\ws' });
  t.equal(result.success, false, 'an unresolvable favorite is a real action failure');
  t.equal(result.reasonCode, 'favorite_not_found', 'reported structurally');
  t.equal(result.captureSuccess, undefined, 'and it never reaches the evidence stage, so nothing is muddled');
  t.end();
});
