const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readMultipleRanges,
  inspectCodeContext,
  mergeRanges
} = require('../lib/context-retrieval');

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

  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
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
  t.end();
});
