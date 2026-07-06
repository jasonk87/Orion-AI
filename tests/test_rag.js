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

const { chunkText, cosineSimilarity } = main;

test('RAG - chunkText splits text into segments correctly', (t) => {
  const content = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join('\n');
  const chunks = chunkText(content, 100, 20);
  
  t.ok(chunks.length > 1, 'splits into multiple chunks');
  t.equal(chunks[0].startLine, 1, 'first chunk starts at line 1');
  t.ok(chunks[0].text.includes('Line 1'), 'first chunk contains line 1');
  t.equal(chunks[chunks.length - 1].endLine, 50, 'last chunk ends at line 50');
  t.ok(chunks[chunks.length - 1].text.includes('Line 50'), 'last chunk contains line 50');
  t.end();
});

test('RAG - cosineSimilarity computes similarity correctly', (t) => {
  const vecA = [1, 0, 0];
  const vecB = [1, 0, 0];
  const vecC = [0, 1, 0];
  const vecD = [-1, 0, 0];

  t.equal(cosineSimilarity(vecA, vecB), 1, 'identical vectors have similarity 1');
  t.equal(cosineSimilarity(vecA, vecC), 0, 'orthogonal vectors have similarity 0');
  t.equal(cosineSimilarity(vecA, vecD), -1, 'opposite vectors have similarity -1');
  
  const vecE = [1, 1, 0];
  const sim = cosineSimilarity(vecA, vecE);
  t.ok(sim > 0.7 && sim < 0.71, 'computes correct partial similarity');
  t.end();
});
