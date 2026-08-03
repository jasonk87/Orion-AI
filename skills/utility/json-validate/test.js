'use strict';

const assert = require('assert');
const jsonValidate = require('./index.js');

(async () => {
  // Valid JSON object
  const r1 = await jsonValidate({ text: '{"key": "value", "num": 42}' });
  assert.strictEqual(r1.valid, true);
  assert.strictEqual(r1.parsed.key, 'value');
  assert.strictEqual(r1.parsed.num, 42);
  assert.strictEqual(r1.error, undefined);

  // Valid JSON array
  const r2 = await jsonValidate({ text: '[1, 2, 3]' });
  assert.strictEqual(r2.valid, true);
  assert.deepStrictEqual(r2.parsed, [1, 2, 3]);

  // Invalid JSON
  const r3 = await jsonValidate({ text: '{not: valid}' });
  assert.strictEqual(r3.valid, false);
  assert(typeof r3.error === 'string', 'error should be a string');
  assert.strictEqual(r3.parsed, undefined);

  // Empty string (invalid)
  const r4 = await jsonValidate({ text: '' });
  assert.strictEqual(r4.valid, false);

  console.log('json-validate tests passed');
})().catch(e => { console.error(e); process.exit(1); });
