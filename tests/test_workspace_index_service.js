const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  WorkspaceIndexService,
  getWorkspaceIndexService,
  resetWorkspaceIndexServices
} = require('../lib/workspace-index-service');
const { inspectCodeContext } = require('../lib/context-retrieval');

function makeWorkspace(t, prefix = 'orion-index-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  t.teardown(() => {
    resetWorkspaceIndexServices();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeFile(workspace, relPath, lines) {
  const fullPath = path.join(workspace, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, Array.isArray(lines) ? lines.join('\n') : String(lines), 'utf8');
  const now = new Date(Date.now() + 2000);
  fs.utimesSync(fullPath, now, now);
}

function appSource(returnValue = "'value:' + input") {
  return [
    "const helper = require('./helper');",
    '',
    'function targetThing(input) {',
    `  return ${returnValue};`,
    '}',
    '',
    'module.exports = { targetThing };'
  ];
}

function seedBasicWorkspace(t) {
  const workspace = makeWorkspace(t);
  writeFile(workspace, 'src/app.js', appSource());
  writeFile(workspace, 'src/helper.js', [
    'function helper(value) {',
    "  return `helper:${value}`;",
    '}',
    'module.exports = { helper };'
  ]);
  writeFile(workspace, 'src/caller.js', [
    "const { targetThing } = require('./app');",
    'function run() {',
    "  return targetThing('demo');",
    '}',
    'module.exports = { run };'
  ]);
  writeFile(workspace, 'tests/app.test.js', [
    "const { targetThing } = require('../src/app');",
    "test('targetThing works', () => targetThing('x'));"
  ]);
  return workspace;
}

test('initial workspace indexing builds and persists the shared cache', (t) => {
  const workspace = seedBasicWorkspace(t);
  const service = new WorkspaceIndexService(workspace, { watch: false });
  const telemetry = service.getTelemetry();

  t.ok(service.getRecord('src/app.js'), 'source file is indexed');
  t.ok(service.getRecord('tests/app.test.js').isTestFile, 'test file is classified');
  t.ok(fs.existsSync(path.join(workspace, '.orion', 'workspace-intelligence-cache.json')), 'cache is persisted under .orion');
  t.ok(telemetry.filesReindexed >= 4, 'initial index reprocesses files');
  service.close();
  t.end();
});

test('reopening an unchanged workspace reuses persisted records', (t) => {
  const workspace = seedBasicWorkspace(t);
  new WorkspaceIndexService(workspace, { watch: false }).close();
  const reopened = new WorkspaceIndexService(workspace, { watch: false });
  const telemetry = reopened.getTelemetry();

  t.equal(telemetry.persistedCacheLoaded, true, 'persisted cache is loaded');
  t.ok(telemetry.filesReusedUnchanged >= 4, 'unchanged files are reused');
  t.equal(telemetry.filesReindexed, 0, 'no unchanged files are reindexed');
  reopened.close();
  t.end();
});

test('unchanged inspect_code_context queries avoid whole-workspace rereads and reparses', async (t) => {
  const workspace = makeWorkspace(t, 'orion-index-benchmark-');
  for (let i = 0; i < 180; i++) {
    writeFile(workspace, `src/file${i}.js`, [
      `function feature${i}() {`,
      `  return ${i};`,
      '}',
      `module.exports = { feature${i} };`
    ]);
  }
  writeFile(workspace, 'src/target.js', [
    'function targetThing(value) {',
    "  return `target:${value}`;",
    '}',
    'module.exports = { targetThing };'
  ]);
  writeFile(workspace, 'tests/target.test.js', [
    "const { targetThing } = require('../src/target');",
    "test('targetThing', () => targetThing('x'));"
  ]);

  const first = await inspectCodeContext(workspace, {
    query: 'targetThing behavior',
    symbols: ['targetThing'],
    include: ['definitions', 'tests'],
    budgetTokens: 12000
  });
  const second = await inspectCodeContext(workspace, {
    query: 'targetThing behavior',
    symbols: ['targetThing'],
    include: ['definitions', 'tests'],
    budgetTokens: 12000
  });

  t.equal(first.success, true, 'first query succeeds');
  t.equal(second.success, true, 'second query succeeds');
  t.ok(second.content.includes('targetThing'), 'second query returns equivalent context');
  t.equal(second.metrics.cache.astParsesPerformed, 0, 'second query does not reparse unchanged files');
  t.equal(second.metrics.cache.diskReadsPerformed, 0, 'second query does not reread source from disk');
  t.ok(second.metrics.cache.sourceLruHits >= 1, 'second query serves selected exact source from LRU');
  t.end();
});

test('modified files invalidate, reindex, and return current exact source', (t) => {
  const workspace = seedBasicWorkspace(t);
  const service = new WorkspaceIndexService(workspace, { watch: false });
  service.readSource('src/app.js');

  writeFile(workspace, 'src/app.js', appSource("'changed:' + input"));
  service.markDirty('src/app.js');
  service.flushDirtySync();
  const current = service.readSource('src/app.js');

  t.ok(current.source.includes("'changed:' + input"), 'current source is returned after invalidation');
  t.ok(service.getRecord('src/app.js').hash, 'record hash is refreshed');
  t.ok(service.getTelemetry().filesReindexed >= 5, 'changed file was reindexed');
  service.close();
  t.end();
});

test('deleted, new, renamed, and closed-while-changed files reconcile correctly', (t) => {
  const workspace = seedBasicWorkspace(t);
  let service = new WorkspaceIndexService(workspace, { watch: false });

  fs.unlinkSync(path.join(workspace, 'src/helper.js'));
  writeFile(workspace, 'src/newFeature.js', [
    'function newFeature() {',
    "  return 'new';",
    '}'
  ]);
  fs.renameSync(path.join(workspace, 'src/caller.js'), path.join(workspace, 'src/renamedCaller.js'));
  service.reconcile();

  t.notOk(service.getRecord('src/helper.js'), 'deleted file is removed');
  t.ok(service.findCandidatePaths({ query: 'newFeature' }).includes('src/newFeature.js'), 'new file is searchable');
  t.notOk(service.getRecord('src/caller.js'), 'renamed old path is removed');
  t.ok(service.getRecord('src/renamedCaller.js'), 'renamed new path is indexed');
  service.close();

  writeFile(workspace, 'src/app.js', appSource("'offline-change:' + input"));
  service = new WorkspaceIndexService(workspace, { watch: false });
  t.ok(service.readSource('src/app.js').source.includes('offline-change'), 'startup reconciliation finds changes made while closed');
  service.close();
  t.end();
});

test('rapid dirty events debounce into one effective reindex pass', (t) => {
  const workspace = seedBasicWorkspace(t);
  const service = new WorkspaceIndexService(workspace, { watch: false, debounceMs: 1000 });
  writeFile(workspace, 'src/app.js', appSource("'debounced:' + input"));

  service.markDirty('src/app.js');
  service.markDirty('src/app.js');
  service.markDirty('src/app.js');
  service.flushDirtySync();

  t.equal(service.getTelemetry().debouncedUpdatesPerformed, 1, 'one effective debounced update is recorded');
  t.ok(service.readSource('src/app.js').source.includes('debounced'), 'dirty file is current after flush');
  service.close();
  t.end();
});

test('corrupt persisted cache rebuilds safely', (t) => {
  const workspace = seedBasicWorkspace(t);
  fs.mkdirSync(path.join(workspace, '.orion'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.orion', 'workspace-intelligence-cache.json'), '{not-json', 'utf8');
  const service = new WorkspaceIndexService(workspace, { watch: false });

  t.ok(service.getRecord('src/app.js'), 'workspace still indexes after corrupt cache');
  t.ok(service.getTelemetry().corruptCacheRebuilds >= 1, 'corrupt cache is reported');
  service.close();
  t.end();
});

test('switching active workspaces closes pending old-workspace service work', (t) => {
  const workspaceA = seedBasicWorkspace(t);
  const workspaceB = makeWorkspace(t, 'orion-index-b-');
  writeFile(workspaceB, 'src/other.js', ['function other() { return 1; }']);

  const serviceA = getWorkspaceIndexService(workspaceA, { watch: false, debounceMs: 1000, fresh: true });
  serviceA.markDirty('src/app.js');
  const serviceB = getWorkspaceIndexService(workspaceB, { watch: false, fresh: true });
  serviceA.flushDirtySync();

  t.equal(serviceA.closed, true, 'old active workspace service is closed');
  t.ok(serviceB.getRecord('src/other.js'), 'new active workspace service is usable');
  t.equal(serviceB.getRecord('src/app.js'), null, 'old workspace state does not mutate new workspace');
  serviceB.close();
  t.end();
});

test('source LRU eviction preserves structural metadata', (t) => {
  const workspace = makeWorkspace(t, 'orion-index-lru-');
  for (let i = 0; i < 8; i++) {
    writeFile(workspace, `src/file${i}.js`, [
      `function symbol${i}() {`,
      `  return '${'x'.repeat(300)}';`,
      '}'
    ]);
  }
  const service = new WorkspaceIndexService(workspace, { watch: false, sourceLruMaxBytes: 700, sourceLruMaxEntries: 2 });
  for (let i = 0; i < 8; i++) service.readSource(`src/file${i}.js`);

  t.notOk(service.sourceLru.has('src/file0.js'), 'old source text is evicted');
  t.ok(service.getRecord('src/file0.js').symbols.some(symbol => symbol.name === 'symbol0'), 'structural metadata remains after source eviction');
  service.close();
  t.end();
});

test('semantic chunks reuse unchanged source and invalidate when source changes', async (t) => {
  const workspace = seedBasicWorkspace(t);
  const service = new WorkspaceIndexService(workspace, { watch: false });
  let embeddingCalls = 0;
  const fakeEmbed = async (text) => {
    embeddingCalls += 1;
    return [text.length, embeddingCalls];
  };
  const config = { embeddingBackend: 'test', geminiApiKey: 'fake' };

  const first = await service.getSemanticChunks(config, fakeEmbed);
  const callsAfterFirst = embeddingCalls;
  const second = await service.getSemanticChunks(config, fakeEmbed);
  const callsAfterSecond = embeddingCalls;
  writeFile(workspace, 'src/app.js', appSource("'semantic-change:' + input"));
  service.markDirty('src/app.js');
  service.flushDirtySync();
  const callsBeforeThird = embeddingCalls;
  const third = await service.getSemanticChunks(config, fakeEmbed);

  t.ok(first.length > 0, 'first semantic build creates chunks');
  t.equal(callsAfterSecond, callsAfterFirst, 'unchanged semantic build does not call embedding generation again');
  t.equal(second.length, first.length, 'unchanged semantic chunk count is stable');
  t.ok(embeddingCalls > callsBeforeThird, 'changed source triggers new embedding generation');
  t.ok(third.length > 0, 'semantic chunks remain available after source change');
  t.ok(service.getTelemetry().embeddingChunksReused >= first.length, 'unchanged chunks are reused');
  t.ok(service.getTelemetry().embeddingChunksGenerated > callsAfterFirst, 'changed source generates replacement chunks');
  service.close();
  t.end();
});
