'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { generateEmbedding, cosineSimilarity } = require('./semantic-search');

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

// ── Fact embeddings (RAG over facts/preferences) ──────────────────────────────
// Embeddings live alongside whichever fact store they describe: global facts/preferences are
// indexed under ~/.orion/facts-index.json, project facts/preferences under
// <workspace>/.orion/facts-index.json. Entries are keyed by a hash of the fact text itself, so an
// edited fact naturally gets a fresh embedding next time it is touched (the old hash's entry is
// just never looked up again) instead of needing an explicit invalidation step.

function factsIndexPath(scopeDir) {
  return path.join(scopeDir, 'facts-index.json');
}

function hashFactText(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function readFactsIndex(scopeDir) {
  const file = factsIndexPath(scopeDir);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.entries && typeof raw.entries === 'object') return raw.entries;
    }
  } catch (_) {}
  return {};
}

function writeFactsIndex(scopeDir, entries) {
  return atomicWrite(factsIndexPath(scopeDir), { version: 1, entries });
}

// Generates (or reuses cached) embeddings for a batch of { text } candidates in one read/write of
// the index file, and returns a Map of text -> vector. Candidates that fail to embed are omitted
// from the map rather than throwing, so one bad API call doesn't block the whole batch.
async function ensureFactEmbeddingsBatch(scopeDir, candidates, config) {
  const entries = readFactsIndex(scopeDir);
  let dirty = false;
  const vectors = new Map();
  for (const candidate of candidates) {
    const text = candidate.text;
    if (vectors.has(text)) continue;
    const hash = hashFactText(text);
    const existing = entries[hash];
    if (existing && Array.isArray(existing.vector)) {
      vectors.set(text, existing.vector);
      continue;
    }
    try {
      const vector = await generateEmbedding(text, config);
      entries[hash] = { text: String(text), vector, updatedAt: new Date().toISOString() };
      vectors.set(text, vector);
      dirty = true;
    } catch (_) { /* skip — a candidate that fails to embed just won't rank this time */ }
  }
  if (dirty) writeFactsIndex(scopeDir, entries);
  return vectors;
}

async function ensureFactEmbedding(scopeDir, text, config) {
  const vectors = await ensureFactEmbeddingsBatch(scopeDir, [{ text }], config);
  return vectors.get(text) || null;
}

// Best-effort embedding hook for the append* write paths below — a failed/missing embedding must
// never block a fact/preference save, so failures are swallowed here rather than propagated.
async function maybeEmbedFact(scopeDir, text, config) {
  if (!config) return;
  try { await ensureFactEmbedding(scopeDir, text, config); } catch (_) {}
}

// Ranks a workspace's project facts + preferences against a query by cosine similarity, embedding
// the query and lazily backfilling any candidate embeddings missing from the index. Falls back to
// the most recent `limit` items when no config/query is available or embedding fails outright.
async function rankFactsByQuery(candidates, scopeDir, query, config, limit) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (!config || !query) return candidates.slice(-limit);

  let queryVector;
  try {
    queryVector = await generateEmbedding(query, config);
  } catch (_) {
    return candidates.slice(-limit);
  }

  const vectors = await ensureFactEmbeddingsBatch(scopeDir, candidates, config);
  const scored = candidates
    .filter(c => vectors.has(c.text))
    .map(c => ({ candidate: c, score: cosineSimilarity(queryVector, vectors.get(c.text)) }));
  if (scored.length === 0) return candidates.slice(-limit);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.candidate);
}

// `mode` ('orion'|'coder'), when given, restricts preferences to that mode (or untagged, for
// backward compat with preferences saved before mode-tagging existed). Facts are shared across
// modes and are never filtered.
function globalFactCandidates(mem, mode) {
  const candidates = [];
  if (mem.user && Array.isArray(mem.user.preferences)) {
    for (const p of mem.user.preferences) {
      if (mode && p.mode && p.mode !== mode) continue;
      candidates.push({ type: 'preference', text: p.text });
    }
  }
  if (Array.isArray(mem.facts)) {
    for (const f of mem.facts) candidates.push({ type: 'fact', text: f.text, category: f.category });
  }
  return candidates;
}

async function rankGlobalFactsByQuery(query, config, limit = 10, mode) {
  const mem = readGlobalMemory();
  const candidates = globalFactCandidates(mem, mode);
  return rankFactsByQuery(candidates, globalDir(), query, config, limit);
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

async function appendGlobalFact(text, category, config) {
  const mem = readGlobalMemory();
  if (!text || !String(text).trim()) throw new Error('Fact text is required');
  const trimmed = String(text).trim();
  mem.facts.push({ text: trimmed, category: String(category || 'general').trim(), addedAt: new Date().toISOString() });
  mem.lastUpdated = new Date().toISOString();
  const result = atomicWrite(globalMemoryPath(), mem);
  await maybeEmbedFact(globalDir(), trimmed, config);
  return result;
}

async function appendGlobalPreference(text, config, source, mode) {
  const mem = readGlobalMemory();
  if (!text || !String(text).trim()) throw new Error('Preference text is required');
  const trimmed = String(text).trim();
  const entry = { text: trimmed, addedAt: new Date().toISOString() };
  if (source) entry.source = String(source);
  if (mode) entry.mode = String(mode);
  mem.user.preferences.push(entry);
  mem.lastUpdated = new Date().toISOString();
  const result = atomicWrite(globalMemoryPath(), mem);
  await maybeEmbedFact(globalDir(), trimmed, config);
  return result;
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

async function appendProjectFact(workspacePath, text, category, config) {
  if (!text || !String(text).trim()) throw new Error('Fact text is required');
  const trimmed = String(text).trim();
  const mem = readProjectMemory(workspacePath);
  mem.facts.push({ text: trimmed, category: String(category || 'general').trim(), addedAt: new Date().toISOString() });
  const result = writeProjectMemory(workspacePath, mem);
  await maybeEmbedFact(projectOrionDir(workspacePath), trimmed, config);
  return result;
}

function appendProjectDecision(workspacePath, text, context) {
  if (!text || !String(text).trim()) throw new Error('Decision text is required');
  const mem = readProjectMemory(workspacePath);
  mem.decisions.push({ text: String(text).trim(), context: String(context || '').trim(), addedAt: new Date().toISOString() });
  return writeProjectMemory(workspacePath, mem);
}

async function appendProjectPreference(workspacePath, text, config, mode) {
  if (!text || !String(text).trim()) throw new Error('Preference text is required');
  const trimmed = String(text).trim();
  const mem = readProjectMemory(workspacePath);
  const entry = { text: trimmed, addedAt: new Date().toISOString() };
  if (mode) entry.mode = String(mode);
  mem.preferences.push(entry);
  const result = writeProjectMemory(workspacePath, mem);
  await maybeEmbedFact(projectOrionDir(workspacePath), trimmed, config);
  return result;
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
  appendGlobalPreference,
  updateUserProfile,
  rankGlobalFactsByQuery,
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
