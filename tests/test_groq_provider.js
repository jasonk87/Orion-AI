'use strict';

process.env.NODE_ENV = 'test';
global.window = global.window || {};

const test = require('tape');
const agent = require('../agent');
const reasoningPolicy = require('../reasoning-policy');

const QWEN_VISION = 'groq:qwen/qwen3.6-27b';
const QWEN_REASONING = 'groq:qwen/qwen3.8-27b';
const GPT_OSS = 'groq:openai/gpt-oss-120b';

function captureFetch(t, responseFactory) {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return responseFactory(captured);
  };
  t.teardown(() => { global.fetch = originalFetch; });
  return () => captured;
}

function chatOk(message) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ finish_reason: 'stop', message }] }),
    text: async () => ''
  };
}

test('Groq reasoning controls honor Auto policy output and explicit user effort', t => {
  t.deepEqual(reasoningPolicy.providerControls(GPT_OSS, { effort: 'max' }),
    { reasoning_effort: 'high' }, 'GPT-OSS maps Orion Ultra to Groq high');
  t.deepEqual(reasoningPolicy.providerControls(QWEN_REASONING, { effort: 'medium' }),
    { reasoning_effort: 'medium' }, 'Qwen 3.8 accepts the explicit medium choice');
  t.deepEqual(reasoningPolicy.providerControls(QWEN_VISION, { effort: 'low' }),
    { reasoning_effort: 'none' }, 'Qwen 3.6 low uses non-thinking mode');
  t.deepEqual(reasoningPolicy.providerControls(QWEN_VISION, { effort: 'high' }),
    { reasoning_effort: 'default' }, 'Qwen 3.6 higher effort enables its supported thinking mode');
  t.end();
});

test('Groq chat completions receives Orion tools without leaking the internal model prefix', async t => {
  const captured = captureFetch(t, () => chatOk({
    reasoning: 'I should inspect the file.',
    content: 'Reading it now.',
    tool_calls: [{ id: 'groq_call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"agent.js"}' } }]
  }));

  const result = await agent.callGroqAPI(
    [{ role: 'user', parts: [{ text: 'inspect agent.js' }] }],
    QWEN_REASONING,
    'gsk-test',
    () => {},
    false,
    { reasoningPolicy: { effort: 'high' } }
  );

  const request = captured();
  t.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions', 'uses Groq OpenAI-compatible chat completions');
  t.equal(request.init.headers.Authorization, 'Bearer gsk-test', 'uses the configured Groq bearer key');
  t.equal(request.body.model, 'qwen/qwen3.8-27b', 'strips only Orion\'s provider prefix at the HTTP boundary');
  t.equal(request.body.reasoning_effort, 'high', 'passes the resolved reasoning effort');
  t.equal(request.body.reasoning_format, 'parsed', 'keeps private reasoning separate from visible content');
  t.notOk(Object.prototype.hasOwnProperty.call(request.body, 'temperature'), 'does not impose an incompatible temperature');
  t.ok(Array.isArray(request.body.tools) && request.body.tools.length > 0, 'sends Orion local function tools');

  const parts = result.candidates[0].content.parts;
  t.equal(parts[0].thought, true, 'parsed Groq reasoning remains hidden');
  t.equal(parts[1].text, 'Reading it now.', 'visible Groq content remains visible');
  t.equal(parts[2].functionCall.name, 'read_file', 'Groq tool calls normalize into Orion function calls');
  t.equal(result._orionActiveModelName, QWEN_REASONING, 'the durable model identity retains the Groq prefix');
  t.end();
});

test('Groq Qwen 3.6 receives attached images directly', async t => {
  const captured = captureFetch(t, () => chatOk({ content: 'I see the screenshot.' }));
  await agent.callGroqAPI([{
    role: 'user',
    parts: [
      { text: 'What is visible?' },
      { inlineData: { mimeType: 'image/png', data: 'AAAABBBB' } }
    ]
  }], QWEN_VISION, 'gsk-test', () => {}, false, { reasoningPolicy: { effort: 'low' } });

  const userContent = captured().body.messages.find(message => message.role === 'user').content;
  const image = userContent.find(part => part.type === 'image_url');
  t.ok(image, 'the multimodal model receives an image_url content block');
  t.equal(image.image_url.url, 'data:image/png;base64,AAAABBBB', 'the image bytes use Groq\'s documented data URL shape');
  t.equal(captured().body.reasoning_effort, 'none', 'low effort uses Qwen 3.6 non-thinking mode');
  t.end();
});

test('vision routing distinguishes Groq multimodal and text-only models', t => {
  t.equal(agent.modelSupportsDirectVision(QWEN_VISION), true, 'Qwen 3.6 stays on Groq for images');
  t.equal(agent.modelSupportsDirectVision(QWEN_REASONING), false, 'Qwen 3.8 uses the explicit Gemini vision route');
  t.equal(agent.modelSupportsDirectVision(GPT_OSS), false, 'GPT-OSS is treated as text-only');
  t.equal(agent.getNextModelForHighDemand(QWEN_VISION), null, 'vision capability never creates a quality-escalation tier');
  t.end();
});

test('Groq Qwen 3.6 performs screenshot verification without Gemini', async t => {
  const captured = captureFetch(t, () => chatOk({
    content: JSON.stringify({
      status: 'appears_satisfied',
      confidence: 0.9,
      observations: ['The requested window is visible.'],
      missing: [],
      recommendation: 'Continue.'
    })
  }));

  const result = await agent.inspectScreenshotWithGroq({
    imageBase64: 'AAAABBBB',
    mimeType: 'image/png',
    path: 'screen.png',
    goal: 'Show the requested window',
    modelName: QWEN_VISION,
    apiKey: 'gsk-test'
  });

  t.equal(captured().body.model, 'qwen/qwen3.6-27b', 'screenshot inspection uses the selected Groq vision model');
  t.equal(captured().body.reasoning_effort, 'none', 'bounded perception does not spend thinking tokens');
  t.equal(result.status, 'appears_satisfied', 'the visual result normalizes into Orion evidence');
  t.match(result.summary, /qwen\/qwen3\.6-27b/, 'evidence names the actual provider model');
  t.end();
});

test('Groq missing-key and utility routing remain provider-local', async t => {
  t.equal(agent.resolveUtilityModelName(GPT_OSS), GPT_OSS, 'utility work stays on the selected Groq model');
  try {
    await agent.callGroqAPI([{ role: 'user', parts: [{ text: 'hi' }] }], GPT_OSS, '', () => {}, true);
    t.fail('an unconfigured Groq key should not reach the network');
  } catch (error) {
    t.match(error.message, /Groq API key is not configured/i, 'missing key error names Groq and Settings');
    t.equal(error.nonRetryable, true, 'missing credentials never enter a retry loop');
  }
  t.end();
});
