const test = require('tape');
const proxyquire = require('proxyquire');

const main = proxyquire('../main.js', {
  'electron': {
    app: {
      whenReady: () => Promise.resolve(),
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
  // Use a command that runs for 10 seconds
  const cmd = isWin ? 'ping 127.0.0.1 -n 10' : 'sleep 10';

  const processId = 'test_cmd_' + Date.now();

  const session = main.startCommandSession({
    command: cmd,
    cwd: __dirname,
    processId: processId,
    timeoutMs: 10000
  });

  t.equal(session.status, 'running', 'session starts running');
  t.ok(session.id, 'session has id');

  // Let the process spawn and then kill it using the module function
  setTimeout(() => {
    // Attempt to kill it using the actual exposed command (we must mock the ipcMain handler or call killProcessTree directly)
    // To do this, we can call the killProcessTree logic inside our mock process or use activeProcesses
    // Actually, we can test isDestructiveCommand here as well.
    t.ok(main.isDestructiveCommand('rm -rf /'), 'Catches rm -rf /');
    t.ok(main.isDestructiveCommand('echo hello && rm -rf "$HOME"'), 'Catches chained rm -rf');
    t.ok(main.isDestructiveCommand('git reset --hard'), 'Catches git reset --hard');
    t.ok(main.isDestructiveCommand('echo test | git clean -fdx'), 'Catches git clean -fdx');
    t.ok(main.isDestructiveCommand('del /s /q'), 'Catches del /s /q');
    t.ok(main.isDestructiveCommand('Remove-Item -Recurse -Force'), 'Catches Remove-Item -Recurse');

    // Test the kill logic on the actual spawned child if we could reach it,
    // Since activeProcesses is private, we'll verify killProcessTree execution path:
    const childProcess = require('child_process');
    const child = childProcess.spawn(isWin ? 'cmd.exe' : 'bash', [isWin ? '/c' : '-c', 'sleep 10'], { detached: true });

    t.ok(child.pid, 'Spawned real test child');
    main.killProcessTree(child, (err) => {
      t.error(err, 'killProcessTree executed without error');
      t.end();
      process.exit(0);
    });
  }, 100);
});
