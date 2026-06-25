const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const safety = require('../safety');

const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const packageJson = require('../package.json');

test('workspace containment rejects lexical and link escapes', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-safe-workspace-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside', 'utf8');

  t.throws(() => safety.resolveWorkspacePath(workspace, '../outside.txt'), /escapes/, 'rejects lexical parent escape');

  // Test resolveWorkspacePath with a non-existent workspace folder
  const nonExistentWorkspace = path.join(os.tmpdir(), 'orion-non-existent-workspace-' + Date.now());
  t.doesNotThrow(() => safety.resolveWorkspacePath(nonExistentWorkspace, 'somefile.txt'), 'does not throw when workspace does not exist');

  const linkPath = path.join(workspace, 'linked-outside');
  try {
    fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    t.throws(() => safety.resolveWorkspacePath(workspace, 'linked-outside/secret.txt'), /symbolic link|junction/, 'rejects link escape');
  } catch (error) {
    t.comment(`link escape test skipped: ${error.message}`);
  }

  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  t.end();
});

test('semantic indexing excludes environment files', (t) => {
  t.equal(safety.isIndexableWorkspaceFile('app.js'), true, 'indexes source files');
  t.equal(safety.isIndexableWorkspaceFile('.env'), false, 'excludes .env');
  t.equal(safety.isIndexableWorkspaceFile('.env.local'), false, 'excludes .env.local');
  t.equal(safety.isIndexableWorkspaceFile('production.env'), false, 'does not index env extension files');
  t.ok(mainJs.includes('if (embeddedAllChunks) {'), 'records file hash only after all chunks embed');
  t.ok(mainJs.includes('delete indexData.files[file.relPath];'), 'failed embedding remains eligible for retry');
  t.end();
});

test('destructive command guard catches audited variants', (t) => {
  [
    'Remove-Item -LiteralPath .\\important.txt -Force',
    'cmd /c rmdir /s /q build',
    'node -e "require(\'fs\').rmSync(\'build\',{recursive:true,force:true})"',
    'git checkout -- .',
    'git restore .',
    'Clear-Content .\\important.txt'
  ].forEach(command => t.equal(safety.classifyCommandRequest(command).allowed, false, `blocks ${command}`));
  t.equal(safety.classifyCommandRequest('npm test').allowed, true, 'still allows safe commands');
  t.end();
});

test('renderer and package hardening are wired', (t) => {
  t.ok(rendererJs.includes('function sanitizeRenderedMarkdown(container)'), 'renderer sanitizes markdown links');
  t.ok(rendererJs.includes("!/^(https?:|mailto:|orion-file:)/i.test(href)"), 'renderer allowlists markdown protocols');
  t.ok(rendererJs.includes("if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bubble);"), 'renderer tolerates local Prism removal');
  t.notOk(indexHtml.includes('cdnjs.cloudflare.com'), 'desktop renderer no longer loads CDN scripts');
  t.ok(indexHtml.includes('node_modules/prismjs/prism.js'), 'desktop renderer loads local Prism');
  t.ok(packageJson.scripts.package.includes('--ignore="^/config\\.json$"'), 'package excludes local config');
  t.end();
});

test('config failures and command retention safeguards are wired', (t) => {
  t.ok(mainJs.includes("return path.join(base, 'config.json');"), 'config is stored under userData');
  t.ok(mainJs.includes('throw e;'), 'config write failures propagate');
  t.ok(mainJs.includes('const MAX_COMMAND_OUTPUT_CHARS = 200000;'), 'command output has a memory cap');
  t.ok(mainJs.includes('const MAX_COMMAND_SESSIONS = 100;'), 'completed command sessions have a retention cap');
  t.ok(mainJs.includes('pruneCommandSessions();'), 'completed sessions are pruned');
  t.ok(mainJs.includes('resolveWindowsShellExecutable'), 'packaged command runner resolves Windows shell by absolute path');
  t.ok(mainJs.includes("'System32', 'WindowsPowerShell'"), 'PowerShell resolver checks the Windows system path');
  t.end();
});
