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
