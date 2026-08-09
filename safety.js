const fs = require('fs');
const path = require('path');
const { SCAN_SKIP_DIRECTORIES } = require('./lib/scan-ignore');

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

// ── Unattended condition probes ───────────────────────────────────────────────
//
// A condition probe runs every few minutes, on a timer, with nobody watching, and its output
// decides whether to wake the model. It must be a read-only OBSERVATION. A probe that mutates
// corrupts its own measurement (it observes the change it caused) and, far worse, performs an
// action nobody approved and nobody sees.
//
// A DENYLIST CANNOT ENFORCE THIS, and pretending otherwise is the actual danger. `node -e`,
// `python -c`, `powershell -Command`, `perl`, `ruby`, an arbitrary script, or any binary on
// PATH can write files, POST to the network, or shell out — none of which any pattern list can
// see inside. So the gate is an ALLOWLIST of program + verb combinations known to observe, and
// everything else is refused with an explanation. That inverts the failure mode: an unknown
// command is rejected (annoying, recoverable) rather than silently trusted (unbounded).
//
// The allowlist is the security boundary. The denylist below is kept only as defence in depth
// for allowlisted programs used in a mutating mode (`git push` — git IS allowlisted).

// Programs whose listed subcommands only read. Keyed by executable basename, lowercased.
// `null` verbs means every invocation of the program is read-only.
const PROBE_ALLOWED_PROGRAMS = Object.freeze({
  // Version control — read-only porcelain only. `git` also covers `git.exe`.
  git: ['status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'describe', 'branch',
    'ls-files', 'ls-remote', 'cat-file', 'symbolic-ref', 'remote', 'tag', 'shortlog', 'blame', 'count-objects'],
  // Test/lint/build runners. These execute project code, which is inherently arbitrary — but
  // that is the user's own project, invoked the way they invoke it themselves, and observing
  // "does my suite pass" is the single most valuable probe there is.
  npm: ['test', 'run', 'ls', 'outdated', 'audit', 'view', 'ping'],
  yarn: ['test', 'run', 'list', 'outdated', 'info'],
  pnpm: ['test', 'run', 'list', 'outdated', 'audit'],
  pytest: null,
  jest: null,
  vitest: null,
  eslint: null,
  ruff: null,
  mypy: null,
  tsc: null,
  cargo: ['check', 'test', 'clippy', 'tree', 'metadata'],
  go: ['test', 'vet', 'build', 'list'],
  mvn: ['test', 'verify'],
  gradle: ['test', 'check'],
  make: ['test', 'check', 'lint'],
  // Filesystem and process inspection.
  ls: null, dir: null, cat: null, head: null, tail: null, wc: null, stat: null, du: null, df: null,
  find: null, grep: null, rg: null, findstr: null, type: null, tree: null, file: null,
  // Windows read-only cmdlets and utilities.
  'get-content': null, 'get-childitem': null, 'get-item': null, 'get-process': null,
  'get-service': null, 'get-date': null, 'test-path': null, 'measure-object': null,
  'select-string': null, 'get-psdrive': null, 'compare-object': null,
  tasklist: null, systeminfo: null, whoami: null, hostname: null, ver: null,
  // Networking, read-only verbs only. curl/wget are additionally verb-checked below because
  // their flags, not their name, decide whether they mutate.
  curl: null, wget: null, ping: null, nslookup: null, dig: null,
  // Interpreters are deliberately ABSENT. Allowing `node --version` would put node on the
  // allowlist, and the only thing standing between that and `node -e "<anything>"` would be a
  // verb list — the precise fragility this design exists to remove. A version check is not
  // worth making the boundary depend on argument parsing, so node/python/ruby/perl/powershell
  // are simply not probe-able. Do not add them back for convenience.
  docker: ['ps', 'images', 'logs', 'inspect', 'stats', 'version'],
  kubectl: ['get', 'describe', 'logs', 'top', 'version'],
  gh: ['pr', 'issue', 'run', 'release', 'repo', 'api', 'status'],
  aws: null, az: null, gcloud: null
});

// Sub-verbs that make an otherwise-allowlisted program mutate. Checked after the allowlist.
const PROBE_FORBIDDEN_SUBCOMMANDS = Object.freeze({
  git: /^(?:push|commit|merge|rebase|cherry-pick|revert|reset|clean|am|apply|checkout|switch|restore|fetch|pull|clone|gc|prune)$/i,
  npm: /^(?:publish|install|i|ci|update|uninstall|link|unlink|dedupe|prune)$/i,
  yarn: /^(?:publish|add|remove|upgrade|install)$/i,
  pnpm: /^(?:publish|add|remove|update|install)$/i,
  docker: /^(?:push|run|exec|rm|rmi|build|kill|stop|start|restart|prune|login)$/i,
  kubectl: /^(?:apply|delete|create|edit|patch|replace|scale|rollout|drain|cordon|exec|cp)$/i,
  gh: /^(?:auth|secret|ssh-key|gpg-key)$/i,
  cargo: /^(?:publish|install|uninstall|update)$/i,
  go: /^(?:install|get|clean)$/i
});

// gh/aws/az/gcloud/kubectl are broad CLIs where the mutating action is the SECOND word.
const PROBE_MUTATING_ACTION_WORDS = /^(?:create|delete|update|put|post|deploy|remove|destroy|apply|set|add|edit|patch|merge|publish|upload|sync|restart|reboot|terminate|invoke|start|stop|scale|rollout|import|restore|revoke|grant|attach|detach|enable|disable)$/i;

// HTTP clients mutate based on flags rather than subcommands. This catches the request-body and
// method flags in every spelling: `-X POST`, `--request POST`, `-d`, `--data*`, `-F`, `--form`,
// `-T`, `--upload-file`, and the PowerShell equivalents. A body flag alone implies POST in curl.
const CURL_METHOD_FLAG = /(?:^|\s)(?:-X|--request)[\s=]*["']?([A-Za-z]+)/i;
const CURL_BODY_FLAGS = /(?:^|\s)(?:-d|--data(?:-raw|-binary|-urlencode|-ascii)?|-F|--form(?:-string)?|-T|--upload-file|--json)\b/i;
const PS_METHOD_FLAG = /-Method[\s=]*["']?([A-Za-z]+)/i;
const PS_BODY_FLAGS = /-(?:Body|InFile|Form)\b/i;
const READ_ONLY_HTTP_METHODS = /^(?:GET|HEAD|OPTIONS)$/i;

// Kept as defence in depth for programs that ARE allowlisted. The allowlist is the boundary.
const UNATTENDED_FORBIDDEN_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+(?:commit|merge|rebase|cherry-pick|revert)\b/i,
  /\b(?:npm|yarn|pnpm)\s+publish\b/i,
  /\bdocker\s+push\b/i,
  /\bgh\s+(?:pr\s+(?:merge|create)|release\s+create|repo\s+delete)\b/i,
  /\b(?:kubectl|helm)\s+(?:apply|delete|upgrade|install|rollout)\b/i,
  /\b(?:terraform|tofu)\s+(?:apply|destroy)\b/i,
  /\b(?:aws|az|gcloud)\s+\S+\s+(?:create|delete|update|put|deploy)\b/i,
  /\bInvoke-(?:WebRequest|RestMethod)\b[^\r\n]*-Method\s+(?:POST|PUT|PATCH|DELETE)\b/i,
  /\bshutdown\b|\bRestart-Computer\b|\bStop-Computer\b/i
];

function findUnattendedForbiddenPattern(command) {
  const text = String(command || '');
  return UNATTENDED_FORBIDDEN_PATTERNS.find(pattern => pattern.test(text)) || null;
}

// Splits a command line into whitespace-separated tokens, honouring simple quoting so a quoted
// argument containing a space or an operator is not mistaken for a second command.
function tokenizeCommandLine(text) {
  const tokens = [];
  let current = '';
  let quote = '';
  for (const char of String(text || '')) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

// Any of these means more than one program runs, so a single allowlist decision cannot cover
// the whole line. Chaining and substitution are refused outright rather than parsed.
const COMMAND_COMPOSITION = /(?:\|\||&&|[;&|]|\$\(|`|\breturn\b\s*>|>>|>|<)/;

function programBaseName(token) {
  const raw = String(token || '').replace(/^['"]|['"]$/g, '');
  const base = raw.split(/[\\/]/).pop() || raw;
  return base.replace(/\.(?:exe|cmd|bat|ps1|com)$/i, '').toLowerCase();
}

function classifyHttpClientProbe(program, text) {
  const methodMatch = program === 'curl' ? CURL_METHOD_FLAG.exec(text) : PS_METHOD_FLAG.exec(text);
  if (methodMatch && !READ_ONLY_HTTP_METHODS.test(methodMatch[1])) {
    return `it sends an HTTP ${methodMatch[1].toUpperCase()} request`;
  }
  const bodyFlags = program === 'curl' ? CURL_BODY_FLAGS : PS_BODY_FLAGS;
  if (bodyFlags.test(text)) {
    // A request body implies a write even with no explicit method: curl -d silently POSTs.
    return 'it sends a request body, which performs a write even when no method flag is given';
  }
  return '';
}

// Gate for commands executed by the schedule tick with no human present.
function classifyUnattendedProbeCommand(command) {
  const text = String(command || '').trim();
  if (!text) return { allowed: false, reason: 'A condition probe needs a command.' };

  const base = classifyCommandRequest(text, { source: 'freeform' });
  if (!base.allowed) return { allowed: false, reason: base.reason, category: base.category };

  if (COMMAND_COMPOSITION.test(text)) {
    return {
      allowed: false,
      category: 'probe_composition',
      reason: 'A condition probe must be a single read-only command. Pipes, chaining (&&, ;), redirection, and command substitution are refused because each additional program would need its own safety decision. Use one command that observes, and let the woken run do anything more involved.'
    };
  }

  const tokens = tokenizeCommandLine(text);
  const program = programBaseName(tokens[0]);
  if (!Object.prototype.hasOwnProperty.call(PROBE_ALLOWED_PROGRAMS, program)) {
    return {
      allowed: false,
      category: 'probe_not_allowlisted',
      reason: `Condition probes run unattended on a timer, so they are restricted to an allowlist of read-only programs; "${program || tokens[0] || text}" is not on it. This is deliberate rather than a missing pattern: interpreters like node, python, and powershell can perform arbitrary writes and network calls that no denylist can inspect. Use a listed read-only check (git status, npm test, curl without a body, a file read), or have the woken run take the action where it is visible.`
    };
  }

  const forbiddenVerbs = PROBE_FORBIDDEN_SUBCOMMANDS[program];
  const allowedVerbs = PROBE_ALLOWED_PROGRAMS[program];
  const verb = (tokens[1] || '').replace(/^['"]|['"]$/g, '');

  if (forbiddenVerbs && verb && forbiddenVerbs.test(verb)) {
    return {
      allowed: false,
      category: 'probe_mutating_subcommand',
      reason: `"${program} ${verb}" changes state. A probe must only observe — use a read-only subcommand and let the woken run make changes where you can see them.`
    };
  }
  if (Array.isArray(allowedVerbs)) {
    if (!verb || !allowedVerbs.some(allowed => allowed.toLowerCase() === verb.toLowerCase())) {
      return {
        allowed: false,
        category: 'probe_subcommand_not_allowlisted',
        reason: `"${program}" is only allowed for read-only subcommands (${allowedVerbs.join(', ')}); "${verb || '(none)'}" is not one of them.`
      };
    }
  }
  // Broad cloud CLIs: the mutating word is usually the second one after the service noun.
  if (['gh', 'aws', 'az', 'gcloud', 'kubectl', 'docker'].includes(program)) {
    const mutating = tokens.slice(1, 5).find(token => PROBE_MUTATING_ACTION_WORDS.test(programBaseName(token)));
    if (mutating) {
      return {
        allowed: false,
        category: 'probe_mutating_action',
        reason: `"${program} … ${mutating}" performs an action rather than a read. Probes observe only.`
      };
    }
  }
  if (program === 'curl' || program === 'wget' || /invoke-(?:webrequest|restmethod)/i.test(program)) {
    const mutation = classifyHttpClientProbe(program === 'curl' ? 'curl' : program, text);
    if (mutation) {
      return {
        allowed: false,
        category: 'probe_http_mutation',
        reason: `A condition probe may only issue read-only HTTP requests, but ${mutation}. Use a plain GET, or let the woken run perform the write.`
      };
    }
  }

  const legacyForbidden = findUnattendedForbiddenPattern(text);
  if (legacyForbidden) {
    const matched = text.match(legacyForbidden);
    return {
      allowed: false,
      category: 'unattended_forbidden',
      reason: `Condition probes must be read-only. This command matches ${legacyForbidden} (matched text: "${matched ? matched[0] : ''}"), which changes state outside this machine or the repository.`
    };
  }
  return { allowed: true, category: 'probe', reason: `Allowed read-only probe (${program})` };
}

function isIndexableWorkspaceFile(fileName) {
  const name = String(fileName || '').replace(/\\/g, '/');
  const parts = name.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || '';
  if (parts.some(part => SCAN_SKIP_DIRECTORIES.has(part.toLowerCase()))) return false;
  if (/^\.env(?:\.|$)/i.test(base)) return false;
  return INDEXABLE_EXTENSIONS.has(path.extname(base).toLowerCase());
}

module.exports = {
  classifyCommandRequest,
  classifyUnattendedProbeCommand,
  PROBE_ALLOWED_PROGRAMS,
  tokenizeCommandLine,
  programBaseName,
  findDestructivePattern,
  findUnattendedForbiddenPattern,
  isDestructiveCommand,
  isIndexableWorkspaceFile,
  resolveWorkspacePath
};
