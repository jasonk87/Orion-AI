'use strict';

// Phase 3 (state-freshness optimization, item 6's harder half): tests/test_screenshot_similarity.js
// covers the cheap comparison algorithm in isolation. This file covers the actual wiring: the
// in-memory baseline cache in lib/ipc-shell.js, the IPC/preload surface, and the agent.js call
// sites (capture_screen's freshness reuse, inspect_screenshot_with_model's baseline recording, and
// that computer_action's hard gate still holds when there is nothing to reuse).

global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const fs = require('fs');
const path = require('path');
const agent = require('../agent');
const ipcShell = require('../lib/ipc-shell');

const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
const preloadJs = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8').replace(/\r\n/g, '\n');
const ipcShellSrc = fs.readFileSync(path.join(__dirname, '../lib/ipc-shell.js'), 'utf8').replace(/\r\n/g, '\n');
const ipcUiSrc = fs.readFileSync(path.join(__dirname, '../lib/ipc-ui.js'), 'utf8').replace(/\r\n/g, '\n');

function makeSolidBitmap(width, height, r, g, b) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255;
  }
  return buf;
}

// ── wiring / manifest source-text checks ────────────────────────────────────────

test('preload exposes recordInspectedScreenshot to the renderer/agent', t => {
  t.ok(preloadJs.includes("recordInspectedScreenshot:") && preloadJs.includes("'record-inspected-screenshot'"),
    'preload bridges the baseline-recording IPC call');
  t.end();
});

test('lib/ipc-shell.js registers the record-inspected-screenshot handler and returns a freshnessCheck from capture-screen', t => {
  t.ok(ipcShellSrc.includes("ipcMain.handle('record-inspected-screenshot'"), 'handler registered');
  t.ok(ipcShellSrc.includes('freshnessCheck'), 'capture path threads the freshness comparison into its result');
  t.end();
});

test('lib/ipc-ui.js AUTO_UPDATE_FILES includes the new similarity module (packaged-updater manifest)', t => {
  t.ok(ipcUiSrc.includes("'lib/screenshot-similarity.js'"), 'new module is tracked so packaged builds receive it');
  t.end();
});

test('agent.js wires capture_screen to reuse a prior inspection and inspect_screenshot_with_model to record a new baseline', t => {
  t.ok(agentJs.includes('reuseInspection'), 'capture_screen consults the freshness check before deciding inspectedAt');
  t.ok(agentJs.includes('window.api.recordInspectedScreenshot'), 'inspect_screenshot_with_model records a new baseline on success');
  t.end();
});

// ── lib/ipc-shell.js: the in-memory baseline cache ──────────────────────────────

test('compareToLastInspectedScreenshot reports unavailable when nothing has been recorded yet for that conversation', t => {
  const result = ipcShell.compareToLastInspectedScreenshot('conv_never_seen_' + Date.now(), makeSolidBitmap(10, 10, 1, 1, 1), 10, 10);
  t.notOk(result.available, 'no baseline recorded');
  t.notOk(result.unchanged, 'fails safe to "not unchanged" with nothing to compare against');
  t.end();
});

test('recordInspectedScreenshotBaseline + compareToLastInspectedScreenshot: identical follow-up capture is reported unchanged', t => {
  const conversationId = 'conv_identical_' + Date.now();
  const bitmap = makeSolidBitmap(64, 64, 30, 30, 30);
  ipcShell.recordInspectedScreenshotBaseline(conversationId, bitmap, 64, 64);
  const result = ipcShell.compareToLastInspectedScreenshot(conversationId, makeSolidBitmap(64, 64, 30, 30, 30), 64, 64);
  t.ok(result.available, 'baseline was found');
  t.ok(result.unchanged, 'identical capture reported unchanged');
  t.end();
});

test('recordInspectedScreenshotBaseline + compareToLastInspectedScreenshot: a genuinely different follow-up capture is reported changed', t => {
  const conversationId = 'conv_changed_' + Date.now();
  ipcShell.recordInspectedScreenshotBaseline(conversationId, makeSolidBitmap(64, 64, 10, 10, 10), 64, 64);
  const result = ipcShell.compareToLastInspectedScreenshot(conversationId, makeSolidBitmap(64, 64, 250, 250, 250), 64, 64);
  t.ok(result.available, 'baseline was found');
  t.notOk(result.unchanged, 'a real full-frame change is detected, not skipped');
  t.end();
});

test('the baseline cache is bounded — recording many conversations does not grow it unboundedly', t => {
  for (let i = 0; i < 20; i += 1) {
    ipcShell.recordInspectedScreenshotBaseline(`conv_bound_${i}`, makeSolidBitmap(8, 8, i, i, i), 8, 8);
  }
  // The earliest entries should have been evicted; a very early conversationId should no longer
  // have a baseline (fails safe to "unavailable", not an unbounded-memory leak).
  const earliest = ipcShell.compareToLastInspectedScreenshot('conv_bound_0', makeSolidBitmap(8, 8, 0, 0, 0), 8, 8);
  t.notOk(earliest.available, 'oldest entry was evicted once the cache exceeded its bound');
  const latest = ipcShell.compareToLastInspectedScreenshot('conv_bound_19', makeSolidBitmap(8, 8, 19, 19, 19), 8, 8);
  t.ok(latest.available, 'most recent entry is still present');
  t.end();
});

// ── agent.js: capture_screen reuses a prior inspection when the cheap check says "unchanged" ────

test('capture_screen skips requiring re-inspection when the main process reports the screen unchanged', async t => {
  const oldWindow = global.window;
  global.window = {
    api: {
      captureScreen: async () => ({
        success: true, path: 'screenshots/a.png', width: 800, height: 600,
        freshnessCheck: { available: true, unchanged: true, changedFraction: 0.002, reason: 'unchanged' }
      })
    }
  };
  const executionContext = {};
  const result = await agent.executeTool(
    'capture_screen', {}, 'C:\\workspace', {}, { id: 'conv_reuse', mode: 'operator' }, executionContext
  );
  global.window = oldWindow;
  t.ok(result.inspectionSkipped, 'result tells the model inspection was skipped as redundant');
  t.ok(executionContext.lastDesktopSnapshot.inspectedAt > 0, 'snapshot is marked inspected without a real inspect_screenshot_with_model call');
  t.equal(executionContext.lastDesktopSnapshot.inspectedAt, executionContext.lastDesktopSnapshot.capturedAt, 'inspectedAt is stamped at the same time as this capture');
  t.end();
});

test('capture_screen still requires a real inspection when there is no prior baseline to compare against', async t => {
  const oldWindow = global.window;
  global.window = {
    api: {
      captureScreen: async () => ({
        success: true, path: 'screenshots/b.png', width: 800, height: 600,
        freshnessCheck: { available: false, unchanged: false, changedFraction: 1, reason: 'no_prior_inspection' }
      })
    }
  };
  const executionContext = {};
  const result = await agent.executeTool(
    'capture_screen', {}, 'C:\\workspace', {}, { id: 'conv_no_baseline', mode: 'operator' }, executionContext
  );
  global.window = oldWindow;
  t.notOk(result.inspectionSkipped, 'no skip claimed');
  t.equal(executionContext.lastDesktopSnapshot.inspectedAt, 0, 'still requires inspect_screenshot_with_model before computer_action');
  t.end();
});

test('capture_screen still requires a real inspection when the cheap check reports the screen actually changed', async t => {
  const oldWindow = global.window;
  global.window = {
    api: {
      captureScreen: async () => ({
        success: true, path: 'screenshots/c.png', width: 800, height: 600,
        freshnessCheck: { available: true, unchanged: false, changedFraction: 0.4, reason: 'changed' }
      })
    }
  };
  const executionContext = {};
  const result = await agent.executeTool(
    'capture_screen', {}, 'C:\\workspace', {}, { id: 'conv_changed_capture', mode: 'operator' }, executionContext
  );
  global.window = oldWindow;
  t.notOk(result.inspectionSkipped, 'no skip claimed');
  t.equal(executionContext.lastDesktopSnapshot.inspectedAt, 0, 'a real detected change forces a fresh inspection');
  t.end();
});

test('capture_screen with no freshnessCheck field at all (e.g. an older main-process build) falls back to requiring inspection', async t => {
  const oldWindow = global.window;
  global.window = {
    api: {
      captureScreen: async () => ({ success: true, path: 'screenshots/d.png', width: 800, height: 600 })
    }
  };
  const executionContext = {};
  const result = await agent.executeTool(
    'capture_screen', {}, 'C:\\workspace', {}, { id: 'conv_no_field', mode: 'operator' }, executionContext
  );
  global.window = oldWindow;
  t.notOk(result.inspectionSkipped);
  t.equal(executionContext.lastDesktopSnapshot.inspectedAt, 0, 'missing freshnessCheck fails safe, does not silently reuse');
  t.end();
});

test('capture_screen reuses the exact native window discovered by preview_app when display capture is unavailable', async t => {
  const oldWindow = global.window;
  let captureOptions = null;
  global.window = {
    api: {
      previewApp: async () => ({
        success: true,
        processId: 'preview_conv_window_1',
        running: true,
        path: 'screenshots/preview.png',
        width: 1216,
        height: 808,
        captureMode: 'application_window',
        windowTitle: 'This is Life'
      }),
      captureScreen: async (workspace, options) => {
        captureOptions = options;
        return {
          success: true,
          path: 'screenshots/follow-up.png',
          width: 1216,
          height: 808,
          captureMode: 'application_window',
          windowTitle: 'This is Life',
          freshnessCheck: { available: false, unchanged: false, reason: 'window_capture' }
        };
      },
      killCommand: async () => ({ success: true })
    },
    saveConversationsToStorage: () => {}
  };
  const executionContext = {};
  const conversation = { id: 'conv_window', mode: 'coder', activePreviewProcesses: [] };
  try {
    await agent.executeTool('preview_app', { command: 'python main.py' }, 'C:\\workspace', {}, conversation, executionContext);
    await agent.executeTool('capture_screen', {}, 'C:\\workspace', {}, conversation, executionContext);
  } finally {
    global.window = oldWindow;
  }
  t.equal(captureOptions.windowHint, 'This is Life', 'the known preview window is forwarded without model guessing');
  t.equal(executionContext.lastDesktopSnapshot.captureMode, 'application_window', 'the fallback remains explicitly non-coordinate evidence');
  t.equal(executionContext.lastDesktopSnapshot.windowTitle, undefined, 'only safe capture metadata enters the coordinate snapshot');
  t.end();
});

// ── end-to-end: a reused inspection is sufficient for computer_action to proceed ─────────────────

test('computer_action proceeds off a capture_screen-reused inspection without a separate inspect_screenshot_with_model call', async t => {
  const oldWindow = global.window;
  let computerActionCalled = false;
  global.window = {
    api: {
      captureScreen: async () => ({
        success: true, path: 'screenshots/e.png', width: 800, height: 600,
        freshnessCheck: { available: true, unchanged: true, changedFraction: 0, reason: 'unchanged' }
      }),
      computerAction: async () => { computerActionCalled = true; return { success: true }; }
    }
  };
  const conversation = { id: 'conv_e2e', mode: 'operator' };
  const executionContext = {};
  await agent.executeTool('capture_screen', {}, 'C:\\workspace', {}, conversation, executionContext);
  const result = await agent.executeTool(
    'computer_action', { action: 'click', targetDescription: 'ok button', x: 10, y: 10 },
    'C:\\workspace', {}, conversation, executionContext
  );
  global.window = oldWindow;
  t.ok(computerActionCalled, 'computer_action ran');
  t.ok(result.success);
  t.end();
});

test('computer_action still refuses to act when capture_screen did NOT get to reuse an inspection', async t => {
  const oldWindow = global.window;
  let computerActionCalled = false;
  global.window = {
    api: {
      captureScreen: async () => ({
        success: true, path: 'screenshots/f.png', width: 800, height: 600,
        freshnessCheck: { available: false, unchanged: false, changedFraction: 1, reason: 'no_prior_inspection' }
      }),
      computerAction: async () => { computerActionCalled = true; return { success: true }; }
    }
  };
  const conversation = { id: 'conv_e2e_blocked', mode: 'operator' };
  const executionContext = {};
  await agent.executeTool('capture_screen', {}, 'C:\\workspace', {}, conversation, executionContext);
  let error = null;
  try {
    await agent.executeTool(
      'computer_action', { action: 'click', targetDescription: 'ok button', x: 10, y: 10 },
      'C:\\workspace', {}, conversation, executionContext
    );
  } catch (e) { error = e; }
  global.window = oldWindow;
  t.notOk(computerActionCalled, 'the guard still blocks when nothing confirms the screen is unchanged');
  t.ok(error, 'computer_action throws');
  t.match(error.message, /inspect_screenshot_with_model/, 'error still names the real inspection requirement');
  t.end();
});

// ── agent.js: inspect_screenshot_with_model records a new baseline on success ────────────────────

test('a successful inspect_screenshot_with_model call records a new baseline for future freshness checks', async t => {
  const oldWindow = global.window;
  const recordCalls = [];
  global.window = {
    api: {
      readWorkspaceFileBase64: async () => ({ success: true, data: 'ZmFrZQ==', mimeType: 'image/png' }),
      recordInspectedScreenshot: async (workspacePath, relPath, conversationId) => {
        recordCalls.push({ workspacePath, relPath, conversationId });
        return { success: true };
      }
    }
  };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'A blank desktop.', elements: [] }) }] } }]
    })
  });
  const conversation = { id: 'conv_record', mode: 'operator' };
  const executionContext = {};
  const result = await agent.executeTool(
    'inspect_screenshot_with_model', { path: 'screenshots/g.png', goal: 'check state' },
    'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' },
    conversation, executionContext
  );
  global.window = oldWindow;
  global.fetch = async () => ({ ok: false });
  t.ok(result.success !== false, 'inspection succeeded');
  t.equal(recordCalls.length, 1, 'baseline recording was called exactly once');
  t.equal(recordCalls[0].workspacePath, 'C:\\workspace');
  t.equal(recordCalls[0].relPath, 'screenshots/g.png');
  t.equal(recordCalls[0].conversationId, 'conv_record');
  t.end();
});

test('inspect_screenshot_with_model still succeeds even if baseline recording itself fails (best-effort, non-blocking)', async t => {
  const oldWindow = global.window;
  global.window = {
    api: {
      readWorkspaceFileBase64: async () => ({ success: true, data: 'ZmFrZQ==', mimeType: 'image/png' }),
      recordInspectedScreenshot: async () => { throw new Error('disk full'); }
    }
  };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'A blank desktop.', elements: [] }) }] } }]
    })
  });
  let error = null;
  let result = null;
  try {
    result = await agent.executeTool(
      'inspect_screenshot_with_model', { path: 'screenshots/h.png', goal: 'check state' },
      'C:\\workspace', { geminiApiKey: 'fake-key', activeRunModelName: 'gemini-2.5-flash-lite' },
      { id: 'conv_record_fail', mode: 'operator' }, {}
    );
  } catch (e) { error = e; }
  global.window = oldWindow;
  global.fetch = async () => ({ ok: false });
  t.notOk(error, 'a baseline-recording failure does not fail the whole tool call');
  t.ok(result && result.success !== false, 'inspection result still returned');
  t.end();
});
