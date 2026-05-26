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
  const cmd = isWin ? 'ping 127.0.0.1 -n 10' : 'sleep 10';

  const session = main.startCommandSession({
    command: cmd,
    cwd: __dirname,
    processId: 'test_cmd',
    timeoutMs: 10000
  });

  t.equal(session.status, 'running', 'session starts running');
  t.ok(session.id, 'session has id');

  const child = main.activeProcesses[session.id];
  t.ok(child, 'Real process was spawned and tracked');

  t.ok(main.isDestructiveCommand('rm -rf /'), 'Catches rm -rf /');
  t.ok(main.isDestructiveCommand('echo hello && rm -rf "$HOME"'), 'Catches chained rm -rf');
  t.ok(main.isDestructiveCommand('git reset --hard'), 'Catches git reset --hard');
  t.ok(main.isDestructiveCommand('echo test | git clean -fdx'), 'Catches git clean -fdx');
  t.ok(main.isDestructiveCommand('del /s /q'), 'Catches del /s /q');
  t.ok(main.isDestructiveCommand('Remove-Item -Recurse -Force'), 'Catches Remove-Item -Recurse');

  main.killProcessTree(child, (err) => {
    t.error(err, 'killProcessTree executed without error');

    // Give it a moment to actually exit
    setTimeout(() => {
       t.ok(child.killed || child.exitCode !== null || session.status !== 'running', 'Process is marked as killed or closed');
       t.end();

    }, 200);
  });
});
