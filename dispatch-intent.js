(function initDispatchIntent(globalScope) {
  'use strict';

  /*
   * This module deliberately knows nothing about what ordinary English means.
   * It only identifies mechanical document structure so the semantic classifier
   * can distinguish the live request from quoted/reported material.
   */
  const SPEAKER_LABELS = new Set([
    'user', 'human', 'assistant', 'orion', 'coder', 'system', 'ai', 'claude', 'jason',
    'input', 'output', 'expected', 'actual', 'test', 'command', 'stdout', 'stderr'
  ]);
  const REPORT_LABELS = new Set([
    'transcript', 'status report', 'test case', 'bug report', 'example', 'quoted request',
    'quoted command', 'reported request', 'reported command'
  ]);

  function lineRecords(text) {
    const records = [];
    let cursor = 0;
    while (cursor < text.length) {
      const newline = text.indexOf('\n', cursor);
      const end = newline === -1 ? text.length : newline + 1;
      const contentEnd = newline === -1
        ? end
        : (newline > cursor && text[newline - 1] === '\r' ? newline - 1 : newline);
      records.push({ start: cursor, contentEnd, end, text: text.slice(cursor, contentEnd) });
      cursor = end;
    }
    return records;
  }

  function rangesOverlap(left, right) {
    return left.start < right.end && right.start < left.end;
  }

  function exactLabel(line) {
    const value = String(line || '').trim();
    const separator = value.indexOf(':');
    if (separator < 0) return '';
    return value.slice(0, separator).trim().toLowerCase();
  }

  function collectStructuralSegments(value) {
    const text = String(value || '');
    const records = lineRecords(text);
    const segments = [];
    const fenceLines = new Set();

    function addSegment(start, end, type) {
      if (end <= start) return;
      const next = { start, end, type, text: text.slice(start, end) };
      if (segments.some(existing => rangesOverlap(existing, next))) return;
      segments.push(next);
    }

    for (let index = 0; index < records.length; index += 1) {
      const opening = records[index].text.match(/^\s*(```|~~~)/);
      if (!opening) continue;
      const marker = opening[1];
      let endIndex = index;
      for (let candidate = index + 1; candidate < records.length; candidate += 1) {
        endIndex = candidate;
        if (new RegExp(`^\\s*${marker}\\s*$`).test(records[candidate].text)) break;
      }
      for (let candidate = index; candidate <= endIndex; candidate += 1) fenceLines.add(candidate);
      addSegment(records[index].start, records[endIndex].end, 'fenced_code');
      index = endIndex;
    }

    let reportedBlock = false;
    for (let index = 0; index < records.length; index += 1) {
      if (fenceLines.has(index)) continue;
      const record = records[index];
      const trimmed = record.text.trim();
      if (!trimmed) {
        reportedBlock = false;
        continue;
      }
      if (/^\s{0,3}>/.test(record.text)) {
        addSegment(record.start, record.end, 'blockquote');
        continue;
      }
      const label = exactLabel(record.text);
      if (SPEAKER_LABELS.has(label)) {
        addSegment(record.start, record.end, 'transcript');
        continue;
      }
      const heading = trimmed.replace(/:$/, '').trim().toLowerCase();
      if (REPORT_LABELS.has(heading)) {
        addSegment(record.start, record.end, 'report_heading');
        reportedBlock = true;
        continue;
      }
      if (reportedBlock) addSegment(record.start, record.end, 'reported_material');
    }

    const quotedRe = /`[^`\r\n]+`|"(?:\\.|[^"\\\r\n])*"|“[^”\r\n]*”|'(?:\\.|[^'\\\r\n]){2,}'/g;
    let match;
    while ((match = quotedRe.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const before = start > 0 ? text[start - 1] : '';
      const after = end < text.length ? text[end] : '';
      if (match[0][0] === "'" && (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after))) continue;
      addSegment(start, end, match[0][0] === '`' ? 'inline_code' : 'quoted_string');
    }

    return segments.sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function buildMaskedText(value, suppliedSegments) {
    const text = String(value || '');
    const segments = Array.isArray(suppliedSegments) ? suppliedSegments : collectStructuralSegments(text);
    const chars = text.split('');
    for (const segment of segments) {
      for (let index = segment.start; index < segment.end; index += 1) {
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
      }
    }
    return chars.join('');
  }

  function analyzeMessageStructure(value) {
    const originalText = String(value || '');
    const segments = collectStructuralSegments(originalText);
    return {
      originalText,
      activeText: buildMaskedText(originalText, segments).replace(/[ \t]+/g, ' ').trim(),
      maskedText: buildMaskedText(originalText, segments),
      segments: segments.map(segment => ({ ...segment })),
      containsQuotedText: segments.some(segment => ['blockquote', 'quoted_string', 'inline_code'].includes(segment.type)),
      containsCodeBlock: segments.some(segment => segment.type === 'fenced_code'),
      containsTranscript: segments.some(segment => segment.type === 'transcript'),
      containsReportedMaterial: segments.some(segment => ['reported_material', 'report_heading'].includes(segment.type))
    };
  }

  const api = {
    analyzeMessageStructure,
    collectStructuralSegments,
    buildMaskedText,
    // Backward-compatible name for consumers that only need structural analysis.
    analyzeDispatchInstruction: analyzeMessageStructure
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionDispatchIntent = api;
})(typeof window !== 'undefined' ? window : globalThis);
