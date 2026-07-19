const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readMultipleRanges,
  inspectCodeContext,
  mergeRanges
} = require('../lib/context-retrieval');
const { getWorkspaceIndexService, resetWorkspaceIndexServices } = require('../lib/workspace-index-service');

function makeWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-context-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'src', 'app.js'), [
    "const fs = require('fs');",
    '',
    'function targetThing(input) {',
    "  if (!input) return 'empty';",
    "  return helper(input.trim());",
    '}',
    '',
    'function helper(value) {',
    "  return `value:${value}`;",
    '}',
    '',
    'module.exports = { targetThing };'
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(dir, 'src', 'caller.js'), [
    "const { targetThing } = require('./app');",
    '',
    'function run() {',
    "  return targetThing('demo');",
    '}',
    '',
    'module.exports = { run };'
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(dir, 'tests', 'app.test.js'), [
    "const { targetThing } = require('../src/app');",
    '',
    "test('targetThing trims input', () => {",
    "  expect(targetThing(' demo ')).toBe('value:demo');",
    '});'
  ].join('\n'), 'utf8');

  t.teardown(() => {
    resetWorkspaceIndexServices();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('mergeRanges joins overlapping and adjacent retrieval ranges', (t) => {
  const merged = mergeRanges([
    { startLine: 10, endLine: 20, reasons: ['a'] },
    { startLine: 18, endLine: 25, reasons: ['b'] },
    { startLine: 40, endLine: 45, reasons: ['c'] }
  ]);
  t.deepEqual(
    merged.map(range => [range.startLine, range.endLine]),
    [[10, 25], [40, 45]],
    'overlapping ranges are merged'
  );
  t.deepEqual(merged[0].reasons, ['a', 'b'], 'merge preserves distinct reasons');
  t.end();
});

test('inspectCodeContext falls back to a file overview when the query has no lexical or symbol match', async (t) => {
  const workspace = makeWorkspace(t);
  const result = await inspectCodeContext(workspace, {
    paths: ['src/app.js'],
    query: 'completely absent search phrase',
    include: ['definitions'],
    budgetTokens: 12000
  });

  t.equal(result.success, true, 'no-match retrieval succeeds instead of throwing');
  t.ok(result.content.includes('function targetThing'), 'fallback includes the selected file content');
  t.end();
});

test('readMultipleRanges returns exact numbered source from several files in one bundle', (t) => {
  const workspace = makeWorkspace(t);
  const result = readMultipleRanges(workspace, [
    { path: 'src/app.js', ranges: [{ startLine: 3, endLine: 6 }, { startLine: 8, endLine: 10 }] },
    { path: 'src/caller.js', ranges: [{ startLine: 1, endLine: 4 }] }
  ]);

  t.equal(result.success, true, 'read succeeds');
  t.equal(result.sections.length, 3, 'all requested ranges are returned');
  t.ok(result.content.includes('3: function targetThing(input) {'), 'first range is numbered');
  t.ok(result.content.includes('--- File: src/caller.js (lines 1-4) ---'), 'second file appears in same bundle');
  t.equal(result.metrics.sectionCount, 3, 'metrics report section count');
  t.end();
});

test('inspectCodeContext bundles definitions, imports, callers, and related tests', async (t) => {
  const workspace = makeWorkspace(t);
  const result = await inspectCodeContext(workspace, {
    query: 'targetThing input trimming behavior',
    paths: ['src/app.js'],
    symbols: ['targetThing'],
    include: ['imports', 'definitions', 'callers', 'tests'],
    expand: true,
    budgetTokens: 12000
  });

  t.equal(result.success, true, 'inspection succeeds');
  t.ok(result.content.includes("1: const fs = require('fs');"), 'imports are included');
  t.ok(result.content.includes('3: function targetThing(input) {'), 'target definition is included');
  t.ok(result.content.includes("4:   return targetThing('demo');"), 'caller context is included');
  t.ok(result.content.includes("expect(targetThing(' demo ')).toBe('value:demo');"), 'related test context is included');
  t.ok(result.metrics.sectionCount >= 3, 'metrics capture bundled sections');
  t.ok(result.contextPacketId, 'inspection creates an immutable context packet receipt');
  t.end();
});

test('context packets hand exact source to one Coder conversation and refresh only changed evidence', async (t) => {
  const workspace = makeWorkspace(t);
  const inspected = await inspectCodeContext(workspace, {
    query: 'targetThing input trimming behavior',
    paths: ['src/app.js'],
    symbols: ['targetThing'],
    include: ['imports', 'definitions', 'callers', 'tests'],
    expand: true,
    budgetTokens: 12000,
    conversationId: 'dispatch-1',
    runId: 'dispatch-run-1'
  });
  const service = getWorkspaceIndexService(workspace);
  const assignment = service.assignContextPackets([inspected.contextPacketId], {
    sourceConversationId: 'dispatch-1',
    targetConversationId: 'coder-1',
    requestedWork: 'Fix the trimming behavior.',
    findings: ['targetThing owns input normalization.']
  });

  t.equal(assignment.success, true, 'Dispatch packet is assigned to the target Coder conversation');
  const first = service.hydrateContextPackets(assignment.assignedPacketIds, { conversationId: 'coder-1', budgetTokens: 12000 });
  t.equal(first.success, true, 'target Coder conversation hydrates the packet');
  t.ok(first.content.includes('function targetThing(input)'), 'hydration returns exact numbered source');
  t.equal(first.metrics.refreshedSectionCount, 0, 'unchanged source is reused without refreshing sections');
  t.deepEqual(first.findings, ['targetThing owns input normalization.'], 'Dispatch findings accompany exact evidence');

  const denied = service.hydrateContextPackets(assignment.assignedPacketIds, { conversationId: 'coder-2' });
  t.equal(denied.success, false, 'an unrelated conversation cannot inherit the packet');
  t.equal(denied.rejected[0].reason, 'conversation_mismatch', 'denial names the conversation boundary');

  fs.writeFileSync(path.join(workspace, 'notes.md'), 'unrelated workspace change', 'utf8');
  service.markDirty('notes.md');
  service.flushDirtySync();
  const afterUnrelatedChange = service.hydrateContextPackets(assignment.assignedPacketIds, { conversationId: 'coder-1', budgetTokens: 12000 });
  t.equal(afterUnrelatedChange.metrics.refreshedSectionCount, 0, 'an unrelated workspace revision does not invalidate referenced files');

  const appPath = path.join(workspace, 'src', 'app.js');
  fs.writeFileSync(appPath, fs.readFileSync(appPath, 'utf8').replace('return helper(input.trim());', "return helper(input.trim().toUpperCase());"), 'utf8');
  service.markDirty('src/app.js');
  service.flushDirtySync();
  const afterRelevantChange = service.hydrateContextPackets(assignment.assignedPacketIds, { conversationId: 'coder-1', budgetTokens: 12000 });
  t.ok(afterRelevantChange.metrics.refreshedSectionCount > 0, 'a changed referenced file refreshes its packet section');
  t.ok(afterRelevantChange.content.includes('input.trim().toUpperCase()'), 'Coder receives current source rather than stale Dispatch source');

  const persisted = JSON.parse(fs.readFileSync(path.join(workspace, '.orion', 'workspace-intelligence-cache.json'), 'utf8'));
  const persistedPacket = persisted.contextPackets.find(packet => packet.id === inspected.contextPacketId);
  t.ok(persistedPacket, 'compact packet descriptor persists with the workspace intelligence cache');
  t.notOk(Object.prototype.hasOwnProperty.call(persistedPacket.evidence[0], 'content'), 'packet persistence does not duplicate exact source text');
  resetWorkspaceIndexServices();
  const reopened = getWorkspaceIndexService(workspace, { watch: false });
  const afterRestart = reopened.hydrateContextPackets(assignment.assignedPacketIds, { conversationId: 'coder-1', budgetTokens: 12000 });
  t.equal(afterRestart.success, true, 'assigned receipt survives reopening the workspace intelligence cache');
  t.ok(afterRestart.content.includes('input.trim().toUpperCase()'), 'reopened receipt still resolves current exact source');
  t.end();
});
