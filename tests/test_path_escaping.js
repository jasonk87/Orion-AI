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
    },
    ipcMain: {
      on: () => {},
      handle: () => {}
    },
    dialog: {}
  }
});

test('escapePowerShellSingle escapes single quotes correctly', (t) => {
  const cases = [
    { input: "normal string", expected: "normal string" },
    { input: "it's a test", expected: "it''s a test" },
    { input: "'starts and ends'", expected: "''starts and ends''" },
    { input: "multiple 'quotes' here", expected: "multiple ''quotes'' here" }
  ];

  cases.forEach(c => {
    t.equal(main.escapePowerShellSingle(c.input), c.expected, `Escapes ${c.input} properly`);
  });

  t.end();
});
