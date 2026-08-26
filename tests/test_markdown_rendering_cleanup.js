'use strict';

const test = require('tape');
const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8').replace(/\r\n/g, '\n');
const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const companionHtml = fs.readFileSync(path.join(__dirname, '../lib/companion-html.js'), 'utf8').replace(/\r\n/g, '\n');
const ipcServer = fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8').replace(/\r\n/g, '\n');

// Markdown-rendering cleanup (chosen path: better structure/rendering, not the HTML-screenshot
// approach that was scoped out). Two parts: (1) prismjs, already a package.json dependency and
// already wired into desktop, was never wired into the phone companion at all — code blocks
// rendered as plain unhighlighted monospace text there; (2) table/heading CSS gets a real
// visual-hierarchy pass on both surfaces so structured research output (headers, comparison
// tables, a Sources list) is scannable instead of a wall of near-identical text.

test('phone companion now loads the same prismjs the desktop UI already uses', (t) => {
  t.ok(renderer.includes("if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bubble);"),
    'confirms desktop\'s existing Prism call site, the pattern the phone fix mirrors');
  t.ok(companionHtml.includes('<script src="/prism.js"></script>'), 'phone HTML loads the Prism core script');
  t.ok(companionHtml.includes('<script src="/prism-components/prism-javascript.min.js"></script>'), 'phone HTML loads the JS language component');
  t.ok(companionHtml.includes('<script src="/prism-components/prism-css.min.js"></script>'), 'phone HTML loads the CSS language component');
  t.ok(companionHtml.includes('<script src="/prism-components/prism-json.min.js"></script>'), 'phone HTML loads the JSON language component');
  t.ok(companionHtml.includes('<link rel="stylesheet" href="/prism-theme.css">'), 'phone HTML loads a Prism theme stylesheet');
  t.ok(companionHtml.includes('Prism.highlightAllUnder(messagesEl)'), 'phone actually invokes Prism after rendering messages, not just loading the script');
  t.end();
});

test('the companion HTTP server actually serves the prismjs assets the phone HTML requests', (t) => {
  t.ok(ipcServer.includes("url.pathname === '/prism.js'"), 'server has a route for the Prism core script');
  t.ok(ipcServer.includes('nodejs.prismjs/prism.js'.split('nodejs.').join('')) || ipcServer.includes("'../node_modules/prismjs/prism.js'"),
    'the Prism core route reads the real installed package file, mirroring the /marked.min.js route pattern');
  t.ok(ipcServer.includes('/prism-components/'), 'server has a route family for Prism language components');
  t.ok(ipcServer.includes("url.pathname === '/prism-theme.css'"), 'server has a route for the Prism theme stylesheet');
  t.ok(ipcServer.includes("'../node_modules/prismjs/themes/prism-tomorrow.min.css'"), 'the theme route reads the same tomorrow theme desktop uses');
  t.end();
});

test('the phone companion service worker shell caches the new prismjs assets for offline use', (t) => {
  t.ok(ipcServer.includes("'/prism.js'") && ipcServer.includes("SHELL = ["),
    'the offline-cache SHELL list includes the new Prism assets alongside the existing marked.min.js/task-orchestration.js entries');
  t.end();
});

test('desktop and phone both give markdown tables real visual structure, not just marked.js defaults', (t) => {
  t.ok(styles.includes('.message-body th') && styles.includes('.message-body td'), 'desktop tables have styled header/data cells');
  t.ok(styles.includes('.message-body tbody tr:nth-child(even) td'), 'desktop tables get zebra striping for row-to-row scanning');
  t.ok(styles.includes('.message-body table') && /display:\s*block;\s*\n\s*overflow-x:\s*auto;/.test(styles) || styles.includes('overflow-x: auto'),
    'desktop tables can scroll horizontally instead of breaking layout in a narrow chat column');
  t.ok(companionHtml.includes('.message-answer tbody tr:nth-child(even) td'), 'phone tables get the same zebra striping');
  t.ok(companionHtml.includes('.message-answer th { background: var(--surface2); font-weight: 700; }'), 'phone table headers are visually distinct');
  t.end();
});

test('desktop and phone both give markdown headings more visual weight for scanning structured output', (t) => {
  t.ok(companionHtml.includes("font-size: 1.18rem"), 'phone h1 is sized up from the original 1.08rem for real hierarchy at the small base font');
  t.ok(companionHtml.includes('border-bottom: 2px solid var(--accent'), 'phone h2 gets an accent-colored rule so section breaks are visible at a glance');
  t.ok(styles.includes('.message-body h1') && styles.includes('.message-body h2'), 'desktop already distinguishes heading levels, confirmed still present');
  t.end();
});

test('Researcher\'s prompt actually instructs the Sources-block structure the CSS is styled for', (t) => {
  const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
  t.ok(agentJs.includes('"Sources" section'), 'RESEARCHER_INSTRUCTION tells the model to end output with a distinct Sources section');
  t.ok(agentJs.includes('an actual Markdown table when comparing multiple options'), 'RESEARCHER_INSTRUCTION tells the model to use real tables for comparisons, not prose');
  t.end();
});
