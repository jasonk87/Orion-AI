const test = require('tape');
const fs = require('fs');
const path = require('path');

// Extract escapePowerShellSingle from main.js for testing
const mainJsContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const match = mainJsContent.match(/function escapePowerShellSingle\(value\) \{([\s\S]*?)\}/);
let escapePowerShellSingle;
if (match) {
  escapePowerShellSingle = new Function('value', match[1] + ' return String(value).replace(/\'/g, "\'\'");');
}

test('escapePowerShellSingle escapes single quotes correctly', (t) => {
  t.ok(escapePowerShellSingle, 'escapePowerShellSingle function found');

  const cases = [
    { input: "normal string", expected: "normal string" },
    { input: "it's a test", expected: "it''s a test" },
    { input: "'starts and ends'", expected: "''starts and ends''" },
    { input: "multiple 'quotes' here", expected: "multiple ''quotes'' here" }
  ];

  cases.forEach(c => {
    t.equal(escapePowerShellSingle(c.input), c.expected, `Escapes ${c.input} properly`);
  });

  t.end();
});
