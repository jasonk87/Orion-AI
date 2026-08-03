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

// Regression: Google retired text-embedding-004 and its 404 silently killed semantic search
// app-wide. The model id now resolves from config with a current default.
test('Gemini embedding model resolves from config with a current default', (t) => {
  const { GEMINI_EMBEDDING_MODEL_DEFAULT, resolveGeminiEmbeddingModel } = require('../lib/embedding-config');
  t.notEqual(GEMINI_EMBEDDING_MODEL_DEFAULT, 'text-embedding-004', 'default is no longer the retired model');
  t.equal(resolveGeminiEmbeddingModel({}), GEMINI_EMBEDDING_MODEL_DEFAULT, 'empty config falls back to the default');
  t.equal(resolveGeminiEmbeddingModel({ geminiEmbeddingModel: ' custom-model ' }), 'custom-model', 'configured override wins, trimmed');

  const fs = require('fs');
  const path = require('path');
  const workspaceJs = fs.readFileSync(path.join(__dirname, '../lib/ipc-workspace.js'), 'utf8');
  const semanticJs = fs.readFileSync(path.join(__dirname, '../lib/semantic-search.js'), 'utf8');
  const indexServiceJs = fs.readFileSync(path.join(__dirname, '../lib/workspace-index-service.js'), 'utf8');
  t.notOk(/models\/text-embedding-004|gemini:text-embedding-004/.test(workspaceJs + semanticJs + indexServiceJs), 'no code path still calls the retired model (comments may mention it)');
  t.ok(workspaceJs.includes('indexData.embeddingModel !== embeddingModel'), 'stored vector index invalidates on model change');
  t.ok(workspaceJs.includes('outdated embedding model'), 'search refuses to compare vectors across models and triggers a rebuild');
  t.end();
});

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
