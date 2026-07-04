const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire');
const safety = require('../safety');

const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
const ipcWorkspaceJs = fs.readFileSync(path.join(__dirname, '../lib/ipc-workspace.js'), 'utf8');
const ipcShellJs = fs.readFileSync(path.join(__dirname, '../lib/ipc-shell.js'), 'utf8');
const companionHtmlJs = fs.readFileSync(path.join(__dirname, '../lib/companion-html.js'), 'utf8');
const configJs = fs.readFileSync(path.join(__dirname, '../lib/config.js'), 'utf8');
const packageJson = require('../package.json');
const configModule = proxyquire('../lib/config', {
  electron: { app: { getPath: () => path.join(os.tmpdir(), 'orion-config-test') } }
});

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
  t.ok(ipcWorkspaceJs.includes('if (embeddedAllChunks) {'), 'records file hash only after all chunks embed');
  t.ok(ipcWorkspaceJs.includes('delete indexData.files[file.relPath];'), 'failed embedding remains eligible for retry');
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
  t.ok(companionHtmlJs.includes('function sanitizeMarkdownHref'), 'phone companion sanitizes markdown links');
  t.ok(companionHtmlJs.includes('/^(https?:|mailto:|orion-file:)/i.test(value)'), 'phone companion allowlists markdown protocols');
  t.ok(companionHtmlJs.includes('let html = escapeHtml(text).replace'), 'phone companion escapes inline markdown input before formatting');
  t.ok(rendererJs.includes("if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bubble);"), 'renderer tolerates local Prism removal');
  t.notOk(indexHtml.includes('cdnjs.cloudflare.com'), 'desktop renderer no longer loads CDN scripts');
  t.ok(indexHtml.includes('node_modules/prismjs/prism.js'), 'desktop renderer loads local Prism');
  t.ok(packageJson.scripts.package.includes('--ignore="^/config\\.json$"'), 'package excludes local config');
  t.ok(packageJson.scripts.package.includes('--ignore="^/standalone-workspaces($|/)"'), 'package excludes generated standalone workspace state');
  t.ok(packageJson.scripts.package.includes('--ignore="^/\\.orion($|/)"'), 'package excludes generated operational context state');
  t.ok(mainJs.includes('startStaticWorkspaceServer'), 'static HTML apps launch through a local server');
  t.ok(ipcWorkspaceJs.includes('shell.openExternal(url)'), 'static HTML launch uses http URL instead of file origin');
  t.end();
});

test('config failures and command retention safeguards are wired', (t) => {
  t.ok(configJs.includes("return path.join(base, 'config.json');"), 'config is stored under userData');
  t.ok(configJs.includes('throw e;'), 'config write failures propagate');
  t.ok(configJs.includes('SECRET_CONFIG_FIELDS'), 'config protects saved credential fields');
  t.ok(configJs.includes('DEFAULT_CONFIG_VALUES'), 'config restores safe companion defaults when fields are absent');
  t.ok(configJs.includes("replace(/^\\uFEFF/, '')"), 'config reader tolerates UTF-8 BOMs');
  t.ok(configJs.includes('mergeConfigWithSource'), 'config merges existing/source secrets before writing');
  t.ok(mainJs.includes("path.join(app.getPath('userData'), 'conversations.json')"), 'conversation history is stored under userData');
  t.ok(mainJs.includes("ipcMain.handle('read-conversations'"), 'main process exposes disk conversation reads');
  t.ok(mainJs.includes("ipcMain.handle('write-conversations'"), 'main process exposes disk conversation writes');
  t.ok(preloadJs.includes('readConversations'), 'preload exposes disk conversation reads');
  t.ok(preloadJs.includes('writeConversations'), 'preload exposes disk conversation writes');
  t.ok(rendererJs.includes('await loadConversationsFromStorage();'), 'startup waits for durable conversation load before selecting a chat');
  t.ok(rendererJs.includes('mergeConversationSets(disk, local, backup)'), 'renderer merges disk and local conversation stores');
  t.ok(rendererJs.includes('chooseRicherConversation'), 'renderer preserves richer copies of duplicated conversation records');
  t.ok(rendererJs.includes('writeConversations({ revision, conversations: snapshot })'), 'conversation saves write to disk before relying on localStorage');
  t.ok(rendererJs.includes('localStorage; disk persistence remains primary'), 'localStorage quota failures do not block durable history');
  t.ok(ipcShellJs.includes('const MAX_COMMAND_OUTPUT_CHARS = 200000;'), 'command output has a memory cap');
  t.ok(ipcShellJs.includes('const MAX_COMMAND_SESSIONS = 100;'), 'completed command sessions have a retention cap');
  t.ok(ipcShellJs.includes('pruneCommandSessions();'), 'completed sessions are pruned');
  t.ok(ipcShellJs.includes('resolveWindowsShellExecutable'), 'packaged command runner resolves Windows shell by absolute path');
  t.ok(ipcShellJs.includes("'System32', 'WindowsPowerShell'"), 'PowerShell resolver checks the Windows system path');
  t.end();
});

test('config merge preserves saved credentials when incoming config has empty defaults', (t) => {
  const merged = configModule.mergeConfigWithSource(
    {
      geminiApiKey: '',
      googleSearchApiKey: '',
      defaultModel: 'gemini-2.5-flash-lite',
      planningMode: true
    },
    {
      geminiApiKey: 'saved-gemini-key',
      googleSearchApiKey: 'saved-search-key',
      defaultModel: 'gemini-2.5-flash'
    }
  );

  t.equal(merged.geminiApiKey, 'saved-gemini-key', 'Gemini key is preserved from existing/source config');
  t.equal(merged.googleSearchApiKey, 'saved-search-key', 'Google Search key is preserved from existing/source config');
  t.equal(merged.defaultModel, 'gemini-2.5-flash-lite', 'non-secret model selection is still allowed to change');
  t.equal(merged.enablePhoneCompanion, true, 'phone companion stays enabled by default');
  t.equal(merged.phoneCompanionPort, 45678, 'phone companion falls back to its default port, not Flask\'s common default of 5000');
  t.end();
});

// Regression: the port default changed from 5000 to 45678 to stop colliding with Flask's own
// default dev port, but existing installs already had 5000 baked into config.json from an earlier
// writeAppConfig call (this field has never been exposed in any settings UI, so any persisted
// 5000 is guaranteed to be the old default, not a deliberate user choice). Changing the code
// default alone does nothing for those installs unless the persisted value is migrated too.
test('a persisted phoneCompanionPort of exactly 5000 is migrated to the new default, not preserved', (t) => {
  const merged = configModule.mergeConfigWithSource({ phoneCompanionPort: 5000 }, {});
  t.equal(merged.phoneCompanionPort, 45678, 'a pre-existing 5000 value is treated as the old default and replaced');

  const untouched = configModule.mergeConfigWithSource({ phoneCompanionPort: 51234 }, {});
  t.equal(untouched.phoneCompanionPort, 51234, 'a genuinely different persisted port is left alone');
  t.end();
});
