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
let lastConversationWriteRevision = 0;
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
  const { findReferences } = require('./lib/find-references');

  ipcMain.handle('orion:run-linter', async (event, args) => {
    return await runLinter(args.workspacePath, args.linterType, args.targetPath);
  });
  
  ipcMain.handle('orion:find-references', async (event, args) => {
    return await findReferences(args.workspacePath, args.symbolName, args.targetPath);
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
    // safety / shared
    resolveWorkspacePath,
    classifyCommandRequest,
    isDestructiveCommand,
    activeProcesses: shared.activeProcesses,
    commandSessions: shared.commandSessions,
    ensureCompanionToken: ipcServer.ensureCompanionToken
  };
}
