const test = require('tape');
const http = require('http');
const proxyquire = require('proxyquire').noPreserveCache();

const electronMock = {
  app: {
    whenReady: () => ({ then: () => {} }),
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
      phoneCompanionPort: 1126, // Different port to avoid EADDRINUSE just in case
      phoneCompanionToken: '1234567890123456'
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

          http.get('http://127.0.0.1:1126/api/stop', (resStop) => {
            t.equal(resStop.statusCode, 401, 'Returns 401 for missing token on /api/stop');

          http.get('http://127.0.0.1:1126/api/resume', (resResume) => {
            t.equal(resResume.statusCode, 401, 'Returns 401 for missing token on /api/resume');

          http.get('http://127.0.0.1:1126/api/deny-plan', (resDeny) => {
            t.equal(resDeny.statusCode, 401, 'Returns 401 for missing token on /api/deny-plan');

          http.get('http://127.0.0.1:1126/api/revise-plan', (resRevise) => {
            t.equal(resRevise.statusCode, 401, 'Returns 401 for missing token on /api/revise-plan');

          http.get('http://127.0.0.1:1126/?token=invalid', (res4) => {
            t.equal(res4.statusCode, 401, 'Returns 401 for invalid token on root');

            http.get('http://127.0.0.1:1126/manifest.webmanifest', (res5) => {
              t.equal(res5.statusCode, 401, 'Returns 401 for missing token on manifest');

              http.get('http://127.0.0.1:1126/sw.js', (res6) => {
                t.equal(res6.statusCode, 401, 'Returns 401 for missing token on service worker');

                http.get('http://127.0.0.1:1126/manifest.webmanifest?token=1234567890123456', (res7) => {
                  let body = '';
                  res7.on('data', chunk => { body += chunk; });
                  res7.on('end', () => {
                    t.equal(res7.statusCode, 200, 'Returns manifest for valid token');
                    t.notOk(body.includes('1234567890123456'), 'Manifest does not leak companion token');

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
            });
          });
          });
          });
          });
          });
        });
      });
    }).on('error', (e) => {
      t.fail(`HTTP request failed: ${e.message}`);
      t.end();
    });
  }, 200);
});
