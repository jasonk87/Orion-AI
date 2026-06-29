'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ── Path helpers ──────────────────────────────────────────────────────────────

function globalDir() {
  return path.join(os.homedir(), '.orion');
}

function globalMemoryPath() {
  return path.join(globalDir(), 'global-memory.json');
}

function skillMemoryPath() {
  return path.join(globalDir(), 'skill-memory.json');
}

function projectOrionDir(workspacePath) {
  return path.join(workspacePath, '.orion');
}

function projectMemoryPath(workspacePath) {
  return path.join(projectOrionDir(workspacePath), 'memory.json');
}

function sessionsDir(workspacePath) {
  return path.join(projectOrionDir(workspacePath), 'sessions');
}

// ── Atomic write ──────────────────────────────────────────────────────────────

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Windows EPERM fallback
    fs.writeFileSync(filePath, fs.readFileSync(tmp, 'utf8'), 'utf8');
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
  return data;
}

// ── Global Memory ─────────────────────────────────────────────────────────────

function defaultGlobalMemory() {
  return {
    version: '1.0',
    user: { name: '', preferences: [], routines: [] },
    people: [],
    facts: [],
    lastUpdated: null
  };
}

function readGlobalMemory() {
  const file = globalMemoryPath();
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const defaults = defaultGlobalMemory();
      return {
        version: raw.version || defaults.version,
        user: Object.assign({}, defaults.user, raw.user || {}),
        people: Array.isArray(raw.people) ? raw.people : [],
        facts: Array.isArray(raw.facts) ? raw.facts : [],
        lastUpdated: raw.lastUpdated || null
      };
    }
  } catch (_) {}
  return defaultGlobalMemory();
}

function writeGlobalMemory(data) {
  const current = readGlobalMemory();
  const merged = Object.assign({}, current, data, { lastUpdated: new Date().toISOString() });
  return atomicWrite(globalMemoryPath(), merged);
}

function appendGlobalFact(text, category) {
  const mem = readGlobalMemory();
  if (!text || !String(text).trim()) throw new Error('Fact text is required');
  mem.facts.push({ text: String(text).trim(), category: String(category || 'general').trim(), addedAt: new Date().toISOString() });
  mem.lastUpdated = new Date().toISOString();
  return atomicWrite(globalMemoryPath(), mem);
}

function updateUserProfile(updates) {
  const mem = readGlobalMemory();
  mem.user = Object.assign({}, mem.user, updates);
  mem.lastUpdated = new Date().toISOString();
  return atomicWrite(globalMemoryPath(), mem);
}

// ── Project Memory ────────────────────────────────────────────────────────────

function defaultProjectMemory() {
  return {
    facts: [],
    decisions: [],
    preferences: [],
    lastUpdated: null
  };
}

function readProjectMemory(workspacePath) {
  const file = projectMemoryPath(workspacePath);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        facts: Array.isArray(raw.facts) ? raw.facts : [],
        decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
        preferences: Array.isArray(raw.preferences) ? raw.preferences : [],
        lastUpdated: raw.lastUpdated || null
      };
    }
  } catch (_) {}
  return defaultProjectMemory();
}

function writeProjectMemory(workspacePath, data) {
  const merged = {
    facts: Array.isArray(data.facts) ? data.facts : [],
    decisions: Array.isArray(data.decisions) ? data.decisions : [],
    preferences: Array.isArray(data.preferences) ? data.preferences : [],
    lastUpdated: new Date().toISOString()
  };
  return atomicWrite(projectMemoryPath(workspacePath), merged);
}

function appendProjectFact(workspacePath, text, category) {
  if (!text || !String(text).trim()) throw new Error('Fact text is required');
  const mem = readProjectMemory(workspacePath);
  mem.facts.push({ text: String(text).trim(), category: String(category || 'general').trim(), addedAt: new Date().toISOString() });
  return writeProjectMemory(workspacePath, mem);
}

function appendProjectDecision(workspacePath, text, context) {
  if (!text || !String(text).trim()) throw new Error('Decision text is required');
  const mem = readProjectMemory(workspacePath);
  mem.decisions.push({ text: String(text).trim(), context: String(context || '').trim(), addedAt: new Date().toISOString() });
  return writeProjectMemory(workspacePath, mem);
}

function appendProjectPreference(workspacePath, text) {
  if (!text || !String(text).trim()) throw new Error('Preference text is required');
  const mem = readProjectMemory(workspacePath);
  mem.preferences.push({ text: String(text).trim(), addedAt: new Date().toISOString() });
  return writeProjectMemory(workspacePath, mem);
}

// ── Skill Memory ──────────────────────────────────────────────────────────────

function defaultSkillMemory() {
  return {
    version: '1.0',
    patterns: [],
    preferences: [],
    successfulPatterns: [],
    lastUpdated: null
  };
}

function readSkillMemory() {
  const file = skillMemoryPath();
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const defaults = defaultSkillMemory();
      return {
        version: raw.version || defaults.version,
        patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
        preferences: Array.isArray(raw.preferences) ? raw.preferences : [],
        successfulPatterns: Array.isArray(raw.successfulPatterns) ? raw.successfulPatterns : [],
        lastUpdated: raw.lastUpdated || null
      };
    }
  } catch (_) {}
  return defaultSkillMemory();
}

function writeSkillMemory(data) {
  const current = readSkillMemory();
  const merged = Object.assign({}, current, data, { lastUpdated: new Date().toISOString() });
  return atomicWrite(skillMemoryPath(), merged);
}

function appendSkillPattern(pattern) {
  if (!pattern) throw new Error('Pattern is required');
  const mem = readSkillMemory();
  mem.patterns.push({ pattern, addedAt: new Date().toISOString() });
  mem.lastUpdated = new Date().toISOString();
  return atomicWrite(skillMemoryPath(), mem);
}

// ── Session Memory ────────────────────────────────────────────────────────────

const MAX_SESSIONS = 30;

function sessionFilePath(workspacePath, sessionId) {
  return path.join(sessionsDir(workspacePath), `${sessionId}-session.json`);
}

function saveSessionMemory(workspacePath, sessionData) {
  const dir = sessionsDir(workspacePath);
  fs.mkdirSync(dir, { recursive: true });

  const sessionId = sessionData.sessionId || crypto.randomUUID();
  const now = new Date().toISOString();
  const record = {
    sessionId,
    startedAt: sessionData.startedAt || now,
    endedAt: sessionData.endedAt || now,
    workspacePath: workspacePath,
    summary: sessionData.summary || '',
    decisions: Array.isArray(sessionData.decisions) ? sessionData.decisions : [],
    discoveries: Array.isArray(sessionData.discoveries) ? sessionData.discoveries : [],
    tasksCompleted: Array.isArray(sessionData.tasksCompleted) ? sessionData.tasksCompleted : [],
    openItems: Array.isArray(sessionData.openItems) ? sessionData.openItems : []
  };

  const timestamp = now.replace(/[:.]/g, '-');
  const fileName = `${timestamp}-session.json`;
  const filePath = path.join(dir, fileName);
  atomicWrite(filePath, record);

  // Prune to last MAX_SESSIONS
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('-session.json'))
    .sort();
  if (files.length > MAX_SESSIONS) {
    const toDelete = files.slice(0, files.length - MAX_SESSIONS);
    for (const f of toDelete) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
    }
  }

  return record;
}

function listRecentSessions(workspacePath, limit) {
  const dir = sessionsDir(workspacePath);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('-session.json'))
    .sort()
    .reverse();
  const count = limit && limit > 0 ? Math.min(limit, files.length) : files.length;
  const results = [];
  for (const f of files.slice(0, count)) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      results.push({
        sessionId: raw.sessionId,
        startedAt: raw.startedAt,
        endedAt: raw.endedAt,
        summary: raw.summary,
        file: f
      });
    } catch (_) {}
  }
  return results;
}

function readSession(workspacePath, sessionId) {
  const dir = sessionsDir(workspacePath);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('-session.json'));
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (raw.sessionId === sessionId) return raw;
    } catch (_) {}
  }
  return null;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  readGlobalMemory,
  writeGlobalMemory,
  appendGlobalFact,
  updateUserProfile,
  readProjectMemory,
  writeProjectMemory,
  appendProjectFact,
  appendProjectDecision,
  appendProjectPreference,
  readSkillMemory,
  writeSkillMemory,
  appendSkillPattern,
  saveSessionMemory,
  listRecentSessions,
  readSession
};
