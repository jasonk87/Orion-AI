'use strict';

// Conditional watches. A watch is only worth leaving running if it is CHEAP when nothing is
// happening and QUIET when the condition merely persists. Every test here defends one of those
// two properties — losing either turns a useful watcher into an expensive nuisance you disable.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');

const condition = require('../lib/schedule-condition');
const { runProbe } = require('../lib/schedule-probe');
const { ScheduleStore } = require('../lib/schedule-store');
const safety = require('../safety');

const MINUTE = 60 * 1000;
const BASE = 1700000000000;

const obs = (truthy, signature) => ({ ok: true, truthy, signature, summary: signature });

function makeStore(clockRef) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-watch-test-'));
  const filePath = path.join(dir, 'orion-schedules.json');
  return {
    store: new ScheduleStore({ filePath, now: () => clockRef.now }),
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  };
}

// ── Transition semantics ──────────────────────────────────────────────────────

test('a new watch records a baseline instead of firing immediately', t => {
  const cond = { type: 'command', command: 'npm test', fireWhen: 'true' };
  const verdict = condition.evaluateTransition(cond, obs(true, 'failing'), null);
  t.equal(verdict.fire, false, 'the very first observation never wakes the model');
  t.equal(verdict.reason, 'baseline_recorded', 'it is recorded as a baseline instead');
  t.end();
});

test('a rising-edge watch fires once and stays quiet while the condition persists', t => {
  const cond = { type: 'command', command: 'npm test', fireWhen: 'true' };

  const became = condition.evaluateTransition(cond, obs(true, 'fail-1'), obs(false, 'pass'));
  t.equal(became.fire, true, 'it fires when the condition becomes true');

  // Raw output differs between runs (timestamps, durations) while the condition is unchanged.
  const persists = condition.evaluateTransition(cond, obs(true, 'fail-2'), obs(true, 'fail-1'));
  t.equal(persists.fire, false, 'a still-true condition does not wake the model again');
  t.equal(persists.reason, 'still_matching', 'even though the raw probe output changed');

  const recovered = condition.evaluateTransition(cond, obs(false, 'pass'), obs(true, 'fail-2'));
  t.equal(recovered.fire, false, 'recovery is silent for a rising-edge watch');
  t.equal(recovered.reason, 'transitioned_away', 'but it re-arms so the next break fires again');
  t.end();
});

test('fireWhen false is the "tell me when the build breaks" case', t => {
  const cond = { type: 'command', command: 'npm test', fireWhen: 'false' };
  const broke = condition.evaluateTransition(cond, obs(false, 'exit 1'), obs(true, 'exit 0'));
  t.equal(broke.fire, true, 'passing -> failing wakes the model');
  t.equal(broke.reason, 'became_false', 'recorded as the falling edge');
  t.equal(condition.evaluateTransition(cond, obs(true, 'exit 0'), obs(false, 'exit 1')).fire, false,
    'and a fix does not wake it');
  t.end();
});

test('changed mode wakes on any difference but not on sameness', t => {
  const cond = { type: 'file', path: 'a.log', fireWhen: 'changed' };
  t.equal(condition.evaluateTransition(cond, obs(true, 'h1'), obs(true, 'h1')).fire, false,
    'an identical observation is silent');
  t.equal(condition.evaluateTransition(cond, obs(true, 'h2'), obs(true, 'h1')).fire, true,
    'a different observation wakes the model');
  t.end();
});

test('a broken probe is never mistaken for a satisfied condition', t => {
  const cond = { type: 'http', url: 'https://example.com', fireWhen: 'changed' };
  const error = { ok: false, error: 'ECONNREFUSED' };

  const once = condition.evaluateTransition(cond, error, obs(true, 'h1'), { consecutiveErrors: 0 });
  t.equal(once.fire, false, 'a single transient failure stays quiet');
  t.equal(once.preserveSignature, true,
    'and must not overwrite the baseline, or recovery would fire as a false change');

  const persistent = condition.evaluateTransition(cond, error, obs(true, 'h1'), { consecutiveErrors: 2 });
  t.equal(persistent.fire, true, 'a persistently broken watch reports itself');
  t.equal(persistent.reason, 'probe_failing',
    'as a probe failure — a silently dead watcher must not look like all-clear');

  const after = condition.evaluateTransition(cond, error, obs(true, 'h1'), { consecutiveErrors: 3 });
  t.equal(after.fire, false, 'and it alarms once rather than on every subsequent failure');
  t.end();
});

// ── Unattended safety ─────────────────────────────────────────────────────────

test('unattended probes cannot take outward-facing actions', t => {
  [
    'git push origin main', 'npm publish', 'docker push img',
    'kubectl apply -f x.yaml', 'terraform apply', 'gh pr merge 12',
    'curl -X POST https://api.example.com/deploy', 'git commit -am wip'
  ].forEach(command => {
    const verdict = safety.classifyUnattendedProbeCommand(command);
    t.equal(verdict.allowed, false, `"${command}" is refused for an unattended probe`);
  });
  t.equal(safety.classifyUnattendedProbeCommand('rm -rf build').category, 'destructive',
    'the existing destructive rules still apply on top');
  t.end();
});

test('ordinary read-only checks remain usable as probes', t => {
  ['npm test', 'git status --porcelain', 'git rev-parse HEAD', 'pytest -q', 'curl -s https://example.com']
    .forEach(command => {
      t.equal(safety.classifyUnattendedProbeCommand(command).allowed, true,
        `"${command}" is a legitimate read-only probe`);
    });
  t.end();
});

// ── Probes ────────────────────────────────────────────────────────────────────

test('a command probe observes exit code as well as output', async t => {
  // Uses git rather than `node -e` because interpreters are no longer allowlisted for probes —
  // they can perform arbitrary writes that no denylist can inspect. git rev-parse gives a real
  // pass/fail pair through a program that only reads.
  const repoRoot = path.join(__dirname, '..');
  const passing = await runProbe({ type: 'command', command: 'git rev-parse --verify HEAD', workspacePath: repoRoot });
  const failing = await runProbe({ type: 'command', command: 'git rev-parse --verify refs/heads/definitely-not-a-real-branch', workspacePath: repoRoot });
  t.equal(passing.truthy, true, 'exit 0 is a passing check');
  t.equal(failing.truthy, false, 'a non-zero exit is a failing check');
  // Regression guard: without windowsVerbatimArguments the quoted command was mangled into a
  // no-op that always exited 0, so a failing build could never be observed at all.
  t.ok(failing.exitCode > 0, `the real non-zero exit code survives shell quoting (got ${failing.exitCode})`);
  t.notEqual(passing.signature, failing.signature, 'the exit code is part of the observed identity');
  t.end();
});

test('a probe killed by a signal is an error, never a passing check', async t => {
  // Node reports code === null for a signal kill. Coercing that to 0 made a KILLED probe read
  // as "the condition is satisfied" — an OOM kill or our own timeout could fire a watch on
  // nothing. A terminated process produced no measurement at all.
  const result = await runProbe(
    { type: 'command', command: 'ping -n 60 127.0.0.1' },
    { timeoutMs: 1200 }
  );
  t.equal(result.ok, false, 'a killed probe is not a successful observation');
  t.notEqual(result.truthy, true, 'and is never reported as a satisfied condition');
  t.notEqual(result.exitCode, 0, 'it does not masquerade as exit 0');
  t.end();
});

test('a blocked probe command reports the block instead of running', async t => {
  const result = await runProbe({ type: 'command', command: 'git push origin main' });
  t.equal(result.ok, false, 'it does not execute');
  t.equal(result.blocked, true, 'and says it was blocked rather than failing obscurely');
  t.end();
});

test('a probe that hangs is killed rather than wedging the tick', async t => {
  const started = Date.now();
  const result = await runProbe(
    { type: 'command', command: 'ping -n 60 127.0.0.1' },
    { timeoutMs: 1500 }
  );
  t.equal(result.ok, false, 'a hung probe reports failure');
  t.ok(result.timedOut || result.killedBySignal,
    'explicitly as a timeout or a signal kill, not as a result');
  t.ok(Date.now() - started < 20000, 'and does not block the tick for the command\'s full duration');
  // The probe runs under a cmd.exe/powershell wrapper, so child.kill() leaves the real command
  // orphaned. That was not merely slow — a 5-minute watch with a hanging probe would leak one
  // stray process per poll. The whole tree must die, which also means this process can exit
  // promptly rather than waiting out the orphan.
  t.ok(/killProcessTree/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'schedule-probe.js'), 'utf8')),
    'the timeout kills the whole process tree, not just the shell wrapper');
  t.end();
});

test('a file probe hashes content, so an identical rewrite is not a change', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-probe-test-'));
  const target = path.join(dir, 'app.log');
  try {
    const absent = await runProbe({ type: 'file', path: target });
    t.equal(absent.ok, true, 'a missing file is a valid observation');
    t.equal(absent.truthy, false, 'and reads as a failing check rather than an error');

    fs.writeFileSync(target, 'line one\n');
    const first = await runProbe({ type: 'file', path: target });
    fs.writeFileSync(target, 'line one\n');
    const rewritten = await runProbe({ type: 'file', path: target });
    t.equal(first.signature, rewritten.signature,
      'rewriting identical bytes is not a change — build tools do this constantly');

    fs.appendFileSync(target, 'ERROR: boom\n');
    const appended = await runProbe({ type: 'file', path: target });
    t.notEqual(first.signature, appended.signature, 'real new content is a change');

    const matched = await runProbe({ type: 'file', path: target, matchPattern: 'ERROR' });
    const unmatched = await runProbe({ type: 'file', path: target, matchPattern: 'FATAL' });
    t.equal(matched.truthy, true, 'a matchPattern makes the condition "the pattern appeared"');
    t.equal(unmatched.truthy, false, 'and a non-match is a failing check');

    const badRegex = await runProbe({ type: 'file', path: target, matchPattern: '([unclosed' });
    t.equal(badRegex.truthy, false, 'an invalid regex never reads as a satisfied condition');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  t.end();
});

test('an http probe rejects non-http URLs and holds state when unreachable', async t => {
  const badScheme = await runProbe({ type: 'http', url: 'ftp://example.com/file' });
  t.equal(badScheme.ok, false, 'only http(s) is probed');
  const unreachable = await runProbe({ type: 'http', url: 'http://127.0.0.1:9/none' }, { timeoutMs: 2000 });
  t.equal(unreachable.ok, false, 'an unreachable host is an error');
  t.notEqual(unreachable.truthy, true, 'and is never reported as a satisfied condition');
  t.end();
});

// ── Store integration ─────────────────────────────────────────────────────────

test('a quiet check records the baseline without counting as a fire', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    const created = await h.store.create({
      conversationId: 'c1', purpose: 'watch:build', prompt: 'look',
      delayMs: MINUTE, intervalMs: 5 * MINUTE,
      condition: { type: 'command', command: 'npm test', fireWhen: 'false' }
    });
    t.ok(created.schedule.condition, 'the condition is persisted with the schedule');
    t.equal(created.schedule.condition.fireWhen, 'false', 'including its edge direction');

    clock.now = BASE + 2 * MINUTE;
    await h.store.claimDue(clock.now);
    await h.store.recordCheck(created.schedule.scheduleId, obs(true, 'sig-1'), {});

    const after = (await h.store.list())[0];
    t.equal(after.status, 'pending', 'a quiet check returns the watch to waiting');
    t.equal(after.fireCount, 0, 'a check is not a fire — an idle watch must not look busy');
    t.equal(after.checkCount, 1, 'but the check itself is counted');
    t.equal(after.lastObservation.signature, 'sig-1', 'and the baseline is stored for next time');

    // A firing check does count, so the two are genuinely distinguished rather than both zeroed.
    clock.now = BASE + 8 * MINUTE;
    await h.store.claimDue(clock.now);
    await h.store.recordCheck(created.schedule.scheduleId, obs(false, 'sig-2'), { fired: true });
    const fired = (await h.store.list())[0];
    t.equal(fired.fireCount, 1, 'a check that woke the model is counted as a fire');
    t.equal(fired.checkCount, 2, 'and as a check');
  } finally { h.cleanup(); }
  t.end();
});

test('a failed probe does not overwrite the stored baseline', async t => {
  const clock = { now: BASE };
  const h = makeStore(clock);
  try {
    const created = await h.store.create({
      conversationId: 'c1', purpose: 'watch:url', prompt: 'look',
      delayMs: MINUTE, intervalMs: 5 * MINUTE,
      condition: { type: 'http', url: 'https://example.com', fireWhen: 'changed' }
    });
    await h.store.recordCheck(created.schedule.scheduleId, obs(true, 'good-sig'), {});
    await h.store.recordCheck(
      created.schedule.scheduleId,
      { ok: false, error: 'ECONNREFUSED' },
      { preserveSignature: true }
    );

    const after = (await h.store.list())[0];
    t.equal(after.lastObservation.signature, 'good-sig',
      'the last good observation survives an error, so recovery is not a false change');
    t.equal(after.consecutiveProbeErrors, 1, 'consecutive errors are tracked for the broken-watch alarm');

    await h.store.recordCheck(created.schedule.scheduleId, obs(true, 'good-sig'), {});
    t.equal((await h.store.list())[0].consecutiveProbeErrors, 0, 'and reset once the probe works again');
  } finally { h.cleanup(); }
  t.end();
});

test('a persisted watch survives a restart with its baseline intact', async t => {
  const clock = { now: BASE };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-watch-restart-'));
  const filePath = path.join(dir, 'orion-schedules.json');
  try {
    const first = new ScheduleStore({ filePath, now: () => clock.now });
    const created = await first.create({
      conversationId: 'c1', purpose: 'watch:build', prompt: 'look',
      delayMs: MINUTE, intervalMs: 5 * MINUTE,
      condition: { type: 'command', command: 'npm test', fireWhen: 'false' }
    });
    await first.recordCheck(created.schedule.scheduleId, obs(true, 'baseline-sig'), {});

    // Without a persisted baseline every restart would treat the first check as new and fire.
    const reopened = new ScheduleStore({ filePath, now: () => clock.now });
    const after = (await reopened.list())[0];
    t.equal(after.condition.command, 'npm test', 'the probe definition survives a restart');
    t.equal(after.lastObservation.signature, 'baseline-sig',
      'and so does the baseline, so a restart does not fire a spurious change');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  t.end();
});

// ── Wiring ────────────────────────────────────────────────────────────────────

test('the tick screens conditions before waking the model', t => {
  const scheduleIpc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ipc-schedule.js'), 'utf8');
  const tickStart = scheduleIpc.indexOf('async function tick()');
  const tickBody = scheduleIpc.slice(tickStart, scheduleIpc.indexOf('async function start()', tickStart));

  const screenIndex = tickBody.indexOf('screenCondition(schedule)');
  const dispatchIndex = tickBody.indexOf('dispatchToRenderer(schedule');
  t.ok(screenIndex > 0 && screenIndex < dispatchIndex,
    'the cheap probe runs BEFORE dispatch, which is the entire cost argument for the feature');
  t.ok(tickBody.includes('if (!screened || screened.quiet) continue;'),
    'a non-transition skips dispatch entirely rather than waking the model to decide');

  const screenStart = scheduleIpc.indexOf('async function screenCondition');
  const screenBody = scheduleIpc.slice(screenStart, tickStart);
  t.ok(screenBody.includes('runProbe('), 'screening is a plain probe');
  t.notOk(/runAgentLoop|callModel|generateContent|dispatchToRenderer/.test(screenBody),
    'and no model call is reachable from the screening path');
  t.end();
});

test('a woken run is told what changed instead of rediscovering it', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const start = agentJs.indexOf('window.runDurableSchedule = async function');
  const body = agentJs.slice(start, agentJs.indexOf('\n};', start));
  t.ok(body.includes('payload.conditionBriefing'), 'the transition briefing reaches the run');
  // Compared against the enqueue CALL, not the earlier `typeof` availability guard.
  t.ok(body.indexOf('conditionBriefing') < body.indexOf('await window.enqueueOrchestrationTask({'),
    'and is applied to the prompt before the task is created');

  const briefing = condition.buildTransitionBriefing(
    { type: 'command', command: 'npm test', fireWhen: 'false' },
    { fire: true, reason: 'became_false', summary: 'tests now fail' },
    { detail: 'FAIL src/app.test.js' }
  );
  t.ok(/WATCH TRIGGERED/.test(briefing), 'the run knows it was started by a watch, not by the user');
  t.ok(/npm test/.test(briefing), 'it names what was watched');
  t.ok(/FAIL src\/app\.test\.js/.test(briefing), 'and carries the probe output already gathered');
  t.end();
});

test('watch_condition is exposed as its own tool with the cheap-path guidance', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(agentJs.includes("case 'watch_condition':"), 'the tool is dispatched');
  t.ok(agentJs.includes('name: "watch_condition"'), 'and declared to the model');
  const declStart = agentJs.indexOf('name: "watch_condition"');
  const decl = agentJs.slice(declStart, declStart + 1600);
  t.ok(/no model call/i.test(decl),
    'the description tells the model checks are free, so it prefers a watch over repeated follow-ups');
  t.ok(/baseline/i.test(decl), 'and that the first check is silent, so it does not expect an immediate answer');
  t.end();
});
