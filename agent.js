// AGENT ENGINE FOR ANTIGRAVITY 2.0

// System Instruction for the Pair Programmer
const SYSTEM_INSTRUCTION = `You are Orion AI, the ultimate pair programmer agent running locally on the user's workspace.
Your goal is to solve the task given by the user with high quality, precision, and trust.

CRITICAL RULES:
1. PLANNING MODE DECISION: Match the process to the size of the request. Use an implementation plan only when the task is genuinely complex: new projects, multi-file builds, architecture changes, risky migrations, broad bug hunts, security-sensitive work, or requests where the user should review direction before code changes. For small fixes, running/opening a program, running tests, setting an entry point, showing paths, pushing when explicitly asked, or narrow follow-ups, act directly without creating implementation_plan.md. If a plan is needed, create "implementation_plan.md", set the checklist, show the plan in chat, and pause for explicit user approval or requested revisions before modifying source files or running commands.
2. TESTING AND REGRESSION DISCIPLINE: When you create or change code, you are responsible for producing run-ready code. Before meaningful edits, inspect existing tests and the detected regression command when relevant. After edits, run the appropriate tests or smoke checks using "run_tests", "run_command", or the long-running command tools. If tests fail, read the output, fix the issue, and rerun tests until they pass or you can clearly explain a blocker. For long tests, training, games, and servers, use "start_command" with a sensible timeout, check status/output, and stop processes with "kill_command" when finished. Do not start multiple copies of the same long-running program unless the previous one is stopped. Do not use an interactive command as a test unless you pipe/provide input or intentionally kill it after a short smoke check. Do not claim code works unless you ran a relevant check or state exactly why you could not.
3. WEB RESEARCH: If you are unsure about an API, library, framework, command, model parameter, error message, current behavior, or documentation detail, use "google_search" and then "fetch_web_page" on the most relevant official docs or primary source before editing. Do not invent configuration files or API shapes when files are missing or the correct implementation is unclear. Do not say you reviewed, checked, verified, or confirmed documentation unless you actually used these web tools in the current task and can name the source URL. If docs appear to say something surprising, quote or paraphrase the exact relevant rule before changing files.
4. CONTEXT INTEGRITY: Keep files clean, respect formatting, and preserve comments that are unrelated to your edits.
5. NOTES AND MEMORY: Use project/standalone notes as durable working memory. Read them when orienting, and update them when you learn durable facts: architecture, important files, commands, decisions, user preferences, gotchas, open tasks, test status, and future repair notes. Project notes are shared across every conversation in the same project; standalone notes belong only to that standalone conversation. Keep notes concise and useful, not a transcript.
6. DESIGN QUALITY: When creating apps, games, dashboards, or visual tools, make them visually polished and pleasant by default. Treat beauty, layout, typography, color, spacing, motion, and interaction feedback as part of "working." Avoid bare black boxes, default controls, tiny unstyled text, and placeholder-looking screens unless the user explicitly asks for minimal output. For games, include a cohesive visual theme, clear HUD, start/game-over states, readable controls, animation polish, and a satisfying feel.
7. FOLLOW-UP TIMERS: If you say you will wait, check back, continue after N seconds/minutes, or inspect long-running training/tests later, you MUST call "schedule_followup". Do not merely say you will wait. Schedule only one active follow-up for the same purpose; when the follow-up runs, actually inspect status/output and either continue work, stop the process, or clearly finish.
8. BE CONCISE: Explain your technical decisions briefly. The user can see your tools running and thoughts.
9. AUTONOMOUS WORKFLOW: Once the user approves your plan, execute all required file creations, edits, and test runs consecutively in a single session without yielding or waiting for further conversational input. For direct tasks that do not need a plan, execute them immediately and report the result. Keep calling tools until the entire task is fully complete.
10. TASK COMPLETION: You must use the "set_task_checklist" tool to update the status of each subtask as you work on them. Once all tasks are complete, update the checklist to show all tasks are 'completed', and then present your final summary.
11. RESPONSE FORMAT: Use clean GitHub-flavored Markdown. Prefer short sections with level-2 headings like "Summary", "Findings", "Plan", "Changes", "Tests", and "Next Steps". Use bullets for scan-friendly details, numbered lists only for ordered steps, and fenced code blocks for code. Do not write giant unbroken paragraphs. For code reviews or "look through the code" requests, lead with a brief summary, then specific findings with file/function references, then prioritized recommendations. When creating an implementation plan, put the detailed plan in implementation_plan.md and also show a readable approval summary in chat. At the end of any task that used tools, include a "Work Walkthrough" explaining what you actually did: files touched, commands/tests run, results, and remaining follow-up.
12. SECRETS AND ENVIRONMENT: When a project needs the user's Gemini API key, Google API key, or Google Search Engine ID, use "sync_workspace_env" to create or update workspace environment files. Do not hardcode secrets into source files, do not print secret values, and do not ask the user to paste keys you can sync from settings. Make code read secrets from environment variables such as GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID, and GOOGLE_CSE_ID. For browser-only/static apps, do not expose private API keys in client-side code; add a small local/server API layer instead.
13. GEMINI APP DEFAULTS: For new Gemini Python projects, prefer the current "google-genai" package and "from google import genai" unless local files already use a different SDK. The model "gemini-2.5-flash-lite" is valid; do not downgrade it to older model names unless official docs or an API error proves it is unavailable.
14. USER-REQUESTED LOCAL/GIT OPERATIONS: When the user asks for the active directory, to open the folder, to launch/run the program, or to push to GitHub/Git, use the dedicated tools for those actions. Do not push to Git or launch apps unless the user asked for it. If the user asks to push without specifying a branch, push the current branch to the default remote.

Tools available:
- list_files: List all files in the workspace (excluding node_modules).
- get_workspace_info: Return the active workspace directory and conversation scope.
- open_workspace_folder: Open the active workspace folder in the OS file explorer.
- launch_workspace_app: Launch the active workspace app using Orion's app detection.
- set_workspace_entrypoint: Set or clear the launch entry point command for this workspace.
- git_push: Push the current Git branch, or the current branch to a requested remote branch, when the user asks.
- read_file: Read a file's content. Use startLine/endLine or maxChars for large files.
- write_file: Write a new file or overwrite a file.
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
- google_search: Search Google for current docs, API references, examples, and troubleshooting.
- fetch_web_page: Fetch the text content of a specific web page found via search.
- sync_workspace_env: Safely write configured API keys/search IDs into .env-style files without exposing the secret values in chat or tool output.
- set_task_checklist: Set the UI checklist of tasks (array of {title, status}). Status can be 'pending', 'in-progress', 'completed'.`;

// Keep track of active agent running state
let isAgentRunning = false;
let runningConversationId = null;
let agentSubStatus = '';
let agentExecutionMode = 'idle';
let currentAgentLogs = [];
let isStopRequested = false;
const GEMINI_THINKING_BUDGET = 24576;

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
  window.appendSystemMessage("Stop requested... task will abort on next turn.");
};

// EXPOSE AGENT LOOP TO RENDERER
window.runAgentLoop = async function(userPrompt, modelName, conversation) {
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
  const workspacePath = conversation.workspace || window.getCurrentWorkspace();
  
  // Format message history for Gemini API
  let messages = [];
  
  // Convert LocalStorage conversation history to Gemini format
  // We keep user and model turns. System messages are skipped or added as user instructions
  conversation.messages.forEach(msg => {
    if (msg.role === 'user') {
      messages.push({ role: 'user', parts: [{ text: msg.text }] });
    } else if (msg.role === 'assistant') {
      if (msg.turns && msg.turns.length > 0) {
        msg.turns.forEach(turn => {
          messages.push({ role: 'model', parts: turn.modelParts });
          if (turn.toolResponseParts) {
            const sanitizedParts = JSON.parse(JSON.stringify(turn.toolResponseParts));
            sanitizedParts.forEach(p => {
              if (p.functionResponse && p.functionResponse.response !== undefined) {
                const resp = p.functionResponse.response;
                if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) {
                  p.functionResponse.response = { output: resp };
                }
              }
            });
            messages.push({ role: 'tool', parts: sanitizedParts });
          }
        });
      } else {
        // Fallback for simple text messages or old format
        if (msg.apiParts) {
          messages.push({ role: 'model', parts: msg.apiParts });
        } else {
          messages.push({ role: 'model', parts: [{ text: msg.text }] });
        }
        if (msg.apiToolResponseParts) {
          const sanitizedParts = JSON.parse(JSON.stringify(msg.apiToolResponseParts));
          sanitizedParts.forEach(p => {
            if (p.functionResponse && p.functionResponse.response !== undefined) {
              const resp = p.functionResponse.response;
              if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) {
                p.functionResponse.response = { output: resp };
              }
            }
          });
          messages.push({ role: 'tool', parts: sanitizedParts });
        }
      }
    }
  });
  
  // If the last message is user prompt, it's already in history. 
  // Let's make sure it's correct
  const lastMessageText = messages.length > 0 && messages[messages.length - 1].role === 'user'
    ? ((messages[messages.length - 1].parts || []).map(part => part.text || '').join(''))
    : '';
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user' || lastMessageText !== userPrompt) {
    messages.push({ role: 'user', parts: [{ text: userPrompt }] });
  }

  const scopedNotes = await readScopedNotes(workspacePath, conversation);
  if (scopedNotes.content && scopedNotes.content.trim()) {
    messages.unshift(
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

  let approvalIntent = null;
  if (conversation.awaitingPlanApproval && !conversation.planApproved) {
    approvalIntent = await classifyPlanApprovalIntent(userPrompt, modelName, config.geminiApiKey);
    if (approvalIntent.intent === 'approve') {
      conversation.planApproved = true;
      conversation.awaitingPlanApproval = false;
      window.appendSystemMessage("Plan approved. Continuing implementation.");
    } else if (approvalIntent.intent === 'deny') {
      conversation.awaitingPlanApproval = false;
      window.saveConversationsToStorage();
    }
  }

  let planningDecision = { mode: 'plan', reason: 'Planning mode is active.' };
  let planningBypassedForTask = false;
  if (config.planningMode !== false && !conversation.planApproved && !conversation.awaitingPlanApproval && !(approvalIntent && approvalIntent.intent === 'approve')) {
    planningDecision = await classifyPlanningNeed(userPrompt, modelName, config.geminiApiKey);
    if (planningDecision.mode === 'direct') {
      planningBypassedForTask = true;
      agentExecutionMode = 'direct';
      window.appendSystemMessage(`Planning mode: direct task, no implementation plan required. ${planningDecision.reason || ''}`.trim());
    } else if (planningDecision.mode === 'answer') {
      agentExecutionMode = 'answer';
    }
  } else if (conversation.planApproved) {
    planningDecision = { mode: 'direct', reason: 'An implementation plan has already been approved.' };
    agentExecutionMode = 'executing';
  }

  messages.push({
    role: 'user',
    parts: [{
      text: buildToolUseContractPrompt()
    }]
  });

  if (config.planningMode !== false) {
    messages.push({
      role: 'user',
      parts: [{
        text: `[SYSTEM: Planning decision for this user request: ${planningDecision.mode}. Reason: ${planningDecision.reason || 'No reason provided.'} ${planningBypassedForTask ? 'This is a direct task, so do not create implementation_plan.md unless new complexity appears during inspection.' : 'If this requires workspace changes and no plan is approved, create a real implementation plan and pause.'}]`
      }]
    });
  }

  if (conversation.awaitingPlanApproval && !conversation.planApproved && approvalIntent && approvalIntent.intent === 'revise') {
    messages.push({
      role: 'user',
      parts: [{
        text: '[SYSTEM: An implementation plan is awaiting approval. The latest user message was classified as plan feedback/revision, not approval. Do not execute destructive tools. Update or replace the plan if needed, then pause again.]'
      }]
    });
  }

  let lastTextResponse = "Thinking...";
  let aiMessageIndex = conversation.messages.length;
  let workWalkthrough = [];
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
        messages = compactResult.messages;
        persistCompactedConversation(conversation, compactResult.summary);
        await appendScopedNotes(workspacePath, conversation, `\n\n## Context Compaction ${new Date().toISOString()}\n${compactResult.summary}\n`);
        aiMessageIndex = conversation.messages.length;
        conversation.messages.push({ role: 'assistant', text: 'Thinking...', logs: [], turns: [] });
        window.saveConversationsToStorage();
      }
    } catch (e) {
      console.error("Token count/compacting error:", e);
    }
    
    // Run the agent execution loop (up to 15 steps to prevent runaway bills)
    let loopCount = 0;
    let maxLoops = 20;
    let forceYield = false;
    let consecutiveNoToolCalls = 0;
    let malformedCallsCount = 0;
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
      
      // Check if user steer input is available
      if (window.steeringQueue && window.steeringQueue.length > 0) {
        const steerText = window.steeringQueue.shift();
        currentAgentLogs.push({ type: 'thought', content: `🎯 Steered: "${steerText}"` });
        messages.push({ role: 'user', parts: [{ text: `[USER STEERING FEEDBACK: ${steerText}]` }] });
      }
      
      // Call API (Gemini or Ollama) with automatic transient error retry and warnings
      let response;
      try {
        agentSubStatus = `Calling ${modelName.startsWith('gemini-') ? 'Gemini' : 'Ollama (' + modelName + ')'} API...`;
        window.renderAiMessage(lastTextResponse, currentAgentLogs);
        
        if (modelName.startsWith('gemini-')) {
          response = await callGeminiAPI(messages, modelName, config.geminiApiKey, (warningMsg) => {
            currentAgentLogs.push({ type: 'thought', content: `⚠️ ${warningMsg}` });
            conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
            window.renderAiMessage(lastTextResponse, currentAgentLogs);
          });
        } else {
          response = await callOllamaAPI(messages, modelName, (warningMsg) => {
            currentAgentLogs.push({ type: 'thought', content: `⚠️ ${warningMsg}` });
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
        currentAgentLogs.push({ type: 'thought', content: textVal });
        lastTextResponse = textVal;
      }
      
      // Update live chat bubbles
      conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      window.renderAiMessage(conversation.messages[aiMessageIndex].text, currentAgentLogs);
      
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
        if (shouldHaveUsedToolsButDidNot(textVal, workWalkthrough) && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          messages.push({
            role: 'user',
            parts: [{
              text: '[SYSTEM: Your response appeared to promise or report workspace work, but no tools were called. If the task requires looking at files, running commands/tests, editing code, creating files, or verifying behavior, call the appropriate tools now. If no tools are needed, answer explicitly that no workspace action was needed and why.]'
            }]
          });
          continue;
        }
        if (pendingTasks.length > 0 && canExecuteThisTask() && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
          console.log(`No tool calls, but there are ${pendingTasks.length} pending tasks. Continuing loop automatically.`);
          
          // Append a system message instructing the model to continue
          const prompt = `[SYSTEM: You returned a response without calling any tools, but there are still pending tasks in the checklist: ${pendingTasks.map(t => `"${t.title}"`).join(', ')}. Please continue executing tools to complete the remaining tasks. If you believe a task is complete, use the "set_task_checklist" tool to update its status. When everything is fully complete and verified, output your final summary.]`;
          
          messages.push({ role: 'user', parts: [{ text: prompt }] });
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
          conversation.messages[aiMessageIndex].text = withWorkWalkthrough(lastTextResponse, workWalkthrough, false);
        }
        window.renderAiMessage(conversation.messages[aiMessageIndex].text || lastTextResponse, currentAgentLogs);
        
        // Safety gate for planning mode
        if (config.planningMode && !canExecuteThisTask()) {
          const destructiveTools = ['write_file', 'modify_file', 'patch_file', 'run_command', 'start_command', 'run_tests', 'sync_workspace_env', 'launch_workspace_app', 'git_push'];
          if (destructiveTools.includes(toolName)) {
            // Allow writing the implementation plan file itself before approval
            const isPlanWrite = toolName === 'write_file' && args.path && args.path.split(/[\\/]/).pop().toLowerCase() === 'implementation_plan.md';
            if (!isPlanWrite) {
              const errMsg = "Planning Mode Active: this request needs an implementation plan before file edits or command execution. Create implementation_plan.md, show the plan in chat, set the checklist, then pause for explicit approval or requested revisions.";
              
              currentAgentLogs[logIndex].status = 'error';
              currentAgentLogs[logIndex].result = errMsg;
              
              toolResponseParts.push({
                functionResponse: {
                  name: toolName,
                  response: { error: errMsg }
                }
              });
              continue;
            } else {
              forceYield = true;
            }
          }
        }
        
        // Execute the tool
        let result;
        try {
          result = await executeTool(toolName, args, workspacePath, config, conversation);
          currentAgentLogs[logIndex].status = 'success';
          currentAgentLogs[logIndex].result = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          updateWalkthroughItem(walkthroughItem, toolName, args, result, null);
        } catch (err) {
          console.error(err);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = err.message;
          result = { error: err.message };
          updateWalkthroughItem(walkthroughItem, toolName, args, result, err);
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
    
    // Ensure the final text and logs are written and rendered
    conversation.messages[aiMessageIndex].text = lastTextResponse;
    conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
    window.renderAiMessage(lastTextResponse, currentAgentLogs);
    
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
      if (typeof conversations !== 'undefined' && typeof activeConversationId !== 'undefined') {
        const targetId = nextTask.conversationId || activeConversationId;
        const activeConv = conversations.find(c => c.id === targetId);
        if (activeConv) {
          if (window.selectConversationById) {
            window.selectConversationById(targetId);
          } else {
            activeConversationId = targetId;
          }
          window.appendSystemMessage(`Executing queued prompt: "${nextTask.prompt}"`);
          if (!nextTask.alreadyRendered && window.renderUserMessageInChat) {
            window.renderUserMessageInChat(nextTask.prompt);
          }
          if (!nextTask.alreadyRendered && activeConv.messages) {
            activeConv.messages.push({ role: 'user', text: nextTask.prompt });
            if (window.saveConversationsToStorage) window.saveConversationsToStorage();
          }
          await window.runAgentLoop(nextTask.prompt, nextTask.modelSelectValue, activeConv);
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
      return files.map(f => ({ path: f.path, isDir: f.isDir, size: f.size }));
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
    
    case 'run_command': {
      if (!args.command) throw new Error("Missing 'command' parameter");
      
      const processId = `cmd_${conversation.id}_${Date.now()}`;
      let cmdOutput = '';
      
      // Setup output streamer listener
      const cleanOutput = window.api.onCommandOutput(processId, (data) => {
        cmdOutput += data.text;
      });
      
      const result = await window.api.runCommand(args.command, workspace, processId, args.timeoutMs || config.commandTimeoutMs || 120000);
      cleanOutput();
      
      return {
        exitCode: result.code,
        stdout: cmdOutput,
        stderr: result.error || '',
        timedOut: !!result.timedOut,
        killed: !!result.killed
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
    
    case 'run_tests': {
      const testRes = await window.runRegressionTests();
      return {
        success: testRes.success,
        output: testRes.output
      };
    }

    case 'google_search': {
      if (!args.query) throw new Error("Missing 'query' parameter");
      const apiKey = config.googleSearchApiKey || config.geminiApiKey;
      const searchEngineId = config.googleSearchEngineId;
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

    case 'sync_workspace_env': {
      return await syncWorkspaceEnv(workspace, config, args);
    }
    
    case 'set_task_checklist': {
      if (!args.tasks || !Array.isArray(args.tasks)) throw new Error("Missing 'tasks' array parameter");
      args.tasks = args.tasks.map(task => ({
        ...task,
        status: normalizeTaskStatus(task.status)
      }));
      
      // Update UI checklist
      window.updateTasksChecklist(args.tasks);
      
      // Update local storage representation in active conversation
      const activeConv = conversations.find(c => c.id === activeConversationId);
      if (activeConv) {
        activeConv.tasks = args.tasks;
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
    const searchApiKey = config.googleSearchApiKey || config.geminiApiKey;
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
    const exampleContent = Object.keys(values).map(key => `${key}=`).join('\n') + '\n';
    const exampleWrite = await window.api.writeFile(workspace, examplePath, exampleContent);
    if (exampleWrite.error) throw new Error(exampleWrite.error);
    writtenFiles.push(examplePath);
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
    
    if (window.selectConversationById) {
      window.selectConversationById(targetConversationId);
    } else if (typeof activeConversationId !== 'undefined') {
      activeConversationId = targetConversationId;
    }
    
    window.appendSystemMessage(`Scheduled follow-up running after ${delaySeconds} seconds.`);
    if (window.renderUserMessageInChat) {
      window.renderUserMessageInChat(prompt);
    }
    if (targetConv.messages) {
      targetConv.messages.push({ role: 'user', text: prompt });
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    }
    await window.runAgentLoop(prompt, modelSelectValue || (window.getSelectedModel ? window.getSelectedModel() : 'gemini-2.5-flash-lite'), targetConv);
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
  return `[SYSTEM: Before answering, decide whether the user's request requires interacting with the workspace or runtime. If it requires files, commands, tests, external docs, app state, timers, notes, or code changes, use the relevant tools before giving a final answer. If no tool is needed, answer normally and do not claim that work was performed. Never end with a generic completion message unless the Work Walkthrough shows what actually happened.]`;
}

function summarizeToolStart(toolName, args = {}) {
  if (toolName === 'read_file') return { toolName, status: 'running', label: `Read \`${args.path || 'file'}\`` };
  if (toolName === 'list_files') return { toolName, status: 'running', label: 'Listed workspace files' };
  if (toolName === 'get_workspace_info') return { toolName, status: 'running', label: 'Checked active workspace directory' };
  if (toolName === 'open_workspace_folder') return { toolName, status: 'running', label: 'Opened workspace folder' };
  if (toolName === 'launch_workspace_app') return { toolName, status: 'running', label: 'Launched workspace app' };
  if (toolName === 'set_workspace_entrypoint') return { toolName, status: 'running', label: args.command ? `Set entry point to \`${args.command}\`` : 'Cleared workspace entry point' };
  if (toolName === 'git_push') return { toolName, kind: 'git', status: 'running', label: `Pushed Git branch${args.branch ? ` to \`${args.branch}\`` : ''}` };
  if (toolName === 'write_file') {
    const isPlan = args.path && args.path.split(/[\\/]/).pop().toLowerCase() === 'implementation_plan.md';
    return {
      toolName,
      kind: isPlan ? 'plan' : 'file',
      status: 'running',
      path: args.path,
      content: isPlan ? String(args.content || '') : '',
      label: isPlan ? 'Created implementation plan' : `Wrote \`${args.path || 'file'}\``
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
    return { toolName, kind: 'checklist', status: 'running', label: `Updated task checklist${count ? ` (${count} items)` : ''}` };
  }
  if (toolName === 'schedule_followup') return { toolName, kind: 'followup', status: 'running', label: `Scheduled follow-up in ${args.delaySeconds || 60}s` };
  if (toolName === 'sync_workspace_env') return { toolName, kind: 'env', status: 'running', label: 'Synced workspace environment secrets' };
  if (toolName === 'google_search') return { toolName, kind: 'research', status: 'running', label: `Searched Google for "${args.query || ''}"` };
  if (toolName === 'fetch_web_page') return { toolName, kind: 'research', status: 'running', label: `Fetched docs page ${args.url || ''}` };
  return { toolName, status: 'running', label: `Used \`${toolName}\`` };
}

function updateWalkthroughItem(item, toolName, args, result, error) {
  if (!item) return;
  item.status = error ? 'error' : 'done';
  if (error) {
    item.detail = error.message;
    return;
  }
  if (toolName === 'write_file' || toolName === 'modify_file' || toolName === 'patch_file') {
    item.detail = result && result.backupPath ? `Backup: \`${result.backupPath}\`` : '';
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
    item.detail = `Exit: ${result && result.exitCode !== undefined ? result.exitCode : 'unknown'}${timedOut}${killed}`;
  } else if (toolName === 'start_command') {
    item.detail = result && result.id ? `Session: \`${result.id}\`, timeout: ${result.timeoutMs || 'default'}ms` : '';
  } else if (toolName === 'run_tests') {
    item.detail = result && result.success ? 'Passed' : 'Failed or unavailable';
  } else if (toolName === 'schedule_followup') {
    item.detail = result && result.replacedExisting ? 'Replaced an existing related timer' : '';
  }
}

function withWorkWalkthrough(text, items, final = false) {
  const meaningfulItems = (items || []).filter(Boolean);
  if (meaningfulItems.length === 0) return text;
  const base = stripWorkWalkthrough(String(text || ''));
  const heading = final ? '## Work Walkthrough' : '## Work Walkthrough';
  const lines = meaningfulItems.slice(-12).map(item => {
    const marker = item.status === 'error' ? 'Failed' : (item.status === 'running' ? 'Working' : 'Done');
    const detail = item.detail ? ` - ${item.detail}` : '';
    return `- **${marker}:** ${item.label}${detail}`;
  });
  const suffix = final
    ? ''
    : '\n\n_I will keep this updated as I work._';
  return `${base.trim() || 'Working on it.'}\n\n${heading}\n${lines.join('\n')}${suffix}`;
}

function stripWorkWalkthrough(text) {
  const marker = '\n\n## Work Walkthrough';
  const index = text.indexOf(marker);
  return index === -1 ? text : text.slice(0, index);
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
- direct: concrete low-risk work that should be executed immediately, such as running/opening a program, running tests, showing a directory, setting an entry point, pushing to Git when explicitly requested, viewing a file, making a narrow edit, fixing a small bug, or continuing an already-approved task.
- answer: a question or explanation that can be answered in chat without workspace changes or command execution.

Be practical and avoid ceremony. If the user asks for a simple local action, choose direct.

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

function shouldHaveUsedToolsButDidNot(text, workWalkthrough) {
  if ((workWalkthrough || []).length > 0) return false;
  const response = String(text || '').trim();
  if (!response) return true;
  return response.length < 80;
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

async function callOllamaAPI(messages, modelName, onWarning) {
  const url = `http://localhost:11434/api/chat`;
  
  // Format standard Orion AI system instruction
  const systemInstruction = SYSTEM_INSTRUCTION;
  
  const ollamaTools = convertGeminiToOllamaTools([
    {
      functionDeclarations: [
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
          description: "Creates a new file or overwrites an existing file with the provided text content.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "Relative path of the file to create" },
              content: { type: "STRING", description: "Text content of the file" }
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
          description: "Runs a command in powershell in the workspace directory, waits for completion, and returns code, stdout, stderr, and timeout status.",
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
          description: "Searches Google for current documentation, API references, examples, and troubleshooting. Use this before guessing about unfamiliar or current technical details.",
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
          description: "Sets the task checklist in the side panel to keep track of the subtasks. Pass an array of items with a status ('pending', 'in-progress', 'completed').",
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
    tools: ollamaTools,
    options: {
      temperature: 0
    }
  };
  
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

// GEMINI API UTILITIES
async function callGeminiAPI(messages, modelName, apiKey, onWarning) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  // Format body, translating role: 'tool' to role: 'user' for Gemini REST API compatibility
  const formattedContents = messages.map(msg => {
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
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      temperature: 0,
      thinkingConfig: {
        thinkingBudget: GEMINI_THINKING_BUDGET
      }
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
            description: "Creates a new file or overwrites an existing file with the provided text content.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path of the file to create" },
                content: { type: "STRING", description: "Text content of the file" }
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
            description: "Runs a command in powershell in the workspace directory, waits for completion, and returns code, stdout, stderr, and timeout status.",
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
            description: "Searches Google for current documentation, API references, examples, and troubleshooting. Use this before guessing about unfamiliar or current technical details.",
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
            description: "Sets the task checklist in the side panel to keep track of the subtasks. Pass an array of items with a status ('pending', 'in-progress', 'completed').",
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
          }
        ]
      }
    ]
  };

  const attempts = 5;
  let delay = 1500; // Start with 1.5s
  
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      if (response.ok) {
        return await response.json();
      }
      
      const errorText = await response.text();
      const status = response.status;
      const apiError = describeModelApiError(status, errorText);
      const retryDelayMs = apiError.retryDelayMs || delay;
      
      const isTransient = [429, 500, 502, 503, 504].includes(status);
      if (!isTransient || i === attempts) {
        const retryText = apiError.retryDelayMs ? ` Retry after about ${Math.ceil(apiError.retryDelayMs / 1000)} seconds.` : '';
        throw new Error(`HTTP ${status}: ${apiError.message}${retryText}`);
      }
      
      if (onWarning) {
        const kind = status === 429 ? 'Quota/rate limit' : (status === 503 ? 'High Demand' : 'Transient Error');
        onWarning(`Gemini API returned HTTP ${status} (${kind}). Retrying in ${(retryDelayMs / 1000).toFixed(1)}s (Attempt ${i}/${attempts})...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      delay = Math.max(delay * 2 + Math.random() * 500, retryDelayMs); // Exponential backoff + API retry hint
      
    } catch (e) {
      if (i === attempts) throw e;
      if (onWarning) {
        onWarning(`Connection error: ${e.message}. Retrying in ${(delay / 1000).toFixed(1)}s (Attempt ${i}/${attempts})...`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
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
    classifyPlanningNeed
  };
}

if (typeof module !== 'undefined' && process.env.NODE_ENV === 'test') {
  module.exports.executeTool = executeTool; // So we can test it specifically
}
