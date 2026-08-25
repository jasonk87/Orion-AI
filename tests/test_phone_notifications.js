process.env.NODE_ENV = 'test';

// A phone notification exists so you do NOT have to walk back to the desk to find out what
// happened. The old body for every pause was "Paused — needs your input" — which told you
// something needed attention but not what, so you had to go look anyway.
//
// Push delivery also had no visible failure mode on the desktop: notifyPhone's result was
// discarded with .catch(() => {}), so a phone that never subscribed (the normal state when the
// companion is served over plain HTTP, because the page refuses to subscribe outside a secure
// context) looked exactly like a phone that received everything.

const test = require('tape');
const sinon = require('sinon');
global.window = global.window || {};
global.fetch = global.fetch || (async () => ({ ok: false }));
const agent = require('../agent.js');

const build = (context) => agent.buildRunEndNotification(context);

// ── What the notification says ─────────────────────────────────────────────────

test('a clarifying question puts the actual question on your phone', (t) => {
  const note = build({
    conversation: {
      title: 'Fix action palette availability',
      awaitingClarification: {
        intro: 'A few quick design questions:',
        questions: [
          { header: 'Scope', question: 'Should unavailable actions be hidden or greyed out?' },
          { header: 'Order', question: 'Alphabetical or by domain?' }
        ]
      }
    },
    forceYield: true
  });

  t.equal(note.kind, 'question', 'classified as a question');
  t.ok(/Should unavailable actions be hidden or greyed out\?/.test(note.body),
    'the first real question is in the body — answerable without opening the app');
  t.ok(/Fix action palette/.test(note.title), 'the title names which task is asking');
  t.notOk(/needs your input/i.test(note.body), 'the useless generic text is gone');
  t.end();
});

test('question extraction handles every shape the tool can produce', (t) => {
  const extract = agent.firstClarifyingQuestionText;
  t.equal(extract({ questions: [{ question: 'Real question?' }] }), 'Real question?', 'reads .question');
  t.equal(extract({ questions: ['A bare string question?'] }), 'A bare string question?', 'reads a bare string');
  t.equal(extract({ questions: [{ header: 'Style' }] }), 'Style', 'falls back to the header chip');
  t.equal(extract({ questions: [], intro: 'Some intro' }), 'Some intro', 'falls back to the intro');
  t.equal(extract({ questions: [{}, { question: 'Second one?' }] }), 'Second one?', 'skips empty entries');
  t.equal(extract(null), '', 'null does not throw');
  t.equal(extract({}), '', 'a malformed clarification does not throw');
  t.end();
});

test('a plan waiting for approval says so', (t) => {
  const note = build({
    conversation: { title: 'Add family last name tracking', awaitingPlanApproval: true },
    forceYield: true
  });
  t.equal(note.kind, 'plan-approval', 'classified as needing approval');
  t.ok(/approval/i.test(note.body), 'the body names the action you need to take');
  t.ok(/family last name/.test(note.title), 'and which plan it is');
  t.end();
});

test('a repeated-failure pause names the tool and the error', (t) => {
  const note = build({
    conversation: { title: 'Sync VISION.md' },
    forceYield: true,
    forcedYieldFailure: { toolName: 'run_command', failureCount: 3, error: 'python is not recognized' }
  });
  t.equal(note.kind, 'repeated-failure', 'classified as a repeated failure');
  t.ok(/run_command/.test(note.body), 'names the failing tool');
  t.ok(/3x/.test(note.body), 'names how many times it failed');
  t.ok(/python is not recognized/.test(note.body), 'carries the actual error');
  t.end();
});

test('an unexplained pause still notifies rather than going silent', (t) => {
  const note = build({ conversation: { title: 'Something' }, forceYield: true });
  t.equal(note.kind, 'paused', 'falls back to the generic pause');
  t.ok(note.body, 'a notification is still produced');
  t.end();
});

test('terminal outcomes carry their result', (t) => {
  const done = build({
    conversation: { title: 'Update README' },
    finalizedTaskState: 'completed',
    lastTextResponse: 'Updated README.md and CHANGELOG.md for v0.6.0.'
  });
  t.equal(done.kind, 'completed', 'completion is classified');
  t.ok(/Updated README/.test(done.body), 'the answer summary is on the phone');

  const failed = build({
    conversation: { title: 'Fix F3' },
    finalizedTaskState: 'failed',
    criticalRunError: new Error('DeepSeek API HTTP 400: Invalid assistant message')
  });
  t.equal(failed.kind, 'failed', 'failure is classified');
  t.ok(/HTTP 400/.test(failed.body), 'the real error reaches the phone instead of "open Orion"');

  t.equal(build({ conversation: {}, finalizedTaskState: 'cancelled' }).kind, 'cancelled', 'a stop is classified');
  t.equal(build({ conversation: {}, ranOutOfLoopBudget: true }).kind, 'action-limit', 'the action limit is classified');
  t.end();
});

test('a mid-plan continuation stays silent', (t) => {
  // Buzzing on every continuation of a long plan trains you to ignore the notifications.
  t.equal(build({ conversation: { title: 'x' }, finalizedTaskState: 'pending' }), null,
    'a pending continuation sends nothing');
  t.equal(build({ conversation: { title: 'x' }, autoContinueExecution: true }), null,
    'an auto-continue sends nothing');
  t.end();
});

test('notification text is bounded and single-line', (t) => {
  const note = build({
    conversation: { title: 'T'.repeat(300) },
    finalizedTaskState: 'completed',
    lastTextResponse: 'line one\nline two\n\n   lots   of   space '.repeat(50)
  });
  t.ok(note.title.length <= 60, `title stays short (${note.title.length})`);
  t.ok(note.body.length <= 130, `body stays short (${note.body.length})`);
  t.notOk(/\n/.test(note.body), 'the body is single-line');
  t.notOk(/\s{2,}/.test(note.body), 'whitespace is collapsed');
  t.end();
});

test('a missing conversation never crashes the run', (t) => {
  // This runs inside runAgentLoop's finalization — a throw here would take down the run.
  t.doesNotThrow(() => build({}), 'an empty context does not throw');
  t.doesNotThrow(() => build({ conversation: null, forceYield: true }), 'a null conversation does not throw');
  const note = build({ conversation: null, finalizedTaskState: 'completed', lastTextResponse: 'done' });
  t.equal(note.title, 'Orion AI', 'falls back to a default title');
  t.end();
});

// ── Delivery diagnosis ─────────────────────────────────────────────────────────

test('a failed push is recorded with the reason instead of vanishing', (t) => {
  const warn = sinon.stub(console, 'warn');
  const reported = [];
  const diagnostics = [];
  global.window.api = { reportRendererFault: (kind, detail) => reported.push({ kind, detail }) };
  global.window.updatePhonePushDiagnostic = (outcome) => diagnostics.push(outcome);

  try {
    const outcome = agent.recordPhoneNotificationOutcome(
      { kind: 'question', title: 'Orion', body: 'Question: ...' },
      { success: false, phone: { success: false, reason: 'no subscribed phone devices' } }
    );

    t.equal(outcome.delivered, false, 'the failure is recorded');
    t.equal(outcome.reason, 'no subscribed phone devices', 'with the precise reason');
    t.equal(outcome.kind, 'question', 'and which notification it was');
    t.ok(warn.called, 'it is logged rather than silently swallowed');
    t.equal(reported.length, 1, 'it reaches the on-disk fault log');
    t.ok(/no subscribed phone devices/.test(reported[0].detail), 'the reason is in the fault log');
    t.equal(diagnostics.length, 1, 'the desktop pairing panel is told');
  } finally {
    warn.restore();
    delete global.window.api;
    delete global.window.updatePhonePushDiagnostic;
  }
  t.end();
});

test('a delivered push is recorded quietly', (t) => {
  const warn = sinon.stub(console, 'warn');
  try {
    const outcome = agent.recordPhoneNotificationOutcome(
      { kind: 'completed' },
      { success: true, phone: { success: true, sent: 2, failed: 0 } }
    );
    t.equal(outcome.delivered, true, 'delivery is recorded');
    t.equal(outcome.sent, 2, 'the device count is recorded');
    t.notOk(warn.called, 'a successful push produces no noise');
  } finally {
    warn.restore();
  }
  t.end();
});

test('recording an outcome never throws, whatever the IPC returned', (t) => {
  const warn = sinon.stub(console, 'warn');
  try {
    for (const result of [null, undefined, {}, { phone: null }, { success: false }, 'garbage']) {
      t.doesNotThrow(() => agent.recordPhoneNotificationOutcome({ kind: 'x' }, result),
        `handles ${JSON.stringify(result)} without throwing`);
    }
    t.doesNotThrow(() => agent.recordPhoneNotificationOutcome(null, null), 'handles a null notification');
  } finally {
    warn.restore();
  }
  t.end();
});

// ── Tailscale HTTPS route ──────────────────────────────────────────────────────
// Web Push refuses to subscribe outside a secure context, so the phone can only ever register
// a subscription if a Tailscale serve route forwards the tailnet hostname to the companion
// port. Asserted here because a missing route is silent: pairing appears to succeed and every
// notification then no-ops with "no subscribed phone devices".

const proxyquire = require('proxyquire');
const os = require('os');
const path = require('path');

function serverWithTailscale({ config = {}, statusOut = '', statusOk = true, applyOk = true, applyErr = '' }) {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const isStatus = args[1] === 'status';
    const listeners = {};
    const stream = { on: (evt, cb) => { if (evt === 'data' && isStatus && statusOut) cb(Buffer.from(statusOut)); } };
    const child = {
      stdout: stream,
      stderr: { on: (evt, cb) => { if (evt === 'data' && !isStatus && applyErr) cb(Buffer.from(applyErr)); } },
      on: (evt, cb) => { listeners[evt] = cb; },
      kill: () => {}
    };
    setImmediate(() => {
      const ok = isStatus ? statusOk : applyOk;
      if (listeners.close) listeners.close(ok ? 0 : 1);
    });
    return child;
  };
  const mod = proxyquire('../lib/ipc-server', {
    child_process: { spawn: fakeSpawn },
    './config': {
      readAppConfig: () => config,
      writeAppConfig: () => {},
      updateAppConfig: () => {},
      '@noCallThru': true
    },
    electron: { app: { getPath: () => os.tmpdir() }, BrowserWindow: class {}, Notification: class {} }
  });
  return { mod, calls };
}

test('the serve route is applied for a configured Tailscale origin', async (t) => {
  const { mod, calls } = serverWithTailscale({
    config: { phoneCompanionHttpsOrigin: 'https://orion-host.example-tailnet.ts.net' }
  });
  const result = await mod.ensureTailscaleServeRoute(45678);

  t.equal(result.applied, true, 'the route is applied');
  t.equal(result.target, 'http://127.0.0.1:45678', 'it targets the port the companion actually bound');
  t.ok(calls.some(c => /serve --bg --https=443 http:\/\/127\.0\.0\.1:45678/.test(c)),
    'it runs the serve command that gives the phone a secure context');
  t.end();
});

test('an already-present route is not re-applied', async (t) => {
  const { mod, calls } = serverWithTailscale({
    config: { phoneCompanionHttpsOrigin: 'https://desktop.tailnet.ts.net' },
    statusOut: 'https://desktop.tailnet.ts.net (tailnet only)\n|-- / proxy http://127.0.0.1:45678\n'
  });
  const result = await mod.ensureTailscaleServeRoute(45678);

  t.equal(result.alreadyRouted, true, 'the existing route is detected');
  t.notOk(calls.some(c => /--bg/.test(c)), 'no redundant serve command is issued');
  t.end();
});

test('the route is never published without the user opting in', async (t) => {
  // Publishing the companion onto a tailnet unasked would be a surprise, so an unset origin
  // means do nothing at all.
  const { mod, calls } = serverWithTailscale({ config: {} });
  const result = await mod.ensureTailscaleServeRoute(45678);
  t.equal(result.applied, false, 'nothing is applied');
  t.ok(/no phoneCompanionHttpsOrigin/.test(result.reason), 'and it says why');
  t.equal(calls.length, 0, 'the Tailscale CLI is never invoked');

  const nonTailscale = serverWithTailscale({ config: { phoneCompanionHttpsOrigin: 'https://example.com' } });
  const other = await nonTailscale.mod.ensureTailscaleServeRoute(45678);
  t.equal(other.applied, false, 'a non-Tailscale origin is left alone');
  t.equal(nonTailscale.calls.length, 0, 'and the CLI is not invoked for it');
  t.end();
});

test('Tailscale failures never block Orion from starting', async (t) => {
  const missingCli = proxyquire('../lib/ipc-server', {
    child_process: { spawn: () => { throw new Error('spawn tailscale ENOENT'); } },
    './config': {
      readAppConfig: () => ({ phoneCompanionHttpsOrigin: 'https://d.tailnet.ts.net' }),
      writeAppConfig: () => {}, updateAppConfig: () => {}, '@noCallThru': true
    },
    electron: { app: { getPath: () => os.tmpdir() }, BrowserWindow: class {}, Notification: class {} }
  });
  const noCli = await missingCli.ensureTailscaleServeRoute(45678);
  t.equal(noCli.applied, false, 'a missing Tailscale CLI is handled');
  t.ok(/unavailable/i.test(noCli.reason), 'and reported as unavailable rather than thrown');

  const { mod } = serverWithTailscale({
    config: { phoneCompanionHttpsOrigin: 'https://d.tailnet.ts.net' },
    applyOk: false,
    applyErr: 'needs login'
  });
  const failed = await mod.ensureTailscaleServeRoute(45678);
  t.equal(failed.applied, false, 'a failing serve command does not throw');
  t.ok(/needs login/.test(failed.reason), 'the real CLI error is carried through for diagnosis');

  const noPort = await mod.ensureTailscaleServeRoute(0);
  t.equal(noPort.applied, false, 'an unknown port is handled');
  t.end();
});

test('a hung serve is diagnosed as the tailnet setting that actually causes it', async (t) => {
  // Observed live: `tailscale serve --https=443` blocks forever when the tailnet cannot issue a
  // TLS cert, and reports only "timed out". The real cause is a console toggle, and the only
  // command that says so is `tailscale cert`.
  const seen = [];
  const fakeSpawn = (cmd, args) => {
    seen.push(args.join(' '));
    const isCert = args[0] === 'cert';
    const isServe = args[1] === '--bg';
    const listeners = {};
    const child = {
      stdout: { on: () => {} },
      stderr: {
        on: (evt, cb) => {
          if (evt === 'data' && isCert) {
            cb(Buffer.from('500 Internal Server Error: your Tailscale account does not support getting TLS certs'));
          }
        }
      },
      on: (evt, cb) => { listeners[evt] = cb; },
      kill: () => {}
    };
    // serve never calls back — exactly the observed hang.
    if (!isServe) setImmediate(() => listeners.close && listeners.close(1));
    return child;
  };

  const mod = proxyquire('../lib/ipc-server', {
    child_process: { spawn: fakeSpawn },
    './config': {
      readAppConfig: () => ({ phoneCompanionHttpsOrigin: 'https://orion-host.example-tailnet.ts.net' }),
      writeAppConfig: () => {}, updateAppConfig: () => {}, '@noCallThru': true
    },
    electron: { app: { getPath: () => os.tmpdir() }, BrowserWindow: class {}, Notification: class {} }
  });

  const result = await mod.ensureTailscaleServeRoute(45678, { serveTimeoutMs: 200 });
  t.equal(result.applied, false, 'the route is not applied');
  t.notOk(/timed out/i.test(result.reason), 'the useless "timed out" message is replaced');
  t.ok(/HTTPS certificates are not enabled/i.test(result.reason), 'the real cause is named');
  t.ok(/login\.tailscale\.com/.test(result.reason), 'and the exact place to fix it');
  t.ok(seen.some(c => /^cert /.test(c)), 'it asked tailscale cert for the real reason');
  t.end();
});

// ── Companion push client: authenticated calls ─────────────────────────────────
// The real reason existing pairings never produced a push subscription: subscribePush fetched
// the VAPID key with a bare fetch() instead of companionFetch. /api/vapid-public-key sits behind
// the companion auth gate, so it returned 401 COMPANION_CREDENTIAL_MISSING, publicKey came back
// undefined, and the flow bailed with "notification keys are missing" — on every device, every
// origin, forever. HTTPS was necessary but never sufficient; this would have blocked push anyway.

test('every authenticated companion API call carries credentials', (t) => {
  const fs = require('fs');
  const companionSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'companion-html.js'), 'utf8');

  // Bare fetch('/api/...') is only legitimate BEFORE credentials exist — i.e. pairing itself.
  const PRE_AUTH_ENDPOINTS = ['/api/pair'];
  const bareApiFetches = [...companionSource.matchAll(/(?<!companion)fetch\(\s*['"](\/api\/[a-z0-9-]+)/gi)]
    .map(match => match[1])
    .filter(endpoint => !PRE_AUTH_ENDPOINTS.includes(endpoint));

  t.deepEqual(bareApiFetches, [],
    `no authenticated endpoint is called without credentials (found: ${bareApiFetches.join(', ') || 'none'})`);

  t.ok(/companionFetch\('\/api\/vapid-public-key'\)/.test(companionSource),
    'the VAPID key is fetched with credentials');
  t.ok(/companionFetch\('\/api\/push-subscribe'/.test(companionSource),
    'the subscription is saved with credentials');
  t.end();
});

test('a rejected VAPID key request explains itself instead of blaming missing keys', (t) => {
  const fs = require('fs');
  const companionSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'companion-html.js'), 'utf8');
  // The old message ("notification keys are missing") pointed at the server when the real
  // problem was this device's credentials, which sent every diagnosis in the wrong direction.
  t.ok(/keyRes\.status === 401/.test(companionSource), 'a 401 is distinguished from a real key failure');
  t.ok(/rejected this device/.test(companionSource), 'and reported as a device-credential problem');
  t.notOk(/'Phone push is unavailable: notification keys are missing\.'/.test(companionSource),
    'the misleading blanket message is gone');
  t.end();
});

test('the companion page is still syntactically valid after edits', (t) => {
  // companion-html.js builds the whole phone page inside a JS template literal, so an unescaped
  // backtick in the page source silently breaks the module at load — the same class of failure
  // that has taken out agent.js before.
  t.doesNotThrow(() => {
    delete require.cache[require.resolve('../lib/companion-html')];
    require('../lib/companion-html');
  }, 'lib/companion-html.js loads without throwing');
  t.end();
});
