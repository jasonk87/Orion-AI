'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const registry = require('../specialist-registry');
const taskOrchestration = require('../task-orchestration');
const workspaceResolution = require('../workspace-resolution');
const agent = require('../agent');

// A fake, never-registered role name for the "unknown role fails closed" tests below. This file
// used to use 'researcher' for that purpose, before Researcher became a real third specialist role
// (handoff-generalization build) — those tests now assert the opposite (that 'researcher' IS a
// fully registered, fully wired role), so the "unknown role" tests need a name that will never be
// real, not a role this codebase has since implemented.
const FAKE_UNREGISTERED_ROLE = 'ghostwriter';

test('specialist registry declares prompt, tool policy, workspace, and execution characteristics', t => {
  const coder = registry.requireRole('coder');
  const operator = registry.requireRole('operator');
  const researcher = registry.requireRole('researcher');
  t.equal(coder.promptKey, 'coder');
  t.equal(coder.toolPolicy, 'coder');
  t.equal(coder.standaloneWorkspaceRole, 'standalone_specialist');
  t.equal(coder.canEditWorkspace, true);
  t.equal(operator.promptKey, 'operator');
  t.equal(operator.toolPolicy, 'operator');
  t.equal(operator.canControlDesktop, true);
  t.ok(operator.executionSurfaces.includes('desktop'));
  t.equal(researcher.promptKey, 'researcher');
  t.equal(researcher.toolPolicy, 'researcher');
  t.equal(researcher.standaloneWorkspaceRole, 'standalone_specialist');
  t.equal(researcher.canEditWorkspace, false, 'Researcher never edits the workspace, same as Operator');
  t.equal(researcher.canControlDesktop, false, 'Researcher never controls the desktop, same as Dispatch');
  t.ok(researcher.executionSurfaces.includes('browser'), 'Researcher gets the read-only browser-worker surface');
  t.notOk(researcher.executionSurfaces.includes('desktop'), 'Researcher does not get desktop execution surface');
  t.throws(() => registry.requireRole(FAKE_UNREGISTERED_ROLE), error => error && error.code === 'UNKNOWN_SPECIALIST_ROLE');
  t.end();
});

test('an unknown runtime role fails closed instead of inheriting Coder prompt or tools', t => {
  agent.__setActiveConversationModeForTest(FAKE_UNREGISTERED_ROLE);
  t.throws(() => agent.getSystemInstruction(false, '', 'test-model'), /Unknown Orion specialist role/);
  t.throws(() => agent.buildAgentToolDeclarations(), /Unknown Orion specialist role/);
  agent.__setActiveConversationModeForTest('orion');
  t.end();
});

test('Researcher is a real registered runtime role with its own prompt and tool surface', t => {
  agent.__setActiveConversationModeForTest('researcher');
  const instruction = agent.getSystemInstruction(false, '', 'test-model');
  t.ok(/investigating and synthesizing research/i.test(instruction), 'Researcher gets its own RESEARCHER_INSTRUCTION, not a fallback prompt');
  t.notOk(/ultimate pair programmer/i.test(instruction), 'Researcher does not silently inherit Coder\'s prompt');
  t.notOk(/operating the user\'s desktop and browser directly/i.test(instruction), 'Researcher does not silently inherit Operator\'s prompt');

  const researcherTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  agent.__setActiveConversationModeForTest('orion');

  t.ok(researcherTools.includes('google_search'), 'Researcher has the core web-search tool');
  t.ok(researcherTools.includes('fetch_web_page'), 'Researcher has the core web-fetch tool');
  t.ok(researcherTools.includes('update_scratchpad'), 'Researcher can keep running notes across a multi-step investigation');
  t.ok(researcherTools.includes('handoff_to_coder'), 'Researcher can hand findings that need code changes to Coder');
  t.ok(researcherTools.includes('handoff_to_operator'), 'Researcher can hand findings that need on-screen verification to Operator');
  t.notOk(researcherTools.includes('handoff_to_researcher'), 'Researcher cannot hand off to itself');
  t.notOk(researcherTools.includes('patch_file'), 'Researcher cannot edit source files');
  t.notOk(researcherTools.includes('write_file'), 'Researcher cannot write source files');
  t.notOk(researcherTools.includes('run_command'), 'Researcher cannot run shell commands');
  t.notOk(researcherTools.includes('computer_action'), 'Researcher cannot control the native desktop');
  t.end();
});

test('new and persisted tasks with unknown specialist roles cannot enter the runnable queue', t => {
  const built = taskOrchestration.buildTaskPacket({
    originalUserMessage: 'Do something undefined',
    objective: 'Do something undefined',
    targetMode: FAKE_UNREGISTERED_ROLE
  });
  t.equal(built.success, false);
  t.equal(built.needsClarification, true);
  t.match(built.clarification, /registered task role/i);
  t.match(built.clarification, /Researcher/, 'the clarification names Researcher as a valid choice now that it is registered');

  const persisted = taskOrchestration.normalizeTaskRecord({
    taskId: 'task_unknown_role',
    title: 'Old future task',
    objective: 'Run future work',
    status: 'pending',
    target: { mode: FAKE_UNREGISTERED_ROLE, conversationId: 'future-1' }
  });
  t.equal(persisted.status, 'failed');
  t.equal(persisted.failure.code, 'unknown_specialist_role');
  t.end();
});

test('a Researcher task builds and persists cleanly, same as Coder/Operator', t => {
  const built = taskOrchestration.buildTaskPacket({
    originalUserMessage: 'Research the current pricing for competitor X',
    objective: 'Research the current pricing for competitor X',
    targetMode: 'researcher'
  });
  t.equal(built.success, true);
  t.equal(built.task.target.mode, 'researcher');

  const persisted = taskOrchestration.normalizeTaskRecord({
    taskId: 'task_researcher_role',
    title: 'Researcher task',
    objective: 'Research something',
    status: 'pending',
    target: { mode: 'researcher', conversationId: 'researcher-1' }
  });
  t.notEqual(persisted.status, 'failed', 'a Researcher task is not force-failed as an unregistered role');
  t.notOk(persisted.failure, 'no unknown_specialist_role failure is recorded for Researcher');
  t.end();
});

test('workspace resolution is specialist-generic and rejects unknown specialist modes', t => {
  const operator = workspaceResolution.classifyWorkspace({
    mode: 'operator',
    workspacePath: 'C:\\Orion\\standalone-workspaces\\screen-task',
    standaloneRoot: 'C:\\Orion\\standalone-workspaces'
  });
  t.equal(operator.kind, workspaceResolution.KINDS.STANDALONE_SPECIALIST);
  const researcher = workspaceResolution.classifyWorkspace({
    mode: 'researcher',
    workspacePath: 'C:\\Orion\\standalone-workspaces\\research-task',
    standaloneRoot: 'C:\\Orion\\standalone-workspaces'
  });
  t.equal(researcher.kind, workspaceResolution.KINDS.STANDALONE_SPECIALIST, 'Researcher resolves as a real specialist workspace kind, not unknown');
  const unknown = workspaceResolution.classifyWorkspace({
    mode: FAKE_UNREGISTERED_ROLE,
    workspacePath: 'C:\\Projects\\secret'
  });
  t.equal(unknown.kind, workspaceResolution.KINDS.UNRESOLVED);
  t.equal(unknown.source, 'unknown_specialist_role');
  t.end();
});
