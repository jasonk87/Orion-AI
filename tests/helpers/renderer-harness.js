// Executes renderer.js the way the packaged app does: as a plain script evaluated against
// one shared browser global scope, over the real index.html DOM, with no Node globals.
//
// This matters more than convenience. Node's `require` gives renderer.js its own module
// scope and hands it `require`/`process`/`module`, so require-based tests silently pass on
// the exact bugs that break the packaged app — top-level const collisions across scripts,
// unguarded Node globals, anything that depends on load order. Evaluating the real source
// in a real (jsdom) window reproduces production semantics, so those failures surface here
// instead of in the shipped .exe.
//
// The real index.html is used deliberately: if renderer.js reads an element id that the
// markup no longer defines, `el.thing` is null here exactly as it would be in the app.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repoRoot = path.join(__dirname, '..', '..');

function readIndexHtmlWithoutScripts() {
  return fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8')
    // Drop <script src=...> (node_modules bundles and the app scripts) and inline scripts:
    // the harness evaluates exactly the source under test and nothing else.
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '');
}

// Records every IPC call so tests can assert on what the renderer asked the main process to
// do. Unstubbed methods resolve to { success: true } so the renderer's optimistic paths run.
function createApiStub(overrides = {}) {
  const calls = [];
  const target = { __calls: calls };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === '__calls') return calls;
      if (typeof prop !== 'string') return obj[prop];
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
        return (...args) => {
          calls.push({ method: prop, args });
          return overrides[prop](...args);
        };
      }
      return async (...args) => {
        calls.push({ method: prop, args });
        return { success: true };
      };
    },
    has() { return true; }
  });
}

/**
 * Load renderer.js into a fresh jsdom window.
 *
 * @param {object} [options]
 * @param {object} [options.api]      Overrides for specific window.api methods.
 * @param {boolean} [options.noApi]   Omit window.api entirely, reproducing a failed preload.
 * @param {boolean} [options.trap]    Also install index.html's crash trap before the renderer.
 * @param {object} [options.globals]  Extra globals to define before evaluation.
 * @param {object} [options.set]      Module-scope `let` bindings to assign (e.g. currentWorkspace).
 * @param {string[]} [options.expose] Top-level const/let names to publish for inspection.
 * @param {object} [options.t]        Tape test object; registers automatic teardown.
 * @returns {{win: object, api: object, calls: Array, expose: object, cleanup: Function}}
 */
function loadRenderer(options = {}) {
  const dom = new JSDOM(readIndexHtmlWithoutScripts(), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // An http origin, not file://, because jsdom treats file:// as an opaque origin and
    // throws SecurityError on localStorage. Electron's file:// renderer has working
    // localStorage, so the opaque-origin restriction is a jsdom artifact that would
    // otherwise fail renderer code which is correct in the real app.
    url: 'http://localhost/index.html'
  });
  const win = dom.window;

  // index.html loads these before renderer.js; the harness supplies equivalents so the
  // renderer's markdown/highlighting paths run without pulling in the real bundles.
  win.marked = {
    use() {},
    setOptions() {},
    parse: (text) => String(text == null ? '' : text)
  };
  win.Prism = { highlightAll() {}, highlightAllUnder() {}, highlight: (code) => code, languages: {} };

  const api = createApiStub(options.api || {});
  // noApi reproduces a failed preload bridge: window.api simply does not exist, which is
  // what turns every main-process call in the renderer into a TypeError.
  if (!options.noApi) win.api = api;

  // The crash trap normally runs from index.html before any app script. Tests that care
  // how the renderer REPORTS a fault need it present; the rest do not.
  if (options.trap) {
    const inline = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/);
    if (inline) win.eval(inline[1]);
  }

  for (const [key, value] of Object.entries(options.globals || {})) win[key] = value;

  // Top-level `function` declarations land on the window, but `const`/`let` stay in the
  // eval's own scope. Anything a test needs to inspect (the `el` element map, tuning
  // constants) is republished by an epilogue appended to the SAME eval, so the harness
  // reads real bindings without renderer.js needing a test-only export block.
  const exposeNames = Array.isArray(options.expose) ? options.expose : [];
  // `set` assigns module-scope `let` bindings (currentWorkspace, appConfig, conversations...).
  // Assigning window.currentWorkspace from outside does nothing — the renderer's own code reads
  // the closure binding, not a window property — so a test that "set up state" that way was
  // silently exercising the empty-state path instead.
  const setBindings = options.set && typeof options.set === 'object' ? options.set : {};
  const epilogue = [
    ...Object.entries(setBindings).map(([name, value]) =>
      `try { ${name} = ${JSON.stringify(value)}; } catch (_) {}`),
    ...exposeNames.map(name =>
      `try { window.__exposed[${JSON.stringify(name)}] = ${name}; } catch (_) {}`),
    // `expose` is a snapshot taken at load. This reader stays live: it is DEFINED inside the
    // renderer's own eval scope, so the direct eval() inside it resolves module-scope bindings
    // that a later, separate win.eval() cannot see. Needed to observe state the renderer mutates
    // after load (appConfig after a settings save, conversations after a reload).
    'try { window.__readBinding = function (name) { return eval(name); }; } catch (_) {}'
  ].join('\n');

  // jsdom finishes parsing AFTER this eval, so it fires DOMContentLoaded on its own and the
  // renderer's full async boot starts behind every test's back. That boot then outlives
  // win.close() in teardown and throws "Cannot read properties of undefined (reading
  // 'getElementById')" from a dead window, killing the whole test process.
  //
  // The handler is captured instead of registered, so boot only ever runs when a test asks
  // for it — and runs synchronously under that test's control.
  const domReadyHandlers = [];
  const nativeAddEventListener = win.document.addEventListener.bind(win.document);
  win.document.addEventListener = (type, handler, ...rest) => {
    if (type === 'DOMContentLoaded') {
      domReadyHandlers.push(handler);
      return undefined;
    }
    return nativeAddEventListener(type, handler, ...rest);
  };

  win.__exposed = {};
  const source = fs.readFileSync(path.join(repoRoot, 'renderer.js'), 'utf8');
  win.eval(epilogue ? `${source}\n;${epilogue}\n` : source);

  // renderer.js installs a polling interval at load; closing the window clears jsdom's
  // timers so a test file cannot outlive its assertions and trip the runner timeout.
  const cleanup = () => { try { win.close(); } catch (_) {} };
  if (options.t && typeof options.t.teardown === 'function') options.t.teardown(cleanup);

  // Runs the renderer's DOMContentLoaded boot on demand and waits for it, so a test that wants
  // startup behavior gets it deterministically instead of racing jsdom's parser.
  const boot = async () => {
    for (const handler of domReadyHandlers) await handler({ type: 'DOMContentLoaded' });
    return loaded;
  };

  // Live read of any module-scope binding, for state the renderer mutates after load.
  const read = (name) => (typeof win.__readBinding === 'function' ? win.__readBinding(name) : undefined);

  const loaded = { win, api, calls: api.__calls, expose: win.__exposed, read, boot, cleanup };
  return loaded;
}

module.exports = { loadRenderer, readIndexHtmlWithoutScripts, createApiStub };
