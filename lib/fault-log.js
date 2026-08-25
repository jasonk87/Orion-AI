'use strict';

// One place to record faults that would otherwise be swallowed.
//
// Orion had ~48 empty `catch (_) {}` blocks. Most are correct — killing an already-dead
// child, unlinking a temp file that is already gone — but a handful sat on top of real
// failures. Notably, every memory-file read falls back to an empty default on a parse
// error, so a corrupted global-memory file made Orion silently forget everything with no
// message anywhere. Swallowing the error is still the right runtime behavior (a bad file
// must not brick startup); losing the evidence is not.
//
// Deliberately dependency-free and never throwing: this is called from inside catch blocks,
// so a failure here would replace the original fault with a worse one.

const fs = require('fs');
const path = require('path');

let cachedLogDir = null;

// electron is resolved lazily and optionally so lib modules that run outside the main
// process (tests, the workspace-index worker) still work.
function resolveLogDir() {
  if (cachedLogDir !== null) return cachedLogDir;
  cachedLogDir = '';
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      const dir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cachedLogDir = dir;
    }
  } catch (_) { /* no electron, or no userData yet: console-only is fine */ }
  return cachedLogDir;
}

function describe(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

/**
 * Record a fault that the caller is deliberately recovering from.
 *
 * @param {string} scope  Where it happened, e.g. "memory:readGlobalMemory".
 * @param {*}      value  The caught error (or a plain description).
 * @param {object} [meta] Extra context, e.g. { file }.
 */
function recordSwallowedFault(scope, value, meta) {
  let line;
  try {
    const detail = describe(value);
    // The context is what makes a fault actionable (which file, which recovery path), so it
    // goes to the console too — not just the log file the user may never find.
    const context = meta && Object.keys(meta).length ? ` ${describe(meta)}` : '';
    line = `[${new Date().toISOString()}] ${scope}:${context} ${detail}\n`;
    if (process.env.ORION_QUIET_FAULT_LOG !== '1') {
      console.warn(`[orion:${scope}]${context}`, detail);
    }
  } catch (_) {
    return false;
  }
  try {
    const dir = resolveLogDir();
    if (!dir) return false;
    fs.appendFileSync(path.join(dir, 'crash.log'), line, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

// Exposed for tests, which need a clean slate per case.
function resetForTest() {
  cachedLogDir = null;
}

module.exports = { recordSwallowedFault, describe, resetForTest };
