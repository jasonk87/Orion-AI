'use strict';

// The renderer is well hardened already — context isolation on, node integration off, raw markdown
// HTML escaped, link schemes filtered — but it renders MODEL-AUTHORED content while window.api
// exposes shell execution, file mutation, desktop control and skill creation. Hardening reduces the
// chance of an XSS; a CSP is what decides whether one that slips through can actually do anything.
//
// The failure mode this file exists for: a CSP is enforced by the browser at RUNTIME, so a policy
// that is too strict breaks the app silently and a policy that quietly loses its teeth (someone
// adds 'unsafe-inline' to make an inline handler work) still looks fine in every test. Both
// directions are asserted here, and the packaged-app smoke test covers the runtime half.

const test = require('tape');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(repoRoot, 'renderer.js'), 'utf8');

function cspContent() {
  const match = indexHtml.match(/<meta http-equiv="Content-Security-Policy" content="([\s\S]*?)">/);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function directive(name) {
  const csp = cspContent();
  const match = csp.match(new RegExp(name + '\\s+([^;]*)'));
  return match ? match[1].trim() : '';
}

test('the renderer ships a Content-Security-Policy at all', t => {
  t.ok(cspContent(), 'index.html declares a CSP');
  t.ok(/default-src\s+'self'/.test(cspContent()), "default-src falls back to 'self'");
  t.end();
});

test('script-src is genuinely strict - no unsafe-inline, no unsafe-eval', t => {
  const scriptSrc = directive('script-src');
  t.ok(scriptSrc.includes("'self'"), 'local app scripts are allowed');
  t.notOk(scriptSrc.includes("'unsafe-inline'"),
    "script-src does not allow unsafe-inline - that would readmit exactly the injected <script> a CSP exists to stop");
  t.notOk(scriptSrc.includes("'unsafe-eval'"), 'script-src does not allow eval');
  t.notOk(/https?:/.test(scriptSrc), 'no remote script origin is trusted');
  t.end();
});

test('the inline crash-trap hash matches the script actually in index.html', t => {
  // If someone edits the crash trap without recomputing the hash, the app boots with NO crash
  // reporting and nothing else fails. This is the guard for that.
  const inline = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
  t.ok(inline, 'the inline crash trap is still present');
  const actual = 'sha256-' + crypto.createHash('sha256').update(inline[1], 'utf8').digest('base64');
  t.ok(directive('script-src').includes(actual),
    'script-src carries the hash of the current inline script (recompute it if the crash trap changed)');
  t.end();
});

test('no inline event handlers remain, since they are script under CSP', t => {
  // Requires a quote after the '=' so this matches real handler ATTRIBUTES and not the words
  // "onclick=" appearing in the comments that explain why they were removed.
  const attributePattern = /\son(?:click|change|input|submit|load|error|mouseover|mouseenter)=["']/g;
  const handlers = rendererJs.match(attributePattern) || [];
  t.deepEqual(handlers, [],
    'renderer.js uses delegated listeners rather than inline handler attributes');
  const htmlHandlers = indexHtml.match(attributePattern) || [];
  t.deepEqual(htmlHandlers, [], 'index.html has no inline handler attributes either');
  t.ok(rendererJs.includes("closest('.agent-logs-header')"),
    'the log toggle is wired through a delegated click listener');
  t.end();
});

test('connect-src allows exactly the endpoints the renderer itself calls', t => {
  const connectSrc = directive('connect-src');
  // Everything the renderer actually fetches directly. Web search, page fetching, embeddings and
  // the browser worker all go through IPC to the main process and need no allowance.
  ['https://generativelanguage.googleapis.com', 'https://api.anthropic.com',
    'https://api.deepseek.com', 'http://localhost:11434'].forEach(origin => {
    t.ok(connectSrc.includes(origin), 'connect-src allows ' + origin);
  });
  t.notOk(/connect-src[^;]*\shttps:(\s|;|$)/.test(cspContent()),
    'connect-src does not open all of https: - the renderer never fetches arbitrary URLs');
  t.end();
});

test('every model endpoint the renderer calls is covered by connect-src', t => {
  // Derived from the source rather than restated, so adding a provider to agent.js without adding
  // it to the CSP fails here instead of failing silently at runtime as a dead model call.
  const agentJs = fs.readFileSync(path.join(repoRoot, 'agent.js'), 'utf8');
  const connectSrc = directive('connect-src');
  const called = new Set();
  for (const match of agentJs.matchAll(/fetch(?:WithTimeout)?\(\s*[`'"](https?:\/\/[^`'"\/]+)/g)) {
    called.add(match[1]);
  }
  t.ok(called.size > 0, 'renderer-side fetch targets were found to check against');
  called.forEach(origin => {
    t.ok(connectSrc.includes(origin),
      origin + ' is reachable under the CSP (a missing entry would silently break model calls)');
  });
  t.end();
});

test('dangerous sinks are closed outright', t => {
  t.ok(/object-src\s+'none'/.test(cspContent()), 'plugins are disabled');
  t.ok(/frame-src\s+'none'/.test(cspContent()), 'framing is disabled');
  t.ok(/base-uri\s+'none'/.test(cspContent()), 'base-tag hijacking is prevented');
  t.ok(/form-action\s+'none'/.test(cspContent()), 'form exfiltration targets are disallowed');
  t.end();
});

test('images and styles are permitted the way the renderer actually uses them', t => {
  // Screenshots and attachments render as data: URIs, so blocking data: would blank every image.
  t.ok(/img-src[^;]*data:/.test(cspContent()), 'data: images are allowed because attachments use them');
  t.ok(rendererJs.includes('src="data:'), 'and the renderer really does render data: images');
  // Inline styles stay allowed: the renderer sets style attributes for dynamic layout. Injected CSS
  // cannot reach window.api the way injected script can, so this is the narrower concession.
  t.ok(/style-src[^;]*'unsafe-inline'/.test(cspContent()), 'inline styles remain permitted');
  t.end();
});
