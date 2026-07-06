'use strict';

const fs = require('fs');
const path = require('path');

// ── Symbol extraction ─────────────────────────────────────────────────────────

const SYMBOL_PATTERNS = [
  // function declarations: function foo(
  { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/m, type: 'function' },
  // class declarations: class Foo
  { re: /^(?:export\s+)?class\s+(\w+)[\s{(]/m, type: 'class' },
  // arrow + regular function assignments: const foo = (async) (...) =>
  { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/, type: 'arrow' },
  // arrow function: const foo = async function
  { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/, type: 'function' },
  // module.exports.foo = or exports.foo =
  { re: /^(?:module\.)?exports\.(\w+)\s*=/, type: 'export' },
  // export default function / export default class
  { re: /^export\s+default\s+(?:async\s+)?function\s+(\w+)/, type: 'function' },
  { re: /^export\s+default\s+class\s+(\w+)/, type: 'class' },
  // named export shorthand: export { foo, bar }  — skip, too noisy
];

function indexSymbols(filePath, content) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const seen = new Set();

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    for (const { re, type } of SYMBOL_PATTERNS) {
      const m = trimmed.match(re);
      if (m && m[1]) {
        const key = `${type}:${m[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push({ name: m[1], type, line: idx + 1 });
        }
        break;
      }
    }
  });

  return symbols;
}

// ── Workspace-wide symbol index ───────────────────────────────────────────────

const INDEXABLE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.orion', '.claude']);

function collectJsFiles(dirPath) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const fullPath = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(fullPath); } catch (_) { continue; }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (INDEXABLE_EXTS.has(path.extname(name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  walk(dirPath);
  return results;
}

// ── Disk cache ─────────────────────────────────────────────────────────────────
// Keyed by mtime/size per file so unchanged files skip re-reading + re-parsing on
// every get_symbol_index call — the previous implementation rebuilt the whole
// workspace from scratch on every call, which is slow on larger repos.

const CACHE_VERSION = 1;

function cachePath(workspacePath) {
  return path.join(workspacePath, '.orion', 'symbol-index-cache.json');
}

function readCache(workspacePath) {
  try {
    const raw = fs.readFileSync(cachePath(workspacePath), 'utf8');
    const data = JSON.parse(raw);
    if (data && data.version === CACHE_VERSION && data.files && typeof data.files === 'object') {
      return data.files;
    }
  } catch (_) {}
  return {};
}

function writeCache(workspacePath, files) {
  try {
    const file = cachePath(workspacePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = { version: CACHE_VERSION, files, lastBuilt: new Date().toISOString() };
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      // Windows EPERM fallback
      fs.writeFileSync(file, fs.readFileSync(tmp, 'utf8'), 'utf8');
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  } catch (_) {}
}

function buildWorkspaceSymbolIndex(workspacePath) {
  const files = collectJsFiles(workspacePath);
  const cachedFiles = readCache(workspacePath);
  const nextCacheFiles = {};
  const index = {};
  for (const fullPath of files) {
    const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
    try {
      const stat = fs.statSync(fullPath);
      const cached = cachedFiles[relPath];
      let symbols;
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        symbols = cached.symbols;
      } else {
        const content = fs.readFileSync(fullPath, 'utf8');
        symbols = indexSymbols(fullPath, content);
      }
      nextCacheFiles[relPath] = { mtimeMs: stat.mtimeMs, size: stat.size, symbols };
      if (symbols.length > 0) {
        index[relPath] = symbols;
      }
    } catch (_) {}
  }
  writeCache(workspacePath, nextCacheFiles);
  return index;
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:get-symbol-index', async (event, workspacePath) => {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: 'Invalid workspace path', index: {} };
    }
    try {
      const index = buildWorkspaceSymbolIndex(workspacePath);
      return { success: true, index };
    } catch (e) {
      return { success: false, error: e.message, index: {} };
    }
  });
}

module.exports = {
  registerHandlers,
  indexSymbols,
  buildWorkspaceSymbolIndex,
  collectJsFiles
};
