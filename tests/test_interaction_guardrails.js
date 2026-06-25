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

test('tool contract separates failed tools from task truth', (t) => {
  t.ok(agentJs.includes('A failed tool path is evidence about that tool attempt, not proof'), 'system prompt separates tool failure from task truth');
  t.ok(agentJs.includes("Do not use web search to answer facts about the user's local machine"), 'system prompt blocks local-machine web fallback');
  t.ok(agentJs.includes('For local machine facts, a non-zero exit proves only that this command attempt failed'), 'run_command schema warns against overclaiming failed commands');
  t.ok(agentJs.includes('Do not use for facts about this local machine'), 'google_search schema blocks local-state usage');
  t.ok(agentJs.includes('buildEpistemicCorrectionPrompt'), 'loop has an epistemic self-correction guard');
  t.ok(agentJs.includes('getEpistemicToolGate'), 'loop gates invalid tool escalation');
  t.end();
});

test('failure taxonomy classifies common failure modes', (t) => {
  t.equal(agent.classifyAgentFailure({
    toolName: 'patch_file',
    errorText: 'Target content block not found in file: app.js'
  }).category, 'patch_target_missing', 'classifies missing patch target');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    args: { command: 'rm -rf ./build' },
    errorText: 'Command is in the deny-list and cannot be executed.'
  }).category, 'command_blocked', 'classifies blocked destructive commands');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_tests',
    result: { success: false },
    errorText: 'tests failed'
  }).category, 'test_failure', 'classifies failed regression tests');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    errorText: 'npm: command not found'
  }).category, 'missing_dependency', 'classifies missing dependencies');

  t.equal(agent.classifyAgentFailure({
    toolName: 'google_search',
    errorText: 'HTTP 401 invalid API key'
  }).category, 'auth_missing', 'classifies missing auth');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    result: { timedOut: true },
    errorText: 'Command timed out'
  }).category, 'timeout', 'classifies timeouts');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    errorText: 'Interactive command reads from input(). Pipe test input.'
  }).category, 'interactive_command_needs_input', 'classifies interactive commands without stdin');

  t.equal(agent.classifyAgentFailure({
    toolName: 'patch_file',
    errorText: 'same failure',
    failureCount: 3
  }).category, 'repeated_tool_failure', 'repeated failures override specific categories at threshold');

  t.equal(agent.classifyAgentFailure({
    category: 'model_no_tool_use'
  }).category, 'model_no_tool_use', 'classifies model no-tool-use follow-up');

  t.end();
});

test('local system fact failures do not become fake blockers or web research', (t) => {
  t.equal(agent.isLocalSystemFactRequest('how much memory does my computer have left?'), true, 'recognizes local memory query');
  t.equal(agent.isLocalSystemFactRequest('what do you think about my computer performance wise?'), true, 'recognizes local performance assessment query');
  t.equal(agent.isLocalSystemFactRequest('look up Gemini API docs'), false, 'does not classify docs research as local system fact');
  t.equal(agent.isGenericNonAnswer('Understood.'), true, 'recognizes generic acknowledgement as a non-answer');
  t.equal(agent.requestNeedsLocalInspection('what do you think about my computer performance wise?'), true, 'performance assessment requires local inspection');
  t.equal(
    agent.shouldHaveUsedToolsButDidNot('Understood.', [], 'what do you think about my computer performance wise?'),
    true,
    'generic acknowledgement cannot satisfy a local performance request without tools'
  );

  const failedCommand = {
    exitCode: -4058,
    stdout: '',
    stderr: '',
    timeoutMs: 120000
  };
  t.equal(agent.isFailedToolResult(failedCommand), true, 'non-zero command exit is failed evidence');
  t.ok(agent.getToolFailureSignal(failedCommand).includes('-4058'), 'failure signal preserves exit code');

  const ledger = [
    agent.buildToolEvidenceEntry('run_command', { command: 'wmic ComputerSystem get TotalPhysicalMemory /value' }, failedCommand),
    agent.buildToolEvidenceEntry('run_command', { command: 'systeminfo' }, failedCommand)
  ];

  const webGate = agent.getEpistemicToolGate(
    'how much memory does my computer have left?',
    ledger,
    'google_search',
    { query: 'how to get system memory information without powershell or wmic' }
  );
  t.equal(webGate.allowed, false, 'blocks web search for local machine facts');
  t.ok(webGate.reason.includes('local machine'), 'web gate explains local-state boundary');

  const blockerGate = agent.getEpistemicToolGate(
    'how much memory does my computer have left?',
    ledger,
    'record_blocker',
    { title: 'Cannot check memory' }
  );
  t.equal(blockerGate.allowed, false, 'blocks blocker recording from failed local commands alone');
  t.ok(blockerGate.reason.includes('failed local-inspection commands alone'), 'blocker gate explains evidence problem');

  const correction = agent.buildEpistemicCorrectionPrompt({
    userPrompt: 'how much memory does my computer have left?',
    answerText: 'I cannot proceed without a configured Google Search API key.',
    toolEvidenceLedger: ledger
  });
  t.ok(correction.includes('failed tool attempts'), 'self-correction prompt names failed tool attempts');
  t.ok(correction.includes('not proof'), 'self-correction prompt rejects unsupported inference');
  t.ok(correction.includes('Do not use web search'), 'self-correction prompt blocks web fallback');
  t.end();
});

test('failure taxonomy produces specific recovery guidance', (t) => {
  const patchGuidance = agent.buildFailureRecoveryGuidance({ category: 'patch_target_missing' });
  t.ok(patchGuidance.includes('Re-read the surrounding file lines'), 'patch guidance asks to inspect current file context');
  t.ok(patchGuidance.includes('line-range patch'), 'patch guidance suggests a narrower edit strategy');

  const commandGuidance = agent.buildFailureRecoveryGuidance({ category: 'command_blocked' });
  t.ok(commandGuidance.includes('blocked by safety or planning rules'), 'blocked command guidance preserves safety posture');
  t.ok(commandGuidance.includes('internal executable/args'), 'blocked command guidance points to safe internal boundary');

  const testGuidance = agent.buildFailureRecoveryGuidance({ category: 'test_failure' });
  t.ok(testGuidance.includes('Read the failing test output'), 'test guidance focuses on failing output');
  t.ok(testGuidance.includes('rerun the relevant tests'), 'test guidance requires verification rerun');

  const authGuidance = agent.buildFailureRecoveryGuidance({ category: 'auth_missing' });
  t.ok(authGuidance.includes('Stop retrying credential-gated work'), 'auth guidance stops blind retries');

  const interactiveGuidance = agent.buildFailureRecoveryGuidance({ category: 'interactive_command_needs_input' });
  t.ok(interactiveGuidance.includes('Pipe a short scripted input sequence'), 'interactive command guidance requires stdin');
  t.ok(interactiveGuidance.includes('start_command with a short timeout'), 'interactive command guidance allows bounded smoke checks');

  const noToolGuidance = agent.buildFailureRecoveryGuidance({ category: 'model_no_tool_use' });
  t.ok(noToolGuidance.includes('no tools were called'), 'model no-tool-use guidance explains the failure');
  t.ok(noToolGuidance.includes('call the appropriate tools now'), 'model no-tool-use guidance prompts concrete action');

  const repeatedGuidance = agent.buildFailureRecoveryGuidance({ category: 'repeated_tool_failure' });
  t.ok(repeatedGuidance.includes('Do not quit the task'), 'repeated guidance preserves adaptive recovery');
  t.ok(repeatedGuidance.includes('choose a different strategy before retrying'), 'repeated guidance requires strategy change');

  t.end();
});

test('run_command guard blocks interactive Python scripts without stdin', async (t) => {
  const files = {
    'tic_tac_toe.py': "move = input('move: ')\nprint(move)\n",
    'report.py': "print('ready')\n"
  };
  global.window.api = {
    readFile: async (workspace, relativePath) => files[relativePath] || { error: 'File does not exist' }
  };

  t.equal(agent.extractPythonScriptPath('python tic_tac_toe.py'), 'tic_tac_toe.py', 'extracts Python script path');
  t.equal(agent.commandProvidesInput('echo 1 | python tic_tac_toe.py'), true, 'detects piped stdin');

  const blocked = await agent.validateRunCommandForAgentUse('python tic_tac_toe.py', process.cwd());
  t.equal(blocked.allowed, false, 'blocks interactive Python command without stdin');
  t.ok(blocked.reason.includes('Pipe test input'), 'blocked reason tells agent how to recover');

  const piped = await agent.validateRunCommandForAgentUse('echo 1 | python tic_tac_toe.py', process.cwd());
  t.equal(piped.allowed, true, 'allows interactive Python command with piped stdin');

  const plain = await agent.validateRunCommandForAgentUse('python report.py', process.cwd());
  t.equal(plain.allowed, true, 'allows non-interactive Python scripts');

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

test('live model status does not leak into final answer transcript logs', (t) => {
  t.notOk(
    agentJs.includes("currentAgentLogs.push({ type: 'thought', content: textVal })"),
    'normal model answer text is rendered as the answer, not duplicated as a Thought log'
  );
  t.notOk(
    agentJs.includes("currentAgentLogs.push({ type: 'thought', content: `Warning: ${warningMsg}` })"),
    'provider retry/cooldown warnings stay in live status instead of permanent Thought logs'
  );
  t.notOk(
    agentJs.includes("currentAgentLogs.push({ type: 'thought', content: 'Pro Mode: using the single state-driven loop with stricter evidence expectations.' })"),
    'Pro Mode internal loop note is not persisted into user-facing transcript logs'
  );
  t.ok(
    rendererJs.includes('<strong>Thought:</strong>'),
    'renderer can still show genuine diagnostic thought logs when explicitly recorded'
  );
  t.end();
});

test('write_file refuses silent full-file overwrites', (t) => {
  t.ok(agentJs.includes('write_file refused to overwrite an existing file'), 'write_file blocks existing file overwrite by default');
  t.ok(agentJs.includes('overwriteReason'), 'explicit overwrite reason is required');
  t.end();
});

test('post-edit evidence gate requires real verification before finalizing', (t) => {
  t.ok(agentJs.includes('Post-edit evidence gate'), 'agent has a post-edit evidence gate prompt');
  t.ok(agentJs.includes('Verification guard: code changed'), 'agent logs when the verification guard keeps working');
  t.equal(agent.isRealVerificationCommand('mkdir assets'), false, 'folder creation is not verification');
  t.equal(agent.isRealVerificationCommand('python -m py_compile main.py'), true, 'Python compile check counts as verification');
  t.equal(agent.isRealVerificationCommand('npm test'), true, 'npm test counts as verification');

  const changedOnly = [
    { kind: 'file', toolName: 'patch_file', path: 'main.py', status: 'done' },
    { toolName: 'run_command', kind: 'command', command: 'mkdir assets', label: 'Ran `mkdir assets`', status: 'done' }
  ];
  t.equal(agent.hasVerificationAfterLastFileEdit(changedOnly), false, 'non-verification command after edit does not satisfy evidence gate');
  t.ok(agent.buildPostEditEvidencePrompt(changedOnly, { canExecute: true, promptCount: 0 }).includes('Call the necessary tools now'), 'guard asks for concrete tools');

  const verified = [
    { kind: 'file', toolName: 'patch_file', path: 'main.py', status: 'done' },
    { toolName: 'read_file', path: 'main.py', status: 'done' },
    { toolName: 'run_command', kind: 'command', command: 'python -m py_compile main.py', label: 'Ran `python -m py_compile main.py`', status: 'done' }
  ];
  t.equal(agent.hasVerificationAfterLastFileEdit(verified), true, 'real verification after edit satisfies evidence gate');
  t.equal(agent.buildPostEditEvidencePrompt(verified, { canExecute: true, promptCount: 0 }), '', 'guard does not fire after read and verification evidence');
  t.end();
});

test('final verification summary calls out fake checks and gaps', (t) => {
  const summary = agent.buildFinalVerificationSummary([
    { kind: 'file', toolName: 'write_file', path: 'main.py', status: 'done' },
    { toolName: 'run_command', kind: 'command', command: 'mkdir assets', label: 'Ran `mkdir assets`', status: 'done' }
  ]);
  t.ok(summary.includes('Verification gap'), 'summary exposes missing verification after source edits');
  t.ok(summary.includes('Non-verification commands'), 'summary labels filesystem chores as non-verification');
  t.ok(summary.includes('These do not prove the code works'), 'summary explains why non-verification commands are insufficient');
  t.end();
});

test('final answer leads with answer and strips echoed system walkthrough scaffolding', (t) => {
  const leaked = `[SYSTEM: Work Walkthrough:

Ran wmic ComputerSystem get TotalPhysicalMemory to get system memory.
Parsed the output to extract the memory value: 12817575936 bytes.
Converted bytes to GB: 12817575936 / (1024^3) ≈ 11.94 GB.
Responded to the user with the system memory information.] Your computer has approximately 11.94 GB of system memory.`;

  const cleaned = agent.sanitizeFinalAnswerText(leaked);
  t.equal(cleaned, 'Your computer has approximately 11.94 GB of system memory.', 'echoed system walkthrough is stripped and answer remains first');

  const final = agent.withWorkWalkthrough(leaked, [
    { toolName: 'run_command', kind: 'command', command: 'wmic ComputerSystem get TotalPhysicalMemory', label: 'Ran `wmic ComputerSystem get TotalPhysicalMemory`', status: 'done', detail: 'Exit: 0, timeout: 120000ms' }
  ], true);

  t.ok(final.startsWith('Your computer has approximately 11.94 GB of system memory.'), 'final response starts with the direct answer');
  t.equal((final.match(/## Work Walkthrough/g) || []).length, 1, 'only one Work Walkthrough is appended');
  t.notOk(final.includes('[SYSTEM:'), 'system scaffold is not shown to the user');
  t.notOk(final.includes('## Final Pre-Submit Summary'), 'read-only command answers skip heavy pre-submit summary');
  t.end();
});

test('blocked planning writes are not reported as touched files', (t) => {
  const summary = agent.buildFinalVerificationSummary([
    { kind: 'file', toolName: 'write_file', path: 'tic_tac_toe.py', status: 'error', label: 'Write `tic_tac_toe.py`', detail: 'Planning Mode Active' },
    { kind: 'plan', toolName: 'write_file', path: 'implementation_plan.md', status: 'done', label: 'Created implementation plan' }
  ]);
  const filesTouchedLine = summary.split('\n').find(line => line.includes('Files touched')) || '';
  t.ok(filesTouchedLine.includes('None recorded'), 'blocked source writes do not count as touched files');
  t.notOk(filesTouchedLine.includes('`tic_tac_toe.py`'), 'blocked source path is not listed as touched');
  t.ok(agentJs.includes('updateWalkthroughItem(walkthroughItem, toolName, args, { error: planningGate.reason'), 'planning gate marks blocked tool attempts in walkthrough');
  t.ok(agentJs.includes("label: isPlan ? 'Created implementation plan' : `Write \\`"), 'write label is neutral until execution succeeds');
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

test('phone standalone conversations get isolated workspaces', (t) => {
  t.ok(rendererJs.includes('function getStandaloneWorkspaceRoot'), 'standalone workspace root helper exists');
  t.ok(rendererJs.includes('Desktop\\\\Projects\\\\OrionAI\\\\standalone-workspaces'), 'default standalone root lives under OrionAI project folder');
  t.ok(rendererJs.includes('function createPhoneConversation'), 'phone conversations use a dedicated constructor');
  t.ok(rendererJs.includes('projectPath: normalizedProjectPath'), 'phone constructor preserves explicit project linkage only');
  t.ok(rendererJs.includes('conv.workspace = conv.projectPath || getStandaloneWorkspaceForTitle(conv.title)'), 'standalone phone prompt initializes an isolated workspace');
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

test('legacy phone companion token announcements are scrubbed and blocked', (t) => {
  t.ok(rendererJs.includes('isLegacyPhoneCompanionTokenMessage'), 'renderer detects legacy companion token announcements');
  t.ok(rendererJs.includes('scrubLegacyPhoneCompanionTokenMessages'), 'renderer migrates old stored token announcements');
  t.ok(rendererJs.includes('Phone Companion is available on this Wi-Fi at .*[\\?&]token='), 'legacy token URL pattern is explicit');
  t.ok(/function appendSystemMessage[\s\S]+isLegacyPhoneCompanionTokenMessage\(text\)[\s\S]+return;/.test(rendererJs), 'appendSystemMessage refuses legacy token announcement text');
  t.ok(rendererJs.includes('showPhoneCompanionPairingCard'), 'renderer updates phone companion pairing UI instead of legacy URL message');
  t.ok(rendererJs.includes('btnPhoneCompanion'), 'renderer exposes a top-bar phone companion button');
  t.ok(rendererJs.includes('phoneCompanionModal'), 'phone companion button opens a pairing modal independent of chat messages');
  t.ok(rendererJs.includes('refreshPhoneCompanionPairing'), 'renderer fetches pairing payload on startup instead of relying only on chat append');
  t.ok(rendererJs.includes('getPhoneCompanionPairing'), 'renderer uses IPC to populate phone companion button');
  t.ok(rendererJs.includes('enablePhoneCompanionLan'), 'phone button enables LAN mode before showing a phone QR');
  t.ok(rendererJs.includes('No localhost QR is shown for phones'), 'disabled LAN state does not render a misleading localhost QR');
  t.ok(rendererJs.includes('removeLegacyPhoneCompanionTokenBubbles'), 'renderer removes already-rendered legacy token bubbles');
  t.ok(/function renderSystemBubble[\s\S]+isLegacyPhoneCompanionTokenMessage\(text\)[\s\S]+return;/.test(rendererJs), 'renderSystemBubble refuses legacy token messages during history replay');
  const pairingFnStart = rendererJs.indexOf('function showPhoneCompanionPairingCard');
  const pairingFnEnd = rendererJs.indexOf('function updatePhoneCompanionPairingPanel');
  const pairingFn = rendererJs.slice(pairingFnStart, pairingFnEnd);
  t.notOk(pairingFn.includes('conv.messages.push'), 'pairing UI is not persisted into chat history');
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
