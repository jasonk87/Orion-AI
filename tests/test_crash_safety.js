// Orion runs multi-minute agent loops holding live state in the renderer. Two failure
// modes used to lose a run with no evidence: an unhandled rejection in main ended the
// process outright (Node's default since v15), and a renderer crash or a top-level throw
// in any app script left the window dead or stuck on "Agent engine is loading..." forever.
//
// These tests EXECUTE the crash trap rather than grepping for it — the trap's whole job is
// to work when the rest of the app has failed, which a source-text assertion cannot show.

const test = require('tape');
const fs = require('fs');
const path = require('path');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

const repoRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

const main = proxyquire('../main.js', {
  electron: {
    app: { whenReady: () => ({ then: () => {} }), on: () => {} },
    BrowserWindow: class {
      constructor() {}
      loadFile() {}
      isDestroyed() { return true; }
      static getAllWindows() { return []; }
      get webContents() { return { send: () => {} }; }
    },
    ipcMain: { on: () => {}, handle: () => {} },
    dialog: {}
  }
});

// ── Main process ───────────────────────────────────────────────────────────────

test('describeFault preserves diagnostic detail for every thrown shape', (t) => {
  const error = new Error('boom');
  t.ok(main.describeFault(error).includes('boom'), 'keeps an Error message');
  t.ok(main.describeFault(error).includes('test_crash_safety'), 'keeps the stack, which is the actionable part');
  t.equal(main.describeFault('plain string reason'), 'plain string reason', 'passes strings through');
  t.equal(main.describeFault({ code: 'ENOENT' }), '{"code":"ENOENT"}', 'serializes object reasons');

  const circular = { name: 'loop' };
  circular.self = circular;
  t.doesNotThrow(() => main.describeFault(circular), 'a circular reason cannot crash the crash handler');
  t.end();
});

test('renderer reload guard recovers from crashes but refuses an infinite reload loop', (t) => {
  const stamps = [];
  const start = 1_000_000;

  for (let i = 1; i <= main.MAX_RENDERER_RELOADS; i++) {
    t.ok(main.shouldReloadCrashedRenderer(stamps, start + i * 100), `reload ${i} is allowed`);
  }
  t.notOk(
    main.shouldReloadCrashedRenderer(stamps, start + 400),
    'the crash after the limit stops reloading instead of thrashing the window forever'
  );

  // Crashes spaced further apart than the window are unrelated incidents, not a loop.
  const later = start + main.RENDERER_RELOAD_WINDOW_MS + 5000;
  t.ok(main.shouldReloadCrashedRenderer(stamps, later), 'an isolated crash later on is recovered again');
  t.equal(stamps.length, 1, 'timestamps outside the window are pruned rather than accumulating');
  t.end();
});

test('process crash handlers keep the app alive instead of exiting mid-run', (t) => {
  const priorRejection = process.listeners('unhandledRejection');
  const priorException = process.listeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.removeAllListeners('uncaughtException');

  const consoleError = sinon.stub(console, 'error');
  const consoleWarn = sinon.stub(console, 'warn');
  try {
    main.installProcessCrashHandlers();
    t.equal(process.listeners('unhandledRejection').length, 1, 'an unhandledRejection handler is installed');
    t.equal(process.listeners('uncaughtException').length, 1, 'an uncaughtException handler is installed');

    // The handler must absorb the fault. If it rethrows, the process still dies.
    t.doesNotThrow(
      () => process.listeners('uncaughtException')[0](new Error('simulated main fault')),
      'an uncaught exception is absorbed, not re-thrown'
    );
    t.doesNotThrow(
      () => process.listeners('unhandledRejection')[0]('simulated rejection'),
      'an unhandled rejection is absorbed, not re-thrown'
    );
    t.ok(consoleError.called || consoleWarn.called, 'the fault is reported rather than silently swallowed');
  } finally {
    consoleWarn.restore();
    consoleError.restore();
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    for (const handler of priorRejection) process.on('unhandledRejection', handler);
    for (const handler of priorException) process.on('uncaughtException', handler);
  }
  t.end();
});

// ── Renderer trap ──────────────────────────────────────────────────────────────

// Windows are closed via t.teardown so the trap's real 3s boot timer cannot outlive its
// test, keep the process alive, and trip the runner's per-file timeout.
function bootTrap(t) {
  // The trap is the first inline <script> in index.html.
  const inline = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!inline) throw new Error('index.html no longer contains an inline crash trap script');

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const win = dom.window;
  if (t) t.teardown(() => win.close());
  const reported = [];
  win.api = {
    reportRendererFault: (kind, detail) => reported.push({ kind, detail }),
    onMainFault: (cb) => { win.__mainFaultCallback = cb; }
  };
  win.eval(inline[1]);
  return { win, reported, bannerText: () => {
    const body = win.document.getElementById('orion-fault-banner-body');
    return body ? body.textContent : '';
  } };
}

test('the crash trap is installed before any app script can throw', (t) => {
  const firstInline = indexHtml.indexOf('<script>');
  const firstSrc = indexHtml.indexOf('<script src=');
  t.ok(firstInline !== -1, 'an inline trap script exists');
  t.ok(firstInline < firstSrc, 'it runs before the first external script, so load-time throws are caught');
  t.end();
});

test('a script error surfaces in the UI and reaches the main-process crash log', (t) => {
  const { win, reported, bannerText } = bootTrap(t);

  const event = new win.ErrorEvent('error', { message: 'kaboom', error: new win.Error('kaboom') });
  win.dispatchEvent(event);

  t.equal(win.__orionFaults.length, 1, 'the fault is recorded in-page');
  t.equal(win.__orionFaults[0].kind, 'error', 'it is classified as a script error');
  t.ok(bannerText().includes('kaboom'), 'the user sees the real error text instead of a silent hang');
  t.equal(reported.length, 1, 'it is forwarded over IPC');
  t.equal(reported[0].kind, 'error', 'the forwarded fault keeps its kind');
  t.ok(reported[0].detail.includes('kaboom'), 'the forwarded fault keeps its detail');
  t.end();
});

test('a failed <script> load is reported with the file that did not load', (t) => {
  const { win, reported, bannerText } = bootTrap(t);

  const script = win.document.createElement('script');
  script.src = 'agent.js';
  win.document.body.appendChild(script);
  const event = new win.Event('error');
  Object.defineProperty(event, 'target', { value: script });
  win.dispatchEvent(event);

  t.equal(win.__orionFaults[0].kind, 'script-load', 'a load failure is distinguished from a runtime error');
  t.ok(bannerText().includes('agent.js'), 'names the script that failed to load');
  t.equal(reported[0].kind, 'script-load', 'the load failure reaches main');
  t.end();
});

test('an unhandled promise rejection in the renderer is caught', (t) => {
  const { win, reported, bannerText } = bootTrap(t);

  const event = new win.Event('unhandledrejection');
  event.reason = new win.Error('async blew up');
  win.dispatchEvent(event);

  t.equal(win.__orionFaults[0].kind, 'unhandledrejection', 'rejections are trapped, not just throws');
  t.ok(bannerText().includes('async blew up'), 'the rejection reason is shown');
  t.equal(reported.length, 1, 'the rejection reaches main');
  t.end();
});

test('the boot assertion reports a dead agent engine instead of hanging forever', (t) => {
  const { win, reported, bannerText } = bootTrap(t);
  const clock = sinon.useFakeTimers({ toFake: ['setTimeout'], global: win });

  try {
    // Simulate the documented failure: scripts "load" but a top-level throw meant the
    // engine never attached, so window.runAgentLoop is missing.
    win.dispatchEvent(new win.Event('load'));
    clock.tick(3100);

    t.equal(win.__orionFaults.length, 1, 'the missing engine is detected');
    t.equal(win.__orionFaults[0].kind, 'boot', 'it is classified as a boot failure');
    t.ok(bannerText().includes('runAgentLoop'), 'the banner names the exact missing entrypoint');
    t.ok(bannerText().includes('Conversations on disk are unaffected'), 'the user is told their data is safe');
    t.equal(reported.length, 1, 'the boot failure is logged to disk for post-hoc diagnosis');
  } finally {
    clock.restore();
  }
  t.end();
});

test('a healthy boot stays silent', (t) => {
  const { win, reported, bannerText } = bootTrap(t);
  const clock = sinon.useFakeTimers({ toFake: ['setTimeout'], global: win });

  try {
    win.runAgentLoop = function () {};
    win.dispatchEvent(new win.Event('load'));
    clock.tick(3100);

    t.equal(win.__orionFaults.length, 0, 'no fault is recorded when the engine started');
    t.equal(bannerText(), '', 'no banner is shown on a healthy boot');
    t.equal(reported.length, 0, 'nothing is logged on a healthy boot');
  } finally {
    clock.restore();
  }
  t.end();
});

test('main-process faults are surfaced in the renderer UI', (t) => {
  const { win, bannerText } = bootTrap(t);
  t.ok(typeof win.__mainFaultCallback === 'function', 'the renderer subscribes to main-process faults');

  win.__mainFaultCallback({ scope: 'unhandledRejection', detail: 'provider request never settled' });
  t.ok(bannerText().includes('provider request never settled'), 'a backend fault becomes visible instead of a hang');
  t.end();
});

test('the trap survives a hostile environment', (t) => {
  const inline = indexHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const win = dom.window;
  t.teardown(() => win.close());
  // No window.api at all: preload failed, or the trap ran before the bridge was ready.
  t.doesNotThrow(() => win.eval(inline), 'the trap installs without the preload bridge');

  const consoleError = sinon.stub(console, 'error');
  try {
    t.doesNotThrow(
      () => win.dispatchEvent(new win.ErrorEvent('error', { message: 'no bridge', error: new win.Error('no bridge') })),
      'reporting a fault with no IPC bridge does not throw a second fault'
    );
  } finally {
    consoleError.restore();
  }
  t.equal(win.__orionFaults.length, 1, 'the fault is still recorded in-page');
  t.end();
});
