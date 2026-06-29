'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const shared = require('./lib/shared');

// ── Lib modules ────────────────────────────────────────────────────────────────
const ipcFileTools = require('./lib/ipc-file-tools');
const ipcShell = require('./lib/ipc-shell');
const ipcWorkspace = require('./lib/ipc-workspace');
const ipcServer = require('./lib/ipc-server');
const ipcUi = require('./lib/ipc-ui');
const symbolIndex = require('./lib/symbol-index');
const projectMemory = require('./lib/project-memory');
const ipcSkill = require('./lib/ipc-skill');

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
  const { readAppConfig } = require('./lib/config');
  const { startStaticWorkspaceServer } = ipcServer;

  ipcFileTools.registerHandlers(ipcMain);
  ipcShell.registerHandlers(ipcMain, { getWorkspaceEntrypoint, readAppConfig, startStaticWorkspaceServer });
  ipcWorkspace.registerHandlers(ipcMain, { startStaticWorkspaceServer });
  ipcServer.registerHandlers(ipcMain);
  ipcUi.registerHandlers(ipcMain);
  symbolIndex.registerHandlers(ipcMain);
  projectMemory.registerHandlers(ipcMain);
  ipcSkill.registerHandlers(ipcMain);
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

const gotTheLock = typeof app.requestSingleInstanceLock === 'function' ? app.requestSingleInstanceLock() : true;
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (shared.mainWindow) {
      if (shared.mainWindow.isMinimized()) shared.mainWindow.restore();
      shared.mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (await ipcUi.checkForSourceUpdatesAndRelaunch()) return;

    registerAllHandlers();
    createWindow();
    ipcServer.startPhoneCompanionServer();

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
    commandLooksPowerShellSpecific: ipcShell.commandLooksPowerShellSpecific,
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
    // ipc-ui
    computeSourceUpdates: ipcUi.computeSourceUpdates,
    getAppRuntimeInfo: ipcUi.getAppRuntimeInfo,
    buildUpdateSplashHtml: ipcUi.buildUpdateSplashHtml,
    syncSourceUpdateFiles: ipcUi.syncSourceUpdateFiles,
    isLikelySourceDir: ipcUi.isLikelySourceDir,
    // safety / shared
    resolveWorkspacePath,
    classifyCommandRequest,
    isDestructiveCommand,
    activeProcesses: shared.activeProcesses,
    commandSessions: shared.commandSessions,
    ensureCompanionToken: ipcServer.ensureCompanionToken
  };
}
