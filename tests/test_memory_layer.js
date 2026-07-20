'use strict';

const test = require('tape');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import memory-manager directly (no Electron dependency)
const mm = require('../lib/memory-manager');
const conversationMemory = require('../lib/conversation-memory');

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-mem-test-'));
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// ── Global Memory ─────────────────────────────────────────────────────────────

test('Global memory - readGlobalMemory returns default when file absent', (t) => {
  // Patch globalDir to temp location so tests don't touch ~/.orion
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-home-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  try {
    const mem = mm.readGlobalMemory();
    t.equal(mem.version, '1.0', 'version is 1.0');
    t.ok(Array.isArray(mem.facts), 'facts is array');
    t.ok(Array.isArray(mem.people), 'people is array');
    t.ok(typeof mem.user === 'object', 'user is object');
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    cleanup(tmpHome);
  }
  t.end();
});

test('Global memory - appendGlobalFact stores and reads back', (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-home-'));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  try {
    mm.appendGlobalFact('User prefers dark mode', 'preference');
    const mem = mm.readGlobalMemory();
    t.equal(mem.facts.length, 1, 'one fact stored');
    t.equal(mem.facts[0].text, 'User prefers dark mode', 'fact text correct');
    t.equal(mem.facts[0].category, 'preference', 'category correct');
    t.ok(mem.facts[0].addedAt, 'addedAt is set');
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    cleanup(tmpHome);
  }
  t.end();
});

test('Global memory - updateUserProfile merges into user object', (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-home-'));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  try {
    mm.updateUserProfile({ name: 'Jason', timezone: 'UTC-5' });
    const mem = mm.readGlobalMemory();
    t.equal(mem.user.name, 'Jason', 'name set');
    t.equal(mem.user.timezone, 'UTC-5', 'custom field set');
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    cleanup(tmpHome);
  }
  t.end();
});

test('Global memory - writeGlobalMemory merges partial update', (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-home-'));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  try {
    mm.appendGlobalFact('Initial fact', 'test');
    mm.writeGlobalMemory({ people: [{ name: 'Alice' }] });
    const mem = mm.readGlobalMemory();
    t.ok(Array.isArray(mem.facts), 'facts preserved');
    t.equal(mem.people.length, 1, 'people updated');
    t.ok(mem.lastUpdated, 'lastUpdated set');
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    cleanup(tmpHome);
  }
  t.end();
});

test('Pinned global facts remain eligible after normal age filtering', async (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-home-'));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  try {
    const oldDate = '2020-01-01T00:00:00.000Z';
    mm.writeGlobalMemory({
      facts: [
        { text: 'Old transient fact', category: 'general', addedAt: oldDate },
        { text: 'Jason identity fact', category: 'identity', addedAt: oldDate, pinned: true }
      ]
    });
    const ranked = await mm.rankGlobalFactsByQuery('', null, 10);
    t.deepEqual(ranked.map(item => item.text), ['Jason identity fact'], 'only the pinned old fact survives age filtering');
    t.equal(ranked[0].pinned, true, 'pinned state is preserved in recall results');
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    cleanup(tmpHome);
  }
  t.end();
});

// ── Project Memory ────────────────────────────────────────────────────────────

test('Project memory - readProjectMemory returns defaults for missing workspace', (t) => {
  const ws = makeTmpWorkspace();
  try {
    const mem = mm.readProjectMemory(ws);
    t.ok(Array.isArray(mem.facts), 'facts array');
    t.ok(Array.isArray(mem.decisions), 'decisions array');
    t.ok(Array.isArray(mem.preferences), 'preferences array');
    t.equal(mem.lastUpdated, null, 'lastUpdated null');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Project memory - appendProjectFact stores fact', (t) => {
  const ws = makeTmpWorkspace();
  try {
    mm.appendProjectFact(ws, 'Uses ESM imports', 'architecture');
    const mem = mm.readProjectMemory(ws);
    t.equal(mem.facts.length, 1, 'one fact');
    t.equal(mem.facts[0].text, 'Uses ESM imports', 'text correct');
    t.equal(mem.facts[0].category, 'architecture', 'category correct');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Project memory - appendProjectDecision stores decision', (t) => {
  const ws = makeTmpWorkspace();
  try {
    mm.appendProjectDecision(ws, 'Chose SQLite over Postgres', 'Simpler local deployment');
    const mem = mm.readProjectMemory(ws);
    t.equal(mem.decisions.length, 1, 'one decision');
    t.equal(mem.decisions[0].text, 'Chose SQLite over Postgres', 'text correct');
    t.equal(mem.decisions[0].context, 'Simpler local deployment', 'context correct');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Project memory - appendProjectPreference stores preference', (t) => {
  const ws = makeTmpWorkspace();
  try {
    mm.appendProjectPreference(ws, 'Always use async/await not .then()');
    const mem = mm.readProjectMemory(ws);
    t.equal(mem.preferences.length, 1, 'one preference');
    t.equal(mem.preferences[0].text, 'Always use async/await not .then()', 'text correct');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Project memory - backward compat: existing facts-only file gains decisions/preferences fields', (t) => {
  const ws = makeTmpWorkspace();
  const orionDir = path.join(ws, '.orion');
  fs.mkdirSync(orionDir, { recursive: true });
  // Write old-format file (no decisions/preferences)
  fs.writeFileSync(path.join(orionDir, 'memory.json'), JSON.stringify({
    facts: [{ text: 'Legacy fact', addedAt: '2024-01-01T00:00:00.000Z', category: 'general' }],
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }), 'utf8');

  try {
    const mem = mm.readProjectMemory(ws);
    t.equal(mem.facts.length, 1, 'legacy fact preserved');
    t.equal(mem.facts[0].text, 'Legacy fact', 'fact text intact');
    t.ok(Array.isArray(mem.decisions), 'decisions array added');
    t.ok(Array.isArray(mem.preferences), 'preferences array added');

    // Appending a decision shouldn't lose existing facts
    mm.appendProjectDecision(ws, 'New decision', 'ctx');
    const mem2 = mm.readProjectMemory(ws);
    t.equal(mem2.facts.length, 1, 'fact still there after decision append');
    t.equal(mem2.decisions.length, 1, 'decision added');
  } finally {
    cleanup(ws);
  }
  t.end();
});

// ── Session Memory ────────────────────────────────────────────────────────────

test('Session memory - saveSessionMemory writes file and returns record', (t) => {
  const ws = makeTmpWorkspace();
  try {
    const record = mm.saveSessionMemory(ws, {
      summary: 'Built the auth module',
      decisions: ['Used JWT'],
      tasksCompleted: ['Add login endpoint'],
      openItems: ['Add refresh tokens']
    });
    t.ok(record.sessionId, 'sessionId assigned');
    t.equal(record.summary, 'Built the auth module', 'summary correct');
    t.deepEqual(record.decisions, ['Used JWT'], 'decisions correct');
    t.deepEqual(record.openItems, ['Add refresh tokens'], 'openItems correct');
    t.equal(record.workspacePath, ws, 'workspacePath set');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Session memory - listRecentSessions returns sessions newest first', (t) => {
  const ws = makeTmpWorkspace();
  try {
    mm.saveSessionMemory(ws, { summary: 'Session 1' });
    mm.saveSessionMemory(ws, { summary: 'Session 2' });
    mm.saveSessionMemory(ws, { summary: 'Session 3' });

    const sessions = mm.listRecentSessions(ws, 10);
    t.equal(sessions.length, 3, 'three sessions');
    t.equal(sessions[0].summary, 'Session 3', 'newest first');
    t.equal(sessions[2].summary, 'Session 1', 'oldest last');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Session memory - listRecentSessions respects limit', (t) => {
  const ws = makeTmpWorkspace();
  try {
    for (let i = 0; i < 5; i++) {
      mm.saveSessionMemory(ws, { summary: `Session ${i + 1}` });
    }
    const sessions = mm.listRecentSessions(ws, 2);
    t.equal(sessions.length, 2, 'limited to 2');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Session memory - readSession retrieves by sessionId', (t) => {
  const ws = makeTmpWorkspace();
  try {
    const saved = mm.saveSessionMemory(ws, { summary: 'Findable session', discoveries: ['pattern X'] });
    const found = mm.readSession(ws, saved.sessionId);
    t.ok(found, 'session found');
    t.equal(found.summary, 'Findable session', 'summary matches');
    t.deepEqual(found.discoveries, ['pattern X'], 'discoveries match');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Session memory - prunes to 30 sessions', (t) => {
  const ws = makeTmpWorkspace();
  try {
    for (let i = 0; i < 35; i++) {
      mm.saveSessionMemory(ws, { summary: `Session ${i + 1}` });
    }
    const sessions = mm.listRecentSessions(ws, 100);
    t.ok(sessions.length <= 30, `pruned to <=30 (got ${sessions.length})`);
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Session memory - returns empty array for workspace with no sessions', (t) => {
  const ws = makeTmpWorkspace();
  try {
    const sessions = mm.listRecentSessions(ws, 10);
    t.deepEqual(sessions, [], 'empty array');
  } finally {
    cleanup(ws);
  }
  t.end();
});

test('Session memory - same-millisecond writes stay distinct, ordered, and searchable', (t) => {
  const ws = makeTmpWorkspace();
  const originalDateNow = Date.now;
  const frozenNow = Date.parse('2026-07-19T12:34:56.789Z');
  Date.now = () => frozenNow;

  try {
    const first = mm.saveSessionMemory(ws, {
      sessionId: 'rapid-a',
      summary: 'Rapid intent memory alpha about gym subscriptions.'
    });
    const second = mm.saveSessionMemory(ws, {
      sessionId: 'rapid-b',
      summary: 'Rapid intent memory beta about yoga enrollments.'
    });
    const third = mm.saveSessionMemory(ws, {
      sessionId: 'rapid-c',
      summary: 'Rapid intent memory gamma about massage commitments.'
    });

    const sessionDir = path.join(ws, '.orion', 'sessions');
    const files = fs.readdirSync(sessionDir).filter(file => file.endsWith('-session.json')).sort();
    t.equal(files.length, 3, 'all three writes own a file');
    t.equal(new Set(files).size, 3, 'filenames are collision-proof');
    t.equal(new Set([first.writeId, second.writeId, third.writeId]).size, 3, 'records carry unique write provenance');
    t.deepEqual(
      [first.savedAt, second.savedAt, third.savedAt],
      [
        '2026-07-19T12:34:56.789Z',
        '2026-07-19T12:34:56.790Z',
        '2026-07-19T12:34:56.791Z'
      ],
      'one frozen wall-clock millisecond becomes deterministic monotonic save times'
    );

    const recent = mm.listRecentSessions(ws, 10);
    t.deepEqual(recent.map(item => item.sessionId), ['rapid-c', 'rapid-b', 'rapid-a'], 'newest-first order is deterministic');
    t.equal(mm.readSession(ws, 'rapid-a').summary, first.summary, 'the first rapid record remains retrievable');
    t.equal(mm.readSession(ws, 'rapid-b').summary, second.summary, 'the second rapid record remains retrievable');
    t.equal(mm.readSession(ws, 'rapid-c').summary, third.summary, 'the third rapid record remains retrievable');

    const search = conversationMemory.searchPersistedConversationEvidence({
      workspacePath: ws,
      query: 'earlier rapid intent memory',
      nowMs: frozenNow + 1000,
      limit: 10
    });
    t.deepEqual(
      search.evidence.map(item => item.provenance.sessionId),
      ['rapid-c', 'rapid-b', 'rapid-a'],
      'conversation-memory retrieval sees every rapid write in deterministic order'
    );
  } finally {
    Date.now = originalDateNow;
    cleanup(ws);
  }
  t.end();
});
