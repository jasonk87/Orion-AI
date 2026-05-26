const test = require('tape');
const fs = require('fs');

test('Phone Companion Security', (t) => {
  const mainContent = fs.readFileSync(require('path').join(__dirname, '../main.js'), 'utf8');

  t.ok(mainContent.includes("if (url.searchParams.get('token') !== companionToken) {"), 'Token is checked for unauthorized requests');
  t.ok(mainContent.includes("sendJson(res, 401, { success: false, error: 'Unauthorized companion request' });"), 'Unauthorized responds with 401');
  t.ok(mainContent.includes("const enableCompanion = config.enablePhoneCompanion === true;"), 'enableCompanion logic is present');
  t.ok(mainContent.includes("const host = enableCompanion ? '0.0.0.0' : '127.0.0.1';"), 'host binding restricted to 127.0.0.1 by default');

  t.end();
});
