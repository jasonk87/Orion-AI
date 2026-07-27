'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
let worker = null;
let requestSequence = 0;
const pending = new Map();

function rejectPending(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function createWorker() {
  const next = new Worker(path.join(__dirname, 'workspace-index-worker.js'));
  // Workspace watches and an idle worker must never keep Electron or the test runner alive.
  next.unref();
  next.on('message', message => {
    const request = pending.get(message && message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.success) {
      request.resolve(message.result);
      return;
    }
    const error = new Error(message.error || 'Workspace intelligence worker failed.');
    if (message.code) error.code = message.code;
    request.reject(error);
  });
  next.on('error', error => {
    if (worker === next) worker = null;
    rejectPending(error);
  });
  next.on('exit', code => {
    if (worker === next) worker = null;
    if (pending.size) rejectPending(new Error(`Workspace intelligence worker exited with code ${code}.`));
  });
  worker = next;
  return next;
}

function requestWorkspaceIndex(operation, payload = {}, options = {}) {
  const activeWorker = worker || createWorker();
  const id = `workspace_${Date.now().toString(36)}_${(++requestSequence).toString(36)}`;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Workspace intelligence operation timed out: ${operation}`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
    pending.set(id, { resolve, reject, timer });
    activeWorker.postMessage({ id, operation, payload });
  });
}

async function closeWorkspaceIndexWorker() {
  if (!worker) return;
  const current = worker;
  worker = null;
  rejectPending(new Error('Workspace intelligence worker closed.'));
  await current.terminate();
}

module.exports = {
  requestWorkspaceIndex,
  closeWorkspaceIndexWorker
};
