// DeepSeek V4 Flash/Pro as a model provider. DeepSeek's API is OpenAI-compatible chat completions
// (confirmed against the live API docs): POST https://api.deepseek.com/chat/completions, Bearer
// auth, an OpenAI-shaped tools array, and tool_calls/tool_call_id threading in message history —
// flatter than Anthropic's nested content blocks (one {role:'tool', tool_call_id, content} message
// per tool call). These tests cover the conversions, the request/response shape, and that the
// escalation chain generalized to "the pro version of itself" for DeepSeek as requested.
const test = require('tape');
global.window = global.window || {};
const agent = require('../agent.js');

test('convertGeminiToDeepSeekTools maps declarations to OpenAI-shaped function tools with lowercase JSON-schema types', (t) => {
  const declarations = [{
    name: 'grep_search',
    description: 'search files',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING' },
        maxResults: { type: 'NUMBER' }
      },
      required: ['pattern']
    }
  }];
  const [tool] = agent.convertGeminiToDeepSeekTools(declarations);
  t.equal(tool.type, 'function', 'wraps the declaration as an OpenAI-style function tool');
  t.equal(tool.function.name, 'grep_search', 'name is preserved');
  t.equal(tool.function.description, 'search files', 'description is preserved');
  t.equal(tool.function.parameters.type, 'object', 'schema type is lowercased');
  t.equal(tool.function.parameters.properties.pattern.type, 'string', 'property type is lowercased');
  t.deepEqual(tool.function.parameters.required, ['pattern'], 'required is preserved');
  t.end();
});

test('convertGeminiToDeepSeekMessages threads tool_call_id through to the matching tool-result message', (t) => {
  const messages = [
    { role: 'user', parts: [{ text: 'fix the bug' }] },
    { role: 'model', parts: [{ text: 'reading the file' }, { functionCall: { name: 'read_file', args: { path: 'server.js' } } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { content: 'code here' } } }] }
  ];
  const out = agent.convertGeminiToDeepSeekMessages(messages);
  t.equal(out[0].role, 'user', 'first message is the user turn');
  t.equal(out[1].role, 'assistant', 'second message is the assistant turn');
  const toolCall = out[1].tool_calls[0];
  t.equal(toolCall.type, 'function', 'the tool call is OpenAI-shaped');
  t.equal(toolCall.function.name, 'read_file', 'tool call carries the tool name');
  t.deepEqual(JSON.parse(toolCall.function.arguments), { path: 'server.js' }, 'tool call arguments are JSON-stringified args');
  t.equal(out[2].role, 'tool', 'the tool result is its own flat tool-role message (not nested content blocks)');
  t.equal(out[2].tool_call_id, toolCall.id, 'the tool result references the exact id of its matching tool call');
  t.end();
});

test('callDeepSeekAPI posts to the DeepSeek endpoint with Bearer auth and normalizes the reply to Gemini shape', async (t) => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: "I'll read the file first.",
            tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'read_file', arguments: '{"path":"server.js"}' } }]
          }
        }]
      })
    };
  };
  try {
    const messages = [{ role: 'user', parts: [{ text: 'fix it' }] }];
    const result = await agent.callDeepSeekAPI(messages, 'deepseek-v4-pro', 'sk-test', () => {}, false, {});

    t.equal(captured.url, 'https://api.deepseek.com/chat/completions', 'posts to the DeepSeek chat completions endpoint');
    t.equal(captured.opts.headers['Authorization'], 'Bearer sk-test', 'sends Bearer auth with the configured key');

    const body = JSON.parse(captured.opts.body);
    t.equal(body.model, 'deepseek-v4-pro', 'requests the selected deepseek model');
    t.equal(body.messages[0].role, 'system', 'the system instruction is the first message (OpenAI convention)');
    t.ok(Array.isArray(body.tools) && body.tools.length > 0, 'includes the tool schema when tools are enabled');

    const parts = result.candidates[0].content.parts;
    t.equal(parts[0].text, "I'll read the file first.", 'content normalizes to a Gemini text part');
    t.equal(parts[1].functionCall.name, 'read_file', 'tool_calls normalize to a Gemini functionCall');
    t.deepEqual(parts[1].functionCall.args, { path: 'server.js' }, 'stringified arguments are parsed back into functionCall args');
    t.equal(result._orionActiveModelName, 'deepseek-v4-pro', 'reports the active model back to the loop');
  } finally {
    global.fetch = originalFetch;
  }
  t.end();
});

test('callDeepSeekAPI throws a clear non-retryable error when no api key is configured', async (t) => {
  try {
    await agent.callDeepSeekAPI([{ role: 'user', parts: [{ text: 'hi' }] }], 'deepseek-v4-flash', '', () => {}, false, {});
    t.fail('should have thrown without an api key');
  } catch (e) {
    t.ok(/api key/i.test(e.message), 'error explains the missing DeepSeek key');
    t.ok(e.nonRetryable, 'the missing-key error is marked non-retryable');
  }
  t.end();
});

test('resolveUtilityModelName routes deepseek models to deepseek-v4-flash for utility/bookkeeping calls', (t) => {
  t.equal(agent.resolveUtilityModelName('deepseek-v4-pro'), 'deepseek-v4-flash', 'deepseek pro uses its own cheap flash tier for utility calls');
  t.equal(agent.resolveUtilityModelName('deepseek-v4-flash'), 'deepseek-v4-flash', 'deepseek flash is already the cheap tier');
  t.end();
});

// The user explicitly asked: "add the escalation for them to be the flash/pro version of itself" —
// getNextModelForHighDemand generalizes the existing Gemini-only escalation chain so DeepSeek
// (and Gemini) both work, while providers with no defined next tier (Claude, Ollama) still return
// null, unchanged from before this generalization.
test('getNextModelForHighDemand escalates deepseek-v4-flash to deepseek-v4-pro, and preserves existing gemini/claude/ollama behavior', (t) => {
  t.equal(agent.getNextModelForHighDemand('deepseek-v4-flash'), 'deepseek-v4-pro', 'deepseek flash escalates to the pro version of itself');
  t.equal(agent.getNextModelForHighDemand('deepseek-v4-pro'), null, 'deepseek pro has no further tier to escalate to');
  t.equal(agent.getNextModelForHighDemand('gemini-2.5-flash-lite'), 'gemini-2.5-flash', 'gemini escalation is unchanged');
  t.equal(agent.getNextModelForHighDemand('claude-sonnet-5'), null, 'claude has no defined next tier (unchanged behavior)');
  t.equal(agent.getNextModelForHighDemand('llama3'), null, 'ollama/unknown models have no defined next tier (unchanged behavior)');
  t.end();
});

test('the agent loop dispatches deepseek-* models to callDeepSeekAPI', (t) => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  t.ok(agentSource.includes("activeRunModelName.startsWith('deepseek')"), 'the loop branches on a deepseek-* model name');
  t.ok(agentSource.includes('callDeepSeekAPI(messagesForApiCall, activeRunModelName, config.deepseekApiKey'),
    'the deepseek branch calls callDeepSeekAPI with the deepseek api key');
  t.end();
});

test('the reactive per-file escalation and proactive deep-task upgrade both use the generalized escalation helper', (t) => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  const matches = agentSource.match(/getNextModelForHighDemand\(/g) || [];
  t.ok(matches.length >= 2, 'getNextModelForHighDemand is used at both escalation call sites (proactive + reactive)');
  t.notOk(agentSource.includes("activeRunModelName.startsWith('gemini-') ? getNextGeminiModelForHighDemand(activeRunModelName) : null"),
    'the reactive escalation no longer gates on a hardcoded gemini-only check');
  t.end();
});
