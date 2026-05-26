const test = require('tape');
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const mainPath = path.join(__dirname, '../main.js');
const mainContent = fs.readFileSync(mainPath, 'utf8');

function applyPatch(original, operation) {
    let updated = original;
    if (operation.type === 'replace') {
      const count = Math.max(parseInt(operation.count, 10) || 1, 1);
      let replacements = 0;
      while (replacements < count) {
        const index = updated.indexOf(operation.target);
        if (index === -1) break;
        updated = updated.slice(0, index) + operation.replacement + updated.slice(index + operation.target.length);
        replacements++;
      }
      if (replacements === 0) throw new Error('Target content block not found');
    } else if (operation.type === 'replace_regex') {
      const flags = operation.flags || '';
      const safeFlags = Array.from(new Set(flags.replace(/[^gimsuy]/g, '').split(''))).join('');
      const regex = new RegExp(operation.pattern, safeFlags.includes('g') ? safeFlags : safeFlags + 'g');
      const matches = updated.match(regex);
      const replacements = matches ? matches.length : 0;
      updated = updated.replace(regex, operation.replacement);
      if (replacements === 0) throw new Error('Regex pattern did not match');
    } else if (operation.type === 'insert') {
      const position = operation.position === 'before' ? 'before' : 'after';
      const index = updated.indexOf(operation.anchor);
      if (index === -1) throw new Error('Anchor content not found');
      const insertAt = position === 'before' ? index : index + operation.anchor.length;
      updated = updated.slice(0, insertAt) + operation.content + updated.slice(insertAt);
    } else if (operation.type === 'replace_range') {
      const startLine = parseInt(operation.startLine, 10);
      const endLine = parseInt(operation.endLine, 10);
      const hasFinalNewline = updated.endsWith('\n');
      const lines = updated.split(/\r?\n/);
      if (hasFinalNewline) lines.pop();
      const newLines = String(operation.content).split(/\r?\n/);
      lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
      updated = lines.join('\n') + (hasFinalNewline ? '\n' : '');
    }
    return updated;
}

test('patch file - replace', (t) => {
  const original = 'hello world\nhello world';
  const op = { type: 'replace', target: 'world', replacement: 'earth', count: 2 };
  const result = applyPatch(original, op);
  t.equal(result, 'hello earth\nhello earth');
  t.end();
});

test('patch file - replace_regex', (t) => {
  const original = 'foo 123 bar 456';
  const op = { type: 'replace_regex', pattern: '\\d+', replacement: 'NUM', flags: 'g' };
  const result = applyPatch(original, op);
  t.equal(result, 'foo NUM bar NUM');
  t.end();
});

test('patch file - insert before and after', (t) => {
  const original = 'A B C';
  const opBefore = { type: 'insert', anchor: 'B', position: 'before', content: 'X ' };
  t.equal(applyPatch(original, opBefore), 'A X B C');

  const opAfter = { type: 'insert', anchor: 'B', position: 'after', content: ' Y' };
  t.equal(applyPatch(original, opAfter), 'A B Y C');
  t.end();
});

test('patch file - replace_range', (t) => {
  const original = 'line1\nline2\nline3\nline4\n';
  const op = { type: 'replace_range', startLine: 2, endLine: 3, content: 'new2\nnew3' };
  const result = applyPatch(original, op);
  t.equal(result, 'line1\nnew2\nnew3\nline4\n');
  t.end();
});
