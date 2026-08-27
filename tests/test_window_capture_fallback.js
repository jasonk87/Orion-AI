'use strict';

process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('tape');
const proxyquire = require('proxyquire');

const { buildCaptureWindowScript, captureWindowByHint } = require('../lib/windows-window-capture');

function emptyDesktopShell(userData, sourceCount = 1) {
  const primary = {
    id: 'primary',
    label: 'Primary',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1
  };
  return proxyquire('../lib/ipc-shell', {
    electron: {
      screen: { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary] },
      desktopCapturer: {
        getSources: async () => sourceCount
          ? [{ display_id: 'primary', thumbnail: { isEmpty: () => true } }]
          : []
      },
      app: { getPath: () => userData }
    }
  });
}

test('native named-window capture treats the application name as encoded data', t => {
  const hostile = "Claude'; Stop-Process -Name explorer; #'";
  const script = buildCaptureWindowScript(hostile);
  t.notOk(script.includes(hostile), 'the raw application name is never interpolated into PowerShell');
  t.ok(script.includes('FromBase64String'), 'PowerShell decodes the application name as data');
  t.ok(script.includes('PrintWindow'), 'the fallback captures one native window without requiring the desktop framebuffer');
t.end();
});
test('native named-window capture decodes the bounded PowerShell result', async t => {
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const result = await captureWindowByHint('Claude', {
    execFile: (file, args, options, callback) => {
      t.equal(file, 'powershell.exe', 'the bounded Windows helper is used');
      t.ok(args.includes('-EncodedCommand'), 'the script is passed without shell interpolation');
      t.equal(options.timeout, 15000, 'the native capture has a finite timeout');
      callback(null, JSON.stringify({
        success: true,
        width: 1216,
        height: 808,
        windowTitle: 'Claude',
        processName: 'claude',
        pngBase64: png.toString('base64')
      }), '');
    }
  });
  t.equal(result.size.width, 1216);
  t.equal(result.size.height, 808);
  t.equal(result.windowTitle, 'Claude');
  t.ok(result.png.equals(png), 'the returned PNG is decoded exactly');
  t.end();
});

for (const sourceCount of [1, 0]) {
  test(`named-window fallback survives ${sourceCount ? 'an empty desktop thumbnail' : 'no desktop sources'}`, async t => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
    const ipcShell = emptyDesktopShell(userData, sourceCount);
    const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
    let receivedHint = '';
    const shot = await ipcShell.captureDesktopScreenshot(workspace, '', 'application', {
      windowHint: 'Claude',
      windowCapture: async hint => {
        receivedHint = hint;
        return {
          png,
          size: { width: 1216, height: 808 },
          windowTitle: 'Claude',
          processName: 'claude'
        };
      }
    });
    t.equal(receivedHint, 'Claude', 'the exact activated application is the fallback target');
    t.equal(shot.captureMode, 'application_window', 'the result is explicitly distinguished from full-display evidence');
    t.equal(shot.size.width, 1216);
    t.equal(shot.windowTitle, 'Claude');
    t.ok(fs.existsSync(path.join(workspace, shot.rel)), 'the fallback image is persisted like every other screenshot');
    t.ok(fs.readFileSync(path.join(workspace, shot.rel)).equals(png), 'the persisted bytes are the native window capture');

    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    t.end();
  });
}

test('full-display capture still fails closed when desktop pixels are unavailable', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
  const ipcShell = emptyDesktopShell(userData, 1);
  try {
    await ipcShell.captureDesktopScreenshot(workspace, '', 'capture', {});
    t.fail('a cropped window must not silently replace a requested full-display capture');
  } catch (error) {
    t.match(error.message, /screen image was empty/i, 'coordinate-bearing display evidence still fails safely');
  }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});
