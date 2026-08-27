'use strict';

// Fire-time decisions for durable schedules — pure functions over (schedule, now), with no
// filesystem, timers, or Electron. Every awkward case of desktop scheduling lives here so it
// can be tested directly instead of by sleeping a laptop.
//
// The rules this encodes, and why:
//
//  * WALL CLOCK, NOT setTimeout. A long setTimeout does not survive suspend — the OS does not
//    credit sleep time, so a 40-minute timer set before an overnight close fires 40 minutes
//    after the lid opens, not on time. Every decision here compares stored dueAt against
//    Date.now(), so a schedule is simply "overdue" when the machine wakes and the next tick
//    catches it. That also makes ticks idempotent: missing one costs nothing.
//
//  * ONE-SHOTS RUN LATE. "Check the training in 20 minutes" still wants to run when the laptop
//    wakes at hour three — the request has not expired, it was only delayed. Dropping it would
//    silently lose work the model promised the user. Late fires are marked so the run can say
//    it is late instead of pretending it was punctual.
//
//  * RECURRING SCHEDULES COALESCE. A 5-minute job across an 8-hour sleep is 96 missed
//    occurrences. Running them all is never what anyone wants: they would be identical, and
//    they would stampede the model the moment the machine woke. Missed occurrences collapse
//    into exactly one catch-up run, and the schedule advances to the next FUTURE occurrence.
//    The count of skipped occurrences is preserved so the run can report the gap honestly.

const MIN_INTERVAL_MS = 30 * 1000;
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000;
// Past this much lateness a one-shot is stale rather than delayed: a "check back in 10 minutes"
// that surfaces a week later is noise, not a follow-up. Recurring schedules are never expired
// by lateness — they coalesce instead.
const ONE_SHOT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const SCHEDULE_STATUS = Object.freeze({
  PENDING: 'pending',
  FIRING: 'firing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Calendar recurrence ───────────────────────────────────────────────────────
// "Weekdays at 9am" cannot be expressed as an interval. A day is not reliably 24 hours: on the
// two DST boundaries each year it is 23 or 25, so a schedule maintained by adding 86,400,000ms
// drifts to 8am or 10am and stays wrong until someone notices. Every calculation here goes
// through local date COMPONENTS, which is the only representation where "9am tomorrow" means
// what the user meant.

const DAY_NAMES = Object.freeze({
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6
});
const WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);
// Two weeks is more than enough to land on any weekly pattern, and bounds the search so a
// malformed day list can never spin.
const CALENDAR_SEARCH_DAYS = 15;
// Caps the missed-occurrence count for a very long outage. The exact number past this point is
// not worth iterating for — "more than 400" communicates the same thing.
const MAX_COUNTED_MISSES = 400;
// A calendar run later than this is worth telling the run about even if no occurrence was
// wholly skipped.
const CALENDAR_LATE_AFTER_MS = 15 * 60 * 1000;

// Returned when day tokens were supplied but none of them were recognizable. Distinct from null,
// which means "no days were specified at all" and correctly implies daily.
const INVALID_DAY_LIST = Symbol('invalid-day-list');

function normalizeDayList(value) {
  if (value == null || value === '' || value === 'daily' || value === 'every day') return null;
  const raw = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  const days = new Set();
  raw.forEach(entry => {
    if (entry === 'weekdays' || entry === 'weekday') { WEEKDAYS.forEach(day => days.add(day)); return; }
    if (entry === 'weekends' || entry === 'weekend') { days.add(0); days.add(6); return; }
    const text = String(entry).trim().toLowerCase();
    if (!text) return;
    if (text === 'weekdays' || text === 'weekday') { WEEKDAYS.forEach(day => days.add(day)); return; }
    if (text === 'weekends' || text === 'weekend') { days.add(0); days.add(6); return; }
    if (Object.prototype.hasOwnProperty.call(DAY_NAMES, text)) { days.add(DAY_NAMES[text]); return; }
    const numeric = Number(text);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) days.add(numeric);
  });
  // Two very different situations must not collapse to the same answer. "No days were supplied"
  // legitimately means daily. "Days were supplied but none of them parsed" - onDays: ["Mondey"] -
  // is a validation failure, and returning null for it silently promoted a typo into an EVERY DAY
  // recurrence. INVALID_DAY_LIST is distinguishable, and normalizeCalendar refuses the whole
  // calendar rather than guessing.
  if (!days.size) return INVALID_DAY_LIST;
  return [...days].sort((left, right) => left - right);
}

// Accepts { hour, minute, days } or a "HH:MM" string. Returns null when there is no usable
// calendar, so callers fall through to interval behavior rather than guessing a time.
function normalizeCalendar(raw) {
  if (!raw) return null;
  let hour;
  let minute = 0;
  let days = null;
  if (typeof raw === 'string') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (!match) return null;
    hour = Number(match[1]);
    minute = Number(match[2]);
  } else if (typeof raw === 'object') {
    if (typeof raw.atTime === 'string') {
      const match = /^(\d{1,2}):(\d{2})$/.exec(raw.atTime.trim());
      if (!match) return null;
      hour = Number(match[1]);
      minute = Number(match[2]);
    } else {
      hour = Number(raw.hour);
      minute = Number(raw.minute) || 0;
    }
    days = normalizeDayList(raw.days != null ? raw.days : raw.onDays);
    // A day list that was requested but is entirely unrecognizable makes the whole calendar
    // unusable. Falling through with days=null here is what turned "Mondey" into "every day".
    if (days === INVALID_DAY_LIST) return null;
  } else {
    return null;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute, days };
}

// First matching occurrence strictly after `fromMs`, in the machine's local time zone.
//
// Built from local date components rather than millisecond arithmetic, so it stays correct
// across DST in both directions: the clock changing does not move "9am". On a spring-forward
// day a nonexistent local time normalizes forward by an hour, which is the standard and least
// surprising behavior — the run happens once, slightly later, rather than being skipped.
function nextCalendarOccurrence(calendar, fromMs) {
  const normalized = normalizeCalendar(calendar);
  if (!normalized) return 0;
  const from = new Date(Number(fromMs) || Date.now());
  for (let dayOffset = 0; dayOffset < CALENDAR_SEARCH_DAYS; dayOffset++) {
    const candidate = new Date(
      from.getFullYear(), from.getMonth(), from.getDate() + dayOffset,
      normalized.hour, normalized.minute, 0, 0
    );
    if (candidate.getTime() <= from.getTime()) continue;
    if (normalized.days && !normalized.days.includes(candidate.getDay())) continue;
    return candidate.getTime();
  }
  return 0;
}

function countMissedCalendarOccurrences(calendar, fromMs, nowMs) {
  let cursor = Number(fromMs) || 0;
  let missed = 0;
  while (missed < MAX_COUNTED_MISSES) {
    const next = nextCalendarOccurrence(calendar, cursor);
    if (!next || next > nowMs) break;
    missed++;
    cursor = next;
  }
  return missed;
}

function describeCalendar(calendar) {
  const normalized = normalizeCalendar(calendar);
  if (!normalized) return '';
  const time = `${String(normalized.hour).padStart(2, '0')}:${String(normalized.minute).padStart(2, '0')}`;
  if (!normalized.days) return `every day at ${time}`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isWeekdays = normalized.days.length === 5 && WEEKDAYS.every(day => normalized.days.includes(day));
  if (isWeekdays) return `weekdays at ${time}`;
  return `${normalized.days.map(day => names[day]).join(', ')} at ${time}`;
}

function isRecurring(schedule) {
  if (schedule && normalizeCalendar(schedule.calendar)) return true;
  return toFiniteNumber(schedule && schedule.intervalMs, 0) >= MIN_INTERVAL_MS;
}

function normalizeIntervalMs(value) {
  const interval = toFiniteNumber(value, 0);
  if (interval <= 0) return 0;
  return Math.min(Math.max(interval, MIN_INTERVAL_MS), MAX_DELAY_MS);
}

function normalizeDelayMs(value, fallback = 60000) {
  const delay = toFiniteNumber(value, fallback);
  return Math.min(Math.max(delay, 1000), MAX_DELAY_MS);
}

// Advances a recurring schedule to its first occurrence strictly after `now`, collapsing every
// occurrence missed while the machine was asleep or the app was closed.
//
// Returns the next due time plus how many occurrences were skipped. The modulo keeps this O(1)
// rather than looping — a 30-second job missed across a two-week trip would otherwise spin
// through 40,000 iterations to find the same answer.
function advanceRecurringDueAt(schedule, now) {
  const interval = normalizeIntervalMs(schedule && schedule.intervalMs);
  const currentDueAt = toFiniteNumber(schedule && schedule.dueAt, now);
  if (!interval) return { dueAt: currentDueAt, skipped: 0 };
  if (currentDueAt > now) return { dueAt: currentDueAt, skipped: 0 };
  const elapsed = now - currentDueAt;
  const wholeIntervals = Math.floor(elapsed / interval);
  const nextDueAt = currentDueAt + (wholeIntervals + 1) * interval;
  // wholeIntervals counts occurrences that came and went unrun; the one being fired now is not
  // "skipped", so a schedule that is merely due (not late) reports zero.
  return { dueAt: nextDueAt, skipped: Math.max(0, wholeIntervals) };
}

// Decides what should happen to one schedule at time `now`. The store consults this; it never
// makes timing judgments of its own.
function classifyFire(schedule, now) {
  const status = String(schedule && schedule.status || SCHEDULE_STATUS.PENDING);
  if (status !== SCHEDULE_STATUS.PENDING) {
    return { action: 'skip', reason: `status_${status}` };
  }
  const dueAt = toFiniteNumber(schedule && schedule.dueAt, 0);
  if (!dueAt || dueAt > now) {
    return { action: 'wait', reason: 'not_due', dueAt };
  }
  const lateBy = now - dueAt;
  const calendar = normalizeCalendar(schedule && schedule.calendar);
  if (calendar) {
    // Same coalescing contract as interval recurrence: a laptop closed over a long weekend
    // produces one catch-up run, not one per missed morning.
    //
    // The count starts strictly AFTER dueAt, so it already excludes the occurrence being fired
    // right now — subtracting one as well would under-report the gap by a full occurrence and
    // make a three-day outage look punctual.
    const skipped = countMissedCalendarOccurrences(calendar, dueAt, now);
    return {
      action: 'fire',
      recurring: true,
      calendar: true,
      // A calendar run can be badly late without skipping anything — a 9am briefing delivered
      // at 11am is still worth flagging, because the model must not narrate it as "this
      // morning" when half the day is gone.
      late: skipped > 0 || lateBy > CALENDAR_LATE_AFTER_MS,
      lateBy,
      skippedOccurrences: skipped,
      nextDueAt: nextCalendarOccurrence(calendar, now)
    };
  }
  if (isRecurring(schedule)) {
    const { dueAt: nextDueAt, skipped } = advanceRecurringDueAt(schedule, now);
    return {
      action: 'fire',
      recurring: true,
      late: skipped > 0,
      lateBy,
      skippedOccurrences: skipped,
      nextDueAt
    };
  }
  if (lateBy > ONE_SHOT_STALE_AFTER_MS) {
    // Deliberately not fired: acting on a day-old "check back shortly" would be confusing, and
    // silently dropping it would hide that it was ever scheduled. Expiring records both.
    return { action: 'expire', reason: 'stale_one_shot', lateBy };
  }
  return { action: 'fire', recurring: false, late: lateBy > 60000, lateBy, nextDueAt: 0 };
}

// Human-readable lateness for the system message a fired run posts, so the transcript never
// implies a delayed run was punctual.
function describeFireDelay(decision) {
  if (!decision || decision.action !== 'fire' || !decision.late) return '';
  const minutes = Math.round(toFiniteNumber(decision.lateBy, 0) / 60000);
  const when = minutes >= 120
    ? `${Math.round(minutes / 60)} hours`
    : (minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : 'less than a minute');
  if (decision.recurring && decision.skippedOccurrences > 0) {
    const count = decision.skippedOccurrences;
    return `running ${when} late; ${count} scheduled run${count === 1 ? ' was' : 's were'} skipped while Orion was closed or asleep`;
  }
  return `running ${when} later than scheduled`;
}

module.exports = {
  SCHEDULE_STATUS,
  MIN_INTERVAL_MS,
  MAX_DELAY_MS,
  ONE_SHOT_STALE_AFTER_MS,
  normalizeCalendar,
  normalizeDayList,
  INVALID_DAY_LIST,
  nextCalendarOccurrence,
  countMissedCalendarOccurrences,
  describeCalendar,
  isRecurring,
  normalizeIntervalMs,
  normalizeDelayMs,
  advanceRecurringDueAt,
  classifyFire,
  describeFireDelay
};
