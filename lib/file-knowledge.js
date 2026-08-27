'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJsonSync, enqueueFileWrite } = require('./atomic-json-store');
const { isIndexableWorkspaceFile, resolveWorkspacePath } = require('../safety');

// File knowledge is durable agent-authored metadata, not derived index data. Keep it in a
// small, independently persisted ledger so recording one file never has to warm, serialize,
// or wait behind the repository-wide workspace index.
const LEDGER_VERSION = 3;
const MAX_TRACKED_FILES = 200;
const MAX_DIGEST_CHARS = 400;
const MAX_INDEXED_FILE_BYTES = 2 * 1024 * 1024;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

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
  return path.join(path.resolve(workspacePath), '.orion', 'file-knowledge.json');
}

function sharedCachePath(workspacePath) {
  return path.join(path.resolve(workspacePath), '.orion', 'workspace-intelligence-cache.json');
}

function emptyLedger() {
  return { version: LEDGER_VERSION, updatedAt: null, files: {} };
}

function parseLedger(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) return null;
    return {
      version: LEDGER_VERSION,
      sourceVersion: Number(parsed.version) || 1,
      updatedAt: parsed.updatedAt || null,
      files: { ...parsed.files }
    };
  } catch (_) {
    return null;
  }
}

function readLedger(workspacePath) {
  const dedicated = parseLedger(knowledgePath(workspacePath));
  if (dedicated && dedicated.sourceVersion >= LEDGER_VERSION) {
    delete dedicated.sourceVersion;
    return dedicated;
  }

  // One-way compatibility migration. Older builds embedded file knowledge in the disposable
  // workspace index cache, and still older builds used a versioned dedicated ledger. Merge the
  // old sources once; the next mutation persists version 3 as the sole authority.
  try {
    const cached = JSON.parse(fs.readFileSync(sharedCachePath(workspacePath), 'utf8'));
    if (cached && cached.fileKnowledge && typeof cached.fileKnowledge === 'object') {
      const files = { ...cached.fileKnowledge };
      for (const [relPath, knowledge] of Object.entries(dedicated?.files || {})) {
        const cachedKnowledge = files[relPath];
        const dedicatedTime = Math.max(Number(knowledge?.digestedAt || 0), Number(knowledge?.lastReadAt || 0));
        const cachedTime = Math.max(Number(cachedKnowledge?.digestedAt || 0), Number(cachedKnowledge?.lastReadAt || 0));
        if (!cachedKnowledge || dedicatedTime >= cachedTime) files[relPath] = knowledge;
      }
      return {
        version: LEDGER_VERSION,
        updatedAt: cached.persistedAt || null,
        files
      };
    }
  } catch (_) {}
  if (dedicated) {
    delete dedicated.sourceVersion;
    return dedicated;
  }
  return emptyLedger();
}

function currentFileIdentity(workspacePath, relativePath) {
  const relPath = normalizePath(relativePath);
  const invalid = validateIndexablePath(relPath);
  if (invalid) {
    const error = new Error(invalid.error);
    error.code = invalid.code;
    throw error;
  }
  const fullPath = resolveWorkspacePath(workspacePath, relPath);
  const stat = fs.statSync(fullPath);
  if (!stat.isFile() || stat.size > MAX_INDEXED_FILE_BYTES) {
    const error = new Error(`Not an indexable file: ${relativePath}`);
    error.code = 'NOT_INDEXABLE';
    throw error;
  }
  const source = fs.readFileSync(fullPath, 'utf8');
  return {
    path: relPath,
    hash: crypto.createHash('sha1').update(source).digest('hex'),
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

function pruneFiles(files) {
  const entries = Object.entries(files)
    .sort((a, b) => Number(b[1]?.lastReadAt || 0) - Number(a[1]?.lastReadAt || 0)
      || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.slice(0, MAX_TRACKED_FILES));
}

function persistLedger(workspacePath, ledger) {
  const next = {
    version: LEDGER_VERSION,
    updatedAt: new Date().toISOString(),
    files: pruneFiles(ledger.files || {})
  };
  atomicWriteJsonSync(knowledgePath(workspacePath), next, { trailingNewline: true });
  return next;
}

function recordFileRead(workspacePath, relativePath) {
  const identity = currentFileIdentity(workspacePath, relativePath);
  const ledger = readLedger(workspacePath);
  const existing = ledger.files[identity.path];
  const keepDigest = existing && existing.hash === identity.hash ? existing : null;
  ledger.files[identity.path] = {
    hash: identity.hash,
    mtimeMs: identity.mtimeMs,
    size: identity.size,
    lastReadAt: Date.now(),
    digest: keepDigest ? keepDigest.digest : undefined,
    digestedAt: keepDigest ? keepDigest.digestedAt : undefined
  };
  persistLedger(workspacePath, ledger);
  return {
    recorded: identity.path,
    hash: identity.hash,
    hadCurrentDigest: !!(keepDigest && keepDigest.digest),
    scope: 'single_file'
  };
}

function saveFileDigest(workspacePath, relativePath, digest) {
  const text = String(digest || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DIGEST_CHARS);
  if (!text) throw new Error('Missing digest text');
  const identity = currentFileIdentity(workspacePath, relativePath);
  const ledger = readLedger(workspacePath);
  const existing = ledger.files[identity.path] || {};
  ledger.files[identity.path] = {
    ...existing,
    hash: identity.hash,
    mtimeMs: identity.mtimeMs,
    size: identity.size,
    lastReadAt: existing.lastReadAt || Date.now(),
    digest: text,
    digestedAt: Date.now()
  };
  persistLedger(workspacePath, ledger);
  return { saved: identity.path, hash: identity.hash, scope: 'single_file' };
}

function buildKnowledgeBrief(workspacePath, { maxDigests = 25 } = {}) {
  const ledger = readLedger(workspacePath);
  const knownCurrent = [];
  const seenCurrent = [];
  const changed = [];
  const missing = [];
  for (const [relPath, knowledge] of Object.entries(ledger.files || {})) {
    let stat;
    try {
      stat = fs.statSync(resolveWorkspacePath(workspacePath, relPath));
    } catch (_) {
      missing.push(relPath);
      continue;
    }
    let current = stat.size === knowledge.size && stat.mtimeMs === knowledge.mtimeMs;
    if (!current) {
      try { current = currentFileIdentity(workspacePath, relPath).hash === knowledge.hash; } catch (_) { current = false; }
    }
    if (!current) changed.push(relPath);
    else if (knowledge.digest) knownCurrent.push({ path: relPath, digest: knowledge.digest, lastReadAt: knowledge.lastReadAt || 0 });
    else seenCurrent.push(relPath);
  }
  knownCurrent.sort((a, b) => b.lastReadAt - a.lastReadAt || a.path.localeCompare(b.path));
  seenCurrent.sort();
  changed.sort();
  missing.sort();
  return {
    knownCurrent: knownCurrent.slice(0, maxDigests).map(({ path: filePath, digest }) => ({ path: filePath, digest })),
    seenCurrent: seenCurrent.slice(0, 40),
    changed: changed.slice(0, 40),
    missing: missing.slice(0, 20),
    totalTracked: Object.keys(ledger.files || {}).length
  };
}

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:record-file-read', async (event, { workspacePath, relativePath }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      const invalid = validateIndexablePath(relativePath);
      if (invalid) return invalid;
      return await enqueueFileWrite(knowledgePath(workspacePath), () => ({
        success: true,
        ...recordFileRead(workspacePath, relativePath)
      }));
    } catch (error) {
      return { success: false, error: error.message, code: error.code || '' };
    }
  });

  ipcMain.handle('orion:save-file-digest', async (event, { workspacePath, relativePath, digest }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      const invalid = validateIndexablePath(relativePath);
      if (invalid) return invalid;
      return await enqueueFileWrite(knowledgePath(workspacePath), () => ({
        success: true,
        ...saveFileDigest(workspacePath, relativePath, digest)
      }));
    } catch (error) {
      return { success: false, error: error.message, code: error.code || '' };
    }
  });

  ipcMain.handle('orion:get-knowledge-brief', async (event, { workspacePath, maxDigests }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return { success: true, ...buildKnowledgeBrief(workspacePath, { maxDigests }) };
    } catch (error) {
      return { success: false, error: error.message, code: error.code || '' };
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
  currentFileIdentity,
  LEDGER_VERSION
};
