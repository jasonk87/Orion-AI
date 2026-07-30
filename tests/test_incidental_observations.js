const test = require('tape');

global.window = {};
global.fetch = async () => ({ ok: false });
const agent = require('../agent.js');

function validCandidate(overrides = {}) {
  return {
    file: 'lib/ipc-server.js',
    location: 'startPhoneCompanionServer',
    category: 'silent_failure',
    severity: 'major',
    confidence: 0.94,
    observation: 'The async startup failure path reports ready before bind errors are handled.',
    impact: 'The phone companion can appear available while the server never starts.',
    evidence: 'The caller starts the async server path without awaiting or attaching a rejection handler.',
    suggestedCheck: 'Inspect the caller and verify startup errors are surfaced to the UI.',
    outsideCurrentTask: true,
    ...overrides
  };
}

test('incidental observations record only high-confidence serious candidates', (t) => {
  const buffer = [];
  const result = agent.recordIncidentalIssueCandidate(buffer, validCandidate());

  t.equal(result.success, true, 'tool-style result succeeds');
  t.equal(result.recorded, true, 'valid candidate is recorded');
  t.equal(buffer.length, 1, 'buffer receives the candidate');
  t.equal(buffer[0].category, 'silent_failure', 'category is normalized and preserved');
  t.end();
});

test('incidental observations reject weak or in-scope candidates without failing the run', (t) => {
  const buffer = [];
  const lowConfidence = agent.recordIncidentalIssueCandidate(buffer, validCandidate({ confidence: 0.5 }));
  const styleConcern = agent.recordIncidentalIssueCandidate(buffer, validCandidate({ category: 'style' }));
  const currentTask = agent.recordIncidentalIssueCandidate(buffer, validCandidate({ outsideCurrentTask: false }));
  const missingEvidence = agent.recordIncidentalIssueCandidate(buffer, validCandidate({ evidence: '' }));

  t.equal(lowConfidence.recorded, false, 'low confidence is rejected');
  t.equal(styleConcern.recorded, false, 'unsupported categories are rejected');
  t.equal(currentTask.recorded, false, 'current-task issues are rejected');
  t.equal(missingEvidence.recorded, false, 'missing direct evidence is rejected');
  t.equal(buffer.length, 0, 'rejected candidates do not mutate the buffer');
  t.ok(lowConfidence.success && styleConcern.success && currentTask.success && missingEvidence.success, 'rejections are non-fatal');
  t.end();
});

test('incidental observations dedupe and cap the run-scoped buffer', (t) => {
  const buffer = [];
  t.equal(agent.recordIncidentalIssueCandidate(buffer, validCandidate()).recorded, true, 'first candidate records');
  t.equal(agent.recordIncidentalIssueCandidate(buffer, validCandidate()).recorded, false, 'duplicate is rejected');
  t.equal(agent.recordIncidentalIssueCandidate(buffer, validCandidate({
    file: 'a.js',
    location: 'a',
    observation: 'A normal path can silently drop a saved file after reporting success.'
  })).recorded, true, 'second unique candidate records');
  t.equal(agent.recordIncidentalIssueCandidate(buffer, validCandidate({
    file: 'b.js',
    location: 'b',
    category: 'data_loss',
    observation: 'A normal path can overwrite saved state without path validation.'
  })).recorded, true, 'third unique candidate records');
  t.equal(agent.recordIncidentalIssueCandidate(buffer, validCandidate({
    file: 'c.js',
    location: 'c',
    category: 'crash_path',
    observation: 'A normal path dereferences null after a successful user action.'
  })).recorded, false, 'fourth unique candidate is rejected by cap');
  t.equal(buffer.length, 3, 'cap is enforced');
  t.end();
});

test('incidental observations append only to final Coder handoffs', (t) => {
  const buffer = [];
  agent.recordIncidentalIssueCandidate(buffer, validCandidate());

  const coderFinal = agent.appendIncidentalObservationsToFinal('Done.', buffer, { mode: 'coder' }, {
    autoContinueExecution: false,
    forceYield: false
  });
  const dispatchFinal = agent.appendIncidentalObservationsToFinal('Done.', buffer, { mode: 'orion' }, {
    autoContinueExecution: false,
    forceYield: false
  });
  const continuing = agent.appendIncidentalObservationsToFinal('Done.', buffer, { mode: 'coder' }, {
    autoContinueExecution: true,
    forceYield: false
  });

  t.ok(coderFinal.includes('## Incidental Observations'), 'Coder final handoff includes the section');
  t.ok(coderFinal.includes('lib/ipc-server.js'), 'section includes file evidence');
  t.equal(dispatchFinal, 'Done.', 'Dispatch final handoff does not include Coder incidental observations');
  t.equal(continuing, 'Done.', 'auto-continue runs do not surface observations prematurely');
  t.end();
});
