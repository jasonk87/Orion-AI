'use strict';

const shared = require('./shared');

let displayWakeBlocker = null;
let displayWakeBlockerId = null;

function releaseDisplayWakeLease() {
  if (displayWakeBlocker && displayWakeBlockerId !== null) {
    try {
      if (typeof displayWakeBlocker.isStarted !== 'function' || displayWakeBlocker.isStarted(displayWakeBlockerId)) {
        displayWakeBlocker.stop(displayWakeBlockerId);
      }
    } catch (_) {}
  }
  displayWakeBlocker = null;
  displayWakeBlockerId = null;
}

function acquireDisplayWakeLease(electron) {
  releaseDisplayWakeLease();
  const blocker = electron && electron.powerSaveBlocker;
  if (!blocker || typeof blocker.start !== 'function') return null;
  const blockerId = blocker.start('prevent-display-sleep');
  displayWakeBlocker = blocker;
  displayWakeBlockerId = blockerId;
  return blockerId;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeControlSession(payload = {}) {
  const conversationId = String(payload.conversationId || '').trim();
  const taskId = String(payload.taskId || '').trim();
  const sessionId = String(payload.sessionId || taskId || conversationId).trim();
  if (!conversationId || !sessionId) {
    throw new Error('Computer control requires an owning conversation and session.');
  }
  const surface = String(payload.surface || '').toLowerCase() === 'browser' ? 'browser' : 'desktop';
  const role = String(payload.role || '').toLowerCase() === 'coder' ? 'coder' : 'operator';
  return {
    sessionId,
    taskId,
    conversationId,
    title: String(payload.title || '').trim().slice(0, 180) || 'Active task',
    surface,
    role,
    startedAt: Number(payload.startedAt) || Date.now()
  };
}

function buildControlIndicatorHtml(session) {
  const surfaceLabel = session.surface === 'browser' ? 'browser' : 'desktop';
  const roleLabel = session.role === 'coder' ? 'CODER' : 'OPERATOR';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
  body { display: flex; align-items: center; justify-content: center; font-family: "Segoe UI", sans-serif; color: #f7f5ff; }
  .control {
    width: calc(100% - 8px); min-height: 52px; display: grid;
    grid-template-columns: 12px minmax(0, 1fr); align-items: center; gap: 11px;
    padding: 9px 14px; border: 1px solid rgba(151, 121, 255, .72); border-radius: 15px;
    background: linear-gradient(135deg, rgba(18, 13, 36, .96), rgba(8, 18, 28, .96));
    box-shadow: 0 10px 38px rgba(0,0,0,.48), 0 0 22px rgba(126,92,255,.18);
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #64e6b4; box-shadow: 0 0 0 0 rgba(100,230,180,.55); animation: pulse 1.55s infinite; }
  .line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .label { color: #bdaeff; font-size: 10px; font-weight: 800; letter-spacing: .12em; white-space: nowrap; }
  .state { font-size: 12px; font-weight: 700; white-space: nowrap; }
  .title { min-width: 0; color: #9ca7bf; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(100,230,180,.55); } 70% { box-shadow: 0 0 0 8px rgba(100,230,180,0); } 100% { box-shadow: 0 0 0 0 rgba(100,230,180,0); } }
</style></head><body><div class="control"><span class="dot"></span><div>
  <div class="line"><span class="label">ORION ${roleLabel}</span><span class="state">Controlling ${escapeHtml(surfaceLabel)}</span></div>
  <div class="title">${escapeHtml(session.title)}</div>
</div></div></body></html>`;
}

function isControlSessionActive() {
  return !!(shared.operatorControlSession && shared.operatorControlSession.active);
}

function isUsableWindow(windowValue) {
  if (!windowValue) return false;
  return typeof windowValue.isDestroyed !== 'function' || !windowValue.isDestroyed();
}

function destroyIndicator() {
  const indicator = shared.operatorControlWindow;
  shared.operatorControlWindow = null;
  if (isUsableWindow(indicator)) {
    try { indicator.destroy(); } catch (_) {}
  }
}

async function beginControlSession(payload = {}, dependencies = {}) {
  const session = normalizeControlSession(payload);
  const current = shared.operatorControlSession;
  if (current && current.active && current.sessionId === session.sessionId) {
    return { success: true, alreadyActive: true, session: { ...current } };
  }

  const mainWindow = shared.mainWindow;
  const mainUsable = isUsableWindow(mainWindow);
  const wasMinimized = mainUsable && typeof mainWindow.isMinimized === 'function'
    ? !!mainWindow.isMinimized()
    : false;
  const wasVisible = mainUsable && typeof mainWindow.isVisible === 'function'
    ? !!mainWindow.isVisible()
    : true;

  // Superseding one control run with another keeps Orion minimized. A stale end receipt for the
  // older run cannot tear down the newer indicator because endControlSession checks sessionId.
  const inheritedWindowState = current && current.active
    ? { wasMinimized: !!current.wasMinimized, wasVisible: current.wasVisible !== false }
    : { wasMinimized, wasVisible };
  destroyIndicator();
  shared.operatorControlSession = null;
  if (mainUsable && typeof mainWindow.minimize === 'function' && !wasMinimized) mainWindow.minimize();

  const electron = dependencies.electron || require('electron');
  const BrowserWindow = dependencies.BrowserWindow || electron.BrowserWindow;
  const electronScreen = dependencies.screen || electron.screen;
  const display = electronScreen && typeof electronScreen.getDisplayMatching === 'function' && mainUsable && typeof mainWindow.getBounds === 'function'
    ? electronScreen.getDisplayMatching(mainWindow.getBounds())
    : electronScreen && typeof electronScreen.getPrimaryDisplay === 'function'
      ? electronScreen.getPrimaryDisplay()
      : { workArea: { x: 0, y: 0, width: 1280, height: 720 } };
  const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1280, height: 720 };
  const width = Math.min(390, Math.max(280, area.width - 36));
  const height = 68;
  const indicator = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 18,
    y: area.y + 18,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  shared.operatorControlWindow = indicator;
  try {
    // Screen observation and input are impossible once Windows powers down the interactive
    // display: desktopCapturer returns empty frames and GDI reports an invalid screen handle. Hold
    // it awake for exactly the task-scoped takeover rather than retrying APIs against a surface the
    // OS has stopped presenting.
    acquireDisplayWakeLease(electron);
    if (typeof indicator.setAlwaysOnTop === 'function') indicator.setAlwaysOnTop(true, 'screen-saver');
    if (typeof indicator.setVisibleOnAllWorkspaces === 'function') {
      indicator.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (typeof indicator.setIgnoreMouseEvents === 'function') indicator.setIgnoreMouseEvents(true);
    await indicator.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildControlIndicatorHtml(session))}`);
    shared.operatorControlSession = {
      ...session,
      active: true,
      wasMinimized: inheritedWindowState.wasMinimized,
      wasVisible: inheritedWindowState.wasVisible
    };
    if (shared.operatorControlWindow === indicator && isUsableWindow(indicator)) {
      if (typeof indicator.showInactive === 'function') indicator.showInactive();
      else if (typeof indicator.show === 'function') indicator.show();
    }
  } catch (error) {
    releaseDisplayWakeLease();
    shared.operatorControlSession = null;
    destroyIndicator();
    if (mainUsable && !inheritedWindowState.wasMinimized) {
      if (typeof mainWindow.restore === 'function') mainWindow.restore();
      if (inheritedWindowState.wasVisible) {
        if (typeof mainWindow.showInactive === 'function') mainWindow.showInactive();
        else if (typeof mainWindow.show === 'function') mainWindow.show();
      }
    }
    throw error;
  }
  return { success: true, session: { ...shared.operatorControlSession } };
}

async function endControlSession(payload = {}) {
  const current = shared.operatorControlSession;
  if (!current || !current.active) return { success: true, ended: false, reason: 'not_active' };
  const requestedSessionId = String(payload.sessionId || payload.taskId || payload.conversationId || '').trim();
  if (!requestedSessionId || requestedSessionId !== current.sessionId) {
    return { success: false, ended: false, reason: 'stale_session', activeSessionId: current.sessionId };
  }
  shared.operatorControlSession = null;
  destroyIndicator();
  releaseDisplayWakeLease();

  const mainWindow = shared.mainWindow;
  const mainUsable = isUsableWindow(mainWindow);
  if (mainUsable && !current.wasMinimized) {
    if (typeof mainWindow.restore === 'function') mainWindow.restore();
    if (current.wasVisible !== false) {
      if (typeof mainWindow.showInactive === 'function') mainWindow.showInactive();
      else if (typeof mainWindow.show === 'function') mainWindow.show();
    }
  }
  return { success: true, ended: true, sessionId: current.sessionId };
}

function registerHandlers(ipcMain, dependencies = {}) {
  ipcMain.handle('orion:operator-control-begin', (event, payload) => beginControlSession(payload, dependencies));
  ipcMain.handle('orion:operator-control-end', (event, payload) => endControlSession(payload));
}

module.exports = {
  normalizeControlSession,
  buildControlIndicatorHtml,
  isControlSessionActive,
  beginControlSession,
  endControlSession,
  acquireDisplayWakeLease,
  releaseDisplayWakeLease,
  registerHandlers
};
