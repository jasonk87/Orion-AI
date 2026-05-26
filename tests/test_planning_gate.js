const test = require('tape');
const fs = require('fs');
const path = require('path');

const agentJsContent = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');

test('Planning Gate blocks destructive tools when plan needed', (t) => {
  const match = agentJsContent.match(/if \(config\.planningMode && !canExecuteThisTask\(\)\) \{([\s\S]*?)continue;/);
  t.ok(match, 'Found planning mode gate in executeTool');

  if (match) {
    const gateLogic = match[0];
    t.ok(gateLogic.includes("destructiveTools = ['write_file', 'modify_file', 'patch_file', 'run_command', 'start_command', 'run_tests', 'sync_workspace_env', 'launch_workspace_app', 'git_push']"), "Destructive tools list is correct");
    t.ok(gateLogic.includes("isPlanWrite"), "Allows writing implementation_plan.md");
    t.ok(agentJsContent.includes("forceYield = true"), "Yields on plan write");
  }
  t.end();
});

test('classifyPlanApprovalIntent regex definitions present', (t) => {
  t.ok(agentJsContent.includes('approve: the user clearly wants execution'), 'approve definition');
  t.ok(agentJsContent.includes('deny: the user clearly rejects'), 'deny definition');
  t.ok(agentJsContent.includes('revise: the user asks for more review'), 'revise definition');
  t.ok(agentJsContent.includes('unclear: the user intent is ambiguous'), 'unclear definition');
  t.end();
});

test('classifyPlanningNeed regex definitions present', (t) => {
  t.ok(agentJsContent.includes('plan: broad or complex work'), 'plan definition');
  t.ok(agentJsContent.includes('direct: concrete low-risk work'), 'direct definition');
  t.ok(agentJsContent.includes('answer: a question or explanation'), 'answer definition');
  t.end();
});
