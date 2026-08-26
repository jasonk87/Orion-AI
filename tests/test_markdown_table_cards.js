'use strict';

const test = require('tape');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const marked = require('marked');
const companionHtml = require('../lib/companion-html');

// Real bug from actual phone screenshots: a normal grid <table> at phone width forces narrow
// columns to wrap a single word into a vertical letter-stack ("Wh/ere", "Add-/on",
// "1,34/0/Mine/coins"). Jason approved a fix scoped to the phone companion specifically: render
// tables as stacked cards there (first column = bold title, remaining columns as "Label: value"
// lines) while desktop keeps its normal grid <table> rendering. This file proves both halves of
// that with real execution, not string matching: the phone companion's own markdown-rendering
// functions are extracted from its actual served HTML (so this breaks the moment the served output
// changes shape) and run for real against a real multi-column table, through jsdom + the real
// `marked` package also used at runtime; separately, desktop's exact marked.use() configuration
// from renderer.js is replayed against the same table to prove it is untouched.

// The phone companion's inline <script> has no module boundary — it is a single top-level
// <script> tag whose function declarations are only reachable by extracting and running that
// exact source, the same technique tests/test_phone_companion.js already uses (via vm.Script) to
// prove the inline script compiles. This goes one step further: it actually executes the
// self-contained markdown-rendering functions (no DOM-lookup side effects at definition time) in a
// real jsdom document with the real `marked` package, so the assertions below are about what the
// phone actually renders, not what the source merely appears to say.
// Memoized: building the served HTML and a fresh jsdom document is real, non-trivial work (the
// same fixed jsdom-load cost documented elsewhere in this suite, e.g. tests/helpers/renderer-harness.js
// callers). The extracted functions are pure and stateless, so one shared instance across every test
// in this file is correct, not just faster.
let cachedPhoneMarkdownRenderers = null;
function loadPhoneMarkdownRenderers() {
  if (cachedPhoneMarkdownRenderers) return cachedPhoneMarkdownRenderers;
  const html = companionHtml('TEST-DEVICE');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const inline = inlineScripts.find(s => s.includes('function renderMarkdown('));
  if (!inline) throw new Error('Could not find the phone companion markdown-rendering inline script.');

  const tableFunctionsStart = inline.indexOf('function renderMarkdown(text)');
  const tableFunctionsEnd = inline.indexOf('function splitAssistantOutput(text)');
  if (tableFunctionsStart === -1 || tableFunctionsEnd === -1) {
    throw new Error('Could not locate the markdown-rendering function block by its known anchors.');
  }
  const tableFunctionsBlock = inline.slice(tableFunctionsStart, tableFunctionsEnd);

  const escapeHtmlStart = inline.indexOf('function escapeHtml(value)');
  if (escapeHtmlStart === -1) throw new Error('Could not locate escapeHtml, a dependency of the markdown renderers.');
  const escapeHtmlEnd = inline.indexOf('}', inline.indexOf('}', escapeHtmlStart) + 1) + 1;
  const escapeHtmlBlock = inline.slice(escapeHtmlStart, escapeHtmlEnd);

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const context = { document: dom.window.document, marked };
  vm.createContext(context);
  vm.runInContext(
    tableFunctionsBlock + '\n' + escapeHtmlBlock
      + '\nglobalThis.__renderMarkdown = renderMarkdown;'
      + '\nglobalThis.__renderMarkdownFallback = renderMarkdownFallback;',
    context,
    { filename: 'phone-companion-markdown-renderers.js' }
  );
  cachedPhoneMarkdownRenderers = {
    renderMarkdown: context.__renderMarkdown,
    renderMarkdownFallback: context.__renderMarkdownFallback,
    rawInlineScript: inline
  };
  return cachedPhoneMarkdownRenderers;
}

// The exact desktop configuration from the top of renderer.js — only overrides the `html` renderer
// (for XSS-safe raw-HTML escaping); it must not touch table rendering.
function renderDesktopMarkdown(text) {
  const desktopMarked = require('marked');
  desktopMarked.use({
    renderer: {
      html(htmlText) {
        return String(htmlText).replace(/&(?![a-zA-Z#]\w{0,24};)|[<>]/g, ch => {
          if (ch === '&') return '&amp;';
          if (ch === '<') return '&lt;';
          return '&gt;';
        });
      }
    }
  });
  return desktopMarked.parse(text);
}

const REAL_TABLE = [
  '| Add-on | Where | Cost |',
  '|---|---|---|',
  '| Nether Explorers | Minecraft Marketplace | 1,340 Minecoins |',
  '| Sky Kingdom | Minecraft Marketplace | 990 Minecoins |'
].join('\n');

test('the phone companion renders a real multi-column table as stacked cards, through marked.parse()', t => {
  const { renderMarkdown } = loadPhoneMarkdownRenderers();
  const out = renderMarkdown(REAL_TABLE);
  t.notOk(out.includes('<table'), 'no grid <table> is emitted on the phone path');
  t.ok(out.includes('class="md-table-cards"'), 'the table becomes a stacked-cards container');
  const cardCount = (out.match(/class="md-table-card"/g) || []).length;
  t.equal(cardCount, 2, 'one card per data row (header row is not its own card)');
  t.ok(out.includes('<div class="md-table-card-title">Nether Explorers</div>'),
    "the row's first column becomes a bold title, not a Label: value line");
  t.ok(out.includes('<span class="md-table-card-label">Where</span><span class="md-table-card-value">Minecraft Marketplace</span>'),
    'remaining columns render as Label: value lines using the real header text');
  t.ok(out.includes('<span class="md-table-card-label">Cost</span><span class="md-table-card-value">1,340 Minecoins</span>'),
    'the exact reported wrapping case (a comma-separated cost value) survives as one unbroken value, not a letter-stack');
  t.end();
});

test('the phone companion\'s fallback markdown parser (used when marked fails to load) also renders stacked cards', t => {
  const { renderMarkdownFallback } = loadPhoneMarkdownRenderers();
  const out = renderMarkdownFallback(REAL_TABLE);
  t.notOk(out.includes('<table'), 'the fallback parser never falls back further to a grid <table> either');
  t.ok(out.includes('class="md-table-cards"'), 'the fallback parser produces the same stacked-cards container');
  t.ok(out.includes('<div class="md-table-card-title">Nether Explorers</div>'),
    'the fallback parser also treats the first column as the card title');
  t.ok(out.includes('<span class="md-table-card-label">Cost</span><span class="md-table-card-value">1,340 Minecoins</span>'),
    'both markdown code paths in the phone companion produce identical card structure for the same table');
  t.end();
});

test('desktop keeps normal grid <table> rendering for the same table - this is a phone-only change', t => {
  const out = renderDesktopMarkdown(REAL_TABLE);
  t.ok(out.includes('<table'), 'desktop still emits a real <table> element');
  t.ok(out.includes('<thead>') && out.includes('<tbody'), 'desktop keeps the normal thead/tbody grid structure');
  t.notOk(out.includes('md-table-cards'), 'desktop output has no trace of the phone-only card markup');
  t.notOk(out.includes('md-table-card-title'), 'desktop never invents a "title" column - all columns stay equal cells');
  t.end();
});

test('a single-column table (no restructuring is meaningful) still renders without breaking on the phone path', t => {
  const { renderMarkdown } = loadPhoneMarkdownRenderers();
  const singleColumn = ['| Name |', '|---|', '| Solo |'].join('\n');
  const out = renderMarkdown(singleColumn);
  t.ok(out.includes('class="md-table-cards"'), 'a single-column table still becomes a card container');
  t.ok(out.includes('<div class="md-table-card-title">Solo</div>'), 'its only column becomes the title');
  t.notOk(out.includes('md-table-card-label'), 'there are no remaining columns, so no Label: value lines are invented');
  t.end();
});

test('the stacked-card CSS exists in the phone companion stylesheet and is scoped to the phone shell only', t => {
  const html = companionHtml('TEST-DEVICE');
  t.ok(html.includes('.md-table-cards {'), 'the phone shell defines the card-container style');
  t.ok(html.includes('.md-table-card-title {'), 'the phone shell styles the bold title line');
  t.ok(html.includes('.md-table-card-label {'), 'the phone shell styles the Label: value lines');
  const stylesCss = require('fs').readFileSync(require('path').join(__dirname, '../styles.css'), 'utf8');
  t.notOk(stylesCss.includes('.md-table-cards'), 'the phone-only card CSS was never added to the desktop stylesheet');
  t.end();
});
