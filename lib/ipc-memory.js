'use strict';

const path = require('path');
const os = require('os');
const mm = require('./memory-manager');
const { enqueueFileWrite } = require('./atomic-json-store');

function globalMemoryQueue() {
  return path.join(os.homedir(), '.orion', 'global-memory.json');
}

function projectMemoryQueue(workspacePath) {
  return path.join(workspacePath, '.orion', 'memory.json');
}

function skillMemoryQueue() {
  return path.join(os.homedir(), '.orion', 'skill-memory.json');
}

// ── IPC handler registration ──────────────────────────────────────────────────
// Consolidates all memory-related IPC handlers (global, project, skill, session).
// Replaces the handlers previously in lib/project-memory.js.

function registerHandlers(ipcMain) {

  // ── Global Memory ──────────────────────────────────────────────────────────

  ipcMain.handle('orion:read-global-memory', async () => {
    try {
      return { success: true, ...mm.readGlobalMemory() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:write-global-memory', async (event, updates) => {
    try {
      const result = await enqueueFileWrite(globalMemoryQueue(), () => mm.writeGlobalMemory(updates || {}));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-global-fact', async (event, { text, category, config, pinned } = {}) => {
    if (!text) return { success: false, error: 'text is required' };
    try {
      const result = await enqueueFileWrite(globalMemoryQueue(), () => mm.appendGlobalFact(text, category, config, pinned));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-global-preference', async (event, { text, config, source, mode, pinned } = {}) => {
    if (!text) return { success: false, error: 'text is required' };
    try {
      const result = await enqueueFileWrite(globalMemoryQueue(), () => mm.appendGlobalPreference(text, config, source, mode, pinned));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:update-user-profile', async (event, { updates } = {}) => {
    if (!updates || typeof updates !== 'object') return { success: false, error: 'updates object is required' };
    try {
      const result = await enqueueFileWrite(globalMemoryQueue(), () => mm.updateUserProfile(updates));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:rank-memory-facts', async (event, { query, config, limit, mode } = {}) => {
    try {
      const results = await mm.rankGlobalFactsByQuery(query, config, limit || 10, mode);
      return { success: true, results };
    } catch (e) {
      return { success: false, error: e.message, results: [] };
    }
  });

  // ── Project Memory ─────────────────────────────────────────────────────────

  ipcMain.handle('orion:read-project-memory', async (event, workspacePath) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required', facts: [], decisions: [], preferences: [], lastUpdated: null };
    try {
      return { success: true, ...mm.readProjectMemory(workspacePath) };
    } catch (e) {
      return { success: false, error: e.message, facts: [], decisions: [], preferences: [], lastUpdated: null };
    }
  });

  ipcMain.handle('orion:write-project-memory', async (event, payload) => {
    // Support both { workspacePath, data } and legacy { workspacePath, memory }
    const wp = payload && payload.workspacePath;
    const data = payload && (payload.data || payload.memory);
    if (!wp) return { success: false, error: 'workspacePath is required' };
    try {
      const result = await enqueueFileWrite(projectMemoryQueue(wp), () => mm.writeProjectMemory(wp, data || {}));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-project-fact', async (event, { workspacePath, text, category, config, pinned } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required' };
    if (!text) return { success: false, error: 'text is required' };
    try {
      const result = await enqueueFileWrite(projectMemoryQueue(workspacePath), () => mm.appendProjectFact(workspacePath, text, category, config, pinned));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Legacy handler: orion:append-project-memory → maps to appendProjectFact
  ipcMain.handle('orion:append-project-memory', async (event, { workspacePath, fact } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required' };
    if (!fact || !fact.text) return { success: false, error: 'fact.text is required' };
    try {
      const result = await enqueueFileWrite(projectMemoryQueue(workspacePath), () => mm.appendProjectFact(workspacePath, fact.text, fact.category));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-project-decision', async (event, { workspacePath, text, context } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required' };
    if (!text) return { success: false, error: 'text is required' };
    try {
      const result = await enqueueFileWrite(projectMemoryQueue(workspacePath), () => mm.appendProjectDecision(workspacePath, text, context));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-project-preference', async (event, { workspacePath, text, config, mode, pinned } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required' };
    if (!text) return { success: false, error: 'text is required' };
    try {
      const result = await enqueueFileWrite(projectMemoryQueue(workspacePath), () => mm.appendProjectPreference(workspacePath, text, config, mode, pinned));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Skill Memory ───────────────────────────────────────────────────────────

  ipcMain.handle('orion:read-skill-memory', async () => {
    try {
      return { success: true, ...mm.readSkillMemory() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:append-skill-pattern', async (event, { pattern } = {}) => {
    if (!pattern) return { success: false, error: 'pattern is required' };
    try {
      const result = await enqueueFileWrite(skillMemoryQueue(), () => mm.appendSkillPattern(pattern));
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Session Memory ─────────────────────────────────────────────────────────

  ipcMain.handle('orion:save-session', async (event, { workspacePath, sessionData } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required' };
    if (!sessionData) return { success: false, error: 'sessionData is required' };
    try {
      const result = mm.saveSessionMemory(workspacePath, sessionData);
      return { success: true, session: result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:list-sessions', async (event, { workspacePath, limit } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required', sessions: [] };
    try {
      const sessions = mm.listRecentSessions(workspacePath, limit);
      return { success: true, sessions };
    } catch (e) {
      return { success: false, error: e.message, sessions: [] };
    }
  });

  ipcMain.handle('orion:read-session', async (event, { workspacePath, sessionId } = {}) => {
    if (!workspacePath) return { success: false, error: 'workspacePath is required' };
    if (!sessionId) return { success: false, error: 'sessionId is required' };
    try {
      const session = mm.readSession(workspacePath, sessionId);
      if (!session) return { success: false, error: 'Session not found' };
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registerHandlers };
