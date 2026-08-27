'use strict';

// Automatic (idle-triggered) memory extraction bypassed every guarantee the explicit
// remember_fact / remember_preference path enforces, and the existing memory tests only exercise
// the tool path — so none of this was covered. Five separate defects, all reproduced below:
//
//   1. Provider was chosen by WHICH API KEY EXISTS, not by which provider owns config.modelName.
//      With a Gemini key present and Claude/DeepSeek selected, it posted a foreign model name to
//      the Gemini endpoint and silently extracted nothing.
//   2. Every failure was swallowed by `catch (e) { /* silent */ }`.
//   3. The conversation was marked processed BEFORE the model call, so one transient error
//      permanently suppressed memory for that conversation for the rest of the process.
//   4. A conversation could only ever be summarized once, so material after a second idle period
//      was never considered.
//   5. Every extracted item went to GLOBAL memory regardless of what it was, defeating the scope
//      guarantee the tool path enforces.

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false, json: async () => ({}) });

const test = require('tape');
const agent = require('../agent');

const WORKSPACE = 'C:\\Projects\\OrionAI';

function conversation(id, userTurns = 3) {
  const messages = [];
  for (let i = 0; i < userTurns; i += 1) {
    messages.push({ role: 'user', text: 'User turn ' + i + ' with something durable in it.' });
    messages.push({ role: 'assistant', text: 'Assistant reply ' + i });
  }
  return { id, createdAt: Date.now(), messages };
}

// Captures what automatic memory actually persisted, and which model/provider it asked.
function installMemoryApi(overrides = {}) {
  const calls = { globalFacts: [], globalPreferences: [], projectFacts: [], sessions: [] };
  global.window.api = {
    appendGlobalFact: async (text, category, config) => {
      calls.globalFacts.push({ text, category }); return { success: true };
    },
    appendGlobalPreference: async (text, config, source) => {
      calls.globalPreferences.push({ text, source }); return { success: true };
    },
    appendProjectFact: async (workspacePath, text, category) => {
      calls.projectFacts.push({ workspacePath, text, category }); return { success: true };
    },
    saveSession: async (workspacePath, session) => {
      calls.sessions.push({ workspacePath, session }); return { success: true };
    },
    ...overrides
  };
  return calls;
}

// Stands in for the network. Records the model name the extraction actually requested, so a
// provider/model mismatch is observable instead of silent.
function installExtractionResponder(responder) {
  const seen = [];
  global.fetch = async (url, request = {}) => {
    const body = request.body ? JSON.parse(request.body) : {};
    const target = String(url);
    const model = body.model || (target.match(/models\/([^:]+):/) || [])[1] || '';
    seen.push({ url: target, model });
    return responder({ url: target, model, body });
  };
  return seen;
}

function geminiJson(payload) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
  };
}

function deepseekJson(payload) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] })
  };
}

test('extraction routes by the selected model provider, not by whichever API key exists first', async t => {
  agent.__resetOrionMemoryWatermarks();
  installMemoryApi();
  // Both keys present, DeepSeek selected. The old code checked geminiApiKey first and posted
  // "deepseek-v4-flash" to the Gemini endpoint.
  const seen = installExtractionResponder(({ url }) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
    }
    return deepseekJson({ items: [], session: { summary: '' } });
  });

  await agent.autoSaveOrionMemory(
    conversation('conv_provider'),
    { modelName: 'deepseek-v4-flash', geminiApiKey: 'gem-key', deepseekApiKey: 'ds-key' },
    WORKSPACE,
    'orion'
  );

  const gemini = seen.filter(call => call.url.includes('generativelanguage.googleapis.com'));
  const deepseek = seen.filter(call => call.url.includes('api.deepseek.com'));
  t.equal(gemini.length, 0, 'a DeepSeek model is never posted to the Gemini endpoint');
  t.ok(deepseek.length >= 1, 'it reaches the provider that actually owns the selected model');
  t.end();
});

test('a failed extraction does not permanently suppress memory for that conversation', async t => {
  agent.__resetOrionMemoryWatermarks();
  const calls = installMemoryApi();
  const conv = conversation('conv_retry');
  let attempt = 0;

  installExtractionResponder(() => {
    attempt += 1;
    if (attempt === 1) return { ok: false, status: 500, json: async () => ({}) };
    return geminiJson({
      items: [{ type: 'fact', scope: 'global', text: 'Jason prefers concise status updates.' }],
      session: { summary: '' }
    });
  });

  const config = { modelName: 'gemini-2.5-flash', geminiApiKey: 'gem-key' };
  await agent.autoSaveOrionMemory(conv, config, WORKSPACE, 'orion');
  t.equal(calls.globalFacts.length, 0, 'nothing is stored when extraction fails');
  t.equal(agent.__getOrionMemoryWatermark('conv_retry'), undefined,
    'and the watermark is NOT advanced, so the material stays eligible');

  // Second idle period: the same conversation is retried rather than being permanently skipped.
  await agent.autoSaveOrionMemory(conv, config, WORKSPACE, 'orion');
  t.equal(calls.globalFacts.length, 1, 'the retry succeeds and the memory is finally stored');
  t.ok(agent.__getOrionMemoryWatermark('conv_retry') > 0, 'only now does the watermark advance');
  t.end();
});

test('a conversation can contribute memory more than once as it continues', async t => {
  agent.__resetOrionMemoryWatermarks();
  const calls = installMemoryApi();
  const conv = conversation('conv_second_pass', 2);

  let pass = 0;
  installExtractionResponder(() => {
    pass += 1;
    return geminiJson({
      items: [{ type: 'fact', scope: 'global', text: 'Durable fact from pass ' + pass }],
      session: { summary: '' }
    });
  });
  const config = { modelName: 'gemini-2.5-flash', geminiApiKey: 'gem-key' };

  await agent.autoSaveOrionMemory(conv, config, WORKSPACE, 'orion');
  t.equal(calls.globalFacts.length, 1, 'the first idle period records what it saw');
  const firstWatermark = agent.__getOrionMemoryWatermark('conv_second_pass');

  // The conversation continues after the break and covers new ground.
  conv.messages.push({ role: 'user', text: 'Later I decided something else entirely.' });
  conv.messages.push({ role: 'assistant', text: 'Noted.' });
  conv.messages.push({ role: 'user', text: 'And one more durable thing.' });
  conv.messages.push({ role: 'assistant', text: 'Understood.' });

  await agent.autoSaveOrionMemory(conv, config, WORKSPACE, 'orion');
  t.equal(calls.globalFacts.length, 2,
    'a later idle period records the new material instead of being skipped as already-summarized');
  t.ok(agent.__getOrionMemoryWatermark('conv_second_pass') > firstWatermark,
    'the watermark advances past what the second pass consumed');
  t.end();
});

test('automatically extracted memory honours scope instead of globalizing everything', async t => {
  agent.__resetOrionMemoryWatermarks();
  const calls = installMemoryApi();
  installExtractionResponder(() => geminiJson({
    items: [
      { type: 'fact', scope: 'global', text: 'Jason works on Windows with a Tailscale network.' },
      { type: 'fact', scope: 'project', text: 'OrionAI keeps conversations in per-file JSON.' },
      { type: 'preference', scope: 'global', text: 'Jason prefers plain prose over bullet dumps.' },
      { type: 'fact', text: 'An item the model could not scope at all.' }
    ],
    session: { summary: '' }
  }));

  await agent.autoSaveOrionMemory(
    conversation('conv_scope'),
    { modelName: 'gemini-2.5-flash', geminiApiKey: 'gem-key' },
    WORKSPACE,
    'orion'
  );

  t.deepEqual(calls.globalFacts.map(f => f.text), ['Jason works on Windows with a Tailscale network.'],
    'only the genuinely global fact reached global memory');
  t.deepEqual(calls.projectFacts.map(f => f.text), ['OrionAI keeps conversations in per-file JSON.'],
    'the project-specific fact is bound to the workspace it was learned in');
  t.equal(calls.projectFacts[0].workspacePath, WORKSPACE, 'and to the right workspace');
  t.deepEqual(calls.globalPreferences.map(p => p.text), ['Jason prefers plain prose over bullet dumps.'],
    'a global preference still goes to preferences');
  t.notOk(calls.globalFacts.some(f => /could not scope/.test(f.text)),
    'an unscoped item is dropped rather than silently globalized');
  t.end();
});

test('a project-scoped item is dropped rather than globalized when there is no workspace', async t => {
  agent.__resetOrionMemoryWatermarks();
  const calls = installMemoryApi();
  installExtractionResponder(() => geminiJson({
    items: [{ type: 'fact', scope: 'project', text: 'Something specific to a project.' }],
    session: { summary: '' }
  }));

  await agent.autoSaveOrionMemory(
    conversation('conv_no_workspace'),
    { modelName: 'gemini-2.5-flash', geminiApiKey: 'gem-key' },
    '',
    'orion'
  );

  t.equal(calls.globalFacts.length, 0, 'it does not fall back to global memory');
  t.equal(calls.projectFacts.length, 0, 'and there is no workspace to bind it to');
  t.end();
});

test('a conversation with too little new material is left alone', async t => {
  agent.__resetOrionMemoryWatermarks();
  const calls = installMemoryApi();
  const seen = installExtractionResponder(() => geminiJson({ items: [], session: { summary: '' } }));

  await agent.autoSaveOrionMemory(
    { id: 'conv_short', createdAt: Date.now(), messages: [{ role: 'user', text: 'hi' }] },
    { modelName: 'gemini-2.5-flash', geminiApiKey: 'gem-key' },
    WORKSPACE,
    'orion'
  );

  t.equal(seen.length, 0, 'no extraction call is made for a one-turn conversation');
  t.equal(calls.globalFacts.length, 0, 'and nothing is stored');
  t.end();
});
