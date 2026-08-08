const fs = require('fs');
const path = require('path');

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-r[fF]?\b/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /(?:^|[;&|]\s*|\bcmd(?:\.exe)?\s+\/[cd]\s+)del\s+/i,
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
  // Disk formatting only: `format` must appear in command position and target a drive letter.
  // A bare /\bformat\b/ also matched harmless flags like `--output-format=concise` (which blocked
  // every ruff/linter invocation) and PowerShell display cmdlets like `Format-Table`.
  /(?:^|[;&|]\s*)format(?:\.com|\.exe)?\s+[a-z]:/i,
  /\b(?:Format|Clear|Initialize)-(?:Volume|Disk)\b/i
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

function findDestructivePattern(command) {
  const text = String(command || '');
  return DESTRUCTIVE_PATTERNS.find(pattern => pattern.test(text)) || null;
}

function isDestructiveCommand(command) {
  return !!findDestructivePattern(command);
}

function classifyCommandRequest(command, options = {}) {
  const text = String(command || '');
  const source = options.source || 'freeform';
  if (!text.trim()) return { category: source, allowed: false, reason: 'Missing command' };
  if (source === 'internal') return { category: 'internal', allowed: true, reason: 'Internal executable/args command' };
  const destructiveMatch = findDestructivePattern(text);
  if (destructiveMatch) {
    // Name the exact substring and rule that tripped: an opaque "matches deny rules" left the
    // agent retrying superficial rephrasings for a whole run without ever finding the trigger.
    const matched = text.match(destructiveMatch);
    return {
      category: 'destructive',
      allowed: false,
      reason: `Command matches destructive deny rule ${destructiveMatch} (matched text: "${matched ? matched[0] : ''}"). This command class is blocked; do not attempt to work around the block via wrapper scripts or encodings — choose a non-destructive alternative or ask the user.`
    };
  }
  return { category: 'freeform', allowed: true, reason: 'Allowed freeform terminal command' };
}

// Commands that must never run unattended on a timer, even though they are perfectly fine when
// a human typed them and is watching the result.
//
// A condition probe is supposed to be a read-only OBSERVATION: it answers "did something
// change?" and its answer decides whether to wake the model. Two things follow. First, a probe
// that mutates state corrupts its own measurement — it would observe the change it just caused.
// Second, and more seriously, a probe runs every few minutes with nobody watching, so an
// outward-facing action inside one is an action nobody approved and nobody sees. `git push`
// typed at a prompt is routine; `git push` on a five-minute timer is a robot publishing your
// work while you sleep.
//
// These are additive to DESTRUCTIVE_PATTERNS, which still apply — this list is about
// irreversible OUTWARD effects rather than local destruction.
const UNATTENDED_FORBIDDEN_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+(?:commit|merge|rebase|cherry-pick|revert)\b/i,
  /\b(?:npm|yarn|pnpm)\s+publish\b/i,
  /\bdocker\s+push\b/i,
  /\bgh\s+(?:pr\s+(?:merge|create)|release\s+create|repo\s+delete)\b/i,
  /\b(?:kubectl|helm)\s+(?:apply|delete|upgrade|install|rollout)\b/i,
  /\b(?:terraform|tofu)\s+(?:apply|destroy)\b/i,
  /\b(?:aws|az|gcloud)\s+\S+\s+(?:create|delete|update|put|deploy)\b/i,
  /\bcurl\b[^\r\n]*\s-X\s*(?:POST|PUT|PATCH|DELETE)\b/i,
  /\bInvoke-(?:WebRequest|RestMethod)\b[^\r\n]*-Method\s+(?:POST|PUT|PATCH|DELETE)\b/i,
  /\bshutdown\b|\bRestart-Computer\b|\bStop-Computer\b/i
];

function findUnattendedForbiddenPattern(command) {
  const text = String(command || '');
  return UNATTENDED_FORBIDDEN_PATTERNS.find(pattern => pattern.test(text)) || null;
}

// Gate for commands executed by the schedule tick with no human present. Applies the normal
// destructive rules first, then the unattended-only restrictions.
function classifyUnattendedProbeCommand(command) {
  const text = String(command || '');
  if (!text.trim()) return { allowed: false, reason: 'A condition probe needs a command.' };

  const base = classifyCommandRequest(text, { source: 'freeform' });
  if (!base.allowed) return { allowed: false, reason: base.reason, category: base.category };

  const forbidden = findUnattendedForbiddenPattern(text);
  if (forbidden) {
    const matched = text.match(forbidden);
    return {
      allowed: false,
      category: 'unattended_forbidden',
      reason: `Condition probes run unattended on a timer, so they must be read-only checks. This command matches ${forbidden} (matched text: "${matched ? matched[0] : ''}"), which changes state outside this machine or the repository. Use a probe that only observes — a status/exit-code/read command — and let the woken run take the action, where you can see it.`
    };
  }
  return { allowed: true, category: 'probe', reason: 'Allowed read-only probe command' };
}

function isIndexableWorkspaceFile(fileName) {
  const name = String(fileName || '');
  if (/^\.env(?:\.|$)/i.test(name)) return false;
  return INDEXABLE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

module.exports = {
  classifyCommandRequest,
  classifyUnattendedProbeCommand,
  findDestructivePattern,
  findUnattendedForbiddenPattern,
  isDestructiveCommand,
  isIndexableWorkspaceFile,
  resolveWorkspacePath
};
