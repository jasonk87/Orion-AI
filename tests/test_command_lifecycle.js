const test = require('tape');
const proxyquire = require('proxyquire');

const main = proxyquire('../main.js', {
  'electron': {
    app: {
      whenReady: () => ({ then: () => {} }),
      on: () => {}
    },
    BrowserWindow: class {
      constructor() {}
      loadFile() {}
      isDestroyed() { return true; }
      static getAllWindows() { return []; }
      get webContents() { return { send: () => {} }; }
    },
    ipcMain: {
      on: () => {},
      handle: () => {}
    },
    dialog: {}
  }
});

global.mainWindow = { webContents: { send: () => {} } };

test('startCommandSession runs and killProcessTree kills', (t) => {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'ping 127.0.0.1 -n 10' : 'sleep 10';

  const session = main.startCommandSession({
    command: cmd,
    cwd: __dirname,
    processId: 'test_cmd',
    timeoutMs: 10000
  });

  t.equal(session.status, 'running', 'session starts running');
  t.ok(session.id, 'session has id');
  t.equal(session.timeoutMs, 10000, 'session records explicit timeout');

  const child = main.activeProcesses[session.id];
  t.ok(child, 'Real process was spawned and tracked');

  t.ok(main.isDestructiveCommand('rm -rf /'), 'Catches rm -rf /');
  t.ok(main.isDestructiveCommand('rm -rf ./build'), 'Catches rm -rf ./build');
  t.ok(main.isDestructiveCommand('rm -Rf ./build'), 'Catches mixed-case recursive force rm of ./build');
  t.ok(main.isDestructiveCommand('echo hello && rm -rf "$HOME"'), 'Catches chained rm -rf');
  t.ok(main.isDestructiveCommand('git reset --hard'), 'Catches git reset --hard');
  t.ok(main.isDestructiveCommand('echo test | git clean -fdx'), 'Catches git clean -fdx');
  t.ok(main.isDestructiveCommand('del /s /q'), 'Catches del /s /q');
  t.ok(main.isDestructiveCommand('Remove-Item -Recurse -Force'), 'Catches Remove-Item -Recurse');
  t.deepEqual(main.classifyCommandRequest('npm test', { source: 'freeform' }).category, 'freeform', 'Classifies safe freeform command');
  t.equal(main.classifyCommandRequest('rm -rf ./build', { source: 'freeform' }).allowed, false, 'Blocks freeform rm -rf ./build');
  t.equal(main.classifyCommandRequest('echo ok && rm -rf .', { source: 'freeform' }).allowed, false, 'Blocks chained destructive command');
  t.equal(main.classifyCommandRequest('npm start', { source: 'internal' }).category, 'internal', 'Classifies internal command separately');
  t.equal(main.classifyCommandRequest('rm -rf ./build', { source: 'internal' }).allowed, true, 'Allows internal cleanup through executable/args boundary');

  main.killProcessTree(child, (err) => {
    t.error(err, 'killProcessTree executed without error');

    // Give it a moment to actually exit
    setTimeout(() => {
       t.ok(child.killed || child.exitCode !== null || session.status !== 'running', 'Process is marked as killed or closed');
       t.end();

    }, 200);
  });
});

test('Windows command shell selection does not require PowerShell for plain commands', (t) => {
  if (process.platform !== 'win32') {
    t.pass('Windows-only shell selection skipped on non-Windows');
    t.end();
    return;
  }

  const plain = main.getCommandShellSpec('systeminfo');
  t.ok(plain.executable.toLowerCase().endsWith('cmd.exe'), 'plain Windows commands use cmd.exe');
  t.deepEqual(plain.args, ['/d', '/s', '/c'], 'cmd shell uses non-interactive args');

  const powershell = main.getCommandShellSpec('Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory');
  t.ok(powershell.executable.toLowerCase().endsWith('powershell.exe'), 'PowerShell-specific commands still use PowerShell');
  t.ok(powershell.args.includes('-NoProfile'), 'PowerShell shell remains non-profiled');

  t.equal(main.commandLooksPowerShellSpecific('systeminfo'), false, 'systeminfo is not treated as PowerShell-specific');
  t.equal(main.commandLooksPowerShellSpecific('Get-ChildItem | Select-Object Name'), true, 'PowerShell pipelines are detected');
  t.end();
});

test('conversation command matching handles raw and normalized process ids', (t) => {
  const conversationId = 'conv-123-abc';
  t.equal(main.normalizeConversationIdForCommandSession(conversationId), 'conv_123_abc', 'normalizes conversation id for command sessions');
  t.equal(main.commandBelongsToConversation('cmd_conv-123-abc_1700000000000', conversationId), true, 'matches raw conversation ids from run_command');
  t.equal(main.commandBelongsToConversation('cmd_conv_123_abc_server', conversationId), true, 'matches normalized conversation ids from start_command');
  t.equal(main.commandBelongsToConversation('cmd_conv_999_other_server', conversationId), false, 'does not match unrelated command sessions');
  t.end();
});

test('previewWorkspaceApp guards: missing workspace, no entrypoint, and destructive command', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // 1. Missing workspace is rejected before any spawn/capture.
  const missing = await main.previewWorkspaceApp(path.join(os.tmpdir(), 'orion-does-not-exist-' + Date.now()), {});
  t.equal(missing.success, false, 'missing workspace is rejected');

  // 2. An empty workspace with no entrypoint and no python file cannot be previewed.
  const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-preview-empty-'));
  const undetermined = await main.previewWorkspaceApp(emptyWs, {});
  t.equal(undetermined.success, false, 'no resolvable command is rejected');
  t.ok(/determine what to preview/i.test(undetermined.error), 'explains that nothing could be resolved');

  // 3. A destructive explicit command is blocked by the command safety classifier before launch.
  const denied = await main.previewWorkspaceApp(emptyWs, { command: 'rm -rf ./build' });
  t.equal(denied.success, false, 'destructive preview command is blocked');

  t.end();
});

test('computeSourceUpdates flags only files whose bytes differ', (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-dest-'));

  fs.writeFileSync(path.join(src, 'agent.js'), 'IDENTICAL');
  fs.writeFileSync(path.join(dest, 'agent.js'), 'IDENTICAL');     // unchanged
  fs.writeFileSync(path.join(src, 'renderer.js'), 'NEW CODE');
  fs.writeFileSync(path.join(dest, 'renderer.js'), 'OLD CODE');   // differs
  fs.writeFileSync(path.join(src, 'main.js'), 'ONLY IN SOURCE');  // missing in dest

  const changed = main.computeSourceUpdates(src, dest, ['agent.js', 'renderer.js', 'main.js', 'preload.js']);
  t.notOk(changed.includes('agent.js'), 'identical file is not flagged for update');
  t.ok(changed.includes('renderer.js'), 'differing file is flagged for update');
  t.ok(changed.includes('main.js'), 'file missing from the running app is flagged');
  t.notOk(changed.includes('preload.js'), 'file absent from the source is skipped');

  // Guard against self-copy / relaunch loops: identical src and dest yields nothing.
  t.deepEqual(main.computeSourceUpdates(src, src, ['agent.js']), [], 'same source and dest yields no updates');
  t.end();
});

test('packaged updater includes metadata and preserves source file dates', (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-update-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-update-dest-'));
  const sourceDate = new Date('2026-06-27T15:30:00Z');

  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  fs.writeFileSync(path.join(src, 'renderer.js'), 'new renderer');
  fs.writeFileSync(path.join(dest, 'renderer.js'), 'old renderer');
  fs.utimesSync(path.join(src, 'renderer.js'), sourceDate, sourceDate);

  const changed = main.computeSourceUpdates(src, dest, ['package.json', 'renderer.js']);
  t.ok(changed.includes('package.json'), 'package metadata participates in packaged-app update checks');
  t.ok(changed.includes('renderer.js'), 'runtime source file is flagged for update');

  main.syncSourceUpdateFiles(src, dest, ['renderer.js']);
  const copiedStat = fs.statSync(path.join(dest, 'renderer.js'));
  t.equal(fs.readFileSync(path.join(dest, 'renderer.js'), 'utf8'), 'new renderer', 'copies updated runtime file');
  t.equal(Math.round(copiedStat.mtimeMs), Math.round(sourceDate.getTime()), 'preserves source mtime for runtime date display');

  const splashHtml = main.buildUpdateSplashHtml({ changed: ['renderer.js', 'styles.css'] });
  t.ok(splashHtml.includes('Updating local build'), 'update splash explains the blocking maintenance state');
  t.ok(splashHtml.includes('Relaunching Orion'), 'update splash has relaunching state text');
  t.ok(splashHtml.includes('rgba(130,115,244'), 'update splash uses Orion accent styling');
  t.end();
});

test('packaged updater resolves the real source root from packaged resources', (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-real-source-'));
  fs.mkdirSync(path.join(repo, 'dist', 'OrionAI-win32-x64', 'resources', 'app', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'agent.js'), '');
  fs.writeFileSync(path.join(repo, 'renderer.js'), '');
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');

  const packagedLib = path.join(repo, 'dist', 'OrionAI-win32-x64', 'resources', 'app', 'lib');
  t.equal(main.resolveUpdateSourceDir(packagedLib), repo, 'walks from packaged resources/app/lib back to repo root');
  t.end();
});

test('packaged updater tracks all runtime modules required by main process', (t) => {
  const requiredRuntimeFiles = [
    'lib/ipc-ui.js',
    'lib/ipc-skill.js',
    'lib/ipc-memory.js',
    'lib/memory-manager.js',
    'lib/skill-loader.js'
  ];

  for (const file of requiredRuntimeFiles) {
    t.ok(main.AUTO_UPDATE_FILES.includes(file), `auto-update includes ${file}`);
  }
  t.end();
});

test('preview_app launches a persistent session and does NOT auto-close', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-preview-run-'));
  // A long-lived, harmless command stands in for a GUI app that keeps running.
  const longCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 30' : 'sleep 30';

  // Screen capture needs Electron's desktopCapturer (unavailable under the test mock), so capture
  // will fail — but the contract we care about holds regardless: the process is started, tracked,
  // and LEFT RUNNING with a processId so the agent can manage it.
  const result = await main.previewWorkspaceApp(ws, { command: longCmd, warmupMs: 1000, processId: 'preview_test_persist' });

  t.ok(result.processId, 'returns a processId for the launched app');
  t.ok(main.activeProcesses[result.processId], 'the app is still running (NOT auto-closed) after preview returns');

  // The agent stays in control: it can kill the process when done.
  const child = main.activeProcesses[result.processId];
  await new Promise(resolve => main.killProcessTree(child, () => resolve()));
  t.pass('agent can kill the previewed app on its own terms');
  t.end();
});

test('run-command sessions retain captured stdout in main process', (t) => {
  const command = process.platform === 'win32' ? 'echo orion-shell-smoke' : 'printf orion-shell-smoke';
  const session = main.startCommandSession({
    command,
    cwd: __dirname,
    processId: `stdout_smoke_${Date.now()}`,
    timeoutMs: 10000
  });

  const started = Date.now();
  const poll = setInterval(() => {
    if (session.status !== 'running' || Date.now() - started > 5000) {
      clearInterval(poll);
      t.equal(session.status, 'completed', 'command completed');
      t.equal(session.exitCode, 0, 'command exited successfully');
      t.ok(session.stdout.includes('orion-shell-smoke'), 'stdout is captured on the session');
      t.end();
    }
  }, 100);
});

// Regression: the regression test command used to be a single global appConfig field
// (regressionTestCommand), so a command detected/set for one project (e.g. a Python project's
// "python get_models_test.py") silently applied to every other workspace too — including a real
// traced case where it leaked into an unrelated JS/React/Vite project and broke its test run.
// Scoped per workspace path now, the same way the entry point already is.
test('regression test command is scoped per workspace, not a single global value', (t) => {
  const proxyquire = require('proxyquire').noPreserveCache();
  let savedConfig = {};
  const ipcWorkspace = proxyquire('../lib/ipc-workspace.js', {
    electron: { app: { getPath: () => __dirname }, BrowserWindow: class {} },
    './config': {
      readAppConfig: () => savedConfig,
      writeAppConfig: (cfg) => { savedConfig = cfg; },
      atomicWriteFileSync: () => {},
      '@global': true,
      '@noCallThru': true
    }
  });

  const pythonProject = 'C:\\Users\\Owner\\Desktop\\projects\\some-python-project';
  const jsProject = 'C:\\Users\\Owner\\Desktop\\projects\\Mayor-Life';

  t.equal(ipcWorkspace.getWorkspaceTestCommand(savedConfig, jsProject), null, 'no override exists yet for a fresh workspace');

  ipcWorkspace.setWorkspaceTestCommand(savedConfig, pythonProject, { command: 'python get_models_test.py', autoDetected: true });
  t.equal(
    ipcWorkspace.getWorkspaceTestCommand(savedConfig, jsProject),
    null,
    'setting a test command for one workspace does not leak into an unrelated workspace'
  );

  ipcWorkspace.setWorkspaceTestCommand(savedConfig, jsProject, { command: 'npm test', autoDetected: true });
  t.equal(
    ipcWorkspace.getWorkspaceTestCommand(savedConfig, jsProject).command,
    'npm test',
    'each workspace keeps its own independently-detected test command'
  );
  t.equal(
    ipcWorkspace.getWorkspaceTestCommand(savedConfig, pythonProject).command,
    'python get_models_test.py',
    'the other workspace\'s command is unaffected by the second workspace being configured'
  );

  // Path casing/trailing-slash differences must resolve to the same workspace key.
  t.equal(
    ipcWorkspace.getWorkspaceTestCommand(savedConfig, jsProject.toUpperCase()).command,
    'npm test',
    'workspace key normalization is case-insensitive, same as the entry point store'
  );

  t.end();
});
