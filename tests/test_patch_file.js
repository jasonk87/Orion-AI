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

test('patch file - insert after a full line does not fuse tokens', (t) => {
  // Regression: "import sys" + insert-after "import random" must not become "import sysimport random".
  const original = 'import pygame\nimport sys\n\n# Initialize';
  const op = { type: 'insert', anchor: 'import sys', position: 'after', content: 'import random' };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, 'import pygame\nimport sys\nimport random\n\n# Initialize', 'inserted content lands on its own line');
  t.notOk(updated.includes('sysimport'), 'anchor and inserted token are not fused');
  t.end();
});

test('patch file - insert before a line-starting anchor does not fuse tokens', (t) => {
  const original = 'import pygame\nimport sys\n';
  const op = { type: 'insert', anchor: 'import sys', position: 'before', content: 'import random' };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, 'import pygame\nimport random\nimport sys\n', 'inserted content forms its own line above the anchor');
  t.end();
});

test('patch file - insert preserves content that already starts with a newline', (t) => {
  // Content that already starts with \n (common model usage) must be inserted verbatim — the
  // normalization only adds a newline when the content would otherwise fuse onto the anchor line.
  const original = '# Anchor\nrest';
  const op = { type: 'insert', anchor: '# Anchor', position: 'after', content: '\nclass Foo:\n    pass\n' };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, '# Anchor\nclass Foo:\n    pass\n\nrest', 'leading-newline content is inserted verbatim, no fusion');
  t.notOk(updated.includes('Anchor\nclass') === false, 'class starts on its own line after the anchor');
  t.end();
});

test('patch file - inline insert mid-line is unchanged', (t) => {
  // The anchor is not at a line edge, so no newline normalization should occur.
  const original = 'value = foo + bar';
  const op = { type: 'insert', anchor: 'foo', position: 'after', content: ' * 2' };
  const { updated } = main.applyPatch(original, op);
  t.equal(updated, 'value = foo * 2 + bar', 'mid-line insert stays inline');
  t.end();
});

test('patch file - insert refuses to duplicate content that already exists in the file', (t) => {
  // Regression: a retried/re-issued insert call with the same non-trivial content must not
  // silently duplicate a method/field. Short inserts (below the threshold) are still allowed.
  const original = 'class Player {\n  takeDamage(amount) {\n    this.hp -= amount;\n  }\n}\n';
  const op = {
    type: 'insert',
    anchor: 'class Player {',
    position: 'after',
    content: '\n  takeDamage(amount) {\n    this.hp -= amount;\n  }\n'
  };
  t.throws(() => main.applyPatch(original, op), /already exists/, 'duplicate non-trivial insert is rejected');
  t.end();
});

test('patch file - insert still allows short/trivial repeated content', (t) => {
  const original = 'A B C';
  const op = { type: 'insert', anchor: 'A', position: 'after', content: ' B' };
  t.doesNotThrow(() => main.applyPatch(original, op), 'short content below the duplicate-detection threshold is allowed');
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
