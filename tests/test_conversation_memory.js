'use strict';

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');

const memory = require('../lib/conversation-memory');
const memoryManager = require('../lib/memory-manager');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function candidate(overrides = {}) {
  return {
    id: overrides.id || 'conversation:default:1',
    sourceKind: overrides.sourceKind || 'conversation',
    conversationId: overrides.conversationId || 'default',
    sessionId: overrides.sessionId || null,
    messageId: overrides.messageId || '1',
    role: overrides.role || 'user',
    timestamp: overrides.timestamp || '2026-07-19T15:00:00.000Z',
    text: overrides.text || '',
    workspacePath: overrides.workspacePath || 'C:\\Projects\\Example',
    title: overrides.title || ''
  };
}

test('conversation recall expands a subject query from the best exact exchange', (t) => {
  const nowMs = Date.parse('2026-07-19T18:00:00.000Z');
  const exact = candidate({
    id: 'conversation:gritlife:12',
    conversationId: 'gritlife',
    text: 'For GRITLIFE, evolve the intent model into paid subscriptions, enrollments, and commitments organized by locations. Body and Physical locations include a gym, yoga, massage, and therapy, alongside classes and other recurring services.'
  });
  const generic = candidate({
    id: 'conversation:generic:2',
    conversationId: 'generic',
    timestamp: '2026-07-19T17:59:00.000Z',
    text: 'GRITLIFE has traits and other general game systems.'
  });

  const result = memory.searchConversationEvidence([generic, exact], {
    query: 'Do you remember our earlier GRITLIFE conversation about the intent system?',
    nowMs,
    limit: 5
  });

  t.equal(result.evidence[0].id, exact.id, 'the exact intent exchange outranks a newer generic project mention');
  for (const term of ['subscriptions', 'enrollments', 'commitments', 'locations', 'body', 'physical', 'gym', 'yoga', 'massage']) {
    t.ok(result.queryTerms.includes(term), `query expansion includes ${term}`);
  }
  t.equal(result.evidence[0].sourceKind, 'conversation', 'evidence is typed as an exact conversation source');
  t.equal(result.evidence[0].role, 'user', 'speaker role is retained');
  t.equal(result.evidence[0].provenance.conversationId, 'gritlife', 'conversation provenance is retained');
  t.ok(result.evidence[0].scores.total > 0, 'component and total scores are exposed');
  const directlyRanked = memory.rankConversationEvidence([generic, exact], {
    query: 'earlier GRITLIFE intent',
    nowMs
  });
  t.equal(directlyRanked[0].candidate.id, exact.id, 'the pure rank export accepts a complete options object');
  t.end();
});

test('strong recall cues give a meaningful recency preference among equally relevant exchanges', (t) => {
  const nowMs = Date.parse('2026-07-19T18:00:00.000Z');
  const old = candidate({
    id: 'conversation:old:1',
    conversationId: 'old',
    timestamp: '2026-05-01T18:00:00.000Z',
    text: 'We discussed the intent model and recurring commitments.'
  });
  const recent = candidate({
    id: 'conversation:recent:1',
    conversationId: 'recent',
    timestamp: '2026-07-19T16:00:00.000Z',
    text: 'We discussed the intent model and recurring commitments.'
  });

  const result = memory.searchConversationEvidence([old, recent], {
    query: 'What did we discuss earlier today about intent?',
    nowMs
  });

  t.equal(result.strongRecencyCue, true, 'temporal recall language activates strong recency weighting');
  t.equal(result.evidence[0].id, recent.id, 'the recent equally relevant exchange ranks first');
  t.ok(result.evidence[0].scores.recency > result.evidence[1].scores.recency, 'the reason is visible in recency scores');
  t.end();
});

test('exact conversational evidence outranks a session summary with the same relevance and age', (t) => {
  const timestamp = '2026-07-19T15:00:00.000Z';
  const exact = candidate({
    id: 'conversation:exact:1',
    conversationId: 'exact',
    timestamp,
    text: 'The intent design uses subscriptions and location enrollments.'
  });
  const summary = candidate({
    id: 'session:summary:1',
    sourceKind: 'session',
    conversationId: null,
    sessionId: 'summary',
    messageId: null,
    role: 'summary',
    timestamp,
    text: 'The intent design uses subscriptions and location enrollments.'
  });

  const result = memory.searchConversationEvidence([summary, exact], {
    query: 'earlier intent subscriptions',
    nowMs: Date.parse('2026-07-19T18:00:00.000Z')
  });

  t.equal(result.evidence[0].id, exact.id, 'exact message evidence wins the source-priority tie');
  t.ok(result.evidence[0].scores.source > result.evidence[1].scores.source, 'source priority is explicit in scores');
  t.end();
});

test('an eligible exact message outranks a newer, more detailed session summary', (t) => {
  const exact = candidate({
    id: 'conversation:exact-weaker:1',
    conversationId: 'exact-weaker',
    timestamp: '2026-07-10T15:00:00.000Z',
    text: 'The intent direction used recurring subscriptions.'
  });
  const summary = candidate({
    id: 'session:stronger-summary:1',
    sourceKind: 'session',
    conversationId: null,
    sessionId: 'stronger-summary',
    messageId: null,
    role: 'summary',
    timestamp: '2026-07-19T17:59:00.000Z',
    text: 'The intent direction used recurring subscriptions and enrollments organized by locations, including gym, yoga, massage, therapy, and classes.'
  });

  const result = memory.searchConversationEvidence([summary, exact], {
    query: 'Do you recall our earlier intent subscription discussion?',
    nowMs: Date.parse('2026-07-19T18:00:00.000Z')
  });

  t.equal(result.evidence[0].id, exact.id, 'typed message evidence stays ahead of a more recent generic summary');
  t.equal(result.evidence[1].id, summary.id, 'the summary remains available as secondary evidence');
  t.end();
});

test('candidate-derived query expansion cannot increase its own retrieval score', (t) => {
  const misleading = candidate({
    id: 'conversation:misleading-intent:1',
    conversationId: 'misleading-intent',
    text: 'The intent discussion focused on character traits, combat colors, stamina streaks, Grind, Connect, and Survive.'
  });
  const options = {
    query: 'Do you recall our earlier intent discussion?',
    nowMs: Date.parse('2026-07-19T18:00:00.000Z'),
    relevanceThreshold: 0
  };
  const initial = memory.rankConversationEvidence([misleading], options);
  const expanded = memory.searchConversationEvidence([misleading], options);

  t.ok(expanded.expandedTerms.includes('traits'), 'the candidate can still contribute useful expansion vocabulary');
  t.equal(
    expanded.evidence[0].scores.total,
    Number(initial[0].totalScore.toFixed(6)),
    'terms sourced only from a candidate do not boost that same candidate'
  );
  t.end();
});

test('unrelated recent material does not cross the relevance threshold', (t) => {
  const result = memory.searchConversationEvidence([
    candidate({ text: 'The renderer changed its color palette and button spacing.' }),
    candidate({ id: 'session:generic:1', sourceKind: 'session', role: 'summary', text: 'A generic project summary about source files and tests.' })
  ], {
    query: 'Do you remember our earlier conversation about enrollment commitments?',
    nowMs: Date.parse('2026-07-19T18:00:00.000Z')
  });

  t.deepEqual(result.evidence, [], 'recency and source bonuses cannot turn zero subject overlap into evidence');
  t.end();
});

test('persisted search scans exact conversation JSON and workspace session records', (t) => {
  const root = makeTmpDir('orion-conversation-memory-');
  const conversationsDir = path.join(root, 'conversations');
  const workspace = path.join(root, 'GRITLIFE');
  fs.mkdirSync(conversationsDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const timestamp = Date.parse('2026-07-19T15:00:00.000Z');

  fs.writeFileSync(path.join(conversationsDir, 'conv-design.json'), JSON.stringify({
    id: 'design',
    title: 'GRITLIFE intent design',
    dispatchProjectPath: workspace,
    updatedAt: timestamp,
    messages: [
      { id: 'user-1', role: 'user', createdAt: timestamp, text: 'Replace intent with recurring location subscriptions for gyms and yoga.' },
      { id: 'assistant-1', role: 'assistant', createdAt: timestamp + 1, text: 'That can use enrollments with costs and benefits.' }
    ]
  }), 'utf8');
  memoryManager.saveSessionMemory(workspace, {
    sessionId: 'secondary-session',
    endedAt: '2026-07-19T15:00:00.000Z',
    summary: 'A session about intent and recurring location subscriptions.'
  });

  try {
    const result = memory.searchPersistedConversationEvidence({
      conversationsDir,
      workspacePaths: [workspace],
      query: 'Do you remember the earlier intent subscription discussion?',
      nowMs: Date.parse('2026-07-19T18:00:00.000Z'),
      limit: 10
    });

    t.ok(result.scannedCandidates >= 3, 'exact messages and the session record were scanned');
    t.equal(result.evidence[0].sourceKind, 'conversation', 'exact persisted conversation evidence ranks first');
    t.equal(result.evidence[0].provenance.file, path.join(conversationsDir, 'conv-design.json'), 'evidence identifies its persisted file');
    t.equal(result.evidence[0].provenance.workspacePath, workspace, 'the selected workspace is carried with the evidence');
    t.ok(result.evidence.some(item => item.sourceKind === 'session' && item.provenance.sessionId === 'secondary-session'), 'session memory remains available as secondary evidence');
  } finally {
    cleanup(root);
  }
  t.end();
});

test('persisted search includes unsaved current-conversation context', (t) => {
  const currentConversation = {
    id: 'live-conversation',
    title: 'Live design discussion',
    dispatchProjectPath: 'C:\\Projects\\GRITLIFE',
    messages: [
      { id: 'live-user', role: 'user', createdAt: 1000, text: 'The physical category should include gym and massage enrollments.' }
    ]
  };
  const result = memory.searchPersistedConversationEvidence({
    currentConversation,
    recentContext: [{ role: 'user', text: 'We are working on the GRITLIFE intent model.' }],
    query: 'Do you remember our earlier intent enrollment conversation?',
    nowMs: 2000
  });

  t.equal(result.evidence.length, 1, 'the live message is searchable before a debounced disk flush');
  t.equal(result.evidence[0].provenance.conversationId, 'live-conversation', 'live provenance is stable');
  t.equal(result.evidence[0].provenance.file, 'current-conversation', 'the source is identified as current in-memory state');
  t.end();
});

test('the active recall question cannot qualify as its own conversation evidence', (t) => {
  const prompt = 'Do you remember our earlier conversation about the intent system?';
  const currentConversation = {
    id: 'current-recall',
    title: 'Current chat',
    messages: [{
      id: 'current-question',
      role: 'user',
      text: prompt,
      createdAt: Date.now()
    }]
  };
  const result = memory.searchPersistedConversationEvidence({
    query: prompt,
    currentConversation,
    excludeConversationId: currentConversation.id,
    excludeMessageIds: ['current-question'],
    excludeUserPrompt: prompt,
    limit: 8
  });

  t.equal(result.evidence.length, 0, 'the current question is excluded rather than licensing an I-remember claim');
  t.end();
});

test('recent context cannot make a candidate relevant without the recalled subject', (t) => {
  const result = memory.searchConversationEvidence([{
    id: 'generic-gritlife',
    sourceKind: 'conversation',
    conversationId: 'generic',
    messageId: 'generic-1',
    role: 'assistant',
    timestamp: Date.now(),
    text: 'GRITLIFE currently uses Grind, Connect, and Survive traits.'
  }], {
    query: 'Do you remember our earlier conversation about the intent system?',
    recentContext: 'GRITLIFE Grind Connect Survive traits',
    limit: 8
  });

  t.equal(result.evidence.length, 0, 'context-only overlap cannot substitute for an intent subject match');
  t.end();
});
