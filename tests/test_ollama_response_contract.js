'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
const test = require('tape');
const agent = require('../agent');

test('Ollama keeps generated guidance out of the user role without parsing user text', async t => {
  const original = global.fetch;
  t.teardown(() => { global.fetch = original; });
  let request;
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ done: true, done_reason: 'stop', message: { content: 'Hi there.' } }) };
  };
  await agent.callOllamaAPI([
    { role: 'user', parts: [{ text: "What's up?" }] },
    { role: 'user', internalContext: true, parts: [{ text: 'Internal phase guidance' }] },
    { role: 'user', parts: [{ text: '[REASONING POLICY: user-supplied literal]' }] }
  ], 'ollama:local-model', () => {}, true);
  t.equal(request.messages.find(message => message.content === 'Internal phase guidance').role, 'system');
  t.equal(request.messages.find(message => message.content === "What's up?").role, 'user');
  t.equal(request.messages.at(-1).role, 'user', 'user-owned policy-looking text is never reclassified');
  t.notOk(request.tools, 'text-only replies carry no tool catalog');
  t.ok(request.options.num_ctx >= 8192, 'context budget is explicit');
  t.equal(request.options.num_predict, 2048, 'generation has a finite reply budget');
  t.end();
});

test('structured conversational disposition selects compact local context without keyword rules', t => {
  const intent = { intent: 'conversation', requiresExecution: false, memoryIntent: 'none', inspectionTarget: 'none' };
  t.ok(agent.isPlainOllamaConversation(intent, 'orion', ''));
  t.ok(agent.isPlainOllamaConversation({ ...intent, classifierUnavailable: true }, 'orion', ''), 'non-executing classifier fallback needs conversational context too');
  for (const changes of [{ requiresExecution: true }, { needsClarification: true },
    { memoryIntent: 'recall' }, { memoryContext: { needed: true } }, { inspectionTarget: 'workspace' }, { intent: 'new_task' }]) {
    t.notOk(agent.isPlainOllamaConversation({ ...intent, ...changes }, 'orion', ''), JSON.stringify(changes));
  }
  t.notOk(agent.isPlainOllamaConversation(intent, 'coder', ''));
  t.notOk(agent.isPlainOllamaConversation(intent, 'orion', 'task-1'));
  t.end();
});

test('plain local context preserves real dialogue, private same-thread summaries and attached images', t => {
  const context = agent.buildPlainOllamaContext([
    { role: 'user', text: '[COMPACTED CONTEXT SUMMARY]\nEarlier we chose a red bicycle.', source: 'context-compaction', internalContext: true },
    { role: 'user', text: 'I like Comet.' },
    { role: 'assistant', text: 'Comet fits.' },
    { role: 'assistant', text: 'Unrelated runtime scaffolding', source: 'agent-status' },
    { role: 'user', text: 'Which name did I like?' }
  ], 'Which name did I like?', [{ data: 'aW1hZ2U=', mimeType: 'image/png' }]);
  t.deepEqual(context.messages.map(message => message.role), ['user', 'model', 'user']);
  t.deepEqual(context.messages.map(message => message.parts.at(-1).text), ['I like Comet.', 'Comet fits.', 'Which name did I like?']);
  t.ok(context.systemInstruction.includes('Earlier we chose a red bicycle.'), 'private compaction preserves this conversation');
  t.notOk(JSON.stringify(context).includes('Unrelated runtime scaffolding'));
  t.equal(context.messages.at(-1).parts[0].inline_data.data, 'aW1hZ2U=', 'current image survives');
  const fresh = agent.buildPlainOllamaContext([], 'You received some updates.');
  t.equal(fresh.messages[0].parts[0].text, 'You received some updates.', 'not restricted to greeting keywords');
  t.notOk(fresh.systemInstruction.includes('Earlier we chose'), 'no cross-conversation leakage');
  t.end();
});

test('context allocation includes tools, respects model limits and rejects oversized requests', t => {
  window.getOllamaModelInfo = () => ({ contextLength: 16384 });
  t.teardown(() => { delete window.getOllamaModelInfo; });
  const small = agent.ollamaRequestOptions([{ role: 'user', content: 'Hi' }], [], 'ollama:local');
  const large = agent.ollamaRequestOptions([{ role: 'user', content: 'Hi' }], [{ description: 'x'.repeat(20000) }], 'ollama:local');
  t.equal(small.num_ctx, 8192);
  t.ok(large.num_ctx > small.num_ctx, 'tool payload contributes to context sizing');
  t.ok(large.num_ctx <= 16384);
  t.equal(agent.ollamaRequestOptions([{ role: 'user', content: 'Describe this.', images: ['x'.repeat(1000000)] }]).num_ctx, 8192,
    'base64 image bytes are not miscounted as text tokens');
  t.throws(() => agent.ollamaRequestOptions([{ content: 'x'.repeat(40000) }], [], 'ollama:local'), /context budget/);
  t.end();
});

test('Ollama completion state survives normalization; missing, empty and failed responses cannot succeed', async t => {
  const original = global.fetch;
  t.teardown(() => { global.fetch = original; });
  let body = { done: true, done_reason: 'length', message: { content: 'It is September 1', thinking: 'private' } };
  global.fetch = async () => ({ ok: true, json: async () => body });
  const call = () => agent.callOllamaAPI([], 'ollama:local', () => {}, true);
  const limited = await call();
  t.equal(limited.candidates[0].finishReason, 'MAX_TOKENS', 'partial sentence requests continuation, not completion');
  t.equal(agent.extractVisibleModelText(limited), 'It is September 1', 'private thinking stays private');
  body = { done: true, done_reason: 'stop', message: { content: 'Hello.' } };
  t.equal((await call()).candidates[0].finishReason, 'STOP');
  for (const incomplete of [{ done: false, message: { content: 'partial' } }, { done: true, message: { thinking: 'private' } }, { error: 'backend failed' }]) {
    body = incomplete;
    try { await call(); t.fail('incomplete response must throw'); } catch (error) { t.ok(error.message); }
  }
  t.end();
});

test('lightweight local conversation uses Ollama with true history and system roles, never Gemini', async t => {
  const original = global.fetch;
  t.teardown(() => { global.fetch = original; });
  const calls = [];
  let reason = 'stop';
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ done: true, done_reason: reason, message: { content: 'Comet.' } }) };
  };
  const history = [{ role: 'user', content: 'I like Comet.' }, { role: 'assistant', content: 'A good name.' }, { role: 'user', content: 'Which name?' }];
  const result = await window.quickOrionLLMCall('Answer the actual latest message.', history, { modelName: 'ollama:deepseek-r1:8b' });
  t.equal(result, 'Comet.');
  t.equal(calls[0].url, 'http://localhost:11434/api/chat');
  t.equal(calls[0].body.model, 'deepseek-r1:8b');
  t.deepEqual(calls[0].body.messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
  t.equal(calls[0].body.messages.at(-1).content, 'Which name?');
  reason = 'length';
  try { await window.quickOrionLLMCall('Reply.', history, { modelName: 'ollama:local' }); t.fail('quick reply must reject truncation'); }
  catch (error) { t.match(error.message, /output limit/); }
  t.end();
});
