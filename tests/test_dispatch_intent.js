'use strict';

const test = require('tape');
const dispatchIntent = require('../dispatch-intent.js');

test('Dispatch message structure masks quoted commands without deciding their meaning', t => {
  const input = [
    'User reports that the exact request:',
    '> Can you kill Claude and restart it again?',
    'is now covered by tests and the fix was pushed.'
  ].join('\n');
  const result = dispatchIntent.analyzeMessageStructure(input);

  t.equal(result.originalText, input, 'the exact current message remains available to the semantic classifier');
  t.notOk(/kill Claude/i.test(result.activeText), 'the blockquoted command is absent from active text');
  t.match(result.activeText, /covered by tests/i, 'the surrounding live report remains available');
  t.equal(result.containsQuotedText, true, 'quoted structure is recorded explicitly');
  t.ok(result.segments.some(segment => segment.type === 'blockquote'), 'the blockquote is represented as a structural segment');
  t.notOk(Object.prototype.hasOwnProperty.call(result, 'requiresCoderExecution'), 'the structural layer does not classify execution intent');
  t.end();
});

test('fenced code and inline code are mechanically separated from active prose', t => {
  const input = [
    'Explain why this failed; do not execute it.',
    '```powershell',
    'Remove-Item data.db -Force',
    '```',
    'The test also prints `restart Claude`.'
  ].join('\n');
  const result = dispatchIntent.analyzeMessageStructure(input);

  t.notOk(/Remove-Item|restart Claude/i.test(result.activeText), 'code examples are absent from active prose');
  t.match(result.activeText, /Explain why this failed/i, 'the actual surrounding instruction remains active');
  t.equal(result.containsCodeBlock, true, 'the fenced block is recorded');
  t.equal(result.containsQuotedText, true, 'inline code is recorded');
  t.ok(result.segments.some(segment => segment.type === 'fenced_code'), 'fenced code is segmented');
  t.ok(result.segments.some(segment => segment.type === 'inline_code'), 'inline code is segmented');
  t.end();
});

test('pasted speaker transcripts remain data while following prose remains active', t => {
  const input = [
    'Analyze this transcript:',
    'User: Can you kill Claude and restart it again?',
    'Assistant: I cannot control processes from Dispatch.',
    '',
    'Explain why that answer was wrong.'
  ].join('\n');
  const result = dispatchIntent.analyzeMessageStructure(input);

  t.notOk(/kill Claude|cannot control processes/i.test(result.activeText), 'speaker turns are masked');
  t.match(result.activeText, /Explain why that answer was wrong/i, 'the post-transcript request remains visible');
  t.equal(result.containsTranscript, true, 'transcript structure is recorded');
  t.ok(result.segments.filter(segment => segment.type === 'transcript').length >= 2, 'both transcript turns are segmented');
  t.end();
});

test('report headings mechanically protect their bounded body', t => {
  const input = [
    'Test case:',
    'Input: Please delete the database.',
    'Expected: the command is rejected.',
    '',
    'Summarize the coverage gap.'
  ].join('\n');
  const result = dispatchIntent.analyzeMessageStructure(input);

  t.equal(result.containsReportedMaterial, true, 'reported material is identified');
  t.notOk(/delete the database/i.test(result.activeText), 'reported command text is masked');
  t.match(result.activeText, /Summarize the coverage gap/i, 'the live request after the report boundary remains active');
  t.end();
});

test('plain ordinary English is preserved verbatim for the semantic classifier', t => {
  const cases = [
    "What's up?",
    'How is Coder doing?',
    'You need to stop doing that.',
    'Stop the active task.',
    'Go ahead.',
    'No, revise the plan instead.'
  ];
  for (const value of cases) {
    const result = dispatchIntent.analyzeMessageStructure(value);
    t.equal(result.activeText, value, `${value} is not classified or altered by structural parsing`);
    t.deepEqual(result.segments, [], 'no machine structure is invented');
  }
  t.end();
});

test('backward-compatible analysis name remains structural only', t => {
  const result = dispatchIntent.analyzeDispatchInstruction('Run tests.');
  t.equal(result.activeText, 'Run tests.', 'legacy callers still receive the active text');
  t.notOk(Object.prototype.hasOwnProperty.call(result, 'intent'), 'the compatibility alias does not infer semantic intent');
  t.notOk(Object.prototype.hasOwnProperty.call(result, 'requiresCoderExecution'), 'the compatibility alias does not infer execution');
  t.end();
});
