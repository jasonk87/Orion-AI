'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceIndexService } = require('./workspace-index-service');

const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.html', '.css', '.json', '.md']);
const SYMBOL_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py']);
const TEST_PATH_RE = /(^|[\\/])(__tests__|tests?|spec)([\\/]|$)|(?:^|[._-])(test|spec)\.[a-z0-9]+$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.orion', '.claude']);

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function splitLines(text) {
  return String(text || '').split(/\r?\n/);
}

function readWorkspaceText(workspacePath, relativePath) {
  const service = getWorkspaceIndexService(workspacePath);
  return service.readSource(relativePath).source;
}

function parseRange(range, totalLines) {
  let startLine;
  let endLine;

  if (Array.isArray(range)) {
    startLine = Number(range[0]);
    endLine = Number(range[1]);
  } else if (range && typeof range === 'object') {
    startLine = Number(range.startLine);
    endLine = Number(range.endLine);
  }

  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new Error('Each range must include integer startLine and endLine values.');
  }
  if (startLine < 1 || endLine < startLine) {
    throw new Error(`Invalid range ${startLine}-${endLine}.`);
  }

  const safeTotal = Math.max(1, totalLines);
  const clampedStart = Math.min(Math.max(1, startLine), safeTotal);
  const clampedEnd = Math.min(Math.max(clampedStart, endLine), safeTotal);
  return {
    startLine: clampedStart,
    endLine: clampedEnd
  };
}

function mergeRanges(ranges, gap = 2) {
  const sorted = (ranges || [])
    .filter(range => range && Number.isInteger(range.startLine) && Number.isInteger(range.endLine))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.startLine > last.endLine + gap + 1) {
      merged.push({
        startLine: range.startLine,
        endLine: range.endLine,
        priority: Number.isFinite(Number(range.priority)) ? Number(range.priority) : 50,
        reasons: [...new Set(range.reasons || [range.reason || 'requested range'])],
        symbolName: range.symbolName || ''
      });
      continue;
    }
    last.endLine = Math.max(last.endLine, range.endLine);
    last.priority = Math.min(last.priority, Number.isFinite(Number(range.priority)) ? Number(range.priority) : 50);
    last.reasons = [...new Set([...(last.reasons || []), ...(range.reasons || [range.reason || 'nearby range'])])];
    if (!last.symbolName && range.symbolName) last.symbolName = range.symbolName;
  }

  return merged;
}

function formatNumberedRange(lines, startLine, endLine) {
  return lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
}

function normalizeRangeRequests(files = []) {
  if (!Array.isArray(files)) throw new Error("Missing 'files' array parameter.");
  return files.map(file => {
    if (!file || typeof file !== 'object') throw new Error('Each file request must be an object.');
    const relPath = normalizeSlash(file.path || file.relativePath);
    if (!relPath) throw new Error('Each file request must include path.');
    const ranges = Array.isArray(file.ranges)
      ? file.ranges
      : [{ startLine: file.startLine, endLine: file.endLine }];
    return { path: relPath, ranges };
  });
}

function readMultipleRanges(workspacePath, files, options = {}) {
  const requests = normalizeRangeRequests(files);
  const maxChars = Number.isFinite(Number(options.maxChars)) ? Math.max(1000, Number(options.maxChars)) : 500000;
  const responseFiles = [];
  const sections = [];
  let output = '';
  let totalChars = 0;
  let truncated = false;

  for (const request of requests) {
    const content = readWorkspaceText(workspacePath, request.path);
    const lines = splitLines(content);
    const ranges = mergeRanges(request.ranges.map(range => parseRange(range, lines.length)), 0);
    const fileEntry = { path: request.path, totalLines: lines.length, ranges: [] };

    for (const range of ranges) {
      const source = formatNumberedRange(lines, range.startLine, range.endLine);
      const header = `\n\n--- File: ${request.path} (lines ${range.startLine}-${range.endLine}) ---\n`;
      const next = header + source;
      if (totalChars + next.length > maxChars) {
        truncated = true;
        break;
      }
      totalChars += next.length;
      output += next;
      const section = {
        path: request.path,
        startLine: range.startLine,
        endLine: range.endLine,
        lineCount: range.endLine - range.startLine + 1,
        charCount: source.length,
        content: source
      };
      fileEntry.ranges.push(section);
      sections.push(section);
    }
    responseFiles.push(fileEntry);
    if (truncated) break;
  }

  return {
    success: true,
    content: output.trimStart(),
    files: responseFiles,
    sections,
    metrics: {
      fileCount: responseFiles.length,
      sectionCount: sections.length,
      returnedChars: totalChars,
      estimatedTokens: estimateTokens(output)
    },
    truncated,
    message: truncated ? `Context truncated at ${maxChars} characters.` : undefined
  };
}

function collectSearchableFiles(workspacePath, maxFiles = 800) {
  const service = getWorkspaceIndexService(workspacePath);
  return service.listRecords().map(record => record.path).slice(0, maxFiles);
}

function queryTerms(query) {
  return [...new Set(String(query || '')
    .split(/[^A-Za-z0-9_$]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3)
    .slice(0, 20))];
}

function scoreText(text, terms, symbols = []) {
  const lower = String(text || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (lower.includes(needle)) score += 1;
  }
  for (const symbol of symbols) {
    const needle = String(symbol || '').toLowerCase();
    if (needle && lower.includes(needle)) score += 4;
  }
  return score;
}

function diffTelemetry(before = {}, after = {}) {
  const keys = [
    'filesReusedUnchanged',
    'filesReindexed',
    'filesRemoved',
    'cacheHits',
    'cacheMisses',
    'sourceLruHits',
    'sourceLruMisses',
    'astParsesAvoided',
    'astParsesPerformed',
    'diskReadsAvoided',
    'diskReadsPerformed',
    'embeddingChunksReused',
    'embeddingChunksGenerated',
    'candidateFilesConsidered',
    'exactSourceSectionsReturned'
  ];
  const delta = {};
  for (const key of keys) {
    delta[key] = (Number(after[key]) || 0) - (Number(before[key]) || 0);
  }
  delta.workspaceRevision = after.workspaceRevision || 0;
  delta.queryDurationMs = after.inspectCodeContextQueryDurationMs || 0;
  return delta;
}

function extractTopImportRange(lines, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SYMBOL_EXTS.has(ext)) return null;
  let lastImportLine = 0;
  const limit = Math.min(lines.length, 120);

  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (/^\s*(import\b|from\s+\S+\s+import\b)/.test(line) ||
        /^\s*(const|let|var)\s+[\w${}\s,]+\s*=\s*require\(/.test(line)) {
      lastImportLine = i + 1;
    }
  }

  if (!lastImportLine) return null;
  return {
    startLine: 1,
    endLine: Math.min(lines.length, lastImportLine),
    priority: 25,
    reasons: ['imports/requires needed to interpret selected code']
  };
}

function enclosingSymbolRange(symbols, line) {
  const candidates = (symbols || [])
    .filter(symbol => symbol.startLine <= line && symbol.endLine >= line)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
  return candidates[0] || null;
}

function symbolMatches(symbol, wantedSymbols, terms) {
  const name = String(symbol.name || '');
  const qualified = symbol.path ? `${symbol.path}.${name}` : name;
  const signature = String(symbol.signature || '');
  return wantedSymbols.some(wanted => {
    const needle = String(wanted || '').toLowerCase();
    return needle && (name.toLowerCase() === needle || qualified.toLowerCase().includes(needle));
  }) || scoreText(`${qualified} ${signature}`, terms, []) > 0;
}

function buildSectionsForPath({ service, workspacePath, relPath, query, symbols, include, contextLines }) {
  const fileContext = service ? service.getFileLines(relPath) : {
    source: readWorkspaceText(workspacePath, relPath),
    record: null
  };
  const lines = fileContext.lines || splitLines(fileContext.source);
  const terms = queryTerms(query);
  const wantedSymbols = (symbols || []).map(String).filter(Boolean);
  const parsedSymbols = fileContext.record && Array.isArray(fileContext.record.symbols)
    ? fileContext.record.symbols
    : [];

  const ranges = [];
  if (include.has('imports')) {
    const importRange = extractTopImportRange(lines, relPath);
    if (importRange) ranges.push(importRange);
  }

  parsedSymbols
    .filter(symbol => symbolMatches(symbol, wantedSymbols, terms))
    .slice(0, 10)
    .forEach(symbol => {
      ranges.push({
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        priority: wantedSymbols.includes(symbol.name) ? 5 : 15,
        reasons: [`${symbol.type || 'symbol'} ${symbol.path ? `${symbol.path}.` : ''}${symbol.name}`],
        symbolName: symbol.name
      });
    });

  const phrase = String(query || '').trim().toLowerCase();
  const lexicalHits = [];
  for (let i = 0; i < lines.length && lexicalHits.length < 12; i++) {
    const lower = lines[i].toLowerCase();
    const matchesPhrase = phrase.length >= 6 && lower.includes(phrase);
    const matchesTerm = terms.some(term => lower.includes(term.toLowerCase()));
    const matchesSymbol = wantedSymbols.some(symbol => lower.includes(symbol.toLowerCase()));
    if (!matchesPhrase && !matchesTerm && !matchesSymbol) continue;

    const enclosing = enclosingSymbolRange(parsedSymbols, i + 1);
    if (enclosing) {
      lexicalHits.push({
        startLine: enclosing.startLine,
        endLine: enclosing.endLine,
        priority: 20,
        reasons: [`lexical hit inside ${enclosing.name}`],
        symbolName: enclosing.name
      });
    } else {
      lexicalHits.push({
        startLine: Math.max(1, i + 1 - contextLines),
        endLine: Math.min(lines.length, i + 1 + contextLines),
        priority: 35,
        reasons: ['lexical hit context']
      });
    }
  }
  ranges.push(...lexicalHits);

  if (ranges.length === 0) {
    const fileTokens = estimateTokens(content);
    ranges.push({
      startLine: 1,
      endLine: lines.length,
      priority: fileTokens <= 12000 ? 40 : 80,
      reasons: [fileTokens <= 12000 ? 'full file fits context budget' : 'fallback file overview']
    });
  }

  return { path: relPath, lines, ranges: mergeRanges(ranges, 4), symbols: parsedSymbols };
}

async function addCallerSections({ service, workspacePath, sectionsByPath, symbols, contextLines }) {
  const wantedSymbols = (symbols || []).map(String).filter(Boolean).slice(0, 5);
  const referenceSummaries = [];
  for (const symbolName of wantedSymbols) {
    const references = service ? service.findReferences(symbolName, '.') : { success: false, results: [] };
    if (!references || !references.success) continue;
    referenceSummaries.push({ symbolName, count: references.results.length });
    for (const ref of references.results.slice(0, 12)) {
      const relPath = normalizeSlash(ref.file || ref.path);
      if (!relPath) continue;
      let entry = sectionsByPath.get(relPath);
      if (!entry) {
        entry = buildSectionsForPath({
          service,
          workspacePath,
          relPath,
          query: symbolName,
          symbols: [symbolName],
          include: new Set(),
          contextLines
        });
        entry.ranges = [];
        sectionsByPath.set(relPath, entry);
      }
      const enclosing = enclosingSymbolRange(entry.symbols, Number(ref.line));
      entry.ranges.push(enclosing ? {
        startLine: enclosing.startLine,
        endLine: enclosing.endLine,
        priority: 18,
        reasons: [`caller/reference for ${symbolName}`],
        symbolName: enclosing.name
      } : {
        startLine: Math.max(1, Number(ref.line) - contextLines),
        endLine: Math.min(entry.lines.length, Number(ref.line) + contextLines),
        priority: 38,
        reasons: [`reference context for ${symbolName}`]
      });
    }
  }
  return referenceSummaries;
}

function chooseCandidatePaths(workspacePath, request, service = null) {
  const explicit = Array.isArray(request.paths) ? request.paths.map(normalizeSlash).filter(Boolean) : [];
  const symbols = Array.isArray(request.symbols) ? request.symbols.map(String).filter(Boolean) : [];
  if (explicit.length > 0 && request.expand !== true) return [...new Set(explicit)].slice(0, 12);
  const indexService = service || getWorkspaceIndexService(workspacePath);
  return indexService.findCandidatePaths({ ...request, paths: explicit, symbols }).slice(0, 12);
}

function addRelatedTests(workspacePath, sectionsByPath, request, contextLines, service = null) {
  const include = new Set(request.include || []);
  if (!include.has('tests')) return;
  const symbols = Array.isArray(request.symbols) ? request.symbols.map(String).filter(Boolean) : [];
  const indexService = service || getWorkspaceIndexService(workspacePath);
  const testFiles = indexService.findRelatedTests({ ...request, symbols });

  for (const item of testFiles) {
    if (sectionsByPath.has(item.path)) continue;
    sectionsByPath.set(item.path, buildSectionsForPath({
      service: indexService,
      workspacePath,
      relPath: item.path,
      query: request.query,
      symbols,
      include: new Set(),
      contextLines
    }));
  }
}

function buildContextContent(sectionEntries, budgetTokens) {
  const sections = [];
  const omitted = [];
  let content = '';
  let usedTokens = 0;

  const flattened = [];
  for (const entry of sectionEntries) {
    const merged = mergeRanges(entry.ranges, 4);
    for (const range of merged) {
      flattened.push({
        path: entry.path,
        lines: entry.lines,
        startLine: range.startLine,
        endLine: range.endLine,
        priority: range.priority,
        reasons: range.reasons || []
      });
    }
  }
  flattened.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path) || a.startLine - b.startLine);

  for (const range of flattened) {
    const source = formatNumberedRange(range.lines, range.startLine, range.endLine);
    const block = [
      `\n\n--- File: ${range.path} (lines ${range.startLine}-${range.endLine}) ---`,
      range.reasons.length ? `Reasons: ${range.reasons.join('; ')}` : '',
      source
    ].filter(Boolean).join('\n');
    const nextTokens = estimateTokens(block);
    if (usedTokens + nextTokens > budgetTokens && sections.length > 0) {
      omitted.push({
        path: range.path,
        startLine: range.startLine,
        endLine: range.endLine,
        reason: 'budget'
      });
      continue;
    }
    usedTokens += nextTokens;
    content += block;
    sections.push({
      path: range.path,
      startLine: range.startLine,
      endLine: range.endLine,
      reasons: range.reasons,
      estimatedTokens: nextTokens,
      content: source
    });
  }

  return { content: content.trimStart(), sections, omitted, estimatedTokens: usedTokens };
}

async function inspectCodeContext(workspacePath, request = {}) {
  if (!workspacePath) return { success: false, error: 'No active workspace directory found.' };
  if (!fs.existsSync(workspacePath)) return { success: false, error: `Directory does not exist: ${workspacePath}` };
  const query = String(request.query || '').trim();
  const symbols = Array.isArray(request.symbols) ? request.symbols.map(String).filter(Boolean) : [];
  if (!query && symbols.length === 0 && (!Array.isArray(request.paths) || request.paths.length === 0)) {
    return { success: false, error: 'inspect_code_context needs a query, symbols, or paths.' };
  }

  const budgetTokens = Number.isFinite(Number(request.budgetTokens || request.maxTokens))
    ? Math.max(1000, Math.min(60000, Number(request.budgetTokens || request.maxTokens)))
    : 18000;
  const contextLines = Number.isFinite(Number(request.contextLines)) ? Math.max(2, Math.min(40, Number(request.contextLines))) : 8;
  const include = new Set(Array.isArray(request.include) && request.include.length > 0
    ? request.include
    : ['definitions', 'imports', 'tests']);
  const startedAt = Date.now();
  const service = getWorkspaceIndexService(workspacePath);
  const telemetryBefore = service.getTelemetry();
  const paths = chooseCandidatePaths(workspacePath, { ...request, query, symbols }, service);
  const sectionsByPath = new Map();
  const errors = [];

  for (const relPath of paths) {
    try {
      sectionsByPath.set(relPath, buildSectionsForPath({
        service,
        workspacePath,
        relPath,
        query,
        symbols,
        include,
        contextLines
      }));
    } catch (e) {
      errors.push({ path: relPath, error: e.message });
    }
  }

  let references = [];
  if (include.has('callers') && symbols.length > 0) {
    references = await addCallerSections({ service, workspacePath, sectionsByPath, symbols, contextLines });
  }

  addRelatedTests(workspacePath, sectionsByPath, { ...request, query, symbols, include: [...include] }, contextLines, service);

  const bundle = buildContextContent([...sectionsByPath.values()], budgetTokens);
  const telemetryAfter = service.getTelemetry();
  telemetryAfter.inspectCodeContextQueryDurationMs = Date.now() - startedAt;
  telemetryAfter.candidateFilesConsidered = paths.length;
  telemetryAfter.exactSourceSectionsReturned = bundle.sections.length;
  return {
    success: true,
    query,
    symbols,
    includedPaths: [...sectionsByPath.keys()],
    sections: bundle.sections,
    content: bundle.content,
    omitted: bundle.omitted,
    references,
    errors,
    metrics: {
      candidatePathCount: paths.length,
      includedPathCount: sectionsByPath.size,
      sectionCount: bundle.sections.length,
      estimatedTokens: bundle.estimatedTokens,
      budgetTokens,
      workspaceRevision: service.revision,
      queryDurationMs: telemetryAfter.inspectCodeContextQueryDurationMs,
      cache: diffTelemetry(telemetryBefore, telemetryAfter)
    },
    note: 'Exact source is returned for every included section; omitted sections were excluded by budget or read errors.'
  };
}

module.exports = {
  estimateTokens,
  mergeRanges,
  readMultipleRanges,
  inspectCodeContext,
  collectSearchableFiles
};
