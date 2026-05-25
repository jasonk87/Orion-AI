// AGENT ENGINE FOR ANTIGRAVITY 2.0

// System Instruction for the Pair Programmer
const SYSTEM_INSTRUCTION = `You are Orion AI, the ultimate pair programmer agent running locally on the user's workspace.
Your goal is to solve the task given by the user with high quality, precision, and trust.

CRITICAL RULES:
1. PLANNING MODE DECISION: You must decide if the user's request warrants an implementation plan before taking action:
   - WHEN TO PLAN: If the request is complex, involves creating a new codebase/project, major architectural changes, or significant decision-making. You MUST first create an "implementation_plan.md" file detailing your design, use "set_task_checklist" to load subtasks, and ask the user for approval. Do NOT modify source files or run commands until approved. After writing the plan, clearly tell the user you are paused for approval and that they can reply "approve" or "go ahead" to continue.
   - WHEN NOT TO PLAN (BYPASS): If the request is a simple fix (e.g., tweaking styling, fixing a syntax error, adding a comment, or minor follow-up). In this case, you can bypass plan creation and execute immediately. To do so, you MUST first call the "set_task_checklist" tool with a single task starting with "[SIMPLE]" (e.g. "[SIMPLE] Fix typo in index.html") to automatically unlock file editing and command execution.
2. TESTING AND REGRESSION DISCIPLINE: When you create or change code, you are responsible for producing run-ready code. Before meaningful edits, inspect existing tests and the detected regression command when relevant. After edits, run the appropriate tests or smoke checks using "run_tests", "run_command", or the long-running command tools. If tests fail, read the output, fix the issue, and rerun tests until they pass or you can clearly explain a blocker. For long tests or servers, use "start_command", wait for completion or use "get_command_status"/"read_command_output", and stop hung processes with "kill_command". Do not claim code works unless you ran a relevant check or state exactly why you could not.
3. WEB RESEARCH: If you are unsure about an API, library, framework, command, model parameter, error message, current behavior, or documentation detail, use "google_search" and then "fetch_web_page" on the most relevant official docs or primary source before editing. Do not invent configuration files or API shapes when files are missing or the correct implementation is unclear. Do not say you reviewed, checked, verified, or confirmed documentation unless you actually used these web tools in the current task and can name the source URL. If docs appear to say something surprising, quote or paraphrase the exact relevant rule before changing files.
4. CONTEXT INTEGRITY: Keep files clean, respect formatting, and preserve comments that are unrelated to your edits.
5. NOTES AND MEMORY: Use project/standalone notes as durable working memory. Read them when orienting, and update them when you learn durable facts: architecture, important files, commands, decisions, user preferences, gotchas, open tasks, test status, and future repair notes. Project notes are shared across every conversation in the same project; standalone notes belong only to that standalone conversation. Keep notes concise and useful, not a transcript.
6. DESIGN QUALITY: When creating apps, games, dashboards, or visual tools, make them visually polished and pleasant by default. Treat beauty, layout, typography, color, spacing, motion, and interaction feedback as part of "working." Avoid bare black boxes, default controls, tiny unstyled text, and placeholder-looking screens unless the user explicitly asks for minimal output. For games, include a cohesive visual theme, clear HUD, start/game-over states, readable controls, animation polish, and a satisfying feel.
7. FOLLOW-UP TIMERS: If you say you will wait, check back, continue after N seconds/minutes, or inspect long-running training/tests later, you MUST call "schedule_followup". Do not merely say you will wait.
8. BE CONCISE: Explain your technical decisions briefly. The user can see your tools running and thoughts.
9. AUTONOMOUS WORKFLOW: Once the user approves your plan, execute all required file creations, edits, and test runs consecutively in a single session without yielding or waiting for further conversational input. Do not stop to explain intermediate steps, and do not ask "should I proceed?". Keep calling tools until the entire task is fully complete.
10. TASK COMPLETION: You must use the "set_task_checklist" tool to update the status of each subtask as you work on them. Once all tasks are complete, update the checklist to show all tasks are 'completed', and then present your final summary.
11. RESPONSE FORMAT: Use clean GitHub-flavored Markdown. Prefer short sections with level-2 headings like "Summary", "Findings", "Plan", "Changes", "Tests", and "Next Steps". Use bullets for scan-friendly details, numbered lists only for ordered steps, and fenced code blocks for code. Do not write giant unbroken paragraphs. For code reviews or "look through the code" requests, lead with a brief summary, then specific findings with file/function references, then prioritized recommendations. When creating an implementation plan, put the detailed plan in implementation_plan.md and summarize it in chat in 3-6 bullets instead of pasting the whole plan.
12. SECRETS AND ENVIRONMENT: When a project needs the user's Gemini API key, Google API key, or Google Search Engine ID, use "sync_workspace_env" to create or update workspace environment files. Do not hardcode secrets into source files, do not print secret values, and do not ask the user to paste keys you can sync from settings. Make code read secrets from environment variables such as GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID, and GOOGLE_CSE_ID. For browser-only/static apps, do not expose private API keys in client-side code; add a small local/server API layer instead.

Tools available:
- list_files: List all files in the workspace (excluding node_modules).
- read_file: Read a file's content.
- write_file: Write a new file or overwrite a file.
- modify_file: Edit a specific section of a file (search and replace).
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
let currentAgentLogs = [];
let isStopRequested = false;
const GEMINI_THINKING_BUDGET = 24576;

window.steeringQueue = [];
window.promptQueue = [];
window.followupTimers = window.followupTimers || {};
window.isAgentRunning = () => isAgentRunning;
window.getRunningConversationId = () => runningConversationId;
window.getAgentSubStatus = () => agentSubStatus;
window.stopAgentExecution = () => {
  isStopRequested = true;
  window.appendSystemMessage("🛑 Stop requested... task will abort on next turn.");
};

// EXPOSE AGENT LOOP TO RENDERER
window.runAgentLoop = async function(userPrompt, modelName, conversation) {
  if (isAgentRunning) {
    window.appendSystemMessage("An agent task is already running.");
    return;
  }
  
  isAgentRunning = true;
  runningConversationId = conversation.id;
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
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
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

  let lastTextResponse = "Thinking...";
  let aiMessageIndex = conversation.messages.length;
  // Initialize AI message state in conversation list
  conversation.messages.push({ role: 'assistant', text: 'Thinking...', logs: [], turns: [] });
  
  try {
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
    
    // Set up planning approval status
    // If user says "approve" or similar keywords, set planApproved to true
    const lowerPrompt = userPrompt.toLowerCase();
    const approveKeywords = ['approve', 'yes', 'go ahead', 'looks good', 'run', 'do it', 'sounds good', 'ok', 'okay', 'lets go'];
    const hasApproval = approveKeywords.some(keyword => {
      const escapedKeyword = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      return regex.test(lowerPrompt);
    });
    if (hasApproval) {
      conversation.planApproved = true;
      window.appendSystemMessage("Planning mode: Approved. Full execution enabled.");
    }
    
    // Run the agent execution loop (up to 15 steps to prevent runaway bills)
    let loopCount = 0;
    let maxLoops = 20;
    let forceYield = false;
    let consecutiveNoToolCalls = 0;
    let malformedCallsCount = 0;
    const maxMalformedToolRetries = 5;
    
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
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      window.renderAiMessage(lastTextResponse, currentAgentLogs);
      
      // If no tool calls, the agent is done, unless there are pending tasks in the checklist
      if (functionCalls.length === 0) {
        consecutiveNoToolCalls++;
        const pendingTasks = conversation.tasks ? conversation.tasks.filter(t => t.status !== 'completed' && t.status !== 'x') : [];
        if (pendingTasks.length > 0 && conversation.planApproved && consecutiveNoToolCalls < 2 && loopCount < maxLoops) {
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
        window.renderAiMessage(lastTextResponse, currentAgentLogs);
        
        // Safety gate for planning mode
        if (config.planningMode && !conversation.planApproved) {
          // Auto-approve if the model declares it as a simple task
          const hasSimpleTask = conversation.tasks && conversation.tasks.some(t => t.title && t.title.startsWith('[SIMPLE]'));
          if (hasSimpleTask) {
            conversation.planApproved = true;
            window.appendSystemMessage("Planning mode: Bypassed for simple task.");
          }
        }
        
        if (config.planningMode && !conversation.planApproved) {
          const destructiveTools = ['write_file', 'modify_file', 'run_command', 'start_command', 'run_tests', 'sync_workspace_env'];
          if (destructiveTools.includes(toolName)) {
            // Allow writing the implementation plan file itself before approval
            const isPlanWrite = toolName === 'write_file' && args.path && args.path.toLowerCase().includes('implementation_plan');
            if (!isPlanWrite) {
              const errMsg = "Planning Mode Active: File edits and command execution are blocked until the user explicitly approves your plan (e.g. types 'approve'). Create implementation_plan.md and task checklists first, then wait.";
              
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
        } catch (err) {
          console.error(err);
          currentAgentLogs[logIndex].status = 'error';
          currentAgentLogs[logIndex].result = err.message;
          result = { error: err.message };
        }
        
        toolResponseParts.push({
          functionResponse: {
            name: toolName,
            response: (typeof result === 'object' && result !== null && !Array.isArray(result)) ? result : { output: result }
          }
        });
        
        // Re-render UI with logs
        window.renderAiMessage(lastTextResponse, currentAgentLogs);
      }
      
      // Append tool response parts to message history
      messages.push({ role: 'tool', parts: toolResponseParts });
      
      // Save api response details to current turn
      currentTurn.toolResponseParts = toolResponseParts;
      
      conversation.messages[aiMessageIndex].text = lastTextResponse;
      conversation.messages[aiMessageIndex].logs = [...currentAgentLogs];
      window.saveConversationsToStorage();
      
      if (forceYield) {
        console.log("Plan written. Forcing yield to wait for user approval.");
        if (lastTextResponse === "Thinking...") {
          lastTextResponse = "I created `implementation_plan.md` and paused because Planning Mode is on. Reply `approve` or `go ahead` to let me build it, or turn off Planning Mode in settings for small tasks you want me to execute immediately.";
        }
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
    agentSubStatus = '';
    if (window.onAgentStatusChange) window.onAgentStatusChange(false);
    
    if (lastTextResponse === "Thinking...") {
      lastTextResponse = "Task finished.";
    }
    
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
    case 'list_files': {
      const files = await window.api.listFiles(workspace);
      return files.map(f => ({ path: f.path, isDir: f.isDir, size: f.size }));
    }
    
    case 'read_file': {
      if (!args.path) throw new Error("Missing 'path' parameter");
      const content = await window.api.readFile(workspace, args.path);
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
      
      return { success: true, message: `File written to ${args.path} successfully.${testFeedback}` };
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
      
      return { success: true, message: `File modified successfully.${testFeedback}` };
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
      const processId = args.processId || (`cmd_${conversation.id}_${Date.now()}`);
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
  const timerId = 'followup_' + Date.now();
  const targetConversationId = (typeof activeConversationId !== 'undefined') ? activeConversationId : null;
  const modelSelectValue = window.getSelectedModel ? window.getSelectedModel() : undefined;
  
  window.followupTimers[timerId] = setTimeout(async () => {
    delete window.followupTimers[timerId];
    
    if (window.isAgentRunning && window.isAgentRunning()) {
      window.promptQueue.push({ prompt, modelSelectValue, conversationId: targetConversationId });
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
    await window.runAgentLoop(prompt, modelSelectValue || (window.getSelectedModel ? window.getSelectedModel() : 'gemini-2.5-flash-lite'), targetConv);
  }, delaySeconds * 1000);
  
  return {
    success: true,
    timerId,
    delaySeconds,
    message: `Scheduled follow-up in ${delaySeconds} seconds.`
  };
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
          name: "read_file",
          description: "Reads the entire content of a file located at path relative to the workspace root.",
          parameters: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING", description: "Relative path of the file to read" }
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
          description: "Starts a shell command asynchronously with a timeout and returns immediately with a processId. Use for long-running tests, dev servers, or commands that may take a while.",
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
              prompt: { type: "STRING", description: "Instruction Orion should run when the timer fires." }
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
            name: "read_file",
            description: "Reads the entire content of a file located at path relative to the workspace root.",
            parameters: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING", description: "Relative path of the file to read" }
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
            description: "Starts a shell command asynchronously with a timeout and returns immediately with a processId. Use for long-running tests, dev servers, or commands that may take a while.",
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
                prompt: { type: "STRING", description: "Instruction Orion should run when the timer fires." }
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
      
      const isTransient = [429, 500, 502, 503, 504].includes(status);
      if (!isTransient || i === attempts) {
        throw new Error(`HTTP ${status}: ${errorText}`);
      }
      
      if (onWarning) {
        onWarning(`Gemini API returned HTTP ${status} (${status === 503 ? 'High Demand' : 'Transient Error'}). Retrying in ${(delay / 1000).toFixed(1)}s (Attempt ${i}/${attempts})...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = delay * 2 + Math.random() * 500; // Exponential backoff + jitter
      
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
