// Phase 3 piece 2c of the Operator architecture plan: renderer.js's conversationMode() gains
// 'operator' as a real third value, and the ~54 call sites that read conv.mode/conversationMode()
// were individually audited. Most were already correct (Dispatch-specific or Coder-owned-task-
// specific checks that exclude a third value by construction, or generic checks unrelated to mode).
// This file regression-tests the handful that genuinely needed a fix, run against the real
// renderer via the jsdom harness per this file's sibling test_renderer_behavior.js convention.
const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');
const workspaceResolution = require('../workspace-resolution');

test('conversationMode recognizes an explicitly-tagged operator conversation', (t) => {
  const { win } = loadRenderer({ t });
  t.equal(win.conversationMode({ mode: 'operator' }), 'operator', 'operator is returned directly, not guessed from projectPath');
  t.equal(win.conversationMode({ mode: 'operator', projectPath: 'C:\\Ops\\Project' }), 'operator', 'an explicit operator tag wins even when projectPath is also present');
  t.equal(win.conversationMode({ mode: 'coder' }), 'coder', 'coder is unaffected');
  t.equal(win.conversationMode({ mode: 'orion' }), 'orion', 'Dispatch is unaffected');
  t.equal(win.conversationMode({ projectPath: 'C:\\Legacy\\Project' }), 'coder', 'the untagged legacy fallback is unaffected');
  t.equal(win.conversationMode(null), 'orion', 'a missing conversation still defaults to Dispatch');
  t.end();
});

test('migrateConversations does not overwrite an operator conversation on every app load', (t) => {
  // This was a real bug, not a hypothetical: migrateConversations runs on every load (it is not
  // gated behind the one-time orionCoderModeBackfillDone flag the way the block above it is), and
  // its hasExplicitMode check previously recognized only 'orion'/'coder'. An operator conversation
  // would have been treated as never having an explicit mode and rewritten back to 'coder' or
  // 'orion' based on projectPath presence, every single time the app started.
  const operatorConv = { id: 'conv_op', mode: 'operator', title: 'Operator task', messages: [], workspace: 'C:\\Ops\\Workspace' };
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [operatorConv], projects: [] }
  });
  win.localStorage.setItem('orionCoderModeBackfillDone', 'true');
  win.migrateConversations();
  const reread = read('conversations')[0];
  t.equal(reread.mode, 'operator', 'operator mode survives the per-load migration pass unchanged');
  t.end();
});

test('migrateConversations still infers coder/orion for legacy conversations with no explicit mode', (t) => {
  const legacyProjectConv = { id: 'conv_legacy_project', projectPath: 'C:\\Legacy\\Project', title: 'Legacy', messages: [], workspace: '' };
  const legacyStandaloneConv = { id: 'conv_legacy_standalone', title: 'Legacy standalone', messages: [], workspace: '' };
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [legacyProjectConv, legacyStandaloneConv], projects: [] }
  });
  win.localStorage.setItem('orionCoderModeBackfillDone', 'true');
  win.migrateConversations();
  const reread = read('conversations');
  t.equal(reread.find(c => c.id === 'conv_legacy_project').mode, 'coder', 'a legacy conversation with a project path still infers coder');
  t.equal(reread.find(c => c.id === 'conv_legacy_standalone').mode, 'orion', 'a legacy conversation with nothing bound still infers Dispatch, unchanged');
  t.end();
});

test('migrateConversations binds a matching project path for an operator conversation the same way it does for Coder', (t) => {
  const projectPath = 'C:\\Users\\Owner\\Desktop\\Projects\\GritLife';
  const operatorConv = {
    id: 'conv_op_bind', mode: 'operator', title: 'Operator task', messages: [],
    workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GritLife\\subfolder', projectPath: ''
  };
  const { win, read } = loadRenderer({
    t,
    set: { conversations: [operatorConv], projects: [projectPath] }
  });
  win.localStorage.setItem('orionCoderModeBackfillDone', 'true');
  win.migrateConversations();
  const reread = read('conversations')[0];
  t.equal(reread.projectPath, projectPath, 'operator conversations get the same workspace-to-project binding Coder conversations get');
  t.end();
});

test('getConversationRunWorkspace resolves an operator conversation like Coder', (t) => {
  const { win } = loadRenderer({ t });
  t.equal(
    win.getConversationRunWorkspace({ mode: 'operator', workspace: 'C:\\Ops\\Workspace' }),
    'C:\\Ops\\Workspace',
    'operator keeps its own workspace, the same as Coder would'
  );
  t.equal(
    win.getConversationRunWorkspace({ mode: 'coder', workspace: 'C:\\Ops\\Workspace' }),
    win.getConversationRunWorkspace({ mode: 'operator', workspace: 'C:\\Ops\\Workspace' }),
    'operator and coder resolve identically for the same conversation shape'
  );
  t.end();
});

test('structuredWorkspaceForConversation classifies an operator workspace like Coder, not like Dispatch', (t) => {
  const { win } = loadRenderer({
    t,
    globals: { OrionWorkspaceResolution: workspaceResolution },
    set: { projects: [] }
  });
  const workspacePath = 'C:\\Some\\Random\\StandaloneFolder';
  const operatorResult = win.structuredWorkspaceForConversation({ mode: 'operator', workspace: workspacePath });
  const coderResult = win.structuredWorkspaceForConversation({ mode: 'coder', workspace: workspacePath });
  const dispatchResult = win.structuredWorkspaceForConversation({ mode: 'orion', workspace: workspacePath });
  t.equal(operatorResult.role, coderResult.role, 'operator and coder classify the same workspace identically');
  t.notEqual(operatorResult.role, dispatchResult.role, 'operator differs from Dispatch for the same path');
  t.end();
});

// Nine hand-written `coder || operator || researcher` chains in renderer.js were replaced by one
// registry-driven predicate. This is the same bug class that let Researcher be a registered role
// the semantic router could not route to: every one of those chains would have needed a manual
// edit for a fourth specialist, and missing one fails silently as a misclassified conversation.
test('specialist recognition in the renderer comes from the registry, not a role list', (t) => {
  const registry = require('../specialist-registry');
  const { win } = loadRenderer({ t });

  registry.list().forEach(definition => {
    t.ok(win.isSpecialistMode(definition.role), definition.role + ' is recognized as a specialist');
    t.equal(win.conversationMode({ mode: definition.role }), definition.role,
      definition.role + ' conversations classify as themselves, not as Dispatch');
    t.ok(win.isKnownConversationMode(definition.role), definition.role + ' is a known mode');
  });

  t.notOk(win.isSpecialistMode('orion'), 'Dispatch is not a specialist');
  t.ok(win.isKnownConversationMode('orion'), 'but it is a known conversation mode');
  t.notOk(win.isSpecialistMode('not-a-role'), 'an unregistered role is not a specialist');
  t.notOk(win.isKnownConversationMode('not-a-role'), 'nor a known mode');
  t.notOk(win.isSpecialistMode(''), 'an empty mode is not a specialist');
  t.end();
});

test('renderer specialist recognition survives the registry script failing to load', (t) => {
  // renderer.js is a plain <script> with no require. If specialist-registry.js failed to evaluate,
  // a registry-only implementation would classify EVERY conversation as Dispatch - far worse than
  // the hand-written chains it replaced. Same fallback shape AGENT_ROLE_DISPLAY_NAMES already uses.
  const { win } = loadRenderer({ t });
  win.OrionSpecialistRegistry = undefined;
  ['coder', 'operator', 'researcher'].forEach(role => {
    t.ok(win.isSpecialistMode(role), role + ' is still recognized without the registry');
    t.equal(win.conversationMode({ mode: role }), role, role + ' still classifies correctly');
  });
  t.notOk(win.isSpecialistMode('orion'), 'Dispatch is still not a specialist in the fallback');
  t.end();
});
