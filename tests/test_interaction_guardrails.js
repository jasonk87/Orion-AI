const test = require('tape');
const fs = require('fs');
const path = require('path');

const rendererJs = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
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

test('queued prompt cards can steer or run next after submission', (t) => {
  t.ok(rendererJs.includes('function createQueuedPromptId'), 'queued prompts get stable ids');
  t.ok(rendererJs.includes("source: 'queued-prompt'"), 'queued prompt cards persist with a distinct source');
  t.ok(rendererJs.includes('data-action="steer"'), 'queued card exposes a steer action');
  t.ok(rendererJs.includes('data-action="send-now"'), 'queued card exposes a send-now action');
  t.ok(rendererJs.includes('function promoteQueuedPromptToSteering'), 'queued prompt can be converted to steering');
  t.ok(rendererJs.includes('function sendQueuedPromptNow'), 'queued prompt can be promoted to immediate/next execution');
  t.ok(rendererJs.includes('window.promptQueue.unshift(item)'), 'send-now moves a busy queue item to the front');
  t.ok(rendererJs.includes('window.steeringQueue[conversationId].push(text)'), 'desktop steering is routed per conversation');
  t.notOk(rendererJs.includes('window.steeringQueue.push(text)'), 'desktop steering no longer writes to the unused global array path');
  t.ok(rendererJs.includes('window.markQueuedPromptRunning = markQueuedPromptRunning'), 'renderer exposes queued-card state updates to the agent');
  t.ok(agentJs.includes('window.markQueuedPromptRunning(nextTask.id, targetId)'), 'agent marks queued cards handled when they start running');
  t.end();
});

test('chat scrolling only sticks when the user is already near the bottom', (t) => {
  const directScrollAssignments = rendererJs.match(/el\.chatFeed\.scrollTop = el\.chatFeed\.scrollHeight/g) || [];
  t.equal(directScrollAssignments.length, 1, 'direct chat scroll assignment is isolated to the helper');
  t.ok(rendererJs.includes('function shouldAutoScrollChat'), 'renderer can detect whether the chat is near the bottom');
  t.ok(rendererJs.includes('CHAT_BOTTOM_THRESHOLD_PX'), 'auto-scroll has a small bottom threshold');
  t.ok(rendererJs.includes('scrollChatToBottomIfNeeded(stickToBottom)'), 'message renderers respect the sticky-bottom gate');
  t.end();
});

test('empty Thinking placeholders are not rendered as extra chat bubbles', (t) => {
  t.ok(rendererJs.includes('function isEmptyThinkingPlaceholder'), 'history replay can identify empty Thinking placeholders');
  t.ok(rendererJs.includes('if (isEmptyThinkingPlaceholder(replayMsg.text, replayLogs)) return;'), 'history replay skips empty Thinking placeholders after normalization');
  t.ok(rendererJs.includes('if (!activeAiBubble && isThinkingPlaceholder && !hasLogs)'), 'live rendering suppresses empty Thinking bubbles');
  t.ok(rendererJs.includes("const displayText = isThinkingPlaceholder ? ''"), 'Thinking placeholder text is hidden when logs/status are rendered');
  t.end();
});

test('conversation reload normalizes stored assistant message shapes', (t) => {
  t.ok(rendererJs.includes('function normalizeConversationMessageForReplay'), 'renderer normalizes stored messages before replay');
  t.ok(rendererJs.includes("role === 'assistant' || role === 'model' || role === 'ai' || role === 'orion'"), 'model/AI/orion roles replay as assistant answers');
  t.ok(rendererJs.includes('const directFields = [msg.text, msg.content, msg.output, msg.result, msg.message]'), 'replay reads assistant text from common stored fields');
  t.ok(rendererJs.includes('const arrayFields = [msg.parts, msg.content]'), 'replay reads Gemini/OpenAI-style message parts');
  t.ok(rendererJs.includes('renderAiMessage(replayMsg.text, replayLogs, activeConversationId, replayMsg)'), 'bulk reload renders normalized assistant text and metadata');
  t.ok(rendererJs.includes("map(normalizeConversationMessageForReplay).find(msg => msg.role === 'assistant')"), 'phone preview finds normalized assistant messages');
  t.ok(rendererJs.includes('function extractConversationMessageLogs'), 'replay rebuilds logs when old messages only stored turns');
  t.ok(rendererJs.includes('turn.toolResponseParts'), 'replay reads saved tool responses from old turns');
  t.ok(rendererJs.includes('responseLooksFailed'), 'replay preserves error status from saved tool responses');
  t.ok(agentJs.includes('function persistCurrentAgentLogs'), 'agent has a single persistence helper for live logs');
  t.ok(agentJs.includes('persistCurrentAgentLogs({ render: true });'), 'agent persists tool logs while rendering live activity');
  t.ok(
    /conversation\.messages\.push\(\{ role: 'assistant', text: 'Thinking\.\.\.', logs: \[\], turns: \[\], createdAt: Date\.now\(\) \}\);\s*if \(window\.saveConversationsToStorage\)/.test(agentJs),
    'agent immediately persists the assistant placeholder so reloads keep the agent side coherent'
  );
  const loopStart = agentJs.indexOf('window.runAgentLoop = async function');
  const placeholderIndex = agentJs.indexOf("conversation.messages.push({ role: 'assistant', text: 'Thinking...'", loopStart);
  const routingIndex = agentJs.indexOf('if (isInternalPrompt)', loopStart);
  t.ok(placeholderIndex > loopStart && placeholderIndex < routingIndex, 'assistant placeholder is saved before async routing/classification can fail');
  t.end();
});

test('accepted prompts cannot leave one-sided user-only transcripts', (t) => {
  t.ok(rendererJs.includes('function persistAssistantStatusMessage'), 'renderer has a shared persisted assistant-status helper');
  t.ok(rendererJs.includes('window.persistAssistantStatusMessage = persistAssistantStatusMessage'), 'agent can persist assistant status through renderer');
  t.ok(agentJs.includes('agent-start-blocked'), 'runAgentLoop persists an assistant-side status when another task is already running');
  t.ok(rendererJs.includes('phone-queued-'), 'phone queued prompts persist an assistant-side queue status');
  t.ok(rendererJs.includes('phone-start-error-'), 'phone run-start failures persist an assistant-side error status');
  t.ok(rendererJs.includes('function buildMissingAssistantResponseMessage'), 'reload path can recover old user-only transcripts');
  t.ok(rendererJs.includes('hasMeaningfulAssistantAfterUser'), 'reload recovery requires a meaningful assistant answer');
  t.ok(rendererJs.includes('!isEmptyThinkingPlaceholder(msg.text, logs)'), 'stale Thinking placeholders do not count as assistant answers');
  t.ok(rendererJs.includes('MISSING_ASSISTANT_RESPONSE_TEXT'), 'recovery message is explicit instead of blank');
  t.ok(rendererJs.includes('messages.push(recoveredAssistantMessage)'), 'phone state returns the recovery bubble to mobile clients');
  t.ok(rendererJs.includes('renderAiMessage(recoveredAssistantMessage.text'), 'desktop reload renders the same recovery bubble');
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
  // Routing is structural, not text-guessing: internal prompts always execute and the old
  // regex-based continuation detector is gone.
  t.ok(agentJs.includes('if (isInternalPrompt)'), 'internal prompts are routed structurally');
  t.notOk(agentJs.includes('isTaskContinuationPrompt'), 'regex continuation detector is removed');
  t.notOk(agentJs.includes('classifyPlanApprovalIntentFast'), 'regex approval fast-path is removed');
  t.end();
});

// Regression: the "Planning mode: direct task" system message was firing after clicking
// "Start Implementation" when a second non-internal loop ran while planApproved=true.
// Guard: the message must only appear for genuinely fresh tasks with no approved plan.
test('direct-task system message is suppressed when a plan is already approved', (t) => {
  t.ok(
    agentJs.includes('!conversation.planApproved && window.appendSystemMessage && planningBypassedForTask'),
    '"Planning mode: direct task" message is guarded by !conversation.planApproved'
  );
  t.end();
});

// Regression: after clicking "Start Implementation", the model was responding by
// summarizing/restating the plan instead of writing code. The execution prompt must
// explicitly forbid restating the plan and rewriting planning artifacts.
test('execution prompt after plan approval forbids restating or rewriting the plan', (t) => {
  t.ok(rendererJs.includes('Do not summarize, describe, or restate the plan'), 'execution prompt forbids restating the plan');
  t.ok(rendererJs.includes('Do not rewrite STRATEGY.md or implementation_plan.md'), 'execution prompt forbids rewriting planning artifacts');
  t.ok(rendererJs.includes('immediately start creating and editing the actual source code files'), 'execution prompt demands immediate code writing');
  t.end();
});

// Regression: the "Start Implementation" button used to revert to its unpressed state on any
// re-render because the plan card only existed while awaitingPlanApproval. The plan bubble is
// now marked persistently and re-renders into an "Implementation started" state after approval.
test('plan approval button shows a persistent started state after it is pressed', (t) => {
  // The plan bubble is marked so a reload can identify it without text guessing.
  t.ok(agentJs.includes('isPlanApprovalCard = true'), 'the plan-approval bubble is marked on the stored message');
  t.ok(rendererJs.includes('msgMeta'), 'renderAiMessage accepts the message object to identify the plan bubble');
  t.ok(rendererJs.includes('renderAiMessage(replayMsg.text, replayLogs, activeConversationId, replayMsg)'), 'bulk reload threads the normalized message object so the card persists');
  // After approval the card renders a started state instead of disappearing.
  t.ok(rendererJs.includes('✓ Implementation Started'), 'approved plan renders a persistent "Implementation Started" control');
  t.ok(rendererJs.includes("plan-approval-actions approved"), 'approved card carries the started styling hook');
  t.ok(rendererJs.includes('Implementation started'), 'approved card copy reflects that work has started');
  // The approved/started styling exists in CSS.
  const cssJs = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  t.ok(cssJs.includes('.plan-approval-actions.approved'), 'CSS defines the approved card treatment');
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
  t.ok(agentJs.includes('Do not rely on CDN-only frontend dependencies'), 'generated local apps should avoid CDN-only dependencies');
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
    toolName: 'change_workspace',
    args: { path: 'C:\\Users\\Owner\\Desktop\\rocket Samoa' },
    errorText: 'Workspace path "C:\\Users\\Owner\\Desktop\\rocket Samoa" is invalid or does not exist: Directory does not exist'
  }).category, 'workspace_path_missing', 'classifies missing workspace paths as resolvable path problems');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    errorText: 'npm: command not found'
  }).category, 'missing_dependency', 'classifies missing dependencies');
  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    errorText: 'npm: command not found'
  }).recommendedNature, 'fixable', 'missing dependencies are recommended as fixable');

  t.equal(agent.classifyAgentFailure({
    toolName: 'google_search',
    errorText: 'HTTP 401 invalid API key'
  }).category, 'auth_missing', 'classifies missing auth');
  t.equal(agent.classifyAgentFailure({
    toolName: 'google_search',
    errorText: 'HTTP 401 invalid API key'
  }).recommendedNature, 'terminal', 'missing auth is recommended as terminal');

  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    result: { timedOut: true },
    errorText: 'Command timed out'
  }).category, 'timeout', 'classifies timeouts');
  t.equal(agent.classifyAgentFailure({
    toolName: 'run_command',
    result: { timedOut: true },
    errorText: 'Command timed out'
  }).recommendedNature, 'transient', 'timeouts are recommended as transient');

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

test('workspace path resolver tolerates dictated folder-name variants', (t) => {
  t.equal(
    agent.normalizeLocalPathNameForMatch('rocket sumo'),
    agent.normalizeLocalPathNameForMatch('rocket-sumo'),
    'spaces and hyphens normalize to the same folder key'
  );
  t.equal(
    agent.chooseWorkspaceDirectoryVariant('rocket sumo', ['Axiom', 'Projects', 'rocket-sumo']),
    'rocket-sumo',
    'chooses the real hyphenated folder for a spaced dictated name'
  );
  t.equal(
    agent.chooseWorkspaceDirectoryVariant('rocket Samoa', ['Axiom', 'Projects', 'rocket-sumo']),
    'rocket-sumo',
    'chooses the real folder for a minor autocorrect/dictation variant'
  );
  t.equal(
    agent.chooseWorkspaceDirectoryVariant('rocket sumo', ['Axiom', 'Projects', 'rumi']),
    null,
    'does not invent a workspace when no plausible folder is present'
  );
  t.ok(agentJs.includes('listDirectoryChildren'), 'change_workspace uses a shallow directory lookup before falling back');
  t.ok(agentJs.includes('fuzzyResolved'), 'change_workspace reports when a folder-name variant was resolved');
  t.end();
});

test('workspace path resolver verifies a nearby real folder variant before failing', async (t) => {
  const originalApi = global.window.api;
  const realPath = 'C:\\Users\\Owner\\Desktop\\rocket-sumo';
  global.window.api = {
    listFiles: async (dirPath) => {
      if (dirPath === realPath) return [];
      return { error: `Directory does not exist: ${dirPath}` };
    },
    listDirectoryChildren: async (dirPath) => {
      if (dirPath === 'C:\\Users\\Owner\\Desktop') {
        return [
          { name: 'Axiom', path: 'C:\\Users\\Owner\\Desktop\\Axiom', isDir: true },
          { name: 'rocket-sumo', path: realPath, isDir: true }
        ];
      }
      return [];
    }
  };
  try {
    const result = await agent.resolveWorkspacePathForChange('C:\\Users\\Owner\\Desktop\\rocket sumo');
    t.equal(result.success, true, 'fuzzy workspace resolution succeeds');
    t.equal(result.path, realPath, 'resolves to the real hyphenated folder path');
    t.equal(result.fuzzyResolved, true, 'marks the result as a fuzzy recovery');
    t.equal(result.resolvedFrom, 'C:\\Users\\Owner\\Desktop\\rocket sumo', 'preserves the original guessed path for logs');
  } finally {
    global.window.api = originalApi;
  }
  t.end();
});

test('workspace resolution carries evidence forward from later desktop listings', (t) => {
  const conversation = {};
  agent.rememberPendingWorkspaceResolution(
    conversation,
    'C:\\Users\\Owner\\Desktop\\rocket sumo',
    'I have a folder on my desktop called rocket sumo. Read through it and give me suggestions.'
  );
  const desktopListing = [
    '',
    '    Directory: C:\\Users\\Owner\\Desktop',
    '',
    'Mode                 LastWriteTime         Length Name',
    '----                 -------------         ------ ----',
    'd-----          7/3/2026   4:42 AM                rocket-sumo',
    'd-----         6/28/2026   4:41 PM                Projects'
  ].join('\r\n');
  const candidates = agent.extractDirectoryCandidatesFromCommandOutput(
    desktopListing,
    'Get-ChildItem -Path C:\\Users\\Owner\\Desktop -Directory -Depth 2 -ErrorAction SilentlyContinue'
  );
  t.ok(candidates.some(candidate => candidate.name === 'rocket-sumo'), 'extracts real folder names from PowerShell table output');
  t.ok(candidates.some(candidate => candidate.path === 'C:\\Users\\Owner\\Desktop\\rocket-sumo'), 'infers full path from the command parent path');

  const hint = agent.buildPendingWorkspaceResolutionHint({
    toolName: 'run_command',
    args: { command: 'Get-ChildItem -Path C:\\Users\\Owner\\Desktop -Directory -Depth 2 -ErrorAction SilentlyContinue' },
    result: { exitCode: 0, stdout: desktopListing },
    conversation
  });
  t.equal(hint.matchedPath, 'C:\\Users\\Owner\\Desktop\\rocket-sumo', 'connects later Desktop evidence to the previously failed workspace name');
  const correction = agent.buildPendingWorkspaceResolutionCorrectionPrompt(
    "I couldn't find a folder named rocket sumo. Could you verify the spelling?",
    [{ toolName: 'run_command', status: 'done', localDirectoryResolution: hint }]
  );
  t.ok(correction.includes('Do not ask the user to verify the spelling again'), 'correction blocks the lost verify-spelling answer');
  t.ok(correction.includes('change_workspace'), 'correction pushes the next concrete workspace action');
  t.end();
});

test('local system fact failures do not become fake blockers or web research', (t) => {
  t.equal(agent.isLocalSystemFactRequest('how much memory does my computer have left?'), true, 'recognizes local memory query');
  t.equal(agent.isLocalSystemFactRequest('what do you think about my computer performance wise?'), true, 'recognizes local performance assessment query');
  t.equal(agent.isLocalSystemFactRequest('look up Gemini API docs'), false, 'does not classify docs research as local system fact');
  t.equal(agent.isGenericNonAnswer('Understood.'), true, 'recognizes generic acknowledgement as a non-answer');
  t.equal(agent.requestNeedsLocalInspection('what do you think about my computer performance wise?'), true, 'performance assessment requires local inspection');
  t.equal(
    agent.isLocalProjectOrFolderRequest('I have a folder on my desktop called rocket sumo, recommend similar games and improvements'),
    true,
    'local project recommendations require filesystem inspection before advice'
  );
  t.equal(
    agent.requestNeedsLocalInspection('I have a folder on my desktop called rocket sumo, recommend similar games and improvements'),
    true,
    'local project recommendations are local inspection requests'
  );
  t.equal(
    agent.isLocalAccessDeflection("I can only access file system locations that are explicitly provided to me or are within the defined workspace."),
    true,
    'recognizes false local-access disclaimers'
  );
  t.equal(
    agent.shouldHaveUsedToolsButDidNot('Understood.', [], 'what do you think about my computer performance wise?'),
    true,
    'generic acknowledgement cannot satisfy a local performance request without tools'
  );
  t.equal(
    agent.shouldHaveUsedToolsButDidNot(
      "I can only access file system locations that are explicitly provided to me or are within the defined workspace. Please provide the full path or describe the games.",
      [],
      'I have a folder on my desktop called rocket sumo, recommend similar games and improvements'
    ),
    true,
    'local project recommendations cannot be answered with access disclaimers instead of tools'
  );
  const localFolderGuidance = agent.buildLocalInspectionNoToolGuidance('I have a folder on my desktop called rocket sumo, recommend similar games and improvements');
  t.ok(
    localFolderGuidance.includes('Get-ChildItem') && localFolderGuidance.includes('change_workspace'),
    'local project no-tool recovery tells Orion to try change_workspace then fall back to a directory search'
  );
  // Regression: guidance previously told Orion to manually search with Get-ChildItem BEFORE
  // calling change_workspace, even though change_workspace already fuzzy-matches folder names
  // (ignoring spaces/hyphens/case) against Desktop/Desktop\Projects/Desktop\projects. A manual
  // search using the user's literal phrasing (e.g. "mayor life") can miss a real folder named
  // "Mayor-Life" that change_workspace's fuzzy resolver would have found directly, sending Orion
  // down a wrong-directory rabbit hole. change_workspace must be tried first now.
  t.ok(
    localFolderGuidance.indexOf('change_workspace') < localFolderGuidance.indexOf('Get-ChildItem'),
    'local project recovery tries change_workspace (fuzzy name resolution) before a manual directory search'
  );
  t.ok(
    localFolderGuidance.includes('fuzzy'),
    'local project recovery explains that change_workspace already fuzzy-matches folder names'
  );
  t.ok(agentJs.includes('LOCAL PROJECTS BEFORE CLARIFICATION'), 'system prompt requires project inspection before clarification');
  t.ok(agentJs.includes('TOP-LEVEL FOLDER LISTS'), 'system prompt distinguishes top-level listings from recursive searches');
  t.ok(agentJs.includes('EVIDENCE CONTINUITY'), 'system prompt tells Orion to connect later filesystem evidence to prior path failures');
  t.ok(agentJs.includes('do not add -Depth/-Recurse unless nested folders are explicitly requested') || agentJs.includes('Do not add -Depth or -Recurse for a top-level list request'), 'run_command contract blocks recursive top-level folder dumps');
  t.ok(agentJs.includes('Do not use this as a substitute for inspecting an existing local folder/project/program'), 'clarifying tool contract blocks premature clarification');
  t.equal(
    agent.shouldHaveUsedToolsButDidNot('I do not know your name yet.', [], 'do you know my name?'),
    false,
    'identity behavior is taught through the memory prompt contract, not a keyword recovery gate'
  );
  t.equal(
    agent.shouldHaveUsedToolsButDidNot(
      "Okay, I can help with that. Please tell me which program or files you'd like me to inspect.",
      [],
      "Let's look through this program and see if we can find any bugs, structural errors or typos",
      { reviewOnly: true }
    ),
    true,
    'review-only workspace inspections cannot ask the user which files instead of using tools'
  );
  t.equal(
    agent.shouldHaveUsedToolsButDidNot(
      'I found one issue after reading files.',
      [{ toolName: 'read_file', label: 'Read agent.js', status: 'done' }],
      "Let's look through this program and see if we can find any bugs",
      { reviewOnly: true }
    ),
    false,
    'review-only answers with inspection evidence can proceed'
  );
  t.ok(agentJs.includes('Call `list_files` now'), 'review-only no-tool recovery explicitly sends Orion to list files');
  t.ok(agentJs.includes('Do not ask the user which files or program to inspect'), 'review-only recovery blocks the screenshot deflection');
  t.ok(agentJs.includes('Own being Orion'), 'system prompt tells Orion to own its identity');
  t.ok(agentJs.includes("I don't have your name saved yet"), 'system prompt gives a natural unknown-name response');
  t.ok(agentJs.includes('MEMORY REASONING CONTRACT'), 'system prompt defines durable memory behavior');
  t.ok(agentJs.includes('MEMORY EXAMPLES'), 'system prompt teaches memory behavior through examples');
  t.ok(agentJs.includes('Orion should call remember_fact with global scope'), 'memory examples teach fact persistence without code keywords');
  t.ok(agentJs.includes('Orion should use active chat context or recall_memory'), 'memory examples teach recall without code keyword gates');
  t.notOk(agentJs.includes('function extractUserNameDisclosure'), 'identity name regex helper is removed');
  t.notOk(agentJs.includes('function isUserIdentityQuestion'), 'identity question keyword helper is removed');
  t.notOk(agentJs.includes('function buildMemoryRecallPrompt'), 'identity-specific recovery prompt helper is removed');
  t.notOk(agentJs.includes('workspaceKeywords'), 'no-tool recovery no longer uses a workspace keyword list');
  t.equal(agent.requestNeedsActionableFinalAnswer('how do we improve Orion after this run?'), false, 'final answer quality no longer depends on prompt keyword routing');
  t.equal(
    agent.requestNeedsActionableFinalAnswer('can you give me some ideas for how to make this program better, more professional, more cutting edge, etc?'),
    false,
    'idea/professional/cutting-edge prompts are not special-cased by keyword'
  );
  t.equal(agent.answerHasActionableFinalContent('Ah! The path is C:\\Projects\\OrionAI.'), false, 'half-thought path discovery is not an actionable answer');
  t.ok(
    agent.buildFinalAnswerQualityGatePrompt(
      'tell me about this workspace',
      'Ah! The path is C:\\Projects\\OrionAI.',
      [{ toolName: 'read_file', label: 'Read agent.js', status: 'done' }]
    ).includes('inspection alone is not completion'),
    'final quality gate rejects inspection-only non-answers after tool use'
  );
  t.ok(
    agent.buildFinalAnswerQualityGatePrompt(
      'any prompt text',
      '',
      [{ toolName: 'list_files', label: 'Listed workspace files', status: 'done' }]
    ).includes('inventory-level evidence'),
    'final quality gate rejects empty answer after list_files without prompt keywords'
  );
  t.equal(
    agent.hasOnlyInventoryEvidence([{ toolName: 'list_files', label: 'Listed workspace files', status: 'done' }]),
    true,
    'list_files alone is only inventory-level evidence'
  );
  const rocketDirectorySearch = {
    toolName: 'run_command',
    kind: 'command',
    command: 'Get-ChildItem -Path "C:\\Users\\Owner\\Desktop" -Filter "*rocket*" -Directory -Depth 3 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName',
    label: 'Ran directory search',
    status: 'done'
  };
  t.equal(agent.isInventoryOnlyCommand(rocketDirectorySearch.command), true, 'bounded directory search is inventory-only evidence');
  t.equal(
    agent.hasOnlyInventoryEvidence([
      rocketDirectorySearch,
      { toolName: 'change_workspace', label: 'Used `change_workspace`', status: 'done' },
      { toolName: 'list_files', label: 'Listed workspace files', status: 'done' }
    ]),
    true,
    'path resolution plus list_files is still inventory-only without reading source files'
  );
  t.equal(
    agent.hasDeepInspectionEvidence([
      rocketDirectorySearch,
      { toolName: 'list_files', label: 'Listed workspace files', status: 'done' }
    ]),
    false,
    'directory discovery commands do not count as reading through a program'
  );
  t.ok(
    agent.buildFinalAnswerQualityGatePrompt(
      'Read through the program and tell me what you think about it. Where do we go from here?',
      'It appears to be a Node.js web application based on package.json, server.js, and public/index.html.',
      [
        rocketDirectorySearch,
        { toolName: 'change_workspace', label: 'Used `change_workspace`', status: 'done' },
        { toolName: 'list_files', label: 'Listed workspace files', status: 'done' }
      ]
    ).includes('File names alone are not enough'),
    'read-through-program requests cannot be answered from path search and filenames only'
  );
  t.ok(agentJs.includes('Active conversation workspace (resolved):'), 'run prompt surfaces the resolved conversation workspace');
  t.ok(agentJs.includes('Do not re-run change_workspace for an older dictated/autocorrected folder phrase'), 'run prompt prevents repeated guessed workspace changes after resolution');
  t.ok(
    agent.buildFinalAnswerQualityGatePrompt(
      'any prompt text',
      'Based on the file structure, here are some ideas: add multimodal support, improve memory, add plugins, and polish the UI.',
      [{ toolName: 'list_files', label: 'Listed workspace files', status: 'done' }]
    ).includes('File names alone are not enough'),
    'final quality gate rejects broad analysis from file inventory alone'
  );
  t.equal(
    agent.hasDeepInspectionEvidence([{ toolName: 'read_file', label: 'Read agent.js', status: 'done' }]),
    true,
    'read_file counts as deeper inspection evidence'
  );
  const inspectedThenRemembered = [
    { toolName: 'read_file', label: 'Read `server.js`', status: 'done' },
    { toolName: 'read_file', label: 'Read `public/controller.html`', status: 'done' },
    { toolName: 'remember_fact', label: 'Used remember_fact', status: 'done' }
  ];
  t.ok(
    agent.buildFinalAnswerQualityGatePrompt(
      'what do you think about this program?',
      "We're all set here! My review above is the complete answer. Enjoy your arcade hub.",
      inspectedThenRemembered
    ).includes('not self-contained'),
    'final quality gate rejects a memory-follow-up answer that is not grounded in inspected evidence'
  );
  t.equal(
    agent.buildFinalAnswerQualityGatePrompt(
      'what do you think about this program?',
      'The strongest part is the playful arcade scope, but server.js is carrying too many modes and public/controller.html has grown into a dense controller surface. I would split game-mode logic out of the server first, then tighten the controller panels around the active mode.',
      inspectedThenRemembered
    ),
    '',
    'final quality gate accepts a self-contained answer grounded in inspected files after memory persistence'
  );
  const oneFileReview = [
    { toolName: 'list_files', label: 'Listed workspace files', status: 'done' },
    { toolName: 'read_file', label: 'Read `ai_assistant/communication/cli.py`', status: 'done' }
  ];
  t.ok(
    agent.buildReviewOnlyCompletionGatePrompt(
      'Can you go through this program and find any bugs, errors or structural problems',
      'The file `ai_assistant/communication/cli.py` appears to be the main CLI. Potential areas for bugs include command parsing and TUI state. Would you like me to try running commands?',
      oneFileReview
    ).includes('not inspected enough'),
    'review-only gate rejects one-file generic potential-areas reviews'
  );
  const broadReview = [
    { toolName: 'list_files', label: 'Listed workspace files', status: 'done' },
    { toolName: 'read_file', label: 'Read `ai_assistant/communication/cli.py`', status: 'done' },
    { toolName: 'read_file', label: 'Read `ai_assistant/core/orchestrator.py`', status: 'done' },
    { toolName: 'read_file', label: 'Read `pyproject.toml`', status: 'done' }
  ];
  t.equal(
    agent.buildReviewOnlyCompletionGatePrompt(
      'Can you go through this program and find any bugs, errors or structural problems',
      'Findings:\n- Major issue in `ai_assistant/communication/cli.py:42`: the command parser splits on whitespace, so paths with spaces are misparsed. Impact: project paths can fail in normal Windows usage.\n- No specific issues found in `pyproject.toml` after checking dependency declarations.',
      broadReview
    ),
    '',
    'review-only gate accepts broad grounded findings'
  );
  t.equal(
    agent.answerHasGroundedReviewReport('I reviewed `app.py:10` and found one issue. Would you like me to continue inspecting?'),
    false,
    'grounded review report cannot ask permission to continue instead of finishing'
  );
  t.equal(
    agent.answerHasActionableFinalContent('I reviewed the project structure and found that the agent loop can gather context without producing a useful final response. The next step is to continue from the gathered files, read the core source modules, and give the user a grounded answer instead of stopping at file inventory. This is a substantive response with enough detail to stand on its own.'),
    true,
    'substantive answers satisfy the final quality gate without action keywords'
  );

  // A user reported a real UX problem: the model writes a long, detailed narrative answer, a gate
  // catches it as not-yet-grounded/not-actionable and forces a redo, and the redo produces a
  // shorter, different summary. Gate messages that can trigger a full redo must make the next
  // response standalone without inviting the model to talk about an "answer above."
  t.ok(
    agent.buildReviewOnlyCompletionGatePrompt(
      'Can you go through this program and find any bugs, errors or structural problems',
      'I reviewed `app.py:10` and found one issue. Would you like me to continue inspecting?',
      broadReview
    ).includes('Only the final saved assistant response counts'),
    'review-only completion gate asks for a standalone final response without answer-above wording'
  );
  t.ok(
    agent.buildFinalAnswerQualityGatePrompt(
      'tell me about this workspace',
      'Ah! The path is C:\\Projects\\OrionAI.',
      [{ toolName: 'read_file', label: 'Read agent.js', status: 'done' }]
    ).includes('Only the final saved assistant response counts'),
    'final-answer quality gate asks for a standalone final response without answer-above wording'
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

test('task routing is decided by the model classifier, not keyword regex', (t) => {
  // The brittle keyword router was removed; classifyPlanningNeed (model) makes the call
  // and carries a structured reviewOnly flag instead of a regex route.
  t.notOk(agentJs.includes('function classifySimpleTask'), 'keyword simple-task router is removed');
  t.notOk(agentJs.includes("route: 'local_project_review'"), 'keyword review route is removed');
  t.ok(agentJs.includes('reviewOnly'), 'review-only intent is carried by the model classifier');
  const answer = agent.buildLocalMemoryAnswer('FreePhysicalMemory=4194304\r\nTotalVisibleMemorySize=12582912\r\n');
  t.ok(answer.startsWith('Your computer has about 12.00 GB'), 'memory answer leads with direct answer');
  t.ok(answer.includes('4.00 GB is currently free'), 'memory answer includes available RAM when present');
  t.end();
});

test('project conversations provide project path as the agent workspace', (t) => {
  global.window.getCurrentWorkspace = () => 'C:\\Desktop\\Fallback';
  t.equal(
    agent.resolveConversationWorkspace({ workspace: '', projectPath: 'C:\\Projects\\OrionTarget' }),
    'C:\\Projects\\OrionTarget',
    'projectPath is a first-class workspace fallback'
  );
  t.equal(
    agent.resolveConversationWorkspace({ workspace: 'C:\\Projects\\Explicit', projectPath: 'C:\\Projects\\OrionTarget' }),
    'C:\\Projects\\Explicit',
    'explicit workspace still wins'
  );
  t.equal(
    agent.resolveConversationWorkspace({}),
    'C:\\Desktop\\Fallback',
    'desktop workspace is only the final fallback'
  );
  t.end();
});

test('failure taxonomy produces specific recovery guidance', (t) => {
  const patchGuidance = agent.buildFailureRecoveryGuidance({ category: 'patch_target_missing' });
  t.ok(patchGuidance.includes('Re-read the surrounding file lines'), 'patch guidance asks to inspect current file context');
  t.ok(patchGuidance.includes('line-range patch'), 'patch guidance suggests a narrower edit strategy');

  const workspaceGuidance = agent.buildFailureRecoveryGuidance({ category: 'workspace_path_missing' });
  t.ok(workspaceGuidance.includes('Do not call change_workspace again with another guessed path'), 'workspace guidance blocks blind retry');
  t.ok(workspaceGuidance.includes('Get-ChildItem'), 'workspace guidance requires local directory search');
  t.ok(workspaceGuidance.includes('C:\\Users\\Owner\\Desktop'), 'workspace guidance searches Desktop');
  t.ok(workspaceGuidance.includes('-Depth 2 or -Depth 3'), 'workspace guidance keeps filesystem search bounded');

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
  t.ok(noToolGuidance.includes('do not mention tools'), 'model no-tool-use guidance prevents meta tool narration');
  t.notOk(noToolGuidance.includes('answer explicitly that no workspace action was needed'), 'model no-tool-use guidance no longer asks for meta no-tool answers');

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
  t.ok(agentJs.includes('MODEL_API_MAX_ATTEMPTS = 15'), 'Gemini retry attempts support long-running tasks');
  t.ok(agentJs.includes('fetchWithTimeout(url'), 'Gemini generateContent uses timeout-aware fetch');
  t.ok(agentJs.includes('activeRunController = new AbortController()'), 'each agent run owns a cancellation controller');
  t.ok(agentJs.includes("window.stopAgentExecution = (options = {})"), 'stop API accepts cancellation options');
  t.ok(agentJs.includes("requestAgentStop({ mode: options.mode || 'hard' })"), 'default stop path is hard cancellation');
  t.ok(agentJs.includes('window.softStopAgentExecution'), 'soft stop is available for graceful stop-before-next-turn behavior');
  t.ok(agentJs.includes('activeRunController.abort()'), 'hard stop aborts the active model request controller');
  t.ok(agentJs.includes('signal: getActiveRunSignal()'), 'model calls receive the active run cancellation signal');
  t.ok(agentJs.includes('sleepRespectingStop(modelCallDelayMs)'), 'model-call delay can be cancelled by stop');
  t.ok(agentJs.includes('Task stopped by user after the current tool call.'), 'soft stop after a tool call is persisted explicitly');
  t.ok(agentJs.includes('sleepWithModelApiStatus'), 'retry backoff is routed through status-aware sleep');
  t.ok(agentJs.includes('isStopRequested'), 'retry wait can react to user stop');
  t.ok(agentJs.includes('agentSubStatus = warningMsg'), 'provider cooldown warnings update visible substatus');
  t.ok(agentJs.includes('Provider wait/cooldown active'), 'rate-limit retry state is explicit');
  t.ok(agentJs.includes('candidate.finishReason === "MAX_TOKENS"'), 'MAX_TOKENS responses trigger continuation recovery');
  t.ok(agentJs.includes('Continue from the exact current state'), 'MAX_TOKENS recovery avoids restarting work');
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
  t.equal(agent.isRealVerificationCommand('node test.js'), true, 'node test.js counts as verification');
  t.ok(agentJs.includes('postEditEvidenceLoopExtensions'), 'post-edit verification can extend loop budget before finalizing');
  t.ok(agentJs.includes('completionGateLoopExtensions'), 'completion gate can extend loop budget before surfacing continue_work');
  t.ok(agentJs.includes('Do not answer with another status-only summary'), 'completion gate pushes concrete work instead of status-only summaries');

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

test('list_files curated inventory hides noisy and sensitive workspace paths by default', (t) => {
  const inventory = agent.buildCuratedFileInventory([
    { path: 'agent.js', isDir: false, size: 10 },
    { path: 'lib/shared.js', isDir: false, size: 10 },
    { path: '.env', isDir: false, size: 20 },
    { path: '.env.example', isDir: false, size: 20 },
    { path: '.orion/backups/agent.js.bak', isDir: false, size: 10 },
    { path: '.claude/settings.local.json', isDir: false, size: 20 },
    { path: 'instance/users.json', isDir: false, size: 20 },
    { path: 'src/__pycache__/main.cpython-313.pyc', isDir: false, size: 10 },
    { path: 'node_modules/pkg/index.js', isDir: false, size: 10 },
    { path: 'secrets/token.json', isDir: false, size: 20 }
  ]);

  const returnedPaths = inventory.files.map(file => file.path);
  t.deepEqual(returnedPaths, ['agent.js', 'lib/shared.js', '.env.example'], 'default inventory keeps source files and safe examples only');
  t.equal(inventory.mode, 'project', 'default mode is project inventory');
  t.equal(inventory.totals.hidden, 7, 'hidden count includes runtime, cache, dependency, tool-settings, and sensitive paths');
  t.ok(inventory.omitted.some(item => item.path === '.orion'), 'collapses Orion runtime metadata');
  t.ok(inventory.omitted.some(item => item.path === '.claude'), 'collapses Claude Code tool settings');
  t.ok(inventory.omitted.some(item => item.path === 'instance'), 'collapses instance/user data');
  t.ok(inventory.omitted.some(item => item.path === '.env'), 'omits actual env files');
  t.ok(inventory.warning.includes('mode="all"'), 'warning points to explicit raw listing escape hatch');
  t.end();
});

// Regression: a real implementation plan labeled steps "Estimated Time: 4 hours", "3 hours", etc.
// — calibrated as if a human developer were writing that code by hand, not an AI agent executing
// tool calls back-to-back. The system prompt had no guidance on this at all, so the model filled
// the gap with generic human-project-plan conventions from its training.
test('system prompt calibrates time estimates to an AI agent, not a human developer', (t) => {
  t.ok(agentJs.includes('REALISTIC TIME ESTIMATES'), 'system prompt addresses plan time-estimate calibration');
  t.ok(agentJs.includes('not for a human developer'), 'system prompt explicitly rules out human-developer-hours estimates');
  t.ok(agentJs.includes('Never label a step "N hours"'), 'system prompt forbids hour-scale estimates calibrated to human authoring time');
  t.end();
});

// Regression: a real workspace showed implementation_plan.md, STRATEGY.md, and
// work_walkthrough.md sitting alongside real project files in list_files output, and a stray
// controller.html.bak backup outside .orion/ (from an edit backup written next to the source
// file). None of these are project files the user wrote — they're Orion's own planning/backup
// artifacts and should not clutter the default project inventory.
test('list_files curated inventory hides Orion-generated planning docs and backup files', (t) => {
  const inventory = agent.buildCuratedFileInventory([
    { path: 'server.js', isDir: false, size: 10 },
    { path: 'public/controller.html', isDir: false, size: 10 },
    { path: 'implementation_plan.md', isDir: false, size: 20 },
    { path: 'STRATEGY.md', isDir: false, size: 20 },
    { path: 'work_walkthrough.md', isDir: false, size: 20 },
    { path: 'public/controller.html.bak', isDir: false, size: 10 }
  ]);

  const returnedPaths = inventory.files.map(file => file.path);
  t.deepEqual(returnedPaths, ['server.js', 'public/controller.html'], 'default inventory keeps only real project source files');
  t.ok(inventory.omitted.some(item => item.path === 'implementation_plan.md'), 'hides the implementation plan Orion wrote');
  t.ok(inventory.omitted.some(item => item.path === 'STRATEGY.md'), 'hides the strategy doc Orion wrote');
  t.ok(inventory.omitted.some(item => item.path === 'work_walkthrough.md'), 'hides the work walkthrough Orion wrote');
  t.ok(inventory.omitted.some(item => item.path === 'public/controller.html.bak'), 'hides a stray edit backup outside .orion/');
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
  t.ok(agentJs.includes("isStrategy ? 'Created mission strategy' : `Write \\`"), 'source write label is neutral until execution succeeds');
  t.end();
});

test('workspace artifacts and file explorer controls are wired', (t) => {
  t.ok(agentJs.includes('buildRunArtifactPayload'), 'agent builds external run artifact payloads');
  t.ok(agentJs.includes('writeRunArtifact'), 'agent writes run artifacts through IPC');
  t.ok(agentJs.includes('persistVisualArtifactForTool'), 'agent writes screenshot artifacts as soon as they are captured');
  t.ok(agentJs.includes("type: 'orion-visual-artifact'"), 'screenshot artifacts have a dedicated artifact type');
  t.ok(agentJs.includes('collectVisualArtifacts'), 'final run artifacts retain visual artifact metadata');
  t.ok(preloadJs.includes('readConversationArtifact'), 'preload exposes conversation-scoped artifact reads');
  t.ok(preloadJs.includes('deleteConversationArtifacts'), 'preload exposes conversation artifact cleanup');
  t.ok(rendererJs.includes('Artifacts are saved outside the project after runs'), 'artifact panel explains project-isolated storage');
  t.ok(rendererJs.includes('cleanupConversationArtifacts'), 'conversation deletion cleans up external artifacts');
  t.ok(rendererJs.includes('openImageArtifact'), 'renderer can open screenshot artifacts');
  t.ok(rendererJs.includes('readWorkspaceFileBase64'), 'renderer loads screenshot and PNG files through the image viewer');
  t.ok(rendererJs.includes('window.loadRunArtifacts = loadRunArtifacts'), 'agent can refresh the artifact panel after saving screenshot artifacts');
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
  t.ok(rendererJs.includes('conv.workspace = conv.projectPath || getStandaloneWorkspaceForTitle(conv.title, conv.id)'), 'standalone phone prompt initializes an isolated workspace');
  t.end();
});

test('stuck diagnosis prefers adapting or preserving state over quitting', (t) => {
  const quotaAdvice = agent.diagnoseModelApiFailure('HTTP 429 Resource has been exhausted');
  t.ok(quotaAdvice.includes('resume after cooldown'), 'quota advice schedules recovery posture');
  t.notOk(quotaAdvice.toLowerCase().includes('quit'), 'quota advice does not tell Orion to quit');

  const spendCapAdvice = agent.diagnoseModelApiFailure('HTTP 429 Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend');
  t.ok(spendCapAdvice.includes('monthly spend cap'), 'monthly spend caps get a specific diagnosis');
  t.ok(spendCapAdvice.includes('retries or model escalation will not continue'), 'monthly spend caps do not encourage retry loops');

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

test('checklist updates allow marking a milestone in-progress but block repeated no-op refreshes', (t) => {
  t.ok(agentJs.includes("Do not call repeatedly for the same state"), 'tool description warns against repeated no-op refreshes');
  t.ok(agentJs.includes('Do not call it repeatedly just to refresh the same in-progress state'), 'system prompt blocks repeated in-progress refreshes');

  const initial = agent.shouldApplyChecklistUpdate([], [
    { title: 'Explore the codebase', status: 'pending' },
    { title: 'Implement fix', status: 'pending' },
  ]);
  t.equal(initial.allowed, true, 'initial checklist creation is allowed');

  const startingWork = agent.shouldApplyChecklistUpdate([
    { title: 'Explore the codebase', status: 'pending' },
    { title: 'Implement fix', status: 'pending' },
  ], [
    { title: 'Explore the codebase', status: 'in-progress' },
    { title: 'Implement fix', status: 'pending' },
  ]);
  t.equal(startingWork.allowed, true, 'pending to in-progress is allowed when starting a milestone');

  const churn = agent.shouldApplyChecklistUpdate([
    { title: 'Explore the codebase', status: 'in-progress' },
    { title: 'Implement fix', status: 'pending' },
  ], [
    { title: 'Explore the codebase', status: 'in-progress' },
    { title: 'Implement fix', status: 'pending' },
  ]);
  t.equal(churn.allowed, false, 'resending the exact same in-progress state is skipped as a no-op');

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
