'use strict';

process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('tape');
const proxyquire = require('proxyquire');

const {
  buildCaptureWindowScript,
  buildCaptureDisplayScript,
  captureWindowByHint,
  captureDisplayByBounds,
  captureForegroundWindow
} = require('../lib/windows-window-capture');
const { captureElectronWindowByHint } = require('../lib/ipc-shell');

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

test('native desktop capture treats display bounds as encoded data', t => {
  const bounds = { x: -1920, y: 0, width: 1920, height: 1080 };
  const script = buildCaptureDisplayScript(bounds);
  t.notOk(script.includes(JSON.stringify(bounds)), 'raw bounds are not interpolated as executable PowerShell');
  t.ok(script.includes('FromBase64String'), 'display bounds are decoded as data');
  t.ok(script.includes('CopyFromScreen'), 'the fallback captures actual composed desktop pixels');
  t.end();
});

test('native desktop capture decodes a bounded PowerShell result', async t => {
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const result = await captureDisplayByBounds({ x: 0, y: 0, width: 1920, height: 1080 }, {
    execFile: (file, args, options, callback) => {
      t.equal(file, 'powershell.exe', 'the bounded Windows helper is used');
      t.ok(args.includes('-EncodedCommand'), 'the script is passed without shell interpolation');
      callback(null, JSON.stringify({
        success: true,
        width: 1920,
        height: 1080,
        blank: false,
        pngBase64: png.toString('base64')
      }), '');
    }
  });
  t.equal(result.size.width, 1920);
  t.equal(result.size.height, 1080);
  t.ok(result.png.equals(png), 'the native desktop PNG is decoded exactly');
  t.end();
});

test('native foreground capture resolves the actual active window without a guessed label', async t => {
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const result = await captureForegroundWindow({
    execFile: (file, args, options, callback) => {
      const encodedIndex = args.indexOf('-EncodedCommand') + 1;
      const script = Buffer.from(args[encodedIndex], 'base64').toString('utf16le');
      t.ok(script.includes('GetForegroundWindow'), 'the OS foreground handle is authoritative');
      t.notOk(script.includes('windowMatches = @('), 'foreground capture does not guess from process-name matches');
      callback(null, JSON.stringify({
        success: true,
        width: 1280,
        height: 800,
        blank: false,
        windowTitle: 'Claude',
        processName: 'claude',
        pngBase64: png.toString('base64')
      }), '');
    }
  });
  t.equal(result.windowTitle, 'Claude');
  t.equal(result.processName, 'claude');
  t.ok(result.png.equals(png), 'the foreground window bytes are retained');
  t.end();
});

test('Electron window capture resolves the known preview title before using desktop pixels', async t => {
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const image = {
    isEmpty: () => false,
    toPNG: () => png,
    getSize: () => ({ width: 1280, height: 720 })
  };
  const result = await captureElectronWindowByHint('This is Life', { width: 1920, height: 1080 }, {
    getSources: async options => {
      t.deepEqual(options.types, ['window'], 'the fallback asks for application windows, not another display frame');
      return [
        { name: 'Unrelated', thumbnail: image },
        { name: 'This is Life', thumbnail: image }
      ];
    }
  });
  t.equal(result.windowTitle, 'This is Life', 'the exact known preview window is selected');
  t.ok(result.png.equals(png), 'the non-empty Electron window thumbnail is retained');
  t.end();
});

test('native named-window capture rejects a uniform frame as non-evidence', async t => {
  try {
    await captureWindowByHint('This is Life', {
      execFile: (file, args, options, callback) => callback(null, JSON.stringify({
        success: true,
        width: 800,
        height: 600,
        windowTitle: 'This is Life',
        processName: 'python',
        blank: true,
        pngBase64: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
      }), '')
    });
    t.fail('a uniform frame must not be accepted as screenshot evidence');
  } catch (error) {
    t.match(error.message, /empty or uniform frame/i, 'the caller gets a specific recoverable capture error');
  }
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
      displayCapture: async () => { throw new Error('desktop unavailable'); },
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

test('full-display capture still fails closed when both desktop backends stay empty', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
  const ipcShell = emptyDesktopShell(userData, 1);
  try {
    await ipcShell.captureDesktopScreenshot(workspace, '', 'capture', {
      retryDelayMs: 0,
      displayCapture: async () => { throw new Error('native desktop unavailable'); },
      foregroundCapture: async () => { throw new Error('foreground unavailable'); }
    });
    t.fail('a cropped window must not silently replace a requested full-display capture');
  } catch (error) {
    t.match(error.message, /screen image was empty/i, 'coordinate-bearing display evidence still fails safely');
  }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

test('a bare desktop request falls back to the foreground application when every display backend is unavailable', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
  const ipcShell = emptyDesktopShell(userData, 1);
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const shot = await ipcShell.captureDesktopScreenshot(workspace, '', 'capture', {
    retryDelayMs: 0,
    displayCapture: async () => { throw new Error('native display unavailable'); },
    foregroundCapture: async () => ({
      png,
      size: { width: 1280, height: 800 },
      windowTitle: 'Claude',
      processName: 'claude'
    })
  });
  t.equal(shot.captureMode, 'application_window', 'cropped fallback is never mislabeled as desktop-coordinate evidence');
  t.equal(shot.captureBackend, 'windows_foreground', 'diagnostics identify the last-resort backend');
  t.equal(shot.windowTitle, 'Claude', 'the captured foreground window is named');
  t.ok(fs.readFileSync(path.join(workspace, shot.rel)).equals(png), 'foreground pixels are persisted and attachable');
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

test('full-display capture falls back to native Windows desktop pixels', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
  const ipcShell = emptyDesktopShell(userData, 1);
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  let receivedBounds = null;
  const shot = await ipcShell.captureDesktopScreenshot(workspace, '', 'capture', {
    retryDelayMs: 0,
    displayCapture: async bounds => {
      receivedBounds = bounds;
      return { png, size: { width: 1920, height: 1080 } };
    }
  });
  t.deepEqual(receivedBounds, { x: 0, y: 0, width: 1920, height: 1080 }, 'the selected display bounds reach the native backend');
  t.equal(shot.captureMode, 'display', 'native fallback remains coordinate-bearing full-display evidence');
  t.equal(shot.captureBackend, 'windows_native', 'the fallback backend is explicit for diagnostics');
  t.equal(shot.displayId, 'primary', 'the selected monitor identity is preserved');
  t.ok(fs.readFileSync(path.join(workspace, shot.rel)).equals(png), 'native desktop bytes are persisted normally');
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

test('a blank first desktop frame is retried before giving up, with no window hint required', async t => {
  // Reproduces the exact bare "screenshot my desktop" failure: capture_screen with no preceding
  // preview_app and no window hint to fall back to. Before this fix, a single transient empty
  // frame (the documented DXGI/secure-desktop/GPU-compositor case -- see the captureRetries
  // comment on captureDesktopScreenshot) failed the whole capture on the first try with zero
  // recovery attempt.
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
  const primary = {
    id: 'primary',
    label: 'Primary',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1
  };
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  let callCount = 0;
  const ipcShell = proxyquire('../lib/ipc-shell', {
    electron: {
      screen: { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary] },
      desktopCapturer: {
        getSources: async () => {
          callCount += 1;
          // Blank on the first two attempts, a real frame on the third -- exactly the
          // transient-then-clears shape a secure-desktop/UAC transition would produce.
          const isEmpty = callCount < 3;
          return [{
            display_id: 'primary',
            thumbnail: {
              isEmpty: () => isEmpty,
              toPNG: () => png,
              getSize: () => ({ width: 1920, height: 1080 }),
              toBitmap: () => Buffer.alloc(0)
            }
          }];
        }
      },
      app: { getPath: () => userData }
    }
  });

  const shot = await ipcShell.captureDesktopScreenshot(workspace, '', 'capture', { retryDelayMs: 0 });
  t.equal(callCount, 3, 'the third attempt is the one that finally sees a real frame');
  t.equal(shot.captureMode, 'display', 'a recovered full-desktop capture is still valid coordinate evidence');
  t.ok(shot.png.equals(png), 'the recovered frame bytes are returned');

  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});

test('the desktop-frame retry budget is bounded, not unlimited', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-user-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-window-fallback-ws-'));
  const primary = {
    id: 'primary',
    label: 'Primary',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1
  };
  let callCount = 0;
  const ipcShell = proxyquire('../lib/ipc-shell', {
    electron: {
      screen: { getPrimaryDisplay: () => primary, getAllDisplays: () => [primary] },
      desktopCapturer: {
        getSources: async () => {
          callCount += 1;
          return [{ display_id: 'primary', thumbnail: { isEmpty: () => true } }];
        }
      },
      app: { getPath: () => userData }
    }
  });

  try {
    await ipcShell.captureDesktopScreenshot(workspace, '', 'capture', {
      retryDelayMs: 0,
      captureRetries: 1,
      displayCapture: async () => { throw new Error('native desktop unavailable'); },
      foregroundCapture: async () => { throw new Error('foreground unavailable'); }
    });
    t.fail('an always-empty desktop must still fail once the retry budget is exhausted');
  } catch (error) {
    t.equal(callCount, 2, 'exactly one retry beyond the first attempt when captureRetries is 1');
    t.match(error.message, /screen image was empty/i, 'the final failure is still the clear, existing error');
  }

  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  t.end();
});
