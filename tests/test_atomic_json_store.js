const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWriteJsonSync, enqueueFileWrite } = require('../lib/atomic-json-store');

test('atomic JSON writes use unique temporary siblings and leave valid data', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-atomic-json-'));
  const file = path.join(dir, 'memory.json');
  try {
    atomicWriteJsonSync(file, { revision: 1 });
    atomicWriteJsonSync(file, { revision: 2 });
    t.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { revision: 2 }, 'latest complete payload is readable');
    const residue = fs.readdirSync(dir).filter(name => /\.(tmp|bak)-/.test(name));
    t.deepEqual(residue, [], 'temporary and backup siblings are cleaned up');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.end();
});

test('atomic JSON writes support compact serialization for bounded caches', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-atomic-json-compact-'));
  const file = path.join(dir, 'cache.json');
  try {
    atomicWriteJsonSync(file, { revision: 1, files: {} }, { trailingNewline: true, space: 0 });
    t.equal(
      fs.readFileSync(file, 'utf8'),
      '{"revision":1,"files":{}}\n',
      'compact output remains valid and includes the requested trailing newline'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.end();
});

test('per-file queue serializes overlapping mutations', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-write-queue-'));
  const file = path.join(dir, 'memory.json');
  const order = [];
  try {
    const first = enqueueFileWrite(file, async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      order.push('first');
      atomicWriteJsonSync(file, { revision: 1 });
    });
    const second = enqueueFileWrite(file, async () => {
      order.push('second');
      atomicWriteJsonSync(file, { revision: 2 });
    });
    await Promise.all([first, second]);
    t.deepEqual(order, ['first', 'second'], 'later operations wait for the active file write');
    t.equal(JSON.parse(fs.readFileSync(file, 'utf8')).revision, 2, 'serialized final write wins cleanly');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.end();
});
