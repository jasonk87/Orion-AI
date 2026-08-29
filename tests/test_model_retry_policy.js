// Gemini, Anthropic, and DeepSeek each carried their own copy of the retry backoff and
// their own idea of which errors end a retry loop. They drifted:
//
//   * only Gemini jittered its delay, so Anthropic/DeepSeek retries after a shared 429
//     all landed on the same tick and re-triggered the limit;
//   * only Gemini omitted the user-stop check, so pressing Stop during a Gemini retry
//     did not abort — sleepWithModelApiStatus throws a userStop error, the catch branch
//     saw a plain non-nonRetryable error, and the loop burned its remaining attempts
//     emitting bogus "Connection error" warnings.
//
// Both behaviors now come from one policy. These tests pin the policy itself.

const test = require('tape');
global.window = global.window || {};
global.fetch = global.fetch || (async () => ({ ok: false }));
const agent = require('../agent.js');

const MAX = agent.MODEL_API_MAX_RETRY_WAIT_MS;

test('retry backoff grows exponentially, jitters, and is capped', (t) => {
  const grown = agent.computeNextModelRetryDelay(1500, 0);
  t.ok(grown >= 3000, 'the delay at least doubles');
  t.ok(grown < 3000 + 500, 'growth is doubling plus bounded jitter, not an unbounded leap');

  const samples = new Set();
  for (let i = 0; i < 40; i++) samples.add(agent.computeNextModelRetryDelay(1500, 0));
  t.ok(samples.size > 1, 'jitter is applied, so concurrent retries do not land on the same tick');

  t.equal(agent.computeNextModelRetryDelay(MAX, 0), MAX, 'the delay is capped at the max retry wait');
  t.equal(agent.computeNextModelRetryDelay(MAX * 10, 0), MAX, 'a delay already past the cap is clamped back');
  t.ok(agent.computeNextModelRetryDelay(1500, 0) <= MAX, 'every result respects the cap');
  t.end();
});

test("the provider's own Retry-After hint acts as a floor, never an escape from the cap", (t) => {
  const hinted = agent.computeNextModelRetryDelay(1000, 30000);
  t.equal(hinted, 30000, 'a provider hint longer than our backoff wins, so we do not retry too early');

  const shortHint = agent.computeNextModelRetryDelay(10000, 500);
  t.ok(shortHint >= 20000, 'a provider hint shorter than our backoff does not shrink the wait');

  t.equal(agent.computeNextModelRetryDelay(1000, MAX * 5), MAX, 'even an absurd provider hint stays capped');
  t.end();
});

test('backoff tolerates the degenerate inputs a failing provider actually produces', (t) => {
  const fromZero = agent.computeNextModelRetryDelay(0, 0);
  t.ok(Number.isFinite(fromZero) && fromZero >= 0, 'a zero delay yields jitter only, never NaN');
  t.ok(fromZero < 500, 'a zero delay does not jump straight to a long wait');
  t.ok(Number.isFinite(agent.computeNextModelRetryDelay(undefined, undefined)), 'undefined inputs yield a finite delay');
  t.ok(Number.isFinite(agent.computeNextModelRetryDelay(null, 'not-a-number')), 'garbage inputs yield a finite delay');
  t.ok(agent.computeNextModelRetryDelay(undefined, undefined) >= 0, 'the delay is never negative');
  t.end();
});

test('a user stop ends every provider retry loop', (t) => {
  // This is the exact error object sleepRespectingStop and sleepWithModelApiStatus throw
  // when the user presses Stop mid-retry.
  const hardStop = agent.createUserStopError('hard');
  const softStop = agent.createUserStopError('soft');

  t.ok(agent.isUnretryableModelError(hardStop), 'a hard stop aborts the retry loop');
  t.ok(agent.isUnretryableModelError(softStop), 'a soft stop aborts the retry loop');
  t.end();
});

test('auth, billing, and malformed-request failures abort instead of retrying 15 times', (t) => {
  const nonRetryable = agent.createNonRetryableModelError('HTTP 401: invalid API key');
  t.ok(agent.isUnretryableModelError(nonRetryable), 'a non-retryable API error aborts');
  t.ok(agent.isNonRetryableModelHttpStatus(429, 'You have no credits remaining.'),
    'an exhausted credit balance is permanent and aborts');
  t.notOk(agent.isNonRetryableModelHttpStatus(429, 'Requests per minute exceeded; retry later.'),
    'an ordinary temporary 429 still retries');
  t.end();
});

test('genuinely transient failures still retry', (t) => {
  t.notOk(agent.isUnretryableModelError(new Error('socket hang up')), 'a network error is retried');
  t.notOk(agent.isUnretryableModelError(new Error('HTTP 503: model overloaded')), 'an overload is retried');
  t.notOk(agent.isUnretryableModelError(null), 'a missing error does not abort the loop');
  t.notOk(agent.isUnretryableModelError(undefined), 'an undefined error does not abort the loop');
  t.end();
});

test('every provider retry loop shares one abort policy and one backoff', (t) => {
  // Guards the regression directly: no retry loop may grow a private copy of the policy again.
  //
  // The counts below are DERIVED from how many provider retry loops actually exist rather than
  // pinned to a number. They were pinned at "three providers" and went stale the moment ChatGPT
  // was added as a fourth - failing not because a loop had diverged, but because the file had
  // legitimately grown one more compliant loop. A count that has to be edited every time a
  // provider is added stops testing the invariant and starts testing the provider census.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');

  const privateAbortChecks = source.match(/if \(err? && err?\.nonRetryable\) throw err?;/g) || [];
  t.equal(privateAbortChecks.length, 0, 'no provider re-implements the abort check inline');

  const privateBackoff = source.match(/delay = (Math\.min\(delay \* 2|delay \* 2 \+ Math\.random)/g) || [];
  t.equal(privateBackoff.length, 0, 'no provider re-implements the backoff formula inline');

  // One retry loop per provider, identified by the bounded-attempt header they all share.
  const retryLoops = source.match(/for \(let i = 1; i <= attempts; i\+\+\) \{/g) || [];
  t.ok(retryLoops.length >= 4, `every provider has a bounded retry loop (found ${retryLoops.length})`);

  const sharedAbort = source.match(/isUnretryableModelError\((err|e)\)/g) || [];
  t.equal(sharedAbort.length, retryLoops.length,
    'each retry loop aborts through the shared policy exactly once - no loop opted out');

  const sharedBackoff = source.match(/delay = computeNextModelRetryDelay\(/g) || [];
  t.equal(sharedBackoff.length, retryLoops.length * 2,
    'and each backs off through the shared formula on both its HTTP and its network path');
  t.end();
});
