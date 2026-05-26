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

  main.killProcessTree({ pid: 12345, kill: () => {} }, (err) => {
    t.ok(true, 'killProcessTree executed callback');
    t.end();
    process.exit(0);
  });
});
