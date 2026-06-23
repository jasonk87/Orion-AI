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
    nextAction: 'Begin autonomous NPC behavior.'
  }, '2026-06-23T12:02:00.000Z').state;
  t.equal(state.activeSubplan.status, 'completed', 'evidence permits completion');
  t.ok(state.activeSubplan.completedAt, 'records completion time');
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

test('agent and renderer wire operational context into both providers and Mission Control', (t) => {
  const agent = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  t.equal((agent.match(/\.\.\.OPERATIONAL_CONTEXT_TOOL_DECLARATIONS/g) || []).length, 2, 'shares tool declarations across Gemini and Ollama');
  t.ok(agent.includes('formatForPrompt(operationalContext.state)'), 'injects canonical context into model input');
  t.ok(agent.includes("'context_compaction'"), 'checkpoints compaction');
  t.ok(renderer.includes("reason: 'user_steering'"), 'checkpoints steering');
  t.ok(html.includes('id="operational-context-panel"'), 'renders Mission Control panel');
  t.end();
});
