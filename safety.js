const fs = require('fs');
const path = require('path');

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-r[fF]?\b/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bRemove-Item\s+-Recurse\b/i,
  /\bRemove-Item\b[^\r\n;|&]*\s-(?:Force|LiteralPath|Path)\b/i,
  /\brmdir\b[^\r\n;|&]*(?:\/s|-[rR])\b/i,
  /\b(?:fs\.)?rmSync\s*\(/i,
  /\b(?:fs\.)?rm\s*\(/i,
  /\bgit\s+(?:checkout\s+--|restore\b)/i,
  /\bClear-Content\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /\bmkfs\b/i,
  /\bformat\b/i
];

const INDEXABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.json', '.md',
  '.txt', '.java', '.cpp', '.h', '.c', '.go', '.rs', '.sh', '.bat', '.yml',
  '.yaml'
]);

function assertNoWorkspaceLinkEscape(workspaceRoot, fullPath) {
  const rootRealPath = fs.existsSync(workspaceRoot) ? fs.realpathSync(workspaceRoot) : workspaceRoot;
  const relativeParts = path.relative(workspaceRoot, fullPath).split(path.sep).filter(Boolean);
  let currentPath = workspaceRoot;
  for (const part of relativeParts) {
    currentPath = path.join(currentPath, part);
    if (!fs.existsSync(currentPath)) break;
    const realPath = fs.realpathSync(currentPath);
    const relative = path.relative(rootRealPath, realPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path escapes the active workspace through a symbolic link or junction');
    }
  }
}

function resolveWorkspacePath(workspacePath, relativePath = '') {
  if (!workspacePath) throw new Error('Missing workspace path');
  const workspaceRoot = path.resolve(workspacePath);
  const fullPath = path.resolve(workspaceRoot, relativePath || '');
  const relative = path.relative(workspaceRoot, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the active workspace');
  }
  assertNoWorkspaceLinkEscape(workspaceRoot, fullPath);
  return fullPath;
}

function isDestructiveCommand(command) {
  return DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(String(command || '')));
}

function classifyCommandRequest(command, options = {}) {
  const text = String(command || '');
  const source = options.source || 'freeform';
  if (!text.trim()) return { category: source, allowed: false, reason: 'Missing command' };
  if (source === 'internal') return { category: 'internal', allowed: true, reason: 'Internal executable/args command' };
  if (isDestructiveCommand(text)) return { category: 'destructive', allowed: false, reason: 'Command matches destructive deny rules' };
  return { category: 'freeform', allowed: true, reason: 'Allowed freeform terminal command' };
}

function isIndexableWorkspaceFile(fileName) {
  const name = String(fileName || '');
  if (/^\.env(?:\.|$)/i.test(name)) return false;
  return INDEXABLE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

module.exports = {
  classifyCommandRequest,
  isDestructiveCommand,
  isIndexableWorkspaceFile,
  resolveWorkspacePath
};
