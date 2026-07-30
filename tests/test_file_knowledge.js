const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fk = require('../lib/file-knowledge');

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-fk-test-'));
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("v1");');
  fs.writeFileSync(path.join(root, 'util.js'), 'module.exports = 1;');
  return root;
}

test('recordFileRead stamps content identity and buildKnowledgeBrief buckets it as seen', (t) => {
  const root = makeWorkspace();
  try {
    const rec = fk.recordFileRead(root, 'app.js');
    t.equal(rec.recorded, 'app.js', 'read is recorded under the normalized relative path');
    t.ok(rec.hash, 'a content hash is stored');
    t.equal(rec.hadCurrentDigest, false, 'no digest exists yet');

    const brief = fk.buildKnowledgeBrief(root);
    t.deepEqual(brief.seenCurrent, ['app.js'], 'file is seen-but-unnoted while unchanged');
    t.equal(brief.knownCurrent.length, 0, 'nothing is known-current without a digest');
    t.equal(brief.changed.length, 0, 'nothing is marked changed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('saveFileDigest promotes a file to known-current, and content changes demote it', (t) => {
  const root = makeWorkspace();
  try {
    fk.recordFileRead(root, 'app.js');
    fk.saveFileDigest(root, 'app.js', 'Entry point; logs version.');

    let brief = fk.buildKnowledgeBrief(root);
    t.deepEqual(brief.knownCurrent, [{ path: 'app.js', digest: 'Entry point; logs version.' }], 'digest surfaces while the file is byte-identical');

    // Modify the file — the digest must stop surfacing (hash-gated freshness).
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log("v2 changed");');
    brief = fk.buildKnowledgeBrief(root);
    t.deepEqual(brief.changed, ['app.js'], 'changed content moves the file to the re-read bucket');
    t.equal(brief.knownCurrent.length, 0, 'a digest is never surfaced for changed content');

    // Re-reading the new version drops the outdated digest entirely.
    const rec = fk.recordFileRead(root, 'app.js');
    t.equal(rec.hadCurrentDigest, false, 'the old digest does not survive a content change');
    brief = fk.buildKnowledgeBrief(root);
    t.deepEqual(brief.seenCurrent, ['app.js'], 'file returns to seen-but-unnoted after re-read');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('a touch without a content change does not invalidate knowledge', (t) => {
  const root = makeWorkspace();
  try {
    fk.recordFileRead(root, 'app.js');
    fk.saveFileDigest(root, 'app.js', 'Entry point.');
    // Same bytes, new mtime.
    const full = path.join(root, 'app.js');
    fs.utimesSync(full, new Date(), new Date(Date.now() + 5000));
    const brief = fk.buildKnowledgeBrief(root);
    t.equal(brief.knownCurrent.length, 1, 'hash fallback keeps byte-identical files known-current despite a new mtime');
    t.equal(brief.changed.length, 0, 'a touch is not a change');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('deleted files are reported missing and paths cannot escape the workspace', (t) => {
  const root = makeWorkspace();
  try {
    fk.recordFileRead(root, 'util.js');
    fs.rmSync(path.join(root, 'util.js'));
    const brief = fk.buildKnowledgeBrief(root);
    t.deepEqual(brief.missing, ['util.js'], 'deleted tracked files are reported');

    t.throws(() => fk.recordFileRead(root, '..\\outside.txt'), /escapes/, 'workspace containment applies to ledger paths');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('the ledger caps tracked files by most recent read', (t) => {
  const root = makeWorkspace();
  try {
    for (let i = 0; i < 210; i++) {
      fs.writeFileSync(path.join(root, `f${i}.js`), `// file ${i}`);
      fk.recordFileRead(root, `f${i}.js`);
    }
    const ledger = fk.readLedger(root);
    t.ok(Object.keys(ledger.files).length <= 200, 'ledger stays within its size cap');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('agent wiring: read recording, notes tool, and run-start brief are connected', (t) => {
  const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  const preloadJs = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  t.ok(preloadJs.includes('orion:record-file-read') && preloadJs.includes('orion:save-file-digest') && preloadJs.includes('orion:get-knowledge-brief'), 'preload bridges all three ledger channels');
  t.ok(mainJs.includes("require('./lib/file-knowledge').registerHandlers"), 'main process registers the ledger handlers');
  t.ok(agentJs.includes('window.api.recordFileRead(workspacePath, args.path)'), 'full read_file reads stamp the ledger automatically');
  t.ok(agentJs.includes("case 'remember_file_notes'"), 'the notes tool is executable');
  t.ok(agentJs.includes('[FILE KNOWLEDGE'), 'the knowledge brief is injected at run start');
  t.ok(agentJs.includes("'read_notes', 'read_project_memory', 'remember_file_notes'"), 'Dispatch can save file notes too');
  t.end();
});
