'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const listRecent = require('./index.js');

(async () => {
  // Create a temp directory with a couple of files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-skill-test-'));

  try {
    fs.writeFileSync(path.join(tmpDir, 'recent.txt'), 'hello', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'recent2.txt'), 'world', 'utf8');

    // Should find both files within the last 7 days
    const r1 = await listRecent({ directory: tmpDir, days: 7 });
    assert.strictEqual(r1.count, 2, 'should find 2 recent files');
    assert(Array.isArray(r1.files), 'files should be an array');
    assert(r1.files.every(f => f.path && f.modified && typeof f.size === 'number'),
      'each file entry should have path, modified, size');

    // 0 days — should find nothing (files were just created, but cutoff is now)
    const r2 = await listRecent({ directory: tmpDir, days: 0 });
    // May or may not find the files depending on millisecond timing; just check shape
    assert(Array.isArray(r2.files), 'files should be an array even for 0-day window');
    assert.strictEqual(typeof r2.count, 'number');

    // Non-existent directory should throw
    let threw = false;
    try {
      await listRecent({ directory: path.join(tmpDir, 'nonexistent'), days: 7 });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'should throw for non-existent directory');

    console.log('list-recent tests passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
