const test = require('tape');
global.window = {};

// Mock fetch globally
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const text = body.contents[0].parts[0].text;

  if (text.includes("Classify the user's latest message about a pending implementation plan")) {
    if (text.includes('"good to go"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"approve","reason":""}' }] } }] }) };
    }
    if (text.includes('"no wait"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"revise","reason":""}' }] } }] }) };
    }
    if (text.includes('"what"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"unclear","reason":""}' }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"deny","reason":""}' }] } }] }) };
  }

  if (text.includes("Classify whether this Orion AI request should require an implementation plan")) {
    const userMessage = text.slice(text.lastIndexOf('User message:') + 'User message:'.length).trim();
    if (userMessage === '"run tests"') {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":""}' }] } }] }) };
    }
    if (userMessage === '"what all python environments do i have installed on this computer"') {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"Read-only local environment inventory."}' }] } }] }) };
    }
    if (userMessage === '"I have a folder on my desktop called rocket sumo, recommend similar games and improvements"') {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"Read existing local project before recommending."}' }] } }] }) };
    }
    if (userMessage === '"look through my program and find any bugs"') {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reviewOnly":true,"reason":"Read-only code review."}' }] } }] }) };
    }
    if (userMessage === '"explain"') {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"answer","reason":""}' }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"plan","reason":""}' }] } }] }) };
  }

  return { ok: false };
};

const agent = require('../agent.js');
// When tests run in a full suite, earlier test files reset global.window, wiping the runAgentLoop
// assignment that agent.js makes on first load (module cache prevents re-execution). Re-attach here.
if (!global.window.runAgentLoop && agent.runAgentLoop) global.window.runAgentLoop = agent.runAgentLoop;

function validStrategy(overrides = {}) {
  const sections = {
    'Objective': 'Build the requested feature safely against the current repository reality.',
    'Relevant Files': '- agent.js\n- tests/',
    'Design & Polish': '- Styled with CSS; animations on all state transitions; responsive layout.',
    'Ambiguity Resolution': '- Visual style: isometric pixel art (user confirmed). Core mechanic: RTS god-game orders. NPC scale: batch ECS simulation.',
    'True Objective': 'Build the requested feature safely against the current repository reality.',
    'Current Repo Reality': '- Existing app code is present and must be inspected before edits.',
    'Relevant Files / Subsystems': '- agent.js\n- tests/',
    'Assumptions': '- Minor ambiguity can be handled with conservative defaults.',
    'Ambiguities': '- None mission-critical.',
    'Risks / Failure Modes': '- Tests may reveal integration breakage.',
    'Evidence Required for Success': '- npm test passes\n- Changed files are reread after edits',
    'Clarifying Questions, if needed': 'None',
    'Recommended Direction': 'Inspect first, plan second, edit only after approval.',
    'What Not To Touch': '- Do not rewrite unrelated systems.'
  };
  return Object.entries({ ...sections, ...overrides })
    .map(([heading, body]) => `## ${heading}\n\n${body}`)
    .join('\n\n');
}

test('classifyPlanApprovalIntent returns correct intents', async (t) => {
  const approveRes = await agent.classifyPlanApprovalIntent('good to go', 'gemini-1', 'key');
  t.equal(approveRes.intent, 'approve', 'Recognizes approve intent');

  const denyRes = await agent.classifyPlanApprovalIntent('stop', 'gemini-1', 'key');
  t.equal(denyRes.intent, 'deny', 'Recognizes deny intent');

  const reviseRes = await agent.classifyPlanApprovalIntent('no wait', 'gemini-1', 'key');
  t.equal(reviseRes.intent, 'revise', 'Recognizes revise intent');

  const unclearRes = await agent.classifyPlanApprovalIntent('what', 'gemini-1', 'key');
  t.equal(unclearRes.intent, 'unclear', 'Recognizes unclear intent');

  t.end();
});

test('classifyPlanningNeed returns correct modes', async (t) => {
  const directRes = await agent.classifyPlanningNeed('run tests', 'gemini-1', 'key');
  t.equal(directRes.mode, 'direct', 'Recognizes direct mode');

  const envRes = await agent.classifyPlanningNeed('what all python environments do i have installed on this computer', 'gemini-1', 'key');
  t.equal(envRes.mode, 'direct', 'Recognizes local Python environment inventory as direct mode');

  const localProjectAdviceRes = await agent.classifyPlanningNeed('I have a folder on my desktop called rocket sumo, recommend similar games and improvements', 'gemini-1', 'key');
  t.equal(localProjectAdviceRes.mode, 'direct', 'Recognizes local project recommendation as direct inspection mode');

  const planRes = await agent.classifyPlanningNeed('build a whole app', 'gemini-1', 'key');
  t.equal(planRes.mode, 'plan', 'Recognizes plan mode');

  const reviewRes = await agent.classifyPlanningNeed('look through my program and find any bugs', 'gemini-1', 'key');
  t.equal(reviewRes.mode, 'direct', 'Recognizes read-only bug hunts as direct mode');
  t.equal(reviewRes.reviewOnly, true, 'Carries review-only flag for bug hunts');

  const answerRes = await agent.classifyPlanningNeed('explain', 'gemini-1', 'key');
  t.equal(answerRes.mode, 'answer', 'Recognizes answer mode');

  t.end();
});

test('review-only gate allows strategy but blocks implementation artifacts and edits', (t) => {
  const readGate = agent.getReviewOnlyToolGate('read_file', { path: 'agent.js' });
  t.equal(readGate.allowed, true, 'allows file reading during review');

  const strategyGate = agent.getReviewOnlyToolGate('write_file', { path: 'STRATEGY.md' });
  t.equal(strategyGate.allowed, true, 'allows STRATEGY.md as review strategy');

  const planGate = agent.getReviewOnlyToolGate('write_file', { path: 'implementation_plan.md' });
  t.equal(planGate.allowed, false, 'blocks implementation_plan.md during review-only tasks');
  t.ok(planGate.reason.includes('Review-only task'), 'blocked plan explains review-only mode');

  const editGate = agent.getReviewOnlyToolGate('patch_file', { path: 'src/app.js' });
  t.equal(editGate.allowed, false, 'blocks source edits during review-only tasks');

  const source = require('fs').readFileSync(require('path').join(__dirname, '../agent.js'), 'utf8');
  t.ok(source.includes("if (reviewOnly && planningDecision.mode === 'plan')"), 'runtime forces plan-classified reviews back to direct mode');
  t.ok(source.includes('!reviewOnly && planningDecision.mode === \'plan\''), 'fallback approval gate ignores review-only tasks');
  t.end();
});

test('Planning Gate behavior requires STRATEGY.md before implementation_plan.md', (t) => {
  const config = { planningMode: true };

  const readGate = agent.getPlanningToolGate(config, false, 'read_file', { path: 'app.js' });
  t.equal(readGate.allowed, true, 'allows non-destructive read during refinement');

  const strategyGate = agent.getPlanningToolGate(config, false, 'write_file', { path: 'STRATEGY.md' });
  t.equal(strategyGate.allowed, true, 'allows STRATEGY.md write during refinement');
  t.equal(strategyGate.forceYield, false, 'strategy write does not request implementation approval yet');

  const missingStrategyGate = agent.getPlanningToolGate(config, false, 'write_file', { path: 'plans/implementation_plan.md' }, {
    strategyStatus: { exists: false, valid: false }
  });
  t.equal(missingStrategyGate.allowed, false, 'blocks implementation_plan.md until STRATEGY.md exists');

  // Regression: a real run had STRATEGY.md fail to write twice (a separate bug, since fixed),
  // then went ahead and got an implementation_plan.md approved anyway without ever creating a
  // valid STRATEGY.md. That happened because this validity check used to be conditioned on
  // options.strategyRequired (true only when the routing classifier called the turn 'plan') — so
  // when routing mislabeled the turn 'direct', the check was skipped entirely regardless of
  // whether STRATEGY.md existed. The check must be unconditional: writing implementation_plan.md
  // at all is itself the signal a plan is needed, independent of how routing classified the turn.
  const directRoutedMissingStrategyGate = agent.getPlanningToolGate(config, false, 'write_file', { path: 'implementation_plan.md' }, {
    strategyStatus: { exists: false, valid: false },
    agentExecutionMode: 'direct'
  });
  t.equal(directRoutedMissingStrategyGate.allowed, false, 'blocks implementation_plan.md without a valid STRATEGY.md even when routing called the turn direct');

  const planGate = agent.getPlanningToolGate(config, false, 'write_file', { path: 'plans/implementation_plan.md' }, {
    strategyStatus: { exists: true, valid: true, needsClarification: false }
  });
  t.equal(planGate.allowed, true, 'allows exact implementation_plan.md write after valid strategy');
  t.equal(planGate.forceYield, true, 'plan write forces pause/yield');

  const bypassGate = agent.getPlanningToolGate(config, false, 'write_file', { path: 'implementation_plan.md.bak' });
  t.equal(bypassGate.allowed, false, 'blocks filename suffix bypass');

  const sourceEditGate = agent.getPlanningToolGate(config, false, 'patch_file', { path: 'src/app.js' }, {
    strategyStatus: { exists: true, valid: true, needsClarification: false }
  });
  t.equal(sourceEditGate.allowed, false, 'blocks source edits during refinement/planning');

  const commandGate = agent.getPlanningToolGate(config, false, 'run_command', { command: 'npm test' });
  t.equal(commandGate.allowed, true, 'allows command execution for inspection before approval');

  const approvedGate = agent.getPlanningToolGate(config, true, 'run_command', { command: 'npm test' });
  t.equal(approvedGate.allowed, true, 'allows destructive tools after approval/direct classification');

  const directGate = agent.getPlanningToolGate(config, true, 'write_file', { path: 'small.txt', content: 'ok' });
  t.equal(directGate.allowed, true, 'direct/simple tasks can bypass refinement through canExecute');

  // Regression: writing implementation_plan.md during execution (canExecute=true) must never
  // return forceYield=true — forceYield is what triggers the plan-approval card, so a true
  // value here would re-show the card and double-present the plan after the user clicks
  // "Start Implementation".
  const approvedPlanGate = agent.getPlanningToolGate(config, true, 'write_file', { path: 'implementation_plan.md' }, {
    strategyStatus: { exists: true, valid: true, needsClarification: false }
  });
  t.equal(approvedPlanGate.allowed, true, 'allows implementation_plan.md write during execution');
  t.equal(approvedPlanGate.forceYield, false, 'forceYield is false when canExecute=true — plan card must not re-appear during execution');

  t.end();
});

test('STRATEGY.md validation requires all refinement sections', (t) => {
  const content = validStrategy();
  t.equal(agent.hasRequiredStrategySections(content), true, 'valid strategy contains all required sections');
  // Required-section matching is keyword-based (a model that writes "Leveraging Existing
  // Architecture" instead of the literal "Relevant Files" heading still satisfies the
  // requirement), so the fixture's near-duplicate "Relevant Files / Subsystems" heading must also
  // be removed here to genuinely test the "no heading covers this concept at all" case.
  const missing = content
    .replace(/## Relevant Files[\s\S]*?(?=\n\n## )/, '')
    .replace(/## Relevant Files \/ Subsystems[\s\S]*?(?=\n\n## )/, '');
  t.equal(agent.hasRequiredStrategySections(missing), false, 'missing required section is invalid');
  const validation = agent.validateStrategyContent(missing);
  t.equal(validation.valid, false, 'validation rejects incomplete strategy');
  t.ok(validation.missingSections.includes('Relevant Files'), 'validation reports missing section');
  t.end();
});

// Regression: a real STRATEGY.md used reasonable-but-different headings than the exact literal
// phrases models are instructed to use ("Core Concept" instead of "Objective", "Scope Management"
// instead of "Ambiguity Resolution", etc.). Requiring an exact phrase match caused this real,
// otherwise-complete strategy doc to silently fail validation, which meant Mission Control never
// got populated with no indication why. Section matching must tolerate this kind of variation.
test('STRATEGY.md validation accepts equivalent headings, not just the exact literal phrase', (t) => {
  const realWorldPhrasing = `# Strategy: Army and Defense System

## Core Concept

Add a military and defense system to the game.

## Leveraging Existing Architecture

Reuse the Worker class state machine and Bodyguard AI.

## Player Control & UI

Command interface for selecting and directing units.

## Scope Management

Focused on defensive play; invasions are a stretch goal.
`;
  t.equal(agent.hasRequiredStrategySections(realWorldPhrasing), true, 'accepts differently-worded headings that cover the same required concepts');
  const validation = agent.validateStrategyContent(realWorldPhrasing);
  t.equal(validation.valid, true, 'validateStrategyContent agrees this strategy is valid');
  t.equal(validation.missingSections.length, 0, 'no sections are reported missing');
  t.end();
});

test('strategy critical ambiguity triggers clarification gate before planning', (t) => {
  const content = validStrategy({
    'Clarifying Questions, if needed': '- [critical] Which repository should be modified? This is mission-critical.'
  });
  const validation = agent.validateStrategyContent(content);
  t.equal(validation.valid, true, 'critical-ambiguity strategy can still be structurally valid');
  t.equal(validation.needsClarification, true, 'critical ambiguity requires clarification');

  const gate = agent.getPlanningToolGate({ planningMode: true }, false, 'write_file', { path: 'implementation_plan.md' }, {
    strategyStatus: validation
  });
  t.equal(gate.allowed, false, 'implementation plan is blocked until clarification');
  t.ok(gate.reason.includes('Clarification required'), 'gate explains ask-clarification behavior');
  t.end();
});

test('refinement prompt requires first inspections and no new roles or replanning', (t) => {
  const prompt = agent.buildRefinementPrompt({ exists: false, valid: false, missingSections: agent.STRATEGY_REQUIRED_SECTIONS });
  t.ok(prompt.includes('get_workspace_info'), 'requires workspace info first');
  t.ok(prompt.includes('read_operational_context'), 'requires operational context read first');
  t.ok(prompt.includes('read_notes'), 'requires notes read first');
  t.ok(prompt.includes('list_files'), 'requires file listing first');
  t.ok(prompt.includes('README'), 'requires obvious grounding files');
  t.ok(prompt.includes('Do not add agent roles'), 'forbids new roles');
  t.ok(prompt.includes('automatic replanning'), 'mentions replanning only as forbidden');
  t.end();
});

test('strategy derives operational context mission and win conditions', (t) => {
  const derived = agent.buildOperationalContextFromStrategy(validStrategy({
    'True Objective': 'Make Orion slower before hard decisions and more reliable on large repos.',
    'Evidence Required for Success': '- STRATEGY.md exists before implementation_plan.md\n- Source edits are blocked during refinement'
  }));
  t.equal(derived.mission, 'Make Orion slower before hard decisions and more reliable on large repos.', 'derives mission from True Objective');
  t.equal(derived.winConditions.length, 2, 'derives measurable win conditions from evidence section');
  t.equal(derived.winConditions[0].title, 'STRATEGY.md exists before implementation_plan.md', 'keeps evidence requirement as win condition');
  t.ok(derived.discoveries.some(text => text.includes('Relevant files/subsystems')), 'promotes durable strategy discoveries');
  t.end();
});

test('plan approval validation requires a testing plan section', (t) => {
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n## Testing Plan\n\nRun npm test.'), true, 'accepts required Testing Plan heading');
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n### Test Plan\n\nRun npm test.'), true, 'accepts Test Plan subheading');
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n## Validation Plan\n\nManual smoke check.'), true, 'accepts Validation Plan heading');
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n## 4. Testing Plan\n\nRun it.'), true, 'accepts numbered Testing Plan heading');
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n### Section B: Test Plan\n\nRun it.'), true, 'accepts prefixed Test Plan heading');
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n## Implementation\n\nDo the work.'), false, 'rejects plans without a testing section');
  t.equal(agent.hasRequiredTestingPlanSection(''), false, 'rejects missing or unreadable plan content');
  // Regression: a real plan with a clear "Testing Plan" section written as a full bold line
  // instead of a "## " markdown heading was rejected as missing the section entirely, blocking
  // plan approval on a plan that plainly had the content the check was looking for.
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\n**Testing Plan**\n\nUnit Behavior: test movement.\nRecruitment: verify costs.'), true, 'accepts a bold pseudo-heading as a valid Testing Plan section');
  t.equal(agent.hasRequiredTestingPlanSection('# Plan\n\nThis has nothing to do with **bold text** elsewhere.'), false, 'a bold phrase unrelated to testing is still rejected');
  t.end();
});

test('invalid plan does not present approval UI and requests internal revision', async (t) => {
  // We mock out the window and external dependencies to test the inner agent loop
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  // Set up mock window environment
  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({
    planningMode: true,
    geminiApiKey: 'test-key',
    modelCallDelayMs: 0
  });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async (workspacePath, filePath) => {
      if (filePath === 'STRATEGY.md') {
        return validStrategy();
      }
      if (filePath === 'implementation_plan.md') {
        return '# Plan\n\n## Implementation\n\nDo the work.'; // Invalid, missing Testing Plan
      }
      return '';
    },
    writeFile: async () => ({ success: true }),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
  };

  // Minimal conversation state
  const conversation = {
    id: 'test-conv',
    messages: [],
    awaitingPlanApproval: false,
    planApproved: false
  };

  // Override fetch to act as Gemini API mock returning a plan write tool call
  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  global.fetch = async (url, options) => {
    fetchCallCount++;
    if (fetchCallCount === 1) {
      // First call: The model writes an invalid plan
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                functionCall: {
                  name: 'write_file',
                  args: { path: 'implementation_plan.md', content: 'plan' }
                }
              }]
            }
          }]
        })
      };
    } else if (fetchCallCount === 2) {
      // Second call: We verify that the model received the prompt to revise
      // But instead of immediately providing a valid plan, let's pretend it tried another tool just to test the loop continues
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                functionCall: {
                  name: 'list_files',
                  args: {}
                }
              }]
            }
          }]
        })
      };
    } else {
      // Third call: The model gets the rejection and writes a valid plan
      global.window.api.readFile = async (workspacePath, filePath) => {
        if (filePath === 'STRATEGY.md') return validStrategy();
        return '# Plan\n\n## Testing Plan\n\nTest it.'; // Now it's valid
      };
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                functionCall: {
                  name: 'write_file',
                  args: { path: 'implementation_plan.md', content: 'valid plan' }
                }
              }]
            }
          }]
        })
      };
    }
  };

  try {
    // Prevent the setTimeout queue execution at the end of the loop
    global.setTimeout = (fn, delay) => {
       if (delay !== 500) return originalSetTimeout(fn, delay);
       return null;
    };

    // Run the agent loop
    await window.runAgentLoop('Create a plan', 'gemini-1', conversation);

    // Find the AI message turn and inspect its history
    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    t.ok(aiMessage, 'assistant message was created');

    // We expect the system to have injected a revision prompt, so there should be multiple turns
    // Instead of parsing the exact turns which can be brittle, let's verify that awaitingPlanApproval
    // is ultimately set to true ONLY AFTER the valid plan is generated.
    t.equal(conversation.awaitingPlanApproval, true, 'loop eventually awaits approval');
    t.equal(fetchCallCount, 3, 'agent was forced to loop again to fix the invalid plan');
  } finally {
    // Restore mocks
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

test('invalid plan twice eventually yields to the user to prevent infinite loop', async (t) => {
  // We mock out the window and external dependencies to test the inner agent loop
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  // Set up mock window environment
  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({
    planningMode: true,
    geminiApiKey: 'test-key',
    modelCallDelayMs: 0
  });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async (workspacePath, filePath) => {
      if (filePath === 'STRATEGY.md') {
        return validStrategy();
      }
      return '# Plan\n\n## Implementation\n\nStill invalid plan.';
    },
    writeFile: async () => ({ success: true }),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
  };

  // Minimal conversation state
  const conversation = {
    id: 'test-conv-2',
    messages: [],
    awaitingPlanApproval: false,
    planApproved: false
  };

  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  global.fetch = async (url, options) => {
    fetchCallCount++;
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          finishReason: "STOP",
          content: {
            parts: [{
              functionCall: {
                name: 'write_file',
                args: { path: 'implementation_plan.md', content: 'invalid plan' }
              }
            }]
          }
        }]
      })
    };
  };

  try {
    // Prevent the setTimeout queue execution at the end of the loop
    global.setTimeout = (fn, delay) => {
       if (delay !== 500) return originalSetTimeout(fn, delay);
       return null;
    };

    // Run the agent loop
    await window.runAgentLoop('Create a plan', 'gemini-1', conversation);

    // It should yield to the user after 1 retry (so total 2 attempts to write plan)
    t.equal(conversation.awaitingPlanApproval, true, 'loop yields and sets awaitingPlanApproval to true');
    t.equal(conversation.planApproved, false, 'plan is marked as NOT approved');
    t.equal(fetchCallCount, 5, 'agent only tried 3 times in loop before yielding');
  } finally {
    // Restore mocks
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: when the agent is in execution mode (planApproved=true) and encounters repeated
// tool failures that set forceYield=true, the forceYield block must NOT set awaitingPlanApproval
// back to true or revoke planApproved. Previously the forceYield block always ran the plan
// validation path, causing the plan approval card to re-appear after execution errors.
test('repeated tool failures during execution do not re-trigger plan approval UI', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async (workspacePath, filePath) => {
      if (filePath === 'STRATEGY.md') return validStrategy();
      if (filePath === 'implementation_plan.md') return '# Plan\n\n## Testing Plan\n\nRun npm test.';
      return '';
    },
    writeFile: async () => ({ success: true }),
    runCommand: async () => { throw new Error('Command failed'); },
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
  };

  // Conversation is already in execution mode (plan was approved)
  const conversation = {
    id: 'test-exec-failures',
    messages: [],
    awaitingPlanApproval: false,
    planApproved: true,
  };

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const text = (body.contents || [])[0]?.parts?.[0]?.text || '';

    // Routing classifier: classify as 'direct' so the planApproved branch continues execution
    if (text.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }

    // All model calls during execution: try to run a command (which will always fail via the mock)
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ functionCall: { name: 'run_command', args: { command: 'npm test' } } }] }
        }]
      })
    };
  };

  try {
    global.setTimeout = (fn, delay) => {
      if (delay !== 500) return originalSetTimeout(fn, delay);
      return null;
    };

    await window.runAgentLoop('continue implementation', 'gemini-1', conversation);

    // The loop should hit the repeated-failure guard and break via forceYield.
    // The fix ensures it does NOT set awaitingPlanApproval or revoke planApproved.
    t.equal(conversation.awaitingPlanApproval, false, 'execution-mode tool failures do not re-show plan approval card');
    t.equal(conversation.planApproved, true, 'planApproved is not revoked by execution-mode tool failures');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: the edit-thrash guard blocked repeated edits to the same file until a read_file
// happened, but a small/fast model would sometimes just re-read the file repeatedly afterward
// without ever retrying the edit the guard was blocking — wasting the rest of the turn. The fix
// attaches a reminder to the read_file tool response telling the model to retry the edit now.
test('edit-blocked guard reminds the model to retry the edit after it re-reads the file', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async () => 'const x = 1;\nconst y = 2;\nconst z = 3;\n',
    writeFile: async () => ({ success: true, backupPath: null }),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
  };

  const conversation = {
    id: 'test-edit-retry-reminder',
    messages: [],
    awaitingPlanApproval: false,
    planApproved: true,
  };

  let turnCount = 0;
  let readFileResponseSeen = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';

    // The routing classifier and the per-turn countTokens preflight each make their own fetch
    // call before the actual model turn; neither may consume a slot in the turnCount sequence
    // below, or every branch shifts and the intended modify/modify/modify(blocked)/read_file
    // sequence never actually happens.
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) {
      return { ok: true, json: async () => ({ totalTokens: 100 }) };
    }

    // Function-call responses are serialized as {role: 'user', parts: [{functionResponse}]} rather
    // than a distinct 'tool' role, so search all parts for the read_file response directly.
    for (const message of contents) {
      const readResponse = (message.parts || []).find(p => p.functionResponse && p.functionResponse.name === 'read_file');
      if (readResponse) readFileResponseSeen = readResponse.functionResponse.response;
    }

    turnCount++;
    const respondWith = (functionCall) => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall }] } }] })
    });

    if (turnCount === 1) return respondWith({ name: 'modify_file', args: { path: 'a.js', target: 'const x = 1;', replacement: 'const x = 10;' } });
    if (turnCount === 2) return respondWith({ name: 'modify_file', args: { path: 'a.js', target: 'const y = 2;', replacement: 'const y = 20;' } });
    // Third edit to the same file without an intervening read should be blocked by the thrash guard.
    if (turnCount === 3) return respondWith({ name: 'modify_file', args: { path: 'a.js', target: 'const z = 3;', replacement: 'const z = 30;' } });
    if (turnCount === 4) return respondWith({ name: 'read_file', args: { path: 'a.js' } });
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'All edits are complete now.' }] } }] }) };
  };

  try {
    global.setTimeout = (fn, delay) => {
      if (delay !== 500) return originalSetTimeout(fn, delay);
      return null;
    };

    await window.runAgentLoop('edit the file twice then edit again', 'gemini-1', conversation);

    t.ok(readFileResponseSeen, 'the read_file call after being blocked produced a visible tool response');
    t.ok(readFileResponseSeen && readFileResponseSeen.editRetryReminder, 'the read_file response includes a reminder to retry the blocked edit');
    t.ok(readFileResponseSeen && readFileResponseSeen.editRetryReminder.includes('a.js'), 'the reminder names the file that was blocked');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: Gemini's thinking mode can return an internal "thought" segment as its own part
// alongside the real answer. The loop concatenated every part.text together with no separator,
// so a response with both a thought part and a real answer part rendered as two near-duplicate
// paragraphs of content run directly into each other. Thought parts must not contribute to the
// visible text at all.
test('thought parts do not leak into the visible answer text', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async () => '',
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
  };

  const conversation = { id: 'test-thought-leak', messages: [], awaitingPlanApproval: false, planApproved: false };

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"answer","reason":"question"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    return {
      ok: true,
      json: async () => ({
        candidates: [{
          finishReason: 'STOP',
          content: {
            parts: [
              { text: 'Draft reasoning about the project that looks like a complete answer.', thought: true },
              { text: 'This is the real answer to the question.' }
            ]
          }
        }]
      })
    };
  };

  try {
    global.setTimeout = (fn, delay) => {
      if (delay !== 500) return originalSetTimeout(fn, delay);
      return null;
    };

    await window.runAgentLoop('what do you think of this project?', 'gemini-1', conversation);

    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    t.ok(aiMessage, 'assistant message was created');
    t.notOk(aiMessage.text.includes('Draft reasoning about the project'), 'thought-part text is not included in the visible answer');
    t.ok(aiMessage.text.includes('This is the real answer'), 'the real answer part is still shown');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: buildPostEditEvidencePrompt (the soft nudge asking Orion to verify a code change)
// is capped at 2 attempts and silently gives up once exhausted. The hard block that actually
// requires verification evidence (evaluateCompletionGate's requireVerificationEvidence) only ever
// ran when a full mission/plan/win-condition state was active — a small "direct" edit outside that
// flow could finish "done" having changed real source files with zero test/smoke verification.
// This is a hard stop for that gap: once the soft nudge budget is exhausted, an unverified edit
// must not be allowed to finish silently.
test('direct-mode edits without any mission state still require verification evidence before finishing', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async () => 'export function add(a, b) { return a + b; }\n',
    writeFile: async () => ({ success: true, backupPath: null }),
    listFiles: async () => ([{ path: 'math.js', isDir: false, size: 100 }]),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
  };

  const conversation = { id: 'test-unverified-edit', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    if (turnCount === 1) {
      return {
        ok: true,
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'modify_file', args: { path: 'math.js', target: 'a + b', replacement: 'a + b + 0' } } }] } }] })
      };
    }
    // Every subsequent turn is a plain, substantive-looking final answer with NO tool calls and
    // NO test/smoke check ever run — this must not be allowed to finish as "done".
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: 'I updated math.js to adjust the addition logic as requested. The change is in place and ready to use.' }] }
        }]
      })
    };
  };

  try {
    global.setTimeout = (fn, delay) => {
      if (delay !== 500) return originalSetTimeout(fn, delay);
      return null;
    };

    await window.runAgentLoop('tweak the add function in math.js', 'gemini-1', conversation);

    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    t.ok(aiMessage, 'assistant message was created');
    t.ok(aiMessage.text.includes('did not verify the change with a real test'), 'the run is honestly reported as unverified instead of finishing silently');
    t.ok(aiMessage.text.includes('math.js'), 'the unverified file is named in the message');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: a real run showed patch_file's own auto-test-after-edit check detecting a real
// regression ("[WARNING] REGRESSION DETECTED...]" embedded in the tool result message), but the
// run kept patching more files anyway instead of stopping to fix it — because that warning text
// was never captured on the walkthrough item, and a failed run_tests/run_command call was still
// being treated as "verification happened" since only the tool name/command was checked, not
// whether it actually passed.
test('verification-status helpers require a check to actually pass, not just run', (t) => {
  const failedRunTests = [
    { kind: 'file', path: 'a.js', status: 'done' },
    { toolName: 'run_tests', status: 'error' }
  ];
  t.equal(agent.hasVerificationAfterLastFileEdit(failedRunTests), false, 'a failed run_tests call is not verification');

  const passedRunTests = [
    { kind: 'file', path: 'a.js', status: 'done' },
    { toolName: 'run_tests', status: 'done' }
  ];
  t.equal(agent.hasVerificationAfterLastFileEdit(passedRunTests), true, 'a passing run_tests call is real verification');

  const item = { label: 'Wrote a.js' };
  agent.updateWalkthroughItem(item, 'patch_file', { path: 'a.js' }, {
    success: true,
    message: 'File patched successfully.\n[WARNING] REGRESSION DETECTED: Regression tests failed after this patch. Please inspect your change.'
  }, null);
  t.equal(item.regressionDetected, true, 'the regression warning embedded in an otherwise-successful patch result is captured on the item');
  t.ok(item.detail.includes('Regression detected'), 'the walkthrough detail surfaces the regression to the user, not just internal gating');

  const cleanItem = { label: 'Wrote b.js' };
  agent.updateWalkthroughItem(cleanItem, 'patch_file', { path: 'b.js' }, { success: true, message: 'File patched successfully.' }, null);
  t.equal(cleanItem.regressionDetected, false, 'a clean patch result is not flagged');

  t.equal(agent.hasUnresolvedRegressionWarning([item]), true, 'a regression-flagged edit with no later verification is unresolved');
  t.equal(agent.hasUnresolvedRegressionWarning([item, { toolName: 'run_tests', status: 'done' }]), false, 'a later passing verification resolves the regression');
  t.equal(agent.hasUnresolvedRegressionWarning([item, cleanItem]), true, 'more edits alone do not resolve a previously detected regression without a real passing check');

  t.end();
});

// Regression: a real run showed patch_file's replace_range corrupting a file's syntax (deleting
// a method signature via a stale/miscalculated line range) without the project's own test command
// ever catching it, since that project's `npm test` was a placeholder script. A tool-independent
// `node --check` right after the edit catches this kind of corruption regardless of what (if
// anything) the project's own test command actually verifies.
test('checkJsSyntaxAfterEdit runs node --check on JS files and skips non-JS paths', async (t) => {
  const originalApi = global.window.api;
  const calls = [];
  global.window.api = {
    runCommand: async (command) => {
      calls.push(command);
      if (command.includes('broken.js')) {
        return { code: 1, stderr: 'SyntaxError: Unexpected token' };
      }
      return { code: 0, stdout: '' };
    }
  };

  const okResult = await agent.checkJsSyntaxAfterEdit('/test/workspace', 'src/good.js');
  t.equal(okResult.ok, true, 'valid JS reports ok');

  const badResult = await agent.checkJsSyntaxAfterEdit('/test/workspace', 'src/broken.js');
  t.equal(badResult.ok, false, 'invalid JS reports not ok');
  t.ok(badResult.error.includes('Unexpected token'), 'error text is surfaced');

  const skipped = await agent.checkJsSyntaxAfterEdit('/test/workspace', 'README.md');
  t.equal(skipped.ok, true, 'non-JS files are skipped entirely');
  t.equal(calls.length, 2, 'node --check was only invoked for the two .js paths, not README.md');

  global.window.api = originalApi;
  t.end();
});

test('a syntax error introduced by an edit is captured as an unresolved regression, distinct from a test-suite regression', (t) => {
  const item = { label: 'Wrote broken.js' };
  agent.updateWalkthroughItem(item, 'write_file', { path: 'broken.js' }, {
    success: true,
    message: 'File written to broken.js successfully.\n[WARNING] SYNTAX ERROR DETECTED: node --check failed for broken.js:\nSyntaxError: Unexpected token'
  }, null);
  t.equal(item.regressionDetected, true, 'a syntax error is treated as an unresolved regression');
  t.ok(item.detail.includes('Syntax error'), 'the walkthrough detail distinguishes a syntax error from a test regression');

  t.equal(agent.hasUnresolvedRegressionWarning([item]), true, 'a syntax error with no later verification is unresolved');
  t.equal(agent.hasUnresolvedRegressionWarning([item, { toolName: 'run_tests', status: 'done' }]), false, 'a later passing verification resolves it');
  t.end();
});

// Regression: a transcript showed four consecutive patch_file attempts on the same file each
// reintroduce a fresh syntax error (replace_range line numbers drifting after every edit), with
// zero escalation, because a patch result embedding a syntax warning still reports success:true —
// it never registers with the ordinary repeated-tool-failure counter. The user explicitly required
// that the escalation NEVER suggest a full write_file rewrite for a large file (risk of silently
// losing unrelated content) — only small files should get that suggestion.
test('buildRepeatedEditFailureEscalation recommends different strategies for small vs large files', async (t) => {
  const originalApi = global.window.api;

  global.window.api = { readFile: async () => 'short file content' };
  const smallGuidance = await agent.buildRepeatedEditFailureEscalation('/test/workspace', 'small.js', 3);
  t.ok(/small enough to rewrite safely/.test(smallGuidance), 'a small file is told a full rewrite is safe');
  t.notOk(/do NOT rewrite/.test(smallGuidance), 'a small file is not given the large-file warning');

  global.window.api = { readFile: async () => 'x'.repeat(20000) };
  const largeGuidance = await agent.buildRepeatedEditFailureEscalation('/test/workspace', 'big.js', 3);
  t.ok(/do NOT rewrite the whole file/.test(largeGuidance), 'a large file is explicitly told not to do a full rewrite');
  t.ok(/exact, unique target string/.test(largeGuidance), 'a large file is steered toward modify_file over line-based replace_range');

  global.window.api = { readFile: async () => { throw new Error('read failed'); } };
  const unknownSizeGuidance = await agent.buildRepeatedEditFailureEscalation('/test/workspace', 'unknown.js', 3);
  t.ok(/do NOT rewrite the whole file/.test(unknownSizeGuidance), 'when file size cannot be determined, the safer (large-file) guidance is used');

  global.window.api = originalApi;
  t.end();
});

// Regression: Gemini's MALFORMED_FUNCTION_CALL retry loop repeated the exact same static "be
// simpler" message on every attempt, with no adaptation and no attempt to name a likely cause. A
// transcript showed this happen repeatedly while the model tried to embed a large, multi-hundred-
// line code block (backtick template literals, nested quotes) as a single JSON string argument —
// exactly the kind of payload most likely to break JSON generation. Once the first generic retry
// fails, the guidance should name that cause and suggest a concrete fix instead of repeating itself.
test('buildMalformedFunctionCallGuidance escalates after the first retry instead of repeating itself', (t) => {
  const first = agent.buildMalformedFunctionCallGuidance(1);
  t.notOk(/large, multi-line/.test(first), 'the first attempt gets the plain generic message');
  t.ok(/valid JSON function call/.test(first), 'the first attempt still explains the basic requirement');

  const second = agent.buildMalformedFunctionCallGuidance(2);
  t.ok(/large, multi-line/.test(second), 'the second attempt names large multi-line code blocks as the likely cause');
  t.ok(/template literals/.test(second), 'the second attempt calls out template literals/backticks specifically');
  t.ok(/smaller edit/i.test(second), 'the second attempt suggests a concrete fix: splitting into a smaller edit');
  t.ok(/failed 2 times/.test(second), 'the message reflects the actual attempt count');

  const fourth = agent.buildMalformedFunctionCallGuidance(4);
  t.ok(/failed 4 times/.test(fourth), 'later attempts keep reflecting the current attempt count');
  t.notEqual(first, second, 'the escalated message is meaningfully different from the first attempt, not a repeat');
  t.end();
});

// Regression: a project's `npm test` script was a placeholder (`echo "no tests configured"`)
// that always exits 0. A run_tests/run_command call against it looked like real verification to
// the gates even though nothing was actually tested.
test('looksLikePlaceholderTestOutput identifies no-op test scripts, not real test output', (t) => {
  t.equal(agent.looksLikePlaceholderTestOutput('no tests configured'), true);
  t.equal(agent.looksLikePlaceholderTestOutput('Error: no test specified'), true);
  t.equal(agent.looksLikePlaceholderTestOutput('0 tests found'), true);
  t.equal(agent.looksLikePlaceholderTestOutput(''), false, 'empty output is not treated as a placeholder match');
  t.equal(agent.looksLikePlaceholderTestOutput('12 passing (45ms)'), false, 'real test output is not flagged');
  t.end();
});

test('a run_tests call against a placeholder test script does not count as verification', (t) => {
  const placeholderItem = { toolName: 'run_tests', status: 'done' };
  agent.updateWalkthroughItem(placeholderItem, 'run_tests', {}, { success: true, output: 'no tests configured' }, null);
  t.equal(agent.isVerificationItem(placeholderItem), false, 'placeholder output is rejected as verification even though the tool reported success');

  const realItem = { toolName: 'run_tests', status: 'done' };
  agent.updateWalkthroughItem(realItem, 'run_tests', {}, { success: true, output: '5 passing' }, null);
  t.equal(agent.isVerificationItem(realItem), true, 'real test output still counts as verification');
  t.end();
});

// The work-walkthrough UI showed "Updated `file.js`" for both modify_file and patch_file calls,
// and "Read `file.js`" whether the model read the whole file or a five-line slice — giving the
// user no way to tell what Orion actually did without opening the raw tool-call log.
test('work-walkthrough labels distinguish read/modify/patch calls instead of using generic text', (t) => {
  t.equal(agent.summarizeToolStart('read_file', { path: 'a.js' }).label, 'Read `a.js`', 'a whole-file read has no range suffix');
  t.equal(
    agent.summarizeToolStart('read_file', { path: 'a.js', startLine: 10, endLine: 25 }).label,
    'Read `a.js` (lines 10-25)',
    'a ranged read shows the line range'
  );
  t.equal(
    agent.summarizeToolStart('read_file', { path: 'a.js', startLine: 10 }).label,
    'Read `a.js` (lines 10+)',
    'an open-ended range (no endLine) is still distinguishable from a whole-file read'
  );

  t.equal(agent.summarizeToolStart('modify_file', { path: 'a.js' }).label, 'Modified `a.js`');
  t.equal(
    agent.summarizeToolStart('patch_file', { path: 'a.js', operation: { type: 'insert', position: 'after' } }).label,
    'Patched `a.js` (insert after anchor)'
  );
  t.equal(
    agent.summarizeToolStart('patch_file', { path: 'a.js', operation: { type: 'replace_range', startLine: 12, endLine: 14 } }).label,
    'Patched `a.js` (lines 12-14)'
  );
  t.notEqual(
    agent.summarizeToolStart('modify_file', { path: 'a.js' }).label,
    agent.summarizeToolStart('patch_file', { path: 'a.js', operation: { type: 'replace', target: 'x', replacement: 'y' } }).label,
    'modify_file and patch_file no longer share the same generic label'
  );
  t.end();
});

// Regression: launch_workspace_app only confirms the OS accepted the spawn call, not that the app
// is actually running. A transcript showed it launch the same app twice ("can you launch it" then
// "can you launch it again") and declare success both times with zero follow-up check either time.
test('hasVerificationAfterLastAppLaunch requires a real check after launching, not just the launch itself', (t) => {
  const launchOnly = [{ toolName: 'launch_workspace_app', status: 'done' }];
  t.equal(agent.hasVerificationAfterLastAppLaunch(launchOnly), false, 'a launch with no follow-up check is unverified');

  const launchThenCheck = [
    { toolName: 'launch_workspace_app', status: 'done' },
    { toolName: 'open_url', status: 'done' }
  ];
  t.equal(agent.hasVerificationAfterLastAppLaunch(launchThenCheck), true, 'open_url after a launch counts as verification');

  const launchTwiceNoCheck = [
    { toolName: 'launch_workspace_app', status: 'done' },
    { toolName: 'open_url', status: 'done' },
    { toolName: 'launch_workspace_app', status: 'done' }
  ];
  t.equal(agent.hasVerificationAfterLastAppLaunch(launchTwiceNoCheck), false,
    'a second launch after the first was verified resets the requirement — verifying the first launch does not cover the second');

  const failedLaunch = [{ toolName: 'launch_workspace_app', status: 'error' }];
  t.equal(agent.isAppLaunchItem(failedLaunch[0]), false, 'a failed launch attempt is not treated as a launch needing verification');

  const failedCheck = [
    { toolName: 'launch_workspace_app', status: 'done' },
    { toolName: 'open_url', status: 'error' }
  ];
  t.equal(agent.hasVerificationAfterLastAppLaunch(failedCheck), false, 'a failed open_url attempt does not count as verification');

  const noLaunchAtAll = [{ toolName: 'read_file', status: 'done' }];
  t.equal(agent.hasVerificationAfterLastAppLaunch(noLaunchAtAll), true, 'a turn with no launch at all has nothing to verify');
  t.end();
});

test('launching an app and declaring success without checking is caught, exactly like an unverified file edit', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.lastLaunchLogs = '';
  global.window.lastLaunchUrl = '';
  global.window.api = {
    readFile: async () => '',
    listFiles: async () => ([]),
    launchWorkspaceApp: async () => ({ success: true, message: 'Started background server with command: "npm start"' })
  };

  const conversation = { id: 'test-launch-no-verify', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"launching a program"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    if (turnCount === 1) {
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'launch_workspace_app', args: {} } }] } }] }) };
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'The application has been launched.' }] } }] })
    };
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : (delay === 1500 ? fn() : originalSetTimeout(fn, delay)));
    await window.runAgentLoop('can you launch it', 'gemini-1', conversation);

    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    t.ok(aiMessage, 'assistant message was created');
    t.ok(/did not verify it/.test(aiMessage.text), 'the run reports that the launch was not verified, instead of declaring success');
    t.notOk(/has been launched\.$/.test(aiMessage.text.trim()), 'the unverified "launched" claim is not what reaches the user as final');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    delete global.window.lastLaunchLogs;
    delete global.window.lastLaunchUrl;
  }

  t.end();
});

test('launch_workspace_app surfaces captured output/URL into the tool result instead of just the spawn-succeeded message', async (t) => {
  global.window.lastLaunchLogs = 'Server listening at http://localhost:5173\n';
  global.window.lastLaunchUrl = 'http://localhost:5173';
  global.window.api = {
    launchWorkspaceApp: async () => ({ success: true, message: 'Started background server with command: "npm start"' })
  };
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, delay) => (delay === 1500 ? fn() : originalSetTimeout(fn, delay));

  try {
    const result = await agent.executeTool('launch_workspace_app', {}, '/test/workspace', {}, { id: 'test-surface' });
    t.ok(result.capturedOutput.includes('localhost:5173'), 'captured launch output is included in the tool result');
    t.equal(result.detectedUrl, 'http://localhost:5173', 'the detected URL is included in the tool result');
    t.ok(/Confirm with open_url/.test(result.verificationNote), 'a verification note tells the model to confirm before assuming success');
  } finally {
    global.setTimeout = originalSetTimeout;
    delete global.window.lastLaunchLogs;
    delete global.window.lastLaunchUrl;
  }
  t.end();
});

test('launch_workspace_app tells the model to verify even when nothing was captured', async (t) => {
  global.window.lastLaunchLogs = '';
  global.window.lastLaunchUrl = '';
  global.window.api = {
    launchWorkspaceApp: async () => ({ success: true, message: 'Started configured entry point: "python app.py"' })
  };
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, delay) => (delay === 1500 ? fn() : originalSetTimeout(fn, delay));

  try {
    const result = await agent.executeTool('launch_workspace_app', {}, '/test/workspace', {}, { id: 'test-surface-empty' });
    t.equal(result.capturedOutput, '', 'no output was captured for this launch path');
    t.equal(result.detectedUrl, '', 'no URL was detected');
    t.ok(/does not capture output|failed silently/.test(result.verificationNote), 'the note explains nothing was captured and verification is still required');
  } finally {
    global.setTimeout = originalSetTimeout;
    delete global.window.lastLaunchLogs;
    delete global.window.lastLaunchUrl;
  }
  t.end();
});

test('a second consecutive MALFORMED_FUNCTION_CALL gets escalated guidance instead of the same generic retry message', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = { readFile: async () => '', listFiles: async () => ([]) };

  const conversation = { id: 'test-malformed-escalation', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  let lastContentsSeen = null;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    lastContentsSeen = contents;
    if (turnCount <= 2) {
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL', content: { parts: [{ text: '[garbled attempt]' }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Made a smaller edit instead.' }] } }] }) };
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : originalSetTimeout(fn, delay));
    await window.runAgentLoop('apply the change', 'gemini-1', conversation);

    const contentsText = JSON.stringify(lastContentsSeen);
    t.ok(/large, multi-line/.test(contentsText), 'the escalated guidance (naming large multi-line code blocks) reaches the model after the 2nd malformed call');
    t.ok(/failed 2 times/.test(contentsText), 'the escalated guidance reflects the actual attempt count');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

test('three consecutive syntax-error-introducing patches to the same file trigger a strategy-change escalation', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0, autoTest: false });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async () => 'x'.repeat(20000), // large file -> escalation must not suggest a full rewrite
    patchFile: async (workspace, filePath) => ({ success: true, changed: true, message: `Patched ${filePath} successfully.\n[WARNING] SYNTAX ERROR DETECTED: node --check failed:\nSyntaxError: Unexpected token` }),
    listFiles: async () => ([]),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
  };

  const conversation = { id: 'test-repeated-edit-escalation', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  let lastContentsSeen = null;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    lastContentsSeen = contents;
    const patchCall = (target) => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'patch_file', args: { path: 'server.js', operation: { type: 'replace', target, replacement: 'y' } } } }] } }] })
    });
    if (turnCount === 1) return patchCall('a'); // 1st edit
    if (turnCount === 2) return patchCall('c'); // 2nd edit -> next edit to this file now requires a read first
    if (turnCount === 3) {
      // read_file to satisfy the edit-thrash guard before the 3rd edit
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'server.js' } } }] } }] }) };
    }
    if (turnCount === 4) return patchCall('e'); // 3rd consecutive syntax-error-introducing edit -> escalation fires
    return {
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Stopping to reconsider the approach for server.js.' }] } }] })
    };
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : originalSetTimeout(fn, delay));
    await window.runAgentLoop('fix the syntax error in server.js', 'gemini-1', conversation);

    const contentsText = JSON.stringify(lastContentsSeen);
    t.ok(/REPEATED EDIT FAILURE/.test(contentsText), 'the escalation warning reaches the model in conversation history after the 3rd consecutive failure');
    t.ok(/do NOT rewrite the whole file/.test(contentsText), 'the large-file guidance (not a full rewrite) is what gets sent, matching the large mocked file content');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: a plain "can you launch this program?" request silently escalated into 7+
// unrequested edits to server.js after the launch failed on a pre-existing bug — the user asked
// for a low-risk, read-only action and got repeated, destructive-feeling source changes with no
// check-in at all.
test('looksLikeLaunchOnlyRequest and hasFailedLaunchAttemptThisRun identify the exact scope-creep scenario', (t) => {
  t.equal(agent.looksLikeLaunchOnlyRequest('can you launch this program?'), true, 'a plain launch request has no edit language');
  t.equal(agent.looksLikeLaunchOnlyRequest('can you run it'), true, 'a plain run request has no edit language');
  t.equal(agent.looksLikeLaunchOnlyRequest('can you fix the bug and launch it'), false, 'edit language in the same request removes the restriction');
  t.equal(agent.looksLikeLaunchOnlyRequest('yes, please fix it'), false, 'an explicit follow-up authorization is not treated as launch-only');
  t.equal(agent.looksLikeLaunchOnlyRequest('what does this project do'), false, 'a request with no launch verb at all does not match');
  t.equal(agent.looksLikeLaunchOnlyRequest(''), false, 'empty text does not match');

  const failedLaunch = [{ toolName: 'launch_workspace_app', status: 'error' }];
  t.equal(agent.hasFailedLaunchAttemptThisRun(failedLaunch), true, 'a failed launch_workspace_app is detected');

  const failedNpmStart = [{ toolName: 'run_command', status: 'error', command: 'npm start' }];
  t.equal(agent.hasFailedLaunchAttemptThisRun(failedNpmStart), true, 'a failed run_command (e.g. npm start) is detected');

  const successfulLaunch = [{ toolName: 'launch_workspace_app', status: 'done' }];
  t.equal(agent.hasFailedLaunchAttemptThisRun(successfulLaunch), false, 'a successful launch is not a failed attempt');

  const unrelatedFailure = [{ toolName: 'read_file', status: 'error' }];
  t.equal(agent.hasFailedLaunchAttemptThisRun(unrelatedFailure), false, 'an unrelated failed tool call does not count');
  t.end();
});

test('a plain launch request is blocked from silently editing source files after the launch fails', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async () => '',
    listFiles: async () => ([]),
    launchWorkspaceApp: async () => ({ success: false, error: 'npm start exited with code 1' }),
    patchFile: async () => ({ success: true, changed: true, message: 'Patched server.js successfully.' })
  };

  const conversation = { id: 'test-launch-only-scope', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"launching a program"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    if (turnCount === 1) {
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'launch_workspace_app', args: {} } }] } }] }) };
    }
    if (turnCount === 2) {
      // The model tries to "fix" server.js immediately after the failed launch, unprompted.
      return {
        ok: true,
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'patch_file', args: { path: 'server.js', operation: { type: 'replace', target: 'x', replacement: 'y' } } } }] } }] })
      };
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'The launch failed. Want me to look into fixing it?' }] } }] })
    };
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : originalSetTimeout(fn, delay));
    await window.runAgentLoop('can you launch this program?', 'gemini-1', conversation);

    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    const toolCalls = (aiMessage.logs || []).filter(l => l.type === 'tool_call');
    const patchAttempt = toolCalls.find(c => c.tool === 'patch_file');
    t.ok(patchAttempt, 'the patch_file attempt was made by the model');
    t.equal(patchAttempt.status, 'error', 'the unrequested edit was blocked, not allowed through');
    t.ok(String(patchAttempt.result).includes('only asked you to launch'), 'the block explains the launch-only scope');
    t.ok(/want me to look into fixing/i.test(aiMessage.text), 'the model asks the user before making changes, instead of silently editing');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: after a strategy-change nudge, the model may still fail to fix the file — that
// points at a raw capability limit (miscounting lines across a large edit), not a missing
// guardrail. Once the repeated-edit-failure threshold hits, escalate to a stronger model for the
// turns needed to fix the file, then revert once it gets a clean edit so the rest of the run
// doesn't silently stay on the more expensive model for no reason.
test('repeated edit failures escalate to a stronger model, then revert once the file is fixed', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0, autoTest: false });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};

  let patchCallCount = 0;
  global.window.api = {
    readFile: async () => 'x'.repeat(20000),
    patchFile: async (workspace, filePath) => {
      patchCallCount++;
      // First 3 patches introduce a syntax error; the 4th (after escalation) is clean.
      const broken = patchCallCount <= 3;
      return {
        success: true,
        changed: true,
        message: `Patched ${filePath} successfully.${broken ? '\n[WARNING] SYNTAX ERROR DETECTED: node --check failed:\nSyntaxError: Unexpected token' : ''}`
      };
    },
    listFiles: async () => ([]),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
  };

  const conversation = { id: 'test-model-escalation', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  const modelsRequested = [];
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    const modelMatch = String(url).match(/\/models\/([^:]+):generateContent/);
    modelsRequested.push(modelMatch ? modelMatch[1] : null);

    const patchCall = (target) => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'patch_file', args: { path: 'server.js', operation: { type: 'replace', target, replacement: 'y' } } } }] } }] })
    });
    const readCall = () => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'server.js' } } }] } }] })
    });
    if (turnCount === 1) return patchCall('a'); // 1st edit, streak=1, still original model
    if (turnCount === 2) return patchCall('c'); // 2nd edit, streak=2, still original model, needs-read set
    if (turnCount === 3) return readCall();      // satisfy edit-thrash guard
    if (turnCount === 4) return patchCall('e'); // 3rd edit, streak=3 -> escalation triggers after this
    if (turnCount === 5) return readCall();      // satisfy edit-thrash guard again (request still uses escalated model)
    if (turnCount === 6) return patchCall('g'); // 4th edit, this one is clean -> reverts after this
    return {
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'server.js is fixed now.' }] } }] })
    };
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : originalSetTimeout(fn, delay));
    await window.runAgentLoop('fix the syntax error in server.js', 'gemini-2.5-flash-lite', conversation);

    t.equal(modelsRequested[0], 'gemini-2.5-flash-lite', 'turn 1 uses the originally selected model');
    t.equal(modelsRequested[3], 'gemini-2.5-flash-lite', 'turn 4 (the request that triggers escalation) still uses the original model — escalation applies to the NEXT call');
    t.equal(modelsRequested[4], 'gemini-2.5-flash', 'turn 5 (right after the 3rd consecutive failure) is escalated to the stronger model');
    t.equal(modelsRequested[5], 'gemini-2.5-flash', 'turn 6 (the clean fix attempt) still runs on the escalated model');
    t.equal(modelsRequested[6], 'gemini-2.5-flash-lite', 'turn 7 (after the clean edit) reverts back to the originally selected model');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

test('a real detected regression stops the run with a specific message, not a generic "unverified" one', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0, autoTest: true });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  let regressionCheckCount = 0;
  global.window.runRegressionTests = async () => {
    regressionCheckCount++;
    // First call (before the edit) reports passing; second call (after the edit) reports failing —
    // matching the tool handler's own beforePass/afterPass comparison that decides whether to embed
    // the "[WARNING] REGRESSION DETECTED...]" text.
    return { success: regressionCheckCount % 2 === 1, output: regressionCheckCount % 2 === 1 ? 'ok' : 'FAIL: 1 test failed' };
  };
  global.window.api = {
    readFile: async () => '',
    patchFile: async () => ({ success: true, changed: true, message: 'Patched src/game/units/MilitaryUnit.js successfully.' }),
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
  };

  const conversation = { id: 'test-real-regression', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    if (turnCount === 1) {
      return {
        ok: true,
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'patch_file', args: { path: 'src/game/units/MilitaryUnit.js', operation: { type: 'insert', anchor: 'x', content: 'y', position: 'before' } } } }] } }] })
      };
    }
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: 'Added the new AI state handling to MilitaryUnit.js as requested.' }] }
        }]
      })
    };
  };

  try {
    global.setTimeout = (fn, delay) => {
      if (delay !== 500) return originalSetTimeout(fn, delay);
      return null;
    };

    await window.runAgentLoop('add AI states to MilitaryUnit.js', 'gemini-1', conversation);

    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    t.ok(aiMessage, 'assistant message was created');
    t.ok(aiMessage.text.includes('regression test check that ran after one of these edits FAILED'), 'the run reports the specific regression failure, not a generic unverified message');
    t.notOk(aiMessage.text.includes('did not verify the change with a real test'), 'this is not mistaken for the generic missing-verification case');
    t.ok(aiMessage.text.includes('MilitaryUnit.js'), 'the affected file is named');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    delete global.window.runRegressionTests;
  }

  t.end();
});

// Regression: a user asked Orion to keep discussing a topic ("let's talk about this: ...").
// Orion's internal correction for a too-terse first reply told the model "don't mention tools,
// workspace, or this correction" — but gave it nothing concrete to redirect toward, so the model
// just paraphrased the correction back instead of answering: "My previous response... did not
// require workspace interaction or an implementation plan. I am ready for your next instruction."
// looksLikeLeakedNoToolCorrection() detects this specific failure mode so a stronger retry can fire.
test('looksLikeLeakedNoToolCorrection detects a model describing its own internal correction instead of answering', (t) => {
  const leaked = 'Understood. My previous response was a discussion about game features and did not require workspace interaction or an implementation plan. I am ready for your next instruction.';
  t.equal(agent.looksLikeLeakedNoToolCorrection(leaked), true, 'the exact leaked phrasing from the transcript is detected');
  t.equal(
    agent.looksLikeLeakedNoToolCorrection("Sure! Let's dig into Assetto Corsa's tire model and how that could inspire Apex Velocity's pit-stop mechanic."),
    false,
    'a genuine on-topic reply is not flagged'
  );
  t.equal(agent.looksLikeLeakedNoToolCorrection(''), false, 'empty text is not flagged');
  t.end();
});

test('a leaked no-tool-use correction triggers a stronger retry instead of being accepted as the final answer', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = { readFile: async () => '', listFiles: async () => ([]) };

  const conversation = { id: 'test-leaked-correction', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"conversational follow-up"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    const textReply = (text) => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }) });
    if (turnCount === 1) return textReply(''); // empty first reply triggers the no-tool-use correction
    if (turnCount === 2) return textReply('Understood. My previous response was a discussion about game features and did not require workspace interaction or an implementation plan. I am ready for your next instruction.');
    return textReply("Sure — Assetto Corsa's tire wear model could work great for a pit-strategy mechanic in Apex Velocity.");
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : originalSetTimeout(fn, delay));
    await window.runAgentLoop("let's talk about this: Apex Velocity racing ideas", 'gemini-1', conversation);

    const aiMessage = conversation.messages.find(m => m.role === 'assistant');
    t.ok(aiMessage, 'assistant message was created');
    t.ok(turnCount >= 3, 'the loop made at least three real model calls instead of accepting the leaked correction on the second');
    t.notOk(/did not require workspace interaction|ready for your next instruction/i.test(aiMessage.text),
      'the leaked correction text is not what gets shown to the user as the final answer');
    t.ok(aiMessage.text.includes('Assetto Corsa'), 'the eventual real, on-topic answer is what gets shown');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

// Regression: a transcript showed Orion retry a failing `python -c "..."` command six times in a
// row, each attempt only cosmetically different (single vs double quotes, a redundant `import
// sys`, swapping print() for sys.stdout.write()) — but the repeated-failure guard keys on an exact
// match of the tool's args, so each "new" quoting variant reset the counter back to zero and the
// guard never escalated even though it was the same failure repeating six times.
test('repeated-failure key collapses cosmetically different run_command/start_command retries', (t) => {
  const doubleQuoted = agent.buildRepeatedFailureKey(
    'run_command',
    { command: 'python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash(\'password123\'))"' },
    'tool_failure'
  );
  const singleQuoted = agent.buildRepeatedFailureKey(
    'run_command',
    { command: "python -c 'from werkzeug.security import generate_password_hash; print(generate_password_hash(\"password123\"))'" },
    'tool_failure'
  );
  t.equal(doubleQuoted, singleQuoted, 'quote-style-only differences in an otherwise identical command collapse to the same key');

  const differentCategory = agent.buildRepeatedFailureKey(
    'run_command',
    { command: 'python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash(\'password123\'))"' },
    'missing_dependency'
  );
  t.notEqual(doubleQuoted, differentCategory, 'a different failure category still produces a different key even for the same command');

  const differentCommand = agent.buildRepeatedFailureKey('run_command', { command: 'npm test' }, 'tool_failure');
  t.notEqual(doubleQuoted, differentCommand, 'a genuinely different command still produces a different key');

  const startCommandKey = agent.buildRepeatedFailureKey('start_command', { command: 'python -c "print(1)"' }, 'tool_failure');
  t.ok(startCommandKey.startsWith('start_command:'), 'start_command gets the same cosmetic-normalization treatment as run_command');
  t.end();
});

// Regression: `npx jest --init` failed with stderr that already named the exact fix ("Option
// \"init\" has been deprecated. Please use \"create-jest\" package..."), but Orion still burned
// two web searches re-discovering that same replacement command instead of just running it. The
// answer was already in the tool output it had just received.
test('a CLI error that names its own replacement command is classified so Orion runs it instead of researching it', (t) => {
  const errorText = 'Command exited with code 1. stderr:  init:\n\n  Option "init" has been deprecated. Please use "create-jest" package as shown in the documentation: https://jestjs.io/docs/getting-started\n';
  const failure = agent.classifyAgentFailure({ toolName: 'run_command', args: { command: 'npx jest --init' }, errorText });
  t.equal(failure.category, 'deprecated_command_with_replacement', 'the deprecation + named replacement is recognized as its own category');
  t.equal(failure.replacementHint, 'create-jest', 'the exact replacement command is extracted from the error text');

  const guidance = agent.buildFailureRecoveryGuidance(failure);
  t.ok(guidance.includes('create-jest'), 'the recovery guidance names the replacement command directly');
  t.ok(/do not search the web/i.test(guidance), 'the guidance explicitly discourages re-researching information already in the tool output');

  const genericFailure = agent.classifyAgentFailure({ toolName: 'run_command', args: { command: 'npm run build' }, errorText: 'Command exited with code 1. stderr: some unrelated build error' });
  t.notEqual(genericFailure.category, 'deprecated_command_with_replacement', 'an unrelated failure is not misclassified as a deprecation hint');
  t.end();
});

// Regression: a real transcript showed Orion break src/game/buildings/Barracks.js with a syntax
// error, then move on and ALSO break ArcheryRange.js and Spearman.js instead of going back to fix
// Barracks.js first — three broken files accumulated because the finish-time
// hasUnresolvedRegressionWarning gate only runs when the model tries to produce a text-only final
// answer, and this run never stopped calling tools. The cross-file breakage guard must block an
// edit to a different file while an earlier one is left broken, and unblock once that file is
// fixed (re-edited clean).
test('editing a different file while an earlier one has an unresolved syntax error is blocked until it is fixed', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;
  const originalFetch = global.fetch;

  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0, autoTest: false });
  global.window.getCurrentWorkspace = () => '/test/workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};

  let fileACheckCount = 0;
  const runCommandCalls = [];
  global.window.api = {
    readFile: async () => '',
    patchFile: async (workspace, path) => ({ success: true, changed: true, message: `Patched ${path} successfully.` }),
    listFiles: async () => ([{ path: 'test.txt', isDir: false, size: 100 }]),
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
    runCommand: async (command) => {
      runCommandCalls.push(command);
      if (command.includes('fileA.js')) {
        fileACheckCount++;
        // First check on fileA.js fails (the broken edit); the second (the fix) passes.
        return fileACheckCount === 1 ? { code: 1, stderr: 'SyntaxError: Unexpected token' } : { code: 0, stdout: '' };
      }
      return { code: 0, stdout: '' };
    }
  };

  const conversation = { id: 'test-cross-file-breakage', messages: [], awaitingPlanApproval: false, planApproved: true };

  let turnCount = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"continuing approved execution"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    const patchCall = (path) => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'patch_file', args: { path, operation: { type: 'replace', target: 'x', replacement: 'y' } } } }] } }] })
    });
    if (turnCount === 1) return patchCall('src/fileA.js');       // breaks fileA.js
    if (turnCount === 2) return patchCall('src/fileB.js');       // should be blocked: fileA.js still broken
    if (turnCount === 3) return patchCall('src/fileA.js');       // fixes fileA.js
    if (turnCount === 4) return patchCall('src/fileB.js');       // now allowed
    return {
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Finished editing both files.' }] } }] })
    };
  };

  try {
    global.setTimeout = (fn, delay) => (delay === 500 ? null : originalSetTimeout(fn, delay));
    await window.runAgentLoop('edit fileA.js and fileB.js', 'gemini-1', conversation);

    const toolCalls = (conversation.messages[conversation.messages.length - 1]?.logs || [])
      .filter(l => l.type === 'tool_call');
    const fileBAttempts = toolCalls.filter(c => c.tool === 'patch_file' && c.params && c.params.path === 'src/fileB.js');
    t.equal(fileBAttempts.length, 2, 'fileB.js was attempted twice: once blocked, once allowed after the fix');
    t.equal(fileBAttempts[0].status, 'error', 'the first fileB.js attempt was rejected while fileA.js was still broken');
    t.ok(String(fileBAttempts[0].result).includes('fix_other_file_first') || String(fileBAttempts[0].result).includes('fileA.js'),
      'the block explains which file needs to be fixed first');
    t.equal(fileBAttempts[1].status, 'success', 'the second fileB.js attempt succeeded once fileA.js was fixed');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    delete global.window.runRegressionTests;
  }

  t.end();
});

// Regression: stall detection previously only counted completed checklist items + satisfied win
// conditions as "progress". A model that made real file edits/commands but forgot to check off a
// task looked identical to a pass that only produced failures, and both got flagged as stalled
// after enough passes — stopping a run that was actually still making progress.
test('stall detection also treats successful file edits/commands as progress, not just checklist completion', (t) => {
  const agentSource = require('fs').readFileSync(require('path').join(__dirname, '../agent.js'), 'utf8');
  t.ok(agentSource.includes('hadSuccessfulEditOrCommandThisPass'), 'stall detection tracks successful edits/commands this pass');
  t.ok(agentSource.includes('progressScore > conversation._lastProgressScore || hadSuccessfulEditOrCommandThisPass'),
    'a pass resets stall tracking on either checklist progress or a successful edit/command, not checklist progress alone');
  t.end();
});

// Regression: a fresh task's mission-state reset only ever cleared whatever workspace was active
// at the very start of the turn. When a request named a project that wasn't the active workspace
// yet (e.g. "I have a game called X"), the turn would call change_workspace mid-run to locate it —
// and if that landed on a directory (e.g. a shared parent "projects" folder) that already had its
// own leftover operational-context.json from an unrelated past task, that old mission/blockers got
// picked up and used to evaluate completion for today's unrelated request, wrongly reporting
// "blocked" over e.g. a years-old "Embedding API not available" blocker that has nothing to do
// with the current task. The reset must re-apply wherever change_workspace actually lands.
test('fresh-task mission reset follows change_workspace to wherever the turn actually lands', async (t) => {
  const originalRunAgentLoop = global.window.runAgentLoop;
  const originalSetTimeout = global.setTimeout;

  const staleContext = {
    version: 1,
    revision: 5,
    mission: { statement: 'Execute the strategy in STRATEGY.md.', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
    winConditions: [],
    activeObjective: null,
    activeSubplan: null,
    blockers: { active: [{ id: 'b1', title: 'Embedding API not available', details: '', source: '', severity: 'major', nature: 'transient', count: 1, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }], resolved: [] },
    discoveries: [],
    discarded: [],
    latestEvidence: [],
    lastDistillation: null,
    lastCheckpoint: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z'
  };

  const writes = [];
  global.window.appendSystemMessage = () => {};
  global.window.renderAiMessage = () => {};
  global.window.getAppConfig = () => ({ planningMode: true, geminiApiKey: 'test-key', modelCallDelayMs: 0 });
  global.window.getCurrentWorkspace = () => '/test/bogus-workspace';
  global.window.clearActiveAiBubble = () => {};
  global.window.saveConversationsToStorage = () => {};
  global.window.api = {
    readFile: async (workspacePath, filePath) => {
      if (workspacePath === 'C:\\Users\\Owner\\Desktop\\projects' && filePath === '.orion/context/operational-context.json') {
        return JSON.stringify(staleContext);
      }
      return { error: 'File does not exist' };
    },
    writeFile: async (workspacePath, filePath, content) => {
      writes.push({ workspacePath, filePath, content });
      return { success: true };
    },
    listFiles: async (workspacePath) => {
      if (workspacePath === 'C:\\Users\\Owner\\Desktop\\projects') return [{ path: 'SomeOtherProject', isDir: true, size: 0 }];
      return { error: 'Directory does not exist' };
    },
    getWorkspaceEntrypoint: async () => ({ success: true, entrypoint: null }),
  };

  const conversation = {
    id: 'test-stale-mission-follow',
    messages: [],
    awaitingPlanApproval: false,
    planApproved: false,
    workspace: '/test/bogus-workspace'
  };

  let turnCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const contents = body.contents || [];
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text || '';
    if (lastText.includes('Classify whether this Orion AI request should require an implementation plan')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"read-only inspection"}' }] } }] }) };
    }
    if (String(url).includes(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };

    turnCount++;
    const respondWith = (functionCall) => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall }] } }] }) });
    if (turnCount === 1) return respondWith({ name: 'change_workspace', args: { path: 'C:\\Users\\Owner\\Desktop\\projects' } });
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'I found the projects folder.' }] } }] }) };
  };

  try {
    global.setTimeout = (fn, delay) => {
      if (delay !== 500) return originalSetTimeout(fn, delay);
      return null;
    };

    await window.runAgentLoop('i have a game called mayor life, give me ideas', 'gemini-1', conversation);

    const contextWrite = writes.find(w => w.workspacePath === 'C:\\Users\\Owner\\Desktop\\projects' && w.filePath === '.orion/context/operational-context.json');
    t.ok(contextWrite, 'the workspace change_workspace landed on had its operational context rewritten');
    const written = contextWrite ? JSON.parse(contextWrite.content) : null;
    t.equal(written && written.mission && written.mission.statement, '', 'the stale unrelated mission is cleared, not carried into the new task');
    t.equal(written && written.blockers && written.blockers.active.length, 0, 'the stale unrelated blocker (e.g. an old Embedding API failure) does not carry over either');
  } finally {
    global.window.runAgentLoop = originalRunAgentLoop;
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }

  t.end();
});

test('buildRemainingWorkSummary lists pending tasks and next action honestly', (t) => {
  const pending = [
    { title: 'Implement food spawning', status: 'pending' },
    { title: 'Develop collision detection', status: 'pending' },
  ];
  const state = { activeSubplan: { status: 'active', nextAction: 'Implement food spawning logic' } };

  const msg = agent.buildRemainingWorkSummary(pending, state, false);
  t.ok(/not finished/i.test(msg), 'message states the work is not finished (not a false "Task finished")');
  t.ok(msg.includes('Implement food spawning'), 'lists the first pending task');
  t.ok(msg.includes('Develop collision detection'), 'lists the second pending task');
  t.ok(msg.includes('Implement food spawning logic'), 'surfaces the subplan next action');

  const exhausted = agent.buildRemainingWorkSummary(pending, state, true);
  t.ok(/continue/i.test(exhausted), 'budget-exhausted message tells the user how to resume');
  t.end();
});

// Regression for the "it just quits mid-plan with no answer" failure. When an approved plan
// continues but routing labels the turn 'direct' (not 'executing'), the completion gate must
// still hold the run back. Previously the gate was bypassed and the loop fell straight to
// "Task finished" with most of the work pending.
test('completion gate fires for any execution mode with mission state, not only executing', (t) => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  t.notOk(
    agentSource.includes("hasOperationalMissionState(workingState) && agentExecutionMode === 'executing'"),
    'completion gate no longer keys solely off agentExecutionMode === executing'
  );
  t.ok(
    agentSource.includes("hasOperationalMissionState(workingState) && canExecuteThisTask() && agentExecutionMode !== 'answer'"),
    'completion gate fires whenever execution is allowed and there is mission state'
  );
  t.ok(agentSource.includes('if (executingApprovedPlan && !reviewOnly) maxLoops = 100'), 'approved plan execution gets a large loop budget for long tasks');
  t.ok(agentSource.includes('autoContinueExecution = true'), 'auto-continue path exists for unfinished plan execution');
  t.ok(agentSource.includes('AUTO_CONTINUE_BUDGET'), 'auto-continue is bounded by an absolute ceiling to prevent runaway loops');
  t.ok(agentSource.includes('STALL_LIMIT'), 'auto-continue stops when no goal-level progress is made across passes');
  t.ok(agentSource.includes('progressScore'), 'stall detection is based on completed-work progress, not just activity');
  t.ok(agentSource.includes('const hasResumableWork = hasOperationalMissionState(workingState) || pendingChecklist.length > 0'), 'auto-continue falls back to the checklist when mission state is absent');
  t.end();
});

// Regression for the mid-build stop: a continuation of an approved plan whose later phase merely
// SOUNDS plan-worthy (e.g. "ML training") was re-classified as a new plan, which cleared
// planApproved and wiped operational mission state — disabling the completion gate and
// auto-continue so the run stopped mid-build. The fix keeps the mission while it is in progress.
test('approved-plan continuation does not wipe an in-progress mission when re-classified as plan', (t) => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');

  t.ok(agentSource.includes('const missionInProgress = hasOperationalMissionState(workingState)'),
    'routing computes whether a mission is genuinely in progress');
  t.ok(agentSource.includes("workingState.activeSubplan && workingState.activeSubplan.status === 'active'"),
    'mission-in-progress considers an active subplan');
  t.ok(agentSource.includes("workingState.winConditions.some(condition => condition.status !== 'satisfied')"),
    'mission-in-progress considers unsatisfied win conditions');
  t.ok(agentSource.includes('if (decision.mode === \'plan\' && !missionInProgress)'),
    'a re-plan only triggers when no mission is in progress — never tears down an executing plan');
  t.end();
});

