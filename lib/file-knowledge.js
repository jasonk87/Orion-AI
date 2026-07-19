'use strict';

const path = require('path');
const { getWorkspaceIndexService } = require('./workspace-index-service');
const { enqueueFileWrite } = require('./atomic-json-store');

// File knowledge now lives inside the shared workspace-intelligence cache. This compatibility
// module keeps the renderer/IPC API stable while eliminating a second hash/read/persistence path.
const LEDGER_VERSION = 2;

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
      return await enqueueFileWrite(knowledgePath(workspacePath), async () => ({
        success: true,
        ...recordFileRead(workspacePath, relativePath)
      }));
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('orion:save-file-digest', async (event, { workspacePath, relativePath, digest }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return await enqueueFileWrite(knowledgePath(workspacePath), async () => ({
        success: true,
        ...saveFileDigest(workspacePath, relativePath, digest)
      }));
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('orion:get-knowledge-brief', async (event, { workspacePath, maxDigests }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return { success: true, ...buildKnowledgeBrief(workspacePath, { maxDigests }) };
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
  knowledgePath
};
