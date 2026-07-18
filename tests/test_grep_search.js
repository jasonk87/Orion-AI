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

test('grep-search can include nearby context lines when requested', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const result = await grepSearch({}, { workspacePath: root, pattern: "socket.on('input'", options: { contextLines: 1 } });
    const match = result.results[0];
    t.equal(match.context.length, 3, 'one line of context is returned before and after the match');
    t.deepEqual(match.context.map(line => line.line), [1, 2, 3], 'context reports original line numbers');
    t.equal(match.context[1].match, true, 'matched line is marked inside the context block');
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

// Regression: an agent run wrote `a|b|c` alternation patterns without regex:true. Literal mode
// matched the pipe as an ordinary character, silently returned zero matches, and the model
// concluded — confidently and wrongly — that the searched-for handler and CSS did not exist.
// Literal mode now treats '|' as OR over literal alternatives.
test('grep-search literal mode supports pipe alternation instead of silently matching nothing', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const piped = await grepSearch({}, { workspacePath: root, pattern: 'express|pit_strategy', options: {} });
    t.equal(piped.success, true, 'search succeeds');
    t.deepEqual(piped.results.map(r => r.line).sort(), [1, 5], 'both literal alternatives match their own lines');

    const spaced = await grepSearch({}, { workspacePath: root, pattern: 'express | pit_strategy', options: {} });
    t.equal(spaced.results.length, 2, 'whitespace around the pipe is tolerated');

    const single = await grepSearch({}, { workspacePath: root, pattern: 'express', options: {} });
    t.equal(single.results.length, 1, 'single-token literal search is unchanged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('grep-search flags a zero-match literal search that looks like a regex', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = makeFixtureWorkspace();
  try {
    const regexLooking = await grepSearch({}, { workspacePath: root, pattern: 'socket\\.on\\(.*input', options: {} });
    t.equal(regexLooking.results.length, 0, 'the regex-syntax pattern matches nothing literally');
    t.ok(/regex: true/.test(regexLooking.message || ''), 'the result warns the pattern ran as literal text and suggests regex: true');
    t.ok(/Do not conclude/.test(regexLooking.message || ''), 'the result explicitly warns against inferring absence');

    const genuineMiss = await grepSearch({}, { workspacePath: root, pattern: 'zebra_unicorn_token', options: {} });
    t.equal(genuineMiss.results.length, 0, 'a plain literal miss still returns zero');
    t.equal(genuineMiss.message, undefined, 'a plain literal miss carries no misleading warning');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

// Regression: grep-search's skip list was missing Python environments entirely, so a search
// rooted at a folder containing venvs synchronously read tens of thousands of interpreter
// files in the Electron main process — the app froze with an OS "not responding" dialog.
test('grep-search skips Python environments and caches like every other workspace walk', async (t) => {
  const grepSearch = getGrepSearchHandler();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-grep-venv-test-'));
  try {
    fs.writeFileSync(path.join(root, 'app.py'), 'needle_token = 1');
    for (const dir of [
      path.join('venv', 'Lib', 'site-packages', 'somepkg'),
      path.join('.venv', 'lib'),
      '__pycache__',
      '.ruff_cache',
      '.pytest_cache'
    ]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'mod.py'), 'needle_token = 2');
    }

    const result = await grepSearch({}, { workspacePath: root, pattern: 'needle_token', options: {} });
    t.equal(result.success, true, 'search succeeds');
    t.deepEqual(result.results.map(r => r.path), ['app.py'], 'only real source matches — venvs and caches are excluded');
    t.equal(result.filesScanned, 1, 'excluded trees are never even read');
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
