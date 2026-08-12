const test = require('tape');
const fs = require('fs');
const path = require('path');

// Phase 3 piece 2 of the Operator architecture plan: conversation.mode gains 'operator' as a real
// third value alongside 'coder' and 'orion'. This file characterizes the mode-resolution call
// sites that a strict two-value assumption would silently misclassify, and pins the fix.
//
// Written before the agent.js edits land (per the same before/after discipline used for every
// earlier phase): every assertion below describes the CORRECT three-way behavior. Regression
// assertions (existing 'coder'/'orion' behavior) already pass against the pre-fix code; the new
// 'operator' assertions are the ones expected to fail until the fix lands. Running this file both
// before and after the edit is what proves the fix actually changed the right thing and nothing
// else.
const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
const workspaceResolutionJs = fs.readFileSync(path.join(__dirname, '../workspace-resolution.js'), 'utf8').replace(/\r\n/g, '\n');
global.window = {};
global.fetch = async () => ({ ok: false });
const agent = require('../agent.js');
const WorkspaceResolution = require('../workspace-resolution.js');

test('resolveConversationWorkspace resolves an operator conversation like Coder, independent of stale global run state', (t) => {
  const oldGetCurrentWorkspace = global.window.getCurrentWorkspace;
  global.window.getCurrentWorkspace = () => 'C:\\Desktop\\Fallback';

  // Worst case for the fragile fallback chain: the module-level activeConversationMode happens to
  // be 'orion' (e.g. left over from the most recent Dispatch turn in this process) at the moment an
  // Operator conversation's workspace is resolved. A conversation-object-only conclusion must not
  // depend on this global.
  agent.__setActiveConversationModeForTest('orion');
  try {
    t.equal(
      agent.resolveConversationWorkspace({ mode: 'operator', workspace: 'C:\\Ops\\Workspace' }),
      'C:\\Ops\\Workspace',
      'an operator conversation keeps its own workspace rather than falling back to the Dispatch search root'
    );
    t.equal(
      agent.resolveConversationWorkspace({ mode: 'operator', projectPath: 'C:\\Ops\\Project' }),
      'C:\\Ops\\Project',
      'projectPath is a first-class workspace fallback for operator conversations too'
    );
  } finally {
    global.window.getCurrentWorkspace = oldGetCurrentWorkspace;
    agent.__setActiveConversationModeForTest('orion');
  }

  // Regression: existing coder/orion behavior is unchanged by the added recognition branch.
  global.window.getCurrentWorkspace = () => 'C:\\Desktop\\Fallback';
  try {
    t.equal(
      agent.resolveConversationWorkspace({ mode: 'coder', projectPath: 'C:\\Projects\\OrionTarget' }),
      'C:\\Projects\\OrionTarget',
      'coder conversations are unaffected'
    );
    t.equal(
      agent.resolveConversationWorkspace({ mode: 'orion', workspace: 'C:\\Users\\Owner\\Desktop\\Projects\\GritLife' }),
      'C:\\Users\\Owner\\Desktop\\Projects\\GritLife',
      'Dispatch conversations are unaffected'
    );
  } finally {
    global.window.getCurrentWorkspace = oldGetCurrentWorkspace;
  }
  t.end();
});

test('get_workspace_info classifies an operator workspace the way Coder is classified, not the way Dispatch is', async (t) => {
  const oldApi = global.window.api;
  global.window.api = { getWorkspaceEntrypoint: async () => ({ success: false }) };
  try {
    // A workspace path with no registered project and no search-root match: Coder-mode
    // classification treats this as a real standalone specialist workspace; Dispatch-mode
    // classification treats the identical path as UNRESOLVED, because Dispatch expects a known
    // project or its own search root, not an arbitrary directory. Operator does real workspace-
    // bound artifact work like Coder, so it must get the Coder-style classification.
    const workspacePath = 'C:\\Some\\Random\\StandaloneFolder';

    const operatorResult = await agent.executeTool(
      'get_workspace_info', {}, workspacePath, {},
      { id: 'conv_op', mode: 'operator', projectPath: '' }, {}
    );
    const coderResult = await agent.executeTool(
      'get_workspace_info', {}, workspacePath, {},
      { id: 'conv_coder', mode: 'coder', projectPath: '' }, {}
    );
    const dispatchResult = await agent.executeTool(
      'get_workspace_info', {}, workspacePath, {},
      { id: 'conv_dispatch', mode: 'orion', projectPath: '' }, {}
    );

    t.equal(operatorResult.workspaceKind, 'standalone_specialist', 'operator gets role-neutral standalone classification');
    t.equal(operatorResult.workspaceKind, coderResult.workspaceKind, 'operator and coder classify the same workspace identically');
    t.notEqual(operatorResult.workspaceKind, dispatchResult.workspaceKind, 'operator classification differs from Dispatch for the same path, proving the mode actually mattered');
  } finally {
    global.window.api = oldApi;
  }
  t.end();
});

test('computer_action is available to operator conversations, not just Coder', async (t) => {
  const dispatchAttempt = await agent.executeTool(
    'computer_action', { action: 'screenshot' }, 'C:\\workspace', {},
    { id: 'conv_dispatch', mode: 'orion' }, {}
  ).catch(err => err);
  t.ok(dispatchAttempt instanceof Error && /Dispatch must hand executable desktop work/.test(dispatchAttempt.message),
    'Dispatch is still rejected by the role gate before any snapshot-freshness check runs');

  const operatorAttempt = await agent.executeTool(
    'computer_action', { action: 'screenshot' }, 'C:\\workspace', {},
    { id: 'conv_operator', mode: 'operator' }, {}
  ).catch(err => err);
  t.ok(operatorAttempt instanceof Error, 'operator still fails with no fresh capture in this run');
  t.notOk(/Dispatch must hand executable desktop work/.test(operatorAttempt.message),
    'operator is not rejected by the role gate - it fails later, on the legitimate freshness check');
  t.ok(/fresh capture_screen/.test(operatorAttempt.message),
    'operator reaches the same freshness contract Coder is held to');
  t.end();
});

test('change_workspace binds projectPath for an operator conversation the same way it does for Coder', async (t) => {
  const oldApi = global.window.api;
  global.window.api = { listFiles: async () => ([]) };
  try {
    const operatorConversation = { id: 'conv_op_change', mode: 'operator', workspace: '' };
    await agent.executeTool('change_workspace', { path: 'C:\\Ops\\NewWorkspace' }, 'C:\\old', {}, operatorConversation, {});
    t.equal(operatorConversation.projectPath, 'C:\\Ops\\NewWorkspace',
      'operator conversations bind projectPath on change_workspace, matching Coder - previously neither the coder nor the orion branch fired for operator, leaving projectPath unset');

    const coderConversation = { id: 'conv_coder_change', mode: 'coder', workspace: '' };
    await agent.executeTool('change_workspace', { path: 'C:\\Ops\\NewWorkspace' }, 'C:\\old', {}, coderConversation, {});
    t.equal(coderConversation.projectPath, operatorConversation.projectPath,
      'operator and coder end up with identical projectPath binding behavior');
  } finally {
    global.window.api = oldApi;
  }
  t.end();
});

test('WorkspaceResolution.classifyWorkspace treats operator mode as coder-equivalent at the shared-module level', (t) => {
  // Guards any current or future call site that passes conversation.mode straight through without
  // its own coder-or-operator ternary (e.g. recall_memory's `mode: conversation && conversation.mode`).
  // This is the single source of truth other than the call-site-level fixes above.
  const workspacePath = 'C:\\Some\\Random\\StandaloneFolder';
  const operatorClassification = WorkspaceResolution.classifyWorkspace({ mode: 'operator', workspacePath });
  const coderClassification = WorkspaceResolution.classifyWorkspace({ mode: 'coder', workspacePath });
  t.equal(operatorClassification.kind, coderClassification.kind, 'operator mode classifies identically to coder mode');
  t.equal(operatorClassification.kind, WorkspaceResolution.KINDS.STANDALONE_SPECIALIST, 'operator gets a real standalone classification, not the orion fallback');
  t.end();
});

test('source-level sanity: runtime and workspace routing use the specialist registry', (t) => {
  t.ok(agentJs.includes('OrionSpecialistRegistry.requireRole'),
    'the agent runtime validates specialist roles through the registry');
  t.ok(workspaceResolutionJs.includes('SpecialistRegistry.has'),
    'the shared workspace classifier recognizes specialists through the registry');
  t.end();
});
