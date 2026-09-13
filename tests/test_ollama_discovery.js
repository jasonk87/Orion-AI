'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
const test = require('tape');
const { createOllamaDiscovery, registerHandlers } = require('../lib/ipc-ollama');
const { loadRenderer } = require('./helpers/renderer-harness');
const agent = require('../agent');
const reply = body => ({ ok: true, json: async () => body });

test('Ollama discovers installed names and capabilities, deduplicates and caches by digest', async t => {
  const calls = [];
  let digest = 'one';
  const discover = createOllamaDiscovery({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/tags')) return reply({ models: [
      { name: 'deepseek-r1:8b', digest }, { name: 'deepseek-r1:8b', digest }, { name: 'vector:latest', digest: 'vector' }, { name: null }
    ] });
    const name = JSON.parse(options.body).model;
    return reply({ capabilities: name === 'vector:latest' ? ['embedding'] : ['completion', 'thinking'],
      model_info: { 'general.architecture': 'local', 'local.context_length': digest === 'one' ? 16384 : 32768 } });
  } });
  const first = discover();
  t.equal(discover(), first, 'concurrent callers share discovery');
  const result = await first;
  t.deepEqual(result.models.map(model => model.value), ['ollama:deepseek-r1:8b', 'ollama:vector:latest']);
  t.deepEqual(result.models[0].capabilities, ['completion', 'thinking']);
  t.equal(result.models[0].contextLength, 16384, 'context budget comes from the installed model metadata');
  t.equal((await discover()).models[0].contextLength, 16384, 'cached metadata retains context length');
  t.equal(calls.filter(call => call.url.endsWith('/show')).length, 2, 'unchanged models reuse capability metadata');
  digest = 'two';
  t.equal((await discover()).models[0].contextLength, 32768, 'changed model refreshes its context budget');
  t.equal(calls.filter(call => call.url.endsWith('/show')).length, 3, 'changed model refreshes capabilities');
  t.ok(calls.every(call => /^http:\/\/127\.0\.0\.1:11434\/api\/(tags|show)$/.test(call.url)), 'discovery never downloads or generates');
  const handlers = {};
  registerHandlers({ handle: (name, handler) => { handlers[name] = handler; } });
  t.equal(typeof handlers['ollama:models'], 'function', 'main-process endpoint registered');
  t.end();
});

test('Ollama discovery has bounded failure and does not hide models with unavailable metadata', async t => {
  const unavailable = await createOllamaDiscovery({ fetchImpl: async () => { throw new Error('connection refused'); } })();
  t.equal(unavailable.success, false);
  const timed = await createOllamaDiscovery({ timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) })();
  t.match(timed.error, /timed out/);
  const partial = await createOllamaDiscovery({ fetchImpl: async url => {
    if (url.endsWith('/tags')) return reply({ models: [{ name: 'custom-model:v1' }] });
    throw new Error('show not supported');
  } })();
  t.equal(partial.models[0].value, 'ollama:custom-model:v1');
  t.equal(partial.models[0].capabilities, null, 'unknown capability is not mistaken for embedding-only');
  const invalid = await createOllamaDiscovery({ fetchImpl: async () => reply({}) })();
  t.equal(invalid.success, false, 'malformed list is not an empty successful refresh');
  t.end();
});

function catalog(names) {
  return { success: true, connected: true, models: names.map(name => ({
    name, value: `ollama:${name}`, capabilities: name === 'vectors' ? ['embedding'] : ['completion', 'vision', 'tools']
  })) };
}

test('installed Ollama models appear on desktop and phone, update automatically, and retain selection', async t => {
  let result = catalog(['deepseek-r1:8b', 'qwen:4b', 'vectors']);
  let calls = 0;
  const timers = [];
  const { win } = loadRenderer({ t, api: { ollamaModels: async () => { calls++; return result; } } });
  win.setInterval = (callback, ms) => { timers.push({ callback, ms }); return 10; };
  win.localStorage.setItem('ag2_default_model', 'deepseek-r1:8b');
  await win.initModelDropdown();
  t.equal(win.getPhoneCompanionModels().current, 'ollama:deepseek-r1:8b', 'legacy local model migrates to an explicit provider');
  t.deepEqual(Array.from(win.getPhoneCompanionModels().models).filter(model => model.group === 'Ollama (Local)').map(model => model.value),
    ['ollama:deepseek-r1:8b', 'ollama:qwen:4b'], 'embedding-only models are omitted from agent choices');
  t.ok(win.getOllamaModelInfo('ollama:qwen:4b').capabilities.includes('vision'));
  await win.setPhoneCompanionModel('ollama:qwen:4b');
  const first = win.refreshOllamaModels();
  t.equal(win.refreshOllamaModels(), first, 'renderer deduplicates refreshes');
  await first;
  t.equal(win.document.querySelectorAll('[data-ollama-models]').length, 1);
  result = catalog(['qwen:4b', 'new-model:1b']);
  await timers.find(timer => timer.ms === 30000).callback();
  t.ok(win.getPhoneCompanionModels().models.some(model => model.value === 'ollama:new-model:1b'), 'poll discovers newly installed model');
  t.equal(win.getPhoneCompanionModels().current, 'ollama:qwen:4b', 'poll does not change the selected model');
  result = { success: false, error: 'offline' };
  await win.refreshOllamaModels();
  t.equal(win.getPhoneCompanionModels().current, 'ollama:qwen:4b', 'outage does not change provider');
  t.ok(win.getPhoneCompanionModels().models.some(model => model.value === 'ollama:new-model:1b'), 'last good catalog survives outage');
  result = catalog([]);
  await win.refreshOllamaModels();
  t.equal(win.getPhoneCompanionModels().current, 'ollama:qwen:4b', 'removed selected model is kept as unavailable');
  t.equal(win.document.querySelectorAll('[data-ollama-unavailable]').length, 1);
  result = catalog(['qwen:4b']);
  await win.refreshOllamaModels();
  t.equal(win.document.querySelectorAll('[data-ollama-unavailable]').length, 0, 'recovery removes unavailable placeholder');
  t.ok(calls >= 6);
  t.end();
});

test('offline saved Ollama preference and cloud selections do not switch providers', async t => {
  const { win } = loadRenderer({ t, api: { ollamaModels: async () => ({ success: false, error: 'offline' }) } });
  win.localStorage.setItem('ag2_default_model', 'ollama:local:latest');
  await win.initModelDropdown();
  t.equal(win.getPhoneCompanionModels().current, 'ollama:local:latest');
  await win.setPhoneCompanionModel('deepseek-v4-flash');
  await win.refreshOllamaModels();
  t.equal(win.getPhoneCompanionModels().current, 'deepseek-v4-flash');
  t.end();
});

test('local cloud-like names stay on Ollama for agent, utility and vision calls', async t => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return reply({ done: true, done_reason: 'stop', message: { content: '{"status":"satisfied","confidence":1,"observations":["visible"]}' } });
  };
  t.teardown(() => { global.fetch = originalFetch; delete window.getOllamaModelInfo; });
  window.getOllamaModelInfo = () => ({ capabilities: ['completion', 'vision'] });
  const selected = 'ollama:deepseek-r1:8b';
  t.equal(agent.resolveUtilityModelName(selected), selected);
  await agent.callOllamaAPI([{ role: 'user', parts: [{ text: 'Hello' }, { inlineData: { mimeType: 'image/png', data: 'test-image' } }] }], selected, () => {}, true);
  await agent.callUtilityModel('Classify', selected, {});
  await agent.inspectScreenshotWithModel({ modelName: selected, imageBase64: 'vision-image', goal: 'visible', path: 'capture.png', apiKey: 'unused-cloud-key' });
  t.equal(requests.length, 3);
  t.ok(requests.every(request => request.url === 'http://localhost:11434/api/chat'), 'no cloud request or API billing');
  t.ok(requests.every(request => request.body.model === 'deepseek-r1:8b'), 'provider prefix stripped only at HTTP boundary');
  t.deepEqual(requests[0].body.messages.find(message => message.role === 'user').images, ['test-image'], 'multimodal prompt reaches local model');
  t.deepEqual(requests[2].body.messages[0].images, ['vision-image']);
  t.equal(agent.ollamaApiModelName('llama3.2:latest'), 'llama3.2:latest', 'legacy direct calls still work');
  await agent.callOllamaAPI([], 'ollama:qwen3-vl:2b-instruct', () => {}, true, { reasoningPolicy: { effort: 'high' } });
  await agent.callUtilityModel('Classify', 'ollama:qwen3-vl:2b-instruct', {});
  t.notOk('think' in requests[3].body, 'chat omits unsupported thinking controls using discovered capabilities');
  t.notOk('think' in requests[4].body, 'utility also omits unsupported thinking controls');
  window.getOllamaModelInfo = () => ({ capabilities: ['completion', 'thinking'] });
  await agent.callOllamaAPI([], 'ollama:qwen3.5:4b', () => {}, true, { reasoningPolicy: { effort: 'high' } });
  t.equal(requests[5].body.think, 'high', 'thinking models still receive the requested effort');
  t.end();
});
