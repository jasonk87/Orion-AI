// Orion carried ~48 empty `catch (_) {}` blocks. Most are correct — killing an already-dead
// child, unlinking a temp file that is already gone. A handful were not: every memory-file
// read falls back to an empty default on a parse error, so a corrupted global-memory file
// made Orion silently forget everything with no message anywhere, and a failed rollback in
// the atomic writer left the only surviving copy of a file at a random .bak sibling that
// nothing recorded.
//
// The recovery behavior is still correct and unchanged. What is tested here is that the
// evidence survives.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sinon = require('sinon');

const faultLog = require('../lib/fault-log');
const { atomicWriteTextSync } = require('../lib/atomic-json-store');

test('recordSwallowedFault never throws, whatever it is handed', (t) => {
  const warn = sinon.stub(console, 'warn');
  try {
    const circular = { name: 'loop' };
    circular.self = circular;

    for (const value of [new Error('boom'), 'a string', { code: 'ENOENT' }, circular, null, undefined, 42]) {
      t.doesNotThrow(
        () => faultLog.recordSwallowedFault('test:scope', value),
        `handles ${Object.prototype.toString.call(value)} without throwing`
      );
    }
    t.ok(warn.called, 'the fault reaches the console');
  } finally {
    warn.restore();
  }
  t.end();
});

test('a fault carries the scope and the actionable detail', (t) => {
  const warn = sinon.stub(console, 'warn');
  try {
    faultLog.recordSwallowedFault('memory:readGlobalMemory', new Error('Unexpected token }'));
    const [prefix, detail] = warn.firstCall.args;
    t.ok(String(prefix).includes('memory:readGlobalMemory'), 'the scope names what failed');
    t.ok(String(detail).includes('Unexpected token'), 'the underlying parse error survives');
  } finally {
    warn.restore();
  }
  t.end();
});

test('logging can be silenced without losing the fault', (t) => {
  const warn = sinon.stub(console, 'warn');
  const previous = process.env.ORION_QUIET_FAULT_LOG;
  process.env.ORION_QUIET_FAULT_LOG = '1';
  try {
    t.doesNotThrow(() => faultLog.recordSwallowedFault('test:quiet', new Error('quiet')),
      'quiet mode still records without throwing');
    t.notOk(warn.called, 'quiet mode suppresses console noise');
  } finally {
    if (previous === undefined) delete process.env.ORION_QUIET_FAULT_LOG;
    else process.env.ORION_QUIET_FAULT_LOG = previous;
    warn.restore();
  }
  t.end();
});

test('describe keeps the stack, which is the part worth logging', (t) => {
  const error = new Error('with a stack');
  t.ok(faultLog.describe(error).includes('with a stack'), 'the message survives');
  t.ok(faultLog.describe(error).includes('test_fault_log'), 'the stack survives');
  t.equal(faultLog.describe('plain'), 'plain', 'strings pass through');
  t.end();
});

// ── Atomic write rollback ──────────────────────────────────────────────────────

test('a normal atomic write replaces the file and leaves no litter', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-atomic-'));
  const target = path.join(dir, 'conv.json');
  try {
    atomicWriteTextSync(target, '{"v":1}');
    t.equal(fs.readFileSync(target, 'utf8'), '{"v":1}', 'the file is written');

    atomicWriteTextSync(target, '{"v":2}');
    t.equal(fs.readFileSync(target, 'utf8'), '{"v":2}', 'the file is replaced');

    const litter = fs.readdirSync(dir).filter(f => f !== 'conv.json');
    t.deepEqual(litter, [], 'no temp or backup files are left behind');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.end();
});

test('when a write cannot be rolled back, the surviving copy is findable', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-atomic-'));
  const target = path.join(dir, 'conv.json');
  const warn = sinon.stub(console, 'warn');
  const realRename = fs.renameSync;

  try {
    fs.writeFileSync(target, '{"original":true}', 'utf8');

    // Force the failure this guards: the replace fails, and so does putting the original
    // back. The original then exists only under its .bak sibling.
    let call = 0;
    sinon.stub(fs, 'renameSync').callsFake((from, to) => {
      call += 1;
      if (call === 1) throw new Error('EPERM: replace blocked');   // temp -> target
      if (call === 2) return realRename(from, to);                  // target -> backup
      if (call === 3) throw new Error('EPERM: replace blocked');    // temp -> target (retry)
      throw new Error('EPERM: rollback blocked');                   // backup -> target
    });

    let thrown = null;
    try {
      atomicWriteTextSync(target, '{"new":true}');
    } catch (error) {
      thrown = error;
    }
    fs.renameSync.restore();

    t.ok(thrown, 'the caller is told the write failed rather than believing it succeeded');
    t.ok(thrown.orionSurvivingBackupPath, 'the error carries the path the data survived at');
    t.ok(fs.existsSync(thrown.orionSurvivingBackupPath), 'that path really exists');
    t.equal(fs.readFileSync(thrown.orionSurvivingBackupPath, 'utf8'), '{"original":true}',
      'the original content is intact at the surviving path');

    const logged = warn.getCalls().map(c => c.args.join(' ')).join('\n');
    t.ok(logged.includes('atomic-write:rollback-failed'), 'the rollback failure is recorded, not swallowed');
    t.ok(logged.includes(path.basename(thrown.orionSurvivingBackupPath)),
      'the record names the surviving file so it can actually be recovered');
  } finally {
    if (fs.renameSync.restore) fs.renameSync.restore();
    warn.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.end();
});

// ── Memory reads ───────────────────────────────────────────────────────────────

// Scoped to a temp workspace on purpose: readGlobalMemory() reads the real ~/.orion file.
test('a corrupted memory file degrades to empty but says so', (t) => {
  const warn = sinon.stub(console, 'warn');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-mem-'));

  try {
    const memory = require('../lib/memory-manager');
    fs.mkdirSync(path.join(workspace, '.orion'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.orion', 'memory.json'), '{ this is not json', 'utf8');

    const result = memory.readProjectMemory(workspace);
    t.ok(result && typeof result === 'object', 'a corrupt file still yields a usable default');
    t.ok(Array.isArray(result.facts), 'the default shape is intact so callers do not crash');
    t.equal(result.facts.length, 0, 'no facts are invented from a corrupt file');

    const logged = warn.getCalls().map(c => c.args.join(' ')).join('\n');
    t.ok(/memory:readProjectMemory/.test(logged),
      'the user silently losing their memory file is recorded instead of swallowed');
  } finally {
    warn.restore();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  t.end();
});
