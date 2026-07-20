'use strict';

const test = require('tape');
const workspace = require('../workspace-resolution');

const SEARCH_ROOT = 'C:\\Users\\Owner\\Desktop\\Projects';
const GRITLIFE = 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE';

test('generic Projects root is classified and described as a search root, not a selected workspace', (t) => {
  const resolution = workspace.classifyWorkspace({
    mode: 'orion',
    searchRoot: SEARCH_ROOT,
    workspacePath: SEARCH_ROOT
  });

  t.equal(resolution.kind, workspace.KINDS.PROJECT_SEARCH_ROOT, 'uses the distinct project-search-root kind');
  t.equal(resolution.path, SEARCH_ROOT, 'retains the configured search location');
  t.equal(resolution.projectPath, '', 'does not invent a selected project path');
  t.equal(
    workspace.describeWorkspace(resolution, 'GRITLIFE'),
    `This conversation is not attached to a specific project yet. I will search the Projects directory for GRITLIFE. Search root: ${SEARCH_ROOT}.`,
    'uses the required honest search-root wording'
  );

  const permission = workspace.canHandoffWorkspace(resolution);
  t.equal(permission.allowed, false, 'cannot hand off the generic root as a project workspace');
  t.ok(/only a search root/i.test(permission.reason), 'explains why a concrete project must be resolved');
  t.end();
});

test('named registered project resolves from the search root to its exact workspace', (t) => {
  const projects = [
    { name: 'OrionAI', path: `${SEARCH_ROOT}\\OrionAI`, source: 'registered_project' },
    { name: 'GRITLIFE', path: GRITLIFE, source: 'registered_project' }
  ];
  const searchRoot = workspace.classifyWorkspace({
    mode: 'orion',
    searchRoot: SEARCH_ROOT,
    workspacePath: SEARCH_ROOT,
    knownProjects: projects
  });
  const match = workspace.findNamedProject('Let us implement the intent system in GRITLIFE.', projects);
  const resolution = workspace.bindResolvedProject(searchRoot, match, 'named_project_resolution');

  t.ok(match, 'finds the named project');
  t.equal(match.path, GRITLIFE, 'selects the exact registered GRITLIFE path');
  t.equal(resolution.kind, workspace.KINDS.ACTIVE_PROJECT, 'binding changes the kind to active project');
  t.equal(resolution.path, GRITLIFE, 'binds the exact project workspace');
  t.equal(resolution.projectPath, GRITLIFE, 'records the exact selected project path');
  t.equal(resolution.projectName, 'GRITLIFE', 'retains the selected project name');
  t.equal(resolution.changed, true, 'reports that a real workspace change occurred');
  t.ok(workspace.describeWorkspace(resolution).includes(GRITLIFE), 'active-workspace wording includes the exact path');
  t.equal(workspace.canHandoffWorkspace(resolution).allowed, true, 'a resolved project can be handed to Coder');
  t.end();
});

test('preselected exact project remains active without pretending a workspace change occurred', (t) => {
  const resolution = workspace.classifyWorkspace({
    mode: 'orion',
    searchRoot: SEARCH_ROOT,
    workspacePath: GRITLIFE,
    projectPath: GRITLIFE,
    knownProjects: [{ name: 'GRITLIFE', path: GRITLIFE }]
  });

  t.equal(resolution.kind, workspace.KINDS.ACTIVE_PROJECT, 'classifies the selected project as active');
  t.equal(resolution.path, GRITLIFE, 'retains its exact path');
  t.equal(resolution.changed, false, 'classification alone does not claim a workspace change');
  t.end();
});

test('standalone Coder and unresolved Dispatch workspaces remain distinct', (t) => {
  const standalonePath = 'C:\\Users\\Owner\\AppData\\Roaming\\OrionAI\\standalone-workspaces\\scratch';
  const standalone = workspace.classifyWorkspace({
    mode: 'coder',
    standaloneRoot: 'C:\\Users\\Owner\\AppData\\Roaming\\OrionAI\\standalone-workspaces',
    workspacePath: standalonePath
  });
  const unresolved = workspace.classifyWorkspace({ mode: 'orion' });

  t.equal(standalone.kind, workspace.KINDS.STANDALONE_CODER, 'identifies a standalone Coder workspace');
  t.equal(standalone.projectPath, '', 'does not represent standalone work as a registered project');
  t.equal(workspace.canHandoffWorkspace(standalone).allowed, true, 'standalone Coder work remains a valid concrete target');
  t.equal(unresolved.kind, workspace.KINDS.UNRESOLVED, 'represents missing workspace information explicitly');
  t.equal(workspace.canHandoffWorkspace(unresolved).allowed, false, 'does not hand off an unresolved workspace');
  t.end();
});
