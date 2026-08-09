'use strict';

const path = require('path');
const { getWorkspaceIndexService } = require('./workspace-index-service');
const { enqueueFileWrite } = require('./atomic-json-store');
const { requestWorkspaceIndex } = require('./workspace-index-client');
const { isIndexableWorkspaceFile } = require('../safety');

// File knowledge now lives inside the shared workspace-intelligence cache. This compatibility
// module keeps the renderer/IPC API stable while eliminating a second hash/read/persistence path.
const LEDGER_VERSION = 2;
const FILE_KNOWLEDGE_TIMEOUT_MS = 20 * 1000;

function validateIndexablePath(relativePath) {
  if (!relativePath) return { success: false, error: 'No file path', code: 'MISSING_PATH' };
  if (!isIndexableWorkspaceFile(relativePath)) {
    return {
      success: false,
      error: `Not an indexable project file: ${relativePath}`,
      code: 'NOT_INDEXABLE'
    };
  }
  return null;
}

function knowledgePath(workspacePath) {
  return path.join(workspacePath, '.orion', 'workspace-intelligence-cache.json');
}

function serviceFor(workspacePath) {
  return getWorkspaceIndexService(workspacePath, { watch: false });
}

function readLedger(workspacePath) {
  const service = serviceFor(workspacePath);
  return { version: LEDGER_VERSION, files: Object.fromEntries(service.fileKnowledge.entries()) };
}

function recordFileRead(workspacePath, relativePath) {
  return serviceFor(workspacePath).recordFileRead(relativePath);
}

function saveFileDigest(workspacePath, relativePath, digest) {
  return serviceFor(workspacePath).saveFileDigest(relativePath, digest);
}

function buildKnowledgeBrief(workspacePath, { maxDigests = 25 } = {}) {
  return serviceFor(workspacePath).buildKnowledgeBrief({ maxDigests });
}

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:record-file-read', async (event, { workspacePath, relativePath }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      const invalid = validateIndexablePath(relativePath);
      if (invalid) return invalid;
      return await requestWorkspaceIndex(
        'recordFileRead',
        { workspacePath, relativePath },
        { timeoutMs: FILE_KNOWLEDGE_TIMEOUT_MS }
      );
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('orion:save-file-digest', async (event, { workspacePath, relativePath, digest }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      const invalid = validateIndexablePath(relativePath);
      if (invalid) return invalid;
      return await requestWorkspaceIndex(
        'saveFileDigest',
        { workspacePath, relativePath, digest },
        { timeoutMs: FILE_KNOWLEDGE_TIMEOUT_MS }
      );
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('orion:get-knowledge-brief', async (event, { workspacePath, maxDigests }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return await requestWorkspaceIndex('getKnowledgeBrief', { workspacePath, maxDigests });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerHandlers,
  recordFileRead,
  saveFileDigest,
  buildKnowledgeBrief,
  readLedger,
  knowledgePath,
  validateIndexablePath,
  FILE_KNOWLEDGE_TIMEOUT_MS
};
