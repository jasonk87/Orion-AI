const test = require('tape');
const fs = require('fs');
const path = require('path');

const rendererJs = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
global.window = {};
global.fetch = async () => ({ ok: false });
const agent = require('../agent.js');

test('prompt box queues with Enter and steers with Ctrl+Enter while running', (t) => {
  t.ok(rendererJs.includes("e.key === 'Enter' && e.ctrlKey"), 'Ctrl+Enter branch exists');
  t.ok(rendererJs.includes('triggerSteer();'), 'Ctrl+Enter can steer');
  t.ok(rendererJs.includes('triggerQueue();'), 'Enter can queue while running');
  t.ok(rendererJs.includes("source: 'user-queue'"), 'queued prompts are tagged with source');
  t.end();
});

test('steering and scheduled follow-ups are not persisted as fake user messages', (t) => {
  t.ok(rendererJs.includes("role: 'steering'"), 'steering is stored as a steering event');
  t.notOk(/role:\s*'user'[^}]+Steering/.test(rendererJs), 'steering is not stored as a user message');
  t.ok(agentJs.includes("nextTask.source === 'followup'"), 'follow-up queue items are detected');
  t.ok(agentJs.includes("Executing scheduled follow-up."), 'follow-up execution uses system wording');
  t.ok(agentJs.includes('[ORION INTERNAL FOLLOW-UP - not a user message]'), 'follow-up prompt is tagged as internal model context');
  t.ok(agentJs.includes('Do not quote this as something the user said'), 'internal follow-up explicitly forbids user attribution');
  t.notOk(agentJs.includes("targetConv.messages.push({ role: 'user', text: prompt })"), 'scheduled follow-up prompt is not persisted as user input');
  t.end();
});

test('plan approval continuation is not stored as a fake user message', (t) => {
  t.ok(rendererJs.includes("source: 'plan-approval'"), 'plan approval has a distinct internal source');
  t.ok(rendererJs.includes("role: 'system', source: 'plan-approval'"), 'plan approval is stored as a system event');
  t.ok(rendererJs.includes("internalPrompt: true"), 'plan approval run is passed as internal prompt');
  t.notOk(rendererJs.includes("conv.messages.push({ role: 'user', text: '[Start implementation]' })"), 'synthetic start implementation is not persisted as user');
  t.notOk(rendererJs.includes("renderUserMessage('[Start implementation]')"), 'synthetic start implementation is not rendered as user');
  t.end();
});

test('model call delay and repeated failure guardrails exist', (t) => {
  t.ok(rendererJs.includes('settingModelCallDelay'), 'model-call delay setting is wired in renderer');
  t.ok(agentJs.includes('config.modelCallDelayMs'), 'agent reads model-call delay config');
  t.ok(agentJs.includes('repeatedToolFailures'), 'agent tracks repeated tool failures');
  t.ok(agentJs.includes('Repeated failure guard paused'), 'agent pauses identical repeated failures');
  t.end();
});

test('repeated failure guard warns on second failure and pauses on third', (t) => {
  t.ok(/if\s*\(\s*failureCount\s*===\s*2\s*\)/.test(agentJs), 'second identical failure emits an adaptive warning');
  t.ok(/if\s*\(\s*failureCount\s*>=\s*3\s*\)/.test(agentJs), 'third identical failure triggers the pause guard');
  t.ok(agentJs.includes('Do not retry it blindly'), 'second failure warning tells Orion not to repeat blindly');
  t.ok(agentJs.includes('choose a different strategy before retrying'), 'pause guard requires a different recovery strategy');
  t.end();
});

test('model API calls cannot sit indefinitely without visible cooldown status', (t) => {
  t.ok(agentJs.includes('MODEL_API_REQUEST_TIMEOUT_MS = 60000'), 'model API requests have a hard timeout');
  t.ok(agentJs.includes('MODEL_API_MAX_ATTEMPTS = 3'), 'Gemini retry attempts are bounded');
  t.ok(agentJs.includes('fetchWithTimeout(url'), 'Gemini generateContent uses timeout-aware fetch');
  t.ok(agentJs.includes('sleepWithModelApiStatus'), 'retry backoff is routed through status-aware sleep');
  t.ok(agentJs.includes('isStopRequested'), 'retry wait can react to user stop');
  t.ok(agentJs.includes('agentSubStatus = warningMsg'), 'provider cooldown warnings update visible substatus');
  t.ok(agentJs.includes('Provider wait/cooldown active'), 'rate-limit retry state is explicit');
  t.end();
});

test('write_file refuses silent full-file overwrites', (t) => {
  t.ok(agentJs.includes('write_file refused to overwrite an existing file'), 'write_file blocks existing file overwrite by default');
  t.ok(agentJs.includes('overwriteReason'), 'explicit overwrite reason is required');
  t.end();
});

test('workspace artifacts and file explorer controls are wired', (t) => {
  t.ok(agentJs.includes('buildRunArtifactPayload'), 'agent builds external run artifact payloads');
  t.ok(agentJs.includes('writeRunArtifact'), 'agent writes run artifacts through IPC');
  t.ok(rendererJs.includes('deleteWorkspacePath'), 'file explorer delete handler exists');
  t.ok(rendererJs.includes('moveWorkspacePath'), 'file explorer move handler exists');
  t.ok(rendererJs.includes('renameWorkspacePath'), 'file explorer rename handler exists');
  t.ok(rendererJs.includes('copyWorkspacePath'), 'file explorer copy handler exists');
  t.ok(rendererJs.includes('dragstart'), 'file explorer drag start is wired');
  t.ok(rendererJs.includes('drop'), 'file explorer drop move is wired');
  t.end();
});

test('stuck diagnosis prefers adapting or preserving state over quitting', (t) => {
  const quotaAdvice = agent.diagnoseModelApiFailure('HTTP 429 Resource has been exhausted');
  t.ok(quotaAdvice.includes('resume after cooldown'), 'quota advice schedules recovery posture');
  t.notOk(quotaAdvice.toLowerCase().includes('quit'), 'quota advice does not tell Orion to quit');

  const authAdvice = agent.diagnoseModelApiFailure('HTTP 401 invalid api key');
  t.ok(authAdvice.includes('hard blocker'), 'credential errors are treated as real blockers');

  t.ok(agentJs.includes('I scheduled a follow-up retry'), 'agent schedules retry after cooldown');
  t.ok(agentJs.includes('Do not quit the task'), 'repeated tool failures tell Orion to adapt');
  t.end();
});

test('companion polish exposes queue, latest output, and plan controls', (t) => {
  t.ok(rendererJs.includes('queuedPromptPreview'), 'phone state exposes queued prompt preview');
  t.ok(rendererJs.includes('latestOutput'), 'phone state exposes latest output');
  t.ok(rendererJs.includes('denyPhoneCompanionPlan'), 'phone companion can deny plan');
  t.ok(rendererJs.includes('revisePhoneCompanionPlan'), 'phone companion can revise plan');
  t.end();
});

test('checklist updates are milestone-only to avoid progress churn', (t) => {
  t.ok(agentJs.includes('Use only for milestone changes'), 'tool description warns against routine checklist churn');
  t.ok(agentJs.includes('Do not call it just to mark an item "in-progress"'), 'system prompt blocks in-progress-only updates');

  const initial = agent.shouldApplyChecklistUpdate([], [
    { title: 'Explore the codebase', status: 'pending' },
    { title: 'Implement fix', status: 'pending' },
  ]);
  t.equal(initial.allowed, true, 'initial checklist creation is allowed');

  const churn = agent.shouldApplyChecklistUpdate([
    { title: 'Explore the codebase', status: 'pending' },
    { title: 'Implement fix', status: 'pending' },
  ], [
    { title: 'Explore the codebase', status: 'in-progress' },
    { title: 'Implement fix', status: 'pending' },
  ]);
  t.equal(churn.allowed, false, 'pending to in-progress only is skipped');

  const completed = agent.shouldApplyChecklistUpdate([
    { title: 'Explore the codebase', status: 'in-progress' },
    { title: 'Implement fix', status: 'pending' },
  ], [
    { title: 'Explore the codebase', status: 'completed' },
    { title: 'Implement fix', status: 'in-progress' },
  ]);
  t.equal(completed.allowed, true, 'completed milestone updates are allowed');

  const revised = agent.shouldApplyChecklistUpdate([
    { title: 'Explore the codebase', status: 'pending' },
  ], [
    { title: 'Explore the codebase', status: 'pending' },
    { title: 'Add regression test', status: 'pending' },
  ]);
  t.equal(revised.allowed, true, 'task list revisions are allowed');
  t.end();
});
