const test = require('tape');
const proxyquire = require('proxyquire');
const fs = require('fs');
const os = require('os');
const path = require('path');

const main = proxyquire('../main.js', {
  'electron': {
    app: {
      whenReady: () => ({ then: () => {} }),
      on: () => {},
      getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'orion-user-data-'))
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

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-workspace-'));
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'a.txt'), 'alpha', 'utf8');
  return workspace;
}

test('workspace file operations copy, move, and delete inside workspace', (t) => {
  const workspace = makeWorkspace();

  const copyRes = main.copyWorkspacePath(workspace, 'src/a.txt', 'src/b.txt');
  t.ok(copyRes.success, 'copy succeeds');
  t.equal(fs.readFileSync(path.join(workspace, 'src', 'b.txt'), 'utf8'), 'alpha', 'copy preserves content');

  const moveRes = main.moveWorkspacePath(workspace, 'src/b.txt', 'src/c.txt');
  t.ok(moveRes.success, 'move succeeds');
  t.notOk(fs.existsSync(path.join(workspace, 'src', 'b.txt')), 'move removes old path');
  t.ok(fs.existsSync(path.join(workspace, 'src', 'c.txt')), 'move creates new path');

  const renameRes = main.moveWorkspacePath(workspace, 'src/c.txt', 'src/renamed.txt');
  t.ok(renameRes.success, 'rename via move succeeds');
  t.ok(fs.existsSync(path.join(workspace, 'src', 'renamed.txt')), 'rename creates new name');

  const deleteRes = main.deleteWorkspacePath(workspace, 'src/renamed.txt');
  t.ok(deleteRes.success, 'delete succeeds');
  t.ok(deleteRes.backupPath, 'delete creates backup before removal');
  t.notOk(fs.existsSync(path.join(workspace, 'src', 'c.txt')), 'delete removes target');

  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

test('workspace file operations reject path escapes and existing destinations', (t) => {
  const workspace = makeWorkspace();

  t.throws(() => main.copyWorkspacePath(workspace, 'src/a.txt', '../outside.txt'), /escapes/, 'copy rejects destination escape');
  t.throws(() => main.moveWorkspacePath(workspace, '../outside.txt', 'inside.txt'), /escapes/, 'move rejects source escape');
  t.throws(() => main.copyWorkspacePath(workspace, 'src/a.txt', 'src/a.txt'), /Destination already exists/, 'copy rejects overwrite');

  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});
