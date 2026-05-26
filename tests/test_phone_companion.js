const test = require('tape');
const http = require('http');
const proxyquire = require('proxyquire').noPreserveCache();

const electronMock = {
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
};

test('Phone Companion binds 0.0.0.0 if enabled', (t) => {
  const fsMock = {
    existsSync: (p) => true,
    readFileSync: (p, e) => JSON.stringify({
      enablePhoneCompanion: true,
      phoneCompanionPort: 1125,
      phoneCompanionToken: '1234567890123456'
    })
  };
  const main2 = proxyquire('../main.js', { 'electron': electronMock, 'fs': fsMock });

  main2.resetCompanionServer();
  main2.startPhoneCompanionServer();

  setTimeout(() => {
    const server = main2.getCompanionServer();
    if (server) {
       const address = server.address();
       t.ok(address, 'Server has bound address');
       t.ok(address.address === '0.0.0.0' || address.address === '::', 'Server is bound to 0.0.0.0 when enablePhoneCompanion is true: ' + address.address);
       server.close(() => {
          t.end();
       });
    } else {
       t.fail('Server not running');
       t.end();
    }
  }, 200);
});

test('Phone Companion API Security (127.0.0.1)', (t) => {
  const fsMock = {
    existsSync: (p) => true,
    readFileSync: (p, e) => JSON.stringify({
      enablePhoneCompanion: false,
      phoneCompanionPort: 1126 // Different port to avoid EADDRINUSE just in case
    })
  };
  const main = proxyquire('../main.js', { 'electron': electronMock, 'fs': fsMock });

  main.resetCompanionServer();
  main.startPhoneCompanionServer();

  setTimeout(() => {
    http.get('http://127.0.0.1:1126/api/state', (res) => {
      t.equal(res.statusCode, 401, 'Returns 401 for missing token on /api/state');

      http.get('http://127.0.0.1:1126/api/prompt', (res2) => {
        t.equal(res2.statusCode, 401, 'Returns 401 for missing token on /api/prompt');

        http.get('http://127.0.0.1:1126/api/approve-plan', (res3) => {
          t.equal(res3.statusCode, 401, 'Returns 401 for missing token on /api/approve-plan');

          http.get('http://127.0.0.1:1126/?token=invalid', (res4) => {
            t.equal(res4.statusCode, 401, 'Returns 401 for invalid token on root');

            const server = main.getCompanionServer();
            if (server) {
              const address = server.address();
              t.ok(address, 'Server has bound address');
              t.equal(address.address, '127.0.0.1', 'Server is strictly bound to 127.0.0.1 when enablePhoneCompanion is false');
              server.close(() => {
                 t.end();
              });
            } else {
                 t.fail('Server not running');
                 t.end();
            }
          });
        });
      });
    }).on('error', (e) => {
      t.fail(`HTTP request failed: ${e.message}`);
      t.end();
    });
  }, 200);
});
