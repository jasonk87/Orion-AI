'use strict';

// Phase 3 (concurrency/resource leases item 11, restart/recovery item 12): tests/test_resource_lease_store.js
// covers the store in isolation. This file covers the actual call sites that use it: agent.js's
// computer_action/browser-tool/start_command/kill_command gates, and renderer.js's restart-time
// reconciliation and the role-routing fix that reconciliation exposed.

global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const fs = require('fs');
const path = require('path');
const agent = require('../agent');
const ipcShell = require('../lib/ipc-shell');
const { loadRenderer } = require('./helpers/renderer-harness');

const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
const rendererJs = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').replace(/\r\n/g, '\n');
const preloadJs = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8').replace(/\r\n/g, '\n');

// ── lib/ipc-shell.js: isProcessAlive ─────────────────────────────────────────────

test('isProcessAlive distinguishes a real running process from a PID that does not exist', t => {
  t.equal(ipcShell.isProcessAlive(process.pid), true, 'this test process itself is reported alive');
  t.equal(ipcShell.isProcessAlive(999999999), false, 'an implausible PID is reported dead');
  t.equal(ipcShell.isProcessAlive(0), false, 'PID 0 is rejected rather than probed');
  t.equal(ipcShell.isProcessAlive(-5), false, 'a negative PID is rejected rather than probed');
  t.equal(ipcShell.isProcessAlive('not-a-pid'), false, 'a non-numeric value is rejected rather than probed');
  t.end();
});

test('check-process-alive IPC handler and preload/main wiring exist', t => {
  t.ok(agentJs.includes("processIds: result.pid ? [String(result.pid)] : []") || agentJs.includes('processIds: result.pid'),
    'start_command records the real OS pid on the process lease, not the app-level processId string');
  t.ok(fs.readFileSync(path.join(__dirname, '../lib/ipc-shell.js'), 'utf8').includes("ipcMain.handle('check-process-alive'"),
    'main process exposes a raw PID liveness check IPC handler');
  t.ok(preloadJs.includes("checkProcessAlive: (pid) => ipcRenderer.invoke('check-process-alive', pid)"),
    'preload bridges the liveness check to the renderer');
  t.end();
});

test('main.js registers the resource-lease IPC handlers with their own persisted file', t => {
  t.ok(mainJs.includes("require('./lib/ipc-resource-leases')"), 'main.js loads the resource-lease IPC module');
  t.ok(mainJs.includes('ipcResourceLeases.registerHandlers(ipcMain'), 'the handlers are actually registered');
  t.ok(mainJs.includes("'resource-leases.json'"), 'leases persist to their own file, not mixed into orchestration-tasks.json');
  t.end();
});

test('preload exposes the full resource-lease API surface the renderer and agent depend on', t => {
  for (const method of [
    'acquireResourceLease', 'releaseResourceLease', 'releaseResourceLeasesForConversation',
    'heartbeatResourceLease', 'listResourceLeases', 'reconcileResourceLeases', 'resolveResourceLeaseLiveness'
  ]) {
    t.ok(preloadJs.includes(`${method}:`), `preload exposes window.api.${method}`);
  }
  t.end();
});

// ── agent.js: computer_action / browser tools acquire the shared desktop/browser lease ──────────

test('computer_action acquires a desktop lease and is blocked by a conflicting holder before it ever touches the desktop', async t => {
  const oldWindow = global.window;
  const leaseCalls = [];
  let computerActionCalled = false;
  global.window = {
    api: {
      acquireResourceLease: async (payload) => {
        leaseCalls.push(payload);
        return { success: false, conflict: { conversationId: 'other-conv', role: 'coder' } };
      },
      computerAction: async () => { computerActionCalled = true; return { success: true }; }
    }
  };
  const snapshot = { path: 'x', width: 100, height: 80, capturedAt: Date.now(), inspectedAt: Date.now() };
  const executionContext = { lastDesktopSnapshot: snapshot, runTaskId: 'task_1' };
  let error = null;
  try {
    await agent.executeTool(
      'computer_action', { action: 'click', targetDescription: 'x', x: 1, y: 1 },
      'C:\\workspace', {}, { id: 'conv_new', mode: 'operator' }, executionContext
    );
  } catch (e) { error = e; }
  global.window = oldWindow;
  t.ok(error, 'a conflicting desktop lease blocks the action');
  t.match(error.message, /Another conversation.*desktop/i, 'the error names the collision');
  t.notOk(computerActionCalled, 'the underlying desktop-control IPC call never runs when blocked');
  t.equal(leaseCalls[0].resourceType, 'desktop');
  t.equal(leaseCalls[0].resourceKey, 'desktop');
  t.equal(leaseCalls[0].conversationId, 'conv_new');
  t.equal(leaseCalls[0].taskId, 'task_1');
  t.equal(leaseCalls[0].role, 'operator');
  t.end();
});

test('computer_action still works when window.api.acquireResourceLease is absent - the lease gate fails open, not closed', async t => {
  const oldWindow = global.window;
  global.window = {
    api: {
      computerAction: async () => ({ success: true, path: 'x', width: 100, height: 80 })
      // no acquireResourceLease defined - simulates an older preload build
    }
  };
  const snapshot = { path: 'x', width: 100, height: 80, capturedAt: Date.now(), inspectedAt: Date.now() };
  const result = await agent.executeTool(
    'computer_action', { action: 'click', targetDescription: 'x', x: 1, y: 1 },
    'C:\\workspace', {}, { id: 'conv_new', mode: 'coder' }, { lastDesktopSnapshot: snapshot }
  );
  global.window = oldWindow;
  t.equal(result.success, true, 'the tool call still succeeds without the lease service available');
});

test('a shared browser-worker tool acquires a browser lease and is blocked by a conflicting holder', async t => {
  const oldWindow = global.window;
  const leaseCalls = [];
  global.window = {
    api: {
      acquireResourceLease: async (payload) => {
        leaseCalls.push(payload);
        return { success: false, conflict: { conversationId: 'other-conv', role: 'operator' } };
      }
    }
  };
  let error = null;
  try {
    await agent.executeTool('open_url', { url: 'https://example.com' }, 'C:\\workspace', {}, { id: 'conv_new', mode: 'coder' }, { runTaskId: 'task_3' });
  } catch (e) { error = e; }
  global.window = oldWindow;
  t.ok(error, 'a conflicting browser lease blocks the action');
  t.match(error.message, /Another conversation.*browser worker/i, 'the error names the collision');
  t.equal(leaseCalls[0].resourceType, 'browser');
  t.equal(leaseCalls[0].resourceKey, 'browser');
  t.end();
});

test('a read-only or code tool never triggers the desktop/browser lease gate', async t => {
  const oldWindow = global.window;
  const leaseCalls = [];
  global.window = {
    api: {
      acquireResourceLease: async (payload) => { leaseCalls.push(payload); return { success: true, acquired: true }; }
    }
  };
  try {
    await agent.executeTool('update_scratchpad', { content: 'x' }, 'C:\\workspace', {}, { id: 'conv_new', mode: 'coder', scratchpad: '' }, {});
  } catch (_) { /* irrelevant to this assertion */ }
  global.window = oldWindow;
  t.equal(leaseCalls.length, 0, 'a tool outside the desktop/browser sets never calls acquireResourceLease at all');
  t.end();
});

// ── agent.js: start_command / kill_command track a workspace-scoped process lease ───────────────

test('start_command records a process lease keyed by the workspace, using the real OS pid, and is non-blocking on conflict', async t => {
  const oldWindow = global.window;
  const leaseCalls = [];
  global.window = {
    api: {
      startCommand: async () => ({ success: true, id: 'cmd_x', pid: 4242, status: 'running' }),
      acquireResourceLease: async (payload) => {
        leaseCalls.push(payload);
        return { success: false, conflict: { conversationId: 'other-conv', role: 'coder' } };
      }
    }
  };
  const result = await agent.executeTool(
    'start_command', { command: 'npm run dev' }, 'C:\\workspace', {}, { id: 'conv_new', mode: 'operator' }, { runTaskId: 'task_2' }
  );
  global.window = oldWindow;
  t.equal(result.success, true, 'a lease conflict on a process lease does not block start_command itself - it is a warning, not a hard collision');
  t.ok(result.leaseWarning, 'the conflict is surfaced to the model as a warning');
  t.equal(leaseCalls[0].resourceType, 'process');
  t.equal(leaseCalls[0].resourceKey, 'C:\\workspace');
  t.deepEqual(leaseCalls[0].processIds, ['4242'], 'the real OS pid is recorded, not the app-level processId string, so it can be checked after a restart');
  t.end();
});

test('start_command with no pid reported records no processIds rather than fabricating one', async t => {
  const oldWindow = global.window;
  const leaseCalls = [];
  global.window = {
    api: {
      startCommand: async () => ({ success: true, id: 'cmd_x', status: 'running' }),
      acquireResourceLease: async (payload) => { leaseCalls.push(payload); return { success: true, acquired: true }; }
    }
  };
  await agent.executeTool('start_command', { command: 'npm run dev' }, 'C:\\workspace', {}, { id: 'conv_new', mode: 'coder' }, {});
  global.window = oldWindow;
  t.deepEqual(leaseCalls[0].processIds, [], 'no fabricated pid is recorded when the IPC layer did not report one');
  t.end();
});

test('kill_command releases the workspace process lease', async t => {
  const oldWindow = global.window;
  const releaseCalls = [];
  global.window = {
    api: {
      killCommand: async () => ({ success: true }),
      releaseResourceLease: async (payload) => { releaseCalls.push(payload); return { success: true }; }
    }
  };
  const result = await agent.executeTool(
    'kill_command', { processId: 'cmd_x' }, 'C:\\workspace', {}, { id: 'conv_new', mode: 'operator', activePreviewProcesses: [] }, {}
  );
  global.window = oldWindow;
  t.equal(result.success, true);
  t.equal(releaseCalls[0].resourceType, 'process');
  t.equal(releaseCalls[0].resourceKey, 'C:\\workspace');
  t.equal(releaseCalls[0].conversationId, 'conv_new');
  t.end();
});

// ── agent.js: run-end release and the once-per-run workspace lease (source-text) ─────────────────

test('the run loop releases desktop/browser/workspace leases when it ends, but not process leases', t => {
  const finallyStart = agentJs.indexOf("if (runningConversationId === (conversation && conversation.id)) {");
  const finallyEnd = agentJs.indexOf('if (startingRunTaskId === runTaskId)', finallyStart);
  const finallyBlock = agentJs.slice(finallyStart, finallyEnd);
  t.ok(finallyBlock.includes("resourceType: 'desktop'"), 'desktop lease is released at run end');
  t.ok(finallyBlock.includes("resourceType: 'browser'"), 'browser lease is released at run end');
  t.ok(finallyBlock.includes("resourceType: 'workspace'"), 'workspace lease is released at run end');
  t.notOk(finallyBlock.includes("resourceType: 'process'"), 'process leases are deliberately NOT released here - they track the real OS process, which outlives the run on purpose');
  t.end();
});

test('a Coder/Operator run acquires a workspace lease once, gated to its own role, before the tool loop begins', t => {
  t.ok(agentJs.includes("(activeConversationMode === 'coder' || activeConversationMode === 'operator') && workspacePath"),
    'the workspace lease is only acquired for Coder/Operator conversations with a resolved workspace');
  t.ok(agentJs.includes("resourceType: 'workspace',\n        resourceKey: workspacePath,"),
    'the lease key is the actual resolved workspace path');
  t.end();
});

// ── renderer.js: restart reconciliation is role-aware and actually checks liveness ───────────────

test('scheduleTerminalDelegatedTaskReconciliation routes a terminal Operator task to Operator-phrased notification, not Coder\'s', async t => {
  const { win, read } = loadRenderer({
    t,
    api: {
      // window.getOrchestrationTaskStatus (called inside notifySupervisorOf*Completion) is a
      // renderer-defined wrapper (not window.api.*) that delegates to window.api.getOrchestrationTask
      // (singular) - not getOrchestrationTaskStatus. Mock the actual API surface it calls.
      getOrchestrationTask: async () => ({
        success: true,
        task: { taskId: 'task_op', title: 'Op task', status: 'completed', target: { conversationId: 'operator-1' } }
      })
    },
    set: {
      conversations: [
        { id: 'dispatch-1', mode: 'orion', launchedCoderConvId: 'operator-1', launchedCoderTaskId: 'task_op', launchedCoderTaskTitle: 'Op task', messages: [] },
        { id: 'operator-1', mode: 'operator', title: 'Op task', messages: [] }
      ]
    }
  });
  const dispatchConv = read('conversations').find(c => c.id === 'dispatch-1');
  const durableTasks = new Map([
    ['task_op', {
      taskId: 'task_op', status: 'completed',
      origin: { conversationId: 'dispatch-1' }, target: { conversationId: 'operator-1' }
    }]
  ]);
  const scheduled = win.scheduleTerminalDelegatedTaskReconciliation(dispatchConv, durableTasks);
  t.equal(scheduled, true, 'a terminal delegated task schedules reconciliation');
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  const reread = read('conversations').find(c => c.id === 'dispatch-1');
  const lastMsg = reread.messages[reread.messages.length - 1];
  t.ok(lastMsg && /^Operator (completed|finished)/.test(lastMsg.text || ''),
    `the terminal Operator task is reported with Operator phrasing, not Coder's (got: ${lastMsg && lastMsg.text})`);
  t.end();
});

test('reconcileResourceLeasesAfterRestart extracts interrupted task IDs, checks real liveness, and records a note when a process is confirmed still running', async t => {
  const calls = [];
  const { win, expose } = loadRenderer({
    t,
    expose: ['interruptedTaskLivenessNotes'],
    api: {
      reconcileResourceLeases: async (payload) => {
        calls.push({ method: 'reconcileResourceLeases', payload });
        return {
          success: true,
          released: [],
          flaggedForLivenessCheck: [{
            resourceType: 'process', resourceKey: 'c:\\projects\\orion',
            taskId: 'task_x', processIds: ['4242']
          }]
        };
      },
      checkProcessAlive: async (pid) => ({ success: true, alive: pid === '4242' }),
      resolveResourceLeaseLiveness: async (payload) => { calls.push({ method: 'resolveResourceLeaseLiveness', payload }); return { success: true }; }
    }
  });
  await win.reconcileResourceLeasesAfterRestart({
    tasks: [
      { taskId: 'task_x', failure: { code: 'interrupted' } },
      { taskId: 'task_superseded', failure: { code: 'not_interrupted' } }
    ]
  });
  const reconcileCall = calls.find(c => c.method === 'reconcileResourceLeases');
  t.deepEqual(reconcileCall.payload.interruptedTaskIds, ['task_x'],
    'only the task actually marked interrupted is passed through, not every reconciled task');
  const resolveCall = calls.find(c => c.method === 'resolveResourceLeaseLiveness');
  t.equal(resolveCall.payload.stillAlive, true, 'the real liveness result is reported back to the lease store');
  t.ok(expose.interruptedTaskLivenessNotes.has('task_x'), 'a note is recorded for the notifier to surface later');
  t.end();
});

test('reconcileResourceLeasesAfterRestart records no note when the flagged process is confirmed dead', async t => {
  const { win, expose } = loadRenderer({
    t,
    expose: ['interruptedTaskLivenessNotes'],
    api: {
      reconcileResourceLeases: async () => ({
        success: true,
        released: [],
        flaggedForLivenessCheck: [{ resourceType: 'process', resourceKey: 'c:\\projects\\orion', taskId: 'task_y', processIds: ['9999'] }]
      }),
      checkProcessAlive: async () => ({ success: true, alive: false }),
      resolveResourceLeaseLiveness: async () => ({ success: true })
    }
  });
  await win.reconcileResourceLeasesAfterRestart({ tasks: [{ taskId: 'task_y', failure: { code: 'interrupted' } }] });
  t.notOk(expose.interruptedTaskLivenessNotes.has('task_y'), 'a confirmed-dead process leaves no liveness note - the default failure message already covers it');
  t.end();
});

test('a recorded liveness note is surfaced by the completion notifier and cleared once consumed', async t => {
  const { win, expose, read } = loadRenderer({
    t,
    expose: ['interruptedTaskLivenessNotes'],
    api: {
      getOrchestrationTask: async () => ({
        success: true,
        task: { taskId: 'task_interrupted', title: 'Long build', status: 'failed', failure: { code: 'interrupted', message: 'restarted' } }
      })
    },
    set: {
      conversations: [
        { id: 'dispatch-1', mode: 'orion', launchedCoderConvId: 'coder-1', launchedCoderTaskId: 'task_interrupted', launchedCoderTaskTitle: 'Long build', messages: [] },
        { id: 'coder-1', mode: 'coder', title: 'Long build', messages: [] }
      ]
    }
  });
  expose.interruptedTaskLivenessNotes.set('task_interrupted', 'TEST-LIVENESS-NOTE');
  await win.notifySupervisorOfCoderCompletion('coder-1', 'task_interrupted');
  const reread = read('conversations').find(c => c.id === 'dispatch-1');
  const lastMsg = reread.messages[reread.messages.length - 1];
  t.ok(lastMsg && lastMsg.text.includes('TEST-LIVENESS-NOTE'), 'the liveness note reaches the actual notification text');
  t.notOk(expose.interruptedTaskLivenessNotes.has('task_interrupted'), 'the note is cleared after being consumed so it cannot be shown twice');
  t.end();
});

test('renderer wires restart-time lease reconciliation into the same startup path as task reconciliation', t => {
  t.ok(rendererJs.includes('await reconcileResourceLeasesAfterRestart(taskReconciliation)'),
    'initializeOrchestrationTasks calls the lease reconciliation right after the task-store reconciliation');
  t.ok(rendererJs.includes('const taskReconciliation = await window.api.reconcileOrchestrationTasks'),
    'the task-store reconciliation result is captured so its interrupted-task IDs can be extracted');
  t.end();
});
