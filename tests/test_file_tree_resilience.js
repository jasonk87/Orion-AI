// The file tree panel crashed the packaged app with an unhandled rejection —
// "TypeError: files.forEach is not a function" — whenever list-files answered with its
// { error } failure shape instead of an array. Two layers conspired: the renderer trusted
// the union return type blindly, and the main-process walk aborted the ENTIRE listing when
// any single entry failed lstat (routine while an agent run mutates the workspace mid-walk).
// These tests exercise both layers for real.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire');
const { loadRenderer } = require('./helpers/renderer-harness');

// ── Renderer: syncWorkspaceFiles survives a failed listing ────────────────────

test('a failed list-files result renders an error state instead of crashing the panel', async (t) => {
  const { win } = loadRenderer({
    t,
    api: {
      listFiles: async () => ({ error: 'Directory does not exist: C:\\gone' })
    },
    set: { currentWorkspace: 'C:\\gone' }
  });

  win.onerror = (message) => { t.fail(`renderer threw: ${message}`); };
  await win.syncWorkspaceFiles();

  const treeHtml = win.document.getElementById('file-tree-container').innerHTML;
  t.ok(treeHtml.includes('Could not list files'), 'the panel explains the failure');
  t.ok(treeHtml.includes('Directory does not exist'), 'the real error reason is shown');
  t.equal(win.document.getElementById('file-count-badge').textContent, '—',
    'the count badge shows no stale number for an unlistable workspace');
  t.end();
});

test('error reasons are HTML-escaped before entering the file tree panel', async (t) => {
  const { win } = loadRenderer({
    t,
    api: {
      listFiles: async () => ({ error: '<img src=x onerror=alert(1)>' })
    },
    set: { currentWorkspace: 'C:\\ws' }
  });

  await win.syncWorkspaceFiles();

  const tree = win.document.getElementById('file-tree-container');
  t.equal(tree.querySelector('img'), null, 'markup in the error reason does not become elements');
  t.ok(tree.textContent.includes('<img'), 'the reason is still shown, as text');
  t.end();
});

test('a successful listing still renders the tree normally', async (t) => {
  const { win } = loadRenderer({
    t,
    api: {
      listFiles: async () => ([
        { name: 'src', path: 'src', isDir: true },
        { name: 'a.js', path: 'src\\a.js', isDir: false, size: 10 },
        { name: 'readme.md', path: 'readme.md', isDir: false, size: 5 }
      ])
    },
    set: { currentWorkspace: 'C:\\ws' }
  });

  await win.syncWorkspaceFiles();

  t.equal(win.document.getElementById('file-count-badge').textContent, '3',
    'the badge counts the listed entries');
  const treeText = win.document.getElementById('file-tree-container').textContent;
  t.ok(treeText.includes('readme.md'), 'root-level files appear in the rendered tree');
  t.ok(treeText.includes('src'), 'directories appear in the rendered tree');
  t.notOk(treeText.includes('a.js'), 'collapsed folder contents stay hidden until expanded');
  t.end();
});

// ── Main process: the walk skips broken entries instead of failing the listing ─

function loadIpcFileTools(fsOverrides = {}) {
  return proxyquire('../lib/ipc-file-tools', {
    electron: { app: { getPath: () => os.tmpdir() } },
    fs: Object.assign(Object.create(fs), fsOverrides)
  });
}

function getListFilesHandler(ipcFileTools) {
  const handlers = {};
  ipcFileTools.registerHandlers({ handle: (channel, fn) => { handlers[channel] = fn; } });
  return handlers['list-files'];
}

function makeFixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-listfiles-test-'));
  fs.writeFileSync(path.join(root, 'stable.txt'), 'still here');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'code');
  fs.writeFileSync(path.join(root, 'vanishing.tmp'), 'deleted mid-walk');
  return root;
}

test('an entry deleted between readdir and lstat is skipped, not fatal', async (t) => {
  const root = makeFixtureWorkspace();
  // Deterministic reproduction of the race: lstat on this one entry behaves as if another
  // process deleted the file after readdir returned its name.
  const listFiles = getListFilesHandler(loadIpcFileTools({
    lstatSync: (target) => {
      if (String(target).endsWith('vanishing.tmp')) {
        const err = new Error(`ENOENT: no such file or directory, lstat '${target}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return fs.lstatSync(target);
    }
  }));

  try {
    const result = await listFiles({}, root);
    t.ok(Array.isArray(result), 'the listing still succeeds as an array');
    const paths = result.map((entry) => entry.path);
    t.ok(paths.includes('stable.txt'), 'unaffected files are listed');
    t.ok(paths.some((p) => p.endsWith('app.js')), 'files in subdirectories are listed');
    t.notOk(paths.includes('vanishing.tmp'), 'the vanished entry is simply absent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('an unreadable subdirectory is skipped while the rest of the tree lists', async (t) => {
  const root = makeFixtureWorkspace();
  const lockedDir = path.join(root, 'src');
  const listFiles = getListFilesHandler(loadIpcFileTools({
    readdirSync: (target) => {
      if (String(target) === lockedDir) {
        const err = new Error(`EPERM: operation not permitted, scandir '${target}'`);
        err.code = 'EPERM';
        throw err;
      }
      return fs.readdirSync(target);
    }
  }));

  try {
    const result = await listFiles({}, root);
    t.ok(Array.isArray(result), 'the listing still succeeds as an array');
    const paths = result.map((entry) => entry.path);
    t.ok(paths.includes('stable.txt'), 'siblings of the locked directory are listed');
    t.ok(paths.includes('src'), 'the locked directory itself still appears as a directory');
    t.notOk(paths.some((p) => p.endsWith('app.js')), 'its unreadable contents are absent, not fatal');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  t.end();
});

test('a workspace root that does not exist still reports the error shape', async (t) => {
  const listFiles = getListFilesHandler(loadIpcFileTools());
  const result = await listFiles({}, path.join(os.tmpdir(), 'orion-definitely-missing-root'));
  t.ok(result && result.error, 'a missing root is an error result, not a crash');
  t.ok(/does not exist/i.test(result.error), 'the error names the problem');
  t.end();
});
