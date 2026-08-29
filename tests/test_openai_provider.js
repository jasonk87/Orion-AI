'use strict';

// ChatGPT (gpt-5.6-luna) as a model provider, on the Responses API rather than chat/completions.
//
// That endpoint choice is forced by the provider, not preference. gpt-5.6 rejects a
// chat/completions request that carries function tools AND asks for reasoning:
//   "Function tools with reasoning_effort are not supported for gpt-5.6-luna in
//    /v1/chat/completions."
// Orion sends function tools on every agent call and drives reasoning from its own policy, so
// Responses is the only endpoint where tools, reasoning effort, and image input coexist - which is
// exactly the three things this agent needs at once.
//
// The other constraint is a product decision Jason asked for: ChatGPT never routes up. Orion offers
// exactly one ChatGPT model, so there is no stronger sibling to escalate to, and swapping families
// mid-run would silently change both the provider and the bill behind an explicit selection.

process.env.NODE_ENV = 'test';
global.window = {};

const test = require('tape');
const agent = require('../agent');
const reasoningPolicy = require('../reasoning-policy');

const MODEL = 'gpt-5.6-luna';

// ── Reasoning is connected to Orion's policy ─────────────────────────────────

test("ChatGPT reasoning effort is driven by Orion's reasoning policy", t => {
  for (const effort of ['low', 'medium', 'high', 'max']) {
    t.deepEqual(reasoningPolicy.providerControls(MODEL, { effort }), { reasoning: { effort } },
      `effort "${effort}" reaches the model as the Responses reasoning field, mapped to itself`);
  }
  t.end();
});

test('the ChatGPT reasoning rule does not capture Ollama gpt-oss', t => {
  // gpt-oss is a local Ollama model whose reasoning field is a different control entirely. A
  // greedy /gpt/ pattern would hand it an OpenAI-shaped field it cannot use.
  t.deepEqual(reasoningPolicy.providerControls('gpt-oss:20b', { effort: 'high' }), { think: 'high' },
    'gpt-oss keeps its own think control');
  t.end();
});

test('existing providers keep the reasoning controls they had', t => {
  t.deepEqual(reasoningPolicy.providerControls('deepseek-v4-pro', { effort: 'max' }),
    { thinking: { type: 'enabled' }, reasoning_effort: 'max' }, 'DeepSeek is untouched');
  t.deepEqual(reasoningPolicy.providerControls('gemini-2.5-flash', { effort: 'low' }),
    { thinkingConfig: { thinkingBudget: 0 } }, 'and so is Gemini');
  t.end();
});

// ── No routing up ────────────────────────────────────────────────────────────

test('ChatGPT never escalates to a stronger model', t => {
  t.equal(agent.getNextModelForHighDemand(MODEL), null,
    'a deep task keeps running on the ChatGPT model the user selected');
  t.end();
});

test('escalation for every other provider is unchanged', t => {
  t.equal(agent.getNextModelForHighDemand('deepseek-v4-flash'), 'deepseek-v4-pro', 'DeepSeek flash still escalates');
  t.equal(agent.getNextModelForHighDemand('deepseek-v4-pro'), null, 'and pro still has nowhere to go');
  t.end();
});

test('ChatGPT utility calls stay on ChatGPT', t => {
  t.equal(agent.resolveUtilityModelName(MODEL), MODEL,
    'bookkeeping uses the selected model rather than requiring a second provider key');
  t.equal(agent.resolveUtilityModelName('claude-opus-5'), 'gemini-2.5-flash-lite', 'Claude is unchanged');
  t.equal(agent.resolveUtilityModelName('deepseek-v4-pro'), 'deepseek-v4-flash', 'DeepSeek is unchanged');
  t.end();
});

// ── The request actually sent ────────────────────────────────────────────────

function captureRequest(t, handler) {
  const original = global.fetch;
  let captured = null;
  global.fetch = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return handler(captured);
  };
  t.teardown(() => { global.fetch = original; });
  return () => captured;
}

function responsesOk(output, extra = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: 'resp_1', object: 'response', output, ...extra }),
    text: async () => ''
  };
}

const textOutput = text => [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }];

test('the request goes to the Responses endpoint with bearer auth and the selected model', async t => {
  const captured = captureRequest(t, () => responsesOk(textOutput('done')));
  await agent.callOpenAIAPI([{ role: 'user', parts: [{ text: 'hello' }] }], MODEL, 'sk-test', () => {}, true);
  const request = captured();
  t.equal(request.url, 'https://api.openai.com/v1/responses', 'the Responses endpoint, not chat/completions');
  t.equal(request.init.headers.Authorization, 'Bearer sk-test', 'bearer auth');
  t.equal(request.body.model, MODEL, 'the selected ChatGPT model');
  t.ok(request.body.instructions && request.body.instructions.length > 0,
    'the system prompt rides in `instructions`, which is where Responses takes it');
  t.equal('messages' in request.body, false, 'and there is no chat/completions messages array');
  t.end();
});

test('function tools and reasoning effort are sent TOGETHER, which is the whole reason for this endpoint', async t => {
  const captured = captureRequest(t, () => responsesOk(textOutput('ok')));
  await agent.callOpenAIAPI([{ role: 'user', parts: [{ text: 'hi' }] }], MODEL, 'sk-test', () => {}, false, {
    reasoningPolicy: { effort: 'high' }
  });
  const body = captured().body;
  t.deepEqual(body.reasoning, { effort: 'high' }, 'the reasoning effort Orion chose is sent');
  t.ok(Array.isArray(body.tools) && body.tools.length > 0, 'alongside the function tools');
  const tool = body.tools[0];
  t.equal(tool.type, 'function', 'declared as a function tool');
  t.ok(typeof tool.name === 'string' && tool.name.length > 0,
    'with the name FLAT on the tool, not nested under a function wrapper');
  t.equal('function' in tool, false, 'the chat/completions nesting is absent');
  t.equal('temperature' in body, false, 'and no temperature, which the GPT-5 reasoning family rejects');
  t.end();
});

test('an image is sent as Responses image input, not the chat/completions shape', async t => {
  const captured = captureRequest(t, () => responsesOk(textOutput('I see a window')));
  await agent.callOpenAIAPI([{
    role: 'user',
    parts: [
      { text: 'what is on screen?' },
      { inlineData: { mimeType: 'image/png', data: 'AAAABBBB' } }
    ]
    // disableTools=false matters: the tool-free path runs sanitizeMessagesForTextOnly, which keeps
    // text parts only and drops images by design. Vision belongs to the normal agent turn.
  }], MODEL, 'sk-test', () => {}, false);
  const content = captured().body.input[0].content;
  const image = content.find(part => part.type === 'input_image');
  const text = content.find(part => part.type === 'input_text');
  t.ok(text, 'the text part uses input_text');
  t.ok(image, 'the image part uses input_image');
  t.equal(typeof image.image_url, 'string',
    'image_url is a plain string here - chat/completions wraps it in an object, Responses does not');
  t.equal(image.image_url, 'data:image/png;base64,AAAABBBB', 'carrying the base64 data URL');
  t.end();
});

test('a missing OpenAI key fails with an actionable message instead of a network error', async t => {
  try {
    await agent.callOpenAIAPI([{ role: 'user', parts: [{ text: 'hi' }] }], MODEL, '', () => {}, true);
    t.fail('an unconfigured key should not reach the network');
  } catch (error) {
    t.match(error.message, /OpenAI API key is not configured/i, 'names the missing key');
    t.match(error.message, /Settings/i, 'and where to add it');
  }
  t.end();
});

// ── The response translated back ─────────────────────────────────────────────

test('a function_call item becomes the functionCall shape the agent loop consumes', async t => {
  captureRequest(t, () => responsesOk([
    { id: 'rs_1', type: 'reasoning', summary: [] },
    { id: 'fc_1', type: 'function_call', call_id: 'call_abc', name: 'read_file', arguments: '{"path":"a.js"}' }
  ]));
  const result = await agent.callOpenAIAPI([{ role: 'user', parts: [{ text: 'read it' }] }], MODEL, 'sk-test', () => {}, false);
  const call = result.candidates[0].content.parts.find(part => part.functionCall);
  t.ok(call, 'a tool call is present');
  t.equal(call.functionCall.name, 'read_file', 'with its name');
  t.deepEqual(call.functionCall.args, { path: 'a.js' }, 'and arguments parsed from the JSON string');
  t.equal(call.functionCall._openaiCallId, 'call_abc', 'and the call_id retained for result correlation');
  t.equal(result._orionActiveModelName, MODEL, 'the active model is reported back to the loop');
  t.end();
});

test('a tool result is replayed as a call_id-correlated item, not as a role message', async t => {
  const captured = captureRequest(t, () => responsesOk(textOutput('done')));
  await agent.callOpenAIAPI([
    { role: 'user', parts: [{ text: 'read it' }] },
    { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'a.js' }, _openaiCallId: 'call_abc' } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { content: 'hello' } } }] }
  ], MODEL, 'sk-test', () => {}, false);
  const input = captured().body.input;
  const call = input.find(item => item.type === 'function_call');
  const output = input.find(item => item.type === 'function_call_output');
  t.ok(call && output, 'both the call and its result are present as top-level items');
  t.equal(call.call_id, 'call_abc', 'the call keeps the id the model issued');
  t.equal(output.call_id, 'call_abc', 'and the result is correlated to that exact id');
  t.end();
});

test('a truncated response surfaces as an actionable error the loop can react to', async t => {
  captureRequest(t, () => responsesOk(textOutput('partial'), {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' }
  }));
  const result = await agent.callOpenAIAPI([{ role: 'user', parts: [{ text: 'go' }] }], MODEL, 'sk-test', () => {}, true);
  const error = result.candidates[0].content.parts.find(part => part.functionCall && part.functionCall.name === 'SYSTEM_ERROR');
  t.ok(error, 'truncation is reported rather than silently returning a partial answer');
  t.match(error.functionCall.args.error, /truncated/i, 'and says so');
  t.end();
});

// ── The provider it shares a file with is unaffected ─────────────────────────

test('DeepSeek still uses chat/completions with its own reasoning field', async t => {
  const captured = captureRequest(t, () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    text: async () => ''
  }));
  await agent.callDeepSeekAPI([{ role: 'user', parts: [{ text: 'hi' }] }], 'deepseek-v4-pro', 'sk-ds', () => {}, true);
  const request = captured();
  t.equal(request.url, 'https://api.deepseek.com/chat/completions', 'still its own endpoint');
  t.equal(request.init.headers.Authorization, 'Bearer sk-ds', 'still its own key');
  t.equal(request.body.reasoning_effort, 'max', 'and still the chat/completions reasoning field ChatGPT cannot accept');
  t.end();
});
