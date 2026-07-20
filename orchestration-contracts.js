(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OrionOrchestrationContracts = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RECALL_REQUEST = /\b(?:do you remember|can you remember|remember (?:our|when|the)|our earlier conversation|we (?:talked|spoke|discussed) (?:about|earlier|before)|last time we|you said earlier|i said earlier)\b/i;
  const EXPLICIT_RECALL_CLAIM = /\b(?:i (?:do )?remember|i recall|we (?:talked|spoke|discussed)(?: about)?|you (?:said|told me|mentioned) (?:earlier|before|last time)|as you (?:said|told me|mentioned) (?:earlier|before)|from our (?:earlier|previous|last) (?:conversation|discussion))\b/i;
  const USER_ATTRIBUTION_CLAIM = /\b(?:you (?:said|told me|mentioned)|as you (?:said|told me|mentioned))\b/i;
  const NEGATED_RECALL_CLAIM = /\b(?:do not|don't|don’t|cannot|can't|can’t|could not|couldn't|couldn’t|would not|wouldn't|wouldn’t)\b[^.!?\n]{0,100}\b(?:remember|recall|pretend)\b/i;

  function isRecallRequest(text) {
    return RECALL_REQUEST.test(String(text || ''));
  }

  function hasExplicitRecallClaim(text) {
    const value = String(text || '');
    return EXPLICIT_RECALL_CLAIM.test(value) && !NEGATED_RECALL_CLAIM.test(value);
  }

  function tokenize(text) {
    return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  }

  const CLAIM_STOPWORDS = new Set([
    'the', 'and', 'that', 'this', 'with', 'from', 'about', 'your', 'you', 'our', 'were', 'was', 'are',
    'have', 'had', 'said', 'talked', 'discussed', 'remember', 'recall', 'earlier', 'before', 'last', 'time'
  ]);

  function evidenceText(evidence) {
    return String((evidence && (evidence.excerpt || evidence.text || evidence.summary)) || '');
  }

  function createResponseBasis(input = {}) {
    const conversationEvidence = (Array.isArray(input.conversationEvidence) ? input.conversationEvidence : [])
      .filter(item => item && evidenceText(item))
      .map(item => {
        const provenance = item.provenance && typeof item.provenance === 'object'
          ? item.provenance
          : {};
        const scores = item.scores && typeof item.scores === 'object'
          ? item.scores
          : {};
        return {
          id: String(item.id || ''),
          sourceKind: String(item.sourceKind || 'conversation'),
          conversationId: String(item.conversationId || provenance.conversationId || ''),
          sessionId: String(item.sessionId || provenance.sessionId || ''),
          messageId: String(item.messageId || provenance.messageId || ''),
          role: String(item.role || ''),
          timestamp: item.timestamp || null,
          relevance: Number(item.totalScore || item.relevance || scores.total || 0)
        };
      });
    return {
      conversationEvidence,
      projectKnowledge: !!input.projectKnowledge,
      generalInference: !!input.generalInference,
      structuredStatuses: Array.isArray(input.structuredStatuses) ? input.structuredStatuses : []
    };
  }

  function recallGroundingScore(answerText, evidence = []) {
    const answerTerms = new Set(tokenize(answerText).filter(term => !CLAIM_STOPWORDS.has(term)));
    const evidenceTerms = new Set(evidence.flatMap(item => tokenize(evidenceText(item))).filter(term => !CLAIM_STOPWORDS.has(term)));
    if (!answerTerms.size || !evidenceTerms.size) return 0;
    let overlap = 0;
    for (const term of answerTerms) if (evidenceTerms.has(term)) overlap++;
    return overlap / Math.max(1, Math.min(answerTerms.size, 20));
  }

  function validateMemoryResponse(answerText, context = {}) {
    const answer = String(answerText || '').trim();
    const evidence = Array.isArray(context.conversationEvidence) ? context.conversationEvidence : [];
    const explicitClaim = hasExplicitRecallClaim(answer);
    const userAttribution = USER_ATTRIBUTION_CLAIM.test(answer);
    if (!explicitClaim) return { valid: true, reason: '', groundingScore: recallGroundingScore(answer, evidence) };
    if (!evidence.length) {
      return { valid: false, reason: 'explicit_recall_without_evidence', groundingScore: 0 };
    }
    if (userAttribution && !evidence.some(item => String(item.role || '').toLowerCase() === 'user')) {
      return { valid: false, reason: 'user_attribution_without_user_evidence', groundingScore: 0 };
    }
    const score = recallGroundingScore(answer, evidence);
    if (score < 0.08) return { valid: false, reason: 'recall_claim_not_grounded_in_retrieved_evidence', groundingScore: score };
    return { valid: true, reason: '', groundingScore: score };
  }

  function buildMemoryCorrectionPrompt(userPrompt, evidence = [], reason = '') {
    const excerpts = evidence.slice(0, 5).map((item, index) => `${index + 1}. [${item.sourceKind || 'conversation'}${item.role ? `/${item.role}` : ''}] ${evidenceText(item).slice(0, 900)}`).join('\n');
    return `[SYSTEM: Memory-confidence correction required. Your draft made an explicit claim about a prior conversation that was not supported by retrieved conversational evidence (${reason || 'unsupported recall'}). Never fill a retrieval gap with a plausible reconstruction. ${excerpts ? `Use only these retrieved excerpts when describing what was previously discussed:\n${excerpts}` : `No relevant prior-conversation evidence was retrieved. Say naturally that you could not retrieve the specific discussion. You may offer project facts or a new inference only when you label it as such.`}\n\nAnswer the user's actual question again without discussing this internal correction. User message: "${String(userPrompt || '').replace(/"/g, "'").slice(0, 800)}"]`;
  }

  function buildEvidenceBackedRecallFallback(evidence = []) {
    const usable = evidence.filter(item => evidenceText(item)).slice(0, 3);
    if (!usable.length) {
      return "I couldn’t retrieve that specific earlier conversation, so I don’t want to pretend I remember it. If you give me the key point, I can pick it up from there.";
    }
    const summary = usable.map(item => evidenceText(item).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    return `I found the earlier conversation. The relevant part was: ${summary.slice(0, 1800)}`;
  }

  function extractStructuredStatusFacts(text) {
    const source = String(text || '');
    const facts = [];
    const prMatches = [...source.matchAll(/\bPR\s*#(\d+)\b/gi)];
    for (const match of prMatches) {
      const number = Number(match[1]);
      const state = /\bmerged\b/i.test(source) ? 'merged' : (/\b(?:open|draft)\b/i.test(source) ? 'open' : 'unknown');
      const mergeability = /\bmergeable\b/i.test(source) ? 'mergeable' : (/\bconflict(?:ing|s)?\b/i.test(source) ? 'conflicting' : 'unknown');
      const sync = /\bsynchroni[sz]ed\b|\bup[ -]to[ -]date\b/i.test(source) ? 'synchronized' : 'unknown';
      facts.push({ kind: 'pull_request', number, state, mergeability, sync, source: 'user_reported' });
    }
    if (/\bmock(?:ed|ing)?\b/i.test(source) && /\b(?:restart|process operation|process)\b/i.test(source)) {
      facts.push({ kind: 'process_operation', operation: 'restart', outcome: 'simulated', source: 'user_reported' });
    }
    return facts;
  }

  function validateStatusResponse(answerText, statuses = []) {
    const answer = String(answerText || '');
    for (const status of Array.isArray(statuses) ? statuses : []) {
      if (status.kind === 'pull_request' && status.state === 'open') {
        const explicitlyNotMerged = /\b(?:not(?:\s+(?:been|yet))?|never)\s+merged\b|\b(?:has|have|had|is|was)\s+not\s+been\s+merged\b/i.test(answer);
        const claimsMerged = /\b(?:has been|is|was|successfully)?\s*merged\b/i.test(answer) && !explicitlyNotMerged;
        if (claimsMerged) return { valid: false, reason: 'open_pr_described_as_merged', status };
      }
      if (status.kind === 'task' && status.state === 'pending' && /\b(?:is|now|currently) running\b/i.test(answer)) {
        return { valid: false, reason: 'pending_task_described_as_running', status };
      }
      if (status.kind === 'task' && status.state === 'cancelled' && /\b(?:completed|finished successfully|done)\b/i.test(answer) && !/\bnot completed\b/i.test(answer)) {
        return { valid: false, reason: 'cancelled_task_described_as_completed', status };
      }
      if (status.kind === 'process_operation' && status.outcome === 'simulated' && /\b(?:actually|successfully)?\s*restarted\b/i.test(answer) && !/\b(?:mocked|simulated|test)\b/i.test(answer)) {
        return { valid: false, reason: 'simulated_restart_described_as_real', status };
      }
    }
    return { valid: true, reason: '' };
  }

  function buildStatusCorrectionPrompt(statusValidation) {
    const status = statusValidation && statusValidation.status ? statusValidation.status : {};
    return `[SYSTEM: Factual status correction required. Preserve independent structured fields and do not infer a terminal state from adjacent wording. Source status: ${JSON.stringify(status)}. Your draft contradicted it (${statusValidation && statusValidation.reason ? statusValidation.reason : 'status contradiction'}). Rewrite the answer accurately. In particular, mergeable is not merged; queued is not running; cancelled is not completed; user-reported or mocked checks are not independently verified real operations.]`;
  }

  function enforceStatusFallback(answerText, statuses = []) {
    let output = String(answerText || '');
    for (const status of Array.isArray(statuses) ? statuses : []) {
      if (status.kind === 'pull_request' && status.state === 'open') {
        output = output.replace(/\b(?:has been|is|was|successfully)?\s*merged\b/gi, `is open${status.mergeability === 'mergeable' ? ' and mergeable' : ''} (not merged)`);
      }
    }
    return output;
  }

  return {
    isRecallRequest,
    hasExplicitRecallClaim,
    createResponseBasis,
    recallGroundingScore,
    validateMemoryResponse,
    buildMemoryCorrectionPrompt,
    buildEvidenceBackedRecallFallback,
    extractStructuredStatusFacts,
    validateStatusResponse,
    buildStatusCorrectionPrompt,
    enforceStatusFallback
  };
});
