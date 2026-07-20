'use strict';

const test = require('tape');
const contracts = require('../orchestration-contracts');

function gritlifeEvidence(overrides = {}) {
  return {
    id: 'conversation:gritlife:user-12',
    sourceKind: 'conversation',
    provenance: {
      conversationId: 'gritlife-design',
      sessionId: null,
      messageId: 'user-12',
      workspacePath: 'C:\\Projects\\GRITLIFE'
    },
    role: 'user',
    timestamp: '2026-07-19T15:00:00.000Z',
    excerpt: 'Replace or evolve the intent system with recurring paid subscriptions and enrollments organized by location, including gym, yoga, massage, therapy, and classes.',
    scores: { total: 0.912345 },
    ...overrides
  };
}

test('memory-confidence contract accepts a recall claim grounded in retrieved conversation evidence', (t) => {
  const evidence = [gritlifeEvidence()];
  const answer = 'I remember. We discussed replacing the intent system with recurring subscriptions organized by location, including gym, yoga, massage, therapy, and classes.';
  const result = contracts.validateMemoryResponse(answer, { conversationEvidence: evidence });

  t.equal(contracts.isRecallRequest('Do you remember our earlier conversation about the intent system?'), true, 'recognizes an explicit recall request');
  t.equal(contracts.hasExplicitRecallClaim(answer), true, 'recognizes an explicit recall claim');
  t.equal(result.valid, true, 'allows the evidence-backed claim');
  t.ok(result.groundingScore >= 0.08, 'reports sufficient lexical grounding');
  t.end();
});

test('memory-confidence contract rejects unsupported or unrelated recall claims', (t) => {
  const unsupported = contracts.validateMemoryResponse(
    'I remember that conversation. We decided on combat colors, stamina streaks, and character traits.',
    { conversationEvidence: [] }
  );
  const unrelated = contracts.validateMemoryResponse(
    'I remember the earlier plan was purely about combat attributes, stamina colors, and daily streaks.',
    { conversationEvidence: [gritlifeEvidence()] }
  );
  const attributedWithoutUserSource = contracts.validateMemoryResponse(
    'You said earlier that gym subscriptions should replace intent.',
    { conversationEvidence: [gritlifeEvidence({ role: 'assistant' })] }
  );

  t.equal(unsupported.valid, false, 'a recall claim cannot pass without evidence');
  t.equal(unsupported.reason, 'explicit_recall_without_evidence', 'reports the missing-evidence contract violation');
  t.equal(unrelated.valid, false, 'retrieving unrelated evidence does not license a fabricated recollection');
  t.equal(unrelated.reason, 'recall_claim_not_grounded_in_retrieved_evidence', 'reports the grounding mismatch');
  t.equal(attributedWithoutUserSource.valid, false, 'a statement attributed to the user requires user-authored evidence');
  t.equal(attributedWithoutUserSource.reason, 'user_attribution_without_user_evidence', 'reports the missing user provenance');

  const fallback = contracts.buildEvidenceBackedRecallFallback([]);
  t.ok(/couldn.+retrieve/i.test(fallback), 'the no-evidence fallback states that the conversation could not be retrieved');
  t.notOk(contracts.hasExplicitRecallClaim(fallback), 'the no-evidence fallback does not claim to remember');
  t.end();
});

test('response basis preserves typed retrieval provenance and separates knowledge sources', (t) => {
  const basis = contracts.createResponseBasis({
    conversationEvidence: [gritlifeEvidence()],
    projectKnowledge: true,
    generalInference: false,
    structuredStatuses: [{ kind: 'task', id: 'task-1', state: 'pending' }]
  });

  t.equal(basis.conversationEvidence.length, 1, 'records retrieved conversation evidence');
  t.equal(basis.conversationEvidence[0].sourceKind, 'conversation', 'preserves the evidence type');
  t.equal(basis.conversationEvidence[0].conversationId, 'gritlife-design', 'reads conversation ID from retrieval provenance');
  t.equal(basis.conversationEvidence[0].messageId, 'user-12', 'reads message ID from retrieval provenance');
  t.equal(basis.conversationEvidence[0].relevance, 0.912345, 'reads retrieval relevance from scores.total');
  t.equal(basis.projectKnowledge, true, 'tracks project/source knowledge independently');
  t.equal(basis.generalInference, false, 'tracks general inference independently');
  t.deepEqual(basis.structuredStatuses, [{ kind: 'task', id: 'task-1', state: 'pending' }], 'carries structured status facts without reconstructing them from prose');
  t.end();
});

test('PR status contract preserves open and mergeable as distinct from merged', (t) => {
  const statuses = contracts.extractStructuredStatusFacts(
    'PR #9 is open, clean, synchronized, and mergeable. The branch was pushed.'
  );

  t.equal(statuses.length, 1, 'extracts one pull-request status record');
  t.equal(statuses[0].number, 9, 'preserves the PR number');
  t.equal(statuses[0].state, 'open', 'preserves open as the lifecycle state');
  t.equal(statuses[0].mergeability, 'mergeable', 'preserves mergeable as a separate field');
  t.equal(statuses[0].sync, 'synchronized', 'preserves synchronization separately');

  const incorrect = contracts.validateStatusResponse('PR #9 has been merged.', statuses);
  const correct = contracts.validateStatusResponse('PR #9 is open and mergeable, but it has not been merged.', statuses);
  t.equal(incorrect.valid, false, 'rejects turning mergeable into merged');
  t.equal(incorrect.reason, 'open_pr_described_as_merged', 'reports the exact factual contradiction');
  t.equal(correct.valid, true, 'accepts accurate open/mergeable wording');

  const fallback = contracts.enforceStatusFallback('PR #9 was successfully merged.', statuses);
  t.ok(/open and mergeable/i.test(fallback), 'fallback restores the structured state and mergeability');
  t.ok(/not merged/i.test(fallback), 'fallback explicitly prevents the merged inference');
  t.end();
});

test('task and mocked-process status checks reject false terminal claims', (t) => {
  t.equal(contracts.validateStatusResponse('The queued task is now running.', [
    { kind: 'task', id: 'task-pending', state: 'pending' }
  ]).reason, 'pending_task_described_as_running', 'queued is not running');
  t.equal(contracts.validateStatusResponse('The cancelled task completed successfully.', [
    { kind: 'task', id: 'task-cancelled', state: 'cancelled' }
  ]).reason, 'cancelled_task_described_as_completed', 'cancelled is not completed');
  t.equal(contracts.validateStatusResponse('Claude successfully restarted.', [
    { kind: 'process_operation', operation: 'restart', outcome: 'simulated' }
  ]).reason, 'simulated_restart_described_as_real', 'a mocked restart is not a real restart');
  t.end();
});
