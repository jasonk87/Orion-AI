'use strict';

const test = require('tape');
const policy = require('../dispatch-inspection-policy');

function inspectionIntent(overrides = {}) {
  return {
    intent: 'new_task',
    requiresExecution: true,
    executionScope: 'read_only',
    inspectionTarget: 'project',
    inspectionBreadth: 'focused',
    resolvedRequest: 'Explain how the approval state flows through the project.',
    ...overrides
  };
}

function ledger(paths) {
  return {
    files: new Map(paths.map((filePath, index) => [filePath.toLowerCase(), {
      path: filePath,
      uniqueLines: 50 + index
    }]))
  };
}

test('Dispatch delegates every fresh read-only source inspection before reading the first file', t => {
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent({ inspectionBreadth: 'single_file' }), ledger: ledger([]) }), true,
    'a single-file source inspection starts with Researcher rather than Dispatch');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent(), ledger: ledger([]) }), true,
    'a focused source inspection delegates before Dispatch acquires duplicate evidence');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent({ inspectionBreadth: 'broad' }), ledger: ledger([]) }), true,
    'a broad review follows the same ownership rule');
  t.equal(policy.isSourceInspectionIntent(inspectionIntent({ inspectionBreadth: 'none' })), false,
    'a read-only executable command is not mistaken for a source review without inspection scope');
  t.equal(policy.shouldDelegate({ mode: 'coder', semanticIntent: inspectionIntent({ inspectionBreadth: 'broad' }), ledger: ledger([]) }), false,
    'Coder never hands its own inspection back to itself');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent({ executionScope: 'mutating' }), ledger: ledger(['a.js', 'b.js', 'c.js']) }), false,
    'the inspection policy does not compete with normal executable-work routing');
  t.end();
});

test('delegated reviews preserve read-only scope and require durable knowledge', t => {
  const objective = policy.buildDelegatedObjective({
    resolvedRequest: 'Audit project persistence behavior.',
    inspectedPaths: ['state.js', 'renderer.js', 'ipc.js']
  });
  t.match(objective, /read-only project inspection/i, 'Researcher receives explicit read-only scope rather than an edit mandate');
  t.match(objective, /remember_file_notes/i, 'the handoff explicitly requires version-bound file knowledge');
  t.match(objective, /state\.js, renderer\.js, ipc\.js/i, 'the already-inspected boundary is transferred');
  t.end();
});

// Real bug: a request about Orion's own prior runs was misrouted into this exact delegated
// project-inspection path, which is why an unrelated project (Bot-GPT) ended up with mistaken
// remember_file_notes entries - shouldDelegate()/isReadOnlyProjectInspection() only ever checked
// inspectionTarget against ['workspace','project'], so a historical-investigation classification
// (now inspectionTarget='task_history') would have matched project-review logic exactly like a
// real project inspection: it would have been "delegated" to Coder with the same
// remember_file_notes persistence prompt, in whatever workspace happened to be active. task_history
// is a distinct evidence domain and must never enter this policy at all - proven here directly at
// the policy layer, independent of whether the classifier itself is fixed correctly upstream.
test('a task_history evidence request never enters delegated project inspection, so it can never trigger remember_file_notes on an unrelated project', t => {
  const historyIntent = inspectionIntent({
    inspectionTarget: 'task_history',
    inspectionBreadth: 'broad',
    resolvedRequest: 'Find how Orion previously checked the user\'s DeepSeek balance.'
  });
  t.equal(policy.isReadOnlyProjectInspection(historyIntent), false,
    'task_history is not read-only PROJECT inspection - it is a different evidence domain entirely');
  t.equal(policy.isSourceInspectionIntent(historyIntent), false,
    'a task-history request is never treated as a source-code inspection');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: historyIntent, ledger: ledger(['a.js', 'b.js', 'c.js']) }), false,
    'even with several "inspected" paths recorded, a task-history request is never delegated as a project review - that delegation is what carries the remember_file_notes persistence prompt into whatever project happens to be active');
  // The same check holds for the narrower single-file/focused breadths, not just broad.
  ['none', 'single_file', 'focused'].forEach(breadth => {
    t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent({ inspectionTarget: 'task_history', inspectionBreadth: breadth }), ledger: ledger(['a.js']) }), false,
      `task_history with inspectionBreadth=${breadth} is still never delegated as project inspection`);
  });
  t.end();
});

test('inspection knowledge gate identifies only materially read files without notes', t => {
  const sourceLedger = ledger(['agent.js', 'renderer.js']);
  const work = [{ toolName: 'remember_file_notes', path: 'agent.js', status: 'done' }];
  t.deepEqual(policy.missingFileNotes(sourceLedger, work), ['renderer.js'],
    'already-noted files are excluded from the persistence gate');
  const prompt = policy.buildKnowledgePersistencePrompt({ ledger: sourceLedger, workWalkthrough: work });
  t.match(prompt, /renderer\.js/, 'the missing file is named concretely');
  t.notOk(/- agent\.js/.test(prompt), 'the gate does not ask to rewrite existing notes');
  t.end();
});
