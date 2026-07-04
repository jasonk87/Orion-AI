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

// Regression: cmd.exe does not treat `;` as a statement separator — `set PYTHONPATH=%PYTHONPATH%;.
// ; python foo.py` gets swallowed whole into the `set` command's value under cmd.exe, so `python
// foo.py` never runs at all, and cmd.exe reports this as a silent success (exit 0, empty output)
// with no indication anything went wrong. A transcript showed Orion run exactly this command twice
// and move on as if it had worked. Unquoted `;` must route to PowerShell instead, where it either
// executes as intended or fails with a real, diagnosable parse error.
test('commands with a real unquoted semicolon route to PowerShell instead of silently no-opping under cmd.exe', (t) => {
  if (process.platform !== 'win32') {
    t.pass('Windows-only shell selection skipped on non-Windows');
    t.end();
    return;
  }

  t.equal(main.hasUnquotedSemicolon('echo first; echo second'), true, 'a bare semicolon between statements is detected');
  t.equal(main.hasUnquotedSemicolon('set PYTHONPATH=%PYTHONPATH%;. ; python foo.py'), true, 'the exact command from the transcript is detected');
  t.equal(main.hasUnquotedSemicolon(`python -c "from x import y; print(y('literal'))"`), false, 'a semicolon inside a double-quoted argument is not a statement separator');
  t.equal(main.hasUnquotedSemicolon(`echo 'a;b'`), false, 'a semicolon inside a single-quoted argument is not a statement separator');
  t.equal(main.hasUnquotedSemicolon('echo hello'), false, 'a command with no semicolon at all is unaffected');

  const chained = main.getCommandShellSpec('set PYTHONPATH=%PYTHONPATH%;. ; python foo.py');
  t.ok(chained.executable.toLowerCase().endsWith('powershell.exe'), 'a semicolon-chained command now routes to PowerShell instead of cmd.exe');

  const pythonDashC = main.getCommandShellSpec(`python -c "from x import y; print(y('literal'))"`);
  t.ok(pythonDashC.executable.toLowerCase().endsWith('cmd.exe'), 'a quoted semicolon inside python -c still stays on cmd.exe, unaffected by this change');
  t.end();
});

// Regression: a real auth page had a tab button labeled "Register" (outside any <form>, just
// toggling which form is visible) sitting right next to that form's actual submit button, also
// labeled "Register". click_element{text:"Register"} always picked whichever matched first in DOM
// order — the tab, which came first in the markup — so the registration form was never actually
// submitted, with no error to indicate anything went wrong.
test('pickBestClickCandidate prefers a form submit button over a same-labeled tab/toggle button', (t) => {
  const candidates = [
    { text: 'Login', insideForm: false },
    { text: 'Register', insideForm: false }, // the auth-tab button — appears first in DOM order
    { text: 'Register', insideForm: true }   // the form's actual submit button
  ];
  const best = main.pickBestClickCandidate(candidates, 'Register');
  t.ok(best && best.insideForm === true, 'the in-form submit button is chosen over the earlier same-labeled tab button');

  const onlyOneMatch = main.pickBestClickCandidate([{ text: 'Sign In', insideForm: true }], 'sign in');
  t.ok(onlyOneMatch && onlyOneMatch.insideForm === true, 'an unambiguous single match still works as before');

  const noMatch = main.pickBestClickCandidate([{ text: 'Cancel', insideForm: false }], 'Submit');
  t.equal(noMatch, null, 'no candidate is returned when nothing matches the requested text');

  const exactPreferred = main.pickBestClickCandidate(
    [{ text: 'Register now', insideForm: false }, { text: 'Register', insideForm: false }],
    'Register'
  );
  t.equal(exactPreferred.text, 'Register', 'an exact text match is preferred over a longer partial match, even outside a form');
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

// Regression: launch_workspace_app never tracked or killed a workspace's previously-launched
// process before starting a new one. Re-running "run this program" (after a hard stop, a retry,
// or just asking again) piled up untracked processes with no way for Orion to find or kill them —
// exactly the "starting new programs but not ending the old ones" behavior a user reported.
test('relaunching a workspace app kills the previously tracked instance first', (t) => {
  const os = require('os');
  const path = require('path');
  const ws = require('fs').mkdtempSync(path.join(os.tmpdir(), 'orion-relaunch-'));

  const first = main.spawnInternalCommand(ws, process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  t.ok(first.pid, 'first process has a pid');
  t.equal(main.launchedWorkspaceProcesses.get(main.workspaceKey(ws)), first.pid, 'first process is tracked for this workspace');

  const started = Date.now();
  const poll = setInterval(() => {
    let firstStillAlive = true;
    try { process.kill(first.pid, 0); } catch (_) { firstStillAlive = false; }

    if (!firstStillAlive || Date.now() - started > 5000) {
      clearInterval(poll);
      t.notOk(firstStillAlive, 'the first process is no longer running after the relaunch killed it');
      try { process.kill(second.pid, 'SIGKILL'); } catch (_) {}
      t.end();
    }
  }, 100);

  // Relaunching for the SAME workspace should kill `first` before starting `second`.
  const second = main.spawnInternalCommand(ws, process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  t.ok(second.pid, 'second process has a pid');
  t.notEqual(second.pid, first.pid, 'the second process is a genuinely new process');
  t.equal(main.launchedWorkspaceProcesses.get(main.workspaceKey(ws)), second.pid, 'tracking now points at the second process');
});

test('killTrackedWorkspaceProcess is a no-op when nothing is tracked, and clears its own entry after killing', (t) => {
  const os = require('os');
  const path = require('path');
  const ws = require('fs').mkdtempSync(path.join(os.tmpdir(), 'orion-relaunch-notrack-'));

  t.doesNotThrow(() => main.killTrackedWorkspaceProcess(ws), 'killing with nothing tracked for this workspace does not throw');

  const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  child.unref();
  main.trackWorkspaceProcess(ws, child.pid);
  t.equal(main.launchedWorkspaceProcesses.get(main.workspaceKey(ws)), child.pid, 'process is tracked after trackWorkspaceProcess');

  main.killTrackedWorkspaceProcess(ws);
  t.notOk(main.launchedWorkspaceProcesses.has(main.workspaceKey(ws)), 'tracking entry is cleared after killing');

  const started = Date.now();
  const poll = setInterval(() => {
    let stillAlive = true;
    try { process.kill(child.pid, 0); } catch (_) { stillAlive = false; }
    if (!stillAlive || Date.now() - started > 5000) {
      clearInterval(poll);
      t.notOk(stillAlive, 'the tracked process was actually killed');
      t.end();
    }
  }, 100);
});

// Regression: a live app crash showed "Uncaught Exception: Error: spawn npm ENOENT" thrown from
// deep inside spawnInternalCommand right after launch_workspace_app reported success — the child
// process had no 'error' listener, so Node rethrew the async spawn failure as an uncaught
// exception and took down the entire Electron main process, not just the one tool call.
test('a spawn failure in spawnInternalCommand does not crash the process', (t) => {
  const os = require('os');
  const path = require('path');
  const ws = require('fs').mkdtempSync(path.join(os.tmpdir(), 'orion-spawn-crash-'));

  const originalHandlers = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  let crashed = null;
  process.on('uncaughtException', (err) => { crashed = err; });

  t.doesNotThrow(() => {
    main.spawnInternalCommand(ws, 'this-binary-definitely-does-not-exist-orion-test', []);
  }, 'spawning a nonexistent executable does not throw synchronously');

  setTimeout(() => {
    process.removeAllListeners('uncaughtException');
    for (const handler of originalHandlers) process.on('uncaughtException', handler);
    t.equal(crashed, null, 'the async ENOENT spawn error was handled instead of crashing the process');
    t.end();
  }, 500);
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

// Regression: a real transcript showed `python -c "from x import y; print(y('literal'))"` fail
// with exit code 1 six times in a row, no matter how the model varied its quoting. Reproduced the
// root cause directly: Node's default Windows argument quoting re-escapes the already-fully-formed
// `command` string passed to cmd.exe as one argv element, so Python actually received only `"from`
// and crashed with "unterminated string literal" — the corruption happened in Node's spawn call,
// below anything the model could control. windowsVerbatimArguments:true on that spawn fixes it.
test('a command with embedded quotes and a semicolon survives startCommandSession on Windows', (t) => {
  if (process.platform !== 'win32') {
    t.pass('Windows-only quoting corruption check skipped on non-Windows');
    t.end();
    return;
  }

  const command = `node -e "const x = 'literal'; console.log('embedded-quote-smoke: ' + x)"`;
  const session = main.startCommandSession({
    command,
    cwd: __dirname,
    processId: `quote_smoke_${Date.now()}`,
    timeoutMs: 10000
  });

  const started = Date.now();
  const poll = setInterval(() => {
    if (session.status !== 'running' || Date.now() - started > 5000) {
      clearInterval(poll);
      t.equal(session.status, 'completed', 'the command completed instead of being killed/timing out');
      t.equal(session.exitCode, 0, 'the command exited successfully, not with a shell-quoting syntax error');
      t.ok(session.stdout.includes('embedded-quote-smoke: literal'), 'the embedded single-quoted string literal survived intact');
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
