'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LIMIT = 8;
const DEFAULT_RELEVANCE_THRESHOLD = 0.3;
const MAX_QUERY_TERMS = 48;
const MAX_EXPANDED_TERMS = 32;
const MAX_EXCERPT_CHARS = 900;

// These terms describe the act of recalling rather than the subject being recalled. Removing
// them keeps a request such as "Do you remember our earlier conversation about intent?" focused
// on "intent" instead of ranking every stored conversation that happens to say "conversation".
const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'did', 'do',
  'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'me', 'my', 'of', 'on', 'or', 'our', 'ours', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'to', 'us', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  'about', 'before', 'conversation', 'conversations', 'discuss', 'discussed', 'discussion',
  'earlier', 'last', 'remember', 'remembered', 'remembering', 'said', 'talk', 'talked', 'talking',
  'time', 'today', 'yesterday', 'system', 'thing', 'things'
]);

const STRONG_RECENCY_PATTERN = /\b(?:earlier|today|yesterday|last\s+(?:time|conversation|session)|recent(?:ly)?|we\s+(?:talked|discussed)|you\s+said\s+earlier|do\s+you\s+remember)\b/i;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePath(value) {
  return String(value || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || '').toLowerCase();
  if (role === 'human') return 'user';
  if (role === 'model' || role === 'ai' || role === 'orion') return 'assistant';
  return role;
}

function tokenizeMeaningfulTerms(value, limit = MAX_QUERY_TERMS) {
  const tokens = String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) || [];
  const unique = [];
  const seen = new Set();
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^[-_']+|[-_']+$/g, '');
    if (token.length < 2 || SEARCH_STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= limit) break;
  }
  return unique;
}

function flattenRecentContext(recentContext) {
  if (!recentContext) return '';
  if (typeof recentContext === 'string') return recentContext;
  if (!Array.isArray(recentContext)) return '';
  return recentContext
    .slice(-8)
    .map(item => typeof item === 'string' ? item : (item && (item.text || item.content || '')))
    .filter(Boolean)
    .join('\n');
}

function currentConversationContext(currentConversation) {
  if (!currentConversation || typeof currentConversation !== 'object') return '';
  const messages = Array.isArray(currentConversation.messages) ? currentConversation.messages : [];
  return [
    currentConversation.title,
    currentConversation.dispatchDiscussionSummary,
    currentConversation.dispatchContextSummary,
    messages.slice(-8).map(message => message && message.text).filter(Boolean).join('\n')
  ].filter(Boolean).join('\n');
}

function buildConversationSearchQuery(options = {}) {
  const query = normalizeWhitespace(options.query || options.userPrompt || '');
  const primaryTerms = tokenizeMeaningfulTerms(query);
  const contextText = [
    flattenRecentContext(options.recentContext),
    currentConversationContext(options.currentConversation),
    options.projectName || ''
  ].filter(Boolean).join('\n');
  const primarySet = new Set(primaryTerms);
  const contextTerms = tokenizeMeaningfulTerms(contextText)
    .filter(term => !primarySet.has(term))
    .slice(0, MAX_QUERY_TERMS);
  return {
    query,
    primaryTerms,
    contextTerms,
    expandedTerms: [],
    queryTerms: [...primaryTerms, ...contextTerms].slice(0, MAX_QUERY_TERMS),
    strongRecencyCue: STRONG_RECENCY_PATTERN.test(query)
  };
}

function timestampMs(value, fallback = 0) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function candidateTimestamp(candidate) {
  return timestampMs(candidate.timestamp || candidate.endedAt || candidate.savedAt || candidate.updatedAt || candidate.createdAt, 0);
}

function candidateSearchText(candidate) {
  return [
    candidate.text,
    candidate.title,
    candidate.projectName,
    path.basename(String(candidate.workspacePath || candidate.projectPath || ''))
  ].filter(Boolean).join(' ');
}

function countTermOccurrences(text, term) {
  if (!text || !term) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(term, index)) !== -1) {
    const before = index === 0 ? '' : text[index - 1];
    const after = text[index + term.length] || '';
    if ((!before || !/[\p{L}\p{N}_-]/u.test(before)) && (!after || !/[\p{L}\p{N}_-]/u.test(after))) count += 1;
    index += Math.max(1, term.length);
  }
  return count;
}

function workspaceMatchScore(candidate, workspacePaths) {
  const requested = (Array.isArray(workspacePaths) ? workspacePaths : [workspacePaths])
    .map(normalizePath)
    .filter(Boolean);
  if (!requested.length) return 0;
  const candidatePaths = [candidate.workspacePath, candidate.projectPath, candidate.dispatchProjectPath]
    .map(normalizePath)
    .filter(Boolean);
  if (candidatePaths.some(candidatePath => requested.some(requestedPath =>
    candidatePath === requestedPath || candidatePath.startsWith(`${requestedPath}/`) || requestedPath.startsWith(`${candidatePath}/`)
  ))) return 1;
  return 0;
}

function calculateRecencyScore(candidate, nowMs, strongRecencyCue) {
  const at = candidateTimestamp(candidate);
  if (!at) return 0;
  const ageDays = Math.max(0, nowMs - at) / 86400000;
  const halfLifeDays = strongRecencyCue ? 3 : 30;
  return 1 / (1 + (ageDays / halfLifeDays));
}

function scoreCandidate(candidate, querySpec, options = {}) {
  const searchText = candidateSearchText(candidate).toLowerCase();
  const tokenCount = Math.max(1, tokenizeMeaningfulTerms(searchText, 1000).length);
  const primaryTerms = querySpec.primaryTerms || [];
  const contextTerms = querySpec.contextTerms || [];
  const expandedTerms = querySpec.expandedTerms || [];
  const primaryMatches = primaryTerms.filter(term => countTermOccurrences(searchText, term) > 0);
  const contextMatches = contextTerms.filter(term => countTermOccurrences(searchText, term) > 0);
  const expandedMatches = expandedTerms.filter(term => countTermOccurrences(searchText, term) > 0);
  const occurrenceTotal = [...primaryMatches, ...contextMatches, ...expandedMatches]
    .reduce((sum, term) => sum + Math.min(3, countTermOccurrences(searchText, term)), 0);

  // Expansion may refine a result, but it may never make an unrelated result relevant by itself.
  // At least one subject term from the user's request, or two meaningful terms from the active
  // exchange, must match before a persisted record can become recall evidence.
  const eligible = primaryTerms.length
    ? (primaryMatches.length > 0 || contextMatches.length >= 2)
    : contextMatches.length >= 1;
  const primaryCoverage = primaryTerms.length ? primaryMatches.length / primaryTerms.length : 0;
  const contextCoverage = contextTerms.length ? contextMatches.length / contextTerms.length : 0;
  const expansionCoverage = expandedTerms.length ? expandedMatches.length / expandedTerms.length : 0;
  const density = Math.min(1, occurrenceTotal / Math.max(4, Math.sqrt(tokenCount) * 2));
  const normalizedQuery = querySpec.query.toLowerCase();
  const exactPhraseBonus = normalizedQuery.length >= 8 && searchText.includes(normalizedQuery) ? 0.08 : 0;
  const lexicalScore = eligible
    ? Math.min(1, (primaryCoverage * 0.66) + (contextCoverage * 0.18) + (expansionCoverage * 0.1) + (density * 0.06) + exactPhraseBonus)
    : 0;
  const recencyScore = calculateRecencyScore(candidate, Number(options.nowMs) || Date.now(), !!querySpec.strongRecencyCue);
  const sourceScore = candidate.sourceKind === 'conversation' ? 1 : 0.55;
  const requestedWorkspaces = options.workspacePaths || options.workspacePath || [];
  const workspaceScore = workspaceMatchScore(candidate, requestedWorkspaces);
  const recencyWeight = querySpec.strongRecencyCue ? 0.22 : 0.08;
  const totalScore = eligible
    ? (lexicalScore * (querySpec.strongRecencyCue ? 0.64 : 0.76))
      + (recencyScore * recencyWeight)
      + (sourceScore * 0.1)
      + (workspaceScore * 0.06)
    : 0;

  return {
    candidate,
    eligible,
    lexicalScore,
    recencyScore,
    sourceScore,
    workspaceScore,
    totalScore,
    matchedTerms: [...new Set([...primaryMatches, ...contextMatches, ...expandedMatches])]
  };
}

function compareRankedEvidence(a, b) {
  return (b.totalScore - a.totalScore)
    || (b.lexicalScore - a.lexicalScore)
    || ((b.candidate.sourceKind === 'conversation' ? 1 : 0) - (a.candidate.sourceKind === 'conversation' ? 1 : 0))
    || (candidateTimestamp(b.candidate) - candidateTimestamp(a.candidate))
    || String(a.candidate.id || '').localeCompare(String(b.candidate.id || ''));
}

function rankConversationEvidence(candidates, querySpecOrOptions = {}, options = {}) {
  const suppliedQuerySpec = querySpecOrOptions && Array.isArray(querySpecOrOptions.primaryTerms);
  const querySpec = suppliedQuerySpec ? querySpecOrOptions : buildConversationSearchQuery(querySpecOrOptions);
  const rankOptions = suppliedQuerySpec ? options : { ...querySpecOrOptions, ...options };
  const threshold = Number.isFinite(Number(rankOptions.relevanceThreshold))
    ? Number(rankOptions.relevanceThreshold)
    : DEFAULT_RELEVANCE_THRESHOLD;
  return (Array.isArray(candidates) ? candidates : [])
    .map(candidate => scoreCandidate(candidate, querySpec, rankOptions))
    .filter(item => item.eligible && item.totalScore >= threshold)
    .sort(compareRankedEvidence);
}

function collectExpansionTerms(initialRanked, querySpec, limit = MAX_EXPANDED_TERMS) {
  const excluded = new Set([...(querySpec.primaryTerms || []), ...(querySpec.contextTerms || [])]);
  const weighted = new Map();
  initialRanked.slice(0, 4).forEach((ranked, index) => {
    const rankWeight = 1 / (index + 1);
    const terms = tokenizeMeaningfulTerms(candidateSearchText(ranked.candidate), 200);
    for (const term of terms) {
      if (excluded.has(term)) continue;
      weighted.set(term, (weighted.get(term) || 0) + rankWeight);
    }
  });
  return [...weighted.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([term]) => term);
}

function buildExcerpt(text, matchedTerms, maxChars = MAX_EXCERPT_CHARS) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) return normalized;
  const lower = normalized.toLowerCase();
  const matchIndexes = (matchedTerms || [])
    .map(term => lower.indexOf(String(term).toLowerCase()))
    .filter(index => index >= 0);
  const firstMatch = matchIndexes.length ? Math.min(...matchIndexes) : 0;
  const start = Math.max(0, firstMatch - Math.floor(maxChars * 0.25));
  const end = Math.min(normalized.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? '…' : ''}`;
}

function evidenceFromRanked(ranked, querySpec) {
  const candidate = ranked.candidate;
  const at = candidateTimestamp(candidate);
  return {
    id: candidate.id,
    sourceKind: candidate.sourceKind,
    provenance: {
      conversationId: candidate.conversationId || null,
      sessionId: candidate.sessionId || null,
      messageId: candidate.messageId || null,
      file: candidate.file || null,
      workspacePath: candidate.workspacePath || candidate.projectPath || null
    },
    role: candidate.role || (candidate.sourceKind === 'session' ? 'summary' : 'unknown'),
    timestamp: at ? new Date(at).toISOString() : null,
    excerpt: buildExcerpt(candidate.text, ranked.matchedTerms),
    scores: {
      lexical: Number(ranked.lexicalScore.toFixed(6)),
      recency: Number(ranked.recencyScore.toFixed(6)),
      source: Number(ranked.sourceScore.toFixed(6)),
      workspace: Number(ranked.workspaceScore.toFixed(6)),
      total: Number(ranked.totalScore.toFixed(6))
    },
    queryTerms: [...querySpec.queryTerms],
    matchedTerms: [...ranked.matchedTerms]
  };
}

function preferExactConversationCandidates(candidates) {
  const exactConversationIds = new Set((candidates || [])
    .filter(candidate => candidate && candidate.sourceKind === 'conversation' && candidate.conversationId)
    .map(candidate => String(candidate.conversationId)));
  return (candidates || []).filter(candidate =>
    !(candidate.sourceKind === 'session' && candidate.sessionId && exactConversationIds.has(String(candidate.sessionId)))
  );
}

function searchConversationEvidence(candidates, options = {}) {
  const querySpec = buildConversationSearchQuery(options);
  if (!querySpec.primaryTerms.length && !querySpec.contextTerms.length) {
    return {
      evidence: [],
      results: [],
      queryTerms: [],
      seedTerms: [],
      expandedTerms: [],
      strongRecencyCue: querySpec.strongRecencyCue,
      scannedCandidates: Array.isArray(candidates) ? candidates.length : 0
    };
  }
  const preferredCandidates = preferExactConversationCandidates(Array.isArray(candidates) ? candidates : []);
  const rankOptions = {
    nowMs: Number(options.nowMs) || Date.now(),
    relevanceThreshold: options.relevanceThreshold,
    workspacePaths: options.workspacePaths || options.workspacePath || []
  };
  const initialRanked = rankConversationEvidence(preferredCandidates, querySpec, rankOptions);
  const expandedTerms = collectExpansionTerms(initialRanked, querySpec, options.maxExpandedTerms);
  const expandedQuery = {
    ...querySpec,
    expandedTerms,
    queryTerms: [...querySpec.primaryTerms, ...querySpec.contextTerms, ...expandedTerms].slice(0, MAX_QUERY_TERMS + MAX_EXPANDED_TERMS)
  };
  const ranked = rankConversationEvidence(preferredCandidates, expandedQuery, rankOptions);
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const evidence = ranked.slice(0, limit).map(item => evidenceFromRanked(item, expandedQuery));
  return {
    evidence,
    results: evidence,
    queryTerms: [...expandedQuery.queryTerms],
    seedTerms: [...querySpec.primaryTerms, ...querySpec.contextTerms],
    expandedTerms,
    strongRecencyCue: querySpec.strongRecencyCue,
    scannedCandidates: preferredCandidates.length
  };
}

function stableMessageId(conversationId, message, index) {
  if (message && (message.id || message.messageId)) return String(message.id || message.messageId);
  return `${conversationId || 'conversation'}-${index}`;
}

function conversationWorkspace(conversation) {
  return conversation && (conversation.dispatchProjectPath || conversation.projectPath || conversation.workspace || '');
}

function candidatesFromConversation(conversation, file = '') {
  if (!conversation || typeof conversation !== 'object') return [];
  const conversationId = String(conversation.id || crypto.createHash('sha1').update(file || JSON.stringify(conversation)).digest('hex').slice(0, 16));
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const workspacePath = conversationWorkspace(conversation);
  const fallbackTimestamp = conversation.updatedAt || conversation.createdAt || 0;
  const candidates = [];
  messages.forEach((message, index) => {
    const role = normalizeRole(message && message.role);
    const text = normalizeWhitespace(message && (message.text || message.content || ''));
    if (!text || text === 'Thinking...' || (role !== 'user' && role !== 'assistant')) return;
    const messageId = stableMessageId(conversationId, message, index);
    candidates.push({
      id: `conversation:${conversationId}:${messageId}`,
      sourceKind: 'conversation',
      conversationId,
      messageId,
      role,
      timestamp: (message && (message.createdAt || message.updatedAt || message.timestamp)) || fallbackTimestamp,
      text,
      title: conversation.title || '',
      workspacePath,
      projectPath: conversation.projectPath || '',
      dispatchProjectPath: conversation.dispatchProjectPath || '',
      file
    });
  });
  return candidates;
}

function candidatesFromSessionRecord(record, file = '', fallbackWorkspacePath = '') {
  if (!record || typeof record !== 'object') return [];
  const sessionId = String(record.sessionId || path.basename(file || 'session'));
  const sections = [
    record.summary,
    ...(Array.isArray(record.decisions) ? record.decisions : []),
    ...(Array.isArray(record.discoveries) ? record.discoveries : []),
    ...(Array.isArray(record.tasksCompleted) ? record.tasksCompleted : []),
    ...(Array.isArray(record.openItems) ? record.openItems : [])
  ].map(normalizeWhitespace).filter(Boolean);
  if (!sections.length) return [];
  return [{
    id: `session:${sessionId}:${record.writeId || path.basename(file || 'record')}`,
    sourceKind: 'session',
    sessionId,
    role: 'summary',
    timestamp: record.endedAt || record.savedAt || record.startedAt || 0,
    savedAt: record.savedAt || '',
    endedAt: record.endedAt || '',
    text: sections.join(' | '),
    workspacePath: record.workspacePath || fallbackWorkspacePath || '',
    file
  }];
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return null;
  }
}

function conversationFilesFromOptions(options) {
  const explicit = Array.isArray(options.conversationFiles) ? options.conversationFiles : [];
  const dirs = [];
  if (options.conversationsDir) dirs.push(options.conversationsDir);
  if (options.userDataPath) dirs.push(path.join(options.userDataPath, 'conversations'));
  const files = [...explicit];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      files.push(...fs.readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => path.join(dir, name)));
    } catch (_) {}
  }
  return [...new Set(files.map(file => path.resolve(file)))];
}

function sessionDirectoriesFromOptions(options) {
  const directories = [];
  if (Array.isArray(options.sessionDirectories)) directories.push(...options.sessionDirectories);
  if (options.sessionsDir) directories.push(options.sessionsDir);
  const workspacePaths = [
    ...(Array.isArray(options.workspacePaths) ? options.workspacePaths : []),
    ...(options.workspacePath ? [options.workspacePath] : [])
  ];
  workspacePaths.filter(Boolean).forEach(workspacePath => directories.push(path.join(workspacePath, '.orion', 'sessions')));
  return [...new Set(directories.filter(Boolean).map(directory => path.resolve(directory)))];
}

function collectPersistedConversationCandidates(options = {}) {
  const candidatesById = new Map();
  const add = candidate => {
    if (!candidate || !candidate.id) return;
    candidatesById.set(candidate.id, candidate);
  };

  // Include the live conversation first. If the same message is also on disk, the live copy wins
  // because it may contain turns that have not completed the debounced persistence flush yet.
  candidatesFromConversation(options.currentConversation, 'current-conversation').forEach(add);

  for (const file of conversationFilesFromOptions(options)) {
    const conversation = readJsonFile(file);
    candidatesFromConversation(conversation, file).forEach(candidate => {
      if (!candidatesById.has(candidate.id)) add(candidate);
    });
  }

  for (const directory of sessionDirectoriesFromOptions(options)) {
    if (!fs.existsSync(directory)) continue;
    let files = [];
    try {
      files = fs.readdirSync(directory).filter(name => name.endsWith('-session.json')).sort();
    } catch (_) {
      continue;
    }
    const fallbackWorkspacePath = path.dirname(path.dirname(directory));
    for (const name of files) {
      const file = path.join(directory, name);
      candidatesFromSessionRecord(readJsonFile(file), file, fallbackWorkspacePath).forEach(add);
    }
  }
  const excludedConversationId = String(options.excludeConversationId || '');
  const excludedMessageIds = new Set((Array.isArray(options.excludeMessageIds) ? options.excludeMessageIds : [])
    .map(value => String(value || ''))
    .filter(Boolean));
  const excludedPrompt = normalizeWhitespace(options.excludeUserPrompt || '');
  return [...candidatesById.values()].filter(candidate => {
    if (!candidate || candidate.sourceKind !== 'conversation') return true;
    if (excludedConversationId && String(candidate.conversationId || '') !== excludedConversationId) return true;
    if (excludedMessageIds.has(String(candidate.messageId || ''))) return false;
    // Older persisted records may predate stable message IDs. In that compatibility case, the
    // active recall question itself is still not evidence merely because it was flushed to disk.
    return !(excludedPrompt && candidate.role === 'user' && normalizeWhitespace(candidate.text) === excludedPrompt);
  });
}

function searchPersistedConversationEvidence(options = {}) {
  const candidates = collectPersistedConversationCandidates(options);
  return searchConversationEvidence(candidates, options);
}

module.exports = {
  SEARCH_STOPWORDS,
  STRONG_RECENCY_PATTERN,
  tokenizeMeaningfulTerms,
  buildConversationSearchQuery,
  rankConversationEvidence,
  searchConversationEvidence,
  searchPersistedConversationEvidence,
  collectPersistedConversationCandidates,
  candidatesFromConversation,
  candidatesFromSessionRecord,
  preferExactConversationCandidates
};
