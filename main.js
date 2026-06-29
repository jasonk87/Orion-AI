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
  ipcWorkspace.registerHandlers(ipcMain);
  ipcServer.registerHandlers(ipcMain);
  ipcUi.registerHandlers(ipcMain);
  symbolIndex.registerHandlers(ipcMain);
  projectMemory.registerHandlers(ipcMain);
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
  const ipcFileToolsMod = require('./lib/ipc-file-tools');
  const ipcShellMod = require('./lib/ipc-shell');
  const ipcWorkspaceMod = require('./lib/ipc-workspace');
  const ipcServerMod = require('./lib/ipc-server');
  const ipcUiMod = require('./lib/ipc-ui');
  const { resolveWorkspacePath, classifyCommandRequest, isDestructiveCommand } = require('./safety');
  const { readAppConfig } = require('./lib/config');

  module.exports = {
    // ipc-shell
    escapePowerShellSingle: ipcShellMod.escapePowerShellSingle || ipcWorkspaceMod.escapePowerShellSingle,
    startCommandSession: ipcShellMod.startCommandSession,
    killProcessTree: ipcShellMod.killProcessTree,
    commandLooksPowerShellSpecific: ipcShellMod.commandLooksPowerShellSpecific,
    getCommandShellSpec: ipcShellMod.getCommandShellSpec,
    previewWorkspaceApp: ipcShellMod.previewWorkspaceApp,
    // ipc-file-tools
    writeRunArtifact: ipcFileToolsMod.writeRunArtifact,
    listRunArtifacts: ipcFileToolsMod.listRunArtifacts,
    deleteWorkspacePath: ipcFileToolsMod.deleteWorkspacePath,
    moveWorkspacePath: ipcFileToolsMod.moveWorkspacePath,
    copyWorkspacePath: ipcFileToolsMod.copyWorkspacePath,
    downloadFileToWorkspace: ipcFileToolsMod.downloadFileToWorkspace,
    inspectArchiveInWorkspace: ipcFileToolsMod.inspectArchiveInWorkspace,
    extractArchiveInWorkspace: ipcFileToolsMod.extractArchiveInWorkspace,
    inspectBinaryAssetInWorkspace: ipcFileToolsMod.inspectBinaryAssetInWorkspace,
    listAssetMetadataInWorkspace: ipcFileToolsMod.listAssetMetadataInWorkspace,
    readWorkspaceFileBase64: ipcFileToolsMod.readWorkspaceFileBase64,
    compareScreenshotToGoalInWorkspace: ipcFileToolsMod.compareScreenshotToGoalInWorkspace,
    applyPatch: ipcFileToolsMod.applyPatch,
    buildPatchProof: ipcFileToolsMod.buildPatchProof,
    // ipc-server
    startPhoneCompanionServer: ipcServerMod.startPhoneCompanionServer,
    stopPhoneCompanionServer: ipcServerMod.stopPhoneCompanionServer,
    enablePhoneCompanionLanMode: ipcServerMod.enablePhoneCompanionLanMode,
    buildCompanionPairingAnnouncement: ipcServerMod.buildCompanionPairingAnnouncement,
    getPhoneCompanionPairingForTest: ipcServerMod.getPhoneCompanionPairingPayload,
    getCompanionServer: () => shared.companionServer,
    resetCompanionServer: () => {
      if (shared.companionServer) {
        try { shared.companionServer.close(); } catch (e) {}
      }
      shared.companionServer = null;
    },
    // ipc-workspace
    chunkText: ipcWorkspaceMod.chunkText,
    cosineSimilarity: ipcWorkspaceMod.cosineSimilarity,
    getGeminiEmbedding: ipcWorkspaceMod.getGeminiEmbedding,
    spawnInternalCommand: ipcWorkspaceMod.spawnInternalCommand,
    // ipc-ui
    computeSourceUpdates: ipcUiMod.computeSourceUpdates,
    getAppRuntimeInfo: ipcUiMod.getAppRuntimeInfo,
    buildUpdateSplashHtml: ipcUiMod.buildUpdateSplashHtml,
    syncSourceUpdateFiles: ipcUiMod.syncSourceUpdateFiles,
    isLikelySourceDir: ipcUiMod.isLikelySourceDir,
    // safety / shared
    resolveWorkspacePath,
    classifyCommandRequest,
    isDestructiveCommand,
    activeProcesses: shared.activeProcesses,
    commandSessions: shared.commandSessions,
    ensureCompanionToken: ipcServerMod.ensureCompanionToken
  };
}
