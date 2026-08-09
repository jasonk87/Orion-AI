(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OrionOrchestrationContracts = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RECALL_REQUEST = /\b(?:do you (?:remember|recall)|can you (?:remember|recall)|(?:remember|recall) (?:our|when|the)|remind me(?:\s+(?:what|how|where|when|about))?|our earlier conversation|we (?:talked|spoke|discussed) (?:about|earlier|before)|last time we|you said earlier|i said earlier|what did we (?:decide|agree|settle on|discuss)|what was our (?:earlier|previous|last) (?:decision|agreement|discussion))\b/i;
  const EXPLICIT_RECALL_CLAIM = /\b(?:i (?:do )?remember|i recall|we (?:talked|spoke|discussed)(?: about)?|we (?:agreed|decided|settled)(?: earlier| before| last time)?|you (?:said|told me|mentioned) (?:earlier|before|last time)|as you (?:said|told me|mentioned) (?:earlier|before)|(?:earlier|previously|last time),?\s+you (?:wanted|asked|preferred|decided|said)|from our (?:earlier|previous|last) (?:conversation|discussion)|our (?:earlier|previous|last) (?:decision|agreement|discussion) (?:was|centered|focused|covered)|the (?:earlier|previous|last) (?:conversation|discussion) (?:was|centered|focused|covered))\b/i;
  const USER_ATTRIBUTION_CLAIM = /\b(?:you (?:said|told me|mentioned)|as you (?:said|told me|mentioned))\b/i;
  const NEGATED_RECALL_CLAIM = /\b(?:do not|don't|don’t|cannot|can't|can’t|could not|couldn't|couldn’t|would not|wouldn't|wouldn’t)\b[^.!?\n]{0,100}\b(?:remember|recall|pretend)\b/i;
  const UNLABELED_RECALL_RECONSTRUCTION = /\b(?:the (?:answer|plan|idea|proposal|direction|decision|discussion|conversation) (?:was|used|included|centered|focused)|what we (?:decided|agreed|discussed) (?:was|included)|we (?:had|chose) (?:a|the))\b/i;

  function isRecallRequest(text) {
    return RECALL_REQUEST.test(String(text || ''));
  }

  function hasExplicitRecallClaim(text) {
    const value = String(text || '');
    return value
      .split(/(?:[.!?;\n]+|\bbut\b|\bhowever\b|\byet\b)/i)
      .some(clause => EXPLICIT_RECALL_CLAIM.test(clause) && !NEGATED_RECALL_CLAIM.test(clause));
  }

  function hasRecallUncertaintyDisclosure(text) {
    return /\b(?:could not|couldn['’]t|cannot|can['’]t|did not|didn['’]t|was not able to|wasn['’]t able to)\s+(?:retrieve|find|locate|access|verify|confirm)\b|\b(?:do not|don['’]t)\s+have\s+(?:retrieved\s+)?(?:evidence|a record|the record|that conversation|that discussion|the context)\b|\b(?:i am|i['’]m)\s+(?:reasoning|inferring|making an inference)\b|\b(?:this is|that is)\s+(?:an inference|my reasoning)\b/i.test(String(text || ''));
  }

  const RECALL_CONCEPTS = Object.freeze({
    membership: 'subscription',
    memberships: 'subscription',
    subscriptions: 'subscription',
    enrollment: 'subscription',
    enrollments: 'subscription',
    commitment: 'subscription',
    commitments: 'subscription',
    venues: 'location',
    venue: 'location',
    locations: 'location',
    sites: 'location',
    recurrent: 'recurring',
    repeating: 'recurring',
    ongoing: 'recurring',
    payments: 'paid',
    payment: 'paid',
    fees: 'paid',
    fee: 'paid',
    pricing: 'paid',
    fitness: 'gym',
    gyms: 'gym',
    massages: 'massage',
    therapies: 'therapy',
    classes: 'class',
    grouped: 'organized',
    grouping: 'organized',
    organize: 'organized',
    organising: 'organized',
    organized: 'organized'
  });

  function normalizeRecallTerm(value) {
    let term = String(value || '').toLowerCase().replace(/['’]s$/, '');
    if (RECALL_CONCEPTS[term]) return RECALL_CONCEPTS[term];
    if (term.length > 5 && term.endsWith('ies')) term = `${term.slice(0, -3)}y`;
    else if (term.length > 5 && term.endsWith('ing')) term = term.slice(0, -3);
    else if (term.length > 4 && term.endsWith('ed')) term = term.slice(0, -2);
    else if (term.length > 4 && term.endsWith('s')) term = term.slice(0, -1);
    return RECALL_CONCEPTS[term] || term;
  }

  function tokenize(text) {
    return (String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9_'-]{2,}/g) || [])
      .map(normalizeRecallTerm);
  }

  const CLAIM_STOPWORDS = new Set([
    'the', 'and', 'that', 'this', 'with', 'from', 'about', 'your', 'you', 'our', 'were', 'was', 'are',
    'have', 'had', 'said', 'talked', 'discussed', 'remember', 'recall', 'earlier', 'before', 'last', 'time',
    'conversation', 'discussion', 'idea', 'plan', 'proposal', 'part', 'point', 'found', 'retrieve', 'retriev'
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
    const recallRequested = !!context.recallRequested;
    const explicitClaim = hasExplicitRecallClaim(answer);
    const userAttribution = USER_ATTRIBUTION_CLAIM.test(answer);
    if (recallRequested && !evidence.length && !hasRecallUncertaintyDisclosure(answer)) {
      return { valid: false, reason: 'recall_answer_without_evidence_disclosure', groundingScore: 0 };
    }
    if (recallRequested && !evidence.length && UNLABELED_RECALL_RECONSTRUCTION.test(answer)
        && !/\b(?:reasoning|inference|inferring|current project|project (?:code|source|knowledge)|based on (?:the )?(?:current )?(?:project|source))\b/i.test(answer)) {
      return { valid: false, reason: 'recall_reconstruction_without_evidence', groundingScore: 0 };
    }
    const score = recallGroundingScore(answer, evidence);
    if (recallRequested && evidence.length && score < 0.35) {
      return { valid: false, reason: 'recall_answer_not_grounded_in_retrieved_evidence', groundingScore: score };
    }
    if (!explicitClaim) return { valid: true, reason: '', groundingScore: score };
    if (!evidence.length) {
      return { valid: false, reason: 'explicit_recall_without_evidence', groundingScore: 0 };
    }
    if (userAttribution && !evidence.some(item => String(item.role || '').toLowerCase() === 'user')) {
      return { valid: false, reason: 'user_attribution_without_user_evidence', groundingScore: 0 };
    }
    if (score < 0.55) return { valid: false, reason: 'recall_claim_not_grounded_in_retrieved_evidence', groundingScore: score };
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

  const TASK_STATE_ALIASES = Object.freeze({
    pending: 'pending',
    queued: 'pending',
    waiting: 'pending',
    scheduled: 'pending',
    ready: 'pending',
    pending_execution: 'pending',
    'pending-execution': 'pending',
    active: 'active',
    running: 'active',
    executing: 'active',
    in_progress: 'active',
    'in-progress': 'active',
    completed: 'completed',
    complete: 'completed',
    succeeded: 'completed',
    successful: 'completed',
    done: 'completed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    aborted: 'cancelled',
    stopped: 'cancelled',
    failed: 'failed',
    error: 'failed',
    errored: 'failed'
  });

  function normalizeTaskState(value) {
    const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    return TASK_STATE_ALIASES[key] || '';
  }

  function localClause(source, index, endIndex, neighboringMatches = []) {
    const separators = /[.!?;\n\r]/g;
    let start = 0;
    let end = source.length;
    let separator;
    while ((separator = separators.exec(source)) !== null) {
      if (separator.index < index) start = separator.index + 1;
      else {
        end = separator.index + 1;
        break;
      }
    }
    for (const match of neighboringMatches) {
      if (match.index < index) start = Math.max(start, match.index + match[0].length);
      if (match.index > index) {
        end = Math.min(end, match.index);
        break;
      }
    }
    const prefix = source.slice(start, index);
    const statusPrefix = prefix.match(/\b(?:(?:open|draft|merged|mergeable|conflicting|synchroni[sz]ed|pushed|clean|up[ -]to[ -]date)(?:\s*(?:,|and)\s*)?)+\s*$/i);
    start = statusPrefix ? start + statusPrefix.index : index;
    return source.slice(start, Math.max(endIndex, end)).trim();
  }

  function hasExplicitNotMerged(text) {
    return /\b(?:has|have|had|is|was|were)?\s*(?:not|never)\s+(?:yet\s+)?(?:been\s+)?merged\b|\b(?:hasn['’]?t|haven['’]?t|hadn['’]?t|isn['’]?t|wasn['’]?t|weren['’]?t)\s+(?:yet\s+)?(?:been\s+)?merged\b/i.test(text);
  }

  function hasExplicitMergedState(text) {
    if (hasExplicitNotMerged(text)) return false;
    const withoutProspectiveLanguage = String(text || '')
      .replace(/\b(?:can|could|may|might|should|would|will|ready to|safe to|approved to|eligible to)\s+(?:be\s+)?merged\b/gi, '')
      .replace(/\b(?:once|when|before|after|if)\b[^.!?;\n\r]{0,80}\bmerged\b/gi, '');
    const temporal = '(?:(?:now|just|already|recently|successfully)\\s+)*';
    return new RegExp(
      `\\b(?:has|have|had)\\s+${temporal}(?:been\\s+)?${temporal}merged\\b`
      + `|\\b(?:is|was|were|got)\\s+${temporal}merged\\b`
      + `|\\b(?:PR\\s*#\\d+|pull request)\\s+${temporal}merged\\b`
      + '|\\bmerged\\s+(?:successfully|into|on|at)\\b',
      'i'
    ).test(withoutProspectiveLanguage);
  }

  function splitStatusClauses(text) {
    return String(text || '').split(/(?<=[.!?;])\s+|\r?\n+/).map(clause => clause.trim()).filter(Boolean);
  }

  function isNegatedLifecycleClaim(clause, lifecycleWords) {
    const words = lifecycleWords.join('|');
    return new RegExp(`\\b(?:not|never)\\s+(?:actually\\s+)?(?:${words})\\b|\\b(?:didn['’]?t|doesn['’]?t|isn['’]?t|wasn['’]?t|hasn['’]?t|won['’]?t)\\s+(?:actually\\s+)?(?:${words})\\b`, 'i').test(clause);
  }

  function hasSimulatedProcessQualifier(clause) {
    return /\b(?:mock(?:ed|ing)?|simulat(?:ed|ion)|stub(?:bed)?|fake(?:d)?|emulat(?:ed|ion)|dry[ -]?run|test double|in (?:a|the) test|test[- ]only)\b/i.test(clause);
  }

  function processOperationFromText(text) {
    if (/\brestart(?:ed|ing)?\b/i.test(text)) return 'restart';
    if (/\b(?:kill(?:ed|ing)?|terminat(?:ed|ing|ion))\b/i.test(text)) return 'kill';
    if (/\bstop(?:ped|ping)?\b/i.test(text)) return 'stop';
    if (/\b(?:start(?:ed|ing)?|launch(?:ed|ing)?)\b/i.test(text)) return 'start';
    return '';
  }

  function processCompletionPattern(operation) {
    const patterns = {
      restart: /\b(?:(?:has|had|was|is)\s+)?(?:(?:actually|successfully)\s+)?(?:restarted|restart\s+(?:(?:was|is)\s+)?(?:completed|complete|successful|succeeded|worked))\b/i,
      kill: /\b(?:(?:has|had|was|is)\s+)?(?:(?:actually|successfully)\s+)?(?:killed|terminated|kill\s+(?:(?:was|is)\s+)?(?:completed|complete|successful|succeeded|worked))\b/i,
      stop: /\b(?:(?:has|had|was|is)\s+)?(?:(?:actually|successfully)\s+)?(?:stopped|stop\s+(?:(?:was|is)\s+)?(?:completed|complete|successful|succeeded|worked))\b/i,
      start: /\b(?:(?:has|had|was|is)\s+)?(?:(?:actually|successfully)\s+)?(?:started|launched|start\s+(?:(?:was|is)\s+)?(?:completed|complete|successful|succeeded|worked))\b/i
    };
    return patterns[operation] || /\b(?:restarted|killed|terminated|stopped|started|launched)\b/i;
  }

  function prClausesForNumber(text, number) {
    const source = String(text || '');
    const matches = [...source.matchAll(/\bPR\s*#(\d+)\b/gi)];
    const clauses = matches
      .filter(match => Number(match[1]) === Number(number))
      .map(match => localClause(source, match.index, match.index + match[0].length, matches));
    return clauses.length ? clauses : (matches.length ? [] : [source]);
  }

  function pendingDescribedAsActive(text) {
    return splitStatusClauses(text).some(clause => {
      const activeClaim = /\b(?:running|active|started|underway|executing|in[ -]progress|being worked on)\b/i.test(clause);
      return activeClaim && !isNegatedLifecycleClaim(clause, ['running', 'active', 'started', 'underway', 'executing', 'in[ -]progress', 'being worked on']);
    });
  }

  function cancelledDescribedAsCompleted(text) {
    return splitStatusClauses(text).some(clause => {
      const completedClaim = /\b(?:complete(?:d)?|finished|done|succeeded|successful(?:ly)?|shipped|delivered)\b/i.test(clause);
      return completedClaim && !isNegatedLifecycleClaim(clause, ['complete(?:d)?', 'finished', 'done', 'succeeded', 'successful(?:ly)?', 'shipped', 'delivered']);
    });
  }

  function reportedTestsDescribedAsVerified(text) {
    const subject = '(?:i|we|orion)';
    const sequencing = '(?:(?:(?:then|just|subsequently|afterwards)\\s+)?(?:(?:went\\s+ahead|proceeded)\\s+and\\s+)?)';
    const auxiliary = '(?:(?:have|has|had|did)\\s+)?';
    const modifier = '(?:(?:personally|independently|directly|actually)\\s+)?';
    const testObject = '(?:(?:all|the|those|these)\\s+)?(?:tests?|test suite|suite|npm test|CI|checks?|test results?|results?|it|them)';
    return new RegExp(`\\b${subject}\\s+${sequencing}${auxiliary}${modifier}(?:re[ -]?ran|ran|executed)\\s+${testObject}\\b`, 'i').test(text)
      || new RegExp(`\\b${subject}\\s+${sequencing}${auxiliary}${modifier}(?:verified|confirmed|validated|checked|tested|reproduced)\\s+(?:that\\s+)?${testObject}\\b`, 'i').test(text)
      || /\b(?:my|our|orion['’]?s)\s+(?:own\s+)?(?:test|CI|check)(?:s|\s+suite|\s+run)?\s+(?:passed|succeeded|was|were|is|are)\s*(?:green|successful|passing)?\b/i.test(text)
      || /\b(?:i|we|orion)\s+(?:got|obtained|saw)\s+(?:a\s+)?(?:clean|green|passing|successful)\s+(?:test|CI|check)(?:s|\s+suite|\s+run)?\b/i.test(text);
  }

  // The completion gate holds back premature final answers by injecting a [SYSTEM] prompt; the
  // model finishes the remaining work and then replies TO THE GATE — "Completion gate is now
  // clear — all five coverage surfaces are inspected and verified, the win condition is
  // satisfied, and no blockers remain. Task complete." That reply is internal machinery
  // narration, not an answer, but it is long enough and sentence-shaped enough to pass the
  // substantive-answer checks, so it used to clobber the model's real user-facing summary and
  // get relayed to the user verbatim. This detector recognizes it: text that talks ABOUT gate
  // machinery and says nothing else. A real summary that merely mentions the gate at the end
  // keeps its substance after the gate clauses are removed, and is not flagged.
  // Vocabulary is split by how much it proves. "Completion gate" and "coverage surfaces" name
  // internal apparatus and appear nowhere in ordinary speech. "Blockers" and "verified" are
  // plain English that developers use constantly — treating them as machinery meant a perfectly
  // good short answer like "No blockers, done." was suppressed as narration and never shown.
  //
  // So a strong apparatus term is REQUIRED. Weak terms only help strip clauses once narration
  // has already been established by a strong one; they can never establish it alone.
  const GATE_APPARATUS_STRONG = /\b(?:completion gate|coverage surfaces?|win[ -]conditions?|ready[ _]for[ _]final|evidence gate|operational (?:context|state)|gate (?:is )?(?:now )?(?:clear|cleared|satisfied))\b/i;
  const GATE_APPARATUS_WEAK = /\b(?:blockers?|inspected and verified|all surfaces?|no blockers remain)\b/i;
  const BARE_COMPLETION_CLAUSE = /^(?:the\s+)?task\s+(?:is\s+)?(?:now\s+)?(?:fully\s+)?complete[d.!]*$|^(?:all\s+)?done[.!]*$|^(?:everything|all)\s+(?:is\s+)?(?:verified|complete[d]?|satisfied)[.!]*$/i;

  function isCompletionGateNarration(text) {
    const value = String(text || '').trim();
    // No apparatus term means this is someone talking, not the machinery narrating itself.
    if (!value || !GATE_APPARATUS_STRONG.test(value)) return false;
    const residual = value
      .split(/(?<=[.!?])\s+|\n+|;\s+|\s+[—–]\s+/)
      .map(clause => clause.trim())
      .filter(clause => clause
        && !GATE_APPARATUS_STRONG.test(clause)
        && !GATE_APPARATUS_WEAK.test(clause)
        && !BARE_COMPLETION_CLAUSE.test(clause))
      .join(' ')
      .trim();
    return residual.length < 40;
  }

  // A follow-up question deserves a NEW answer. Asked "why that one over these others?", a
  // model on a low reasoning budget will often re-emit its previous message almost verbatim —
  // it reads as responsive, costs nothing to produce, and completely fails to answer what was
  // actually asked. Restatement is detected by 5-word shingle overlap rather than bag-of-words
  // similarity: a genuine re-analysis of the same topic reuses vocabulary but not phrasing,
  // while a restatement reuses whole clauses in order.
  const RESTATEMENT_SHINGLE_SIZE = 5;
  const RESTATEMENT_OVERLAP_THRESHOLD = 0.6;
  // Short replies are legitimately repeatable ("Yes.", "Still running.") and carry too few
  // shingles to measure, so only substantial answers are checked.
  const RESTATEMENT_MIN_WORDS = 25;

  function normalizeForSimilarity(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildShingles(words, size) {
    const shingles = new Set();
    for (let i = 0; i + size <= words.length; i++) {
      shingles.add(words.slice(i, i + size).join(' '));
    }
    return shingles;
  }

  // Measures how much of THE DRAFT is recycled phrasing — deliberately not similarity, and
  // deliberately not divided by the smaller of the two sets.
  //
  // Dividing by the smaller set punished brevity: a short but legitimate answer that reused a
  // few phrases from a long previous message scored near 1.0 purely because its own shingle set
  // was tiny, and got rejected for being concise. Dividing by the DRAFT asks the question that
  // actually matters — "does this reply contain anything new?" — and is just as resistant to
  // padding, because defeating it requires adding as much genuinely new material as the
  // original, at which point it is a new answer.
  function restatementOverlap(draft, previous) {
    const draftWords = normalizeForSimilarity(draft).split(' ').filter(Boolean);
    const previousWords = normalizeForSimilarity(previous).split(' ').filter(Boolean);
    if (draftWords.length < RESTATEMENT_MIN_WORDS || previousWords.length < RESTATEMENT_MIN_WORDS) return 0;
    const draftShingles = buildShingles(draftWords, RESTATEMENT_SHINGLE_SIZE);
    const previousShingles = buildShingles(previousWords, RESTATEMENT_SHINGLE_SIZE);
    if (!draftShingles.size || !previousShingles.size) return 0;
    let shared = 0;
    draftShingles.forEach(shingle => { if (previousShingles.has(shingle)) shared++; });
    return shared / draftShingles.size;
  }

  function isRestatementOfPrevious(draft, previousAssistantText) {
    return restatementOverlap(draft, previousAssistantText) >= RESTATEMENT_OVERLAP_THRESHOLD;
  }

  function buildRestatementCorrectionPrompt(userPrompt) {
    return `[SYSTEM: Your draft reply repeats your previous message almost word for word. The user has now asked something different: "${String(userPrompt || '').slice(0, 500)}". Answer THAT question specifically. If they asked why you chose one thing over named alternatives, compare it against each alternative they named and give the actual reasons for the ranking. Do not restate your earlier answer, and do not open by repeating your previous conclusion.]`;
  }

  function normalizeStatusIdentityPart(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function inferProcessTarget(text, explicitTarget = '') {
    const explicit = normalizeStatusIdentityPart(explicitTarget);
    if (explicit) return explicit;
    const source = String(text || '');
    const processName = source.match(/\b([A-Za-z][A-Za-z0-9._-]{1,40})\s+(?:process|app|application|service)\s+(?:restart|restarted|restarting|kill|killed|stop|stopped|start|started|launch|launched)\b/i);
    if (processName) {
      const candidate = normalizeStatusIdentityPart(processName[1]);
      if (!new Set(['the', 'this', 'that', 'local', 'named', 'target']).has(candidate)) return candidate;
    }
    const leadingName = source.match(/\b([A-Z][A-Za-z0-9._-]{1,40})\s+(?:successfully\s+|actually\s+)?(?:restarted|killed|terminated|stopped|started|launched)\b/);
    if (leadingName) return normalizeStatusIdentityPart(leadingName[1]);
    const commandTarget = source.match(/\b(?:restart-process|stop-process|start-process|taskkill)\b[^;\r\n]*?(?:-Name|-FilePath|\/IM)?\s*["']?([A-Za-z0-9._-]+)["']?/i)
      || source.match(/\b(?:systemctl|service)\s+(?:restart|stop|start)?\s*["']?([A-Za-z0-9._@-]+)["']?/i);
    if (commandTarget) return normalizeStatusIdentityPart(commandTarget[1].replace(/\.(?:exe|cmd|bat)$/i, ''));
    const executable = source.trim().match(/^(?:&\s*)?["']?(?:[A-Za-z]:[\\/][^"']*[\\/])?([A-Za-z][A-Za-z0-9._-]*)(?:["']|\s|$)/);
    if (!executable) return '';
    const candidate = normalizeStatusIdentityPart(executable[1].replace(/\.(?:exe|cmd|bat)$/i, ''));
    return new Set([
      'the', 'this', 'that', 'a', 'an', 'process',
      'restart', 'restarted', 'kill', 'killed', 'stop', 'stopped', 'start', 'started', 'launch', 'launched'
    ]).has(candidate) ? '' : candidate;
  }

  function structuredStatusIdentity(fact) {
    if (!fact || !fact.kind) return '';
    if (fact.kind === 'pull_request') return `pull_request:${Number(fact.number) || 0}`;
    if (fact.kind === 'task') {
      return `task:${normalizeStatusIdentityPart(fact.taskId || fact.id || fact.title || 'default')}`;
    }
    if (fact.kind === 'process_operation') {
      const target = normalizeStatusIdentityPart(fact.target || '');
      return target
        ? `process_operation:${target}`
        : `process_operation:default:${normalizeStatusIdentityPart(fact.operation || 'unknown')}`;
    }
    if (fact.kind === 'test_result') {
      return `test_result:${normalizeStatusIdentityPart(fact.testId || fact.command || 'default')}`;
    }
    return `${normalizeStatusIdentityPart(fact.kind)}:${normalizeStatusIdentityPart(fact.id || 'default')}`;
  }

  function mergeStructuredStatusFacts(existing = [], incoming = []) {
    const merged = [];
    const identityIndexes = new Map();
    for (const fact of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      if (!fact || typeof fact !== 'object' || !fact.kind) continue;
      const identity = structuredStatusIdentity(fact);
      if (!identity) {
        merged.push(fact);
        continue;
      }
      if (identityIndexes.has(identity)) {
        merged[identityIndexes.get(identity)] = fact;
      } else {
        identityIndexes.set(identity, merged.length);
        merged.push(fact);
      }
    }
    return merged;
  }

  function successfulToolResult(value, context = {}) {
    if (context.failed === true || !value || typeof value !== 'object') return false;
    if (value.success === false || value.error || value.timedOut || value.killed) return false;
    if (value.exitCode !== undefined && Number(value.exitCode) !== 0) return false;
    if (value.code !== undefined && Number(value.code) !== 0) return false;
    return value.success === true || value.exitCode === 0 || value.code === 0;
  }

  function extractStructuredStatusFacts(text, context = {}) {
    const value = text;
    const source = typeof value === 'string' ? value : JSON.stringify(value || {});
    const facts = [];
    const sourceKind = String(context.source || (typeof value === 'string' ? 'user_reported' : 'tool_result'));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const task = value.task && typeof value.task === 'object' ? value.task : value;
      const taskId = String(task.taskId || value.taskId || '');
      const taskState = normalizeTaskState(task.status || task.state || value.status || value.state);
      if (taskId && taskState) {
        facts.push({ kind: 'task', taskId, state: taskState, source: sourceKind });
      }
    }
    const prMatches = [...source.matchAll(/\bPR\s*#(\d+)\b/gi)];
    for (const match of prMatches) {
      const number = Number(match[1]);
      const clause = localClause(source, match.index, match.index + match[0].length, prMatches);
      const mergeability = /\bmergeable\b/i.test(clause) ? 'mergeable' : (/\bconflict(?:ing|s)?\b/i.test(clause) ? 'conflicting' : 'unknown');
      const sync = /\bsynchroni[sz]ed\b|\bup[ -]to[ -]date\b/i.test(clause) ? 'synchronized' : 'unknown';
      const state = hasExplicitMergedState(clause)
        ? 'merged'
        : (/\b(?:is|remains?|currently)\s+(?:still\s+)?(?:open|draft)\b|\bopen\s+(?:pull request|PR)\b/i.test(clause)
            ? 'open'
            : ((hasExplicitNotMerged(clause) || mergeability === 'mergeable' || /\bpushed\b/i.test(clause)) ? 'not_merged' : 'unknown'));
      const hasLifecycleLanguage = /\b(?:open|draft|merged|mergeable|conflicting|synchroni[sz]ed|pushed)\b/i.test(clause);
      if (state !== 'unknown' || mergeability !== 'unknown' || sync !== 'unknown' || hasLifecycleLanguage) {
        facts.push({ kind: 'pull_request', number, state, mergeability, sync, source: sourceKind });
      }
    }
    for (const clause of splitStatusClauses(source)) {
      const operation = processOperationFromText(clause);
      if (operation && hasSimulatedProcessQualifier(clause) && !/\b(?:not|never)\s+(?:mocked|simulated|stubbed|faked|emulated)\b/i.test(clause)) {
        facts.push({
          kind: 'process_operation',
          operation,
          target: inferProcessTarget(clause, context.target),
          outcome: 'simulated',
          source: sourceKind,
          verified: false
        });
      }
    }
    const reportsPassingTests = /\b(?:all\s+|\d+\s+|the\s+(?:full\s+|complete\s+)?)?tests?(?:\s+suite)?\s+(?:(?:have|has)\s+)?passed\b|\b(?:all\s+|the\s+)?tests?(?:\s+suite)?\s+(?:are|were|remain)\s+(?:passing|green)\b|\b(?:CI|checks?|npm test|test suite)\s+(?:is|was|are|were|has|have)?\s*(?:green|passed|succeeded|completed successfully)\b|\bpassed\s+(?:all\s+|the\s+)?tests?\b|\bnpm test\s+(?:exited|returned)\s+(?:with\s+)?(?:code\s+)?0\b/i.test(source);
    if (reportsPassingTests && typeof value === 'string') {
      facts.push({
        kind: 'test_result',
        testId: normalizeStatusIdentityPart(context.testId || 'default'),
        outcome: 'reported_passing',
        source: sourceKind,
        verified: false
      });
    }

    const toolName = String(context.toolName || '');
    const args = context.args && typeof context.args === 'object' ? context.args : {};
    const toolSucceeded = successfulToolResult(value, context);
    const command = String(args.command || context.command || '');
    const explicitOperation = String(context.operation || (value && value.operation) || '');
    const actualOperation = processOperationFromText(explicitOperation)
      || (['kill_command', 'stop_command'].includes(toolName) ? 'kill' : '')
      || (toolName === 'start_command' ? 'start' : '')
      || (['run_command', 'terminal_exec'].includes(toolName) ? processOperationFromText(command) : '');
    if (toolSucceeded && actualOperation && (
      context.operation || (value && value.operation)
      || ['kill_command', 'stop_command', 'start_command'].includes(toolName)
      || /\b(?:restart-process|restart-service|taskkill|stop-process|start-process|systemctl\s+(?:restart|stop|start)|service\s+\S+\s+(?:restart|stop|start))\b/i.test(command)
    )) {
      facts.push({
        kind: 'process_operation',
        operation: actualOperation,
        target: inferProcessTarget(command || source, context.target || (value && value.target) || args.processId),
        outcome: 'verified_success',
        source: 'tool_result',
        verified: true,
        toolName
      });
    }
    const isDirectTestTool = toolName === 'run_tests';
    const isTestCommand = ['run_command', 'terminal_exec'].includes(toolName)
      && /^\s*(?:npm\s+(?:test|run\s+test(?::[\w.-]+)?)|pnpm\s+(?:test|run\s+test)|yarn\s+(?:test|run\s+test)|npx\s+\S*test|pytest\b|python\s+-m\s+pytest\b)/i.test(command);
    const testOutput = String((value && (value.output || value.stdout || value.results)) || '');
    const inconclusiveTestOutput = /\b(?:no tests? (?:configured|found|detected)|no test (?:command|script)|0 tests? (?:found|collected|run)|missing script:?\s*test)\b/i.test(testOutput);
    if ((isDirectTestTool || isTestCommand) && value && typeof value === 'object'
        && (!toolSucceeded || !inconclusiveTestOutput)) {
      facts.push({
        kind: 'test_result',
        testId: normalizeStatusIdentityPart(context.testId || 'default'),
        outcome: toolSucceeded ? 'verified_passing' : 'verified_failing',
        source: 'tool_result',
        verified: true,
        toolName
      });
    }
    return mergeStructuredStatusFacts([], facts);
  }

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clauseMentionsStatusIdentifier(clause, value) {
    const identity = String(value || '').trim();
    return !!identity && new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegex(identity)}(?:$|[^A-Za-z0-9_-])`, 'i').test(clause);
  }

  function explicitTaskReference(clause) {
    const match = String(clause || '').match(/\btask(?:\s+id)?\s*(?:#|:)?\s+([A-Za-z0-9][A-Za-z0-9._-]*)\b/i);
    if (!match) return '';
    const candidate = normalizeStatusIdentityPart(match[1]);
    return new Set([
      'is', 'was', 'has', 'had', 'will', 'can', 'should', 'remains',
      'completed', 'finished', 'done', 'succeeded', 'successful', 'shipped', 'delivered',
      'cancelled', 'canceled', 'aborted', 'stopped', 'pending', 'running', 'active',
      'started', 'underway', 'executing'
    ]).has(candidate)
      ? '' : candidate;
  }

  function taskClauseApplies(clause, status, statuses) {
    const ownId = String(status.taskId || status.id || status.title || '');
    if (clauseMentionsStatusIdentifier(clause, ownId)) return true;
    const explicitReference = explicitTaskReference(clause);
    if (explicitReference && explicitReference !== normalizeStatusIdentityPart(ownId)) return false;
    const otherIds = statuses
      .filter(item => item && item.kind === 'task' && item !== status)
      .map(item => String(item.taskId || item.id || item.title || ''))
      .filter(Boolean);
    if (otherIds.some(id => clauseMentionsStatusIdentifier(clause, id))) return false;
    if (statuses.filter(item => item && item.kind === 'task').length > 1) return false;
    return /\b(?:task|work|job|queue|queued|pending|cancelled|canceled|aborted|stopped|it|this|that)\b/i.test(clause);
  }

  function processClauseApplies(clause, status, statuses) {
    const target = String(status.target || '');
    if (target && clauseMentionsStatusIdentifier(clause, target)) return true;
    const mentionedTarget = inferProcessTarget(clause);
    if (target && mentionedTarget && normalizeStatusIdentityPart(target) !== mentionedTarget) return false;
    const otherTargets = statuses
      .filter(item => item && item.kind === 'process_operation' && item !== status)
      .map(item => String(item.target || ''))
      .filter(Boolean);
    if (otherTargets.some(other => clauseMentionsStatusIdentifier(clause, other))) return false;
    if (statuses.filter(item => item && item.kind === 'process_operation').length > 1) return false;
    const operation = String(status.operation || '');
    return !!operation && (
      new RegExp(`\\b${escapeRegex(operation)}(?:ed|ing)?\\b`, 'i').test(clause)
      || processCompletionPattern(operation).test(clause)
    );
  }

  function testClauseApplies(clause, status, statuses) {
    const testId = String(status.testId || '');
    if (testId && testId !== 'default' && clauseMentionsStatusIdentifier(clause, testId)) return true;
    const otherTestIds = statuses
      .filter(item => item && item.kind === 'test_result' && item !== status)
      .map(item => String(item.testId || ''))
      .filter(id => id && id !== 'default');
    if (otherTestIds.some(id => clauseMentionsStatusIdentifier(clause, id))) return false;
    if (statuses.filter(item => item && item.kind === 'test_result').length > 1) return false;
    return /\b(?:tests?|test suite|suite|npm test|CI|checks?|test results?|results?)\b/i.test(clause);
  }

  function validateStatusResponse(answerText, statuses = []) {
    const answer = String(answerText || '');
    const effectiveStatuses = mergeStructuredStatusFacts([], statuses);
    for (const status of effectiveStatuses) {
      if (status.kind === 'pull_request' && (status.state === 'open' || status.state === 'not_merged')) {
        const claimsMerged = prClausesForNumber(answer, status.number).some(hasExplicitMergedState);
        if (claimsMerged) return { valid: false, reason: 'open_pr_described_as_merged', status };
      }
      const taskState = status.kind === 'task' ? normalizeTaskState(status.state || status.status) : '';
      const taskClauses = status.kind === 'task'
        ? splitStatusClauses(answer).filter(clause => taskClauseApplies(clause, status, effectiveStatuses))
        : [];
      if (status.kind === 'task' && taskState === 'pending' && taskClauses.some(pendingDescribedAsActive)) {
        return { valid: false, reason: 'pending_task_described_as_running', status };
      }
      if (status.kind === 'task' && taskState === 'cancelled' && taskClauses.some(cancelledDescribedAsCompleted)) {
        return { valid: false, reason: 'cancelled_task_described_as_completed', status };
      }
      if (status.kind === 'process_operation' && status.outcome === 'simulated') {
        const completionPattern = processCompletionPattern(status.operation);
        const claimsRealOperation = splitStatusClauses(answer).filter(
          clause => processClauseApplies(clause, status, effectiveStatuses)
        ).some(clause => (
          completionPattern.test(clause)
          && !hasSimulatedProcessQualifier(clause)
          && !isNegatedLifecycleClaim(clause, ['restarted', 'killed', 'terminated', 'stopped', 'started', 'launched'])
        ));
        if (claimsRealOperation) return { valid: false, reason: 'simulated_restart_described_as_real', status };
      }
      if (status.kind === 'test_result' && status.outcome === 'reported_passing'
          && splitStatusClauses(answer)
            .filter(clause => testClauseApplies(clause, status, effectiveStatuses))
            .some(reportedTestsDescribedAsVerified)) {
        return { valid: false, reason: 'reported_tests_described_as_independently_verified', status };
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
    const allStatuses = mergeStructuredStatusFacts([], statuses);
    const guardedPrStatuses = allStatuses.filter(status => status.kind === 'pull_request' && (status.state === 'open' || status.state === 'not_merged'));
    for (const status of allStatuses) {
      if (status.kind === 'pull_request' && (status.state === 'open' || status.state === 'not_merged')) {
        const matches = [...output.matchAll(new RegExp(`\\bPR\\s*#${Number(status.number)}\\b`, 'gi'))];
        const replacements = matches.map(match => {
          const allPrMatches = [...output.matchAll(/\bPR\s*#(\d+)\b/gi)];
          const clause = localClause(output, match.index, match.index + match[0].length, allPrMatches);
          const clauseIndex = output.indexOf(clause, Math.max(0, match.index - clause.length));
          return { clause, clauseIndex };
        }).filter(item => item.clauseIndex >= 0 && hasExplicitMergedState(item.clause)).sort((a, b) => b.clauseIndex - a.clauseIndex);
        for (const replacement of replacements) {
          const corrected = replacement.clause.replace(
            /\b(?:(?:has|have|had)\s+(?:(?:now|just|already|recently|successfully)\s+)*(?:been\s+)?|(?:is|was|were|got)\s+(?:(?:now|just|already|recently|successfully)\s+)*)(?:(?:now|just|already|recently|successfully)\s+)*merged\b|\bmerged\s+(?:successfully|into|on|at)\b/gi,
            status.state === 'open'
              ? `is open${status.mergeability === 'mergeable' ? ' and mergeable' : ''} (not merged)`
              : `is${status.mergeability === 'mergeable' ? ' mergeable and' : ''} not merged`
          );
          output = output.slice(0, replacement.clauseIndex) + corrected + output.slice(replacement.clauseIndex + replacement.clause.length);
        }
        if (!matches.length && guardedPrStatuses.length === 1 && !/\bPR\s*#\d+\b/i.test(output) && hasExplicitMergedState(output)) {
          output = output.replace(
            /\b(?:(?:has|have|had)\s+(?:(?:now|just|already|recently|successfully)\s+)*(?:been\s+)?|(?:is|was|were|got)\s+(?:(?:now|just|already|recently|successfully)\s+)*)(?:(?:now|just|already|recently|successfully)\s+)*merged\b|\bmerged\s+(?:successfully|into|on|at)\b/gi,
            status.state === 'open'
              ? `is open${status.mergeability === 'mergeable' ? ' and mergeable' : ''} (not merged)`
              : `is${status.mergeability === 'mergeable' ? ' mergeable and' : ''} not merged`
          );
        }
      }
      const taskState = status.kind === 'task' ? normalizeTaskState(status.state || status.status) : '';
      if (status.kind === 'task' && taskState === 'pending') {
        output = splitStatusClauses(output).map(clause => (
          taskClauseApplies(clause, status, allStatuses) && pendingDescribedAsActive(clause)
            ? clause.replace(/\b(?:(?:is|has|was)\s+|now\s+|currently\s+)?(?:running|active|started|underway|executing|in[ -]progress|being worked on)\b/i, 'is pending (not running)')
            : clause
        )).join(' ');
      }
      if (status.kind === 'task' && taskState === 'cancelled') {
        output = splitStatusClauses(output).map(clause => (
          taskClauseApplies(clause, status, allStatuses) && cancelledDescribedAsCompleted(clause)
            ? clause.replace(/\b(?:(?:is|has|was|had)\s+)?(?:complete(?:d)?|finished|done|succeeded|successful(?:ly)?|shipped|delivered)(?:\s+successfully)?\b/i, 'is cancelled (not completed)')
            : clause
        )).join(' ');
      }
      if (status.kind === 'process_operation' && status.outcome === 'simulated') {
        const completionPattern = processCompletionPattern(status.operation);
        output = splitStatusClauses(output).map(clause => {
          if (!processClauseApplies(clause, status, allStatuses) || !completionPattern.test(clause) || hasSimulatedProcessQualifier(clause)) return clause;
          return clause.replace(completionPattern, 'was simulated in a test (not an actual process operation)');
        }).join(' ');
      }
      if (status.kind === 'test_result' && status.outcome === 'reported_passing') {
        output = splitStatusClauses(output).map(clause => {
          if (!testClauseApplies(clause, status, allStatuses) || !reportedTestsDescribedAsVerified(clause)) return clause;
          return clause
            .replace(/\b(?:i|we|orion)\s+(?:(?:then|just|subsequently|afterwards)\s+)?(?:(?:went\s+ahead|proceeded)\s+and\s+)?(?:(?:have|has|had|did)\s+)?(?:(?:personally|independently|directly|actually)\s+)?(?:re[ -]?ran|ran|executed|verified|confirmed|validated|checked|tested|reproduced)(?:\s+that)?\b/gi, 'the report states that')
            .replace(/\b(?:my|our|orion['’]?s)\s+(?:own\s+)?(?:test|CI|check)(?:s|\s+suite|\s+run)?\s+(?:passed|succeeded|was|were|is|are)\s*(?:green|successful|passing)?\b/gi, 'the report states that the tests passed')
            .replace(/\b(?:i|we|orion)\s+(?:got|obtained|saw)\s+(?:a\s+)?(?:clean|green|passing|successful)\s+(?:test|CI|check)(?:s|\s+suite|\s+run)?\b/gi, 'the report states that the tests passed');
        }).join(' ');
      }
    }
    return output;
  }

  return {
    isRecallRequest,
    hasExplicitRecallClaim,
    hasRecallUncertaintyDisclosure,
    createResponseBasis,
    recallGroundingScore,
    validateMemoryResponse,
    buildMemoryCorrectionPrompt,
    buildEvidenceBackedRecallFallback,
    extractStructuredStatusFacts,
    structuredStatusIdentity,
    mergeStructuredStatusFacts,
    validateStatusResponse,
    buildStatusCorrectionPrompt,
    enforceStatusFallback,
    isCompletionGateNarration,
    restatementOverlap,
    isRestatementOfPrevious,
    buildRestatementCorrectionPrompt
  };
});
