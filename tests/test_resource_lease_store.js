'use strict';

// Phase 3 (concurrency/resource leases, item 11). Recon before this module was written found the
// app's only real cross-conversation protection is a single global "one agent run at a time" lock
// (agent.js: isAgentRunning/runningConversationId). That lock has real gaps this store closes:
//   - it only covers the model loop being *active*; a background process a run started with
//     start_command keeps running after the run (and the global lock) ends, so a second run can
//     start into the same workspace while that background process is still alive with no way to
//     know
//   - the single shared browserWorker BrowserWindow (lib/ipc-shell.js) and the desktop-input gate
//     (agent.js computer_action) have zero cross-conversation ownership tracking at all - two
//     sequential runs can stomp each other's browser/desktop state with no handoff protocol
//   - workspace paths have a resolver (workspace-resolution.js) but no registry of who is
//     currently bound to a given path
// These tests exercise the store in isolation (no Electron, a real temp-file-backed store exactly
// like tests/test_task_orchestration.js exercises OrchestrationTaskStore) before any call site in
// agent.js/renderer.js is wired to it.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ResourceLeaseStore,
  RESOURCE_TYPES,
  DEFAULT_STALE_AFTER_MS,
  normalizeResourceKey,
  leaseIdentity
} = require('../lib/resource-lease-store');

function makeTempStore(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-lease-store-'));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'leases.json');
  return {
    dir,
    filePath,
    store: new ResourceLeaseStore({ filePath, ...options })
  };
}

test('acquiring a new resource creates a lease owned by the requesting conversation', async t => {
  const { store } = makeTempStore(t);
  const result = await store.acquire({
    resourceType: 'workspace',
    resourceKey: 'C:\\Projects\\Orion',
    conversationId: 'coder-1',
    taskId: 'task_1',
    executionId: 'task_1:run:1',
    role: 'coder'
  });
  t.equal(result.success, true, 'acquire succeeds against an unheld resource');
  t.equal(result.acquired, true, 'a fresh lease is reported as newly acquired');
  t.equal(result.lease.conversationId, 'coder-1', 'the lease records the requesting conversation');
  t.equal(result.lease.resourceType, 'workspace');
  t.ok(result.lease.acquiredAt > 0 && result.lease.heartbeatAt > 0, 'timestamps are recorded');
  t.end();
});

test('the same conversation re-acquiring its own lease is idempotent, not a conflict', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'browser', resourceKey: 'anything', conversationId: 'operator-1', taskId: 'task_1' });
  const again = await store.acquire({ resourceType: 'browser', resourceKey: 'anything', conversationId: 'operator-1', taskId: 'task_1' });
  t.equal(again.success, true, 'reacquiring by the same holder succeeds');
  t.equal(again.acquired, false, 'it is not reported as a fresh acquisition');
  t.equal(again.reacquired, true, 'it is reported as a re-entrant hold');
  t.end();
});

test('a different conversation cannot acquire a fresh lease held by someone else', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'desktop', resourceKey: 'anything', conversationId: 'coder-1', taskId: 'task_a' });
  const blocked = await store.acquire({ resourceType: 'desktop', resourceKey: 'anything', conversationId: 'operator-1', taskId: 'task_b' });
  t.equal(blocked.success, false, 'the second conversation is blocked');
  t.equal(blocked.conflict.conversationId, 'coder-1', 'the conflict names the actual current holder');
  t.end();
});

test('desktop and browser leases are process-wide singletons regardless of the resourceKey supplied', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'desktop', resourceKey: 'left-monitor', conversationId: 'coder-1' });
  const blocked = await store.acquire({ resourceType: 'desktop', resourceKey: 'right-monitor', conversationId: 'operator-1' });
  t.equal(blocked.success, false, 'a different resourceKey string does not create a second desktop lease - there is only one physical desktop');
  t.equal(leaseIdentity('desktop', 'left-monitor'), leaseIdentity('desktop', 'right-monitor'), 'desktop identity ignores the caller-supplied key');
  t.equal(leaseIdentity('browser', 'tab-a'), leaseIdentity('browser', 'tab-b'), 'browser identity ignores the caller-supplied key too - one shared BrowserWindow');
  t.end();
});

test('workspace and process lease keys normalize path casing, slashes, and trailing separators', async t => {
  t.equal(
    normalizeResourceKey('workspace', 'C:\\Projects\\Orion\\'),
    normalizeResourceKey('workspace', 'c:/projects/orion'),
    'workspace keys normalize case, slash direction, and trailing separators to the same identity'
  );
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\Projects\\Orion\\', conversationId: 'coder-1' });
  const blocked = await store.acquire({ resourceType: 'workspace', resourceKey: 'c:/projects/orion', conversationId: 'operator-1' });
  t.equal(blocked.success, false, 'a path that differs only by casing/slashes collides with the existing lease, not a distinct one');
  t.end();
});

test('a stale lease with no heartbeat is treated as abandoned and can be stolen', async t => {
  let now = 1000;
  const { store } = makeTempStore(t, { now: () => now, staleAfterMs: 5000 });
  await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'coder-1', taskId: 'task_a' });
  now += 4000;
  const stillBlocked = await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'operator-1' });
  t.equal(stillBlocked.success, false, 'not yet stale - still blocked');
  now += 2000; // total 6000ms since acquire, past the 5000ms staleAfterMs
  const stolen = await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'operator-1', taskId: 'task_b' });
  t.equal(stolen.success, true, 'a lease stale past the timeout can be acquired by someone else');
  t.equal(stolen.stolen, true, 'the acquisition is reported as a steal, not a fresh unheld resource');
  t.equal(stolen.previousHolder.conversationId, 'coder-1', 'the previous holder is reported for diagnostics');
  t.equal(stolen.lease.conversationId, 'operator-1', 'the new holder now owns the lease');
  t.end();
});

test('a heartbeat keeps a long-held lease from going stale and can merge in new process IDs', async t => {
  let now = 1000;
  const { store } = makeTempStore(t, { now: () => now, staleAfterMs: 5000 });
  await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'coder-1', taskId: 'task_a', processIds: ['1111'] });
  now += 4000;
  const beat = await store.heartbeat({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'coder-1', processIds: ['2222'] });
  t.equal(beat.success, true, 'heartbeat by the actual holder succeeds');
  t.deepEqual(beat.lease.processIds.slice().sort(), ['1111', '2222'], 'heartbeat merges newly reported process IDs instead of replacing the list');
  now += 4000; // 8000ms since acquire, but only 4000ms since the heartbeat - still fresh
  const stillBlocked = await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'operator-1' });
  t.equal(stillBlocked.success, false, 'the heartbeat reset the staleness clock, so the lease is not stealable yet');
  const wrongHolderBeat = await store.heartbeat({ resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'operator-1' });
  t.equal(wrongHolderBeat.success, false, 'a conversation that does not hold the lease cannot heartbeat it');
  t.end();
});

test('release only succeeds for the actual holder, and releasing an unheld resource is a harmless no-op', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\Projects\\Orion', conversationId: 'coder-1' });
  const wrongHolder = await store.release({ resourceType: 'workspace', resourceKey: 'C:\\Projects\\Orion', conversationId: 'operator-1' });
  t.equal(wrongHolder.success, false, 'a non-holder cannot release the lease');
  const noop = await store.release({ resourceType: 'workspace', resourceKey: 'C:\\Nothing\\Here', conversationId: 'coder-1' });
  t.equal(noop.success, true, 'releasing a resource nobody holds is a harmless no-op');
  t.equal(noop.released, false);
  const real = await store.release({ resourceType: 'workspace', resourceKey: 'C:\\Projects\\Orion', conversationId: 'coder-1' });
  t.equal(real.success, true);
  t.equal(real.released, true, 'the actual holder can release it');
  const reacquire = await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\Projects\\Orion', conversationId: 'operator-1' });
  t.equal(reacquire.success, true, 'once released, a different conversation can freely acquire it');
  t.end();
});

test('releaseAllForConversation sweeps every resource type held by that conversation and nothing else', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'coder-1' });
  await store.acquire({ resourceType: 'browser', resourceKey: 'x', conversationId: 'coder-1' });
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\A', conversationId: 'coder-1' });
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\B', conversationId: 'operator-1' });
  const result = await store.releaseAllForConversation('coder-1');
  t.equal(result.released.length, 3, 'all three of coder-1\'s leases are released');
  const remaining = await store.list({});
  t.equal(remaining.length, 1, 'operator-1\'s unrelated lease survives untouched');
  t.equal(remaining[0].conversationId, 'operator-1');
  t.end();
});

test('list() filters by resourceType, conversationId, and taskId', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\A', conversationId: 'coder-1', taskId: 'task_a' });
  await store.acquire({ resourceType: 'process', resourceKey: 'C:\\B', conversationId: 'coder-2', taskId: 'task_b' });
  await store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'operator-1', taskId: 'task_c' });
  t.equal((await store.list({ resourceType: 'workspace' })).length, 1);
  t.equal((await store.list({ conversationId: 'coder-2' })).length, 1);
  t.equal((await store.list({ taskId: 'task_c' })).length, 1);
  t.equal((await store.list({})).length, 3, 'no filters returns everything');
  t.end();
});

test('acquire validates its inputs instead of silently creating malformed leases', async t => {
  const { store } = makeTempStore(t);
  try {
    await store.acquire({ resourceType: 'not-a-real-type', resourceKey: 'x', conversationId: 'coder-1' });
    t.fail('an unknown resource type should throw');
  } catch (error) {
    t.equal(error.code, 'UNKNOWN_LEASE_RESOURCE_TYPE');
  }
  try {
    await store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: '' });
    t.fail('a missing conversationId should throw');
  } catch (error) {
    t.equal(error.code, 'LEASE_CONVERSATION_ID_REQUIRED');
  }
  try {
    await store.acquire({ resourceType: 'workspace', resourceKey: '', conversationId: 'coder-1' });
    t.fail('a workspace lease with no path should throw');
  } catch (error) {
    t.equal(error.code, 'LEASE_RESOURCE_KEY_REQUIRED');
  }
  t.end();
});

test('two concurrent acquire attempts for the same resource never both win - the actual collision guarantee', async t => {
  const { store } = makeTempStore(t);
  const [a, b] = await Promise.all([
    store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'coder-1' }),
    store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'operator-1' })
  ]);
  const winners = [a, b].filter(result => result.success && result.acquired);
  const losers = [a, b].filter(result => !result.success);
  t.equal(winners.length, 1, 'exactly one of the two concurrent acquires wins the lease');
  t.equal(losers.length, 1, 'the other is reported as a conflict, not silently dropped or silently granted');
  t.end();
});

test('reconcileInterrupted releases desktop/browser/workspace leases tied to an interrupted task immediately', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'coder-1', taskId: 'task_dead' });
  await store.acquire({ resourceType: 'browser', resourceKey: 'x', conversationId: 'coder-1', taskId: 'task_dead' });
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\A', conversationId: 'coder-1', taskId: 'task_dead' });
  const result = await store.reconcileInterrupted({ interruptedTaskIds: ['task_dead'] });
  t.equal(result.released.length, 3, 'all three renderer-owned resource types are released - none can survive an app restart');
  t.equal(result.flaggedForLivenessCheck.length, 0);
  t.equal((await store.list({})).length, 0, 'nothing remains leased');
  t.end();
});

test('reconcileInterrupted does NOT blindly release a process lease tied to an interrupted task - it flags for a liveness check instead', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({
    resourceType: 'process', resourceKey: 'C:\\Projects\\Orion', conversationId: 'coder-1',
    taskId: 'task_dead', processIds: ['4242']
  });
  const result = await store.reconcileInterrupted({ interruptedTaskIds: ['task_dead'] });
  t.equal(result.released.length, 0, 'the process lease is not released outright - the OS process may still be running');
  t.equal(result.flaggedForLivenessCheck.length, 1, 'it is flagged instead so the caller can actually check');
  t.equal(result.flaggedForLivenessCheck[0].processIds[0], '4242');
  const remaining = await store.list({});
  t.equal(remaining.length, 1, 'the lease is kept, not dropped, while its liveness is unresolved');
  t.equal(remaining[0].needsLivenessCheck, true);
  t.end();
});

test('reconcileInterrupted sweeps stale ad-hoc leases with no backing task, and leaves fresh unrelated leases alone', async t => {
  let now = 1000;
  const { store } = makeTempStore(t, { now: () => now, staleAfterMs: 5000 });
  await store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'coder-1' }); // no taskId
  await store.acquire({ resourceType: 'workspace', resourceKey: 'C:\\Fresh', conversationId: 'coder-2', taskId: 'task_alive' }); // not interrupted
  now += 6000;
  const result = await store.reconcileInterrupted({ interruptedTaskIds: ['task_nonexistent'] });
  t.equal(result.released.length, 1, 'the stale ad-hoc lease with no task is swept');
  const remaining = await store.list({});
  t.equal(remaining.length, 1);
  t.equal(remaining[0].resourceKey, normalizeResourceKey('workspace', 'C:\\Fresh'), 'the unrelated fresh, task-backed lease survives untouched');
  t.end();
});

test('resolveProcessLiveness releases a dead process lease and keeps a confirmed-alive one', async t => {
  const { store } = makeTempStore(t);
  await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Dead', conversationId: 'coder-1', taskId: 't1', processIds: ['1'] });
  await store.acquire({ resourceType: 'process', resourceKey: 'C:\\Alive', conversationId: 'coder-2', taskId: 't2', processIds: ['2'] });
  await store.reconcileInterrupted({ interruptedTaskIds: ['t1', 't2'] });

  const deadResolved = await store.resolveProcessLiveness({ resourceKey: 'C:\\Dead', stillAlive: false });
  t.equal(deadResolved.released, true, 'a process confirmed dead releases its lease');

  const aliveResolved = await store.resolveProcessLiveness({ resourceKey: 'C:\\Alive', stillAlive: true });
  t.equal(aliveResolved.released, false, 'a process confirmed still running keeps its lease');
  t.equal(aliveResolved.lease.needsLivenessCheck, false, 'the flag clears once resolved');

  const remaining = await store.list({});
  t.equal(remaining.length, 1);
  t.equal(remaining[0].resourceKey, normalizeResourceKey('workspace', 'C:\\Alive'));
  t.end();
});

test('a corrupt lease file does not crash startup - the store degrades to empty rather than throwing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-lease-store-corrupt-'));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'leases.json');
  fs.writeFileSync(filePath, '{not valid json', 'utf8');
  const store = new ResourceLeaseStore({ filePath });
  const listed = await store.list({});
  t.deepEqual(listed, [], 'a corrupt file reads as an empty lease set instead of throwing');
  const acquired = await store.acquire({ resourceType: 'desktop', resourceKey: 'x', conversationId: 'coder-1' });
  t.equal(acquired.success, true, 'the store is fully usable again after a corrupt read');
  t.end();
});

test('the module exports the documented default staleness window', t => {
  t.equal(DEFAULT_STALE_AFTER_MS, 5 * 60 * 1000, 'default stale-after window is 5 minutes');
  t.ok(RESOURCE_TYPES.DESKTOP && RESOURCE_TYPES.BROWSER && RESOURCE_TYPES.WORKSPACE && RESOURCE_TYPES.PROCESS, 'all four resource types are exported');
  t.end();
});
