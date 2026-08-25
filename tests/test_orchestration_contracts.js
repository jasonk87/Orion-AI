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
  t.ok(result.groundingScore >= 0.45, 'reports sufficient lexical grounding');
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
  const partiallyInvented = contracts.validateMemoryResponse(
    'I remember our intent conversation. We said Grind, Connect, and Survive would shape subscriptions, locations, gym, and yoga.',
    { conversationEvidence: [gritlifeEvidence()] }
  );

  t.equal(unsupported.valid, false, 'a recall claim cannot pass without evidence');
  t.equal(unsupported.reason, 'explicit_recall_without_evidence', 'reports the missing-evidence contract violation');
  t.equal(unrelated.valid, false, 'retrieving unrelated evidence does not license a fabricated recollection');
  t.equal(unrelated.reason, 'recall_claim_not_grounded_in_retrieved_evidence', 'reports the grounding mismatch');
  t.equal(attributedWithoutUserSource.valid, false, 'a statement attributed to the user requires user-authored evidence');
  t.equal(attributedWithoutUserSource.reason, 'user_attribution_without_user_evidence', 'reports the missing user provenance');
  t.equal(partiallyInvented.valid, false, 'a few shared entities cannot license substantial invented details');
  t.equal(partiallyInvented.reason, 'recall_claim_not_grounded_in_retrieved_evidence', 'partial overlap fails the conservative grounding contract');

  const fallback = contracts.buildEvidenceBackedRecallFallback([]);
  t.ok(/couldn.+retrieve/i.test(fallback), 'the no-evidence fallback states that the conversation could not be retrieved');
  t.notOk(contracts.hasExplicitRecallClaim(fallback), 'the no-evidence fallback does not claim to remember');
  t.end();
});

test('equivalent recall language and reconstructed answers require evidence', (t) => {
  const equivalentClaims = [
    'We agreed earlier that subscriptions should replace intent.',
    'Earlier, you wanted location-based memberships.',
    'Our previous decision was to organize enrollments by venue.',
    'The earlier discussion centered on gyms and yoga.'
  ];
  equivalentClaims.forEach((answer) => {
    t.equal(contracts.hasExplicitRecallClaim(answer), true, `recognizes recall-equivalent wording: ${answer}`);
    t.equal(
      contracts.validateMemoryResponse(answer, { conversationEvidence: [], recallRequested: true }).valid,
      false,
      'rejects the unsupported reconstruction'
    );
  });

  const unlabeledReconstruction = contracts.validateMemoryResponse(
    'The plan centered on paid gym, yoga, and therapy subscriptions by location.',
    { conversationEvidence: [], recallRequested: true }
  );
  t.equal(unlabeledReconstruction.valid, false, 'a recall answer cannot evade the contract by omitting a narrow recall phrase');
  t.equal(unlabeledReconstruction.reason, 'recall_answer_without_evidence_disclosure', 'the missing uncertainty disclosure is explicit');

  const honestGap = contracts.validateMemoryResponse(
    'I could not retrieve that specific discussion. I can reason from the current project if that would help.',
    { conversationEvidence: [], recallRequested: true }
  );
  const negationEvasion = contracts.validateMemoryResponse(
    'I cannot recall every detail, but we discussed combat colors and character traits.',
    { conversationEvidence: [], recallRequested: true }
  );
  const disclaimerReconstruction = contracts.validateMemoryResponse(
    'I could not retrieve that discussion. The plan was combat colors and character traits.',
    { conversationEvidence: [], recallRequested: true }
  );
  t.equal(honestGap.valid, true, 'an honest retrieval gap remains conversationally acceptable');
  t.equal(negationEvasion.valid, false, 'a negated recall clause cannot hide a positive recall claim in a later clause');
  t.equal(disclaimerReconstruction.valid, false, 'a disclosure cannot be followed by an unlabeled invented reconstruction');
  t.equal(contracts.isRecallRequest('What did we decide about the intent system?'), true, 'decision wording requests recall');
  t.equal(contracts.isRecallRequest('Remind me what we agreed about locations.'), true, 'agreement wording requests recall');
  t.equal(contracts.isRecallRequest('Do you recall the intent design?'), true, 'do-you-recall wording requests recall');
  t.equal(contracts.isRecallRequest('Can you recall our location plan?'), true, 'can-you-recall wording requests recall');
  t.equal(contracts.isRecallRequest('Remind me about the location plan.'), true, 'plain remind-me wording requests recall');
  t.end();
});

test('every recall answer is evidence-checked while honest semantic paraphrases remain natural', (t) => {
  const evidence = [gritlifeEvidence()];
  const paraphrase = contracts.validateMemoryResponse(
    'I found it. The proposal used ongoing paid memberships grouped by venues, with fitness, yoga, massage, therapy, and classes.',
    { conversationEvidence: evidence, recallRequested: true }
  );
  const unlabeledFabrication = contracts.validateMemoryResponse(
    'The answer was combat colors, stamina streaks, and character traits.',
    { conversationEvidence: evidence, recallRequested: true }
  );
  const disclaimerThenFabrication = contracts.validateMemoryResponse(
    'I could not verify every detail. The answer was combat colors, stamina streaks, and character traits.',
    { conversationEvidence: evidence, recallRequested: true }
  );

  t.equal(paraphrase.valid, true, 'semantic equivalents do not require copied citation prose');
  t.ok(paraphrase.groundingScore >= 0.35, 'the paraphrase remains measurably grounded');
  t.equal(unlabeledFabrication.valid, false, 'a recall answer cannot evade evidence validation by omitting an explicit recall phrase');
  t.equal(unlabeledFabrication.reason, 'recall_answer_not_grounded_in_retrieved_evidence', 'the all-answer recall guard reports the mismatch');
  t.equal(disclaimerThenFabrication.valid, false, 'an uncertainty disclaimer cannot license unrelated recalled details');
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

test('structured tool results preserve canonical task lifecycle fields', (t) => {
  const pending = contracts.extractStructuredStatusFacts({
    success: true,
    task: { taskId: 'task-pending', status: 'pending', title: 'Queued work' }
  });
  const cancelled = contracts.extractStructuredStatusFacts({
    success: true,
    stopped: true,
    task: { taskId: 'task-cancelled', status: 'cancelled', title: 'Stopped work' }
  });

  t.deepEqual(
    pending,
    [{ kind: 'task', taskId: 'task-pending', state: 'pending', source: 'tool_result' }],
    'pending task state is carried from the tool result without prose reconstruction'
  );
  t.deepEqual(
    cancelled,
    [{ kind: 'task', taskId: 'task-cancelled', state: 'cancelled', source: 'tool_result' }],
    'cancelled task state is carried from the tool result without prose reconstruction'
  );
  t.match(
    contracts.enforceStatusFallback('The task completed successfully.', cancelled),
    /cancelled \(not completed\)/i,
    'fallback cannot turn a cancelled tool result into successful completion'
  );
  t.end();
});

test('explicit negative PR wording and reported checks keep their source semantics', (t) => {
  const pr = contracts.extractStructuredStatusFacts(
    'PR #9 is mergeable, but it has not been merged.'
  );
  const tests = contracts.extractStructuredStatusFacts(
    'The user reports that all tests passed.'
  );
  const requestedFutureState = contracts.extractStructuredStatusFacts(
    'Fix the tests so they pass.'
  );

  t.equal(pr[0].state, 'not_merged', 'negative merged wording is preserved as an explicit non-merged lifecycle state');
  t.equal(pr[0].mergeability, 'mergeable', 'mergeability remains an independent field');
  t.equal(tests[0].outcome, 'reported_passing', 'reported passing tests retain user-reported provenance');
  t.equal(requestedFutureState.length, 0, 'a request to make tests pass is not treated as evidence that they already passed');
  t.equal(
    contracts.validateStatusResponse('I independently verified that all tests passed.', tests).reason,
    'reported_tests_described_as_independently_verified',
    'user-reported checks cannot become independently verified checks'
  );
  t.match(
    contracts.enforceStatusFallback('I independently verified that all tests passed.', tests),
    /the report states/i,
    'fallback restores the reported-evidence wording'
  );
  t.end();
});

test('PR extraction and validation keep lifecycle claims local to the referenced PR', (t) => {
  const statuses = contracts.extractStructuredStatusFacts(
    'PR #9 is open and mergeable while PR #10 merged successfully. PR #11 is mergeable and pushed.'
  );
  const pr9 = statuses.find(status => status.number === 9);
  const pr10 = statuses.find(status => status.number === 10);
  const pr11 = statuses.find(status => status.number === 11);

  t.equal(pr9.state, 'open', 'the first PR retains its open state');
  t.equal(pr9.mergeability, 'mergeable', 'the first PR retains its own mergeability');
  t.equal(pr10.state, 'merged', 'an explicit completed merge is recognized for the second PR');
  t.equal(pr10.mergeability, 'unknown', 'the second PR does not inherit mergeability from the first clause');
  t.equal(pr11.state, 'not_merged', 'mergeable and pushed do not imply merged');
  t.equal(pr11.mergeability, 'mergeable', 'mergeability remains independent from lifecycle state');

  const accurate = contracts.validateStatusResponse(
    'PR #9 remains open and mergeable. PR #10 was merged successfully.',
    [pr9]
  );
  const inaccurate = contracts.validateStatusResponse(
    'PR #9 merged successfully. PR #10 was also merged.',
    [pr9]
  );
  t.equal(accurate.valid, true, 'another PR being merged does not invalidate an accurate open-PR report');
  t.equal(inaccurate.reason, 'open_pr_described_as_merged', 'a merge claim for the actual open PR is rejected');

  const fallback = contracts.enforceStatusFallback(
    'PR #9 was successfully merged. PR #10 was successfully merged.',
    [pr9]
  );
  t.match(fallback, /PR #9 is open and mergeable \(not merged\)/i, 'fallback corrects only the contradicted open PR');
  t.match(fallback, /PR #10 was successfully merged/i, 'fallback preserves the independent merged PR');
  t.end();
});

test('mergeable, pushed, prospective, and explicitly negative PR wording remain non-merged', (t) => {
  const mergeable = contracts.extractStructuredStatusFacts('PR #21 is mergeable.');
  const pushed = contracts.extractStructuredStatusFacts('PR #22 was pushed.');
  const negative = contracts.extractStructuredStatusFacts('PR #23 has not yet been merged.');
  const prospective = contracts.extractStructuredStatusFacts('PR #24 is ready to be merged after review.');

  t.equal(mergeable[0].state, 'not_merged', 'mergeable alone is explicitly non-merged');
  t.equal(pushed[0].state, 'not_merged', 'pushed alone is explicitly non-merged');
  t.equal(negative[0].state, 'not_merged', 'not-yet-merged wording is explicitly non-merged');
  t.equal(prospective[0].state, 'unknown', 'prospective merge wording is not mistaken for a completed merge');
  t.equal(
    contracts.validateStatusResponse('PR #21 has been merged.', mergeable).reason,
    'open_pr_described_as_merged',
    'a mergeable PR cannot be summarized as merged'
  );
  t.end();
});

test('task lifecycle aliases preserve pending and cancelled semantics', (t) => {
  const queued = contracts.extractStructuredStatusFacts({ taskId: 'task-q', status: 'queued' });
  const canceled = contracts.extractStructuredStatusFacts({ taskId: 'task-c', status: 'canceled' });
  const aborted = [{ kind: 'task', taskId: 'task-a', state: 'aborted' }];

  t.equal(queued[0].state, 'pending', 'queued tool state normalizes to pending');
  t.equal(canceled[0].state, 'cancelled', 'US canceled spelling normalizes to cancelled');
  t.equal(
    contracts.validateStatusResponse('The work is underway now.', queued).reason,
    'pending_task_described_as_running',
    'underway is treated as a running claim'
  );
  t.equal(
    contracts.validateStatusResponse('The stopped task shipped successfully.', canceled).reason,
    'cancelled_task_described_as_completed',
    'shipped and successful are treated as completion claims'
  );
  t.equal(
    contracts.validateStatusResponse('The aborted task is done.', aborted).reason,
    'cancelled_task_described_as_completed',
    'aborted input state receives the cancelled-state guard'
  );
  t.equal(
    contracts.validateStatusResponse('It is still queued and not running.', queued).valid,
    true,
    'an explicit not-running statement remains valid'
  );
  t.equal(
    contracts.validateStatusResponse('It was cancelled and did not complete.', canceled).valid,
    true,
    'an explicit non-completion statement remains valid'
  );
  t.end();
});

test('mocked process evidence cannot become a real process-operation claim', (t) => {
  const simulated = contracts.extractStructuredStatusFacts(
    'A dry-run simulated the Claude process restart; no real process was touched.'
  );
  const negatedMock = contracts.extractStructuredStatusFacts(
    'The restart was not mocked. Claude actually restarted.'
  );

  t.deepEqual(
    simulated,
    [{
      kind: 'process_operation',
      operation: 'restart',
      target: 'claude',
      outcome: 'simulated',
      source: 'user_reported',
      verified: false
    }],
    'dry-run and simulated wording produces structured mocked-process evidence'
  );
  t.equal(negatedMock.length, 0, 'explicitly negated mock wording is not classified as simulated evidence');
  t.equal(
    contracts.validateStatusResponse(
      'The mocked restart test passed. Claude successfully restarted.',
      simulated
    ).reason,
    'simulated_restart_described_as_real',
    'a mocked qualifier in another clause cannot license a real restart claim'
  );
  t.equal(
    contracts.validateStatusResponse('The process restart was successful.', simulated).reason,
    'simulated_restart_described_as_real',
    'successful restart wording is also treated as a real-operation claim'
  );
  t.equal(
    contracts.validateStatusResponse(
      'Claude was not actually restarted; the operation was only simulated in a test.',
      simulated
    ).valid,
    true,
    'an explicit no-real-restart explanation remains valid'
  );
  t.match(
    contracts.enforceStatusFallback('Claude successfully restarted.', simulated),
    /simulated in a test/i,
    'fallback labels the operation as simulated'
  );
  t.end();
});

test('latest structured fact supersedes the same PR, task, process, or test identity', (t) => {
  const statuses = contracts.mergeStructuredStatusFacts(
    [
      { kind: 'pull_request', number: 9, state: 'open', source: 'user_reported' },
      { kind: 'task', taskId: 'task-A', state: 'pending', source: 'tool_result' },
      { kind: 'process_operation', operation: 'restart', target: 'claude', outcome: 'simulated', source: 'user_reported', verified: false },
      { kind: 'test_result', testId: 'default', outcome: 'reported_passing', source: 'user_reported', verified: false }
    ],
    [
      { kind: 'pull_request', number: 9, state: 'merged', source: 'tool_result', verified: true },
      { kind: 'task', taskId: 'task-A', state: 'completed', source: 'tool_result' },
      { kind: 'process_operation', operation: 'restart', target: 'claude', outcome: 'verified_success', source: 'tool_result', verified: true },
      { kind: 'test_result', testId: 'default', outcome: 'verified_passing', source: 'tool_result', verified: true }
    ]
  );

  t.equal(statuses.length, 4, 'one current fact remains for each stable subject identity');
  t.equal(statuses.find(item => item.kind === 'pull_request').state, 'merged', 'the newer PR lifecycle wins');
  t.equal(statuses.find(item => item.kind === 'task').state, 'completed', 'the newer task lifecycle wins');
  t.equal(statuses.find(item => item.kind === 'process_operation').outcome, 'verified_success', 'real process evidence supersedes a simulated result for that process');
  t.equal(statuses.find(item => item.kind === 'test_result').outcome, 'verified_passing', 'a real test run supersedes an earlier report');
  t.equal(
    contracts.validateStatusResponse('I ran npm test and it passed. Claude restarted successfully.', statuses).valid,
    true,
    'superseded reported/simulated facts no longer suppress truthful later tool evidence'
  );

  const repeatedPr = contracts.extractStructuredStatusFacts(
    'PR #9 is open and mergeable. PR #9 has now been merged.'
  );
  t.equal(repeatedPr.length, 1, 'repeated text about one PR becomes one current fact');
  t.equal(repeatedPr[0].state, 'merged', 'the last PR fact in the report is authoritative');
  t.equal(
    contracts.extractStructuredStatusFacts('I opened the PR #9 page to inspect its discussion.').length,
    0,
    'a bare PR reference is not a newer lifecycle fact that can erase known status'
  );
  t.end();
});

test('successful tool results carry verified provenance and replace stale reports', (t) => {
  const reportedTests = contracts.extractStructuredStatusFacts('The user reports that all tests passed.');
  const verifiedTests = contracts.extractStructuredStatusFacts(
    { success: true, output: '123 tests passed' },
    { source: 'tool_result', toolName: 'run_tests', args: {} }
  );
  const effectiveTests = contracts.mergeStructuredStatusFacts(reportedTests, verifiedTests);

  t.equal(verifiedTests[0].outcome, 'verified_passing', 'a successful run_tests result is structured as verified');
  t.equal(verifiedTests[0].verified, true, 'the evidence provenance explicitly marks verification');
  t.equal(effectiveTests.length, 1, 'the verified run replaces the same reported test identity');
  t.equal(
    contracts.validateStatusResponse('I just went ahead and ran npm test; it passed.', effectiveTests).valid,
    true,
    'a truthful run claim is allowed once matching successful tool evidence exists'
  );
  t.equal(
    contracts.extractStructuredStatusFacts(
      { success: true, output: 'No tests configured' },
      { source: 'tool_result', toolName: 'run_tests', args: {} }
    ).length,
    0,
    'a successful no-tests placeholder is not promoted to genuine verified evidence'
  );

  const simulated = contracts.extractStructuredStatusFacts(
    'A mocked test simulated the Claude process restart.'
  );
  const verifiedRestart = contracts.extractStructuredStatusFacts(
    { success: true, operation: 'restart', target: 'Claude' },
    {
      source: 'tool_result',
      toolName: 'run_command',
      args: { command: 'Restart-Process Claude' },
      operation: 'restart',
      target: 'Claude'
    }
  );
  const effectiveProcess = contracts.mergeStructuredStatusFacts(simulated, verifiedRestart);
  t.equal(effectiveProcess.length, 1, 'the actual operation replaces the simulated fact for the same target');
  t.equal(effectiveProcess[0].outcome, 'verified_success', 'the current process fact records real success');
  t.end();
});

test('status validation and fallback are local to the named task and process', (t) => {
  const statuses = [
    { kind: 'task', taskId: 'task-A', state: 'pending', source: 'tool_result' },
    { kind: 'task', taskId: 'task-B', state: 'completed', source: 'tool_result' },
    { kind: 'process_operation', operation: 'restart', target: 'claude', outcome: 'simulated', source: 'user_reported' },
    { kind: 'process_operation', operation: 'restart', target: 'node', outcome: 'verified_success', source: 'tool_result', verified: true }
  ];
  const answer = 'Task task-B completed successfully. Documentation completed. Node restarted successfully.';

  t.equal(
    contracts.validateStatusResponse(answer, statuses).valid,
    true,
    'pending task A and simulated Claude evidence do not contaminate task B, documentation, or Node'
  );
  t.equal(
    contracts.enforceStatusFallback(answer, statuses),
    answer,
    'fallback leaves unrelated completed subjects untouched'
  );

  const cancelledA = [
    { kind: 'task', taskId: 'task-A', state: 'cancelled', source: 'tool_result' },
    { kind: 'task', taskId: 'task-B', state: 'completed', source: 'tool_result' }
  ];
  t.equal(
    contracts.validateStatusResponse('Task task-B is done. The release notes are completed.', cancelledA).valid,
    true,
    'cancelled task A does not forbid a separate task or generic document from completing'
  );
  t.equal(
    contracts.validateStatusResponse('Task task-A completed successfully.', cancelledA).reason,
    'cancelled_task_described_as_completed',
    'the guard still rejects a completion claim for the cancelled task itself'
  );
  t.equal(
    contracts.validateStatusResponse('Node restarted successfully.', [
      { kind: 'process_operation', operation: 'restart', target: 'claude', outcome: 'simulated', source: 'user_reported' }
    ]).valid,
    true,
    'a simulated Claude fact does not contaminate a separately named process even when it is the only stored process fact'
  );
  t.end();
});

test('temporal merged wording and narrated test execution upgrades are rejected', (t) => {
  const openPr = [{ kind: 'pull_request', number: 9, state: 'open', mergeability: 'mergeable', source: 'tool_result' }];
  for (const phrase of [
    'PR #9 has now been merged.',
    'PR #9 was just merged.',
    'PR #9 is already merged.'
  ]) {
    t.equal(
      contracts.validateStatusResponse(phrase, openPr).reason,
      'open_pr_described_as_merged',
      `rejects temporal merge upgrade: ${phrase}`
    );
  }

  const reportedTests = contracts.extractStructuredStatusFacts('The report says all tests passed.');
  for (const phrase of [
    'I then went ahead and ran npm test.',
    'I just went ahead and ran npm test.',
    'We subsequently proceeded and executed the test suite.'
  ]) {
    t.equal(
      contracts.validateStatusResponse(phrase, reportedTests).reason,
      'reported_tests_described_as_independently_verified',
      `rejects narrated independent execution without tool evidence: ${phrase}`
    );
  }
  t.end();
});

test('user-reported green checks cannot become independently run or verified checks', (t) => {
  const ciReport = contracts.extractStructuredStatusFacts('The user says CI was green.');
  const countReport = contracts.extractStructuredStatusFacts('The report says 247 tests passed.');
  const exitReport = contracts.extractStructuredStatusFacts('The report says npm test exited with code 0.');

  t.equal(ciReport[0].outcome, 'reported_passing', 'green CI is captured as a reported result');
  t.equal(countReport[0].outcome, 'reported_passing', 'a reported passing test count is captured');
  t.equal(exitReport[0].outcome, 'reported_passing', 'a reported zero test exit code is captured');
  t.equal(
    contracts.validateStatusResponse('We reran npm test and it passed.', ciReport).reason,
    'reported_tests_described_as_independently_verified',
    'reran is treated as an independent-execution claim'
  );
  t.equal(
    contracts.validateStatusResponse('Our own test run was green.', ciReport).reason,
    'reported_tests_described_as_independently_verified',
    'own green run is treated as independent verification'
  );
  t.equal(
    contracts.validateStatusResponse('Orion validated the suite.', ciReport).reason,
    'reported_tests_described_as_independently_verified',
    'validated suite is treated as independent verification'
  );
  t.equal(
    contracts.validateStatusResponse('I checked the report, and it says CI was green.', ciReport).valid,
    true,
    'checking the supplied report is not confused with independently checking the code'
  );
  t.match(
    contracts.enforceStatusFallback('We independently executed the tests and they passed.', countReport),
    /the report states/i,
    'fallback restores reported provenance for execution synonyms'
  );
  t.end();
});

// ── Completion-gate narration detection ────────────────────────────────────────
// The completion gate injects a [SYSTEM] prompt when the model tries to finish early; the
// model's eventual reply TO THE GATE ("Completion gate is now clear — all five coverage
// surfaces are inspected and verified...") is machinery narration, not an answer, yet it is
// sentence-shaped enough to pass substantive-answer checks. It overwrote the model's real
// summary and was relayed to the user verbatim by Dispatch. This contract recognizes it.

test('completion-gate narration is detected when the reply only talks about the gate', (t) => {
  t.equal(
    contracts.isCompletionGateNarration(
      'Completion gate is now clear — all five coverage surfaces are inspected and verified, the win condition is satisfied, and no blockers remain. Task complete.'
    ),
    true,
    'the exact relayed gate acknowledgment is narration'
  );
  t.equal(
    contracts.isCompletionGateNarration('All coverage surfaces verified. No blockers remain.'),
    true,
    'a terse surfaces-and-blockers acknowledgment is narration'
  );
  t.equal(
    contracts.isCompletionGateNarration('Completion gate cleared. Done.'),
    true,
    'gate clearance with a bare done is narration'
  );
  t.end();
});

test('real answers are never mistaken for completion-gate narration', (t) => {
  t.equal(
    contracts.isCompletionGateNarration(
      'I upgraded the Codex project playwright to 1.61.1 and removed chromium-1208/1223, freeing about 1.29 GB. The completion gate is clear.'
    ),
    false,
    'a substantive summary that merely mentions the gate keeps its substance'
  );
  t.equal(
    contracts.isCompletionGateNarration(
      'Python Playwright has no 1.61.1 release — it jumps to 1.62.0, which needs a new browser download, so I skipped that bump and consolidated the rest.'
    ),
    false,
    'a substantive summary with no gate vocabulary is untouched'
  );
  t.equal(
    contracts.isCompletionGateNarration(
      'The build is failing on Windows because node-gyp cannot find MSVC; that blocker needs Visual Studio Build Tools installed before I can continue.'
    ),
    false,
    'a real explanation that uses the word blocker is not narration'
  );
  t.equal(contracts.isCompletionGateNarration('Task complete.'), false,
    'a bare completion with no gate vocabulary is out of scope for this detector');
  t.equal(contracts.isCompletionGateNarration(''), false, 'empty text is not narration');
  t.end();
});
