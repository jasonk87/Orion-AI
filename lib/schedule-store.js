'use strict';

// Durable schedules. Previously every follow-up was a renderer setTimeout in
// window.followupTimers, which meant a reload, a crash, or a restart silently erased every
// pending "check back in N minutes" with nothing recorded anywhere. This store persists the
// intent so the clock is recoverable state rather than a live object in one process's heap.
//
// Deliberately separate from the orchestration task store: a task is work that exists now, a
// schedule is a trigger that will CREATE work later. Merging them would put future intentions
// in the queue the user reads as "things Orion is doing", which is the same confusion that
// previously required keeping active-run conversations out of the task queue.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJsonSync, enqueueFileWrite } = require('./atomic-json-store');
const { recordSwallowedFault } = require('./fault-log');
const policy = require('./schedule-policy');
const { normalizeCondition } = require('./schedule-condition');

const SCHEMA_VERSION = 3;
const { SCHEDULE_STATUS } = policy;

function nowMs() { return Date.now(); }

function newScheduleId() {
  return `sched_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function text(value, max = 4000) {
  return String(value == null ? '' : value).slice(0, max);
}

function normalizeRecord(raw, fallbackNow) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const createdAt = Number(source.createdAt) || fallbackNow;
  const intervalMs = policy.normalizeIntervalMs(source.intervalMs);
  return {
    scheduleId: text(source.scheduleId, 120) || newScheduleId(),
    conversationId: text(source.conversationId, 200),
    // The execution conversation may be an internal Coder/Operator worker. Results belong in
    // the user-facing conversation that created the work, and notification clicks must return
    // there. Old records did not carry this field, so they safely fall back to execution.
    deliveryConversationId: text(source.deliveryConversationId, 200)
      || text(source.conversationId, 200),
    sourceTaskId: text(source.sourceTaskId, 200),
    prompt: text(source.prompt),
    purpose: text(source.purpose, 200) || 'general-followup',
    title: text(source.title, 300),
    modelSelectValue: text(source.modelSelectValue, 120),
    source: text(source.source, 60) || 'followup',
    // A delivery-only schedule surfaces its stored prompt in the owning conversation when it
    // fires. It does not create specialist work or authorize the future payload as an action.
    // Missing on older records means false, preserving their existing execution behavior.
    deliveryOnly: source.deliveryOnly === true,
    createdAt,
    dueAt: Number(source.dueAt) || createdAt,
    intervalMs,
    status: Object.values(SCHEDULE_STATUS).includes(source.status)
      ? source.status
      : SCHEDULE_STATUS.PENDING,
    lastFiredAt: Number(source.lastFiredAt) || 0,
    fireCount: Math.max(0, Number(source.fireCount) || 0),
    skippedOccurrences: Math.max(0, Number(source.skippedOccurrences) || 0),
    lastError: text(source.lastError, 500),
    // Conditional watches: the probe definition, plus the last observation it produced. The
    // observation is the baseline every transition is measured against, so it must persist —
    // an in-memory baseline would make every restart re-fire on the first check.
    // A calendar recurrence ("weekdays at 09:00") instead of a fixed interval. Stored as
    // components rather than a next-run timestamp so it stays correct across DST.
    calendar: policy.normalizeCalendar(source.calendar) || null,
    condition: normalizeCondition(source.condition) || null,
    lastObservation: source.lastObservation && typeof source.lastObservation === 'object'
      ? {
          ok: source.lastObservation.ok !== false,
          signature: text(source.lastObservation.signature, 200),
          truthy: source.lastObservation.truthy === true,
          summary: text(source.lastObservation.summary, 500),
          observedAt: Number(source.lastObservation.observedAt) || 0
        }
      : null,
    consecutiveProbeErrors: Math.max(0, Number(source.consecutiveProbeErrors) || 0),
    checkCount: Math.max(0, Number(source.checkCount) || 0)
  };
}

class ScheduleStore {
  constructor(options = {}) {
    if (!options.filePath) throw new Error('ScheduleStore requires filePath.');
    this.filePath = path.resolve(String(options.filePath));
    this.now = typeof options.now === 'function' ? options.now : nowMs;
  }

  _readSync() {
    let parsed = null;
    try {
      if (fs.existsSync(this.filePath)) {
        parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8').replace(/^﻿/, ''));
      }
    } catch (error) {
      // A corrupt schedule file must not brick startup — losing pending schedules is bad, but
      // refusing to boot is worse. The damaged file is preserved for inspection.
      recordSwallowedFault('schedule-store:unreadable', error, { filePath: this.filePath });
      try {
        fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch (_) {}
      parsed = null;
    }
    const fallbackNow = Number(this.now()) || Date.now();
    const rawSchedules = parsed && Array.isArray(parsed.schedules) ? parsed.schedules : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Number(parsed && parsed.updatedAt) || fallbackNow,
      schedules: rawSchedules.map(record => normalizeRecord(record, fallbackNow))
    };
  }

  _writeSync(state) {
    atomicWriteJsonSync(this.filePath, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Number(this.now()) || Date.now(),
      schedules: state.schedules
    });
    return state;
  }

  // All mutations funnel through here so concurrent ticks and tool calls serialize on the same
  // write queue instead of read-modify-writing over each other.
  _mutate(mutator) {
    return enqueueFileWrite(this.filePath, async () => {
      const state = this._readSync();
      const result = mutator(state);
      // Every mutator here is synchronous by design: the state object is mutated in place and
      // written immediately below. An async mutator would return a pending promise, so the write
      // would persist a HALF-MUTATED state and the caller would receive a promise instead of the
      // receipt. Nothing currently violates this, which is exactly why it would be an easy footgun
      // to introduce later — so it fails loudly at the point of the mistake instead of silently
      // corrupting the schedule file.
      if (result && typeof result.then === 'function') {
        throw new TypeError(
          'ScheduleStore._mutate requires a synchronous mutator: state is written immediately after '
          + 'it returns, so an async mutator would persist a partially-applied state. Do the async '
          + 'work before calling _mutate and pass the resolved values in.'
        );
      }
      this._writeSync(state);
      return result;
    });
  }

  async list(filters = {}) {
    const state = this._readSync();
    let schedules = state.schedules;
    if (filters.conversationId) {
      schedules = schedules.filter(s => s.conversationId === filters.conversationId);
    }
    if (filters.sourceTaskId) {
      schedules = schedules.filter(s => s.sourceTaskId === filters.sourceTaskId);
    }
    if (filters.status) {
      const accepted = new Set(Array.isArray(filters.status) ? filters.status : [filters.status]);
      schedules = schedules.filter(s => accepted.has(s.status));
    }
    return schedules.sort((left, right) => left.dueAt - right.dueAt);
  }

  async create(input = {}) {
    const now = Number(this.now()) || Date.now();
    const intervalMs = policy.normalizeIntervalMs(input.intervalMs);
    const delayMs = policy.normalizeDelayMs(input.delayMs, intervalMs || 60000);
    // A calendar schedule's first run is its next real occurrence, not "now plus a delay" —
    // "weekdays at 09:00" created on Friday afternoon must land on Monday morning.
    const calendar = policy.normalizeCalendar(input.calendar);
    const firstDueAt = calendar
      ? (policy.nextCalendarOccurrence(calendar, now) || now + delayMs)
      : now + delayMs;
    const record = normalizeRecord({
      ...input,
      scheduleId: newScheduleId(),
      createdAt: now,
      dueAt: firstDueAt,
      intervalMs,
      calendar,
      status: SCHEDULE_STATUS.PENDING
    }, now);

    return this._mutate(state => {
      // One live schedule per (conversation, purpose). Re-scheduling the same follow-up
      // replaces the old one rather than stacking duplicate wake-ups, matching the behavior
      // the in-memory timers had.
      const superseded = [];
      state.schedules = state.schedules.filter(existing => {
        const clashes = existing.status === SCHEDULE_STATUS.PENDING
          && existing.conversationId === record.conversationId
          && existing.purpose === record.purpose;
        if (clashes) superseded.push(existing.scheduleId);
        return !clashes;
      });
      state.schedules.push(record);
      return { schedule: record, supersededScheduleIds: superseded };
    });
  }

  // Atomically takes ownership of everything due at `now`, marking each 'firing' inside the
  // same write so a second tick cannot claim the same schedule twice. Recurring schedules have
  // their next occurrence written immediately, which means a crash mid-run loses the run but
  // never the schedule.
  async claimDue(atTime) {
    const now = Number(atTime) || Number(this.now()) || Date.now();
    return this._mutate(state => {
      const claimed = [];
      state.schedules.forEach(schedule => {
        const decision = policy.classifyFire(schedule, now);
        if (decision.action === 'expire') {
          schedule.status = SCHEDULE_STATUS.EXPIRED;
          schedule.lastError = `Expired unfired: ${decision.reason}`;
          return;
        }
        if (decision.action !== 'fire') return;
        schedule.status = SCHEDULE_STATUS.FIRING;
        schedule.lastFiredAt = now;
        schedule.fireCount += 1;
        schedule.skippedOccurrences = Number(decision.skippedOccurrences) || 0;
        if (decision.recurring) schedule.dueAt = decision.nextDueAt;
        claimed.push({ schedule: { ...schedule }, decision });
      });
      return claimed;
    });
  }

  // Called after the fired run is dispatched (or failed to dispatch). One-shots are done;
  // recurring schedules return to pending on the next occurrence claimDue already computed.
  async settle(scheduleId, outcome = {}) {
    return this._mutate(state => {
      const schedule = state.schedules.find(s => s.scheduleId === scheduleId);
      if (!schedule) return null;
      if (schedule.status !== SCHEDULE_STATUS.FIRING) return schedule;
      schedule.lastError = text(outcome.error, 500);
      if (policy.isRecurring(schedule)) {
        schedule.status = SCHEDULE_STATUS.PENDING;
      } else if (outcome.error && outcome.retry) {
        // A one-shot that could not be dispatched (no window yet) stays pending so the next
        // tick retries it, rather than being consumed by a fire that never happened.
        schedule.status = SCHEDULE_STATUS.PENDING;
        schedule.fireCount = Math.max(0, schedule.fireCount - 1);
      } else {
        schedule.status = SCHEDULE_STATUS.COMPLETED;
      }
      return schedule;
    });
  }

  // The quiet path: a conditional watch was checked, nothing transitioned, and no model run is
  // wanted. Records the observation as the new baseline and returns the schedule to pending
  // without touching fireCount — this is a CHECK, not a fire, and conflating the two would
  // make an idle watch look busy.
  //
  // `preserveSignature` is passed when the probe errored: a failed read must not overwrite the
  // baseline, or recovery from the error would register as a change and fire spuriously.
  async recordCheck(scheduleId, observation, options = {}) {
    const now = Number(this.now()) || Date.now();
    return this._mutate(state => {
      const schedule = state.schedules.find(s => s.scheduleId === scheduleId);
      if (!schedule) return null;
      schedule.checkCount += 1;
      if (observation && observation.ok === false) {
        schedule.consecutiveProbeErrors += 1;
        schedule.lastError = text(observation.error, 500);
      } else {
        schedule.consecutiveProbeErrors = 0;
        schedule.lastError = '';
      }
      if (observation && observation.ok !== false && !options.preserveSignature) {
        schedule.lastObservation = {
          ok: true,
          signature: text(observation.signature, 200),
          truthy: observation.truthy === true,
          summary: text(observation.summary, 500),
          observedAt: now
        };
      }
      // claimDue optimistically counts a fire when it takes the schedule, because for a plain
      // timed schedule claiming and firing are the same event. For a conditional watch they are
      // not: most claims are screened out by the probe and never reach the model. Undo the
      // increment unless this check actually fired, or an idle watch that woke nobody in a
      // month would report thousands of "fires".
      if (!options.fired) schedule.fireCount = Math.max(0, schedule.fireCount - 1);
      // A watch is never terminal on a quiet check — it goes back to waiting for its next poll.
      if (schedule.status === SCHEDULE_STATUS.FIRING) schedule.status = SCHEDULE_STATUS.PENDING;
      return schedule;
    });
  }

  async cancel(scheduleId) {
    return this._mutate(state => {
      const schedule = state.schedules.find(s => s.scheduleId === scheduleId);
      if (!schedule) return null;
      schedule.status = SCHEDULE_STATUS.CANCELLED;
      return schedule;
    });
  }

  async cancelForConversation(conversationId) {
    if (!conversationId) return { cancelled: 0 };
    return this._mutate(state => {
      let cancelled = 0;
      state.schedules.forEach(schedule => {
        if (schedule.conversationId !== conversationId) return;
        if (schedule.status !== SCHEDULE_STATUS.PENDING && schedule.status !== SCHEDULE_STATUS.FIRING) return;
        schedule.status = SCHEDULE_STATUS.CANCELLED;
        cancelled++;
      });
      return { cancelled };
    });
  }

  async cancelForSourceTask(sourceTaskId) {
    if (!sourceTaskId) return { cancelled: 0, scheduleIds: [] };
    return this._mutate(state => {
      const scheduleIds = [];
      state.schedules.forEach(schedule => {
        if (schedule.sourceTaskId !== sourceTaskId) return;
        if (schedule.status !== SCHEDULE_STATUS.PENDING && schedule.status !== SCHEDULE_STATUS.FIRING) return;
        schedule.status = SCHEDULE_STATUS.CANCELLED;
        scheduleIds.push(schedule.scheduleId);
      });
      return { cancelled: scheduleIds.length, scheduleIds };
    });
  }

  // Startup recovery: a schedule left 'firing' means the app died between claiming it and
  // running it. Without this it would sit in that state forever, never firing again.
  async releaseInterruptedFiring() {
    return this._mutate(state => {
      const released = [];
      state.schedules.forEach(schedule => {
        if (schedule.status !== SCHEDULE_STATUS.FIRING) return;
        schedule.status = SCHEDULE_STATUS.PENDING;
        schedule.lastError = 'Orion restarted before this scheduled run started.';
        // claimDue optimistically counted a fire when it took this schedule, but the run never
        // happened — the process died between claiming and dispatching. Leaving the increment
        // would make the retry look like a SECOND execution of work that only ever ran once,
        // which is exactly the number a human would use to judge whether a job double-fired.
        schedule.fireCount = Math.max(0, schedule.fireCount - 1);
        // A one-shot's dueAt is still in the past, so the next tick fires it immediately;
        // a recurring one already advanced, so it waits for its next real occurrence.
        released.push(schedule.scheduleId);
      });
      return { released };
    });
  }

  // Housekeeping so the file cannot grow without bound across months of use.
  async pruneTerminal(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const now = Number(this.now()) || Date.now();
    return this._mutate(state => {
      const before = state.schedules.length;
      state.schedules = state.schedules.filter(schedule => {
        const terminal = schedule.status === SCHEDULE_STATUS.COMPLETED
          || schedule.status === SCHEDULE_STATUS.CANCELLED
          || schedule.status === SCHEDULE_STATUS.EXPIRED;
        if (!terminal) return true;
        const settledAt = schedule.lastFiredAt || schedule.createdAt;
        return now - settledAt < maxAgeMs;
      });
      return { pruned: before - state.schedules.length };
    });
  }
}

module.exports = { ScheduleStore, SCHEDULE_STATUS, SCHEMA_VERSION };
