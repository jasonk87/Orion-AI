const test = require('tape');
const http = require('http');
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
    },
    ipcMain: {
      on: () => {},
      handle: () => {}
    },
    dialog: {}
  }
});

test('Phone Companion API Security', (t) => {
  main.startPhoneCompanionServer();

  setTimeout(() => {
    http.get('http://127.0.0.1:1122/api/state', (res) => {
      t.equal(res.statusCode, 401, 'Returns 401 for missing token');

      http.get('http://127.0.0.1:1122/?token=invalid', (res2) => {
        t.equal(res2.statusCode, 401, 'Returns 401 for invalid token on root');

        const server = main.companionServer || main.getCompanionServer();
        if (server) {
          server.close(() => {
             t.end();
          });
        } else {
             t.end();
        }
      });
    }).on('error', (e) => {
      t.fail(`HTTP request failed: ${e.message}`);
      t.end();
    });
  }, 500);
});
