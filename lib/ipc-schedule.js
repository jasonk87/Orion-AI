'use strict';

// Owns the schedule clock in the MAIN process and exposes the store to the renderer.
//
// Main-process ownership is the whole point of this module. The previous implementation ran
// setTimeout inside the renderer, so a reload — which the app does on update, and which any
// renderer crash forces — erased every pending wake-up with no record that it had existed.
// Here the clock is a repeating tick over durable state: losing a tick costs nothing, and a
// full restart resumes from the file.
//
// The tick is short and fixed rather than a long timer sized to the next due time, because a
// long setTimeout does not survive suspend. Polling wall-clock every few seconds means "the
// laptop was closed for nine hours" needs no special handling — the first tick after wake sees
// overdue work and schedule-policy decides what to do about it.

const { ScheduleStore, SCHEDULE_STATUS } = require('./schedule-store');
const { describeFireDelay } = require('./schedule-policy');
const { evaluateTransition, buildTransitionBriefing } = require('./schedule-condition');
const { runProbe } = require('./schedule-probe');
const { recordSwallowedFault } = require('./fault-log');
const shared = require('./shared');

const TICK_INTERVAL_MS = 15 * 1000;

function registerHandlers(ipcMain, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain is required.');

  let lazyStore = options.store || null;
  const store = () => {
    if (!lazyStore) {
      const filePath = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
      lazyStore = new ScheduleStore({ filePath });
    }
    return lazyStore;
  };

  const ok = value => ({ success: true, ...value });
  const fail = error => ({
    success: false,
    error: error && error.message ? error.message : String(error || 'Schedule operation failed.')
  });

  ipcMain.handle('orion:create-schedule', async (event, input = {}) => {
    try { return ok(await store().create(input)); } catch (error) { return fail(error); }
  });
  ipcMain.handle('orion:list-schedules', async (event, filters = {}) => {
    try { return ok({ schedules: await store().list(filters) }); } catch (error) { return fail(error); }
  });
  ipcMain.handle('orion:cancel-schedule', async (event, payload = {}) => {
    try { return ok({ schedule: await store().cancel(payload.scheduleId) }); } catch (error) { return fail(error); }
  });
  ipcMain.handle('orion:cancel-conversation-schedules', async (event, payload = {}) => {
    try { return ok(await store().cancelForConversation(payload.conversationId)); } catch (error) { return fail(error); }
  });

  // ── The clock ───────────────────────────────────────────────────────────────
  let timer = null;
  let ticking = false;

  // A fired schedule needs the renderer: runAgentLoop and the conversation list live there.
  // If no window is ready the schedule is NOT consumed — it returns to pending so the next
  // tick retries. Otherwise closing the window during a due minute would silently eat the run.
  async function dispatchToRenderer(schedule, decision) {
    if (!shared.mainWindow || shared.mainWindow.isDestroyed()) {
      throw new Error('Orion window is not ready.');
    }
    const payload = {
      scheduleId: schedule.scheduleId,
      conversationId: schedule.conversationId,
      deliveryConversationId: schedule.deliveryConversationId || schedule.conversationId,
      sourceTaskId: schedule.sourceTaskId || '',
      prompt: schedule.prompt,
      purpose: schedule.purpose,
      title: schedule.title,
      modelSelectValue: schedule.modelSelectValue,
      recurring: !!decision.recurring,
      late: !!decision.late,
      lateBy: Number(decision.lateBy) || 0,
      skippedOccurrences: Number(decision.skippedOccurrences) || 0,
      delayNote: describeFireDelay(decision),
      // Present only for conditional watches: tells the woken run why it is awake and what
      // changed, so it does not have to rediscover the transition the probe already found.
      conditionBriefing: schedule.conditionBriefing || ''
    };
    const script = `window.runDurableSchedule && window.runDurableSchedule(${JSON.stringify(payload)})`;
    const result = await shared.mainWindow.webContents.executeJavaScript(script, true);
    if (!result) throw new Error('Renderer schedule bridge is not ready yet.');
    return result;
  }

  // The cheap tier. A conditional schedule that comes due runs its probe FIRST; the model is
  // only woken if the probe reports a real transition. A watch that finds nothing costs one
  // subprocess or one HTTP GET, which is what makes leaving a 5-minute watcher running for a
  // month affordable rather than absurd.
  //
  // Returns null when the model should be woken (with a briefing), or a settled outcome when
  // the tick handled it quietly.
  async function screenCondition(schedule) {
    if (!schedule.condition) return null;
    const observation = await runProbe(schedule.condition, {});
    const verdict = evaluateTransition(
      schedule.condition,
      observation,
      schedule.lastObservation,
      { consecutiveErrors: schedule.consecutiveProbeErrors }
    );
    if (!verdict.fire) {
      await store().recordCheck(schedule.scheduleId, observation, {
        preserveSignature: !!verdict.preserveSignature
      });
      return { quiet: true, reason: verdict.reason };
    }
    // Firing: the new observation becomes the baseline so the same transition cannot fire
    // twice, and the run is told exactly what changed.
    await store().recordCheck(schedule.scheduleId, observation, { fired: true });
    return { fire: true, briefing: buildTransitionBriefing(schedule.condition, verdict, observation) };
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const claimed = await store().claimDue(Date.now());
      for (const { schedule, decision } of claimed) {
        try {
          if (schedule.condition) {
            const screened = await screenCondition(schedule);
            // recordCheck already returned the watch to pending for its next poll.
            if (!screened || screened.quiet) continue;
            schedule.conditionBriefing = screened.briefing;
          }
          const result = await dispatchToRenderer(schedule, decision);
          // 'deferred' means the renderer is alive but the conversation is mid-run. Returning
          // the schedule to pending lets it retry instead of overlapping a run with itself.
          if (result && result.deferred) {
            await store().settle(schedule.scheduleId, { error: result.reason || 'deferred', retry: true });
          } else {
            await store().settle(schedule.scheduleId, {});
          }
        } catch (error) {
          await store().settle(schedule.scheduleId, { error: error.message, retry: true });
        }
      }
    } catch (error) {
      recordSwallowedFault('schedule-tick', error, {});
    } finally {
      ticking = false;
    }
  }

  async function start() {
    if (timer) return;
    try {
      // Anything left mid-fire belonged to a process that died. Recover it before the first
      // tick so a crash during a scheduled run does not strand the schedule forever.
      await store().releaseInterruptedFiring();
      await store().pruneTerminal();
    } catch (error) {
      recordSwallowedFault('schedule-startup-recovery', error, {});
    }
    timer = setInterval(() => { tick().catch(() => {}); }, TICK_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    // setInterval does not fire until a full interval has elapsed, but a restart is exactly
    // when overdue schedules are most likely to be waiting — they accumulated while the app
    // was closed. Sweep once now so recovery is prompt instead of waiting out the first tick.
    // Deferred a beat so the renderer has a chance to attach; a fire that finds no window
    // defers and retries anyway, so this is an optimization, not a correctness dependency.
    const priming = setTimeout(() => { tick().catch(() => {}); }, 2000);
    if (typeof priming.unref === 'function') priming.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { store, start, stop, tick, TICK_INTERVAL_MS, SCHEDULE_STATUS };
}

module.exports = { registerHandlers, TICK_INTERVAL_MS };
