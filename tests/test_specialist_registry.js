'use strict';

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const registry = require('../specialist-registry');
const taskOrchestration = require('../task-orchestration');
const workspaceResolution = require('../workspace-resolution');
const agent = require('../agent');

test('specialist registry declares prompt, tool policy, workspace, and execution characteristics', t => {
  const coder = registry.requireRole('coder');
  const operator = registry.requireRole('operator');
  t.equal(coder.promptKey, 'coder');
  t.equal(coder.toolPolicy, 'coder');
  t.equal(coder.standaloneWorkspaceRole, 'standalone_specialist');
  t.equal(coder.canEditWorkspace, true);
  t.equal(operator.promptKey, 'operator');
  t.equal(operator.toolPolicy, 'operator');
  t.equal(operator.canControlDesktop, true);
  t.ok(operator.executionSurfaces.includes('desktop'));
  t.throws(() => registry.requireRole('researcher'), error => error && error.code === 'UNKNOWN_SPECIALIST_ROLE');
  t.end();
});

test('an unknown runtime role fails closed instead of inheriting Coder prompt or tools', t => {
  agent.__setActiveConversationModeForTest('researcher');
  t.throws(() => agent.getSystemInstruction(false, '', 'test-model'), /Unknown Orion specialist role/);
  t.throws(() => agent.buildAgentToolDeclarations(), /Unknown Orion specialist role/);
  agent.__setActiveConversationModeForTest('orion');
  t.end();
});

test('new and persisted tasks with unknown specialist roles cannot enter the runnable queue', t => {
  const built = taskOrchestration.buildTaskPacket({
    originalUserMessage: 'Research this topic',
    objective: 'Research this topic',
    targetMode: 'researcher'
  });
  t.equal(built.success, false);
  t.equal(built.needsClarification, true);
  t.match(built.clarification, /registered task role/i);

  const persisted = taskOrchestration.normalizeTaskRecord({
    taskId: 'task_unknown_role',
    title: 'Old future task',
    objective: 'Run future work',
    status: 'pending',
    target: { mode: 'researcher', conversationId: 'future-1' }
  });
  t.equal(persisted.status, 'failed');
  t.equal(persisted.failure.code, 'unknown_specialist_role');
  t.end();
});

test('workspace resolution is specialist-generic and rejects unknown specialist modes', t => {
  const operator = workspaceResolution.classifyWorkspace({
    mode: 'operator',
    workspacePath: 'C:\\Orion\\standalone-workspaces\\screen-task',
    standaloneRoot: 'C:\\Orion\\standalone-workspaces'
  });
  t.equal(operator.kind, workspaceResolution.KINDS.STANDALONE_SPECIALIST);
  const unknown = workspaceResolution.classifyWorkspace({
    mode: 'researcher',
    workspacePath: 'C:\\Projects\\secret'
  });
  t.equal(unknown.kind, workspaceResolution.KINDS.UNRESOLVED);
  t.equal(unknown.source, 'unknown_specialist_role');
  t.end();
});
