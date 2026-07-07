'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
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
let lastConversationWriteRevision = 0;

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
  ipcServer.registerHandlers(ipcMain);
  ipcUi.registerHandlers(ipcMain);
  symbolIndex.registerHandlers(ipcMain);
  ipcSkill.registerHandlers(ipcMain);
  ipcMemory.registerHandlers(ipcMain);

  const { runLinter } = require('./lib/run-linter');
  const { findReferences } = require('./lib/find-references');

  ipcMain.handle('orion:run-linter', async (event, args) => {
    return await runLinter(args.workspacePath, args.linterType, args.targetPath);
  });
  
  ipcMain.handle('orion:find-references', async (event, args) => {
    return await findReferences(args.workspacePath, args.symbolName, args.targetPath);
  });

  const getConversationsPath = () => path.join(app.getPath('userData'), 'conversations.json');
  ipcMain.handle('read-conversations', () => {
    const filePath = getConversationsPath();
    try {
      if (!fs.existsSync(filePath)) {
        return { success: true, conversations: [], path: filePath, missing: true };
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
      return { success: true, conversations: Array.isArray(parsed) ? parsed : [], path: filePath };
    } catch (error) {
      return { success: false, conversations: [], path: filePath, error: error.message };
    }
  });
  ipcMain.handle('write-conversations', (event, payload) => {
    const filePath = getConversationsPath();
    try {
      const conversations = Array.isArray(payload)
        ? payload
        : (payload && Array.isArray(payload.conversations) ? payload.conversations : null);
      const revision = payload && Number(payload.revision || 0);
      if (!Array.isArray(conversations)) throw new Error('Conversation payload must be an array');
      if (revision && revision < lastConversationWriteRevision) {
        return { success: true, path: filePath, count: conversations.length, stale: true };
      }
      atomicWriteFileSync(filePath, `${JSON.stringify(conversations, null, 2)}\n`, 'utf8');
      if (revision) lastConversationWriteRevision = revision;
      return { success: true, path: filePath, count: conversations.length };
    } catch (error) {
      return { success: false, path: filePath, error: error.message };
    }
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

const isTestRuntime = process.env.NODE_ENV === 'test';
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
    if (!isTestRuntime) ipcServer.startPhoneCompanionServer();

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
    // safety / shared
    resolveWorkspacePath,
    classifyCommandRequest,
    isDestructiveCommand,
    activeProcesses: shared.activeProcesses,
    commandSessions: shared.commandSessions,
    ensureCompanionToken: ipcServer.ensureCompanionToken
  };
}
