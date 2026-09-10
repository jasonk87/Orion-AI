'use strict';

const test = require('tape');
const assert = require('assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { CodexSubscription } = require('../lib/codex-subscription');
const provider = require('../codex-provider');
const { registerHandlers } = require('../lib/ipc-codex');

const MODEL = { id: 'account-model', model: 'account-model', displayName: 'Account model', hidden: false, isDefault: true, defaultReasoningEffort: 'low', inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'xhigh' }] };

function fakeServer(options = {}) {
  const calls = [];
  let launch;
  let count = 0;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; };
  const emit = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.stdin.on('data', buffer => {
    const request = JSON.parse(buffer.toString());
    calls.push(request);
    if (request.id === undefined || !request.method || options.hang === request.method) return;
    let result = {};
    if (request.method === 'account/read') result = { account: { type: options.authType || 'chatgpt', planType: 'test' } };
    if (request.method === 'model/list') result = { data: [MODEL], nextCursor: null };
    if (request.method === 'account/rateLimits/read') result = { rateLimits: { primary: { usedPercent: 10, resetsAt: 12345 } } };
    if (request.method === 'thread/start') result = { thread: { id: `thread-${++count}` } };
    if (request.method === 'turn/start') result = { turn: { id: `turn-${request.params.threadId}` } };
    setImmediate(() => {
      emit({ id: request.id, result });
      if (request.method === 'turn/start' && !options.waitForInterrupt) {
        const threadId = request.params.threadId;
        const text = request.params.input[0].text;
        emit({ method: 'item/agentMessage/delta', params: { threadId, itemId: 'answer', delta: text } });
        emit({ method: 'item/completed', params: { threadId, item: { id: 'answer', type: 'agentMessage', text, phase: 'final_answer' } } });
        emit({ method: 'turn/completed', params: { threadId, turn: { id: result.turn.id, status: 'completed', items: [] } } });
      }
    });
  });
  const service = new CodexSubscription({ executable: 'codex-test', requestTimeoutMs: options.timeout || 1000, turnTimeoutMs: options.turnTimeout || 1000,
    spawn: (exe, args, settings) => { launch = { exe, args, settings }; return child; } });
  return { service, calls, child, emit, get launch() { return launch; } };
}

const input = text => ({ model: MODEL.model, instructions: 'Test', input: [{ type: 'text', text }] });

test('Codex reuses ChatGPT auth, discovers account models, and exposes quota without API auth', async t => {
  const fake = fakeServer();
  try {
    const status = await fake.service.status();
    t.equal(status.connected, true);
    t.deepEqual(status.models, [MODEL]);
    t.equal(status.quota.rateLimits.primary.usedPercent, 10);
    t.notOk(fake.launch.settings.env.OPENAI_API_KEY, 'API key is not inherited');
    t.ok(fake.launch.args.includes('forced_login_method="chatgpt"'), 'server explicitly requires subscription login');
    t.notOk(fake.calls.some(call => call.method === 'account/login/start'), 'existing login is reused');
  } finally { fake.service.close(); t.end(); }
});

test('API-key authentication cannot silently charge an API account', async t => {
  const fake = fakeServer({ authType: 'apiKey' });
  try {
    await assert.rejects(fake.service.complete(input('hello')), /ChatGPT login/);
    t.notOk(fake.calls.some(call => call.method === 'turn/start'), 'no inference after wrong auth');
  } finally { fake.service.close(); t.end(); }
});

test('parallel comparison requests stream independently and preserve supplied context', async t => {
  const fake = fakeServer();
  try {
    const chunks = [[], []];
    const results = await Promise.all(['lane A history', 'lane B history'].map((text, index) => fake.service.complete(input(text), { onDelta: event => chunks[index].push(event.delta) })));
    t.equal(results[0].text, 'lane A history');
    t.equal(results[1].text, 'lane B history');
    t.notEqual(results[0].threadId, results[1].threadId, 'isolated official threads');
    t.deepEqual(chunks, [['lane A history'], ['lane B history']]);
    const starts = fake.calls.filter(call => call.method === 'thread/start');
    t.ok(starts.every(call => call.params.ephemeral && call.params.modelProvider === 'openai'));
    t.ok(starts.every(call => call.params.environments.length === 0), 'Orion retains action ownership');
  } finally { fake.service.close(); t.end(); }
});

test('explicit supported reasoning survives and unsupported reasoning fails before inference', async t => {
  const fake = fakeServer();
  try {
    await fake.service.complete({ ...input('test'), effort: 'xhigh', forcedEffort: true });
    t.equal(fake.calls.find(call => call.method === 'turn/start').params.effort, 'xhigh');
    await assert.rejects(fake.service.complete({ ...input('test'), effort: 'max', forcedEffort: true }), /does not support max/);
    await fake.service.complete({ ...input('test'), effort: 'high' });
    t.equal(fake.calls.filter(call => call.method === 'turn/start').at(-1).params.effort, 'low', 'automatic effort uses model default when unsupported');
    await assert.rejects(fake.service.complete({ ...input('test'), input: [{ type: 'image', url: 'data:image/png;base64,eA==' }] }), /does not accept images/);
  } finally { fake.service.close(); t.end(); }
});

test('stop interrupts the exact active turn and cleans up pending state', async t => {
  const fake = fakeServer({ waitForInterrupt: true });
  const controller = new AbortController();
  try {
    const run = fake.service.complete(input('wait'), { signal: controller.signal });
    const stopped = assert.rejects(run, /stopped/);
    while (!fake.calls.some(call => call.method === 'turn/start')) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await stopped;
    t.ok(fake.calls.some(call => call.method === 'turn/interrupt' && call.params.threadId === 'thread-1'));
    t.equal(fake.service.turns.size, 0);
  } finally { fake.service.close(); t.end(); }
});

test('hung handshake fails explicitly and retires the transport', async t => {
  const fake = fakeServer({ hang: 'initialize', timeout: 20 });
  try {
    await assert.rejects(fake.service.status(), /timed out/);
    t.equal(fake.child.killed, true);
    t.equal(fake.service.pending.size, 0);
  } finally { fake.service.close(); t.end(); }
});

test('hung inference times out and interrupts instead of leaving Thinking forever', async t => {
  const fake = fakeServer({ waitForInterrupt: true, turnTimeout: 30 });
  try {
    await assert.rejects(fake.service.complete(input('wait')), /timed out/);
    t.ok(fake.calls.some(call => call.method === 'turn/interrupt'));
    t.equal(fake.service.turns.size, 0);
  } finally { fake.service.close(); t.end(); }
});

test('Orion history, tools, and partial JSON streams retain their meaning', t => {
  const tools = [{ name: 'read_file', parameters: { type: 'object' } }];
  const messages = [
    { role: 'user', parts: [{ text: 'Remember blue.' }] },
    { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'a' } } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { text: 'contents' } } }] },
    { role: 'user', parts: [{ text: 'What color?' }] }
  ];
  const request = provider.buildRequest(messages, 'codex:account-model', 'system', tools);
  t.deepEqual(JSON.parse(request.input[0].text), messages, 'all roles and tool results preserved');
  t.deepEqual(provider.parseResponse('{"text":"Reading","toolCalls":[{"name":"read_file","arguments":"{\\"path\\":\\"a\\"}"}]}', tools), [{ text: 'Reading' }, { functionCall: { name: 'read_file', args: { path: 'a' } } }]);
  t.throws(() => provider.parseResponse('{"text":"","toolCalls":[{"name":"execute_anything","arguments":"{}"}]}', tools), /unavailable/);
  t.equal(provider.streamedText('{"text":"hello\\nwor', true), 'hello\nwor');
  t.equal(provider.streamedText('{"text":"hello\\u0', true), 'hello');
  t.equal(provider.streamedText('{"text":"hello","toolCalls":', true), 'hello', 'protocol never leaks into chat');
  t.end();
});

test('IPC cancellation is scoped to the requesting renderer', async t => {
  const handlers = {};
  const app = new EventEmitter();
  let signal;
  const service = { complete: async (_input, options) => { signal = options.signal; return new Promise(resolve => signal.addEventListener('abort', () => resolve({ text: 'stopped' }))); }, close() {} };
  registerHandlers({ handle: (name, fn) => { handlers[name] = fn; } }, { app, shell: {}, service });
  const sender = new EventEmitter(); sender.id = 1; sender.isDestroyed = () => false;
  const run = handlers['codex:complete']({ sender }, { requestId: 'one' });
  handlers['codex:cancel']({ sender: { id: 2 } }, 'one');
  t.equal(signal.aborted, false, 'another renderer cannot cancel this request');
  handlers['codex:cancel']({ sender }, 'one');
  await run;
  t.equal(signal.aborted, true);
  app.emit('before-quit');
  t.end();
});
