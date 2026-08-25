'use strict';

// These assertions intentionally exercise US Central daylight-saving transitions.
// CI runners commonly use UTC, which has no DST and would make the test meaningless.
process.env.TZ = 'America/Chicago';

// Calendar schedules ("weekdays at 09:00"). The reason this cannot reuse interval recurrence
// is DST: a day is 23 or 25 hours twice a year, so a schedule maintained by adding 86,400,000ms
// drifts to 08:00 or 10:00 and stays wrong until a human notices. Every test that mentions
// March or November is defending that.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');

const policy = require('../lib/schedule-policy');
const { ScheduleStore } = require('../lib/schedule-store');

const WEEKDAYS_9AM = { atTime: '09:00', onDays: 'weekdays' };
const DAILY_9AM = { atTime: '09:00' };

function makeStore(clockRef) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-cal-test-'));
  return {
    store: new ScheduleStore({ filePath: path.join(dir, 'orion-schedules.json'), now: () => clockRef.now }),
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  };
}

// ── Parsing ───────────────────────────────────────────────────────────────────

test('clock times and day filters are parsed into components', t => {
  t.deepEqual(policy.normalizeCalendar('09:00'), { hour: 9, minute: 0, days: null },
    'a bare HH:MM means every day');
  t.deepEqual(policy.normalizeCalendar(WEEKDAYS_9AM), { hour: 9, minute: 0, days: [1, 2, 3, 4, 5] },
    'weekdays expands to Mon-Fri');
  t.deepEqual(policy.normalizeCalendar({ atTime: '17:30', onDays: 'mon,wed,fri' }),
    { hour: 17, minute: 30, days: [1, 3, 5] }, 'a comma list is accepted');
  t.deepEqual(policy.normalizeCalendar({ atTime: '08:00', onDays: 'weekends' }),
    { hour: 8, minute: 0, days: [0, 6] }, 'weekends expands to Sat/Sun');
  t.end();
});

test('unusable times are rejected rather than silently defaulted', t => {
  ['25:00', '9am', '09', 'noon', '', '9:0'].forEach(value => {
    t.equal(policy.normalizeCalendar(value), null, `"${value}" is not a usable clock time`);
  });
  t.equal(policy.normalizeCalendar({ atTime: '12:60' }), null, 'an impossible minute is rejected');
  t.equal(policy.normalizeCalendar(null), null, 'and no calendar at all is not a calendar');
  t.end();
});

// ── Next occurrence ───────────────────────────────────────────────────────────

test('a weekday schedule skips the weekend', t => {
  const fridayAfternoon = new Date(2026, 7, 7, 14, 0, 0).getTime(); // Fri 7 Aug 2026
  const next = new Date(policy.nextCalendarOccurrence(WEEKDAYS_9AM, fridayAfternoon));
  t.equal(next.getDay(), 1, 'from Friday afternoon the next run is Monday');
  t.equal(next.getHours(), 9, 'at the requested hour');
  t.equal(next.getDate(), 10, 'specifically Monday the 10th');
  t.end();
});

test('a daily schedule runs the same day if the time has not passed', t => {
  const mondayEarly = new Date(2026, 7, 10, 7, 0, 0).getTime();
  const next = new Date(policy.nextCalendarOccurrence(DAILY_9AM, mondayEarly));
  t.equal(next.getDate(), 10, 'still today');
  t.equal(next.getHours(), 9, 'at 09:00');

  const mondayLate = new Date(2026, 7, 10, 11, 0, 0).getTime();
  t.equal(new Date(policy.nextCalendarOccurrence(DAILY_9AM, mondayLate)).getDate(), 11,
    'but once the time has passed it moves to tomorrow');
  t.end();
});

test('an occurrence exactly now is not returned as the next one', t => {
  const nineExactly = new Date(2026, 7, 10, 9, 0, 0).getTime();
  const next = policy.nextCalendarOccurrence(DAILY_9AM, nineExactly);
  t.ok(next > nineExactly, 'next means strictly after, or a schedule would re-fire on itself');
  t.equal(new Date(next).getDate(), 11, 'so it lands on the following day');
  t.end();
});

// ── Daylight saving ───────────────────────────────────────────────────────────

test('the local hour is preserved across spring forward', t => {
  // US spring forward 2027: 2027-03-14. Millisecond arithmetic would land on 10:00.
  const dayBefore = new Date(2027, 2, 13, 10, 0, 0).getTime();
  const next = policy.nextCalendarOccurrence(DAILY_9AM, dayBefore);
  const occurrence = new Date(next);
  t.equal(occurrence.getHours(), 9, '09:00 is still 09:00 the morning the clocks move');
  t.equal(occurrence.getDate(), 14, 'on the DST transition day itself');
  t.end();
});

test('the local hour is preserved across fall back', t => {
  // US fall back 2026: 2026-11-01.
  const dayBefore = new Date(2026, 9, 31, 10, 0, 0).getTime();
  const occurrence = new Date(policy.nextCalendarOccurrence(DAILY_9AM, dayBefore));
  t.equal(occurrence.getHours(), 9, '09:00 survives the clocks going back too');
  t.end();
});

test('a DST day is not 24 hours, which is exactly why interval math fails here', t => {
  const before = new Date(2027, 2, 13, 9, 0, 0).getTime();
  const after = policy.nextCalendarOccurrence(DAILY_9AM, before);
  const elapsedHours = (after - before) / 3600000;
  t.equal(elapsedHours, 23, 'consecutive 09:00s are 23 real hours apart across spring forward');
  t.equal(new Date(after).getHours(), 9, 'yet both are 09:00 locally — the point of component math');
  t.end();
});

// ── Firing and coalescing ─────────────────────────────────────────────────────

test('a calendar schedule is recurring and advances to its next occurrence', t => {
  const due = new Date(2026, 7, 10, 9, 0, 0).getTime();
  const decision = policy.classifyFire({ status: 'pending', dueAt: due, calendar: WEEKDAYS_9AM }, due);
  t.equal(decision.action, 'fire', 'it fires when due');
  t.equal(decision.recurring, true, 'a calendar schedule is recurring even with no intervalMs');
  t.equal(decision.calendar, true, 'and is identified as calendar-driven');
  t.equal(decision.skippedOccurrences, 0, 'an on-time run skips nothing');
  t.equal(new Date(decision.nextDueAt).getDate(), 11, 'and advances to the next weekday');
  t.end();
});

test('occurrences missed over a long weekend collapse into one catch-up run', t => {
  // Due Friday 09:00; the machine is reopened Monday at 11:00, so Monday 09:00 also passed.
  const dueFriday = new Date(2026, 7, 7, 9, 0, 0).getTime();
  const mondayLate = new Date(2026, 7, 10, 11, 0, 0).getTime();
  const decision = policy.classifyFire(
    { status: 'pending', dueAt: dueFriday, calendar: WEEKDAYS_9AM },
    mondayLate
  );
  t.equal(decision.action, 'fire', 'one run happens');
  t.equal(decision.skippedOccurrences, 1,
    "Monday's occurrence is reported skipped — the count starts after dueAt, so it is not off by one");
  t.equal(decision.late, true, 'and the run knows it is late');
  t.ok(decision.nextDueAt > mondayLate, 'the schedule advances to a future occurrence, not a backlog');
  t.ok(/1 scheduled run was skipped/.test(policy.describeFireDelay(decision)),
    'the gap is described in correct English, singular');
  t.end();
});

test('a calendar run that is merely late is still flagged', t => {
  const due = new Date(2026, 7, 10, 9, 0, 0).getTime();
  const twoHoursLate = due + 2 * 60 * 60 * 1000;
  const decision = policy.classifyFire({ status: 'pending', dueAt: due, calendar: DAILY_9AM }, twoHoursLate);
  t.equal(decision.skippedOccurrences, 0, 'nothing was wholly skipped');
  t.equal(decision.late, true,
    'but a 9am briefing delivered at 11am must not be narrated as "this morning, just now"');
  t.end();
});

test('a long outage reports many skips without unbounded iteration', t => {
  const dueLastYear = new Date(2025, 7, 10, 9, 0, 0).getTime();
  const now = new Date(2026, 7, 10, 9, 0, 0).getTime();
  const started = Date.now();
  const decision = policy.classifyFire({ status: 'pending', dueAt: dueLastYear, calendar: DAILY_9AM }, now);
  t.ok(decision.skippedOccurrences > 100, 'a year of missed mornings is a lot of occurrences');
  t.ok(decision.skippedOccurrences <= 400, 'but counting is capped rather than walking every one');
  t.ok(Date.now() - started < 200, 'and it resolves quickly');
  t.end();
});

// ── Store integration ─────────────────────────────────────────────────────────

test('a calendar schedule first runs at its next real occurrence, not now plus a delay', async t => {
  const clock = { now: new Date(2026, 7, 7, 14, 0, 0).getTime() }; // Friday afternoon
  const h = makeStore(clock);
  try {
    const created = await h.store.create({
      conversationId: 'c1', purpose: 'standup', prompt: 'morning check',
      delayMs: 60000, calendar: WEEKDAYS_9AM
    });
    const first = new Date(created.schedule.dueAt);
    t.equal(first.getDay(), 1, 'created Friday afternoon, it lands on Monday');
    t.equal(first.getHours(), 9, 'at 09:00');
    t.notEqual(created.schedule.dueAt, clock.now + 60000, 'the delayMs is not used for a calendar schedule');
    t.end();
  } finally { h.cleanup(); }
});

test('a calendar schedule survives a restart with its recurrence intact', async t => {
  const clock = { now: new Date(2026, 7, 7, 14, 0, 0).getTime() };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-cal-restart-'));
  const filePath = path.join(dir, 'orion-schedules.json');
  try {
    const first = new ScheduleStore({ filePath, now: () => clock.now });
    await first.create({
      conversationId: 'c1', purpose: 'standup', prompt: 'morning check', calendar: WEEKDAYS_9AM
    });
    const reopened = new ScheduleStore({ filePath, now: () => clock.now });
    const restored = (await reopened.list())[0];
    t.deepEqual(restored.calendar, { hour: 9, minute: 0, days: [1, 2, 3, 4, 5] },
      'the recurrence is stored as components, so it is not a stale timestamp after a restart');
    t.end();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('claiming a due calendar schedule advances it to the next occurrence', async t => {
  const clock = { now: new Date(2026, 7, 10, 8, 0, 0).getTime() }; // Monday 08:00
  const h = makeStore(clock);
  try {
    const created = await h.store.create({
      conversationId: 'c1', purpose: 'standup', prompt: 'morning check', calendar: WEEKDAYS_9AM
    });
    t.equal(new Date(created.schedule.dueAt).getHours(), 9, 'first run is 09:00 today');

    clock.now = new Date(2026, 7, 10, 9, 0, 30).getTime(); // 09:00:30 Monday
    const claimed = await h.store.claimDue(clock.now);
    t.equal(claimed.length, 1, 'it fires at its time');

    const after = (await h.store.list())[0];
    t.equal(new Date(after.dueAt).getDate(), 11, 'and immediately advances to Tuesday');
    t.equal(new Date(after.dueAt).getHours(), 9, 'still at 09:00');
    t.end();
  } finally { h.cleanup(); }
});

// ── Tool surface ──────────────────────────────────────────────────────────────

test('schedule_followup exposes calendar scheduling and no longer forces delaySeconds', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const declStart = agentJs.indexOf('name: "schedule_followup"');
  const decl = agentJs.slice(declStart, declStart + 2500);
  t.ok(/atTime:\s*\{/.test(decl), 'a clock time can be given');
  t.ok(/onDays:\s*\{/.test(decl), 'along with a day filter');
  t.ok(/daylight saving/i.test(decl),
    'and the description tells the model why atTime beats repeatEverySeconds for daily jobs');
  t.ok(/required: \["prompt"\]/.test(decl),
    'delaySeconds is no longer required, since a calendar schedule does not use it');
  t.end();
});

test('an unparseable time is reported rather than silently becoming an interval schedule', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const start = agentJs.indexOf('async function scheduleAgentFollowup(');
  const body = agentJs.slice(start, agentJs.indexOf('\nasync function createConditionWatch', start));
  t.ok(body.includes('calendar && !created.schedule.calendar'),
    'a time the store could not parse is detected');
  t.ok(/Use 24-hour HH:MM/.test(body),
    'and the model is told the format instead of getting a silently wrong schedule');
  t.end();
});
