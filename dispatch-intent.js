(function initDispatchIntent(globalScope) {
  'use strict';

  const EXECUTION_VERBS = [
    'kill', 'terminate', 'stop', 'restart', 'reboot', 'start', 'launch',
    'run', 'execute', 'apply', 'install', 'uninstall', 'upgrade', 'update',
    'configure', 'change', 'modify', 'edit', 'write', 'create', 'delete',
    'remove', 'rename', 'move', 'copy', 'build', 'fix', 'repair', 'test',
    'deploy', 'package', 'commit', 'push', 'pull', 'save', 'generate',
    'produce', 'capture', 'patch'
  ];
  const ACTION_PATTERN = `(?:${EXECUTION_VERBS.join('|')})`;
  const REFERENCE_VERB_PATTERN = '(?:run|execute|apply|perform|carry\\s+out|do|follow|use)';
  const SPEAKER_LINE_RE = /^\s*(?:user|human|assistant|orion|coder|system|ai|claude|jason)\s*:/i;

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

  function isReportFramingLine(line, documentHasReportFraming) {
    const value = String(line || '').trim();
    if (!value) return false;
    if (/^(?:here(?:'s|\s+is)|this\s+is|the\s+following\s+is)\s+(?:an?\s+)?(?:example|test(?:\s+case)?|status\s+report|report|transcript|quoted?\s+(?:request|command|example))/i.test(value)) return true;
    if (/^(?:the\s+)?(?:user|customer|tester|assistant|model)\s+(?:had\s+)?(?:previously\s+)?(?:asked|said|requested|reported|wrote|told\s+us)\b/i.test(value)) return true;
    if (/\b(?:exact\s+)?(?:request|prompt|command|example|test(?:\s+case)?)\b.{0,120}\b(?:is|was|has\s+been)\s+(?:now\s+)?(?:covered|tested|fixed|pushed|reported|quoted|documented)\b/i.test(value)) return true;
    if (/\b(?:covered\s+by\s+tests|the\s+fix\s+was\s+pushed|previously\s+asked\s+(?:us|me)\s+to)\b/i.test(value)) return true;
    if (documentHasReportFraming && /^(?:test(?:\s+case)?|status(?:\s+report)?|transcript|expected|actual|input|output|reported\s+request|quoted\s+request)\s*:/i.test(value)) return true;
    return false;
  }

  function startsReportedBlock(line) {
    const value = String(line || '').trim();
    return /(?:^|\b)(?:the\s+)?(?:exact\s+)?(?:request|prompt|command|example|test(?:\s+case)?|transcript|status\s+report)\s*:\s*$/i.test(value);
  }

  function hasExplicitExecutionFollowup(line) {
    return /\b(?:now|then)\s+(?:please\s+)?(?:run|execute|apply|perform|do|restart|kill|modify|edit|install|test)\b/i.test(String(line || ''));
  }

  function collectStructuralSegments(text) {
    const records = lineRecords(text);
    const segments = [];
    const fenceLines = new Set();

    function addSegment(start, end, type) {
      if (end <= start) return;
      const next = { start, end, type, text: text.slice(start, end) };
      if (segments.some(existing => rangesOverlap(existing, next))) return;
      segments.push(next);
    }

    for (let index = 0; index < records.length; index++) {
      const opening = records[index].text.match(/^\s*(```|~~~)/);
      if (!opening) continue;
      const marker = opening[1];
      let endIndex = index;
      for (let candidate = index + 1; candidate < records.length; candidate++) {
        endIndex = candidate;
        if (new RegExp(`^\\s*${marker}\\s*$`).test(records[candidate].text)) break;
      }
      for (let candidate = index; candidate <= endIndex; candidate++) fenceLines.add(candidate);
      addSegment(records[index].start, records[endIndex].end, 'fenced_code');
      index = endIndex;
    }

    const documentHasReportFraming = /\b(?:status\s+report|pasted\s+transcript|transcript\s*:|test\s+case|exact\s+request|covered\s+by\s+tests|fix\s+was\s+pushed|previously\s+asked|here(?:'s|\s+is)\s+(?:an?\s+)?(?:example|test))\b/i.test(text);
    let reportedBlock = false;
    for (let index = 0; index < records.length; index++) {
      if (fenceLines.has(index)) continue;
      const record = records[index];
      const line = record.text;
      const trimmed = line.trim();
      if (!trimmed) {
        reportedBlock = false;
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        addSegment(record.start, record.end, 'blockquote');
        continue;
      }
      if (SPEAKER_LINE_RE.test(line)) {
        addSegment(record.start, record.end, 'transcript');
        continue;
      }
      const reportLine = isReportFramingLine(line, documentHasReportFraming);
      if ((reportLine || reportedBlock) && !hasExplicitExecutionFollowup(line)) {
        addSegment(record.start, record.end, reportLine ? 'reported_material' : 'reported_block');
        reportedBlock = reportLine && startsReportedBlock(line) ? true : reportedBlock;
        continue;
      }
      reportedBlock = reportLine && startsReportedBlock(line);
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

  function buildMaskedText(text, segments) {
    const chars = text.split('');
    for (const segment of segments) {
      for (let index = segment.start; index < segment.end; index++) {
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
      }
    }
    return chars.join('');
  }

  function segmentIsExplicitlyReferenced(text, maskedText, segment) {
    const before = maskedText.slice(Math.max(0, segment.start - 240), segment.start);
    const after = maskedText.slice(segment.end, Math.min(maskedText.length, segment.end + 160));
    const beforePattern = new RegExp(
      `(?:^|[\\n.!?;])\\s*(?:(?:can|could|would|will)\\s+you\\s+|(?:i\\s+(?:need|want|would\\s+like)\\s+you\\s+to)\\s+|please\\s+|(?:go\\s+ahead\\s+and)\\s+)?${REFERENCE_VERB_PATTERN}\\b[^\\n.!?;]{0,140}:?\\s*$`,
      'i'
    );
    const afterPattern = new RegExp(
      `^\\s*(?:[-—,:;]\\s*)?(?:(?:please|now|then)\\s+)?${REFERENCE_VERB_PATTERN}\\s+(?:it|that|this|the\\s+(?:command|code|patch|request|instructions?|content))\\b`,
      'i'
    );
    return beforePattern.test(before) || afterPattern.test(after);
  }

  function buildActiveText(text, segments) {
    if (!segments.length) return text;
    let cursor = 0;
    let active = '';
    for (const segment of segments) {
      active += text.slice(cursor, segment.start);
      if (segment.referenced) active += ` [referenced ${segment.type.replace(/_/g, ' ')} content] `;
      cursor = segment.end;
    }
    active += text.slice(cursor);
    return active;
  }

  function actionIsExecutable(verb, remainder) {
    const action = String(verb || '').toLowerCase();
    const object = String(remainder || '').trim().toLowerCase();

    if (action === 'update' && /^(?:me\b|(?:the\s+)?(?:latest\s+)?(?:status|news|changes?)\b.*\b(?:on|about|from)\b)/.test(object)) return false;
    if (action === 'change' && /^(?:how|the\s+way|your\s+(?:tone|wording|phrasing|answers?|responses?))\b/.test(object)) return false;
    if (action === 'generate' || action === 'produce') {
      if (/^(?:me\s+)?(?:ideas?|suggestions?|options?|a\s+summary|an?\s+explanation|an?\s+answer|a\s+report|text|prose)\b/.test(object)) return false;
      return /\b(?:code|file|files|image|asset|screenshot|build|package|script|component|project|app|application|website)\b|\.[a-z0-9]{1,8}\b/i.test(object);
    }
    if (action === 'run' && /^(?:me\s+through|through|over)\b/.test(object)) return false;
    if (action === 'start' && /^(?:by\s+)?(?:explain|explaining|tell|telling|summarize|summarizing|a\s+discussion|a\s+conversation)\b/.test(object)) return false;
    if (action === 'stop' && /^(?:saying|calling|using|phrasing|answering|responding|referring)\b/.test(object)) return false;
    if (action === 'test' && /^(?:my|our)\s+(?:knowledge|understanding)\b/.test(object)) return false;
    if ((action === 'write' || action === 'create') && /^(?:me\s+)?(?:an?\s+)?(?:answer|summary|explanation|story|list\s+of\s+ideas|draft\s+reply)\b/.test(object)) return false;
    if (action === 'save' && /^(?:this|that|my)\s+(?:preference|memory|fact)\b/.test(object)) return false;
    return true;
  }

  function findExecutionCandidate(activeText, referencedSegments) {
    const clauses = String(activeText || '')
      .split(/(?:\r?\n|[.!?;])+/)
      .map(value => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const patterns = [
      new RegExp(`\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:go\\s+ahead\\s+and\\s+)?(${ACTION_PATTERN})\\b(.*)$`, 'i'),
      new RegExp(`\\bi\\s+(?:need|want|would\\s+like)\\s+you\\s+to\\s+(?:please\\s+)?(${ACTION_PATTERN})\\b(.*)$`, 'i'),
      new RegExp(`^(?:please\\s+)?(?:go\\s+ahead\\s+and\\s+)?(${ACTION_PATTERN})\\b(.*)$`, 'i'),
      new RegExp(`\\b(?:have|get)\\s+(?:the\\s+)?coder\\s+(?:to\\s+)?(${ACTION_PATTERN})\\b(.*)$`, 'i'),
      new RegExp(`^(?:let['’]?s|lets)\\s+(${ACTION_PATTERN})\\b(.*)$`, 'i')
    ];

    for (const clause of clauses) {
      for (const pattern of patterns) {
        const match = clause.match(pattern);
        if (!match) continue;
        if (actionIsExecutable(match[1], match[2])) {
          return { verb: match[1].toLowerCase(), object: match[2].trim(), clause };
        }
      }
    }

    if (referencedSegments.length > 0 && new RegExp(`\\b${REFERENCE_VERB_PATTERN}\\s+(?:it|that|this)\\b`, 'i').test(activeText)) {
      return { verb: 'execute_reference', object: referencedSegments[0].type, clause: activeText.trim() };
    }
    return null;
  }

  function analyzeDispatchInstruction(value) {
    const originalText = String(value || '');
    const segments = collectStructuralSegments(originalText);
    const maskedText = buildMaskedText(originalText, segments);
    for (const segment of segments) {
      segment.referenced = segmentIsExplicitlyReferenced(originalText, maskedText, segment);
    }
    const activeText = buildActiveText(originalText, segments).replace(/[ \t]+/g, ' ').trim();
    const referencedSegments = segments.filter(segment => segment.referenced);
    const candidate = findExecutionCandidate(activeText, referencedSegments);
    const requiresCoderExecution = !!candidate;
    let reason = 'no_execution_request';
    if (requiresCoderExecution) reason = 'direct_execution_request';
    else if (segments.length > 0 && !activeText) reason = 'quoted_or_reported_material_only';
    else if (segments.length > 0) reason = 'surrounding_text_does_not_request_execution';

    return {
      originalText,
      activeText,
      segments: segments.map(segment => ({ ...segment })),
      referencedSegments: referencedSegments.map(segment => ({ ...segment })),
      ignoredSegments: segments.filter(segment => !segment.referenced).map(segment => ({ ...segment })),
      requiresCoderExecution,
      action: candidate ? candidate.verb : '',
      actionObject: candidate ? candidate.object : '',
      reason
    };
  }

  function dispatchRequestRequiresCoderExecution(text) {
    return analyzeDispatchInstruction(text).requiresCoderExecution;
  }

  const api = { analyzeDispatchInstruction, dispatchRequestRequiresCoderExecution };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionDispatchIntent = api;
})(typeof window !== 'undefined' ? window : globalThis);
