'use strict';

// Decides whether an observation should WAKE THE MODEL. Pure: takes a condition, the fresh
// observation, and the previously stored one, and returns a verdict. No I/O, no clock beyond
// what it is handed.
//
// This is the half of conditional scheduling that determines whether the feature is cheap or
// ruinous, so the semantics are deliberate:
//
//  * EDGE-TRIGGERED, NOT LEVEL-TRIGGERED. "Tell me when the build breaks" must fire once when
//    it breaks — not every five minutes for as long as it stays broken. A level-triggered
//    check would turn one real event into a hundred identical wake-ups overnight, each one a
//    paid model run. Firing requires a TRANSITION between observations.
//
//  * THE FIRST OBSERVATION NEVER FIRES. There is nothing to compare against yet. Without this,
//    every new watcher wakes the model the instant it is created, which trains you to ignore
//    it. The first probe silently records a baseline.
//
//  * A BROKEN PROBE IS NOT A FALSE CONDITION. If the command cannot run or the URL is
//    unreachable, that is missing information, not "the build is fine". Treating an error as
//    falsey would make a watcher that silently stopped working look identical to a watcher
//    reporting all-clear — the worst possible failure mode for something you rely on. Errors
//    hold the previous state and, if they persist, surface once as their own alarm.

const CONDITION_TYPES = Object.freeze(['command', 'file', 'http']);
const FIRE_WHEN = Object.freeze(['changed', 'true', 'false']);
// How many consecutive failed probes before the watcher reports itself broken. One transient
// network blip should stay quiet; a watcher that has been failing for half an hour should not
// masquerade as "nothing has changed".
const PROBE_ERROR_ALARM_THRESHOLD = 3;

function normalizeFireWhen(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return FIRE_WHEN.includes(normalized) ? normalized : 'changed';
}

function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim().toLowerCase();
  if (!CONDITION_TYPES.includes(type)) return null;
  return {
    type,
    command: String(raw.command || '').slice(0, 2000),
    path: String(raw.path || '').slice(0, 1000),
    url: String(raw.url || '').slice(0, 2000),
    workspacePath: String(raw.workspacePath || '').slice(0, 1000),
    // Optional regex applied to probe output; when present the condition's truthiness is
    // "the pattern matched" rather than the probe's own notion of success.
    matchPattern: String(raw.matchPattern || '').slice(0, 500),
    fireWhen: normalizeFireWhen(raw.fireWhen)
  };
}

function describeCondition(condition) {
  if (!condition) return '';
  if (condition.type === 'command') return `command \`${condition.command}\``;
  if (condition.type === 'file') return `file \`${condition.path}\``;
  if (condition.type === 'http') return `URL ${condition.url}`;
  return condition.type;
}

// `observation` is what the probe produced now; `previous` is what was stored from last time.
// Both use { ok, signature, truthy, summary, error }.
function evaluateTransition(condition, observation, previous, options = {}) {
  const normalized = normalizeCondition(condition);
  if (!normalized) {
    return { fire: false, reason: 'invalid_condition', quiet: true };
  }
  const consecutiveErrors = Math.max(0, Number(options.consecutiveErrors) || 0);

  if (!observation || observation.ok === false) {
    const errorCount = consecutiveErrors + 1;
    const threshold = Number(options.errorAlarmThreshold) || PROBE_ERROR_ALARM_THRESHOLD;
    if (errorCount === threshold) {
      // Exactly ON the threshold, not past it: this fires once, not on every subsequent failure.
      return {
        fire: true,
        reason: 'probe_failing',
        consecutiveErrors: errorCount,
        summary: `The watched ${describeCondition(normalized)} could not be checked ${errorCount} times in a row. Latest error: ${(observation && observation.error) || 'unknown'}. The watch is not reporting on the thing it was set up to watch.`
      };
    }
    return {
      fire: false,
      reason: 'probe_error',
      quiet: true,
      consecutiveErrors: errorCount,
      // Deliberately does NOT overwrite the stored signature: a failed read must not be
      // recorded as a new value, or recovery would look like a change and fire spuriously.
      preserveSignature: true
    };
  }

  const hasBaseline = !!(previous && previous.ok !== false && typeof previous.signature === 'string' && previous.signature.length > 0);
  if (!hasBaseline) {
    return {
      fire: false,
      reason: 'baseline_recorded',
      quiet: true,
      summary: `Baseline recorded for ${describeCondition(normalized)}.`
    };
  }

  if (normalized.fireWhen === 'changed') {
    if (observation.signature === previous.signature) {
      return { fire: false, reason: 'unchanged', quiet: true };
    }
    return {
      fire: true,
      reason: 'changed',
      summary: `${describeCondition(normalized)} changed.\nPrevious: ${previous.summary || previous.signature}\nNow: ${observation.summary || observation.signature}`
    };
  }

  // Rising / falling edge. Comparing against the previous BOOLEAN (not the signature) is what
  // keeps a condition that stays true from re-firing on every unrelated output change.
  const want = normalized.fireWhen === 'true';
  const was = previous.truthy === true;
  const now = observation.truthy === true;
  if (now === was) {
    return { fire: false, reason: now === want ? 'still_matching' : 'still_not_matching', quiet: true };
  }
  if (now !== want) {
    return {
      fire: false,
      reason: 'transitioned_away',
      quiet: true,
      // Worth recording even though nothing fires: this is the edge that re-arms the watch.
      summary: `${describeCondition(normalized)} returned to its normal state.`
    };
  }
  return {
    fire: true,
    reason: want ? 'became_true' : 'became_false',
    summary: `${describeCondition(normalized)} ${want ? 'now matches' : 'no longer matches'} the watched condition.\n${observation.summary || observation.signature}`
  };
}

// The context handed to a run that a condition woke. Without this the model would open with no
// idea why it is awake and would re-derive the change by hand — the exact cost the cheap probe
// tier exists to avoid.
function buildTransitionBriefing(condition, verdict, observation) {
  const normalized = normalizeCondition(condition);
  const lines = [
    `[WATCH TRIGGERED] This run was started automatically because a watched condition changed — not by the user.`,
    `Watched: ${describeCondition(normalized)}`,
    `Trigger: ${verdict.reason}`
  ];
  if (verdict.summary) lines.push(`What changed:\n${verdict.summary}`);
  if (observation && observation.detail) {
    lines.push(`Latest probe output:\n${String(observation.detail).slice(0, 4000)}`);
  }
  lines.push('Act on this change. If it needs no action, say so briefly and stop rather than inventing work.');
  return lines.join('\n');
}

module.exports = {
  CONDITION_TYPES,
  FIRE_WHEN,
  PROBE_ERROR_ALARM_THRESHOLD,
  normalizeCondition,
  normalizeFireWhen,
  describeCondition,
  evaluateTransition,
  buildTransitionBriefing
};
