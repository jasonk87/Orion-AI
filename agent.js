// AGENT ENGINE FOR ANTIGRAVITY 2.0

// System Instruction for the Pair Programmer
const SYSTEM_INSTRUCTION = `You are Orion AI, the ultimate pair programmer agent running locally on the user's workspace.
Your goal is to solve the task given by the user with high quality, precision, and trust. Apply extra care on architecture, edge cases, tests, and failure recovery at every step. The operational completion gate is the sole completion authority — do not self-terminate before it clears.

VOICE AND IDENTITY:
- Own being Orion. Speak in first person as the user's local collaborator, not as a generic model reciting "I am an AI" disclaimers.
- For personal-memory questions, answer from chat context and durable memory. If you do not know or have not saved the fact, say that plainly, e.g. "I don't have your name saved yet," not "I cannot know personal information."
- Avoid distancing language like "I do not have access to personal information" unless the user asks about unavailable private data outside the conversation or memory.

SCRATCHPAD CHAIN-OF-THOUGHT CONTRACT:
- You have access to a private reasoning space via the update_scratchpad tool.
- Use it to break down complex tasks, write intermediate logic, do math, or list hypotheses BEFORE executing actions.
- Before writing tricky logic with loops, async behavior, parsing, file mutations, state transitions, or boundary-heavy conditions, use the scratchpad to enumerate edge cases and confirm the approach.
- The scratchpad is strictly an ADDITION for intermediate scratch work. You MUST still report your final blockers, state changes, and mission updates to the user in chat. Do not hide your actual conclusions in the scratchpad.
- The scratchpad state completely overwrites each time. If you want to keep previous scratchpad context, include it in your updated content.

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
2. TESTING AND REGRESSION DISCIPLINE: When you create or change code, you are responsible for producing run-ready code. Before meaningful edits, inspect existing tests and the detected regression command when relevant. Before changing a function name or signature, call "find_references" to enumerate every call site. After edits, run the appropriate tests or smoke checks using "run_tests", "run_command", or the long-running command tools. For JS/TS projects with configured lint/typecheck tooling, run targeted "run_linter" after JS/TS edits so ESLint/TSC can catch undefined variables, broken imports, and type mismatches that syntax checks miss. If tests fail, read the output, fix the issue, and rerun tests until they pass or you can clearly explain a blocker. For long tests, training, games, and servers, use "start_command" with a sensible timeout, check status/output, and stop processes with "kill_command" when finished. Do not use an interactive command as a test unless you pipe/provide input or intentionally kill it after a short smoke check. For graphical/Pygame/interactive applications, write a non-interactive test script or design the program to accept a '--smoke-test' command-line flag that exits after a few frames/seconds, and use this flag (or run with a short timeoutMs) when validating. Do not claim code works unless you ran a relevant check or state exactly why you could not.
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
10. TASK COMPLETION: Create a checklist during planning when a task has meaningful milestones. When you begin working on a milestone, use "set_task_checklist" to mark it as 'in-progress'. Once finished, update it to 'completed'. Do not call it repeatedly just to refresh the same in-progress state. Once all tasks are complete, update the checklist to show all tasks are 'completed', and then present your final summary.
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
18A. DIAGNOSTIC RIGOR: When diagnosing why something fails or explaining how a system behaves, run this self-check before committing to your conclusion. (a) VERIFY LOAD-BEARING CLAIMS: if your explanation depends on something existing — a limit, a mechanism, an API, an external system/platform, a config value, a behavior — you MUST have actually verified it with a tool (read the file, grep_search for it, web search). If you have not verified it, verify it now or do not assert it. Never invent an external cause you never checked for; one grep_search that returns nothing kills a wrong theory for almost no cost, while asserting a phantom cause wastes far more and misleads the user. (b) TRACE THE DATA, NOT JUST THE CODE: reading where something is defined is not the same as knowing what it receives at runtime. Read the responsible function IN FULL (use get_symbol_index/get_file_symbols to jump to it, not a keyhole 20-line window of a large file), and confirm the inputs and properties it references actually exist and are populated — a reference to a property that is never set (so it is always undefined) is a common real bug that only shows when you trace the data. (c) PREFER THE BORING INTERNAL CAUSE: for "we built X to prevent Y, but Y still happens," the likely answer is a bug in X — is it wired in, does it receive the data it needs, does its condition actually fire? Exhaust the in-code explanations before blaming anything outside the codebase.
16. OPERATING SYSTEM AWARENESS: You are currently running on a Windows system. When guessing or constructing file paths outside the current workspace, ALWAYS use Windows path conventions (e.g., C:\\Users\\owner\\Desktop) with the literal resolved path — do NOT pass unexpanded PowerShell variables like $env:USERPROFILE as a path argument to any tool; resolve the path to a literal string first (e.g., C:\\Users\\owner). If you are unsure of the username, run 'echo $env:USERPROFILE' first. When searching for files on the Desktop or broad directories, ALWAYS limit recursive searches with '-Depth 2' or '-Depth 3' and add '-ErrorAction SilentlyContinue' to avoid timeouts from permission-denied folders. Never run an unbounded 'Get-ChildItem -Recurse' on C:\\ or the Desktop without a depth limit.
19. PLANNING MODE: Exercise judgement on whether a request warrants a formal plan before taking action. Stop and create an implementation plan (using STRATEGY.md or implementation_plan.md) if the request requires major architectural changes, extensive research, or significant decision making. If you decide that a request does NOT warrant a plan (for example: one-off investigatory questions, trivial tweaks, minor bug fixes, or minor follow-ups to an existing plan), then continue your work WITHOUT making a plan or requesting user review. You have the authority to make small fixes and adjustments instantly without drafting a full blown-out plan.

TOOL USE:
- Callable tools are supplied separately as formal JSON schemas. Use those schemas as the source of truth for available tool names, parameters, and per-tool behavior.
- If a needed capability is not present in the supplied schemas, adapt with the available tools or explain the blocker; do not invent undeclared tool names.
- If a planning gate blocks a tool call, do not paste strategy or implementation-plan prose into chat. State the blocker briefly and ask for the missing clarification.

INCIDENTAL OBSERVATIONS:
- While inspecting material required for the current task, you may notice a separate serious issue. Do not search for unrelated issues, broaden inspection, interrupt the current task, or spend extra tool calls investigating it.
- Call note_incidental_issue only when the evidence is already directly visible, confidence is high, impact is substantial, the issue is actionable, it is outside the current task, and it is not already known or being addressed.
- Valid incidental observations include clear security exposure, data-loss or corruption paths, ordinary-path crashes, silent failure after lost work, state races, runaway loops, and unsafe destructive operations.
- Do not record style concerns, generic missing tests, minor duplication, TODOs, broad refactors, alternative architecture preferences, or anything mainly phrased as could/might/consider.
- Incidental observations are silent until the final handoff unless continuing would risk immediate data loss or corruption.

SKILL REGISTRY GUIDANCE: The skill registry is a library of reusable, tested capabilities. Before starting a complex or repetitive task, call discover_skills to check if a relevant skill already exists. If a task requires a capability that doesn't exist yet and would be useful in the future, use create_skill to author it — provide the JS implementation and a test that exits 0 on success. Skills are stored persistently and shared across all conversations.

MEMORY PROTOCOL:
- SESSION START: When a workspace is active, call recall_memory with scope="all" to load project context and orient yourself before responding.
- USER PREFERENCES: When the user expresses a preference ("I like X", "always do Y", "don't do Z", "I prefer X"), call remember_preference immediately — do not wait.
- DESIGN DECISIONS: When a significant architectural or design decision is made, call remember_decision with the decision and why.
- DURABLE FACTS: When you discover a fact about the project or user that future sessions should know, call remember_fact.
- SESSION END: When the user indicates they are wrapping up, switching tasks, or says they are done, call save_session_summary with what was accomplished, what was decided, and what remains open.
- SCOPE: Global memory is for things true across all projects (user identity, habits, people, cross-project preferences). Project memory is for things specific to the current workspace.

PERSISTENT TERMINAL (terminal_exec):
- Use "terminal_exec" when a sequence of commands needs to retain its working directory between calls.
- Provide a "sessionId" (string, default: "default") to group related commands. Environment changes and activated shells do not persist; include those in each command when needed.
- Use "resetSession: true" to clear a session and return to the workspace root.
- For single, stateless commands, continue using "run_command".

DATABASE QUERIES (db_query):
- Use "db_query" to inspect data from a local SQLite file or a remote Postgres/MySQL database. The implementation enforces read-only statements and cannot perform mutations.
- For SQLite: provide "dbPath" as an absolute path to the .sqlite, .db, or .sqlite3 file.
- For Postgres: provide "connectionString" (e.g. "postgresql://user:pass@host:5432/dbname"). Optionally set "dbType": "postgres".
- For MySQL: provide "connectionString" and set "dbType": "mysql".
- Output is returned as raw CLI JSON/CSV text. Parse with caution — check for error lines mixed into output.`;


// ── Dispatcher (Orion Chat) System Instruction ────────────────────────────────
const DISPATCHER_INSTRUCTION = `You are Orion — Jason's personal AI assistant.

You are the front door to everything Jason needs. You handle what you can directly, route what needs a specialist, and always think before you act. The goal is the correct answer, not the fastest one.

WHO YOU'RE TALKING TO:
Jason. Solo developer. Casual, direct — he wants the answer, not the explanation. He'll give you context as it comes up. Don't ask for everything upfront.

HOW YOU WORK:
Handle directly: conversation, strategy, planning, research, reading and discussing code or docs, answering questions, web searches. You can look at files and search the web to back up what you say, but you cannot write, edit, run commands, capture screenshots, or operate the desktop yourself — you are read-only by design.
Route to the coder: anything requiring file changes, writing or debugging code, running tests, building or fixing features, running local commands, capturing the desktop/screen, or producing local files/artifacts for Jason. Before routing, make sure you understand the task well enough to hand it off clearly — ask Jason to clarify if you don't. When you route something, tell him. Don't go quiet. Report back with a clean summary when it's done.

Permission boundary rule: when Jason asks for an executable or mutating operation that Dispatch cannot perform, you MUST call handoff_to_coder. Never refuse the task or tell Jason to perform it manually merely because Dispatch is read-only. If the target is genuinely ambiguous, use inspect_environment for read-only identification or tell Coder to identify it safely as part of the handoff.

Context ownership: for an obvious build/fix/edit/test request, route early from the known workspace and task description. Do not deeply inspect source merely to decide that Coder should do the work. For a read-only question or architectural opinion, inspect deeply yourself and answer it. If Jason then turns that discussion into implementation, use handoff_to_coder; Orion will transfer the exact validated context packets you already built so Coder can start from that evidence instead of rediscovering the project.

HOW YOU THINK:
Don't snap-route. Ask yourself first: can I handle this directly? Do I have enough context to give the coder a clear task? Is this a coding problem or a planning conversation first? Think it through, then act.

BEFORE YOU COMMIT TO A CLAIM OR DIAGNOSIS (silent self-check, then answer):
- Load-bearing claims: if your explanation depends on something existing — a limit, a mechanism, an API, an external system, a config value, a behavior — confirm you actually verified it (read the file, grepped for it, searched the web). If you did not verify it, verify it now or do not assert it. Never invent an external cause you never checked for. One grep that comes back empty kills a wrong theory for almost no cost; asserting a phantom wastes far more.
- Trace the data, don't just locate the code. When diagnosing why something fails, read the responsible function in full and check that the inputs and properties it references actually exist and are populated. "Where X is defined" is not the same as "what X receives at runtime" — the bug is usually in the second one.
- Prefer the boring internal cause. For "we built X to prevent Y, but Y still happens," the likely answer is a bug in X — is it wired in, does it get the data it needs, does its condition actually fire? Exhaust the in-code explanations before blaming anything outside the codebase.

HOW YOU COMMUNICATE:
Casual and direct. Short when simple, fuller when it isn't. Greet Jason by name when starting fresh. If you don't know something about his projects or context, ask — don't assume or pretend.

MEMORY:
At the start of a conversation, call recall_memory with scope="global" to orient yourself. When you learn something new — a project, a preference, a decision — use remember_fact or remember_preference immediately. When past context is relevant, surface it naturally.

{{user_memory}}

TOOL USE:
Your callable tools are supplied separately as formal schemas. In Dispatch, use read/search/memory/workspace/handoff tools when available. You still cannot edit files, run commands, capture screenshots, or produce local artifacts yourself; hand those tasks to Coder with a concise task description.

DATABASE QUERIES (db_query):
- Use "db_query" to read data directly from a local SQLite file or a Postgres/MySQL database without handing off to Coder.
- For SQLite: provide "dbPath" (absolute path to the .sqlite/.db file). For Postgres/MySQL: provide "connectionString" and optionally "dbType".
- Read-only is technically enforced. If Jason asks for data, use this tool rather than routing to Coder just to run a SELECT.

ENVIRONMENT INSPECTION (inspect_environment):
- Use "inspect_environment" for read-only system checks: package versions, running processes, port availability, env vars, git status.
- Commands are safety-filtered — writes, installs, server starts, and destructive operations are blocked.`;


// Returns the right system instruction for the current mode.
// Pass cachedMemory (string) to inject into the dispatcher instruction.
function getSystemInstruction(disableTools = false, cachedMemory = '', modelName = '') {
  const isOrion = activeConversationMode === 'orion';
  let base;
  if (isOrion) {
    const memBlock = cachedMemory ? `\n\nKnown context about Jason:\n${cachedMemory}` : '';
    // Time-of-day context injection
    const now = new Date();
    const hour = now.getHours();
    const tod = hour < 5 ? 'late night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const timeContext = `\n\nCurrent time: ${timeStr} on ${dateStr} (${tod}).`;
    base = DISPATCHER_INSTRUCTION.replace('{{user_memory}}', memBlock) + timeContext + orionSessionContinuityContext;
  } else {
    base = SYSTEM_INSTRUCTION;
    if (modelName && (modelName.startsWith('deepseek') || modelName.includes('pro') || modelName.includes('claude-3-7'))) {
      base = `SYSTEM AWARENESS: You are currently running on ${modelName}, which features a large context window. Read entire files when they fit the active acquisition budget and whole-file structure matters. Oversized reads are capped so one tool result cannot crowd out the task; use inspect_code_context, semantic_search, or get_symbol_index for very large files.\n\n` + base;
    } else if (modelName) {
      base = `SYSTEM AWARENESS: You are currently running on ${modelName}. Use your tools efficiently and prefer targeted reads.\n\n` + base;
    }
  }
  if (disableTools) {
    return base + '\n\nCRITICAL: You are in an analysis phase. DO NOT request any tool use. Provide your analysis in plain text only.';
  }
  return base;
}

// Session continuity: carries a summary of the previous session into the current one
let orionSessionContinuityContext = '';

// Cached formatted global-memory block, injected into every Orion system prompt.
// Refreshed at the start of each Orion run so the model already knows Jason's facts/prefs.
let orionCachedMemoryBlock = '';

async function refreshOrionMemoryBlock(config, queryText, mode) {
  try {
    if (!window.api || !window.api.readGlobalMemory) return;
    const modeTag = mode || 'orion';
    const mem = await window.api.readGlobalMemory();
    const lines = [];
    if (mem.user && mem.user.name) lines.push(`Name: ${mem.user.name}`);

    // RAG: rank facts/preferences by cosine similarity against the current message instead of
    // dumping the most recent ones unconditionally. Falls back to recency when there's no query
    // to embed against (e.g. the post-session refresh) or the ranking call fails outright.
    // Preferences are filtered to this mode (or untagged, for backward compat) before ranking, so
    // coder-mode preferences never bleed into the Orion prompt block and vice versa.
    let ranked = null;
    if (queryText && config && window.api.rankMemoryFacts) {
      try {
        const result = await window.api.rankMemoryFacts(queryText, config, 10, modeTag);
        if (result && result.success && Array.isArray(result.results)) ranked = result.results;
      } catch (_) { /* fall through to the recency-based fallback below */ }
    }
    if (!ranked) {
      const recentPrefs = (mem.user && Array.isArray(mem.user.preferences))
        ? mem.user.preferences.filter(p => !p.mode || p.mode === modeTag).slice(-15).map(p => ({ type: 'preference', text: p.text })) : [];
      const recentFacts = Array.isArray(mem.facts)
        ? mem.facts.slice(-30).reverse().map(f => ({ type: 'fact', text: f.text, category: f.category })) : [];
      ranked = recentPrefs.concat(recentFacts);
    }

    const prefs = ranked.filter(c => c.type === 'preference').map(c => c.text);
    const facts = ranked.filter(c => c.type === 'fact');
    if (prefs.length > 0) lines.push(`Preferences: ${prefs.join('; ')}`);
    if (facts.length > 0) {
      lines.push(`Facts:\n${facts.map((f, i) => `${i + 1}. [${f.category || 'general'}] ${f.text}`).join('\n')}`);
    }

    orionCachedMemoryBlock = lines.join('\n');
  } catch (_) {
    orionCachedMemoryBlock = '';
  }
}

// Small stopword list used only to keep the recency/topic-overlap scoring below from treating
// common filler words as a topic match — it does not need to be linguistically complete.
const CONTINUITY_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'with', 'this', 'that', 'from', 'have', 'has',
  'had', 'was', 'were', 'will', 'can', 'could', 'would', 'should', 'about', 'into', 'your', 'their',
  'they', 'them', 'what', 'when', 'where', 'which', 'how', 'why', 'just', 'like', 'also', 'than',
  'then', 'some', 'any', 'all', 'get', 'got', 'make', 'made', 'use', 'used', 'using'
]);

function extractContinuityWords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !CONTINUITY_STOPWORDS.has(w))
  );
}

async function buildOrionContinuityContext(conversation, workspacePath) {
  // Only inject on the very first user message in an Orion conversation
  const userMessages = (conversation.messages || []).filter(m => m.role === 'user');
  if (userMessages.length !== 1) return '';
  if (!workspacePath || !window.api || !window.api.listSessions) return '';

  let sessions;
  try {
    const result = await window.api.listSessions(workspacePath, 10);
    sessions = (result && Array.isArray(result.sessions)) ? result.sessions : [];
  } catch (_) {
    return '';
  }
  sessions = sessions.filter(s => s.sessionId !== conversation.id && s.summary && s.summary.trim());
  if (!sessions.length) return '';

  // Score by recency (sessions are already newest-first) plus topic overlap with the first
  // message of this conversation, so a relevant older session can outrank a generic recent one.
  const queryWords = extractContinuityWords(userMessages[0].text || '');
  const scored = sessions.map((session, index) => {
    const summaryWords = extractContinuityWords(session.summary);
    let overlap = 0;
    for (const w of queryWords) if (summaryWords.has(w)) overlap++;
    const recencyScore = 1 / (index + 1);
    return { session, score: overlap * 1.5 + recencyScore };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3).map(s => s.session);
  if (!top.length) return '';

  const lines = top.map(s => {
    const when = s.endedAt ? new Date(s.endedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `- ${s.summary}${when ? ` (${when})` : ''}`;
  }).join('\n');

  return `\n\nRecent sessions (for context, do not summarize unprompted):\n${lines}`;
}

// Cheap regex pre-filter for unambiguous explicit-preference phrasing ("I prefer X", "don't do Y",
// "always/never Z"). Runs on every user message with no LLM call — a match is trusted as-is and
// saved immediately, instead of waiting for autoSaveOrionMemory's end-of-session LLM pass to
// (maybe) notice it later.
const EXPLICIT_PREFERENCE_PATTERNS = [
  /\bi wish you('?d| would)\b/i,
  /\bi('?d| would) (rather|prefer)\b/i,
  /\bi prefer\b/i,
  /\bplease don'?t\b/i,
  /\bdon'?t (ever )?(do|use|write|add|call|create|make|say|put)\b/i,
  /\b(always|never)\s+\w+\s+\w+/i,
  /\bstop\s+(doing|using|adding|writing|calling|saying|putting)\b/i,
  /\bcan you remember\b/i,
  /\bi like it when\b/i
];

function findExplicitPreferenceSentence(text) {
  const sentences = String(text || '').split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (EXPLICIT_PREFERENCE_PATTERNS.some(re => re.test(trimmed))) {
      return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
    }
  }
  return null;
}

async function maybeSaveExplicitPreference(text, config, mode) {
  if (!config || !window.api || !window.api.appendGlobalPreference) return;
  const sentence = findExplicitPreferenceSentence(text);
  if (!sentence) return;
  try {
    await window.api.appendGlobalPreference(sentence, config, 'explicit-preference', mode);
    console.log('[Orion] Captured explicit preference signal from message.');
  } catch (_) { /* silent — best-effort fast path; the end-of-session pass is the fallback */ }
}

// Tracks conversations already auto-summarized to avoid duplicate writes
const orionAutoSummarizedIds = new Set();

async function autoSaveOrionMemory(conversation, config, workspacePath, mode) {
  if (!config) return;
  const convId = conversation.id;
  if (orionAutoSummarizedIds.has(convId)) return;
  const msgs = (conversation.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  const userMsgCount = msgs.filter(m => m.role === 'user').length;
  if (userMsgCount < 2) return; // too short — nothing worth summarizing

  orionAutoSummarizedIds.add(convId); // mark before async to avoid double-fire

  // Build a condensed transcript
  const transcript = msgs.slice(-10).map(m =>
    `${m.role === 'user' ? 'Jason' : 'Orion'}: ${(m.text || '').substring(0, 300)}`
  ).join('\n');

  const analyzePrompt = `You are reviewing a conversation between Jason and Orion (his AI assistant).
Extract facts/preferences worth remembering in future sessions, and a short session summary for a session log.
Return JSON: {"items": [{"type": "fact"|"preference", "text": "..."}], "session": {"summary": "...", "decisions": ["..."], "discoveries": ["..."], "tasksCompleted": ["..."], "openItems": ["..."]}}
"items" are durable facts/preferences Jason expressed clearly or decided. Keep each under 120 characters. Do not include trivial details, greetings, or task steps. Return [] if none.
"session.summary" is a concise 1-2 sentence description of what this session covered — return "" if the conversation had no durable content worth logging.
"session.decisions"/"discoveries"/"tasksCompleted"/"openItems" are short bullet strings (under 150 characters each) — omit or leave empty where nothing applies.

Conversation:
${transcript}`;

  try {
    let rawJson = '';
    const extractionModel = config.modelName;
    if (config.geminiApiKey) {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${extractionModel}:generateContent?key=${config.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: analyzePrompt }] }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.2, responseMimeType: 'application/json' }
        })
      });
      const data = await resp.json();
      rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"items":[]}';
    } else if (config.anthropicApiKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: extractionModel, max_tokens: 512, messages: [{ role: 'user', content: analyzePrompt }] })
      });
      const data = await resp.json();
      rawJson = data?.content?.[0]?.text?.trim() || '{"items":[]}';
    } else if (config.deepseekApiKey) {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: extractionModel,
          messages: [{ role: 'user', content: analyzePrompt }],
          max_tokens: 512,
          temperature: 0.2,
          response_format: { type: 'json_object' }
        })
      });
      const data = await resp.json();
      rawJson = data?.choices?.[0]?.message?.content?.trim() || '{"items":[]}';
    }
    const parsed = JSON.parse(rawJson);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of items) {
      if (!item.text || item.text.length < 5) continue;
      if (item.type === 'preference') {
        await window.api.appendGlobalPreference(item.text, config, 'auto-summary', mode);
      } else {
        await window.api.appendGlobalFact(item.text, 'auto-summary', config);
      }
    }
    if (items.length > 0) {
      console.log(`[Orion] Auto-saved ${items.length} memory item(s) from session.`);
      // Refresh the in-memory block so the next run in this session starts with the new facts
      await refreshOrionMemoryBlock(config, null, mode).catch(() => {});
    }

    const session = parsed && parsed.session;
    const summary = session && typeof session.summary === 'string' ? session.summary.trim() : '';
    if (summary && workspacePath && window.api && window.api.saveSession) {
      await window.api.saveSession(workspacePath, {
        sessionId: convId,
        startedAt: conversation.createdAt ? new Date(conversation.createdAt).toISOString() : new Date().toISOString(),
        summary,
        decisions: Array.isArray(session.decisions) ? session.decisions : [],
        discoveries: Array.isArray(session.discoveries) ? session.discoveries : [],
        tasksCompleted: Array.isArray(session.tasksCompleted) ? session.tasksCompleted : [],
        openItems: Array.isArray(session.openItems) ? session.openItems : []
      });
    }
  } catch (e) { /* silent — memory auto-save is best-effort */ }
}

// ── Inactivity-triggered memory auto-save ──────────────────────────────────────
// Users rarely close a conversation explicitly, so "end of session" is treated instead as a
// period of inactivity after a response: if no new user message arrives within
// ORION_MEMORY_INACTIVITY_MS, that idle gap is the trigger. A single timer is enough since only
// one conversation can be actively running/awaiting-follow-up at a time.
const ORION_MEMORY_INACTIVITY_MS = 10 * 60 * 1000;
let orionMemoryInactivityTimer = null;
let orionMemoryInactivityConvId = null;

function clearOrionMemoryInactivityTimer() {
  if (orionMemoryInactivityTimer) clearTimeout(orionMemoryInactivityTimer);
  orionMemoryInactivityTimer = null;
  orionMemoryInactivityConvId = null;
}
window.clearOrionMemoryInactivityTimer = clearOrionMemoryInactivityTimer;

function scheduleOrionMemoryInactivitySave(conversation, config, workspacePath, mode) {
  clearOrionMemoryInactivityTimer();
  const convId = conversation.id;
  orionMemoryInactivityConvId = convId;
  orionMemoryInactivityTimer = setTimeout(() => {
    // Guard against firing for a conversation this timer no longer represents (belt-and-braces —
    // clearOrionMemoryInactivityTimer should already have cancelled it in that case).
    if (orionMemoryInactivityConvId !== convId) return;
    orionMemoryInactivityTimer = null;
    orionMemoryInactivityConvId = null;
    autoSaveOrionMemory(conversation, config, workspacePath, mode).catch(() => {});
  }, ORION_MEMORY_INACTIVITY_MS);
  // In Node (tests, and any non-browser host) setTimeout returns a Timeout that keeps the process
  // alive; unref it so a pending 10-minute timer never blocks process exit. Browsers return a
  // plain number with no unref method, so this is a no-op there.
  if (orionMemoryInactivityTimer && typeof orionMemoryInactivityTimer.unref === 'function') {
    orionMemoryInactivityTimer.unref();
  }
}

async function generateOrionSmartTitle(conversation, userText, assistantText, config) {
  if (!config) return;
  const snippet = userText.substring(0, 300) + (assistantText ? '\n' + assistantText.substring(0, 200) : '');
  const titlePrompt = `Generate a short, specific title (4-6 words, no quotes) for this conversation snippet. Return ONLY the title, nothing else.\n\n${snippet}`;
  try {
    let newTitle = '';
    if (config.geminiApiKey) {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${config.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }], generationConfig: { maxOutputTokens: 20, temperature: 0.4 } })
      });
      const data = await resp.json();
      newTitle = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    } else if (config.anthropicApiKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 20, messages: [{ role: 'user', content: titlePrompt }] })
      });
      const data = await resp.json();
      newTitle = data?.content?.[0]?.text?.trim() || '';
    }
    newTitle = newTitle.replace(/^["'`]|["'`]$/g, '').replace(/\.$/, '').trim();
    if (newTitle && newTitle.length > 2 && newTitle.length < 80) {
      conversation.title = newTitle;
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      if (window.renderConversationList) window.renderConversationList();
      const titleEl = document.getElementById('chat-title');
      if (titleEl && window.activeConversationId === conversation.id) titleEl.textContent = newTitle;
    }
  } catch (e) { /* silent — titles are best-effort */ }
}

// Keep track of active agent running state
let isAgentRunning = false;
let runningConversationId = null;
let agentSubStatus = '';
let agentExecutionMode = 'idle';
// The active conversation's own persistent mode ('orion'/'coder'), set once at the start of each
// run. Used by getSystemInstruction/buildAgentToolDeclarations instead of the live UI mode toggle
// (appMode), since a conversation's identity must not depend on which sidebar tab happens to be
// focused when a background/phone-triggered run executes.
let activeConversationMode = 'orion';
let resolvedHomeDir = 'C:\\Users\\Owner';
let currentAgentLogs = [];
// Signature of the last observed browser page state (url/title/content), used to detect when a
// click_element produced no observable effect — a click "succeeding" only means the DOM element was
// found and clicked, not that the app actually reacted (e.g. a button with no handler wired up).
let lastBrowserPageSignature = null;
function computeBrowserPageSignature(result) {
  if (!result || typeof result !== 'object') return null;
  const text = typeof result.text === 'string' ? result.text : '';
  return [result.url || '', result.title || '', text.length, text.slice(0, 160)].join('¦');
}
let isStopRequested = false;
let activeRunController = null;
let stopRequestMode = 'none';
let activeRunTaskId = null;
const GEMINI_THINKING_BUDGET = 24576;
const MODEL_API_REQUEST_TIMEOUT_MS = 600000;
const MODEL_API_MAX_RETRY_WAIT_MS = 45000;
const MODEL_API_MAX_ATTEMPTS = 15;
const OperationalContext = window.OrionOperationalContext || (typeof require === 'function' ? require('./operational-context') : null);
const WorkspaceResolution = window.OrionWorkspaceResolution || (typeof require === 'function' ? require('./workspace-resolution') : null);
const OrchestrationContracts = window.OrionOrchestrationContracts || (typeof require === 'function' ? require('./orchestration-contracts') : null);
const DispatchIntent = window.OrionDispatchIntent || (typeof require === 'function' ? require('./dispatch-intent') : null);
const TaskOrchestration = window.OrionTaskOrchestration || (typeof require === 'function' ? require('./task-orchestration') : null);

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
    description: 'Opens a URL in Orion’s browser worker and returns page title, text snippet, and links.',
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
window.getActiveRunTaskId = () => activeRunTaskId;
window.getAgentSubStatus = () => agentSubStatus;
window.getAgentExecutionMode = () => agentExecutionMode;

// ── Supervisor: expose a snapshot of a Coder conversation for status summaries ──
window.getCoderConversationSummary = function(coderConvId) {
  if (typeof conversations === 'undefined') return null;
  const conv = conversations.find(c => c.id === coderConvId);
  if (!conv) return null;
  const msgs = (conv.messages || []).slice(-15);
  const recentActivity = [];
  msgs.forEach(msg => {
    const logs = Array.isArray(msg.logs) ? msg.logs : [];
    logs.forEach(log => {
      if (log.type === 'tool_call' && log.tool) {
        recentActivity.push({ tool: log.tool, status: log.status || 'done', result: String(log.result || '').slice(0, 150) });
      }
    });
    if (msg.role === 'assistant' && msg.text && msg.text.trim() !== 'Thinking...') {
      recentActivity.push({ tool: '_thought', text: String(msg.text).slice(0, 250) });
    }
  });
  const tasks = Array.isArray(conv.tasks) ? conv.tasks : [];
  const doneTasks = tasks.filter(t => t.status === 'completed' || t.status === 'x');
  const pendingTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'x');
  return {
    title: conv.title || 'Coder Task',
    tasks,
    doneTasks,
    pendingTasks,
    recentActivity: recentActivity.slice(-10),
    awaitingClarification: conv.awaitingClarification || null,
    awaitingPlanApproval: !!(conv.awaitingPlanApproval && !conv.planApproved),
    subStatus: agentSubStatus,
    isRunning: isAgentRunning && runningConversationId === coderConvId
  };
};
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
  const requestedTaskId = String(options.taskId || '');
  if (requestedTaskId && activeRunTaskId && requestedTaskId !== activeRunTaskId) {
    return { success: false, stopped: false, reason: 'The requested task is not the active run.' };
  }
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
  return { success: true, stopped: !!targetConversationId, taskId: activeRunTaskId || '' };
}

function compactConversationForEvidenceSearch(conversation, excludedMessageIds = []) {
  if (!conversation || typeof conversation !== 'object') return null;
  const excluded = new Set((Array.isArray(excludedMessageIds) ? excludedMessageIds : []).map(String));
  return {
    id: String(conversation.id || ''),
    title: String(conversation.title || ''),
    mode: String(conversation.mode || ''),
    workspace: String(conversation.workspace || ''),
    projectPath: String(conversation.projectPath || conversation.dispatchProjectPath || ''),
    updatedAt: conversation.updatedAt || conversation.createdAt || 0,
    messages: (Array.isArray(conversation.messages) ? conversation.messages : [])
      .filter(message => !excluded.has(String(message && (message.id || message.messageId) || '')))
      .slice(-30).map((message, index) => ({
      id: String(message.id || `${conversation.id || 'conversation'}-${index}`),
      role: String(message.role || ''),
      text: String(message.text || message.content || '').slice(0, 5000),
      createdAt: message.createdAt || 0
    }))
  };
}

async function searchConversationEvidenceForRun(conversation, userPrompt, workspaceResolution) {
  if (!window.api || typeof window.api.searchConversationEvidence !== 'function') {
    return { success: false, evidence: [], queryTerms: [], reason: 'conversation_search_unavailable' };
  }
  const recentContext = (Array.isArray(conversation.messages) ? conversation.messages : [])
    .slice(-12)
    .map(message => String(message.text || message.content || ''))
    .filter(Boolean);
  const workspacePaths = getKnownWorkspaceCandidates(conversation).map(item => item.path);
  const currentPromptMessage = [...(Array.isArray(conversation.messages) ? conversation.messages : [])]
    .reverse()
    .find(message => String(message && message.role || '').toLowerCase() === 'user'
      && String(message && (message.text || message.content) || '').trim() === String(userPrompt || '').trim());
  const excludedMessageIds = currentPromptMessage && (currentPromptMessage.id || currentPromptMessage.messageId)
    ? [String(currentPromptMessage.id || currentPromptMessage.messageId)]
    : [];
  if (workspaceResolution && workspaceResolution.path && workspaceResolution.kind === WorkspaceResolution.KINDS.ACTIVE_PROJECT) {
    workspacePaths.unshift(workspaceResolution.path);
  }
  try {
    const result = await window.api.searchConversationEvidence({
      query: String(userPrompt || ''),
      recentContext,
      currentConversation: compactConversationForEvidenceSearch(conversation, excludedMessageIds),
      excludeConversationId: String(conversation.id || ''),
      excludeMessageIds,
      excludeUserPrompt: String(userPrompt || ''),
      workspacePaths: [...new Set(workspacePaths.filter(Boolean))],
      limit: 8
    });
    return result && typeof result === 'object'
      ? { ...result, evidence: Array.isArray(result.evidence) ? result.evidence : [] }
      : { success: false, evidence: [], queryTerms: [], reason: 'invalid_conversation_search_result' };
  } catch (error) {
    return { success: false, evidence: [], queryTerms: [], reason: error.message || String(error) };
  }
}

function formatRetrievedConversationEvidence(searchResult) {
  const evidence = searchResult && Array.isArray(searchResult.evidence) ? searchResult.evidence : [];
  if (!evidence.length) return '';
  const lines = evidence.slice(0, 8).map((item, index) => {
    const provenance = [item.sourceKind || 'conversation', item.role || '', item.timestamp || ''].filter(Boolean).join('/');
    return `${index + 1}. [${provenance}] ${String(item.excerpt || item.text || item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 1400)}`;
  });
  return `[RETRIEVED CONVERSATION EVIDENCE]\nThese are typed excerpts retrieved from persisted conversations/session records. They license recall only to the extent of their exact content; do not invent missing details. Exact conversation messages outrank session summaries.\nSearch terms: ${(searchResult.queryTerms || []).join(', ')}\n\n${lines.join('\n')}`;
}

window.stopAgentExecution = (options = {}) => {
  return requestAgentStop({ mode: options.mode || 'hard', taskId: options.taskId || '' });
};
window.softStopAgentExecution = () => requestAgentStop({ mode: 'soft' });

function buildSupervisorEvidencePacket(workWalkthrough = [], contextReceipt = {}) {
  const recentTools = (workWalkthrough || []).slice(-20).map((w, index) => {
    const target = w.label || w.toolName || 'unknown step';
    const status = w.status && w.status !== 'running' ? ` [${w.status}]` : '';
    const detail = w.detail ? ` - ${String(w.detail).slice(0, 160)}` : '';
    return `${index + 1}. ${target}${status}${detail}`;
  }).join('\n');

  const signatures = new Map();
  for (const item of (workWalkthrough || [])) {
    if (!item) continue;
    const key = [
      item.toolName || 'unknown',
      item.path || '',
      item.command || '',
      item.label || ''
    ].join('|').toLowerCase();
    signatures.set(key, (signatures.get(key) || 0) + 1);
  }

  return {
    recentTools,
    repeated: [...signatures.entries()]
      .filter(([, count]) => count >= 2)
      .slice(-8)
      .map(([signature, count]) => ({ signature, count })),
    fileMutations: (workWalkthrough || []).filter(isFileMutationItem).length,
    verificationCount: (workWalkthrough || []).filter(isVerificationItem).length,
    context: contextReceipt || {}
  };
}

function normalizeSupervisorDecision(responseText) {
  const parsed = parseModelJsonObject(responseText);
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
    const rawStatus = String(parsed.status || '').toLowerCase();
    const status = rawStatus === 'stuck' || rawStatus === 'continue' || rawStatus === 'finalize'
      ? rawStatus
      : (rawStatus === 'blocked' ? 'stuck' : 'continue');
    return {
      status,
      pattern: String(parsed.pattern || ''),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 8) : [],
      recommendedAction: parsed.recommendedAction && typeof parsed.recommendedAction === 'object'
        ? parsed.recommendedAction
        : { type: status === 'stuck' ? 'change_tool_strategy' : 'continue' },
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.map(String).slice(0, 8) : [],
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0
    };
  }

  const text = String(responseText || '');
  if (/STUCK/i.test(text) && !/CONTINUE/i.test(text)) {
    return {
      status: 'stuck',
      pattern: 'legacy_stuck_response',
      evidence: [],
      recommendedAction: { type: 'change_tool_strategy' },
      avoid: [],
      confidence: 0.5
    };
  }
  return {
    status: 'continue',
    pattern: 'legacy_continue_response',
    evidence: [],
    recommendedAction: { type: 'continue' },
    avoid: [],
    confidence: 0.5
  };
}

function buildSupervisorDecisionPrompt(evidencePacket) {
  return `You are a bounded supervisor for an autonomous local coding agent. Decide whether the run is healthy or stuck.

Evidence:
Recent tool calls:
${evidencePacket.recentTools || '(none)'}

Repeated signatures:
${JSON.stringify(evidencePacket.repeated || [], null, 2)}

Context acquisition receipt:
${JSON.stringify(evidencePacket.context || {}, null, 2)}

File mutations this run: ${evidencePacket.fileMutations || 0}
Verification calls this run: ${evidencePacket.verificationCount || 0}

Judge patterns, not a single call. Healthy progress includes reading different relevant files/ranges, running new verification, or making file mutations. Stuck patterns include repeated unchanged reads, repeated identical failures, fragmented context acquisition, identical completion-gate blocks, command loops with no new evidence, or tool oscillation.

Return compact JSON only:
{
  "status": "continue" | "stuck" | "finalize",
  "pattern": "short_pattern_name",
  "evidence": ["specific evidence from the packet"],
  "recommendedAction": {
    "type": "continue" | "consolidate_context" | "change_tool_strategy" | "run_verification" | "finalize" | "ask_user",
    "tool": "optional tool name",
    "target": "optional file/symbol/query target"
  },
  "avoid": ["specific repeated action to avoid"],
  "confidence": 0.0
}`;
}

async function evaluateLoopStateWithSupervisorDecision(modelName, workWalkthrough, disableTools, config, contextReceipt = {}) {
  if (disableTools) return { status: 'continue', recommendedAction: { type: 'continue' }, confidence: 1 };
  if (!workWalkthrough || workWalkthrough.length === 0) {
    return { status: 'continue', recommendedAction: { type: 'continue' }, confidence: 1 };
  }

  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
    return { status: 'stuck', pattern: 'test_mode', recommendedAction: { type: 'change_tool_strategy' }, confidence: 1 };
  }

  const prompt = buildSupervisorDecisionPrompt(buildSupervisorEvidencePacket(workWalkthrough, contextReceipt));

  try {
    const messages = [{ role: 'user', parts: [{ text: prompt }] }];
    let responseText = '';
    let resp;
    if (modelName.startsWith('deepseek')) {
      resp = await callDeepSeekAPI(messages, modelName, config?.deepseekApiKey || '', () => {}, true);
    } else if (modelName.includes('claude')) {
      resp = await callAnthropicAPI(messages, modelName, config?.anthropicApiKey || '', () => {}, true);
    } else if (modelName.includes('gemini')) {
      resp = await callGeminiAPI(messages, modelName, config?.geminiApiKey || '', () => {}, true);
    } else {
      resp = await callOllamaAPI(messages, modelName, () => {}, true);
    }

    if (resp && resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) {
      responseText = resp.candidates[0].content.parts.map(p => p.text || '').join('');
    }
    console.log("Supervisor response:", responseText);
    return normalizeSupervisorDecision(responseText);
  } catch (err) {
    console.error("Supervisor check failed:", err);
    return { status: 'continue', pattern: 'supervisor_failed', evidence: [err.message], recommendedAction: { type: 'continue' }, confidence: 0 };
  }
}

async function evaluateLoopStateWithSupervisorLegacy(modelName, workWalkthrough, disableTools, config) {
  if (disableTools) return false;
  if (!workWalkthrough || workWalkthrough.length === 0) return false;
  
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
    return true; // Fake "STUCK" for testing to avoid infinite loops in existing tests
  }

  // Walkthrough items carry a human-readable `label` (which encodes the actual target: file path,
  // line range, search term, URL, command), plus `status` and a post-run `detail`. Earlier this
  // read `w.toolArgs`, a property that never exists on these items, so every line rendered as
  // "read_file: undefined" — leaving the supervisor blind to WHICH file/term each call targeted.
  // It could see that read_file ran 8 times but not whether those were 8 different files
  // (progress) or the same file 8 times (stuck), which is the one distinction it exists to make.
  const recentTools = workWalkthrough.slice(-15).map(w => {
    const target = w.label || w.toolName || 'unknown step';
    const status = w.status && w.status !== 'running' ? ` [${w.status}]` : '';
    const detail = w.detail ? ` — ${String(w.detail).slice(0, 120)}` : '';
    return `${target}${status}${detail}`;
  }).join('\n');
  const prompt = `You are a supervisor evaluating an autonomous agent. Look at its recent tool calls:\n\n${recentTools}\n\nIs it stuck in a repetitive loop (e.g., searching the exact same term repeatedly, making the exact same tool call repeatedly with the same error, or reading the exact same lines without progress), or is it making healthy, unique progress on a large task (e.g., reading different files, searching different terms, exploring different line ranges)?\n\nReply strictly with the word STUCK or CONTINUE.`;

  try {
    const messages = [{ role: 'user', parts: [{ text: prompt }] }];
    let responseText = '';
    
    let resp;
    if (modelName.startsWith('deepseek')) {
      resp = await callDeepSeekAPI(messages, modelName, config?.deepseekApiKey || '', () => {}, true);
    } else if (modelName.includes('claude')) {
      resp = await callAnthropicAPI(messages, modelName, config?.anthropicApiKey || '', () => {}, true);
    } else if (modelName.includes('gemini')) {
      resp = await callGeminiAPI(messages, modelName, config?.geminiApiKey || '', () => {}, true);
    } else {
      resp = await callOllamaAPI(messages, modelName, () => {}, true);
    }
    
    if (resp && resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) {
      responseText = resp.candidates[0].content.parts.map(p => p.text || '').join('');
    }
    
    console.log("Supervisor response:", responseText);
    const isStuck = /STUCK/i.test(responseText) && !/CONTINUE/i.test(responseText);
    return isStuck;
  } catch (err) {
    console.error("Supervisor check failed:", err);
    return false; // Default to continue if supervisor fails
  }
}

async function evaluateLoopStateWithSupervisor(modelName, workWalkthrough, disableTools, config, contextReceipt = {}) {
  const decision = await evaluateLoopStateWithSupervisorDecision(modelName, workWalkthrough, disableTools, config, contextReceipt);
  return decision && decision.status === 'stuck';
}

// EXPOSE AGENT LOOP TO RENDERER
window.runAgentLoop = async function(userPrompt, modelName, conversation, options = {}) {
  const runTaskId = String(options.taskId || '');
  let runTaskExecutionId = '';
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
    return { success: false, queued: false, reason: 'agent_busy', taskId: runTaskId };
  }
  if (runTaskId && typeof window.claimOrchestrationTask === 'function') {
    const claimed = await window.claimOrchestrationTask(runTaskId);
    if (!claimed || claimed.success === false) {
      if (window.appendSystemMessage) {
        window.appendSystemMessage(`Skipped queued task ${runTaskId}: ${(claimed && claimed.reason) || 'it is no longer pending.'}`, {
          conversationId: conversation && conversation.id,
          source: 'task-status',
          dedupeKey: `task-skipped-${runTaskId}`
        });
      }
      scheduleSkippedQueueRecovery(0);
      return { success: false, skipped: true, taskId: runTaskId };
    }
    runTaskExecutionId = String(claimed.task && claimed.task.execution && claimed.task.execution.executionId || '');
    if (claimed.prompt) userPrompt = claimed.prompt;
  }
  
  // A new message means this conversation is no longer idle — cancel any pending
  // inactivity-triggered memory save (a fresh one is scheduled once this run completes).
  clearOrionMemoryInactivityTimer();

  isAgentRunning = true;
  runningConversationId = conversation.id;
  activeRunTaskId = runTaskId;
  agentExecutionMode = 'planning';
  isStopRequested = false;
  stopRequestMode = 'none';
  activeRunController = new AbortController();
  window.currentLoopCount = 0;
  currentAgentLogs = [];
  const config = window.getAppConfig();
  // Session continuity: build prev-session context on first message, clear otherwise
  const isOrionMode = conversation.mode === 'orion' ||
    (conversation.mode !== 'coder' && typeof appMode !== 'undefined' && appMode === 'orion');
  activeConversationMode = isOrionMode ? 'orion' : 'coder';
  // Captured once per run (rather than re-reading the shared activeConversationMode later, e.g. in
  // the finally block) so a concurrently-started run can't change which bucket this run's
  // preferences land in.
  const runMode = activeConversationMode;
  let workspaceResolution = isOrionMode
    ? await resolveDispatchWorkspaceForRun(conversation, userPrompt)
    : (WorkspaceResolution ? WorkspaceResolution.classifyWorkspace({
        mode: 'coder',
        workspacePath: resolveConversationWorkspace(conversation),
        projectPath: conversation.projectPath,
        searchRoot: getDispatchWorkspaceRoot(),
        knownProjects: getKnownWorkspaceCandidates(conversation)
      }) : { kind: 'standalone_coder', path: resolveConversationWorkspace(conversation) });
  let workspacePath = workspaceResolution.path || resolveConversationWorkspace(conversation);
  const contextualTaskResolution = (isOrionMode && TaskOrchestration && TaskOrchestration.isContextDependentRequest(userPrompt))
    ? TaskOrchestration.buildTaskPacket({
        originalUserMessage: userPrompt,
        precedingMessages: (conversation.messages || []).slice(0, -1),
        workspace: {
          role: workspaceResolution.kind,
          path: workspaceResolution.path || '',
          project: { name: workspaceResolution.projectName || '', path: workspaceResolution.projectPath || '' },
          source: workspaceResolution.source || '',
          resolved: workspaceResolution.kind !== (WorkspaceResolution && WorkspaceResolution.KINDS.UNRESOLVED)
        },
        originConversationId: conversation.id,
        targetConversationId: conversation.id,
        targetMode: 'orion'
      })
    : null;
  const resolvedRequestForRouting = contextualTaskResolution && contextualTaskResolution.success
    ? contextualTaskResolution.task.objective : userPrompt;
  const recallRequested = !!(isOrionMode && OrchestrationContracts && OrchestrationContracts.isRecallRequest(userPrompt));
  const conversationEvidenceSearch = recallRequested
    ? await searchConversationEvidenceForRun(conversation, userPrompt, workspaceResolution)
    : { success: true, evidence: [], queryTerms: [] };
  const retrievedConversationEvidence = Array.isArray(conversationEvidenceSearch.evidence)
    ? conversationEvidenceSearch.evidence : [];
  const structuredStatusFacts = OrchestrationContracts
    ? OrchestrationContracts.extractStructuredStatusFacts(userPrompt)
    : [];
  if (isOrionMode) {
    // Recall-oriented requests use the typed exact-evidence search above. The older continuity
    // summary remains useful for ordinary first-turn orientation, but it must never be the only
    // basis for an explicit "I remember" claim.
    orionSessionContinuityContext = recallRequested ? '' : await buildOrionContinuityContext(conversation, workspacePath);
    await refreshOrionMemoryBlock(config, userPrompt, runMode); // pre-load global memory, ranked against this message
  } else {
    orionSessionContinuityContext = '';
    orionCachedMemoryBlock = '';
  }
  if (window.onAgentStatusChange) window.onAgentStatusChange(true);

  conversation._activeContextRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  config.modelName = modelName || config.modelName || 'gemini-2.5-flash-lite';
  let activeRunModelName = config.modelName;
  config.activeRunModelName = activeRunModelName;
  // Preserved so a temporary escalation to a stronger model (see the repeated-edit-failure
  // handling below) can revert once the file it was escalated for gets a clean edit, instead of
  // silently staying on the more expensive model for the rest of the conversation.
  const userSelectedModelName = activeRunModelName;
  let modelEscalatedForEditKey = null;
  const promptSource = options.source || 'user';
  const isInternalPrompt = !!options.internalPrompt || promptSource === 'followup' || promptSource === 'system' || promptSource === 'plan-approval';
  if (!isInternalPrompt) {
    maybeSaveExplicitPreference(userPrompt, config, runMode).catch(() => {});
  }

  // Image data attached to this prompt (e.g. from desktop paste or phone file upload)
  const promptImages = Array.isArray(options.images) ? options.images.filter(img => img && img.data && img.mimeType) : [];
  const hasPromptImages = promptImages.length > 0;

  // Route to Gemini 2.5 Flash if images are present and current model doesn't support vision
  if (hasPromptImages && !activeRunModelName.startsWith('gemini-')) {
    const visionModel = 'gemini-2.5-flash';
    if (window.appendSystemMessage) {
      window.appendSystemMessage(
        `Image attached — switching to ${visionModel} for this message (${activeRunModelName} doesn't support vision).`,
        { conversationId: conversation.id }
      );
    }
    activeRunModelName = visionModel;
    config.activeRunModelName = activeRunModelName;
  }

  let lastTextResponse = "Thinking...";
  let bestVisibleAnswer = "";
  let aiMessageIndex = Array.isArray(conversation.messages) ? conversation.messages.length : 0;
  let workWalkthrough = [];
  const persistedVisualArtifactKeys = new Set();
  let forceYield = false;
  let autoContinueExecution = false;
  let userRequestedStop = false;
  let finalAnswerQualityPrompts = 0;
  let finalAnswerQualityLoopExtensions = 0;
  let memoryConfidenceCorrections = 0;
  let statusAccuracyCorrections = 0;
  let criticalRunError = null;
  let finalizedTaskState = runTaskId ? 'active' : '';
  // Set right after the main while loop exits, in the outer function scope so the `finally` block
  // below (which runs in a separate block from the `try` that declares loopCount/maxLoops) can see
  // whether the loop stopped because it hit its raw per-turn ceiling rather than because the model
  // reached a deliberate conclusion. A run that thrashes through many legitimate-but-circuitous
  // tool calls (e.g. repeatedly retrying broken shell escaping) exhausts this ceiling while
  // lastTextResponse is still whatever stale mid-task sentence was set before the thrashing began
  // — with no checklist yet established (this can happen before plan approval), nothing else
  // catches that and the stale sentence silently becomes the "final" answer.
  let ranOutOfLoopBudget = false;

  if (!Array.isArray(conversation.messages)) {
    conversation.messages = [];
  }
  // Clear active bubble tracking so this fresh run starts its own new bubble instead of mutating
  // whatever bubble the previous run (e.g. a plan awaiting approval) left behind. This must happen
  // before the very first render below — clearing it later (after that render) let a resumed run
  // (post plan-approval, post clarification) silently overwrite the old bubble in its old DOM
  // position instead of appending a new one after the messages that came in between.
  window.clearActiveAiBubble();
  conversation.messages.push({ role: 'assistant', text: 'Thinking...', logs: [], turns: [], createdAt: Date.now() });
  if (window.saveConversationsToStorage) {
    window.saveConversationsToStorage();
  }
  // Show the running-indicator spinner immediately instead of leaving the chat area blank until
  // the first tool call (or the whole run finishing) — the model's first response can take a
  // while, and without this the user has no visible sign the run is even happening.
  if (window.renderAiMessage) {
    window.renderAiMessage('Thinking...', [], conversation.id, conversation.messages[aiMessageIndex]);
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
  const inheritedContextReceipt = await loadInheritedContextReceipt(conversation, workspacePath);

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
  let suppressPlanApprovalCardThisTurn = false;

  if (isInternalPrompt) {
    // System-driven continuation (approved-plan execution, queued follow-up): just build.
    // planningBypassedForTask unblocks the executor and keeps the system note execution-focused.
    planningDecision = { mode: 'direct', reason: 'Internal follow-up continuing existing work.' };
    planningBypassedForTask = true;
    agentExecutionMode = 'executing';
  } else if (conversation.awaitingPlanApproval && !conversation.planApproved) {
    // The user is replying to a pending plan. The model classifies their reply.
    approvalIntent = await classifyPlanApprovalIntent(userPrompt, resolveUtilityModelName(modelName), config);
    if (approvalIntent.intent === 'approve') {
      const planText = await readImplementationPlanText(workspacePath, conversation);
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
    } else if (approvalIntent.intent === 'other') {
      suppressPlanApprovalCardThisTurn = true;
      const decision = config.planningMode === false
        ? { mode: 'direct', reason: 'Planning mode disabled.' }
        : await classifyPlanningNeed(userPrompt, resolveUtilityModelName(modelName), config, conversation.messages);
      planningDecision = decision;
      reviewOnly = !!decision.reviewOnly;
      if (reviewOnly && planningDecision.mode === 'plan') {
        planningDecision = {
          ...planningDecision,
          mode: 'direct',
          reason: `${planningDecision.reason || ''} Separate read-only request while a plan is pending; answer directly without plan approval.`.trim()
        };
      }
      if (reviewOnly || planningDecision.mode === 'direct') {
        planningBypassedForTask = true;
        agentExecutionMode = 'direct';
      } else if (planningDecision.mode === 'answer') {
        agentExecutionMode = 'answer';
      }
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
      : await classifyPlanningNeed(userPrompt, resolveUtilityModelName(modelName), config, conversation.messages);
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
    const decision = await classifyPlanningNeed(userPrompt, resolveUtilityModelName(modelName), config, conversation.messages);
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
    const upgraded = getNextModelForHighDemand(userSelectedModelName);
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
  if (!isInternalPrompt && conversation.mode !== 'orion' && !conversation.planApproved && window.appendSystemMessage && planningBypassedForTask && planningDecision.mode === 'direct' && agentExecutionMode === 'direct') {
    window.appendSystemMessage(`Planning mode: direct task, no implementation plan required. ${planningDecision.reason || ''}`.trim(), {
      conversationId: conversation.id,
      source: 'planning-mode',
      dedupeKey: `planning-mode-${conversation.id}`,
      updateExisting: true
    });
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
  let messages = OperationalContext.buildReasoningMessages(workingState, conversation.messages, promptForModel, promptImages);

  if (recallRequested) {
    const retrievedEvidenceText = formatRetrievedConversationEvidence(conversationEvidenceSearch);
    const recallContractText = retrievedEvidenceText || `[RETRIEVED CONVERSATION EVIDENCE]\nNo relevant prior-conversation evidence passed the retrieval threshold for this request. You must not say "I remember," "we discussed," "you said earlier," or reconstruct a plausible prior exchange. Say naturally that the specific conversation could not be retrieved. Project/source knowledge and a new inference are still allowed only when labeled as such.`;
    messages.splice(2, 0,
      { role: 'user', parts: [{ text: recallContractText }] },
      { role: 'model', parts: [{ text: retrievedEvidenceText
        ? 'Understood. I will base any recall claim only on these retrieved conversational excerpts.'
        : 'Understood. I will not claim to remember a conversation that was not retrieved.' }] }
    );
  }

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
  const durableNotesText = scopedNotes.content && scopedNotes.content.trim()
    ? `[ORION DURABLE NOTES - ${scopedNotes.scopeLabel}]\nThese are persistent notes for this scope. Use them as working memory, but verify against files when needed.\n\n${scopedNotes.content}`
    : '';

  let rulesText = '';
  if (workspacePath && window.api && window.api.readFile) {
    try {
      const result = await window.api.readFile(workspacePath, '.orion/rules.md');
      if (result && result.content && !result.error) {
        rulesText = result.content;
      }
    } catch (_) {}
  }

  let scratchpadText = conversation.scratchpad || '';

  if (durableNotesText || (projectMemory.facts && projectMemory.facts.length > 0) || rulesText || scratchpadText) {
    const memText = (projectMemory.facts || []).map((f, i) => `${i + 1}. [${f.category || 'general'}] ${f.text}`).join('\n');
    const combinedText = [
      durableNotesText,
      memText ? `[ORION PROJECT MEMORY]\nPersistent workspace facts from prior sessions.\n\n${memText}` : '',
      rulesText ? `[PROJECT GOTCHAS & RULES]\nFound in .orion/rules.md. ALWAYS follow these rules for this project:\n\n${rulesText}` : '',
      scratchpadText ? `[CURRENT SCRATCHPAD STATE]\nYour persistent chain-of-thought scratchpad. Update this with update_scratchpad when you need to think through a task.\n\n${scratchpadText}` : ''
    ].filter(Boolean).join('\n\n---\n\n');

    messages.splice(2, 0,
      { role: 'user', parts: [{ text: combinedText }] },
      { role: 'model', parts: [{ text: 'Understood. I have the context data loaded.' }] }
    );
  }

  // Inject resolved system facts so the model never needs to probe for the home directory
  const webSearchAvailable = !!(config.googleSearchApiKey && config.googleSearchEngineId);
  const webSearchLabel = webSearchAvailable ? 'AVAILABLE' : 'UNAVAILABLE';
  const webSearchStatus = webSearchAvailable
    ? 'AVAILABLE — google_search and fetch_web_page are ready to use.'
    : 'UNAVAILABLE — googleSearchApiKey or googleSearchEngineId not configured. Do not attempt google_search; use fetch_web_page with a known URL if you must retrieve a specific doc.';
  // Dispatch is a conversational assistant, not a task-tracking tool -- the "Work Walkthrough"
  // step-by-step recap (required by RESPONSE FORMAT for Coder's implementation work) is just noise
  // on a direct answer/discussion reply here, so override that instruction for this conversation.
  const isDispatchConversation = conversation.mode === 'orion';
  const workWalkthroughOverride = isDispatchConversation
    ? '\nThis is a Dispatch conversation, not a Coder/implementation task. Do NOT include a "Work Walkthrough" section, a files-touched list, or a step-by-step recap of tool calls in your response, even if you used tools this turn. Just answer directly and conversationally.'
    : '';
  // Evidence discipline: a real agent run confidently reported a click handler and a CSS block
  // as nonexistent because piped grep patterns silently matched nothing — zero-match searches
  // read exactly like genuine absence. This rule makes negative claims require corroboration.
  const evidenceDisciplineRule = '\nEvidence discipline: a zero-match search is WEAK evidence of absence — it may mean a wrong pattern, wrong mode (literal vs regex), wrong directory, or a truncated scan. Before stating in your answer that code, a handler, a style, or a feature does NOT exist, corroborate with a second differently-shaped check: a simpler single-token grep_search, or read_file of the location where it would live. If you cannot corroborate, say "I could not find it" instead of "it does not exist." Never present an unverified absence as a confirmed finding.';
  const dispatchProjectContext = isDispatchConversation && conversation.dispatchContextSummary
    ? `\nFresh project session context: ${String(conversation.dispatchContextSummary).replace(/\s+/g, ' ').trim().slice(0, 1800)}\nThis is a compact re-entry summary, not current source-code evidence. Preserve established discussion and decisions, but refresh only the files needed by the user's current question before making code claims.`
    : '';
  const knownProjectsFacts = formatKnownProjectsForSystemFacts();
  const knownProjectsBlock = knownProjectsFacts
    ? `\n\n[ORION KNOWN LOCAL PROJECTS]\nUse these registered absolute paths directly when Jason names a project:\n${knownProjectsFacts}`
    : '';
  const systemFactsSignature = JSON.stringify({
    home: resolvedHomeDir,
    workspace: workspacePath || '',
    workspaceKind: workspaceResolution && workspaceResolution.kind,
    webSearch: webSearchLabel,
    promptSource: promptSource === 'phone' ? 'phone' : 'desktop',
    knownProjectsFacts,
    dispatch: isDispatchConversation,
    dispatchProjectContext
  });
  const shouldInjectFullSystemFacts = conversation._systemFactsSignature !== systemFactsSignature;
  conversation._systemFactsSignature = systemFactsSignature;
  const workspaceFactText = WorkspaceResolution
    ? WorkspaceResolution.describeWorkspace(workspaceResolution, (WorkspaceResolution.extractProjectReferences(userPrompt) || [])[0] || '')
    : `Active conversation workspace: ${workspacePath || '(none)'}.`;
  const systemFactsText = shouldInjectFullSystemFacts
    ? `[ORION SYSTEM FACTS]\nUser home directory (resolved): ${resolvedHomeDir}\nDesktop projects folder: ${resolvedHomeDir}\\Desktop\\projects\n${workspaceFactText}\nWeb search: ${webSearchStatus}\nClient: ${promptSource === 'phone' ? 'PHONE COMPANION — the user is on their phone. Prefer descriptions, text output, and copy-pasteable results over actions that require the desktop (launching GUI apps, opening windows, running interactive commands). If you need to show output, describe it clearly rather than suggesting they look at the screen.' : 'DESKTOP — the user is at their computer. You can launch apps, reference screen elements, and run interactive commands normally.'}\nUse self-referential phrases such as "this program" only when the workspace role above is an active project or standalone Coder workspace. A project search root is a directory to search, not a selected project. Do not re-run change_workspace for an older dictated/autocorrected folder phrase after a real workspace has already been resolved.\nDo NOT run echo or whoami to discover these paths — use the values above directly.${evidenceDisciplineRule}${dispatchProjectContext}${workWalkthroughOverride}${knownProjectsBlock}`
    : `[ORION SYSTEM FACTS - compact]\nStable system facts are unchanged from earlier in this conversation. ${workspaceFactText} Home: ${resolvedHomeDir}. Web search: ${webSearchLabel}. Client: ${promptSource === 'phone' ? 'phone companion' : 'desktop'}.\nUse self-referential workspace phrases only for an active project or standalone Coder workspace. Do NOT run echo or whoami to discover these paths.${evidenceDisciplineRule}${dispatchProjectContext}${workWalkthroughOverride}`;
  messages.splice(2, 0,
    {
      role: 'user',
      parts: [{ text: systemFactsText }]
    },
    {
      role: 'model',
      parts: [{ text: `Understood. System facts loaded (${shouldInjectFullSystemFacts ? 'full' : 'compact'}). Web search: ${webSearchLabel}. Client: ${promptSource === 'phone' ? 'phone companion' : 'desktop'}.${isDispatchConversation ? ' I will skip the Work Walkthrough section for this conversation.' : ''}` }]
    }
  );

  // File-knowledge brief: cold ingestion (re-reading the whole project every task) is the
  // dominant startup cost in a known workspace. The ledger binds prior reads and saved notes to
  // exact content versions, so a new run can trust notes for byte-identical files and re-read
  // only what actually changed. Digests are hash-gated — they are never surfaced for a file
  // whose content moved, so "stale notes" cannot occur, only absent ones.
  if (shouldInjectFullSystemFacts && workspacePath && window.api && typeof window.api.getKnowledgeBrief === 'function') {
    try {
      const brief = await window.api.getKnowledgeBrief(workspacePath, 25);
      if (brief && brief.success && ((brief.knownCurrent || []).length || (brief.changed || []).length || (brief.seenCurrent || []).length)) {
        const knownLines = (brief.knownCurrent || []).map(f => `- ${f.path}: ${f.digest}`).join('\n');
        const briefText = [
          '[FILE KNOWLEDGE — what you already know about this workspace from previous tasks]',
          knownLines ? `Files UNCHANGED since you last read them, with your saved notes (trust these for orientation; re-read only when making load-bearing claims about exact contents or before editing):\n${knownLines}` : '',
          (brief.seenCurrent || []).length ? `Files you previously read (still unchanged) but saved no notes for: ${brief.seenCurrent.join(', ')}` : '',
          (brief.changed || []).length ? `Files CHANGED since you last read them — re-read before relying on any prior understanding: ${brief.changed.join(', ')}` : '',
          (brief.missing || []).length ? `Previously-tracked files that no longer exist: ${brief.missing.join(', ')}` : '',
          'Do NOT re-read unchanged files you already have notes for just to re-orient. After substantively reading a file, save or update its notes with remember_file_notes so the next task starts warm.'
        ].filter(Boolean).join('\n\n');
        messages.splice(4, 0,
          { role: 'user', parts: [{ text: briefText }] },
          { role: 'model', parts: [{ text: 'Understood. I will reuse my current file knowledge, re-read only the changed files, and save notes for files I read this run.' }] }
        );
      }
    } catch (_) {
      // Ledger problems must never block a run.
    }
  }

  // Strategy gate prep: only a fresh plan-worthy task that has not been approved needs it.
  if (!planningBypassedForTask && planningDecision.mode === 'plan' && config.planningMode !== false && !conversation.planApproved && !isInternalPrompt) {
        strategyStatus = await readStrategyStatus(workspacePath, conversation);
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

  const inheritedContextPrompt = buildInheritedContextPrompt(inheritedContextReceipt);
  if (inheritedContextPrompt) {
    messages.push({
      role: 'user',
      parts: [{ text: inheritedContextPrompt }]
    });
  }

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

  function rememberBestVisibleAnswer(text) {
    if (isSubstantiveVisibleAnswer(text)) {
      bestVisibleAnswer = String(text || '');
    }
  }

  function useBestVisibleAnswerIfGateEcho(text) {
    if (bestVisibleAnswer && looksLikeLeakedNoToolCorrection(text)) {
      lastTextResponse = bestVisibleAnswer;
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      return true;
    }
    return false;
  }

  const incidentalIssueBuffer = [];
  // Declared outside the try so the finally-block response-basis computation can see it.
  const toolEvidenceLedger = [];

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
      const tokenCount = await countTokens(messages, resolveUtilityModelName(modelName), config, { signal: getActiveRunSignal() });
      console.log("Current conversation tokens:", tokenCount);
      const compactThreshold = getCompactionThreshold(modelName, config);
      if (config.autoCompact !== false && tokenCount > compactThreshold) {
        window.appendSystemMessage(`Context reached ${tokenCount} tokens; compacting for ${modelName} at threshold ${compactThreshold}.`);
        if (typeof window.api.writeConversationArtifact === 'function') {
          try {
            const backupStr = JSON.stringify(conversation.messages, null, 2);
            await window.api.writeConversationArtifact(conversation.id, `compaction-backup-${Date.now()}.json`, backupStr);
          } catch (e) {
            console.warn("Failed to backup conversation pre-compaction", e);
          }
        }
        const compactResult = await compactHistory(messages, resolveUtilityModelName(modelName), config);
        persistCompactedConversation(conversation, compactResult.summary);
        await appendScopedNotes(workspacePath, conversation, `\n\n## Context Compaction ${new Date().toISOString()}\n${compactResult.summary}\n`);
        const checkpoint = await checkpointOperationalContext(workspacePath, 'context_compaction', 'Conversation context was compacted; canonical mission state was preserved.', 'Continue the active subplan from operational context.');
        if (checkpoint && checkpoint.state) workingState = checkpoint.state;
        messages = OperationalContext.buildReasoningMessages(workingState, conversation.messages, promptForModel, promptImages);
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
        if (window.renderAiMessage) {
          window.renderAiMessage('Thinking...', [], conversation.id, conversation.messages[aiMessageIndex]);
        }
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
    // Planning phase (not yet approved, writing a plan doc) needs more room than a simple task
    // because it must survey the codebase AND produce a complete multi-section plan document.
    // Without this, deep codebase surveys hit the 20-loop ceiling before finishing the plan.
    const writingPlan = planningDecision.mode === 'plan' && !conversation.planApproved && !planningBypassedForTask;
    if (writingPlan && !reviewOnly) maxLoops = 40;
    let planValidationRetries = 0;
    let consecutiveNoToolCalls = 0;
    let malformedCallsCount = 0;
    let maxTokensContinuations = 0;
    let postEditEvidencePrompts = 0;
    let postEditEvidenceLoopExtensions = 0;
    let completionGatePrompts = 0;
    let completionGateLoopExtensions = 0;
    let lastCompletionGateBlockSignature = '';
    let lastCompletionGateBlockFileMutationCount = -1;
    let reviewCompletionPrompts = 0;
    let reviewCompletionLoopExtensions = 0;
    let pendingWorkspaceResolutionPrompts = 0;
    let memoryNudgeSent = false;
    let skillGateFired = false;
    let skillDiscoveryChecked = false; // true once discover_skills has been called this run
    let blankFinalAnswerNudgeSent = false;
    let dispatchForcedHandoffSent = false;
    let blockedDispatchHandoffAttempts = 0;
    const repeatedToolFailures = new Map();
    const fileEditCounts = new Map();
    const fileNeedsReadBeforeEdit = new Set(); // files that must be read before the next edit
    // Files whose current content the model has actually seen this run — populated by a successful
    // read_file (it saw the content) or write_file (it authored the content). A surgical edit
    // (modify_file/patch_file) to a file NOT in this set is a blind edit against content the model
    // is only guessing at, which is the single biggest source of drift corruption. The gate below
    // requires the file to be here first. (This is the "read before you edit" rule that keeps even
    // a weak model from mangling a file it never looked at.)
    const filesSeenThisRun = inheritedContextSeenFiles(inheritedContextReceipt);
    // Files that have been fully read this run and NOT edited since — a subsequent full re-read of
    // one of these returns the same bytes the model already has, which is pure waste (a transcript
    // showed a 2600-line file re-read six times in one run). We still deliver the content (safe —
    // never risk hiding something the model needs), but attach a note nudging it to stop re-reading
    // and act. Cleared on any edit to the file, since a re-read after an edit is legitimate.
    const filesFullyReadUnchanged = new Set();
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
    const contextAcquisitionLedger = createContextAcquisitionLedger();
    if (inheritedContextReceipt) {
      recordContextAcquisitionToolResult(
        contextAcquisitionLedger,
        'inspect_code_context',
        { query: 'inherited Dispatch context packet' },
        inheritedContextReceipt
      );
    }
    let supervisorCorrectionAttempts = 0;
    const maxMalformedToolRetries = 5;
    const canExecuteThisTask = () => !config.planningMode || conversation.planApproved || planningBypassedForTask;

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
        agentSubStatus = `Calling ${activeRunModelName.startsWith('gemini-') ? 'Gemini' : (activeRunModelName.startsWith('claude') ? 'Claude (' + activeRunModelName + ')' : (activeRunModelName.startsWith('deepseek') ? 'DeepSeek (' + activeRunModelName + ')' : 'Ollama (' + activeRunModelName + ')'))} API...`;
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
        const onApiWarning = (warningMsg) => {
          agentSubStatus = warningMsg;
          conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
          window.renderAiMessage(lastTextResponse, currentAgentLogs);
        };
        if (activeRunModelName.startsWith('gemini-')) {
          response = await callGeminiAPI(messagesForApiCall, activeRunModelName, config.geminiApiKey, onApiWarning, false, { signal: getActiveRunSignal() });
        } else if (activeRunModelName.startsWith('claude')) {
          response = await callAnthropicAPI(messagesForApiCall, activeRunModelName, config.anthropicApiKey, onApiWarning, false, { signal: getActiveRunSignal() });
        } else if (activeRunModelName.startsWith('deepseek')) {
          response = await callDeepSeekAPI(messagesForApiCall, activeRunModelName, config.deepseekApiKey, onApiWarning, false, { signal: getActiveRunSignal() });
        } else {
          response = await callOllamaAPI(messagesForApiCall, activeRunModelName, onApiWarning, false, { signal: getActiveRunSignal() });
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

      // A handoff is an executable side effect. The model may not turn commands that appear only
      // inside a quoted status report, transcript, test case, or code sample into a real Coder
      // task. This gate runs before tool execution, so it protects model-originated calls as well
      // as the synthetic refusal-recovery path below.
      if (runMode === 'orion' && functionCalls.some(call => call && call.name === 'handoff_to_coder') && DispatchIntent) {
        const instructionAnalysis = DispatchIntent.analyzeDispatchInstruction(
          contextualTaskResolution && contextualTaskResolution.success ? resolvedRequestForRouting : userPrompt
        );
        if (!instructionAnalysis.executionRequested) {
          blockedDispatchHandoffAttempts++;
          for (let index = parts.length - 1; index >= 0; index--) {
            if (parts[index] && parts[index].functionCall && parts[index].functionCall.name === 'handoff_to_coder') parts.splice(index, 1);
          }
          functionCalls = functionCalls.filter(call => call && call.name !== 'handoff_to_coder');
          currentAgentLogs.push({
            type: 'thought',
            content: `Dispatch instruction guard: ignored a handoff derived only from ${instructionAnalysis.reason || 'reported/quoted material'}.`
          });
          if (functionCalls.length === 0 && blockedDispatchHandoffAttempts <= 2 && loopCount < maxLoops) {
            messages.push({
              role: 'user',
              parts: [{ text: '[SYSTEM: The attempted Coder handoff was blocked because the latest user message reports, quotes, transcribes, or tests executable wording rather than actively requesting that operation. Analyze or acknowledge the surrounding message. Do not execute the quoted example and do not call handoff_to_coder unless the user explicitly asks to run/apply that quoted content.]' }]
            });
            continue;
          }
        }
      }

      // Dispatch is intentionally denied execution/mutation tools, but that permission boundary
      // must never become a reason to return the task to Jason. If an explicit execution request
      // receives a no-tool permission refusal/manual deflection, synthesize the allowed Coder
      // handoff as part of this same model turn. Mutating `parts` keeps provider history valid:
      // the following tool response has a matching functionCall in the assistant message.
      if (functionCalls.length === 0 && shouldForceDispatchHandoff(resolvedRequestForRouting, textVal, {
        mode: runMode,
        alreadyHandedOff: dispatchForcedHandoffSent
      })) {
        const handoffText = "I can't execute that from Dispatch, so I'm passing it to Coder.";
        const forcedCall = {
          name: 'handoff_to_coder',
          args: {
            prompt: buildForcedDispatchHandoffPrompt(resolvedRequestForRouting),
            title: 'Execute Dispatch request',
            open: true
          }
        };
        parts.splice(0, parts.length, { text: handoffText }, { functionCall: forcedCall });
        textVal = handoffText;
        functionCalls = [forcedCall];
        dispatchForcedHandoffSent = true;
        currentAgentLogs.push({
          type: 'thought',
          content: 'Dispatch delegation guard: converted a permission refusal into the required Coder handoff.'
        });
      }

      if (textVal) {
        if (!useBestVisibleAnswerIfGateEcho(textVal)) {
          lastTextResponse = textVal;
          rememberBestVisibleAnswer(textVal);
        }
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
        if (bestVisibleAnswer && looksLikeLeakedNoToolCorrection(textVal)) {
          currentAgentLogs.push({ type: 'thought', content: 'Answer continuity guard: a later gate response referred to an earlier answer instead of being the answer, so Orion kept the substantive visible answer.' });
          break;
        }
        // A model can do a batch of real tool work (reads/searches) and then, on the very next
        // turn, return truly nothing at all — no tool call, no text. Every other recovery gate
        // below shares a small per-run budget (finalAnswerQualityPrompts, evidencePrompts, etc.),
        // and a long investigative turn can exhaust that budget on earlier nudges before ever
        // reaching this specific case, letting a blank response fall straight through to the
        // generic "did not produce an answer" bailout at the end of the run. A blank response
        // after real work is the clearest possible signal the model just stopped mid-task, so it
        // gets one dedicated, budget-exempt retry here, ahead of every other gate.
        if (!textVal.trim() && !blankFinalAnswerNudgeSent && workWalkthrough.some(item => item && item.status !== 'error')) {
          blankFinalAnswerNudgeSent = true;
          if (loopCount >= maxLoops) maxLoops++;
          currentAgentLogs.push({ type: 'thought', content: 'Blank-response guard: the model gathered evidence but returned nothing at all. Forcing one more turn to write the actual answer.' });
          messages.push({
            role: 'user',
            parts: [{
              text: `[SYSTEM: Your last response contained no text and no tool call, even though you already gathered evidence this run (file reads, searches, etc.). Do not stop mid-task. Write your complete, direct answer to the user's original request now, using everything you found. The user's original message was: "${String(userPrompt || '').replace(/"/g, "'").slice(0, 500)}"]`
            }]
          });
          continue;
        }
        if (OrchestrationContracts && (recallRequested || OrchestrationContracts.hasExplicitRecallClaim(textVal))) {
          const memoryValidation = OrchestrationContracts.validateMemoryResponse(textVal, {
            conversationEvidence: retrievedConversationEvidence
          });
          if (!memoryValidation.valid && memoryConfidenceCorrections < 1 && loopCount < maxLoops) {
            memoryConfidenceCorrections++;
            currentAgentLogs.push({ type: 'thought', content: `Memory-confidence guard: ${memoryValidation.reason}.` });
            messages.push({
              role: 'user',
              parts: [{ text: OrchestrationContracts.buildMemoryCorrectionPrompt(userPrompt, retrievedConversationEvidence, memoryValidation.reason) }]
            });
            continue;
          }
          if (!memoryValidation.valid) {
            lastTextResponse = OrchestrationContracts.buildEvidenceBackedRecallFallback(retrievedConversationEvidence);
            break;
          }
        }
        if (structuredStatusFacts.length > 0 && OrchestrationContracts) {
          const statusValidation = OrchestrationContracts.validateStatusResponse(textVal, structuredStatusFacts);
          if (!statusValidation.valid && statusAccuracyCorrections < 1 && loopCount < maxLoops) {
            statusAccuracyCorrections++;
            currentAgentLogs.push({ type: 'thought', content: `Structured-status guard: ${statusValidation.reason}.` });
            messages.push({ role: 'user', parts: [{ text: OrchestrationContracts.buildStatusCorrectionPrompt(statusValidation) }] });
            continue;
          }
          if (!statusValidation.valid) {
            lastTextResponse = OrchestrationContracts.enforceStatusFallback(textVal, structuredStatusFacts);
            break;
          }
        }
        const pendingTasks = conversation.tasks ? conversation.tasks.filter(t => t.status !== 'completed' && t.status !== 'x') : [];
        if (config.planningMode && !canExecuteThisTask() && !hasAnyChecklist(conversation) &&
            !isSubstantiveVisibleAnswer(textVal) && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: Planning Mode is active and no checklist or implementation plan has been created for this request. Either create the implementation plan and checklist with tools now, or give a complete direct answer that does not promise later action.]'
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
          const prompt = `[SYSTEM: You returned a response without calling any tools, but there are still pending tasks in the checklist: ${pendingTasks.map(t => `"${t.title}"`).join(', ')}. Continue with the next concrete tool action if one is needed. Be sure to mark tasks as 'in-progress' when starting them and 'completed' when done. If you are blocked, explain the blocker and the next recovery step. When everything is fully complete and verified, output your final summary.]`;
          
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
        const finalAnswerQualityPrompt = buildFinalAnswerQualityGatePrompt(userPrompt, textVal, workWalkthrough, conversation);
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
          const completionGateSignature = buildCompletionGateLoopSignature(completionGate);
          const completionGateFileMutationCount = workWalkthrough.filter(isFileMutationItem).length;
          if (shouldEscapeRepeatedCompletionGateBlock({
            gate: completionGate,
            signature: completionGateSignature,
            previousSignature: lastCompletionGateBlockSignature,
            fileMutationCount: completionGateFileMutationCount,
            previousFileMutationCount: lastCompletionGateBlockFileMutationCount
          })) {
            currentAgentLogs.push({ type: 'thought', content: 'Completion gate loop escape: identical completion block repeated without intervening file mutations, so Orion stopped prompting for more work.' });
            lastTextResponse = bestVisibleAnswer || `I am stopping instead of repeating the same completion gate loop.\n\n${buildCompletionGateMessage(completionGate)}`;
            break;
          }
          lastCompletionGateBlockSignature = completionGateSignature;
          lastCompletionGateBlockFileMutationCount = completionGateFileMutationCount;
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
        if (!bestVisibleAnswer && !memoryNudgeSent && !reviewOnly && turnDidSubstantiveInspection(workWalkthrough) &&
            !turnAlreadyWroteMemory(workWalkthrough) && !isGenericNonAnswer(textVal) && loopCount < maxLoops) {
          memoryNudgeSent = true;
          currentAgentLogs.push({ type: 'thought', content: 'Memory gate: substantial workspace inspection happened this turn; nudging Orion to persist any durable facts before finishing.' });
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: You just did substantial workspace inspection. If you discovered a durable architectural fact, API shape, gotcha, or decision that future sessions should know, call append_project_memory, remember_fact, or remember_decision now (1-3 concise entries) before your final answer. If nothing new/durable was learned, do not repeat, rewrite, or replace your previous answer — it already stands as the final response and must not be lost. Reply with exactly: NO_ADDITIONAL_ACTION]'
            }]
          });
          continue;
        }
        // Skill creation nudge: after a multi-step task (5+ tool calls) that didn't already
        // create a skill, prompt Orion to consider whether any reusable capability emerged.
        const didMultiStepWork = !reviewOnly && workWalkthrough.filter(i => i && i.status !== 'error').length >= 5;
        const alreadyCreatedSkill = workWalkthrough.some(i => i && i.toolName === 'create_skill');
        if (!bestVisibleAnswer && !skillGateFired && didMultiStepWork && !alreadyCreatedSkill && !isGenericNonAnswer(textVal) && loopCount < maxLoops) {
          skillGateFired = true;
          currentAgentLogs.push({ type: 'thought', content: 'Skill gate: multi-step task completed; nudging Orion to consider packaging a reusable skill.' });
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: You just completed a multi-step task. Briefly consider: is there a reusable, testable capability here that would save effort on future tasks? If yes, call create_skill now. If not, do not repeat, rewrite, or replace your previous answer — it already stands as the final response and must not be lost. Reply with exactly: NO_ADDITIONAL_ACTION]'
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

      // ── Parallel execution for read-only batches ──────────────────────────────
      // When the model returns a batch of calls that are all read-only, run the
      // executeTool calls concurrently with Promise.all. State mutations (log
      // updates, ledger entries, working-state transitions) are still sequential.
      const PARALLELIZABLE_TOOLS = new Set([
        'read_file', 'read_multiple_files', 'read_multiple_ranges', 'inspect_code_context', 'list_files', 'get_symbol_index', 'get_workspace_info',
        'google_search', 'fetch_web_page', 'grep_search', 'search_embeddings', 'search_api_docs',
        'semantic_search', 'fetch_page', 'git_diff', 'git_rollback', 'edit_config', 'get_file_symbols', 'find_references',
        'read_command_output', 'get_command_status',
        'recall_memory', 'read_notes', 'get_project_memory'
      ]);
      const canRunParallel = functionCalls.length > 1 &&
        functionCalls.every(c => PARALLELIZABLE_TOOLS.has(c.name));

      if (canRunParallel) {
        const parallelNames = functionCalls.map(c => c.name).join(', ');
        currentAgentLogs.push({ type: 'thought', content: `⚡ Running ${functionCalls.length} independent read-only calls in parallel: ${parallelNames}` });
        agentSubStatus = `Running ${functionCalls.length} tools in parallel...`;

        // Pre-allocate a log slot and walkthrough item for each call
        const callMeta = functionCalls.map(call => {
          const toolName = call.name;
          const args = call.args || {};
          const logIndex = currentAgentLogs.length;
          currentAgentLogs.push({ type: 'tool_call', tool: toolName, params: args, status: 'running' });
          const walkthroughItem = summarizeToolStart(toolName, args);
          if (walkthroughItem) workWalkthrough.push(walkthroughItem);
          return { toolName, args, logIndex, walkthroughItem };
        });
        window.renderAiMessage(lastTextResponse, currentAgentLogs);

        // Fire all executeTool calls concurrently
        const batchStart = Date.now();
        const parallelResults = await Promise.all(callMeta.map(async ({ toolName, args, logIndex, walkthroughItem }) => {
          const t0 = Date.now();
          let result;
          try {
            const epistemicGate = getEpistemicToolGate(userPrompt, toolEvidenceLedger, toolName, args);
            if (!epistemicGate.allowed) {
              result = { error: epistemicGate.reason, failureCategory: 'unsupported_inference', recoveryGuidance: epistemicGate.guidance };
            } else {
              result = await executeTool(toolName, args, workspacePath, config, conversation);
            }
          } catch (err) {
            result = { error: err.message };
          }
          const elapsed = Date.now() - t0;
          return { toolName, args, result, logIndex, walkthroughItem, elapsed };
        }));

        // Sequential post-processing (state mutations, ledger, UI)
        for (const { toolName, args, result, logIndex, walkthroughItem, elapsed } of parallelResults) {
          currentAgentLogs[logIndex].status = isFailedToolResult(result) ? 'error' : 'success';
          currentAgentLogs[logIndex].result = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          currentAgentLogs[logIndex].elapsed = elapsed;
          updateWalkthroughItem(walkthroughItem, toolName, args, result, isFailedToolResult(result) ? new Error(getToolFailureSignal(result) || 'error') : null);
          toolEvidenceLedger.push(buildToolEvidenceEntry(toolName, args, result));
          recordContextAcquisitionToolResult(contextAcquisitionLedger, toolName, args, result);
          rememberContextPacketForConversation(conversation, workspacePath, toolName, result);

          // read_file state tracking
          if (toolName === 'read_file' && args.path && !isFailedToolResult(result)) {
            const readKey = String(args.path).toLowerCase();
            filesSeenThisRun.add(readKey);
            const wasBlocked = fileNeedsReadBeforeEdit.has(readKey);
            fileNeedsReadBeforeEdit.delete(readKey);
            if (wasBlocked && typeof result === 'object' && !Array.isArray(result)) {
              result.editRetryReminder = `You previously had an edit to ${args.path} blocked until you re-read it. Retry the edit now.`;
            }
            const isFullRead = !(Number.isInteger(parseInt(args.startLine, 10)) && Number.isInteger(parseInt(args.endLine, 10)));
            if (isFullRead) {
              if (filesFullyReadUnchanged.has(readKey) && typeof result === 'object' && !Array.isArray(result)) {
                result.redundantReadNote = `You already read ${args.path} earlier this run and it hasn't changed.`;
              }
              filesFullyReadUnchanged.add(readKey);
              // File-knowledge ledger: stamp "the agent has seen this exact content version"
              // (hash+mtime) so future runs can skip re-reading unchanged files. Fire-and-forget —
              // ledger bookkeeping must never slow down or fail a read.
              if (workspacePath && window.api && typeof window.api.recordFileRead === 'function') {
                window.api.recordFileRead(workspacePath, args.path).catch(() => {});
              }
            }
          }
          if ((toolName === 'read_multiple_files' || toolName === 'read_multiple_ranges' || toolName === 'inspect_code_context') && !isFailedToolResult(result)) {
            for (const section of getContextSectionsFromToolResult(toolName, args, result)) {
              const readKey = String(section.path || '').toLowerCase();
              if (readKey) {
                filesSeenThisRun.add(readKey);
                fileNeedsReadBeforeEdit.delete(readKey);
              }
            }
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
        }

        const batchElapsed = Date.now() - batchStart;
        currentAgentLogs.push({ type: 'thought', content: `⚡ Parallel batch done in ${batchElapsed}ms (vs ~${parallelResults.reduce((s, r) => s + r.elapsed, 0)}ms sequential)` });
        persistCurrentAgentLogs({ render: true });

      } else {
      // ── Sequential execution (default) ───────────────────────────────────────
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
          strategyStatus = await readStrategyStatus(workspacePath, conversation);
        }
        // Track when discover_skills is called so the create_skill gate knows it's been done
        if (toolName === 'discover_skills') skillDiscoveryChecked = true;

        const reviewGate = reviewOnly ? getReviewOnlyToolGate(toolName, args) : { allowed: true, reason: '' };
        const planningGate = getPlanningToolGate(config, canExecuteThisTask(), toolName, args, {
          strategyStatus,
          agentExecutionMode
        });
        // Skill-discovery gate: require discover_skills before create_skill so Orion checks for
        // an existing skill first rather than recreating capabilities that already exist.
        const skillDiscoveryGate = (toolName === 'create_skill' && !skillDiscoveryChecked)
          ? { allowed: false, reason: 'Call discover_skills first to check whether a skill for this already exists, then call create_skill only if nothing suitable is found.' }
          : { allowed: true, reason: '' };
        // All gates use identical response logic — handle the first failure found
        const blockedGate = !reviewGate.allowed ? reviewGate : (!planningGate.allowed ? planningGate : (!skillDiscoveryGate.allowed ? skillDiscoveryGate : null));
        if (blockedGate) {
          const failure = classifyAgentFailure({ toolName, args, errorText: blockedGate.reason });
          const guidance = buildFailureRecoveryGuidance(failure);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = blockedGate.reason;
          toolResponseParts.push({
            functionResponse: {
              name: toolName,
              response: { error: blockedGate.reason, failureCategory: failure.category, recoveryGuidance: guidance }
            }
          });
          const transition = await recordToolOutcomeInWorkingState(workspacePath, toolName, args, { error: blockedGate.reason, failureCategory: failure.category });
          if (transition && transition.state) {
            workingState = transition.state;
            refreshWorkingStateMessage();
          }
          if (!reviewGate.allowed) {
            updateWalkthroughItem(walkthroughItem, toolName, args, { error: reviewGate.reason, failureCategory: failure.category }, new Error(reviewGate.reason));
          } else {
            updateWalkthroughItem(walkthroughItem, toolName, args, { error: planningGate.reason, failureCategory: failure.category }, new Error(planningGate.reason));
          }
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
        if (toolName === 'note_incidental_issue') {
          const result = recordIncidentalIssueCandidate(incidentalIssueBuffer, args);
          currentAgentLogs[logIndex].status = 'success';
          currentAgentLogs[logIndex].result = JSON.stringify(result, null, 2);
          updateWalkthroughItem(walkthroughItem, toolName, args, result, null);
          toolEvidenceLedger.push(buildToolEvidenceEntry(toolName, args, result));
          toolResponseParts.push({
            functionResponse: {
              name: toolName,
              response: result
            }
          });
          persistCurrentAgentLogs({ render: true });
          continue;
        }

        // Launch-only scope guard: a plain launch/run request is low-risk and read-only.
        // It does not authorize repeated source edits just because the launch failed on a
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

        // Read-before-edit gate: a surgical edit (modify_file/patch_file) to a file whose content
        // the model has not seen this run — never read it, never wrote it — is a blind edit against
        // guessed content. That is the primary way line-range/anchor edits drift and corrupt a file.
        // Require a read first. write_file is exempt (it replaces wholesale and has its own
        // allowOverwrite gate). A file already read or authored this run is fine.
        if ((toolName === 'modify_file' || toolName === 'patch_file') && args.path) {
          const editKey = String(args.path).toLowerCase();
          if (!filesSeenThisRun.has(editKey)) {
            const blockMsg = `EDIT BLOCKED: You have not read ${args.path} this session, so you would be editing content you haven't seen. Call read_file, read_multiple_ranges, or inspect_code_context for ${args.path} first (for a large file, retrieve the complete relevant function/class instead of arbitrary chunks), then make your edit against its actual current content. Editing a file blind is the top cause of corruption.`;
            currentAgentLogs[logIndex].status = 'error';
            currentAgentLogs[logIndex].result = blockMsg;
            updateWalkthroughItem(walkthroughItem, toolName, args, { error: blockMsg }, new Error(blockMsg));
            toolResponseParts.push({ functionResponse: { name: toolName, response: { error: blockMsg, blocked: 'read_before_edit' } } });
            persistCurrentAgentLogs({ render: true });
            continue;
          }
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
        const _toolStartTime = Date.now();
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
          currentAgentLogs[logIndex].elapsed = Date.now() - _toolStartTime;
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
          currentAgentLogs[logIndex].elapsed = Date.now() - _toolStartTime;
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
        if (result && Array.isArray(result.conversationEvidence)) {
          for (const item of result.conversationEvidence) {
            const evidenceId = item && item.id;
            if (item && !retrievedConversationEvidence.some(existing => existing && existing.id === evidenceId)) {
              retrievedConversationEvidence.push(item);
            }
          }
        }
        if (Array.isArray(evidenceEntry.structuredStatuses)) {
          for (const fact of evidenceEntry.structuredStatuses) {
            const signature = JSON.stringify(fact);
            if (!structuredStatusFacts.some(existing => JSON.stringify(existing) === signature)) {
              structuredStatusFacts.push(fact);
            }
          }
        }
        recordContextAcquisitionToolResult(contextAcquisitionLedger, toolName, args, result);
        rememberContextPacketForConversation(conversation, workspacePath, toolName, result);

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
          // write_file authored the file's full content, so the model has "seen" it for the
          // read-before-edit gate (it can safely modify/patch it next without a separate read).
          if (toolName === 'write_file') filesSeenThisRun.add(editKey);
          // The file's content just changed, so a subsequent re-read is legitimate (not redundant).
          filesFullyReadUnchanged.delete(editKey);
          invalidateContextAcquisitionForFile(contextAcquisitionLedger, args.path, toolName);
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
                const strongerModel = getNextModelForHighDemand(activeRunModelName);
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
          filesSeenThisRun.add(readKey); // the model has now seen this file's content — edits allowed
          const wasBlocked = fileNeedsReadBeforeEdit.has(readKey);
          fileNeedsReadBeforeEdit.delete(readKey);
          if (wasBlocked && result && typeof result === 'object' && !Array.isArray(result)) {
            result.editRetryReminder = `You previously had an edit to ${args.path} blocked until you re-read it. You have now read its current content above. Retry the edit you were making now, using this fresh content, instead of reading this file again or stopping without editing.`;
          }
          // Redundant-read guard: a FULL re-read (no startLine/endLine range) of a file already
          // fully read this run and not edited since returns bytes the model already has. We still
          // deliver the content — never hide something it might need — but flag the waste so it
          // stops re-reading the same large file and acts on what it already has.
          const isFullRead = !(Number.isInteger(parseInt(args.startLine, 10)) && Number.isInteger(parseInt(args.endLine, 10)));
          if (isFullRead) {
            if (filesFullyReadUnchanged.has(readKey) && result && typeof result === 'object' && !Array.isArray(result) && !wasBlocked) {
              result.redundantReadNote = `You already read ${args.path} earlier this run and it has not changed since — this is the same content. Re-reading files you already have (especially large ones) wastes context; rely on your earlier read and proceed to the next concrete action instead of reading this file again.`;
            }
            filesFullyReadUnchanged.add(readKey);
          }
        }
        if ((toolName === 'read_multiple_files' || toolName === 'read_multiple_ranges' || toolName === 'inspect_code_context') && !isFailedToolResult(result)) {
          for (const section of getContextSectionsFromToolResult(toolName, args, result)) {
            const readKey = String(section.path || '').toLowerCase();
            if (readKey) {
              filesSeenThisRun.add(readKey);
              fileNeedsReadBeforeEdit.delete(readKey);
            }
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
      } // end sequential else block

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
          const planText = await readImplementationPlanText(workspacePath, conversation);
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
            forceYield = true;  // prevent auto-continue from bypassing plan approval gate
            break;
          }
        }

        console.log("Plan written. Forcing yield to wait for user approval.");
        conversation.awaitingPlanApproval = true;
        const planItem = workWalkthrough.find(item => item.kind === 'plan');
        lastTextResponse = buildPlanApprovalMessage(planItem, lastTextResponse);
        forceYield = true;  // prevent auto-continue from bypassing plan approval gate
        break;
      }
      
      if (loopCount === maxLoops && !isStopRequested && !forceYield) {
        if (window.appendSystemMessage) {
          window.appendSystemMessage("Action limit reached. Checking with Supervisor...", {
            conversationId: conversation.id,
            source: 'supervisor-extension',
            dedupeKey: `supervisor-extension-${conversation.id}`,
            updateExisting: true
          });
        }
        const supervisorDecision = await evaluateLoopStateWithSupervisorDecision(
          activeRunModelName,
          workWalkthrough,
          false,
          config,
          buildContextAcquisitionReceipt(contextAcquisitionLedger)
        );
        const recommendedAction = supervisorDecision && supervisorDecision.recommendedAction ? supervisorDecision.recommendedAction : { type: 'continue' };
        const actionType = String(recommendedAction.type || '').toLowerCase();
        if (!supervisorDecision || supervisorDecision.status === 'continue') {
          maxLoops += 15;
          if (window.appendSystemMessage) {
            window.appendSystemMessage("Supervisor approved +15 turn extension.", {
              conversationId: conversation.id,
              source: 'supervisor-extension',
              dedupeKey: `supervisor-extension-${conversation.id}`,
              updateExisting: true
            });
          }
        } else if (supervisorDecision.status === 'stuck' && supervisorCorrectionAttempts < 1 && (actionType === 'consolidate_context' || actionType === 'change_tool_strategy' || actionType === 'run_verification')) {
          supervisorCorrectionAttempts += 1;
          maxLoops += 4;
          const avoidText = Array.isArray(supervisorDecision.avoid) && supervisorDecision.avoid.length
            ? ` Avoid repeating: ${supervisorDecision.avoid.join('; ')}.`
            : '';
          const targetText = recommendedAction.target ? ` Target: ${recommendedAction.target}.` : '';
          const toolText = recommendedAction.tool ? ` Prefer tool: ${recommendedAction.tool}.` : '';
          messages.push({
            role: 'user',
            parts: [{
              text: `[SYSTEM: Supervisor detected a likely loop (${supervisorDecision.pattern || 'stuck'}). Use one bounded correction attempt now.${toolText}${targetText}${avoidText} If context acquisition is fragmented, call inspect_code_context or read_multiple_ranges to retrieve the needed exact source in one bundle. Do not repeat the same failed/read action.]`
            }]
          });
          if (window.appendSystemMessage) {
            window.appendSystemMessage("Supervisor requested one bounded correction attempt.", {
              conversationId: conversation.id,
              source: 'supervisor-extension',
              dedupeKey: `supervisor-extension-${conversation.id}`,
              updateExisting: true
            });
          }
        } else {
          if (window.appendSystemMessage) {
            window.appendSystemMessage("Supervisor halted run due to looping.", {
              conversationId: conversation.id,
              source: 'supervisor-extension',
              dedupeKey: `supervisor-extension-${conversation.id}`,
              updateExisting: true
            });
          }
        }
      }
    }

    ranOutOfLoopBudget = loopCount >= maxLoops;

    // Plan approval is conversation state. A workspace-level implementation_plan.md may be an
    // artifact from another conversation or an older task, so its mere presence must not reactivate
    // approval mode for this run.
  } catch (error) {
    if (isUserStopError(error)) {
      userRequestedStop = true;
      isStopRequested = false;
      lastTextResponse = stopRequestMode === 'soft' ? "Task stopped by user after the current step." : "Task aborted by user.";
      currentAgentLogs.push({ type: 'thought', content: stopRequestMode === 'soft' ? "Stop requested by user; the run was halted cleanly." : "Task execution stopped by user." });
    } else {
      criticalRunError = error;
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

    // Smart Orion title: generate a better title after the first response
    if (isOrionMode) {
      const msgs = conversation.messages || [];
      const firstUser = msgs.find(m => m.role === 'user');
      const firstAsst = msgs.find(m => m.role === 'assistant');
      const currentTitle = conversation.title || '';
      const needsSmartTitle = firstUser && firstAsst && (currentTitle === 'New Conversation' || currentTitle === window.generateConversationTitle?.(firstUser.text || ''));
      if (needsSmartTitle) {
        generateOrionSmartTitle(conversation, firstUser.text || '', firstAsst.text || '', config).catch(() => {});
      }
    }
    // Auto-save memory insights once this conversation goes idle (silent, best-effort). Runs for
    // coder-mode conversations too — corrections made mid-coding-session are just as worth
    // remembering as ones made in Orion chat.
    scheduleOrionMemoryInactivitySave(conversation, config, workspacePath, runMode);

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
    const EDIT_OR_COMMAND_TOOLS = new Set(['write_file', 'modify_file', 'patch_file', 'run_command', 'start_command', 'run_tests', 'run_linter']);
    const hadSuccessfulEditOrCommandThisPass = (workWalkthrough || []).some(item => item && item.status !== 'error' && EDIT_OR_COMMAND_TOOLS.has(item.toolName));

    // A pass whose only file mutations were documentation (STRATEGY.md, implementation_plan.md,
    // README, etc.) was almost certainly a planning/documentation request, not a build. Auto-queuing
    // an "[ORION INTERNAL CONTINUATION]" pass after it has no memory of a "do not implement" (or
    // similar) constraint from the original prompt, so it starts writing source code unprompted.
    // Note: write_file items for plan/strategy paths carry kind 'plan'/'strategy' rather than
    // 'file' (see summarizeToolStart), so this checks toolName + path directly instead of relying
    // on isFileMutationItem's kind === 'file' filter.
    const FILE_MUTATION_TOOLS = new Set(['write_file', 'modify_file', 'patch_file']);
    const CODE_EXTENSIONS = /\.(py|js|ts|jsx|tsx|go|java|cs|cpp|c|h|rb|php|swift|kt|rs|html|css|scss|less|sh|bash|ps1|sql|yaml|yml|toml|ini|cfg|conf)$/i;
    const fileMutationsThisRun = (workWalkthrough || []).filter(item =>
      item && item.status === 'done' && FILE_MUTATION_TOOLS.has(item.toolName) && item.path);
    const wroteCodeFilesThisRun = fileMutationsThisRun.some(item => CODE_EXTENSIONS.test(String(item.path)));
    const docOnlyRun = fileMutationsThisRun.length > 0 && !wroteCodeFilesThisRun;

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
        && hasResumableWork && conversation._planExecAutoContinues < AUTO_CONTINUE_BUDGET
        && !conversation.awaitingPlanApproval && !docOnlyRun) {
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
    if (bestVisibleAnswer && looksLikeLeakedNoToolCorrection(lastTextResponse)) {
      lastTextResponse = bestVisibleAnswer;
    }
    if (OrchestrationContracts && (recallRequested || OrchestrationContracts.hasExplicitRecallClaim(lastTextResponse))) {
      const finalMemoryValidation = OrchestrationContracts.validateMemoryResponse(lastTextResponse, {
        conversationEvidence: retrievedConversationEvidence
      });
      if (!finalMemoryValidation.valid) {
        lastTextResponse = OrchestrationContracts.buildEvidenceBackedRecallFallback(retrievedConversationEvidence);
      }
    }
    if (structuredStatusFacts.length > 0 && OrchestrationContracts) {
      const finalStatusValidation = OrchestrationContracts.validateStatusResponse(lastTextResponse, structuredStatusFacts);
      if (!finalStatusValidation.valid) {
        lastTextResponse = OrchestrationContracts.enforceStatusFallback(lastTextResponse, structuredStatusFacts);
      }
    }
    // A run that exhausted its raw per-turn ceiling while thrashing on legitimate-but-circuitous
    // tool calls (e.g. repeatedly retrying broken shell escaping) and never reached a checklist —
    // so autoContinueExecution never engaged — otherwise leaves whatever stale mid-task sentence
    // was set before the thrashing began as the silent "final" answer, with the tool log the only
    // hint anything went wrong. Append an explicit, honest note so the user knows to ask Orion to
    // continue instead of assuming the task finished or is simply taking a while.
    if (ranOutOfLoopBudget && !autoContinueExecution && madeProgressThisRun &&
        !/ask me to continue/i.test(lastTextResponse)) {
      lastTextResponse += '\n\n[Note: this run hit its per-turn action limit before the task was confirmed complete — the message above may be from partway through, not a final result. Ask me to continue and I will pick up from the current state.]';
    }
    lastTextResponse = appendIncidentalObservationsToFinal(lastTextResponse, incidentalIssueBuffer, conversation, {
      autoContinueExecution,
      forceYield
    });
    lastTextResponse = withWorkWalkthrough(lastTextResponse, workWalkthrough, true, conversation);

    // Save walkthrough to file so the chat bubble stays clean
    if (workWalkthrough.length > 0 && workspacePath) {
      try {
        const walkthroughMd = buildWorkWalkthroughMarkdown(workWalkthrough, lastTextResponse);
        await writeOrionGovernanceArtifactText(workspacePath, conversation, 'work_walkthrough.md', walkthroughMd);
      } catch (_) {}
    }

    // Ensure the final text and logs are written and rendered
    conversation.messages[aiMessageIndex].text = lastTextResponse;
    conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
    if (OrchestrationContracts) {
      const projectKnowledgeTools = new Set([
        'read_file', 'read_multiple_files', 'read_multiple_ranges', 'inspect_code_context', 'list_files',
        'grep_search', 'semantic_search', 'get_symbol_index', 'read_project_memory', 'recall_memory'
      ]);
      conversation.messages[aiMessageIndex].responseBasis = OrchestrationContracts.createResponseBasis({
        conversationEvidence: retrievedConversationEvidence,
        projectKnowledge: toolEvidenceLedger.some(item => item && projectKnowledgeTools.has(item.toolName)),
        generalInference: retrievedConversationEvidence.length === 0 && !toolEvidenceLedger.some(item => item && projectKnowledgeTools.has(item.toolName)),
        structuredStatuses: structuredStatusFacts
      });
    }
    // Permanently mark the bubble that carries the plan-approval card so it can be re-rendered
    // with a persistent "Implementation started" state after approval, instead of vanishing on
    // the next reload and looking like the button was never pressed.
    if (conversation.awaitingPlanApproval && !suppressPlanApprovalCardThisTurn) {
      conversation.messages[aiMessageIndex].isPlanApprovalCard = true;
    }
    if (conversation.awaitingClarification) {
      conversation.messages[aiMessageIndex].isClarificationCard = true;
    }
    window.renderAiMessage(lastTextResponse, currentAgentLogs, conversation.id, conversation.messages[aiMessageIndex]);
    // A phone-started run can finish in a conversation that is not open on desktop. Once the
    // running flag above is cleared, the generic debounced saver no longer infers that conversation
    // as a write target. Explicitly dirty and flush the completed message before reporting success,
    // otherwise disk can retain only the earlier "Thinking..." checkpoint and reload loses the
    // answer that was visible live on the phone.
    if (typeof window.markConversationDirty === 'function') {
      window.markConversationDirty(conversation.id);
    }
    if (typeof window.flushConversationsToStorage === 'function') {
      await window.flushConversationsToStorage(conversation.id);
    } else if (window.saveConversationsToStorage) {
      window.saveConversationsToStorage();
    }
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

    if (runTaskId && typeof window.finalizeOrchestrationTask === 'function') {
      const desiredTaskState = userRequestedStop
        ? 'cancelled'
        : (criticalRunError
          ? 'failed'
          : ((autoContinueExecution || forceYield || ranOutOfLoopBudget || hasPendingWork || conversation.awaitingPlanApproval || conversation.awaitingClarification)
            ? 'pending'
            : 'completed'));
      const finalizedTask = await window.finalizeOrchestrationTask(runTaskId, desiredTaskState, {
        reason: userRequestedStop
          ? 'Cancelled by user.'
          : (criticalRunError ? String(criticalRunError.message || criticalRunError) : ''),
        summary: String(lastTextResponse || '').replace(/\s+/g, ' ').slice(0, 1000),
        conversationId: conversation.id,
        pendingWork: !!hasPendingWork,
        awaitingUser: !!(forceYield || conversation.awaitingPlanApproval || conversation.awaitingClarification),
        expectedExecutionId: runTaskExecutionId
      });
      finalizedTaskState = finalizedTask && finalizedTask.status ? finalizedTask.status : desiredTaskState;
    }
    
    // Clear the active bubble tracking ONLY after the final render has updated it (removing the spinner)
    window.clearActiveAiBubble();

    // Notify phone companion whenever the agent stops — different messages by exit reason
    if (window.api && typeof window.api.notifyPhone === 'function') {
      let notifBody;
      if (userRequestedStop) {
        notifBody = 'Agent stopped.';
      } else if (autoContinueExecution) {
        // Mid-plan continuation queued — skip, phone will get notified when it truly finishes
        notifBody = null;
      } else if (ranOutOfLoopBudget) {
        notifBody = 'Hit action limit — ask Orion to continue.';
      } else if (forceYield) {
        notifBody = 'Paused — needs your input.';
      } else {
        const shortResponse = String(lastTextResponse || '').replace(/\s+/g, ' ').slice(0, 120);
        notifBody = shortResponse || 'Task complete';
      }
      if (notifBody) {
        window.api.notifyPhone('Orion AI', notifBody).catch(() => {});
      }
    }

    window.saveConversationsToStorage();
    if (window.renderConversationList) window.renderConversationList();
    if (window.renderProjectsList) window.renderProjectsList();
  }

  if (activeRunTaskId === runTaskId) activeRunTaskId = null;
  
  // If the run stopped mid-plan with real progress and pending work, queue an internal
  // continuation so a multi-phase build keeps going instead of falsely ending. Real user
  // queue items take priority, so only enqueue when nothing else is waiting.
  if (autoContinueExecution && window.promptQueue && window.promptQueue.length === 0 && !conversation.awaitingPlanApproval) {
    window.promptQueue.push({
      prompt: '[ORION INTERNAL CONTINUATION - not a user message] The approved plan is still in progress. Continue executing the remaining checklist items and subplan steps now: write and edit the actual source files for the next pending tasks, then verify. Do not restate the plan or stop until the work is genuinely complete or you hit a real blocker. Do not quote this as something the user said.',
      modelSelectValue: modelName,
      conversationId: conversation.id,
      taskId: activeRunTaskId || '',
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
          // Quote only a preview of the prompt — the full text is already the next user bubble,
          // and repeating a multi-paragraph prompt inside a system chip doubles the wall of text.
          const queuedPromptPreview = String(nextTask.prompt || '').replace(/\s+/g, ' ').trim();
          const queueLabel = nextTask.source === 'followup'
            ? 'Executing scheduled follow-up.'
            : (nextTask.source === 'plan-approval' ? 'Continuing approved plan.' : `Executing queued prompt: "${queuedPromptPreview.length > 140 ? queuedPromptPreview.slice(0, 140).trimEnd() + '…' : queuedPromptPreview}"`);
          
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
            internalPrompt: isInternalQueueItem,
            taskId: nextTask.taskId || ''
          });
        }
      }
    }
  }, 500);
};

function scheduleSkippedQueueRecovery(delayMs = 0) {
  setTimeout(async () => {
    if (isAgentRunning || !Array.isArray(window.promptQueue) || window.promptQueue.length === 0) return;
    const nextTask = window.promptQueue.shift();
    const targetId = nextTask && (nextTask.conversationId || (window.getActiveConversationId && window.getActiveConversationId()));
    if (!targetId || typeof conversations === 'undefined') return;
    const targetConversation = conversations.find(item => item.id === targetId);
    if (!targetConversation) return;
    const internal = ['followup', 'plan-approval', 'system'].includes(nextTask.source);
    await window.runAgentLoop(nextTask.prompt, nextTask.modelSelectValue, targetConversation, {
      source: nextTask.source || 'queue',
      internalPrompt: internal,
      taskId: nextTask.taskId || ''
    });
  }, Math.max(0, Number(delayMs) || 0));
}

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
      const resolution = WorkspaceResolution ? WorkspaceResolution.classifyWorkspace({
        mode: conversation.mode === 'coder' ? 'coder' : 'orion',
        workspacePath: workspace,
        projectPath: conversation.projectPath,
        dispatchProjectPath: conversation.dispatchProjectPath,
        searchRoot: getDispatchWorkspaceRoot(),
        knownProjects: getKnownWorkspaceCandidates(conversation)
      }) : null;
      return {
        success: true,
        workspace,
        workspaceKind: resolution ? resolution.kind : (conversation.projectPath ? 'active_project' : 'unresolved'),
        workspaceDescription: resolution ? WorkspaceResolution.describeWorkspace(resolution) : '',
        conversationId: conversation.id,
        title: conversation.title,
        projectPath: (resolution && resolution.projectPath) || conversation.projectPath || conversation.dispatchProjectPath || '',
        scope: resolution ? resolution.kind : (conversation.projectPath ? 'active_project' : 'standalone_coder'),
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

    case 'grep_search': {
      if (!args.pattern) throw new Error("Missing 'pattern' parameter");
      const result = await window.api.grepSearch(workspace, args.pattern, {
        regex: !!args.regex,
        caseSensitive: !!args.caseSensitive,
        filePattern: args.filePattern,
        maxResults: Number.isFinite(Number(args.maxResults)) ? Number(args.maxResults) : 100,
        contextLines: Number.isFinite(Number(args.contextLines)) ? Number(args.contextLines) : 0
      });
      if (!result || result.success === false) throw new Error((result && result.error) || 'grep_search failed');
      return result;
    }

    case 'fetch_page': {
      if (!args.url) throw new Error("Missing 'url' parameter");
      const result = await window.api.fetchWebPage(args.url);
      if (result.error) throw new Error(result.error);
      return { content: result.content || result.success || result };
    }

    case 'git_diff': {
      const result = await window.api.gitDiff(workspace, args.path);
      if (!result.success) throw new Error(result.error || 'Failed to get git diff');
      return { diff: result.stdout || '(no differences)' };
    }

    case 'git_rollback': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const result = await window.api.gitRollback(workspace, args.path);
      if (!result.success) throw new Error(result.error || 'Failed to roll back file');
      return { success: true, message: `Rolled back ${args.path}` };
    }

    case 'edit_config': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (!args.updates) throw new Error("Missing 'updates' parameter");
      const result = await window.api.editConfig(workspace, args.path, args.updates);
      if (!result.success) throw new Error(result.error || 'Failed to edit config');
      return { success: true, message: `Updated config at ${args.path}` };
    }

    case 'get_file_symbols': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const result = await window.api.getFileSymbols(workspace, args.path);
      if (!result.success) throw new Error(result.error || 'Failed to extract file symbols');
      return result.symbols;
    }

    case 'fetch_api_docs': {
      if (!args.library_name || !args.version || !args.url) throw new Error("Missing parameters for fetch_api_docs");
      if (typeof window.api.fetchApiDocs !== 'function') throw new Error("fetchApiDocs IPC not available");
      const result = await window.api.fetchApiDocs({ libraryName: args.library_name, version: args.version, url: args.url });
      if (!result.success) throw new Error(result.error || 'Failed to fetch API docs');
      return result;
    }

    case 'search_api_docs': {
      if (!args.library_name || !args.version || !args.query) throw new Error("Missing parameters for search_api_docs");
      if (typeof window.api.searchApiDocs !== 'function') throw new Error("searchApiDocs IPC not available");
      const result = await window.api.searchApiDocs({ libraryName: args.library_name, version: args.version, query: args.query, config });
      if (!result.success) throw new Error(result.error || 'Failed to search API docs');
      return result.results;
    }

    case 'semantic_search': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const result = await window.api.semanticSearch(args.query, workspace, config, 10);
      if (!result.success) throw new Error(result.error || 'Semantic search failed');
      return result.results;
    }

    case 'read_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const readMaxChars = resolveAgentReadMaxChars(
        args.maxChars,
        config.activeRunModelName || config.modelName,
        config
      );
      const content = isOrionGovernanceArtifactPath(args.path)
        ? await readOrionGovernanceArtifactText(workspace, conversation, args.path, {
          startLine: args.startLine,
          endLine: args.endLine,
          maxChars: readMaxChars
        })
        : await window.api.readFile(workspace, args.path, {
        startLine: args.startLine,
        endLine: args.endLine,
        maxChars: readMaxChars
      });
      if (content.error) throw new Error(content.error);
      return { content: content };
    }
    
    case 'read_multiple_files': {
      if (!args.paths || !Array.isArray(args.paths)) throw new Error("Missing 'paths' array parameter");
      const paths = args.paths.map(String).filter(Boolean).slice(0, 50);
      const totalReadBudget = getAgentReadCharBudget(config.activeRunModelName || config.modelName, config);
      const perFileMaxChars = Math.max(1000, Math.floor(totalReadBudget / Math.max(1, paths.length)));

      const readPromises = paths.map(async (path) => {
        const content = isOrionGovernanceArtifactPath(path)
          ? await readOrionGovernanceArtifactText(workspace, conversation, path, { maxChars: perFileMaxChars }).catch(e => ({ error: e.message }))
          : await window.api.readFile(workspace, path, { maxChars: perFileMaxChars }).catch(e => ({ error: e.message }));
        if (content && content.error) throw new Error(`Error reading ${path}: ${content.error}`);
        return `\n\n--- File: ${path} ---\n${content}`;
      });

      const results = await Promise.all(readPromises);
      const omittedNote = args.paths.length > paths.length
        ? `\n\n[Orion] ${args.paths.length - paths.length} additional files were omitted. Narrow the file set or use inspect_code_context so the most relevant source fits in one context packet.`
        : '';
      return { content: results.join("") + omittedNote };
    }

    case 'read_multiple_ranges': {
      if (!Array.isArray(args.files)) throw new Error("Missing 'files' array parameter");
      if (typeof window.api.readMultipleRanges !== 'function') throw new Error('readMultipleRanges IPC not available');
      const result = await window.api.readMultipleRanges(workspace, args.files, {
        maxChars: Number.isFinite(Number(args.maxChars)) ? Number(args.maxChars) : 500000
      });
      if (!result || result.success === false) throw new Error((result && result.error) || 'read_multiple_ranges failed');
      return result;
    }

    case 'inspect_code_context': {
      if (!args.query && !Array.isArray(args.symbols) && !Array.isArray(args.paths)) {
        throw new Error("inspect_code_context needs a query, symbols, or paths");
      }
      if (typeof window.api.inspectCodeContext !== 'function') throw new Error('inspectCodeContext IPC not available');
      const result = await window.api.inspectCodeContext(workspace, {
        query: args.query || '',
        paths: Array.isArray(args.paths) ? args.paths : [],
        symbols: Array.isArray(args.symbols) ? args.symbols : [],
        include: Array.isArray(args.include) ? args.include : undefined,
        budgetTokens: Number.isFinite(Number(args.budgetTokens)) ? Number(args.budgetTokens) : undefined,
        contextLines: Number.isFinite(Number(args.contextLines)) ? Number(args.contextLines) : undefined,
        expand: args.expand === true,
        conversationId: conversation && conversation.id ? conversation.id : '',
        runId: conversation && conversation._activeContextRunId ? conversation._activeContextRunId : ''
      });
      if (!result || result.success === false) throw new Error((result && result.error) || 'inspect_code_context failed');
      return result;
    }
    
    case 'write_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (args.content === undefined) throw new Error("Missing 'content' parameter");
      const isPlanFile = isImplementationPlanPath(args.path);
      const isStrategyFile = isStrategyPath(args.path);
      const isGovernanceArtifact = isOrionGovernanceArtifactPath(args.path);
      const existingContent = isGovernanceArtifact
        ? await readOrionGovernanceArtifactText(workspace, conversation, args.path, { maxChars: 200000 }).catch(error => ({ error: error.message }))
        : await window.api.readFile(workspace, args.path, { maxChars: 200000 });
      if (!isGovernanceArtifact && !isPlanFile && !isStrategyFile && existingContent && !existingContent.error && args.allowOverwrite !== true) {
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
      
      const writeRes = isGovernanceArtifact
        ? await writeOrionGovernanceArtifactText(workspace, conversation, args.path, args.content)
        : await window.api.writeFile(workspace, args.path, args.content);
      if (writeRes.error) throw new Error(writeRes.error);
      
      // Refresh directory UI
      if (!isGovernanceArtifact && window.syncWorkspaceFiles) window.syncWorkspaceFiles();
      
      let testFeedback = "";
      if (!isGovernanceArtifact) {
        const writeSyntaxCheck = await checkJsSyntaxAfterEdit(workspace, args.path);
        if (!writeSyntaxCheck.ok) {
          testFeedback += `\n[WARNING] SYNTAX ERROR DETECTED: node --check failed for ${args.path}:\n${writeSyntaxCheck.error}`;
        }
      }
      if (config.autoTest) {
        const testRes = await window.runRegressionTests();
        if (beforePass && !testRes.success) {
          testFeedback += "\n[WARNING] REGRESSION DETECTED: Regression tests failed after this write. Please review your modifications.";
        }
      }
      const missingHtmlRefs = isGovernanceArtifact ? [] : await findMissingHtmlLocalReferences(workspace, args.path, args.content);
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
      if (fileData.indexOf(args.target, index + args.target.length) !== -1) {
        throw new Error(`Target content block is not unique in file: ${args.path}. Provide a larger exact target, or use patch_file replace_range only after re-reading the current line numbers.`);
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
      if (conversation.mode === 'coder') {
        conversation.projectPath = targetPath;
      } else if (conversation.mode === 'orion' && window.getKnownProjects) {
        const normalizedTarget = String(targetPath).replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase();
        const knownProject = (window.getKnownProjects() || []).find(projectPath =>
          String(projectPath || '').replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase() === normalizedTarget
        );
        if (knownProject) conversation.dispatchProjectPath = knownProject;
      }
      if (typeof window.changeActiveWorkspace === 'function') {
        window.changeActiveWorkspace(targetPath, {
          conversationId: conversation.id,
          promoteProject: conversation.mode === 'coder'
        });
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

    case 'handoff_to_coder': {
      const requestedPath = String(args.path || workspace || conversation.workspace || '').trim();
      if (!requestedPath) throw new Error("Missing workspace path to hand off to Coder");
      const resolution = await resolveWorkspacePathForChange(requestedPath);
      if (!resolution.success) {
        throw new Error(`Coder handoff path "${resolution.path}" is invalid or does not exist: ${resolution.error}`);
      }
      if (typeof window.promoteWorkspaceToCoder !== 'function') {
        throw new Error('Coder handoff is not available in this Orion build.');
      }
      let handoffWorkspace = WorkspaceResolution ? WorkspaceResolution.classifyWorkspace({
        mode: 'orion',
        workspacePath: resolution.path,
        dispatchProjectPath: conversation.dispatchProjectPath,
        searchRoot: getDispatchWorkspaceRoot(),
        knownProjects: getKnownWorkspaceCandidates(conversation)
      }) : { kind: 'active_project', path: resolution.path };
      if (WorkspaceResolution && handoffWorkspace.kind === WorkspaceResolution.KINDS.UNRESOLVED
          && !WorkspaceResolution.samePath(resolution.path, getDispatchWorkspaceRoot())) {
        handoffWorkspace = WorkspaceResolution.bindResolvedProject(handoffWorkspace, {
          path: resolution.path,
          name: resolution.matchedName || getLocalPathBaseName(resolution.path),
          source: args.path ? 'explicit_verified_handoff_path' : 'resolved_conversation_workspace'
        });
      }
      const handoffPermission = WorkspaceResolution ? WorkspaceResolution.canHandoffWorkspace(handoffWorkspace) : { allowed: true };
      if (!handoffPermission.allowed) {
        throw new Error(handoffPermission.reason || 'Resolve a concrete project workspace before handing work to Coder.');
      }
      const prompt = String(args.prompt || '').trim();
      const contextPacketIds = getHandoffContextPacketIds(conversation, resolution.path);
      const result = await window.promoteWorkspaceToCoder({
        path: resolution.path,
        prompt,
        title: args.title || '',
        open: args.open === true,
        sourceConversationId: conversation.id,
        sourceSessionId: conversation.sessionId || conversation.id,
        sourceMessageId: (conversation.messages || []).slice().reverse().find(message => message.role === 'user')?.id || '',
        contextPacketIds,
        findings: Array.isArray(args.findings) ? args.findings : []
      });
      if (!result || result.success === false) {
        throw new Error((result && result.error) || 'Coder handoff failed.');
      }

      // ── Supervisor: track the launched Coder conversation ──────────────────
      conversation.launchedCoderConvId = result.conversationId;
      conversation.launchedCoderTaskId = result.taskId || '';
      conversation.lastOwnedTaskId = result.taskId || conversation.lastOwnedTaskId || '';
      conversation.launchedCoderTaskTitle = result.title || 'Coder Task';
      conversation.launchedCoderTaskStart = Date.now();
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      // Kick off the supervisor monitor in the renderer
      if (typeof window.startCoderTaskMonitor === 'function') {
        window.startCoderTaskMonitor(conversation.id, result.conversationId);
      }
      // ───────────────────────────────────────────────────────────────────────

      return {
        ...result,
        success: true,
        message: prompt
          ? `Promoted ${resolution.path} to Coder and queued task ${result.taskId || '(pending ID)'} with state ${result.status || 'pending'}.${result.contextTransferred ? ` Transferred ${result.contextPacketIds.length} validated context packet(s).` : ''}`
          : `Promoted ${resolution.path} to Coder as a project.`,
        fuzzyResolved: !!resolution.fuzzyResolved,
        resolvedFrom: resolution.resolvedFrom,
        matchedName: resolution.matchedName || getLocalPathBaseName(resolution.path)
      };
    }

    case 'get_coder_task_status': {
      const taskId = String(args.taskId || conversation.launchedCoderTaskId || conversation.lastOwnedTaskId || '').trim();
      if (!taskId) throw new Error('No task ID is associated with this Dispatch conversation.');
      if (typeof window.getOrchestrationTaskStatus !== 'function') throw new Error('Task status service is unavailable.');
      const result = await window.getOrchestrationTaskStatus(taskId, conversation.id);
      if (!result || result.success === false) throw new Error((result && result.error) || 'Task status lookup failed.');
      return {
        success: true,
        taskId: result.taskId,
        status: result.status,
        description: result.description,
        workspacePath: result.task && result.task.workspacePath,
        targetConversationId: result.task && result.task.target && result.task.target.conversationId
      };
    }

    case 'cancel_coder_task': {
      const taskId = String(args.taskId || conversation.launchedCoderTaskId || conversation.lastOwnedTaskId || '').trim();
      if (!taskId) throw new Error('No task ID is associated with this Dispatch conversation.');
      if (typeof window.cancelOwnedOrchestrationTask !== 'function') throw new Error('Task cancellation service is unavailable.');
      const result = await window.cancelOwnedOrchestrationTask(taskId, conversation.id, args.reason || 'Cancelled at the user\'s request.');
      if (!result || result.success === false) throw new Error((result && result.error) || 'Task cancellation failed.');
      return {
        success: true,
        taskId,
        status: result.task.status,
        stoppedActiveRun: !!result.stopped,
        message: result.task.status === 'cancelled'
          ? `Task ${taskId} is cancelled. It will not be reported as completed.`
          : `Cancellation requested for task ${taskId}.`
      };
    }

    case 'update_scratchpad': {
      if (!args.content && args.content !== '') throw new Error("Missing 'content' parameter");
      conversation.scratchpad = args.content;
      if (typeof window.updateScratchpadUI === 'function') {
        window.updateScratchpadUI(conversation.scratchpad);
      }
      return { success: true, message: "Scratchpad updated successfully." };
    }

    case 'terminal_exec': {
      if (!args.command) throw new Error("Missing 'command' parameter");
      const teCmd = String(args.command).trim();
      const teSessionId = String(args.sessionId || 'default');
      const teReset = !!args.resetSession;

      // Lazy-init the session store on the window object so it persists across tool calls
      if (!window.orionTerminalSessions) window.orionTerminalSessions = {};
      if (teReset || !window.orionTerminalSessions[teSessionId]) {
        window.orionTerminalSessions[teSessionId] = { cwd: workspace || null };
      }
      const teSession = window.orionTerminalSessions[teSessionId];

      // Build a wrapped command that reapplies the tracked directory and captures the next cwd.
      // Each call is a fresh shell process, so environment/activation state is intentionally not claimed.
      const teCdLine = teSession.cwd ? `Set-Location ${JSON.stringify(teSession.cwd)}` : '';
      const teWrapped = [
        teCdLine,
        teCmd,
        `$_te_exit = if ($? -and $LASTEXITCODE -ne $null) { $LASTEXITCODE } else { if ($?) { 0 } else { 1 } }`,
        `Write-Output "::ORION_CWD::$(Get-Location)"`,
        `exit $_te_exit`
      ].filter(Boolean).join('; ');

      const teProcessId = `terminal_${teSessionId}_${conversation.id}_${Date.now()}`;
      const teTimeout = args.timeoutMs || 60000;
      let teStdout = '', teStderr = '';
      const teClean = typeof window.api.onCommandOutput === 'function'
        ? window.api.onCommandOutput(teProcessId, (data) => {
            if (data.type === 'stderr') teStderr += data.text;
            else teStdout += data.text;
          })
        : () => {};
      const teResult = await window.api.runCommand(teWrapped, null, teProcessId, teTimeout);
      teClean();

      // Parse the cwd sentinel and update tracked session state
      const teRawStdout = teStdout || teResult.stdout || '';
      const teCwdMatch = teRawStdout.match(/::ORION_CWD::(.+?)(\r?\n|$)/);
      if (teCwdMatch) {
        teSession.cwd = teCwdMatch[1].trim();
      }
      const teCleanStdout = teRawStdout.replace(/::ORION_CWD::.+(\r?\n)?/, '').slice(0, 16000);

      return {
        sessionId: teSessionId,
        command: teCmd,
        exitCode: teResult.code,
        stdout: teCleanStdout,
        stderr: (teStderr || teResult.stderr || '').slice(0, 4000),
        cwd: teSession.cwd,
        timedOut: !!teResult.timedOut
      };
    }

    case 'db_query': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const result = await window.api.runDatabaseQuery({
        query: String(args.query).trim(),
        dbPath: args.dbPath ? String(args.dbPath).trim() : undefined,
        connectionString: args.connectionString ? String(args.connectionString).trim() : undefined,
        dbType: args.dbType ? String(args.dbType).trim() : undefined,
        timeoutMs: args.timeoutMs,
        workspacePath: workspace
      });
      if (!result || !result.success) return result || { success: false, error: 'Database query failed.' };
      return result;
    }

    case 'inspect_environment': {
      if (!args.command) throw new Error("Missing 'command' parameter");
      const ieCmd = String(args.command).trim();

      // Safety filter: block write/mutating/destructive operations
      const INSPECT_ENV_BLOCKED = [
        /\bpip\s+install\b/i, /\bnpm\s+install\b/i, /\byarn\s+add\b/i, /\bpnpm\s+add\b/i,
        /\bnpm\s+(start|run|build|publish|ci)\b/i,
        /\bpython\s+-m\s+(http\.server|flask|uvicorn|gunicorn|django)/i,
        /\bnode\s+(server|app|index)\b/i,
        /\b(rm|del|rmdir|rd|Remove-Item)\b/i,
        /\b(cp|copy|mv|move|xcopy|robocopy|Move-Item|Copy-Item)\b/i,
        /\b(mkdir|md|New-Item)\b/i,
        /\b(chmod|chown|icacls|Set-Acl)\b/i,
        /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\s.*(-o\b|-O\b|--output)/i,
        /\b(git\s+(push|pull|clone|checkout|reset|rebase|merge|commit|add|rm))\b/i,
        />{1,2}/, // output redirection to files
        /\|\s*(tee|Out-File|Set-Content|Add-Content)\b/i,
        /\b(sudo|runas)\b/i,
        /\b(reboot|shutdown|poweroff|halt)\b/i,
        /\b(reg\s+(add|delete|import|export|copy))\b/i,
        /\bSet-ItemProperty\b/i,
        /\bNew-ItemProperty\b/i,
      ];
      const blocked = INSPECT_ENV_BLOCKED.find(re => re.test(ieCmd));
      if (blocked) {
        return {
          success: false,
          error: `Command blocked: inspect_environment only allows read-only introspection commands. Blocked pattern: ${blocked}. Use handoff_to_coder for write operations or server starts.`,
          command: ieCmd
        };
      }

      const ieWorkspace = args.workspacePath || workspace || null;
      const ieProcessId = `inspect_${conversation.id}_${Date.now()}`;
      const ieTimeout = 15000; // 15s max for introspection
      let ieStdout = '', ieStderr = '';
      const ieClean = typeof window.api.onCommandOutput === 'function'
        ? window.api.onCommandOutput(ieProcessId, (data) => {
            if (data.type === 'stderr') ieStderr += data.text;
            else ieStdout += data.text;
          })
        : () => {};
      const ieResult = await window.api.runCommand(ieCmd, ieWorkspace, ieProcessId, ieTimeout);
      ieClean();
      return {
        command: ieCmd,
        exitCode: ieResult.code,
        stdout: (ieStdout || ieResult.stdout || '').slice(0, 8000),
        stderr: (ieStderr || ieResult.stderr || '').slice(0, 2000),
        timedOut: !!ieResult.timedOut
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

      // The command never ran at all (e.g. it matched the destructive deny rules, or the shell
      // failed to spawn). Previously this fell through to the normal return shape with an
      // undefined exitCode and the rejection text folded into stderr — the log chip showed
      // "success" and the model kept retrying near-identical variants instead of treating it as
      // a hard policy block.
      if (result.error && result.code == null && !result.timedOut && !result.killed) {
        return {
          success: false,
          error: result.error,
          exitCode: null,
          commandNeverRan: true,
          stdout: '',
          stderr: '',
          timeoutMs: result.timeoutMs || timeoutMs
        };
      }

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
    
    case 'run_linter': {
      if (!args.linterType) throw new Error("Missing 'linterType' parameter");
      const res = await window.api.runLinter(workspace, args.linterType, args.targetPath || '.');
      if (!res.success) throw new Error(res.error || 'Failed to run linter');
      return { success: true, results: res.results };
    }
    
    case 'find_references': {
      if (!args.symbolName) throw new Error("Missing 'symbolName' parameter");
      const res = await window.api.findReferences(workspace, args.symbolName, args.targetPath || '.');
      if (!res.success) throw new Error(res.error || 'Failed to find references');
      return { success: true, results: res.results };
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
      lastBrowserPageSignature = computeBrowserPageSignature(result);
      return result;
    }

    case 'search_web': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const result = await window.api.browserSearchWeb(args.query);
      if (!result.success) throw new Error(result.error || 'Browser search failed');
      return result;
    }

    case 'click_element': {
      const before = lastBrowserPageSignature;
      const result = await window.api.browserClickElement(args.selector || '', args.text || '');
      if (!result.success) throw new Error(result.error || 'Click failed');
      const after = computeBrowserPageSignature(result);
      lastBrowserPageSignature = after;
      // A click "succeeding" only means the DOM element was found and clicked. If the page looks
      // identical afterward — same URL, title, and visible content — the click very likely did not
      // trigger the intended behavior (a common cause: the element has no event handler wired up).
      // Surface that so the model verifies the real effect instead of assuming success.
      if (before && after && before === after) {
        return {
          ...result,
          observedEffect: false,
          verificationNote: `The click succeeded (the element was found and clicked), but the page did NOT visibly change — same URL, title, and content as before the click. A successful click confirms only that a DOM element was clicked, not that it did anything. If you expected a panel to open, a navigation, new content, or a server action, it likely did not happen — a frequent cause is that the clicked element has no event handler wired up (grep_search the page's script for how similar elements bind their handlers). Verify the actual effect (take_screenshot, re-read the page text, or check server/console output) before assuming this worked.`
        };
      }
      return { ...result, observedEffect: true };
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
      const result = await window.api.takeScreenshot(workspace, args.destination || '', conversation.id);
      if (!result.success) throw new Error(result.error || 'Screenshot failed');
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
        destination: args.destination || '',
        conversationId: conversation.id
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
      return result;
    }

    case 'capture_screen': {
      const result = await window.api.captureScreen(workspace, {
        delayMs: args.delayMs,
        destination: args.destination || '',
        conversationId: conversation.id
      });
      if (!result.success) throw new Error(result.error || 'Screen capture failed');
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

    case 'remember_file_notes': {
      if (!workspace) throw new Error('No active workspace');
      if (!args.path) throw new Error("Missing 'path' parameter");
      if (!args.notes || !String(args.notes).trim()) throw new Error("Missing 'notes' parameter");
      const result = await window.api.saveFileDigest(workspace, args.path, String(args.notes).trim());
      if (!result || result.success === false) throw new Error((result && result.error) || 'Failed to save file notes');
      return { success: true, message: `Notes saved for ${args.path}, bound to its current content version. They will surface in [FILE KNOWLEDGE] on future tasks while the file is unchanged.` };
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
        const result = await window.api.appendGlobalFact(text, category, config, !!args.pinned);
        if (!result || !result.success) throw new Error((result && result.error) || 'appendGlobalFact failed');
        return { success: true, message: `Global fact stored: "${text}"` };
      } else {
        if (!workspace) throw new Error('No active workspace');
        const result = await window.api.appendProjectFact(workspace, text, category, config, !!args.pinned);
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
        const result = await window.api.appendGlobalPreference(text, config, undefined, activeConversationMode, !!args.pinned);
        if (!result || !result.success) throw new Error((result && result.error) || 'appendGlobalPreference failed');
        return { success: true, message: `Global preference stored: "${text}"` };
      } else {
        const wp = args.workspacePath || workspace;
        if (!wp) throw new Error('No active workspace');
        const result = await window.api.appendProjectPreference(wp, text, config, activeConversationMode, !!args.pinned);
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
      if (scope === 'conversation' || ((scope === 'all' || scope === 'recent') && args.query)) {
        const query = String(args.query || '').trim();
        if (!query) throw new Error("recall_memory requires 'query' for conversation evidence.");
        const resolution = WorkspaceResolution ? WorkspaceResolution.classifyWorkspace({
          mode: conversation && conversation.mode,
          workspacePath: wp,
          projectPath: conversation && (conversation.projectPath || conversation.dispatchProjectPath),
          searchRoot: getDispatchWorkspaceRoot(),
          knownProjects: getKnownWorkspaceCandidates(conversation)
        }) : { path: wp, kind: wp ? 'active_project' : 'unresolved' };
        const search = await searchConversationEvidenceForRun(conversation, query, resolution);
        output.conversationEvidence = search.evidence || [];
        output.queryTerms = search.queryTerms || [];
        output.responseBasis = OrchestrationContracts
          ? OrchestrationContracts.createResponseBasis({ conversationEvidence: output.conversationEvidence })
          : { conversationEvidence: output.conversationEvidence.length > 0 };
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
      if (previousTask.status === 'pending' && task.status === 'in-progress') {
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
  // OperationalContext.applyAction already enforces the real evidence gate per-condition (a
  // condition cannot be marked 'satisfied' without a concrete evidence entry) — that is the
  // legitimate check. This function used to ALSO run the broader, stricter evaluateCompletionGate
  // (checklist items, blockers, verification-evidence text matching, mission statement) whenever
  // every win condition would end up satisfied, and if that separate, unrelated check wasn't happy
  // it threw before ever writing state — silently discarding the model's evidenced win-condition
  // satisfaction entirely. That meant a genuinely-completed condition (e.g. a screenshot proving a
  // UI fix worked) never got persisted, winPending stayed true forever, and the run kept
  // auto-continuing even after the user-visible task was truly done. Persist the state
  // unconditionally now; the broader gate is only used to attach informational feedback about
  // what else (if anything) is needed before the whole mission can be considered finished.
  const writeResult = await window.api.writeFile(workspace, OPERATIONAL_CONTEXT_PATH, `${JSON.stringify(transition.state, null, 2)}\n`);
  if (writeResult && writeResult.error) throw new Error(writeResult.error);
  await appendOperationalJournal(workspace, transition.event, transition.state.revision);
  if (window.updateOperationalContext) window.updateOperationalContext(transition.state);
  let completionGateInfo = null;
  if (action === 'evaluate_win_conditions' && transition.state.winConditions.length > 0 && transition.state.winConditions.every(condition => condition.status === 'satisfied') && agentExecutionMode !== 'direct' && agentExecutionMode !== 'answer') {
    const completionGate = OperationalContext.evaluateCompletionGate(transition.state, { explicitRequirements: [] });
    if (completionGate.status !== 'ready_for_final') {
      completionGateInfo = `All win conditions are now satisfied, but the mission is not yet ready to finish: ${buildCompletionGateMessage(completionGate)}`;
    }
  }
  return { success: true, action, event: transition.event, state: transition.state, path: OPERATIONAL_CONTEXT_PATH, completionGateInfo };
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

function buildCompletionGateLoopSignature(gate) {
  const normalized = gate && typeof gate === 'object' ? gate : {};
  return JSON.stringify({
    status: normalized.status || '',
    reasons: normalized.reasons || [],
    missingEvidence: normalized.missingEvidence || [],
    pendingWinConditions: (normalized.pendingWinConditions || []).map(item => ({
      title: item && item.title || '',
      status: item && item.status || ''
    })),
    pendingRequirements: (normalized.pendingRequirements || []).map(item => ({
      title: item && item.title || '',
      status: item && item.status || ''
    })),
    blockers: (normalized.blockers || []).map(item => ({
      title: item && item.title || '',
      severity: item && item.severity || '',
      nature: item && item.nature || ''
    }))
  });
}

function shouldEscapeRepeatedCompletionGateBlock({ gate, signature, previousSignature, fileMutationCount, previousFileMutationCount }) {
  return !!(gate && gate.status === 'continue_work' &&
    signature &&
    previousSignature &&
    signature === previousSignature &&
    Number(fileMutationCount) === Number(previousFileMutationCount));
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
  // Fallback used only when the strategy itself never named concrete evidence bullets. The old
  // text ("Evidence satisfies strategy objective: {mission}") was circular — it named no concrete
  // check, so it could never be honestly marked satisfied and a run could loop forever even after
  // the real objective was verifiably done. Name an actual verification artifact instead so a
  // screenshot, test run, or manual check has something concrete to attach as evidence.
  const winConditions = evidenceLines.length
    ? evidenceLines.map(line => ({ title: line, status: 'pending', evidence: [] }))
    : [{ title: `A concrete check (test run, screenshot, or manual verification) confirms: ${mission}`, status: 'pending', evidence: [] }];
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
    if (toolName === 'note_incidental_issue') {
      parts.push(result.recorded ? `recorded=${result.issue && result.issue.file ? result.issue.file : 'candidate'}` : `rejected=${result.reason || 'threshold not met'}`);
    }
    if ((toolName === 'read_multiple_ranges' || toolName === 'inspect_code_context') && result.metrics) {
      parts.push(`sections=${result.metrics.sectionCount || 0}`);
      parts.push(`estimatedTokens=${result.metrics.estimatedTokens || 0}`);
    }
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

function getAgentReadCharBudget(modelName, config = {}) {
  const thresholdTokens = getCompactionThreshold(modelName || '', config) || 100000;
  return Math.max(60000, Math.min(500000, Math.floor(thresholdTokens * 4 * 0.35)));
}

function resolveAgentReadMaxChars(requestedMaxChars, modelName, config = {}) {
  const safeLimit = getAgentReadCharBudget(modelName, config);
  const requested = parseInt(requestedMaxChars, 10);
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, safeLimit)
    : safeLimit;
}

function persistCompactedConversation(conversation, summary) {
  // Capture backup state before destructive overwrite
  conversation.compactionHistory = conversation.compactionHistory || [];
  conversation.compactionHistory.push({
    timestamp: Date.now(),
    summary,
    messages: [...conversation.messages]
  });

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
  const targetConversationId = runningConversationId || ((typeof activeConversationId !== 'undefined') ? activeConversationId : null);
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
    
    if (typeof conversations === 'undefined') return;
    const targetConv = conversations.find(c => c.id === targetConversationId);
    if (!targetConv) return;
    if (typeof window.enqueueOrchestrationTask !== 'function') return;
    const queued = await window.enqueueOrchestrationTask({
      prompt,
      resolvedObjective: prompt,
      title: `Scheduled follow-up: ${purpose}`,
      modelSelectValue,
      targetConversationId,
      originConversationId: targetConversationId,
      source: 'followup',
      alreadyRendered: true
    });
    if (!queued || !queued.success) return;
    if (window.isAgentRunning && window.isAgentRunning()) return;
    window.promptQueue = (window.promptQueue || []).filter(item => item && item.taskId !== queued.task.taskId);
    
    if (window.appendSystemMessage) {
      window.appendSystemMessage(`Scheduled follow-up running after ${delaySeconds} seconds.`, { conversationId: targetConversationId });
    }
    await window.runAgentLoop(
      prompt,
      modelSelectValue || (window.getSelectedModel ? window.getSelectedModel() : 'gemini-2.5-flash-lite'),
      targetConv,
      { source: 'followup', internalPrompt: true, taskId: queued.task.taskId }
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

function isWorkWalkthroughPath(pathValue) {
  return normalizeInventoryPath(pathValue).toLowerCase() === 'work_walkthrough.md';
}

function isOrionGovernanceArtifactPath(pathValue) {
  return isImplementationPlanPath(pathValue) || isStrategyPath(pathValue) || isWorkWalkthroughPath(pathValue);
}

function applyTextReadOptions(content, options = {}, label = 'Artifact') {
  const text = String(content || '');
  const startLine = parseInt(options.startLine, 10);
  const endLine = parseInt(options.endLine, 10);
  if (Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine) {
    const lines = text.split(/\r?\n/);
    return lines.slice(startLine - 1, endLine).map((line, index) => `${startLine + index}: ${line}`).join('\n');
  }
  const maxChars = parseInt(options.maxChars, 10);
  if (Number.isInteger(maxChars) && maxChars > 0 && text.length > maxChars) {
    return text.slice(0, maxChars) + `\n\n[Orion] ${label} truncated at ${maxChars} characters. Use startLine/endLine to inspect targeted sections.`;
  }
  return text;
}

async function readOrionGovernanceArtifactText(workspacePath, conversation, relativePath, options = {}) {
  if (conversation && conversation.id && window.api && typeof window.api.readConversationArtifact === 'function') {
    const artifact = await window.api.readConversationArtifact(conversation.id, relativePath, options || {});
    if (artifact && artifact.success) return applyTextReadOptions(artifact.content || '', options, 'Conversation artifact');
  }
  const result = await window.api.readFile(workspacePath, relativePath, options || {});
  if (typeof result === 'string') return result;
  if (result && !result.error && typeof result.content === 'string') return result.content;
  throw new Error((result && result.error) || 'Artifact does not exist');
}

async function writeOrionGovernanceArtifactText(workspacePath, conversation, relativePath, content) {
  if (conversation && conversation.id && window.api && typeof window.api.writeConversationArtifact === 'function') {
    return await window.api.writeConversationArtifact(conversation.id, relativePath, content);
  }
  return await window.api.writeFile(workspacePath, relativePath, content);
}

async function readStrategyStatus(workspacePath, conversation) {
  try {
    if (!window.api || typeof window.api.readFile !== 'function') {
      return { exists: false, valid: false, missingSections: STRATEGY_REQUIRED_SECTIONS, needsClarification: false, content: '' };
    }
    const content = await readOrionGovernanceArtifactText(workspacePath, conversation, 'STRATEGY.md', { maxChars: 120000 });
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
  const destructiveTools = ['write_file', 'modify_file', 'patch_file', 'start_command', 'run_tests', 'run_linter', 'sync_workspace_env', 'launch_workspace_app', 'preview_app', 'git_push', 'download_file', 'download_from_page', 'extract_archive', 'take_screenshot'];
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
  if (toolName === 'read_multiple_ranges') {
    const fileCount = Array.isArray(args.files) ? args.files.length : 0;
    return { toolName, status: 'running', label: `Read bundled source ranges${fileCount ? ` from ${fileCount} file(s)` : ''}` };
  }
  if (toolName === 'inspect_code_context') {
    const target = args.query || (Array.isArray(args.symbols) && args.symbols.length ? args.symbols.join(', ') : 'requested code context');
    return { toolName, status: 'running', label: `Inspected code context for \`${String(target).slice(0, 80)}\`` };
  }
  if (toolName === 'note_incidental_issue') {
    return null;
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
  if (toolName === 'run_tests') return { toolName, kind: 'test', status: 'running', label: 'Ran regression tests' };
  if (toolName === 'run_linter') return { toolName, kind: 'test', status: 'running', label: `Ran ${args.linterType || 'linter'} on ${args.targetPath || 'workspace'}` };
  if (toolName === 'find_references') return { toolName, status: 'running', label: `Found references for \`${args.symbolName || ''}\`` };
  if (toolName === 'run_command' || toolName === 'start_command') {
    return { toolName, kind: 'command', status: 'running', command: args.command, label: `${toolName === 'start_command' ? 'Started' : 'Ran'} \`${args.command || 'command'}\`` };
  }
  if (toolName === 'terminal_exec') {
    const teSession = args.sessionId ? ` [${args.sessionId}]` : '';
    return { toolName, kind: 'command', status: 'running', command: args.command, label: `Terminal${teSession}: \`${args.command || 'command'}\`` };
  }
  if (toolName === 'db_query') {
    const dbLabel = args.dbPath ? args.dbPath.split(/[\\/]/).pop() : (args.connectionString || 'database');
    return { toolName, kind: 'command', status: 'running', label: `DB query on ${dbLabel}: \`${(args.query || '').slice(0, 60)}\`` };
  }
  if (toolName === 'inspect_environment') {
    return { toolName, kind: 'command', status: 'running', command: args.command, label: `Inspected \`${args.command || 'environment'}\`` };
  }
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
  } else if (toolName === 'read_multiple_ranges' || toolName === 'inspect_code_context') {
    const metrics = result && result.metrics ? result.metrics : {};
    item.detail = metrics.sectionCount ? `${metrics.sectionCount} exact source section(s), ~${metrics.estimatedTokens || 0} tokens` : '';
  } else if (toolName === 'note_incidental_issue') {
    item.detail = result && result.recorded ? 'Kept for final handoff' : (result && result.reason ? result.reason : '');
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

function withWorkWalkthrough(text, items, final = false, conversation = null) {
  const meaningfulItems = (items || []).filter(Boolean);
  if (meaningfulItems.length === 0) return text;
  // Dispatch (Orion) is a conversational assistant, not a task-tracking tool -- the bulleted
  // step-by-step recap is useful for Coder's implementation work but is just noise on top of a
  // direct answer/discussion reply. Coder conversations (including legacy ones without a stamped
  // mode) keep the walkthrough as before.
  if (conversation && conversation.mode === 'orion') {
    return sanitizeFinalAnswerText(text);
  }
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
  if (item.toolName === 'evaluate_win_conditions') return true;
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
  const missingVerification = !hasVerificationAfterLastFileEdit(list);
  if (!missingVerification) return '';

  return `[SYSTEM: Post-edit evidence gate. You changed source files (${fileList}) but have not yet produced enough evidence to finish.

Before giving a final answer:
- Run at least one real verification check after the edits. Use the project regression command when available. For Python/Pygame/interactive GUI apps, prefer \`python -m py_compile <file>\` plus \`preview_app\` (it launches the window, screenshots it, and leaves it running so you never hang) — then inspect_screenshot_with_model to confirm it looks right, and capture_screen again or kill_command as needed. Commands that only create folders, list files, or move assets do not count as verification.
- If the verification result is unclear, failed, or points back to a changed section, inspect the relevant file lines before patching again.
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
      item.toolName === 'read_multiple_ranges' ||
      item.toolName === 'inspect_code_context' ||
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
  if (looksLikeLeakedNoToolCorrection(text)) return false;
  if (text.length < 120) return false;
  const nonBlankLines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (nonBlankLines.length >= 3) return true;
  return /[.!?]\s+\S+.*[.!?]/s.test(text);
}

function isSubstantiveVisibleAnswer(text) {
  return answerHasActionableFinalContent(text) && !looksLikeLeakedNoToolCorrection(text);
}

function getInspectedEvidenceAnchors(workWalkthrough = []) {
  const anchors = new Set();
  (workWalkthrough || []).forEach(item => {
    if (!item || item.status === 'error') return;
    if (item.toolName !== 'read_file' && item.toolName !== 'read_multiple_ranges' && item.toolName !== 'inspect_code_context' && item.kind !== 'file') return;
    const raw = String(item.path || item.label || '');
    const backtickMatch = raw.match(/`([^`]+)`/);
    const filePath = (backtickMatch ? backtickMatch[1] : raw).trim();
    if (!filePath) return;
    anchors.add(filePath.toLowerCase());
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    if (parts.length) anchors.add(parts[parts.length - 1].toLowerCase());
  });
  return [...anchors].filter(anchor => anchor.length >= 4);
}

function answerHasInspectionGrounding(answerText, workWalkthrough = []) {
  const text = sanitizeFinalAnswerText(answerText);
  const lower = text.toLowerCase();
  if (/(?:^|[\s`'"(\[])(?:[\w.-]+[\\/])*[\w.-]+\.(?:js|jsx|ts|tsx|py|json|md|html|css|mjs|cjs|yml|yaml|toml|rs|go|java|cs|cpp|c|h)(?::\d+)?\b/i.test(text)) {
    return true;
  }
  return getInspectedEvidenceAnchors(workWalkthrough).some(anchor => lower.includes(anchor));
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
    return '[SYSTEM: Review completion gate. Your draft is not a grounded findings report yet. Either continue inspecting files, or produce a concrete report now with specific findings tied to file paths and line/function context, severity/impact, and a clear note if no specific issues were found. Do not ask the user whether to keep inspecting; finish the review from the available evidence or gather the missing evidence with tools. Only the final saved assistant response counts. Write a complete, standalone report, not a continuation, correction, or shorter follow-up to earlier text.]';
  }
  return '';
}

function buildFinalAnswerQualityGatePrompt(userPrompt, answerText, workWalkthrough = [], conversation = null) {
  const inspected = (workWalkthrough || []).some(item => item && item.status !== 'error');
  if (!inspected) return '';
  if (hasOnlyInventoryEvidence(workWalkthrough)) {
    return `[SYSTEM: Final-response quality gate. You only have inventory-level evidence from tools such as list_files/get_workspace_info. File names alone are not enough to give a deep project analysis, quality review, architecture assessment, or improvement roadmap.

Before final response, decide what evidence the user's actual request requires. If they asked for anything beyond a file inventory, read the relevant source files, tests, README/package/config files, or run safe inspection commands before answering. If the user truly requested only an inventory, answer that narrowly and explicitly. Do not produce broad recommendations from filenames alone.]`;
  }
  // A Dispatch conversation is a conversational assistant, not a task with deliverables -- a short,
  // direct reply that ends by asking the user a clarifying question is a complete answer, not an
  // incomplete one, and it need not cite exact file paths for every claim. Holding it to this
  // gate's "recommendations, a plan, changes, or a next action" / inspection-grounding bars forces
  // a redundant re-verification pass (re-reading files it may have already inspected earlier in the
  // same conversation) purely to satisfy the gate, burning tokens on evidence nobody asked for. This
  // also tends to make the model regress into a degenerate retry that just refers back to its own
  // earlier answer instead of restating it. agentExecutionMode 'answer' covers turns classified as
  // pure discussion; conversation.mode 'orion' covers the rest of Dispatch's turns regardless of
  // how this specific turn got classified (e.g. verifying a technical claim still counts).
  if (agentExecutionMode === 'answer' || (conversation && conversation.mode === 'orion')) {
    const trimmed = sanitizeFinalAnswerText(answerText);
    if (trimmed.length >= 40 && !isGenericNonAnswer(trimmed) && !looksLikeLeakedNoToolCorrection(trimmed)) {
      return '';
    }
  }
  if (turnAlreadyWroteMemory(workWalkthrough) && turnDidSubstantiveInspection(workWalkthrough) &&
      !answerHasInspectionGrounding(answerText, workWalkthrough)) {
    return `[SYSTEM: Final-response quality gate. You inspected source files and stored durable memory, but the visible final answer is not self-contained or grounded in the inspected evidence.

Before final response, answer the user's actual request directly using the files, functions, behaviors, and facts you inspected. Do not rely on any earlier draft answer being visible to the user; restate the substantive answer now.]`;
  }
  if (answerHasActionableFinalContent(answerText)) return '';
  return `[SYSTEM: Final-response quality gate. You inspected context, but inspection alone is not completion.

Before final response, answer the user's actual request directly, using the evidence you gathered. If more evidence is needed, call the necessary tools now; otherwise produce a substantive answer now. Do not stop at phrases like "Ah, the path is...", an acknowledgement, a file-inspection summary, or an empty response. Only the final saved assistant response counts. Write a complete, standalone answer, not a continuation, correction, or shorter follow-up to earlier text.]`;
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

async function readImplementationPlanText(workspacePath, conversation) {
  if (!workspacePath) return '';
  try {
    return await readOrionGovernanceArtifactText(workspacePath, conversation, 'implementation_plan.md', { maxChars: 100000 });
  } catch (err) {
    console.error('Error reading implementation_plan.md:', err);
  }
  return '';
}

function hasAnyChecklist(conversation) {
  return !!(conversation && Array.isArray(conversation.tasks) && conversation.tasks.length > 0);
}

async function callUtilityModel(prompt, modelName, config, requireJson = true) {
  if (modelName.startsWith('deepseek')) {
    if (!config.deepseekApiKey) return null;
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          ...(requireJson ? { response_format: { type: 'json_object' } } : {})
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null;
    } catch (e) {
      console.error('DeepSeek utility call failed:', e);
      return null;
    }
  } else if (modelName.startsWith('gemini-')) {
    if (!config.geminiApiKey) return null;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.geminiApiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            ...(requireJson ? { responseMimeType: 'application/json' } : {})
          }
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) || null;
    } catch (e) {
      console.error('Gemini utility call failed:', e);
      return null;
    }
  } else {
    // Assume Ollama local for anything else
    try {
      const response = await fetch(`http://localhost:11434/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: "You are a concise, technical summarizer utility." },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: { temperature: 0 }
        })
      });
      if (!response.ok) return null;
      const resData = await response.json();
      let text = resData.message && resData.message.content;
      // Some Ollama models don't support JSON mode reliably, but we try to parse it if required
      if (requireJson && text) {
        // Just return the raw text, the caller uses JSON.parse which will handle it
      }
      return text || null;
    } catch (e) {
      console.error('Ollama utility call failed:', e);
      return null;
    }
  }
}

async function classifyPlanApprovalIntent(userPrompt, modelName, config) {
  const fallback = { intent: 'unclear', reason: 'Could not classify plan approval intent.' };
  const prompt = `Classify the user's latest message about a pending implementation plan.

Return only compact JSON with:
{"intent":"approve"|"deny"|"revise"|"other"|"unclear","reason":"short reason"}

Definitions:
- approve: the user clearly wants execution of the existing pending plan to begin.
- deny: the user clearly rejects, cancels, or stops the pending plan.
- revise: the user asks for more review, a different plan, changes, additions, or clarification before execution.
- other: the user is asking a separate question or reporting that the previous answer did not satisfy their request, rather than giving a verdict on the pending plan.
- unclear: the user intent is ambiguous.

User message:
${JSON.stringify(String(userPrompt || ''))}`;

  try {
    const text = await callUtilityModel(prompt, modelName, config, true);
    if (!text) return fallback;
    const parsed = JSON.parse(text);
    const intent = ['approve', 'deny', 'revise', 'other', 'unclear'].includes(parsed.intent) ? parsed.intent : 'unclear';
    return { intent, reason: String(parsed.reason || '') };
  } catch (e) {
    console.error('Plan approval classifier failed:', e);
    return fallback;
  }
}

async function classifyPlanningNeed(userPrompt, modelName, config, recentMessages) {
  const regexFallback = () => ({
    mode: 'plan',
    reason: 'Could not safely classify task complexity.',
    needsLocalInspection: isLocalProjectOrFolderRequest(userPrompt),
    benefitsFromWorkspaceContext: requestPlausiblyBenefitsFromWorkspaceContext(userPrompt),
    taskComplexity: 'standard'
  });
  // Include the last few exchanges so the classifier can resolve references like "let's do all of
  // them" or "go ahead" by understanding what "them"/"that" referred to in context.
  let contextBlock = '';
  if (Array.isArray(recentMessages) && recentMessages.length > 0) {
    const snippet = recentMessages
      .slice(-6)
      .filter(m => m.role && (m.text || m.parts))
      .map(m => {
        const text = m.text || (Array.isArray(m.parts) ? m.parts.map(p => p.text || '').join(' ') : '');
        return `${m.role === 'user' ? 'User' : 'Orion'}: ${String(text).slice(0, 400)}`;
      })
      .join('\n');
    if (snippet) contextBlock = `\nRecent conversation context (for resolving pronouns like "them"/"that"/"it"):\n${snippet}\n`;
  }
  const prompt = `Classify whether this Orion AI request should require an implementation plan before acting.${contextBlock}

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
- "what is this program about" -> direct
- "tell me about the project in my Desktop/projects folder" -> direct
- "I have a folder on my desktop called rocket sumo, recommend similar games and improvements" -> direct
- "look through my program and find any bugs" -> direct
- "audit this codebase for security problems" -> direct
- "how could we make this program better?" -> direct
- "explain how PATH works on Windows" -> answer
- "build me a Python desktop app" -> plan
- "refactor the authentication flow" -> plan
- "lets add this game to the collection with the others, ensure smooth animated professional performance" -> plan
- "go ahead and implement the racing game idea we just discussed, with a real 3D physics engine and new controller UI" -> plan
- "let's build that feature you suggested" -> plan

Be practical and avoid ceremony. Decide from task complexity and risk, not from whether the response may need multiple bullet points.

User message:
${JSON.stringify(String(userPrompt || ''))}`;

  try {
    const text = await callUtilityModel(prompt, modelName, config, true);
    if (!text) return regexFallback();
    const parsed = JSON.parse(text);
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
    conversation.messages[aiMessageIndex].text = withWorkWalkthrough(finalText, workWalkthrough, true, conversation);
    conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
    if (window.renderAiMessage) window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
  } catch (error) {
    workWalkthrough[0].status = 'error';
    workWalkthrough[0].detail = error.message;
    conversation.messages[aiMessageIndex].text = withWorkWalkthrough(`I could not read your RAM because the local command runner failed: ${error.message}`, workWalkthrough, true, conversation);
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

// Dispatch has no execution/mutation tools by design. These helpers identify a direct request for
// one of those unavailable actions and the specific failure mode where the model responds by
// refusing, citing its permissions, promising a handoff without calling it, or returning the work
// to the user. The main loop then creates the real handoff function call deterministically.
function dispatchRequestRequiresCoderExecution(userPrompt) {
  if (DispatchIntent && typeof DispatchIntent.dispatchRequestRequiresCoderExecution === 'function') {
    return DispatchIntent.dispatchRequestRequiresCoderExecution(userPrompt);
  }
  const prompt = String(userPrompt || '').trim();
  if (!prompt) return false;
  const action = '(?:kill|terminate|stop|restart|reboot|start|launch|run|execute|install|uninstall|upgrade|update|configure|change|modify|edit|write|create|delete|remove|rename|move|copy|build|fix|repair|test|deploy|package|commit|push|pull|save|generate|produce|capture)';
  return [
    new RegExp(`\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:go\\s+ahead\\s+and\\s+)?${action}\\b`, 'i'),
    new RegExp(`\\b(?:i\\s+(?:need|want|would\\s+like)\\s+you\\s+to)\\s+(?:please\\s+)?${action}\\b`, 'i'),
    new RegExp(`^\\s*(?:please\\s+)?(?:go\\s+ahead\\s+and\\s+)?${action}\\b`, 'i'),
    new RegExp(`\\b(?:have|get)\\s+(?:the\\s+)?coder\\s+(?:to\\s+)?${action}\\b`, 'i')
  ].some(pattern => pattern.test(prompt));
}

function isDispatchExecutionDeflection(answerText) {
  const answer = String(answerText || '').trim().replace(/\u2019/g, "'");
  if (!answer) return false;
  const limitation = /(?:\b(?:can(?:not|'t)|unable|not\s+able|do(?:n't|\s+not)\s+have|lack(?:ing)?)\b.{0,140}\b(?:permission|access|ability|capability|control|execute|run|command|process|kill|stop|restart|modify|write|perform|do\s+that)\b|\b(?:permission|access|ability|capability|control)\b.{0,100}\b(?:can(?:not|'t)|unable|not\s+able|lack)\b)/i;
  const manualReturn = /\b(?:you(?:'ll|\s+will)?\s+need\s+to|you\s+have\s+to|do\s+it\s+yourself|perform\s+it\s+manually|from\s+your\s+(?:terminal|command\s+prompt)|run\s+(?:this|the\s+command)\s+yourself|i\s+can\s+(?:only\s+)?(?:guide|tell|show)\s+you)\b/i;
  const unexecutedHandoffPromise = /\b(?:pass|hand|route|delegate|send)(?:ing|ed)?\s+(?:it|this|the\s+task)?\s*(?:over|off|along)?\s*(?:to\s+)?(?:the\s+)?coder\b/i;
  return limitation.test(answer) || /\bread[-\s]?only\b/i.test(answer) || manualReturn.test(answer) || unexecutedHandoffPromise.test(answer);
}

function shouldForceDispatchHandoff(userPrompt, answerText, context = {}) {
  if (context.mode !== 'orion' || context.alreadyHandedOff) return false;
  return dispatchRequestRequiresCoderExecution(userPrompt) && isDispatchExecutionDeflection(answerText);
}

function buildForcedDispatchHandoffPrompt(userPrompt) {
  const originalRequest = String(userPrompt || '').trim();
  return `Execute this request from Dispatch in the local environment: "${originalRequest.replace(/"/g, "'").slice(0, 2000)}"\n\nIdentify the intended local target if needed, perform the operation safely using the existing launch/configuration method, and verify the result. Do not return the task to the user merely because Dispatch itself is read-only.`;
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
  // The Memory/Skill gates ask the model to reply with this exact sentinel when it has nothing to
  // add, specifically so a real substantive answer already produced this turn never gets
  // overwritten by a throwaway "no skill needed" / "nothing durable to save" aside. Models don't
  // always use the sentinel verbatim, so the phrase-based checks below stay as a fallback.
  if (/^\W*no_additional_action\W*$/i.test(normalized.trim())) return true;
  return /\b(did not require (workspace|tools?|an implementation plan)|no workspace interaction|ready for (your )?next instruction|mention(ed)? (this|the) correction|previous response (was|did not)|does not require (tools?|workspace)|not require workspace interaction)\b/.test(normalized) ||
    /\b(?:nothing|no)\s+(?:is\s+)?reusable\b/.test(normalized) ||
    /\bno\s+(?:reusable\s+)?skill\s+(?:is\s+)?needed\b/.test(normalized) ||
    /\bdoesn'?t\s+warrant\s+a\s+skill\b/.test(normalized) ||
    /\bone[-\s]?time\s+(?:information|task|thing)\b/.test(normalized) ||
    /\bno\s+(?:new|durable)\s+(?:facts?|information)\s+(?:to|worth)\s+(?:save|saving|record|recording)\b/.test(normalized) ||
    /\bnothing\s+(?:new\s+|durable\s+)*(?:was\s+)?learned\b/.test(normalized) ||
    /\b(?:my|the)\s+(?:answer|response|reply)\s+above\b/.test(normalized) ||
    /\balready\s+(?:a\s+)?complete\s+(?:non[-\s]?workspace\s+)?answer\b/.test(normalized) ||
    /\bi\s+gave\s+you\s+the\s+full\b/.test(normalized) ||
    // Model says "you already have the full report/answer" — it's pointing back at a prior turn
    // instead of being a self-contained answer. Canonically produced after memory tools fire and
    // force one more loop iteration on a turn where the real answer was already written.
    /\byou\s+already\s+have\s+(?:the\s+)?(?:full\s+)?(?:report|answer|analysis|findings|results|summary|everything|it)\b/.test(normalized) ||
    /\byou\s+(?:now\s+)?have\s+(?:the\s+)?(?:full|complete|entire)\s+(?:report|answer|analysis|findings|results|summary)\b/.test(normalized) ||
    // A gate-nudged retry can regress into referring back to an earlier turn instead of
    // restating the substantive answer itself — e.g. "I'm already waiting on your call here...
    // the last message laid it out" instead of actually re-answering. These phrasings are
    // meta-commentary about a prior response, not a self-contained answer.
    /\b(?:already\s+)?waiting\s+on\s+your\s+(?:call|answer|response|turn)\b/.test(normalized) ||
    /\bthe\s+last\s+(?:message|response|answer)\s+(?:already\s+)?(?:laid\s+it\s+out|covered\s+it|covers?\s+it|answered\s+(?:that|this|it))\b/.test(normalized) ||
    /\bas\s+i\s+(?:already|previously)\s+(?:said|mentioned|explained|noted|laid\s+out|answered)\b/.test(normalized) ||
    /\b(?:my|the)\s+(?:previous|prior|earlier)\s+(?:answer|response|message)\s+(?:already\s+)?(?:covers?|covered|addressed|laid\s+out|answered)\b/.test(normalized);
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

const INSPECTION_TOOLS = new Set(['list_files', 'read_file', 'read_multiple_files', 'read_multiple_ranges', 'inspect_code_context', 'get_workspace_info', 'grep_search', 'search_embeddings', 'get_symbol_index']);
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
  if (inspectionCalls.some(item => item.toolName === 'inspect_code_context' || item.toolName === 'read_multiple_ranges')) return true;
  const toolNames = new Set(inspectionCalls.map(item => item.toolName));
  return toolNames.has('get_symbol_index') && (toolNames.has('read_file') || toolNames.has('read_multiple_ranges'));
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
  // "upgrade/install/lint/audit"-style requests mutate the environment or run tooling over the
  // codebase — they are not a plain "launch this program" ask, and the model may legitimately
  // need scratch files to complete them. A transcript showed "Upgrade ruff and run ruff check"
  // misclassified as launch-only, blocking harmless temp-script writes mid-task.
  const hasEditVerb = /\b(fix|edit|change|modify|update|debug|repair|patch|refactor|add|build|implement|create|remove|delete|rewrite|upgrade|install|uninstall|reinstall|setup|set up|configure|lint|audit|analyze|analyse)\b/.test(text);
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
  const conversationEvidence = result && Array.isArray(result.conversationEvidence) ? result.conversationEvidence : [];
  const structuredStatuses = OrchestrationContracts && result && typeof result === 'object'
    ? OrchestrationContracts.extractStructuredStatusFacts(JSON.stringify(result))
    : [];
  return {
    toolName,
    command,
    failed: !!failure,
    failure,
    category: failure ? classifyAgentFailure({ toolName, args, result, errorText: failure }).category : 'success',
    summary: summarizeToolOutcome(toolName, args, result).summary,
    evidenceKind: conversationEvidence.length ? 'retrieved_conversation' : 'tool_result',
    provenance: conversationEvidence.map(item => item && item.provenance).filter(Boolean),
    structuredStatuses
  };
}

function estimateTextTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

const INCIDENTAL_ISSUE_CATEGORIES = new Set([
  'security',
  'data_loss',
  'silent_failure',
  'crash_path',
  'state_race',
  'runaway_loop',
  'destructive_path'
]);
const INCIDENTAL_ISSUE_SEVERITIES = new Set(['major', 'critical']);
const INCIDENTAL_MIN_CONFIDENCE = 0.85;
const INCIDENTAL_MAX_CANDIDATES = 3;

function compactIncidentalIssueText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeIncidentalIssueCandidate(args = {}) {
  const confidence = Number(args.confidence);
  return {
    file: compactIncidentalIssueText(args.file, 240),
    location: compactIncidentalIssueText(args.location, 240),
    category: compactIncidentalIssueText(args.category, 80).toLowerCase(),
    severity: compactIncidentalIssueText(args.severity, 40).toLowerCase(),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    observation: compactIncidentalIssueText(args.observation, 700),
    impact: compactIncidentalIssueText(args.impact, 700),
    evidence: compactIncidentalIssueText(args.evidence, 700),
    suggestedCheck: compactIncidentalIssueText(args.suggestedCheck, 500),
    outsideCurrentTask: args.outsideCurrentTask === true || String(args.outsideCurrentTask).toLowerCase() === 'true'
  };
}

function fingerprintIncidentalIssue(issue = {}) {
  return [
    issue.file,
    issue.location,
    issue.category,
    issue.observation
  ].map(value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
}

function recordIncidentalIssueCandidate(buffer, args = {}) {
  const candidates = Array.isArray(buffer) ? buffer : [];
  const issue = normalizeIncidentalIssueCandidate(args);
  const requiredFields = ['file', 'location', 'observation', 'impact', 'evidence', 'suggestedCheck'];
  const missing = requiredFields.filter(key => !issue[key]);
  if (missing.length) {
    return {
      success: true,
      recorded: false,
      reason: `Rejected incidental observation: missing ${missing.join(', ')}.`,
      count: candidates.length
    };
  }
  if (!INCIDENTAL_ISSUE_CATEGORIES.has(issue.category)) {
    return {
      success: true,
      recorded: false,
      reason: `Rejected incidental observation: category must be one of ${[...INCIDENTAL_ISSUE_CATEGORIES].join(', ')}.`,
      count: candidates.length
    };
  }
  if (!INCIDENTAL_ISSUE_SEVERITIES.has(issue.severity)) {
    return {
      success: true,
      recorded: false,
      reason: 'Rejected incidental observation: severity must be major or critical.',
      count: candidates.length
    };
  }
  if (issue.confidence < INCIDENTAL_MIN_CONFIDENCE) {
    return {
      success: true,
      recorded: false,
      reason: `Rejected incidental observation: confidence must be at least ${INCIDENTAL_MIN_CONFIDENCE}.`,
      count: candidates.length
    };
  }
  if (!issue.outsideCurrentTask) {
    return {
      success: true,
      recorded: false,
      reason: 'Rejected incidental observation: issue must be outside the current task.',
      count: candidates.length
    };
  }
  const fingerprint = fingerprintIncidentalIssue(issue);
  if (candidates.some(candidate => candidate.fingerprint === fingerprint)) {
    return {
      success: true,
      recorded: false,
      reason: 'Rejected incidental observation: duplicate candidate already recorded.',
      count: candidates.length
    };
  }
  if (candidates.length >= INCIDENTAL_MAX_CANDIDATES) {
    return {
      success: true,
      recorded: false,
      reason: `Rejected incidental observation: run-scoped buffer is capped at ${INCIDENTAL_MAX_CANDIDATES}.`,
      count: candidates.length
    };
  }
  const recorded = {
    ...issue,
    fingerprint,
    recordedAt: Date.now()
  };
  candidates.push(recorded);
  return {
    success: true,
    recorded: true,
    count: candidates.length,
    issue: {
      file: recorded.file,
      location: recorded.location,
      category: recorded.category,
      severity: recorded.severity,
      confidence: recorded.confidence,
      observation: recorded.observation
    }
  };
}

function formatIncidentalObservations(buffer, maxItems = 2) {
  const candidates = Array.isArray(buffer) ? buffer : [];
  const ranked = candidates
    .filter(candidate => candidate && candidate.observation)
    .sort((a, b) => {
      const severityDelta = (b.severity === 'critical' ? 2 : 1) - (a.severity === 'critical' ? 2 : 1);
      return severityDelta || ((Number(b.confidence) || 0) - (Number(a.confidence) || 0));
    })
    .slice(0, Math.max(0, maxItems));
  if (!ranked.length) return '';
  const lines = ['## Incidental Observations', 'While working, I also noticed:'];
  for (const issue of ranked) {
    const severity = issue.severity === 'critical' ? 'Critical' : 'Major';
    lines.push(`- **${severity}:** \`${issue.file}\` (${issue.location}) - ${issue.observation}`);
    lines.push(`  Impact: ${issue.impact}`);
    lines.push(`  Evidence: ${issue.evidence}`);
    lines.push(`  Suggested check: ${issue.suggestedCheck}`);
  }
  return lines.join('\n');
}

function appendIncidentalObservationsToFinal(text, buffer, conversation = {}, options = {}) {
  if (!Array.isArray(buffer) || !buffer.length) return text;
  if (conversation && conversation.mode === 'orion') return text;
  if (options.autoContinueExecution || options.forceYield) return text;
  const section = formatIncidentalObservations(buffer);
  if (!section) return text;
  const base = String(text || '').trimEnd();
  if (base.includes('## Incidental Observations')) return base;
  return `${base}\n\n${section}`;
}

function createContextAcquisitionLedger() {
  return {
    files: new Map(),
    events: [],
    readCalls: 0,
    searchCalls: 0,
    failedSearchCalls: 0,
    uniqueLinesReturned: 0,
    duplicateLinesReturned: 0,
    estimatedSourceTokens: 0,
    invalidations: 0
  };
}

function normalizeLedgerPath(pathValue) {
  return String(pathValue || '').replace(/\\/g, '/').toLowerCase();
}

function mergeLedgerRange(existingRanges, startLine, endLine) {
  existingRanges.push({ startLine, endLine });
  existingRanges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged = [];
  for (const range of existingRanges) {
    const last = merged[merged.length - 1];
    if (!last || range.startLine > last.endLine + 1) {
      merged.push({ ...range });
    } else {
      last.endLine = Math.max(last.endLine, range.endLine);
    }
  }
  existingRanges.splice(0, existingRanges.length, ...merged);
}

function countRangeOverlap(existingRanges, startLine, endLine) {
  let overlap = 0;
  for (const range of existingRanges || []) {
    const start = Math.max(startLine, range.startLine);
    const end = Math.min(endLine, range.endLine);
    if (end >= start) overlap += end - start + 1;
  }
  return overlap;
}

function countResultLines(value) {
  const text = String(value || '');
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function getContextSectionsFromToolResult(toolName, args = {}, result = {}) {
  if (!result || isFailedToolResult(result)) return [];
  if (toolName === 'read_file' && args.path) {
    const content = String(result.content || '');
    const hasRange = Number.isInteger(parseInt(args.startLine, 10)) && Number.isInteger(parseInt(args.endLine, 10));
    const lineCount = countResultLines(content);
    const startLine = hasRange ? parseInt(args.startLine, 10) : 1;
    const endLine = hasRange ? parseInt(args.endLine, 10) : Math.max(1, lineCount);
    return [{ path: args.path, startLine, endLine, lineCount, estimatedTokens: estimateTextTokens(content), fullRead: !hasRange }];
  }
  if (toolName === 'read_multiple_files' && Array.isArray(args.paths)) {
    const content = String(result.content || '');
    const perFileTokenEstimate = Math.ceil(estimateTextTokens(content) / Math.max(1, args.paths.length));
    return args.paths.map(pathValue => ({
      path: pathValue,
      startLine: 1,
      endLine: countResultLines(content),
      lineCount: countResultLines(content),
      estimatedTokens: perFileTokenEstimate,
      fullRead: true
    }));
  }
  if ((toolName === 'read_multiple_ranges' || toolName === 'inspect_code_context') && Array.isArray(result.sections)) {
    return result.sections
      .filter(section => section && section.path)
      .map(section => ({
        path: section.path,
        startLine: Number(section.startLine) || 1,
        endLine: Number(section.endLine) || Number(section.startLine) || 1,
        lineCount: Number(section.lineCount) || Math.max(1, (Number(section.endLine) || 1) - (Number(section.startLine) || 1) + 1),
        estimatedTokens: Number(section.estimatedTokens) || estimateTextTokens(section.content || ''),
        fullRead: false
      }));
  }
  return [];
}

function normalizeContextWorkspacePath(value) {
  return String(value || '').replace(/[\\/]+$/, '').toLowerCase();
}

function rememberContextPacketForConversation(conversation, workspacePath, toolName, result = {}) {
  if (!conversation || toolName !== 'inspect_code_context' || !result || !result.contextPacketId) return false;
  const refs = Array.isArray(conversation.contextPacketRefs) ? conversation.contextPacketRefs : [];
  const next = refs.filter(ref => ref && ref.id !== result.contextPacketId);
  next.push({
    id: String(result.contextPacketId),
    workspace: String(workspacePath || ''),
    query: String(result.query || ''),
    workspaceRevision: Number(result.metrics && result.metrics.workspaceRevision) || 0,
    sectionCount: Array.isArray(result.sections) ? result.sections.length : 0,
    createdAt: Date.now()
  });
  conversation.contextPacketRefs = next.slice(-8);
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conversation.id);
  return true;
}

function getHandoffContextPacketIds(conversation, workspacePath) {
  if (!conversation || !Array.isArray(conversation.contextPacketRefs)) return [];
  const targetWorkspace = normalizeContextWorkspacePath(workspacePath);
  return conversation.contextPacketRefs
    .filter(ref => ref && ref.id && normalizeContextWorkspacePath(ref.workspace) === targetWorkspace)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(-5)
    .map(ref => String(ref.id));
}

async function loadInheritedContextReceipt(conversation, workspacePath) {
  const inherited = conversation && conversation.inheritedContext;
  const packetIds = inherited && Array.isArray(inherited.packetIds) ? inherited.packetIds.filter(Boolean) : [];
  if (!conversation || conversation.mode === 'orion' || !inherited || inherited.active === false || packetIds.length === 0) return null;
  if (normalizeContextWorkspacePath(inherited.workspace) !== normalizeContextWorkspacePath(workspacePath)) return null;
  if (!window.api || typeof window.api.hydrateContextPackets !== 'function') return null;
  try {
    const receipt = await window.api.hydrateContextPackets(workspacePath, packetIds, {
      conversationId: conversation.id,
      budgetTokens: 18000
    });
    inherited.lastHydratedAt = Date.now();
    inherited.lastHydrationError = receipt && receipt.success === false ? String(receipt.error || '') : '';
    inherited.workspaceRevision = Number(receipt && receipt.workspaceRevision) || inherited.workspaceRevision || 0;
    inherited.metrics = receipt && receipt.metrics ? receipt.metrics : inherited.metrics;
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conversation.id);
    return receipt && receipt.success !== false && Array.isArray(receipt.sections) && receipt.sections.length > 0
      ? receipt
      : null;
  } catch (error) {
    inherited.lastHydratedAt = Date.now();
    inherited.lastHydrationError = error.message || String(error);
    return null;
  }
}

function buildInheritedContextPrompt(receipt = {}) {
  if (!receipt || !Array.isArray(receipt.sections) || receipt.sections.length === 0 || !receipt.content) return '';
  const requestedWork = Array.isArray(receipt.requestedWork) ? receipt.requestedWork.filter(Boolean) : [];
  const findings = Array.isArray(receipt.findings) ? receipt.findings.filter(Boolean) : [];
  const refreshed = receipt.sections.filter(section => section && section.refreshed).map(section => section.path);
  return [
    '[INHERITED DISPATCH CONTEXT - validated exact source]',
    `Context packet IDs: ${(receipt.packetIds || []).join(', ')}`,
    `Current workspace revision: ${Number(receipt.workspaceRevision) || 0}`,
    requestedWork.length ? `Requested work:\n${requestedWork.map(item => `- ${item}`).join('\n')}` : '',
    findings.length ? `Dispatch findings:\n${findings.map(item => `- ${item}`).join('\n')}` : '',
    refreshed.length ? `Changed since Dispatch inspected it; Orion refreshed these sections before this run: ${[...new Set(refreshed)].join(', ')}` : '',
    'The source below is current and satisfies read-before-edit for the listed files. Do not list, search, or reread these same sections merely to orient yourself. Expand context only when you can name a concrete missing caller, dependency, test, or source section required for the task.',
    receipt.content
  ].filter(Boolean).join('\n\n');
}

function inheritedContextSeenFiles(receipt = {}) {
  return new Set((receipt && Array.isArray(receipt.sections) ? receipt.sections : [])
    .filter(section => section && section.current === true && section.path)
    .map(section => String(section.path).toLowerCase()));
}

function recordContextAcquisitionToolResult(ledger, toolName, args = {}, result = {}) {
  if (!ledger) return;
  if (toolName === 'grep_search' || toolName === 'semantic_search' || toolName === 'search_embeddings' || toolName === 'get_symbol_index' || toolName === 'get_file_symbols' || toolName === 'find_references') {
    ledger.searchCalls += 1;
    if (isFailedToolResult(result)) ledger.failedSearchCalls += 1;
    ledger.events.push({
      toolName,
      kind: 'search',
      failed: isFailedToolResult(result),
      target: args.pattern || args.query || args.symbolName || args.path || ''
    });
    ledger.events = ledger.events.slice(-40);
    return;
  }

  const sections = getContextSectionsFromToolResult(toolName, args, result);
  for (const section of sections) {
    const pathKey = normalizeLedgerPath(section.path);
    if (!pathKey) continue;
    const fileEntry = ledger.files.get(pathKey) || {
      path: String(section.path),
      ranges: [],
      fullReads: 0,
      readCalls: 0,
      duplicateLines: 0,
      uniqueLines: 0,
      estimatedTokens: 0
    };
    const startLine = Math.max(1, Number(section.startLine) || 1);
    const endLine = Math.max(startLine, Number(section.endLine) || startLine);
    const lineCount = Math.max(1, endLine - startLine + 1);
    const duplicateLines = countRangeOverlap(fileEntry.ranges, startLine, endLine);
    const uniqueLines = Math.max(0, lineCount - duplicateLines);
    fileEntry.readCalls += 1;
    if (section.fullRead) fileEntry.fullReads += 1;
    fileEntry.duplicateLines += duplicateLines;
    fileEntry.uniqueLines += uniqueLines;
    fileEntry.estimatedTokens += Number(section.estimatedTokens) || 0;
    mergeLedgerRange(fileEntry.ranges, startLine, endLine);
    ledger.files.set(pathKey, fileEntry);

    ledger.readCalls += 1;
    ledger.uniqueLinesReturned += uniqueLines;
    ledger.duplicateLinesReturned += duplicateLines;
    ledger.estimatedSourceTokens += Number(section.estimatedTokens) || 0;
    ledger.events.push({
      toolName,
      kind: 'read',
      path: fileEntry.path,
      startLine,
      endLine,
      duplicateLines,
      fullRead: !!section.fullRead
    });
  }
  ledger.events = ledger.events.slice(-40);
}

function invalidateContextAcquisitionForFile(ledger, pathValue, reason = 'file mutation') {
  if (!ledger || !pathValue) return;
  const key = normalizeLedgerPath(pathValue);
  if (ledger.files.delete(key)) ledger.invalidations += 1;
  ledger.events.push({ toolName: reason, kind: 'invalidation', path: String(pathValue) });
  ledger.events = ledger.events.slice(-40);
}

function buildContextAcquisitionReceipt(ledger) {
  if (!ledger) return {};
  const repeatedReads = [...ledger.files.values()]
    .filter(file => file.readCalls >= 2 || file.duplicateLines > 0 || file.fullReads >= 2)
    .sort((a, b) => (b.duplicateLines - a.duplicateLines) || (b.readCalls - a.readCalls))
    .slice(0, 6)
    .map(file => ({
      path: file.path,
      readCalls: file.readCalls,
      fullReads: file.fullReads,
      uniqueLines: file.uniqueLines,
      duplicateLines: file.duplicateLines
    }));
  return {
    readCalls: ledger.readCalls,
    searchCalls: ledger.searchCalls,
    failedSearchCalls: ledger.failedSearchCalls,
    uniqueLinesReturned: ledger.uniqueLinesReturned,
    duplicateLinesReturned: ledger.duplicateLinesReturned,
    estimatedSourceTokens: ledger.estimatedSourceTokens,
    invalidations: ledger.invalidations,
    repeatedReads,
    recentEvents: ledger.events.slice(-12)
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
  const toolName = String((failure && failure.toolName) || '');
  const errorText = String((failure && failure.errorText) || '');
  const args = (failure && failure.args) || {};
  const failureCount = Number((failure && failure.failureCount) || 1);

  // Extract useful snippets from the error for inline context
  const errorSnippet = errorText ? errorText.slice(0, 200).replace(/\n+/g, ' ').trim() : '';
  const toolLabel = toolName ? `\`${toolName}\`` : 'the tool';

  if (category === 'deprecated_command_with_replacement' && failure && failure.replacementHint) {
    return `The command's own output already named the fix: it says to use \`${failure.replacementHint}\`. Run that directly. Do not search the web for documentation that repeats information already in the tool output you just received.`;
  }

  if (category === 'repeated_tool_failure') {
    const countNote = failureCount >= 3 ? ` (${failureCount} consecutive failures)` : '';
    return `${toolLabel} has failed repeatedly${countNote}. Do not retry it blindly. Do not quit the task. Pause, inspect fresh state and recent output, explain the likely cause${errorSnippet ? ': "' + errorSnippet + '"' : ''}, then choose a different strategy before retrying: use a different tool, narrower arguments, or ask for the missing prerequisite.`;
  }

  if (category === 'patch_target_missing') {
    const filePath = args.path || args.file_path || '';
    const fileHint = filePath ? ` in \`${filePath}\`` : '';
    return `The patch target${fileHint} was not found in the current file. Re-read the surrounding file lines before editing. Use a narrower exact target, a line-range patch, or adjust the patch to the current file contents instead of repeating the same patch.${errorSnippet ? ' Error: "' + errorSnippet + '"' : ''}`;
  }

  if (category === 'workspace_path_missing') {
    const attemptedPath = args.path || args.workspace_path || errorText.match(/'([^']+)'/)?.[1] || '';
    const pathHint = attemptedPath ? ` The path \`${attemptedPath}\` does not exist.` : '';
    return `The workspace path guess failed.${pathHint} Do not call change_workspace again with another guessed path. Resolve the folder first: run a bounded PowerShell Get-ChildItem directory search against the likely parent locations such as C:\\Users\\Owner\\Desktop and C:\\Users\\Owner\\Desktop\\Projects, using name tokens from the user request and the failed path, -Directory, -Depth 2 or -Depth 3, and -ErrorAction SilentlyContinue. Then pick the closest real directory from the local listing and call change_workspace once with that verified absolute path.`;
  }

  if (category === 'command_blocked') {
    return `${toolLabel} was blocked by safety or planning rules.${errorSnippet ? ' Reason: "' + errorSnippet + '".' : ''} Keep the safety behavior intact; use a safer non-destructive command, an internal executable/args path, or ask for explicit plan approval when required.`;
  }

  if (category === 'test_failure') {
    return `Tests failed${errorSnippet ? ': "' + errorSnippet + '"' : ''}. Treat this as a regression signal. Read the failing test output, identify the first failing assertion or command, fix the code or test expectation, and rerun the relevant tests before summarizing.`;
  }

  if (category === 'missing_dependency') {
    // Try to extract the missing module/command name from the error
    const missingMatch = errorText.match(/cannot find module '([^']+)'|command not found[:\s]+(\S+)|no such file[^:]*:\s*(\S+)/i);
    const missingHint = missingMatch ? ` The missing item appears to be \`${missingMatch[1] || missingMatch[2] || missingMatch[3]}\`.` : (errorSnippet ? ` Error: "${errorSnippet}".` : '');
    return `A dependency is missing.${missingHint} Install or configure it only after checking the project manifest and existing package manager. If installation is not appropriate, choose a tool that uses available local capabilities.`;
  }

  if (category === 'auth_missing') {
    const credHint = errorText.match(/api.?key|credential|token|unauthorized|forbidden/i)?.[0] || '';
    return `${toolLabel} failed due to missing credentials or permissions${credHint ? ' (' + credHint + ')' : ''}. Stop retrying credential-gated work. Preserve state, name the missing credential or permission, and ask the user to provide or configure it before continuing.`;
  }

  if (category === 'timeout') {
    const cmd = args.command ? ` (\`${String(args.command).slice(0, 60)}\`)` : '';
    return `${toolLabel}${cmd} timed out. Do not repeat the same long-running action unchanged. Check if the process is a GUI/Pygame app that blocks until closed. If so, add an automated exit flag to the code (e.g. exit after N frames/ticks), run with a short timeout, or use start_command/kill_command instead of waiting for a long timeout.`;
  }

  if (category === 'interactive_command_needs_input') {
    return `${toolLabel} launched an interactive command that expects stdin input. Do not run it as a blocking call without stdin. Pipe a short scripted input sequence, redirect an input fixture, or use start_command with a short timeout followed by read_command_output and kill_command.`;
  }

  if (category === 'model_no_tool_use') {
    return 'Your response appeared to promise or report workspace work, but no tools were called. If the task requires looking at files, running commands/tests, editing code, creating files, saving memory, or verifying behavior, call the appropriate tools now. If the task does not require tools, answer the user naturally and do not mention tools, workspace operations, or this correction.';
  }

  // Generic tool_failure with actual error context
  return `${toolLabel} failed${errorSnippet ? ': "' + errorSnippet + '"' : ''}. Inspect the error and current workspace state before trying again. Change one meaningful variable in the next attempt, such as the target path, command, arguments, or verification step.`;
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

function isGeneratedStandaloneWorkspacePath(pathValue) {
  return /(?:^|[\\/])standalone-workspaces(?:[\\/]|$)/i.test(String(pathValue || ''));
}

function getDispatchWorkspaceRoot() {
  return joinLocalPath(joinLocalPath(resolvedHomeDir || 'C:\\Users\\Owner', 'Desktop'), 'Projects');
}

function formatKnownProjectsForSystemFacts() {
  let knownProjects = [];
  try {
    if (window.getKnownProjects) {
      const result = window.getKnownProjects();
      if (Array.isArray(result)) knownProjects = result;
    }
  } catch (_) {}
  const unique = [];
  const seen = new Set();
  for (const projectPath of knownProjects) {
    const pathText = String(projectPath || '').trim();
    if (!pathText) continue;
    const key = pathText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pathText);
    if (unique.length >= 40) break;
  }
  if (!unique.length) return '';
  const lines = unique.map(projectPath => `- ${getLocalPathBaseName(projectPath)}: ${projectPath}`).join('\n');
  return `\nKnown local projects:\n${lines}`;
}

function resolveConversationWorkspace(conversation) {
  const conv = conversation && typeof conversation === 'object' ? conversation : {};
  const hasConversationShape = Object.keys(conv).length > 0;
  let mode = 'coder';
  if (conv.mode === 'orion' || conv.mode === 'coder') {
    mode = conv.mode;
  } else if (conv.projectPath) {
    mode = 'coder';
  } else if (hasConversationShape) {
    mode = activeConversationMode;
  }
  if (mode === 'orion') {
    const workspace = String(conv.workspace || '').trim();
    if (workspace && !isGeneratedStandaloneWorkspacePath(workspace)) return workspace;
    return getDispatchWorkspaceRoot();
  }
  return conv.workspace || conv.projectPath || (window.getCurrentWorkspace ? window.getCurrentWorkspace() : '');
}

function getKnownWorkspaceCandidates(conversation) {
  const candidates = [];
  const add = (value, source) => {
    const projectPath = String(value || '').trim();
    if (!projectPath || candidates.some(item => WorkspaceResolution && WorkspaceResolution.samePath(item.path, projectPath))) return;
    candidates.push({ path: projectPath, source });
  };
  try {
    const known = window.getKnownProjects ? window.getKnownProjects() : [];
    (Array.isArray(known) ? known : []).forEach(value => add(value, 'registered_project'));
  } catch (_) {}
  add(conversation && conversation.dispatchProjectPath, 'dispatch_binding');
  add(conversation && conversation.projectPath, 'conversation_project');
  if (window.getRecentProjectCandidates) {
    try {
      (window.getRecentProjectCandidates() || []).forEach(value => add(value.path || value, value.source || 'recent_conversation'));
    } catch (_) {}
  }
  return candidates;
}

async function resolveDispatchWorkspaceForRun(conversation, userPrompt) {
  const searchRoot = getDispatchWorkspaceRoot();
  if (!WorkspaceResolution) {
    return { kind: 'unresolved', path: resolveConversationWorkspace(conversation), projectPath: '', projectName: '', source: 'legacy' };
  }
  const knownProjects = getKnownWorkspaceCandidates(conversation);
  let resolution = WorkspaceResolution.classifyWorkspace({
    mode: 'orion',
    workspacePath: conversation && conversation.workspace,
    dispatchProjectPath: conversation && conversation.dispatchProjectPath,
    searchRoot,
    knownProjects
  });
  const named = WorkspaceResolution.findNamedProject(userPrompt, knownProjects);
  if (named) {
    resolution = WorkspaceResolution.bindResolvedProject(resolution, named, named.source || 'registered_project');
  } else if (resolution.kind !== WorkspaceResolution.KINDS.ACTIVE_PROJECT) {
    // A bounded filesystem lookup covers named projects that have not yet been registered. The
    // search starts from entity-like names (for example an all-caps app name) and never treats the
    // generic Projects directory itself as the selected project.
    const references = WorkspaceResolution.extractProjectReferences(userPrompt);
    for (const reference of references) {
      const candidatePath = joinLocalPath(searchRoot, reference);
      const candidate = await resolveWorkspacePathForChange(candidatePath);
      if (!candidate || !candidate.success || WorkspaceResolution.samePath(candidate.path, searchRoot)) continue;
      resolution = WorkspaceResolution.bindResolvedProject(resolution, {
        path: candidate.path,
        name: candidate.matchedName || getLocalPathBaseName(candidate.path),
        source: candidate.fuzzyResolved ? 'filesystem_fuzzy_match' : 'filesystem_match'
      });
      break;
    }
  }

  if (resolution.kind === WorkspaceResolution.KINDS.ACTIVE_PROJECT) {
    const didChange = !WorkspaceResolution.samePath(conversation.workspace, resolution.path)
      || !WorkspaceResolution.samePath(conversation.dispatchProjectPath, resolution.path);
    conversation.workspace = resolution.path;
    conversation.dispatchProjectPath = resolution.path;
    conversation.projectPath = '';
    resolution.changed = didChange;
    if (didChange && typeof window.changeActiveWorkspace === 'function') {
      window.changeActiveWorkspace(resolution.path, { conversationId: conversation.id, promoteProject: false });
    }
    if (didChange && window.saveConversationsToStorage) window.saveConversationsToStorage();
  }
  return resolution;
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

function isNonRetryableModelHttpStatus(status) {
  return status === 400 || status === 401 || status === 402 || status === 403;
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

// Provider-aware version of the escalation chain above, used by both the proactive deep-task
// upgrade and the reactive repeated-edit-failure escalation. DeepSeek's lineup is a flat two-tier
// flash->pro chain (unlike Gemini's multi-family ladder), so it doesn't need its own model-tier
// classification logic — it escalates to "the pro version of itself," exactly as requested. Claude
// and Ollama models have no defined next tier and return null, same as before this generalization.
function getNextModelForHighDemand(modelName) {
  const name = String(modelName || '');
  if (name.startsWith('gemini-')) return getNextGeminiModelForHighDemand(name);
  const deepseekChain = { 'deepseek-v4-flash': 'deepseek-v4-pro' };
  return deepseekChain[name] || null;
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
  // When the main loop runs on Claude, still route the cheap JSON-classification / token-counting /
  // compaction-summary calls to a cheap Gemini model rather than paying Claude rates for bookkeeping.
  // This is the ideal cost split: Claude does the hard reasoning, flash-lite does the plumbing. Falls
  // back gracefully (regexFallback in the classifiers) if no Gemini key is configured.
  if (name.startsWith('claude')) return 'gemini-2.5-flash-lite';
  // DeepSeek routes utility calls to its own cheap flash tier instead of Gemini — unlike Claude,
  // a DeepSeek-only setup shouldn't need a Gemini key just for classification/token-counting.
  if (name.startsWith('deepseek')) return 'deepseek-v4-flash';
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

// Dispatch (Orion) can look at files, code, and the web to back up what it says, and it can
// explicitly hand a workspace to Coder when Jason asks. It must never be structurally able to
// write, edit, run, or execute anything itself; that's Coder's job. This whitelist is enforced
// below regardless of what the system prompt text claims, so the restriction can't be talked
// around by a model that decides to route differently.
const DISPATCH_TOOL_ALLOWLIST = new Set([
  'recall_memory', 'remember_fact', 'remember_preference',
  'google_search', 'fetch_web_page', 'fetch_api_docs', 'search_api_docs',
  'read_file', 'read_multiple_files', 'read_multiple_ranges', 'inspect_code_context', 'list_files', 'get_workspace_info', 'change_workspace',
  'handoff_to_coder',
  'get_coder_task_status', 'cancel_coder_task',
  'open_url', 'click_element', 'fill_input', 'take_screenshot', 'navigate_back',
  'inspect_binary_asset', 'list_asset_metadata', 'inspect_screenshot', 'inspect_screenshot_with_model',
  'grep_search', 'search_embeddings', 'semantic_search',
  'get_symbol_index', 'fetch_page', 'git_diff', 'git_rollback', 'edit_config', 'get_file_symbols', 'find_references',
  'read_notes', 'read_project_memory', 'remember_file_notes',
  'inspect_environment',
  'db_query'
]);

// Single source of truth for the agent's tool declarations, consumed by every provider
// (Gemini, Ollama, and Anthropic). Previously this ~480-line array was duplicated verbatim
// inside callGeminiAPI and callOllamaAPI, which silently drifted out of sync. Reads the
// module-level agentExecutionMode so operational-context tools are only offered during execution.
function buildAgentToolDeclarations() {
  const allTools = [
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
            name: "fetch_api_docs",
            description: "Downloads documentation from a URL (e.g. a markdown repo, a DevDocs JSON, or a raw webpage) and caches it persistently in ~/orion-docs-cache/<library_name>@<version>/. Use this when you are missing library documentation and want to index it for offline semantic search.",
            parameters: {
              type: "OBJECT",
              properties: {
                library_name: { type: "STRING", description: "The name of the library (e.g., 'pygame')." },
                version: { type: "STRING", description: "The version of the library (e.g., '2.6.0')." },
                url: { type: "STRING", description: "The direct URL to the documentation to fetch (can be markdown, HTML, or DevDocs endpoint)." }
              },
              required: ["library_name", "version", "url"]
            }
          },
          {
            name: "search_api_docs",
            description: "Semantically searches the locally cached documentation for a specific library and version (in ~/orion-docs-cache/<library_name>@<version>/). Returns relevant chunks. Use this instead of web searching for syntax when documentation is locally cached.",
            parameters: {
              type: "OBJECT",
              properties: {
                library_name: { type: "STRING", description: "The name of the library." },
                version: { type: "STRING", description: "The version of the library." },
                query: { type: "STRING", description: "The semantic query." }
              },
              required: ["library_name", "version", "query"]
            }
          },
          {
            name: "update_scratchpad",
            description: "Updates your private Chain-of-Thought scratchpad. This is your personal space to break down complex tasks, write intermediate logic, or list hypotheses. Note: this tool OVERWRITES the scratchpad state, so include previous content if you wish to keep it.",
            parameters: {
              type: "OBJECT",
              properties: {
                content: { type: "STRING", description: "The markdown content for your scratchpad." }
              },
              required: ["content"]
            }
          },
          {
            name: "note_incidental_issue",
            description: "Records a run-scoped incidental observation that was unmistakably visible while inspecting material required for the current task. Do not search for unrelated issues, do not interrupt the task, and do not use this for style, refactors, TODOs, generic missing tests, minor duplication, or speculative concerns. Weak candidates are rejected without failing the run.",
            parameters: {
              type: "OBJECT",
              properties: {
                file: { type: "STRING", description: "File path containing the directly visible evidence." },
                location: { type: "STRING", description: "Specific function, line range, execution path, or UI/backend location." },
                category: {
                  type: "STRING",
                  enum: ["security", "data_loss", "silent_failure", "crash_path", "state_race", "runaway_loop", "destructive_path"],
                  description: "Serious issue class. Do not use for style, design preference, complexity, or generic test gaps."
                },
                severity: { type: "STRING", enum: ["major", "critical"], description: "Only major or critical observations should be recorded." },
                confidence: { type: "NUMBER", description: "0-1 confidence. Must be at least 0.85." },
                observation: { type: "STRING", description: "Concise statement of what is wrong and why it is wrong." },
                impact: { type: "STRING", description: "Concrete user-visible, data, security, reliability, or operational impact." },
                evidence: { type: "STRING", description: "Direct evidence already visible in the inspected material. Do not cite uninspected assumptions." },
                suggestedCheck: { type: "STRING", description: "Clear next inspection or repair step for a later task." },
                outsideCurrentTask: { type: "BOOLEAN", description: "Must be true. If it affects the current task, handle it as part of the task instead." }
              },
              required: ["file", "location", "category", "severity", "confidence", "observation", "impact", "evidence", "suggestedCheck", "outsideCurrentTask"]
            }
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
            name: "handoff_to_coder",
            description: "Promotes a local folder into Coder as an explicit project and optionally queues a Coder prompt to start implementation or execution. REQUIRED: when the user asks for an operation outside Dispatch's read-only permissions, call this tool; never refuse or tell the user to perform it manually merely because Dispatch cannot execute it. For an obvious implementation/execution request, route early without deeply inspecting source first. IMPORTANT — context transfer: exact-source context packets are generated ONLY by inspect_code_context calls. If your investigation used grep_search/read_file instead, no packets exist, so you MUST pass your key conclusions in `findings` — otherwise Coder starts blind and rediscovers everything. This is the explicit promotion path; change_workspace alone must not add folders to Coder.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Optional absolute folder path to promote. Defaults to the current Dispatch workspace." },
                prompt: { type: "STRING", description: "Optional exact task for Coder to start, such as what to build, fix, or investigate." },
                findings: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Concise findings or decisions already established in Dispatch (file paths, key line references, conclusions). REQUIRED in practice when you explored with grep_search/read_file, since only inspect_code_context produces transferable context packets. Do not paste source code here; exact source is transferred through context packets."
                },
                title: { type: "STRING", description: "Optional title for the new Coder conversation." },
                open: { type: "BOOLEAN", description: "Whether to switch the UI to the new Coder conversation immediately. Defaults to false." }
              }
            }
          },
          {
            name: "get_coder_task_status",
            description: "Reads the canonical state of a task launched by this Dispatch conversation. Use the task ID returned by handoff_to_coder; omit it to inspect this conversation's latest launched task.",
            parameters: {
              type: "OBJECT",
              properties: {
                taskId: { type: "STRING", description: "Optional task ID. Defaults to the latest task owned by this Dispatch conversation." }
              }
            }
          },
          {
            name: "cancel_coder_task",
            description: "Cancels a pending or active Coder task owned by this Dispatch conversation. Pending work is removed from the scheduler; active work uses the existing cooperative abort and command cleanup path. It cannot cancel unrelated tasks.",
            parameters: {
              type: "OBJECT",
              properties: {
                taskId: { type: "STRING", description: "Optional owned task ID. Defaults to this Dispatch conversation's latest launched task." },
                reason: { type: "STRING", description: "Short user-facing cancellation reason." }
              }
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
            name: "read_multiple_files",
            description: "Reads the entire content of multiple files in one turn. Use this ONLY if you have a massive context window and need to ingest complete context from multiple files without burning action loops. For smaller context windows, read files individually or use targeted reads with get_symbol_index.",
            parameters: {
              type: "OBJECT",
              properties: {
                paths: { 
                  type: "ARRAY", 
                  items: { type: "STRING" },
                  description: "Array of relative paths of the files to read" 
                }
              },
              required: ["paths"]
            }
          },
          {
            name: "read_file",
            description: "Reads a TEXT file located at path relative to the workspace root. Images and binary assets are rejected; use inspect_screenshot_with_model for visual understanding or inspect_binary_asset for metadata. Use full-file reads when the file fits the active context budget or whole-file structure matters. For very large files, prefer inspect_code_context, read_multiple_ranges, get_symbol_index, or get_file_symbols so Orion gets complete relevant functions/classes in one turn instead of many arbitrary chunks.",
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
            name: "read_multiple_ranges",
            description: "Reads multiple exact line ranges across one or more files in a single tool call. Use this after symbol/search results identify several relevant locations; it avoids one model round trip per range while still returning exact source for editing.",
            parameters: {
              type: "OBJECT",
              properties: {
                files: {
                  type: "ARRAY",
                  description: "Files and ranges to read.",
                  items: {
                    type: "OBJECT",
                    properties: {
                      path: { type: "STRING", description: "Relative file path." },
                      ranges: {
                        type: "ARRAY",
                        description: "Line ranges to return from this file.",
                        items: {
                          type: "OBJECT",
                          properties: {
                            startLine: { type: "NUMBER", description: "1-based start line." },
                            endLine: { type: "NUMBER", description: "1-based end line." }
                          },
                          required: ["startLine", "endLine"]
                        }
                      }
                    },
                    required: ["path", "ranges"]
                  }
                },
                maxChars: { type: "NUMBER", description: "Optional maximum returned characters for the whole bundle." }
              },
              required: ["files"]
            }
          },
          {
            name: "inspect_code_context",
            description: "Builds one consolidated exact-source context packet for a code question. Use this when you need implementation, callers, imports, and related tests without spending many turns on grep/read cycles. The backend performs local symbol and lexical retrieval, expands hits to complete functions/classes, merges overlapping ranges, and returns exact code sections with line numbers. Summaries are not substituted for code needed for edits.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "What you need to understand, debug, or change." },
                paths: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Optional relative paths to prioritize. Omit when location is unknown."
                },
                symbols: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Optional function/class/variable names to retrieve definitions and callers for."
                },
                include: {
                  type: "ARRAY",
                  items: { type: "STRING", enum: ["definitions", "callers", "imports", "tests"] },
                  description: "Context kinds to include. Defaults to definitions/imports/tests."
                },
                budgetTokens: { type: "NUMBER", description: "Approximate source-token budget for the returned packet. Defaults to 18000." },
                contextLines: { type: "NUMBER", description: "Fallback surrounding lines for lexical hits outside symbols." },
                expand: { type: "BOOLEAN", description: "When true, search beyond provided paths for related files." }
              }
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
                    startLine: { type: "NUMBER", description: "1-based start line for replace_range. WARNING: every prior edit to this file can shift line numbers. Before any replace_range call, re-read the file or targeted section to get current line numbers; stale numbers from before a previous edit can corrupt the file." },
                    endLine: { type: "NUMBER", description: "1-based end line for replace_range. WARNING: every prior edit to this file can shift line numbers. Before any replace_range call, re-read the file or targeted section to get current line numbers; stale numbers from before a previous edit can corrupt the file." },
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
            name: "fetch_page",
            description: "Fetches and parses a web page from a URL. Great for reading documentation, API references, or any external link.",
            parameters: {
              type: "OBJECT",
              properties: {
                url: { type: "STRING", description: "The full URL to fetch." }
              },
              required: ["url"]
            }
          },
          {
            name: "git_diff",
            description: "Gets the current git diff for the workspace or a specific file.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Optional relative path to a specific file to diff." }
              }
            }
          },
          {
            name: "git_rollback",
            description: "Rolls back changes to a specific file using git checkout HEAD.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path to the file to roll back." }
              },
              required: ["path"]
            }
          },
          {
            name: "edit_config",
            description: "Safely edits a JSON config file (like package.json or .orionrc) by merging key-value pairs without risking syntax errors.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path to the JSON file." },
                updates: {
                  type: "OBJECT",
                  description: "An object containing key-value pairs to update in the config. Values can be deeply nested.",
                  additionalProperties: true
                }
              },
              required: ["path", "updates"]
            }
          },
          {
            name: "get_file_symbols",
            description: "Returns signatures and line ranges for classes, methods, and functions in a single JS/TS/JSX/TSX or Python file.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "The path to the file." }
              },
              required: ["path"]
            }
          },
          {
            name: "semantic_search",
            description: "Performs a vector-based semantic search across the workspace to find code by meaning rather than exact string matching. HIGHLY RECOMMENDED as your first step when exploring an unfamiliar codebase, looking for where a concept is implemented, or when you don't know the exact variable names. Semantic similarity scores do not prove relevance; always cross-check top results with targeted read_file or grep_search before treating them as the authoritative location.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "The semantic query to search for (e.g. 'where does user authentication happen')." }
              },
              required: ["query"]
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
            name: "run_linter",
            description: "Runs a proactive structured linter (eslint, tsc, or ruff) and returns a clean array of errors.",
            parameters: {
              type: "OBJECT",
              properties: {
                linterType: { type: "STRING", description: "The type of linter to run: 'eslint', 'tsc', or 'ruff'." },
                targetPath: { type: "STRING", description: "The path to lint (default is '.')." }
              },
              required: ["linterType"]
            }
          },
          {
            name: "find_references",
            description: "Finds usages of a function or variable across the workspace. Call this BEFORE renaming, removing, or changing the signature of any function so every caller can be updated. Uses AST validation for JS/TS to filter false positives from string literals and comments.",
            parameters: {
              type: "OBJECT",
              properties: {
                symbolName: { type: "STRING", description: "The literal string name of the symbol to find references for." },
                targetPath: { type: "STRING", description: "Optional path restriction (default is '.')." }
              },
              required: ["symbolName"]
            }
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
            description: "Sets the task checklist in the side panel. Pass an array of items with a status ('pending', 'in-progress', 'completed'). Use this to mark tasks as 'in-progress' when you start them and 'completed' when done. Do not call repeatedly for the same state.",
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
            name: "grep_search",
            description: "Searches file contents across the workspace. DEFAULT MODE IS LITERAL SUBSTRING MATCHING, not regex — 'foo|bar' matches lines containing foo OR bar (pipe alternation is supported literally), but \\b, .*, (), [] and other regex syntax are matched as literal characters unless you pass regex: true. Returns matching file paths, line numbers, and the matched line text. Use this before writing new code that depends on an existing pattern — e.g. to find how other similar UI elements wire up event listeners before adding one, or to find every call site of a function before renaming it. Prefer this over reading whole files when you just need to locate where something is defined or used. A zero-match result for a pattern you expected to hit is a signal to re-check your pattern mode and try a simpler single-token search — never conclude code is absent from one zero-match search.",
            parameters: {
              type: "OBJECT",
              properties: {
                pattern: { type: "STRING", description: "The text to search for. Literal by default; '|' separates literal alternatives. Set regex: true for real regex syntax." },
                regex: { type: "BOOLEAN", description: "Treat pattern as a regular expression. Defaults to false (literal substring match with '|' alternation)." },
                caseSensitive: { type: "BOOLEAN", description: "Case-sensitive match. Defaults to false." },
                filePattern: { type: "STRING", description: "Optional file extension filter, e.g. '.js' or '.html'. Searches all text files if omitted." },
                maxResults: { type: "NUMBER", description: "Maximum number of matches to return before truncation. Defaults to 100." },
                contextLines: { type: "NUMBER", description: "Optional number of surrounding lines to include before and after each match. Defaults to 0; use 2-3 when the matched line alone is not enough to understand the call site." }
              },
              required: ["pattern"]
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
            name: "remember_file_notes",
            description: "Saves a concise 1-3 line understanding of a workspace file you just read, bound to the file's exact current content version. On future tasks, files whose bytes are unchanged surface these notes in the [FILE KNOWLEDGE] brief so you can skip re-reading them; if the file changes, the notes are dropped automatically. Save notes after substantively reading a file you are likely to work with again (role, key responsibilities, landmark functions/line areas). Do not paste source code.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Workspace-relative path of the file the notes describe." },
                notes: { type: "STRING", description: "1-3 line digest of what the file is and where its important parts live. Max ~400 chars." }
              },
              required: ["path", "notes"]
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
                category: { type: "STRING", description: "Optional category, e.g. architecture, api, gotcha, preference." },
                pinned: { type: "BOOLEAN", description: "Keep this durable identity fact eligible for recall even after normal age filtering." }
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
                workspacePath: { type: "STRING", description: "Optional workspace path override (project scope only)." },
                pinned: { type: "BOOLEAN", description: "Keep this durable preference eligible for recall even after normal age filtering." }
              },
              required: ["text"]
            }
          },
          {
            name: "recall_memory",
            description: "Read typed memory for the given scope. Use scope=conversation with a focused query when the user asks what was said earlier; returned conversationEvidence is the only memory source that licenses explicit recall claims.",
            parameters: {
              type: "OBJECT",
              properties: {
                scope: { type: "STRING", description: "global, project, conversation, recent, or all (default: project)." },
                query: { type: "STRING", description: "Focused retrieval query. Required for conversation scope and useful with recent/all." },
                workspacePath: { type: "STRING", description: "Optional workspace path override." }
              }
            }
          },
          {
            name: "terminal_exec",
            description: "Run a shell command in a terminal session that retains its working directory between calls. Environment variables and activated shells do not persist because each call starts a fresh process; include those setup steps in each command when needed. For single stateless commands, prefer run_command.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: { type: "STRING", description: "PowerShell command to run inside the tracked session working directory." },
                sessionId: { type: "STRING", description: "Optional: name of the persistent session (default: 'default'). Use different IDs to maintain separate parallel sessions." },
                resetSession: { type: "BOOLEAN", description: "If true, clears all session state (cwd resets to workspace root, env vars cleared) before running the command." },
                timeoutMs: { type: "NUMBER", description: "Optional timeout in milliseconds (default 60000)." }
              },
              required: ["command"]
            }
          },
          {
            name: "db_query",
            description: "Execute one technically enforced read-only SQL query against SQLite, Postgres, or MySQL. Mutating keywords and multiple statements are blocked; SQLite opens in read-only mode and remote queries run inside read-only transactions. Connection passwords are passed through child-process environment variables, not command-line arguments.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "One read-only SQL statement. Examples: 'SELECT * FROM users LIMIT 10' or 'PRAGMA table_info(orders)'." },
                dbPath: { type: "STRING", description: "Absolute path to a local SQLite file (e.g. 'C:\\\\Users\\\\Owner\\\\projects\\\\app\\\\db.sqlite'). Use for SQLite databases." },
                connectionString: { type: "STRING", description: "Connection string for Postgres (e.g. 'postgresql://user:pass@localhost:5432/dbname') or MySQL. Use for remote/server databases." },
                dbType: { type: "STRING", description: "Optional: 'sqlite', 'postgres', or 'mysql'. Auto-detected from parameters if omitted." },
                timeoutMs: { type: "NUMBER", description: "Optional timeout in milliseconds (default 30000)." }
              },
              required: ["query"]
            }
          },
          {
            name: "inspect_environment",
            description: "Run a read-only introspection command against the user's environment — check package versions, running processes, port usage, environment variables, or other system state. Only safe, non-mutating commands are permitted; write operations, package installs, server starts, and destructive commands are blocked. Use this instead of handing off to Coder just to verify a version, check if a port is in use, or confirm a process is running.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: { type: "STRING", description: "The shell command to run. Must be read-only / introspection-only. Examples: 'node -v', 'python --version', 'pip show requests', 'lsof -i :3000', 'netstat -an | findstr 5000', 'Get-Process | Where-Object {$_.Name -like \"*node*\"}', 'echo %NODE_ENV%', 'git status', 'dir /b', 'npm list --depth=0'." },
                workspacePath: { type: "STRING", description: "Optional: path to run the command in. Defaults to the project workspace if set." }
              },
              required: ["command"]
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
  ];
  if (activeConversationMode === 'orion') {
    return allTools.filter(tool => DISPATCH_TOOL_ALLOWLIST.has(tool.name));
  }
  return allTools;
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
  const systemInstruction = getSystemInstruction(disableTools, orionCachedMemoryBlock, modelName);
  
  const ollamaTools = convertGeminiToOllamaTools([
    {
      functionDeclarations: buildAgentToolDeclarations()
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

// ── ANTHROPIC (CLAUDE) PROVIDER ────────────────────────────────────────────────
// Mirrors the Ollama provider's shape: convert the canonical Gemini-format tool schema and
// message history into Anthropic's format, POST to the Messages API, then normalize the reply
// back to Gemini's `candidates[0].content.parts` so the rest of the agent loop is provider-agnostic.

// Gemini declares schema types in uppercase (OBJECT/STRING/ARRAY/...). Anthropic's input_schema is
// plain JSON Schema (lowercase). Recurse so nested object properties and array items convert too.
function lowercaseJsonSchemaTypes(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (typeof schema.type === 'string') schema.type = schema.type.toLowerCase();
  if (schema.properties && typeof schema.properties === 'object') {
    for (const key in schema.properties) lowercaseJsonSchemaTypes(schema.properties[key]);
  }
  if (schema.items) lowercaseJsonSchemaTypes(schema.items);
  return schema;
}

function convertGeminiToAnthropicTools(declarations) {
  return (declarations || []).map(fd => {
    const inputSchema = lowercaseJsonSchemaTypes(JSON.parse(JSON.stringify(fd.parameters || {})));
    if (!inputSchema.type) inputSchema.type = 'object';
    if (!inputSchema.properties) inputSchema.properties = {};
    return {
      name: fd.name,
      description: fd.description,
      input_schema: inputSchema
    };
  });
}

// Anthropic requires every tool_use block to carry an id that its matching tool_result references
// by tool_use_id. The Gemini message shape has no ids — it pairs a model turn's functionCalls with
// the very next tool turn's functionResponses positionally — so we synthesize ids deterministically
// as we walk the history in order, remembering the ids from the latest assistant turn to attach to
// the tool_results that follow it.
function convertGeminiToAnthropicMessages(geminiMessages) {
  const out = [];
  let toolUseCounter = 0;
  let lastToolUseIds = [];

  (geminiMessages || []).forEach(msg => {
    if (msg.role === 'user') {
      const blocks = [];
      (msg.parts || []).forEach(p => {
        if (p.text) blocks.push({ type: 'text', text: p.text });
        if (p.inlineData) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data }
          });
        }
      });
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(no content)' });
      out.push({ role: 'user', content: blocks });
    } else if (msg.role === 'model') {
      const blocks = [];
      lastToolUseIds = [];
      (msg.parts || []).forEach(p => {
        if (p.text) blocks.push({ type: 'text', text: p.text });
        if (p.functionCall) {
          const id = `toolu_orion_${toolUseCounter++}`;
          lastToolUseIds.push(id);
          blocks.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args || {} });
        }
      });
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(no content)' });
      out.push({ role: 'assistant', content: blocks });
    } else if (msg.role === 'tool') {
      const blocks = [];
      let idx = 0;
      (msg.parts || []).forEach(p => {
        if (p.functionResponse) {
          const responseObj = p.functionResponse.response || {};
          const content = typeof responseObj === 'object' ? JSON.stringify(responseObj) : String(responseObj);
          const toolUseId = lastToolUseIds[idx] || `toolu_orion_orphan_${toolUseCounter++}`;
          idx++;
          blocks.push({ type: 'tool_result', tool_use_id: toolUseId, content });
        }
      });
      if (blocks.length > 0) out.push({ role: 'user', content: blocks });
    }
  });

  // Anthropic wants strictly alternating roles; Orion occasionally emits two user-role messages in a
  // row (e.g. a tool_result immediately followed by injected steering/system text). Merge adjacent
  // same-role messages, normalizing string content into text blocks so mixed content stays valid.
  const merged = [];
  out.forEach(msg => {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      const toBlocks = (c) => Array.isArray(c) ? c : [{ type: 'text', text: String(c) }];
      prev.content = [...toBlocks(prev.content), ...toBlocks(msg.content)];
    } else {
      merged.push({ role: msg.role, content: msg.content });
    }
  });
  return merged;
}

function getAnthropicMaxTokens(modelName) {
  // Opus/Sonnet handle large outputs; keep a generous but bounded ceiling for agent turns.
  if (/opus|sonnet|fable/.test(modelName)) return 16384;
  return 8192;
}

async function callAnthropicAPI(messages, modelName, apiKey, onWarning, disableTools = false, options = {}) {
  if (!apiKey) throw createNonRetryableModelError('Anthropic API key is not configured. Add it in Settings to use Claude models.');
  const url = 'https://api.anthropic.com/v1/messages';

  // In the disable-tools analysis phase, strip tool blocks entirely (same as the Gemini path) so we
  // never send tool_use/tool_result without a tools array, which Anthropic rejects.
  const processedMessages = disableTools ? sanitizeMessagesForTextOnly(messages) : messages;
  const anthropicMessages = convertGeminiToAnthropicMessages(processedMessages);

  const systemText = getSystemInstruction(disableTools, orionCachedMemoryBlock, modelName);

  const requestBody = {
    model: modelName,
    max_tokens: getAnthropicMaxTokens(modelName),
    temperature: 0,
    system: systemText,
    messages: anthropicMessages
  };
  if (!disableTools) {
    requestBody.tools = convertGeminiToAnthropicTools(buildAgentToolDeclarations());
  }

  const attempts = MODEL_API_MAX_ATTEMPTS;
  let delay = 1500;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(requestBody),
        signal: options.signal
      }, MODEL_API_REQUEST_TIMEOUT_MS, 'Anthropic messages request');

      if (response.ok) {
        const data = await response.json();
        const parts = [];
        (data.content || []).forEach(block => {
          if (block.type === 'text' && block.text) parts.push({ text: block.text });
          else if (block.type === 'tool_use') parts.push({ functionCall: { name: block.name, args: block.input || {} } });
        });
        return { _orionActiveModelName: modelName, candidates: [{ content: { parts } }] };
      }

      const errorText = await response.text();
      const status = response.status;
      const apiError = describeModelApiError(status, errorText);
      const retryDelayMs = Math.min(apiError.retryDelayMs || delay, MODEL_API_MAX_RETRY_WAIT_MS);

      // Auth, billing, and malformed-request failures are not worth retrying.
      if (isNonRetryableModelHttpStatus(status)) {
        throw createNonRetryableModelError(`Anthropic API HTTP ${status}: ${apiError.message}`);
      }
      if (i === attempts) {
        throw new Error(`Anthropic API HTTP ${status} after ${attempts} attempts: ${apiError.message}`);
      }
      if (onWarning) onWarning(`Anthropic API HTTP ${status} for ${modelName}; retrying in ${Math.ceil(retryDelayMs / 1000)}s (attempt ${i}/${attempts}).`);
      await sleepRespectingStop(retryDelayMs);
      delay = Math.min(delay * 2, MODEL_API_MAX_RETRY_WAIT_MS);
    } catch (err) {
      if (err && err.nonRetryable) throw err;
      if (isUserStopError && isUserStopError(err)) throw err;
      if (i === attempts) throw err;
      if (onWarning) onWarning(`Anthropic API request failed (${err.message}); retrying (attempt ${i}/${attempts}).`);
      await sleepRespectingStop(delay);
      delay = Math.min(delay * 2, MODEL_API_MAX_RETRY_WAIT_MS);
    }
  }
  throw new Error('Anthropic API: exhausted retries.');
}

// ── DEEPSEEK PROVIDER ───────────────────────────────────────────────────────────
// DeepSeek's API is OpenAI-compatible chat completions: POST https://api.deepseek.com/chat/completions
// with Authorization: Bearer <key>, an OpenAI-shaped tools array, and tool_calls/tool_call_id
// threading in the message history (flatter than Anthropic's nested content blocks — one
// {role:'tool', tool_call_id, content} message per tool call, not a content-block array).

function convertGeminiToDeepSeekTools(declarations) {
  return (declarations || []).map(fd => ({
    type: 'function',
    function: {
      name: fd.name,
      description: fd.description,
      parameters: lowercaseJsonSchemaTypes(JSON.parse(JSON.stringify(fd.parameters || { type: 'OBJECT', properties: {} })))
    }
  }));
}

function convertGeminiToDeepSeekMessages(geminiMessages) {
  const out = [];
  let toolCallCounter = 0;
  let lastToolCallIds = [];

  (geminiMessages || []).forEach(msg => {
    if (msg.role === 'user') {
      const blocks = [];
      (msg.parts || []).forEach(p => {
        if (p.text) blocks.push({ type: 'text', text: p.text });
        if (p.inlineData) {
          blocks.push({
            type: 'image_url',
            image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
          });
        }
      });
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(no content)' });
      out.push({ role: 'user', content: blocks });
    } else if (msg.role === 'model') {
      const textParts = (msg.parts || []).filter(p => p.text && !p.thought && !p._deepseekReasoningContent).map(p => p.text);
      const reasoningContent = (msg.parts || [])
        .filter(p => (p._deepseekReasoningContent || p.thought) && p.text)
        .map(p => p.text)
        .join('');
      const toolCalls = [];
      lastToolCallIds = [];
      (msg.parts || []).forEach(p => {
        if (p.functionCall) {
          const id = p.functionCall._deepseekToolCallId || p._deepseekToolCallId || `call_orion_${toolCallCounter++}`;
          lastToolCallIds.push(id);
          toolCalls.push({ id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } });
        }
      });
      const joinedText = textParts.join('');
      const assistantMsg = { role: 'assistant', content: joinedText || (reasoningContent ? "" : null) };
      // DeepSeek thinking mode requires reasoning_content to be passed back on every
      // assistant turn that performed tool calls. Older/sanitized Orion histories may have
      // tool calls without the hidden reasoning part; include a minimal continuity marker so
      // DeepSeek does not reject the whole request with a 400.
      if (reasoningContent) {
        assistantMsg.reasoning_content = reasoningContent;
      } else if (toolCalls.length > 0) {
        assistantMsg.reasoning_content = '[Orion internal note: reasoning_content was not preserved for this earlier tool-call turn; continue from the tool calls and tool results.]';
      }
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      out.push(assistantMsg);
    } else if (msg.role === 'tool') {
      let idx = 0;
      (msg.parts || []).forEach(p => {
        if (p.functionResponse) {
          const responseObj = p.functionResponse.response || {};
          const content = typeof responseObj === 'object' ? JSON.stringify(responseObj) : String(responseObj);
          const toolCallId = lastToolCallIds[idx] || `call_orion_orphan_${toolCallCounter++}`;
          idx++;
          out.push({ role: 'tool', tool_call_id: toolCallId, content });
        }
      });
    }
  });
  return out;
}

const DEEPSEEK_CONTEXT_WINDOW_TOKENS = 1048565;
const DEEPSEEK_SAFE_INPUT_RATIO = 0.90;

function estimateDeepSeekRequestTokens(messages, modelName, systemText, tools) {
  const request = {
    model: modelName,
    messages: [{ role: 'system', content: systemText }, ...convertGeminiToDeepSeekMessages(messages)],
    thinking: { type: 'enabled' },
    reasoning_effort: modelName === 'deepseek-v4-pro' ? 'max' : 'high',
    temperature: 0
  };
  if (Array.isArray(tools) && tools.length > 0) request.tools = tools;
  // One token per UTF-8 byte is a deliberately conservative upper bound. Normal
  // prose and source are much cheaper, but high-entropy or malformed tool output
  // can tokenize far more densely than the usual four-characters-per-token rule.
  return new TextEncoder().encode(JSON.stringify(request)).length;
}

function fitDeepSeekMessagesToContextWindow(messages, modelName, systemText, tools, options = {}) {
  const configuredLimit = Number(options.maxInputTokens);
  const maxInputTokens = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : Math.floor(DEEPSEEK_CONTEXT_WINDOW_TOKENS * DEEPSEEK_SAFE_INPUT_RATIO);
  let fitted = Array.isArray(messages) ? messages : [];
  let estimatedTokens = estimateDeepSeekRequestTokens(fitted, modelName, systemText, tools);
  if (estimatedTokens <= maxInputTokens) {
    return { messages: fitted, estimatedTokens, collapsedToolResults: 0, maxInputTokens };
  }

  const candidates = [];
  fitted.forEach((message, messageIndex) => {
    if (!message || message.role !== 'tool' || !Array.isArray(message.parts)) return;
    message.parts.forEach((part, partIndex) => {
      const name = part && part.functionResponse && part.functionResponse.name;
      if (!name || !TRIMMABLE_TOOL_RESULT_NAMES.has(name)) return;
      let serialized = '';
      try {
        serialized = JSON.stringify(part.functionResponse.response || {});
      } catch (_) {
        return;
      }
      if (serialized.length > TOOL_RESULT_TRIM_THRESHOLD_CHARS) {
        candidates.push({ messageIndex, partIndex, name, originalLength: serialized.length });
      }
    });
  });

  let collapsedToolResults = 0;
  for (const candidate of candidates) {
    if (estimatedTokens <= maxInputTokens) break;
    const message = fitted[candidate.messageIndex];
    const parts = [...message.parts];
    parts[candidate.partIndex] = {
      functionResponse: {
        name: candidate.name,
        response: {
          trimmed: true,
          contextOverflowPrevented: true,
          originalLength: candidate.originalLength,
          note: `This ${candidate.name} output was too large to fit safely in the DeepSeek request. Use inspect_code_context, get_file_symbols, grep_search with contextLines, or a narrower read_file range to retrieve the exact relevant source.`
        }
      }
    };
    fitted = fitted.slice();
    fitted[candidate.messageIndex] = { ...message, parts };
    collapsedToolResults += 1;
    estimatedTokens = estimateDeepSeekRequestTokens(fitted, modelName, systemText, tools);
  }

  if (estimatedTokens > maxInputTokens) {
    throw createNonRetryableModelError(
      `Orion blocked an oversized DeepSeek request locally (${estimatedTokens} estimated input tokens; safe limit ${maxInputTokens}). `
      + 'The remaining context is not reducible tool output. Start a new task or compact the conversation before retrying.'
    );
  }
  return { messages: fitted, estimatedTokens, collapsedToolResults, maxInputTokens };
}

async function callDeepSeekAPI(messages, modelName, apiKey, onWarning, disableTools = false, options = {}) {
  if (!apiKey) throw createNonRetryableModelError('DeepSeek API key is not configured. Add it in Settings to use DeepSeek models.');
  const url = 'https://api.deepseek.com/chat/completions';

  const processedMessages = disableTools ? sanitizeMessagesForTextOnly(messages) : messages;
  const systemText = getSystemInstruction(disableTools, orionCachedMemoryBlock, modelName);
  const deepseekTools = disableTools ? undefined : convertGeminiToDeepSeekTools(buildAgentToolDeclarations());
  const fitted = fitDeepSeekMessagesToContextWindow(processedMessages, modelName, systemText, deepseekTools, options);
  if (fitted.collapsedToolResults > 0 && onWarning) {
    onWarning(`Context safety collapsed ${fitted.collapsedToolResults} oversized tool result(s) before calling ${modelName}. Orion will retrieve narrower exact source instead.`);
  }
  const deepseekMessages = [{ role: 'system', content: systemText }, ...convertGeminiToDeepSeekMessages(fitted.messages)];

  const requestBody = {
    model: modelName,
    messages: deepseekMessages,
    thinking: { type: 'enabled' },
    reasoning_effort: modelName === 'deepseek-v4-pro' ? 'max' : 'high',
    temperature: 0
  };
  if (!disableTools) requestBody.tools = deepseekTools;

  const attempts = MODEL_API_MAX_ATTEMPTS;
  let delay = 1500;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: options.signal
      }, MODEL_API_REQUEST_TIMEOUT_MS, 'DeepSeek chat completions request');

      if (response.ok) {
        const data = await response.json();
        const message = (data.choices && data.choices[0] && data.choices[0].message) || {};
        const finishReason = data.choices && data.choices[0] && data.choices[0].finish_reason;
        const parts = [];
        if (message.reasoning_content) parts.push({ text: message.reasoning_content, thought: true, _deepseekReasoningContent: true });
        if (message.content) parts.push({ text: message.content });
        
        if (finishReason === 'length') {
          parts.push({ functionCall: { name: "SYSTEM_ERROR", args: { error: "Your output was truncated because it exceeded the maximum token limit. This often happens if you output too many <think> reasoning tokens before taking action, or if you attempt to rewrite a massive file. Try again, but keep your internal reasoning much shorter and use patch_file for smaller, targeted edits." } } });
        }
        
        (message.tool_calls || []).forEach(tc => {
          let args = tc.function && tc.function.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch (_) { args = {}; }
          }
          const functionCall = { name: tc.function.name, args: args || {} };
          if (tc.id) functionCall._deepseekToolCallId = tc.id;
          parts.push({ functionCall });
        });
        return { _orionActiveModelName: modelName, candidates: [{ content: { parts } }] };
      }

      const errorText = await response.text();
      const status = response.status;
      const apiError = describeModelApiError(status, errorText);
      const retryDelayMs = Math.min(apiError.retryDelayMs || delay, MODEL_API_MAX_RETRY_WAIT_MS);

      if (isNonRetryableModelHttpStatus(status)) {
        throw createNonRetryableModelError(`DeepSeek API HTTP ${status}: ${apiError.message}`);
      }
      if (i === attempts) {
        throw new Error(`DeepSeek API HTTP ${status} after ${attempts} attempts: ${apiError.message}`);
      }
      if (onWarning) onWarning(`DeepSeek API HTTP ${status} for ${modelName}; retrying in ${Math.ceil(retryDelayMs / 1000)}s (attempt ${i}/${attempts}).`);
      await sleepRespectingStop(retryDelayMs);
      delay = Math.min(delay * 2, MODEL_API_MAX_RETRY_WAIT_MS);
    } catch (err) {
      if (err && err.nonRetryable) throw err;
      if (isUserStopError && isUserStopError(err)) throw err;
      if (i === attempts) throw err;
      if (onWarning) onWarning(`DeepSeek API request failed (${err.message}); retrying (attempt ${i}/${attempts}).`);
      await sleepRespectingStop(delay);
      delay = Math.min(delay * 2, MODEL_API_MAX_RETRY_WAIT_MS);
    }
  }
  throw new Error('DeepSeek API: exhausted retries.');
}

// Lightweight per-turn token savings, distinct from compactHistory's heavyweight summarization
// (which only triggers near the context-window threshold). Old, large, read-only tool outputs
// (a full directory listing, a large file read, a search result) are still resent on every
// subsequent API call even though the model rarely needs to re-see the exact bytes once a few
// turns have passed — it either already acted on that information or would re-run the tool if it
// needed the data again. Only read-only/inventory tools are eligible: never trim edit/write/test
// results (patch_file, write_file, modify_file, run_tests, etc.), since those carry the actual
// evidence the completion gate and verification logic depend on.
const TOOL_RESULT_TRIM_THRESHOLD_CHARS = 1500;
const TOOL_RESULT_TRIM_KEEP_RECENT_MESSAGES = 3;
const TRIMMABLE_TOOL_RESULT_NAMES = new Set([
  'list_files', 'read_file', 'read_multiple_files', 'read_multiple_ranges', 'inspect_code_context',
  'grep_search', 'semantic_search', 'search_embeddings', 'get_symbol_index', 'get_file_symbols', 'find_references', 'read_command_output',
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
  if (apiKey) {
    return await inspectScreenshotWithGemini({ imageBase64, mimeType, path, goal, modelName: 'gemini-2.5-flash', apiKey });
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
  }, MODEL_API_REQUEST_TIMEOUT_MS, 'Ollama vision screenshot inspection').catch(err => {
    throw new Error(`Could not connect to Ollama at localhost:11434 (${err.message}). Is Ollama running?`);
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama vision inspection failed HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data && data.message && data.message.content;
  return normalizeScreenshotInspectionResult({ text, path, goal, providerName: modelName });
}

// ── Quick single-turn LLM call for Orion's conversational layer (no tools) ─────
window.quickOrionLLMCall = async function(systemPrompt, userMessages, config) {
  // userMessages: array of { role: 'user'|'assistant', content: string }
  // Returns: string response text, or throws
  const modelName = config.modelName || '';
  const messages = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood.' }] },
    ...userMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || m.text || '') }]
    }))
  ];

  let resp;
  if (/anthropic|claude/i.test(modelName)) {
    resp = await callAnthropicAPI(messages, modelName, config.anthropicApiKey || '', () => {}, true);
  } else if (/deepseek/i.test(modelName)) {
    resp = await callDeepSeekAPI(messages, modelName, config.deepseekApiKey || '', () => {}, true);
  } else {
    resp = await callGeminiAPI(messages, modelName || 'gemini-2.5-flash', config.geminiApiKey || '', () => {}, true);
  }

  const text = resp && (resp.text || (resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts && resp.candidates[0].content.parts[0] && resp.candidates[0].content.parts[0].text) || '');
  return String(text).trim();
};

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
      parts: [{ text: getSystemInstruction(disableTools, orionCachedMemoryBlock, modelName) }]
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
        // Coding tasks can include aggressive content in test data / user message fixtures.
        // BLOCK_ONLY_HIGH avoids false positives while still filtering obvious harassment.
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_ONLY_HIGH"
      },
      {
        // Hate speech has no legitimate presence in code generation — BLOCK_MEDIUM is fine.
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_MEDIUM_AND_ABOVE"
      },
      {
        // Sexually explicit content has no legitimate presence in code generation.
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE"
      },
      {
        // Security code, file system ops, network code, and shell commands legitimately
        // trigger DANGEROUS_CONTENT. BLOCK_NONE is required for a coding agent.
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE"
      }
    ],
    tools: [
      {
        functionDeclarations: buildAgentToolDeclarations()
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
async function countTokens(messages, modelName, config, options = {}) {
  if (!modelName.startsWith('gemini-')) {
    return JSON.stringify(messages).length / 4;
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:countTokens?key=${config.geminiApiKey}`;
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
async function compactHistory(messages, modelName, config) {
  // Format history for the summarizer prompt
  let logLines = [];
  messages.forEach(m => {
    const roleName = m.role === 'user' ? 'User' : 'Assistant';
    let contentText = "";
    if (m.parts) {
      m.parts.forEach(p => {
        if (p.text) contentText += p.text;
        if (p.functionCall) contentText += ` [Called Tool: ${p.functionCall.name}]`;
        if (p.functionResponse) {
          const resp = p.functionResponse.response || {};
          let out = '';
          if (resp.error) {
            out = `Error: ${String(resp.error).slice(0, 500)}`;
          } else {
            out = "Success (details omitted for compaction)";
          }
          contentText += ` [Tool Output: ${out}]`;
        }
      });
    }
    logLines.push(`${roleName}: ${contentText}`);
  });

  // Dynamic Summarizer Overflow Protection
  // getCompactionThreshold already returns ~82% of the raw model budget.
  // We use 70% of that (roughly 57% of total raw token capacity) as a safe ceiling for the summarizer prompt.
  const thresholdTokens = getCompactionThreshold(modelName, config) || 128000;
  const MAX_CHARS = Math.floor((thresholdTokens * 4) * 0.70);
  
  let finalLogs = [];
  let charCount = 0;
  for (let i = logLines.length - 1; i >= 0; i--) {
    if (charCount + logLines[i].length > MAX_CHARS && finalLogs.length > 2) {
      finalLogs.unshift("[... older messages truncated to fit summarizer context ...]");
      break;
    }
    finalLogs.unshift(logLines[i]);
    charCount += logLines[i].length;
  }
  
  const conversationLogsText = finalLogs.join('\n\n') + '\n\n';

  const summaryPrompt = `The following is a conversation history between a user and an AI pair programmer. Summarize the history, detailing:
1. The overall task and workspace directory.
2. Major modifications made to files.
3. Current task list status and remaining goals.
4. Any errors encountered and how they were resolved.
Keep the summary highly technical, extremely brief, and complete.

CONVERSATION HISTORY:
${conversationLogsText}`;

  const text = await callUtilityModel(summaryPrompt, modelName, config, false);
  const compactedSummary = text || "History compacted.";

  // Note: runAgent persists the summary and rebuilds its live API messages from conversation
  // state. The returned messages are kept for tests and provider paths that need a compacted
  // transcript while preserving model/tool adjacency.
  let tailStart = Math.max(0, messages.length - 3);
  if (messages[tailStart] && messages[tailStart].role === 'tool' && tailStart > 0 && messages[tailStart - 1].role === 'model') {
    tailStart -= 1;
  }
  const retainedTail = messages.slice(tailStart);
  return {
    summary: compactedSummary,
    messages: [
      { role: 'user', parts: [{ text: `Previous conversation summary:\n${compactedSummary}` }] },
      { role: 'model', parts: [{ text: 'Understood. I will continue from this compacted context.' }] },
      ...retainedTail
    ]
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
    mutateOperationalContext,
    readOperationalContext,
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
    isSubstantiveVisibleAnswer,
    answerHasInspectionGrounding,
    getReviewCoverage,
    answerHasGroundedReviewReport,
    buildReviewOnlyCompletionGatePrompt,
    isInventoryOnlyCommand,
    hasDeepInspectionEvidence,
    hasOnlyInventoryEvidence,
    buildFinalAnswerQualityGatePrompt,
    shouldHaveUsedToolsButDidNot,
    dispatchRequestRequiresCoderExecution,
    isDispatchExecutionDeflection,
    shouldForceDispatchHandoff,
    buildForcedDispatchHandoffPrompt,
    isFailedToolResult,
    getToolFailureSignal,
    buildToolEvidenceEntry,
    createContextAcquisitionLedger,
    recordContextAcquisitionToolResult,
    invalidateContextAcquisitionForFile,
    buildContextAcquisitionReceipt,
    getContextSectionsFromToolResult,
    rememberContextPacketForConversation,
    getHandoffContextPacketIds,
    loadInheritedContextReceipt,
    buildInheritedContextPrompt,
    inheritedContextSeenFiles,
    recordIncidentalIssueCandidate,
    formatIncidentalObservations,
    appendIncidentalObservationsToFinal,
    getEpistemicToolGate,
    buildEpistemicCorrectionPrompt,
    getCompactionThreshold,
    getAgentReadCharBudget,
    resolveAgentReadMaxChars,
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
    convertGeminiToAnthropicTools,
    convertGeminiToAnthropicMessages,
    callAnthropicAPI,
    convertGeminiToDeepSeekTools,
    convertGeminiToDeepSeekMessages,
    estimateDeepSeekRequestTokens,
    fitDeepSeekMessagesToContextWindow,
    callDeepSeekAPI,
    getNextModelForHighDemand,
    compactHistory,
    summarizeToolStart,
    buildRepeatedFailureKey,
    updateWalkthroughItem,
    buildSupervisorEvidencePacket,
    normalizeSupervisorDecision,
    evaluateLoopStateWithSupervisorDecision,
    buildPostEditEvidencePrompt,
    buildFinalVerificationSummary,
    buildCompletionGateLoopSignature,
    shouldEscapeRepeatedCompletionGateBlock,
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
  module.exports.evaluateLoopStateWithSupervisor = evaluateLoopStateWithSupervisor;
}
