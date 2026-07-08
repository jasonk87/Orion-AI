/**
 * Tests for classifyAgentFailure, buildFailureRecoveryGuidance, and getCompactionThreshold.
 * These are pure/near-pure functions that can be unit-tested without a full Electron bootstrap.
 */
const test = require('tape');

// Minimal window stub so agent.js module-level code doesn't crash
global.window = { api: {}, OrionOperationalContext: null };
global.fetch = async () => ({ ok: true, json: async () => ({}) });

const agent = require('../agent.js');
const { classifyAgentFailure, buildFailureRecoveryGuidance, getCompactionThreshold } = agent;

// ── classifyAgentFailure ──────────────────────────────────────────────────────

test('classifyAgentFailure: repeated failures (count >= 3) override other categories', (t) => {
  const result = classifyAgentFailure({ toolName: 'run_command', args: {}, errorText: 'some error', failureCount: 3 });
  t.equal(result.category, 'repeated_tool_failure', 'three identical failures → repeated_tool_failure');
  t.equal(result.toolName, 'run_command', 'toolName is forwarded');
  t.end();
});

test('classifyAgentFailure: patch target not found', (t) => {
  const result = classifyAgentFailure({
    toolName: 'patch_file',
    args: { path: 'src/app.js' },
    errorText: 'target content block not found in file'
  });
  t.equal(result.category, 'patch_target_missing', 'patch_file with target-not-found text → patch_target_missing');
  t.end();
});

test('classifyAgentFailure: workspace path missing', (t) => {
  const result = classifyAgentFailure({
    toolName: 'change_workspace',
    args: { path: 'C:\\bogus\\path' },
    errorText: 'directory does not exist'
  });
  t.equal(result.category, 'workspace_path_missing', 'change_workspace + does-not-exist text → workspace_path_missing');
  t.end();
});

test('classifyAgentFailure: blocked command', (t) => {
  const result = classifyAgentFailure({
    toolName: 'run_command',
    args: { command: 'rm -rf /' },
    errorText: 'command blocked: destructive operation'
  });
  t.equal(result.category, 'command_blocked', 'destructive/blocked error → command_blocked');
  t.end();
});

test('classifyAgentFailure: missing dependency (module not found)', (t) => {
  const result = classifyAgentFailure({
    toolName: 'run_command',
    args: { command: 'node index.js' },
    errorText: "Cannot find module 'express'"
  });
  t.equal(result.category, 'missing_dependency', 'module not found → missing_dependency');
  t.end();
});

test('classifyAgentFailure: auth missing (401)', (t) => {
  const result = classifyAgentFailure({ toolName: 'run_command', args: {}, errorText: 'Request failed with status 401 Unauthorized' });
  t.equal(result.category, 'auth_missing', '401 error → auth_missing');
  t.end();
});

test('classifyAgentFailure: timeout via timedOut flag', (t) => {
  const result = classifyAgentFailure({ toolName: 'run_command', args: {}, result: { timedOut: true }, errorText: '' });
  t.equal(result.category, 'timeout', 'timedOut flag → timeout');
  t.end();
});

test('classifyAgentFailure: test failure', (t) => {
  const result = classifyAgentFailure({ toolName: 'run_tests', args: {}, errorText: 'tests failed: 3 assertions failed' });
  t.equal(result.category, 'test_failure', 'run_tests tool → test_failure');
  t.end();
});

test('classifyAgentFailure: interactive command needs input', (t) => {
  const result = classifyAgentFailure({ toolName: 'run_command', args: {}, errorText: 'interactive command reads from input()' });
  t.equal(result.category, 'interactive_command_needs_input', 'interactive input message → interactive_command_needs_input');
  t.end();
});

test('classifyAgentFailure: deprecated command with replacement hint', (t) => {
  const result = classifyAgentFailure({
    toolName: 'run_command',
    args: { command: 'old-cmd' },
    errorText: 'deprecated: use new-cmd instead'
  });
  t.equal(result.category, 'deprecated_command_with_replacement', 'deprecated + replacement → deprecated_command_with_replacement');
  t.ok(result.replacementHint, 'replacement hint is extracted');
  t.end();
});

test('classifyAgentFailure: fallback to generic tool_failure', (t) => {
  const result = classifyAgentFailure({ toolName: 'list_files', args: {}, errorText: 'something went wrong' });
  t.equal(result.category, 'tool_failure', 'unrecognised error → tool_failure');
  t.end();
});

test('classifyAgentFailure: pre-set category is preserved', (t) => {
  const result = classifyAgentFailure({ category: 'model_no_tool_use', toolName: 'n/a', args: {}, errorText: '' });
  t.equal(result.category, 'model_no_tool_use', 'explicit category is not overridden');
  t.end();
});

test('classifyAgentFailure: returns all expected fields', (t) => {
  const result = classifyAgentFailure({ toolName: 'run_command', args: { command: 'ls' }, errorText: 'err', failureCount: 1 });
  t.ok('category' in result, 'has category');
  t.ok('recommendedNature' in result, 'has recommendedNature');
  t.ok('toolName' in result, 'has toolName');
  t.ok('args' in result, 'has args');
  t.ok('errorText' in result, 'has errorText');
  t.ok('failureCount' in result, 'has failureCount');
  t.end();
});

// ── buildFailureRecoveryGuidance ─────────────────────────────────────────────

test('buildFailureRecoveryGuidance: injects tool name into message', (t) => {
  const guidance = buildFailureRecoveryGuidance({ category: 'tool_failure', toolName: 'read_file', args: {}, errorText: 'permission denied', failureCount: 1 });
  t.ok(guidance.includes('read_file'), 'tool name appears in guidance');
  t.end();
});

test('buildFailureRecoveryGuidance: injects error snippet into message', (t) => {
  const guidance = buildFailureRecoveryGuidance({ category: 'tool_failure', toolName: 'run_command', args: {}, errorText: 'ENOENT: no such file', failureCount: 1 });
  t.ok(guidance.includes('ENOENT'), 'error snippet appears in guidance');
  t.end();
});

test('buildFailureRecoveryGuidance: workspace_path_missing injects failed path', (t) => {
  const guidance = buildFailureRecoveryGuidance({
    category: 'workspace_path_missing',
    toolName: 'change_workspace',
    args: { path: 'C:\\bogus' },
    errorText: '',
    failureCount: 1
  });
  t.ok(guidance.includes('C:\\bogus') || guidance.toLowerCase().includes('path'), 'failed path or path reference in guidance');
  t.end();
});

test('buildFailureRecoveryGuidance: missing_dependency extracts module name', (t) => {
  const guidance = buildFailureRecoveryGuidance({
    category: 'missing_dependency',
    toolName: 'run_command',
    args: {},
    errorText: "Cannot find module 'express'",
    failureCount: 1
  });
  t.ok(guidance.includes('express'), 'missing module name injected');
  t.end();
});

test('buildFailureRecoveryGuidance: repeated failure includes count', (t) => {
  const guidance = buildFailureRecoveryGuidance({
    category: 'repeated_tool_failure',
    toolName: 'run_command',
    args: {},
    errorText: 'file not found',
    failureCount: 5
  });
  t.ok(guidance.includes('5'), 'failure count injected for repeated failures');
  t.end();
});

test('buildFailureRecoveryGuidance: deprecated_command_with_replacement mentions replacement', (t) => {
  const guidance = buildFailureRecoveryGuidance({
    category: 'deprecated_command_with_replacement',
    toolName: 'run_command',
    args: {},
    errorText: '',
    failureCount: 1,
    replacementHint: 'new-cmd --flag'
  });
  t.ok(guidance.includes('new-cmd --flag'), 'replacement hint injected');
  t.end();
});

test('buildFailureRecoveryGuidance: model_no_tool_use returns fixed guidance', (t) => {
  const guidance = buildFailureRecoveryGuidance({ category: 'model_no_tool_use', toolName: '', args: {}, errorText: '', failureCount: 1 });
  t.ok(guidance.includes('tools'), 'model_no_tool_use guidance mentions tools');
  t.end();
});

test('buildFailureRecoveryGuidance: gracefully handles empty failure object', (t) => {
  t.doesNotThrow(() => buildFailureRecoveryGuidance({}), 'empty object does not throw');
  t.doesNotThrow(() => buildFailureRecoveryGuidance(null), 'null does not throw');
  t.end();
});

// ── getCompactionThreshold ────────────────────────────────────────────────────

test('getCompactionThreshold: Gemini 2.5 with 1M context uses 82% of budget', (t) => {
  const threshold = getCompactionThreshold('gemini-2.5-pro', { modelContextBudgets: { 'gemini-2.5-pro': 1000000 } });
  t.equal(threshold, Math.floor(1000000 * 0.82), '2.5 model threshold is 82% of 1M budget');
  t.end();
});

test('getCompactionThreshold: configuredThreshold caps non-Gemini-2.5 models', (t) => {
  const threshold = getCompactionThreshold('gemini-1.5-pro', {
    compactThresholdTokens: 50000,
    modelContextBudgets: { 'gemini-1.5-pro': 128000 }
  });
  t.ok(threshold <= 50000, 'configured threshold caps non-2.5 model threshold');
  t.end();
});

test('getCompactionThreshold: defaults to 82% of 128k when no config', (t) => {
  const threshold = getCompactionThreshold('unknown-model', {});
  t.equal(threshold, Math.floor(128000 * 0.82), 'default budget 128k → threshold 104960');
  t.end();
});
