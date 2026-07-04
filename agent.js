// AGENT ENGINE FOR ANTIGRAVITY 2.0

// System Instruction for the Pair Programmer
const SYSTEM_INSTRUCTION = `You are Orion AI, the ultimate pair programmer agent running locally on the user's workspace.
Your goal is to solve the task given by the user with high quality, precision, and trust. Apply extra care on architecture, edge cases, tests, and failure recovery at every step. The operational completion gate is the sole completion authority — do not self-terminate before it clears.

VOICE AND IDENTITY:
- Own being Orion. Speak in first person as the user's local collaborator, not as a generic model reciting "I am an AI" disclaimers.
- For personal-memory questions, answer from chat context and durable memory. If you do not know or have not saved the fact, say that plainly, e.g. "I don't have your name saved yet," not "I cannot know personal information."
- Avoid distancing language like "I do not have access to personal information" unless the user asks about unavailable private data outside the conversation or memory.

MEMORY REASONING CONTRACT:
- Definition: durable memory means facts, preferences, identity details, decisions, and recurring context that the user expects Orion to carry across turns or sessions.
- Definition: private unavailable data means information the user has not provided, Orion has not observed, and Orion has no legitimate local/tool path to inspect.
- Treat user-provided identity and preferences as durable memory, not as forbidden private data.
- When the user gives a durable fact, store it with the appropriate memory tool before giving the final conversational acknowledgement.
- When the user asks what Orion knows or remembers about them, inspect durable memory if the answer is not already present in the active chat context.
- After memory tools succeed, answer naturally. Do not narrate tool use, workspace operations, policy, or system instructions.

MEMORY EXAMPLES:
- User: "My name is Jason Kinslow"
  Orion should call remember_fact with global scope and an identity-style fact, then say: "Got it, Jason. I'll remember that."
- User: "What is my name?"
  Orion should use active chat context or recall_memory, then say: "Your name is Jason Kinslow." If the fact is not known, say: "I don't have your name saved yet."
- User: "I hate keyword hacks; use stronger prompts and examples instead"
  Orion should treat this as a global preference about how the user wants Orion built and remember it.
- Bad answer pattern: "I am an AI and cannot know personal information."
- Better answer pattern: "I don't have that saved yet" or "I remember that your name is Jason Kinslow."

CRITICAL RULES:
1. PLANNING MODE DECISION: Match the process to the size of the request. Use an implementation plan only when the task is genuinely complex and requires changes: new projects, multi-file builds, architecture changes, risky migrations, security-sensitive work, or requests where the user should review direction before code changes. For small fixes, running/opening a program, running tests, setting an entry point, showing paths, pushing when explicitly asked, read-only reviews, bug hunts, audits, or narrow follow-ups, act directly without creating implementation_plan.md. If a plan is needed, first complete a Mission Refinement / Strategy Pass and write "STRATEGY.md"; only then create "implementation_plan.md", set the checklist, show the plan in chat, and pause for explicit user approval or requested revisions before modifying source files or running commands. Every implementation plan MUST include a "## Testing Plan" section that details exact commands/tests to run, expected behaviors, edge cases, success conditions, and manual checks if automated tests are unavailable.
   CLARIFICATION GATE FOR AMBIGUOUS CREATIVE TASKS: For games, simulations, apps, or creative tools where the user's request leaves KEY DESIGN DECISIONS unspecified, you MUST call the "ask_clarifying_questions" tool BEFORE writing STRATEGY.md. Do NOT write questions as text — use the tool. Do NOT say "Task finished" or any completion summary when calling this tool — the task is paused, not done. The tool pauses the agent loop and shows the user an interactive card with radio options, recommended badges, and an "Other" free-text fallback. Key design decisions that require clarification when unspecified: (a) visual style/genre (e.g., 2D pixel art vs isometric vs 3D vs top-down); (b) core gameplay mechanic/loop (what does the player actually DO?); (c) scale and performance strategy (e.g., "thousands of entities" requires a specific approach — batch rendering, spatial partitioning, ECS, etc.); (d) framework/platform when multiple are reasonable. Supply 2-3 questions with 2-4 options each; mark the recommended option with recommended: true. Only after the user answers (their answers come back as your next prompt) should you proceed to STRATEGY.md. Exception: if the user explicitly says "surprise me," "you decide," or "figure it out," skip clarification and document your bold choices in STRATEGY.md under "Design Choices."
   LOCAL PROJECTS BEFORE CLARIFICATION: If the user names a local folder, desktop project, or existing program, inspect that local project first; do not ask clarifying questions before using available local tools to see what already exists.
   REALISTIC TIME ESTIMATES: If a step needs a duration estimate, estimate for yourself (an AI agent executing tool calls back-to-back), not for a human developer. Writing/editing a file, reviewing a diff, or running a quick check each take seconds to low minutes, not "hours" of human labor — do not carry over an "hours per step" human-project-estimate style. The real time cost in a step is dominated by tool round-trips and test/build runtime, not authoring time. Prefer estimating in minutes (e.g. "~2-5 min", "~10-15 min for a step needing a full test run"), or state relative complexity (small/medium/large step) instead of a time estimate if duration is genuinely unpredictable (e.g. a long-running build or training job). Never label a step "N hours" when N is calibrated to how long a human would take to write that code by hand.
2. TESTING AND REGRESSION DISCIPLINE: When you create or change code, you are responsible for producing run-ready code. Before meaningful edits, inspect existing tests and the detected regression command when relevant. After edits, run the appropriate tests or smoke checks using "run_tests", "run_command", or the long-running command tools. If tests fail, read the output, fix the issue, and rerun tests until they pass or you can clearly explain a blocker. For long tests, training, games, and servers, use "start_command" with a sensible timeout, check status/output, and stop processes with "kill_command" when finished. Do not use an interactive command as a test unless you pipe/provide input or intentionally kill it after a short smoke check. For graphical/Pygame/interactive applications, write a non-interactive test script or design the program to accept a '--smoke-test' command-line flag that exits after a few frames/seconds, and use this flag (or run with a short timeoutMs) when validating. Do not claim code works unless you ran a relevant check or state exactly why you could not.
   PREVIEW_APP RULES: (a) Orion auto-kills the previous preview window before launching a new one — you never need to manage this manually, and you must NOT open multiple game windows yourself. (b) When preview_app fails or the screenshot shows a crash/black screen: DO NOT STOP. Run "python -m py_compile <file>" to catch syntax errors, then read the crash output with read_command_output or run_command, fix the root cause, and retry preview_app. A single failed launch is NOT a reason to end the task. (c) Always call kill_command on the processId returned by preview_app when you are finished verifying, so the window is closed.
   FILE EDIT DISCIPLINE: If you have edited the same file more than twice in a row, STOP and read_file the complete current version before making any further changes. Identify ALL remaining issues in one pass, then fix them in a single edit. Incremental micro-patches on the same file create cascading bugs and waste loops. Write complete, correct implementations the first time rather than patching incrementally.
3. WEB RESEARCH: If you are unsure about an API, library, framework, command, model parameter, error message, current behavior, or documentation detail, use "google_search" and then "fetch_web_page" on the most relevant official docs or primary source before editing. Do not use web search to answer facts about the user's local machine, workspace state, installed tools, paths, memory, disk, processes, environment variables, or runtime output; inspect local state instead. Do not invent configuration files or API shapes when files are missing or the correct implementation is unclear. Do not say you reviewed, checked, verified, or confirmed documentation unless you actually used these web tools in the current task and can name the source URL. If docs appear to say something surprising, quote or paraphrase the exact relevant rule before changing files.
4. CONTEXT INTEGRITY: Keep files clean, respect formatting, and preserve comments that are unrelated to your edits.
5. NOTES AND MEMORY: Use project/standalone notes as durable working memory. Read them when orienting, and update them when you learn durable facts: architecture, important files, commands, decisions, user preferences, gotchas, open tasks, test status, and future repair notes. Project notes are shared across every conversation in the same project; standalone notes belong only to that standalone conversation. Keep notes concise and useful, not a transcript. Additionally, use append_project_memory to persist important architectural decisions, API shapes, recurring gotchas, and per-workspace patterns so future sessions start with that context already loaded.
5A. OPERATIONAL CONTEXT: For long-running or multi-subplan goals, maintain mission, measurable win conditions, active objective/subplan, blockers, and retained discoveries with the operational-context tools. Treat operational context as canonical working state, not another chat transcript. Promote durable lessons; discard summaries of fixed errors, dead ends, and temporary output. Never mark a subplan or win condition complete without concrete evidence from tests, inspected output, or explicit user confirmation.
6. DESIGN QUALITY — NON-NEGOTIABLE: Visual polish is a hard requirement, not a nice-to-have. For ANY app, game, dashboard, or UI-facing tool, you MUST meet the following minimum bar before considering the task complete — even if the user did not explicitly ask for it:
   (a) STYLING: Use a proper CSS framework (Tailwind, MUI, Chakra, etc.) or write thorough custom CSS. Zero bare/unstyled HTML is acceptable in a delivered product. Every element must have intentional color, spacing, typography, and layout.
   (b) ANIMATIONS & TRANSITIONS: All state changes (answers revealing, score updates, screen transitions, hover/click feedback, loading states) must have smooth CSS transitions or animations. Static instant-swap UI is not polished.
   (c) RESPONSIVE: Layout must work on both mobile and desktop screen widths.
   (d) THEME COHERENCE: Use a consistent color palette, font pairing, and visual language throughout. No mismatched default browser styles.
   (e) INTERACTION FEEDBACK: Buttons must show hover/active states, inputs must have focus rings, loading must show spinners or skeletons.
   For games specifically: cohesive visual theme, animated game board, smooth reveal mechanics, clear HUD/scoreboard, satisfying start/end states, sound-readiness hooks (even if silent).
   COMPLETION GATE: A win condition for "Visual polish and animations meet professional standard" must be added to operational context for any UI project, and it must be satisfied with screenshot evidence before the task is marked complete.
   Do not rely on CDN-only frontend dependencies (such as Tailwind CDN, Chart.js CDN, icon CDNs, or remote fonts) for local production-style apps unless the user explicitly asks for CDN usage; prefer local CSS/JS or installed packages so browser console checks stay clean.
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
15. WORKSPACE AND SYSTEM-WIDE QUERIES: Prefer and prioritize files/code within the active workspace. If the user mentions a specific local folder, program, or path outside the workspace (like "on my desktop" or "in my projects folder"), ALWAYS investigate the local filesystem using your local tools (e.g., run_command, list_files, grep_search) BEFORE attempting a web search. You are fully authorized to run system commands using "run_command" to query, search, and identify paths outside the workspace folder in order to answer their questions. When the user provides an explicit absolute path, or names a project whose exact path is already known from the project list, use "change_workspace" to that verified path and then read its key files. When the user gives a fuzzy/local folder name, a dictated name, an autocorrect-prone name, or a Desktop/Projects location that has not been verified, FIRST resolve the real directory with a bounded filesystem check: run a targeted Get-ChildItem listing/search of C:\\Users\\Owner\\Desktop and C:\\Users\\Owner\\Desktop\\Projects (use -Directory, name filters, -Depth 2 or -Depth 3, and -ErrorAction SilentlyContinue). Do not make repeated guessed change_workspace calls. If change_workspace fails because the path does not exist, do not retry another guessed path until you list/search candidate directories and pick the closest real match from local evidence.
   TOP-LEVEL FOLDER LISTS: If the user asks to list folders directly on the Desktop or in a named parent folder, do a non-recursive listing only: e.g. Get-ChildItem -LiteralPath "C:\\Users\\Owner\\Desktop" -Directory | Select-Object -ExpandProperty Name. Do not add -Depth or -Recurse for a top-level list request, and do not dump nested folder trees unless the user asks for nested contents.
   EVIDENCE CONTINUITY: If an earlier step failed to find a local folder by a dictated/autocorrected name, but a later directory listing shows a close real folder name, connect that evidence back to the original request. Use the real path, change workspace, and continue the original inspection/advice task instead of asking the user to verify the spelling again.
17. SIMPLE READ-ONLY QUESTIONS: For questions like "what is this program about", "tell me what X does", "describe this project" — do NOT call "update_mission_context", "start_subplan", or "evaluate_win_conditions". These operational planning tools are for long-running multi-step tasks only. For read-only questions: navigate to the project, read the key files (README, main entry, package.json / requirements.txt), and answer directly. Never set win conditions for a question that just needs file reading.
   LOCAL PROJECT RECOMMENDATIONS: If the user asks for ideas, recommendations, comparisons, or improvements for an existing local project/folder/program, inspect that local project first, then recommend from evidence. Do not ask the user to describe what is inside before using local tools. Do not claim access is limited to explicitly provided paths when the user has named a Desktop/project location.
   WORKSPACE SELF-REFERENCE: When the user says "this code", "the code", "this program", "this project", "these files", "my code", "the app", "the whole program", or any similar self-referential phrase, they ALWAYS mean the code already in the active workspace. NEVER ask the user to provide or paste code. NEVER ask "which file?" or "which program?" when a workspace is active — read the workspace and figure it out. Call list_files immediately, then read ALL non-boilerplate source files you find (.py, .js, .ts, .html, .css, etc.) in one pass. If the root contains only cache/config files (.env, .gitignore, __pycache__, .ruff_cache, .orion, etc.), look one level deeper into subdirectories. Read first, ask never.
18. FIND VS FIX: When the user asks you to "find", "look for", "check for", "review", "audit", or "identify" bugs/typos/issues/faults — your job is ONLY to inspect and report what you found. For a broad read-only review, you may use STRATEGY.md as a private review strategy/report outline, but never create implementation_plan.md, never show an approval gate, and never start fixing things. Do NOT modify source files or propose a fix implementation plan. Present your findings clearly and ask the user which issues they want you to address. Only make changes when the user explicitly asks you to fix, patch, implement, or update something.
16. OPERATING SYSTEM AWARENESS: You are currently running on a Windows system. When guessing or constructing file paths outside the current workspace, ALWAYS use Windows path conventions (e.g., C:\\Users\\owner\\Desktop) with the literal resolved path — do NOT pass unexpanded PowerShell variables like $env:USERPROFILE as a path argument to any tool; resolve the path to a literal string first (e.g., C:\\Users\\owner). If you are unsure of the username, run 'echo $env:USERPROFILE' first. When searching for files on the Desktop or broad directories, ALWAYS limit recursive searches with '-Depth 2' or '-Depth 3' and add '-ErrorAction SilentlyContinue' to avoid timeouts from permission-denied folders. Never run an unbounded 'Get-ChildItem -Recurse' on C:\\ or the Desktop without a depth limit.

Tools available:
- list_files: List a curated project inventory by default. Generated caches, dependencies, runtime/user data, backups, and sensitive-looking files are hidden unless mode="all" is explicitly needed.
- get_workspace_info: Return the active workspace directory and conversation scope.
- change_workspace: Changes the active workspace directory of this conversation to a new absolute directory path on your computer. Use this when the user asks you to inspect or work on a project located outside the active standalone workspace folder.
- open_workspace_folder: Open the active workspace folder in the OS file explorer.
- launch_workspace_app: Launch the active workspace app using Orion's app detection. For a GUI program with an event loop (pygame, tkinter, a game window), do NOT verify it with run_command — that blocks until timeout. Use preview_app, which launches it, screenshots it, and leaves it running under your control (wait + capture_screen, read_command_output, or kill_command).
- set_workspace_entrypoint: Set or clear the launch entry point command for this workspace.
- git_push: Push the current Git branch, or the current branch to a requested remote branch, when the user asks.
- read_file: Read a file's content. For large files, first call get_symbol_index to locate the exact function/class by line number, then read only that range with startLine/endLine.
- get_symbol_index: Returns function, class, and arrow-function symbols with line numbers for every JS/TS file in the workspace. Always call this before read_file on large source files — identify the target symbol's line range first. For any source file roughly above 300 lines or a few thousand characters, prefer get_symbol_index plus a targeted read_file(startLine, endLine) over reading the whole file in one call — a full read of a large file costs many times the tokens of a scoped read and usually contains far more than the current task needs.
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
- take_screenshot: Captures the BROWSER WORKER view — use this after open_url to visually verify a web app (React, HTML, localhost dev servers). Do NOT use capture_screen for web verification; it captures the OS desktop and will show whatever app happens to be on screen, which may not be the correct page.
- inspect_screenshot, compare_screenshot_to_goal: Visual verification helpers. Use evidence honestly; do not claim visual success without screenshot evidence or observations.
- preview_app: Launches a NATIVE DESKTOP app (pygame, tkinter game window, etc.) as a persistent process, captures a desktop screenshot, and LEAVES IT RUNNING (no auto-close). ALWAYS use this — never run_command — to run or visually check a GUI program with an event loop. NOT for web apps (use start_command to run the dev server, open_url to navigate, and take_screenshot to capture the page). Returns a processId. Then decide: capture_screen again later, read_command_output to watch progress, or kill_command when done. Follow up with inspect_screenshot_with_model to judge a captured frame.
- capture_screen: Takes another OS-level desktop screenshot — for NATIVE apps (pygame, tkinter) previously launched with preview_app. Do NOT use for web apps; use open_url + take_screenshot instead.
- inspect_screenshot_with_model: Sends a workspace screenshot to the active chat LLM's multimodal vision for semantic visual inspection against a goal.
- sync_workspace_env: Safely write configured API keys/search IDs into .env-style files without exposing the secret values in chat or tool output.
- set_task_checklist: Set the UI checklist of tasks (array of {title, status}). Status can be 'pending', 'in-progress', 'completed'. Use only for milestone changes, not routine progress churn.
- step_complete: Emit after completing each step of an approved implementation plan. Orion auto-runs tests and injects a [POST-STEP VERIFICATION: ...] message. If tests fail you must fix them before the next step.
- read_project_memory: Reads the persistent per-workspace project memory: architectural decisions, API shapes, gotchas, and preferences saved from prior sessions.
- append_project_memory: Appends a durable fact to the workspace project memory. Use whenever you discover a decision, pattern, API shape, or constraint that future sessions should know.
- discover_skills: List all registered skills in the skill registry, optionally filtered by group. Call this before attempting a complex or repetitive task to check if a reusable skill already exists.
- run_skill: Execute a registered skill by name with the given inputs. Returns the skill's outputs.
- create_skill: Write, test, and register a new reusable skill. Use this when you encounter a capability gap that would benefit from a reusable, testable function. Skills authored by Orion are marked createdBy: "orion" and are available immediately after registration.
- remember_fact: Store a durable fact in global or project memory. scope="global" for cross-project facts (user habits, preferences, people), scope="project" for workspace-specific facts.
- remember_decision: Store an architectural or design decision in project memory with optional context about why it was made.
- remember_preference: Store a user preference at global or project level. Call this immediately when the user expresses how they like things done.
- recall_memory: Read memory for the given scope ("global", "project", or "all"). Call this at the start of a session with an active workspace to orient yourself.
- save_session_summary: Save what was accomplished this session: summary, decisions, discoveries, completed tasks, and open items. Call when the user says they're wrapping up or switching tasks.

SKILL REGISTRY GUIDANCE: The skill registry is a library of reusable, tested capabilities. Before starting a complex or repetitive task, call discover_skills to check if a relevant skill already exists. If a task requires a capability that doesn't exist yet and would be useful in the future, use create_skill to author it — provide the JS implementation and a test that exits 0 on success. Skills are stored persistently and shared across all conversations.

MEMORY PROTOCOL:
- SESSION START: When a workspace is active, call recall_memory with scope="all" to load project context and orient yourself before responding.
- USER PREFERENCES: When the user expresses a preference ("I like X", "always do Y", "don't do Z", "I prefer X"), call remember_preference immediately — do not wait.
- DESIGN DECISIONS: When a significant architectural or design decision is made, call remember_decision with the decision and why.
- DURABLE FACTS: When you discover a fact about the project or user that future sessions should know, call remember_fact.
- SESSION END: When the user indicates they are wrapping up, switching tasks, or says they are done, call save_session_summary with what was accomplished, what was decided, and what remains open.
- SCOPE: Global memory is for things true across all projects (user identity, habits, people, cross-project preferences). Project memory is for things specific to the current workspace.`;

// Keep track of active agent running state
let isAgentRunning = false;
let runningConversationId = null;
let agentSubStatus = '';
let agentExecutionMode = 'idle';
let resolvedHomeDir = 'C:\\Users\\Owner';
let currentAgentLogs = [];
let isStopRequested = false;
let activeRunController = null;
let stopRequestMode = 'none';
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
    description: 'Creates or updates the durable mission and measurable win conditions. Use ONLY for long-running multi-step tasks that need a plan. NEVER call for read-only questions, project descriptions, code reviews, improvement suggestions, or conversational follow-ups — answer those directly.',
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
    description: 'Captures the current browser worker view as a screenshot. USE THIS to verify web apps — after open_url navigates to a local dev server (e.g. http://localhost:3000), call take_screenshot to capture what that page looks like. This is the correct tool for web/React/HTML verification. Do NOT use capture_screen for web pages — that captures the full OS desktop, which may show a completely different browser window.',
    parameters: { type: 'OBJECT', properties: { destination: { type: 'STRING', description: 'Optional workspace-relative PNG path.' } } }
  },
  {
    name: 'preview_app',
    description: 'Launches a NATIVE DESKTOP app (e.g. a Python/pygame game, tkinter window) as a persistent process, lets it warm up, captures a desktop screenshot, and LEAVES IT RUNNING. ALWAYS use this instead of run_command for GUI programs with an event loop. Returns a screenshot path (inspect with inspect_screenshot_with_model) and a processId. After it, decide: wait and capture_screen again, read_command_output(processId) to watch progress (e.g. ML training), or kill_command(processId) when done. NOT for web apps — for web, use start_command to run the dev server then open_url + take_screenshot.',
    parameters: { type: 'OBJECT', properties: {
      command: { type: 'STRING', description: 'Optional command to run (defaults to the workspace entrypoint or an auto-detected python main file).' },
      warmupMs: { type: 'NUMBER', description: 'Optional ms to let the window render before the first capture (default 4000, max 60000).' },
      timeoutMs: { type: 'NUMBER', description: 'Optional safety backstop (ms) after which the process is auto-killed to prevent leaks (default 600000 = 10 min, max 30 min). Raise it for long training runs.' },
      destination: { type: 'STRING', description: 'Optional workspace-relative PNG path for the screenshot.' }
    } }
  },
  {
    name: 'capture_screen',
    description: 'Captures a fresh OS-level desktop screenshot — for NATIVE apps (pygame, tkinter, etc.) previously launched with preview_app. NOT for web apps: use open_url + take_screenshot instead, which captures the browser worker view of the page rather than whatever happens to be on screen. Optionally waits first (delayMs) to let the native app advance.',
    parameters: { type: 'OBJECT', properties: {
      delayMs: { type: 'NUMBER', description: 'Optional ms to wait before capturing (max 120000), to let the running app advance.' },
      destination: { type: 'STRING', description: 'Optional workspace-relative PNG path for the screenshot.' }
    } }
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
    description: 'Uses the active chat LLM multimodal vision to inspect a workspace screenshot against a goal and returns structured visual evidence.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, goal: { type: 'STRING' } }, required: ['path', 'goal'] }
  }
];

window.steeringQueue = {};
window.promptQueue = [];
window.followupTimers = window.followupTimers || {};
window.followupTimerMeta = window.followupTimerMeta || {};
window.isAgentRunning = () => isAgentRunning;
window.getRunningConversationId = () => runningConversationId;
window.getAgentSubStatus = () => agentSubStatus;
window.getAgentExecutionMode = () => agentExecutionMode;
function createUserStopError(mode = stopRequestMode || 'hard') {
  const err = new Error(mode === 'soft' ? 'Agent stop requested by user.' : 'Agent hard stop requested by user.');
  err.userStop = true;
  err.stopMode = mode;
  return err;
}

function isUserStopError(error) {
  return !!(error && (error.userStop || /stop requested by user|cancelled by user stop|aborted by user/i.test(String(error.message || ''))));
}

function getActiveRunSignal() {
  return activeRunController ? activeRunController.signal : null;
}

function requestAgentStop(options = {}) {
  const mode = options.mode === 'soft' ? 'soft' : 'hard';
  isStopRequested = true;
  stopRequestMode = mode;
  if (mode === 'hard' && activeRunController && !activeRunController.signal.aborted) {
    activeRunController.abort();
  }
  const targetConversationId = runningConversationId;
  if (targetConversationId) {
    if (mode === 'hard' && window.api.killCommandsForConversation) {
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
  const message = mode === 'soft'
    ? 'Soft stop requested. Orion will finish the current atomic step, then stop before the next turn.'
    : 'Hard stop requested. Orion is aborting model calls, killing running commands, and stopping this run.';
  window.appendSystemMessage(message, {
    dedupeKey: `stop-requested-${mode}-${targetConversationId || 'global'}`,
    windowMs: 3000
  });
}

window.stopAgentExecution = (options = {}) => {
  requestAgentStop({ mode: options.mode || 'hard' });
};
window.softStopAgentExecution = () => requestAgentStop({ mode: 'soft' });

// EXPOSE AGENT LOOP TO RENDERER
window.runAgentLoop = async function(userPrompt, modelName, conversation, options = {}) {
  if (isAgentRunning) {
    const statusText = "Another Orion task is already running. This request needs to be queued or retried after the active task finishes.";
    if (window.persistAssistantStatusMessage && conversation && conversation.id) {
      window.persistAssistantStatusMessage(conversation.id, statusText, {
        source: 'agent-start-blocked',
        dedupeKey: `agent-start-blocked-${conversation.id}`
      });
    } else if (window.appendSystemMessage) {
      window.appendSystemMessage(statusText);
    }
    return;
  }
  
  isAgentRunning = true;
  runningConversationId = conversation.id;
  agentExecutionMode = 'planning';
  isStopRequested = false;
  stopRequestMode = 'none';
  activeRunController = new AbortController();
  window.currentLoopCount = 0;
  currentAgentLogs = [];
  if (window.onAgentStatusChange) window.onAgentStatusChange(true);
  
  const config = window.getAppConfig();
  config.modelName = modelName || config.modelName || 'gemini-2.5-flash-lite';
  let activeRunModelName = config.modelName;
  config.activeRunModelName = activeRunModelName;
  // Preserved so a temporary escalation to a stronger model (see the repeated-edit-failure
  // handling below) can revert once the file it was escalated for gets a clean edit, instead of
  // silently staying on the more expensive model for the rest of the conversation.
  const userSelectedModelName = activeRunModelName;
  let modelEscalatedForEditKey = null;
  let workspacePath = resolveConversationWorkspace(conversation);
  const promptSource = options.source || 'user';
  const isInternalPrompt = !!options.internalPrompt || promptSource === 'followup' || promptSource === 'system' || promptSource === 'plan-approval';
  let lastTextResponse = "Thinking...";
  let aiMessageIndex = Array.isArray(conversation.messages) ? conversation.messages.length : 0;
  let workWalkthrough = [];
  const persistedVisualArtifactKeys = new Set();
  let forceYield = false;
  let autoContinueExecution = false;
  let userRequestedStop = false;
  let finalAnswerQualityPrompts = 0;
  let finalAnswerQualityLoopExtensions = 0;

  if (!Array.isArray(conversation.messages)) {
    conversation.messages = [];
  }
  conversation.messages.push({ role: 'assistant', text: 'Thinking...', logs: [], turns: [], createdAt: Date.now() });
  if (window.saveConversationsToStorage) {
    window.saveConversationsToStorage();
  }

  // ── INTENT ROUTING — driven by structural state, never by parsing the user's words ──
  // The dangerous flows (approval, continuation, execution) are decided entirely from
  // explicit flags:
  //   isInternalPrompt     — caller-set: a system-driven continuation (button approval,
  //                          queued follow-up). Always executes; never re-classified.
  //   awaitingPlanApproval — a plan is on screen waiting for the user's verdict.
  //   planApproved         — the user already approved; we are building/executing.
  // A small AI classifier is used ONLY where intent is genuinely ambiguous:
  //   classifyPlanApprovalIntent — a plan is pending and the user typed a free-form reply.
  //   classifyPlanningNeed       — a fresh task needs a plan/direct/answer decision.
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
  const projectMemory = (workspacePath && window.api && window.api.readProjectMemory)
    ? await window.api.readProjectMemory(workspacePath).catch(() => ({ facts: [] }))
    : { facts: [] };

  // Resolve the whole routing decision up front so message construction and the loop
  // share one consistent verdict.
  let approvalIntent = null;
  let planningDecision = { mode: 'plan', reason: 'Planning mode is active.' };
  let planningBypassedForTask = false;
  let reviewOnly = false;
  let planNeedsTestingSection = false;
  let strategyStatus = { exists: false, valid: false, missingSections: STRATEGY_REQUIRED_SECTIONS, needsClarification: false };
  let resetMissionState = false;

  if (isInternalPrompt) {
    // System-driven continuation (approved-plan execution, queued follow-up): just build.
    // planningBypassedForTask unblocks the executor and keeps the system note execution-focused.
    planningDecision = { mode: 'direct', reason: 'Internal follow-up continuing existing work.' };
    planningBypassedForTask = true;
    agentExecutionMode = 'executing';
  } else if (conversation.awaitingPlanApproval && !conversation.planApproved) {
    // The user is replying to a pending plan. The model classifies their reply.
    approvalIntent = await classifyPlanApprovalIntent(userPrompt, resolveUtilityModelName(modelName), config.geminiApiKey);
    if (approvalIntent.intent === 'approve') {
      const planText = await readImplementationPlanText(workspacePath);
      if (hasRequiredTestingPlanSection(planText)) {
        conversation.planApproved = true;
        conversation.awaitingPlanApproval = false;
        if (window.appendSystemMessage) window.appendSystemMessage("Plan approved. Continuing implementation.", { conversationId: conversation.id });
        planningDecision = { mode: 'direct', reason: 'Implementation plan approved.' };
        planningBypassedForTask = true;
        agentExecutionMode = 'executing';
      } else {
        planNeedsTestingSection = true;
        if (window.appendSystemMessage) window.appendSystemMessage("Approval rejected: The implementation plan is missing a valid '## Testing Plan' section. Please revise the plan first.", { conversationId: conversation.id });
        planningDecision = { mode: 'plan', reason: 'Plan missing Testing Plan section; revision required.' };
      }
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    } else if (approvalIntent.intent === 'deny') {
      conversation.awaitingPlanApproval = false;
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      planningDecision = { mode: 'answer', reason: 'User declined the pending plan.' };
      agentExecutionMode = 'answer';
    } else {
      // revise or unclear: address the user without executing destructive tools
      planningDecision = { mode: 'direct', reason: approvalIntent.intent === 'revise' ? 'User asked to revise the pending plan.' : 'Ambiguous reply to a pending plan.' };
      planningBypassedForTask = true;
      agentExecutionMode = 'answer';
    }
  } else if (conversation.planApproved) {
    // Already approved and building. A new user message continues/steers the same work,
    // unless the model judges it a genuinely new plan-worthy task.
    const decision = config.planningMode === false
      ? { mode: 'direct', reason: 'Planning mode disabled.' }
      : await classifyPlanningNeed(userPrompt, resolveUtilityModelName(modelName), config.geminiApiKey);
    // A mission is genuinely in progress when an active subplan still has work or any win
    // condition is unsatisfied. While that is true we must NEVER downgrade to a re-plan: doing
    // so clears planApproved and wipes the operational context (mission/subplan/win conditions),
    // which in turn disables the completion gate and auto-continue and makes the run stop
    // mid-build. A later phase that merely *sounds* plan-worthy (e.g. "ML training") must not
    // tear down the approved plan that is already executing it.
    const missionInProgress = hasOperationalMissionState(workingState) && (
      (workingState.activeSubplan && workingState.activeSubplan.status === 'active') ||
      (Array.isArray(workingState.winConditions) && workingState.winConditions.some(condition => condition.status !== 'satisfied'))
    );
    if (decision.mode === 'plan' && !missionInProgress) {
      resetMissionState = true;
      conversation.planApproved = false;
      planningDecision = decision;
    } else {
      planningDecision = { mode: 'direct', reason: missionInProgress ? 'Continuing approved plan that is still in progress.' : 'Continuing approved task.' };
      planningBypassedForTask = true;
      agentExecutionMode = 'executing';
    }
  } else if (config.planningMode === false) {
    planningDecision = { mode: 'direct', reason: 'Planning mode disabled.' };
    planningBypassedForTask = true;
    agentExecutionMode = 'direct';
  } else {
    // Fresh task, nothing pending or approved. The model decides plan / direct / answer.
    const decision = await classifyPlanningNeed(userPrompt, resolveUtilityModelName(modelName), config.geminiApiKey);
    planningDecision = decision;
    reviewOnly = !!decision.reviewOnly;
    resetMissionState = true; // a fresh task should not inherit a previous mission's state
    if (reviewOnly && planningDecision.mode === 'plan') {
      planningDecision = {
        ...planningDecision,
        mode: 'direct',
        reason: `${planningDecision.reason || ''} Review-only inspections use direct reporting with optional STRATEGY.md, not implementation approval.`.trim()
      };
    }
    if (reviewOnly) {
      planningBypassedForTask = true;
      agentExecutionMode = 'direct';
    } else if (planningDecision.mode === 'direct') {
      planningBypassedForTask = true;
      agentExecutionMode = 'direct';
    } else if (planningDecision.mode === 'answer') {
      agentExecutionMode = 'answer';
    }
  }

  // Every branch above sets planningDecision, but only the classifyPlanningNeed() branches
  // populate needsLocalInspection/benefitsFromWorkspaceContext. Fill in the regex-based signal
  // for the other branches (internal follow-ups, plan-approval replies, planning-mode-disabled)
  // so downstream gates can always read planningDecision.* without re-deriving intent themselves.
  if (planningDecision.needsLocalInspection === undefined || planningDecision.benefitsFromWorkspaceContext === undefined) {
    planningDecision = {
      needsLocalInspection: isLocalProjectOrFolderRequest(userPrompt),
      benefitsFromWorkspaceContext: requestPlausiblyBenefitsFromWorkspaceContext(userPrompt),
      ...planningDecision
    };
  }

  // Proactive model tier selection: pick capability up front instead of only reacting after
  // repeated edit failures already happened. The user's selected model is a FLOOR, never a
  // ceiling — a "deep" task (multi-file implementation, non-trivial refactor, or anything
  // plan-worthy) is upgraded one tier for the whole run, but a "light" task never downgrades
  // below what the user explicitly picked. Reuses the existing escalation family-mapping so a
  // later reactive escalation (see repeated-edit-failure handling below) still composes cleanly
  // on top of this baseline instead of fighting it.
  //
  // A deep-task upgrade must survive the WHOLE approved-plan lifecycle (planning -> approval ->
  // execution -> auto-continue), not just the single call where classifyPlanningNeed happened to
  // return "deep". Plan-approval replies and internal follow-ups re-enter runAgentLoop as fresh
  // calls with a fresh local activeRunModelName, and their own planningDecision never carries
  // taskComplexity (only classifyPlanningNeed sets it) — without persisting the decision on the
  // conversation object, the upgrade silently evaporates right as real execution starts, which is
  // exactly when the model most needs the extra capability.
  if (resetMissionState) {
    // A genuinely new task: forget any previous mission's upgrade and let it recompute fresh.
    delete conversation._proactiveDeepTaskModel;
    delete conversation._proactiveDeepTaskBaseModel;
  }
  const taskComplexity = planningDecision.taskComplexity || (planningDecision.mode === 'plan' ? 'deep' : 'standard');
  if (taskComplexity === 'deep') {
    const upgraded = getNextGeminiModelForHighDemand(userSelectedModelName);
    if (upgraded) {
      activeRunModelName = upgraded;
      config.activeRunModelName = activeRunModelName;
      conversation._proactiveDeepTaskModel = upgraded;
      conversation._proactiveDeepTaskBaseModel = userSelectedModelName;
      currentAgentLogs.push(`[Model] Proactively using ${activeRunModelName} for this deep task (upgraded from ${userSelectedModelName}).`);
      if (window.appendSystemMessage) window.appendSystemMessage(`Using ${activeRunModelName} for this task — it looks like it needs a stronger model than ${userSelectedModelName}.`, { conversationId: conversation.id });
    }
  } else if (conversation._proactiveDeepTaskModel && conversation._proactiveDeepTaskBaseModel === userSelectedModelName) {
    // This call didn't freshly classify complexity (a plan-approval reply, an internal follow-up,
    // or an already-approved continuation) but a deep-task upgrade is still active for the
    // current unresolved mission and the user hasn't changed their model selection since — keep
    // using it instead of reverting to the base model mid-execution.
    activeRunModelName = conversation._proactiveDeepTaskModel;
    config.activeRunModelName = activeRunModelName;
  }

  // A genuinely new task resets the auto-continue budget and stall tracking so prior runs
  // cannot starve it.
  if (resetMissionState) {
    conversation._planExecAutoContinues = 0;
    conversation._stallPasses = 0;
    conversation._lastProgressScore = -1;
  }

  // Surface a direct-task decision once, in one consistent place.
  if (!isInternalPrompt && !conversation.planApproved && window.appendSystemMessage && planningBypassedForTask && planningDecision.mode === 'direct' && agentExecutionMode === 'direct') {
    window.appendSystemMessage(`Planning mode: direct task, no implementation plan required. ${planningDecision.reason || ''}`.trim());
  }

  // Structural reset of stale mission state for genuinely new work. This only clears whatever
  // workspace is active right now; if change_workspace moves the turn to a different directory
  // mid-run (e.g. resolving a named project), the same reset is re-applied there — see the
  // change_workspace handling in the tool-execution loop below.
  if (resetMissionState && workspacePath) {
    const cleared = await clearStaleMissionStateIfPresent(workspacePath);
    if (cleared) workingState = cleared;
  }

  // Canonical operational state seeds reasoning. Conversation remains a bounded UI/input view;
  // old model and tool turns are deliberately not replayed as task truth.
  let messages = OperationalContext.buildReasoningMessages(workingState, conversation.messages, promptForModel);

  // OC injection optimization: subsequent turns inject a short header instead of full OC state
  const OC_SHORT_HEADER = '[Operational context on file — request specific sections if needed: goals, current_task, do_not_touch, notes]';
  let useOCShortHeader = false;
  if (resetMissionState) conversation._ocFirstTurnDone = false;
  if (hasOperationalMissionState(workingState) && conversation._ocFirstTurnDone) {
    useOCShortHeader = true;
    if (messages[0] && messages[0].parts && messages[0].parts[0]) {
      messages[0].parts[0].text = OC_SHORT_HEADER;
    }
  } else if (hasOperationalMissionState(workingState)) {
    conversation._ocFirstTurnDone = true;
  }

  const refreshWorkingStateMessage = () => {
    if (useOCShortHeader) return;
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

  if (projectMemory.facts && projectMemory.facts.length > 0) {
    const memText = projectMemory.facts.map((f, i) => `${i + 1}. [${f.category || 'general'}] ${f.text}`).join('\n');
    messages.splice(2, 0,
      { role: 'user', parts: [{ text: `[ORION PROJECT MEMORY]\nPersistent workspace facts from prior sessions. Reference these when relevant.\n\n${memText}` }] },
      { role: 'model', parts: [{ text: 'Understood. I have the workspace project memory loaded.' }] }
    );
  }

  // Inject resolved system facts so the model never needs to probe for the home directory
  messages.splice(2, 0,
    {
      role: 'user',
      parts: [{ text: `[ORION SYSTEM FACTS]\nUser home directory (resolved): ${resolvedHomeDir}\nDesktop projects folder: ${resolvedHomeDir}\\Desktop\\projects\nActive conversation workspace (resolved): ${workspacePath || '(none)'}\nIf the user's latest message says "this program", "the program", "read through it", "where do we go from here", or otherwise follows up on the same project, use the active conversation workspace above as the target. Do not re-run change_workspace for an older dictated/autocorrected folder phrase after a real workspace has already been resolved.\nDo NOT run echo or whoami to discover these paths — use the values above directly.` }]
    },
    {
      role: 'model',
      parts: [{ text: `Understood. Home directory is ${resolvedHomeDir}. I will use this directly without probing.` }]
    }
  );

  // Strategy gate prep: only a fresh plan-worthy task that has not been approved needs it.
  if (!planningBypassedForTask && planningDecision.mode === 'plan' && config.planningMode !== false && !conversation.planApproved && !isInternalPrompt) {
    strategyStatus = await readStrategyStatus(workspacePath);
  }

  // Approval-reply system notes (revise / unclear / approved-but-invalid).
  if (planNeedsTestingSection) {
    messages.push({
      role: 'user',
      parts: [{
        text: `[SYSTEM: The user approved the plan, but it is missing the mandatory '## Testing Plan' section. Update implementation_plan.md to add it now, then pause for approval again.]`
      }]
    });
  } else if (approvalIntent && approvalIntent.intent === 'unclear') {
    if (window.appendSystemMessage) {
      window.appendSystemMessage("A plan is waiting for approval. Approve it to start, or tell me what to change.", { conversationId: conversation.id });
    }
    messages.push({
      role: 'user',
      parts: [{ text: '[SYSTEM: A plan is awaiting approval and the user sent an ambiguous reply. Briefly summarize what the plan will build and ask them to approve or describe changes. Do not modify files.]' }]
    });
  }

  messages.push({
    role: 'user',
    parts: [{
      text: buildToolUseContractPrompt()
    }]
  });

  if (config.planningMode !== false) {
    const reviewOnlyConstraint = reviewOnly
      ? ' CRITICAL: The user asked you to FIND issues, not fix them. Treat the active workspace as the program under review. First inspect workspace inventory, then read the main entry points, adjacent modules, config/package files, and tests where present. A completed review must contain concrete findings tied to file paths and line/function context, severity/impact, or clearly say no specific issues were found after naming the files inspected. Do NOT stop after one file with generic potential risks. Do NOT ask which program to inspect or whether to continue inspecting. For a broad review, STRATEGY.md is allowed only as a private review strategy/report outline. Do NOT create implementation_plan.md, do NOT modify source files, do NOT start fixing issues, and do NOT ask to approve a fix plan. End by summarizing what you found and asking the user which issues they want you to address.'
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

  function persistCurrentAgentLogs(options = {}) {
    const msg = conversation.messages[aiMessageIndex];
    if (!msg) return;
    msg.text = lastTextResponse;
    msg.logs = [...currentAgentLogs];
    if (window.saveConversationsToStorage) {
      window.saveConversationsToStorage();
    }
    if (options.render && window.renderAiMessage) {
      window.renderAiMessage(lastTextResponse, currentAgentLogs, conversation.id, msg);
    }
  }
  
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
      const tokenCount = await countTokens(messages, resolveUtilityModelName(modelName), config.geminiApiKey, { signal: getActiveRunSignal() });
      console.log("Current conversation tokens:", tokenCount);
      const compactThreshold = getCompactionThreshold(modelName, config);
      if (config.autoCompact !== false && tokenCount > compactThreshold) {
        window.appendSystemMessage(`Context reached ${tokenCount} tokens; compacting for ${modelName} at threshold ${compactThreshold}.`);
        const compactResult = await compactHistory(messages, resolveUtilityModelName(modelName), config.geminiApiKey);
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
      if (isUserStopError(e)) throw e;
      console.error("Token count/compacting error:", e);
    }
    
    // Run the agent execution loop
    let loopCount = 0;
    let maxLoops = reviewOnly ? 40 : 20;
    // An approved multi-phase plan (mission state present and execution allowed) needs far more
    // model turns than a one-shot task. Give it substantially more room so it does not stop
    // mid-build and falsely report completion. The completion gate still governs when it ends.
    const executingApprovedPlan = (!config.planningMode || conversation.planApproved || planningBypassedForTask)
      && hasOperationalMissionState(workingState);
    if (executingApprovedPlan && !reviewOnly) maxLoops = 100;
    let planValidationRetries = 0;
    let consecutiveNoToolCalls = 0;
    let malformedCallsCount = 0;
    let maxTokensContinuations = 0;
    let postEditEvidencePrompts = 0;
    let postEditEvidenceLoopExtensions = 0;
    let completionGatePrompts = 0;
    let completionGateLoopExtensions = 0;
    let reviewCompletionPrompts = 0;
    let reviewCompletionLoopExtensions = 0;
    let pendingWorkspaceResolutionPrompts = 0;
    let memoryNudgeSent = false;
    const repeatedToolFailures = new Map();
    const fileEditCounts = new Map();
    const fileNeedsReadBeforeEdit = new Set(); // files that must be read before the next edit
    // Files whose most recent write/modify/patch embedded a SYNTAX ERROR/REGRESSION DETECTED
    // warning and haven't been fixed since. Without this, a run can break file A, move on and
    // break file B and C too, leaving three broken files instead of fixing A before continuing —
    // exactly what a real transcript showed happening across Barracks.js/ArcheryRange.js/Spearman.js.
    const brokenFiles = new Map(); // path (lowercased) -> reason string
    // Counts consecutive edits to the same file that each introduced a NEW syntax/regression
    // error. A patch_file result that embeds a syntax warning still reports success:true, so it
    // never registers with the ordinary repeated-tool-failure counter below — a transcript showed
    // four consecutive replace_range attempts on the same file each reintroduce a fresh syntax
    // error (miscalculated line ranges drifting after each edit) with zero escalation ever firing.
    const consecutiveEditFailureCounts = new Map(); // path (lowercased) -> streak count
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
        userRequestedStop = true;
        isStopRequested = false;
        const mode = stopRequestMode;
        lastTextResponse = mode === 'soft' ? "Task stopped by user after the current step." : "Task aborted by user.";
        currentAgentLogs.push({ type: 'thought', content: mode === 'soft' ? "Stop requested by user; stopping before the next turn." : "Task execution stopped by user." });
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
        agentSubStatus = `Calling ${activeRunModelName.startsWith('gemini-') ? 'Gemini' : 'Ollama (' + activeRunModelName + ')'} API...`;
        persistCurrentAgentLogs({ render: true });
        const modelCallDelayMs = Math.min(Math.max(parseInt(config.modelCallDelayMs, 10) || 0, 0), 60000);
        if (modelCallDelayMs > 0) {
          agentSubStatus = `Waiting ${modelCallDelayMs}ms before the next model call...`;
          window.renderAiMessage(lastTextResponse, currentAgentLogs);
          await sleepRespectingStop(modelCallDelayMs);
        }
        
        // Send a trimmed copy for this call only — the canonical `messages` array (used for
        // compaction's real token count and any future turn) keeps the full untrimmed history.
        const messagesForApiCall = trimAgedToolResultsFromMessages(messages);
        if (activeRunModelName.startsWith('gemini-')) {
          response = await callGeminiAPI(messagesForApiCall, activeRunModelName, config.geminiApiKey, (warningMsg) => {
            agentSubStatus = warningMsg;
            conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
            window.renderAiMessage(lastTextResponse, currentAgentLogs);
          }, false, { signal: getActiveRunSignal() });
        } else {
          response = await callOllamaAPI(messagesForApiCall, activeRunModelName, (warningMsg) => {
            agentSubStatus = warningMsg;
            conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
            window.renderAiMessage(lastTextResponse, currentAgentLogs);
          }, false, { signal: getActiveRunSignal() });
        }
        if (response && response._orionActiveModelName) {
          activeRunModelName = response._orionActiveModelName;
          config.activeRunModelName = activeRunModelName;
        }
        if (isStopRequested) {
          userRequestedStop = true;
          isStopRequested = false;
          lastTextResponse = stopRequestMode === 'soft' ? "Task stopped by user after the current model call." : "Task aborted by user.";
          currentAgentLogs.push({ type: 'thought', content: stopRequestMode === 'soft' ? "Stop requested by user; stopping before tool execution." : "Task execution stopped by user." });
          conversation.messages[aiMessageIndex].text = lastTextResponse;
          break;
        }
        agentSubStatus = 'Processing model response...';
      } catch (e) {
        if (isUserStopError(e)) {
          userRequestedStop = true;
          isStopRequested = false;
          lastTextResponse = stopRequestMode === 'soft' ? "Task stopped by user after the current step." : "Task aborted by user.";
          currentAgentLogs.push({ type: 'thought', content: stopRequestMode === 'soft' ? "Stop requested by user; stopping before the next turn." : "Task execution stopped by user." });
          conversation.messages[aiMessageIndex].text = lastTextResponse;
          break;
        }
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
            conversation.messages[aiMessageIndex].text = lastTextResponse;
            window.renderAiMessage(lastTextResponse, currentAgentLogs);
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
        if (candidate.finishReason === "MALFORMED_FUNCTION_CALL") {
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

          if (malformedCallsCount < maxMalformedToolRetries) {
            messages.push({
              role: 'user',
              parts: [{ text: `[SYSTEM: ${buildMalformedFunctionCallGuidance(malformedCallsCount)}]` }]
            });
            continue;
          }

          // All retries exhausted — inject recovery context and break cleanly.
          lastTextResponse = 'Tool calls failed repeatedly due to a malformed response. The last attempted operation was not executed. Resuming from saved state on next continuation.';
          conversation.messages[aiMessageIndex].text = lastTextResponse;
          currentAgentLogs.push({ type: 'thought', content: '⚠️ MALFORMED_FUNCTION_CALL retries exhausted — breaking cleanly for auto-continue recovery.' });
          break;
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
      
      // Process text and thoughts. Gemini's thinking mode can return an internal "thought"
      // segment as its own part alongside the real answer; naively concatenating every part.text
      // together (with no separator) produced a visible answer that ran two near-duplicate drafts
      // of the same content directly into each other with no paragraph break. Thought parts are
      // draft reasoning, not the answer, so they must not contribute to the visible text at all.
      let textVal = '';
      let functionCalls = [];

      parts.forEach(part => {
        if (part.text && !part.thought) {
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
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      if (functionCalls.length > 0) {
        window.renderAiMessage(lastTextResponse, currentAgentLogs);
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
        if (shouldHaveUsedToolsButDidNot(textVal, workWalkthrough, userPrompt, {
          reviewOnly,
          needsLocalInspection: planningDecision.needsLocalInspection,
          benefitsFromWorkspaceContext: planningDecision.benefitsFromWorkspaceContext
        }) && consecutiveNoToolCalls < 3 && loopCount < maxLoops) {
          const guidance = buildFailureRecoveryGuidance(classifyAgentFailure({
            category: 'model_no_tool_use',
            errorText: textVal
          }));
          const localInspectionGuidance = buildLocalInspectionNoToolGuidance(userPrompt, planningDecision);
          const workspaceInspectionGuidance = reviewOnly
            ? ' The user asked you to inspect the active workspace and report findings. Call `list_files` now, then read the relevant source files with `read_file`. Do not ask the user which files or program to inspect when a workspace is already active.'
            : '';
          // Telling the model only what NOT to do ("don't mention tools or this correction") gives
          // it nothing concrete to answer instead — a small model tends to just describe the
          // correction in its own words rather than follow it. Quoting the user's actual message
          // back gives it something concrete to respond to, on top of whatever specific redirection
          // (local-project/workspace-review) already applies.
          const directAnswerGuidance = ` Directly write your natural reply to the user's message now, continuing the conversation as if answering for the first time. The user's message was: "${String(userPrompt || '').replace(/"/g, "'").slice(0, 500)}"`;
          messages.push({
            role: 'user',
            parts: [{
              text: `[SYSTEM: ${guidance}${localInspectionGuidance}${workspaceInspectionGuidance}${directAnswerGuidance}]`
            }]
          });
          continue;
        }
        if (looksLikeLeakedNoToolCorrection(textVal) && (workWalkthrough || []).length === 0 && consecutiveNoToolCalls < 3 && loopCount < maxLoops) {
          messages.push({
            role: 'user',
            parts: [{
              text: `[SYSTEM: Your last reply described an internal correction instead of answering. Do not mention tools, workspace status, or any correction at all. Write only your direct, natural reply to the user's message now: "${String(userPrompt || '').replace(/"/g, "'").slice(0, 500)}"]`
            }]
          });
          continue;
        }
        if (isGenericNonAnswer(textVal) && (planningDecision.needsLocalInspection || isLocalSystemFactRequest(userPrompt)) && (workWalkthrough || []).length === 0) {
          lastTextResponse = 'I did not produce a real answer. This question needs local system inspection first, so I should run commands to check CPU/RAM/disk or clearly explain why that evidence cannot be gathered.';
          break;
        }
        if (reviewOnly && (workWalkthrough || []).length === 0) {
          lastTextResponse = 'I did not inspect the workspace, so this is not a real review yet. I need to list the workspace files, read the relevant source files, and then report the findings.';
          break;
        }
        if (!reviewOnly && (workWalkthrough || []).length === 0 && !hasPriorWorkspaceInspection(conversation) &&
            planningDecision.benefitsFromWorkspaceContext && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: This request touches on this app\'s own features/codebase and no workspace inspection has happened yet in this conversation. Before answering, call `list_files`, then read the most relevant existing feature file(s) so your answer is grounded in what this codebase already has, rather than generic suggestions unrelated to the real implementation. Then answer the user\'s actual request.]'
            }]
          });
          continue;
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
        const reviewCompletionPrompt = reviewOnly ? buildReviewOnlyCompletionGatePrompt(userPrompt, textVal, workWalkthrough) : '';
        if (reviewCompletionPrompt && loopCount >= maxLoops && reviewCompletionLoopExtensions < 3) {
          reviewCompletionLoopExtensions++;
          maxLoops++;
        }
        if (reviewCompletionPrompt && reviewCompletionPrompts < 3 && loopCount < maxLoops) {
          reviewCompletionPrompts++;
          currentAgentLogs.push({ type: 'thought', content: 'Review completion gate: review-only work needs broad enough coverage and grounded findings before final response.' });
          messages.push({ role: 'user', parts: [{ text: reviewCompletionPrompt }] });
          continue;
        }
        // In review-only mode, always nudge the model to keep reading files until it explicitly signals completion
        if (reviewOnly && consecutiveNoToolCalls === 1 && workWalkthrough.length > 0 && loopCount < maxLoops) {
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
        const pendingWorkspaceResolutionPrompt = buildPendingWorkspaceResolutionCorrectionPrompt(textVal, workWalkthrough);
        if (pendingWorkspaceResolutionPrompt && pendingWorkspaceResolutionPrompts < 2 && loopCount < maxLoops) {
          pendingWorkspaceResolutionPrompts++;
          currentAgentLogs.push({ type: 'thought', content: 'Directory resolution continuity guard: a later folder listing revealed the missing workspace match.' });
          messages.push({ role: 'user', parts: [{ text: pendingWorkspaceResolutionPrompt }] });
          continue;
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
        // The completion gate must hold back a premature final answer whenever there is a real
        // mission/subplan in flight and we are allowed to execute — regardless of whether routing
        // labeled this turn 'executing' or 'direct'. Gating on 'executing' alone let a resumed
        // approved plan slip straight to "Task finished" with most of the work still pending.
        if (hasOperationalMissionState(workingState) && canExecuteThisTask() && agentExecutionMode !== 'answer') {
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
        } else if (canExecuteThisTask() && agentExecutionMode !== 'answer') {
          // No mission/plan state governs this turn (e.g. a small "direct" edit outside the full
          // STRATEGY/plan/approval flow), so the richer completion gate above never runs. The
          // soft evidence nudge earlier in this block (buildPostEditEvidencePrompt) is capped at
          // postEditEvidencePrompts attempts and gives up silently once exhausted — without a
          // hard stop here, a run could finish "done" having changed real source files with zero
          // test/smoke verification. If execution reaches this point, either verification already
          // happened, or the soft nudge budget is exhausted and the model still didn't verify —
          // in the latter case, stop honestly instead of finishing silently.
          const filesTouchedThisRun = [...new Set(workWalkthrough.filter(isFileMutationItem).map(item => item.path))]
            .filter(path => !isImplementationPlanPath(path) && !isStrategyPath(path));
          if (filesTouchedThisRun.length > 0 && hasUnresolvedRegressionWarning(workWalkthrough)) {
            lastTextResponse = `I changed source file(s) (${filesTouchedThisRun.map(path => `\`${path}\``).join(', ')}) and the regression test check that ran after one of these edits FAILED — this is not unverified, it is verified and broken. This is not complete — ask me to continue and I should read the failing output, fix what broke, and rerun the check until it passes before doing anything else.`;
            break;
          }
          if (filesTouchedThisRun.length > 0 && !hasVerificationAfterLastFileEdit(workWalkthrough)) {
            lastTextResponse = `I changed source file(s) (${filesTouchedThisRun.map(path => `\`${path}\``).join(', ')}) but did not verify the change with a real test, smoke check, or manual run. This is not complete — ask me to continue and I should run the appropriate check (run_tests, run_command, or a manual smoke check) and confirm it passes, or clearly explain why no check is possible.`;
            break;
          }
          if (workWalkthrough.some(isAppLaunchItem) && !hasVerificationAfterLastAppLaunch(workWalkthrough)) {
            lastTextResponse = `I launched the workspace app, but launching only confirms the OS accepted the spawn call — it does not confirm the app is actually running. I did not verify it with a screenshot, a URL check, or reading its output. This is not complete — ask me to continue and I should check with open_url, capture_screen, or read_command_output before assuming it launched successfully.`;
            break;
          }
        }
        if (!memoryNudgeSent && !reviewOnly && turnDidSubstantiveInspection(workWalkthrough) &&
            !turnAlreadyWroteMemory(workWalkthrough) && !isGenericNonAnswer(textVal) && loopCount < maxLoops) {
          memoryNudgeSent = true;
          currentAgentLogs.push({ type: 'thought', content: 'Memory gate: substantial workspace inspection happened this turn; nudging Orion to persist any durable facts before finishing.' });
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: You just did substantial workspace inspection. If you discovered a durable architectural fact, API shape, gotcha, or decision that future sessions should know, call append_project_memory, remember_fact, or remember_decision now (1-3 concise entries) before your final answer. If nothing new/durable was learned, skip this and answer normally.]'
            }]
          });
          continue;
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
        }
        window.renderAiMessage(lastTextResponse, currentAgentLogs);
        
        // Safety gate for planning mode
        if (!canExecuteThisTask() && config.planningMode && planningDecision.mode === 'plan' && (
          (toolName === 'write_file' && (isImplementationPlanPath(args.path) || isStrategyPath(args.path))) ||
          toolName === 'modify_file' || toolName === 'patch_file' || toolName === 'run_command' || toolName === 'start_command' || toolName === 'run_tests'
        )) {
          strategyStatus = await readStrategyStatus(workspacePath);
        }
        const reviewGate = reviewOnly ? getReviewOnlyToolGate(toolName, args) : { allowed: true, reason: '' };
        if (!reviewGate.allowed) {
          const failure = classifyAgentFailure({
            toolName,
            args,
            errorText: reviewGate.reason
          });
          const guidance = buildFailureRecoveryGuidance(failure);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = reviewGate.reason;

          toolResponseParts.push({
            functionResponse: {
              name: toolName,
              response: { error: reviewGate.reason, failureCategory: failure.category, recoveryGuidance: guidance }
            }
          });
          const transition = await recordToolOutcomeInWorkingState(workspacePath, toolName, args, { error: reviewGate.reason, failureCategory: failure.category });
          if (transition && transition.state) {
            workingState = transition.state;
            refreshWorkingStateMessage();
          }
          updateWalkthroughItem(walkthroughItem, toolName, args, { error: reviewGate.reason, failureCategory: failure.category }, new Error(reviewGate.reason));
          persistCurrentAgentLogs({ render: true });
          continue;
        }
        const planningGate = getPlanningToolGate(config, canExecuteThisTask(), toolName, args, {
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
          persistCurrentAgentLogs({ render: true });
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
          persistCurrentAgentLogs({ render: true });
          continue;
        }
        
        // Launch-only scope guard: a plain "launch/run this" request is low-risk and read-only —
        // it does not authorize repeated source edits just because the launch failed on a
        // pre-existing bug. Block the first edit attempt this turn and require the model to report
        // the failure and ask before making changes, instead of silently starting to fix code
        // nobody asked it to touch.
        if ((toolName === 'write_file' || toolName === 'modify_file' || toolName === 'patch_file') &&
            !workWalkthrough.some(isFileMutationItem) &&
            looksLikeLaunchOnlyRequest(userPrompt) &&
            hasFailedLaunchAttemptThisRun(workWalkthrough)) {
          const blockMsg = `EDIT BLOCKED: The user only asked you to launch/run this program — that is a low-risk, read-only request. The launch failed because of a pre-existing issue, but nothing authorized you to start editing source files to fix it. Do not make this edit. Instead, explain what failed and why, and ask the user whether they want you to attempt a fix before making any changes.`;
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = blockMsg;
          updateWalkthroughItem(walkthroughItem, toolName, args, { error: blockMsg }, new Error(blockMsg));
          toolResponseParts.push({ functionResponse: { name: toolName, response: { error: blockMsg, blocked: 'launch_only_scope' } } });
          persistCurrentAgentLogs({ render: true });
          continue;
        }

        // Hard thrash guard: block repeated edits to the same file without an intervening read
        if ((toolName === 'write_file' || toolName === 'modify_file' || toolName === 'patch_file') && args.path) {
          const editKey = String(args.path).toLowerCase();
          if (fileNeedsReadBeforeEdit.has(editKey)) {
            const blockMsg = `EDIT BLOCKED: You have already edited ${args.path} multiple times without reading it. Call read_file on this file first to see the actual current state before making further changes. Incremental patches without reading create cascading bugs.`;
            currentAgentLogs[logIndex].status = 'error';
            currentAgentLogs[logIndex].result = blockMsg;
            updateWalkthroughItem(walkthroughItem, toolName, args, { error: blockMsg }, new Error(blockMsg));
            toolResponseParts.push({ functionResponse: { name: toolName, response: { error: blockMsg, blocked: 'read_required' } } });
            persistCurrentAgentLogs({ render: true });
            continue;
          }
        }

        // Cross-file breakage guard: if a previous edit left another file with an unresolved
        // syntax error or regression, block edits to any OTHER file until that one is fixed.
        // Without this, a run can leave a trail of broken files instead of fixing each one before
        // moving on — the finish-time hasUnresolvedRegressionWarning gate never catches this
        // because the model keeps calling tools and never tries to produce a final answer.
        if ((toolName === 'write_file' || toolName === 'modify_file' || toolName === 'patch_file') && args.path && brokenFiles.size > 0) {
          const editKey = String(args.path).toLowerCase();
          const otherBroken = [...brokenFiles.entries()].find(([key]) => key !== editKey);
          if (otherBroken) {
            const { path: brokenPath, reason } = otherBroken[1];
            const blockMsg = `EDIT BLOCKED: \`${brokenPath}\` was left with an unresolved ${reason} from a previous edit. Fix and re-verify that file before editing ${args.path}. Read \`${brokenPath}\`, correct the issue, and confirm the syntax check or regression test passes first.`;
            currentAgentLogs[logIndex].status = 'error';
            currentAgentLogs[logIndex].result = blockMsg;
            updateWalkthroughItem(walkthroughItem, toolName, args, { error: blockMsg }, new Error(blockMsg));
            toolResponseParts.push({ functionResponse: { name: toolName, response: { error: blockMsg, blocked: 'fix_other_file_first', brokenPath } } });
            persistCurrentAgentLogs({ render: true });
            continue;
          }
        }

        // Execute the tool
        let result;
        try {
          result = await executeTool(toolName, args, workspacePath, config, conversation);
          if (result && result._forceYield) {
            forceYield = true;
            delete result._forceYield;
          }
          if (toolName === 'change_workspace' && result && result.success) {
            workspacePath = conversation.workspace;
            // A fresh (non-approved-plan) task must not inherit whatever mission/blockers happen
            // to already exist in the workspace this landed on — otherwise an old, unrelated
            // mission (e.g. from a shared parent "projects" folder holding many past sessions)
            // can make the completion gate report today's unrelated request as "blocked."
            if (resetMissionState) {
              const cleared = await clearStaleMissionStateIfPresent(workspacePath);
              if (cleared) workingState = cleared;
            }
          }
          currentAgentLogs[logIndex].status = isFailedToolResult(result) ? 'error' : 'success';
          currentAgentLogs[logIndex].result = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          updateWalkthroughItem(walkthroughItem, toolName, args, result, null);
          persistVisualArtifactForTool({
            conversation,
            userPrompt,
            modelName: config.modelName || 'gemini-2.5-flash-lite',
            workspacePath,
            toolName,
            args,
            result,
            persistedVisualArtifactKeys
          });
        } catch (err) {
          console.error(err);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = err.message;
          result = { error: err.message };
          updateWalkthroughItem(walkthroughItem, toolName, args, result, err);
        }

        const pendingResolutionHint = buildPendingWorkspaceResolutionHint({ toolName, args, result, conversation });
        if (pendingResolutionHint) {
          result.localDirectoryResolution = pendingResolutionHint;
          result.summary = pendingResolutionHint.guidance;
          if (walkthroughItem) {
            walkthroughItem.localDirectoryResolution = pendingResolutionHint;
            walkthroughItem.detail = `Matched pending folder: \`${pendingResolutionHint.matchedPath}\``;
          }
          currentAgentLogs.push({
            type: 'thought',
            content: `Resolved likely workspace folder: "${pendingResolutionHint.requestedName}" -> ${pendingResolutionHint.matchedPath}`
          });
          currentAgentLogs[logIndex].result = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
        }

        if (toolName === 'change_workspace' && isFailedToolResult(result)) {
          const failureText = getToolFailureSignal(result);
          const failure = classifyAgentFailure({ toolName, args, result, errorText: failureText });
          if (failure.category === 'workspace_path_missing') {
            rememberPendingWorkspaceResolution(conversation, args.path, userPrompt);
          }
        } else if (toolName === 'change_workspace' && result && result.success) {
          clearPendingWorkspaceResolution(conversation);
        }
        persistCurrentAgentLogs({ render: true });

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
          const failureKey = (toolName === 'run_command' || toolName === 'start_command')
            ? buildRepeatedFailureKey(toolName, args, baseFailure.category)
            : `${toolName}:${stableStringify(args)}:${String(resultError).slice(0, 240)}`;
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
            persistCurrentAgentLogs({ render: true });
            forceYield = true;
            break;
          }
          if (failureCount === 2) {
            await checkpointOperationalContext(workspacePath, 'tool_failure', `${toolName} repeated a ${baseFailure.category} failure.`, guidance);
            currentAgentLogs.push({ type: 'thought', content: `Repeated ${toolName} failure detected (${baseFailure.category}). ${guidance}` });
            if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
              result.repeatedFailureWarning = guidance;
            }
            persistCurrentAgentLogs({ render: true });
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

        // File thrash tracking: after a successful edit, require a read before the next edit.
        // The pre-execution block above enforces this — here we update the tracking state.
        if ((toolName === 'write_file' || toolName === 'modify_file' || toolName === 'patch_file') && args.path && !isFailedToolResult(result)) {
          const editKey = String(args.path).toLowerCase();
          const editCount = (fileEditCounts.get(editKey) || 0) + 1;
          fileEditCounts.set(editKey, editCount);
          if (editCount >= 2) {
            // Mark this file as requiring a read before the next edit
            fileNeedsReadBeforeEdit.add(editKey);
          }
          // A successful code edit resets app-launch failure counters so the repeated-failure
          // guard doesn't block the next launch attempt after a legitimate code fix.
          for (const key of [...repeatedToolFailures.keys()]) {
            if (key.startsWith('preview_app:') || key.startsWith('run_command:')) {
              repeatedToolFailures.delete(key);
            }
          }
          // Track/clear broken-file state for the cross-file breakage guard above.
          const editMessage = result && typeof result.message === 'string' ? result.message : '';
          const introducedFailure = /SYNTAX ERROR DETECTED/.test(editMessage) || /REGRESSION DETECTED/.test(editMessage);
          if (/SYNTAX ERROR DETECTED/.test(editMessage)) {
            brokenFiles.set(editKey, { reason: 'syntax error', path: args.path });
          } else if (/REGRESSION DETECTED/.test(editMessage)) {
            brokenFiles.set(editKey, { reason: 'regression (test suite failure)', path: args.path });
          } else {
            // This edit to this exact file came back clean — it's no longer blocking other files.
            brokenFiles.delete(editKey);
          }
          if (introducedFailure) {
            const failureStreak = (consecutiveEditFailureCounts.get(editKey) || 0) + 1;
            consecutiveEditFailureCounts.set(editKey, failureStreak);
            if (failureStreak >= 3 && result && typeof result === 'object' && !Array.isArray(result)) {
              const escalation = await buildRepeatedEditFailureEscalation(workspacePath, args.path, failureStreak);
              result.message = `${result.message || ''}\n\n${escalation}`;
              // Repeated syntax/regression errors on the same file despite a strategy-change nudge
              // suggest the current model can't reliably reconstruct this file's code, not just a
              // tooling gap — escalate to a stronger model for the turns needed to fix it, then
              // revert once this file gets a clean edit so the rest of the run doesn't silently
              // stay on the more expensive model.
              if (!modelEscalatedForEditKey) {
                const strongerModel = activeRunModelName.startsWith('gemini-') ? getNextGeminiModelForHighDemand(activeRunModelName) : null;
                if (strongerModel) {
                  modelEscalatedForEditKey = editKey;
                  activeRunModelName = strongerModel;
                  config.activeRunModelName = strongerModel;
                  const escalationNote = `Escalating to ${strongerModel} after ${failureStreak} consecutive syntax/regression errors editing ${args.path}.`;
                  currentAgentLogs.push({ type: 'thought', content: escalationNote });
                  if (window.appendSystemMessage) window.appendSystemMessage(escalationNote, { conversationId: conversation.id });
                }
              }
            }
          } else {
            consecutiveEditFailureCounts.delete(editKey);
            if (modelEscalatedForEditKey === editKey) {
              // Revert to the proactive deep-task baseline if one is still active for this
              // mission, not all the way past it to the user's raw selection — the task is
              // still deep even though this one file is now fixed.
              const revertTarget = conversation._proactiveDeepTaskModel || userSelectedModelName;
              const revertNote = `${args.path} was edited cleanly; reverting to ${revertTarget}.`;
              currentAgentLogs.push({ type: 'thought', content: revertNote });
              if (window.appendSystemMessage) window.appendSystemMessage(revertNote, { conversationId: conversation.id });
              activeRunModelName = revertTarget;
              config.activeRunModelName = revertTarget;
              modelEscalatedForEditKey = null;
            }
          }
        }
        // A successful read_file clears the read-required gate for that file. When the gate was
        // actually blocking an edit, tell the model to retry that edit now instead of stopping or
        // re-reading again — otherwise a small/fast model can burn the rest of the turn re-reading
        // the same file repeatedly without ever producing the corrected edit the guard was for.
        if (toolName === 'read_file' && args.path && !isFailedToolResult(result)) {
          const readKey = String(args.path).toLowerCase();
          const wasBlocked = fileNeedsReadBeforeEdit.has(readKey);
          fileNeedsReadBeforeEdit.delete(readKey);
          if (wasBlocked && result && typeof result === 'object' && !Array.isArray(result)) {
            result.editRetryReminder = `You previously had an edit to ${args.path} blocked until you re-read it. You have now read its current content above. Retry the edit you were making now, using this fresh content, instead of reading this file again or stopping without editing.`;
          }
        }
        // A genuine passing verification (not a placeholder script) proves the workspace is
        // healthy again, so it clears every file the cross-file breakage guard was tracking —
        // not just the one most recently edited.
        if (brokenFiles.size > 0 && !isFailedToolResult(result)) {
          if (toolName === 'run_tests' && result && result.success && !looksLikePlaceholderTestOutput(result.output)) {
            brokenFiles.clear();
          } else if ((toolName === 'run_command' || toolName === 'start_command') && isRealVerificationCommand(args.command)) {
            const combinedOutput = `${(result && result.stdout) || ''}\n${(result && result.stderr) || ''}`;
            if (!looksLikePlaceholderTestOutput(combinedOutput)) {
              brokenFiles.clear();
            }
          }
        }

        toolResponseParts.push({
          functionResponse: {
            name: toolName,
            response: (typeof result === 'object' && result !== null && !Array.isArray(result)) ? result : { output: result }
          }
        });
        
        // Re-render UI with logs and persist them so reloads keep tool errors/results.
        persistCurrentAgentLogs({ render: true });
        if (isStopRequested) {
          userRequestedStop = true;
          isStopRequested = false;
          lastTextResponse = stopRequestMode === 'soft' ? "Task stopped by user after the current tool call." : "Task aborted by user.";
          currentAgentLogs.push({ type: 'thought', content: stopRequestMode === 'soft' ? "Stop requested by user; stopping after tool completion." : "Task execution stopped by user." });
          break;
        }
      }
      
      // Append tool response parts to message history
      messages.push({ role: 'tool', parts: toolResponseParts });
      
      // Save api response details to current turn
      currentTurn.toolResponseParts = toolResponseParts;
      
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      window.saveConversationsToStorage();
      if (userRequestedStop) {
        break;
      }
      
      if (forceYield) {
        // Clarification questions were presented — just yield, the UI will render the question cards.
        if (conversation.awaitingClarification) {
          // Replace any stale AI text (e.g. "Task finished.") with a neutral hold message
          // so the bubble reads correctly while the question card is visible.
          const clarIntro = conversation.awaitingClarification.intro || '';
          if (!lastTextResponse || /task finished/i.test(lastTextResponse)) {
            lastTextResponse = clarIntro || 'A few quick design questions before I proceed:';
          }
          break;
        }
        // forceYield can be set by the planning gate (model wrote implementation_plan.md before
        // approval) OR by repeated tool failures during execution. Only present the plan
        // approval card for the planning-gate case — execution failures should just break out.
        if (canExecuteThisTask()) {
          break;
        }

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

    // Fallback: if the agent ran in planning mode but never wrote a new plan (e.g. reviewed
    // an existing one and summarized it), check whether implementation_plan.md exists on disk.
    // If it does, gate on approval now so the next user message is properly routed.
    if (!forceYield && !reviewOnly && planningDecision.mode === 'plan' && !conversation.awaitingPlanApproval && !conversation.planApproved) {
      try {
        const existingPlanText = await readImplementationPlanText(workspacePath);
        if (existingPlanText && existingPlanText.trim()) {
          conversation.awaitingPlanApproval = true;
          console.log('Planning turn ended without forceYield; existing implementation_plan.md found — gating on approval.');
        }
      } catch (_) {}
    }
  } catch (error) {
    if (isUserStopError(error)) {
      userRequestedStop = true;
      isStopRequested = false;
      lastTextResponse = stopRequestMode === 'soft' ? "Task stopped by user after the current step." : "Task aborted by user.";
      currentAgentLogs.push({ type: 'thought', content: stopRequestMode === 'soft' ? "Stop requested by user; the run was halted cleanly." : "Task execution stopped by user." });
    } else {
      console.error("Critical error in agent loop:", error);
      window.appendSystemMessage(`Critical error in agent: ${error.message}`);
      lastTextResponse = `An error occurred: ${error.message}`;
      currentAgentLogs.push({ type: 'thought', content: `Critical Error: ${error.message}` });
    }
  } finally {
    activeRunController = null;
    stopRequestMode = 'none';
    isAgentRunning = false;
    runningConversationId = null;
    agentExecutionMode = 'idle';
    agentSubStatus = '';
    if (window.onAgentStatusChange) window.onAgentStatusChange(false);

    // Determine whether the run stopped with genuine work still pending. This drives both the
    // auto-continue decision and an honest terminal message instead of a blanket "Task finished".
    const canExecuteAtExit = (!config.planningMode || conversation.planApproved || planningBypassedForTask);
    const pendingChecklist = (conversation.tasks || []).filter(task => task.status !== 'completed' && task.status !== 'x');
    const subplanActive = !!(workingState && workingState.activeSubplan && workingState.activeSubplan.status === 'active');
    const winPending = !!(workingState && Array.isArray(workingState.winConditions) && workingState.winConditions.length
      && workingState.winConditions.some(condition => condition.status !== 'satisfied'));
    const blockersActive = !!(workingState && workingState.blockers && Array.isArray(workingState.blockers.active) && workingState.blockers.active.length);
    const madeProgressThisRun = (workWalkthrough || []).some(item => item && item.status === 'done');
    const hasPendingWork = pendingChecklist.length > 0 || subplanActive || winPending;

    // Progress score = work that is actually finished (completed checklist items + satisfied win
    // conditions). It is the goal-level signal used to detect a stall: a long task legitimately
    // takes many passes, but if this score never moves across several consecutive auto-continue
    // passes, the agent is busy-working without advancing and we should stop rather than spin.
    const completedChecklist = (conversation.tasks || []).filter(task => task.status === 'completed' || task.status === 'x').length;
    const satisfiedWins = (workingState && Array.isArray(workingState.winConditions))
      ? workingState.winConditions.filter(condition => condition.status === 'satisfied').length : 0;
    const progressScore = completedChecklist + satisfiedWins;

    // Real workspace edits/commands this pass are also genuine progress, even if the model never
    // called set_task_checklist to check anything off. Checklist bookkeeping is a courtesy the
    // model can forget to do — it must not be the only signal stall detection trusts, or a pass
    // that made real file edits (but no checklist update) looks identical to a pass that thrashed
    // on nothing but failed tool calls, and both get stopped prematurely as "stalled."
    const EDIT_OR_COMMAND_TOOLS = new Set(['write_file', 'modify_file', 'patch_file', 'run_command', 'start_command', 'run_tests']);
    const hadSuccessfulEditOrCommandThisPass = (workWalkthrough || []).some(item => item && item.status !== 'error' && EDIT_OR_COMMAND_TOOLS.has(item.toolName));

    conversation._planExecAutoContinues = conversation._planExecAutoContinues || 0;
    if (typeof conversation._lastProgressScore !== 'number') conversation._lastProgressScore = -1;
    if (progressScore > conversation._lastProgressScore || hadSuccessfulEditOrCommandThisPass) {
      conversation._stallPasses = 0;
      conversation._lastProgressScore = Math.max(progressScore, conversation._lastProgressScore);
    } else {
      conversation._stallPasses = (conversation._stallPasses || 0) + 1;
    }

    // The goal is to run very long tasks to completion unattended. Continue as long as the plan
    // is mid-execution, this pass did real work, nothing is blocked, and we are neither stalled
    // (no goal-level progress for STALL_LIMIT passes) nor past the absolute ceiling.
    const AUTO_CONTINUE_BUDGET = 100;  // absolute ceiling so a runaway can never loop forever
    const STALL_LIMIT = 8;             // consecutive passes with no completed-work progress before stopping
    const stalled = (conversation._stallPasses || 0) >= STALL_LIMIT;
    // Continue when there is a real mission in flight OR an outstanding checklist — the checklist
    // fallback keeps long work going even if operational mission state is unexpectedly absent.
    const hasResumableWork = hasOperationalMissionState(workingState) || pendingChecklist.length > 0;
    if (!forceYield && !userRequestedStop && canExecuteAtExit && hasPendingWork && madeProgressThisRun && !blockersActive && !stalled
        && hasResumableWork && conversation._planExecAutoContinues < AUTO_CONTINUE_BUDGET) {
      autoContinueExecution = true;
      conversation._planExecAutoContinues++;
    }

    const stoppedShort = conversation._planExecAutoContinues >= AUTO_CONTINUE_BUDGET || stalled;
    if (lastTextResponse === "Thinking...") {
      if (autoContinueExecution) {
        lastTextResponse = 'Completed the next batch of implementation steps. Continuing automatically with the remaining plan…';
      } else if (hasPendingWork && canExecuteAtExit && !forceYield) {
        lastTextResponse = buildRemainingWorkSummary(pendingChecklist, workingState, stoppedShort);
      } else if ((workWalkthrough || []).some(item => item && item.status === 'done')) {
        lastTextResponse = 'I inspected the workspace but did not produce the requested answer. This run is not complete; ask me to continue and I should use the gathered context to answer the actual request instead of stopping after file listing.';
      } else {
        lastTextResponse = "Task finished.";
      }
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
    // Permanently mark the bubble that carries the plan-approval card so it can be re-rendered
    // with a persistent "Implementation started" state after approval, instead of vanishing on
    // the next reload and looking like the button was never pressed.
    if (conversation.awaitingPlanApproval) {
      conversation.messages[aiMessageIndex].isPlanApprovalCard = true;
    }
    if (conversation.awaitingClarification) {
      conversation.messages[aiMessageIndex].isClarificationCard = true;
    }
    window.renderAiMessage(lastTextResponse, currentAgentLogs, conversation.id, conversation.messages[aiMessageIndex]);
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
  
  // If the run stopped mid-plan with real progress and pending work, queue an internal
  // continuation so a multi-phase build keeps going instead of falsely ending. Real user
  // queue items take priority, so only enqueue when nothing else is waiting.
  if (autoContinueExecution && window.promptQueue && window.promptQueue.length === 0) {
    window.promptQueue.push({
      prompt: '[ORION INTERNAL CONTINUATION - not a user message] The approved plan is still in progress. Continue executing the remaining checklist items and subplan steps now: write and edit the actual source files for the next pending tasks, then verify. Do not restate the plan or stop until the work is genuinely complete or you hit a real blocker. Do not quote this as something the user said.',
      modelSelectValue: modelName,
      conversationId: conversation.id,
      alreadyRendered: true,
      source: 'system'
    });
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
          if (nextTask.id && window.markQueuedPromptRunning) {
            window.markQueuedPromptRunning(nextTask.id, targetId);
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

const DEFAULT_LIST_FILES_MAX = 250;
const HIDDEN_DIRECTORY_REASONS = new Map([
  ['.git', 'version-control internals'],
  ['node_modules', 'installed dependencies'],
  ['__pycache__', 'generated Python cache'],
  ['.pytest_cache', 'test runner cache'],
  ['.ruff_cache', 'linter cache'],
  ['.mypy_cache', 'type-checker cache'],
  ['.next', 'framework build output'],
  ['dist', 'build output'],
  ['build', 'build output'],
  ['coverage', 'test coverage output'],
  ['target', 'build output'],
  ['.orion', 'Orion runtime metadata/backups'],
  ['.claude', 'Claude Code tool settings'],
  ['instance', 'runtime/user data'],
  ['user_data', 'runtime/user data'],
  ['chroma', 'vector database files'],
  ['images', 'conversation/image artifacts']
]);

function normalizeInventoryPath(pathValue) {
  return String(pathValue || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function inventoryPathSegments(pathValue) {
  return normalizeInventoryPath(pathValue).split('/').filter(Boolean);
}

function hiddenDirectoryForInventory(pathValue) {
  const segments = inventoryPathSegments(pathValue);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i].toLowerCase();
    if (!HIDDEN_DIRECTORY_REASONS.has(segment)) continue;
    return {
      path: segments.slice(0, i + 1).join('/'),
      reason: HIDDEN_DIRECTORY_REASONS.get(segment)
    };
  }
  return null;
}

// Root-level docs Orion itself writes during planning/execution (mission scratch files, not
// project source). Hidden from the default inventory so listing a workspace shows the user's
// actual project, not Orion's own working notes about that project.
const ORION_ARTIFACT_FILENAMES = new Set(['implementation_plan.md', 'strategy.md', 'work_walkthrough.md']);

function orionArtifactFileForInventory(pathValue, isDir = false) {
  if (isDir) return null;
  const segments = inventoryPathSegments(pathValue);
  const basename = (segments[segments.length - 1] || '').toLowerCase();
  if (ORION_ARTIFACT_FILENAMES.has(basename)) {
    return { path: normalizeInventoryPath(pathValue), reason: 'Orion-generated planning artifact' };
  }
  if (/\.bak$/.test(basename)) {
    return { path: normalizeInventoryPath(pathValue), reason: 'Orion edit backup' };
  }
  return null;
}

function sensitiveFileForInventory(pathValue, isDir = false) {
  if (isDir) return null;
  const segments = inventoryPathSegments(pathValue);
  const basename = (segments[segments.length - 1] || '').toLowerCase();
  if (!basename) return null;
  if (basename === '.env' || (/^\.env\./.test(basename) && basename !== '.env.example')) {
    return { path: normalizeInventoryPath(pathValue), reason: 'environment/secret file' };
  }
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts)$/.test(basename)) {
    return { path: normalizeInventoryPath(pathValue), reason: 'SSH credential file' };
  }
  if (/\.(pem|p12|pfx|key)$/.test(basename)) {
    return { path: normalizeInventoryPath(pathValue), reason: 'key/certificate file' };
  }
  if (/(secret|secrets|credential|credentials|token|tokens|password|passwd)/.test(basename)) {
    return { path: normalizeInventoryPath(pathValue), reason: 'sensitive-looking filename' };
  }
  if (basename === 'users.json' || basename === 'user.json') {
    return { path: normalizeInventoryPath(pathValue), reason: 'user data file' };
  }
  return null;
}

function addOmittedInventoryPath(omittedByPath, omitted) {
  if (!omitted || !omitted.path) return;
  const key = omitted.path.toLowerCase();
  if (!omittedByPath.has(key)) {
    omittedByPath.set(key, { path: omitted.path, reason: omitted.reason || 'hidden from default inventory', count: 0 });
  }
  omittedByPath.get(key).count += 1;
}

function buildCuratedFileInventory(files, options = {}) {
  const maxFiles = Math.max(25, Math.min(Number(options.maxFiles) || DEFAULT_LIST_FILES_MAX, 800));
  const visible = [];
  const omittedByPath = new Map();
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map(file => ({
      path: normalizeInventoryPath(file && file.path),
      isDir: !!(file && file.isDir),
      size: file && file.size
    }))
    .filter(file => file.path);

  for (const file of normalizedFiles) {
    const hiddenDirectory = hiddenDirectoryForInventory(file.path);
    if (hiddenDirectory) {
      addOmittedInventoryPath(omittedByPath, hiddenDirectory);
      continue;
    }
    const sensitiveFile = sensitiveFileForInventory(file.path, file.isDir);
    if (sensitiveFile) {
      addOmittedInventoryPath(omittedByPath, sensitiveFile);
      continue;
    }
    const orionArtifact = orionArtifactFileForInventory(file.path, file.isDir);
    if (orionArtifact) {
      addOmittedInventoryPath(omittedByPath, orionArtifact);
      continue;
    }
    visible.push(file);
  }

  const omitted = [...omittedByPath.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 40);
  const hiddenCount = normalizedFiles.length - visible.length;
  const result = {
    mode: 'project',
    files: visible.slice(0, maxFiles),
    omitted,
    totals: {
      returned: Math.min(visible.length, maxFiles),
      visible: visible.length,
      hidden: hiddenCount,
      scanned: normalizedFiles.length
    },
    warning: 'Default project inventory hides generated caches, runtime/user data, backups, dependencies, and sensitive-looking files. Use mode="all" only when a raw workspace listing is explicitly needed.'
  };
  if (visible.length > maxFiles) {
    result.truncated = true;
    result.warning += ` Showing first ${maxFiles} project files out of ${visible.length}. Use maxFiles, search, or a targeted read for more.`;
  }
  return result;
}

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
      // Success here only means the OS accepted the spawn call — the process may still be
      // starting, may fail moments later (missing deps, port conflict), or may never bind
      // anything. Wait briefly and surface whatever output/URL was actually captured so the model
      // has real evidence instead of just this "spawn succeeded" message, and is explicitly told
      // it still needs to verify further either way.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const capturedOutput = typeof window.lastLaunchLogs === 'string' ? window.lastLaunchLogs.trim() : '';
      const capturedUrl = typeof window.lastLaunchUrl === 'string' ? window.lastLaunchUrl.trim() : '';
      return {
        ...result,
        capturedOutput: capturedOutput.slice(-4000),
        detectedUrl: capturedUrl,
        verificationNote: capturedUrl
          ? `Detected URL: ${capturedUrl}. Confirm with open_url or a screenshot before assuming it is fully working.`
          : (capturedOutput
            ? 'No URL detected yet in the captured output above. Verify with open_url, capture_screen, or read_command_output before assuming success.'
            : 'No output captured yet — the process may still be starting, may have failed silently, or this launch path does not capture output. Verify with open_url, capture_screen, or read_command_output before assuming it launched successfully.')
      };
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
      if (args.mode !== 'all') {
        return buildCuratedFileInventory(mappedFiles, {
          maxFiles: Number.isFinite(Number(args.maxFiles)) ? Number(args.maxFiles) : 250
        });
      }
      if (mappedFiles.length > 800) {
        return {
          mode: 'all',
          files: mappedFiles.slice(0, 800),
          warning: `Truncated output. Found ${mappedFiles.length} items, showing first 800. Be more specific or use search/grep tools.`
        };
      }
      return { mode: 'all', files: mappedFiles };
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
      const writeSyntaxCheck = await checkJsSyntaxAfterEdit(workspace, args.path);
      if (!writeSyntaxCheck.ok) {
        testFeedback += `\n[WARNING] SYNTAX ERROR DETECTED: node --check failed for ${args.path}:\n${writeSyntaxCheck.error}`;
      }
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback += "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this write. Please review your modifications.";
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
      const modifySyntaxCheck = await checkJsSyntaxAfterEdit(workspace, args.path);
      if (!modifySyntaxCheck.ok) {
        testFeedback += `\n[WARNING] SYNTAX ERROR DETECTED: node --check failed for ${args.path}:\n${modifySyntaxCheck.error}`;
      }
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback += "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this edit. Please inspect your change.";
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
      const patchSyntaxCheck = await checkJsSyntaxAfterEdit(workspace, args.path);
      if (!patchSyntaxCheck.ok) {
        testFeedback += `\n[WARNING] SYNTAX ERROR DETECTED: node --check failed for ${args.path}:\n${patchSyntaxCheck.error}`;
      }
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback += "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this patch. Please inspect your change.";
        }
      }

      return { ...patchRes, message: `${patchRes.message || 'File patched successfully.'}${testFeedback}` };
    }
    
    case 'change_workspace': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const resolution = await resolveWorkspacePathForChange(args.path);
      if (!resolution.success) {
        throw new Error(`Workspace path "${resolution.path}" is invalid or does not exist: ${resolution.error}`);
      }
      const targetPath = resolution.path;
      conversation.workspace = targetPath;
      conversation.projectPath = targetPath;
      if (typeof window.changeActiveWorkspace === 'function') {
        window.changeActiveWorkspace(targetPath);
      }
      return {
        success: true,
        message: resolution.fuzzyResolved
          ? `Workspace directory changed to: ${targetPath} (resolved from "${resolution.resolvedFrom}")`
          : `Workspace directory changed to: ${targetPath}`,
        fuzzyResolved: !!resolution.fuzzyResolved,
        resolvedFrom: resolution.resolvedFrom,
        matchedName: resolution.matchedName || getLocalPathBaseName(targetPath)
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
      const cleanOutput = typeof window.api.onCommandOutput === 'function'
        ? window.api.onCommandOutput(processId, (data) => {
            if (data.type === 'stderr') {
              stderrOutput += data.text;
            } else {
              stdoutOutput += data.text;
            }
          })
        : () => {};
      
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
        const cleanRetry = typeof window.api.onCommandOutput === 'function'
          ? window.api.onCommandOutput(retryId, (data) => {
              if (data.type === 'stderr') retryStderr += data.text;
              else retryStdout += data.text;
            })
          : () => {};
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
      // Normalize the conversation ID to underscores so the session ID is consistent regardless of
      // whether dashes or underscores appear in conversation.id. Without this, the model would see
      // e.g. "cmd_conv-123-abc_server" in the result but then sanitize it to "cmd_conv_123_abc_server"
      // for a subsequent call, causing a lookup miss on the same session.
      const convIdNorm = conversation.id.replace(/[^a-zA-Z0-9]/g, '_');
      const processId = requestedId && (requestedId.includes(convIdNorm) || requestedId.includes(conversation.id))
        ? requestedId
        : `cmd_${convIdNorm}_${requestedId || Date.now()}`;
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
      const killResult = await window.api.killCommand(args.processId);
      // Remove from the active preview tracking list so auto-kill doesn't double-attempt it
      if (Array.isArray(conversation.activePreviewProcesses)) {
        conversation.activePreviewProcesses = conversation.activePreviewProcesses.filter(pid => pid !== args.processId);
      }
      return killResult;
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
      if (agentExecutionMode === 'direct' || agentExecutionMode === 'answer') {
        return { blocked: true, reason: `${name} is not available in ${agentExecutionMode} mode. Operational planning tools are for long-running multi-step tasks only. Answer the user directly using read tools.` };
      }
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

    case 'preview_app': {
      // Kill any preview processes from this conversation that are still open, so the
      // user never ends up with multiple game windows piling up on their desktop.
      if (Array.isArray(conversation.activePreviewProcesses) && conversation.activePreviewProcesses.length > 0) {
        for (const pid of conversation.activePreviewProcesses) {
          try { await window.api.killCommand(pid); } catch (_) {}
        }
        conversation.activePreviewProcesses = [];
      }

      // Generate a managed processId (scoped to this conversation) unless the model supplied one,
      // mirroring start_command, so the app can be tracked/killed afterward.
      const requestedId = args.processId ? String(args.processId).replace(/[^a-zA-Z0-9_.-]/g, '_') : '';
      const convIdNorm = conversation.id.replace(/[^a-zA-Z0-9]/g, '_');
      const processId = requestedId && (requestedId.includes(convIdNorm) || requestedId.includes(conversation.id))
        ? requestedId
        : `preview_${convIdNorm}_${requestedId || Date.now()}`;
      const result = await window.api.previewApp(workspace, {
        command: args.command || '',
        warmupMs: args.warmupMs,
        timeoutMs: args.timeoutMs,
        processId,
        destination: args.destination || ''
      });
      // Track the processId so we can auto-kill it next time
      if (result && result.success) {
        conversation.activePreviewProcesses = conversation.activePreviewProcesses || [];
        conversation.activePreviewProcesses.push(processId);
        if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      }
      // A crash before render is a real, reportable failure the model must act on — surface it as
      // a failed result (not a thrown error) so the recovery guidance and stderr reach the model.
      if (!result.success && !result.crashed) throw new Error(result.error || 'App preview failed');
      if (window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      return result;
    }

    case 'capture_screen': {
      const result = await window.api.captureScreen(workspace, {
        delayMs: args.delayMs,
        destination: args.destination || ''
      });
      if (!result.success) throw new Error(result.error || 'Screen capture failed');
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
      const activeModelName = config.activeRunModelName || config.modelName || 'gemini-2.5-flash-lite';
      if (String(activeModelName || '').startsWith('gemini-') && !config.geminiApiKey) throw new Error('Gemini API key is required for Gemini multimodal screenshot inspection.');
      const file = await window.api.readWorkspaceFileBase64(workspace, args.path);
      if (!file.success) throw new Error(file.error || 'Could not read screenshot image');
      if (!String(file.mimeType || '').startsWith('image/')) throw new Error(`Screenshot inspection requires an image file, got ${file.mimeType}`);
      return await inspectScreenshotWithModel({
        imageBase64: file.data,
        mimeType: file.mimeType,
        path: args.path,
        goal: args.goal,
        modelName: activeModelName,
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

    case 'ask_clarifying_questions': {
      if (!args.questions || !Array.isArray(args.questions) || args.questions.length === 0) {
        throw new Error("ask_clarifying_questions requires a non-empty 'questions' array.");
      }
      conversation.awaitingClarification = {
        intro: args.intro || 'A few quick design questions before I proceed:',
        questions: args.questions
      };
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      return { success: true, status: 'questions_presented', _forceYield: true };
    }

    case 'step_complete': {
      const stepLabel = String(args.step || args.label || 'current step').trim();
      let verification = `[POST-STEP VERIFICATION: Step "${stepLabel}" complete.`;
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (testRes.success) {
          verification += ` Tests passing. ✓]`;
        } else {
          verification += ` Tests FAILED — fix before continuing.\n${testRes.output || ''}]`;
        }
      } else {
        verification += ` No test command configured.]`;
      }
      return { success: true, verification };
    }

    case 'get_symbol_index': {
      if (!workspace) throw new Error('No active workspace');
      const result = await window.api.getSymbolIndex(workspace);
      if (!result.success) throw new Error(result.error || 'Symbol index failed');
      return result;
    }

    case 'read_project_memory': {
      if (!workspace) throw new Error('No active workspace');
      const result = await window.api.readProjectMemory(workspace);
      if (!result || !result.success) return { facts: [], lastUpdated: null, message: 'No project memory found.' };
      return result;
    }

    case 'append_project_memory': {
      if (!workspace) throw new Error('No active workspace');
      if (!args.text) throw new Error("Missing 'text' parameter");
      const result = await window.api.appendProjectMemory(workspace, { text: args.text, category: args.category || 'general' });
      if (!result || !result.success) throw new Error((result && result.error) || 'Failed to append project memory');
      return { success: true, message: `Memory appended: "${args.text}"` };
    }

    case 'discover_skills': {
      const result = await window.api.discoverSkills(args.group || null);
      if (!result.success) throw new Error(result.error || 'discover_skills failed');
      return { skills: result.skills, count: result.skills.length };
    }

    case 'run_skill': {
      if (!args.name) throw new Error("Missing 'name' parameter");
      const result = await window.api.runSkill(args.name, args.inputs || {});
      if (!result.success) throw new Error(result.error || `Skill '${args.name}' failed`);
      return result.outputs;
    }

    case 'create_skill': {
      if (!args.name) throw new Error("Missing 'name' parameter");
      if (!args.group) throw new Error("Missing 'group' parameter");
      if (!args.description) throw new Error("Missing 'description' parameter");
      if (!args.implementation) throw new Error("Missing 'implementation' parameter");
      const result = await window.api.createSkill({
        name: args.name,
        group: args.group,
        description: args.description,
        inputs: args.inputs || {},
        outputs: args.outputs || {},
        implementation: args.implementation,
        test: args.test || null
      });
      if (!result.success) throw new Error(result.error || 'create_skill failed');
      return { success: true, manifest: result.manifest, message: `Skill '${args.name}' created and registered.` };
    }

    case 'remember_fact': {
      const scope = args.scope || 'project';
      const text = args.text;
      const category = args.category || 'general';
      if (!text) throw new Error("Missing 'text' parameter");
      if (scope === 'global') {
        const result = await window.api.appendGlobalFact(text, category);
        if (!result || !result.success) throw new Error((result && result.error) || 'appendGlobalFact failed');
        return { success: true, message: `Global fact stored: "${text}"` };
      } else {
        if (!workspace) throw new Error('No active workspace');
        const result = await window.api.appendProjectFact(workspace, text, category);
        if (!result || !result.success) throw new Error((result && result.error) || 'appendProjectFact failed');
        return { success: true, message: `Project fact stored: "${text}"` };
      }
    }

    case 'remember_decision': {
      if (!workspace) throw new Error('No active workspace');
      if (!args.text) throw new Error("Missing 'text' parameter");
      const result = await window.api.appendProjectDecision(workspace, args.text, args.context || '');
      if (!result || !result.success) throw new Error((result && result.error) || 'appendProjectDecision failed');
      return { success: true, message: `Decision stored: "${args.text}"` };
    }

    case 'remember_preference': {
      const scope = args.scope || 'project';
      const text = args.text;
      if (!text) throw new Error("Missing 'text' parameter");
      if (scope === 'global') {
        const mem = await window.api.readGlobalMemory();
        const prefs = (mem && mem.user && Array.isArray(mem.user.preferences)) ? mem.user.preferences : [];
        prefs.push({ text, addedAt: new Date().toISOString() });
        const result = await window.api.writeGlobalMemory({ user: Object.assign({}, (mem && mem.user) || {}, { preferences: prefs }) });
        if (!result || !result.success) throw new Error((result && result.error) || 'writeGlobalMemory failed');
        return { success: true, message: `Global preference stored: "${text}"` };
      } else {
        const wp = args.workspacePath || workspace;
        if (!wp) throw new Error('No active workspace');
        const result = await window.api.appendProjectPreference(wp, text);
        if (!result || !result.success) throw new Error((result && result.error) || 'appendProjectPreference failed');
        return { success: true, message: `Project preference stored: "${text}"` };
      }
    }

    case 'recall_memory': {
      const scope = args.scope || 'project';
      const wp = args.workspacePath || workspace;
      const output = {};
      if (scope === 'global' || scope === 'all') {
        const g = await window.api.readGlobalMemory();
        output.global = g || {};
      }
      if ((scope === 'project' || scope === 'all') && wp) {
        const p = await window.api.readProjectMemory(wp);
        output.project = p || {};
      }
      return output;
    }

    case 'save_session_summary': {
      const wp = args.workspacePath || workspace;
      if (!wp) throw new Error('No active workspace');
      if (!args.summary) throw new Error("Missing 'summary' parameter");
      const sessionData = {
        summary: args.summary,
        decisions: args.decisions || [],
        discoveries: args.discoveries || [],
        tasksCompleted: args.tasksCompleted || [],
        openItems: args.openItems || []
      };
      const result = await window.api.saveSession(wp, sessionData);
      if (!result || !result.success) throw new Error((result && result.error) || 'saveSession failed');
      return { success: true, sessionId: result.session && result.session.sessionId, message: 'Session summary saved.' };
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

// A fresh (non-approved-plan) task must not inherit an unrelated mission/blockers left over in a
// workspace's operational context — including a workspace the turn only reaches mid-run via
// change_workspace, e.g. after a fuzzy folder search lands on a shared parent directory that
// happens to hold an old, unrelated project's stale state. Reads fresh from disk (not any
// already-loaded in-memory state) since the caller may not have loaded this exact path yet.
async function clearStaleMissionStateIfPresent(workspace) {
  if (!workspace) return null;
  try {
    const current = await readOperationalContext(workspace);
    if (!hasOperationalMissionState(current.state)) return null;
    const emptyState = OperationalContext.createEmptyContext();
    const writeResult = await window.api.writeFile(workspace, OPERATIONAL_CONTEXT_PATH, `${JSON.stringify(emptyState, null, 2)}\n`);
    if (writeResult && writeResult.error) return null;
    return emptyState;
  } catch (_) {
    return null;
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

// Builds an honest "here is what is done and what remains" message for when an execution run
// stops with work still pending — instead of a misleading bare "Task finished.".
function buildRemainingWorkSummary(pendingChecklist, state, budgetExhausted) {
  const lines = [];
  if (budgetExhausted) {
    lines.push('I paused after several automatic continuation passes so this does not run unbounded. The plan is partially implemented — send "continue" to resume.');
  } else {
    lines.push('I made progress but the plan is not finished yet.');
  }

  const remaining = (pendingChecklist || []).map(task => task.title).filter(Boolean).slice(0, 12);
  if (remaining.length) {
    lines.push('\n**Still pending:**');
    remaining.forEach(title => lines.push(`- ${title}`));
  }

  const subplan = state && state.activeSubplan;
  if (subplan && subplan.status === 'active' && subplan.nextAction) {
    lines.push(`\n**Next action:** ${subplan.nextAction}`);
  }

  return lines.join('\n');
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
  const visualTools = new Set(['take_screenshot', 'preview_app', 'capture_screen', 'inspect_screenshot', 'compare_screenshot_to_goal', 'inspect_screenshot_with_model']);
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
  'Relevant Files',
  'Design & Polish',
  'Ambiguity Resolution'
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

// A model told to use an exact heading like "Ambiguity Resolution" will often instead write a
// heading that covers the same concept in its own words (e.g. "Scope Management"). Requiring the
// literal phrase caused a real, otherwise-reasonable STRATEGY.md to silently fail validation,
// which in turn meant applyStrategyToOperationalContext() never ran at all — mission/win
// conditions never got derived, and Mission Control stayed empty with no indication why. Match
// each required section by concept keywords instead of the exact phrase, the same way
// hasRequiredTestingPlanSection accepts "Test Plan"/"Validation Plan" as equivalents of "Testing
// Plan" rather than requiring that literal string.
const STRATEGY_SECTION_KEYWORDS = {
  'Objective': ['objective', 'goal', 'concept', 'mission', 'purpose', 'overview'],
  'Relevant Files': ['relevant', 'file', 'subsystem', 'architecture', 'component', 'codebase'],
  'Design & Polish': ['design', 'polish', 'visual', 'ui', 'ux', 'style', 'aesthetic'],
  'Ambiguity Resolution': ['ambiguit', 'assumption', 'clarif', 'scope', 'open question']
};

function headingMatchesStrategySection(normalizedHeading, section) {
  const keywords = STRATEGY_SECTION_KEYWORDS[section] || [normalizeHeadingText(section)];
  return keywords.some(keyword => normalizedHeading.includes(keyword));
}

function hasRequiredStrategySections(content) {
  const text = String(content || '');
  if (!text.trim()) return false;
  const headings = [];
  const headingRegex = /^#{1,4}\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(text))) {
    headings.push(normalizeHeadingText(match[1]));
  }
  return STRATEGY_REQUIRED_SECTIONS.every(section => headings.some(heading => headingMatchesStrategySection(heading, section)));
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
  const headings = [];
  const headingRegex = /^#{1,4}\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(String(content || '')))) headings.push(normalizeHeadingText(match[1]));
  const missingSections = STRATEGY_REQUIRED_SECTIONS.filter(section => !headings.some(heading => headingMatchesStrategySection(heading, section)));
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

CLARIFICATION BEFORE STRATEGY: For games, simulations, apps, or creative tools — if the user's request leaves key design decisions open (visual style/genre, core mechanic, scale/performance strategy, framework choice) — call the "ask_clarifying_questions" tool with 2-3 questions BEFORE writing STRATEGY.md. Do NOT write questions as prose — use the tool so the user gets an interactive card UI with selectable options. Do not proceed to STRATEGY.md until you have the user's answers. Only skip this if the user said "surprise me" or "you decide."

For existing local folders/projects/programs, inspect first and let the discovered files/current behavior answer as many design questions as possible before asking the user.

If STRATEGY.md finds mission-critical ambiguity, ask the user before planning. If ambiguity is minor, record the assumption in STRATEGY.md and operational context, then proceed. Base implementation_plan.md on STRATEGY.md, not just the raw user prompt. Do not add agent roles, automatic replanning, or domain-specific workflows.]`;
}

function getPlanningToolGate(config, canExecute, toolName, args = {}, options = {}) {
  if (!config || !config.planningMode || canExecute) {
    return { allowed: true, forceYield: false, reason: '' };
  }
  const destructiveTools = ['write_file', 'modify_file', 'patch_file', 'start_command', 'run_tests', 'sync_workspace_env', 'launch_workspace_app', 'preview_app', 'git_push', 'download_file', 'download_from_page', 'extract_archive', 'take_screenshot'];
  const completionTools = ['complete_subplan', 'evaluate_win_conditions'];
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
  // Writing STRATEGY.md is never risky (it's a planning doc, not source/destructive), so it must
  // always be allowed — regardless of whether the routing classifier called this turn 'plan' or
  // 'direct'. Gating it on the routing classification caused the write to be rejected whenever
  // routing said 'direct' even though the system prompt separately tells Orion to write
  // STRATEGY.md first for any game/app request with open design decisions, and then let
  // implementation_plan.md through immediately afterward without ever validating a strategy (see
  // isPlanWrite below), silently skipping the grounding the ritual was supposed to enforce.
  const isStrategyWrite = toolName === 'write_file' && isStrategyPath(args.path);
  if (isStrategyWrite) {
    return { allowed: true, forceYield: false, reason: 'Writing STRATEGY.md is allowed during refinement.' };
  }
  const isPlanWrite = toolName === 'write_file' && isImplementationPlanPath(args.path);
  if (isPlanWrite) {
    // This must NOT be conditioned on strategyRequired (i.e. on the routing classifier having
    // called this turn 'plan'). The system prompt's own rule is unconditional: STRATEGY.md always
    // precedes implementation_plan.md. Writing implementation_plan.md at all is itself the signal
    // that a plan is needed — if routing mislabeled the turn 'direct' (the exact bug that caused
    // this file to be skipped once already), gating validation on that same mislabeling would
    // silently let implementation_plan.md through ungrounded again.
    if (!strategyStatus.valid) {
      return {
        allowed: false,
        forceYield: false,
        reason: `Refinement required: create a valid STRATEGY.md before implementation_plan.md. STRATEGY.md must include: ${STRATEGY_REQUIRED_SECTIONS.join(', ')}.`
      };
    }
    if (strategyStatus.needsClarification) {
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

function getReviewOnlyToolGate(toolName, args = {}) {
  const reviewReason = 'Review-only task: inspect and report findings. Do not modify source files, create implementation_plan.md, or show an implementation approval gate. STRATEGY.md is allowed only as a private review strategy/report outline.';
  if (toolName === 'write_file') {
    if (isStrategyPath(args.path)) {
      return { allowed: true, forceYield: false, reason: 'Writing STRATEGY.md is allowed as a read-only review strategy artifact.' };
    }
    return { allowed: false, forceYield: false, reason: isImplementationPlanPath(args.path) ? reviewReason : reviewReason };
  }
  const blockedTools = new Set([
    'modify_file',
    'patch_file',
    'sync_workspace_env',
    'set_workspace_entrypoint',
    'start_command',
    'launch_workspace_app',
    'preview_app',
    'git_push',
    'download_file',
    'download_from_page',
    'extract_archive',
    'set_task_checklist',
    'update_mission_context',
    'start_subplan',
    'update_subplan_context',
    'complete_subplan',
    'evaluate_win_conditions',
    'record_blocker',
    'resolve_blocker'
  ]);
  if (blockedTools.has(toolName)) {
    return { allowed: false, forceYield: false, reason: reviewReason };
  }
  return { allowed: true, forceYield: false, reason: '' };
}

function summarizeToolStart(toolName, args = {}) {
  if (toolName === 'read_file') {
    const hasRange = args.startLine !== undefined && args.startLine !== null;
    const rangeLabel = hasRange
      ? ` (lines ${args.startLine}${args.endLine !== undefined && args.endLine !== null ? `-${args.endLine}` : '+'})`
      : '';
    return { toolName, status: 'running', label: `Read \`${args.path || 'file'}\`${rangeLabel}` };
  }
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
  if (toolName === 'preview_app') return { toolName, kind: 'visual', status: 'running', label: `Launched app${args.command ? ` \`${args.command}\`` : ''} and captured a screenshot` };
  if (toolName === 'capture_screen') return { toolName, kind: 'visual', status: 'running', label: 'Captured a fresh screen screenshot' };
  if (toolName === 'inspect_screenshot') return { toolName, kind: 'visual', status: 'running', label: `Inspected screenshot \`${args.path || 'screenshot'}\`` };
  if (toolName === 'compare_screenshot_to_goal') return { toolName, kind: 'visual', status: 'running', label: `Compared screenshot to goal` };
  if (toolName === 'inspect_screenshot_with_model') return { toolName, kind: 'visual', status: 'running', label: `Inspected screenshot with active model vision` };
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
  if (toolName === 'modify_file') {
    return { toolName, kind: 'file', status: 'running', path: args.path, label: `Modified \`${args.path || 'file'}\`` };
  }
  if (toolName === 'patch_file') {
    const op = args.operation || {};
    const opLabels = {
      replace: 'replace',
      replace_regex: 'regex replace',
      insert: op.position === 'before' ? 'insert before anchor' : 'insert after anchor',
      replace_range: `lines ${op.startLine || '?'}-${op.endLine || '?'}`
    };
    const opDetail = op.type && opLabels[op.type] ? ` (${opLabels[op.type]})` : '';
    return { toolName, kind: 'file', status: 'running', path: args.path, operationType: op.type, label: `Patched \`${args.path || 'file'}\`${opDetail}` };
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
    // The auto-test-after-edit regression warning lives only in result.message (surfaced to the
    // model as tool-response text) — it was never captured on the walkthrough item itself, so the
    // verification gates below had no way to see that a change actually broke the test suite.
    // Presence of a run_tests/run_command call was being treated as "verified", even when the
    // most recent evidence was a failure.
    const message = result && typeof result.message === 'string' ? result.message : '';
    const hasSyntaxError = /SYNTAX ERROR DETECTED/.test(message);
    item.regressionDetected = hasSyntaxError || /REGRESSION DETECTED/.test(message);
    const backupDetail = result && result.backupPath ? `Backup: \`${result.backupPath}\`` : '';
    item.detail = item.regressionDetected
      ? `${backupDetail ? `${backupDetail} — ` : ''}⚠ ${hasSyntaxError ? 'Syntax error introduced by this change.' : 'Regression detected: tests failed after this change.'}`
      : backupDetail;
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
    item.output = result ? `${result.stdout || ''}\n${result.stderr || ''}`.trim() : '';
    item.detail = `Exit: ${result && result.exitCode !== undefined ? result.exitCode : 'unknown'}${timedOut}${killed}${timeout}`;
    if (looksLikePlaceholderTestOutput(item.output)) {
      item.detail += ' — output looks like a placeholder/no-op test script, not real verification.';
    }
  } else if (toolName === 'start_command') {
    item.detail = result && result.id ? `Session: \`${result.id}\`, timeout: ${result.timeoutMs || 'default'}ms` : '';
  } else if (toolName === 'run_tests') {
    item.output = result && result.output ? String(result.output) : '';
    item.detail = result && result.success ? 'Passed' : 'Failed or unavailable';
    if (looksLikePlaceholderTestOutput(item.output)) {
      item.detail += ' — output looks like a placeholder/no-op test script, not real verification.';
    }
  } else if (toolName === 'schedule_followup') {
    item.detail = result && result.replacedExisting ? 'Replaced an existing related timer' : '';
  } else if (result && result.summary && (
    toolName === 'download_file' || toolName === 'inspect_archive' || toolName === 'extract_archive' ||
    toolName === 'inspect_binary_asset' || toolName === 'list_asset_metadata' ||
    toolName === 'take_screenshot' || toolName === 'preview_app' || toolName === 'capture_screen' || toolName === 'inspect_screenshot' || toolName === 'compare_screenshot_to_goal' || toolName === 'inspect_screenshot_with_model'
  )) {
    item.detail = result.summary;
    if (result.path && (toolName === 'take_screenshot' || toolName === 'preview_app' || toolName === 'capture_screen' || toolName === 'inspect_screenshot' || toolName === 'compare_screenshot_to_goal' || toolName === 'inspect_screenshot_with_model')) {
      item.path = result.path;
      item.width = result.width || item.width || 0;
      item.height = result.height || item.height || 0;
      item.size = result.size || item.size || 0;
    }
  } else if (result && result.title && (toolName === 'open_url' || toolName === 'search_web' || toolName === 'click_element' || toolName === 'fill_input' || toolName === 'navigate_back' || toolName === 'wait_for_page')) {
    item.detail = `Page: ${result.title}`;
  }
}

function withWorkWalkthrough(text, items, final = false) {
  const meaningfulItems = (items || []).filter(Boolean);
  if (meaningfulItems.length === 0) return text;
  const base = sanitizeFinalAnswerText(text);
  const lines = meaningfulItems.slice(-12).map(item => {
    const marker = item.status === 'error' ? 'Failed' : (item.status === 'running' ? 'Working' : 'Done');
    const detail = item.detail ? ` - ${item.detail}` : '';
    return `- **${marker}:** ${item.label}${detail}`;
  });
  if (final) {
    return `${base.trim() || 'Task finished.'}\n\n## Work Walkthrough\n${lines.join('\n')}`;
  }
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

// Some project test scripts are a literal no-op (e.g. `echo "no tests configured" && exit 0`,
// left in place as a placeholder by a scaffolding tool). Such a script exits 0 and looks like a
// passing test run, but the output text itself says nothing was actually tested — treating this
// as real verification would let a broken change through a gate that never ran any assertions.
function looksLikePlaceholderTestOutput(output) {
  const text = String(output || '').toLowerCase();
  if (!text.trim()) return false;
  return /(no tests?\s*(configured|found|specified|to run|available)|no test (files|suites)\s*(found|matched)|test (command|script) not (configured|specified)|error:\s*no test specified|0 tests?\s*(found|ran|matched|passed)|nothing to test)/.test(text);
}

function isRealVerificationCommand(command) {
  const text = String(command || '').toLowerCase().trim();
  if (!text) return false;
  if (/^(mkdir|md|new-item|copy|cp|move|mv|ren|rename|dir|ls|get-childitem)\b/.test(text)) return false;
  return /\b(pytest|unittest|python\s+-m\s+py_compile|python\s+-m\s+compileall|npm\s+test|npm\s+run\s+(test|build|lint|typecheck)|pnpm\s+(test|build|lint|typecheck)|yarn\s+(test|build|lint|typecheck)|node\s+--check|node\s+[\w./\\-]*test[\w./\\-]*\.js|tsc\b|eslint\b|ruff\b|mypy\b|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|smoke|--smoke-test|playwright|vitest|jest|tap|tape)\b/.test(text);
}

function isSyntaxCheckableJsPath(filePath) {
  const p = String(filePath || '');
  return /\.(js|mjs|cjs)$/i.test(p) && !/\.min\.js$/i.test(p);
}

// Any edit tool (write_file/modify_file/patch_file) can silently corrupt a JS file's syntax —
// e.g. patch_file's replace_range deleting a method signature by line-count miscalculation.
// A project's own test command may be a placeholder (see looksLikePlaceholderTestOutput) and
// never catch this, so run a fast, tool-independent `node --check` right after the write.
async function checkJsSyntaxAfterEdit(workspace, filePath) {
  if (!isSyntaxCheckableJsPath(filePath)) return { ok: true };
  if (!window.api || typeof window.api.runCommand !== 'function') return { ok: true };
  try {
    const safePath = String(filePath).replace(/"/g, '\\"');
    const processId = `syntaxcheck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const result = await window.api.runCommand(`node --check "${safePath}"`, workspace, processId, 15000);
    if (result && result.code === 0) return { ok: true };
    const errText = (result && (result.stderr || result.error || result.stdout)) || 'Unknown syntax check failure';
    return { ok: false, error: String(errText).trim().split('\n').slice(0, 6).join('\n') };
  } catch (err) {
    // Never let the syntax checker itself block a real edit from completing.
    return { ok: true };
  }
}

// A file over this size is risky to rewrite wholesale with write_file — one bad generation can
// silently drop unrelated content the model never re-reads carefully. Below it, a full rewrite of
// the broken section is the safer move once incremental line-based patches keep drifting.
const LARGE_FILE_REWRITE_RISK_THRESHOLD_CHARS = 12000;

// A patch_file/write_file/modify_file result that embeds a syntax/regression warning still
// reports success:true, so it never registers with the repeated-tool-failure counter used
// elsewhere — a transcript showed four consecutive replace_range attempts on the same file each
// reintroduce a fresh syntax error (line numbers drifting after every edit) with zero escalation.
// This builds a strategy-change nudge once that streak crosses a threshold. Large files must NOT
// be told to do a full rewrite — that risks losing unrelated content the model won't re-verify —
// so the guidance differs by file size.
async function buildRepeatedEditFailureEscalation(workspace, filePath, failureStreak) {
  let isLarge = true; // fail safe toward the more conservative guidance if size can't be determined
  try {
    const content = await window.api.readFile(workspace, filePath, { maxChars: 20000 });
    const text = typeof content === 'string' ? content : '';
    const truncated = /\[Orion\] File truncated at/.test(text);
    isLarge = truncated || text.length > LARGE_FILE_REWRITE_RISK_THRESHOLD_CHARS;
  } catch (_) {
    isLarge = true;
  }
  if (isLarge) {
    return `[WARNING] REPEATED EDIT FAILURE: this file has had ${failureStreak} consecutive edits each introduce a new syntax/regression error. This file is large — do NOT rewrite the whole file with write_file, that risks silently losing unrelated content. Instead: read the exact current section immediately before each patch, use modify_file with an exact, unique target string (not replace_range by line number, which drifts as line numbers shift between edits), and make one small, single-purpose change at a time.`;
  }
  return `[WARNING] REPEATED EDIT FAILURE: this file has had ${failureStreak} consecutive edits each introduce a new syntax/regression error. This file is small enough to rewrite safely — read its full current content, then use write_file to replace the whole broken section (or the whole file) with complete, correct code in one shot instead of continuing to guess line ranges with patch_file.`;
}

// Gemini's own MALFORMED_FUNCTION_CALL signal means it tried to generate a tool call but produced
// invalid structure. The retry guidance used to be one static message repeated for every attempt,
// with no adaptation and no attempt to name a likely cause — a transcript showed this happen
// repeatedly while the model was trying to embed a large, multi-hundred-line code block (full of
// backtick template literals and nested quotes) as a single JSON string argument to patch_file/
// write_file, which is exactly the kind of payload most likely to break JSON generation. Once the
// first generic retry doesn't resolve it, name that likely cause and suggest a concrete fix
// (split into a smaller edit) instead of repeating "be simpler" with nothing to act on.
function buildMalformedFunctionCallGuidance(attemptCount) {
  if (attemptCount <= 1) {
    return 'The previous function call was malformed and was NOT executed — no process was started, no file was written. Please generate a valid JSON function call. Use simple, minimal arguments. Avoid namespace prefixes (like \'default_api.\') and markdown code blocks around the call.';
  }
  return `The previous function call was malformed and was NOT executed — no process was started, no file was written. This has now failed ${attemptCount} times in a row. If you are trying to pass a large, multi-line block of code (especially one containing template literals with backticks and \${...}, or many embedded quotes) as a single argument, that is very likely why the call keeps failing to generate correctly. Break the change into a SMALLER edit: use modify_file with a short, exact target/replacement instead of one large multi-hundred-line block, or split the change into two or more smaller tool calls. Use simple, minimal arguments, no namespace prefixes, no markdown code blocks around the call.`;
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

// A check that RAN is not the same as a check that PASSED. This must reject failed verification
// attempts (item.status === 'error', e.g. a run_tests call that came back with success: false),
// not just require that a verification-shaped tool was called — otherwise a turn where npm test
// runs and fails still counts as "verified", and the run keeps going instead of stopping to fix
// the actual failure.
function isVerificationItem(item) {
  if (!item) return false;
  if (item.status === 'error') return false;
  if (looksLikePlaceholderTestOutput(item.output)) return false;
  if (item.toolName === 'run_tests' || item.kind === 'test') return true;
  if (item.toolName === 'run_command') return isRealVerificationCommand(item.command);
  if (item.toolName === 'start_command') return isRealVerificationCommand(item.command);
  // A bounded GUI preview that actually captured a screenshot is real evidence the app rendered.
  if (item.toolName === 'preview_app') return true;
  return false;
}

function hasVerificationAfterLastFileEdit(items) {
  const list = Array.isArray(items) ? items : [];
  const lastEditIndex = list.findLastIndex(item => isFileMutationItem(item));
  if (lastEditIndex === -1) return true;
  return list.slice(lastEditIndex + 1).some(item => isVerificationItem(item));
}

function isAppLaunchItem(item) {
  return !!(item && item.toolName === 'launch_workspace_app' && item.status !== 'error');
}

// launch_workspace_app only confirms the OS accepted the spawn call, not that the process is
// actually running — a transcript showed it launch the same app twice ("can you launch it again")
// and declare success both times with zero follow-up check either time. Treat these tools as real
// evidence the launch was verified, the same way file edits require a real test/smoke check.
function isAppLaunchVerificationItem(item) {
  if (!item || item.status === 'error') return false;
  return ['open_url', 'capture_screen', 'take_screenshot', 'preview_app', 'read_command_output',
    'get_command_status', 'inspect_screenshot', 'inspect_screenshot_with_model', 'compare_screenshot_to_goal']
    .includes(item.toolName);
}

function hasVerificationAfterLastAppLaunch(items) {
  const list = Array.isArray(items) ? items : [];
  const lastLaunchIndex = list.findLastIndex(isAppLaunchItem);
  if (lastLaunchIndex === -1) return true;
  return list.slice(lastLaunchIndex + 1).some(isAppLaunchVerificationItem);
}

// write_file/modify_file/patch_file run their own auto-test-before/after-edit check internally
// (see the tool handlers) and surface a "[WARNING] REGRESSION DETECTED...]" string embedded in
// the tool result's message — but that text was never captured onto the walkthrough item itself
// (only the backup path was), so this gate had no way to see that an edit's own auto-test check
// found a real regression. updateWalkthroughItem now sets item.regressionDetected for these tools;
// this walks backward from the most recent item and treats a regression as unresolved unless a
// genuine passing verification (isVerificationItem) shows up after it.
function hasUnresolvedRegressionWarning(items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (!item) continue;
    if (isVerificationItem(item)) return false;
    if (item.regressionDetected) return true;
  }
  return false;
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
  const filesTouched = [...new Set(list.filter(isFileMutationItem).map(item => item.path))];
  if (!filesTouched.length) return '';
  const fileList = filesTouched.map(path => `\`${path}\``).join(', ');

  // A regression that was actually detected and never resolved takes priority over the generic
  // "did you verify" nudge, and is not subject to the same nudge-count cap — letting a known
  // broken change slide after 2 attempts is worse than letting an unverified-but-possibly-fine one
  // slide, and the hard verification gate later in the loop will stop the run either way.
  if (hasUnresolvedRegressionWarning(list)) {
    return `[SYSTEM: Regression detected. Your own edit to ${fileList} triggered an automatic regression-test check that FAILED — this is not "unverified", it is verified and broken.

Do not continue implementing further steps. Fix the actual regression now:
- Read the failing output (rerun the project's regression command directly if the failure reason isn't already visible).
- Identify what your change broke and fix it in the affected file(s).
- Rerun the regression command and confirm it passes before doing anything else.

Do not report this step as complete until the regression is actually fixed and verified passing.]`;
  }

  if ((options.promptCount || 0) >= (options.maxPrompts || 2)) return '';
  const missingRead = !hasReadAfterLastFileEdit(list);
  const missingVerification = !hasVerificationAfterLastFileEdit(list);
  if (!missingRead && !missingVerification) return '';

  return `[SYSTEM: Post-edit evidence gate. You changed source files (${fileList}) but have not yet produced enough evidence to finish.

Before giving a final answer:
- Re-read the touched source files or the relevant changed sections to reconcile the actual code against the task and approved plan.
- Run at least one real verification check after the edits. Use the project regression command when available. For Python/Pygame/interactive GUI apps, prefer \`python -m py_compile <file>\` plus \`preview_app\` (it launches the window, screenshots it, and leaves it running so you never hang) — then inspect_screenshot_with_model to confirm it looks right, and capture_screen again or kill_command as needed. Commands that only create folders, list files, or move assets do not count as verification.
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
  const visualArtifacts = collectVisualArtifacts(workWalkthrough, workspacePath);
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
      visualArtifacts,
      walkthrough: workWalkthrough
    },
    walkthrough: {
      finalText
    }
  };
}

function isScreenshotProducingTool(toolName) {
  return toolName === 'take_screenshot' || toolName === 'preview_app' || toolName === 'capture_screen';
}

function collectVisualArtifacts(items = [], workspacePath = '') {
  const seen = new Set();
  return (items || [])
    .filter(item => item && item.kind === 'visual' && item.path && item.status !== 'error')
    .map(item => ({
      path: item.path,
      workspacePath,
      toolName: item.toolName,
      width: item.width || 0,
      height: item.height || 0,
      size: item.size || 0,
      summary: item.detail || item.label || ''
    }))
    .filter(item => {
      const key = `${item.workspacePath}|${item.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function persistVisualArtifactForTool({ conversation, userPrompt, modelName, workspacePath, toolName, result, persistedVisualArtifactKeys }) {
  if (!window.api || !window.api.writeRunArtifact || !isScreenshotProducingTool(toolName)) return;
  if (!result || result.success === false || !result.path) return;
  const key = `${workspacePath}|${result.path}`;
  if (persistedVisualArtifactKeys && persistedVisualArtifactKeys.has(key)) return;
  if (persistedVisualArtifactKeys) persistedVisualArtifactKeys.add(key);
  const runId = `visual-${Date.now()}-${String(toolName || 'screenshot').replace(/[^a-z0-9._-]+/gi, '-')}`;
  const payload = {
    conversationId: conversation.id,
    runId,
    type: 'orion-visual-artifact',
    toolName,
    workspacePath,
    task: {
      prompt: userPrompt,
      model: modelName,
      workspace: workspacePath
    },
    visualArtifact: {
      path: result.path,
      width: result.width || 0,
      height: result.height || 0,
      size: result.size || 0,
      summary: result.summary || '',
      capturedAt: new Date().toISOString()
    }
  };
  window.api.writeRunArtifact(payload).then((artifactResult) => {
    if (artifactResult && artifactResult.success && window.loadRunArtifacts) {
      window.loadRunArtifacts();
    }
  }).catch(() => {});
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
  // Deprecated compatibility export. Final-answer quality is now based on whether
  // the agent used tools and then failed to produce a substantive answer, not on
  // guessing the user's intent from keywords in the prompt.
  return false;
}

function isInventoryOnlyTool(item) {
  const name = item && item.toolName;
  if ((name === 'run_command' || name === 'start_command') && isInventoryOnlyCommand(item.command || item.label || '')) {
    return true;
  }
  return name === 'list_files' || name === 'get_workspace_info' || name === 'change_workspace' || name === 'read_notes' || name === 'read_operational_context';
}

function isInventoryOnlyCommand(commandText) {
  const command = String(commandText || '').trim();
  if (!command) return false;
  const lower = command.toLowerCase();
  const isDirectoryListing =
    /\bget-childitem\b/.test(lower) ||
    /\bselect-object\b/.test(lower) ||
    /\bwhere-object\b/.test(lower) ||
    /\bdir\b/.test(lower) ||
    /\bls\b/.test(lower);
  if (!isDirectoryListing) return false;
  const discoveryFlags =
    /-directory\b/.test(lower) ||
    /-filter\b/.test(lower) ||
    /select-object\s+-expandproperty\s+fullname/.test(lower) ||
    /desktop/.test(lower) ||
    /projects/.test(lower);
  const readsFileContent =
    /\bget-content\b/.test(lower) ||
    /\btype\b/.test(lower) ||
    /\bcat\b/.test(lower) ||
    /\bselect-string\b/.test(lower) ||
    /\brg\b/.test(lower);
  return discoveryFlags && !readsFileContent;
}

function hasDeepInspectionEvidence(workWalkthrough = []) {
  return (workWalkthrough || []).some(item => {
    if (!item || item.status === 'error') return false;
    if (isInventoryOnlyTool(item)) return false;
    return item.toolName === 'read_file' ||
      item.toolName === 'grep_search' ||
      item.toolName === 'search_embeddings' ||
      item.toolName === 'run_command' ||
      item.toolName === 'start_command' ||
      item.kind === 'file' ||
      item.kind === 'command';
  });
}

function hasOnlyInventoryEvidence(workWalkthrough = []) {
  const done = (workWalkthrough || []).filter(item => item && item.status !== 'error');
  return done.length > 0 && done.every(isInventoryOnlyTool);
}

function answerHasActionableFinalContent(answerText) {
  const text = sanitizeFinalAnswerText(answerText);
  if (isGenericNonAnswer(text)) return false;
  if (text.length < 120) return false;
  const nonBlankLines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (nonBlankLines.length >= 3) return true;
  return /[.!?]\s+\S+.*[.!?]/s.test(text);
}

function getReviewCoverage(workWalkthrough = []) {
  const done = (workWalkthrough || []).filter(item => item && item.status !== 'error');
  const filesRead = new Set();
  let hasInventory = false;
  let hasSearchOrCommand = false;
  done.forEach(item => {
    if (item.toolName === 'list_files' || item.toolName === 'get_workspace_info') hasInventory = true;
    if (item.toolName === 'grep_search' || item.toolName === 'search_embeddings' || item.toolName === 'run_command' || item.toolName === 'start_command') hasSearchOrCommand = true;
    if (item.toolName === 'read_file') {
      const label = String(item.label || item.path || '');
      const match = label.match(/`([^`]+)`/);
      filesRead.add(match ? match[1] : label || 'read_file');
    }
  });
  const fileCount = filesRead.size;
  const broadEnough = fileCount >= 3 || (fileCount >= 2 && hasSearchOrCommand);
  return { fileCount, hasInventory, hasSearchOrCommand, broadEnough };
}

function answerHasGroundedReviewReport(answerText) {
  const text = sanitizeFinalAnswerText(answerText);
  if (!answerHasActionableFinalContent(text)) return false;
  const lower = text.toLowerCase();
  const asksToContinue = /would you like me to|should i (?:try|run|continue)|do you want me to|to find specific bugs,? i would need|i need to know which program/.test(lower);
  if (asksToContinue) return false;
  const concreteLocation = /(?:^|[\s`'"(\[])(?:[\w.-]+[\\/])*[\w.-]+\.(?:js|jsx|ts|tsx|py|json|md|html|css|mjs|cjs|yml|yaml|toml|rs|go|java|cs|cpp|c|h)(?::\d+)?\b/i.test(text)
    || /\b(?:line|lines)\s+\d+\b/i.test(text)
    || /\b(?:function|class|method)\s+[`'"]?[A-Za-z_$][\w$]*/.test(text);
  const hasFindingsShape = /\b(?:finding|issue|bug|error|risk|structural problem|typo|no specific issues|no obvious issues)\b/i.test(text);
  const speculativeOnly = /\bpotential areas\b/i.test(text) && !/\b(?:finding|issue|bug|error)\s+\d*\b/i.test(text);
  return concreteLocation && hasFindingsShape && !speculativeOnly;
}

function buildReviewOnlyCompletionGatePrompt(userPrompt, answerText, workWalkthrough = []) {
  const inspected = (workWalkthrough || []).some(item => item && item.status !== 'error');
  if (!inspected) {
    return '[SYSTEM: Review completion gate. This is a read-only code review of the active workspace. Start with workspace inventory, then inspect relevant source/config/test files. Do not ask which program to inspect when an active workspace exists.]';
  }
  const coverage = getReviewCoverage(workWalkthrough);
  if (!coverage.broadEnough) {
    return `[SYSTEM: Review completion gate. You have not inspected enough of the program to finish a broad bug/structural review yet. Current coverage: ${coverage.fileCount} source file(s) read${coverage.hasInventory ? ' with inventory context' : ''}. Continue with concrete tools: list files if needed, then read the main entry point, adjacent modules, config/package files, and tests where present. Do not stop after one file with general possibilities.]`;
  }
  if (!answerHasGroundedReviewReport(answerText)) {
    return '[SYSTEM: Review completion gate. Your draft is not a grounded findings report yet. Either continue inspecting files, or produce a concrete report now with specific findings tied to file paths and line/function context, severity/impact, and a clear note if no specific issues were found. Do not ask the user whether to keep inspecting; finish the review from the available evidence or gather the missing evidence with tools.]';
  }
  return '';
}

function buildFinalAnswerQualityGatePrompt(userPrompt, answerText, workWalkthrough = []) {
  const inspected = (workWalkthrough || []).some(item => item && item.status !== 'error');
  if (!inspected) return '';
  if (hasOnlyInventoryEvidence(workWalkthrough)) {
    return `[SYSTEM: Final-response quality gate. You only have inventory-level evidence from tools such as list_files/get_workspace_info. File names alone are not enough to give a deep project analysis, quality review, architecture assessment, or improvement roadmap.

Before final response, decide what evidence the user's actual request requires. If they asked for anything beyond a file inventory, read the relevant source files, tests, README/package/config files, or run safe inspection commands before answering. If the user truly requested only an inventory, answer that narrowly and explicitly. Do not produce broad recommendations from filenames alone.]`;
  }
  if (answerHasActionableFinalContent(answerText)) return '';
  return `[SYSTEM: Final-response quality gate. You inspected context, but inspection alone is not completion.

Before final response, answer the user's actual request directly, using the evidence you gathered. If more evidence is needed, call the necessary tools now; otherwise produce a substantive answer now. Do not stop at phrases like "Ah, the path is...", an acknowledgement, a file-inspection summary, or an empty response.]`;
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
  const text = String(content || '');
  if (/^#{1,4}\s+.*?(testing plan|test plan|validation plan)\b/im.test(text)) return true;
  // Models sometimes write a section title as a full bold line ("**Testing Plan**") instead of a
  // real markdown heading. Treat that as an equally valid section marker rather than rejecting a
  // plan that clearly has the section, just not in strict "## " form.
  return /^\*\*[^*\n]*?(testing plan|test plan|validation plan)[^*\n]*?\*\*\s*$/im.test(text);
}

async function readImplementationPlanText(workspacePath) {
  if (!workspacePath) return '';
  try {
    const planContent = await window.api.readFile(workspacePath, 'implementation_plan.md', { maxChars: 100000 });
    if (typeof planContent === 'string') return planContent;
    if (planContent && !planContent.error && typeof planContent.content === 'string') return planContent.content;
  } catch (err) {
    console.error('Error reading implementation_plan.md:', err);
  }
  return '';
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
  const regexFallback = () => ({
    mode: 'plan',
    reason: 'Could not safely classify task complexity.',
    needsLocalInspection: isLocalProjectOrFolderRequest(userPrompt),
    benefitsFromWorkspaceContext: requestPlausiblyBenefitsFromWorkspaceContext(userPrompt),
    taskComplexity: 'standard'
  });
  const prompt = `Classify whether this Orion AI request should require an implementation plan before acting.

Return only compact JSON with:
{"mode":"plan"|"direct"|"answer","reviewOnly":true|false,"needsLocalInspection":true|false,"benefitsFromWorkspaceContext":true|false,"taskComplexity":"light"|"standard"|"deep","reason":"short reason"}

Definitions:
- plan: broad or complex work where the user should review direction first, such as creating a substantial new project, major redesign/refactor, architecture change, risky migration, security-sensitive change, or ambiguous multi-step coding task that will modify the workspace.
- direct: concrete low-risk work that should be executed immediately, such as running/opening a program, running tests, showing a directory, setting an entry point, pushing to Git when explicitly requested, viewing a file, making a narrow edit, fixing a small bug, continuing an already-approved task, OR reading/inspecting local files to answer a question about them.
- answer: a question or explanation that can be answered in chat without workspace changes or command execution.
- reviewOnly: true ONLY when the user asked you to FIND/review/audit issues, bugs, typos, or faults WITHOUT being asked to fix them. In that case present findings as a report and do not modify files. Otherwise false.
- needsLocalInspection: true when the user named or clearly implied a specific local folder/project/program/repo on this machine (e.g. "the game on my desktop called X") and the request asks to inspect, describe, or improve it. Otherwise false.
- benefitsFromWorkspaceContext: true when the request asks for ideas, suggestions, design direction, or improvements that reference this app/codebase itself (its features, code, or workspace) rather than being a purely generic/abstract question. Otherwise false.
- taskComplexity: how demanding the underlying work itself is, independent of mode. "light" = a quick lookup, a chat answer, or a single trivial edit. "standard" = a normal bounded task — a few file edits, a well-defined bug fix, a routine command. "deep" = multi-file implementation, a non-trivial refactor, or anything that would also be classified mode:"plan". Default to "standard" when unsure.

Decision guidance:
- Prefer direct for read-only local inspection or inventory tasks, including listing installed runtimes, checking versions, checking PATH, finding executables, showing files, or running safe diagnostic commands.
- Prefer direct for any request to describe, explain, summarize, or understand a local program, project, or file — even if multiple files must be read. Reading files is not risky.
- Prefer direct for recommendations or improvement ideas about an existing local folder/project/program; inspect the project first, then answer from evidence.
- Prefer direct for a small number of safe commands that gather facts, even if the answer has several sections.
- Prefer plan only when the task requires a coordinated implementation, risky changes, many file edits, architecture/design choices, migrations, security-sensitive changes, or user review before modifying the workspace.
- Prefer plan when the user moves from discussing/recommending an idea to actually telling you to build, add, or implement it as a real feature — especially a new game, new subsystem, or anything needing new architecture (new physics/rendering, new UI, new server logic, multiple files). "What do you think of X" and "recommend improvements" are direct; "let's add X" or "go build X" for that same substantial idea is plan, even mid-conversation.
- Prefer answer when no local tools or workspace actions are needed at all.
- NEVER return plan for a read-only question about what a local program/project/file does or contains.
- NEVER return plan for a code review, bug hunt, typo check, or analysis of a local project — these are read-only inspection tasks.
- NEVER return direct for a request to actually build/add/implement a substantial new game, feature, or system with multiple new parts (new UI, new physics/logic, new server-side state) just because earlier turns in the conversation were only brainstorming — the shift from "ideas" to "let's build it" is what makes it plan-worthy.

Examples:
- "what python environments do i have installed on this computer" -> direct
- "where is python installed and which one is first on PATH" -> direct
- "run the tests" -> direct
- "what is this program about" -> direct
- "can you tell me what llm-call does" -> direct
- "tell me about the project in my Desktop/projects folder" -> direct
- "I have a folder on my desktop called rocket sumo, recommend similar games and improvements" -> direct
- "what does this file do" -> direct
- "look through my program and find any bugs" -> direct
- "can you find typos and structural faults in my project" -> direct
- "review my code for issues" -> direct
- "audit this codebase for security problems" -> direct
- "how could we make this program better?" -> direct
- "what improvements could we make to this app?" -> direct
- "can you suggest ways to improve this project?" -> direct
- "what would you recommend to enhance this?" -> direct
- "can you walk me through this?" -> direct
- "what are the next steps?" -> direct
- "how does this compare to other approaches?" -> direct
- "elaborate on how that works" -> direct
- "explain how PATH works on Windows" -> answer
- "build me a Python desktop app" -> plan
- "refactor the authentication flow" -> plan
- "i have a folder on my desktop called rocket sumo, recommend similar games" -> direct
- "lets add this game to the collection with the others, ensure smooth animated professional performance" -> plan
- "go ahead and implement the racing game idea we just discussed, with a real 3D physics engine and new controller UI" -> plan
- "let's build that feature you suggested" -> plan

Be practical and avoid ceremony. Decide from task complexity and risk, not from whether the response may need multiple bullet points.

User message:
${JSON.stringify(String(userPrompt || ''))}`;

  try {
    if (modelName && !modelName.startsWith('gemini-')) {
      return regexFallback();
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
    if (!response.ok) return regexFallback();
    const data = await response.json();
    const text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text || '{}');
    const mode = ['plan', 'direct', 'answer'].includes(parsed.mode) ? parsed.mode : 'plan';
    const taskComplexity = ['light', 'standard', 'deep'].includes(parsed.taskComplexity) ? parsed.taskComplexity : 'standard';
    return {
      mode,
      reviewOnly: !!parsed.reviewOnly,
      reason: String(parsed.reason || ''),
      needsLocalInspection: !!parsed.needsLocalInspection,
      benefitsFromWorkspaceContext: !!parsed.benefitsFromWorkspaceContext,
      taskComplexity
    };
  } catch (e) {
    console.error('Planning need classifier failed:', e);
    return regexFallback();
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

function shouldHaveUsedToolsButDidNot(text, workWalkthrough, userPrompt = '', context = {}) {
  if ((workWalkthrough || []).length > 0) return false;
  const response = String(text || '').trim();
  if (!response) return true;
  if (context && context.reviewOnly) return true;
  // context.needsLocalInspection carries the cached classifyPlanningNeed() verdict when the main
  // loop calls this; direct callers (tests, other call sites) that omit it fall back to the regex
  // check so this function still works as a standalone classifier.
  const needsLocalProject = (context && context.needsLocalInspection !== undefined)
    ? !!context.needsLocalInspection
    : isLocalProjectOrFolderRequest(userPrompt);
  const needsLocalInspection = needsLocalProject || isLocalSystemFactRequest(userPrompt);
  if (needsLocalProject && (isGenericNonAnswer(response) || isLocalAccessDeflection(response))) return true;
  if (needsLocalInspection && isGenericNonAnswer(response)) return true;
  return false;
}

// The model_no_tool_use correction tells the model what NOT to do ("don't mention tools,
// workspace, or this correction") but gives it nothing concrete to redirect toward — a small model
// frequently just paraphrases the correction back instead of answering the user's actual message.
// A real transcript showed exactly this: the user asked to keep discussing a topic, and the model
// replied "My previous response... did not require workspace interaction or an implementation
// plan. I am ready for your next instruction" — describing the internal nudge instead of engaging
// with the topic at all.
function looksLikeLeakedNoToolCorrection(text) {
  const normalized = String(text || '').toLowerCase();
  return /\b(did not require (workspace|tools?|an implementation plan)|no workspace interaction|ready for (your )?next instruction|mention(ed)? (this|the) correction|previous response (was|did not)|does not require (tools?|workspace)|not require workspace interaction)\b/.test(normalized);
}

function isGenericNonAnswer(text) {
  const normalized = String(text || '').toLowerCase().replace(/[^\w\s']/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  return /^(understood|ok|okay|sure|got it|done|sounds good|working on it|i understand|acknowledged|noted|task finished)( thanks)?$/.test(normalized);
}

function requestNeedsLocalInspection(prompt) {
  return isLocalSystemFactRequest(prompt) || isLocalProjectOrFolderRequest(prompt);
}

function requestPlausiblyBenefitsFromWorkspaceContext(prompt) {
  const tokens = new Set(tokenizeIntentText(prompt));
  const referencesAppOrCode = hasAnyToken(tokens, [
    'app', 'game', 'games', 'feature', 'features', 'controller', 'companion',
    'workspace', 'project', 'codebase', 'code', 'program', 'orion'
  ]);
  const isIdeaOrDesignRequest = hasAnyToken(tokens, [
    'idea', 'ideas', 'suggest', 'suggestions', 'recommend', 'recommendations',
    'design', 'build', 'add', 'extend', 'improve', 'create', 'implement', 'plan'
  ]);
  return referencesAppOrCode && isIdeaOrDesignRequest;
}

const INSPECTION_TOOLS = new Set(['list_files', 'read_file', 'get_workspace_info', 'grep_search', 'search_embeddings', 'get_symbol_index']);
const MEMORY_WRITE_TOOLS = new Set(['append_project_memory', 'remember_fact', 'remember_decision']);

function hasPriorWorkspaceInspection(conversation) {
  const messages = (conversation && Array.isArray(conversation.messages)) ? conversation.messages : [];
  return messages.some(message => Array.isArray(message && message.logs) && message.logs.some(log => log && INSPECTION_TOOLS.has(log.toolName)));
}

// Substantive inspection this turn = enough distinct inspection-tool calls that the model
// likely learned something durable about the workspace worth persisting to project memory.
function turnDidSubstantiveInspection(workWalkthrough) {
  const done = (workWalkthrough || []).filter(item => item && item.status !== 'error');
  const inspectionCalls = done.filter(item => INSPECTION_TOOLS.has(item.toolName));
  if (inspectionCalls.length >= 2) return true;
  const toolNames = new Set(inspectionCalls.map(item => item.toolName));
  return toolNames.has('get_symbol_index') && toolNames.has('read_file');
}

function turnAlreadyWroteMemory(workWalkthrough) {
  return (workWalkthrough || []).some(item => item && MEMORY_WRITE_TOOLS.has(item.toolName));
}

// A transcript showed a plain "can you launch this program?" request silently escalate into 7+
// unrequested edits to server.js after the launch failed on a pre-existing bug — the user only
// asked for a low-risk, read-only action, but got repeated, increasingly destructive-feeling
// source edits with no check-in. This distinguishes a pure launch/run request (no edit/fix
// language) from one that already authorizes changes.
function looksLikeLaunchOnlyRequest(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (!text.trim()) return false;
  const hasLaunchVerb = /\b(launch|run|start|open|boot up|fire up|spin up|execute)\b/.test(text);
  const hasEditVerb = /\b(fix|edit|change|modify|update|debug|repair|patch|refactor|add|build|implement|create|remove|delete|rewrite)\b/.test(text);
  return hasLaunchVerb && !hasEditVerb;
}

// Only the FIRST edit attempt of a turn needs to be intercepted — once the user has been asked and
// responds (their reply naturally won't match looksLikeLaunchOnlyRequest if it authorizes a fix,
// e.g. "yes fix it"), the gate no longer applies to that follow-up turn.
function hasFailedLaunchAttemptThisRun(items) {
  const list = Array.isArray(items) ? items : [];
  return list.some(item => item && item.status === 'error' &&
    (item.toolName === 'launch_workspace_app' || item.toolName === 'run_command' || item.toolName === 'start_command'));
}

function isLocalProjectOrFolderRequest(prompt) {
  const text = String(prompt || '').toLowerCase();
  const tokens = new Set(tokenizeIntentText(prompt));
  const localAnchor = /\b(on|in)\s+my\s+desktop\b/.test(text) ||
    /\bdesktop\s+projects?\b/.test(text) ||
    /\bprojects?\s+folder\b/.test(text) ||
    hasAnyToken(tokens, ['desktop', 'local']);
  const namedThing = /\b(folder|project|program|app|game|repo|repository)\s+(called|named)\b/.test(text) ||
    /\bcalled\s+["']?[a-z0-9][a-z0-9 _-]+["']?/.test(text) ||
    hasAnyToken(tokens, ['folder', 'project', 'program', 'app', 'game', 'repo', 'repository']);
  const asksForInspectionOrAdvice = hasAnyToken(tokens, [
    'recommend', 'recommendations', 'ideas', 'improve', 'better', 'enhance',
    'similar', 'style', 'styles', 'contains', 'inside', 'look', 'inspect',
    'find', 'what', 'where', 'list', 'show', 'open', 'run'
  ]);
  return localAnchor && namedThing && asksForInspectionOrAdvice;
}

function isLocalAccessDeflection(text) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return /only access .*explicitly provided/.test(normalized) ||
    /within (the )?defined workspace/.test(normalized) ||
    /do not have .*capability .*explore .*desktop/.test(normalized) ||
    /cannot .*arbitrarily .*desktop/.test(normalized) ||
    /need .*exact (location|path)/.test(normalized) ||
    /provide .*full path/.test(normalized) ||
    /describe the (games|files|contents|project)/.test(normalized);
}

function buildLocalInspectionNoToolGuidance(userPrompt, planningDecision) {
  const needsLocalProject = (planningDecision && planningDecision.needsLocalInspection !== undefined)
    ? !!planningDecision.needsLocalInspection
    : isLocalProjectOrFolderRequest(userPrompt);
  if (needsLocalProject) {
    return ' The user named a local folder/project/program. Call `change_workspace` with that name directly FIRST — it already searches Desktop, Desktop\\Projects, and Desktop\\projects and fuzzy-matches the name (ignoring spaces/hyphens/underscores/case), so "mayor life" resolves to a folder literally named "Mayor-Life" without any manual search. Only if `change_workspace` itself reports the path does not exist should you fall back to a bounded PowerShell `Get-ChildItem` directory search/listing (`-Directory`, `-Depth 2` or `-Depth 3`, `-ErrorAction SilentlyContinue`) — and even then, prefer matching by fuzzy substring (ignore spaces/hyphens) rather than the user\'s literal phrasing, since folder names rarely match natural-language phrasing exactly. Do not ask the user to paste contents, do not claim Desktop access is unavailable, and do not use clarifying questions before inspecting.';
  }
  if (isLocalSystemFactRequest(userPrompt)) {
    return ' The user asked about this local computer. Call local inspection commands now, such as `systeminfo`, CPU/RAM/disk/process commands, or another available local route. Do not answer with acknowledgement only.';
  }
  return '';
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

// A CLI's own error output sometimes names the exact fix (e.g. "Option \"init\" has been
// deprecated. Please use \"create-jest\" package"). A run showed Orion burning two web searches
// re-discovering that same replacement command instead of just running it — the answer was
// already in the tool output it had just received.
function extractDeprecationReplacementHint(errorText) {
  const text = String(errorText || '');
  const match = text.match(/deprecated[^.]*\.?\s*(?:please\s+)?use\s+["'`]?([a-z0-9@/_.\-]+)["'`]?\s*(?:package|command|instead)?/i)
    || text.match(/use\s+["'`]?([a-z0-9@/_.\-]+)["'`]?\s+instead/i);
  return match ? match[1] : '';
}

function classifyAgentFailure({ toolName = '', args = {}, result = null, errorText = '', failureCount = 1, category = '' } = {}) {
  if (category) return { category, recommendedNature: recommendedNatureForFailureCategory(category), toolName, args, errorText: String(errorText || ''), failureCount };

  const text = String(errorText || '').toLowerCase();
  const command = String((args && args.command) || '');
  const replacementHint = extractDeprecationReplacementHint(errorText);

  let resolved = 'tool_failure';
  if (failureCount >= 3) {
    resolved = 'repeated_tool_failure';
  } else if (replacementHint && /deprecated/.test(text)) {
    resolved = 'deprecated_command_with_replacement';
  } else if (toolName === 'patch_file' && /target content block not found|target.*not found|line range|patch.*failed/.test(text)) {
    resolved = 'patch_target_missing';
  } else if (toolName === 'change_workspace' && /workspace path|invalid or does not exist|directory does not exist|path does not exist|does not exist/.test(text)) {
    resolved = 'workspace_path_missing';
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

  return { category: resolved, recommendedNature: recommendedNatureForFailureCategory(resolved), toolName, args, errorText: String(errorText || ''), failureCount, replacementHint };
}

function recommendedNatureForFailureCategory(category) {
  const map = {
    timeout: 'transient',
    auth_missing: 'terminal',
    command_blocked: 'terminal',
    missing_dependency: 'fixable',
    workspace_path_missing: 'fixable',
    patch_target_missing: 'fixable',
    deprecated_command_with_replacement: 'fixable',
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
  if (category === 'deprecated_command_with_replacement' && failure && failure.replacementHint) {
    return `The command's own output already named the fix: it says to use \`${failure.replacementHint}\`. Run that directly. Do not search the web for documentation that repeats information already in the tool output you just received.`;
  }
  const messages = {
    repeated_tool_failure: 'Do not quit the task. Do not retry it blindly. Pause the repeated call, inspect fresh state and recent output, explain the likely cause, then choose a different strategy before retrying: use a different tool, narrower arguments, or ask for the missing prerequisite.',
    patch_target_missing: 'Re-read the surrounding file lines before editing. Use a narrower exact target, a line-range patch, or adjust the patch to the current file contents instead of repeating the same patch.',
    workspace_path_missing: 'The workspace path guess failed. Do not call change_workspace again with another guessed path. Resolve the folder first: run a bounded PowerShell Get-ChildItem directory search against the likely parent locations such as C:\\Users\\Owner\\Desktop and C:\\Users\\Owner\\Desktop\\Projects, using name tokens from the user request and the failed path, -Directory, -Depth 2 or -Depth 3, and -ErrorAction SilentlyContinue. Then pick the closest real directory from the local listing and call change_workspace once with that verified absolute path.',
    command_blocked: 'The command was blocked by safety or planning rules. Keep the safety behavior intact; use a safer non-destructive command, an internal executable/args path, or ask for explicit plan approval when required.',
    test_failure: 'Treat this as a regression signal. Read the failing test output, identify the first failing assertion or command, fix the code or test expectation, and rerun the relevant tests before summarizing.',
    missing_dependency: 'Install or configure the missing dependency only after checking the project manifest and existing package manager. If installation is not appropriate, choose a tool that uses available local capabilities.',
    auth_missing: 'Stop retrying credential-gated work. Preserve state, name the missing credential or permission, and ask the user to provide or configure it before continuing.',
    timeout: 'Do not repeat the same long-running action unchanged. Check if the process is a GUI/Pygame app that blocks until closed. If so, add an automated exit flag to the code (e.g. exit after N frames/ticks), run with a short timeout, or use start_command/kill_command instead of waiting for a long timeout.',
    interactive_command_needs_input: 'Do not run an interactive command as a blocking test without stdin. Pipe a short scripted input sequence, redirect an input fixture, or use start_command with a short timeout followed by read_command_output and kill_command.',
    model_no_tool_use: 'Your response appeared to promise or report workspace work, but no tools were called. If the task requires looking at files, running commands/tests, editing code, creating files, saving memory, or verifying behavior, call the appropriate tools now. If the task does not require tools, answer the user naturally and do not mention tools, workspace operations, or this correction.',
    tool_failure: 'Inspect the error and current workspace state before trying again. Change one meaningful variable in the next attempt, such as the target path, command, arguments, or verification step.'
  };
  return messages[category] || messages.tool_failure;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sleepRespectingStop(ms) {
  const boundedMs = Math.max(Number(ms) || 0, 0);
  const startedAt = Date.now();
  while (Date.now() - startedAt < boundedMs) {
    if (isStopRequested) throw createUserStopError(stopRequestMode);
    const remainingMs = Math.max(0, boundedMs - (Date.now() - startedAt));
    await sleep(Math.min(250, remainingMs));
  }
}

async function sleepWithModelApiStatus(ms, label, onWarning) {
  const boundedMs = Math.min(Math.max(Number(ms) || 0, 0), MODEL_API_MAX_RETRY_WAIT_MS);
  const startedAt = Date.now();
  if (onWarning) {
    onWarning(`${label} Waiting ${(boundedMs / 1000).toFixed(1)}s before retrying instead of hammering the provider...`);
  }
  while (Date.now() - startedAt < boundedMs) {
    if (isStopRequested) {
      throw createUserStopError(stopRequestMode);
    }
    const remainingMs = Math.max(0, boundedMs - (Date.now() - startedAt));
    await sleep(Math.min(1000, remainingMs));
  }
}

// Small models often retry a broken run_command/start_command with only cosmetic differences —
// different quote style, a redundant `import sys`, swapping print() for sys.stdout.write() — that
// make each attempt look like a "new" command to an exact-args match, so the repeated-failure
// guard below never accumulates a count and never engages. A real transcript showed six such
// variations of the same failing `python -c "..."` invocation run back to back with no escalation.
// Normalize away superficial command text and key on the failure category instead so these collapse
// into one growing counter.
function buildRepeatedFailureKey(toolName, args, category) {
  if (toolName === 'run_command' || toolName === 'start_command') {
    const normalizedCommand = String((args && args.command) || '')
      .toLowerCase()
      .replace(/["'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return `${toolName}:${normalizedCommand}:${category}`;
  }
  return `${toolName}:${stableStringify(args)}:${category}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function resolveConversationWorkspace(conversation) {
  const conv = conversation && typeof conversation === 'object' ? conversation : {};
  return conv.workspace || conv.projectPath || (window.getCurrentWorkspace ? window.getCurrentWorkspace() : '');
}

function expandCommonWindowsPath(rawPath) {
  return String(rawPath || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\$env:USERPROFILE/gi, resolvedHomeDir)
    .replace(/\$env:HOMEDRIVE/gi, resolvedHomeDir.slice(0, 2) || 'C:')
    .replace(/\$env:HOMEPATH/gi, resolvedHomeDir.slice(2) || '\\Users\\Owner')
    .replace(/^~[/\\]?/, resolvedHomeDir + '\\');
}

function normalizeLocalPathNameForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[_\-\s.]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokenizeLocalPathNameForMatch(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function editDistanceWithin(left, right, maxDistance) {
  const a = String(left || '');
  const b = String(right || '');
  const limit = Math.max(0, Number(maxDistance) || 0);
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

function tokenMatchScore(targetToken, candidateToken) {
  if (!targetToken || !candidateToken) return 0;
  if (targetToken === candidateToken) return 100;
  if (targetToken.length >= 3 && candidateToken.length >= 3 && (
    targetToken.includes(candidateToken) ||
    candidateToken.includes(targetToken)
  )) {
    return 80;
  }
  const maxLen = Math.max(targetToken.length, candidateToken.length);
  const allowedDistance = maxLen >= 4 ? 2 : 1;
  return editDistanceWithin(targetToken, candidateToken, allowedDistance) ? 65 : 0;
}

function scoreWorkspaceDirectoryVariant(targetName, candidateName) {
  const targetNorm = normalizeLocalPathNameForMatch(targetName);
  const candidateNorm = normalizeLocalPathNameForMatch(candidateName);
  if (!targetNorm || !candidateNorm) return 0;
  if (targetNorm === candidateNorm) return 1000;
  if (targetNorm.length >= 4 && candidateNorm.includes(targetNorm)) {
    return 700 - Math.abs(candidateNorm.length - targetNorm.length);
  }
  if (candidateNorm.length >= 4 && targetNorm.includes(candidateNorm)) {
    return 650 - Math.abs(candidateNorm.length - targetNorm.length);
  }

  const targetTokens = tokenizeLocalPathNameForMatch(targetName);
  const candidateTokens = tokenizeLocalPathNameForMatch(candidateName);
  if (!targetTokens.length || !candidateTokens.length) return 0;
  const used = new Set();
  let total = 0;
  let matched = 0;
  for (const targetToken of targetTokens) {
    let bestIndex = -1;
    let bestScore = 0;
    candidateTokens.forEach((candidateToken, index) => {
      if (used.has(index)) return;
      const score = tokenMatchScore(targetToken, candidateToken);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestScore > 0) {
      used.add(bestIndex);
      matched++;
      total += bestScore;
    }
  }
  if (!matched) return 0;
  if (matched === targetTokens.length && matched === candidateTokens.length) total += 150;
  else if (matched === targetTokens.length) total += 75;
  return total - Math.abs(candidateNorm.length - targetNorm.length);
}

function chooseWorkspaceDirectoryVariant(targetName, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const targetTokens = tokenizeLocalPathNameForMatch(targetName);
  const threshold = targetTokens.length > 1 ? 150 : 80;
  let best = null;
  let bestScore = 0;
  for (const candidate of list) {
    const candidateName = typeof candidate === 'string'
      ? candidate
      : (candidate && (candidate.name || getLocalPathBaseName(candidate.path))) || '';
    const score = scoreWorkspaceDirectoryVariant(targetName, candidateName);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= threshold ? best : null;
}

function trimTrailingLocalPathSeparators(value) {
  return String(value || '').replace(/[\\/]+$/, '');
}

function getLocalPathBaseName(value) {
  const clean = trimTrailingLocalPathSeparators(value);
  const parts = clean.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

function getLocalPathParent(value) {
  const clean = trimTrailingLocalPathSeparators(value);
  const match = clean.match(/^(.*)[\\/][^\\/]+$/);
  return match ? match[1] : '';
}

function isAbsoluteLocalPath(value) {
  return /^[a-zA-Z]:[\\/]/.test(String(value || '')) || /^\\\\/.test(String(value || ''));
}

function joinLocalPath(parentPath, childPath) {
  const parent = trimTrailingLocalPathSeparators(parentPath);
  const child = String(childPath || '').replace(/^[\\/]+/, '');
  const separator = parent.includes('/') && !parent.includes('\\') ? '/' : '\\';
  return parent ? `${parent}${separator}${child}` : child;
}

function uniqueLocalPaths(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    const value = trimTrailingLocalPathSeparators(candidate);
    if (!value) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function tryListWorkspacePath(pathValue) {
  try {
    const files = await window.api.listFiles(pathValue);
    if (files && files.error) return { exists: false, error: files.error };
    return { exists: true, files };
  } catch (error) {
    return { exists: false, error: error && error.message ? error.message : String(error) };
  }
}

async function listWorkspaceDirectoryCandidates(parentPath) {
  try {
    const api = window && window.api ? window.api : {};
    const entries = typeof api.listDirectoryChildren === 'function'
      ? await api.listDirectoryChildren(parentPath)
      : await api.listFiles(parentPath);
    if (entries && entries.error) return { candidates: [], error: entries.error };
    const candidates = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && entry.isDir)
      .map((entry) => {
        const rawPath = String(entry.path || entry.name || '');
        const name = entry.name || getLocalPathBaseName(rawPath);
        const resolvedPath = isAbsoluteLocalPath(rawPath) ? rawPath : joinLocalPath(parentPath, rawPath);
        return { name, path: resolvedPath };
      });
    return { candidates, error: '' };
  } catch (error) {
    return { candidates: [], error: error && error.message ? error.message : String(error) };
  }
}

async function resolveWorkspacePathForChange(rawPath) {
  const targetPath = expandCommonWindowsPath(rawPath);
  const direct = await tryListWorkspacePath(targetPath);
  if (direct.exists) {
    return { success: true, path: targetPath, resolvedFrom: targetPath, fuzzyResolved: false };
  }

  const targetName = getLocalPathBaseName(targetPath);
  const desktopPath = joinLocalPath(resolvedHomeDir, 'Desktop');
  const searchRoots = uniqueLocalPaths([
    getLocalPathParent(targetPath),
    desktopPath,
    joinLocalPath(desktopPath, 'Projects'),
    joinLocalPath(desktopPath, 'projects')
  ]);
  const errors = [direct.error].filter(Boolean);

  for (const root of searchRoots) {
    const { candidates, error } = await listWorkspaceDirectoryCandidates(root);
    if (error) errors.push(`${root}: ${error}`);
    const match = chooseWorkspaceDirectoryVariant(targetName, candidates);
    if (!match) continue;
    const verified = await tryListWorkspacePath(match.path);
    if (verified.exists) {
      return {
        success: true,
        path: match.path,
        resolvedFrom: targetPath,
        fuzzyResolved: true,
        matchedName: match.name
      };
    }
    if (verified.error) errors.push(`${match.path}: ${verified.error}`);
  }

  return {
    success: false,
    path: targetPath,
    error: errors[0] || `Directory does not exist: ${targetPath}`
  };
}

function rememberPendingWorkspaceResolution(conversation, rawPath, userPrompt = '') {
  if (!conversation || !rawPath) return null;
  const requestedPath = expandCommonWindowsPath(rawPath);
  const pending = {
    requestedPath,
    requestedName: getLocalPathBaseName(requestedPath),
    originalPrompt: String(userPrompt || '').slice(0, 2000),
    createdAt: Date.now()
  };
  conversation.pendingWorkspaceResolution = pending;
  return pending;
}

function clearPendingWorkspaceResolution(conversation) {
  if (conversation && conversation.pendingWorkspaceResolution) {
    delete conversation.pendingWorkspaceResolution;
  }
}

function extractCommandPathArgument(commandText) {
  const text = String(commandText || '');
  const match = text.match(/-(?:LiteralPath|Path)\s+(?:"([^"]+)"|'([^']+)'|([^\s|]+))/i);
  return match ? expandCommonWindowsPath(match[1] || match[2] || match[3] || '') : '';
}

function parseDirectoryCandidateLine(line, parentPath = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  if (/^(directory:|mode\s+|----)/i.test(trimmed)) return null;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return { name: getLocalPathBaseName(trimmed), path: trimmed };
  }

  const tableMatch = trimmed.match(/^d\S*\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s+(.+)$/i);
  const name = tableMatch ? tableMatch[1].trim() : trimmed;
  if (!name || /^(name|length|lastwritetime)$/i.test(name)) return null;
  if (!/[a-z0-9]/i.test(name)) return null;
  if (/[{}:]/.test(name)) return null;
  return {
    name,
    path: parentPath ? joinLocalPath(parentPath, name) : name
  };
}

function extractDirectoryCandidatesFromCommandOutput(stdout, commandText = '') {
  const parentPath = extractCommandPathArgument(commandText);
  const seen = new Set();
  return String(stdout || '')
    .split(/\r?\n/)
    .map(line => parseDirectoryCandidateLine(line, parentPath))
    .filter(Boolean)
    .filter(candidate => {
      const key = String(candidate.path || candidate.name || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildPendingWorkspaceResolutionHint({ toolName, args = {}, result = {}, conversation = {} } = {}) {
  if (toolName !== 'run_command') return null;
  const pending = conversation && conversation.pendingWorkspaceResolution;
  if (!pending || !pending.requestedName) return null;
  if (!result || result.error || result.success === false || Number(result.exitCode || 0) !== 0) return null;
  const candidates = extractDirectoryCandidatesFromCommandOutput(result.stdout || '', args.command || '');
  const match = chooseWorkspaceDirectoryVariant(pending.requestedName, candidates);
  if (!match) return null;
  return {
    requestedName: pending.requestedName,
    requestedPath: pending.requestedPath,
    matchedName: match.name || getLocalPathBaseName(match.path),
    matchedPath: match.path,
    originalPrompt: pending.originalPrompt || '',
    guidance: `A later directory listing found "${match.name || getLocalPathBaseName(match.path)}", which is the closest real match for "${pending.requestedName}". Use change_workspace with "${match.path}" and continue the original local-project request instead of asking the user to verify the spelling.`
  };
}

function buildPendingWorkspaceResolutionCorrectionPrompt(answerText, workWalkthrough = []) {
  const hintItem = (workWalkthrough || []).find(item => item && item.localDirectoryResolution);
  if (!hintItem) return '';
  const hint = hintItem.localDirectoryResolution;
  const text = String(answerText || '').toLowerCase();
  const asksUserToVerify = /couldn'?t find|could not find|exact match|verify|double-check|provide the exact|spelling|location/.test(text);
  const mentionsMatch = hint.matchedName && text.includes(String(hint.matchedName).toLowerCase());
  const alreadyContinues = /change_workspace|changed workspace|reading|read_file|list_files|inspect/i.test(String(answerText || '')) && mentionsMatch;
  if (alreadyContinues && !asksUserToVerify) return '';
  return `[SYSTEM: Directory resolution continuity guard. A later local directory listing found a strong match for the previously failed workspace path.\n\nRequested/dictated name: ${hint.requestedName}\nMatched real folder: ${hint.matchedPath}\nOriginal request: ${hint.originalPrompt || '(not recorded)'}\n\nDo not ask the user to verify the spelling again. Call change_workspace with the matched real folder, then continue the original request from evidence. If the latest user only asked for the folder list as a way to help you recover, explain briefly that you found the match and proceed.]`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_API_REQUEST_TIMEOUT_MS, label = 'request') {
  const externalSignal = options.signal;
  const fetchOptions = { ...options };
  delete fetchOptions.signal;
  const controller = new AbortController();
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw createUserStopError(stopRequestMode);
    }
    externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (externalSignal && externalSignal.aborted) {
        throw createUserStopError(stopRequestMode);
      }
      throw new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortFromExternalSignal);
    }
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

function isGeminiHardQuotaError(status, message) {
  if (status !== 429) return false;
  return /monthly spending cap|project spend cap|ai\.studio\/spend|billing/i.test(String(message || ''));
}

function createNonRetryableModelError(message) {
  const error = new Error(message);
  error.nonRetryable = true;
  return error;
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

// classifyPlanningNeed/classifyPlanApprovalIntent/countTokens/compactHistory are all small,
// single-purpose utility calls (a JSON classification, a token count, a summary) that a cheap
// model handles identically well — but previously received the user's full modelName, so
// selecting gemini-2.5-pro for real coding work meant every one of these utility calls also went
// out at pro pricing for no reason. Maps any selected model down to the cheapest tier in its own
// family; falls back to the original name unchanged for non-Gemini models (e.g. Ollama) or an
// unrecognized Gemini family, so behavior there is unaffected.
function resolveUtilityModelName(modelName) {
  const name = String(modelName || '');
  if (!name.startsWith('gemini-')) return name;
  if (name.startsWith('gemini-3')) return 'gemini-3.1-flash-lite';
  if (name.startsWith('gemini-2.5')) return 'gemini-2.5-flash-lite';
  return name;
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

async function callOllamaAPI(messages, modelName, onWarning, disableTools = false, options = {}) {
  const url = `http://localhost:11434/api/chat`;
  
  // Format standard Orion AI system instruction
  const systemInstruction = SYSTEM_INSTRUCTION;
  
  const ollamaTools = convertGeminiToOllamaTools([
    {
      functionDeclarations: [
        ...(agentExecutionMode === 'executing' ? OPERATIONAL_CONTEXT_TOOL_DECLARATIONS : []),
        ...ASSET_BROWSER_VISUAL_TOOL_DECLARATIONS,
        {
          name: "list_files",
          description: "Returns a curated project file inventory for the active workspace by default. The default hides generated caches, dependencies, runtime/user data, backups, and sensitive-looking files; use mode='all' only when the user explicitly needs a raw workspace listing.",
          parameters: {
            type: "OBJECT",
            properties: {
              mode: { type: "STRING", enum: ["project", "all"], description: "Use 'project' for the curated default inventory. Use 'all' only for an explicit raw recursive listing." },
              maxFiles: { type: "NUMBER", description: "Maximum curated project files to return before truncation. Ignored for mode='all'." }
            }
          }
        },
        {
          name: "get_workspace_info",
          description: "Returns the active workspace directory, conversation scope, and project metadata. Use when the user asks where the project/program is or asks for the directory.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "change_workspace",
          description: "Changes the active workspace directory of this conversation to a new absolute directory path on your computer. Use this only after the path is explicit or locally verified. The executor also resolves obvious folder-name variants such as spaces, hyphens, underscores, casing, and minor dictation/autocorrect differences against nearby Desktop/Projects directories before failing. For fuzzy Desktop/project names, first resolve the real folder with a bounded run_command Get-ChildItem search; if this tool fails because the path does not exist, search/list candidate directories before retrying with another path.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "The verified absolute path to the directory you want to set as the active workspace." }
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
          description: "Runs a command in powershell in the workspace directory, waits for completion, and returns code, stdout, stderr, and timeout status. For local machine facts, a non-zero exit proves only that this command attempt failed; try a different local route before concluding the task is blocked. For a top-level Desktop/folder listing, use a non-recursive command such as Get-ChildItem -LiteralPath \"C:\\Users\\Owner\\Desktop\" -Directory | Select-Object -ExpandProperty Name; do not add -Depth/-Recurse unless nested folders are explicitly requested.",
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
        },
        {
          name: "ask_clarifying_questions",
          description: "Pauses and presents 2-3 structured clarifying questions to the user when key design decisions are unspecified. Use BEFORE writing STRATEGY.md when the request leaves critical choices open (visual style, core mechanic, scale/performance strategy, framework). Do not use this as a substitute for inspecting an existing local folder/project/program; if the user named one, call local tools first and ask only for ambiguities that remain after inspection. IMPORTANT: Do NOT say 'Task finished' or any completion text when calling this tool — the task is paused awaiting answers, not done. The user sees an interactive card with radio options, recommended badges, and a free-text 'Other' fallback. Their answers resume the agent automatically.",
          parameters: {
            type: "OBJECT",
            properties: {
              intro: { type: "STRING", description: "Brief intro sentence shown above the questions, e.g. 'Before I write the strategy, a few quick design questions:'" },
              questions: {
                type: "ARRAY",
                description: "2-3 clarifying questions to present.",
                items: {
                  type: "OBJECT",
                  properties: {
                    header: { type: "STRING", description: "Short chip label for the question, max 12 chars, e.g. 'Visual Style'" },
                    question: { type: "STRING", description: "The full question text to display." },
                    options: {
                      type: "ARRAY",
                      description: "2-4 multiple-choice options.",
                      items: {
                        type: "OBJECT",
                        properties: {
                          label: { type: "STRING", description: "Option label shown to user." },
                          description: { type: "STRING", description: "Optional one-line explanation of this choice." },
                          recommended: { type: "BOOLEAN", description: "If true, badges this option as recommended." }
                        },
                        required: ["label"]
                      }
                    }
                  },
                  required: ["header", "question", "options"]
                }
              }
            },
            required: ["intro", "questions"]
          }
        },
        {
          name: "get_symbol_index",
          description: "Returns a symbol index for all JS/TS files in the workspace: function names, class names, and arrow functions with their line numbers. Use this BEFORE read_file on large source files — find the target symbol's line range first, then read only that range.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "step_complete",
          description: "Emit after completing each step of an approved implementation plan. Orion auto-runs the configured test command and injects a [POST-STEP VERIFICATION: ...] message. If tests fail you must fix them before the next step.",
          parameters: {
            type: "OBJECT",
            properties: {
              step: { type: "STRING", description: "Short description of the step just completed, e.g. 'Add auth middleware'." }
            },
            required: ["step"]
          }
        },
        {
          name: "read_project_memory",
          description: "Reads the persistent per-workspace project memory: architectural decisions, API shapes, gotchas, and preferences saved from prior sessions.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "append_project_memory",
          description: "Appends a durable fact to the workspace project memory. Use when you discover an architectural decision, API shape, gotcha, recurring pattern, or constraint that future sessions should know.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "The fact to store. Be specific and actionable." },
              category: { type: "STRING", description: "Optional category, e.g. architecture, api, gotcha, command, preference." }
            },
            required: ["text"]
          }
        },
        {
          name: "discover_skills",
          description: "Lists all registered skills in the skill registry. Call this before starting a complex or repetitive task to check if a reusable skill already exists.",
          parameters: {
            type: "OBJECT",
            properties: {
              group: { type: "STRING", description: "Optional group filter: utility, files, coding, home, calendar, research." }
            }
          }
        },
        {
          name: "run_skill",
          description: "Executes a registered skill by name with the given inputs. Returns the skill's output object.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "The skill name as registered (e.g. word-count)." },
              inputs: { type: "OBJECT", description: "Key-value inputs matching the skill's input schema." }
            },
            required: ["name"]
          }
        },
        {
          name: "create_skill",
          description: "Authors, tests, and registers a new reusable skill. The skill implementation must be a CommonJS module exporting async function(inputs). The test must exit 0 on success.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Kebab-case skill name, unique in the registry." },
              group: { type: "STRING", description: "Group: utility, files, coding, home, calendar, or research." },
              description: { type: "STRING", description: "Human-readable description used by the agent to decide when to invoke this skill." },
              inputs: { type: "OBJECT", description: "JSON schema of inputs: { paramName: { type, description, required } }." },
              outputs: { type: "OBJECT", description: "JSON schema of outputs: { resultName: { type, description } }." },
              implementation: { type: "STRING", description: "Full CommonJS JS source: module.exports = async function(inputs) { ... }." },
              test: { type: "STRING", description: "Full JS test source using Node assert. Must exit 0 on success, non-zero on failure." }
            },
            required: ["name", "group", "description", "implementation"]
          }
        },
        {
          name: "remember_fact",
          description: "Store a durable fact in global or project memory. Use scope='global' for cross-project facts (user habits, people, identity), scope='project' for workspace-specific facts.",
          parameters: {
            type: "OBJECT",
            properties: {
              scope: { type: "STRING", description: "global or project (default: project)." },
              text: { type: "STRING", description: "The fact to store." },
              category: { type: "STRING", description: "Optional category, e.g. architecture, api, gotcha, preference." }
            },
            required: ["text"]
          }
        },
        {
          name: "remember_decision",
          description: "Store an architectural or design decision in project memory with optional context about why it was made.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "The decision that was made." },
              context: { type: "STRING", description: "Optional: why this decision was made." },
              workspacePath: { type: "STRING", description: "Optional workspace path override." }
            },
            required: ["text"]
          }
        },
        {
          name: "remember_preference",
          description: "Store a user preference at global or project level. Call immediately when the user expresses how they like things done.",
          parameters: {
            type: "OBJECT",
            properties: {
              scope: { type: "STRING", description: "global or project (default: project)." },
              text: { type: "STRING", description: "The preference to store, e.g. 'Always use TypeScript interfaces over type aliases'." },
              workspacePath: { type: "STRING", description: "Optional workspace path override (project scope only)." }
            },
            required: ["text"]
          }
        },
        {
          name: "recall_memory",
          description: "Read memory for the given scope. Call at the start of a session with an active workspace to orient yourself with prior context.",
          parameters: {
            type: "OBJECT",
            properties: {
              scope: { type: "STRING", description: "global, project, or all (default: project)." },
              workspacePath: { type: "STRING", description: "Optional workspace path override." }
            }
          }
        },
        {
          name: "save_session_summary",
          description: "Save a summary of this session: what was accomplished, decisions made, discoveries, completed tasks, and open items. Call when the user is wrapping up or switching tasks.",
          parameters: {
            type: "OBJECT",
            properties: {
              workspacePath: { type: "STRING", description: "Optional workspace path override." },
              summary: { type: "STRING", description: "What was accomplished this session." },
              decisions: { type: "ARRAY", items: { type: "STRING" }, description: "Decisions made this session." },
              discoveries: { type: "ARRAY", items: { type: "STRING" }, description: "Interesting things discovered." },
              tasksCompleted: { type: "ARRAY", items: { type: "STRING" }, description: "Tasks completed this session." },
              openItems: { type: "ARRAY", items: { type: "STRING" }, description: "Open items or follow-ups remaining." }
            },
            required: ["summary"]
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
  
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: options.signal
  }, MODEL_API_REQUEST_TIMEOUT_MS, 'Ollama chat request');
  
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
    _orionActiveModelName: modelName,
    candidates: [
      {
        content: {
          parts: candidateParts
        }
      }
    ]
  };
}

// Lightweight per-turn token savings, distinct from compactHistory's heavyweight summarization
// (which only triggers near the context-window threshold). Old, large, read-only tool outputs
// (a full directory listing, a large file read, a search result) are still resent on every
// subsequent API call even though the model rarely needs to re-see the exact bytes once a few
// turns have passed — it either already acted on that information or would re-run the tool if it
// needed the data again. Only read-only/inventory tools are eligible: never trim edit/write/test
// results (patch_file, write_file, modify_file, run_tests, etc.), since those carry the actual
// evidence the completion gate and verification logic depend on.
const TOOL_RESULT_TRIM_THRESHOLD_CHARS = 4000;
const TOOL_RESULT_TRIM_KEEP_RECENT_MESSAGES = 6;
const TRIMMABLE_TOOL_RESULT_NAMES = new Set([
  'list_files', 'read_file', 'get_symbol_index', 'read_command_output',
  'google_search', 'fetch_web_page', 'read_notes', 'read_operational_context',
  'read_project_memory', 'recall_memory', 'discover_skills'
]);

function trimAgedToolResultsFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length <= TOOL_RESULT_TRIM_KEEP_RECENT_MESSAGES) return messages;
  const cutoff = messages.length - TOOL_RESULT_TRIM_KEEP_RECENT_MESSAGES;
  let changedAny = false;
  const result = messages.map((msg, index) => {
    if (index >= cutoff || !msg || msg.role !== 'tool' || !Array.isArray(msg.parts)) return msg;
    let msgChanged = false;
    const newParts = msg.parts.map(part => {
      const name = part && part.functionResponse && part.functionResponse.name;
      if (!name || !TRIMMABLE_TOOL_RESULT_NAMES.has(name)) return part;
      const response = part.functionResponse.response;
      let serialized;
      try {
        serialized = JSON.stringify(response || {});
      } catch (_) {
        return part;
      }
      if (serialized.length <= TOOL_RESULT_TRIM_THRESHOLD_CHARS) return part;
      msgChanged = true;
      return {
        functionResponse: {
          name,
          response: {
            trimmed: true,
            originalLength: serialized.length,
            note: `This ${name} output (${serialized.length} chars) is from an earlier turn and was collapsed to save tokens. Re-run ${name} if you need this data again.`
          }
        }
      };
    });
    if (!msgChanged) return msg;
    changedAny = true;
    return { ...msg, parts: newParts };
  });
  return changedAny ? result : messages;
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

function buildScreenshotInspectionPrompt(goal) {
  return `You are Orion's visual verification eye. Inspect this screenshot against the mission goal.

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
}

function normalizeScreenshotInspectionResult({ text, path, goal, providerName }) {
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
    evidence: observations.join('; ') || text || `${providerName} inspected screenshot but returned no observations.`,
    summary: `${providerName} judged screenshot ${status} for goal "${goal}" (confidence ${confidence.toFixed(2)}).`
  };
}

async function inspectScreenshotWithModel({ imageBase64, mimeType, path, goal, modelName, apiKey }) {
  if (!modelName) throw new Error('Active chat model is required for multimodal screenshot inspection.');
  if (modelName.startsWith('gemini-')) {
    return await inspectScreenshotWithGemini({ imageBase64, mimeType, path, goal, modelName, apiKey });
  }
  return await inspectScreenshotWithOllama({ imageBase64, path, goal, modelName });
}

async function inspectScreenshotWithGemini({ imageBase64, mimeType, path, goal, modelName, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const prompt = buildScreenshotInspectionPrompt(goal);

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
  return normalizeScreenshotInspectionResult({ text, path, goal, providerName: modelName });
}

async function inspectScreenshotWithOllama({ imageBase64, path, goal, modelName }) {
  const response = await fetchWithTimeout('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [{
        role: 'user',
        content: buildScreenshotInspectionPrompt(goal),
        images: [imageBase64]
      }],
      stream: false,
      format: 'json',
      options: {
        temperature: 0
      }
    })
  }, MODEL_API_REQUEST_TIMEOUT_MS, 'Ollama vision screenshot inspection');

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama vision inspection failed HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data && data.message && data.message.content;
  return normalizeScreenshotInspectionResult({ text, path, goal, providerName: modelName });
}

// GEMINI API UTILITIES
async function callGeminiAPI(messages, modelName, apiKey, onWarning, disableTools = false, options = {}) {
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
          ...(agentExecutionMode === 'executing' ? OPERATIONAL_CONTEXT_TOOL_DECLARATIONS : []),
          ...ASSET_BROWSER_VISUAL_TOOL_DECLARATIONS,
          {
            name: "list_files",
            description: "Returns a curated project file inventory for the active workspace by default. The default hides generated caches, dependencies, runtime/user data, backups, and sensitive-looking files; use mode='all' only when the user explicitly needs a raw workspace listing.",
            parameters: {
              type: "OBJECT",
              properties: {
                mode: { type: "STRING", enum: ["project", "all"], description: "Use 'project' for the curated default inventory. Use 'all' only for an explicit raw recursive listing." },
                maxFiles: { type: "NUMBER", description: "Maximum curated project files to return before truncation. Ignored for mode='all'." }
              }
            }
          },
          {
            name: "get_workspace_info",
            description: "Returns the active workspace directory, conversation scope, and project metadata. Use when the user asks where the project/program is or asks for the directory.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "change_workspace",
          description: "Changes the active workspace directory of this conversation to a new absolute directory path on your computer. Use this only after the path is explicit or locally verified. The executor also resolves obvious folder-name variants such as spaces, hyphens, underscores, casing, and minor dictation/autocorrect differences against nearby Desktop/Projects directories before failing. For fuzzy Desktop/project names, first resolve the real folder with a bounded run_command Get-ChildItem search; if this tool fails because the path does not exist, search/list candidate directories before retrying with another path.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "The verified absolute path to the directory you want to set as the active workspace." }
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
            description: "Runs a command in powershell in the workspace directory, waits for completion, and returns code, stdout, stderr, and timeout status. For local machine facts, a non-zero exit proves only that this command attempt failed; try a different local route before concluding the task is blocked. For a top-level Desktop/folder listing, use a non-recursive command such as Get-ChildItem -LiteralPath \"C:\\Users\\Owner\\Desktop\" -Directory | Select-Object -ExpandProperty Name; do not add -Depth/-Recurse unless nested folders are explicitly requested.",
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
          },
          {
            name: "ask_clarifying_questions",
            description: "Pauses and presents 2-3 structured clarifying questions to the user when key design decisions are unspecified. Use BEFORE writing STRATEGY.md when the request leaves critical choices open (visual style, core mechanic, scale/performance strategy, framework). Do not use this as a substitute for inspecting an existing local folder/project/program; if the user named one, call local tools first and ask only for ambiguities that remain after inspection. IMPORTANT: Do NOT say 'Task finished' or any completion text when calling this tool — the task is paused awaiting answers, not done. The user sees an interactive card with radio options, recommended badges, and a free-text 'Other' fallback. Their answers resume the agent automatically.",
            parameters: {
              type: "OBJECT",
              properties: {
                intro: { type: "STRING", description: "Brief intro sentence shown above the questions, e.g. 'Before I write the strategy, a few quick design questions:'" },
                questions: {
                  type: "ARRAY",
                  description: "2-3 clarifying questions to present.",
                  items: {
                    type: "OBJECT",
                    properties: {
                      header: { type: "STRING", description: "Short chip label for the question, max 12 chars, e.g. 'Visual Style'" },
                      question: { type: "STRING", description: "The full question text to display." },
                      options: {
                        type: "ARRAY",
                        description: "2-4 multiple-choice options.",
                        items: {
                          type: "OBJECT",
                          properties: {
                            label: { type: "STRING", description: "Option label shown to user." },
                            description: { type: "STRING", description: "Optional one-line explanation of this choice." },
                            recommended: { type: "BOOLEAN", description: "If true, badges this option as recommended." }
                          },
                          required: ["label"]
                        }
                      }
                    },
                    required: ["header", "question", "options"]
                  }
                }
              },
              required: ["intro", "questions"]
            }
          },
          {
            name: "get_symbol_index",
            description: "Returns a symbol index for all JS/TS files in the workspace: function names, class names, and arrow functions with their line numbers. Use this BEFORE read_file on large source files — find the target symbol's line range first, then read only that range.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "step_complete",
            description: "Emit after completing each step of an approved implementation plan. Orion auto-runs the configured test command and injects a [POST-STEP VERIFICATION: ...] message. If tests fail you must fix them before the next step.",
            parameters: {
              type: "OBJECT",
              properties: {
                step: { type: "STRING", description: "Short description of the step just completed, e.g. 'Add auth middleware'." }
              },
              required: ["step"]
            }
          },
          {
            name: "read_project_memory",
            description: "Reads the persistent per-workspace project memory: architectural decisions, API shapes, gotchas, and preferences saved from prior sessions.",
            parameters: { type: "OBJECT", properties: {} }
          },
          {
            name: "append_project_memory",
            description: "Appends a durable fact to the workspace project memory. Use when you discover an architectural decision, API shape, gotcha, recurring pattern, or constraint that future sessions should know.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING", description: "The fact to store. Be specific and actionable." },
                category: { type: "STRING", description: "Optional category, e.g. architecture, api, gotcha, command, preference." }
              },
              required: ["text"]
            }
          },
          {
            name: "discover_skills",
            description: "Lists all registered skills in the skill registry. Call this before starting a complex or repetitive task to check if a reusable skill already exists.",
            parameters: {
              type: "OBJECT",
              properties: {
                group: { type: "STRING", description: "Optional group filter: utility, files, coding, home, calendar, research." }
              }
            }
          },
          {
            name: "run_skill",
            description: "Executes a registered skill by name with the given inputs. Returns the skill's output object.",
            parameters: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "The skill name as registered (e.g. word-count)." },
                inputs: { type: "OBJECT", description: "Key-value inputs matching the skill's input schema." }
              },
              required: ["name"]
            }
          },
          {
            name: "create_skill",
            description: "Authors, tests, and registers a new reusable skill. The skill implementation must be a CommonJS module exporting async function(inputs). The test must exit 0 on success.",
            parameters: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "Kebab-case skill name, unique in the registry." },
                group: { type: "STRING", description: "Group: utility, files, coding, home, calendar, or research." },
                description: { type: "STRING", description: "Human-readable description used by the agent to decide when to invoke this skill." },
                inputs: { type: "OBJECT", description: "JSON schema of inputs: { paramName: { type, description, required } }." },
                outputs: { type: "OBJECT", description: "JSON schema of outputs: { resultName: { type, description } }." },
                implementation: { type: "STRING", description: "Full CommonJS JS source: module.exports = async function(inputs) { ... }." },
                test: { type: "STRING", description: "Full JS test source using Node assert. Must exit 0 on success, non-zero on failure." }
              },
              required: ["name", "group", "description", "implementation"]
            }
          },
          {
            name: "remember_fact",
            description: "Store a durable fact in global or project memory. Use scope='global' for cross-project facts (user habits, people, identity), scope='project' for workspace-specific facts.",
            parameters: {
              type: "OBJECT",
              properties: {
                scope: { type: "STRING", description: "global or project (default: project)." },
                text: { type: "STRING", description: "The fact to store." },
                category: { type: "STRING", description: "Optional category, e.g. architecture, api, gotcha, preference." }
              },
              required: ["text"]
            }
          },
          {
            name: "remember_decision",
            description: "Store an architectural or design decision in project memory with optional context about why it was made.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING", description: "The decision that was made." },
                context: { type: "STRING", description: "Optional: why this decision was made." },
                workspacePath: { type: "STRING", description: "Optional workspace path override." }
              },
              required: ["text"]
            }
          },
          {
            name: "remember_preference",
            description: "Store a user preference at global or project level. Call immediately when the user expresses how they like things done.",
            parameters: {
              type: "OBJECT",
              properties: {
                scope: { type: "STRING", description: "global or project (default: project)." },
                text: { type: "STRING", description: "The preference to store." },
                workspacePath: { type: "STRING", description: "Optional workspace path override (project scope only)." }
              },
              required: ["text"]
            }
          },
          {
            name: "recall_memory",
            description: "Read memory for the given scope. Call at the start of a session with an active workspace to orient yourself with prior context.",
            parameters: {
              type: "OBJECT",
              properties: {
                scope: { type: "STRING", description: "global, project, or all (default: project)." },
                workspacePath: { type: "STRING", description: "Optional workspace path override." }
              }
            }
          },
          {
            name: "save_session_summary",
            description: "Save a summary of this session: what was accomplished, decisions made, discoveries, completed tasks, and open items. Call when the user is wrapping up or switching tasks.",
            parameters: {
              type: "OBJECT",
              properties: {
                workspacePath: { type: "STRING", description: "Optional workspace path override." },
                summary: { type: "STRING", description: "What was accomplished this session." },
                decisions: { type: "ARRAY", items: { type: "STRING" }, description: "Decisions made this session." },
                discoveries: { type: "ARRAY", items: { type: "STRING" }, description: "Interesting things discovered." },
                tasksCompleted: { type: "ARRAY", items: { type: "STRING" }, description: "Tasks completed this session." },
                openItems: { type: "ARRAY", items: { type: "STRING" }, description: "Open items or follow-ups remaining." }
              },
              required: ["summary"]
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
        body: JSON.stringify(requestBody),
        signal: options.signal
      }, MODEL_API_REQUEST_TIMEOUT_MS, 'Gemini generateContent request');
      
      if (response.ok) {
        const responseData = await response.json();
        responseData._orionActiveModelName = activeModelName;
        return responseData;
      }
      
      const errorText = await response.text();
      const status = response.status;
      const apiError = describeModelApiError(status, errorText);
      const retryDelayMs = Math.min(apiError.retryDelayMs || delay, MODEL_API_MAX_RETRY_WAIT_MS);

      if (isGeminiHardQuotaError(status, apiError.message)) {
        if (onWarning) {
          onWarning(`Gemini API returned HTTP ${status} (monthly spend cap). This is a billing limit, not a temporary model rate limit, so Orion is stopping retries.`);
        }
        throw createNonRetryableModelError(`HTTP ${status}: ${apiError.message}`);
      }

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
        const errorMessage = `HTTP ${status}: ${apiError.message}${retryText}`;
        if (!isTransient) throw createNonRetryableModelError(errorMessage);
        throw new Error(errorMessage);
      }
      
      if (onWarning) {
        const kind = status === 429 ? 'Quota/rate limit' : (status === 503 ? 'High Demand' : 'Transient Error');
        onWarning(`Gemini API returned HTTP ${status} (${kind}). Provider wait/cooldown active (Attempt ${i}/${attempts}).`);
      }
      
      await sleepWithModelApiStatus(retryDelayMs, `Gemini API retry ${i}/${attempts}.`, onWarning);
      delay = Math.max(delay * 2 + Math.random() * 500, retryDelayMs); // Exponential backoff + API retry hint
      
    } catch (e) {
      if (e && e.nonRetryable) throw e;
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
async function countTokens(messages, modelName, apiKey, options = {}) {
  if (!modelName.startsWith('gemini-')) {
    return JSON.stringify(messages).length / 4;
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:countTokens?key=${apiKey}`;
  const requestBody = { contents: messages };
  
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: options.signal
  }, MODEL_API_REQUEST_TIMEOUT_MS, 'Gemini countTokens request');
  
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
    buildLocalMemoryAnswer,
    getPlanningToolGate,
    getReviewOnlyToolGate,
    buildRemainingWorkSummary,
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
    isLocalProjectOrFolderRequest,
    isLocalAccessDeflection,
    requestNeedsLocalInspection,
    buildLocalInspectionNoToolGuidance,
    isGenericNonAnswer,
    looksLikeLeakedNoToolCorrection,
    requestNeedsActionableFinalAnswer,
    answerHasActionableFinalContent,
    getReviewCoverage,
    answerHasGroundedReviewReport,
    buildReviewOnlyCompletionGatePrompt,
    isInventoryOnlyCommand,
    hasDeepInspectionEvidence,
    hasOnlyInventoryEvidence,
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
    resolveConversationWorkspace,
    isRealVerificationCommand,
    isVerificationItem,
    hasVerificationAfterLastFileEdit,
    isAppLaunchItem,
    isAppLaunchVerificationItem,
    hasVerificationAfterLastAppLaunch,
    hasUnresolvedRegressionWarning,
    looksLikePlaceholderTestOutput,
    checkJsSyntaxAfterEdit,
    buildRepeatedEditFailureEscalation,
    buildMalformedFunctionCallGuidance,
    looksLikeLaunchOnlyRequest,
    hasFailedLaunchAttemptThisRun,
    getNextGeminiModelForHighDemand,
    resolveUtilityModelName,
    trimAgedToolResultsFromMessages,
    summarizeToolStart,
    buildRepeatedFailureKey,
    updateWalkthroughItem,
    buildPostEditEvidencePrompt,
    buildFinalVerificationSummary,
    stripEchoedSystemScaffold,
    sanitizeFinalAnswerText,
    withWorkWalkthrough,
    hiddenDirectoryForInventory,
    sensitiveFileForInventory,
    buildCuratedFileInventory,
    buildDiscoveryFromToolOutcome,
    parseModelJsonObject,
    callGeminiAPI,
    inspectScreenshotWithModel,
    inspectScreenshotWithGemini,
    inspectScreenshotWithOllama,
    diagnoseModelApiFailure,
    expandCommonWindowsPath,
    normalizeLocalPathNameForMatch,
    tokenizeLocalPathNameForMatch,
    editDistanceWithin,
    scoreWorkspaceDirectoryVariant,
    chooseWorkspaceDirectoryVariant,
    resolveWorkspacePathForChange,
    rememberPendingWorkspaceResolution,
    extractCommandPathArgument,
    extractDirectoryCandidatesFromCommandOutput,
    buildPendingWorkspaceResolutionHint,
    buildPendingWorkspaceResolutionCorrectionPrompt
  };
}

function diagnoseModelApiFailure(errorText) {
  const text = String(errorText || '').toLowerCase();
  if (!text) return '';
  if (text.includes('monthly spending cap') || text.includes('project spend cap') || text.includes('ai.studio/spend')) {
    return 'Diagnosis: the Gemini project has hit a monthly spend cap. This is a hard billing limit, not a temporary model rate limit; retries or model escalation will not continue until the AI Studio spend cap or billing configuration is changed.';
  }
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
  module.exports.runAgentLoop = window.runAgentLoop;
}
