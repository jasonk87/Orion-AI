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

test('convertGeminiToDeepSeekMessages preserves hidden reasoning_content without mixing it into content', (t) => {
  const messages = [
    {
      role: 'model',
      parts: [
        { text: 'private chain of thought', thought: true, _deepseekReasoningContent: true },
        { text: 'Visible answer.' },
        { functionCall: { name: 'read_file', args: { path: 'agent.js' } } }
      ]
    }
  ];
  const [out] = agent.convertGeminiToDeepSeekMessages(messages);
  t.equal(out.content, 'Visible answer.', 'assistant content contains only the visible answer');
  t.equal(out.reasoning_content, 'private chain of thought', 'hidden reasoning is retained for DeepSeek continuity');
  t.equal(out.tool_calls[0].function.name, 'read_file', 'tool calls are still preserved');
  t.end();
});

test('convertGeminiToDeepSeekMessages adds reasoning continuity for tool-call turns that lost it', (t) => {
  const messages = [
    {
      role: 'model',
      parts: [
        { text: 'I will inspect the file.' },
        { functionCall: { name: 'read_file', args: { path: 'agent.js' } } }
      ]
    }
  ];
  const [out] = agent.convertGeminiToDeepSeekMessages(messages);
  t.equal(out.content, 'I will inspect the file.', 'visible content is preserved');
  t.ok(out.reasoning_content.includes('reasoning_content was not preserved'), 'tool-call turns always carry reasoning_content for DeepSeek thinking mode');
  t.equal(out.tool_calls[0].function.name, 'read_file', 'tool call is still present');
  t.end();
});

test('convertGeminiToDeepSeekMessages reuses provider tool call ids when they were preserved', (t) => {
  const messages = [
    {
      role: 'model',
      parts: [
        { text: 'private tool reasoning', thought: true, _deepseekReasoningContent: true },
        { functionCall: { name: 'grep_search', args: { pattern: 'foo' }, _deepseekToolCallId: 'call_real_123' } }
      ]
    },
    { role: 'tool', parts: [{ functionResponse: { name: 'grep_search', response: { results: [] } } }] }
  ];
  const out = agent.convertGeminiToDeepSeekMessages(messages);
  t.equal(out[0].tool_calls[0].id, 'call_real_123', 'assistant message keeps the DeepSeek tool call id');
  t.equal(out[1].tool_call_id, 'call_real_123', 'tool response references the same preserved id');
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
            reasoning_content: 'I should inspect the file before editing.',
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
    t.deepEqual(body.thinking, { type: 'enabled' }, 'explicitly enables DeepSeek thinking mode');
    t.equal(body.reasoning_effort, 'max', 'uses max reasoning effort for DeepSeek pro');
    t.equal(body.messages[0].role, 'system', 'the system instruction is the first message (OpenAI convention)');
    t.ok(Array.isArray(body.tools) && body.tools.length > 0, 'includes the tool schema when tools are enabled');

    const parts = result.candidates[0].content.parts;
    t.equal(parts[0].text, 'I should inspect the file before editing.', 'reasoning_content is preserved as a hidden thought part');
    t.equal(parts[0].thought, true, 'reasoning_content is marked as a thought so it is not shown as answer text');
    t.equal(parts[1].text, "I'll read the file first.", 'content normalizes to a Gemini text part');
    t.equal(parts[2].functionCall.name, 'read_file', 'tool_calls normalize to a Gemini functionCall');
    t.deepEqual(parts[2].functionCall.args, { path: 'server.js' }, 'stringified arguments are parsed back into functionCall args');
    t.equal(parts[2].functionCall._deepseekToolCallId, 'call_x', 'provider tool call id is preserved for later DeepSeek requests');
    t.equal(result._orionActiveModelName, 'deepseek-v4-pro', 'reports the active model back to the loop');
  } finally {
    global.fetch = originalFetch;
  }
  t.end();
});

test('DeepSeek context fitting collapses a giant recent read result without mutating canonical history', (t) => {
  const giant = 'x'.repeat(40000);
  const messages = [
    { role: 'user', parts: [{ text: 'review it' }] },
    { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'huge.js' } } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { content: giant } } }] }
  ];
  const fitted = agent.fitDeepSeekMessagesToContextWindow(messages, 'deepseek-v4-flash', 'system', [], { maxInputTokens: 3000 });
  const response = fitted.messages[2].parts[0].functionResponse.response;

  t.equal(fitted.collapsedToolResults, 1, 'the most recent tool result is eligible for emergency fitting');
  t.equal(response.contextOverflowPrevented, true, 'the replacement explicitly records why exact bytes were omitted');
  t.ok(/narrower read_file range/.test(response.note), 'DeepSeek is told how to recover exact relevant source');
  t.equal(messages[2].parts[0].functionResponse.response.content.length, giant.length, 'canonical history is not mutated by the per-call safety copy');
  t.ok(fitted.estimatedTokens <= fitted.maxInputTokens, 'the fitted request is below the configured safety ceiling');
  t.end();
});

test('callDeepSeekAPI fits oversized tool output before fetch and blocks irreducible overflow locally', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  let capturedBody = null;
  let warning = '';
  global.fetch = async (url, options) => {
    calls += 1;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Recovered.' } }] }) };
  };
  try {
    const toolMessages = [
      { role: 'user', parts: [{ text: 'inspect the project' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'huge.js' } } }] },
      { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { content: 'x'.repeat(1200000) } } }] }
    ];
    await agent.callDeepSeekAPI(toolMessages, 'deepseek-v4-flash', 'sk-test', value => { warning = value; }, false, { maxInputTokens: 200000 });
    const toolResponse = JSON.parse(capturedBody.messages.find(message => message.role === 'tool').content);
    t.equal(calls, 1, 'the fitted request reaches DeepSeek once');
    t.equal(toolResponse.contextOverflowPrevented, true, 'the network payload contains the bounded recovery receipt, not 1.2 million characters');
    t.ok(/Context safety collapsed/.test(warning), 'the UI receives a quiet explanation of the automatic recovery');

    calls = 0;
    try {
      await agent.callDeepSeekAPI(
        [{ role: 'user', parts: [{ text: 'y'.repeat(1200000) }] }],
        'deepseek-v4-flash',
        'sk-test',
        () => {},
        false,
        { maxInputTokens: 200000 }
      );
      t.fail('irreducible user context should not be sent');
    } catch (error) {
      t.equal(calls, 0, 'an irreducible oversized request is rejected before fetch');
      t.ok(error.nonRetryable, 'local overflow does not enter a retry loop');
      t.ok(/blocked an oversized DeepSeek request locally/.test(error.message), 'the local error explains the real blocker');
    }
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

test('callDeepSeekAPI treats HTTP 402 billing failures as non-retryable', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: { message: 'Insufficient balance. Please top up.' } })
    };
  };
  try {
    await agent.callDeepSeekAPI([{ role: 'user', parts: [{ text: 'hi' }] }], 'deepseek-v4-flash', 'sk-test', () => {}, false, {});
    t.fail('should have thrown on 402');
  } catch (e) {
    t.equal(calls, 1, 'does not retry a payment-required response');
    t.ok(e.nonRetryable, '402 is marked non-retryable');
    t.ok(/402/.test(e.message) && /Insufficient balance/.test(e.message), 'error explains the billing failure');
  } finally {
    global.fetch = originalFetch;
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
