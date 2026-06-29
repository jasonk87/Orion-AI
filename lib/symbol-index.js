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
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.orion']);

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

function buildWorkspaceSymbolIndex(workspacePath) {
  const files = collectJsFiles(workspacePath);
  const index = {};
  for (const fullPath of files) {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
      const symbols = indexSymbols(fullPath, content);
      if (symbols.length > 0) {
        index[relPath] = symbols;
      }
    } catch (_) {}
  }
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
