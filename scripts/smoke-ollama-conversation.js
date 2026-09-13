'use strict';

// Opt-in local inference probe. Logs only request sizes, completion state and visible replies.
process.env.NODE_ENV = 'test';
global.window = {};
const agent = require('../agent');
const { createOllamaDiscovery } = require('../lib/ipc-ollama');

async function main() {
  const model = process.argv[2] || 'ollama:qwen3.5:4b';
  const catalog = await createOllamaDiscovery()();
  if (!catalog.success) throw new Error(catalog.error);
  window.getOllamaModelInfo = value => catalog.models.find(item => item.value === value);
  const nativeFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    console.log('Request:', JSON.stringify({ model: body.model, messageChars: JSON.stringify(body.messages).length,
      toolChars: JSON.stringify(body.tools || []).length, options: body.options, think: body.think }));
    const response = await nativeFetch(url, { ...options, signal: globalThis.AbortSignal.any([options.signal, globalThis.AbortSignal.timeout(120000)].filter(Boolean)) });
    if (response.ok) {
      const result = await response.clone().json();
      console.log('Response:', JSON.stringify({ done: result.done, doneReason: result.done_reason,
        promptTokens: result.prompt_eval_count, outputTokens: result.eval_count,
        text: result.message?.content, toolCalls: result.message?.tool_calls?.length || 0 }));
    }
    return response;
  };
  const context = agent.buildPlainOllamaContext([], "What's up?");
  const result = await agent.callOllamaAPI(context.messages, model, () => {}, true, {
    systemInstruction: context.systemInstruction, reasoningPolicy: { phase: 'casual_conversation', effort: 'low' }
  });
  console.log('Visible:', agent.extractVisibleModelText(result));
  if (result.candidates[0].finishReason !== 'STOP' || !agent.extractVisibleModelText(result)) throw new Error('Greeting did not finish.');
  const quick = await window.quickOrionLLMCall('You are Orion. Answer the latest user message naturally and concisely.', [
    { role: 'user', content: 'I am choosing a name for a red bicycle. I like Comet.' },
    { role: 'assistant', content: 'Comet fits a red bicycle.' },
    { role: 'user', content: 'Which name did I like?' }
  ], { modelName: model });
  if (!quick.includes('Comet')) throw new Error('Conversational context was lost.');
  console.log('Follow-up context preserved:', quick);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
