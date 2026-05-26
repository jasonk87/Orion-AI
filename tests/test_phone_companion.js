const test = require('tape');
const http = require('http');
const proxyquire = require('proxyquire');

let configMock = {
  enablePhoneCompanion: false
};

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

// Override readAppConfig to inject our config
main.readAppConfig = () => configMock;

test('Phone Companion API Security', (t) => {
  main.startPhoneCompanionServer();

  setTimeout(() => {
    http.get('http://127.0.0.1:1122/api/state', (res) => {
      t.equal(res.statusCode, 401, 'Returns 401 for missing token on /api/state');

      http.get('http://127.0.0.1:1122/api/prompt', (res2) => {
        t.equal(res2.statusCode, 401, 'Returns 401 for missing token on /api/prompt');

        http.get('http://127.0.0.1:1122/api/approve-plan', (res3) => {
          t.equal(res3.statusCode, 401, 'Returns 401 for missing token on /api/approve-plan');

          http.get('http://127.0.0.1:1122/?token=invalid', (res4) => {
            t.equal(res4.statusCode, 401, 'Returns 401 for invalid token on root');

            const server = main.companionServer || main.getCompanionServer();
            if (server) {
              const address = server.address();
              t.equal(address.address, '127.0.0.1', 'Server is strictly bound to 127.0.0.1 when enablePhoneCompanion is false');
              server.close(() => {
                 t.end();
                 process.exit(0);
              });
            } else {
                 t.end();
                 process.exit(0);
            }
          });
        });
      });
    }).on('error', (e) => {
      t.fail(`HTTP request failed: ${e.message}`);
      t.end();
      process.exit(1);
    });
  }, 500);
});
