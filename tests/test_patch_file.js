const test = require('tape');
const proxyquire = require('proxyquire');

const main = proxyquire('../main.js', {
  'electron': {
    app: {
      whenReady: () => ({ then: () => {} }),
      on: () => {}
    },
    BrowserWindow: class {
      constructor() {}
      loadFile() {}
      isDestroyed() { return true; }
      static getAllWindows() { return []; }
    },
    ipcMain: {
      on: () => {},
      handle: () => {}
    },
    dialog: {}
  }
});

test('patch file - replace', (t) => {
  const original = 'hello world\nhello world';
  const op = { type: 'replace', target: 'world', replacement: 'earth', count: 2 };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, 'hello earth\nhello earth');
  t.end();
});

test('patch file - replace_regex', (t) => {
  const original = 'foo 123 bar 456';
  const op = { type: 'replace_regex', pattern: '\\d+', replacement: 'NUM', flags: 'g' };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, 'foo NUM bar NUM');
  t.end();
});

test('patch file - insert before and after', (t) => {
  const original = 'A B C';
  const opBefore = { type: 'insert', anchor: 'B', position: 'before', content: 'X ' };
  t.equal(main.applyPatch(original, opBefore).updated, 'A X B C');

  const opAfter = { type: 'insert', anchor: 'B', position: 'after', content: ' Y' };
  t.equal(main.applyPatch(original, opAfter).updated, 'A B Y C');
  t.end();
});

test('patch file - replace_range', (t) => {
  const original = 'line1\nline2\nline3\nline4\n';
  const op = { type: 'replace_range', startLine: 2, endLine: 3, content: 'new2\nnew3' };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, 'line1\nnew2\nnew3\nline4\n');
  t.end();
});

test('patch file - proof shows changed range and snippets', (t) => {
  const original = 'line1\nline2\nline3\nline4\n';
  const updated = 'line1\nnew2\nnew3\nline4\n';
  const proof = main.buildPatchProof(original, updated);
  t.equal(proof.startLine, 2, 'proof starts at first changed line');
  t.ok(proof.originalSnippet.includes('line2'), 'proof includes original content');
  t.ok(proof.updatedSnippet.includes('new2'), 'proof includes updated content');
  t.end();
});
