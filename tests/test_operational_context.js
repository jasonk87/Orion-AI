const test = require('tape');
const fs = require('fs');
const path = require('path');
const operational = require('../operational-context');

const T0 = '2026-06-23T12:00:00.000Z';

function missionState() {
  const empty = operational.createEmptyContext(T0);
  return operational.applyAction(empty, 'update_mission_context', {
    mission: 'Build a deep colony simulation.',
    activeObjective: 'Establish the playable core loop.',
    winConditions: [
      { id: 'economy', title: 'Working economy' },
      { id: 'npcs', title: 'Autonomous NPCs' }
    ]
  }, '2026-06-23T12:00:01.000Z').state;
}

test('operational context creates a mission and preserves win-condition progress', (t) => {
  let state = missionState();
  t.equal(state.version, 1, 'uses the current schema version');
  t.equal(state.mission.statement, 'Build a deep colony simulation.', 'stores mission');
  t.equal(state.winConditions.length, 2, 'stores measurable win conditions');

  state = operational.applyAction(state, 'evaluate_win_conditions', {
    evaluations: [{ id: 'economy', status: 'in_progress', evidence: ['Economy smoke test executes.'] }]
  }, '2026-06-23T12:00:02.000Z').state;
  state = operational.applyAction(state, 'update_mission_context', {
    mission: 'Build a deep colony simulation.',
    winConditions: [{ id: 'economy', title: 'Working economy' }, { id: 'npcs', title: 'Autonomous NPCs' }]
  }, '2026-06-23T12:00:03.000Z').state;

  t.equal(state.winConditions[0].status, 'in_progress', 'mission edits retain existing progress');
  t.deepEqual(state.winConditions[0].evidence, ['Economy smoke test executes.'], 'mission edits retain evidence');
  state = operational.applyAction(state, 'update_mission_context', {
    mission: 'Build a deep colony simulation.',
    activeObjective: ''
  }, '2026-06-23T12:00:04.000Z').state;
  t.equal(state.activeObjective, null, 'explicitly clears the active objective');
  t.end();
});

test('subplans require evidence before completion', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'start_subplan', {
    title: 'Implement save/load',
    steps: ['Define format', 'Round-trip test'],
    nextAction: 'Inspect current serializer.'
  }, '2026-06-23T12:01:00.000Z').state;
  t.equal(state.activeSubplan.status, 'active', 'starts active');
  t.throws(() => operational.applyAction(state, 'complete_subplan', { summary: 'Done' }, T0), /requires concrete evidence/, 'rejects narrative-only completion');

  state = operational.applyAction(state, 'complete_subplan', {
    summary: 'Save data round-trips.',
    evidence: ['npm test: 42 passing'],
    nextAction: 'Begin autonomous NPC behavior.',
    keep: [{ text: 'Save files use ID-based entity relationships.', category: 'architecture' }],
    discard: [{ summary: 'Early circular-reference stack traces', reason: 'Serializer is fixed.' }]
  }, '2026-06-23T12:02:00.000Z').state;
  t.equal(state.activeSubplan.status, 'completed', 'evidence permits completion');
  t.ok(state.activeSubplan.completedAt, 'records completion time');
  t.equal(state.lastDistillation.kept[0], 'Save files use ID-based entity relationships.', 'records what was kept');
  t.equal(state.lastDistillation.discarded[0], 'Early circular-reference stack traces', 'records what was tossed');
  t.ok(state.discoveries.some(item => item.text === 'Save files use ID-based entity relationships.'), 'promotes durable lesson automatically');
  t.ok(state.discarded.some(item => item.summary === 'Early circular-reference stack traces'), 'discards temporary context automatically');
  t.end();
});

test('subplan completion produces a safe default distillation', (t) => {
  let state = operational.applyAction(missionState(), 'start_subplan', { title: 'Economy smoke test' }, T0).state;
  state = operational.applyAction(state, 'complete_subplan', {
    summary: 'Resource production and consumption balance correctly.',
    evidence: ['economy.test.js passed']
  }, '2026-06-23T12:02:30.000Z').state;
  t.equal(state.lastDistillation.kept.length, 1, 'retains one verified outcome by default');
  t.ok(state.lastDistillation.kept[0].includes('Resource production'), 'default retained outcome includes the result');
  t.equal(state.lastDistillation.discarded.length, 1, 'marks temporary working context discarded');
  t.end();
});

test('blockers move to resolved state and retain useful lessons', (t) => {
  let state = operational.applyAction(missionState(), 'start_subplan', { title: 'Fix serializer' }, T0).state;
  state = operational.applyAction(state, 'record_blocker', {
    id: 'circular-inventory',
    title: 'Circular inventory reference',
    details: 'JSON serialization crashes.'
  }, '2026-06-23T12:03:00.000Z').state;
  t.equal(state.blockers.active.length, 1, 'records blocker');
  t.equal(state.activeSubplan.status, 'blocked', 'marks active subplan blocked');

  state = operational.applyAction(state, 'resolve_blocker', {
    id: 'circular-inventory',
    resolution: 'Serialize inventory IDs instead of object references.',
    lesson: 'Entity relationships need ID-based persistence.'
  }, '2026-06-23T12:04:00.000Z').state;
  t.equal(state.blockers.active.length, 0, 'removes active blocker');
  t.equal(state.blockers.resolved.length, 1, 'retains resolved blocker');
  t.equal(state.blockers.resolved[0].lesson, 'Entity relationships need ID-based persistence.', 'retains durable lesson');
  t.equal(state.activeSubplan.status, 'active', 'unblocks subplan');
  t.end();
});

test('blocker severity and nature normalize and sort by engineering priority', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'record_blocker', {
    id: 'minor-fixable',
    title: 'Campfire scale looks slightly large',
    severity: 'minor',
    nature: 'fixable'
  }, T0).state;
  state = operational.applyAction(state, 'record_blocker', {
    id: 'major-transient',
    title: 'Asset CDN timed out',
    severity: 'major',
    nature: 'transient'
  }, T0).state;
  state = operational.applyAction(state, 'record_blocker', {
    id: 'major-terminal',
    title: 'Asset license prohibits redistribution',
    severity: 'major',
    nature: 'terminal'
  }, T0).state;
  state = operational.applyAction(state, 'record_blocker', {
    id: 'critical-fixable',
    title: 'App launch crashes',
    severity: 'critical',
    nature: 'fixable'
  }, T0).state;
  state = operational.applyAction(state, 'record_blocker', {
    id: 'unknown-labels',
    title: 'Unknown labels normalize',
    severity: 'urgent',
    nature: 'weird'
  }, T0).state;

  const unknown = state.blockers.active.find(item => item.id === 'unknown-labels');
  t.equal(unknown.severity, 'major', 'unknown severity normalizes to major');
  t.equal(unknown.nature, 'fixable', 'unknown nature normalizes to fixable');
  t.deepEqual(
    state.blockers.active.map(item => item.id),
    ['critical-fixable', 'major-terminal', 'unknown-labels', 'major-transient', 'minor-fixable'],
    'blockers sort critical before major before minor, and terminal before fixable/transient within severity'
  );

  const prompt = operational.formatForPrompt(state);
  t.ok(prompt.includes('[CRITICAL / FIXABLE] critical-fixable: App launch crashes'), 'prompt includes critical/fixable label');
  t.ok(prompt.includes('[MAJOR / TERMINAL] major-terminal: Asset license prohibits redistribution'), 'prompt includes major/terminal label');
  t.ok(prompt.includes('transient blockers are retry/backoff candidates'), 'prompt includes transient retry/backoff guidance');
  t.ok(prompt.includes('do not automatically replan yet'), 'prompt forbids automatic replanning');
  t.end();
});

test('completion gate triages critical, major, minor, and terminal blockers', (t) => {
  let base = missionState();
  base = operational.applyAction(base, 'evaluate_win_conditions', {
    evaluations: [
      { id: 'economy', status: 'satisfied', evidence: ['economy.test.js passed'] },
      { id: 'npcs', status: 'satisfied', evidence: ['npc autonomy smoke test passed'] }
    ]
  }, T0).state;
  base = operational.applyAction(base, 'record_tool_result', {
    toolName: 'run_tests',
    success: true,
    summary: 'npm test passed'
  }, T0).state;

  let critical = operational.applyAction(base, 'record_blocker', {
    title: 'App launch crashes',
    severity: 'critical',
    nature: 'fixable'
  }, T0).state;
  t.equal(operational.evaluateCompletionGate(critical).status, 'blocked', 'critical blockers block completion');

  let major = operational.applyAction(base, 'record_blocker', {
    title: 'Inventory save test fails',
    severity: 'major',
    nature: 'fixable'
  }, T0).state;
  t.equal(operational.evaluateCompletionGate(major).status, 'blocked', 'major blockers block completion');

  let minor = operational.applyAction(base, 'record_blocker', {
    id: 'minor-polish',
    title: 'Campfire scale looks slightly large',
    severity: 'minor',
    nature: 'fixable'
  }, T0).state;
  const minorGate = operational.evaluateCompletionGate(minor);
  t.equal(minorGate.status, 'ready_for_final', 'minor-only blockers do not block completion when win conditions have evidence');
  t.equal(minorGate.remainingMinorBlockers[0].title, 'Campfire scale looks slightly large', 'minor blockers are returned as remaining minor blockers');
  t.equal(minorGate.backlogCandidates[0].id, 'minor-polish', 'minor blockers are returned as backlog candidates');

  let terminalMajor = operational.applyAction(base, 'record_blocker', {
    title: 'Required asset license prohibits redistribution',
    severity: 'major',
    nature: 'terminal'
  }, T0).state;
  t.equal(operational.evaluateCompletionGate(terminalMajor).status, 'blocked', 'terminal major blockers block completion');

  let terminalCritical = operational.applyAction(base, 'record_blocker', {
    title: 'Missing required GPU feature',
    severity: 'critical',
    nature: 'terminal'
  }, T0).state;
  t.equal(operational.evaluateCompletionGate(terminalCritical).status, 'blocked', 'terminal critical blockers block completion');

  let terminalMinor = operational.applyAction(base, 'record_blocker', {
    id: 'minor-terminal',
    title: 'Optional icon license cannot be used',
    severity: 'minor',
    nature: 'terminal'
  }, T0).state;
  t.equal(operational.evaluateCompletionGate(terminalMinor).status, 'blocked', 'terminal blockers block unless converted to backlog/technical debt');

  terminalMinor = operational.applyAction(terminalMinor, 'convert_blocker_to_backlog', {
    id: 'minor-terminal',
    lesson: 'Optional icon license cannot be used; pick a different icon later.'
  }, T0).state;
  const convertedGate = operational.evaluateCompletionGate(terminalMinor);
  t.equal(convertedGate.status, 'ready_for_final', 'converted minor terminal blocker no longer blocks completion');
  t.equal(terminalMinor.blockers.active.length, 0, 'minor blocker is removed from active blockers');
  t.ok(terminalMinor.blockers.resolved.some(item => item.backlog), 'converted blocker is retained as backlog metadata');
  t.ok(terminalMinor.discoveries.some(item => item.category === 'backlog_candidate'), 'converted blocker lesson is retained as discovery candidate');
  t.end();
});

test('win conditions cannot be satisfied without evidence', (t) => {
  const state = missionState();
  t.throws(() => operational.applyAction(state, 'evaluate_win_conditions', {
    evaluations: [{ id: 'economy', status: 'satisfied' }]
  }, T0), /requires evidence/, 'rejects unsupported satisfaction');
  const next = operational.applyAction(state, 'evaluate_win_conditions', {
    evaluations: [{ id: 'economy', status: 'satisfied', evidence: ['Economy integration test passed.'] }]
  }, T0).state;
  t.equal(next.winConditions[0].status, 'satisfied', 'accepts evidence-backed satisfaction');
  t.end();
});

test('completion gate rejects unsatisfied win conditions', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'record_tool_result', {
    toolName: 'run_tests',
    success: true,
    summary: 'npm test passed'
  }, T0).state;
  const gate = operational.evaluateCompletionGate(state);
  t.equal(gate.status, 'continue_work', 'not ready while win conditions remain pending');
  t.equal(gate.pendingWinConditions.length, 2, 'reports pending win conditions');
  t.end();
});

test('completion gate rejects active blockers', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'record_blocker', {
    title: 'Save file crashes',
    details: 'Cannot verify persistence.'
  }, T0).state;
  const gate = operational.evaluateCompletionGate(state);
  t.equal(gate.status, 'blocked', 'active blockers prevent finalization');
  t.equal(gate.blockers[0].title, 'Save file crashes', 'reports blocker');
  t.end();
});

test('completion gate rejects missing evidence', (t) => {
  let state = missionState();
  state.winConditions = state.winConditions.map(condition => ({ ...condition, status: 'satisfied', evidence: [] }));
  const gate = operational.evaluateCompletionGate(state);
  t.equal(gate.status, 'continue_work', 'cannot finalize without proof');
  t.ok(gate.missingEvidence.some(item => item.includes('latest evidence')), 'requires latest evidence');
  t.ok(gate.missingEvidence.some(item => item.includes('Working economy')), 'requires condition evidence');
  t.end();
});

test('completion gate accepts evidence-backed completed mission', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'start_subplan', { title: 'Verify playable loop' }, T0).state;
  state = operational.applyAction(state, 'complete_subplan', {
    summary: 'Playable loop verified.',
    evidence: ['manual smoke verification passed']
  }, T0).state;
  state = operational.applyAction(state, 'evaluate_win_conditions', {
    evaluations: [
      { id: 'economy', status: 'satisfied', evidence: ['economy.test.js passed'] },
      { id: 'npcs', status: 'satisfied', evidence: ['npc autonomy smoke test passed'] }
    ]
  }, T0).state;
  state = operational.applyAction(state, 'record_tool_result', {
    toolName: 'run_tests',
    success: true,
    summary: 'npm test: all tests passed'
  }, T0).state;
  const gate = operational.evaluateCompletionGate(state);
  t.equal(gate.status, 'ready_for_final', 'all evidence-backed state can finalize');
  t.end();
});

test('completion gate ignores chat trimming and judges operational state', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'evaluate_win_conditions', {
    evaluations: [
      { id: 'economy', status: 'satisfied', evidence: ['economy.test.js passed'] },
      { id: 'npcs', status: 'satisfied', evidence: ['npc autonomy smoke test passed'] }
    ]
  }, T0).state;
  state = operational.applyAction(state, 'record_tool_result', {
    toolName: 'run_tests',
    success: true,
    summary: 'npm test passed after chat history was trimmed'
  }, T0).state;
  const fullChat = operational.buildReasoningMessages(state, [{ role: 'user', text: 'old long chat' }], 'Finish.');
  const trimmedChat = operational.buildReasoningMessages(state, [], 'Finish.');
  t.equal(operational.evaluateCompletionGate(state).status, 'ready_for_final', 'gate is state-driven');
  t.ok(JSON.stringify(fullChat).includes('Build a deep colony simulation.'), 'full chat path carries state');
  t.ok(JSON.stringify(trimmedChat).includes('Build a deep colony simulation.'), 'trimmed chat path carries state');
  t.end();
});

test('discoveries deduplicate and discarded noise stays bounded', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'promote_discovery', { text: 'Tests run with npm test.', category: 'command' }, T0).state;
  state = operational.applyAction(state, 'promote_discovery', { text: 'Tests run with npm test.', category: 'command' }, T0).state;
  t.equal(state.discoveries.length, 1, 'deduplicates retained discoveries');
  for (let index = 0; index < 55; index++) {
    state = operational.applyAction(state, 'discard_noise', { summary: `Old stack trace ${index}`, reason: 'Error was fixed.' }, new Date(Date.parse(T0) + index * 1000)).state;
  }
  t.equal(state.discarded.length, 50, 'bounds discarded summaries');
  t.equal(state.discarded[0].summary, 'Old stack trace 5', 'drops oldest discarded noise first');
  t.end();
});

test('prompt format carries operational signal without discarded noise', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'promote_discovery', { text: 'Use ID-based serialization.' }, T0).state;
  state = operational.applyAction(state, 'discard_noise', { summary: 'Huge obsolete stack trace contents', reason: 'Fixed' }, T0).state;
  const prompt = operational.formatForPrompt(state);
  t.ok(prompt.includes('Build a deep colony simulation.'), 'includes mission');
  t.ok(prompt.includes('Use ID-based serialization.'), 'includes retained discovery');
  t.notOk(prompt.includes('Huge obsolete stack trace contents'), 'does not reinject discarded noise');
  t.end();
});

test('tool results become latest evidence before the next reasoning turn', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'record_tool_result', {
    toolName: 'run_tests',
    success: true,
    summary: 'npm test: 385 passing',
    checkpoint: 'Full suite verified.'
  }, T0).state;
  const prompt = operational.formatForPrompt(state);
  t.equal(state.latestEvidence.length, 1, 'stores tool evidence in working state');
  t.ok(prompt.includes('Latest evidence/checkpoints'), 'prompts include latest evidence');
  t.ok(prompt.includes('run_tests: npm test: 385 passing'), 'next turn sees the reduced tool result');
  t.end();
});

test('discarded noise is pruned from latest evidence and not reintroduced', (t) => {
  let state = missionState();
  state = operational.applyAction(state, 'record_tool_result', {
    toolName: 'run_command',
    success: false,
    summary: 'obsolete stack trace XYZ123'
  }, T0).state;
  state = operational.applyAction(state, 'discard_noise', {
    summary: 'obsolete stack trace XYZ123',
    reason: 'Fixed by later serializer guard.'
  }, T0).state;
  const prompt = operational.formatForPrompt(state);
  t.equal(state.latestEvidence.length, 0, 'discard action removes matching transient evidence');
  t.notOk(prompt.includes('obsolete stack trace XYZ123'), 'discarded evidence does not return to prompts');
  t.end();
});

test('conversation can be compacted without losing mission state', (t) => {
  const state = missionState();
  const compactedConversation = [
    { role: 'user', text: '[COMPACTED CONTEXT SUMMARY]\nOld task summary that is not canonical.' },
    { role: 'assistant', text: 'Understood. I will use this compacted summary as prior context.' }
  ];
  const messages = operational.buildReasoningMessages(state, compactedConversation, 'Continue.');
  const joined = JSON.stringify(messages);
  t.ok(joined.includes('Build a deep colony simulation.'), 'mission state is still present');
  t.ok(joined.includes('Working economy'), 'win conditions are still present');
  t.notOk(joined.includes('Old task summary that is not canonical'), 'compacted chat summary is not task source of truth');
  t.end();
});

test('new model turn receives mission state even when old chat is reduced', (t) => {
  const state = missionState();
  const reducedChat = [{ role: 'user', text: 'Tiny follow-up only.' }];
  const messages = operational.buildReasoningMessages(state, reducedChat, 'Do the next step.');
  t.equal(messages[0].role, 'user', 'state envelope is first');
  t.ok(messages[0].parts[0].text.includes('Mission: Build a deep colony simulation.'), 'first provider turn carries mission');
  t.ok(messages[0].parts[0].text.includes('Win conditions'), 'first provider turn carries win conditions');
  t.ok(messages.some(message => JSON.stringify(message).includes('[RECENT CHAT VIEW - non-canonical]')), 'chat is present only as view context');
  t.end();
});

test('orphan blockers are not injected as canonical task state', (t) => {
  let state = operational.createEmptyContext(T0);
  state = operational.applyAction(state, 'record_blocker', {
    title: 'Command Execution Environment Issue',
    details: 'Old spawn powershell.exe ENOENT failure.'
  }, T0).state;
  const prompt = operational.formatForPrompt(state);
  const messages = operational.buildReasoningMessages(state, [], 'how much system memory do i have?');
  const joined = JSON.stringify(messages);
  t.equal(prompt, '', 'blocker-only context is treated as stale/orphaned');
  t.notOk(joined.includes('Command Execution Environment Issue'), 'stale blocker is not injected into the next direct task');
  t.ok(joined.includes('Mission: Not defined'), 'model still receives a neutral state envelope');
  t.end();
});

test('agent and renderer wire operational context into both providers and Mission Control', (t) => {
  const agent = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  t.equal((agent.match(/\? OPERATIONAL_CONTEXT_TOOL_DECLARATIONS :/g) || []).length, 2, 'shares tool declarations across Gemini and Ollama');
  t.ok(agent.includes('OperationalContext.buildReasoningMessages(workingState'), 'builds provider input from working state first');
  t.notOk(agent.includes('conversation.messages.forEach(msg =>'), 'does not reconstruct task state from full chat transcript');
  t.ok(agent.includes('evaluateWorkingStateCompletion'), 'uses a single completion gate before finalizing');
  t.ok(agent.includes('Completion gate held final response'), 'completion gate can force continued work instead of final summaries');
  t.notOk(agent.includes('criticMessages'), 'does not keep a separate critic/reviewer agent path');
  t.notOk(agent.includes('Act as a Critical Code Reviewer'), 'does not prompt a separate reviewer role');
  t.ok(agent.includes('recordToolOutcomeInWorkingState'), 'reduces tool outcomes into working state');
  t.ok(agent.includes("'context_compaction'"), 'checkpoints compaction');
  t.ok(renderer.includes("reason: 'user_steering'"), 'checkpoints steering');
  t.ok(renderer.includes('operationalContext,'), 'exposes sanitized mission context to Phone Companion');
  t.ok(html.includes('id="operational-context-panel"'), 'renders Mission Control panel');
  t.ok(html.includes('id="operational-context-modal"'), 'provides a direct Mission Control editor');
  t.ok(renderer.includes("mutateOperationalContext(currentWorkspace, 'update_mission_context'"), 'editor persists through validated context transitions');
  t.end();
});
