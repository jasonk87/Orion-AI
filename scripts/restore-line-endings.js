#!/usr/bin/env node
/**
 * Restore original line endings on lines a tool did not actually change.
 *
 * agent.js and renderer.js have MIXED line endings (agent.js is ~11k CRLF + ~1.1k bare LF).
 * Most editors — including `sed -i` and several agent file-edit tools — rewrite the whole file
 * on save and normalize every line to one ending. A 20-line change then shows up as a
 * ~1,100-line diff, which is unreviewable and has already broken a line-ending-sensitive test
 * assertion in tests/test_interaction_guardrails.js.
 *
 * This diffs the working file against a git revision, keeps the ORIGINAL bytes for every
 * unchanged line, and keeps the new content for lines that genuinely changed.
 *
 * Usage:
 *   node scripts/restore-line-endings.js <file> [<file> ...] [--rev HEAD] [--check]
 *
 *   --check   report only, exit 1 if any file has phantom churn (useful in CI)
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const files = [];
  let rev = 'HEAD';
  let check = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--rev') rev = argv[++i];
    else if (argv[i] === '--check') check = true;
    else files.push(argv[i]);
  }
  return { files, rev, check };
}

function readKeepingEndings(text) {
  // Splits on \n but keeps the terminator, so a line's original \r\n vs \n survives.
  return text.split(/(?<=\n)/);
}

const stripEnding = line => line.replace(/\r?\n$/, '');

// Longest-common-subsequence opcodes over line CONTENT (endings ignored), so a line that only
// differs by its terminator counts as unchanged and keeps the original bytes.
function opcodes(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) { ops.push(['equal', i++, j++]); }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push(['delete', i++, j]); }
    else { ops.push(['insert', i, j++]); }
  }
  while (j < m) ops.push(['insert', i, j++]);
  return ops;
}

function endingCensus(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return { crlf, lf };
}

function restoreFile(file, rev, checkOnly) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  let originalText;
  try {
    originalText = execFileSync('git', ['show', `${rev}:${rel}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (_) {
    console.log(`  skip   ${rel} (not in ${rev})`);
    return { changed: false, phantom: 0 };
  }

  const currentText = fs.readFileSync(file, 'utf8');
  const oldLines = readKeepingEndings(originalText);
  const newLines = readKeepingEndings(currentText);
  const oldContent = oldLines.map(stripEnding);
  const newContent = newLines.map(stripEnding);

  const out = [];
  let phantom = 0;
  for (const [tag, oi, nj] of opcodes(oldContent, newContent)) {
    if (tag === 'equal') {
      out.push(oldLines[oi]);
      if (oldLines[oi] !== newLines[nj]) phantom++;
    } else if (tag === 'insert') {
      out.push(newLines[nj]);
    }
    // 'delete' contributes nothing: the line is gone from the new file.
  }

  const before = endingCensus(currentText);
  const restored = out.join('');
  const after = endingCensus(restored);

  if (phantom === 0) {
    console.log(`  ok     ${rel} (no phantom churn)`);
    return { changed: false, phantom: 0 };
  }
  if (checkOnly) {
    console.log(`  CHURN  ${rel}: ${phantom} lines differ only by line ending`);
    return { changed: false, phantom };
  }

  if (restored !== currentText) fs.writeFileSync(file, restored, 'utf8');
  console.log(`  fixed  ${rel}: restored ${phantom} lines  (CRLF ${before.crlf}->${after.crlf}, LF ${before.lf}->${after.lf})`);
  return { changed: true, phantom };
}

const { files, rev, check } = parseArgs(process.argv);
if (files.length === 0) {
  console.error('Usage: node scripts/restore-line-endings.js <file> [...] [--rev HEAD] [--check]');
  process.exit(2);
}

console.log(`${check ? 'Checking' : 'Restoring'} line endings against ${rev}:`);
let totalPhantom = 0;
for (const file of files) {
  if (!fs.existsSync(file)) { console.log(`  skip   ${file} (missing)`); continue; }
  totalPhantom += restoreFile(path.resolve(file), rev, check).phantom;
}

if (check && totalPhantom > 0) {
  console.error(`\n${totalPhantom} lines differ only by line ending. Run without --check to fix.`);
  process.exit(1);
}
process.exit(0);
