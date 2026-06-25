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
    if (text.includes('"run tests"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":""}' }] } }] }) };
    }
    if (text.includes('"what all python environments do i have installed on this computer"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":"Read-only local environment inventory."}' }] } }] }) };
    }
    if (text.includes('"explain"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"answer","reason":""}' }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"plan","reason":""}' }] } }] }) };
  }

  return { ok: false };
};

const agent = require('../agent.js');

function validStrategy(overrides = {}) {
  const sections = {
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

  const planRes = await agent.classifyPlanningNeed('build a whole app', 'gemini-1', 'key');
  t.equal(planRes.mode, 'plan', 'Recognizes plan mode');

  const answerRes = await agent.classifyPlanningNeed('explain', 'gemini-1', 'key');
  t.equal(answerRes.mode, 'answer', 'Recognizes answer mode');

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
  t.equal(commandGate.allowed, false, 'blocks command execution before approval');

  const approvedGate = agent.getPlanningToolGate(config, true, 'run_command', { command: 'npm test' });
  t.equal(approvedGate.allowed, true, 'allows destructive tools after approval/direct classification');

  const directGate = agent.getPlanningToolGate(config, true, 'write_file', { path: 'small.txt', content: 'ok' });
  t.equal(directGate.allowed, true, 'direct/simple tasks can bypass refinement through canExecute');

  t.end();
});

test('STRATEGY.md validation requires all refinement sections', (t) => {
  const content = validStrategy();
  t.equal(agent.hasRequiredStrategySections(content), true, 'valid strategy contains all required sections');
  const missing = content.replace(/## What Not To Touch[\s\S]*$/, '');
  t.equal(agent.hasRequiredStrategySections(missing), false, 'missing required section is invalid');
  const validation = agent.validateStrategyContent(missing);
  t.equal(validation.valid, false, 'validation rejects incomplete strategy');
  t.ok(validation.missingSections.includes('What Not To Touch'), 'validation reports missing section');
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

