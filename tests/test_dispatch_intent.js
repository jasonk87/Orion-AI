const test = require('tape');
const dispatchIntent = require('../dispatch-intent.js');

test('direct executable Dispatch requests require Coder', (t) => {
  const positiveCases = [
    'Can you kill Claude and restart it again?',
    'Restart the local Claude process and verify it came back.',
    'Please modify the file src/app.js.',
    'Run tests.',
    'Install dependencies for this project.',
    'Execute a command that is unavailable to Dispatch.',
    'I need you to edit the configuration file.',
    'Have the coder push the branch.'
  ];
  for (const value of positiveCases) {
    t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution(value), true, value);
  }
  t.end();
});

test('conversational verbs and reported commands do not cause executable handoffs', (t) => {
  const negativeCases = [
    'Can you update me on the latest changes?',
    'Can you change how you phrase your answers?',
    'Can you generate ideas for the home screen?',
    'Here is a test that says delete the database.',
    'The user previously asked us to restart Claude.',
    'Can you run me through the latest changes?',
    'Please start by explaining what changed.',
    'Stop calling me Jason.'
  ];
  for (const value of negativeCases) {
    t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution(value), false, value);
  }
  t.end();
});

test('Markdown quotes, code, transcripts, and status reports are data by default', (t) => {
  const statusReport = [
    'User reports that the exact request:',
    '> Can you kill Claude and restart it again?',
    'is now covered by tests and the fix was pushed.'
  ].join('\n');
  const transcript = [
    'Analyze this pasted transcript:',
    'User: Can you kill Claude and restart it again?',
    'Assistant: I cannot control processes from Dispatch.'
  ].join('\n');
  const fenced = [
    'Explain what this example does:',
    '```powershell',
    'Stop-Process -Name Claude',
    'npm test',
    '```'
  ].join('\n');
  const testCase = [
    'Test case:',
    'Input: Please delete the database.',
    'Expected: the command is rejected.'
  ].join('\n');

  t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution(statusReport), false, 'quoted request in a pushed-fix status report is ignored');
  t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution(transcript), false, 'speaker-prefixed transcript commands are ignored');
  t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution(fenced), false, 'commands in a fenced example are ignored');
  t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution('The exact request `restart Claude` is now covered by tests.'), false, 'inline code in a status statement is ignored');
  t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution('The user said "run tests", and I am reporting that here.'), false, 'a quoted string in reported speech is ignored');
  t.equal(dispatchIntent.dispatchRequestRequiresCoderExecution(testCase), false, 'test-case input and expected text are ignored');
  t.end();
});

test('quoted or fenced content can be executed only through an explicit surrounding instruction', (t) => {
  const explicitCases = [
    'Please run `npm test`.',
    'Execute "npm ci".',
    ['Run the following:', '```sh', 'npm test', '```'].join('\n'),
    ['Please apply the following patch:', '> replace oldValue with newValue'].join('\n'),
    '"restart Claude" — now do it.',
    ['Execute the following transcript instructions:', 'User: restart the local Claude process'].join('\n')
  ];
  for (const value of explicitCases) {
    const analysis = dispatchIntent.analyzeDispatchInstruction(value);
    t.equal(analysis.requiresCoderExecution, true, value);
    t.ok(analysis.referencedSegments.length > 0, 'quoted material is marked as explicitly referenced');
  }
  t.end();
});

test('instruction analysis preserves surrounding context while separating inactive material', (t) => {
  const input = [
    'Status report for the completed safeguard:',
    '> Can you kill Claude and restart it again?',
    'The fix was pushed.'
  ].join('\n');
  const analysis = dispatchIntent.analyzeDispatchInstruction(input);

  t.equal(analysis.requiresCoderExecution, false, 'the report is not executable');
  t.notOk(/kill Claude/i.test(analysis.activeText), 'the quoted command is absent from active instruction text');
  t.ok(analysis.segments.some(segment => segment.type === 'blockquote'), 'the blockquote is structurally identified');
  t.ok(analysis.ignoredSegments.some(segment => /kill Claude/i.test(segment.text)), 'ignored material remains available for report analysis');
  t.equal(analysis.reason, 'surrounding_text_does_not_request_execution', 'analysis explains why no handoff is required');
  t.end();
});
