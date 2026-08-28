'use strict';

// The phone companion is the higher-value target of the two documents Orion ships. It is served
// over the network to a real mobile browser, it renders model-authored markdown, and it holds a
// bearer token that can drive the desktop — so an XSS there is remote-controllable.
//
// Delivery differs from the desktop renderer in two ways that drive the design:
//   - It is served, so the policy goes in a RESPONSE HEADER. A header is applied before any markup
//     is parsed and cannot be displaced by injected content.
//   - It is templated per request, so script-src uses a per-response NONCE rather than a hash;
//     a hash would have to be recomputed for every response anyway.
//
// Runtime behaviour was verified separately against the live server in a real browser: the app's
// own nonced script runs, an injected inline script is blocked, a script carrying a wrong nonce is
// blocked, same-origin /api works, an off-origin fetch is refused, inline styles still apply, and
// data: images still load. eval and new Function are blocked — confirmed by serving this exact
// policy to a page-authored script, because measuring eval through a CDP evaluation context is
// unreliable: that context bypasses CSP and so do scripts created from within it.

const test = require('tape');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const serverJs = fs.readFileSync(path.join(repoRoot, 'lib', 'ipc-server.js'), 'utf8');
const companionHtmlJs = fs.readFileSync(path.join(repoRoot, 'lib', 'companion-html.js'), 'utf8');
const companionHtml = require('../lib/companion-html');

function policyDirectives() {
  // The policy is built as an array of directive strings in the '/' route.
  const start = serverJs.indexOf("'Content-Security-Policy': [");
  if (start < 0) return [];
  const end = serverJs.indexOf('].join', start);
  return (serverJs.slice(start, end).match(/"([^"]+)"|`([^`]+)`/g) || [])
    .map(entry => entry.replace(/^[`"]|[`"]$/g, ''));
}

function directive(name) {
  return policyDirectives().find(entry => entry.startsWith(name + ' ')) || '';
}

test('the companion serves a CSP as a response header, not a meta tag', t => {
  t.ok(serverJs.includes("'Content-Security-Policy':"),
    'the / route sets a Content-Security-Policy response header');
  t.notOk(/http-equiv="Content-Security-Policy"/.test(companionHtmlJs),
    'the policy is not delivered as a meta tag, which injected markup could sit in front of');
  t.ok(serverJs.includes("'X-Content-Type-Options': 'nosniff'"), 'MIME sniffing is disabled');
  t.ok(serverJs.includes("'Referrer-Policy': 'no-referrer'"), 'the bearer-token page leaks no referrer');
  t.end();
});

test('script-src is nonce-based and strict', t => {
  const scriptSrc = directive('script-src');
  t.ok(scriptSrc.includes("'self'"), 'same-origin bundles load');
  t.ok(scriptSrc.includes('nonce-'), 'the single inline block is authorized by nonce');
  t.notOk(scriptSrc.includes("'unsafe-inline'"),
    "no unsafe-inline - that would readmit every injected inline script, which is the whole risk here");
  t.notOk(scriptSrc.includes("'unsafe-eval'"), 'no unsafe-eval');
  t.ok(serverJs.includes("crypto.randomBytes(16).toString('base64')"),
    'the nonce is cryptographically random');
  t.end();
});

test('a fresh nonce is generated per response and reaches both header and document', t => {
  t.ok(/const scriptNonce = crypto\.randomBytes/.test(serverJs),
    'the nonce is created inside the request handler, so it cannot be reused across responses');
  t.ok(serverJs.includes('companionHtml(os.hostname(), scriptNonce)'),
    'the same nonce is handed to the document generator');
  t.ok(serverJs.includes('`script-src \'self\' \'nonce-${scriptNonce}\'`'),
    'and to the header');

  const html = companionHtml('test-machine', 'AbC123+/=');
  t.ok(html.includes('<script nonce="AbC123+/=">'), 'the generator stamps the nonce on the inline script');
  t.equal((html.match(/<script(?![^>]*src=)/g) || []).length, 1,
    'there is exactly one inline script, so exactly one thing needs the nonce');
  t.end();
});

test('a hostile nonce value cannot break out of the attribute', t => {
  const html = companionHtml('m', 'evil" onload="alert(1)');
  t.notOk(/onload="alert\(1\)/.test(html), 'characters outside the base64 alphabet are stripped');
  t.ok(/<script nonce="[A-Za-z0-9+/=_-]*">/.test(html), 'what remains is a well-formed attribute');
  t.end();
});

test('the phone client has no inline event handlers left', t => {
  const handlers = companionHtmlJs.match(/\son(?:click|change|input|submit|load|error)=["']/g) || [];
  t.deepEqual(handlers, [],
    'inline handlers are script under CSP, so the two that existed became real listeners');
  t.ok(companionHtmlJs.includes("getElementById('pair-retry-btn')"),
    'the pairing retry button is wired through addEventListener');
  t.ok(companionHtmlJs.includes("dbgEl.addEventListener('click'"),
    'the diagnostics banner dismisses through addEventListener');
  t.end();
});

test('connect-src is same-origin only, matching what the client actually calls', t => {
  t.equal(directive('connect-src'), "connect-src 'self'",
    'every client call is a same-origin /api/* path, including the SSE stream');
  // Derived from the client rather than restated: a future off-origin call would fail here rather
  // than silently at runtime on someone's phone.
  const offOrigin = (companionHtmlJs.match(/(?:companionFetch|fetch)\(\s*['"`]https?:\/\/[^'"`]+/g) || []);
  t.deepEqual(offOrigin, [], 'the phone client makes no absolute off-origin requests');
  t.end();
});

test('the policy permits what the UI genuinely needs and closes the rest', t => {
  t.ok(directive('img-src').includes('data:'), 'data: images are allowed because chat attachments use them');
  t.ok(companionHtmlJs.includes("src=\"data:'"), 'and the client really does emit data: images');
  // Nonces apply to <style> ELEMENTS, not to style="" attributes, and adding one would DISABLE
  // unsafe-inline and break every inline style in the UI. So this stays as-is, deliberately.
  t.ok(directive('style-src').includes("'unsafe-inline'"), 'inline style attributes keep working');
  t.ok(directive('worker-src').includes("'self'"), 'the service worker that drives push can register');
  t.ok(directive('manifest-src').includes("'self'"), 'the PWA manifest loads');
  ['object-src', 'frame-ancestors', 'base-uri', 'form-action'].forEach(name => {
    t.ok(directive(name).includes("'none'"), name + ' is closed outright');
  });
  t.end();
});
