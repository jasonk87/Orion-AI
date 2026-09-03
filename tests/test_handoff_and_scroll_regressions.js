'use strict';

// Two defects Jason reported from real use.
//
// 1. Handing a task to a specialist showed FAILED until that specialist picked it up. A handoff is
//    not instantaneous: the conversation records the new task id immediately, but the durable
//    record reaches the view a beat later, while the packet is still being written and read back.
//    In that window the presenter found no matching record and fell through to "newest of
//    anything", which resurrected the PREVIOUS run's terminal record. A conversation that had just
//    delegated fresh work sat there reading FAILED.
//
// 2. On the phone, sending a message scrolled the view back UP to the last assistant message,
//    past the user's own message and the thinking bubble. Following was recomputed purely from
//    geometry on every scroll event, so content growing after the send (image hydration, markdown
//    layout) fired a scroll event with a large distance-from-bottom and silently switched
//    following off. The next render then restored the pre-send offset.

process.env.NODE_ENV = 'test';
global.window = {};

const test = require('tape');
const vm = require('vm');
const taskOrchestration = require('../task-orchestration');
const companionHtml = require('../lib/companion-html');

// ── 1. A handoff in flight is not a failure ─────────────────────────────────

const DISPATCH = 'dispatch-1';

function task(id, status, updatedAt, extra = {}) {
  return {
    taskId: id,
    status,
    updatedAt,
    origin: { conversationId: DISPATCH },
    target: { conversationId: `specialist-${id}`, mode: 'coder' },
    ...extra
  };
}

function presented(tasks, awaitedTaskId) {
  const selected = taskOrchestration.selectSupervisedTask(tasks, DISPATCH, awaitedTaskId, { delegatedOnly: true });
  return selected ? `${selected.taskId}/${selected.status}` : 'none';
}

const previousFailure = task('old', 'failed', 1000, { failure: { message: 'an earlier run failed' } });
const previousSuccess = task('done', 'completed', 900);

test('a handoff still being written never presents the previous run as the current state', t => {
  // The exact gap: the conversation already awaits 'new', but only the old record is loaded.
  t.equal(presented([previousFailure], 'new'), 'none',
    'awaiting a specific task shows nothing rather than resurrecting an unrelated failure');
  t.equal(presented([previousSuccess], 'new'), 'none',
    'and it does not resurrect an unrelated completion either - the same fallthrough produced both');
  t.end();
});

test('once the delegated record loads, it is what shows', t => {
  const fresh = task('new', 'pending', 2000);
  t.equal(presented([previousFailure, fresh], 'new'), 'new/pending',
    'the newly delegated task is presented as queued, which is what it is');
  t.end();
});

test('a task that genuinely failed is still reported as failed', t => {
  t.equal(presented([previousFailure], 'old'), 'old/failed',
    'when the awaited task IS the failed one, the failure is the honest current state');
  t.end();
});

test('browsing an idle conversation still shows its terminal history', t => {
  t.equal(presented([previousFailure, previousSuccess], ''), 'old/failed',
    'with nothing awaited there is no handoff in flight, so history is the current state');
  t.end();
});

test('ongoing work always outranks a stale preference', t => {
  const running = task('running', 'active', 3000);
  t.equal(presented([previousFailure, running], 'old'), 'running/active',
    'an active task wins over a terminal one the conversation still points at');
  t.end();
});

test('the guard is scoped to a missing record, not to failures generally', t => {
  const fresh = task('new', 'pending', 2000);
  t.equal(presented([previousFailure, fresh], 'nonexistent'), 'new/pending',
    'awaiting an unknown id still surfaces genuinely ongoing work');
  t.end();
});

// ── 2. The phone transcript keeps following the newest message ──────────────

// Executes the REAL rule from the served page rather than matching source text, so this breaks if
// the shipped behavior changes. Same extraction technique as tests/test_markdown_table_cards.js.
function loadFollowingRule() {
  const html = companionHtml('TEST-DEVICE');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(source => source.includes('function resolveTranscriptFollowing('));
  if (!inline) throw new Error('resolveTranscriptFollowing is not in the served phone page.');
  const start = inline.indexOf('function resolveTranscriptFollowing(');
  const end = inline.indexOf('\n  }', start) + '\n  }'.length;
  const context = { NEAR_BOTTOM_PX: 80 };
  vm.createContext(context);
  new vm.Script(`${inline.slice(start, end)}; this.rule = resolveTranscriptFollowing;`).runInContext(context);
  return context.rule;
}

const following = loadFollowingRule();

test('content growing under the reader does not stop the transcript following', t => {
  // The reported bug: pinned at the bottom, then images and markdown grow the list, so a scroll
  // event arrives with a large distance-from-bottom and no movement of its own.
  t.equal(following(true, 500, 500, 400), true,
    'the reader never moved, so they are still following - this is what used to flip to false');
  t.end();
});

test('scrolling up to read history stops it following', t => {
  t.equal(following(true, 500, 120, 900), false,
    'a deliberate move up away from the bottom means the reader is reading, not following');
  t.end();
});

test('scrolling back down to the bottom resumes following', t => {
  t.equal(following(false, 120, 940, 10), true, 'returning to the bottom re-pins');
  t.end();
});

test('a small upward nudge that stays at the bottom keeps following', t => {
  t.equal(following(true, 500, 495, 20), true,
    'still within the near-bottom band, so this is not reading history');
  t.end();
});

test('sub-pixel jitter is never read as a deliberate scroll up', t => {
  t.equal(following(true, 500, 499.5, 400), true,
    'rounding must not unpin a reader who never touched the screen');
  t.end();
});

test('a reader who scrolled up stays unpinned while an answer streams in', t => {
  t.equal(following(false, 300, 300, 1200), false,
    'growth alone must not drag someone back down who chose to read history');
  t.end();
});

test('the rule is actually wired into the scroll handler', t => {
  const html = companionHtml('TEST-DEVICE');
  t.ok(/userPinnedToBottom = resolveTranscriptFollowing\(/.test(html),
    'the handler assigns following from the rule instead of recomputing geometry inline');
  t.ok(/lastScrollTop = currentScrollTop;/.test(html),
    'and records the offset so the next event can tell direction');
  t.end();
});

test('a superseded predecessor still resolves to its successor, not to nothing', t => {
  // The narrowing that matters: "awaited task is absent" must mean absent from the INPUT, not
  // merely filtered out of this view. A superseded predecessor IS known - it was replaced - and
  // showing its successor is the whole point. Treating that as a handoff-in-flight blanked the
  // card instead, which this guards against.
  const predecessor = { taskId: 'pred', status: 'pending', updatedAt: 1000,
    origin: { conversationId: DISPATCH }, target: { conversationId: 'coder-a', mode: 'coder' },
    supersededByTaskId: 'succ' };
  const successor = { taskId: 'succ', status: 'completed', updatedAt: 2000,
    origin: { conversationId: DISPATCH }, target: { conversationId: 'coder-b', mode: 'coder' } };
  t.equal(presented([predecessor, successor], 'pred'), 'succ/completed',
    'the replacement is shown, because the awaited task was present and deliberately superseded');
  t.end();
});
