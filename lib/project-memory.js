'use strict';

const fs = require('fs');
const path = require('path');

// ── Per-workspace persistent memory ──────────────────────────────────────────
// Stored at {workspacePath}/.orion/memory.json
// Schema: { facts: [{ text, addedAt, category }], lastUpdated }

function memoryPath(workspacePath) {
  return path.join(workspacePath, '.orion', 'memory.json');
}

function readProjectMemory(workspacePath) {
  const file = memoryPath(workspacePath);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { facts: Array.isArray(data.facts) ? data.facts : [], lastUpdated: data.lastUpdated || null };
    }
  } catch (_) {}
  return { facts: [], lastUpdated: null };
}

function writeProjectMemory(workspacePath, memory) {
  const file = memoryPath(workspacePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = {
    facts: Array.isArray(memory.facts) ? memory.facts : [],
    lastUpdated: new Date().toISOString()
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // On Windows, renameSync can throw EPERM if the destination is held open.
    // Fall back to a direct overwrite via the already-written temp file contents.
    fs.writeFileSync(file, fs.readFileSync(tmp, 'utf8'), 'utf8');
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
  return data;
}

function appendProjectMemory(workspacePath, fact) {
  const existing = readProjectMemory(workspacePath);
  const entry = {
    text: String(fact.text || '').trim(),
    addedAt: new Date().toISOString(),
    category: String(fact.category || 'general').trim()
  };
  if (!entry.text) throw new Error('Fact text is required');
  existing.facts.push(entry);
  return writeProjectMemory(workspacePath, existing);
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:read-project-memory', async (event, workspacePath) => {
    if (!workspacePath) return { success: false, error: 'No workspace path', facts: [], lastUpdated: null };
    try {
      return { success: true, ...readProjectMemory(workspacePath) };
    } catch (e) {
      return { success: false, error: e.message, facts: [], lastUpdated: null };
    }
  });

  ipcMain.handle('orion:write-project-memory', async (event, { workspacePath, memory }) => {
    if (!workspacePath) return { success: false, error: 'No workspace path' };
    try {
      const result = writeProjectMemory(workspacePath, memory);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-project-memory', async (event, { workspacePath, fact }) => {
    if (!workspacePath) return { success: false, error: 'No workspace path' };
    try {
      const result = appendProjectMemory(workspacePath, fact);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  registerHandlers,
  readProjectMemory,
  writeProjectMemory,
  appendProjectMemory
};
