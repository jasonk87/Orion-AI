// Why this file exists: a Coder task was asked to commit work to GitHub, inspected the
// repository, ran 303 tests, verified everything - and then reported that it could not
// commit because "this session exposes only read-only environment tooling. There is no
// write-capable command tool available to run git add, git commit, or git push."
//
// run_command was never removed from Coder. It is not in Coder's exclusion set in
// getAvailableToolsForMode, and Operator's allowlist has it too. What actually happened is
// that the semantic intent classifier threw, and semantic-intent-router's catch path
// returns intent 'clarification_required' with the canned question "I could not safely
// determine whether that refers to the current task or plan." The turn was then forced
// into the unresolved-intent gate, whose surface is inspection-only - so Coder kept every
// read tool, lost every write tool, and truthfully reported a blocker that looked like a
// permissions problem rather than a classifier outage.
//
// The same failure has a second face: with a durable task attached, that clarification
// sets forceYield, so the task stays pending forever while the UI shows it as failed.
//
// The rule now is that a classifier FAILURE is not a user AMBIGUITY. Dispatch is still
// gated, because deciding what the user meant is Dispatch's whole job. A specialist is
// not, because it only exists as a task at all after Dispatch classified the request,
// chose the role, and handed over an explicit objective.

const test = require('tape');
global.window = global.window || {};
global.fetch = global.fetch || (async () => ({ ok: false }));
const agent = require('../agent.js');

const recoverable = agent.isSemanticClarificationRecoverable;

function toolNamesForProfile(profile, mode = 'coder') {
  agent.__setActiveConversationModeForTest(mode);
  agent.setActiveToolGateProfile(profile);
  const names = new Set(agent.buildAgentToolDeclarations().map(tool => tool.name));
  agent.setActiveToolGateProfile(null);
  agent.__setActiveConversationModeForTest('orion');
  return names;
}

test('the inspection-only gate is what takes Coder\'s ability to commit', (t) => {
  const open = toolNamesForProfile(null, 'coder');
  t.ok(open.has('run_command'), 'Coder has run_command normally - it was never excluded');

  const gated = toolNamesForProfile({ inspectionOnlyIntent: true }, 'coder');
  for (const writeTool of ['run_command', 'start_command', 'patch_file', 'write_file']) {
    t.notOk(gated.has(writeTool),
      `${writeTool} disappears under the unresolved-intent gate - this is the reported blocker`);
  }
  t.ok(open.size > gated.size, 'the gate is a strict reduction of the surface');
  t.end();
});

test('a routed specialist mission survives a classifier outage', (t) => {
  t.equal(recoverable({ classifierError: 'provider unavailable', isDispatch: false, taskId: 'task-1' }), true,
    'a Coder task with a durable id keeps its tools when the classifier throws');
  t.equal(recoverable({ classifierUnavailable: true, isDispatch: false, taskObjective: 'Commit uncommitted work' }), true,
    'a claimed task objective is equally good evidence the mission was already decided');
  t.end();
});

test('Dispatch is never exempt, because deciding intent is its job', (t) => {
  t.equal(recoverable({ classifierError: 'boom', isDispatch: true, taskId: 'task-1' }), false,
    'Dispatch still stops when it cannot tell what was meant');
  t.equal(recoverable({ classifierUnavailable: true, isDispatch: true }), false,
    'an unbound Dispatch turn is the case the gate was written for');
  t.end();
});

test('the exemption is narrow', (t) => {
  t.equal(recoverable({ classifierError: 'boom', isDispatch: false }), false,
    'a specialist with no task and no objective has nothing to fall back on');
  t.equal(recoverable({ isDispatch: false, taskId: 'task-1' }), false,
    'a healthy classifier asking for clarification is a real signal, not an outage');
  t.equal(recoverable({ isDispatch: false, taskId: '   ', taskObjective: '  ' }), false,
    'blank task identity does not count as a routed mission');
  t.equal(recoverable(), false, 'the default is the safe one');
  t.end();
});
