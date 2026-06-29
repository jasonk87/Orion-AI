'use strict';

const assert = require('assert');
const wordCount = require('./index.js');

(async () => {
  // Basic sentence
  const r1 = await wordCount({ text: 'Hello world. This is a test!' });
  assert.strictEqual(r1.wordCount, 6, 'wordCount should be 6');
  assert.strictEqual(r1.sentenceCount, 2, 'sentenceCount should be 2');
  assert.strictEqual(r1.charCount, 28, 'charCount should be 28');
  assert.strictEqual(r1.charCountNoSpaces, 23, 'charCountNoSpaces should be 23');

  // Empty string
  const r2 = await wordCount({ text: '' });
  assert.strictEqual(r2.wordCount, 0, 'empty text should have 0 words');
  assert.strictEqual(r2.charCount, 0, 'empty text should have 0 chars');

  // Single word (no terminal punctuation — counts as one sentence fragment)
  const r3 = await wordCount({ text: 'Orion' });
  assert.strictEqual(r3.wordCount, 1);
  assert.strictEqual(r3.sentenceCount, 1);

  console.log('word-count tests passed');
})().catch(e => { console.error(e); process.exit(1); });
