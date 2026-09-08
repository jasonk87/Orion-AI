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

// ── Dispatch promising a handoff it never made ────────────────────────────────
//
// Second reported failure, same conversation shape: "Can you submit any uncommitted work
// for my music life project to GitHub" produced "I'll route this to Coder to inspect the
// Music Life repo, commit any legitimate uncommitted work, and push it to GitHub." Then
// the turn went READY with no handoff_to_coder call and no queued task.
//
// shouldHaveUsedToolsButDidNot accepts any non-empty text, on the stated assumption that
// "the shared semantic result drives inspection/handoff before the model call". That holds
// for scheduling only - buildDispatchOrchestrationCall emits schedule_followup and nothing
// else - so a handoff still depends on the model choosing to call the tool, and narrating
// it instead was accepted as a finished turn.

test('a bare text answer is still treated as a complete turn', (t) => {
  t.equal(agent.shouldHaveUsedToolsButDidNot("I'll route this to Coder.", [], 'commit my work'), false,
    'the general guard deliberately does not phrase-match prose, so it cannot catch this on its own');
  t.equal(agent.shouldHaveUsedToolsButDidNot('', [], 'commit my work'), true,
    'an empty answer is still caught');
  t.equal(agent.shouldHaveUsedToolsButDidNot('anything', [{ name: 'read_file' }], 'commit my work'), false,
    'a turn that actually used a tool is never nudged');
  t.end();
});

test('scheduling is the only thing Dispatch routes deterministically', (t) => {
  const scheduled = agent.buildDispatchOrchestrationCall({
    requiresExecution: true,
    executionTarget: 'dispatch',
    orchestrationAction: 'schedule_followup',
    intent: 'new_task',
    scheduledRequest: { prompt: 'remind me', delaySeconds: 60 }
  });
  t.equal(scheduled && scheduled.name, 'schedule_followup',
    'a scheduling intent is turned into a real call without the model');

  const handoff = agent.buildDispatchOrchestrationCall({
    requiresExecution: true,
    executionTarget: 'coder',
    orchestrationAction: 'none',
    intent: 'new_task',
    taskResolution: { title: 'Commit uncommitted work' }
  });
  t.equal(handoff, null,
    'a specialist handoff is NOT synthesized - this is why an unmade handoff has to be caught after the answer');
  t.end();
});
