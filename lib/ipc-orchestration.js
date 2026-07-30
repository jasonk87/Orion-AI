'use strict';

const { OrchestrationTaskStore } = require('./orchestration-task-store');

function success(value) {
  return { success: true, ...value };
}

function failure(error, fallback) {
  return {
    success: false,
    error: error && error.message ? error.message : String(error || fallback || 'Task operation failed.'),
    code: error && error.code ? error.code : 'TASK_OPERATION_FAILED'
  };
}

function registerHandlers(ipcMain, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain is required.');
  let lazyStore = options.store || null;
  // The file path may come from app.getPath(), which is unavailable until the
  // Electron app is ready, so the store is only constructed on first use.
  const store = () => {
    if (!lazyStore) {
      const filePath = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
      lazyStore = new OrchestrationTaskStore({ filePath });
    }
    return lazyStore;
  };

  ipcMain.handle('orion:create-task', async (event, task) => {
    try { return success({ task: await store().create(task) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:get-task', async (event, taskId) => {
    try { return success({ task: await store().get(taskId) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:list-tasks', async (event, filters = {}) => {
    try { return success({ tasks: await store().list(filters) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:update-task', async (event, payload = {}) => {
    try { return success({ task: await store().update(payload.taskId, payload.patch || {}) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:transition-task', async (event, payload = {}) => {
    try { return success({ task: await store().transition(payload.taskId, payload.status, payload.details || {}) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:cancel-task', async (event, payload = {}) => {
    try {
      return success(await store().cancel(
        payload.taskId,
        payload.requester || payload.requesterConversationId || '',
        payload.reason || 'Cancelled by user.'
      ));
    } catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:reconcile-tasks', async (event, payload = {}) => {
    try { return success({ tasks: await store().reconcileInterrupted(payload) }); }
    catch (error) { return failure(error); }
  });
  ipcMain.handle('orion:migrate-tasks', async () => {
    try { return success(await store().migrate()); }
    catch (error) { return failure(error); }
  });

  return store;
}

module.exports = { registerHandlers };
