'use strict';

const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const shared = require('./lib/shared');

// ── Lib modules ────────────────────────────────────────────────────────────────
const ipcFileTools = require('./lib/ipc-file-tools');
const ipcShell = require('./lib/ipc-shell');
const ipcWorkspace = require('./lib/ipc-workspace');
const ipcServer = require('./lib/ipc-server');
const ipcUi = require('./lib/ipc-ui');
const symbolIndex = require('./lib/symbol-index');
const ipcSkill = require('./lib/ipc-skill');
const ipcMemory = require('./lib/ipc-memory');
const ipcDatabase = require('./lib/ipc-database');
const ipcOrchestration = require('./lib/ipc-orchestration');
const conversationMemory = require('./lib/conversation-memory');
const MAX_PERSISTED_TOOL_PAYLOAD_CHARS = 250000;

function trimPersistedToolPayload(value) {
  let serialized;
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_) {
    return { value, changed: false };
  }
  if (serialized.length <= MAX_PERSISTED_TOOL_PAYLOAD_CHARS) return { value, changed: false };
  const receipt = {
    trimmed: true,
    persistedPayloadTrimmed: true,
    originalLength: serialized.length,
    note: 'Oversized generated tool output was omitted from persisted conversation history. Re-run the tool with a narrower query or range if exact data is needed.'
  };
  return {
    value: typeof value === 'string' ? JSON.stringify(receipt) : receipt,
    changed: true
  };
}

function sanitizeConversationForPersistence(conversation) {
  if (!conversation || !Array.isArray(conversation.messages)) {
    return { conversation, changed: false, trimmedPayloads: 0 };
  }
  let changed = false;
  let trimmedPayloads = 0;
  const messages = conversation.messages.map(message => {
    if (!message || typeof message !== 'object') return message;
    let nextMessage = message;
    if (Array.isArray(message.logs)) {
      const logs = message.logs.map(log => {
        if (!log || !Object.prototype.hasOwnProperty.call(log, 'result')) return log;
        const trimmed = trimPersistedToolPayload(log.result);
        if (!trimmed.changed) return log;
        changed = true;
        trimmedPayloads += 1;
        return { ...log, result: trimmed.value };
      });
      if (logs.some((log, index) => log !== message.logs[index])) nextMessage = { ...nextMessage, logs };
    }
    if (Array.isArray(message.turns)) {
      const turns = message.turns.map(turn => {
        if (!turn || !Array.isArray(turn.toolResponseParts)) return turn;
        const toolResponseParts = turn.toolResponseParts.map(part => {
          const functionResponse = part && part.functionResponse;
          if (!functionResponse || !Object.prototype.hasOwnProperty.call(functionResponse, 'response')) return part;
          const trimmed = trimPersistedToolPayload(functionResponse.response);
          if (!trimmed.changed) return part;
          changed = true;
          trimmedPayloads += 1;
          return { ...part, functionResponse: { ...functionResponse, response: trimmed.value } };
        });
        return toolResponseParts.some((part, index) => part !== turn.toolResponseParts[index])
          ? { ...turn, toolResponseParts }
          : turn;
      });
      if (turns.some((turn, index) => turn !== message.turns[index])) nextMessage = { ...nextMessage, turns };
    }
    return nextMessage;
  });
  return {
    conversation: changed ? { ...conversation, messages } : conversation,
    changed,
    trimmedPayloads
  };
}

// ── Crash safety ───────────────────────────────────────────────────────────────
// Orion runs multi-minute agent loops that hold live run state in the renderer.
// Before this, one unhandled rejection in main ended the whole process (Node's
// default since v15) and a renderer crash left a dead window — both lost the run
// with no record of why. Nothing here is fatal: faults are appended to a crash log,
// surfaced to the user, and the renderer is reloaded instead of abandoned.

const MAX_RENDERER_RELOADS = 3;
const RENDERER_RELOAD_WINDOW_MS = 60000;
const rendererReloadTimestamps = [];

// Shared with the lib modules so every swallowed fault, main-process crash, and renderer
// fault lands in ONE file (userData/logs/crash.log) instead of three places to check.
const { recordSwallowedFault, describe: describeFault } = require('./lib/fault-log');

function appendCrashLog(scope, detail) {
  return recordSwallowedFault(scope, detail);
}

function notifyFault(title, body) {
  try {
    if (Notification && typeof Notification.isSupported === 'function' && Notification.isSupported()) {
      new Notification({ title, body: String(body).split('\n')[0].slice(0, 240) }).show();
    }
  } catch (_) { /* notifications are best-effort; never let one mask the fault */ }
}

function reportFault(scope, value, options = {}) {
  const detail = describeFault(value);
  appendCrashLog(scope, detail); // also writes the console line
  if (options.notify !== false) notifyFault(options.title || 'Orion hit an internal error', detail);
  // Tell the renderer so the fault lands in the conversation instead of looking like a hang.
  try {
    if (shared.mainWindow && !shared.mainWindow.isDestroyed()) {
      shared.mainWindow.webContents.send('orion:main-fault', { scope, detail });
    }
  } catch (_) { /* the renderer may be the thing that just died */ }
  return detail;
}

// Pure so the reload-loop guard is unit testable without crashing a real renderer.
function shouldReloadCrashedRenderer(timestamps, now = Date.now()) {
  const recent = timestamps.filter(at => now - at < RENDERER_RELOAD_WINDOW_MS);
  timestamps.length = 0;
  timestamps.push(...recent, now);
  return timestamps.length <= MAX_RENDERER_RELOADS;
}

function installProcessCrashHandlers() {
  process.on('unhandledRejection', reason => {
    reportFault('unhandledRejection', reason, { title: 'Orion recovered from an internal error' });
  });
  process.on('uncaughtException', error => {
    // Staying alive with a visible, logged error beats vanishing mid-run.
    reportFault('uncaughtException', error, { title: 'Orion recovered from an internal error' });
  });
}

function installRendererCrashRecovery() {
  app.on('render-process-gone', (event, webContents, details) => {
    const detail = `renderer gone (reason=${details && details.reason}, exitCode=${details && details.exitCode})`;
    reportFault('render-process-gone', detail, { notify: false });
    if (!shouldReloadCrashedRenderer(rendererReloadTimestamps)) {
      notifyFault('Orion could not recover', 'The window crashed repeatedly. Restart Orion; conversations are saved on disk.');
      return;
    }
    notifyFault('Orion window crashed — reloading', 'Your conversations are saved. Reopening the last state now.');
    try {
      if (shared.mainWindow && !shared.mainWindow.isDestroyed()) shared.mainWindow.reload();
      else createWindow();
    } catch (error) {
      reportFault('render-process-recovery', error);
    }
  });

  app.on('child-process-gone', (event, details) => {
    reportFault('child-process-gone', `${details && details.type} gone (reason=${details && details.reason})`, { notify: false });
  });
}

// ── Window creation ────────────────────────────────────────────────────────────

function createWindow() {
  shared.mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    frame: false,
    backgroundColor: '#0c0c0e',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  shared.mainWindow.loadFile('index.html');

  shared.mainWindow.on('closed', () => {
    shared.mainWindow = null;
    app.quit();
  });
}

// ── Register all IPC handlers ──────────────────────────────────────────────────

function registerAllHandlers() {
  const { getWorkspaceEntrypoint } = ipcWorkspace;
  const { readAppConfig, atomicWriteFileSync } = require('./lib/config');
  const { startStaticWorkspaceServer } = ipcServer;

  ipcFileTools.registerHandlers(ipcMain);
  ipcShell.registerHandlers(ipcMain, { getWorkspaceEntrypoint, readAppConfig, startStaticWorkspaceServer });
  ipcWorkspace.registerHandlers(ipcMain, { startStaticWorkspaceServer });
  ipcServer.registerHandlers(ipcMain, { Notification });
  ipcUi.registerHandlers(ipcMain);
  symbolIndex.registerHandlers(ipcMain);
  ipcSkill.registerHandlers(ipcMain);
  ipcMemory.registerHandlers(ipcMain);
  ipcDatabase.registerHandlers(ipcMain);
  ipcOrchestration.registerHandlers(ipcMain, {
    filePath: () => path.join(app.getPath('userData'), 'orchestration-tasks.json')
  });
  require('./lib/file-knowledge').registerHandlers(ipcMain);

  const { runLinter } = require('./lib/run-linter');
  const { requestWorkspaceIndex } = require('./lib/workspace-index-client');

  // The renderer's global error traps report here so browser-side faults land in the
  // same crash log as main-process ones. Renderer-only failures are the class Node
  // tests cannot see, so an on-disk record is the only post-hoc evidence available.
  ipcMain.on('orion:report-renderer-fault', (event, payload = {}) => {
    const scope = `renderer:${String(payload.kind || 'error').slice(0, 40)}`;
    appendCrashLog(scope, String(payload.detail || '').slice(0, 8000));
  });

  ipcMain.handle('orion:run-linter', async (event, args) => {
    return await runLinter(args.workspacePath, args.linterType, args.targetPath);
  });
  
  ipcMain.handle('orion:find-references', async (event, args) => {
    return await requestWorkspaceIndex('findReferences', {
      workspacePath: args.workspacePath,
      symbolName: args.symbolName,
      targetPath: args.targetPath
    });
  });

  const getConversationsDir = () => {
    const dir = path.join(app.getPath('userData'), 'conversations');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const getConversationsIndexPath = () => path.join(app.getPath('userData'), 'conversations-index.json');
  const getLegacyConversationsPath = () => path.join(app.getPath('userData'), 'conversations.json');

  ipcMain.handle('orion:search-conversation-evidence', (event, payload = {}) => {
    try {
      const result = conversationMemory.searchPersistedConversationEvidence({
        query: String(payload.query || '').slice(0, 10000),
        recentContext: Array.isArray(payload.recentContext) ? payload.recentContext.slice(-12) : [],
        currentConversation: payload.currentConversation && typeof payload.currentConversation === 'object'
          ? payload.currentConversation : null,
        excludeConversationId: String(payload.excludeConversationId || ''),
        excludeMessageIds: Array.isArray(payload.excludeMessageIds) ? payload.excludeMessageIds.slice(0, 20) : [],
        excludeUserPrompt: String(payload.excludeUserPrompt || '').slice(0, 10000),
        workspacePaths: Array.isArray(payload.workspacePaths) ? payload.workspacePaths.slice(0, 50) : [],
        conversationsDir: getConversationsDir(),
        limit: Math.max(1, Math.min(Number(payload.limit) || 8, 20))
      });
      return { success: true, ...result };
    } catch (error) {
      return { success: false, evidence: [], results: [], queryTerms: [], error: error.message };
    }
  });

  function migrateLegacyConversations() {
    const legacyPath = getLegacyConversationsPath();
    const indexPath = getConversationsIndexPath();
    if (fs.existsSync(legacyPath) && !fs.existsSync(indexPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8').replace(/^\uFEFF/, ''));
        if (Array.isArray(parsed)) {
          const dir = getConversationsDir();
          const index = [];
          for (const conv of parsed) {
            atomicWriteFileSync(path.join(dir, `conv-${conv.id}.json`), `${JSON.stringify(conv, null, 2)}\n`, 'utf8');
            const stub = { ...conv };
            delete stub.messages;
            delete stub.tasks;
            delete stub.testResults;
            delete stub.fileTree;
            delete stub.scratchpad;
            stub.hasMessages = Array.isArray(conv.messages) && conv.messages.length > 0;
            index.push(stub);
          }
          atomicWriteFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
          fs.renameSync(legacyPath, legacyPath + '.bak');
        }
      } catch (err) {
        console.error("Migration failed:", err);
      }
    }
  }

  ipcMain.handle('read-conversations-index', () => {
    migrateLegacyConversations();
    const filePath = getConversationsIndexPath();
    try {
      if (!fs.existsSync(filePath)) return { success: true, index: [], path: filePath, missing: true };
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
      return { success: true, index: Array.isArray(parsed) ? parsed : [], path: filePath };
    } catch (error) {
      return { success: false, index: [], path: filePath, error: error.message };
    }
  });

  ipcMain.handle('write-conversations-index', (event, payload) => {
    const filePath = getConversationsIndexPath();
    try {
      const index = Array.isArray(payload) ? payload : (payload && payload.index ? payload.index : []);
      atomicWriteFileSync(filePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('read-conversation', (event, id) => {
    const filePath = path.join(getConversationsDir(), `conv-${id}.json`);
    try {
      if (!fs.existsSync(filePath)) return { success: false, missing: true };
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
      const sanitized = sanitizeConversationForPersistence(parsed);
      if (sanitized.changed) {
        atomicWriteFileSync(filePath, `${JSON.stringify(sanitized.conversation, null, 2)}\n`, 'utf8');
      }
      return { success: true, conversation: sanitized.conversation, trimmedPayloads: sanitized.trimmedPayloads };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-conversation', (event, conv) => {
    if (!conv || !conv.id) return { success: false, error: "Missing conv.id" };
    const filePath = path.join(getConversationsDir(), `conv-${conv.id}.json`);
    try {
      const sanitized = sanitizeConversationForPersistence(conv);
      atomicWriteFileSync(filePath, `${JSON.stringify(sanitized.conversation, null, 2)}\n`, 'utf8');
      return { success: true, trimmedPayloads: sanitized.trimmedPayloads };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-conversation', (event, id) => {
    const filePath = path.join(getConversationsDir(), `conv-${id}.json`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

const isTestRuntime = process.env.NODE_ENV === 'test';
// Registered outside the test runtime only: the suite installs and asserts on its own
// uncaughtException listeners, and a permanent handler would swallow real test failures.
if (!isTestRuntime) installProcessCrashHandlers();
if (!isTestRuntime && process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('orion-ai');
}
const gotTheLock = !isTestRuntime && typeof app.requestSingleInstanceLock === 'function' ? app.requestSingleInstanceLock() : true;
if (!isTestRuntime && !gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (shared.mainWindow) {
      if (shared.mainWindow.isMinimized()) shared.mainWindow.restore();
      shared.mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (!isTestRuntime && await ipcUi.checkForSourceUpdatesAndRelaunch()) return;

    registerAllHandlers();
    installRendererCrashRecovery();
    createWindow();
    if (!isTestRuntime) {
      try {
        await ipcServer.startPhoneCompanionServer();
      } catch (error) {
        console.error('Phone companion startup failed:', error);
        if (Notification && Notification.isSupported && Notification.isSupported()) {
          new Notification({ title: 'Orion phone companion unavailable', body: error.message }).show();
        }
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (shared.companionServer) {
    shared.companionServer.close();
    shared.companionServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

// ── Test exports ───────────────────────────────────────────────────────────────

if (process.env.NODE_ENV === 'test') {
  const { resolveWorkspacePath, classifyCommandRequest, isDestructiveCommand } = require('./safety');
  const { readAppConfig } = require('./lib/config');

  module.exports = {
    // ipc-shell
    escapePowerShellSingle: ipcShell.escapePowerShellSingle || ipcWorkspace.escapePowerShellSingle,
    startCommandSession: ipcShell.startCommandSession,
    killProcessTree: ipcShell.killProcessTree,
    commandBelongsToConversation: ipcShell.commandBelongsToConversation,
    normalizeConversationIdForCommandSession: ipcShell.normalizeConversationIdForCommandSession,
    commandLooksPowerShellSpecific: ipcShell.commandLooksPowerShellSpecific,
    hasUnquotedSemicolon: ipcShell.hasUnquotedSemicolon,
    pickBestClickCandidate: ipcShell.pickBestClickCandidate,
    getCommandShellSpec: ipcShell.getCommandShellSpec,
    previewWorkspaceApp: ipcShell.previewWorkspaceApp,
    // ipc-file-tools
    writeRunArtifact: ipcFileTools.writeRunArtifact,
    listRunArtifacts: ipcFileTools.listRunArtifacts,
    deleteWorkspacePath: ipcFileTools.deleteWorkspacePath,
    moveWorkspacePath: ipcFileTools.moveWorkspacePath,
    copyWorkspacePath: ipcFileTools.copyWorkspacePath,
    downloadFileToWorkspace: ipcFileTools.downloadFileToWorkspace,
    inspectArchiveInWorkspace: ipcFileTools.inspectArchiveInWorkspace,
    extractArchiveInWorkspace: ipcFileTools.extractArchiveInWorkspace,
    inspectBinaryAssetInWorkspace: ipcFileTools.inspectBinaryAssetInWorkspace,
    listAssetMetadataInWorkspace: ipcFileTools.listAssetMetadataInWorkspace,
    readWorkspaceFileBase64: ipcFileTools.readWorkspaceFileBase64,
    compareScreenshotToGoalInWorkspace: ipcFileTools.compareScreenshotToGoalInWorkspace,
    applyPatch: ipcFileTools.applyPatch,
    buildPatchProof: ipcFileTools.buildPatchProof,
    // ipc-server
    startPhoneCompanionServer: ipcServer.startPhoneCompanionServer,
    stopPhoneCompanionServer: ipcServer.stopPhoneCompanionServer,
    enablePhoneCompanionLanMode: ipcServer.enablePhoneCompanionLanMode,
    buildCompanionPairingAnnouncement: ipcServer.buildCompanionPairingAnnouncement,
    getPhoneCompanionPairingForTest: ipcServer.getPhoneCompanionPairingPayload,
    getCompanionServer: () => shared.companionServer,
    resetCompanionServer: () => {
      if (shared.companionServer) {
        try { shared.companionServer.close(); } catch (e) {}
      }
      shared.companionServer = null;
    },
    // ipc-workspace
    chunkText: ipcWorkspace.chunkText,
    cosineSimilarity: ipcWorkspace.cosineSimilarity,
    getGeminiEmbedding: ipcWorkspace.getGeminiEmbedding,
    spawnInternalCommand: ipcWorkspace.spawnInternalCommand,
    workspaceKey: ipcWorkspace.workspaceKey,
    launchCommandInWorkspace: ipcWorkspace.launchCommandInWorkspace,
    trackWorkspaceProcess: ipcWorkspace.trackWorkspaceProcess,
    killTrackedWorkspaceProcess: ipcWorkspace.killTrackedWorkspaceProcess,
    findChildProcessId: ipcWorkspace.findChildProcessId,
    launchedWorkspaceProcesses: ipcWorkspace.launchedWorkspaceProcesses,
    // ipc-ui
    computeSourceUpdates: ipcUi.computeSourceUpdates,
    getAppRuntimeInfo: ipcUi.getAppRuntimeInfo,
    buildUpdateSplashHtml: ipcUi.buildUpdateSplashHtml,
    syncSourceUpdateFiles: ipcUi.syncSourceUpdateFiles,
    isLikelySourceDir: ipcUi.isLikelySourceDir,
    resolveUpdateSourceDir: ipcUi.resolveUpdateSourceDir,
    checkLocalSourceUpdates: ipcUi.checkLocalSourceUpdates,
    applyLocalSourceUpdateAndRestart: ipcUi.applyLocalSourceUpdateAndRestart,
    AUTO_UPDATE_FILES: ipcUi.AUTO_UPDATE_FILES,
    sanitizeConversationForPersistence,
    // crash safety
    describeFault,
    shouldReloadCrashedRenderer,
    installProcessCrashHandlers,
    installRendererCrashRecovery,
    MAX_RENDERER_RELOADS,
    RENDERER_RELOAD_WINDOW_MS,
    // safety / shared
    resolveWorkspacePath,
    classifyCommandRequest,
    isDestructiveCommand,
    activeProcesses: shared.activeProcesses,
    commandSessions: shared.commandSessions,
    ensureCompanionToken: ipcServer.ensureCompanionToken
  };
}
