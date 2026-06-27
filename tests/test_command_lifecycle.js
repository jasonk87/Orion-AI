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
