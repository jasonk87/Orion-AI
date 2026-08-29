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

test('lightweight conversational replies project visible DeepSeek content instead of private reasoning', t => {
  const response = {
    candidates: [{
      content: {
        parts: [
          {
            text: 'The user is asking why I routed this task. Let me reason through the possible explanations.',
            thought: true,
            _deepseekReasoningContent: true
          },
          { text: 'I routed it incorrectly. Interactive playtesting belongs to Operator.' }
        ]
      }
    }]
  };
  t.equal(
    agent.extractVisibleModelText(response),
    'I routed it incorrectly. Interactive playtesting belongs to Operator.',
    'the supervisor path selects the visible answer even when reasoning is the first provider part'
  );
  t.equal(
    agent.extractVisibleModelText({
      candidates: [{ content: { parts: [{ text: 'private draft only', thought: true, _deepseekReasoningContent: true }] } }]
    }),
    '',
    'reasoning-only output fails closed instead of becoming the chat answer'
  );
  t.end();
});

test('the real lightweight Dispatch call returns DeepSeek visible content, not reasoning_content', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          reasoning_content: 'The user is asking why the task was routed this way. I should reconstruct the old decision.',
          content: 'That was routed incorrectly. An interactive playtest belongs to Operator.'
        }
      }]
    })
  });

  try {
    const reply = await global.window.quickOrionLLMCall(
      'Answer conversationally.',
      [{ role: 'user', content: 'Why did you route that to Coder?' }],
      { modelName: 'deepseek-v4-flash', deepseekApiKey: 'test-key' }
    );
    t.equal(
      reply,
      'That was routed incorrectly. An interactive playtest belongs to Operator.',
      'the integrated supervisor call returns the provider-visible answer'
    );
    t.notOk(reply.includes('The user is asking'), 'private provider reasoning never becomes chat content');
  } finally {
    global.fetch = originalFetch;
  }
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

test('DeepSeek emergency fitting bounds a giant recent command result while retaining verification evidence', (t) => {
  const stdout = `first match\n${'x'.repeat(50000)}\nlast match`;
  const messages = [
    { role: 'user', parts: [{ text: 'inspect the diagnostic result' }] },
    { role: 'model', parts: [{ functionCall: { name: 'run_command', args: { command: 'Select-String huge.json needle' } } }] },
    {
      role: 'tool',
      parts: [{
        functionResponse: {
          name: 'run_command',
          response: { exitCode: 0, stdout, stderr: '', timedOut: false, killed: false }
        }
      }]
    }
  ];
  const fitted = agent.fitDeepSeekMessagesToContextWindow(
    messages,
    'deepseek-v4-flash',
    'system',
    [],
    { maxInputTokens: 4000 }
  );
  const response = fitted.messages[2].parts[0].functionResponse.response;

  t.equal(fitted.collapsedToolResults, 1, 'recent execution output is eligible only for emergency request fitting');
  t.equal(response.exitCode, 0, 'the command exit status survives emergency fitting');
  t.equal(response.timedOut, false, 'timeout evidence survives emergency fitting');
  t.match(response.stdoutPreview, /first match/, 'the start of command evidence is retained');
  t.match(response.stdoutPreview, /last match/, 'the end of command evidence is retained');
  t.match(response.note, /rerun a narrower command/i, 'the model receives a safe exact-evidence recovery path');
  t.equal(messages[2].parts[0].functionResponse.response.stdout.length, stdout.length, 'canonical live history is not mutated');
  t.ok(fitted.estimatedTokens <= fitted.maxInputTokens, 'the provider request is brought below the safety ceiling');
  t.end();
});

test('live command streaming is bounded before it enters agent history', (t) => {
  const first = agent.appendBoundedCommandOutput('', 'a'.repeat(agent.AGENT_COMMAND_OUTPUT_MAX_CHARS - 10));
  const second = agent.appendBoundedCommandOutput(first.output, `${'b'.repeat(1000)}TAIL`);
  t.equal(second.output.length, agent.AGENT_COMMAND_OUTPUT_MAX_CHARS, 'the renderer-side live buffer cannot grow past its cap');
  t.equal(second.truncated, true, 'the caller can disclose that output was truncated');
  t.match(second.output, /TAIL$/, 'the newest diagnostic output is retained');
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

test('getNextModelForHighDemand never replaces the user-selected model', (t) => {
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro', 'gemini-2.5-flash-lite', 'claude-sonnet-5', 'llama3']) {
    t.equal(agent.getNextModelForHighDemand(model), null, `${model} has no automatic next tier`);
  }
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

test('the agent loop contains no proactive or reactive model-escalation call site', (t) => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  const matches = agentSource.match(/getNextModelForHighDemand\(/g) || [];
  t.equal(matches.length, 1, 'only the compatibility function declaration remains');
  t.notOk(/Proactively using|Escalating to .* after .* syntax\/regression/.test(agentSource),
    'no task-complexity or edit-failure path swaps models');
  t.end();
});

// Regression: DeepSeek rejects the ENTIRE request with
//   HTTP 400 "Invalid assistant message: content or tool_calls must be set"
// if any assistant message carries neither. This killed a live task mid-run.
//
// The cause was a coupling that was easy to miss: content used to be derived as
//   joinedText || (reasoningContent ? "" : null)
// so reasoningContent was silently doing double duty as "does this turn have any substance".
// When prior-turn reasoning stopped being replayed (to stop each request growing larger than
// the last), older text-free turns collapsed to content:null with no tool_calls.
//
// This asserts the provider's invariant directly, across every history shape, so the two
// concerns can never be coupled again.
test('every assistant message sent to DeepSeek satisfies content-or-tool_calls', (t) => {
  const reasoningPart = { text: 'internal chain of thought', thought: true, _deepseekReasoningContent: true };
  const callPart = { functionCall: { name: 'grep_search', args: { pattern: 'x' } } };

  const histories = {
    'text only': [{ role: 'model', parts: [{ text: 'Here is the answer.' }] }],
    'reasoning only, no text, no tools': [{ role: 'model', parts: [reasoningPart] }],
    'tool call with no text': [{ role: 'model', parts: [callPart] }],
    'reasoning plus tool call': [{ role: 'model', parts: [reasoningPart, callPart] }],
    'completely empty parts': [{ role: 'model', parts: [] }],
    'missing parts entirely': [{ role: 'model' }],
    'older reasoning-only turn followed by a newer turn': [
      { role: 'model', parts: [reasoningPart] },
      { role: 'user', parts: [{ text: 'and then?' }] },
      { role: 'model', parts: [{ text: 'final' }, reasoningPart] }
    ],
    'several stacked reasoning-only turns': [
      { role: 'model', parts: [reasoningPart] },
      { role: 'model', parts: [reasoningPart] },
      { role: 'model', parts: [reasoningPart] }
    ]
  };

  for (const [label, history] of Object.entries(histories)) {
    const converted = agent.convertGeminiToDeepSeekMessages(history);
    const assistants = converted.filter(m => m.role === 'assistant');
    t.ok(assistants.length > 0, `${label}: produces at least one assistant message`);
    for (const msg of assistants) {
      const hasContent = typeof msg.content === 'string';
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      t.ok(hasContent || hasToolCalls,
        `${label}: assistant message has content or tool_calls (content=${JSON.stringify(msg.content)}, tools=${hasToolCalls})`);
      // content:null is legal when tool_calls carry the turn — it is only fatal when the
      // message has neither, which is the case the guard above covers.
      if (!hasToolCalls) {
        t.notEqual(msg.content, null, `${label}: a tool-less assistant message never sends null content`);
      }
    }
  }
  t.end();
});

test('only the newest turn replays full reasoning, but tool-call turns keep the field', (t) => {
  const reasoningPart = { text: 'a very long chain of thought', thought: true, _deepseekReasoningContent: true };
  const callPart = { functionCall: { name: 'read_file', args: { path: 'a.js' } } };
  const history = [
    { role: 'model', parts: [reasoningPart, callPart] },
    { role: 'tool', parts: [{ functionResponse: { name: 'read_file', response: { ok: true } } }] },
    { role: 'model', parts: [reasoningPart, { text: 'done' }] }
  ];

  const assistants = agent.convertGeminiToDeepSeekMessages(history).filter(m => m.role === 'assistant');
  t.equal(assistants.length, 2, 'both assistant turns are present');

  // The older tool-call turn must still carry the field — DeepSeek requires it on tool-call
  // turns — but not the full earlier transcript, which is what was inflating every request.
  t.ok(assistants[0].reasoning_content, 'the older tool-call turn keeps a reasoning_content field');
  t.notEqual(assistants[0].reasoning_content, 'a very long chain of thought',
    'the older turn does not replay its full chain of thought');
  t.equal(assistants[1].reasoning_content, 'a very long chain of thought',
    'the newest turn replays its reasoning verbatim');
  t.end();
});
