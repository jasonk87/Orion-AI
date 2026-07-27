'use strict';

const test = require('tape');
const {
  SubmissionRegistry,
  createRequestId,
  fingerprint
} = require('../prompt-submission');

test('submission registry coalesces an in-flight duplicate request ID', async t => {
  const registry = new SubmissionRegistry();
  let executions = 0;
  let release;
  const operation = () => {
    executions += 1;
    return new Promise(resolve => { release = resolve; });
  };
  const input = {
    requestId: 'phone-request-1',
    conversationId: 'coder-1',
    source: 'phone',
    prompt: 'Build the feature'
  };
  const first = registry.run(input, operation);
  const duplicate = registry.run(input, operation);
  await Promise.resolve();
  t.equal(executions, 1, 'the duplicate does not start a second operation');
  t.equal(first, duplicate, 'both callers receive the same in-flight promise');
  release({ success: true });
  t.deepEqual(await duplicate, { success: true }, 'the duplicate receives the original result');
  t.end();
});

test('submission registry coalesces retry fingerprints when an old client has no request ID', async t => {
  const registry = new SubmissionRegistry({ now: () => 1000 });
  let executions = 0;
  const input = { conversationId: 'coder-2', source: 'phone', prompt: 'Run tests' };
  const first = registry.run(input, async () => ({ attempt: ++executions }));
  const second = registry.run({ ...input }, async () => ({ attempt: ++executions }));
  t.deepEqual(await first, { attempt: 1 }, 'first send executes');
  t.deepEqual(await second, { attempt: 1 }, 'same prompt retry reuses the result');
  t.equal(executions, 1, 'only one execution occurred');
  t.equal(fingerprint(input), fingerprint({ ...input }), 'fingerprints are stable');
  t.ok(/^prompt_/.test(createRequestId()), 'request IDs carry a recognizable prompt prefix');
  t.end();
});
