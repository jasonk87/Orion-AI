const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire');

const ipcFileTools = proxyquire('../lib/ipc-file-tools', {
  electron: {
    app: {
      getPath: () => os.tmpdir()
    }
  }
});

function makeFixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-grep-test-'));
  fs.writeFileSync(path.join(root, 'server.js'), [
    "const express = require('express');",
    "socket.on('input', (inputs) => {",
    "  console.log('handling input');",
    "});",
    "socket.on('pit_strategy', (strategy) => {",
    "  console.log('handling pit strategy');",
    "});"
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'SOCKET.ON is mentioned here too, uppercase.');
  fs.mkdirSync(path.join(root, 'node_modules', 'some-dep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'some-dep', 'index.js'), "socket.on('input', () => {});");
  fs.writeFileSync(path.join(root, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return root;
}

function getGrepSearchHandler() {
  const handlers = {};
  const mockIpcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
  ipcFileTools.registerHandlers(mockIpcMain);
  return handlers['grep-search'];
}

test('grep-search finds literal matches with file and line info, skipping node_modules and binaries', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const result = await grepSearch({}, { workspacePath: root, pattern: "socket.on('input'", options: {} });
    t.equal(result.success, true, 'search succeeds');
    t.equal(result.results.length, 1, 'only the one match in server.js is found — node_modules is excluded');
    t.equal(result.results[0].path, 'server.js', 'match reports the relative file path');
    t.equal(result.results[0].line, 2, 'match reports the correct 1-indexed line number');
    t.ok(result.results[0].text.includes("socket.on('input'"), 'match includes the matched line text');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('grep-search is case-insensitive by default and case-sensitive when requested', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const insensitive = await grepSearch({}, { workspacePath: root, pattern: 'socket.on', options: {} });
    const matchedFiles = insensitive.results.map(r => r.path).sort();
    t.ok(matchedFiles.includes('notes.txt'), 'case-insensitive search matches the uppercase mention in notes.txt');

    const sensitive = await grepSearch({}, { workspacePath: root, pattern: 'socket.on', options: { caseSensitive: true } });
    const sensitiveFiles = sensitive.results.map(r => r.path);
    t.notOk(sensitiveFiles.includes('notes.txt'), 'case-sensitive search does not match the uppercase mention');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('grep-search supports regex patterns', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const result = await grepSearch({}, { workspacePath: root, pattern: "socket\\.on\\('(input|pit_strategy)'", options: { regex: true } });
    t.equal(result.results.length, 2, 'regex matches both socket.on call sites in server.js');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('grep-search respects filePattern and truncates at maxResults', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const jsOnly = await grepSearch({}, { workspacePath: root, pattern: 'socket.on', options: { filePattern: '.js' } });
    t.ok(jsOnly.results.every(r => r.path.endsWith('.js')), 'filePattern restricts matches to .js files only');

    const capped = await grepSearch({}, { workspacePath: root, pattern: 'socket.on', options: { maxResults: 1 } });
    t.equal(capped.results.length, 1, 'result count is capped at maxResults');
    t.equal(capped.truncated, true, 'truncated flag is set when the cap is hit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('grep-search reports a clear error for a missing workspace or pattern, and an invalid regex', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const noPattern = await grepSearch({}, { workspacePath: root, pattern: '', options: {} });
    t.equal(noPattern.success, false, 'missing pattern fails');
    t.ok(/pattern/i.test(noPattern.error), 'error mentions the missing pattern');

    const noWorkspace = await grepSearch({}, { workspacePath: '', pattern: 'x', options: {} });
    t.equal(noWorkspace.success, false, 'missing workspace fails');

    const badRegex = await grepSearch({}, { workspacePath: root, pattern: '(unterminated', options: { regex: true } });
    t.equal(badRegex.success, false, 'invalid regex fails instead of throwing');
    t.ok(/regex/i.test(badRegex.error), 'error names the invalid regex');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});
