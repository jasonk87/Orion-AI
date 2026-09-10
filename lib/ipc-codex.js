'use strict';

const { CodexSubscription } = require('./codex-subscription');

function registerHandlers(ipcMain, { app, shell, service = new CodexSubscription() }) {
  const requests = new Map();
  const owners = new Set();
  const safe = fn => async (...args) => {
    try { return { success: true, ...await fn(...args) }; }
    catch (error) { return { success: false, error: error.message, cancelled: error.name === 'AbortError' }; }
  };
  ipcMain.handle('codex:status', safe(() => service.status()));
  ipcMain.handle('codex:login', safe(async () => {
    const login = await service.login();
    const url = new URL(login.authUrl);
    if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname)) throw new Error('Codex returned an unexpected login URL.');
    await shell.openExternal(login.authUrl);
    return { loginId: login.loginId };
  }));
  ipcMain.handle('codex:login-cancel', safe((_event, loginId) => service.rpc('account/login/cancel', { loginId })));
  ipcMain.handle('codex:complete', safe(async (event, input) => {
    const key = `${event.sender.id}:${input.requestId}`;
    if (!input.requestId || requests.has(key)) throw new Error('Invalid or duplicate Codex request.');
    const controller = new AbortController();
    requests.set(key, controller);
    if (!owners.has(event.sender.id)) {
      owners.add(event.sender.id);
      event.sender.once('destroyed', () => {
        for (const [id, request] of requests) if (id.startsWith(`${event.sender.id}:`)) request.abort();
        owners.delete(event.sender.id);
      });
    }
    try {
      return await service.complete(input, {
        signal: controller.signal,
        onDelta: delta => { if (!event.sender.isDestroyed()) event.sender.send('codex:delta', { ...delta, requestId: input.requestId }); }
      });
    } finally { requests.delete(key); }
  }));
  ipcMain.handle('codex:cancel', (_event, requestId) => {
    requests.get(`${_event.sender.id}:${requestId}`)?.abort();
    return { success: true };
  });
  app.on('before-quit', () => { for (const controller of requests.values()) controller.abort(); service.close(); });
  return service;
}

module.exports = { registerHandlers };
