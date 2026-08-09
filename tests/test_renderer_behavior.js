// Behavioral coverage for renderer.js.
//
// renderer.js is ~9.3k lines and was previously verified only by asserting that certain
// strings appeared in its source. Those assertions pass when the matched text sits in a
// comment or an unreachable branch, and fail on a harmless rename — they test the spelling
// of the code, not what it does. Everything here runs the real renderer against a real DOM
// built from the real index.html, via tests/helpers/renderer-harness.js.

const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');
const operational = require('../operational-context');
const workspaceResolution = require('../workspace-resolution');
const semanticIntentRouter = require('../semantic-intent-router');
const reasoningPolicy = require('../reasoning-policy');

// ── Chat auto-scroll ───────────────────────────────────────────────────────────
// The chat must stick to the bottom while you are following along, and must NOT yank you
// back down when you have scrolled up to read earlier output during a long run.

function setScroll(win, { scrollHeight, scrollTop, clientHeight }) {
  const feed = win.document.getElementById('chat-feed');
  Object.defineProperty(feed, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(feed, 'clientHeight', { value: clientHeight, configurable: true });
  feed.scrollTop = scrollTop;
  return feed;
}

test('chat sticks to the bottom only when the user is already there', (t) => {
  const { win } = loadRenderer({ t });

  setScroll(win, { scrollHeight: 5000, scrollTop: 4400, clientHeight: 600 });
  t.equal(win.shouldAutoScrollChat(), true, 'pinned to the bottom keeps auto-scrolling');

  setScroll(win, { scrollHeight: 5000, scrollTop: 1000, clientHeight: 600 });
  t.equal(win.shouldAutoScrollChat(), false, 'scrolled up to read, new output does not yank the view down');

  // The threshold exists so "close enough to the bottom" still counts as following along.
  setScroll(win, { scrollHeight: 5000, scrollTop: 4380, clientHeight: 600 });
  t.equal(win.shouldAutoScrollChat(), true, 'a few pixels off the bottom still counts as following');

  setScroll(win, { scrollHeight: 600, scrollTop: 0, clientHeight: 600 });
  t.equal(win.shouldAutoScrollChat(), true, 'a chat shorter than the viewport is always at the bottom');
  t.end();
});

test('scrollChatToBottom actually moves the feed to the bottom', (t) => {
  const { win } = loadRenderer({ t });
  const feed = setScroll(win, { scrollHeight: 5000, scrollTop: 0, clientHeight: 600 });

  win.scrollChatToBottom();
  t.equal(feed.scrollTop, 5000, 'the feed is scrolled to its full height');

  feed.scrollTop = 0;
  win.scrollChatToBottomIfNeeded(false);
  t.equal(feed.scrollTop, 0, 'the gated helper does not scroll when the user is reading history');

  win.scrollChatToBottomIfNeeded(true);
  t.equal(feed.scrollTop, 5000, 'the gated helper scrolls when the user is following along');
  t.end();
});

// ── Phone companion origin ─────────────────────────────────────────────────────
// This value is used to reach the desktop from a phone. Anything that is not a valid
// https origin must be rejected outright rather than stored and half-trusted.

test('phone companion origin accepts only https origins', (t) => {
  const { win } = loadRenderer({ t });
  const normalize = win.normalizePhoneHttpsOrigin;

  t.equal(normalize('https://orion.example.com'), 'https://orion.example.com', 'a plain https origin is kept');
  t.equal(normalize('  https://orion.example.com  '), 'https://orion.example.com', 'surrounding whitespace is trimmed');
  t.equal(normalize('https://orion.example.com:8443/some/path?q=1'),
    'https://orion.example.com:8443', 'the origin is kept and the path/query discarded');

  t.equal(normalize('http://orion.example.com'), '', 'plaintext http is rejected');
  t.equal(normalize('ftp://orion.example.com'), '', 'a non-web scheme is rejected');
  t.equal(normalize('javascript:alert(1)'), '', 'a javascript: URL is rejected');
  t.equal(normalize('orion.example.com'), '', 'a bare host with no scheme is rejected');
  t.equal(normalize('not a url'), '', 'unparseable input is rejected');
  t.equal(normalize(''), '', 'empty input yields empty');
  t.equal(normalize(null), '', 'null yields empty rather than throwing');
  t.equal(normalize(undefined), '', 'undefined yields empty rather than throwing');
  t.end();
});

// ── Thinking placeholders ──────────────────────────────────────────────────────

test('empty Thinking placeholders are suppressed but real content is never dropped', (t) => {
  const { win } = loadRenderer({ t });
  const isEmpty = win.isEmptyThinkingPlaceholder;

  t.equal(isEmpty('Thinking...', []), true, 'a bare Thinking placeholder with no logs is empty');
  t.equal(isEmpty('  Thinking...  ', []), true, 'whitespace around the placeholder still counts as empty');
  t.equal(isEmpty('Thinking...', [{ type: 'tool_call' }]), false,
    'a placeholder with tool activity is real content and must render');
  t.equal(isEmpty('Here is the fix.', []), false, 'a real answer is never treated as an empty placeholder');
  t.equal(isEmpty('', []), false, 'an empty string is not the Thinking placeholder');
  t.equal(isEmpty(null, []), false, 'null text does not throw');
  t.end();
});

// ── Conversation replay ────────────────────────────────────────────────────────
// Conversations on disk span several historical shapes. Replay must recover assistant
// text from every one of them: dropping it silently is how a transcript ends up
// one-sided after a reload.

test('replay normalizes every historical assistant role to "assistant"', (t) => {
  const { win } = loadRenderer({ t });
  const normalize = win.normalizeConversationMessageForReplay;

  for (const role of ['assistant', 'model', 'ai', 'orion', 'ASSISTANT', 'Model']) {
    t.equal(normalize({ role, text: 'hi' }).role, 'assistant', `role "${role}" replays as assistant`);
  }
  for (const role of ['user', 'human', 'USER']) {
    t.equal(normalize({ role, text: 'hi' }).role, 'user', `role "${role}" replays as user`);
  }
  t.end();
});

test('replay recovers assistant text from every stored message shape', (t) => {
  const { win } = loadRenderer({ t });
  const normalize = win.normalizeConversationMessageForReplay;

  t.equal(normalize({ role: 'model', text: 'from text' }).text, 'from text', 'reads .text');
  t.equal(normalize({ role: 'model', content: 'from content' }).text, 'from content', 'reads .content');
  t.equal(normalize({ role: 'model', output: 'from output' }).text, 'from output', 'reads .output');
  t.equal(normalize({ role: 'model', result: 'from result' }).text, 'from result', 'reads .result');
  t.equal(normalize({ role: 'model', message: 'from message' }).text, 'from message', 'reads .message');

  t.equal(normalize({ role: 'model', parts: [{ text: 'gemini part' }] }).text, 'gemini part',
    'reads Gemini-style parts');
  t.equal(normalize({ role: 'model', content: [{ text: 'anthropic block' }] }).text, 'anthropic block',
    'reads Anthropic-style content blocks');
  t.equal(normalize({ role: 'model', content: [{ output_text: 'openai part' }] }).text, 'openai part',
    'reads OpenAI-style output_text parts');
  t.equal(normalize({ role: 'model', parts: [{ text: 'line one' }, { text: 'line two' }] }).text,
    'line one\nline two', 'joins multi-part messages');
  t.equal(normalize({ role: 'model', parts: ['raw string part'] }).text, 'raw string part',
    'reads bare string parts');

  t.equal(normalize({ role: 'model' }).text, '', 'a message with no recoverable text yields empty, not undefined');
  t.equal(normalize(null).text, '', 'a null message does not throw');
  t.end();
});

test('replay rebuilds tool logs from legacy messages that only stored turns', (t) => {
  const { win } = loadRenderer({ t });

  const legacy = {
    role: 'model',
    text: 'done',
    turns: [{
      modelParts: [{ functionCall: { name: 'read_file', args: { path: 'a.js' } } }],
      toolResponseParts: [{ functionResponse: { name: 'read_file', response: { content: 'ok' } } }]
    }]
  };
  const logs = win.normalizeConversationMessageForReplay(legacy).logs;
  t.equal(logs.length, 1, 'one tool call is rebuilt from the stored turn');
  t.equal(logs[0].tool, 'read_file', 'the tool name is recovered');
  t.deepEqual(logs[0].params, { path: 'a.js' }, 'the tool arguments are recovered');
  t.notEqual(logs[0].status, 'running', 'a call with a stored response is not left stuck as running');

  const modern = { role: 'model', text: 'done', logs: [{ type: 'tool_call', tool: 'grep_search' }] };
  t.equal(win.normalizeConversationMessageForReplay(modern).logs[0].tool, 'grep_search',
    'messages that already have logs keep them rather than being rebuilt');
  t.end();
});

test('desktop replay hides internal compaction scaffolding from old and new conversations', async (t) => {
  const conversation = {
    id: 'compacted-conversation',
    title: "What's up",
    mode: 'orion',
    workspace: '',
    messages: [
      { role: 'user', text: '[COMPACTED CONTEXT SUMMARY]\nPrivate summary.' },
      { role: 'assistant', text: 'Understood. I will use this compacted summary as prior context.' },
      { role: 'system', text: 'Context reached 125000 tokens; compacting for model-x at threshold 100000.' },
      { role: 'user', text: "What's up?" },
      { role: 'assistant', text: 'Hey Jason, I am here.' }
    ],
    tasks: []
  };
  const { win } = loadRenderer({
    t,
    globals: { OrionOperationalContext: operational },
    set: { conversations: [conversation], activeConversationId: conversation.id, appMode: 'orion' }
  });

  await win.selectConversation(conversation.id);
  const transcript = win.document.getElementById('messages-container').textContent;
  t.notOk(/COMPACTED CONTEXT SUMMARY|compacted summary as prior context|Context reached 125000/.test(transcript), 'internal compaction records do not render');
  t.match(transcript, /What's up\?/, 'real user message still renders');
  t.match(transcript, /Hey Jason, I am here/, 'real assistant answer still renders');

  const phoneState = await win.getPhoneCompanionState(conversation.id);
  const phoneTranscript = JSON.stringify(phoneState.messages || []);
  t.notOk(/COMPACTED CONTEXT SUMMARY|compacted summary as prior context|Context reached 125000/.test(phoneTranscript), 'internal compaction records are also absent from phone state');
  t.match(phoneTranscript, /What's up\?/, 'phone state retains the real user message');
  t.match(phoneTranscript, /Hey Jason, I am here/, 'phone state retains the real assistant answer');
  t.end();
});

// ── Orphaned turns ─────────────────────────────────────────────────────────────

test('a queued follow-up gets a status bubble; a crashed run does not get a fake one', (t) => {
  const { win } = loadRenderer({ t });
  const build = win.buildMissingAssistantResponseMessage;

  const orphanUser = [{ role: 'user', text: 'do the thing' }];

  const queued = build(orphanUser, { queued: true });
  t.ok(queued, 'a queued prompt with no reply yet explains itself');
  t.equal(queued.role, 'assistant', 'the status is an assistant-side message');
  t.ok(queued.statusOnly, 'it is marked status-only, not a real answer');
  t.ok(/queued/i.test(queued.text), 'the text tells the user the work is queued');

  t.equal(build(orphanUser, {}), null,
    'a run that ended without a reply is left incomplete rather than given a fabricated bubble');

  const answered = [
    { role: 'user', text: 'do the thing' },
    { role: 'assistant', text: 'done', logs: [] }
  ];
  t.equal(build(answered, { queued: true }), null, 'an already-answered turn gets no status bubble');

  const placeholderOnly = [
    { role: 'user', text: 'do the thing' },
    { role: 'assistant', text: 'Thinking...', logs: [] }
  ];
  t.ok(build(placeholderOnly, { queued: true }),
    'an empty Thinking placeholder does not count as a real reply');

  t.equal(build([], { queued: true }), null, 'an empty transcript yields nothing');
  t.equal(build(null, { queued: true }), null, 'a null transcript does not throw');
  t.end();
});

// ── Queued prompt identity ─────────────────────────────────────────────────────

test('queued prompt ids are unique so cards cannot collide', (t) => {
  const { win } = loadRenderer({ t });
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(win.createQueuedPromptId());
  t.equal(ids.size, 500, '500 consecutive ids are all distinct');
  t.end();
});

// ── System card dedupe ─────────────────────────────────────────────────────────

test('duplicate system cards are suppressed within their dedupe window', (t) => {
  const { win } = loadRenderer({ t });

  t.equal(win.shouldDedupeSystemCard('workspace-changed'), false, 'the first card is shown');
  t.equal(win.shouldDedupeSystemCard('workspace-changed'), true, 'an immediate repeat is suppressed');
  t.equal(win.shouldDedupeSystemCard('other-event'), false, 'a different event is not suppressed');
  t.equal(win.shouldDedupeSystemCard('workspace-changed', 0), false,
    'a zero-length window lets the card through again');
  t.end();
});

// ── Renderer/markup contract ───────────────────────────────────────────────────
// renderer.js resolves its element handles from index.html at load. A renamed or deleted
// id leaves a silent null that only fails later, at click time, in the packaged app.
// Loading the real markup makes that drift a test failure instead.

// renderer.js resolves its element handles from index.html at load. A renamed or deleted
// id leaves a silent null that only fails later, at click time, in the packaged app.
// Loading the real markup turns that drift into a test failure.
//
// These seven ids no longer exist in index.html: the inline test panel and the workspace
// entrypoint input were removed from the markup but their renderer code was left behind.
// Every use site guards with `if (el.x)` or an early return, so they are inert rather than
// crashing — which is exactly why nothing caught them. They are pinned here so the dead
// code is visible and, more importantly, so any NEW dangling binding fails immediately.
const KNOWN_INERT_BINDINGS = [
  'btnRunTestsManually',
  'btnSaveEntrypoint',
  'lblTestCmd',
  'settingAutoTest',
  'testIndicator',
  'testResults',
  'workspaceEntrypointInput'
];

test('every element renderer.js binds at load exists in index.html', (t) => {
  const { expose } = loadRenderer({ t, expose: ['el'] });
  const el = expose.el;

  t.ok(el && typeof el === 'object', 'the renderer exposes its element map');

  const missing = Object.keys(el).filter(key => el[key] === null).sort();
  const unexpected = missing.filter(key => !KNOWN_INERT_BINDINGS.includes(key));
  const resurrected = KNOWN_INERT_BINDINGS.filter(key => !missing.includes(key));

  t.deepEqual(unexpected, [],
    `no new dangling element binding (found: ${unexpected.join(', ') || 'none'})`);
  t.deepEqual(resurrected, [],
    `the known-inert list has no stale entries (drop from the list: ${resurrected.join(', ') || 'none'})`);

  // Spot-check the handles the core loop cannot work without.
  for (const key of ['chatFeed', 'chatInput', 'chatTitle', 'btnNewChat']) {
    t.ok(el[key], `el.${key} is bound`);
  }
  t.end();
});

// ── Boot resilience ────────────────────────────────────────────────────────────
// Reported live: "TypeError: Cannot read properties of undefined (reading 'readConfig')
// at loadSettings (renderer.js:539) at HTMLDocument.<anonymous> (renderer.js:217)".
//
// window.api was unavailable, so loadSettings threw — and because it was the second
// statement of one unguarded async init sequence, the rejection skipped every remaining
// step: workspace handlers, chat wiring, the update checker, image attach, every button
// binding. The window still rendered, so it read as a hang rather than a failure.

// The harness captures the DOMContentLoaded handler rather than letting jsdom fire it, so boot
// runs exactly once, under this test's control, and cannot outlive the window in teardown.
async function bootRenderer(t, options = {}) {
  const loaded = loadRenderer({ t, trap: true, ...options });
  await loaded.boot();
  return loaded;
}

test('one failing init step does not cancel the rest of startup', async (t) => {
  // readConfig rejects the way a malformed config on disk would.
  const { win, expose } = await bootRenderer(t, {
    expose: ['el'],
    api: { readConfig: async () => { throw new Error('config read failed'); } }
  });

  const faults = win.__orionFaults || [];
  const settingsFault = faults.find(f => f.kind === 'init:settings');
  t.ok(settingsFault, 'the failing step is reported rather than swallowed');
  t.ok(/config read failed/.test(settingsFault.detail), 'the report carries the real cause');

  // The steps that come AFTER the failure are the ones that used to be lost.
  for (const later of ['init:workspace-handlers', 'init:chat-handlers', 'init:image-attach']) {
    t.notOk(faults.some(f => f.kind === later), `${later} still ran after the earlier failure`);
  }
  t.ok(expose.el.chatInput, 'the chat input is still bound after a failed settings step');
  t.end();
});

test('a missing preload bridge is reported in plain language, once', async (t) => {
  const { win } = await bootRenderer(t, { noApi: true });

  const faults = win.__orionFaults || [];
  const bridgeFault = faults.find(f => f.kind === 'preload-bridge-missing');
  t.ok(bridgeFault, 'the missing bridge is named directly');
  t.ok(/window\.api is unavailable/.test(bridgeFault.detail), 'it says exactly what is missing');
  t.ok(/preload\.js/.test(bridgeFault.detail), 'it names the likely cause');
  t.ok(/conversations on disk are unaffected/.test(bridgeFault.detail), 'it reassures about data');

  const banner = win.document.getElementById('orion-fault-banner-body');
  t.ok(banner && /cannot reach its main process/i.test(banner.textContent),
    'the user sees it instead of a bare TypeError in a console nobody opened');

  t.equal(faults.filter(f => f.kind === 'preload-bridge-missing').length, 1,
    'the bridge failure is reported once, not once per dependent step');
  t.end();
});

test('a healthy boot reports no init faults at all', async (t) => {
  const { win } = await bootRenderer(t);
  // Copied into this realm: __orionFaults is a jsdom-realm array, and tape's deepEqual
  // compares constructors, so a cross-realm array never matches a plain [].
  const initFaults = Array.from(win.__orionFaults || [])
    .filter(f => String(f.kind).startsWith('init:'))
    .map(f => String(f.kind));
  t.equal(initFaults.length, 0, `a normal startup is silent (saw: ${initFaults.join(', ') || 'none'})`);
  t.end();
});

// ── Live-progress indicator lifecycle ──────────────────────────────────────────
// Reported from a real session: the header chip read "Ready" while the finished answer below
// it still showed "Preparing implementation plan (Step 1)... — Finalizing" with animated dots.
//
// The pill is baked into an assistant bubble's innerHTML by renderAiMessage. runAgentLoop does
// its FINAL render while isAgentRunning() is still true and only clears the flag afterwards in
// its finally block, so nothing ever re-rendered the bubble and the pill was frozen there until
// the next reload — the UI claiming two contradictory states at once.

function seedRunningIndicator(win, count = 1) {
  const feed = win.document.getElementById('chat-feed');
  for (let i = 0; i < count; i++) {
    const bubble = win.document.createElement('div');
    bubble.innerHTML = '<div class="agent-running-indicator">' +
      '<span class="status-text">Preparing implementation plan (Step 1)... — Finalizing</span></div>';
    feed.appendChild(bubble);
  }
  return () => win.document.querySelectorAll('.agent-running-indicator').length;
}

test('the progress pill is removed once the run is over', (t) => {
  const { win } = loadRenderer({ t });
  const remaining = seedRunningIndicator(win);
  t.equal(remaining(), 1, 'the indicator starts out rendered');

  win.isAgentRunning = () => false; // the state runAgentLoop's finally leaves behind
  win.clearAgentRunningIndicators();

  t.equal(remaining(), 0,
    'a finished answer no longer sits under a live progress pill while the header reads Ready');
  t.end();
});

test('the pill survives while the agent is still working', (t) => {
  const { win } = loadRenderer({ t });
  const remaining = seedRunningIndicator(win);

  win.isAgentRunning = () => true;
  win.clearAgentRunningIndicators();

  t.equal(remaining(), 1, 'an in-flight run keeps its progress indicator');
  t.end();
});

test('every stale pill is cleared, not just the newest', (t) => {
  // A multi-turn conversation can leave one per assistant bubble if earlier runs also ended
  // without a re-render.
  const { win } = loadRenderer({ t });
  const remaining = seedRunningIndicator(win, 4);
  t.equal(remaining(), 4, 'several stale indicators are present');

  win.isAgentRunning = () => false;
  win.clearAgentRunningIndicators();
  t.equal(remaining(), 0, 'all of them are cleared');
  t.end();
});

test('clearing is safe to call in any state', (t) => {
  const { win } = loadRenderer({ t });
  t.doesNotThrow(() => win.clearAgentRunningIndicators(), 'no indicators present is fine');

  seedRunningIndicator(win);
  win.isAgentRunning = undefined; // agent.js not loaded yet
  t.doesNotThrow(() => win.clearAgentRunningIndicators(), 'a missing isAgentRunning does not throw');
  t.equal(win.document.querySelectorAll('.agent-running-indicator').length, 0,
    'with no agent loaded there is no run in flight, so the pill is cleared');
  t.end();
});

test('runAgentLoop clears the pill only after its run flags are down', (t) => {
  // Ordering is the whole bug: calling this before the flags clear would be a no-op, because
  // clearAgentRunningIndicators deliberately refuses to touch a running agent's indicator.
  const fs = require('fs');
  const path = require('path');
  // Normalized: agent.js has mixed CRLF/LF, so a raw \n match here is a false failure.
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8').replace(/\r\n/g, '\n');

  const flagCleared = agentJs.indexOf('isAgentRunning = false;\n      runningConversationId = null;');
  const indicatorCleared = agentJs.indexOf('window.clearAgentRunningIndicators();');
  t.ok(flagCleared !== -1, 'the run flag is cleared in the finally block');
  t.ok(indicatorCleared !== -1, 'the indicator cleanup is wired into the loop');
  t.ok(indicatorCleared > flagCleared, 'cleanup runs after the flags are down, otherwise it no-ops');
  t.end();
});

test('renderer.js loads in a browser scope with no Node globals', (t) => {
  // The packaged app gives renderer.js a plain browser global scope. A stray require()
  // or process reference works under Node tests and throws in the real app; loading the
  // real source here without those globals is what makes that a caught failure.
  const { win } = loadRenderer({ t });
  t.equal(typeof win.require, 'undefined', 'renderer.js does not rely on require at load');
  t.equal(typeof win.module, 'undefined', 'renderer.js does not rely on module at load');
  t.equal(typeof win.runAgentLoop, 'undefined', 'the agent engine is agent.js\'s job, not renderer.js\'s');
  t.ok(typeof win.renderAiMessage === 'function' || typeof win.el === 'object',
    'the renderer finished loading and published its surface');
  t.end();
});

// ── Test-run outcome reporting ─────────────────────────────────────────────────
// Observed live: run_tests returned {success:false, output:"........"} — passing pytest dots
// reported as a failure with no explanation. `result.code === 0` collapsed four distinct
// outcomes into "tests failed", so the agent could not tell "my change broke tests" from "the
// command never ran", and fell back to re-running tests through run_command instead.

function runTestsWith(t, commandResult, streamed = '') {
  const { win } = loadRenderer({
    t,
    set: { currentWorkspace: 'C:/fake/workspace' },
    api: {
      onCommandOutput: (processId, cb) => { if (streamed) cb({ text: streamed }); return () => {}; },
      runCommand: async () => commandResult,
      getWorkspaceTestCommand: async () => ({ success: true, testCommand: 'pytest -q' })
    }
  });
  return win.runRegressionTests();
}

test('a clean test run is reported as passing', async (t) => {
  const info = await runTestsWith(t, { code: 0 }, '........\n8 passed\n');
  t.equal(info.success, true, 'exit 0 passes');
  t.equal(info.outcome, 'passed', 'the outcome is explicit');
  t.equal(info.ranToCompletion, true, 'the runner completed');
  t.ok(/8 passed/.test(info.output), 'the real output is preserved');
  t.end();
});

test('a genuine test failure is reported as a failure, and says so', async (t) => {
  const info = await runTestsWith(t, { code: 1 }, 'F..\n1 failed\n');
  t.equal(info.success, false, 'a non-zero exit fails');
  t.equal(info.outcome, 'failed', 'classified as a real failure');
  t.equal(info.ranToCompletion, true, 'the runner did complete — the tests did not pass');
  t.ok(/real test failure/i.test(info.output), 'the model is told this is a genuine failure');
  t.end();
});

test('a timeout is not reported as a broken test suite', async (t) => {
  const info = await runTestsWith(t, { code: null, timedOut: true }, '........');
  t.equal(info.success, false, 'a timeout is not a pass');
  t.equal(info.outcome, 'timed_out', 'but it is classified distinctly');
  t.equal(info.ranToCompletion, false, 'the runner did not complete');
  t.ok(/NOT a test failure/i.test(info.output),
    'the model is told explicitly this is not evidence the code is broken');
  t.ok(/waiting on input|slow/i.test(info.output), 'and given the likely causes');
  t.end();
});

test('a killed run and a runner that never started are distinguishable', async (t) => {
  const killed = await runTestsWith(t, { code: null, killed: true });
  t.equal(killed.outcome, 'killed', 'a stopped process is its own outcome');
  t.ok(/NOT a test failure/i.test(killed.output), 'and is not blamed on the code');

  const neverRan = await runTestsWith(t, { error: "'pytest' is not recognized" });
  t.equal(neverRan.outcome, 'did_not_run', 'a spawn failure is its own outcome');
  t.equal(neverRan.ranToCompletion, false, 'nothing ran');
  t.ok(/not recognized/.test(neverRan.output), 'the underlying error is surfaced');
  t.ok(/right command for this workspace/i.test(neverRan.output),
    'and the model is pointed at the actual problem — the configured command');
  t.end();
});

test('a missing exit code is never silently treated as a pass or a plain failure', async (t) => {
  const info = await runTestsWith(t, {});
  t.equal(info.success, false, 'an absent exit code is not a pass');
  t.equal(info.outcome, 'did_not_run', 'it is classified as never having run');
  t.equal(info.exitCode, null, 'the missing code is normalized to null, not undefined');
  t.end();
});

test('no workspace selected is reported without pretending tests failed', async (t) => {
  const { win } = loadRenderer({ t });
  const info = await win.runRegressionTests();
  t.equal(info.success, false, 'it does not claim success');
  t.ok(/workspace/i.test(info.output), 'it names the actual problem');
  t.end();
});

// ── Settings persistence with missing controls ─────────────────────────────────
// The settings modal no longer renders an auto-test checkbox, but agent.js still acts on
// config.autoTest in five places. The save handler fell back to `true` whenever the control was
// absent, so every settings save silently re-enabled a behavior the user had no way to disable.

test('saving settings does not overwrite config for controls the UI no longer renders', async (t) => {
  const { expose, read } = await bootRenderer(t, {
    expose: ['el'],
    api: {
      readConfig: async () => ({ autoTest: false, geminiApiKey: 'k', planningMode: true }),
      writeConfig: async () => ({ success: true })
    }
  });

  t.equal(expose.el.settingAutoTest, null, 'the auto-test checkbox really is absent from the markup');
  t.equal(read('appConfig').autoTest, false, 'the stored value loaded as false');

  expose.el.btnSettingsSave.click();
  await new Promise(resolve => setTimeout(resolve, 60));

  t.equal(read('appConfig').autoTest, false,
    'saving settings preserves autoTest instead of silently forcing it back on');
  t.end();
});

// ── Phone push diagnosis on the desktop ────────────────────────────────────────
// Push failure had no visible symptom here: a phone that never subscribed and one that received
// everything looked identical. The reason string already existed inside notifyAllPhoneDevices —
// it was just discarded, so "notifications don't work" could only be diagnosed by reading source.

test('the pairing panel reports why a push did not arrive', (t) => {
  const { win } = loadRenderer({ t });
  const meta = win.document.getElementById('phone-companion-meta');
  t.ok(meta, 'the pairing panel has a meta line to report into');

  win.updatePhoneCompanionPairingPanel({
    pairUrl: 'https://desktop.tailnet.ts.net/pair',
    preferredUrlType: 'https',
    networkEnabled: true
  });
  const healthy = meta.textContent;
  t.notOk(/Last push/.test(healthy), 'nothing is claimed before any push has been attempted');

  // The signature of an insecure origin: the companion page refuses to subscribe outside a
  // secure context, so no device is ever registered and every push silently no-ops.
  win.updatePhonePushDiagnostic({
    delivered: false, kind: 'question', sent: 0, failed: 0, reason: 'no subscribed phone devices'
  });
  const failed = meta.textContent;
  t.ok(/Last push FAILED/.test(failed), 'the failure is stated plainly');
  t.ok(/no subscribed phone devices/.test(failed), 'the precise reason is shown');
  t.ok(/HTTPS URL and allow notifications/i.test(failed),
    'and the actionable fix, since this reason always means the phone never subscribed');

  win.updatePhonePushDiagnostic({ delivered: true, kind: 'completed', sent: 2, failed: 0, reason: '' });
  const ok = meta.textContent;
  t.ok(/delivered to 2 devices/.test(ok), 'a successful push is confirmed with the device count');
  t.notOk(/FAILED/.test(ok), 'the stale failure is replaced, not appended');
  t.end();
});

test('push diagnosis survives being called before the panel exists', (t) => {
  const { win } = loadRenderer({ t });
  t.doesNotThrow(() => win.updatePhonePushDiagnostic({ delivered: false, reason: 'x' }),
    'reporting before the panel has rendered does not throw');
  t.doesNotThrow(() => win.updatePhonePushDiagnostic(null), 'a null outcome does not throw');
  t.end();
});

test('semantic preflight resolves the latest named project before classifying the turn', async t => {
  const searchRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const selfEvolvingPath = `${searchRoot}\\Self Evolving AI`;
  const thisIsLifePath = `${searchRoot}\\This is Life`;
  const conv = {
    id: 'dispatch-this-is-life',
    title: 'Good morning good morning',
    mode: 'orion',
    workspace: selfEvolvingPath,
    dispatchProjectPath: selfEvolvingPath,
    messages: [
      { role: 'assistant', text: 'The current workspace is Self Evolving AI.', createdAt: 1 },
      { role: 'user', text: 'This is Life is the game I want you to inspect.', createdAt: 2 },
      { role: 'assistant', text: 'Do you want me to take a look?', createdAt: 3 }
    ]
  };
  const loaded = loadRenderer({
    t,
    globals: {
      OrionWorkspaceResolution: workspaceResolution,
      OrionSemanticIntentRouter: semanticIntentRouter
    },
    set: {
      projects: [selfEvolvingPath, thisIsLifePath],
      conversations: [conv],
      appConfig: { dispatchWorkspaceRoot: searchRoot }
    }
  });
  let classifierInput = null;
  loaded.win.getOwnedOrchestrationTasks = async () => [];
  loaded.win.classifySemanticIntent = async input => {
    classifierInput = input;
    return {
      intent: 'new_task',
      requiresExecution: true,
      target: 'current_conversation',
      resolvedRequest: 'Inspect the This is Life project and report what is implemented.',
      contextDependent: true,
      confidence: 0.98,
      needsClarification: false,
      clarificationQuestion: '',
      reasoningPolicyHint: { complexity: 'medium', risk: 'low', contextNeed: 'project' },
      executionScope: 'read_only',
      inspectionTarget: 'project',
      standaloneSystemOperation: false
    };
  };

  const result = await loaded.win.classifyCurrentConversationIntent(
    loaded.read('conversations')[0],
    'Look through This is Life and see for yourself.'
  );
  const reboundConversation = loaded.read('conversations')[0];

  t.equal(result.intent, 'new_task', 'the actual semantic preflight completes normally');
  t.equal(classifierInput.workspace.role, workspaceResolution.KINDS.ACTIVE_PROJECT,
    'the classifier sees an active project rather than the stale workspace');
  t.equal(classifierInput.workspace.path, thisIsLifePath,
    'the classifier receives the exact project named in the visible conversation');
  t.equal(reboundConversation.dispatchProjectPath, thisIsLifePath,
    'the real Dispatch conversation is rebound before execution routing');
  t.equal(reboundConversation.workspace, thisIsLifePath,
    'the selected workspace and semantic target stay synchronized');
  t.end();
});

// ── Coder completion summaries never relay completion-gate narration ───────────
// The final model reply in a gated run often answers the GATE ("all coverage surfaces are
// inspected and verified, no blockers remain") instead of the user. That text must never win
// over the real summary when Dispatch relays the finished task.

test('summarizeCoderCompletion skips gate narration and relays the real answer', (t) => {
  const contracts = require('../orchestration-contracts');
  const { win } = loadRenderer({ t, globals: { OrionOrchestrationContracts: contracts } });

  const realSummary = 'Upgraded Codex playwright to 1.61.1 and removed chromium-1208/1223, freeing ~1.29 GB.';
  const gateNarration = 'Completion gate is now clear — all five coverage surfaces are inspected and verified, the win condition is satisfied, and no blockers remain. Task complete.';

  // Durable summary recorded as gate narration (a task finalized by an older build): the
  // fallback scan must reach past the trailing narration message to the substantive one.
  const fromFallback = win.summarizeCoderCompletion(
    { result: { summary: gateNarration, changedFiles: [], verification: [] } },
    {
      messages: [
        { role: 'assistant', text: realSummary },
        { role: 'assistant', text: gateNarration }
      ]
    }
  );
  t.equal(fromFallback.summary, realSummary,
    'a gate-narration durable summary is discarded in favor of the last real answer');

  // A healthy durable summary passes through untouched.
  const healthy = win.summarizeCoderCompletion(
    { result: { summary: realSummary, changedFiles: ['a.js'], verification: ['npm test'] } },
    { messages: [] }
  );
  t.equal(healthy.summary, realSummary, 'a substantive durable summary is relayed as-is');

  // All-narration conversation: better an empty summary than machinery speak.
  const nothingReal = win.summarizeCoderCompletion(
    { result: { summary: gateNarration } },
    { messages: [{ role: 'assistant', text: gateNarration }] }
  );
  t.equal(nothingReal.summary, '', 'narration is never relayed even when it is all there is');

  const authoredWalkthrough = [
    '## Work Walkthrough',
    '',
    'Opened Codex and inspected the active window.',
    '',
    '**Result:** Codex is open, idle, and showing the completed Orion report.',
    '',
    '## Work Walkthrough',
    '- **Done:** Captured the desktop',
    '- **Done:** Attached `codex.png`'
  ].join('\n');
  const legacyWalkthrough = win.summarizeCoderCompletion(
    { result: { summary: authoredWalkthrough } },
    { messages: [] }
  );
  t.match(legacyWalkthrough.summary, /^## Work Walkthrough/, 'an authored report heading is preserved');
  t.match(legacyWalkthrough.summary, /Codex is open, idle/, 'the actual result reaches Dispatch');
  t.notOk(/Captured the desktop/.test(legacyWalkthrough.summary), 'only the generated tool ledger tail is removed');
  t.end();
});

test('a successful handoff retry removes only the stale clarification from the current turn', t => {
  const conv = {
    id: 'dispatch-retry',
    messages: [
      { role: 'assistant', source: 'task-resolution-clarification', text: 'An older clarification stays.' },
      { role: 'user', text: 'Yes, do that.' },
      { role: 'assistant', source: 'task-resolution-clarification', text: 'Which project workspace should I use?' },
      { role: 'assistant', source: 'agent-run', text: 'Coder has the task queued.' }
    ]
  };
  const loaded = loadRenderer({
    t,
    set: { conversations: [conv] },
    expose: ['clearCurrentTurnTaskResolutionClarifications']
  });
  const removed = loaded.expose.clearCurrentTurnTaskResolutionClarifications(loaded.read('conversations')[0]);
  const messages = loaded.read('conversations')[0].messages;
  t.equal(removed, 1, 'the failed attempt clarification is removed before the successful retry is persisted');
  t.ok(messages.some(message => message.text === 'An older clarification stays.'), 'prior-turn history is untouched');
  t.ok(messages.some(message => message.source === 'agent-run'), 'the live success bubble is untouched');
  t.notOk(messages.some(message => /Which project workspace/.test(message.text)), 'the contradictory current-turn prompt is gone');
  t.end();
});

test('phone image relay honors the attached Coder artifact provenance', async t => {
  const imagePath = 'C:\\Users\\Owner\\AppData\\Roaming\\orion-ai\\artifacts\\coder-1\\codex.png';
  const calls = [];
  const loaded = loadRenderer({
    t,
    api: {
      readWorkspaceFileBase64: async (...args) => {
        calls.push(args);
        return { success: true, data: 'aW1hZ2U=', mimeType: 'image/png' };
      }
    },
    set: {
      conversations: [{
        id: 'dispatch-1',
        mode: 'orion',
        workspace: 'C:\\Users\\Owner',
        messages: [{
          role: 'assistant',
          source: 'supervisor-completion',
          images: [{
            path: imagePath,
            workspacePath: 'C:\\Users\\Owner',
            sourceConversationId: 'coder-1',
            mimeType: 'image/png'
          }]
        }]
      }]
    }
  });
  const result = await loaded.win.readChatImageForPhone({
    conversationId: 'dispatch-1',
    path: imagePath
  });
  t.equal(result.success, true, 'the Dispatch attachment resolves');
  t.deepEqual(calls[0], ['C:\\Users\\Owner', imagePath, 'coder-1'],
    'the file API validates the source Coder conversation instead of losing provenance');
  t.end();
});

// ── Per-message model + reasoning pickers ──────────────────────────────────────
// The reasoning selector sits beside the model select under the input box. It is sticky, it
// persists to both localStorage and appConfig (which is what agent.js reads), and a forced
// level is visually distinct so a pinned Ultra is never an invisible cost.

test('the reasoning picker exists beside the model select under the input box', (t) => {
  const { win } = loadRenderer({ t });
  const select = win.document.getElementById('reasoning-select');
  t.ok(select, 'a reasoning selector is present');
  t.equal(select.closest('.chat-input-toolbar') !== null, true,
    'it lives in the chat input toolbar, not a settings screen');
  const values = Array.from(select.options).map(o => o.value);
  t.deepEqual(values, ['auto', 'low', 'medium', 'high', 'max'],
    'auto plus the four effort levels are offered');
  t.equal(select.value, 'auto', 'auto is the default so Orion keeps deciding per step');
  t.ok(Array.from(select.options).find(o => o.value === 'max').textContent.includes('Ultra'),
    'the max level is labelled Ultra for the user');
  t.end();
});

test('picking a reasoning level persists it where the agent reads it', async (t) => {
  const { win, calls } = loadRenderer({ t });

  const result = await win.setReasoningEffortSelection('max');
  t.equal(result.reasoning, 'max', 'the selection is reported back');
  t.equal(win.getAppConfig().reasoningEffort, 'max',
    'appConfig carries the level — this is what runAgentLoop reads');
  t.equal(win.localStorage.getItem('ag2_reasoning_effort'), 'max', 'the choice survives restart');
  t.ok(calls.some(c => c.method === 'writeConfig'), 'the config is written to disk');
  t.equal(win.document.getElementById('reasoning-select').classList.contains('reasoning-forced'), true,
    'a forced level is visually distinct from auto');
  const forcedRevision = result.selectionRevisions.reasoning;
  t.ok(forcedRevision > 0, 'the persisted selection receives a monotonic revision for poll ordering');

  const reset = await win.setReasoningEffortSelection('auto');
  t.ok(reset.selectionRevisions.reasoning > forcedRevision, 'a later selection has a strictly newer revision');
  t.equal(win.document.getElementById('reasoning-select').classList.contains('reasoning-forced'), false,
    'returning to auto drops the forced styling');
  t.end();
});

test('a failed config write cannot claim or display a durable reasoning change', async t => {
  const { win } = loadRenderer({
    t,
    api: { writeConfig: async () => false }
  });
  const result = await win.setReasoningEffortSelection('max');
  t.equal(result.success, false, 'the failed persistence is reported to the caller');
  t.equal(win.getAppConfig().reasoningEffort, 'auto', 'the in-memory selection rolls back');
  t.equal(win.document.getElementById('reasoning-select').value, 'auto', 'the desktop picker rolls back');
  t.equal(win.localStorage.getItem('ag2_reasoning_effort'), null, 'localStorage does not retain a selection that config rejected');
  t.end();
});

test('an unknown stored reasoning level degrades to auto instead of breaking the run', async (t) => {
  const { win } = loadRenderer({ t, globals: { OrionReasoningPolicy: reasoningPolicy } });
  win.localStorage.setItem('ag2_reasoning_effort', 'warp9');
  win.restoreReasoningEffortSelection();
  t.equal(win.document.getElementById('reasoning-select').value, 'auto',
    'a junk stored value falls back to auto');
  t.equal(win.getAppConfig().reasoningEffort, 'auto', 'and never reaches the agent as an override');
  t.end();
});

test('the phone companion is served both selections and can set either', async (t) => {
  const { win } = loadRenderer({ t, globals: { OrionReasoningPolicy: reasoningPolicy } });
  await win.setReasoningEffortSelection('high');

  const payload = win.getPhoneCompanionModels();
  t.equal(payload.reasoning, 'high', 'the phone is told the current reasoning level');
  t.ok(Array.isArray(payload.reasoningLevels) && payload.reasoningLevels.length === 5,
    'the phone receives the level list to render its picker');
  t.ok(payload.models.length > 0, 'the model list is still supplied');
  t.equal(payload.selectionRevisions.reasoning > 0, true, 'model-list sync carries the selection revision');

  const set = await win.setPhoneCompanionReasoning('low');
  t.equal(set.success, true, 'the phone can set the reasoning level');
  t.equal(win.getAppConfig().reasoningEffort, 'low',
    'a phone-side change lands in the same appConfig the desktop uses');
  t.equal(win.document.getElementById('reasoning-select').value, 'low',
    'and the desktop picker reflects it immediately');
  t.equal(set.selectionRevisions.reasoning, win.getPhoneCompanionModels().selectionRevisions.reasoning,
    'the POST acknowledgement and subsequent polls use the same canonical revision');
  t.end();
});
