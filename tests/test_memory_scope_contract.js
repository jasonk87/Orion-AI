'use strict';

// Real bug: remember_fact, remember_preference, and recall_memory all silently defaulted a
// missing scope to 'project'. That meant a fact or preference the model intended as personal
// ("Jason hates keyword-matching hacks") could be written into whichever project's memory
// happened to be active, invisible everywhere else - and a read with no scope specified would
// search only the active project instead of the user's global facts. The fix requires the model
// to judge scope explicitly per fact/preference/query, and treats a missing or invalid scope as
// an error to correct, never as license to guess the active workspace. This mirrors the
// evidenceTarget/inspectionTarget pattern: the model resolves meaning, deterministic code enforces
// the invariant that nothing silently substitutes the active project as a default.

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const agent = require('../agent.js');

function withMockedApi(overrides, fn) {
  const original = global.window.api;
  global.window.api = Object.assign({
    appendGlobalFact: async () => { throw new Error('appendGlobalFact should not have been called'); },
    appendProjectFact: async () => { throw new Error('appendProjectFact should not have been called'); },
    appendGlobalPreference: async () => { throw new Error('appendGlobalPreference should not have been called'); },
    appendProjectPreference: async () => { throw new Error('appendProjectPreference should not have been called'); },
    readGlobalMemory: async () => ({ facts: [], preferences: [] }),
    readProjectMemory: async () => ({ facts: [], preferences: [], decisions: [] })
  }, overrides);
  return fn().finally(() => { global.window.api = original; });
}

// ── remember_fact ───────────────────────────────────────────────────────────

test('remember_fact with no scope is rejected, not silently written to the active project', async t => {
  await withMockedApi({}, async () => {
    try {
      await agent.executeTool('remember_fact', { text: 'Jason hates keyword-matching hacks' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
      t.fail('expected remember_fact to throw when scope is omitted');
    } catch (err) {
      t.match(err.message, /explicit scope/, 'the error explains that scope must be explicit');
      t.match(err.message, /'global' or 'project'/, 'the error names the two valid choices');
    }
  });
  t.end();
});

test('remember_fact with an invalid scope value is rejected the same way', async t => {
  await withMockedApi({}, async () => {
    try {
      await agent.executeTool('remember_fact', { text: 'Some fact', scope: 'workspace' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
      t.fail('expected remember_fact to reject an invalid scope value');
    } catch (err) {
      t.match(err.message, /explicit scope/, 'an invalid scope is treated the same as a missing one');
    }
  });
  t.end();
});

test('remember_fact with scope=global writes global memory, never the active project', async t => {
  let globalCalled = false;
  await withMockedApi({
    appendGlobalFact: async (text) => { globalCalled = true; t.equal(text, 'Jason hates keyword-matching hacks'); return { success: true }; }
  }, async () => {
    const result = await agent.executeTool('remember_fact', { text: 'Jason hates keyword-matching hacks', scope: 'global' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.equal(result.success, true);
  });
  t.ok(globalCalled, 'appendGlobalFact was actually called for an explicit global scope');
  t.end();
});

test('remember_fact with scope=project writes the active project, not global', async t => {
  let projectCalled = false;
  await withMockedApi({
    appendProjectFact: async (wp, text) => { projectCalled = true; t.equal(wp, '/workspace/GRITLIFE'); t.equal(text, 'GRITLIFE uses a custom binary save format'); return { success: true }; }
  }, async () => {
    const result = await agent.executeTool('remember_fact', { text: 'GRITLIFE uses a custom binary save format', scope: 'project' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.equal(result.success, true);
  });
  t.ok(projectCalled, 'appendProjectFact was actually called for an explicit project scope');
  t.end();
});

// ── remember_preference ─────────────────────────────────────────────────────

test('remember_preference with no scope is rejected, not silently written to the active project', async t => {
  await withMockedApi({}, async () => {
    try {
      await agent.executeTool('remember_preference', { text: 'Always confirm before deleting files' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
      t.fail('expected remember_preference to throw when scope is omitted');
    } catch (err) {
      t.match(err.message, /explicit scope/, 'the error explains that scope must be explicit');
    }
  });
  t.end();
});

test('remember_preference with scope=global writes global memory', async t => {
  let globalCalled = false;
  await withMockedApi({
    appendGlobalPreference: async (text) => { globalCalled = true; t.equal(text, 'I hate keyword hacks; use stronger prompts instead'); return { success: true }; }
  }, async () => {
    const result = await agent.executeTool('remember_preference', { text: 'I hate keyword hacks; use stronger prompts instead', scope: 'global' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.equal(result.success, true);
  });
  t.ok(globalCalled, 'appendGlobalPreference was actually called for an explicit global scope');
  t.end();
});

test('remember_preference with scope=project writes the active project', async t => {
  let projectCalled = false;
  await withMockedApi({
    appendProjectPreference: async (wp, text) => { projectCalled = true; t.equal(wp, '/workspace/GRITLIFE'); return { success: true }; }
  }, async () => {
    const result = await agent.executeTool('remember_preference', { text: 'Always use TypeScript interfaces in this repo', scope: 'project' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.equal(result.success, true);
  });
  t.ok(projectCalled, 'appendProjectPreference was actually called for an explicit project scope');
  t.end();
});

// ── recall_memory ────────────────────────────────────────────────────────────

test('recall_memory with no scope is rejected, not silently narrowed to the active project', async t => {
  await withMockedApi({}, async () => {
    try {
      await agent.executeTool('recall_memory', {}, '/workspace/GRITLIFE', {}, { id: 'c1' });
      t.fail('expected recall_memory to throw when scope is omitted');
    } catch (err) {
      t.match(err.message, /explicit scope/, 'the error explains that scope must be explicit');
    }
  });
  t.end();
});

test('recall_memory with an invalid scope value is rejected the same way', async t => {
  await withMockedApi({}, async () => {
    try {
      await agent.executeTool('recall_memory', { scope: 'workspace' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
      t.fail('expected recall_memory to reject an invalid scope value');
    } catch (err) {
      t.match(err.message, /explicit scope/, 'an invalid scope is treated the same as a missing one');
    }
  });
  t.end();
});

test('recall_memory with scope=global reads only global memory, not the active project', async t => {
  let globalCalled = false;
  let projectCalled = false;
  await withMockedApi({
    readGlobalMemory: async () => { globalCalled = true; return { facts: [{ text: 'Jason lives in Kentucky' }] }; },
    readProjectMemory: async () => { projectCalled = true; return { facts: [] }; }
  }, async () => {
    const result = await agent.executeTool('recall_memory', { scope: 'global' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.ok(result.global, 'global memory is returned');
    t.notOk(result.project, 'project memory is absent - scope=global never leaks into project reads');
  });
  t.ok(globalCalled, 'readGlobalMemory was called');
  t.notOk(projectCalled, 'readProjectMemory was never called for an explicit global-scope read');
  t.end();
});

test('recall_memory with scope=project reads only the active project', async t => {
  let globalCalled = false;
  await withMockedApi({
    readGlobalMemory: async () => { globalCalled = true; return { facts: [] }; },
    readProjectMemory: async (wp) => { t.equal(wp, '/workspace/GRITLIFE'); return { facts: [{ text: 'GRITLIFE uses a custom binary save format' }] }; }
  }, async () => {
    const result = await agent.executeTool('recall_memory', { scope: 'project' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.ok(result.project, 'project memory is returned');
    t.notOk(result.global, 'global memory is absent for an explicit project-scope read');
  });
  t.notOk(globalCalled, 'readGlobalMemory was never called for an explicit project-scope read');
  t.end();
});

test('recall_memory with scope=all reads both, so a genuinely uncertain lookup is not starved by the new requirement', async t => {
  await withMockedApi({
    readGlobalMemory: async () => ({ facts: [{ text: 'global fact' }] }),
    readProjectMemory: async () => ({ facts: [{ text: 'project fact' }] })
  }, async () => {
    const result = await agent.executeTool('recall_memory', { scope: 'all' }, '/workspace/GRITLIFE', {}, { id: 'c1' });
    t.ok(result.global, 'global memory is included in an all-scope read');
    t.ok(result.project, 'project memory is included in an all-scope read');
  });
  t.end();
});

// ── the tool declarations actually require scope, so a strict provider enforces this too ─────

test('the remember_fact/remember_preference/recall_memory declarations mark scope as required', t => {
  agent.__setActiveConversationModeForTest('orion');
  const declarations = agent.buildAgentToolDeclarations();
  agent.__setActiveConversationModeForTest('orion');
  const byName = Object.fromEntries(declarations.map(d => [d.name, d]));
  t.ok(byName.remember_fact.parameters.required.includes('scope'), 'remember_fact declares scope as required');
  t.ok(byName.remember_preference.parameters.required.includes('scope'), 'remember_preference declares scope as required');
  t.ok(byName.recall_memory.parameters.required.includes('scope'), 'recall_memory declares scope as required');
  t.end();
});
