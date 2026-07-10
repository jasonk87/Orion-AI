'use strict';
const assert = require('assert');
const skill = require('./index.js');

(async () => {
  const result = await skill({});
  assert(result !== undefined, 'Skill must return a result');
  console.log('test-skill test passed:', JSON.stringify(result));
})().catch(e => { console.error(e); process.exit(1); });
