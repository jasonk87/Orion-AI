'use strict';

// Opt-in live verification using the installed account. Never reads or supplies API keys.
const assert = require('assert/strict');
const { CodexSubscription } = require('../lib/codex-subscription');
const provider = require('../codex-provider');

async function main() {
  const service = new CodexSubscription();
  try {
    const status = await service.status();
    assert.equal(status.connected, true);
    const model = status.models.find(item => item.isDefault) || status.models[0];
    console.log(`ChatGPT login reused; ${status.models.length} models discovered; quota available: ${!!status.quota}.`);
    const request = (messages, tools = []) => provider.buildRequest(messages, 'codex:' + model.model,
      'You are Orion, a concise assistant. Follow the latest user request.', tools, { effort: model.supportedReasoningEfforts[0]?.reasoningEffort });
    const history = [{ role: 'user', parts: [{ text: 'Remember the code ORION-CONTEXT-73. Reply with only saved.' }] }];
    let deltas = 0;
    const first = await service.complete(request(history), { onDelta: () => deltas++ });
    assert.ok(deltas > 0);
    history.push({ role: 'model', parts: [{ text: first.text }] }, { role: 'user', parts: [{ text: 'What exact code did I ask you to remember? Reply only with that code.' }] });
    const context = await service.complete(request(history));
    assert.match(context.text, /ORION-CONTEXT-73/);
    console.log('Streaming and conversation continuity passed.');
    const tools = [{ name: 'lookup_marker', description: 'Read the marker value.', parameters: { type: 'object', properties: {}, required: [] } }];
    const toolHistory = [{ role: 'user', parts: [{ text: 'Use lookup_marker to read the marker. Do not guess it.' }] }];
    const toolResult = await service.complete(request(toolHistory, tools));
    const parts = provider.parseResponse(toolResult.text, tools);
    assert.equal(parts.find(part => part.functionCall)?.functionCall.name, 'lookup_marker');
    toolHistory.push({ role: 'model', parts }, { role: 'tool', parts: [{ functionResponse: { name: 'lookup_marker', response: { marker: 'VERIFIED-92' } } }] });
    const done = await service.complete(request(toolHistory, tools));
    assert.ok(provider.parseResponse(done.text, tools).some(part => part.text?.includes('VERIFIED-92')));
    console.log('Existing Orion action/result loop passed.');
    const lanes = await Promise.all(['LEFT-135', 'RIGHT-246'].map(token => service.complete(request([{ role: 'user', parts: [{ text: `Reply only with ${token}.` }] }]))));
    assert.match(lanes[0].text, /LEFT-135/); assert.match(lanes[1].text, /RIGHT-246/);
    assert.notEqual(lanes[0].threadId, lanes[1].threadId);
    console.log('Concurrent comparison lane isolation passed.');
    const controller = new AbortController();
    let stopAfterStreaming = false;
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      await assert.rejects(service.complete(request([{ role: 'user', parts: [{ text: 'Write a long, detailed essay about the history of mathematics.' }] }]), {
        signal: controller.signal,
        onDelta: () => { stopAfterStreaming = true; controller.abort(); }
      }), error => error.name === 'AbortError');
      assert.equal(stopAfterStreaming, true, 'stop interrupted actual streamed inference');
    } finally { clearTimeout(timer); }
    console.log('Live stop/cancel passed.');
  } finally { service.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
