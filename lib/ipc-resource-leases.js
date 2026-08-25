'use strict';

const { ResourceLeaseStore } = require('./resource-lease-store');

function success(value) {
  return { success: true, ...value };
}

function failure(error, fallback) {
  return {
    success: false,
    error: error && error.message ? error.message : String(error || fallback || 'Lease operation failed.'),
    code: error && error.code ? error.code : 'LEASE_OPERATION_FAILED'
  };
}

function registerHandlers(ipcMain, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain is required.');
  let lazyStore = options.store || null;
  // Same lazy-construction reason as ipc-orchestration.js: the file path usually comes from
  // app.getPath(), which is unavailable until the Electron app is ready.
  const store = () => {
    if (!lazyStore) {
      const filePath = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
      lazyStore = new ResourceLeaseStore({ filePath });
    }
    return lazyStore;
  };

  ipcMain.handle('orion:acquire-lease', async (event, payload = {}) => {
    try { return success(await store().acquire(payload)); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:release-lease', async (event, payload = {}) => {
    try { return success(await store().release(payload)); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:release-leases-for-conversation', async (event, conversationId) => {
    try { return success(await store().releaseAllForConversation(conversationId)); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:heartbeat-lease', async (event, payload = {}) => {
    try { return success(await store().heartbeat(payload)); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:list-leases', async (event, filters = {}) => {
    try { return success({ leases: await store().list(filters) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:reconcile-leases', async (event, payload = {}) => {
    try { return success(await store().reconcileInterrupted(payload)); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:resolve-lease-liveness', async (event, payload = {}) => {
    try { return success(await store().resolveProcessLiveness(payload)); }
    catch (error) { return failure(error); }
  });

  return store;
}

module.exports = { registerHandlers };
