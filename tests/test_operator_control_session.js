'use strict';

const test = require('tape');
const shared = require('../lib/shared');
const control = require('../lib/operator-control-session');

class FakeIndicatorWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.calls = [];
    FakeIndicatorWindow.instances.push(this);
  }
  setAlwaysOnTop(...args) { this.calls.push(['alwaysOnTop', ...args]); }
  setVisibleOnAllWorkspaces(...args) { this.calls.push(['allWorkspaces', ...args]); }
  setIgnoreMouseEvents(...args) { this.calls.push(['ignoreMouse', ...args]); }
  async loadURL(url) { this.url = url; this.calls.push(['loadURL']); }
  showInactive() { this.calls.push(['showInactive']); }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.calls.push(['destroy']); }
}
FakeIndicatorWindow.instances = [];

function createMainWindow({ minimized = false } = {}) {
  let isMinimized = minimized;
  const calls = [];
  return {
    calls,
    isDestroyed: () => false,
    isMinimized: () => isMinimized,
    isVisible: () => true,
    getBounds: () => ({ x: 100, y: 80, width: 900, height: 700 }),
    minimize: () => { isMinimized = true; calls.push('minimize'); },
    restore: () => { isMinimized = false; calls.push('restore'); },
    showInactive: () => calls.push('showInactive')
  };
}

const dependencies = {
  BrowserWindow: FakeIndicatorWindow,
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  },
  electron: {}
};

function resetShared(previous) {
  shared.mainWindow = previous.mainWindow;
  shared.operatorControlSession = previous.operatorControlSession;
  shared.operatorControlWindow = previous.operatorControlWindow;
  FakeIndicatorWindow.instances.length = 0;
}

test('computer/browser control minimizes Orion and shows a passive monitor indicator for the exact task', async t => {
  const previous = {
    mainWindow: shared.mainWindow,
    operatorControlSession: shared.operatorControlSession,
    operatorControlWindow: shared.operatorControlWindow
  };
  shared.operatorControlSession = null;
  shared.operatorControlWindow = null;
  const mainWindow = createMainWindow();
  shared.mainWindow = mainWindow;

  try {
    const begun = await control.beginControlSession({
      taskId: 'task_operator_1',
      conversationId: 'conv_operator_1',
      title: '<Playtest This is Life>',
      role: 'operator',
      surface: 'desktop'
    }, dependencies);
    const indicator = FakeIndicatorWindow.instances[0];
    const html = decodeURIComponent(indicator.url.split(',')[1]);

    t.ok(begun.success, 'the task-scoped control session starts');
    t.deepEqual(mainWindow.calls, ['minimize'], 'Orion minimizes once at takeover start');
    t.equal(indicator.options.focusable, false, 'the indicator cannot steal keyboard focus');
    t.ok(indicator.calls.some(call => call[0] === 'ignoreMouse' && call[1] === true), 'the indicator is click-through');
    t.ok(indicator.calls.some(call => call[0] === 'showInactive'), 'the indicator is shown without activation');
    t.ok(html.includes('ORION OPERATOR'), 'the monitor identifies the controlling specialist');
    t.ok(html.includes('Controlling desktop'), 'the monitor identifies the controlled surface');
    t.ok(html.includes('&lt;Playtest This is Life&gt;'), 'task text is escaped before entering indicator HTML');

    const staleEnd = await control.endControlSession({ taskId: 'task_old' });
    t.equal(staleEnd.reason, 'stale_session', 'an old task cannot dismiss the current takeover indicator');
    t.notOk(indicator.destroyed, 'the live indicator survives a stale completion');
    t.deepEqual(mainWindow.calls, ['minimize'], 'a stale completion cannot restore Orion');

    const ended = await control.endControlSession({ taskId: 'task_operator_1' });
    t.ok(ended.ended, 'the owning task ends its control session');
    t.ok(indicator.destroyed, 'its indicator is removed');
    t.deepEqual(mainWindow.calls, ['minimize', 'restore', 'showInactive'], 'Orion restores only after the owning task ends and does not take focus');
  } finally {
    resetShared(previous);
  }
  t.end();
});

test('ending control preserves a window the user already had minimized', async t => {
  const previous = {
    mainWindow: shared.mainWindow,
    operatorControlSession: shared.operatorControlSession,
    operatorControlWindow: shared.operatorControlWindow
  };
  shared.operatorControlSession = null;
  shared.operatorControlWindow = null;
  const mainWindow = createMainWindow({ minimized: true });
  shared.mainWindow = mainWindow;
  try {
    await control.beginControlSession({
      conversationId: 'conv_direct_operator',
      title: 'Direct Operator task',
      surface: 'browser'
    }, dependencies);
    await control.endControlSession({ conversationId: 'conv_direct_operator' });
    t.deepEqual(mainWindow.calls, [], 'task cleanup does not unminimize a window that was already minimized');
  } finally {
    resetShared(previous);
  }
  t.end();
});

test('indicator startup failure cannot strand Orion minimized', async t => {
  const previous = {
    mainWindow: shared.mainWindow,
    operatorControlSession: shared.operatorControlSession,
    operatorControlWindow: shared.operatorControlWindow
  };
  shared.operatorControlSession = null;
  shared.operatorControlWindow = null;
  const mainWindow = createMainWindow();
  shared.mainWindow = mainWindow;
  class BrokenIndicatorWindow extends FakeIndicatorWindow {
    async loadURL() { throw new Error('overlay load failed'); }
  }
  try {
    let error = null;
    try {
      await control.beginControlSession({
        conversationId: 'conv_broken_overlay',
        title: 'Broken overlay test',
        surface: 'desktop'
      }, { ...dependencies, BrowserWindow: BrokenIndicatorWindow });
    } catch (caught) {
      error = caught;
    }
    t.match(String(error && error.message || ''), /overlay load failed/, 'the real indicator failure is reported');
    t.notOk(shared.operatorControlSession, 'no phantom active session remains');
    t.deepEqual(mainWindow.calls, ['minimize', 'restore', 'showInactive'], 'the failed startup rolls the window state back without taking focus');
  } finally {
    resetShared(previous);
  }
  t.end();
});
