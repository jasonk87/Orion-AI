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

test('Dispatch keeps one/two-file inspections and delegates broader project reviews', t => {
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent(), ledger: ledger(['a.js']) }), false,
    'one source file stays with Dispatch');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent(), ledger: ledger(['a.js', 'b.js']) }), false,
    'two source files stay with Dispatch');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent(), ledger: ledger(['a.js', 'b.js', 'c.js']) }), true,
    'the third material source file crosses the deterministic ownership boundary');
  t.equal(policy.isSourceInspectionIntent(inspectionIntent({ inspectionBreadth: 'none' })), false,
    'a read-only executable command is not mistaken for a source review without inspection scope');
  t.equal(policy.shouldDelegate({ mode: 'orion', semanticIntent: inspectionIntent({ inspectionBreadth: 'broad' }), ledger: ledger([]) }), true,
    'a semantically broad review routes before Dispatch duplicates the survey');
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
  t.match(objective, /read-only project inspection/i, 'Coder is not granted an implicit source-edit mandate');
  t.match(objective, /remember_file_notes/i, 'the handoff explicitly requires version-bound file knowledge');
  t.match(objective, /state\.js, renderer\.js, ipc\.js/i, 'the already-inspected boundary is transferred');
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
