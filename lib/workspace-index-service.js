'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveWorkspacePath } = require('../safety');
const { extractSymbols } = require('./ast-parser');
const { resolveGeminiEmbeddingModel } = require('./embedding-config');

const CACHE_SCHEMA_VERSION = 1;
const SEMANTIC_CHUNK_VERSION = 2;
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_SOURCE_LRU_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_SOURCE_LRU_MAX_ENTRIES = 80;
const CONTEXT_PACKET_VERSION = 1;
const MAX_CONTEXT_PACKETS = 40;
const CONTEXT_PACKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INDEXED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LEXICAL_TERMS_PER_FILE = 2500;
const MAX_TERM_LINES_PER_FILE = 1500;
const MAX_LINES_PER_TERM = 40;

const SOURCE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.html', '.css',
  '.json', '.md', '.txt', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.sh', '.bat', '.yml', '.yaml'
]);
const SYMBOL_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py']);
const AST_CHUNK_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py']);
const { SCAN_SKIP_DIRECTORIES: SKIP_DIRS } = require('./scan-ignore');
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp', '.pdf',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wav', '.mov',
  '.avi', '.db', '.sqlite', '.node'
]);
const TEST_PATH_RE = /(^|[\\/])(__tests__|tests?|spec)([\\/]|$)|(?:^|[._-])(test|spec)\.[a-z0-9]+$/i;

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeWorkspacePath(workspacePath) {
  return path.resolve(String(workspacePath || ''));
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function splitLines(text) {
  return String(text || '').split(/\r?\n/);
}

function hashText(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function cacheFilePath(workspacePath) {
  return path.join(workspacePath, '.orion', 'workspace-intelligence-cache.json');
}

function languageForPath(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) return 'javascript';
  if (['.ts', '.tsx'].includes(ext)) return 'typescript';
  if (ext === '.py') return 'python';
  if (ext === '.md') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.html') return 'html';
  if (ext === '.css') return 'css';
  return ext.replace(/^\./, '') || 'text';
}

function shouldIndexPath(relPath, stat) {
  const normalized = normalizeSlash(relPath);
  if (!normalized || normalized.startsWith('../')) return false;
  const parts = normalized.split('/');
  if (parts.some(part => SKIP_DIRS.has(part))) return false;
  const base = path.basename(normalized);
  if (/^\.env(?:\.|$)/i.test(base)) return false;
  if (BINARY_EXTS.has(path.extname(base).toLowerCase())) return false;
  if (!SOURCE_EXTS.has(path.extname(base).toLowerCase())) return false;
  if (stat && stat.size > MAX_INDEXED_FILE_BYTES) return false;
  return true;
}

function extractLexicalTerms(source, relPath) {
  const termSet = new Set();
  const termLines = {};
  const lines = splitLines(source);
  const addTerm = (term, lineNo) => {
    const normalized = String(term || '').toLowerCase();
    if (normalized.length < 2 || normalized.length > 80) return;
    if (termSet.size >= MAX_LEXICAL_TERMS_PER_FILE && !termSet.has(normalized)) return;
    termSet.add(normalized);
    if (Object.keys(termLines).length >= MAX_TERM_LINES_PER_FILE && !termLines[normalized]) return;
    const existing = termLines[normalized] || [];
    if (existing.length < MAX_LINES_PER_TERM && existing[existing.length - 1] !== lineNo) {
      existing.push(lineNo);
      termLines[normalized] = existing;
    }
  };

  normalizeSlash(relPath).split(/[^A-Za-z0-9_$]+/).forEach(part => addTerm(part, 1));
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const tokens = line.match(/[A-Za-z_$][A-Za-z0-9_$]{1,79}/g) || [];
    for (const token of tokens) addTerm(token, lineNo);
  });

  return { lexicalTerms: [...termSet], termLines };
}

function extractImportsAndExports(source, relPath) {
  const imports = [];
  const exports = [];
  const lines = splitLines(source);
  const ext = path.extname(relPath).toLowerCase();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    let match;
    if ((match = line.match(/\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/))) {
      imports.push({ specifier: match[1], line: lineNo });
    }
    if ((match = line.match(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/))) {
      imports.push({ specifier: match[1], line: lineNo });
    }
    if (ext === '.py' && (match = line.match(/^\s*(?:from\s+([A-Za-z0-9_.$]+)\s+import|import\s+([A-Za-z0-9_.$]+))/))) {
      imports.push({ specifier: match[1] || match[2], line: lineNo });
    }
    if (/\bexport\b/.test(line) || /\bmodule\.exports\b/.test(line) || /\bexports\.[A-Za-z_$]/.test(line)) {
      exports.push({ text: line.trim().slice(0, 200), line: lineNo });
    }
  });

  return { imports, exports };
}

function buildSemanticChunks(source, relPath, symbols = []) {
  const lines = splitLines(source);
  const chunks = [];
  const covered = new Array(lines.length).fill(false);
  if (AST_CHUNK_EXTS.has(path.extname(relPath).toLowerCase()) && Array.isArray(symbols)) {
    const sorted = symbols
      .filter(symbol => Number.isInteger(symbol.startLine) && Number.isInteger(symbol.endLine))
      .filter(symbol => symbol.startLine > 0 && symbol.endLine >= symbol.startLine)
      .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    const seen = new Set();
    for (const symbol of sorted) {
      const startLine = Math.max(1, symbol.startLine);
      const endLine = Math.min(lines.length, symbol.endLine);
      const key = `${startLine}:${endLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const body = lines.slice(startLine - 1, endLine).join('\n').trim();
      if (body.length <= 20) continue;
      for (let i = startLine - 1; i <= endLine - 1; i++) covered[i] = true;
      const qualifiedName = symbol.path ? `${symbol.path}.${symbol.name}` : symbol.name;
      chunks.push({
        text: [
          `File: ${relPath}`,
          `Symbol: ${qualifiedName} (${symbol.type || 'Symbol'})`,
          `Lines ${startLine}-${endLine}`,
          symbol.signature ? `Signature: ${symbol.signature}` : null,
          body
        ].filter(Boolean).join('\n'),
        startLine,
        endLine,
        symbolName: symbol.name,
        symbolType: symbol.type || 'Symbol',
        symbolPath: symbol.path || ''
      });
    }
  }

  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && covered[index]) index++;
    const start = index;
    while (index < lines.length && !covered[index]) index++;
    const end = index - 1;
    if (end >= start) {
      chunks.push(...chunkLineRange(lines, relPath, start + 1, end + 1));
    }
  }
  return chunks;
}

function chunkLineRange(lines, relPath, startLine, endLine) {
  const chunks = [];
  const chunkSize = 50;
  const overlap = 10;
  const step = chunkSize - overlap;
  for (let lineNo = startLine; lineNo <= endLine; lineNo += step) {
    const sliceEnd = Math.min(endLine, lineNo + chunkSize - 1);
    const text = lines.slice(lineNo - 1, sliceEnd).join('\n').trim();
    if (text.length > 20) {
      chunks.push({
        text: `File: ${relPath}\nLines ${lineNo}-${sliceEnd}\n${text}`,
        startLine: lineNo,
        endLine: sliceEnd
      });
    }
    if (sliceEnd >= endLine) break;
  }
  return chunks;
}

function createEmptyTelemetry() {
  return {
    workspaceFilesIndexed: 0,
    filesReusedUnchanged: 0,
    filesReindexed: 0,
    filesRemoved: 0,
    watcherEventsReceived: 0,
    debouncedUpdatesPerformed: 0,
    cacheHits: 0,
    cacheMisses: 0,
    sourceLruHits: 0,
    sourceLruMisses: 0,
    astParsesAvoided: 0,
    astParsesPerformed: 0,
    diskReadsAvoided: 0,
    diskReadsPerformed: 0,
    embeddingChunksReused: 0,
    embeddingChunksGenerated: 0,
    fullReconciliationDurationMs: 0,
    incrementalUpdateDurationMs: 0,
    inspectCodeContextQueryDurationMs: 0,
    workspaceRevision: 0,
    candidateFilesConsidered: 0,
    exactSourceSectionsReturned: 0,
    corruptCacheRebuilds: 0,
    watcherFailures: 0,
    persistedCacheLoaded: false,
    sourceLruEvictions: 0,
    contextPacketsCreated: 0,
    contextPacketsHydrated: 0,
    contextPacketSectionsReused: 0,
    contextPacketSectionsRefreshed: 0,
    contextPacketAccessDenied: 0
  };
}

class SourceLru {
  constructor(options = {}, telemetry = null) {
    this.maxBytes = Number.isFinite(Number(options.maxBytes)) ? Number(options.maxBytes) : DEFAULT_SOURCE_LRU_MAX_BYTES;
    this.maxEntries = Number.isFinite(Number(options.maxEntries)) ? Number(options.maxEntries) : DEFAULT_SOURCE_LRU_MAX_ENTRIES;
    this.telemetry = telemetry;
    this.map = new Map();
    this.bytes = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key, entry) {
    this.delete(key);
    const bytes = Buffer.byteLength(String(entry.source || ''), 'utf8');
    this.map.set(key, { ...entry, bytes });
    this.bytes += bytes;
    this.evict();
  }

  delete(key) {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.bytes || 0;
      this.map.delete(key);
    }
  }

  evict() {
    while ((this.map.size > this.maxEntries || this.bytes > this.maxBytes) && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value;
      this.delete(oldestKey);
      if (this.telemetry) this.telemetry.sourceLruEvictions += 1;
    }
  }

  has(key) {
    return this.map.has(key);
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}

class WorkspaceIndexService {
  constructor(workspacePath, options = {}) {
    this.workspacePath = normalizeWorkspacePath(workspacePath);
    this.options = {
      watch: options.watch !== false,
      debounceMs: Number.isFinite(Number(options.debounceMs)) ? Number(options.debounceMs) : DEFAULT_DEBOUNCE_MS,
      sourceLruMaxBytes: Number.isFinite(Number(options.sourceLruMaxBytes)) ? Number(options.sourceLruMaxBytes) : DEFAULT_SOURCE_LRU_MAX_BYTES,
      sourceLruMaxEntries: Number.isFinite(Number(options.sourceLruMaxEntries)) ? Number(options.sourceLruMaxEntries) : DEFAULT_SOURCE_LRU_MAX_ENTRIES
    };
    this.records = new Map();
    this.contextPackets = new Map();
    this.revision = 0;
    this.telemetry = createEmptyTelemetry();
    this.sourceLru = new SourceLru({
      maxBytes: this.options.sourceLruMaxBytes,
      maxEntries: this.options.sourceLruMaxEntries
    }, this.telemetry);
    this.dirtyFiles = new Set();
    this.closed = false;
    this.watcher = null;
    this.debounceTimer = null;
    this.needsFullReconcile = false;
    this.loadPersistedCache();
    this.reconcile();
    if (this.options.watch) this.startWatcher();
  }

  loadPersistedCache() {
    const filePath = cacheFilePath(this.workspacePath);
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !parsed.files || typeof parsed.files !== 'object') {
        this.telemetry.corruptCacheRebuilds += 1;
        return;
      }
      this.revision = Number(parsed.revision) || 0;
      for (const [relPath, record] of Object.entries(parsed.files)) {
        if (!record || record.path !== relPath) continue;
        this.records.set(relPath, record);
      }
      const now = Date.now();
      for (const packet of Array.isArray(parsed.contextPackets) ? parsed.contextPackets : []) {
        if (!packet || packet.version !== CONTEXT_PACKET_VERSION || !packet.id) continue;
        if (now - Number(packet.createdAt || 0) > CONTEXT_PACKET_TTL_MS) continue;
        this.contextPackets.set(packet.id, packet);
      }
      this.pruneContextPackets();
      this.telemetry.persistedCacheLoaded = true;
    } catch (_) {
      this.telemetry.corruptCacheRebuilds += 1;
    }
  }

  persist() {
    if (this.closed) return;
    try {
      const filePath = cacheFilePath(this.workspacePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const files = {};
      for (const [relPath, record] of this.records.entries()) {
        files[relPath] = { ...record, sourceSnapshot: undefined, dirty: undefined };
      }
      const payload = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        revision: this.revision,
        persistedAt: new Date().toISOString(),
        contextPackets: [...this.contextPackets.values()],
        files
      };
      const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (_) {}
  }

  collectFiles() {
    const results = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir);
      } catch (_) {
        return;
      }
      for (const name of entries) {
        if (SKIP_DIRS.has(name)) continue;
        const fullPath = path.join(dir, name);
        let stat;
        try {
          stat = fs.lstatSync(fullPath);
        } catch (_) {
          continue;
        }
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          walk(fullPath);
          continue;
        }
        const relPath = normalizeSlash(path.relative(this.workspacePath, fullPath));
        if (!shouldIndexPath(relPath, stat)) continue;
        results.push({ relPath, fullPath, stat });
      }
    };
    walk(this.workspacePath);
    return results;
  }

  reconcile() {
    if (this.closed || !this.workspacePath || !fs.existsSync(this.workspacePath)) return;
    const started = Date.now();
    const seen = new Set();
    let changed = false;
    for (const file of this.collectFiles()) {
      seen.add(file.relPath);
      const existing = this.records.get(file.relPath);
      if (existing && existing.size === file.stat.size && existing.mtimeMs === file.stat.mtimeMs) {
        this.telemetry.filesReusedUnchanged += 1;
        this.telemetry.cacheHits += 1;
        this.telemetry.astParsesAvoided += SYMBOL_EXTS.has(path.extname(file.relPath).toLowerCase()) ? 1 : 0;
        this.telemetry.diskReadsAvoided += 1;
        continue;
      }
      this.indexFile(file.relPath, file.stat);
      changed = true;
    }

    for (const relPath of [...this.records.keys()]) {
      if (!seen.has(relPath)) {
        this.removeFile(relPath, { incrementRevision: false });
        changed = true;
      }
    }
    if (changed) {
      this.revision += 1;
      this.telemetry.workspaceRevision = this.revision;
      this.persist();
    }
    this.telemetry.workspaceFilesIndexed = this.records.size;
    this.telemetry.fullReconciliationDurationMs = Date.now() - started;
  }

  indexFile(relPath, stat = null, sourceOverride = null) {
    if (this.closed) return null;
    const normalized = normalizeSlash(relPath);
    let fileStat = stat;
    const fullPath = resolveWorkspacePath(this.workspacePath, normalized);
    try {
      if (!fileStat) fileStat = fs.statSync(fullPath);
      if (!fileStat.isFile() || !shouldIndexPath(normalized, fileStat)) {
        this.removeFile(normalized, { incrementRevision: false });
        return null;
      }
      const source = sourceOverride !== null && sourceOverride !== undefined
        ? String(sourceOverride)
        : fs.readFileSync(fullPath, 'utf8');
      if (sourceOverride === null || sourceOverride === undefined) this.telemetry.diskReadsPerformed += 1;
      const lines = splitLines(source);
      const ext = path.extname(normalized).toLowerCase();
      let symbols = [];
      if (SYMBOL_EXTS.has(ext)) {
        const parsed = extractSymbols(source, { filePath: normalized, path: normalized });
        this.telemetry.astParsesPerformed += 1;
        if (parsed && parsed.success && Array.isArray(parsed.symbols)) symbols = parsed.symbols;
      }
      const { imports, exports } = extractImportsAndExports(source, normalized);
      const { lexicalTerms, termLines } = extractLexicalTerms(source, normalized);
      const existing = this.records.get(normalized);
      const hash = hashText(source);
      const record = {
        path: normalized,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        hash,
        language: languageForPath(normalized),
        lineCount: lines.length,
        lineOffsets: buildLineOffsets(source),
        symbols,
        imports,
        exports,
        lexicalTerms,
        termLines,
        semanticChunks: existing && existing.hash === hash ? existing.semanticChunks : undefined,
        isTestFile: TEST_PATH_RE.test(normalized),
        relatedSourceFiles: [],
        indexedAt: new Date().toISOString(),
        revision: this.revision + 1
      };
      this.records.set(normalized, record);
      this.sourceLru.set(normalized, {
        source,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        hash,
        revision: record.revision
      });
      this.dirtyFiles.delete(normalized);
      this.telemetry.filesReindexed += 1;
      this.telemetry.cacheMisses += 1;
      return record;
    } catch (_) {
      return null;
    }
  }

  removeFile(relPath, options = {}) {
    const normalized = normalizeSlash(relPath);
    if (this.records.delete(normalized)) {
      this.telemetry.filesRemoved += 1;
      this.sourceLru.delete(normalized);
      this.dirtyFiles.delete(normalized);
      if (options.incrementRevision !== false) {
        this.revision += 1;
        this.telemetry.workspaceRevision = this.revision;
        this.persist();
      }
    }
  }

  markDirty(relPath) {
    if (this.closed) return;
    const normalized = normalizeSlash(relPath);
    if (!normalized || normalized.startsWith('../')) {
      this.needsFullReconcile = true;
    } else {
      this.dirtyFiles.add(normalized);
      this.sourceLru.delete(normalized);
      const existing = this.records.get(normalized);
      if (existing) existing.dirty = true;
    }
    this.scheduleDirtyFlush();
  }

  scheduleDirtyFlush() {
    if (this.closed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushDirtySync();
    }, this.options.debounceMs);
    if (this.debounceTimer.unref) this.debounceTimer.unref();
  }

  flushDirtySync() {
    if (this.closed) return;
    const started = Date.now();
    const dirty = [...this.dirtyFiles];
    this.dirtyFiles.clear();
    if (this.needsFullReconcile) {
      this.needsFullReconcile = false;
      this.reconcile();
      return;
    }
    let changed = false;
    for (const relPath of dirty) {
      const fullPath = resolveWorkspacePath(this.workspacePath, relPath);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        this.removeFile(relPath, { incrementRevision: false });
        changed = true;
        continue;
      }
      if (!stat.isFile() || !shouldIndexPath(relPath, stat)) {
        this.removeFile(relPath, { incrementRevision: false });
        changed = true;
        continue;
      }
      const existing = this.records.get(relPath);
      if (existing && existing.size === stat.size && existing.mtimeMs === stat.mtimeMs) {
        existing.dirty = false;
        continue;
      }
      this.indexFile(relPath, stat);
      changed = true;
    }
    if (changed) {
      this.revision += 1;
      this.telemetry.workspaceRevision = this.revision;
      this.telemetry.debouncedUpdatesPerformed += 1;
      this.persist();
    }
    this.telemetry.workspaceFilesIndexed = this.records.size;
    this.telemetry.incrementalUpdateDurationMs = Date.now() - started;
  }

  startWatcher() {
    try {
      this.watcher = fs.watch(this.workspacePath, { recursive: true }, (eventType, fileName) => {
        this.telemetry.watcherEventsReceived += 1;
        const normalized = normalizeSlash(fileName || '');
        if (!normalized) {
          this.needsFullReconcile = true;
          this.scheduleDirtyFlush();
          return;
        }
        if (eventType === 'rename') this.needsFullReconcile = true;
        this.markDirty(normalized);
      });
      if (typeof this.watcher.unref === 'function') this.watcher.unref();
      this.watcher.on('error', () => {
        this.telemetry.watcherFailures += 1;
        this.needsFullReconcile = true;
      });
    } catch (_) {
      this.telemetry.watcherFailures += 1;
    }
  }

  close() {
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.watcher) {
      try { this.watcher.close(); } catch (_) {}
    }
    this.watcher = null;
    this.sourceLru.clear();
  }

  getTelemetry() {
    return {
      ...this.telemetry,
      workspaceRevision: this.revision,
      workspaceFilesIndexed: this.records.size,
      dirtyFileCount: this.dirtyFiles.size,
      sourceLruEntries: this.sourceLru.map.size,
      sourceLruBytes: this.sourceLru.bytes
    };
  }

  getRecord(relPath) {
    this.flushDirtySync();
    return this.records.get(normalizeSlash(relPath)) || null;
  }

  listRecords() {
    this.flushDirtySync();
    return [...this.records.values()];
  }

  readSource(relPath) {
    this.flushDirtySync();
    const normalized = normalizeSlash(relPath);
    const fullPath = resolveWorkspacePath(this.workspacePath, normalized);
    const stat = fs.statSync(fullPath);
    const existing = this.records.get(normalized);
    const cached = this.sourceLru.get(normalized);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && !this.dirtyFiles.has(normalized)) {
      this.telemetry.sourceLruHits += 1;
      this.telemetry.diskReadsAvoided += 1;
      return { source: cached.source, record: existing, current: true, fromLru: true };
    }
    this.telemetry.sourceLruMisses += 1;
    const source = fs.readFileSync(fullPath, 'utf8');
    this.telemetry.diskReadsPerformed += 1;
    const hash = hashText(source);
    let record = existing;
    if (!record || record.size !== stat.size || record.mtimeMs !== stat.mtimeMs || record.hash !== hash || record.dirty) {
      record = this.indexFile(normalized, stat, source);
      this.revision += 1;
      this.telemetry.workspaceRevision = this.revision;
      this.persist();
    } else {
      this.sourceLru.set(normalized, { source, size: stat.size, mtimeMs: stat.mtimeMs, hash, revision: record.revision });
    }
    return { source, record, current: true, fromLru: false };
  }

  getFileLines(relPath) {
    const { source, record, fromLru } = this.readSource(relPath);
    return { lines: splitLines(source), source, record, fromLru };
  }

  getSymbolIndex() {
    const index = {};
    for (const record of this.listRecords()) {
      if (record.symbols && record.symbols.length > 0) index[record.path] = record.symbols;
    }
    return index;
  }

  getFileSymbols(relPath) {
    const record = this.getRecord(relPath) || this.indexPathIfPresent(relPath);
    return record ? (record.symbols || []) : [];
  }

  indexPathIfPresent(relPath) {
    const normalized = normalizeSlash(relPath);
    try {
      const fullPath = resolveWorkspacePath(this.workspacePath, normalized);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || !shouldIndexPath(normalized, stat)) return null;
      return this.indexFile(normalized, stat);
    } catch (_) {
      return null;
    }
  }

  findReferences(symbolName, targetPath = '.') {
    this.flushDirtySync();
    const needle = String(symbolName || '').toLowerCase();
    if (!needle) return { success: false, error: 'Missing symbolName', results: [] };
    const target = normalizeSlash(targetPath || '.').replace(/^\.\//, '');
    const candidates = this.listRecords().filter(record => {
      if (target && target !== '.' && record.path !== target && !record.path.startsWith(`${target.replace(/\/$/, '')}/`)) return false;
      return record.termLines && record.termLines[needle];
    });
    const results = [];
    for (const record of candidates) {
      let lines;
      try {
        lines = this.getFileLines(record.path).lines;
      } catch (_) {
        continue;
      }
      for (const lineNo of record.termLines[needle] || []) {
        const line = lines[lineNo - 1] || '';
        const regex = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`);
        if (!regex.test(line)) continue;
        results.push({
          file: record.path,
          line: lineNo,
          content: line.trim()
        });
      }
    }
    return { success: true, results };
  }

  findCandidatePaths(request = {}) {
    const explicit = Array.isArray(request.paths) ? request.paths.map(normalizeSlash).filter(Boolean) : [];
    const symbols = Array.isArray(request.symbols) ? request.symbols.map(String).filter(Boolean) : [];
    const terms = queryTerms(request.query);
    if (explicit.length > 0 && request.expand !== true) return [...new Set(explicit)].slice(0, 12);
    const scored = [];
    for (const record of this.listRecords()) {
      let score = 0;
      const termSet = new Set(record.lexicalTerms || []);
      for (const term of terms) if (termSet.has(term.toLowerCase())) score += 2;
      for (const symbol of symbols) {
        const lower = symbol.toLowerCase();
        if (termSet.has(lower)) score += 4;
        if ((record.symbols || []).some(item => String(item.name || '').toLowerCase() === lower)) score += 8;
      }
      if (explicit.includes(record.path)) score += 20;
      if (record.isTestFile) score += 1;
      if (score > 0 || explicit.includes(record.path)) scored.push({ path: record.path, score });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return [...new Set([...explicit, ...scored.map(item => item.path)])].slice(0, 12);
  }

  findRelatedTests(request = {}) {
    const terms = queryTerms(request.query);
    const symbols = Array.isArray(request.symbols) ? request.symbols.map(String).filter(Boolean) : [];
    const scored = [];
    for (const record of this.listRecords()) {
      if (!record.isTestFile) continue;
      const termSet = new Set(record.lexicalTerms || []);
      let score = 0;
      for (const term of terms) if (termSet.has(term.toLowerCase())) score += 2;
      for (const symbol of symbols) if (termSet.has(symbol.toLowerCase())) score += 5;
      if (score > 0) scored.push({ path: record.path, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 5);
  }

  async getSemanticChunks(config = {}, generateEmbedding) {
    this.flushDirtySync();
    const identity = getEmbeddingIdentity(config);
    const chunks = [];
    let changed = false;
    for (const record of this.listRecords()) {
      const existing = Array.isArray(record.semanticChunks) ? record.semanticChunks : [];
      const reusable = existing.filter(chunk =>
        chunk &&
        chunk.sourceHash === record.hash &&
        chunk.embeddingIdentity === identity &&
        chunk.chunkingVersion === SEMANTIC_CHUNK_VERSION &&
        Array.isArray(chunk.vector)
      );
      if (reusable.length > 0) {
        this.telemetry.embeddingChunksReused += reusable.length;
        chunks.push(...reusable.map(chunk => ({ ...chunk, file: record.path })));
        continue;
      }
      const { source } = this.readSource(record.path);
      const rawChunks = buildSemanticChunks(source, record.path, record.symbols || []);
      const embedded = [];
      for (const chunk of rawChunks) {
        const vector = await generateEmbedding(chunk.text, config);
        embedded.push({
          ...chunk,
          vector,
          sourceHash: record.hash,
          embeddingIdentity: identity,
          chunkingVersion: SEMANTIC_CHUNK_VERSION
        });
        this.telemetry.embeddingChunksGenerated += 1;
      }
      record.semanticChunks = embedded;
      chunks.push(...embedded.map(chunk => ({ ...chunk, file: record.path })));
      changed = true;
    }
    if (changed) this.persist();
    return chunks;
  }

  pruneContextPackets() {
    const now = Date.now();
    for (const [packetId, packet] of this.contextPackets.entries()) {
      if (now - Number(packet.createdAt || 0) > CONTEXT_PACKET_TTL_MS) {
        this.contextPackets.delete(packetId);
      }
    }
    const ordered = [...this.contextPackets.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    for (const packet of ordered.slice(MAX_CONTEXT_PACKETS)) this.contextPackets.delete(packet.id);
  }

  createContextPacket(payload = {}) {
    this.flushDirtySync();
    const evidence = [];
    const seen = new Set();
    for (const section of Array.isArray(payload.sections) ? payload.sections : []) {
      const relPath = normalizeSlash(section && section.path);
      if (!relPath) continue;
      let current;
      try {
        current = this.readSource(relPath);
      } catch (_) {
        continue;
      }
      const lines = splitLines(current.source);
      const startLine = Math.max(1, Math.min(lines.length, Number(section.startLine) || 1));
      const endLine = Math.max(startLine, Math.min(lines.length, Number(section.endLine) || startLine));
      const key = `${relPath.toLowerCase()}:${startLine}:${endLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        path: relPath,
        startLine,
        endLine,
        reasons: Array.isArray(section.reasons) ? section.reasons.map(String).slice(0, 8) : [],
        symbolName: String(section.symbolName || ''),
        hash: current.record && current.record.hash ? current.record.hash : hashText(current.source),
        fileRevision: Number(current.record && current.record.revision) || this.revision
      });
    }
    if (evidence.length === 0) return { success: false, error: 'No current exact-source sections were available for a context packet.' };

    const packet = {
      version: CONTEXT_PACKET_VERSION,
      id: `ctx_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
      workspacePath: this.workspacePath,
      workspaceRevision: this.revision,
      ownerConversationId: String(payload.ownerConversationId || ''),
      targetConversationId: '',
      runId: String(payload.runId || ''),
      query: String(payload.query || ''),
      symbols: Array.isArray(payload.symbols) ? payload.symbols.map(String).slice(0, 20) : [],
      include: Array.isArray(payload.include) ? payload.include.map(String).slice(0, 10) : [],
      requestedWork: '',
      findings: [],
      evidence,
      createdAt: Date.now(),
      assignedAt: 0,
      lastHydratedAt: 0
    };
    this.contextPackets.set(packet.id, packet);
    this.pruneContextPackets();
    this.telemetry.contextPacketsCreated += 1;
    this.persist();
    return {
      success: true,
      packetId: packet.id,
      workspaceRevision: packet.workspaceRevision,
      evidenceCount: packet.evidence.length,
      files: [...new Set(packet.evidence.map(item => item.path))]
    };
  }

  assignContextPackets(packetIds = [], payload = {}) {
    const sourceConversationId = String(payload.sourceConversationId || '');
    const targetConversationId = String(payload.targetConversationId || '');
    if (!targetConversationId) return { success: false, error: 'Missing target conversation for context handoff.', assignedPacketIds: [] };
    const assignedPacketIds = [];
    const rejected = [];
    for (const packetId of [...new Set((packetIds || []).map(String))].slice(-5)) {
      const packet = this.contextPackets.get(packetId);
      if (!packet) {
        rejected.push({ packetId, reason: 'missing' });
        continue;
      }
      if (packet.ownerConversationId && packet.ownerConversationId !== sourceConversationId) {
        this.telemetry.contextPacketAccessDenied += 1;
        rejected.push({ packetId, reason: 'owner_mismatch' });
        continue;
      }
      packet.targetConversationId = targetConversationId;
      packet.requestedWork = String(payload.requestedWork || '').slice(0, 12000);
      packet.findings = Array.isArray(payload.findings) ? payload.findings.map(String).filter(Boolean).slice(0, 20) : [];
      packet.assignedAt = Date.now();
      assignedPacketIds.push(packetId);
    }
    if (assignedPacketIds.length > 0) this.persist();
    return { success: assignedPacketIds.length > 0, assignedPacketIds, rejected };
  }

  hydrateContextPackets(packetIds = [], payload = {}) {
    this.flushDirtySync();
    const conversationId = String(payload.conversationId || '');
    const budgetTokens = Number.isFinite(Number(payload.budgetTokens))
      ? Math.max(1000, Math.min(60000, Number(payload.budgetTokens)))
      : 18000;
    const packets = [];
    const rejected = [];
    for (const packetId of [...new Set((packetIds || []).map(String))].slice(-5)) {
      const packet = this.contextPackets.get(packetId);
      if (!packet) {
        rejected.push({ packetId, reason: 'missing' });
        continue;
      }
      const allowed = packet.targetConversationId
        ? packet.targetConversationId === conversationId
        : packet.ownerConversationId === conversationId;
      if (!allowed) {
        this.telemetry.contextPacketAccessDenied += 1;
        rejected.push({ packetId, reason: 'conversation_mismatch' });
        continue;
      }
      packets.push(packet);
    }
    if (packets.length === 0) {
      return { success: false, error: 'No context packets are available for this conversation.', rejected, sections: [], content: '' };
    }

    const findings = [];
    const requestedWork = [];
    const candidates = [];
    const seen = new Set();
    for (const packet of packets) {
      if (packet.requestedWork) requestedWork.push(packet.requestedWork);
      findings.push(...(packet.findings || []));
      for (const item of packet.evidence || []) {
        const key = `${String(item.path).toLowerCase()}:${item.startLine}:${item.endLine}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ packetId: packet.id, ...item });
      }
    }

    let usedTokens = 0;
    let content = '';
    const sections = [];
    const omitted = [];
    for (const item of candidates) {
      let current;
      try {
        current = this.readSource(item.path);
      } catch (error) {
        omitted.push({ path: item.path, reason: 'missing_or_unreadable', error: error.message });
        continue;
      }
      const record = current.record || this.getRecord(item.path);
      const currentHash = record && record.hash ? record.hash : hashText(current.source);
      const refreshed = currentHash !== item.hash;
      let startLine = Number(item.startLine) || 1;
      let endLine = Number(item.endLine) || startLine;
      if (refreshed && item.symbolName && record && Array.isArray(record.symbols)) {
        const symbol = record.symbols.find(candidate => String(candidate.name || '').toLowerCase() === String(item.symbolName).toLowerCase());
        if (symbol) {
          startLine = Number(symbol.startLine) || startLine;
          endLine = Number(symbol.endLine) || endLine;
        }
      }
      const lines = splitLines(current.source);
      startLine = Math.max(1, Math.min(lines.length, startLine));
      endLine = Math.max(startLine, Math.min(lines.length, endLine));
      const numberedSource = formatNumberedSource(lines, startLine, endLine);
      const header = `\n\n--- File: ${item.path} (lines ${startLine}-${endLine}) ---\n`;
      const block = `${header}${numberedSource}`;
      const nextTokens = estimateTokens(block);
      if (usedTokens + nextTokens > budgetTokens && sections.length > 0) {
        omitted.push({ path: item.path, startLine, endLine, reason: 'budget' });
        continue;
      }
      usedTokens += nextTokens;
      content += block;
      sections.push({
        path: item.path,
        startLine,
        endLine,
        content: numberedSource,
        hash: currentHash,
        originalHash: item.hash,
        current: true,
        refreshed,
        packetId: item.packetId,
        reasons: item.reasons || []
      });
      if (refreshed) this.telemetry.contextPacketSectionsRefreshed += 1;
      else this.telemetry.contextPacketSectionsReused += 1;
    }

    const hydratedAt = Date.now();
    for (const packet of packets) packet.lastHydratedAt = hydratedAt;
    this.telemetry.contextPacketsHydrated += packets.length;
    this.persist();
    return {
      success: sections.length > 0,
      packetIds: packets.map(packet => packet.id),
      workspaceRevision: this.revision,
      sourceWorkspaceRevisions: [...new Set(packets.map(packet => packet.workspaceRevision))],
      requestedWork: [...new Set(requestedWork)],
      findings: [...new Set(findings)],
      sections,
      content: content.trimStart(),
      omitted,
      rejected,
      metrics: {
        packetCount: packets.length,
        sectionCount: sections.length,
        reusedSectionCount: sections.filter(section => !section.refreshed).length,
        refreshedSectionCount: sections.filter(section => section.refreshed).length,
        estimatedTokens: usedTokens,
        budgetTokens
      }
    };
  }
}

function formatNumberedSource(lines, startLine, endLine) {
  return lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
}

function buildLineOffsets(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function queryTerms(query) {
  return [...new Set(String(query || '')
    .split(/[^A-Za-z0-9_$]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3)
    .slice(0, 20))];
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getEmbeddingIdentity(config = {}) {
  if (config.embeddingBackend === 'ollama') {
    return `ollama:${config.embeddingModel || 'nomic-embed-text'}:chunks-v${SEMANTIC_CHUNK_VERSION}`;
  }
  return `gemini:${resolveGeminiEmbeddingModel(config)}:chunks-v${SEMANTIC_CHUNK_VERSION}`;
}

const services = new Map();
let activeWorkspaceKey = '';

function getWorkspaceIndexService(workspacePath, options = {}) {
  const key = normalizeWorkspacePath(workspacePath);
  if (!key) throw new Error('Missing workspace path');
  if (activeWorkspaceKey && activeWorkspaceKey !== key) {
    const old = services.get(activeWorkspaceKey);
    if (old) old.close();
  }
  activeWorkspaceKey = key;
  let service = services.get(key);
  if (!service || service.closed || options.fresh) {
    if (service) service.close();
    service = new WorkspaceIndexService(key, options);
    services.set(key, service);
  }
  return service;
}

function resetWorkspaceIndexServices() {
  for (const service of services.values()) service.close();
  services.clear();
  activeWorkspaceKey = '';
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  SEMANTIC_CHUNK_VERSION,
  DEFAULT_DEBOUNCE_MS,
  CONTEXT_PACKET_VERSION,
  WorkspaceIndexService,
  getWorkspaceIndexService,
  resetWorkspaceIndexServices,
  estimateTokens,
  normalizeSlash,
  shouldIndexPath,
  queryTerms,
  buildSemanticChunks,
  chunkLineRange,
  getEmbeddingIdentity
};
