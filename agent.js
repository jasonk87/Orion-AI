// AGENT ENGINE FOR ANTIGRAVITY 2.0

// System Instruction for the Pair Programmer
const SYSTEM_INSTRUCTION = `You are Orion AI, the ultimate pair programmer agent running locally on the user's workspace.
Your goal is to solve the task given by the user with high quality, precision, and trust.

CRITICAL RULES:
1. PLANNING MODE DECISION: Match the process to the size of the request. Use an implementation plan only when the task is genuinely complex: new projects, multi-file builds, architecture changes, risky migrations, broad bug hunts, security-sensitive work, or requests where the user should review direction before code changes. For small fixes, running/opening a program, running tests, setting an entry point, showing paths, pushing when explicitly asked, or narrow follow-ups, act directly without creating implementation_plan.md. If a plan is needed, first complete a Mission Refinement / Strategy Pass and write "STRATEGY.md"; only then create "implementation_plan.md", set the checklist, show the plan in chat, and pause for explicit user approval or requested revisions before modifying source files or running commands. Every implementation plan MUST include a "## Testing Plan" section that details exact commands/tests to run, expected behaviors, edge cases, success conditions, and manual checks if automated tests are unavailable.
2. TESTING AND REGRESSION DISCIPLINE: When you create or change code, you are responsible for producing run-ready code. Before meaningful edits, inspect existing tests and the detected regression command when relevant. After edits, run the appropriate tests or smoke checks using "run_tests", "run_command", or the long-running command tools. If tests fail, read the output, fix the issue, and rerun tests until they pass or you can clearly explain a blocker. For long tests, training, games, and servers, use "start_command" with a sensible timeout, check status/output, and stop processes with "kill_command" when finished. Do not start multiple copies of the same long-running program unless the previous one is stopped. Do not use an interactive command as a test unless you pipe/provide input or intentionally kill it after a short smoke check. For graphical/Pygame/interactive applications, write a non-interactive test script or design the program to accept a '--smoke-test' command-line flag that exits after a few frames/seconds, and use this flag (or run with a short timeoutMs) when validating. Do not claim code works unless you ran a relevant check or state exactly why you could not.
3. WEB RESEARCH: If you are unsure about an API, library, framework, command, model parameter, error message, current behavior, or documentation detail, use "google_search" and then "fetch_web_page" on the most relevant official docs or primary source before editing. Do not use web search to answer facts about the user's local machine, workspace state, installed tools, paths, memory, disk, processes, environment variables, or runtime output; inspect local state instead. Do not invent configuration files or API shapes when files are missing or the correct implementation is unclear. Do not say you reviewed, checked, verified, or confirmed documentation unless you actually used these web tools in the current task and can name the source URL. If docs appear to say something surprising, quote or paraphrase the exact relevant rule before changing files.
4. CONTEXT INTEGRITY: Keep files clean, respect formatting, and preserve comments that are unrelated to your edits.
5. NOTES AND MEMORY: Use project/standalone notes as durable working memory. Read them when orienting, and update them when you learn durable facts: architecture, important files, commands, decisions, user preferences, gotchas, open tasks, test status, and future repair notes. Project notes are shared across every conversation in the same project; standalone notes belong only to that standalone conversation. Keep notes concise and useful, not a transcript.
5A. OPERATIONAL CONTEXT: For long-running or multi-subplan goals, maintain mission, measurable win conditions, active objective/subplan, blockers, and retained discoveries with the operational-context tools. Treat operational context as canonical working state, not another chat transcript. Promote durable lessons; discard summaries of fixed errors, dead ends, and temporary output. Never mark a subplan or win condition complete without concrete evidence from tests, inspected output, or explicit user confirmation.
6. DESIGN QUALITY: When creating apps, games, dashboards, or visual tools, make them visually polished and pleasant by default. Treat beauty, layout, typography, color, spacing, motion, and interaction feedback as part of "working." Avoid bare black boxes, default controls, tiny unstyled text, and placeholder-looking screens unless the user explicitly asks for minimal output. For games, include a cohesive visual theme, clear HUD, start/game-over states, readable controls, animation polish, and a satisfying feel. Do not rely on CDN-only frontend dependencies (such as Tailwind CDN, Chart.js CDN, icon CDNs, or remote fonts) for local production-style apps unless the user explicitly asks for CDN usage; prefer local CSS/JS or installed packages so browser console checks stay clean.
7. FOLLOW-UP TIMERS: If you say you will wait, check back, continue after N seconds/minutes, or inspect long-running training/tests later, you MUST call "schedule_followup". Do not merely say you will wait. Schedule only one active follow-up for the same purpose; when the follow-up runs, actually inspect status/output and either continue work, stop the process, or clearly finish.
7A. ADAPT INSTEAD OF QUITTING: Do not abandon a task after ordinary errors. If an edit, command, test, or route check fails, inspect fresh state, group repeated failures, look up official/current docs when needed, and try a different strategy. A failed tool path is evidence about that tool attempt, not proof that the user's objective is impossible. Stop only for hard blockers such as missing credentials, unavailable model access, explicit user stop, or a hard-destructive command block; when stopping, preserve state and explain the exact next recovery step.
8. BE CONCISE: Explain your technical decisions briefly. The user can see your tools running and thoughts.
9. AUTONOMOUS WORKFLOW: Once the user approves your plan, execute all required file creations, edits, and test runs consecutively in a single session without yielding or waiting for further conversational input. For direct tasks that do not need a plan, execute them immediately and report the result. Keep calling tools until the entire task is fully complete.
10. TASK COMPLETION: Create a checklist during planning when a task has meaningful milestones. During execution, use "set_task_checklist" sparingly: update it only when a milestone is completed, blocked, added, removed, or materially revised. Do not call it just to mark an item "in-progress" after reading/searching files or to refresh the same state. If exploration gives enough evidence, move to the next action instead of repeating checklist updates. Once all tasks are complete, update the checklist to show all tasks are 'completed', and then present your final summary.
11. RESPONSE FORMAT: Use clean GitHub-flavored Markdown. Prefer short sections with level-2 headings like "Summary", "Findings", "Plan", "Changes", "Tests", and "Next Steps". Use bullets for scan-friendly details, numbered lists only for ordered steps, and fenced code blocks for code. Do not write giant unbroken paragraphs. For code reviews or "look through the code" requests, lead with a brief summary, then specific findings with file/function references, then prioritized recommendations. When creating an implementation plan, put the detailed plan in implementation_plan.md and also show a readable approval summary in chat. At the end of any task that used tools, include a "Work Walkthrough" explaining what you actually did: files touched, commands/tests run, results, and remaining follow-up. NEVER write the same information twice in one response — do not write a narrative paragraph summary and then a bullet-point summary of the same content. Pick one format and write it once.
12. SECRETS AND ENVIRONMENT: When a project needs the user's Gemini API key, Google API key, or Google Search Engine ID, use "sync_workspace_env" to create or update workspace environment files. Do not hardcode secrets into source files, do not print secret values, and do not ask the user to paste keys you can sync from settings. Make code read secrets from environment variables such as GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID, and GOOGLE_CSE_ID. For browser-only/static apps, do not expose private API keys in client-side code; add a small local/server API layer instead.
13. GEMINI APP DEFAULTS: For new Gemini Python projects, prefer the current "google-genai" package and "from google import genai" unless local files already use a different SDK. The model "gemini-2.5-flash-lite" is valid; do not downgrade it to older model names unless official docs or an API error proves it is unavailable.
13A. PYTHON PACKAGE VERSIONS: Before pinning a specific package version in requirements.txt, check the active Python version with "python --version". Avoid pinning old versions (e.g., pygame==2.5.2, tensorflow==2.x) that require building from source and may lack pre-built wheels for the installed Python version. When in doubt, specify only a minimum version (e.g., pygame>=2.6.0) or no version at all. Always try "pip install <package>" (no version) first; only add a version constraint if the project explicitly requires one.
14. USER-REQUESTED LOCAL/GIT OPERATIONS: When the user asks for the active directory, to open the folder, to launch/run the program, or to push to GitHub/Git, use the dedicated tools for those actions. Do not push to Git or launch apps unless the user asked for it. If the user explicitly asks you to run a command, run it directly unless it matches Orion's hard destructive block list; do not interrupt with extra approval prompts for ordinary user-requested commands. If the user asks to push without specifying a branch, push the current branch to the default remote.
15. WORKSPACE AND SYSTEM-WIDE QUERIES: Prefer and prioritize files/code within the active workspace. If the user mentions a specific local folder, program, or path outside the workspace (like "on my desktop" or "in my projects folder"), ALWAYS investigate the local filesystem using your local tools (e.g., run_command, list_files, grep_search) BEFORE attempting a web search. You are fully authorized to run system commands using "run_command" to query, search, and identify paths outside the workspace folder in order to answer their questions. When the user names a specific program or project (e.g., "a program called X" or "my project named Y"), immediately use "change_workspace" directly to that project's path (e.g., C:\\Users\\Owner\\Desktop\\Projects\\X) and then read its key files — do NOT call "list_files" on the parent folder first, as parent folders may have hundreds of entries and the target may be truncated. If the path does not exist, try common spelling/casing variants, then use "run_command" with Get-ChildItem filtered by name.
17. SIMPLE READ-ONLY QUESTIONS: For questions like "what is this program about", "tell me what X does", "describe this project" — do NOT call "update_mission_context", "start_subplan", or "evaluate_win_conditions". These operational planning tools are for long-running multi-step tasks only. For read-only questions: navigate to the project, read the key files (README, main entry, package.json / requirements.txt), and answer directly. Never set win conditions for a question that just needs file reading.
18. FIND VS FIX: When the user asks you to "find", "look for", "check for", "review", "audit", or "identify" bugs/typos/issues/faults — your job is ONLY to read files and report what you found. Do NOT modify files, do NOT propose a fix implementation plan, and do NOT start fixing things. Present your findings clearly and ask the user which issues they want you to address. Only make changes when the user explicitly asks you to fix, patch, implement, or update something.
16. OPERATING SYSTEM AWARENESS: You are currently running on a Windows system. When guessing or constructing file paths outside the current workspace, ALWAYS use Windows path conventions (e.g., C:\\Users\\owner\\Desktop) with the literal resolved path — do NOT pass unexpanded PowerShell variables like $env:USERPROFILE as a path argument to any tool; resolve the path to a literal string first (e.g., C:\\Users\\owner). If you are unsure of the username, run 'echo $env:USERPROFILE' first. When searching for files on the Desktop or broad directories, ALWAYS limit recursive searches with '-Depth 2' or '-Depth 3' and add '-ErrorAction SilentlyContinue' to avoid timeouts from permission-denied folders. Never run an unbounded 'Get-ChildItem -Recurse' on C:\\ or the Desktop without a depth limit.

Tools available:
- list_files: List all files in the workspace (excluding node_modules).
- get_workspace_info: Return the active workspace directory and conversation scope.
- change_workspace: Changes the active workspace directory of this conversation to a new absolute directory path on your computer. Use this when the user asks you to inspect or work on a project located outside the active standalone workspace folder.
- open_workspace_folder: Open the active workspace folder in the OS file explorer.
- launch_workspace_app: Launch the active workspace app using Orion's app detection.
- set_workspace_entrypoint: Set or clear the launch entry point command for this workspace.
- git_push: Push the current Git branch, or the current branch to a requested remote branch, when the user asks.
- read_file: Read a file's content. Use startLine/endLine or maxChars for large files.
- write_file: Write a new file. Existing non-governance files require allowOverwrite=true and overwriteReason; prefer patch_file for source edits. STRATEGY.md and implementation_plan.md are governance files.
- modify_file: Edit a specific section of a file (search and replace).
- patch_file: Targeted file update using line ranges, anchors, exact replacement, or regex. Prefer this over rewriting large files.
- run_command: Run a command line in Powershell.
- run_tests: Execute the workspace regression tests.
- start_command: Start a shell command asynchronously with a timeout and return immediately.
- get_command_status: Check whether a started command is running, completed, failed, timed out, or was killed.
- read_command_output: Read accumulated stdout/stderr from a started command.
- kill_command: Stop a running command session.
- schedule_followup: Schedule Orion to continue this conversation after a delay.
- read_notes: Read durable project or standalone notes for this conversation scope.
- update_notes: Replace or append durable project/standalone notes for this conversation scope.
- read_operational_context: Read the canonical mission-level working state.
- update_mission_context, start_subplan, update_subplan_context, complete_subplan: Manage the mission route and current work segment.
- record_blocker, resolve_blocker, promote_discovery, discard_noise, evaluate_win_conditions: Distill useful state and remove operational clutter.
- google_search: Search Google for current docs, API references, examples, and troubleshooting.
- fetch_web_page: Fetch the text content of a specific web page found via search.
- download_file, inspect_archive, extract_archive, inspect_binary_asset, list_asset_metadata: General asset acquisition/inspection hands. Use when useful; do not follow a hardcoded asset pipeline.
- open_url, search_web, click_element, fill_input, navigate_back, download_from_page, wait_for_page: Browser worker hands for autonomous web navigation and acquisition when the mission calls for it.
- take_screenshot, inspect_screenshot, compare_screenshot_to_goal: Visual verification eyes for previews and UI/game scenes. Use evidence honestly; do not claim visual success without screenshot evidence or observations.
- inspect_screenshot_with_model: Sends a workspace screenshot to Gemini multimodal vision for semantic visual inspection against a goal.
- sync_workspace_env: Safely write configured API keys/search IDs into .env-style files without exposing the secret values in chat or tool output.
- set_task_checklist: Set the UI checklist of tasks (array of {title, status}). Status can be 'pending', 'in-progress', 'completed'. Use only for milestone changes, not routine progress churn.`;

// Keep track of active agent running state
let isAgentRunning = false;
let runningConversationId = null;
let agentSubStatus = '';
let agentExecutionMode = 'idle';
let resolvedHomeDir = 'C:\\Users\\Owner';
let currentAgentLogs = [];
let isStopRequested = false;
const GEMINI_THINKING_BUDGET = 24576;
const MODEL_API_REQUEST_TIMEOUT_MS = 600000;
const MODEL_API_MAX_RETRY_WAIT_MS = 45000;
const MODEL_API_MAX_ATTEMPTS = 15;
const OperationalContext = window.OrionOperationalContext || (typeof require === 'function' ? require('./operational-context') : null);

const OPERATIONAL_CONTEXT_TOOL_DECLARATIONS = [
  {
    name: 'read_operational_context',
    description: 'Reads Orion mission, win conditions, active objective/subplan, blockers, discoveries, discarded noise, and latest checkpoint.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'update_mission_context',
    description: 'Creates or updates the durable mission and measurable win conditions. Use for long-running goals, not ordinary one-step requests.',
    parameters: { type: 'OBJECT', properties: {
      mission: { type: 'STRING' }, activeObjective: { type: 'STRING' }, rationale: { type: 'STRING' },
      winConditions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, title: { type: 'STRING' }, status: { type: 'STRING' }, evidence: { type: 'ARRAY', items: { type: 'STRING' } }, notes: { type: 'STRING' } }, required: ['title'] } }
    }, required: ['mission'] }
  },
  {
    name: 'start_subplan',
    description: 'Starts the next bounded route segment under the current mission.',
    parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, objective: { type: 'STRING' }, rationale: { type: 'STRING' }, steps: { type: 'ARRAY', items: { type: 'STRING' } }, summary: { type: 'STRING' }, nextAction: { type: 'STRING' } }, required: ['title'] }
  },
  {
    name: 'update_subplan_context',
    description: 'Updates meaningful active-subplan state. Do not call for routine narration or raw tool output.',
    parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, status: { type: 'STRING' }, steps: { type: 'ARRAY', items: { type: 'STRING' } }, summary: { type: 'STRING' }, nextAction: { type: 'STRING' } } }
  },
  {
    name: 'complete_subplan',
    description: 'Completes and automatically distills the current subplan. Requires concrete evidence; keep durable lessons and summarize temporary context to discard.',
    parameters: { type: 'OBJECT', properties: {
      summary: { type: 'STRING' }, evidence: { type: 'ARRAY', items: { type: 'STRING' } }, nextAction: { type: 'STRING' },
      keep: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, category: { type: 'STRING' }, evidence: { type: 'STRING' } }, required: ['text'] } },
      discard: { type: 'ARRAY', items: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['summary'] } }
    }, required: ['evidence'] }
  },
  {
    name: 'record_blocker',
    description: 'Records a current mission blocker with triage labels. Prefer this after a repeated or genuinely blocking failure, not every transient error. Severity defaults to major; nature defaults to fixable.',
    parameters: { type: 'OBJECT', properties: {
      id: { type: 'STRING' },
      title: { type: 'STRING' },
      details: { type: 'STRING' },
      source: { type: 'STRING' },
      severity: { type: 'STRING', description: 'critical, major, or minor. critical blocks app launch/tests/core execution/primary mission loop/all progress; major blocks a feature/subplan/win condition; minor is polish/cleanup/technical debt/nice-to-have.' },
      nature: { type: 'STRING', description: 'transient, fixable, or terminal. transient is temporary external/runtime; fixable is implementation/environment repair; terminal means current approach violates hard constraints.' }
    }, required: ['title'] }
  },
  {
    name: 'resolve_blocker',
    description: 'Moves an active blocker to resolved and retains its useful lesson.',
    parameters: { type: 'OBJECT', properties: { id: { type: 'STRING', description: 'Blocker id or exact title.' }, resolution: { type: 'STRING' }, lesson: { type: 'STRING' } }, required: ['id', 'resolution'] }
  },
  {
    name: 'convert_blocker_to_backlog',
    description: 'Converts an active minor blocker into backlog/technical debt so it no longer blocks completion. Retains the lesson as a discovery candidate. Only valid for minor blockers.',
    parameters: { type: 'OBJECT', properties: { id: { type: 'STRING', description: 'Blocker id or exact title.' }, resolution: { type: 'STRING' }, lesson: { type: 'STRING' }, discovery: { type: 'STRING' } }, required: ['id'] }
  },
  {
    name: 'promote_discovery',
    description: 'Retains a durable architecture fact, command, constraint, API, preference, or lesson that will matter later.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' }, category: { type: 'STRING' }, evidence: { type: 'STRING' } }, required: ['text'] }
  },
  {
    name: 'discard_noise',
    description: 'Records that temporary output, a failed guess, dead-end plan, or fixed error should not influence future work. Store only a short summary, never raw noise.',
    parameters: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['summary'] }
  },
  {
    name: 'evaluate_win_conditions',
    description: 'Updates win-condition progress. A condition cannot be satisfied without concrete evidence.',
    parameters: { type: 'OBJECT', properties: { evaluations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, title: { type: 'STRING' }, status: { type: 'STRING' }, evidence: { type: 'ARRAY', items: { type: 'STRING' } }, notes: { type: 'STRING' } } } } }, required: ['evaluations'] }
  }
];

const OPERATIONAL_CONTEXT_ACTIONS = new Set(OPERATIONAL_CONTEXT_TOOL_DECLARATIONS
  .map(tool => tool.name)
  .filter(name => name !== 'read_operational_context'));

const ASSET_BROWSER_VISUAL_TOOL_DECLARATIONS = [
  {
    name: 'download_file',
    description: 'Downloads an http(s) file into the workspace. General-purpose asset/research capability; the ReAct loop decides when to use it.',
    parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' }, destination: { type: 'STRING', description: 'Optional workspace-relative path. Defaults under assets/downloads/.' } }, required: ['url'] }
  },
  {
    name: 'inspect_archive',
    description: 'Inspects an archive such as zip/tar without extracting it and returns visible entries.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'Workspace-relative archive path.' } }, required: ['path'] }
  },
  {
    name: 'extract_archive',
    description: 'Extracts an archive into the workspace. Use after inspection when the archive contents are relevant.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, destination: { type: 'STRING', description: 'Optional workspace-relative extraction folder. Defaults under assets/extracted/.' } }, required: ['path'] }
  },
  {
    name: 'inspect_binary_asset',
    description: 'Inspects a binary/3D/media asset such as glb, gltf, image, obj, fbx, or zip and returns safe metadata.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'Workspace-relative asset path.' } }, required: ['path'] }
  },
  {
    name: 'list_asset_metadata',
    description: 'Lists asset-like files and metadata under a workspace folder. Defaults to assets/.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'Optional workspace-relative folder.' } } }
  },
  {
    name: 'open_url',
    description: 'Opens a URL in Orion’s hidden browser worker and returns page title, text snippet, and links.',
    parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] }
  },
  {
    name: 'search_web',
    description: 'Searches the web in Orion’s browser worker and returns page text/links. Use as a general browsing hand, not a fixed workflow.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] }
  },
  {
    name: 'click_element',
    description: 'Clicks an element in the current browser page by CSS selector or visible text.',
    parameters: { type: 'OBJECT', properties: { selector: { type: 'STRING' }, text: { type: 'STRING' } } }
  },
  {
    name: 'fill_input',
    description: 'Fills an input in the current browser page by CSS selector.',
    parameters: { type: 'OBJECT', properties: { selector: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['selector'] }
  },
  {
    name: 'navigate_back',
    description: 'Navigates the browser worker back one page.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'download_from_page',
    description: 'Downloads a URL from the current browser page, either by selector or explicit URL, into the workspace.',
    parameters: { type: 'OBJECT', properties: { selector: { type: 'STRING' }, url: { type: 'STRING' }, destination: { type: 'STRING' } } }
  },
  {
    name: 'wait_for_page',
    description: 'Waits briefly for the current browser page to settle and returns an updated page snapshot.',
    parameters: { type: 'OBJECT', properties: { timeoutMs: { type: 'NUMBER' } } }
  },
  {
    name: 'take_screenshot',
    description: 'Captures the current browser worker view as a screenshot in the workspace for visual verification.',
    parameters: { type: 'OBJECT', properties: { destination: { type: 'STRING', description: 'Optional workspace-relative PNG path.' } } }
  },
  {
    name: 'inspect_screenshot',
    description: 'Inspects screenshot file metadata. Does not invent semantic visual conclusions.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] }
  },
  {
    name: 'compare_screenshot_to_goal',
    description: 'Records a structured screenshot-vs-goal judgment using screenshot metadata and supplied observations. If observations are missing, returns needs_more_visual_evidence.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, goal: { type: 'STRING' }, observations: { type: 'STRING', description: 'Optional visual observations from model/user/inspection.' } }, required: ['path', 'goal'] }
  },
  {
    name: 'inspect_screenshot_with_model',
    description: 'Uses Gemini multimodal vision to inspect a workspace screenshot against a goal and returns structured visual evidence. Prefer this when Gemini is available before judging visual win conditions.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, goal: { type: 'STRING' } }, required: ['path', 'goal'] }
  }
];

window.steeringQueue = [];
window.promptQueue = [];
window.followupTimers = window.followupTimers || {};
window.followupTimerMeta = window.followupTimerMeta || {};
window.isAgentRunning = () => isAgentRunning;
window.getRunningConversationId = () => runningConversationId;
window.getAgentSubStatus = () => agentSubStatus;
window.getAgentExecutionMode = () => agentExecutionMode;
window.stopAgentExecution = () => {
  isStopRequested = true;
  const targetConversationId = runningConversationId;
  if (targetConversationId) {
    if (window.api.killCommandsForConversation) {
      window.api.killCommandsForConversation(targetConversationId).then((result) => {
        if (result && result.killed) {
          window.appendSystemMessage(`Stop requested. Killed ${result.killed} running command(s) for this conversation.`);
        }
      }).catch(() => {});
    }
    cancelFollowupsForConversation(targetConversationId);
    if (window.promptQueue) {
      window.promptQueue = window.promptQueue.filter(item => item.conversationId !== targetConversationId);
    }
  }
  window.appendSystemMessage("Stop requested... task will abort on next turn.", {
    dedupeKey: `stop-requested-${targetConversationId || 'global'}`,
    windowMs: 3000
  });
};

// EXPOSE AGENT LOOP TO RENDERER
window.runAgentLoop = async function(userPrompt, modelName, conversation, options = {}) {
  if (isAgentRunning) {
    window.appendSystemMessage("An agent task is already running.");
    return;
  }
  
  isAgentRunning = true;
  runningConversationId = conversation.id;
  agentExecutionMode = 'planning';
  isStopRequested = false;
  window.currentLoopCount = 0;
  currentAgentLogs = [];
  if (window.onAgentStatusChange) window.onAgentStatusChange(true);
  
  const config = window.getAppConfig();
  let workspacePath = conversation.workspace || window.getCurrentWorkspace();
  const promptSource = options.source || 'user';
  const isInternalPrompt = !!options.internalPrompt || promptSource === 'followup' || promptSource === 'system' || promptSource === 'plan-approval';

  let simpleRoute = null;
  if (!isInternalPrompt && !conversation.awaitingPlanApproval && config.planningMode !== false) {
    simpleRoute = classifySimpleTask(userPrompt);
    if (simpleRoute && simpleRoute.route === 'local_memory') {
      await answerLocalMemoryQuestionFastPath({ userPrompt, workspacePath, conversation, config, route: simpleRoute });
      return;
    }
    if (simpleRoute && simpleRoute.route === 'local_project_summary') {
      await answerLocalProjectSummaryFastPath({ userPrompt, workspacePath, conversation, config, route: simpleRoute });
      return;
    }
  }

  const promptForModel = isInternalPrompt
    ? `[ORION INTERNAL FOLLOW-UP - not a user message]\n${userPrompt}\n\nContinue from the saved conversation/task state. Do not quote this as something the user said.`
    : userPrompt;
  
  // Resolve the user's home directory once so the model never needs to discover it
  resolvedHomeDir = 'C:\\Users\\Owner';
  try {
    if (window.api && window.api.getHomeDir) resolvedHomeDir = await window.api.getHomeDir();
  } catch (_) {}

  const scopedNotes = await readScopedNotes(workspacePath, conversation);
  const operationalContext = await readOperationalContext(workspacePath);
  let workingState = operationalContext.state;
  const isContinuationRequest = isTaskContinuationPrompt(userPrompt) && hasOperationalMissionState(workingState);

  if (!isInternalPrompt && !conversation.awaitingPlanApproval && !isContinuationRequest) {
    conversation.planApproved = false;
    // Clear stale operational context (blockers, win conditions, mission) from previous runs
    if (workspacePath && hasOperationalMissionState(workingState)) {
      try {
        const emptyState = OperationalContext.createEmptyContext();
        await window.api.writeFile(workspacePath, OPERATIONAL_CONTEXT_PATH, `${JSON.stringify(emptyState, null, 2)}\n`);
        workingState = emptyState;
      } catch (_) {}
    }
  }
  // Canonical operational state seeds reasoning. Conversation remains a bounded UI/input view;
  // old model and tool turns are deliberately not replayed as task truth.
  let messages = OperationalContext.buildReasoningMessages(workingState, conversation.messages, promptForModel);
  const refreshWorkingStateMessage = () => {
    if (messages[0] && messages[0].parts && messages[0].parts[0]) {
      messages[0].parts[0].text = OperationalContext.formatForPrompt(workingState) || messages[0].parts[0].text;
    }
  };
  if (scopedNotes.content && scopedNotes.content.trim()) {
    messages.splice(2, 0,
      {
        role: 'user',
        parts: [{
          text: `[ORION DURABLE NOTES - ${scopedNotes.scopeLabel}]\nThese are persistent notes for this scope. Use them as working memory, but verify against files when needed.\n\n${scopedNotes.content}`
        }]
      },
      {
        role: 'model',
        parts: [{ text: 'Understood. I will use these durable notes as context for this task.' }]
      }
    );
  }

  // Inject resolved system facts so the model never needs to probe for the home directory
  messages.splice(2, 0,
    {
      role: 'user',
      parts: [{ text: `[ORION SYSTEM FACTS]\nUser home directory (resolved): ${resolvedHomeDir}\nDesktop projects folder: ${resolvedHomeDir}\\Desktop\\projects\nDo NOT run echo or whoami to discover these paths — use the values above directly.` }]
    },
    {
      role: 'model',
      parts: [{ text: `Understood. Home directory is ${resolvedHomeDir}. I will use this directly without probing.` }]
    }
  );

  let approvalIntent = null;
  if (!isInternalPrompt && conversation.awaitingPlanApproval && !conversation.planApproved) {
    approvalIntent = await classifyPlanApprovalIntent(userPrompt, modelName, config.geminiApiKey);
    if (approvalIntent.intent === 'approve') {
      let planIsValid = false;
      try {
        const planContent = await window.api.readFile(workspacePath, 'implementation_plan.md', { maxChars: 100000 });
        const planText = typeof planContent === 'string'
          ? planContent
          : (planContent && !planContent.error && typeof planContent.content === 'string' ? planContent.content : '');
        planIsValid = hasRequiredTestingPlanSection(planText);
      } catch (err) {
        console.error('Error validating implementation_plan.md during chat approval:', err);
      }

      if (!planIsValid) {
        if (window.appendSystemMessage) {
          window.appendSystemMessage("Approval rejected: The implementation plan is missing a valid '## Testing Plan' section. Please revise the plan first.", { conversationId: conversation.id });
        }
        conversation.awaitingPlanApproval = true;
        conversation.planApproved = false;
        if (window.saveConversationsToStorage) {
          window.saveConversationsToStorage();
        }
        messages.push({
          role: 'user',
          parts: [{
            text: `[SYSTEM: The user attempted to approve the plan, but it is structurally invalid or missing. It must have a '## Testing Plan' section. Please update implementation_plan.md with this section now.]`
          }]
        });
      } else {
        conversation.planApproved = true;
        conversation.awaitingPlanApproval = false;
        if (window.appendSystemMessage) {
          window.appendSystemMessage("Plan approved. Continuing implementation.", { conversationId: conversation.id });
        }
        if (window.saveConversationsToStorage) {
          window.saveConversationsToStorage();
        }
      }
    }

    if (approvalIntent.intent === 'deny') {
      conversation.awaitingPlanApproval = false;
      window.saveConversationsToStorage();
    }
  }

  let planningDecision = { mode: 'plan', reason: 'Planning mode is active.' };
  let planningBypassedForTask = false;
  let strategyStatus = { exists: false, valid: false, missingSections: STRATEGY_REQUIRED_SECTIONS, needsClarification: false };
  if (isContinuationRequest && !conversation.awaitingPlanApproval) {
    planningDecision = {
      mode: 'direct',
      reason: 'Continuing or fixing an existing in-progress approved task.'
    };
    planningBypassedForTask = true;
    agentExecutionMode = 'executing';
    if (window.appendSystemMessage) {
      window.appendSystemMessage('Planning mode: direct task, no implementation plan required. Continuing or fixing the current in-progress task.');
    }
  } else if (!isInternalPrompt && config.planningMode !== false && !conversation.planApproved && !conversation.awaitingPlanApproval && !(approvalIntent && approvalIntent.intent === 'approve')) {
    // Fast-path routes (local_project_describe, local_project_review, etc.) bypass the Gemini classifier
    if (simpleRoute && (simpleRoute.mode === 'direct' || simpleRoute.mode === 'answer')) {
      planningDecision = { mode: simpleRoute.mode, reason: simpleRoute.reason };
    } else {
      planningDecision = await classifyPlanningNeed(userPrompt, modelName, config.geminiApiKey);
    }
    if (planningDecision.mode === 'direct') {
      planningBypassedForTask = true;
      agentExecutionMode = 'direct';
      window.appendSystemMessage(`Planning mode: direct task, no implementation plan required. ${planningDecision.reason || ''}`.trim());
    } else if (planningDecision.mode === 'answer') {
      agentExecutionMode = 'answer';
    }
  } else if (conversation.planApproved || isInternalPrompt) {
    planningDecision = {
      mode: 'direct',
      reason: isInternalPrompt
        ? 'This is an internal follow-up to continue existing work, not a new user request.'
        : 'An implementation plan has already been approved.'
    };
    agentExecutionMode = 'executing';
  }
  if (!planningBypassedForTask && planningDecision.mode === 'plan' && config.planningMode !== false && !conversation.planApproved && !isInternalPrompt) {
    strategyStatus = await readStrategyStatus(workspacePath);
  }

  messages.push({
    role: 'user',
    parts: [{
      text: buildToolUseContractPrompt()
    }]
  });

  const reviewOnlyMode = simpleRoute && simpleRoute.route === 'local_project_review';
  if (config.planningMode !== false) {
    const reviewOnlyConstraint = reviewOnlyMode
      ? ' CRITICAL: The user asked you to FIND issues, not fix them. Read files, identify bugs/typos/structural faults, and present your findings as a clear report. Do NOT modify any files, do NOT propose implementation steps, and do NOT ask to approve a fix plan. End by summarizing what you found and asking the user which issues they want you to address.'
      : '';
    messages.push({
      role: 'user',
      parts: [{
        text: `[SYSTEM: Planning decision for this user request: ${planningDecision.mode}. Reason: ${planningDecision.reason || 'No reason provided.'} ${planningBypassedForTask ? 'This is a direct task, so do not create STRATEGY.md or implementation_plan.md unless new complexity appears during inspection.' : 'If this requires workspace changes and no plan is approved, complete Mission Refinement first, create a valid STRATEGY.md, then create a real implementation plan and pause.'}${reviewOnlyConstraint}]`
      }]
    });
    if (!planningBypassedForTask && planningDecision.mode === 'plan' && !conversation.planApproved && !isInternalPrompt) {
      messages.push({
        role: 'user',
        parts: [{ text: buildRefinementPrompt(strategyStatus) }]
      });
    }
  }

  if (conversation.awaitingPlanApproval && !conversation.planApproved && approvalIntent && approvalIntent.intent === 'revise') {
    messages.push({
      role: 'user',
      parts: [{
        text: '[SYSTEM: An implementation plan is awaiting approval. The user provided feedback or asked a question. Do not execute destructive tools. Address the user\'s message. ONLY update the implementation_plan.md if the user requested changes to the plan. If you update the plan, pause for approval. If you just answer a question, do not write the plan again.]'
      }]
    });
  }

  let lastTextResponse = "Thinking...";
  let aiMessageIndex = conversation.messages.length;
  let workWalkthrough = [];
  let forceYield = false;
  let finalAnswerQualityPrompts = 0;
  let finalAnswerQualityLoopExtensions = 0;
  // Initialize AI message state in conversation list
  conversation.messages.push({ role: 'assistant', text: 'Thinking...', logs: [], turns: [] });
  
  try {
    if (approvalIntent && approvalIntent.intent === 'deny') {
      lastTextResponse = `Understood. I will not proceed with that implementation plan.\n\nReason interpreted: ${approvalIntent.reason || 'The message was a denial or rejection of the plan.'}`;
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      return;
    }
    if (approvalIntent && approvalIntent.intent === 'unclear') {
      lastTextResponse = `I’m not sure whether you want me to approve and execute the current plan, revise it, or cancel it. Please clarify what you want changed or whether I should proceed.`;
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      return;
    }

    // Check if we need to compact context
    try {
      const tokenCount = await countTokens(messages, modelName, config.geminiApiKey);
      console.log("Current conversation tokens:", tokenCount);
      const compactThreshold = getCompactionThreshold(modelName, config);
      if (config.autoCompact !== false && tokenCount > compactThreshold) {
        window.appendSystemMessage(`Context reached ${tokenCount} tokens; compacting for ${modelName} at threshold ${compactThreshold}.`);
        const compactResult = await compactHistory(messages, modelName, config.geminiApiKey);
        persistCompactedConversation(conversation, compactResult.summary);
        await appendScopedNotes(workspacePath, conversation, `\n\n## Context Compaction ${new Date().toISOString()}\n${compactResult.summary}\n`);
        const checkpoint = await checkpointOperationalContext(workspacePath, 'context_compaction', 'Conversation context was compacted; canonical mission state was preserved.', 'Continue the active subplan from operational context.');
        if (checkpoint && checkpoint.state) workingState = checkpoint.state;
        messages = OperationalContext.buildReasoningMessages(workingState, conversation.messages, promptForModel);
        if (scopedNotes.content && scopedNotes.content.trim()) {
          messages.splice(2, 0,
            {
              role: 'user',
              parts: [{ text: `[ORION DURABLE NOTES - ${scopedNotes.scopeLabel}]\nThese are persistent notes for this scope. Use them as working memory, but verify against files when needed.\n\n${scopedNotes.content}` }]
            },
            {
              role: 'model',
              parts: [{ text: 'Understood. I will use these durable notes as context for this task.' }]
            }
          );
        }
        aiMessageIndex = conversation.messages.length;
        conversation.messages.push({ role: 'assistant', text: 'Thinking...', logs: [], turns: [] });
        window.saveConversationsToStorage();
      }
    } catch (e) {
      console.error("Token count/compacting error:", e);
    }
    
    // Run the agent execution loop
    let loopCount = 0;
    let maxLoops = reviewOnlyMode ? 40 : 20;
    let planValidationRetries = 0;
    let consecutiveNoToolCalls = 0;
    let malformedCallsCount = 0;
    let maxTokensContinuations = 0;
    let postEditEvidencePrompts = 0;
    let postEditEvidenceLoopExtensions = 0;
    let completionGatePrompts = 0;
    let completionGateLoopExtensions = 0;
    const repeatedToolFailures = new Map();
    const toolEvidenceLedger = [];
    const maxMalformedToolRetries = 5;
    const canExecuteThisTask = () => !config.planningMode || conversation.planApproved || planningBypassedForTask;
    
    // Clear active bubble tracking so we start a new one
    window.clearActiveAiBubble();
    
    while (loopCount < maxLoops) {
      loopCount++;
      window.currentLoopCount = loopCount;
      console.log(`Agent Loop Turn ${loopCount}`);
      
      // Check if Stop was requested
      if (isStopRequested) {
        isStopRequested = false;
        lastTextResponse = "Task aborted by user.";
        currentAgentLogs.push({ type: 'thought', content: "🛑 Task execution stopped by user." });
        break;
      }
      
      // Check if user steer input is available for this conversation
      window.steeringQueue = window.steeringQueue || {};
      const convSteerQueue = window.steeringQueue[conversation.id] || [];
      if (convSteerQueue.length > 0) {
        const steerText = convSteerQueue.shift();
        currentAgentLogs.push({ type: 'thought', content: `🎯 Steered: "${steerText}"` });
        messages.push({ role: 'user', parts: [{ text: `[USER STEERING FEEDBACK: ${steerText}]` }] });
      }
      
      // Call API (Gemini or Ollama) with automatic transient error retry and warnings
      let response;
      try {
        agentSubStatus = `Calling ${modelName.startsWith('gemini-') ? 'Gemini' : 'Ollama (' + modelName + ')'} API...`;
        window.renderAiMessage(lastTextResponse, currentAgentLogs);
        const modelCallDelayMs = Math.min(Math.max(parseInt(config.modelCallDelayMs, 10) || 0, 0), 60000);
        if (modelCallDelayMs > 0) {
          agentSubStatus = `Waiting ${modelCallDelayMs}ms before the next model call...`;
          window.renderAiMessage(lastTextResponse, currentAgentLogs);
          await sleep(modelCallDelayMs);
        }
        
        const isProMode = typeof window.isProModeActive === 'function' && window.isProModeActive();
        if (isProMode) {
          messages.push({
            role: 'user',
            parts: [{ text: '[PRO MODE: Use extra care on architecture, edge cases, tests, and failure recovery inside the same state-driven reasoning loop. Do not create another role; the operational completion gate is the completion authority.]' }]
          });
          window.renderAiMessage(lastTextResponse, currentAgentLogs);
        }

        if (modelName.startsWith('gemini-')) {
          response = await callGeminiAPI(messages, modelName, config.geminiApiKey, (warningMsg) => {
            agentSubStatus = warningMsg;
            conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
            window.renderAiMessage(lastTextResponse, currentAgentLogs);
          });
        } else {
          response = await callOllamaAPI(messages, modelName, (warningMsg) => {
            agentSubStatus = warningMsg;
            conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
            window.renderAiMessage(lastTextResponse, currentAgentLogs);
          });
        }
        agentSubStatus = 'Processing model response...';
      } catch (e) {
        console.error(e);
        lastTextResponse = `Error contacting Model API: ${e.message}`;
        const retryDelayMs = parseRetryDelayMs(e.message);
        if (retryDelayMs) {
          lastTextResponse += `\n\nThis is a temporary quota/rate-limit window. It should reset after about ${Math.ceil(retryDelayMs / 1000)} seconds.`;
          const retrySeconds = Math.min(Math.max(Math.ceil(retryDelayMs / 1000), 10), 3600);
          scheduleAgentFollowup({
            delaySeconds: retrySeconds,
            purpose: 'model-api-retry',
            prompt: 'Retry the previous task after the model/API cooldown. First inspect the latest state and avoid repeating any failed action blindly.'
          });
          lastTextResponse += `\n\nI scheduled a follow-up retry in about ${retrySeconds} seconds instead of hammering the API.`;
        }
        const advice = diagnoseModelApiFailure(e.message);
        if (advice) {
          lastTextResponse += `\n\n${advice}`;
        }
        currentAgentLogs.push({ type: 'thought', content: `API Error: ${e.message}` });
        conversation.messages[aiMessageIndex].text = lastTextResponse;
        break;
      }
      
      const candidate = response.candidates && response.candidates[0];
      if (!candidate) {
        lastTextResponse = "Error: Received empty response from Gemini.";
        conversation.messages[aiMessageIndex].text = lastTextResponse;
        break;
      }
      
      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        if (candidate.finishReason === "MAX_TOKENS" && maxTokensContinuations < 3 && loopCount < maxLoops) {
          maxTokensContinuations++;
          const modelParts = (candidate.content && candidate.content.parts) || [];
          const partialText = modelParts.map(part => part.text || '').join('').trim();
          if (partialText) {
            lastTextResponse = partialText;
            conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
            window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
          }
          messages.push({
            role: 'model',
            parts: modelParts.length ? modelParts : [{ text: '[Model response stopped because it reached the token limit before finishing.]' }]
          });
          conversation.messages[aiMessageIndex].turns.push({ modelParts, toolResponseParts: null });
          currentAgentLogs.push({ type: 'thought', content: `Model hit MAX_TOKENS. Continuing from partial response (Attempt ${maxTokensContinuations}/3).` });
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: Your previous response hit MAX_TOKENS before the task was complete. Continue from the exact current state. Do not restart, do not repeat completed work, and use tools if needed to finish the active investigation. If you were about to summarize findings, continue the findings concisely.]'
            }]
          });
          continue;
        }
        if (candidate.finishReason === "MALFORMED_FUNCTION_CALL" && malformedCallsCount < maxMalformedToolRetries) {
          malformedCallsCount++;
          const errorMsg = `⚠️ Tool call was malformed (Attempt ${malformedCallsCount}/${maxMalformedToolRetries}). Requesting regeneration...`;
          currentAgentLogs.push({ type: 'thought', content: errorMsg });
          
          const modelParts = (candidate.content && candidate.content.parts) || [];
          if (modelParts.length === 0) {
            modelParts.push({ text: "[Malformed tool call attempted]" });
          }
          messages.push({ role: 'model', parts: modelParts });
          
          let currentTurn = { modelParts: modelParts, toolResponseParts: null };
          conversation.messages[aiMessageIndex].turns.push(currentTurn);
          
          messages.push({
            role: 'user',
            parts: [{
              text: `[SYSTEM: The previous function call was malformed. Please generate a valid JSON function call that adheres strictly to the schema properties and required fields. Avoid adding namespace prefixes (like 'default_api.') or markdown blocks.]`
            }]
          });
          continue;
        }
        
        lastTextResponse = `Generation stopped by API (Reason: ${candidate.finishReason}).`;
        conversation.messages[aiMessageIndex].text = lastTextResponse;
        currentAgentLogs.push({ type: 'thought', content: `⚠️ Model finish reason: ${candidate.finishReason}` });
        break;
      }
      
      const content = candidate.content;
      const parts = (content && content.parts) || [];
      
      // Append model response to messages history
      messages.push({ role: 'model', parts: parts });
      
      // Track turn parts
      let currentTurn = { modelParts: parts, toolResponseParts: null };
      conversation.messages[aiMessageIndex].turns.push(currentTurn);
      
      // Process text and thoughts
      let textVal = '';
      let functionCalls = [];
      
      parts.forEach(part => {
        if (part.text) {
          textVal += part.text;
        }
        if (part.functionCall) {
          functionCalls.push(part.functionCall);
        }
      });
      
      if (textVal) {
        lastTextResponse = textVal;
      }
      
      // Update live chat bubbles — skip render when there are no tool calls so the
      // final answer isn't shown with the "Working..." spinner still attached; the
      // finally block will render once isAgentRunning is already false.
      conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      if (functionCalls.length > 0) {
        window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
      }

      // If no tool calls, the agent is done, unless there are pending tasks in the checklist
      if (functionCalls.length === 0) {
        consecutiveNoToolCalls++;
        const pendingTasks = conversation.tasks ? conversation.tasks.filter(t => t.status !== 'completed' && t.status !== 'x') : [];
        if (config.planningMode && !canExecuteThisTask() && !hasAnyChecklist(conversation) && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: Planning Mode is active and no checklist or implementation plan has been created for this request. Either create the implementation plan and checklist with tools now, or give a complete non-workspace answer that does not promise later action.]'
            }]
          });
          continue;
        }
        if (shouldHaveUsedToolsButDidNot(textVal, workWalkthrough, userPrompt) && consecutiveNoToolCalls < 3 && loopCount < maxLoops) {
          const guidance = buildFailureRecoveryGuidance(classifyAgentFailure({
            category: 'model_no_tool_use',
            errorText: textVal
          }));
          const localInspectionGuidance = requestNeedsLocalInspection(userPrompt)
            ? ' The user asked about this local computer. Call local inspection commands now, such as `systeminfo`, CPU/RAM/disk/process commands, or another available local route. Do not answer with acknowledgement only.'
            : '';
          messages.push({
            role: 'user',
            parts: [{
              text: `[SYSTEM: ${guidance}${localInspectionGuidance}]`
            }]
          });
          continue;
        }
        if (isGenericNonAnswer(textVal) && requestNeedsLocalInspection(userPrompt) && (workWalkthrough || []).length === 0) {
          lastTextResponse = 'I did not produce a real answer. This question needs local system inspection first, so I should run commands to check CPU/RAM/disk or clearly explain why that evidence cannot be gathered.';
          break;
        }
        if (pendingTasks.length > 0 && canExecuteThisTask() && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          console.log(`No tool calls, but there are ${pendingTasks.length} pending tasks. Continuing loop automatically.`);
          
          // Append a system message instructing the model to continue
          const prompt = `[SYSTEM: You returned a response without calling any tools, but there are still pending tasks in the checklist: ${pendingTasks.map(t => `"${t.title}"`).join(', ')}. Continue with the next concrete tool action if one is needed. Do not call set_task_checklist merely to mark in-progress work. If the pending task is already complete, mark it completed; if you are blocked, explain the blocker and the next recovery step. When everything is fully complete and verified, output your final summary.]`;
          
          messages.push({ role: 'user', parts: [{ text: prompt }] });
          continue;
        }
        const evidencePrompt = buildPostEditEvidencePrompt(workWalkthrough, {
          canExecute: canExecuteThisTask(),
          promptCount: postEditEvidencePrompts,
          maxPrompts: 2
        });
        if (evidencePrompt && loopCount >= maxLoops && postEditEvidenceLoopExtensions < 3) {
          postEditEvidenceLoopExtensions++;
          maxLoops++;
        }
        if (evidencePrompt && loopCount < maxLoops) {
          postEditEvidencePrompts++;
          currentAgentLogs.push({ type: 'thought', content: 'Verification guard: code changed, so Orion must inspect the changed files and run or justify a real check before finishing.' });
          messages.push({ role: 'user', parts: [{ text: evidencePrompt }] });
          continue;
        }
        const epistemicCorrection = buildEpistemicCorrectionPrompt({
          userPrompt,
          answerText: textVal,
          toolEvidenceLedger
        });
        if (epistemicCorrection && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          currentAgentLogs.push({ type: 'thought', content: 'Self-correction guard: failed tool attempts do not prove the requested fact is unknowable or blocked.' });
          messages.push({ role: 'user', parts: [{ text: epistemicCorrection }] });
          continue;
        }
        // In review-only mode, always nudge the model to keep reading files until it explicitly signals completion
        if (reviewOnlyMode && consecutiveNoToolCalls === 1 && workWalkthrough.length > 0 && loopCount < maxLoops) {
          const signalsDone = /\b(that'?s all|in conclusion|to summarize|summary of findings|final(?:ly)?|this concludes|completed (?:my )?(?:review|analysis|scan)|finished reviewing|done reviewing)\b/i.test(String(textVal || ''));
          if (!signalsDone) {
            currentAgentLogs.push({ type: 'thought', content: 'Review mode: model paused mid-review. Nudging to continue reading files.' });
            messages.push({ role: 'user', parts: [{ text: '[SYSTEM: You paused mid-review without finishing. Continue reading the remaining project files. Do not stop until you have covered all major source files, then present your complete findings.]' }] });
            continue;
          }
        }
        // If model described a next action but didn't call the tool, give it one nudge to follow through
        if (consecutiveNoToolCalls === 1 && workWalkthrough.length > 0 && loopCount < maxLoops) {
          const describesThenStops = /\b(let'?s|i'?ll|i will|i'm going to|next i'?ll|now i'?ll|i'll now|let me now)\b.{0,120}(search|read|look|check|list|run|scan|find|navigate|inspect|analyze|review)/i.test(String(textVal || ''));
          if (describesThenStops) {
            currentAgentLogs.push({ type: 'thought', content: 'Model described a next tool action but did not call it. Nudging to execute.' });
            messages.push({ role: 'user', parts: [{ text: '[SYSTEM: You described what you were going to do next but did not call any tool. Execute that action now with the appropriate tool call. Do not describe it again.]' }] });
            continue;
          }
        }
        const finalAnswerQualityPrompt = buildFinalAnswerQualityGatePrompt(userPrompt, textVal, workWalkthrough);
        if (finalAnswerQualityPrompt && loopCount >= maxLoops && finalAnswerQualityLoopExtensions < 2) {
          finalAnswerQualityLoopExtensions++;
          maxLoops++;
        }
        if (finalAnswerQualityPrompt && finalAnswerQualityPrompts < 2 && loopCount < maxLoops) {
          finalAnswerQualityPrompts++;
          currentAgentLogs.push({ type: 'thought', content: 'Final-answer quality gate: the draft inspected context but did not answer with recommendations, a plan, changes, or a next action.' });
          messages.push({ role: 'user', parts: [{ text: finalAnswerQualityPrompt }] });
          continue;
        }
        if (hasOperationalMissionState(workingState) && agentExecutionMode === 'executing') {
          const completionGate = evaluateWorkingStateCompletion(workingState, conversation);
          if (completionGate.status === 'continue_work' && loopCount >= maxLoops && completionGateLoopExtensions < 3) {
            completionGateLoopExtensions++;
            maxLoops++;
          }
          if (completionGate.status === 'continue_work' && completionGatePrompts < 3 && loopCount < maxLoops) {
            completionGatePrompts++;
            const gateMessage = buildCompletionGateMessage(completionGate);
            currentAgentLogs.push({ type: 'thought', content: `Completion gate held final response.\n${gateMessage}` });
            messages.push({
              role: 'user',
              parts: [{
                text: `[SYSTEM: The operational completion gate says this task is not ready for a final summary yet.\n${gateMessage}\nContinue work with the next concrete tool action now: implement missing files, run/record verification, launch or visually inspect the UI, resolve blockers, or satisfy win conditions with evidence. Do not answer with another status-only summary. Do not split this into another role.]`
              }]
            });
            continue;
          }
          if (completionGate.status === 'blocked' || completionGate.status === 'ask_clarification') {
            lastTextResponse = `${completionGate.status === 'blocked' ? 'I cannot honestly mark this complete yet because the operational state is blocked.' : 'I need clarification before I can judge this complete.'}\n\n${buildCompletionGateMessage(completionGate)}`;
            break;
          }
          if (completionGate.status !== 'ready_for_final') {
            lastTextResponse = `I cannot honestly mark this complete yet.\n\n${buildCompletionGateMessage(completionGate)}`;
            break;
          }
        }
        break;
      } else {
        consecutiveNoToolCalls = 0;
      }
      
      // Execute tool calls
      const toolResponseParts = [];
      
      for (const call of functionCalls) {
        const toolName = call.name;
        const args = call.args || {};
        
        agentSubStatus = `Running tool: ${toolName}...`;
        
        const logIndex = currentAgentLogs.length;
        currentAgentLogs.push({
          type: 'tool_call',
          tool: toolName,
          params: args,
          status: 'running'
        });
        const walkthroughItem = summarizeToolStart(toolName, args);
        if (walkthroughItem) {
          workWalkthrough.push(walkthroughItem);
          conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
        }
        window.renderAiMessage(conversation.messages[aiMessageIndex].text || lastTextResponse, currentAgentLogs);
        
        // Safety gate for planning mode
        if (!canExecuteThisTask() && config.planningMode && planningDecision.mode === 'plan' && (
          (toolName === 'write_file' && (isImplementationPlanPath(args.path) || isStrategyPath(args.path))) ||
          toolName === 'modify_file' || toolName === 'patch_file' || toolName === 'run_command' || toolName === 'start_command' || toolName === 'run_tests'
        )) {
          strategyStatus = await readStrategyStatus(workspacePath);
        }
        const planningGate = getPlanningToolGate(config, canExecuteThisTask(), toolName, args, {
          strategyRequired: !planningBypassedForTask && planningDecision.mode === 'plan',
          strategyStatus,
          agentExecutionMode
        });
        if (!planningGate.allowed) {
          const failure = classifyAgentFailure({
            toolName,
            args,
            errorText: planningGate.reason
          });
          const guidance = buildFailureRecoveryGuidance(failure);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = planningGate.reason;
          
          toolResponseParts.push({
            functionResponse: {
              name: toolName,
              response: { error: planningGate.reason, failureCategory: failure.category, recoveryGuidance: guidance }
            }
          });
          const transition = await recordToolOutcomeInWorkingState(workspacePath, toolName, args, { error: planningGate.reason, failureCategory: failure.category });
          if (transition && transition.state) {
            workingState = transition.state;
            refreshWorkingStateMessage();
          }
          updateWalkthroughItem(walkthroughItem, toolName, args, { error: planningGate.reason, failureCategory: failure.category }, new Error(planningGate.reason));
          continue;
        }
        if (planningGate.forceYield) {
          forceYield = true;
        }

        const epistemicToolGate = getEpistemicToolGate(userPrompt, toolEvidenceLedger, toolName, args);
        if (!epistemicToolGate.allowed) {
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = epistemicToolGate.reason;
          const gatedResult = {
            error: epistemicToolGate.reason,
            failureCategory: 'unsupported_inference',
            recoveryGuidance: epistemicToolGate.guidance
          };
          toolEvidenceLedger.push(buildToolEvidenceEntry(toolName, args, gatedResult));
          updateWalkthroughItem(walkthroughItem, toolName, args, gatedResult, new Error(epistemicToolGate.reason));
          toolResponseParts.push({
            functionResponse: {
              name: toolName,
              response: gatedResult
            }
          });
          continue;
        }
        
        // Execute the tool
        let result;
        try {
          result = await executeTool(toolName, args, workspacePath, config, conversation);
          if (toolName === 'change_workspace' && result && result.success) {
            workspacePath = conversation.workspace;
          }
          currentAgentLogs[logIndex].status = isFailedToolResult(result) ? 'error' : 'success';
          currentAgentLogs[logIndex].result = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          updateWalkthroughItem(walkthroughItem, toolName, args, result, null);
        } catch (err) {
          console.error(err);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = err.message;
          result = { error: err.message };
          updateWalkthroughItem(walkthroughItem, toolName, args, result, err);
        }

        const evidenceEntry = buildToolEvidenceEntry(toolName, args, result);
        toolEvidenceLedger.push(evidenceEntry);

        if (toolName === 'write_file' && isStrategyPath(args.path) && !isFailedToolResult(result)) {
          try {
            const strategyTransition = await applyStrategyToOperationalContext(workspacePath, String(args.content || ''));
            result.strategyValidation = strategyTransition.validation;
            if (strategyTransition.transition && strategyTransition.transition.state) {
              workingState = strategyTransition.transition.state;
              refreshWorkingStateMessage();
            }
            if (strategyTransition.validation && strategyTransition.validation.needsClarification) {
              result.requiresClarification = true;
              result.message = `${result.message || 'STRATEGY.md written.'} Mission-critical ambiguity was identified; ask the user before creating implementation_plan.md.`;
            }
          } catch (strategyError) {
            result.strategyContextUpdateError = strategyError.message;
            currentAgentLogs.push({ type: 'thought', content: `Strategy context update warning: ${strategyError.message}` });
          }
        }

        const resultError = getToolFailureSignal(result);
        if (resultError) {
          const baseFailure = classifyAgentFailure({ toolName, args, result, errorText: resultError });
          const failureKey = `${toolName}:${stableStringify(args)}:${String(resultError).slice(0, 240)}`;
          const failureCount = (repeatedToolFailures.get(failureKey) || 0) + 1;
          repeatedToolFailures.set(failureKey, failureCount);
          const failure = classifyAgentFailure({ toolName, args, result, errorText: resultError, failureCount });
          const guidance = buildFailureRecoveryGuidance(failure);
          if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
            result.failureCategory = failure.category;
            result.recoveryGuidance = guidance;
          }
          if (failureCount >= 3) {
            const errMsg = `Repeated failure guard paused ${toolName} after ${failureCount} identical failures. ${guidance}`;
            await checkpointOperationalContext(workspacePath, 'repeated_tool_failure', `${toolName} failed ${failureCount} times: ${String(resultError).slice(0, 500)}`, guidance);
            currentAgentLogs.push({ type: 'thought', content: errMsg });
            toolResponseParts.push({
              functionResponse: {
                name: toolName,
                response: { error: errMsg, repeatedFailure: true, failureCategory: failure.category, recoveryGuidance: guidance }
              }
            });
            const transition = await recordToolOutcomeInWorkingState(workspacePath, toolName, args, { error: errMsg, repeatedFailure: true, failureCategory: failure.category });
            if (transition && transition.state) {
              workingState = transition.state;
              refreshWorkingStateMessage();
            }
            forceYield = true;
            break;
          }
          if (failureCount === 2) {
            await checkpointOperationalContext(workspacePath, 'tool_failure', `${toolName} repeated a ${baseFailure.category} failure.`, guidance);
            currentAgentLogs.push({ type: 'thought', content: `Repeated ${toolName} failure detected (${baseFailure.category}). ${guidance}` });
            if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
              result.repeatedFailureWarning = guidance;
            }
          }
        }

        if (result && result.state && OPERATIONAL_CONTEXT_ACTIONS.has(toolName)) {
          workingState = result.state;
          refreshWorkingStateMessage();
        }
        const transition = await recordToolOutcomeInWorkingState(workspacePath, toolName, args, result);
        if (transition && transition.state) {
          workingState = transition.state;
          refreshWorkingStateMessage();
        }
        
        toolResponseParts.push({
          functionResponse: {
            name: toolName,
            response: (typeof result === 'object' && result !== null && !Array.isArray(result)) ? result : { output: result }
          }
        });
        
        // Re-render UI with logs
        conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
        window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
      }
      
      // Append tool response parts to message history
      messages.push({ role: 'tool', parts: toolResponseParts });
      
      // Save api response details to current turn
      currentTurn.toolResponseParts = toolResponseParts;
      
      conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      window.saveConversationsToStorage();
      
      if (forceYield) {
        // Structural Validation: Check for Testing Plan section before presenting plan for approval
        let planIsValid = false;
        try {
          const planContent = await window.api.readFile(workspacePath, 'implementation_plan.md', { maxChars: 100000 });
          const planText = typeof planContent === 'string'
            ? planContent
            : (planContent && !planContent.error && typeof planContent.content === 'string' ? planContent.content : '');
          planIsValid = hasRequiredTestingPlanSection(planText);
        } catch (err) {
          console.error('Error checking implementation_plan.md for testing section:', err);
        }

        if (!planIsValid) {
          if (planValidationRetries < 2) {
            planValidationRetries++;
            console.log(`Plan written, but missing Testing Plan. Requesting auto-revision (attempt ${planValidationRetries}).`);
            forceYield = false;
            if (window.appendSystemMessage) {
              window.appendSystemMessage("The plan is missing the required '## Testing Plan' section. Asking the agent to revise before approval.", { conversationId: conversation.id });
            }

            messages.push({
              role: 'user',
              parts: [{
                text: `[SYSTEM: The implementation plan you just wrote is structurally invalid. It is missing the mandatory '## Testing Plan' section. Please revise implementation_plan.md to include this section with exact commands/tests to run, expected behaviors, edge cases, success conditions, and manual checks if automated tests are unavailable. Do this before presenting the plan for approval.]`
              }]
            });
            continue;
          } else {
            console.log("Plan written, but missing Testing Plan. Max revision retries reached. Yielding to user.");
            if (window.appendSystemMessage) {
              window.appendSystemMessage("Approval rejected: The implementation plan is missing a valid '## Testing Plan' section. Please revise the plan first.", { conversationId: conversation.id });
            }
            conversation.awaitingPlanApproval = true;
            conversation.planApproved = false;
            if (window.saveConversationsToStorage) {
              window.saveConversationsToStorage();
            }
            const planItem = workWalkthrough.find(item => item.kind === 'plan');
            lastTextResponse = buildPlanApprovalMessage(planItem, lastTextResponse);
            break;
          }
        }

        console.log("Plan written. Forcing yield to wait for user approval.");
        conversation.awaitingPlanApproval = true;
        const planItem = workWalkthrough.find(item => item.kind === 'plan');
        lastTextResponse = buildPlanApprovalMessage(planItem, lastTextResponse);
        break;
      }
    }
  } catch (error) {
    console.error("Critical error in agent loop:", error);
    window.appendSystemMessage(`Critical error in agent: ${error.message}`);
    lastTextResponse = `An error occurred: ${error.message}`;
    currentAgentLogs.push({ type: 'thought', content: `❌ Critical Error: ${error.message}` });
  } finally {
    isAgentRunning = false;
    runningConversationId = null;
    agentExecutionMode = 'idle';
    agentSubStatus = '';
    if (window.onAgentStatusChange) window.onAgentStatusChange(false);
    
    if (lastTextResponse === "Thinking...") {
      lastTextResponse = "Task finished.";
    }
    lastTextResponse = withWorkWalkthrough(lastTextResponse, workWalkthrough, true);

    // Save walkthrough to file so the chat bubble stays clean
    if (workWalkthrough.length > 0 && workspacePath) {
      try {
        const walkthroughMd = buildWorkWalkthroughMarkdown(workWalkthrough, lastTextResponse);
        await window.api.writeFile(workspacePath, 'work_walkthrough.md', walkthroughMd);
      } catch (_) {}
    }

    // Ensure the final text and logs are written and rendered
    conversation.messages[aiMessageIndex].text = lastTextResponse;
    conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
    window.renderAiMessage(lastTextResponse, currentAgentLogs);
    if (window.api && window.api.writeRunArtifact && workWalkthrough.length > 0) {
      const artifactPayload = buildRunArtifactPayload({
        conversation,
        userPrompt,
        modelName: config.modelName || 'gemini-2.5-flash-lite',
        workspacePath,
        workWalkthrough,
        finalText: lastTextResponse
      });
      window.api.writeRunArtifact(artifactPayload).then((artifactResult) => {
        if (artifactResult && artifactResult.success) {
          conversation.lastArtifactPath = artifactResult.artifactPath;
          window.saveConversationsToStorage();
        }
      }).catch(() => {});
    }
    const pendingOperationalTask = (conversation.tasks || []).find(task => task.status !== 'completed' && task.status !== 'x');
    await checkpointOperationalContext(
      workspacePath,
      forceYield ? 'agent_yield' : 'agent_run_complete',
      String(lastTextResponse || 'Agent run finished.').replace(/\s+/g, ' ').slice(0, 1000),
      pendingOperationalTask ? pendingOperationalTask.title : ''
    );
    
    // Clear the active bubble tracking ONLY after the final render has updated it (removing the spinner)
    window.clearActiveAiBubble();
    
    window.saveConversationsToStorage();
    if (window.renderConversationList) window.renderConversationList();
    if (window.renderProjectsList) window.renderProjectsList();
  }
  
  // Check for queued prompts
  setTimeout(async () => {
    if (window.promptQueue && window.promptQueue.length > 0) {
      const nextTask = window.promptQueue.shift();
      // Look up current or targeted conversation reference
      if (typeof conversations !== 'undefined') {
        const targetId = nextTask.conversationId || (typeof activeConversationId !== 'undefined' ? activeConversationId : null);
        if (!targetId) return;
        const activeConv = conversations.find(c => c.id === targetId);
        if (activeConv) {
          const isInternalQueueItem = nextTask.source === 'followup' || nextTask.source === 'plan-approval' || nextTask.source === 'system';
          const queueLabel = nextTask.source === 'followup'
            ? 'Executing scheduled follow-up.'
            : (nextTask.source === 'plan-approval' ? 'Continuing approved plan.' : `Executing queued prompt: "${nextTask.prompt}"`);
          
          if (window.appendSystemMessage) {
            window.appendSystemMessage(queueLabel, { conversationId: targetId });
          }
          
          const isActive = window.getActiveConversationId && targetId === window.getActiveConversationId();
          if (!isInternalQueueItem && !nextTask.alreadyRendered && isActive && window.renderUserMessageInChat) {
            window.renderUserMessageInChat(nextTask.prompt);
          }
          if (!isInternalQueueItem && !nextTask.alreadyRendered && activeConv.messages) {
            activeConv.messages.push({ role: 'user', source: nextTask.source || 'queue', text: nextTask.prompt, createdAt: Date.now() });
            if (window.saveConversationsToStorage) window.saveConversationsToStorage();
          }
          await window.runAgentLoop(nextTask.prompt, nextTask.modelSelectValue, activeConv, {
            source: nextTask.source || 'queue',
            internalPrompt: isInternalQueueItem
          });
        }
      }
    }
  }, 500);
};

// TOOL EXECUTOR HUB
async function executeTool(name, args, workspace, config, conversation) {
  console.log(`Executing tool ${name} with args:`, args);
  
  switch (name) {
    case 'get_workspace_info': {
      const entryResult = await window.api.getWorkspaceEntrypoint(workspace);
      return {
        success: true,
        workspace,
        conversationId: conversation.id,
        title: conversation.title,
        projectPath: conversation.projectPath || '',
        scope: conversation.projectPath ? 'project' : 'standalone',
        entrypoint: entryResult && entryResult.success ? entryResult.entrypoint : null
      };
    }

    case 'open_workspace_folder': {
      const result = await window.api.openWorkspaceFolder(workspace);
      if (!result.success) throw new Error(result.error || 'Failed to open workspace folder');
      return result;
    }

    case 'launch_workspace_app': {
      const result = await window.api.launchWorkspaceApp(workspace);
      if (!result.success) throw new Error(result.error || 'Failed to launch workspace app');
      return result;
    }

    case 'set_workspace_entrypoint': {
      const command = args.command ? String(args.command).trim() : '';
      const result = await window.api.setWorkspaceEntrypoint(workspace, command ? { command, label: args.label || '' } : null);
      if (!result.success) throw new Error(result.error || 'Failed to set workspace entry point');
      if (window.refreshWorkspaceEntrypoint) window.refreshWorkspaceEntrypoint();
      return {
        success: true,
        message: command ? `Workspace entry point set to: ${command}` : 'Workspace entry point cleared.',
        entrypoint: result.entrypoint
      };
    }

    case 'git_push': {
      const result = await window.api.gitPush(
        workspace,
        args.remote || 'origin',
        args.branch || '',
        args.setUpstream !== false
      );
      if (!result.success) throw new Error(result.error || 'Git push failed');
      return result;
    }

    case 'list_files': {
      const files = await window.api.listFiles(workspace);
      if (files && files.error) throw new Error(files.error);
      const fileList = Array.isArray(files) ? files : (Array.isArray(files && files.files) ? files.files : []);
      if (!Array.isArray(files) && !Array.isArray(files && files.files)) {
        throw new Error('list_files returned an unexpected result shape.');
      }
      const mappedFiles = fileList.map(f => ({ path: f.path, isDir: f.isDir, size: f.size }));
      if (mappedFiles.length > 800) {
        return {
          files: mappedFiles.slice(0, 800),
          warning: `Truncated output. Found ${mappedFiles.length} items, showing first 800. Be more specific or use search/grep tools.`
        };
      }
      return mappedFiles;
    }

    case 'search_embeddings': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const result = await window.api.searchEmbeddings(args.query, args.limit);
      if (!result.success) return { success: false, results: [], message: 'Semantic search is not available for this workspace. Use read_file or run_command to find what you need instead.' };
      return result;
    }
    
    case 'read_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const content = await window.api.readFile(workspace, args.path, {
        startLine: args.startLine,
        endLine: args.endLine,
        maxChars: args.maxChars
      });
      if (content.error) throw new Error(content.error);
      return { content: content };
    }
    
    case 'write_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (args.content === undefined) throw new Error("Missing 'content' parameter");
      const isPlanFile = isImplementationPlanPath(args.path);
      const isStrategyFile = isStrategyPath(args.path);
      const existingContent = await window.api.readFile(workspace, args.path, { maxChars: 200000 });
      if (!isPlanFile && !isStrategyFile && existingContent && !existingContent.error && args.allowOverwrite !== true) {
        throw new Error("write_file refused to overwrite an existing file. Use patch_file for surgical edits, or set allowOverwrite=true with overwriteReason when a full rewrite is explicitly required.");
      }
      if (args.allowOverwrite === true && !String(args.overwriteReason || '').trim()) {
        throw new Error("write_file allowOverwrite requires overwriteReason so the rewrite is auditable.");
      }
      
      // Optional regression testing BEFORE edit
      let beforePass = true;
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        beforePass = testRes.success;
      }
      
      const writeRes = await window.api.writeFile(workspace, args.path, args.content);
      if (writeRes.error) throw new Error(writeRes.error);
      
      // Refresh directory UI
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      
      let testFeedback = "";
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback = "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this write. Please review your modifications.";
        }
      }
      const missingHtmlRefs = await findMissingHtmlLocalReferences(workspace, args.path, args.content);
      if (missingHtmlRefs.length) {
        testFeedback += `\n[WARNING] Missing local HTML references from ${args.path}: ${missingHtmlRefs.map(ref => `\`${ref}\``).join(', ')}. Create these files or remove the references before considering the UI verified.`;
      }
      
      return {
        success: true,
        message: `File written to ${args.path} successfully.${testFeedback}`,
        backupPath: writeRes.backupPath || null
      };
    }
    
    case 'modify_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (!args.target) throw new Error("Missing 'target' parameter");
      if (args.replacement === undefined) throw new Error("Missing 'replacement' parameter");
      
      // Read original
      const fileData = await window.api.readFile(workspace, args.path);
      if (fileData.error) throw new Error(fileData.error);
      
      // Apply replacement
      const index = fileData.indexOf(args.target);
      if (index === -1) {
        throw new Error(`Target content block not found in file: ${args.path}. Ensure exact match including whitespace.`);
      }
      
      const newContent = fileData.substring(0, index) + args.replacement + fileData.substring(index + args.target.length);
      
      // Optional regression testing BEFORE edit
      let beforePass = true;
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        beforePass = testRes.success;
      }
      
      const writeRes = await window.api.writeFile(workspace, args.path, newContent);
      if (writeRes.error) throw new Error(writeRes.error);
      
      // Refresh directory UI
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      
      let testFeedback = "";
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback = "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this edit. Please inspect your change.";
        }
      }
      
      return {
        success: true,
        message: `File modified successfully.${testFeedback}`,
        backupPath: writeRes.backupPath || null
      };
    }

    case 'patch_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (!args.operation || !args.operation.type) throw new Error("Missing 'operation' parameter");

      let beforePass = true;
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        beforePass = testRes.success;
      }

      const patchRes = await window.api.patchFile(workspace, args.path, args.operation);
      if (patchRes.error) throw new Error(patchRes.error);

      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();

      let testFeedback = "";
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback = "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this patch. Please inspect your change.";
        }
      }

      return { ...patchRes, message: `${patchRes.message || 'File patched successfully.'}${testFeedback}` };
    }
    
    case 'change_workspace': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      // Expand common Windows env var patterns the model tends to emit literally
      let targetPath = args.path
        .replace(/\$env:USERPROFILE/gi, resolvedHomeDir)
        .replace(/\$env:HOMEDRIVE/gi, resolvedHomeDir.slice(0, 2) || 'C:')
        .replace(/\$env:HOMEPATH/gi, resolvedHomeDir.slice(2) || '\\Users\\Owner')
        .replace(/^~[/\\]?/, resolvedHomeDir + '\\');
      try {
        const files = await window.api.listFiles(targetPath);
        if (files && files.error) {
          throw new Error(files.error);
        }
      } catch (err) {
        throw new Error(`Workspace path "${targetPath}" is invalid or does not exist: ${err.message}`);
      }
      conversation.workspace = targetPath;
      conversation.projectPath = targetPath;
      if (typeof window.changeActiveWorkspace === 'function') {
        window.changeActiveWorkspace(targetPath);
      }
      return {
        success: true,
        message: `Workspace directory changed to: ${targetPath}`
      };
    }

    case 'run_command': {
      if (!args.command) throw new Error("Missing 'command' parameter");
      const timeoutMs = args.timeoutMs || config.commandTimeoutMs || 120000;
      const interactiveGate = await validateRunCommandForAgentUse(args.command, workspace);
      if (!interactiveGate.allowed) {
        return {
          success: false,
          error: interactiveGate.reason,
          failureCategory: 'interactive_command_needs_input',
          recoveryGuidance: buildFailureRecoveryGuidance({ category: 'interactive_command_needs_input' }),
          timeoutMs
        };
      }
      
      const processId = `cmd_${conversation.id}_${Date.now()}`;
      let stdoutOutput = '';
      let stderrOutput = '';
      
      // Setup output streamer listener
      const cleanOutput = window.api.onCommandOutput(processId, (data) => {
        if (data.type === 'stderr') {
          stderrOutput += data.text;
        } else {
          stdoutOutput += data.text;
        }
      });
      
      let result = await window.api.runCommand(args.command, workspace, processId, timeoutMs);
      cleanOutput();

      // Auto-recovery: if pip install X==version failed with a source-build error, retry without version pin
      const cmdStderr = stderrOutput || result.stderr || result.error || '';
      const isPipBuildFailure = result.code !== 0
        && /pip\s+install/i.test(args.command)
        && /==\d/.test(args.command)
        && /(Failed to build|Getting requirements to build wheel|error: subprocess-exited-with-error|No module named 'distutils)/i.test(cmdStderr);
      if (isPipBuildFailure) {
        const retryCmd = args.command.replace(/([a-zA-Z0-9_\-\.]+)==[\d][^\s]*/g, '$1');
        currentAgentLogs.push({ type: 'thought', content: `pip build failure detected — retrying without version pin: ${retryCmd}` });
        const retryId = `cmd_${conversation.id}_retry_${Date.now()}`;
        let retryStdout = '', retryStderr = '';
        const cleanRetry = window.api.onCommandOutput(retryId, (data) => {
          if (data.type === 'stderr') retryStderr += data.text;
          else retryStdout += data.text;
        });
        const retryResult = await window.api.runCommand(retryCmd, workspace, retryId, timeoutMs);
        cleanRetry();
        return {
          exitCode: retryResult.code,
          stdout: retryStdout || retryResult.stdout || '',
          stderr: retryStderr || retryResult.stderr || retryResult.error || '',
          timedOut: !!retryResult.timedOut,
          killed: !!retryResult.killed,
          timeoutMs: retryResult.timeoutMs || timeoutMs,
          autoRetried: true,
          originalCommand: args.command,
          retryCommand: retryCmd,
          retryReason: 'pip source-build failure — retried without version pin'
        };
      }

      return {
        exitCode: result.code,
        stdout: stdoutOutput || result.stdout || '',
        stderr: stderrOutput || result.stderr || result.error || '',
        timedOut: !!result.timedOut,
        killed: !!result.killed,
        timeoutMs: result.timeoutMs || timeoutMs
      };
    }

    case 'start_command': {
      if (!args.command) throw new Error("Missing 'command' parameter");
      const requestedId = args.processId ? String(args.processId).replace(/[^a-zA-Z0-9_.-]/g, '_') : '';
      const processId = requestedId && requestedId.includes(conversation.id)
        ? requestedId
        : `cmd_${conversation.id}_${requestedId || Date.now()}`;
      const timeoutMs = args.timeoutMs || config.commandTimeoutMs || 120000;
      const result = await window.api.startCommand(args.command, workspace, processId, timeoutMs);
      if (!result.success) throw new Error(result.error || 'Failed to start command');
      return result;
    }

    case 'get_command_status': {
      if (!args.processId) throw new Error("Missing 'processId' parameter");
      const result = await window.api.getCommandStatus(args.processId);
      if (!result.success) throw new Error(result.error || 'Failed to get command status');
      return result;
    }

    case 'read_command_output': {
      if (!args.processId) throw new Error("Missing 'processId' parameter");
      const result = await window.api.readCommandOutput(args.processId, args.maxChars || 12000);
      if (!result.success) throw new Error(result.error || 'Failed to read command output');
      return result;
    }

    case 'kill_command': {
      if (!args.processId) throw new Error("Missing 'processId' parameter");
      return await window.api.killCommand(args.processId);
    }

    case 'schedule_followup': {
      return scheduleAgentFollowup(args);
    }

    case 'read_notes': {
      return await readScopedNotes(workspace, conversation);
    }

    case 'update_notes': {
      if (args.content === undefined) throw new Error("Missing 'content' parameter");
      const mode = args.mode || 'replace';
      if (mode === 'append') {
        return await appendScopedNotes(workspace, conversation, args.content);
      }
      return await writeScopedNotes(workspace, conversation, args.content);
    }

    case 'read_operational_context':
      return await readOperationalContext(workspace);
    case 'update_mission_context':
    case 'start_subplan':
    case 'update_subplan_context':
    case 'complete_subplan':
    case 'record_blocker':
    case 'resolve_blocker':
    case 'convert_blocker_to_backlog':
    case 'promote_discovery':
    case 'discard_noise':
    case 'evaluate_win_conditions':
      return await mutateOperationalContext(workspace, name, args);
    
    case 'run_tests': {
      const testRes = await window.runRegressionTests();
      return {
        success: testRes.success,
        output: testRes.output
      };
    }

    case 'google_search': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const apiKey = config.googleSearchApiKey;
      if (!apiKey) throw new Error("Google Search API Key is not configured. Please add it in settings.");
      const searchEngineId = config.googleSearchEngineId;
      if (!searchEngineId) throw new Error("Google Search Engine ID is not configured. Please add it in settings.");
      const result = await window.api.googleSearch(args.query, apiKey, searchEngineId, args.numResults || 5);
      if (!result.success) throw new Error(result.error || 'Google search failed');
      return {
        success: true,
        results: result.items
      };
    }

    case 'fetch_web_page': {
      if (!args.url) throw new Error("Missing 'url' parameter");
      const result = await window.api.fetchWebPage(args.url);
      if (!result.success) throw new Error(result.error || 'Web page fetch failed');
      return result;
    }

    case 'download_file': {
      if (!args.url) throw new Error("Missing 'url' parameter");
      const result = await window.api.downloadFile(workspace, args.url, args.destination || '');
      if (!result.success) throw new Error(result.error || 'Download failed');
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      return result;
    }

    case 'inspect_archive': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const result = await window.api.inspectArchive(workspace, args.path);
      if (!result.success) throw new Error(result.error || 'Archive inspection failed');
      return result;
    }

    case 'extract_archive': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const result = await window.api.extractArchive(workspace, args.path, args.destination || '');
      if (!result.success) throw new Error(result.error || 'Archive extraction failed');
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      return result;
    }

    case 'inspect_binary_asset': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const result = await window.api.inspectBinaryAsset(workspace, args.path);
      if (!result.success) throw new Error(result.error || 'Asset inspection failed');
      return result;
    }

    case 'list_asset_metadata': {
      const result = await window.api.listAssetMetadata(workspace, args.path || 'assets');
      if (!result.success) throw new Error(result.error || 'Asset metadata listing failed');
      return result;
    }

    case 'open_url': {
      if (!args.url) throw new Error("Missing 'url' parameter");
      const result = await window.api.browserOpenUrl(args.url);
      if (!result.success) throw new Error(result.error || 'Browser open failed');
      return result;
    }

    case 'search_web': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const result = await window.api.browserSearchWeb(args.query);
      if (!result.success) throw new Error(result.error || 'Browser search failed');
      return result;
    }

    case 'click_element': {
      const result = await window.api.browserClickElement(args.selector || '', args.text || '');
      if (!result.success) throw new Error(result.error || 'Click failed');
      return result;
    }

    case 'fill_input': {
      if (!args.selector) throw new Error("Missing 'selector' parameter");
      const result = await window.api.browserFillInput(args.selector, args.value || '');
      if (!result.success) throw new Error(result.error || 'Fill input failed');
      return result;
    }

    case 'navigate_back': {
      const result = await window.api.browserNavigateBack();
      if (!result.success) throw new Error(result.error || 'Navigate back failed');
      return result;
    }

    case 'download_from_page': {
      const result = await window.api.browserDownloadFromPage(workspace, args.selector || '', args.url || '', args.destination || '');
      if (!result.success) throw new Error(result.error || 'Page download failed');
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      return result;
    }

    case 'wait_for_page': {
      const result = await window.api.browserWaitForPage(args.timeoutMs || 1000);
      if (!result.success) throw new Error(result.error || 'Wait failed');
      return result;
    }

    case 'take_screenshot': {
      const result = await window.api.takeScreenshot(workspace, args.destination || '');
      if (!result.success) throw new Error(result.error || 'Screenshot failed');
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      return result;
    }

    case 'inspect_screenshot': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const result = await window.api.inspectScreenshot(workspace, args.path);
      if (!result.success) throw new Error(result.error || 'Screenshot inspection failed');
      return result;
    }

    case 'compare_screenshot_to_goal': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (!args.goal) throw new Error("Missing 'goal' parameter");
      const result = await window.api.compareScreenshotToGoal(workspace, args.path, args.goal, args.observations || '');
      if (!result.success) throw new Error(result.error || 'Screenshot comparison failed');
      return result;
    }

    case 'inspect_screenshot_with_model': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (!args.goal) throw new Error("Missing 'goal' parameter");
      if (!config.geminiApiKey) throw new Error('Gemini API key is required for multimodal screenshot inspection.');
      const file = await window.api.readWorkspaceFileBase64(workspace, args.path);
      if (!file.success) throw new Error(file.error || 'Could not read screenshot image');
      if (!String(file.mimeType || '').startsWith('image/')) throw new Error(`Screenshot inspection requires an image file, got ${file.mimeType}`);
      return await inspectScreenshotWithGemini({
        imageBase64: file.data,
        mimeType: file.mimeType,
        path: args.path,
        goal: args.goal,
        modelName,
        apiKey: config.geminiApiKey
      });
    }

    case 'sync_workspace_env': {
      return await syncWorkspaceEnv(workspace, config, args);
    }
    
    case 'set_task_checklist': {
      if (!args.tasks || !Array.isArray(args.tasks)) throw new Error("Missing 'tasks' array parameter");
      args.tasks = normalizeChecklistTasks(args.tasks);
      const gate = shouldApplyChecklistUpdate(conversation.tasks, args.tasks);
      if (!gate.allowed) {
        return {
          success: true,
          skipped: true,
          reason: gate.reason,
          message: `Checklist update skipped: ${gate.reason}`
        };
      }
      if (args.tasks.length > 0 && args.tasks.every(task => task.status === 'completed' || task.status === 'x')) {
        const currentOperational = await readOperationalContext(workspace);
        if (currentOperational.success && hasOperationalMissionState(currentOperational.state)) {
          const completionGate = OperationalContext.evaluateCompletionGate(currentOperational.state, { explicitRequirements: args.tasks });
          if (completionGate.status !== 'ready_for_final') {
            return {
              success: true,
              skipped: true,
              reason: 'completion_gate',
              message: `Checklist completion skipped: ${buildCompletionGateMessage(completionGate)}`,
              completionGate
            };
          }
        }
      }
      
      // Update local storage representation in target conversation
      conversation.tasks = args.tasks;
      
      // Update UI checklist only if target conversation is active
      if (window.getActiveConversationId && conversation.id === window.getActiveConversationId()) {
        window.updateTasksChecklist(args.tasks);
      }
      
      if (window.saveConversationsToStorage) {
        window.saveConversationsToStorage();
      }
      
      return { success: true, message: `Checklist updated with ${args.tasks.length} items.` };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function syncWorkspaceEnv(workspace, config, args = {}) {
  if (!workspace) throw new Error("No active workspace");
  
  const envPath = args.envPath || '.env';
  const updateGitignore = args.updateGitignore !== false;
  const createExample = args.createExample !== false;
  const includeGemini = args.includeGemini !== false;
  const includeSearch = args.includeSearch !== false;
  
  const values = {};
  if (includeGemini && config.geminiApiKey) {
    values.GEMINI_API_KEY = config.geminiApiKey;
    values.GOOGLE_API_KEY = config.geminiApiKey;
  }
  if (includeSearch) {
    if (config.googleSearchEngineId) {
      values.GOOGLE_SEARCH_ENGINE_ID = config.googleSearchEngineId;
      values.GOOGLE_CSE_ID = config.googleSearchEngineId;
    }
    const searchApiKey = config.googleSearchApiKey;
    if (searchApiKey) {
      values.GOOGLE_SEARCH_API_KEY = searchApiKey;
    }
  }
  
  if (Object.keys(values).length === 0) {
    throw new Error("No configured API keys or search settings are available to sync.");
  }
  
  let existing = '';
  const existingRead = await window.api.readFile(workspace, envPath);
  if (typeof existingRead === 'string') {
    existing = existingRead;
  }
  
  const lines = existing.split(/\r?\n/).filter(line => {
    const key = line.split('=')[0].trim();
    return !Object.prototype.hasOwnProperty.call(values, key);
  });
  
  if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
    lines.push('');
  }
  
  Object.entries(values).forEach(([key, value]) => {
    lines.push(`${key}=${escapeEnvValue(value)}`);
  });
  
  const envWrite = await window.api.writeFile(workspace, envPath, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
  if (envWrite.error) throw new Error(envWrite.error);
  
  const writtenFiles = [envPath];
  if (createExample) {
    const examplePath = args.examplePath || '.env.example';
    let existingExample = '';
    const readExample = await window.api.readFile(workspace, examplePath);
    if (typeof readExample === 'string') {
      existingExample = readExample;
    }
    
    const exampleLines = existingExample.split(/\r?\n/);
    const existingKeys = new Set();
    exampleLines.forEach(line => {
      const cleanLine = line.trim();
      if (cleanLine && !cleanLine.startsWith('#') && cleanLine.includes('=')) {
        const key = cleanLine.split('=')[0].trim();
        if (key) existingKeys.add(key);
      }
    });

    const newKeysToAppend = Object.keys(values).filter(key => !existingKeys.has(key));
    if (newKeysToAppend.length > 0) {
      if (exampleLines.length > 0 && exampleLines[exampleLines.length - 1].trim() !== '') {
        exampleLines.push('');
      }
      newKeysToAppend.forEach(key => {
        exampleLines.push(`${key}=`);
      });
      const exampleWrite = await window.api.writeFile(workspace, examplePath, exampleLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
      if (exampleWrite.error) throw new Error(exampleWrite.error);
      writtenFiles.push(examplePath);
    }
  }
  
  if (updateGitignore) {
    let gitignore = '';
    const gitignoreRead = await window.api.readFile(workspace, '.gitignore');
    if (typeof gitignoreRead === 'string') {
      gitignore = gitignoreRead;
    }
    
    const ignoreEntries = [envPath, '.env.local', '.env.*.local'];
    const gitignoreLines = gitignore.split(/\r?\n/);
    ignoreEntries.forEach(entry => {
      if (!gitignoreLines.some(line => line.trim() === entry)) {
        gitignoreLines.push(entry);
      }
    });
    
    const gitignoreWrite = await window.api.writeFile(workspace, '.gitignore', gitignoreLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
    if (gitignoreWrite.error) throw new Error(gitignoreWrite.error);
    writtenFiles.push('.gitignore');
  }
  
  if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
  
  return {
    success: true,
    message: "Workspace environment secrets synced. Secret values were not returned to the model.",
    writtenFiles,
    variables: Object.keys(values).map(key => `${key}=<configured>`)
  };
}

function escapeEnvValue(value) {
  const stringValue = String(value || '');
  if (/[\s"'#]/.test(stringValue)) {
    return JSON.stringify(stringValue);
  }
  return stringValue;
}

function normalizeTaskStatus(status) {
  const normalized = String(status || 'pending').toLowerCase().trim().replace(/_/g, '-');
  if (normalized === 'done' || normalized === 'complete' || normalized === 'completed' || normalized === 'x') {
    return 'completed';
  }
  if (normalized === 'running' || normalized === 'active' || normalized === 'in-progress' || normalized === 'in progress' || normalized === '/') {
    return 'in-progress';
  }
  return 'pending';
}

function normalizeChecklistTasks(tasks = []) {
  return tasks.map(task => ({
    ...task,
    title: String(task.title || '').trim(),
    status: normalizeTaskStatus(task.status)
  })).filter(task => task.title);
}

function checklistTaskKey(task) {
  return String(task && task.title || '').trim().toLowerCase();
}

function shouldApplyChecklistUpdate(previousTasks = [], nextTasks = []) {
  const previous = normalizeChecklistTasks(previousTasks || []);
  const next = normalizeChecklistTasks(nextTasks || []);
  if (next.length === 0) {
    return { allowed: false, reason: 'empty checklist update' };
  }
  if (previous.length === 0) {
    return { allowed: true, reason: 'initial checklist' };
  }

  const previousByTitle = new Map(previous.map(task => [checklistTaskKey(task), task]));
  const nextByTitle = new Map(next.map(task => [checklistTaskKey(task), task]));
  const previousTitles = [...previousByTitle.keys()].sort().join('\n');
  const nextTitles = [...nextByTitle.keys()].sort().join('\n');
  if (previousTitles !== nextTitles) {
    return { allowed: true, reason: 'checklist tasks changed' };
  }

  let changed = false;
  let meaningful = false;
  for (const task of next) {
    const previousTask = previousByTitle.get(checklistTaskKey(task));
    if (!previousTask || previousTask.status !== task.status) {
      changed = true;
      if (task.status === 'completed' || previousTask.status === 'completed') {
        meaningful = true;
      }
      if (previousTask.status === 'in-progress' && task.status === 'pending') {
        meaningful = true;
      }
    }
  }

  if (!changed) {
    return { allowed: false, reason: 'no checklist changes' };
  }
  if (meaningful) {
    return { allowed: true, reason: 'milestone status changed' };
  }
  return {
    allowed: false,
    reason: 'only in-progress status changed; continue the work instead of refreshing the checklist'
  };
}

function getNotesMetadata(conversation) {
  const isProject = !!(conversation && conversation.projectPath);
  return {
    scope: isProject ? 'project' : 'standalone',
    scopeLabel: isProject ? `Project: ${conversation.projectPath}` : `Standalone conversation: ${conversation ? conversation.title : 'Untitled'}`,
    path: isProject ? '.orion/project-notes.md' : '.orion/conversation-notes.md'
  };
}

async function readScopedNotes(workspace, conversation) {
  const metadata = getNotesMetadata(conversation);
  if (!workspace) {
    return { ...metadata, content: '' };
  }
  
  const content = await window.api.readFile(workspace, metadata.path);
  return {
    ...metadata,
    content: typeof content === 'string' ? content : ''
  };
}

async function writeScopedNotes(workspace, conversation, content) {
  const metadata = getNotesMetadata(conversation);
  if (!workspace) throw new Error('No active workspace for notes');
  
  const header = metadata.scope === 'project'
    ? `# Orion Project Notes\n\nScope: ${metadata.scopeLabel}\n\n`
    : `# Orion Standalone Conversation Notes\n\nScope: ${metadata.scopeLabel}\n\n`;
  const noteContent = String(content || '').trim();
  const finalContent = noteContent.startsWith('# Orion') ? `${noteContent}\n` : `${header}${noteContent}\n`;
  
  const writeRes = await window.api.writeFile(workspace, metadata.path, finalContent);
  if (writeRes.error) throw new Error(writeRes.error);
  if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
  
  return {
    success: true,
    ...metadata,
    message: `Updated ${metadata.scope} notes.`,
    bytes: finalContent.length
  };
}

async function appendScopedNotes(workspace, conversation, content) {
  const existing = await readScopedNotes(workspace, conversation);
  const addition = String(content || '').trim();
  const nextContent = existing.content && existing.content.trim()
    ? `${existing.content.trimEnd()}\n\n${addition}\n`
    : addition;
  return await writeScopedNotes(workspace, conversation, nextContent);
}

const OPERATIONAL_CONTEXT_PATH = '.orion/context/operational-context.json';
const OPERATIONAL_CONTEXT_JOURNAL_PATH = '.orion/context/journal.jsonl';

async function readOperationalContext(workspace) {
  const empty = OperationalContext.createEmptyContext();
  if (!workspace) return { success: true, state: empty, path: OPERATIONAL_CONTEXT_PATH };
  const content = await window.api.readFile(workspace, OPERATIONAL_CONTEXT_PATH, { maxChars: 500000 });
  if (!content || content.error) return { success: true, state: empty, path: OPERATIONAL_CONTEXT_PATH };
  try {
    return { success: true, state: OperationalContext.normalizeContext(JSON.parse(content)), path: OPERATIONAL_CONTEXT_PATH };
  } catch (error) {
    return { success: false, state: empty, path: OPERATIONAL_CONTEXT_PATH, error: `Operational context is invalid JSON: ${error.message}` };
  }
}

async function appendOperationalJournal(workspace, event, revision) {
  const existing = await window.api.readFile(workspace, OPERATIONAL_CONTEXT_JOURNAL_PATH, { maxChars: 500000 });
  const lines = typeof existing === 'string' ? existing.trim().split(/\r?\n/).filter(Boolean) : [];
  lines.push(JSON.stringify({ ...event, revision }));
  const writeResult = await window.api.writeFile(workspace, OPERATIONAL_CONTEXT_JOURNAL_PATH, `${lines.slice(-500).join('\n')}\n`);
  if (writeResult && writeResult.error) throw new Error(writeResult.error);
}

async function mutateOperationalContext(workspace, action, args = {}) {
  if (!workspace) throw new Error('No active workspace for operational context');
  const current = await readOperationalContext(workspace);
  if (!current.success) throw new Error(current.error);
  const transition = OperationalContext.applyAction(current.state, action, args);
  if (action === 'evaluate_win_conditions' && transition.state.winConditions.length > 0 && transition.state.winConditions.every(condition => condition.status === 'satisfied') && agentExecutionMode !== 'direct' && agentExecutionMode !== 'answer') {
    const completionGate = OperationalContext.evaluateCompletionGate(transition.state, { explicitRequirements: [] });
    if (completionGate.status !== 'ready_for_final') {
      throw new Error(`Completion gate rejected final win-condition satisfaction: ${buildCompletionGateMessage(completionGate)}`);
    }
  }
  const writeResult = await window.api.writeFile(workspace, OPERATIONAL_CONTEXT_PATH, `${JSON.stringify(transition.state, null, 2)}\n`);
  if (writeResult && writeResult.error) throw new Error(writeResult.error);
  await appendOperationalJournal(workspace, transition.event, transition.state.revision);
  if (window.updateOperationalContext) window.updateOperationalContext(transition.state);
  return { success: true, action, event: transition.event, state: transition.state, path: OPERATIONAL_CONTEXT_PATH };
}

async function checkpointOperationalContext(workspace, reason, summary, nextAction = '') {
  try {
    const current = await readOperationalContext(workspace);
    if (!current.state.mission.statement && current.state.winConditions.length === 0) return null;
    return await mutateOperationalContext(workspace, 'checkpoint', { reason, summary, nextAction });
  } catch (error) {
    console.warn('Operational context checkpoint failed:', error);
    return null;
  }
}

function hasOperationalMissionState(state) {
  return !!(state && (state.mission && state.mission.statement || state.winConditions && state.winConditions.length || state.activeSubplan));
}

function isTaskContinuationPrompt(prompt) {
  const text = String(prompt || '').toLowerCase().trim();
  if (!text) return false;
  return /\b(continue|keep going|finish|finish this|lets finish|let's finish|resume|carry on|complete it|fix this|fix these|why didn't you catch|why did you not catch|catch and fix|not done|still broken|missing|error|console|failed to load|err_file_not_found)\b/.test(text);
}

function buildCompletionGateMessage(gate) {
  const parts = [`Completion gate status: ${gate.status}.`];
  if (gate.reasons && gate.reasons.length) parts.push(`Reasons: ${gate.reasons.join('; ')}`);
  if (gate.missingEvidence && gate.missingEvidence.length) parts.push(`Missing proof: ${gate.missingEvidence.join('; ')}`);
  if (gate.pendingWinConditions && gate.pendingWinConditions.length) parts.push(`Pending win conditions: ${gate.pendingWinConditions.map(item => item.title).join('; ')}`);
  if (gate.pendingRequirements && gate.pendingRequirements.length) parts.push(`Pending requirements: ${gate.pendingRequirements.map(item => item.title).join('; ')}`);
  if (gate.blockers && gate.blockers.length) parts.push(`Active blockers: ${gate.blockers.map(item => item.title).join('; ')}`);
  if (gate.remainingMinorBlockers && gate.remainingMinorBlockers.length) parts.push(`Remaining minor blockers: ${gate.remainingMinorBlockers.map(item => item.title).join('; ')}`);
  if (gate.backlogCandidates && gate.backlogCandidates.length) parts.push(`Backlog candidates: ${gate.backlogCandidates.map(item => item.title).join('; ')}`);
  return parts.join('\n');
}

function evaluateWorkingStateCompletion(state, conversation) {
  return OperationalContext.evaluateCompletionGate(state, {
    explicitRequirements: conversation && conversation.tasks ? conversation.tasks : []
  });
}

function firstMeaningfulLine(text, fallback = '') {
  const lines = String(text || '').split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*(\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean);
  return (lines[0] || fallback).slice(0, 1000);
}

function bulletLines(text, max = 8) {
  return String(text || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').replace(/^\[[ xX]\]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function summarizeSectionForDiscovery(title, content) {
  const lines = bulletLines(content, 4);
  const text = lines.length ? lines.join('; ') : firstMeaningfulLine(content);
  return text ? `${title}: ${text}`.slice(0, 4000) : '';
}

function buildOperationalContextFromStrategy(content) {
  const trueObjective = extractMarkdownSection(content, 'True Objective');
  const evidenceRequired = extractMarkdownSection(content, 'Evidence Required for Success');
  const recommendedDirection = extractMarkdownSection(content, 'Recommended Direction');
  const currentReality = extractMarkdownSection(content, 'Current Repo Reality');
  const relevantFiles = extractMarkdownSection(content, 'Relevant Files / Subsystems');
  const assumptions = extractMarkdownSection(content, 'Assumptions');
  const risks = extractMarkdownSection(content, 'Risks / Failure Modes');
  const whatNotToTouch = extractMarkdownSection(content, 'What Not To Touch');
  const mission = firstMeaningfulLine(trueObjective, 'Execute the strategy in STRATEGY.md.');
  const evidenceLines = bulletLines(evidenceRequired, 12);
  const winConditions = evidenceLines.length
    ? evidenceLines.map(line => ({ title: line, status: 'pending', evidence: [] }))
    : [{ title: `Evidence satisfies strategy objective: ${mission}`, status: 'pending', evidence: [] }];
  const discoveries = [
    summarizeSectionForDiscovery('Current repo reality', currentReality),
    summarizeSectionForDiscovery('Relevant files/subsystems', relevantFiles),
    summarizeSectionForDiscovery('Strategy assumptions', assumptions),
    summarizeSectionForDiscovery('Risks/failure modes', risks),
    summarizeSectionForDiscovery('What not to touch', whatNotToTouch)
  ].filter(Boolean);
  return {
    mission,
    winConditions,
    activeObjective: firstMeaningfulLine(recommendedDirection, mission),
    discoveries
  };
}

async function applyStrategyToOperationalContext(workspace, content) {
  const validation = validateStrategyContent(content);
  if (!validation.valid || !workspace) return { validation, transition: null };
  const derived = buildOperationalContextFromStrategy(content);
  let transition = await mutateOperationalContext(workspace, 'update_mission_context', {
    mission: derived.mission,
    winConditions: derived.winConditions,
    activeObjective: derived.activeObjective,
    rationale: 'Derived from STRATEGY.md during mission refinement.'
  });
  for (const text of derived.discoveries) {
    transition = await mutateOperationalContext(workspace, 'promote_discovery', {
      text,
      category: 'strategy_discovery',
      evidence: 'STRATEGY.md'
    });
  }
  transition = await mutateOperationalContext(workspace, 'discard_noise', {
    summary: 'Temporary repository scan details were distilled into STRATEGY.md and operational context.'
  });
  return { validation, transition };
}

function summarizeToolOutcome(toolName, args, result) {
  const success = !(result && (result.error || result.success === false));
  const parts = [];
  if (result && typeof result === 'object') {
    if (result.message) parts.push(String(result.message));
    if (result.summary) parts.push(String(result.summary));
    if (result.title) parts.push(`title=${result.title}`);
    if (result.url) parts.push(`url=${result.url}`);
    if (result.path) parts.push(`path=${result.path}`);
    if (result.destination) parts.push(`destination=${result.destination}`);
    if (result.file) parts.push(`file=${result.file}`);
    if (result.count !== undefined) parts.push(`count=${result.count}`);
    if (result.entryCount !== undefined) parts.push(`entryCount=${result.entryCount}`);
    if (result.status) parts.push(`status=${result.status}`);
    if (result.exitCode !== undefined) parts.push(`exitCode=${result.exitCode}`);
    if (result.error) parts.push(`error=${String(result.error)}`);
    if (!parts.length && result.output) parts.push(String(result.output));
  } else if (result !== undefined) {
    parts.push(String(result));
  }
  const argHint = args && typeof args === 'object'
    ? Object.entries(args).slice(0, 3).map(([key, value]) => `${key}=${String(value).slice(0, 120)}`).join(', ')
    : '';
  const summary = String(parts.filter(Boolean).join(' | ') || argHint || 'Tool completed.').trim().slice(0, 1200);
  return { success, summary };
}

async function recordToolOutcomeInWorkingState(workspace, toolName, args, result) {
  try {
    if (!workspace || toolName === 'read_operational_context') return null;
    const current = await readOperationalContext(workspace);
    if (!current.state.mission.statement && current.state.winConditions.length === 0 && !current.state.activeSubplan) return null;
    const outcome = summarizeToolOutcome(toolName, args, result);
    let transition = await mutateOperationalContext(workspace, 'record_tool_result', {
      toolName,
      success: outcome.success,
      summary: outcome.summary,
      checkpoint: 'Tool result reduced into operational working state before next model turn.'
    });
    const discovery = buildDiscoveryFromToolOutcome(toolName, args, result, outcome);
    if (discovery && outcome.success) {
      transition = await mutateOperationalContext(workspace, 'promote_discovery', discovery);
    }
    return transition;
  } catch (error) {
    console.warn('Operational working-state tool reduction failed:', error);
    return null;
  }
}

function buildDiscoveryFromToolOutcome(toolName, args = {}, result = {}, outcome = {}) {
  if (!result || result.error || result.success === false) return null;
  const assetTools = new Set(['download_file', 'inspect_archive', 'extract_archive', 'inspect_binary_asset', 'list_asset_metadata']);
  const browserTools = new Set(['open_url', 'search_web', 'click_element', 'download_from_page']);
  const visualTools = new Set(['take_screenshot', 'inspect_screenshot', 'compare_screenshot_to_goal', 'inspect_screenshot_with_model']);
  if (assetTools.has(toolName)) {
    const source = result.url || args.url || '';
    const path = result.path || result.destination || args.path || '';
    const licenseHint = result.license || result.licenseInfo || '';
    return {
      text: `Asset capability result: ${outcome.summary}${source ? ` Source: ${source}.` : ''}${path ? ` Path: ${path}.` : ''}${licenseHint ? ` License: ${licenseHint}.` : ''}`,
      category: 'asset_discovery',
      evidence: outcome.summary
    };
  }
  if (browserTools.has(toolName)) {
    const url = result.url || args.url || '';
    return {
      text: `Browser research result: ${result.title || outcome.summary}${url ? ` (${url})` : ''}`,
      category: 'web_discovery',
      evidence: outcome.summary
    };
  }
  if (visualTools.has(toolName)) {
    return {
      text: `Visual verification result: ${outcome.summary}`,
      category: 'visual_evidence',
      evidence: result.evidence || outcome.summary
    };
  }
  return null;
}

window.readOperationalContext = readOperationalContext;
window.mutateOperationalContext = mutateOperationalContext;

function getCompactionThreshold(modelName, config) {
  const budgets = config.modelContextBudgets || {};
  const modelBudget = Number(budgets[modelName] || budgets.default || config.compactThresholdTokens || 128000);
  const configuredThreshold = Number(config.compactThresholdTokens || 0);
  const modelAwareThreshold = Math.floor(modelBudget * 0.82);
  
  if (modelName && modelName.startsWith('gemini-2.5') && modelBudget >= 1000000) {
    return Math.max(configuredThreshold || 0, modelAwareThreshold);
  }
  
  if (configuredThreshold > 0) {
    return Math.min(configuredThreshold, modelAwareThreshold);
  }
  return modelAwareThreshold;
}

function persistCompactedConversation(conversation, summary) {
  const recentMessages = conversation.messages
    .filter(message => !(message.role === 'assistant' && message.text === 'Thinking...'))
    .slice(-8);
  conversation.messages = [
    {
      role: 'user',
      text: `[COMPACTED CONTEXT SUMMARY]\n${summary}`
    },
    {
      role: 'assistant',
      text: 'Understood. I will use this compacted summary as prior context.',
      logs: [],
      turns: []
    },
    ...recentMessages
  ];
  conversation.compactedAt = Date.now();
}

function scheduleAgentFollowup(args = {}) {
  const delaySeconds = Math.min(Math.max(Number(args.delaySeconds || 60), 1), 3600);
  const prompt = args.prompt || 'Continue the previous task. Check any long-running command or training progress, inspect output, fix issues if needed, and keep working until the task is complete.';
  const targetConversationId = (typeof activeConversationId !== 'undefined') ? activeConversationId : null;
  const modelSelectValue = window.getSelectedModel ? window.getSelectedModel() : undefined;
  const purpose = normalizeFollowupPurpose(args.purpose || prompt);
  const existingTimerId = Object.keys(window.followupTimerMeta || {}).find((id) => {
    const meta = window.followupTimerMeta[id];
    return meta && meta.conversationId === targetConversationId && meta.purpose === purpose;
  });

  if (existingTimerId && window.followupTimers[existingTimerId]) {
    clearTimeout(window.followupTimers[existingTimerId]);
    delete window.followupTimers[existingTimerId];
    delete window.followupTimerMeta[existingTimerId];
  }

  const timerId = 'followup_' + targetConversationId + '_' + Date.now();
  window.followupTimerMeta[timerId] = {
    conversationId: targetConversationId,
    purpose,
    prompt,
    scheduledAt: Date.now(),
    delaySeconds
  };
  
  window.followupTimers[timerId] = setTimeout(async () => {
    delete window.followupTimers[timerId];
    delete window.followupTimerMeta[timerId];
    
    if (window.isAgentRunning && window.isAgentRunning()) {
      const alreadyQueued = window.promptQueue && window.promptQueue.some(item =>
        item.conversationId === targetConversationId && item.prompt === prompt
      );
      if (!alreadyQueued) {
        window.promptQueue.push({ prompt, modelSelectValue, conversationId: targetConversationId, source: 'followup' });
      }
      return;
    }
    
    if (typeof conversations === 'undefined') return;
    const targetConv = conversations.find(c => c.id === targetConversationId);
    if (!targetConv) return;
    
    if (window.appendSystemMessage) {
      window.appendSystemMessage(`Scheduled follow-up running after ${delaySeconds} seconds.`, { conversationId: targetConversationId });
    }
    await window.runAgentLoop(
      prompt,
      modelSelectValue || (window.getSelectedModel ? window.getSelectedModel() : 'gemini-2.5-flash-lite'),
      targetConv,
      { source: 'followup', internalPrompt: true }
    );
  }, delaySeconds * 1000);
  
  return {
    success: true,
    timerId,
    delaySeconds,
    replacedExisting: !!existingTimerId,
    message: `Scheduled follow-up in ${delaySeconds} seconds.`
  };
}

function cancelFollowupsForConversation(conversationId) {
  if (!conversationId || !window.followupTimerMeta) return 0;
  let cancelled = 0;
  Object.keys(window.followupTimerMeta).forEach((timerId) => {
    const meta = window.followupTimerMeta[timerId];
    if (meta && meta.conversationId === conversationId) {
      if (window.followupTimers[timerId]) {
        clearTimeout(window.followupTimers[timerId]);
        delete window.followupTimers[timerId];
      }
      delete window.followupTimerMeta[timerId];
      cancelled++;
    }
  });
  return cancelled;
}

function normalizeFollowupPurpose(value) {
  const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return 'general-followup';
  if (/(training|train\.py|training_log|score|record|agent progress)/.test(text)) return 'training-progress';
  if (/(test|pytest|unittest|regression|spec|suite)/.test(text)) return 'test-progress';
  if (/(server|localhost|dev server|npm run dev|web app)/.test(text)) return 'server-progress';
  if (/(quota|429|rate|retry)/.test(text)) return 'quota-retry';
  return text.slice(0, 160);
}

function buildToolUseContractPrompt() {
  return `[SYSTEM: Before answering, decide whether the user's request requires interacting with the workspace or runtime. If it requires files, commands, tests, external docs, app state, timers, notes, or code changes, use the relevant tools before giving a final answer. Questions about this computer's performance, specs, RAM, CPU, disk, processes, or local environment require local inspection with tools unless fresh evidence is already present. If no tool is needed, answer normally and do not claim that work was performed. Never end with a generic completion message unless the Work Walkthrough shows what actually happened. Remember, for complex tasks, your final summary must explicitly list what planned tests were run, their results, and reasons for any skipped tests.

CRITICAL: If a planning gate blocks a tool call, do NOT paste planning documents (STRATEGY.md content, implementation plan phases, testing plan sections) into your chat response. Instead write one short sentence explaining what is blocking you and ask the user to clarify or rephrase. Planning document prose must only ever go into files — never into the chat bubble.]`;
}

const STRATEGY_FILE_NAME = 'strategy.md';
const IMPLEMENTATION_PLAN_FILE_NAME = 'implementation_plan.md';
const STRATEGY_REQUIRED_SECTIONS = [
  'Objective',
  'Relevant Files'
];

function basenameLower(pathValue) {
  return String(pathValue || '').split(/[\\/]/).pop().toLowerCase();
}

function isImplementationPlanPath(pathValue) {
  return basenameLower(pathValue) === IMPLEMENTATION_PLAN_FILE_NAME;
}

function isStrategyPath(pathValue) {
  return basenameLower(pathValue) === STRATEGY_FILE_NAME;
}

function normalizeHeadingText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasRequiredStrategySections(content) {
  const text = String(content || '');
  if (!text.trim()) return false;
  const headings = new Set();
  const headingRegex = /^#{1,4}\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(text))) {
    headings.add(normalizeHeadingText(match[1]));
  }
  return STRATEGY_REQUIRED_SECTIONS.every(section => headings.has(normalizeHeadingText(section)));
}

function extractMarkdownSection(content, heading) {
  const text = String(content || '');
  const normalizedHeading = normalizeHeadingText(heading);
  const headingRegex = /^(#{1,4})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(text))) {
    if (normalizeHeadingText(match[2]) !== normalizedHeading) continue;
    const start = headingRegex.lastIndex;
    const currentDepth = match[1].length;
    let end = text.length;
    let next;
    while ((next = headingRegex.exec(text))) {
      if (next[1].length <= currentDepth) {
        end = next.index;
        break;
      }
    }
    return text.slice(start, end).trim();
  }
  return '';
}

function strategyRequiresClarification(content) {
  const section = extractMarkdownSection(content, 'Clarifying Questions, if needed');
  if (!section) return false;
  const normalized = section.toLowerCase();
  if (/^\s*(none|n\/a|no critical questions|no mission-critical ambiguity)\s*[\.\-]*\s*$/i.test(section)) return false;
  return /\b(mission[-\s]?critical|critical ambiguity|must ask|cannot proceed|blocked until|requires user|needs user clarification)\b/i.test(normalized) ||
    /^\s*[-*]\s*\[(critical|blocker|mission-critical)\]/im.test(section);
}

function validateStrategyContent(content) {
  const missingSections = STRATEGY_REQUIRED_SECTIONS.filter(section => {
    const headings = [];
    const headingRegex = /^#{1,4}\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(String(content || '')))) headings.push(normalizeHeadingText(match[1]));
    return !headings.includes(normalizeHeadingText(section));
  });
  const valid = missingSections.length === 0;
  return {
    valid,
    missingSections,
    needsClarification: valid && strategyRequiresClarification(content)
  };
}

async function readStrategyStatus(workspacePath) {
  try {
    if (!window.api || typeof window.api.readFile !== 'function') {
      return { exists: false, valid: false, missingSections: STRATEGY_REQUIRED_SECTIONS, needsClarification: false, content: '' };
    }
    const result = await window.api.readFile(workspacePath, 'STRATEGY.md', { maxChars: 120000 });
    const content = typeof result === 'string'
      ? result
      : (result && !result.error && typeof result.content === 'string' ? result.content : '');
    if (!content) return { exists: false, valid: false, missingSections: STRATEGY_REQUIRED_SECTIONS, needsClarification: false, content: '' };
    return { exists: true, content, ...validateStrategyContent(content) };
  } catch (err) {
    return { exists: false, valid: false, missingSections: STRATEGY_REQUIRED_SECTIONS, needsClarification: false, content: '', error: err.message };
  }
}

function buildRefinementPrompt(strategyStatus = {}) {
  const statusLine = strategyStatus.exists
    ? (strategyStatus.valid ? 'A STRATEGY.md exists and has the required sections.' : `A STRATEGY.md exists but is invalid or incomplete. Missing sections: ${(strategyStatus.missingSections || []).join(', ') || 'unknown'}.`)
    : 'No valid STRATEGY.md exists yet.';
  return `[SYSTEM: Mission Refinement / Strategy Pass is mandatory before implementation planning for this complex task.
${statusLine}

Architecture: Refine → Plan → Act → Verify → Update State.

During refinement, you may inspect/read/search and update operational context, but you must not edit source files, run destructive commands, create implementation_plan.md, mark tasks complete, or claim completion.

Required first inspections for project/workspace tasks:
1. get_workspace_info
2. read_operational_context
3. read_notes
4. list_files

Then inspect obvious grounding files when present: README, package.json, pyproject.toml, requirements.txt, main entry files, test config/test folders, and existing implementation_plan.md.

Before writing implementation_plan.md, write STRATEGY.md with these exact sections:
${STRATEGY_REQUIRED_SECTIONS.map(section => `- ${section}`).join('\n')}

If STRATEGY.md finds mission-critical ambiguity, ask the user before planning. If ambiguity is minor, record the assumption in STRATEGY.md and operational context, then proceed. Base implementation_plan.md on STRATEGY.md, not just the raw user prompt. Do not add agent roles, automatic replanning, or domain-specific workflows.]`;
}

function getPlanningToolGate(config, canExecute, toolName, args = {}, options = {}) {
  if (!config || !config.planningMode || canExecute) {
    return { allowed: true, forceYield: false, reason: '' };
  }
  const destructiveTools = ['write_file', 'modify_file', 'patch_file', 'start_command', 'run_tests', 'sync_workspace_env', 'launch_workspace_app', 'git_push', 'download_file', 'download_from_page', 'extract_archive', 'take_screenshot'];
  const completionTools = ['complete_subplan', 'evaluate_win_conditions'];
  const strategyRequired = options.strategyRequired !== false;
  const strategyStatus = options.strategyStatus || {};
  const executionMode = options.agentExecutionMode || '';
  // Allow completion tools for read-only/answer tasks — no plan approval needed to close them
  if (completionTools.includes(toolName) && executionMode !== 'answer' && executionMode !== 'direct') {
    return {
      allowed: false,
      forceYield: false,
      reason: 'Refinement/Planning Mode Active: do not mark tasks, subplans, or win conditions complete before strategy, plan approval, execution, and evidence.'
    };
  }
  if (completionTools.includes(toolName)) {
    return { allowed: true, forceYield: false, reason: '' };
  }
  if (!destructiveTools.includes(toolName)) {
    return { allowed: true, forceYield: false, reason: '' };
  }
  const isStrategyWrite = toolName === 'write_file' && isStrategyPath(args.path);
  if (strategyRequired && isStrategyWrite) {
    return { allowed: true, forceYield: false, reason: 'Writing STRATEGY.md is allowed during refinement.' };
  }
  const isPlanWrite = toolName === 'write_file' && isImplementationPlanPath(args.path);
  if (isPlanWrite) {
    if (strategyRequired && !strategyStatus.valid) {
      return {
        allowed: false,
        forceYield: false,
        reason: `Refinement required: create a valid STRATEGY.md before implementation_plan.md. STRATEGY.md must include: ${STRATEGY_REQUIRED_SECTIONS.join(', ')}.`
      };
    }
    if (strategyRequired && strategyStatus.needsClarification) {
      return {
        allowed: false,
        forceYield: false,
        reason: 'Clarification required: STRATEGY.md identifies mission-critical ambiguity. Ask the user before creating implementation_plan.md.'
      };
    }
    return { allowed: true, forceYield: true, reason: 'Writing implementation_plan.md is allowed before approval.' };
  }
  return {
    allowed: false,
    forceYield: false,
    reason: "Refinement/Planning Mode Active: this request needs a grounded STRATEGY.md before implementation_plan.md, and an approved implementation plan before file edits or command execution. Inspect the workspace first, write STRATEGY.md, then create implementation_plan.md and pause for approval."
  };
}

function summarizeToolStart(toolName, args = {}) {
  if (toolName === 'read_file') return { toolName, status: 'running', label: `Read \`${args.path || 'file'}\`` };
  if (toolName === 'list_files') return { toolName, status: 'running', label: 'Listed workspace files' };
  if (toolName === 'get_workspace_info') return { toolName, status: 'running', label: 'Checked active workspace directory' };
  if (toolName === 'open_workspace_folder') return { toolName, status: 'running', label: 'Opened workspace folder' };
  if (toolName === 'launch_workspace_app') return { toolName, status: 'running', label: 'Launched workspace app' };
  if (toolName === 'set_workspace_entrypoint') return { toolName, status: 'running', label: args.command ? `Set entry point to \`${args.command}\`` : 'Cleared workspace entry point' };
  if (toolName === 'git_push') return { toolName, kind: 'git', status: 'running', label: `Pushed Git branch${args.branch ? ` to \`${args.branch}\`` : ''}` };
  if (toolName === 'download_file') return { toolName, kind: 'asset', status: 'running', label: `Downloaded asset from \`${args.url || 'URL'}\`` };
  if (toolName === 'inspect_archive') return { toolName, kind: 'asset', status: 'running', label: `Inspected archive \`${args.path || 'archive'}\`` };
  if (toolName === 'extract_archive') return { toolName, kind: 'asset', status: 'running', label: `Extracted archive \`${args.path || 'archive'}\`` };
  if (toolName === 'inspect_binary_asset') return { toolName, kind: 'asset', status: 'running', label: `Inspected asset \`${args.path || 'asset'}\`` };
  if (toolName === 'list_asset_metadata') return { toolName, kind: 'asset', status: 'running', label: `Listed asset metadata${args.path ? ` under \`${args.path}\`` : ''}` };
  if (toolName === 'open_url') return { toolName, kind: 'browser', status: 'running', label: `Opened URL \`${args.url || ''}\`` };
  if (toolName === 'search_web') return { toolName, kind: 'browser', status: 'running', label: `Searched web for \`${args.query || ''}\`` };
  if (toolName === 'click_element') return { toolName, kind: 'browser', status: 'running', label: `Clicked page element${args.selector ? ` \`${args.selector}\`` : ''}` };
  if (toolName === 'fill_input') return { toolName, kind: 'browser', status: 'running', label: `Filled input \`${args.selector || 'input'}\`` };
  if (toolName === 'navigate_back') return { toolName, kind: 'browser', status: 'running', label: 'Navigated browser back' };
  if (toolName === 'download_from_page') return { toolName, kind: 'asset', status: 'running', label: 'Downloaded asset from current page' };
  if (toolName === 'wait_for_page') return { toolName, kind: 'browser', status: 'running', label: 'Waited for page' };
  if (toolName === 'take_screenshot') return { toolName, kind: 'visual', status: 'running', label: 'Captured browser screenshot' };
  if (toolName === 'inspect_screenshot') return { toolName, kind: 'visual', status: 'running', label: `Inspected screenshot \`${args.path || 'screenshot'}\`` };
  if (toolName === 'compare_screenshot_to_goal') return { toolName, kind: 'visual', status: 'running', label: `Compared screenshot to goal` };
  if (toolName === 'inspect_screenshot_with_model') return { toolName, kind: 'visual', status: 'running', label: `Inspected screenshot with Gemini vision` };
  if (toolName === 'write_file') {
    const isPlan = args.path && isImplementationPlanPath(args.path);
    const isStrategy = args.path && isStrategyPath(args.path);
    return {
      toolName,
      kind: isPlan ? 'plan' : (isStrategy ? 'strategy' : 'file'),
      status: 'running',
      path: args.path,
      content: isPlan ? String(args.content || '') : '',
      label: isPlan ? 'Created implementation plan' : (isStrategy ? 'Created mission strategy' : `Write \`${args.path || 'file'}\``)
    };
  }
  if (toolName === 'modify_file' || toolName === 'patch_file') {
    return { toolName, kind: 'file', status: 'running', path: args.path, label: `Updated \`${args.path || 'file'}\`` };
  }
  if (toolName === 'run_command' || toolName === 'start_command') {
    return { toolName, kind: 'command', status: 'running', command: args.command, label: `${toolName === 'start_command' ? 'Started' : 'Ran'} \`${args.command || 'command'}\`` };
  }
  if (toolName === 'run_tests') return { toolName, kind: 'test', status: 'running', label: 'Ran regression tests' };
  if (toolName === 'set_task_checklist') {
    const count = Array.isArray(args.tasks) ? args.tasks.length : 0;
    return { toolName, kind: 'checklist', status: 'running', label: `Requested checklist update${count ? ` (${count} items)` : ''}` };
  }
  if (toolName === 'schedule_followup') return { toolName, kind: 'followup', status: 'running', label: `Scheduled follow-up in ${args.delaySeconds || 60}s` };
  if (toolName === 'sync_workspace_env') return { toolName, kind: 'env', status: 'running', label: 'Synced workspace environment secrets' };
  if (toolName === 'google_search') return { toolName, kind: 'research', status: 'running', label: `Searched Google for "${args.query || ''}"` };
  if (toolName === 'fetch_web_page') return { toolName, kind: 'research', status: 'running', label: `Fetched docs page ${args.url || ''}` };
  return { toolName, status: 'running', label: `Used \`${toolName}\`` };
}

function updateWalkthroughItem(item, toolName, args, result, error) {
  if (!item) return;
  item.status = (error || isFailedToolResult(result)) ? 'error' : 'done';
  if (error) {
    item.detail = error.message;
    return;
  }
  if (toolName === 'write_file' || toolName === 'modify_file' || toolName === 'patch_file') {
    item.detail = result && result.backupPath ? `Backup: \`${result.backupPath}\`` : '';
  } else if (toolName === 'set_task_checklist') {
    item.detail = result && result.skipped ? result.message : '';
  } else if (toolName === 'get_workspace_info') {
    item.detail = result && result.workspace ? `Directory: \`${result.workspace}\`` : '';
  } else if (toolName === 'launch_workspace_app') {
    item.detail = result && result.message ? result.message : '';
  } else if (toolName === 'set_workspace_entrypoint') {
    item.detail = result && result.message ? result.message : '';
  } else if (toolName === 'open_workspace_folder') {
    item.detail = result && result.path ? `Opened \`${result.path}\`` : '';
  } else if (toolName === 'git_push') {
    item.detail = result && result.command ? result.command : '';
  } else if (toolName === 'run_command') {
    const timedOut = result && result.timedOut ? ', timed out' : '';
    const killed = result && result.killed ? ', stopped' : '';
    const timeout = result && result.timeoutMs ? `, timeout: ${result.timeoutMs}ms` : '';
    item.detail = `Exit: ${result && result.exitCode !== undefined ? result.exitCode : 'unknown'}${timedOut}${killed}${timeout}`;
  } else if (toolName === 'start_command') {
    item.detail = result && result.id ? `Session: \`${result.id}\`, timeout: ${result.timeoutMs || 'default'}ms` : '';
  } else if (toolName === 'run_tests') {
    item.detail = result && result.success ? 'Passed' : 'Failed or unavailable';
  } else if (toolName === 'schedule_followup') {
    item.detail = result && result.replacedExisting ? 'Replaced an existing related timer' : '';
  } else if (result && result.summary && (
    toolName === 'download_file' || toolName === 'inspect_archive' || toolName === 'extract_archive' ||
    toolName === 'inspect_binary_asset' || toolName === 'list_asset_metadata' ||
    toolName === 'take_screenshot' || toolName === 'inspect_screenshot' || toolName === 'compare_screenshot_to_goal' || toolName === 'inspect_screenshot_with_model'
  )) {
    item.detail = result.summary;
  } else if (result && result.title && (toolName === 'open_url' || toolName === 'search_web' || toolName === 'click_element' || toolName === 'fill_input' || toolName === 'navigate_back' || toolName === 'wait_for_page')) {
    item.detail = `Page: ${result.title}`;
  }
}

function withWorkWalkthrough(text, items, final = false) {
  const meaningfulItems = (items || []).filter(Boolean);
  if (meaningfulItems.length === 0) return text;
  const base = sanitizeFinalAnswerText(text);
  if (final) {
    // Walkthrough is saved to work_walkthrough.md — keep the chat bubble clean
    return base.trim() || 'Task finished.';
  }
  const lines = meaningfulItems.slice(-12).map(item => {
    const marker = item.status === 'error' ? 'Failed' : (item.status === 'running' ? 'Working' : 'Done');
    const detail = item.detail ? ` - ${item.detail}` : '';
    return `- **${marker}:** ${item.label}${detail}`;
  });
  return `${base.trim() || 'Working on it.'}\n\n## Work Walkthrough\n${lines.join('\n')}\n\n_I will keep this updated as I work._`;
}

function buildWorkWalkthroughMarkdown(items, finalText) {
  const lines = (items || []).filter(Boolean).map(item => {
    const marker = item.status === 'error' ? '❌ Failed' : (item.status === 'running' ? '⏳ Working' : '✅ Done');
    const detail = item.detail ? ` — ${item.detail}` : '';
    return `- **${marker}:** ${item.label}${detail}`;
  });
  const summary = buildFinalVerificationSummary((items || []).filter(Boolean));
  return `# Work Walkthrough\n\n${lines.join('\n')}${summary || ''}`;
}

function isFileMutationItem(item) {
  return !!(item && item.kind === 'file' && item.path && item.status === 'done');
}

function isPlanMutationItem(item) {
  return !!(item && item.kind === 'plan');
}

function isRealVerificationCommand(command) {
  const text = String(command || '').toLowerCase().trim();
  if (!text) return false;
  if (/^(mkdir|md|new-item|copy|cp|move|mv|ren|rename|dir|ls|get-childitem)\b/.test(text)) return false;
  return /\b(pytest|unittest|python\s+-m\s+py_compile|python\s+-m\s+compileall|npm\s+test|npm\s+run\s+(test|build|lint|typecheck)|pnpm\s+(test|build|lint|typecheck)|yarn\s+(test|build|lint|typecheck)|node\s+--check|node\s+[\w./\\-]*test[\w./\\-]*\.js|tsc\b|eslint\b|ruff\b|mypy\b|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|smoke|--smoke-test|playwright|vitest|jest|tap|tape)\b/.test(text);
}

async function findMissingHtmlLocalReferences(workspace, htmlPath, htmlContent) {
  if (!/\.html?$/i.test(String(htmlPath || ''))) return [];
  const text = String(htmlContent || '');
  const refs = [];
  const attrRegex = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRegex.exec(text))) {
    const ref = String(match[1] || '').trim();
    if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
    if (/^(data:|mailto:|tel:|javascript:)/i.test(ref)) continue;
    const cleanRef = ref.split(/[?#]/)[0].replace(/^[\\/]+/, '');
    if (!cleanRef) continue;
    refs.push(cleanRef);
  }

  const baseDir = String(htmlPath || '').split(/[\\/]/).slice(0, -1).join('/');
  const missing = [];
  for (const ref of [...new Set(refs)]) {
    const candidate = baseDir ? `${baseDir}/${ref}` : ref;
    try {
      const result = await window.api.readFile(workspace, candidate, { maxChars: 1 });
      if (!result || result.error) missing.push(ref);
    } catch (err) {
      missing.push(ref);
    }
  }
  return missing;
}

function isVerificationItem(item) {
  if (!item) return false;
  if (item.toolName === 'run_tests' || item.kind === 'test') return true;
  if (item.toolName === 'run_command') return isRealVerificationCommand(item.command);
  if (item.toolName === 'start_command') return isRealVerificationCommand(item.command);
  return false;
}

function hasVerificationAfterLastFileEdit(items) {
  const list = Array.isArray(items) ? items : [];
  const lastEditIndex = list.findLastIndex(item => isFileMutationItem(item));
  if (lastEditIndex === -1) return true;
  return list.slice(lastEditIndex + 1).some(item => isVerificationItem(item));
}

function hasReadAfterLastFileEdit(items) {
  const list = Array.isArray(items) ? items : [];
  const lastEditIndex = list.findLastIndex(item => isFileMutationItem(item));
  if (lastEditIndex === -1) return true;
  return list.slice(lastEditIndex + 1).some(item => item && item.toolName === 'read_file');
}

function buildPostEditEvidencePrompt(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!options.canExecute) return '';
  if ((options.promptCount || 0) >= (options.maxPrompts || 2)) return '';
  const filesTouched = [...new Set(list.filter(isFileMutationItem).map(item => item.path))];
  if (!filesTouched.length) return '';
  const missingRead = !hasReadAfterLastFileEdit(list);
  const missingVerification = !hasVerificationAfterLastFileEdit(list);
  if (!missingRead && !missingVerification) return '';

  const fileList = filesTouched.map(path => `\`${path}\``).join(', ');
  return `[SYSTEM: Post-edit evidence gate. You changed source files (${fileList}) but have not yet produced enough evidence to finish.

Before giving a final answer:
- Re-read the touched source files or the relevant changed sections to reconcile the actual code against the task and approved plan.
- Run at least one real verification check after the edits. Use the project regression command when available. For Python/Pygame/interactive apps, prefer \`python -m py_compile <file>\` plus a bounded smoke check such as a \`--smoke-test\` flag or short timeout. Commands that only create folders, list files, or move assets do not count as verification.
- If a check cannot run, inspect the blocker and state the exact reason in the final summary.
- If the evidence reveals a bug or mismatch, fix it and rerun the relevant check.

Call the necessary tools now. Do not finish with a generic summary.]`;
}

function buildFinalVerificationSummary(items) {
  const filesTouched = [...new Set(items.filter(isFileMutationItem).map(item => item.path))];
  const testsRun = items.filter(isVerificationItem).map(item => item.label);
  const nonVerificationCommands = items
    .filter(item => item && (item.toolName === 'run_command' || item.toolName === 'start_command') && !isVerificationItem(item))
    .map(item => item.label);
  const failures = items.filter(item => item.status === 'error');
  const planItems = items.filter(item => item.kind === 'plan');
  const hasPlan = planItems.length > 0;
  const changedSourceFiles = filesTouched.filter(path => !/implementation_plan\.md$/i.test(path));
  const verificationGap = changedSourceFiles.length > 0 && !hasVerificationAfterLastFileEdit(items);
  const needsPreSubmitSummary = filesTouched.length > 0 || testsRun.length > 0 || failures.length > 0 || hasPlan || verificationGap;
  if (!needsPreSubmitSummary) return '';

  const lines = ['\n\n## Final Pre-Submit Summary'];
  lines.push(`- **Files touched:** ${filesTouched.length ? filesTouched.map(path => `\`${path}\``).join(', ') : 'None recorded'}`);
  if (hasPlan) {
    lines.push(`- **Planned Tests Executed:** ${testsRun.length ? testsRun.join('; ') : 'None recorded'}`);
    lines.push(`- **Failures/Skipped Tests:** ${failures.length ? failures.map(item => item.label).join('; ') : 'None recorded. Note: Any planned tests not run must be justified.'}`);
  } else {
    lines.push(`- **Tests/checks run:** ${testsRun.length ? testsRun.join('; ') : 'None recorded'}`);
    lines.push(`- **Failures/skipped checks:** ${failures.length ? failures.map(item => item.label).join('; ') : 'None recorded'}`);
  }
  if (verificationGap) {
    lines.push('- **Verification gap:** Source files changed after the last real verification check. Treat this run as incomplete until a real smoke/regression check is run.');
  }
  if (nonVerificationCommands.length && !testsRun.length) {
    lines.push(`- **Non-verification commands:** ${nonVerificationCommands.join('; ')}. These do not prove the code works.`);
  }
  lines.push('- **How to verify:** Review the files above and rerun the listed tests/checks.');
  return lines.join('\n');
}

function buildRunArtifactPayload({ conversation, userPrompt, modelName, workspacePath, workWalkthrough, finalText }) {
  const filesTouched = [...new Set((workWalkthrough || []).filter(isFileMutationItem).map(item => item.path))];
  return {
    conversationId: conversation.id,
    runId: `run-${Date.now()}`,
    type: 'orion-run',
    task: {
      prompt: userPrompt,
      model: modelName,
      workspace: workspacePath
    },
    implementation: {
      filesTouched,
      walkthrough: workWalkthrough
    },
    walkthrough: {
      finalText
    }
  };
}

function stripWorkWalkthrough(text) {
  let cleaned = String(text || '');
  for (const marker of ['\n\n## Work Walkthrough', '\n\n## Final Pre-Submit Summary']) {
    const index = cleaned.indexOf(marker);
    if (index !== -1) cleaned = cleaned.slice(0, index);
  }
  return cleaned;
}

function stripEchoedSystemScaffold(text) {
  let cleaned = String(text || '');
  cleaned = cleaned.replace(/^\s*\[SYSTEM:\s*(?:Work Walkthrough|Final Pre-Submit Summary|Before answering|Planning Mode|Mission Refinement|Refinement\/Planning Mode|Post-edit evidence gate|The operational completion gate)[\s\S]*?\]\s*/i, '');
  cleaned = cleaned.replace(/\n\s*\[SYSTEM:\s*(?:Work Walkthrough|Final Pre-Submit Summary|Before answering|Planning Mode|Mission Refinement|Refinement\/Planning Mode|Post-edit evidence gate|The operational completion gate)[\s\S]*?\]\s*/gi, '\n');
  return cleaned;
}

function sanitizeFinalAnswerText(text) {
  return stripEchoedSystemScaffold(stripWorkWalkthrough(String(text || '')))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function requestNeedsActionableFinalAnswer(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (!text.trim()) return false;
  const actionPatterns = [
    /\bhow\s+(?:do|can|would|should)\s+(?:we|you|i)\s+(?:improve|fix|build|make|add|repair|change|handle|solve)\b/,
    /\bwhat\s+(?:can|should|would)\s+(?:we|you|i)\s+(?:improve|fix|build|make|add|change|do)\b/,
    /\b(?:recommend|recommendation|recommendations|next\s+patch|next\s+action|next\s+step|plan|roadmap)\b/,
    /\b(?:why\s+did\s+it\s+stop|how\s+do\s+we\s+fix|what\s+was\s+wrong|what\s+went\s+wrong)\b/,
    /\b(?:bugs?|errors?|issues?)\b.*\b(?:fix|improve|recommend|look\s+through|find|what)\b/
  ];
  return actionPatterns.some(pattern => pattern.test(text));
}

function answerHasActionableFinalContent(answerText) {
  const text = sanitizeFinalAnswerText(answerText);
  const lower = text.toLowerCase();
  if (isGenericNonAnswer(text)) return false;
  if (lower.length < 80) return false;
  const actionLine = /^\s*(?:[-*]|\d+\.)\s+(?:make|add|fix|improve|build|change|update|remove|run|test|verify|use|create|implement|patch|prioritize|separate|preserve|launch|rebuild|retry)\b/im;
  const actionHeading = /^#{1,4}\s*(?:findings|recommendations|plan|changes|next steps|fixes|what i found|what to fix)\b/im;
  const actionSentence = /\b(?:the best improvements are|i recommend|i would fix|we should|next patch should|the fix is|i changed|i fixed|i added|i updated|next action is)\b/i;
  const concreteCodeReference = /\b(?:file|function|test|setting|model|ui|api|state|server|launch|verification)\b/i;
  if (actionLine.test(text) || actionHeading.test(text) || actionSentence.test(text)) return true;
  return /\b(?:fix|improve|add|update|change|implement|test|verify|recommend|prioritize)\b/i.test(text) && concreteCodeReference.test(text);
}

function buildFinalAnswerQualityGatePrompt(userPrompt, answerText, workWalkthrough = []) {
  if (!requestNeedsActionableFinalAnswer(userPrompt)) return '';
  if (answerHasActionableFinalContent(answerText)) return '';
  const inspected = (workWalkthrough || []).some(item => item && item.status !== 'error');
  const inspectionNote = inspected
    ? 'You inspected context, but inspection alone is not completion.'
    : 'You have not produced the actual answer yet.';
  return `[SYSTEM: Final-response quality gate. The user asked for improvements, fixes, recommendations, a plan, or a next action. ${inspectionNote}

Before final response, answer the user's actual question with at least one concrete recommendation, fix plan, implemented change summary, or next action. Do not stop at phrases like "Ah, the path is..." or a file-inspection summary. If more evidence is needed, call the necessary tools now; otherwise produce a direct, actionable answer now.]`;
}

function buildPlanApprovalMessage(planItem, fallbackText) {
  const planContent = planItem && planItem.content ? formatPlanContentForChat(planItem.content) : '';
  const intro = 'I created [`implementation_plan.md`](orion-file:implementation_plan.md) and paused for review. The plan is shown below; approve it when you want me to start, or tell me what to change.';
  if (!planContent) return intro;
  return `${intro}\n\n## Implementation Plan\n\n${planContent}`;
}

function formatPlanContentForChat(content) {
  const text = String(content || '').trim();
  if (!text) return '';
  const maxChars = 24000;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n_The plan continues in [implementation_plan.md](orion-file:implementation_plan.md). I showed the first ${maxChars.toLocaleString()} characters here._`;
}

function hasRequiredTestingPlanSection(content) {
  return /^#{2,3}\s+.*?(testing plan|test plan|validation plan)\b/im.test(String(content || ''));
}

function hasAnyChecklist(conversation) {
  return !!(conversation && Array.isArray(conversation.tasks) && conversation.tasks.length > 0);
}

async function classifyPlanApprovalIntent(userPrompt, modelName, apiKey) {
  const fallback = { intent: 'unclear', reason: 'Could not classify plan approval intent.' };
  const prompt = `Classify the user's latest message about a pending implementation plan.

Return only compact JSON with:
{"intent":"approve"|"deny"|"revise"|"unclear","reason":"short reason"}

Definitions:
- approve: the user clearly wants execution of the existing pending plan to begin.
- deny: the user clearly rejects, cancels, or stops the pending plan.
- revise: the user asks for more review, a different plan, changes, additions, or clarification before execution.
- unclear: the user intent is ambiguous.

User message:
${JSON.stringify(String(userPrompt || ''))}`;

  try {
    if (modelName && !modelName.startsWith('gemini-')) {
      return fallback;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName || 'gemini-2.5-flash-lite'}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json'
        }
      })
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text || '{}');
    const intent = ['approve', 'deny', 'revise', 'unclear'].includes(parsed.intent) ? parsed.intent : 'unclear';
    return { intent, reason: String(parsed.reason || '') };
  } catch (e) {
    console.error('Plan approval classifier failed:', e);
    return fallback;
  }
}

async function classifyPlanningNeed(userPrompt, modelName, apiKey) {
  const fallback = { mode: 'plan', reason: 'Could not safely classify task complexity.' };
  const prompt = `Classify whether this Orion AI request should require an implementation plan before acting.

Return only compact JSON with:
{"mode":"plan"|"direct"|"answer","reason":"short reason"}

Definitions:
- plan: broad or complex work where the user should review direction first, such as creating a substantial new project, major redesign/refactor, large bug hunt, architecture change, risky migration, security-sensitive change, or ambiguous multi-step coding task.
- direct: concrete low-risk work that should be executed immediately, such as running/opening a program, running tests, showing a directory, setting an entry point, pushing to Git when explicitly requested, viewing a file, making a narrow edit, fixing a small bug, continuing an already-approved task, OR reading/inspecting local files to answer a question about them.
- answer: a question or explanation that can be answered in chat without workspace changes or command execution.

Decision guidance:
- Prefer direct for read-only local inspection or inventory tasks, including listing installed runtimes, checking versions, checking PATH, finding executables, showing files, or running safe diagnostic commands.
- Prefer direct for any request to describe, explain, summarize, or understand a local program, project, or file — even if multiple files must be read. Reading files is not risky.
- Prefer direct for a small number of safe commands that gather facts, even if the answer has several sections.
- Prefer plan only when the task requires a coordinated implementation, risky changes, many file edits, architecture/design choices, migrations, security-sensitive changes, or user review before modifying the workspace.
- Prefer answer when no local tools or workspace actions are needed at all.
- NEVER return plan for a read-only question about what a local program/project/file does or contains.
- NEVER return plan for a code review, bug hunt, typo check, or analysis of a local project — these are read-only inspection tasks.

Examples:
- "what python environments do i have installed on this computer" -> direct
- "where is python installed and which one is first on PATH" -> direct
- "run the tests" -> direct
- "what is this program about" -> direct
- "can you tell me what llm-call does" -> direct
- "tell me about the project in my Desktop/projects folder" -> direct
- "what does this file do" -> direct
- "look through my program and find any bugs" -> direct
- "can you find typos and structural faults in my project" -> direct
- "review my code for issues" -> direct
- "audit this codebase for security problems" -> direct
- "explain how PATH works on Windows" -> answer
- "build me a Python desktop app" -> plan
- "refactor the authentication flow" -> plan

Be practical and avoid ceremony. Decide from task complexity and risk, not from whether the response may need multiple bullet points.

User message:
${JSON.stringify(String(userPrompt || ''))}`;

  try {
    if (modelName && !modelName.startsWith('gemini-')) {
      return fallback;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName || 'gemini-2.5-flash-lite'}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json'
        }
      })
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text || '{}');
    const mode = ['plan', 'direct', 'answer'].includes(parsed.mode) ? parsed.mode : 'plan';
    return { mode, reason: String(parsed.reason || '') };
  } catch (e) {
    console.error('Planning need classifier failed:', e);
    return fallback;
  }
}

function tokenizeIntentText(value) {
  const tokens = [];
  let current = '';
  const input = String(value || '').toLowerCase();
  for (const char of input) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLetter = code >= 97 && code <= 122;
    if (isDigit || isLetter) {
      current += char;
    } else if (current) {
      tokens.push(current);
      current = '';
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function hasAnyToken(tokenSet, values) {
  return values.some(value => tokenSet.has(value));
}

function classifySimpleTask(userPrompt) {
  const tokens = tokenizeIntentText(userPrompt);
  const tokenSet = new Set(tokens);
  if (tokens.length === 0) return null;

  const localSubject = hasAnyToken(tokenSet, ['my', 'this', 'computer', 'pc', 'machine', 'system', 'laptop', 'windows']);
  const memorySubject = hasAnyToken(tokenSet, ['ram', 'memory']);
  const askingAmount = hasAnyToken(tokenSet, ['how', 'much', 'many', 'total', 'have', 'left', 'free', 'available']);

  if (localSubject && memorySubject && askingAmount) {
    return {
      route: 'local_memory',
      mode: 'direct',
      reason: 'Simple local system memory question; answer from local command evidence without model planning.'
    };
  }

  // Read-only "what is X about / what does X do" questions targeting local projects
  const describeVerbs = hasAnyToken(tokenSet, ['what', 'tell', 'describe', 'explain', 'summarize', 'show', 'about']);
  const describeNouns = hasAnyToken(tokenSet, ['program', 'project', 'app', 'application', 'file', 'folder', 'code', 'script', 'tool', 'repo', 'repository']);
  const localRef = hasAnyToken(tokenSet, ['my', 'this', 'the', 'desktop', 'projects', 'folder']);
  if (describeVerbs && (describeNouns || localRef)) {
    return {
      route: 'local_project_describe',
      mode: 'direct',
      reason: 'Read-only question about a local program or project; read files and answer without planning gates.'
    };
  }

  // Code review / bug hunt on a local project — read-only analysis, no plan approval needed
  const reviewVerbs = hasAnyToken(tokenSet, ['find', 'look', 'check', 'review', 'audit', 'scan', 'analyze', 'analyse', 'search', 'identify', 'spot', 'detect']);
  const reviewTargets = hasAnyToken(tokenSet, ['bug', 'bugs', 'typo', 'typos', 'error', 'errors', 'issue', 'issues', 'fault', 'faults', 'problem', 'problems', 'smell', 'smells', 'vulnerability', 'vulnerabilities']);
  if (reviewVerbs && reviewTargets && (describeNouns || localRef)) {
    return {
      route: 'local_project_review',
      mode: 'direct',
      reason: 'Read-only code review or bug hunt on a local project; inspect files and report findings without planning gates.'
    };
  }

  return null;
}

function parseKeyValueOutput(output) {
  const result = {};
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const index = rawLine.indexOf('=');
    if (index === -1) continue;
    const key = rawLine.slice(0, index).trim();
    const value = rawLine.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function formatGibFromKb(kb) {
  const value = Number(kb);
  if (!Number.isFinite(value) || value <= 0) return '';
  return (value / 1024 / 1024).toFixed(2);
}

function buildLocalMemoryAnswer(stdout) {
  const values = parseKeyValueOutput(stdout);
  const totalGb = formatGibFromKb(values.TotalVisibleMemorySize);
  const freeGb = formatGibFromKb(values.FreePhysicalMemory);
  if (!totalGb && !freeGb) return '';
  const parts = [];
  if (totalGb) parts.push(`Your computer has about ${totalGb} GB of usable system RAM`);
  if (freeGb) parts.push(`${freeGb} GB is currently free/available`);
  return `${parts.join(', ')}.`;
}

async function answerLocalMemoryQuestionFastPath({ userPrompt, workspacePath, conversation, config, route }) {
  agentExecutionMode = 'direct';
  agentSubStatus = 'Checking system memory locally...';
  const aiMessageIndex = conversation.messages.length;
  const command = 'wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value';
  const processId = `cmd_${conversation.id}_${Date.now()}`;
  const timeoutMs = config.commandTimeoutMs || 120000;
  const workWalkthrough = [{ toolName: 'run_command', kind: 'command', status: 'running', command, label: `Ran \`${command}\`` }];
  conversation.messages.push({ role: 'assistant', text: 'Checking your system memory...', logs: [], turns: [] });
  if (window.renderAiMessage) window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);

  try {
    const result = await window.api.runCommand(command, workspacePath, processId, timeoutMs);
    const stdout = result && result.stdout ? result.stdout : '';
    const stderr = result && (result.stderr || result.error) ? (result.stderr || result.error) : '';
    const answer = result && Number(result.code) === 0 ? buildLocalMemoryAnswer(stdout) : '';
    workWalkthrough[0].status = answer ? 'done' : 'error';
    workWalkthrough[0].detail = `Exit: ${result && result.code !== undefined ? result.code : 'unknown'}, timeout: ${result && result.timeoutMs ? result.timeoutMs : timeoutMs}ms`;
    const finalText = answer || `I could not read your RAM from the local command output.\n\nCommand attempted: \`${command}\`${stderr ? `\n\nError: ${String(stderr).slice(0, 500)}` : ''}`;
    conversation.messages[aiMessageIndex].text = withWorkWalkthrough(finalText, workWalkthrough, true);
    conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
    if (window.renderAiMessage) window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
  } catch (error) {
    workWalkthrough[0].status = 'error';
    workWalkthrough[0].detail = error.message;
    conversation.messages[aiMessageIndex].text = withWorkWalkthrough(`I could not read your RAM because the local command runner failed: ${error.message}`, workWalkthrough, true);
    conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
    if (window.renderAiMessage) window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
  } finally {
    isAgentRunning = false;
    runningConversationId = null;
    agentExecutionMode = 'idle';
    agentSubStatus = '';
    if (window.onAgentStatusChange) window.onAgentStatusChange(false);
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    if (window.renderConversationList) window.renderConversationList();
    if (window.renderProjectsList) window.renderProjectsList();
  }
}

function shouldHaveUsedToolsButDidNot(text, workWalkthrough, userPrompt = '') {
  if ((workWalkthrough || []).length > 0) return false;
  const response = String(text || '').trim();
  if (!response) return true;
  if (requestNeedsLocalInspection(userPrompt) && isGenericNonAnswer(response)) return true;
  if (response.length < 80) return true;

  const promptLower = String(userPrompt || '').toLowerCase();
  const workspaceKeywords = ['file', 'test', 'code', 'search', 'index', 'run', 'execute', 'directory', 'folder', 'write', 'modify', 'patch', 'git', 'npm'];
  const hasWorkspaceKeyword = workspaceKeywords.some(kw => promptLower.includes(kw));

  if (hasWorkspaceKeyword) {
    const claimsRegex = /\b(checked|verified|inspected|updated|created|found|tested|run|executed|deleted|copied|moved|read|wrote)\b/i;
    if (claimsRegex.test(response)) {
      return true;
    }
  }

  return false;
}

function isGenericNonAnswer(text) {
  const normalized = String(text || '').toLowerCase().replace(/[^\w\s']/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  return /^(understood|ok|okay|sure|got it|done|sounds good|working on it|i understand|acknowledged|noted|task finished)( thanks)?$/.test(normalized);
}

function requestNeedsLocalInspection(prompt) {
  return isLocalSystemFactRequest(prompt);
}

async function validateRunCommandForAgentUse(command, workspace) {
  const text = String(command || '');
  if (!looksLikePythonFileRun(text) || commandProvidesInput(text)) {
    return { allowed: true, reason: '' };
  }

  const scriptPath = extractPythonScriptPath(text);
  if (!scriptPath || !window.api || typeof window.api.readFile !== 'function') {
    return { allowed: true, reason: '' };
  }

  const content = await window.api.readFile(workspace, scriptPath, { maxChars: 200000 });
  const source = typeof content === 'string'
    ? content
    : (content && !content.error && typeof content.content === 'string' ? content.content : '');
  if (!/\binput\s*\(/.test(source)) {
    return { allowed: true, reason: '' };
  }

  return {
    allowed: false,
    reason: `Interactive command '${text}' appears to run ${scriptPath}, which reads from input(). Pipe test input into the command, redirect a prepared input file, or use start_command with a short timeout and then kill/read output for a smoke check.`
  };
}

function looksLikePythonFileRun(command) {
  return !!extractPythonScriptPath(command);
}

function commandProvidesInput(command) {
  const text = String(command || '');
  return /[|<]/.test(text) || /\b(echo|printf|type|Get-Content|gc)\b/i.test(text);
}

function extractPythonScriptPath(command) {
  const text = String(command || '');
  const match = text.match(/(?:^|[;&]\s*)(?:py(?:thon)?|python(?:\d+(?:\.\d+)?)?|py)\s+(?:"([^"]+\.py)"|'([^']+\.py)'|([^\s;&|<>]+\.py))/i);
  return match ? (match[1] || match[2] || match[3]) : '';
}

function isLocalSystemFactRequest(prompt) {
  const tokenSet = new Set(tokenizeIntentText(prompt));
  const localSubject = hasAnyToken(tokenSet, ['my', 'this', 'computer', 'pc', 'machine', 'system', 'windows', 'local', 'laptop']);
  const systemTopic = hasAnyToken(tokenSet, [
    'memory', 'ram', 'disk', 'storage', 'cpu', 'gpu', 'processor', 'graphics',
    'process', 'processes', 'battery', 'ip', 'address', 'environment', 'env',
    'path', 'installed', 'version', 'free', 'space', 'left', 'usage',
    'performance', 'performing', 'speed', 'slow', 'fast', 'spec', 'specs',
    'hardware', 'benchmark'
  ]);
  return localSubject && systemTopic;
}

function isFailedToolResult(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.error || result.success === false) return true;
  if (result.exitCode !== undefined && Number(result.exitCode) !== 0) return true;
  if (result.code !== undefined && Number(result.code) !== 0) return true;
  if (result.timedOut || result.killed) return true;
  return false;
}

function getToolFailureSignal(result) {
  if (!result || typeof result !== 'object') return '';
  if (result.error) return String(result.error);
  if (result.success === false && result.message) return String(result.message);
  if (result.exitCode !== undefined && Number(result.exitCode) !== 0) {
    const stderr = result.stderr ? ` stderr: ${String(result.stderr).slice(0, 500)}` : '';
    return `Command exited with code ${result.exitCode}.${stderr}`;
  }
  if (result.code !== undefined && Number(result.code) !== 0) return `Command exited with code ${result.code}.`;
  if (result.timedOut) return 'Command timed out.';
  if (result.killed) return 'Command was stopped.';
  return '';
}

function buildToolEvidenceEntry(toolName, args = {}, result = {}) {
  const failure = getToolFailureSignal(result);
  const command = args && args.command ? String(args.command) : '';
  return {
    toolName,
    command,
    failed: !!failure,
    failure,
    category: failure ? classifyAgentFailure({ toolName, args, result, errorText: failure }).category : 'success',
    summary: summarizeToolOutcome(toolName, args, result).summary
  };
}

function hasLocalInspectionAttempt(ledger) {
  return (ledger || []).some(item => item && (item.toolName === 'run_command' || item.toolName === 'start_command' || item.toolName === 'get_command_status' || item.toolName === 'read_command_output'));
}

function hasOnlyFailedLocalInspection(ledger) {
  const local = (ledger || []).filter(item => item && (item.toolName === 'run_command' || item.toolName === 'start_command'));
  return local.length > 0 && local.every(item => item.failed);
}

function getEpistemicToolGate(userPrompt, ledger, toolName, args = {}) {
  if (!isLocalSystemFactRequest(userPrompt)) return { allowed: true };
  if (toolName === 'google_search' || toolName === 'fetch_web_page') {
    return {
      allowed: false,
      reason: 'Web research cannot answer facts about this local machine. A failed local command is not evidence that the local fact is unknowable.',
      guidance: 'Use local inspection. If local command execution itself is failing, say that the command runner failed and do not ask for Google Search credentials.'
    };
  }
  if (toolName === 'record_blocker' && hasOnlyFailedLocalInspection(ledger)) {
    return {
      allowed: false,
      reason: 'Do not record a mission blocker from failed local-inspection commands alone. The failures prove only that those tool attempts failed, not that the requested local fact cannot be answered.',
      guidance: 'Try a different local route, or honestly report that local command execution failed and name the failed attempts.'
    };
  }
  return { allowed: true };
}

function buildEpistemicCorrectionPrompt({ userPrompt, answerText, toolEvidenceLedger }) {
  if (!isLocalSystemFactRequest(userPrompt)) return '';
  if (!hasLocalInspectionAttempt(toolEvidenceLedger)) return '';
  const text = String(answerText || '').toLowerCase();
  const claimsBlocked = /\b(blocked|cannot proceed|can't proceed|unable to proceed|need .*google|google search api key|configured google|cannot answer|impossible)\b/.test(text);
  if (!claimsBlocked || !hasOnlyFailedLocalInspection(toolEvidenceLedger)) return '';
  const failures = toolEvidenceLedger
    .filter(item => item.failed)
    .slice(-5)
    .map(item => `- ${item.toolName}${item.command ? ` (${item.command})` : ''}: ${item.failure || item.summary}`)
    .join('\n');
  return `[SYSTEM: Self-correction required. The user asked for a local machine fact. Your previous answer appears to turn failed tool attempts into a world-state conclusion.\n\nFailed tool attempts are evidence about the tool path, not proof that the user's objective is blocked or that Google is needed.\n\nRecent failed evidence:\n${failures}\n\nCorrect your reasoning. Do not use web search for local machine facts. Do not record a blocker unless there is evidence the objective itself is impossible. Try another local inspection route if available; otherwise answer honestly that the local command runner/attempts failed and name what proof is missing.]`;
}

function classifyAgentFailure({ toolName = '', args = {}, result = null, errorText = '', failureCount = 1, category = '' } = {}) {
  if (category) return { category, recommendedNature: recommendedNatureForFailureCategory(category), toolName, args, errorText: String(errorText || ''), failureCount };

  const text = String(errorText || '').toLowerCase();
  const command = String((args && args.command) || '');

  let resolved = 'tool_failure';
  if (failureCount >= 3) {
    resolved = 'repeated_tool_failure';
  } else if (toolName === 'patch_file' && /target content block not found|target.*not found|line range|patch.*failed/.test(text)) {
    resolved = 'patch_target_missing';
  } else if (/deny-list|destructive|blocked|planning mode blocks|not approved/.test(text)) {
    resolved = 'command_blocked';
  } else if (toolName === 'run_tests' || /test .*failed|tests failed|regression detected|npm test/.test(text) || (toolName === 'run_command' && /\b(npm|yarn|pnpm|node)\s+test\b/.test(command))) {
    resolved = 'test_failure';
  } else if (/cannot find module|module not found|command not found|not recognized as|enoent|missing dependency|no such file or directory/.test(text)) {
    resolved = 'missing_dependency';
  } else if (/401|403|unauthorized|forbidden|api key|credential|auth|permission denied/.test(text)) {
    resolved = 'auth_missing';
  } else if (/timed out|timeout|etimedout|aborted/.test(text) || (result && result.timedOut)) {
    resolved = 'timeout';
  } else if (/interactive command|reads from input\(\)|pipe test input|requires stdin/.test(text)) {
    resolved = 'interactive_command_needs_input';
  }

  return { category: resolved, recommendedNature: recommendedNatureForFailureCategory(resolved), toolName, args, errorText: String(errorText || ''), failureCount };
}

function recommendedNatureForFailureCategory(category) {
  const map = {
    timeout: 'transient',
    auth_missing: 'terminal',
    command_blocked: 'terminal',
    missing_dependency: 'fixable',
    patch_target_missing: 'fixable',
    test_failure: 'fixable',
    interactive_command_needs_input: 'fixable',
    repeated_tool_failure: 'fixable',
    model_no_tool_use: 'fixable',
    tool_failure: 'fixable'
  };
  return map[category] || 'fixable';
}

function buildFailureRecoveryGuidance(failure) {
  const category = failure && failure.category ? failure.category : 'tool_failure';
  const messages = {
    repeated_tool_failure: 'Do not quit the task. Do not retry it blindly. Pause the repeated call, inspect fresh state and recent output, explain the likely cause, then choose a different strategy before retrying: use a different tool, narrower arguments, or ask for the missing prerequisite.',
    patch_target_missing: 'Re-read the surrounding file lines before editing. Use a narrower exact target, a line-range patch, or adjust the patch to the current file contents instead of repeating the same patch.',
    command_blocked: 'The command was blocked by safety or planning rules. Keep the safety behavior intact; use a safer non-destructive command, an internal executable/args path, or ask for explicit plan approval when required.',
    test_failure: 'Treat this as a regression signal. Read the failing test output, identify the first failing assertion or command, fix the code or test expectation, and rerun the relevant tests before summarizing.',
    missing_dependency: 'Install or configure the missing dependency only after checking the project manifest and existing package manager. If installation is not appropriate, choose a tool that uses available local capabilities.',
    auth_missing: 'Stop retrying credential-gated work. Preserve state, name the missing credential or permission, and ask the user to provide or configure it before continuing.',
    timeout: 'Do not repeat the same long-running action unchanged. Check if the process is a GUI/Pygame app that blocks until closed. If so, add an automated exit flag to the code (e.g. exit after N frames/ticks), run with a short timeout, or use start_command/kill_command instead of waiting for a long timeout.',
    interactive_command_needs_input: 'Do not run an interactive command as a blocking test without stdin. Pipe a short scripted input sequence, redirect an input fixture, or use start_command with a short timeout followed by read_command_output and kill_command.',
    model_no_tool_use: 'Your response appeared to promise or report workspace work, but no tools were called. If the task requires looking at files, running commands/tests, editing code, creating files, or verifying behavior, call the appropriate tools now. If no tools are needed, answer explicitly that no workspace action was needed and why.',
    tool_failure: 'Inspect the error and current workspace state before trying again. Change one meaningful variable in the next attempt, such as the target path, command, arguments, or verification step.'
  };
  return messages[category] || messages.tool_failure;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sleepWithModelApiStatus(ms, label, onWarning) {
  const boundedMs = Math.min(Math.max(Number(ms) || 0, 0), MODEL_API_MAX_RETRY_WAIT_MS);
  const startedAt = Date.now();
  if (onWarning) {
    onWarning(`${label} Waiting ${(boundedMs / 1000).toFixed(1)}s before retrying instead of hammering the provider...`);
  }
  while (Date.now() - startedAt < boundedMs) {
    if (isStopRequested) {
      throw new Error('Model API retry wait cancelled by user stop.');
    }
    const remainingMs = Math.max(0, boundedMs - (Date.now() - startedAt));
    await sleep(Math.min(1000, remainingMs));
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_API_REQUEST_TIMEOUT_MS, label = 'request') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseRetryDelayMs(errorText) {
  if (!errorText) return null;
  try {
    const parsed = JSON.parse(errorText);
    const details = parsed.error && Array.isArray(parsed.error.details) ? parsed.error.details : [];
    const retryInfo = details.find(d => d['@type'] && d['@type'].includes('RetryInfo') && d.retryDelay);
    if (retryInfo) {
      const seconds = parseFloat(String(retryInfo.retryDelay).replace(/s$/, ''));
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    }
  } catch (e) {}

  const retryInMatch = errorText.match(/retry in\s+([0-9.]+)s/i);
  if (retryInMatch) {
    const seconds = parseFloat(retryInMatch[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }

  const retryDelayMatch = errorText.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
  if (retryDelayMatch) {
    const seconds = parseFloat(retryDelayMatch[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }

  return null;
}

function describeModelApiError(status, errorText) {
  let message = errorText;
  let retryDelayMs = parseRetryDelayMs(errorText);
  try {
    const parsed = JSON.parse(errorText);
    if (parsed.error && parsed.error.message) {
      message = parsed.error.message;
    }
  } catch (e) {}
  return { status, message, retryDelayMs };
}

function isGeminiHighDemandError(status, message) {
  return status === 503 && /currently experiencing high demand|spikes in demand|high demand/i.test(String(message || ''));
}

function getNextGeminiModelForHighDemand(modelName) {
  const fallbackChain = {
    'gemini-3.1-flash-lite': 'gemini-3.5-flash',
    'gemini-3.5-flash': 'gemini-3.1-pro-preview',
    'gemini-2.5-flash-lite': 'gemini-2.5-flash',
    'gemini-2.5-flash': 'gemini-2.5-pro'
  };
  return fallbackChain[modelName] || null;
}

// OLLAMA API UTILITIES & TRANSLATION HELPERS
function convertGeminiToOllamaMessages(geminiMessages) {
  const ollamaMessages = [];
  
  geminiMessages.forEach((msg) => {
    if (msg.role === 'user') {
      let contentText = '';
      if (msg.parts) {
        msg.parts.forEach(p => {
          if (p.text) contentText += p.text;
        });
      }
      ollamaMessages.push({ role: 'user', content: contentText });
    } else if (msg.role === 'model') {
      let contentText = '';
      let toolCalls = [];
      
      if (msg.parts) {
        msg.parts.forEach((p) => {
          if (p.text) contentText += p.text;
          if (p.functionCall) {
            toolCalls.push({
              function: {
                name: p.functionCall.name,
                arguments: p.functionCall.args || {}
              }
            });
          }
        });
      }
      
      const assistantMsg = { role: 'assistant', content: contentText };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      ollamaMessages.push(assistantMsg);
    } else if (msg.role === 'tool') {
      if (msg.parts) {
        msg.parts.forEach((p) => {
          if (p.functionResponse) {
            const responseObj = p.functionResponse.response || {};
            ollamaMessages.push({
              role: 'tool',
              content: typeof responseObj === 'object' ? JSON.stringify(responseObj) : String(responseObj)
            });
          }
        });
      }
    }
  });
  
  return ollamaMessages;
}

function convertGeminiToOllamaTools(geminiTools) {
  const ollamaTools = [];
  if (geminiTools && geminiTools[0] && geminiTools[0].functionDeclarations) {
    geminiTools[0].functionDeclarations.forEach(fd => {
      const parameters = JSON.parse(JSON.stringify(fd.parameters || {}));
      if (parameters.type) {
        parameters.type = parameters.type.toLowerCase();
      }
      if (parameters.properties) {
        for (const key in parameters.properties) {
          if (parameters.properties[key].type) {
            parameters.properties[key].type = parameters.properties[key].type.toLowerCase();
          }
        }
      }
      
      ollamaTools.push({
        type: 'function',
        function: {
          name: fd.name,
          description: fd.description,
          parameters: parameters
        }
      });
    });
  }
  return ollamaTools;
}

async function callOllamaAPI(messages, modelName, onWarning, disableTools = false) {
  const url = `http://localhost:11434/api/chat`;
  
  // Format standard Orion AI system instruction
  const systemInstruction = SYSTEM_INSTRUCTION;
  
  const ollamaTools = convertGeminiToOllamaTools([
    {
      functionDeclarations: [
        ...OPERATIONAL_CONTEXT_TOOL_DECLARATIONS,
        ...ASSET_BROWSER_VISUAL_TOOL_DECLARATIONS,
        {
          name: "list_files",
          description: "Lists all files recursively in the active workspace directory, excluding build folders like node_modules.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "get_workspace_info",
          description: "Returns the active workspace directory, conversation scope, and project metadata. Use when the user asks where the project/program is or asks for the directory.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "change_workspace",
          description: "Changes the active workspace directory of this conversation to a new absolute directory path on your computer. Use this when you discover that the user wants to work on or inspect a project located outside the active standalone workspace folder.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "The absolute path to the directory you want to set as the active workspace." }
            },
            required: ["path"]
          }
        },
        {
          name: "open_workspace_folder",
          description: "Opens the active workspace directory in the operating system file explorer.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "launch_workspace_app",
          description: "Launches/runs the active workspace app using Orion's app detection. Use when the user asks to run, launch, or open the program.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "set_workspace_entrypoint",
          description: "Sets or clears the saved launch entry point command for the active workspace. Use after identifying the correct way to run a project, or when the user asks to set the entry point.",
          parameters: {
            type: "OBJECT",
            properties: {
              command: { type: "STRING", description: "Command to run from the workspace root, such as python app.py or npm run dev. Leave blank to clear." },
              label: { type: "STRING", description: "Optional human-readable label." }
            }
          }
        },
        {
          name: "git_push",
          description: "Pushes the current Git branch to GitHub/Git when the user explicitly asks. If branch is omitted, pushes the current branch to the same branch name on the remote.",
          parameters: {
            type: "OBJECT",
            properties: {
              remote: { type: "STRING", description: "Git remote name. Defaults to origin." },
              branch: { type: "STRING", description: "Remote branch name to push to. Defaults to current branch." },
              setUpstream: { type: "BOOLEAN", description: "Whether to set upstream with -u. Defaults to true." }
            }
          }
        },
        {
          name: "read_file",
          description: "Reads the entire content of a file located at path relative to the workspace root.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "Relative path of the file to read" },
              startLine: { type: "NUMBER", description: "Optional 1-based start line for targeted reads." },
              endLine: { type: "NUMBER", description: "Optional 1-based end line for targeted reads." },
              maxChars: { type: "NUMBER", description: "Optional maximum characters to return." }
            },
            required: ["path"]
          }
        },
        {
          name: "write_file",
          description: "Creates a new file. Existing non-governance files require allowOverwrite=true and overwriteReason; prefer patch_file for source edits. STRATEGY.md and implementation_plan.md are governance files.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "Relative path of the file to create" },
              content: { type: "STRING", description: "Text content of the file" },
              allowOverwrite: { type: "BOOLEAN", description: "Must be true to overwrite an existing non-plan file. Prefer patch_file for edits." },
              overwriteReason: { type: "STRING", description: "Required when allowOverwrite is true; explain why a full rewrite is necessary." }
            },
            required: ["path", "content"]
          }
        },
        {
          name: "modify_file",
          description: "Edits a file by replacing a contiguous block of text. Specify the target content to look for and the replacement content to put in its place.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "Relative path of the file to modify" },
              target: { type: "STRING", description: "The exact block of code to search for. Must be unique in the file." },
              replacement: { type: "STRING", description: "The replacement block of code" }
            },
            required: ["path", "target", "replacement"]
          }
        },
        {
          name: "patch_file",
          description: "Applies a targeted file patch without rewriting the whole file. Prefer this for large files. Supports operation.type values: replace, replace_regex, insert, replace_range.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "Relative path of the file to patch" },
              operation: {
                type: "OBJECT",
                properties: {
                  type: { type: "STRING", description: "replace, replace_regex, insert, or replace_range" },
                  target: { type: "STRING", description: "Exact text for replace" },
                  replacement: { type: "STRING", description: "Replacement text for replace or replace_regex" },
                  pattern: { type: "STRING", description: "JavaScript regex pattern for replace_regex" },
                  flags: { type: "STRING", description: "Regex flags such as gim" },
                  anchor: { type: "STRING", description: "Anchor text for insert" },
                  position: { type: "STRING", description: "before or after for insert" },
                  content: { type: "STRING", description: "Inserted content or replacement range content" },
                  startLine: { type: "NUMBER", description: "1-based start line for replace_range" },
                  endLine: { type: "NUMBER", description: "1-based end line for replace_range" },
                  count: { type: "NUMBER", description: "Maximum replacements for replace" }
                },
                required: ["type"]
              }
            },
            required: ["path", "operation"]
          }
        },
        {
          name: "run_command",
          description: "Runs a command in powershell in the workspace directory, waits for completion, and returns code, stdout, stderr, and timeout status. For local machine facts, a non-zero exit proves only that this command attempt failed; try a different local route before concluding the task is blocked.",
          parameters: {
            type: "OBJECT",
            properties: {
              command: { type: "STRING", description: "Powershell command to run" },
              timeoutMs: { type: "NUMBER", description: "Optional timeout in milliseconds before Orion stops the command." }
            },
            required: ["command"]
          }
        },
        {
          name: "start_command",
          description: "Starts a shell command asynchronously with a timeout and returns immediately with a processId. Use for long-running tests, dev servers, or commands that may take a while. Use the returned id for later status/output/kill calls.",
          parameters: {
            type: "OBJECT",
            properties: {
              command: { type: "STRING", description: "Powershell command to run" },
              processId: { type: "STRING", description: "Optional stable id for this command session." },
              timeoutMs: { type: "NUMBER", description: "Optional timeout in milliseconds before Orion stops the command." }
            },
            required: ["command"]
          }
        },
        {
          name: "get_command_status",
          description: "Checks status for a command started with start_command.",
          parameters: {
            type: "OBJECT",
            properties: {
              processId: { type: "STRING", description: "The command session id returned by start_command." }
            },
            required: ["processId"]
          }
        },
        {
          name: "read_command_output",
          description: "Reads accumulated stdout and stderr from a command started with start_command.",
          parameters: {
            type: "OBJECT",
            properties: {
              processId: { type: "STRING", description: "The command session id returned by start_command." },
              maxChars: { type: "NUMBER", description: "Maximum number of trailing output characters to return." }
            },
            required: ["processId"]
          }
        },
        {
          name: "kill_command",
          description: "Stops a running command session started with start_command.",
          parameters: {
            type: "OBJECT",
            properties: {
              processId: { type: "STRING", description: "The command session id returned by start_command." }
            },
            required: ["processId"]
          }
        },
        {
          name: "schedule_followup",
          description: "Schedules Orion to continue this same conversation after a delay. Use whenever you say you will wait, check progress later, inspect long-running tests/training, or continue after N seconds/minutes.",
          parameters: {
            type: "OBJECT",
            properties: {
              delaySeconds: { type: "NUMBER", description: "Delay before continuing, in seconds. Maximum 3600." },
              prompt: { type: "STRING", description: "Instruction Orion should run when the timer fires." },
              purpose: { type: "STRING", description: "Optional stable dedupe key, e.g. training-progress or test-check." }
            },
            required: ["delaySeconds", "prompt"]
          }
        },
        {
          name: "read_notes",
          description: "Reads durable notes for the current scope. Project conversations share project notes; standalone conversations have private standalone notes.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "update_notes",
          description: "Updates durable project/standalone notes with concise facts, architecture decisions, commands, gotchas, open tasks, and future repair notes.",
          parameters: {
            type: "OBJECT",
            properties: {
              content: { type: "STRING", description: "Markdown note content to write or append." },
              mode: { type: "STRING", description: "Use replace to rewrite notes or append to add a new note. Defaults to replace." }
            },
            required: ["content"]
          }
        },
        {
          name: "run_tests",
          description: "Runs the regression test command configured for the workspace.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "google_search",
          description: "Searches Google for current documentation, API references, examples, and troubleshooting. Do not use for facts about this local machine, workspace state, installed tools, paths, memory, disk, processes, or environment variables; inspect local state instead.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Search query, preferably including the product/library and exact API or error." },
              numResults: { type: "NUMBER", description: "Number of results to return, from 1 to 10." }
            },
            required: ["query"]
          }
        },
        {
          name: "fetch_web_page",
          description: "Fetches readable text from a specific http(s) page, usually an official docs page found with google_search.",
          parameters: {
            type: "OBJECT",
            properties: {
              url: { type: "STRING", description: "The http(s) URL to fetch." }
            },
            required: ["url"]
          }
        },
        {
          name: "sync_workspace_env",
          description: "Writes the user's configured Gemini API key, Google API key, Google Search API key, and Google Search Engine ID into workspace .env files without exposing secret values in chat or tool output. Also creates .env.example and updates .gitignore by default.",
          parameters: {
            type: "OBJECT",
            properties: {
              envPath: { type: "STRING", description: "Environment file path relative to workspace. Defaults to .env." },
              examplePath: { type: "STRING", description: "Example env file path relative to workspace. Defaults to .env.example." },
              includeGemini: { type: "BOOLEAN", description: "Whether to include Gemini/Google API key variables. Defaults to true." },
              includeSearch: { type: "BOOLEAN", description: "Whether to include Google Search Engine ID and Search API key variables. Defaults to true." },
              updateGitignore: { type: "BOOLEAN", description: "Whether to add env files to .gitignore. Defaults to true." },
              createExample: { type: "BOOLEAN", description: "Whether to create/update .env.example. Defaults to true." }
            }
          }
        },
        {
          name: "set_task_checklist",
          description: "Sets the task checklist in the side panel for meaningful milestones only. Pass an array of items with a status ('pending', 'in-progress', 'completed'); do not call this just to refresh in-progress state.",
          parameters: {
            type: "OBJECT",
            properties: {
              tasks: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    status: { type: "STRING", description: "Task status. Use pending, in-progress, or completed." }
                  },
                  required: ["title", "status"]
                }
              }
            },
          }
        },
        {
          name: "search_embeddings",
          description: "Searches the workspace files semantically using vector embeddings of code chunks. Returns the most relevant code snippets with line numbers and file paths.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "The semantic search query, e.g. 'how is configuration loaded'" },
              limit: { type: "NUMBER", description: "Optional maximum number of results to return. Defaults to 5." }
            },
            required: ["query"]
          }
        }
      ]
    }
  ]);
  
  const ollamaMessages = [];
  if (systemInstruction) {
    ollamaMessages.push({ role: 'system', content: systemInstruction });
  }
  
  ollamaMessages.push(...convertGeminiToOllamaMessages(messages));
  
  const requestBody = {
    model: modelName,
    messages: ollamaMessages,
    stream: false,
    options: {
      temperature: 0
    }
  };
  
  if (!disableTools) {
    requestBody.tools = ollamaTools;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API HTTP ${response.status}: ${errText}`);
  }
  
  const responseData = await response.json();
  
  // Format back to Gemini style candidates response
  const candidateParts = [];
  const message = responseData.message || {};
  if (message.content) {
    candidateParts.push({ text: message.content });
  }
  if (message.tool_calls) {
    message.tool_calls.forEach(tc => {
      let args = tc.function.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch (e) {
          args = {};
        }
      }
      candidateParts.push({
        functionCall: {
          name: tc.function.name,
          args: args || {}
        }
      });
    });
  }
  
  return {
    candidates: [
      {
        content: {
          parts: candidateParts
        }
      }
    ]
  };
}

function sanitizeMessagesForTextOnly(messages) {
  const cleanMessages = [];
  messages.forEach(msg => {
    if (msg.role === 'tool') {
      return;
    }
    const textParts = (msg.parts || []).filter(part => part.text !== undefined && part.text !== null);
    if (textParts.length > 0) {
      cleanMessages.push({
        role: msg.role,
        parts: textParts.map(p => ({ text: p.text }))
      });
    } else {
      const originalFunctionCalls = (msg.parts || [])
        .filter(part => part.functionCall !== undefined && part.functionCall !== null)
        .map(part => part.functionCall.name);
      if (originalFunctionCalls.length > 0) {
        cleanMessages.push({
          role: msg.role,
          parts: [{ text: `[Orion: Model executed tool call(s): ${originalFunctionCalls.join(', ')}]` }]
        });
      }
    }
  });

  const merged = [];
  cleanMessages.forEach(msg => {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].parts.push(...msg.parts);
    } else {
      merged.push({
        role: msg.role,
        parts: [...msg.parts]
      });
    }
  });
  return merged;
}

function parseModelJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (inner) {}
    }
  }
  return {};
}

async function inspectScreenshotWithGemini({ imageBase64, mimeType, path, goal, modelName, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName || 'gemini-2.5-flash-lite'}:generateContent?key=${apiKey}`;
  const prompt = `You are Orion's visual verification eye. Inspect this screenshot against the mission goal.

Goal: ${goal}

Return compact JSON only with:
{
  "status": "appears_satisfied" | "partially_satisfied" | "not_satisfied" | "uncertain",
  "confidence": 0.0-1.0,
  "observations": ["specific visible evidence"],
  "missing": ["what is missing or unclear"],
  "recommendation": "next action for the agent"
}

Be strict. If the screenshot does not clearly show the requested objective, say not_satisfied or uncertain.`;

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  }, MODEL_API_REQUEST_TIMEOUT_MS, 'Gemini vision screenshot inspection');

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini vision inspection failed HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;
  const parsed = parseModelJsonObject(text);
  const allowed = ['appears_satisfied', 'partially_satisfied', 'not_satisfied', 'uncertain'];
  const status = allowed.includes(parsed.status) ? parsed.status : 'uncertain';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const observations = Array.isArray(parsed.observations) ? parsed.observations.map(item => String(item).slice(0, 500)).filter(Boolean).slice(0, 8) : [];
  const missing = Array.isArray(parsed.missing) ? parsed.missing.map(item => String(item).slice(0, 500)).filter(Boolean).slice(0, 8) : [];
  const recommendation = String(parsed.recommendation || '').slice(0, 1000);

  return {
    success: true,
    path,
    goal,
    status,
    confidence,
    observations,
    missing,
    recommendation,
    evidence: observations.join('; ') || text || 'Gemini inspected screenshot but returned no observations.',
    summary: `Gemini vision judged screenshot ${status} for goal "${goal}" (confidence ${confidence.toFixed(2)}).`
  };
}

// GEMINI API UTILITIES
async function callGeminiAPI(messages, modelName, apiKey, onWarning, disableTools = false) {
  let activeModelName = modelName;
  
  const processedMessages = disableTools ? sanitizeMessagesForTextOnly(messages) : messages;

  // Format body, translating role: 'tool' to role: 'user' for Gemini REST API compatibility
  const formattedContents = processedMessages.map(msg => {
    if (msg.role === 'tool') {
      return {
        role: 'user',
        parts: msg.parts
      };
    }
    return msg;
  });
  
  // Merge consecutive messages with the same role to enforce strictly alternating roles (user <-> model)
  const mergedContents = [];
  formattedContents.forEach(msg => {
    if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === msg.role) {
      mergedContents[mergedContents.length - 1].parts.push(...msg.parts);
    } else {
      mergedContents.push({
        role: msg.role,
        parts: [...msg.parts]
      });
    }
  });
  
  const requestBody = {
    contents: mergedContents,
    systemInstruction: {
      parts: [{ text: disableTools ? (SYSTEM_INSTRUCTION.split('Tools available:')[0] + '\n\nCRITICAL: You are in an analysis phase. DO NOT output any function calls. Provide your analysis in markdown text only.') : SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      ...(modelName.includes('thinking') || modelName.includes('2.5') ? {
        thinkingConfig: {
          thinkingBudget: GEMINI_THINKING_BUDGET
        }
      } : {
        temperature: 0
      })
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE"
      }
    ],
    tools: [
      {
        functionDeclarations: [
          ...OPERATIONAL_CONTEXT_TOOL_DECLARATIONS,
          ...ASSET_BROWSER_VISUAL_TOOL_DECLARATIONS,
          {
            name: "list_files",
            description: "Lists all files recursively in the active workspace directory, excluding build folders like node_modules.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "get_workspace_info",
            description: "Returns the active workspace directory, conversation scope, and project metadata. Use when the user asks where the project/program is or asks for the directory.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "change_workspace",
            description: "Changes the active workspace directory of this conversation to a new absolute directory path on your computer. Use this when you discover that the user wants to work on or inspect a project located outside the active standalone workspace folder.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "The absolute path to the directory you want to set as the active workspace." }
              },
              required: ["path"]
            }
          },
          {
            name: "open_workspace_folder",
            description: "Opens the active workspace directory in the operating system file explorer.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "launch_workspace_app",
            description: "Launches/runs the active workspace app using Orion's app detection. Use when the user asks to run, launch, or open the program.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "set_workspace_entrypoint",
            description: "Sets or clears the saved launch entry point command for the active workspace. Use after identifying the correct way to run a project, or when the user asks to set the entry point.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: { type: "STRING", description: "Command to run from the workspace root, such as python app.py or npm run dev. Leave blank to clear." },
                label: { type: "STRING", description: "Optional human-readable label." }
              }
            }
          },
          {
            name: "git_push",
            description: "Pushes the current Git branch to GitHub/Git when the user explicitly asks. If branch is omitted, pushes the current branch to the same branch name on the remote.",
            parameters: {
              type: "OBJECT",
              properties: {
                remote: { type: "STRING", description: "Git remote name. Defaults to origin." },
                branch: { type: "STRING", description: "Remote branch name to push to. Defaults to current branch." },
                setUpstream: { type: "BOOLEAN", description: "Whether to set upstream with -u. Defaults to true." }
              }
            }
          },
          {
            name: "read_file",
            description: "Reads the entire content of a file located at path relative to the workspace root.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path of the file to read" },
                startLine: { type: "NUMBER", description: "Optional 1-based start line for targeted reads." },
                endLine: { type: "NUMBER", description: "Optional 1-based end line for targeted reads." },
                maxChars: { type: "NUMBER", description: "Optional maximum characters to return." }
              },
              required: ["path"]
            }
          },
          {
            name: "write_file",
            description: "Creates a new file. Existing non-governance files require allowOverwrite=true and overwriteReason; prefer patch_file for source edits. STRATEGY.md and implementation_plan.md are governance files.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path of the file to create" },
                content: { type: "STRING", description: "Text content of the file" },
                allowOverwrite: { type: "BOOLEAN", description: "Must be true to overwrite an existing non-plan file. Prefer patch_file for edits." },
                overwriteReason: { type: "STRING", description: "Required when allowOverwrite is true; explain why a full rewrite is necessary." }
              },
              required: ["path", "content"]
            }
          },
          {
            name: "modify_file",
            description: "Edits a file by replacing a contiguous block of text. Specify the target content to look for and the replacement content to put in its place.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path of the file to modify" },
                target: { type: "STRING", description: "The exact block of code to search for. Must be unique in the file." },
                replacement: { type: "STRING", description: "The replacement block of code" }
              },
              required: ["path", "target", "replacement"]
            }
          },
          {
            name: "patch_file",
            description: "Applies a targeted file patch without rewriting the whole file. Prefer this for large files. Supports operation.type values: replace, replace_regex, insert, replace_range.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path of the file to patch" },
                operation: {
                  type: "OBJECT",
                  properties: {
                    type: { type: "STRING", description: "replace, replace_regex, insert, or replace_range" },
                    target: { type: "STRING", description: "Exact text for replace" },
                    replacement: { type: "STRING", description: "Replacement text for replace or replace_regex" },
                    pattern: { type: "STRING", description: "JavaScript regex pattern for replace_regex" },
                    flags: { type: "STRING", description: "Regex flags such as gim" },
                    anchor: { type: "STRING", description: "Anchor text for insert" },
                    position: { type: "STRING", description: "before or after for insert" },
                    content: { type: "STRING", description: "Inserted content or replacement range content" },
                    startLine: { type: "NUMBER", description: "1-based start line for replace_range" },
                    endLine: { type: "NUMBER", description: "1-based end line for replace_range" },
                    count: { type: "NUMBER", description: "Maximum replacements for replace" }
                  },
                  required: ["type"]
                }
              },
              required: ["path", "operation"]
            }
          },
          {
            name: "run_command",
            description: "Runs a command in powershell in the workspace directory, waits for completion, and returns code, stdout, stderr, and timeout status. For local machine facts, a non-zero exit proves only that this command attempt failed; try a different local route before concluding the task is blocked.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: { type: "STRING", description: "Powershell command to run" },
                timeoutMs: { type: "NUMBER", description: "Optional timeout in milliseconds before Orion stops the command." }
              },
              required: ["command"]
            }
          },
          {
            name: "start_command",
            description: "Starts a shell command asynchronously with a timeout and returns immediately with a processId. Use for long-running tests, dev servers, or commands that may take a while. Use the returned id for later status/output/kill calls.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: { type: "STRING", description: "Powershell command to run" },
                processId: { type: "STRING", description: "Optional stable id for this command session." },
                timeoutMs: { type: "NUMBER", description: "Optional timeout in milliseconds before Orion stops the command." }
              },
              required: ["command"]
            }
          },
          {
            name: "get_command_status",
            description: "Checks status for a command started with start_command.",
            parameters: {
              type: "OBJECT",
              properties: {
                processId: { type: "STRING", description: "The command session id returned by start_command." }
              },
              required: ["processId"]
            }
          },
          {
            name: "read_command_output",
            description: "Reads accumulated stdout and stderr from a command started with start_command.",
            parameters: {
              type: "OBJECT",
              properties: {
                processId: { type: "STRING", description: "The command session id returned by start_command." },
                maxChars: { type: "NUMBER", description: "Maximum number of trailing output characters to return." }
              },
              required: ["processId"]
            }
          },
          {
            name: "kill_command",
            description: "Stops a running command session started with start_command.",
            parameters: {
              type: "OBJECT",
              properties: {
                processId: { type: "STRING", description: "The command session id returned by start_command." }
              },
              required: ["processId"]
            }
          },
          {
            name: "schedule_followup",
            description: "Schedules Orion to continue this same conversation after a delay. Use whenever you say you will wait, check progress later, inspect long-running tests/training, or continue after N seconds/minutes.",
            parameters: {
              type: "OBJECT",
              properties: {
                delaySeconds: { type: "NUMBER", description: "Delay before continuing, in seconds. Maximum 3600." },
                prompt: { type: "STRING", description: "Instruction Orion should run when the timer fires." },
                purpose: { type: "STRING", description: "Optional stable dedupe key, e.g. training-progress or test-check." }
              },
              required: ["delaySeconds", "prompt"]
            }
          },
          {
            name: "read_notes",
            description: "Reads durable notes for the current scope. Project conversations share project notes; standalone conversations have private standalone notes.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "update_notes",
            description: "Updates durable project/standalone notes with concise facts, architecture decisions, commands, gotchas, open tasks, and future repair notes.",
            parameters: {
              type: "OBJECT",
              properties: {
                content: { type: "STRING", description: "Markdown note content to write or append." },
                mode: { type: "STRING", description: "Use replace to rewrite notes or append to add a new note. Defaults to replace." }
              },
              required: ["content"]
            }
          },
          {
            name: "run_tests",
            description: "Runs the regression test command configured for the workspace.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "google_search",
            description: "Searches Google for current documentation, API references, examples, and troubleshooting. Do not use for facts about this local machine, workspace state, installed tools, paths, memory, disk, processes, or environment variables; inspect local state instead.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "Search query, preferably including the product/library and exact API or error." },
                numResults: { type: "NUMBER", description: "Number of results to return, from 1 to 10." }
              },
              required: ["query"]
            }
          },
          {
            name: "fetch_web_page",
            description: "Fetches readable text from a specific http(s) page, usually an official docs page found with google_search.",
            parameters: {
              type: "OBJECT",
              properties: {
                url: { type: "STRING", description: "The http(s) URL to fetch." }
              },
              required: ["url"]
            }
          },
          {
            name: "sync_workspace_env",
            description: "Writes the user's configured Gemini API key, Google API key, Google Search API key, and Google Search Engine ID into workspace .env files without exposing secret values in chat or tool output. Also creates .env.example and updates .gitignore by default.",
            parameters: {
              type: "OBJECT",
              properties: {
                envPath: { type: "STRING", description: "Environment file path relative to workspace. Defaults to .env." },
                examplePath: { type: "STRING", description: "Example env file path relative to workspace. Defaults to .env.example." },
                includeGemini: { type: "BOOLEAN", description: "Whether to include Gemini/Google API key variables. Defaults to true." },
                includeSearch: { type: "BOOLEAN", description: "Whether to include Google Search Engine ID and Search API key variables. Defaults to true." },
                updateGitignore: { type: "BOOLEAN", description: "Whether to add env files to .gitignore. Defaults to true." },
                createExample: { type: "BOOLEAN", description: "Whether to create/update .env.example. Defaults to true." }
              }
            }
          },
          {
            name: "set_task_checklist",
            description: "Sets the task checklist in the side panel for meaningful milestones only. Pass an array of items with a status ('pending', 'in-progress', 'completed'); do not call this just to refresh in-progress state.",
            parameters: {
              type: "OBJECT",
              properties: {
                tasks: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      status: { type: "STRING", description: "Task status. Use pending, in-progress, or completed." }
                    },
                    required: ["title", "status"]
                  }
                }
              },
              required: ["tasks"]
            }
          },
          {
            name: "search_embeddings",
            description: "Searches the workspace files semantically using vector embeddings of code chunks. Returns the most relevant code snippets with line numbers and file paths.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "The semantic search query, e.g. 'how is configuration loaded'" },
                limit: { type: "NUMBER", description: "Optional maximum number of results to return. Defaults to 5." }
              },
              required: ["query"]
            }
          }
        ]
      }
    ]
  };

  if (disableTools) {
    delete requestBody.tools;
    delete requestBody.toolConfig;
  }

  const attempts = MODEL_API_MAX_ATTEMPTS;
  let delay = 1500; // Start with 1.5s
  
  for (let i = 1; i <= attempts; i++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModelName}:generateContent?key=${apiKey}`;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }, MODEL_API_REQUEST_TIMEOUT_MS, 'Gemini generateContent request');
      
      if (response.ok) {
        return await response.json();
      }
      
      const errorText = await response.text();
      const status = response.status;
      const apiError = describeModelApiError(status, errorText);
      const retryDelayMs = Math.min(apiError.retryDelayMs || delay, MODEL_API_MAX_RETRY_WAIT_MS);

      if (isGeminiHighDemandError(status, apiError.message)) {
        const fallbackModelName = getNextGeminiModelForHighDemand(activeModelName);
        if (fallbackModelName) {
          if (onWarning) {
            onWarning(`Gemini API returned HTTP ${status} (High Demand) for ${activeModelName}. Temporarily switching this request to ${fallbackModelName}; your selected default model is unchanged.`);
          }
          activeModelName = fallbackModelName;
          delay = 1500;
          i -= 1;
          continue;
        }
      }
      
      const isTransient = [429, 500, 502, 503, 504].includes(status);
      if (!isTransient || i === attempts) {
        const retryText = apiError.retryDelayMs ? ` Retry after about ${Math.ceil(apiError.retryDelayMs / 1000)} seconds.` : '';
        throw new Error(`HTTP ${status}: ${apiError.message}${retryText}`);
      }
      
      if (onWarning) {
        const kind = status === 429 ? 'Quota/rate limit' : (status === 503 ? 'High Demand' : 'Transient Error');
        onWarning(`Gemini API returned HTTP ${status} (${kind}). Provider wait/cooldown active (Attempt ${i}/${attempts}).`);
      }
      
      await sleepWithModelApiStatus(retryDelayMs, `Gemini API retry ${i}/${attempts}.`, onWarning);
      delay = Math.max(delay * 2 + Math.random() * 500, retryDelayMs); // Exponential backoff + API retry hint
      
    } catch (e) {
      if (i === attempts) throw e;
      if (onWarning) {
        onWarning(`Connection error: ${e.message}. Provider wait/cooldown active (Attempt ${i}/${attempts}).`);
      }
      await sleepWithModelApiStatus(delay, `Gemini connection retry ${i}/${attempts}.`, onWarning);
      delay = delay * 2 + Math.random() * 500;
    }
  }
}

// TOKEN COUNT ESTIMATOR VIA API
async function countTokens(messages, modelName, apiKey) {
  if (!modelName.startsWith('gemini-')) {
    return JSON.stringify(messages).length / 4;
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:countTokens?key=${apiKey}`;
  const requestBody = { contents: messages };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    // Return approximation if API fails
    return JSON.stringify(messages).length / 4;
  }
  const data = await response.json();
  return data.totalTokens;
}

// CONTEXT COMPACTOR (Summarizer)
async function compactHistory(messages, modelName, apiKey) {
  const isOllama = !modelName.startsWith('gemini-');
  
  // Format history for the summarizer prompt
  let conversationLogsText = "";
  messages.forEach(m => {
    const roleName = m.role === 'user' ? 'User' : 'Assistant';
    let contentText = "";
    if (m.parts) {
      m.parts.forEach(p => {
        if (p.text) contentText += p.text;
        if (p.functionCall) contentText += ` [Called Tool: ${p.functionCall.name}]`;
        if (p.functionResponse) contentText += ` [Tool Output: ${JSON.stringify(p.functionResponse.response)}]`;
      });
    }
    conversationLogsText += `${roleName}: ${contentText}\n\n`;
  });
  
  const summaryPrompt = `The following is a conversation history between a user and an AI pair programmer. Summarize the history, detailing:
1. The overall task and workspace directory.
2. Major modifications made to files.
3. Current task list status and remaining goals.
4. Any errors encountered and how they were resolved.
Keep the summary highly technical, extremely brief, and complete.

CONVERSATION HISTORY:
${conversationLogsText}`;

  let compactedSummary = "History compacted.";
  
  if (isOllama) {
    try {
      const response = await fetch(`http://localhost:11434/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: "You are a concise, technical summarizer utility." },
            { role: 'user', content: summaryPrompt }
          ],
          stream: false
        })
      });
      if (response.ok) {
        const resData = await response.json();
        compactedSummary = resData.message.content;
      }
    } catch (e) {
      console.error("Local Ollama compaction error:", e);
    }
  } else {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
      systemInstruction: {
        parts: [{ text: "You are a concise, technical summarizer utility." }]
      },
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: GEMINI_THINKING_BUDGET
        }
      }
    };
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (response.ok) {
        const resData = await response.json();
        compactedSummary = resData.candidates[0].content.parts[0].text;
      }
    } catch (e) {
      console.error("Gemini compaction error:", e);
    }
  }
  
  // Retain only the last 3 messages + the summary
  const lastMessages = messages.slice(-3);
  
  const newHistory = [
    {
      role: 'user',
      parts: [{
        text: `Here is a summary of our previous session history, do not repeat it but remember the context:\n\n${compactedSummary}`
      }]
    },
    {
      role: 'model',
      parts: [{
        text: "Understood. I have fully digested the summary context of our workspace history. Let's continue working."
      }]
    },
    ...lastMessages
  ];
  
  return {
    messages: newHistory,
    summary: compactedSummary
  };
}

if (typeof module !== 'undefined' && process.env.NODE_ENV === 'test') {
  module.exports = {
    classifyPlanApprovalIntent,
    classifyPlanningNeed,
    tokenizeIntentText,
    classifySimpleTask,
    buildLocalMemoryAnswer,
    getPlanningToolGate,
    normalizeChecklistTasks,
    shouldApplyChecklistUpdate,
    hasRequiredTestingPlanSection,
    STRATEGY_REQUIRED_SECTIONS,
    hasRequiredStrategySections,
    validateStrategyContent,
    strategyRequiresClarification,
    buildRefinementPrompt,
    buildOperationalContextFromStrategy,
    validateRunCommandForAgentUse,
    extractPythonScriptPath,
    commandProvidesInput,
    isLocalSystemFactRequest,
    requestNeedsLocalInspection,
    isTaskContinuationPrompt,
    isGenericNonAnswer,
    requestNeedsActionableFinalAnswer,
    answerHasActionableFinalContent,
    buildFinalAnswerQualityGatePrompt,
    shouldHaveUsedToolsButDidNot,
    isFailedToolResult,
    getToolFailureSignal,
    buildToolEvidenceEntry,
    getEpistemicToolGate,
    buildEpistemicCorrectionPrompt,
    classifyAgentFailure,
    recommendedNatureForFailureCategory,
    buildFailureRecoveryGuidance,
    isRealVerificationCommand,
    isVerificationItem,
    hasVerificationAfterLastFileEdit,
    buildPostEditEvidencePrompt,
    buildFinalVerificationSummary,
    stripEchoedSystemScaffold,
    sanitizeFinalAnswerText,
    withWorkWalkthrough,
    buildDiscoveryFromToolOutcome,
    parseModelJsonObject,
    inspectScreenshotWithGemini,
    diagnoseModelApiFailure
  };
}

function diagnoseModelApiFailure(errorText) {
  const text = String(errorText || '').toLowerCase();
  if (!text) return '';
  if (text.includes('429') || text.includes('quota') || text.includes('resource has been exhausted')) {
    return 'Diagnosis: the model provider is rate-limiting or quota-limiting requests. Orion should pause the request loop, preserve state, and resume after cooldown.';
  }
  if (text.includes('401') || text.includes('403') || text.includes('api key')) {
    return 'Diagnosis: the model request looks unauthorized. This is a hard blocker until credentials/config are fixed; Orion should preserve state and explain the exact config to check.';
  }
  if (text.includes('fetch') || text.includes('network') || text.includes('econn') || text.includes('timeout')) {
    return 'Diagnosis: this looks like a network/service availability problem. Orion should stop the repeated request loop, verify connectivity/provider status, then resume from saved state.';
  }
  return 'Diagnosis: Orion paused after the model API failed. Preserve the task state, inspect the error, change strategy, and avoid repeating the same request blindly.';
}

if (typeof module !== 'undefined' && process.env.NODE_ENV === 'test') {
  module.exports.executeTool = executeTool; // So we can test it specifically
}
