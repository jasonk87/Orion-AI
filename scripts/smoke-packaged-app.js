#!/usr/bin/env node
/**
 * Packaged-app smoke test.
 *
 * The unit suite loads renderer.js and agent.js through Node's module loader, which gives
 * each file its own scope and hands it require/process/module. The packaged app loads them
 * as plain <script> tags sharing ONE browser global scope with no Node globals. Whole classes
 * of failure live only in that gap — duplicate top-level const across scripts, an unguarded
 * Node global, an unescaped backtick in a prompt template literal that parses fine but throws
 * at load — and every one of them keeps the unit suite green while the shipped .exe hangs on
 * "Agent engine is loading..." forever.
 *
 * This launches the real packaged executable, drives it over the Chrome DevTools Protocol,
 * and fails if any script threw during load or if the agent engine never attached.
 *
 * Usage:  node scripts/smoke-packaged-app.js [--port 9222] [--app <path to .exe>]
 * Expects `npm run package` to have been run first.
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = { port: 9222, app: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--app') args.app = argv[++i];
  }
  return args;
}

function resolveAppPath(explicit) {
  // Normalized because spawn() on Windows rejects a forward-slash path with EFTYPE.
  if (explicit) return path.resolve(explicit);
  const candidates = [
    path.join(repoRoot, 'dist', 'OrionAI-win32-x64', 'OrionAI.exe'),
    path.join(repoRoot, 'dist', 'OrionAI-linux-x64', 'OrionAI'),
    path.join(repoRoot, 'dist', 'OrionAI-darwin-x64', 'OrionAI.app', 'Contents', 'MacOS', 'OrionAI')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No packaged app found. Looked in:\n  ${candidates.join('\n  ')}\nRun "npm run package" first.`
  );
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDebugTarget(port, timeoutMs, isDead = () => null) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    // Fail fast and specifically instead of burning the whole timeout. Exit code 0 before a
    // window appears is the signature of Orion's single-instance lock rejecting this launch.
    const dead = isDead();
    if (dead) {
      throw new Error(
        `App exited before exposing a debug target (code=${dead.code}, signal=${dead.signal}).` +
        (dead.code === 0 ? ' Exit code 0 usually means another Orion instance holds the single-instance lock.' : '')
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      // The auto-update splash is also a page target, served from a data: URL. Match only
      // the real app window (a file:// URL ending in index.html) so the smoke test cannot
      // attach to the splash and then lose it when the app relaunches.
      const page = targets.find(target =>
        target.type === 'page' &&
        /^file:/i.test(String(target.url || '')) &&
        /index\.html$/i.test(String(target.url || '').split('?')[0]));
      if (page && page.webSocketDebuggerUrl) return page;
      lastError = `targets: ${targets.map(t => `${t.type}:${String(t.url).slice(0, 60)}`).join(', ') || 'none'}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for a debuggable app window on port ${port} (${lastError})`);
}

// Minimal CDP client. Electron exposes a plain WebSocket endpoint; Node 22+ has a global
// WebSocket, so this needs no dependency.
function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    const events = [];

    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            setTimeout(() => {
              if (pending.delete(id)) rej(new Error(`CDP ${method} timed out`));
            }, 30000);
          });
        },
        events,
        close: () => { try { socket.close(); } catch (_) {} }
      });
    });

    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(`${message.error.message} (${message.error.code})`));
        else res(message.result);
      } else if (message.method) {
        events.push(message);
      }
    });

    socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)));
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch (_) { /* already gone */ }
}

function describeException(event) {
  const details = event.params && event.params.exceptionDetails;
  if (!details) return 'unknown exception';
  const description = (details.exception && details.exception.description) || details.text;
  const where = details.url ? ` (${details.url}:${details.lineNumber})` : '';
  return `${description}${where}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const appPath = resolveAppPath(args.app);
  const failures = [];

  // Orion holds a single-instance lock keyed on its user-data directory. Without an isolated
  // one, launching here while a real Orion is open makes this process quit instantly with
  // code 0 and the smoke test "fails" for the wrong reason. An isolated directory also means
  // the smoke test starts from clean state and can never touch real conversations.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-smoke-'));
  console.log(`Launching ${appPath}`);
  console.log(`  port=${args.port} user-data-dir=${userDataDir}`);

  const child = spawn(appPath, [
    `--remote-debugging-port=${args.port}`,
    `--user-data-dir=${userDataDir}`
  ], {
    env: {
      ...process.env,
      // Without this the packaged app resolves this very repo as its update source and
      // relaunches itself out from under the smoke test.
      ORION_DISABLE_AUTO_UPDATE: '1'
    },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stderrChunks = [];
  child.stdout.on('data', d => process.stdout.write(`  [app] ${d}`));
  child.stderr.on('data', d => { stderrChunks.push(String(d)); process.stdout.write(`  [app:err] ${d}`); });

  let exitedEarly = null;
  child.on('exit', (code, signal) => { exitedEarly = { code, signal }; });

  let cdp = null;
  try {
    const target = await waitForDebugTarget(args.port, 90000, () => exitedEarly);
    console.log(`Attached to ${target.url}`);

    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');

    // Reload so every script load is observed from the very beginning.
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(9000); // covers the renderer's own 3s boot assertion

    const exceptions = cdp.events
      .filter(e => e.method === 'Runtime.exceptionThrown')
      .map(describeException);
    for (const exception of exceptions) failures.push(`Uncaught exception during load: ${exception}`);

    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text}`);
      return result.result.value;
    };

    // The load-bearing assertion: agent.js finished evaluating and published the engine.
    // This is what breaks when a top-level throw aborts the rest of the file.
    const engineType = await evaluate('typeof window.runAgentLoop');
    if (engineType !== 'function') {
      failures.push(`window.runAgentLoop is "${engineType}", expected "function" — an app script threw while loading`);
    }

    const rendererReady = await evaluate('typeof window.renderAiMessage');
    if (rendererReady !== 'function') {
      failures.push(`window.renderAiMessage is "${rendererReady}", expected "function" — renderer.js did not finish loading`);
    }

    // The in-page crash trap records anything it caught, including faults that happened
    // before this script attached.
    const trapped = await evaluate('(window.__orionFaults || []).map(f => f.kind + ": " + f.detail)');
    for (const fault of trapped || []) failures.push(`Renderer crash trap recorded: ${fault}`);

    const title = await evaluate('document.title');
    console.log(`Window loaded: "${title}"`);

    if (failures.length === 0) console.log('\nSmoke test PASSED: packaged app booted with no script faults.');
  } catch (error) {
    failures.push(error.message);
    if (exitedEarly) {
      failures.push(`App exited early (code=${exitedEarly.code}, signal=${exitedEarly.signal}). stderr:\n${stderrChunks.join('')}`);
    }
  } finally {
    if (cdp) cdp.close();
    killTree(child.pid);
    await sleep(500);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* temp dir */ }
  }

  if (failures.length) {
    console.error('\nSmoke test FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(error => {
  console.error('Smoke test crashed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
