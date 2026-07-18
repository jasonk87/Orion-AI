'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveWorkspacePath } = require('../safety');

// ── Per-workspace file-knowledge ledger ───────────────────────────────────────
// Stored at {workspacePath}/.orion/file-knowledge.json
// Schema: { version, files: { [relPath]: { hash, mtimeMs, size, lastReadAt, digest, digestedAt } } }
//
// The ledger binds the agent's understanding of a file to that file's exact content version.
// Cold ingestion (re-reading every file at the start of every task) is the dominant token and
// latency cost of working in a known project — this lets a new run trust prior notes for files
// whose bytes have not changed, and re-read only what actually moved.
//
// Freshness is hash-gated: a digest is only ever surfaced for a byte-identical file, so notes
// cannot be stale — only absent (file changed → digest is dropped at the next record/brief).

const LEDGER_VERSION = 1;
const MAX_TRACKED_FILES = 200;
const MAX_DIGEST_CHARS = 400;

function knowledgePath(workspacePath) {
  return path.join(workspacePath, '.orion', 'file-knowledge.json');
}

function readLedger(workspacePath) {
  try {
    const data = JSON.parse(fs.readFileSync(knowledgePath(workspacePath), 'utf8'));
    if (data && data.version === LEDGER_VERSION && data.files && typeof data.files === 'object') {
      return { version: LEDGER_VERSION, files: data.files };
    }
  } catch (_) {}
  return { version: LEDGER_VERSION, files: {} };
}

function writeLedger(workspacePath, ledger) {
  const file = knowledgePath(workspacePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries = Object.entries(ledger.files || {});
  if (entries.length > MAX_TRACKED_FILES) {
    entries.sort((a, b) => (b[1].lastReadAt || 0) - (a[1].lastReadAt || 0));
    ledger.files = Object.fromEntries(entries.slice(0, MAX_TRACKED_FILES));
  }
  const payload = JSON.stringify({ version: LEDGER_VERSION, files: ledger.files }, null, 2);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, payload, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows renameSync can throw EPERM if the destination is held open — overwrite directly.
    fs.writeFileSync(file, payload, 'utf8');
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function normalizeRelPath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function statAndHash(workspacePath, relativePath) {
  const fullPath = resolveWorkspacePath(workspacePath, relativePath);
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${relativePath}`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex').slice(0, 16);
  return { stat, hash };
}

// Records that the agent has seen the CURRENT content of a file (called on full read_file).
// Preserves an existing digest only while the content hash is unchanged.
function recordFileRead(workspacePath, relativePath) {
  const rel = normalizeRelPath(relativePath);
  if (!rel) throw new Error('Missing relative path');
  const { stat, hash } = statAndHash(workspacePath, rel);
  const ledger = readLedger(workspacePath);
  const existing = ledger.files[rel];
  const keepDigest = existing && existing.hash === hash ? existing : null;
  ledger.files[rel] = {
    hash,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    lastReadAt: Date.now(),
    digest: keepDigest ? keepDigest.digest : undefined,
    digestedAt: keepDigest ? keepDigest.digestedAt : undefined
  };
  writeLedger(workspacePath, ledger);
  return { recorded: rel, hash, hadCurrentDigest: !!(keepDigest && keepDigest.digest) };
}

// Saves the agent's concise understanding of a file, bound to the file's current content hash.
function saveFileDigest(workspacePath, relativePath, digest) {
  const rel = normalizeRelPath(relativePath);
  const text = String(digest || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DIGEST_CHARS);
  if (!rel) throw new Error('Missing relative path');
  if (!text) throw new Error('Missing digest text');
  const { stat, hash } = statAndHash(workspacePath, rel);
  const ledger = readLedger(workspacePath);
  const existing = ledger.files[rel] || {};
  ledger.files[rel] = {
    ...existing,
    hash,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    lastReadAt: existing.lastReadAt || Date.now(),
    digest: text,
    digestedAt: Date.now()
  };
  writeLedger(workspacePath, ledger);
  return { saved: rel, hash };
}

// Reconciles the ledger against current disk state and buckets every tracked file.
// - knownCurrent: byte-identical to when notes were written — the digest is trustworthy.
// - seenCurrent:  byte-identical to the last read, but no notes were saved.
// - changed:      content differs from what the agent last saw — must re-read before relying.
// - missing:      tracked file no longer exists.
function buildKnowledgeBrief(workspacePath, { maxDigests = 25 } = {}) {
  const ledger = readLedger(workspacePath);
  const knownCurrent = [];
  const seenCurrent = [];
  const changed = [];
  const missing = [];

  for (const [rel, entry] of Object.entries(ledger.files)) {
    let currentStat = null;
    try {
      const fullPath = resolveWorkspacePath(workspacePath, rel);
      currentStat = fs.statSync(fullPath);
    } catch (_) {
      missing.push(rel);
      continue;
    }
    // size+mtime match is the cheap check; only hash when they moved (a touch without a change
    // should not invalidate knowledge).
    let isCurrent = currentStat.size === entry.size && currentStat.mtimeMs === entry.mtimeMs;
    if (!isCurrent) {
      try {
        isCurrent = statAndHash(workspacePath, rel).hash === entry.hash;
      } catch (_) {
        isCurrent = false;
      }
    }
    if (!isCurrent) {
      changed.push(rel);
    } else if (entry.digest) {
      knownCurrent.push({ path: rel, digest: entry.digest, lastReadAt: entry.lastReadAt || 0 });
    } else {
      seenCurrent.push(rel);
    }
  }

  knownCurrent.sort((a, b) => b.lastReadAt - a.lastReadAt);
  return {
    knownCurrent: knownCurrent.slice(0, maxDigests).map(({ path: p, digest }) => ({ path: p, digest })),
    seenCurrent: seenCurrent.slice(0, 40),
    changed: changed.slice(0, 40),
    missing: missing.slice(0, 20),
    totalTracked: Object.keys(ledger.files).length
  };
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:record-file-read', async (event, { workspacePath, relativePath }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return { success: true, ...recordFileRead(workspacePath, relativePath) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:save-file-digest', async (event, { workspacePath, relativePath, digest }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return { success: true, ...saveFileDigest(workspacePath, relativePath, digest) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:get-knowledge-brief', async (event, { workspacePath, maxDigests }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No workspace path' };
      return { success: true, ...buildKnowledgeBrief(workspacePath, { maxDigests }) };
    } catch (e) {
      return { success: false, error: e.message };
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
