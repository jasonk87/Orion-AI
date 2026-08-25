'use strict';

// Durable scheduling. The behavior under test is specifically what the old in-renderer
// setTimeout could not do: survive a restart, survive machine sleep, and refuse to stampede
// or double-fire. Every case here is one that used to silently lose or duplicate a run.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');

const policy = require('../lib/schedule-policy');
const { ScheduleStore } = require('../lib/schedule-store');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const BASE = 1700000000000;

function makeStore(clockRef) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-sched-test-'));
  const filePath = path.join(dir, 'orion-schedules.json');
  return {
    filePath,
    dir,
    store: new ScheduleStore({ filePath, now: () => clockRef.now }),
    reopen: () => new ScheduleStore({ filePath, now: () => clockRef.now }),
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  };
}

// ── Fire-time policy ──────────────────────────────────────────────────────────

test('a one-shot that came due while the machine slept still runs, and is marked late', t => {
  const decision = policy.classifyFire(
    { status: 'pending', dueAt: BASE - 3 * HOUR, intervalMs: 0 },
    BASE
  );
  t.equal(decision.action, 'fire', 'a delayed follow-up is not discarded');
  t.equal(decision.late, true, 'it is flagged late rather than presented as punctual');
  t.ok(/3 hours/.test(policy.describeFireDelay(decision)), 'the lateness is describable for the transcript');
  t.end();
});

test('a one-shot that is stale beyond a day expires instead of firing', t => {
  const decision = policy.classifyFire(
    { status: 'pending', dueAt: BASE - 2 * 24 * HOUR, intervalMs: 0 },
    BASE
  );
  t.equal(decision.action, 'expire', 'a week-old "check back shortly" is noise, not a follow-up');
  t.equal(decision.reason, 'stale_one_shot', 'and the reason is recorded rather than silently dropped');
  t.end();
});

test('missed recurring occurrences coalesce into exactly one catch-up run', t => {
  // A 5-minute job across an 8-hour sleep is 96 missed occurrences. Running them all would
  // stampede the model with identical work the moment the lid opened.
  const decision = policy.classifyFire(
    { status: 'pending', dueAt: BASE - 8 * HOUR, intervalMs: 5 * MINUTE },
    BASE
  );
  t.equal(decision.action, 'fire', 'the schedule still runs');
  t.equal(decision.skippedOccurrences, 96, 'every missed occurrence is counted');
  t.ok(decision.nextDueAt > BASE, 'and the schedule advances to a FUTURE occurrence, not a backlog');
  t.ok(decision.nextDueAt - BASE <= 5 * MINUTE, 'the next run is within one interval');
  t.ok(/96 scheduled runs were skipped/.test(policy.describeFireDelay(decision)),
    'the gap is reported honestly rather than hidden');
  t.end();
});

test('an on-time recurring fire reports no skips and no lateness', t => {
  const decision = policy.classifyFire({ status: 'pending', dueAt: BASE, intervalMs: 5 * MINUTE }, BASE);
  t.equal(decision.skippedOccurrences, 0, 'the occurrence being run now is not counted as skipped');
  t.equal(decision.late, false, 'and it is not labelled late');
  t.equal(decision.nextDueAt, BASE + 5 * MINUTE, 'the next occurrence is exactly one interval out');
  t.end();
});

test('coalescing a long outage stays O(1) rather than looping per missed occurrence', t => {
  // A 30-second schedule missed across two weeks is ~40k occurrences; a loop-based advance
  // would burn that many iterations to reach the same answer.
  const started = Date.now();
  const decision = policy.classifyFire(
    { status: 'pending', dueAt: BASE - 14 * 24 * HOUR, intervalMs: 30 * 1000 },
    BASE
  );
  t.ok(decision.skippedOccurrences > 40000, 'the outage really is enormous');
  t.ok(decision.nextDueAt > BASE, 'it still lands on a future occurrence');
  t.ok(Date.now() - started < 50, 'and it resolves immediately');
  t.end();
});

test('non-pending schedules are never fired', t => {
  ['cancelled', 'completed', 'firing', 'expired'].forEach(status => {
    const decision = policy.classifyFire({ status, dueAt: BASE - HOUR, intervalMs: 0 }, BASE);
    t.equal(decision.action, 'skip', `a ${status} schedule is skipped even when overdue`);
  });
  t.end();
});

// ── Durable store ─────────────────────────────────────────────────────────────

test('a pending schedule survives a full restart of the store', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    await h.store.create({ conversationId: 'c1', purpose: 'training-progress', prompt: 'check training', delayMs: 20 * MINUTE });

    // A brand-new instance reading the same file is what an app restart looks like.
    const reopened = h.reopen();
    clock.now = BASE + 8 * HOUR; // ...and the laptop was closed the whole time
    const claimed = await reopened.claimDue(clock.now);

    t.equal(claimed.length, 1, 'the schedule outlived the process that created it');
    t.equal(claimed[0].schedule.prompt, 'check training', 'with its instruction intact');
    t.equal(claimed[0].decision.late, true, 'and it knows it is running late');
  } finally { h.cleanup(); }
  t.end();
});

test('a schedule preserves its user-facing delivery conversation across restarts', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    await h.store.create({
      conversationId: 'operator-worker',
      deliveryConversationId: 'dispatch-origin',
      sourceTaskId: 'task-reminder',
      purpose: 'weather-update',
      prompt: 'Give the user a weather update.',
      delayMs: MINUTE
    });
    const [restored] = await h.reopen().list({ status: 'pending' });
    t.equal(restored.conversationId, 'operator-worker', 'execution remains bound to the worker conversation');
    t.equal(restored.deliveryConversationId, 'dispatch-origin', 'delivery remains bound to the visible conversation');
    t.equal(restored.sourceTaskId, 'task-reminder', 'the originating task provenance is durable');
  } finally { h.cleanup(); }
  t.end();
});

test('re-scheduling the same purpose replaces rather than stacking wake-ups', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    await h.store.create({ conversationId: 'c1', purpose: 'test-progress', prompt: 'first', delayMs: 10 * MINUTE });
    const second = await h.store.create({ conversationId: 'c1', purpose: 'test-progress', prompt: 'second', delayMs: 5 * MINUTE });
    t.equal(second.supersededScheduleIds.length, 1, 'the earlier schedule is superseded');

    const pending = await h.store.list({ status: 'pending' });
    t.equal(pending.length, 1, 'only one wake-up remains for that purpose');
    t.equal(pending[0].prompt, 'second', 'and it is the newer one');

    // A different purpose in the same conversation is independent.
    await h.store.create({ conversationId: 'c1', purpose: 'server-progress', prompt: 'other', delayMs: 5 * MINUTE });
    t.equal((await h.store.list({ status: 'pending' })).length, 2, 'a different purpose coexists');
  } finally { h.cleanup(); }
  t.end();
});

test('claiming is atomic, so a second tick cannot fire the same schedule twice', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    await h.store.create({ conversationId: 'c1', purpose: 'p', prompt: 'once', delayMs: MINUTE });
    clock.now = BASE + 2 * MINUTE;

    const [first, second] = await Promise.all([
      h.store.claimDue(clock.now),
      h.store.claimDue(clock.now)
    ]);
    t.equal(first.length + second.length, 1, 'exactly one of two concurrent ticks claims it');
  } finally { h.cleanup(); }
  t.end();
});

test('a deferred fire returns the schedule to pending instead of consuming it', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    const created = await h.store.create({ conversationId: 'c1', purpose: 'p', prompt: 'run', delayMs: MINUTE });
    clock.now = BASE + 2 * MINUTE;
    const claimed = await h.store.claimDue(clock.now);
    t.equal(claimed.length, 1, 'it is claimed once');

    // The renderer was busy running this same conversation.
    await h.store.settle(created.schedule.scheduleId, { error: 'agent_busy', retry: true });
    const after = (await h.store.list())[0];
    t.equal(after.status, 'pending', 'the schedule is still pending, not silently consumed');
    t.equal(after.fireCount, 0, 'and a fire that never happened is not counted');

    t.equal((await h.store.claimDue(clock.now)).length, 1, 'the next tick retries it');
  } finally { h.cleanup(); }
  t.end();
});

test('a recurring schedule returns to pending on its next occurrence after running', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    const created = await h.store.create({
      conversationId: 'c1', purpose: 'watch', prompt: 'poll', delayMs: MINUTE, intervalMs: 5 * MINUTE
    });
    clock.now = BASE + 2 * MINUTE;
    const claimed = await h.store.claimDue(clock.now);
    await h.store.settle(created.schedule.scheduleId, {});

    const after = (await h.store.list())[0];
    t.equal(after.status, 'pending', 'a recurring schedule is never terminal after one run');
    t.ok(after.dueAt > clock.now, 'its next occurrence is in the future');
    t.equal(after.fireCount, 1, 'the completed run is counted');
    t.equal(claimed[0].decision.recurring, true, 'and the fire was classified as recurring');
  } finally { h.cleanup(); }
  t.end();
});

test('a crash mid-fire is recovered on the next start rather than stranding the schedule', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    await h.store.create({ conversationId: 'c1', purpose: 'p', prompt: 'run', delayMs: MINUTE });
    clock.now = BASE + 2 * MINUTE;
    await h.store.claimDue(clock.now); // claimed, then the process dies before settling
    t.equal((await h.store.list())[0].status, 'firing', 'it is left mid-fire');

    const reopened = h.reopen();
    const released = await reopened.releaseInterruptedFiring();
    t.equal(released.released.length, 1, 'startup recovery releases it');
    t.equal((await reopened.list())[0].status, 'pending', 'back to pending');
    t.equal((await reopened.claimDue(clock.now)).length, 1, 'so it actually runs instead of hanging forever');
  } finally { h.cleanup(); }
  t.end();
});

test('cancelling a conversation clears only its own live schedules', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    await h.store.create({ conversationId: 'c1', purpose: 'a', prompt: 'x', delayMs: MINUTE });
    await h.store.create({ conversationId: 'c1', purpose: 'b', prompt: 'y', delayMs: MINUTE });
    await h.store.create({ conversationId: 'c2', purpose: 'a', prompt: 'z', delayMs: MINUTE });

    const result = await h.store.cancelForConversation('c1');
    t.equal(result.cancelled, 2, 'both of that conversation\'s schedules are cancelled');
    t.equal((await h.store.list({ status: 'pending' })).length, 1, 'the other conversation is untouched');
    t.equal((await h.store.list({ status: 'pending' }))[0].conversationId, 'c2', 'and it is the right one');
  } finally { h.cleanup(); }
  t.end();
});

test('a corrupt schedule file does not prevent startup', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    fs.writeFileSync(h.filePath, '{ this is not json', 'utf8');
    const reopened = h.reopen();
    t.deepEqual(await reopened.list(), [], 'the store opens empty rather than throwing');
    const created = await reopened.create({ conversationId: 'c1', purpose: 'p', prompt: 'x', delayMs: MINUTE });
    t.ok(created.schedule.scheduleId, 'and remains usable afterwards');
    const preserved = fs.readdirSync(h.dir).some(name => name.includes('.corrupt-'));
    t.ok(preserved, 'the damaged file is preserved for inspection instead of being overwritten');
  } finally { h.cleanup(); }
  t.end();
});

test('terminal schedules are pruned so the file cannot grow without bound', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    const old = await h.store.create({ conversationId: 'c1', purpose: 'old', prompt: 'x', delayMs: MINUTE });
    clock.now = BASE + 2 * MINUTE;
    await h.store.claimDue(clock.now);
    await h.store.settle(old.schedule.scheduleId, {});

    clock.now = BASE + 30 * 24 * HOUR;
    await h.store.create({ conversationId: 'c1', purpose: 'new', prompt: 'y', delayMs: MINUTE });
    const pruned = await h.store.pruneTerminal();
    t.equal(pruned.pruned, 1, 'the month-old completed schedule is dropped');
    t.equal((await h.store.list()).length, 1, 'the live one is kept');
  } finally { h.cleanup(); }
  t.end();
});

// ── Wiring ────────────────────────────────────────────────────────────────────
// The clock must live in the MAIN process. If a future edit moves it back into the renderer,
// schedules silently die on reload again — which is the entire bug this replaced.

test('the schedule clock is owned by the main process, not the renderer', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const scheduleIpc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ipc-schedule.js'), 'utf8');

  t.ok(mainJs.includes('ipcSchedule.registerHandlers(ipcMain'), 'main registers the schedule runtime');
  t.ok(mainJs.includes('scheduleRuntime.start()'), 'and starts the clock at boot');
  t.ok(scheduleIpc.includes('setInterval'), 'the clock is a repeating tick');
  t.notOk(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]{0,200}claimDue/.test(scheduleIpc),
    'it is not a long single timer, which would not survive machine suspend');

  t.notOk(agentJs.includes('window.followupTimers['),
    'the renderer no longer holds follow-up timers in memory');
  t.ok(agentJs.includes('window.api.createSchedule('),
    'scheduling goes through the durable store');
  t.end();
});

test('a scheduled run can never overlap the conversation it belongs to', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const start = agentJs.indexOf('window.runDurableSchedule = async function');
  const body = agentJs.slice(start, agentJs.indexOf('\n};', start));
  t.ok(start > 0, 'the renderer exposes a schedule entry point for the main-process tick');

  const busyGuard = body.indexOf('window.isAgentRunning()');
  const runLoop = body.indexOf('window.runAgentLoop(');
  t.ok(busyGuard > 0 && busyGuard < runLoop, 'it checks for a live run BEFORE starting another');
  t.ok(/deferred:\s*true,\s*reason:\s*'agent_busy'/.test(body),
    'and defers rather than dropping, so the run is retried not lost');

  const scheduleIpc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ipc-schedule.js'), 'utf8');
  t.ok(scheduleIpc.includes('retry: true'),
    'the tick returns a deferred schedule to pending instead of consuming it');
  t.ok(/if \(!shared\.mainWindow \|\| shared\.mainWindow\.isDestroyed\(\)\)/.test(scheduleIpc),
    'a closed window defers the fire rather than eating it');
  t.end();
});

test('a late run tells the conversation it is late', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const start = agentJs.indexOf('window.runDurableSchedule = async function');
  const body = agentJs.slice(start, agentJs.indexOf('\n};', start));
  t.ok(body.includes('payload.delayNote'),
    'the lateness note reaches the transcript so the model does not assume no time passed');
  t.end();
});

test('the integrated schedule path carries delivery provenance into execution', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const scheduleStart = agentJs.indexOf('async function scheduleAgentFollowup');
  const scheduleBody = agentJs.slice(scheduleStart, agentJs.indexOf('// A conditional watch', scheduleStart));
  const runStart = agentJs.indexOf('window.runDurableSchedule = async function');
  const runBody = agentJs.slice(runStart, agentJs.indexOf('\n};', runStart));
  const scheduleIpc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ipc-schedule.js'), 'utf8');
  t.ok(scheduleBody.includes('resolveScheduledDeliveryConversation'), 'schedule creation resolves the originating visible conversation from task provenance');
  t.ok(scheduleBody.includes('deliveryConversationId: delivery.conversationId'), 'the visible destination is persisted with the schedule');
  t.ok(scheduleIpc.includes('deliveryConversationId: schedule.deliveryConversationId'), 'main-process dispatch preserves the destination');
  t.ok(runBody.includes('scheduleDeliveryConversationId'), 'the fired run receives the destination before model execution');
  t.end();
});

test('startup sweeps overdue schedules promptly instead of waiting out the first interval', t => {
  const scheduleIpc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ipc-schedule.js'), 'utf8');
  const start = scheduleIpc.indexOf('async function start()');
  const body = scheduleIpc.slice(start, scheduleIpc.indexOf('function stop()', start));
  t.ok(start > 0, 'the runtime has a start hook');
  t.ok(body.includes('releaseInterruptedFiring()'), 'startup recovers schedules stranded mid-fire');
  t.ok(body.includes('setInterval'), 'the repeating tick is installed');
  t.ok(body.includes('setTimeout') && /priming/.test(body),
    'and a priming sweep runs without waiting a full interval, which is when overdue work is most likely');
  const recoveryIndex = body.indexOf('releaseInterruptedFiring()');
  const primingIndex = body.indexOf('priming');
  t.ok(recoveryIndex < primingIndex, 'stranded schedules are released before the first sweep claims anything');
  t.end();
});
