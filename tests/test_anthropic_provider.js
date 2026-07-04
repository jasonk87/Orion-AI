// Slice 2: Claude/Anthropic as a model provider. These cover the format conversions (Gemini's
// canonical tool/message shape -> Anthropic's), the response normalization back to Gemini's
// candidates shape, and that the agent loop actually routes claude-* models to the Anthropic
// endpoint while keeping cheap utility calls on Gemini.
const test = require('tape');
global.window = global.window || {};
const agent = require('../agent.js');

test('convertGeminiToAnthropicTools maps declarations to Anthropic input_schema with lowercase JSON-schema types', (t) => {
  const declarations = [{
    name: 'grep_search',
    description: 'search files',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'text' },
        maxResults: { type: 'NUMBER' },
        opts: { type: 'OBJECT', properties: { deep: { type: 'BOOLEAN' } } },
        globs: { type: 'ARRAY', items: { type: 'STRING' } }
      },
      required: ['pattern']
    }
  }];
  const [tool] = agent.convertGeminiToAnthropicTools(declarations);
  t.equal(tool.name, 'grep_search', 'name is preserved');
  t.equal(tool.description, 'search files', 'description is preserved');
  t.equal(tool.input_schema.type, 'object', 'top-level type is lowercased');
  t.equal(tool.input_schema.properties.pattern.type, 'string', 'property type is lowercased');
  t.equal(tool.input_schema.properties.opts.properties.deep.type, 'boolean', 'nested object property type is lowercased');
  t.equal(tool.input_schema.properties.globs.items.type, 'string', 'array item type is lowercased');
  t.deepEqual(tool.input_schema.required, ['pattern'], 'required is preserved');
  t.end();
});

test('convertGeminiToAnthropicTools defaults an empty parameter schema to a valid object schema', (t) => {
  const [tool] = agent.convertGeminiToAnthropicTools([{ name: 'get_workspace_info', description: 'info', parameters: { type: 'OBJECT', properties: {} } }]);
  t.equal(tool.input_schema.type, 'object', 'type defaults to object');
  t.deepEqual(tool.input_schema.properties, {}, 'properties defaults to empty object');
  t.end();
});

test('convertGeminiToAnthropicMessages threads tool_use ids through to the matching tool_result', (t) => {
  const messages = [
    { role: 'user', parts: [{ text: 'fix the bug' }] },
    { role: 'model', parts: [{ text: 'reading the file' }, { functionCall: { name: 'read_file', args: { path: 'server.js' } } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { content: 'code here' } } }] }
  ];
  const out = agent.convertGeminiToAnthropicMessages(messages);
  t.equal(out[0].role, 'user', 'first message is the user turn');
  t.equal(out[1].role, 'assistant', 'second message is the assistant turn');
  const toolUse = out[1].content.find(b => b.type === 'tool_use');
  t.ok(toolUse, 'assistant turn contains a tool_use block');
  t.equal(toolUse.name, 'read_file', 'tool_use carries the tool name');
  t.deepEqual(toolUse.input, { path: 'server.js' }, 'tool_use carries the args as input');
  t.equal(out[2].role, 'user', 'tool result is delivered as a user message (Anthropic convention)');
  const toolResult = out[2].content.find(b => b.type === 'tool_result');
  t.equal(toolResult.tool_use_id, toolUse.id, 'tool_result references the exact id of its matching tool_use');
  t.end();
});

test('convertGeminiToAnthropicMessages merges consecutive same-role messages into one', (t) => {
  const messages = [
    { role: 'user', parts: [{ text: 'do the thing' }] },
    { role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'list_files', response: { files: [] } } }] },
    { role: 'user', parts: [{ text: '[USER STEERING FEEDBACK: hurry up]' }] }
  ];
  const out = agent.convertGeminiToAnthropicMessages(messages);
  // The tool_result user message and the steering user message must merge — Anthropic requires
  // alternating roles and rejects two consecutive user messages.
  const roles = out.map(m => m.role);
  for (let i = 1; i < roles.length; i++) {
    t.notEqual(roles[i], roles[i - 1], `no two consecutive same-role messages (index ${i})`);
  }
  const mergedUser = out[out.length - 1];
  t.equal(mergedUser.role, 'user', 'final merged message is a user turn');
  t.ok(mergedUser.content.some(b => b.type === 'tool_result'), 'merged content keeps the tool_result');
  t.ok(mergedUser.content.some(b => b.type === 'text' && /STEERING/.test(b.text)), 'merged content keeps the steering text');
  t.end();
});

test('callAnthropicAPI posts to the Anthropic endpoint with the right headers and normalizes the reply to Gemini shape', async (t) => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'Ill read the file first.' },
          { type: 'tool_use', id: 'toolu_x', name: 'read_file', input: { path: 'server.js' } }
        ],
        stop_reason: 'tool_use'
      })
    };
  };
  try {
    const messages = [{ role: 'user', parts: [{ text: 'fix it' }] }];
    const result = await agent.callAnthropicAPI(messages, 'claude-sonnet-5', 'sk-ant-test', () => {}, false, {});

    t.equal(captured.url, 'https://api.anthropic.com/v1/messages', 'posts to the Anthropic messages endpoint');
    t.equal(captured.opts.headers['x-api-key'], 'sk-ant-test', 'sends the api key header');
    t.ok(captured.opts.headers['anthropic-version'], 'sends an anthropic-version header');
    t.equal(captured.opts.headers['anthropic-dangerous-direct-browser-access'], 'true', 'sends the browser-access header so the renderer-origin request is allowed');

    const body = JSON.parse(captured.opts.body);
    t.equal(body.model, 'claude-sonnet-5', 'requests the selected claude model');
    t.ok(typeof body.system === 'string' && body.system.length > 0, 'passes the system instruction as a top-level string');
    t.ok(Array.isArray(body.tools) && body.tools.length > 0, 'includes the tool schema when tools are enabled');
    t.ok(body.max_tokens > 0, 'sets a max_tokens ceiling (Anthropic requires it)');

    const parts = result.candidates[0].content.parts;
    t.equal(parts[0].text, 'Ill read the file first.', 'text block normalizes to a Gemini text part');
    t.equal(parts[1].functionCall.name, 'read_file', 'tool_use block normalizes to a Gemini functionCall');
    t.deepEqual(parts[1].functionCall.args, { path: 'server.js' }, 'tool_use input normalizes to functionCall args');
    t.equal(result._orionActiveModelName, 'claude-sonnet-5', 'reports the active model back to the loop');
  } finally {
    global.fetch = originalFetch;
  }
  t.end();
});

test('callAnthropicAPI throws a clear non-retryable error when no api key is configured', async (t) => {
  try {
    await agent.callAnthropicAPI([{ role: 'user', parts: [{ text: 'hi' }] }], 'claude-sonnet-5', '', () => {}, false, {});
    t.fail('should have thrown without an api key');
  } catch (e) {
    t.ok(/api key/i.test(e.message), 'error explains the missing Anthropic key');
    t.ok(e.nonRetryable, 'the missing-key error is marked non-retryable');
  }
  t.end();
});

test('resolveUtilityModelName routes claude models to cheap Gemini for utility/bookkeeping calls', (t) => {
  t.equal(agent.resolveUtilityModelName('claude-opus-4-8'), 'gemini-2.5-flash-lite', 'claude main model uses cheap Gemini for utility calls');
  t.equal(agent.resolveUtilityModelName('claude-sonnet-5'), 'gemini-2.5-flash-lite', 'any claude model maps to the cheap utility model');
  // Existing behavior preserved:
  t.equal(agent.resolveUtilityModelName('gemini-2.5-pro'), 'gemini-2.5-flash-lite', 'gemini families still collapse to their cheapest tier');
  t.equal(agent.resolveUtilityModelName('llama3'), 'llama3', 'non-Gemini, non-Claude models pass through unchanged');
  t.end();
});

test('the agent loop dispatches claude-* models to callAnthropicAPI', (t) => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  t.ok(agentSource.includes("activeRunModelName.startsWith('claude')"), 'the loop branches on a claude-* model name');
  t.ok(agentSource.includes('callAnthropicAPI(messagesForApiCall, activeRunModelName, config.anthropicApiKey'),
    'the claude branch calls callAnthropicAPI with the anthropic api key');
  t.end();
});
