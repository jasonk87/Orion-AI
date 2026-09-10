'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
const test = require('tape');
const agent = require('../agent');
const taskOrchestration = require('../task-orchestration');
const reasoningPolicy = require('../reasoning-policy');
const { loadRenderer } = require('./helpers/renderer-harness');

test('subscription agent and utility calls use IPC and the existing Orion response contract', async t => {
  const requests = [];
  let deltaListener;
  window.api = {
    onCodexDelta: listener => { deltaListener = listener; return () => { deltaListener = null; }; },
    codexComplete: async request => {
      requests.push(request);
      const text = request.outputSchema ? '{"text":"Working","toolCalls":[{"name":"inspect_environment","arguments":"{\\"target\\":\\"workspace\\"}"}]}' : '{"intent":"answer"}';
      deltaListener({ requestId: request.requestId, text });
      return { success: true, text };
    }
  };
  let streamed = '';
  const result = await agent.callCodexSubscription([{ role: 'user', parts: [{ text: 'Read the readme.' }] }], 'codex:account-model', () => {}, false, {
    requestedEffort: 'xhigh', onText: text => { streamed = text; }
  });
  t.equal(streamed, 'Working');
  t.equal(result.candidates[0].content.parts[1].functionCall.name, 'inspect_environment');
  t.equal(requests[0].effort, 'xhigh', 'explicit reasoning reaches official protocol unchanged');
  t.equal(requests[0].forcedEffort, true);
  t.notOk(deltaListener, 'IPC listener removed after response');
  const utility = await agent.callUtilityModel('Classify.', 'codex:account-model', {}, true);
  t.equal(JSON.parse(utility).intent, 'answer', 'classification stays on the subscription provider');
  t.equal(agent.resolveUtilityModelName('codex:account-model'), 'codex:account-model');
  const profile = taskOrchestration.normalizeExecutionProfile({ requestedModel: 'codex:account-model', requestedReasoning: 'ultra' });
  t.equal(profile.requestedReasoning, 'ultra', 'specialist tasks preserve the Codex reasoning name');
  t.end();
});

test('desktop and phone lists expose dynamic Codex models and supported reasoning', async t => {
  const { win } = loadRenderer({ t, globals: { OrionReasoningPolicy: reasoningPolicy, fetch: async () => ({ ok: false }) }, api: {
    codexStatus: async () => ({ success: true, connected: true, account: { email: 'test@example.com', planType: 'plus' }, models: [
      { model: 'account-discovered', displayName: 'Account discovered model', inputModalities: ['text', 'image'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'xhigh' }] }
    ], quota: { rateLimits: { primary: { usedPercent: 25, resetsAt: 1800000000 } } } }),
    writeConfig: async () => true
  } });
  await win.initModelDropdown();
  t.ok([...win.document.getElementById('model-select').options].some(option => option.value === 'codex:account-discovered'));
  await win.setPhoneCompanionModel('codex:account-discovered');
  const levels = win.getPhoneCompanionModels().reasoningLevels.map(option => option.value);
  t.deepEqual([...levels], ['auto', 'low', 'xhigh']);
  await win.setReasoningEffortSelection('xhigh');
  t.equal(win.getPhoneCompanionModels().reasoning, 'xhigh');
  t.equal(win.document.getElementById('reasoning-select').value, 'xhigh');
  t.match(win.document.getElementById('codex-quota-status').textContent, /75% remaining/);
  t.ok(win.getCodexModelInfo('codex:account-discovered').inputModalities.includes('image'));
  t.end();
});

test('unavailable saved subscription does not silently switch to an API provider', async t => {
  const { win } = loadRenderer({ t, globals: { OrionReasoningPolicy: reasoningPolicy, fetch: async () => ({ ok: false }) },
    api: { codexStatus: async () => ({ success: false, error: 'Codex unavailable' }) } });
  win.localStorage.setItem('ag2_default_model', 'codex:account-discovered');
  await win.initModelDropdown();
  t.equal(win.getPhoneCompanionModels().current, 'codex:account-discovered');
  t.match(win.document.getElementById('codex-account-status').textContent, /unavailable/);
  t.end();
});
