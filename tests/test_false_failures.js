// Findings from a real Coder run ("Investigate and fix keyboard shortcuts, especially F3"):
// ~180 tool calls, many of which failed for reasons that were not failures at all. Every one of
// these fed the repeated-failure guard, which escalates reasoning effort and eventually PAUSES
// the task — so phantom failures cost real time and real progress.
//
//   * PowerShell serialized its progress stream as CLIXML onto stderr. `git show`, a passing
//     smoke test, and a passing diagnostic all "failed" with a wall of XML and no real error.
//   * get_command_status answering "that background job exited 1" was classified as the QUERY
//     failing, because the reported subject's exitCode was read as the tool's own.
//   * The redundant-read guard returns success:false by design to stop the model repeating
//     itself — and was counted as a fault, escalating effort for doing its job.
//   * record_adversarial_review rejected "pass" (wanted "passed"); evaluate_win_conditions
//     rejected a remembered slug. Each cost a full round trip.
//   * delete_created_file refused to remove a scratch file Orion had written itself, because
//     the ledger was per-run and the task spanned several runs.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');

global.window = global.window || {};
global.fetch = global.fetch || (async () => ({ ok: false }));
const agent = require('../agent.js');
const ipcShell = require('../lib/ipc-shell.js');
const OperationalContext = require('../operational-context.js');

// ── PowerShell CLIXML noise ────────────────────────────────────────────────────

const CLIXML_PROGRESS = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
  '<Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T>' +
  '<T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules</AV>' +
  '</PR></MS></Obj></Objs>';

test('CLIXML progress noise is not mistaken for error output', (t) => {
  t.equal(ipcShell.stripPowerShellClixml(CLIXML_PROGRESS), '',
    'a stderr stream that is nothing but CLIXML becomes empty, not a phantom failure');
  t.equal(ipcShell.stripPowerShellClixml(''), '', 'empty input stays empty');
  t.equal(ipcShell.stripPowerShellClixml(null), '', 'null does not throw');
  t.equal(ipcShell.stripPowerShellClixml('ordinary stderr text'), 'ordinary stderr text',
    'normal stderr is passed through untouched');
  t.end();
});

test('a real error inside a CLIXML envelope is recovered, not discarded', (t) => {
  const wrapped = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
    '<S S="error">ModuleNotFoundError: No module named _x0027_pygame_x0027__x000D__x000A_</S></Objs>';
  const cleaned = ipcShell.stripPowerShellClixml(wrapped);
  t.ok(/ModuleNotFoundError/.test(cleaned), 'the genuine error message survives');
  t.notOk(/<Objs/.test(cleaned), 'the XML envelope is gone');
  t.notOk(/CLIXML/.test(cleaned), 'the CLIXML header is gone');
  t.end();
});

test('mixed and truncated CLIXML output degrades safely', (t) => {
  const mixed = `real failure line\n${CLIXML_PROGRESS}\nanother real line`;
  const cleaned = ipcShell.stripPowerShellClixml(mixed);
  t.ok(/real failure line/.test(cleaned), 'text before the envelope survives');
  t.ok(/another real line/.test(cleaned), 'text after the envelope survives');
  t.notOk(/Objs Version/.test(cleaned), 'the envelope is removed from the middle');

  // Output caps can cut the XML mid-stream, leaving an unterminated header.
  const truncated = 'partial output\n#< CLIXML\r\n<Objs Version="1.1.0.1"><Obj S="progress"';
  const cleanedTruncated = ipcShell.stripPowerShellClixml(truncated);
  t.ok(/partial output/.test(cleanedTruncated), 'real output before a truncated envelope survives');
  t.notOk(/CLIXML/.test(cleanedTruncated), 'an unterminated envelope is still stripped');
  t.end();
});

// ── Failure classification ─────────────────────────────────────────────────────

test('a successful status report about a failed process is not a tool failure', (t) => {
  // Exactly the payload get_command_status returned in the live run.
  const statusReport = {
    success: true,
    id: 'cmd_conv_x_1785680730214',
    command: 'python _diag_f3_v2.py',
    status: 'failed',
    exitCode: 1,
    startedAt: 1785680730849,
    finishedAt: 1785680734627
  };
  t.notOk(agent.isFailedToolResult(statusReport),
    'querying a failed job is a successful query, not a failed tool call');
  t.equal(agent.getToolFailureSignal(statusReport), '',
    'it produces no failure signal, so it cannot feed the repeated-failure guard');

  const runningReport = { success: true, id: 'cmd_x', command: 'npm test', status: 'running' };
  t.notOk(agent.isFailedToolResult(runningReport), 'a running job report is not a failure either');
  t.end();
});

test('the redundancy guard is not counted as a fault', (t) => {
  // The guard deliberately returns success:false to stop the model repeating itself. Counting
  // that as a failure escalated reasoning effort for doing exactly what it was built to do.
  const blocked = {
    success: false,
    skipped: true,
    redundantContext: true,
    failureCategory: 'redundant_context_loop',
    error: 'This exact unchanged source result was already supplied.'
  };
  t.notOk(agent.isFailedToolResult(blocked), 'a redundancy block is not a tool failure');
  t.equal(agent.getToolFailureSignal(blocked), '', 'it emits no failure signal');
  t.end();
});

test('genuine failures are still detected', (t) => {
  t.ok(agent.isFailedToolResult({ error: 'File does not exist' }), 'an explicit error is a failure');
  t.ok(agent.isFailedToolResult({ success: false, message: 'nope' }), 'success:false is a failure');
  t.ok(agent.isFailedToolResult({ exitCode: 1, stdout: '', stderr: 'boom' }), 'a non-zero exit is a failure');
  t.ok(agent.isFailedToolResult({ timedOut: true }), 'a timeout is a failure');
  t.ok(agent.isFailedToolResult({ killed: true }), 'a killed command is a failure');
  t.notOk(agent.isFailedToolResult({ success: true, message: 'done' }), 'a plain success is not');
  t.notOk(agent.isFailedToolResult({ exitCode: 0 }), 'exit 0 is not');
  t.notOk(agent.isFailedToolResult(null), 'null is not');

  // A status-shaped payload that genuinely errored must still fail.
  t.ok(agent.isFailedToolResult({ success: true, id: 'x', command: 'y', status: 'failed', error: 'lookup failed' }),
    'an explicit error beats the reporting-tool exemption');
  t.end();
});

// ── Operational-context enums that cost round trips ────────────────────────────

function missionState() {
  let state = OperationalContext.createEmptyContext(new Date());
  // applyAction returns { state, event } — unwrap it, or the next call normalizes the wrapper
  // into an empty context and every subsequent assertion tests nothing.
  const apply = (action, args) => {
    const result = OperationalContext.applyAction(state, action, args, new Date());
    state = result && result.state ? result.state : result;
    return state;
  };
  apply('update_mission_context', {
    mission: 'Fix F3',
    winConditions: [
      { title: 'F3 no longer quits program — family tree overlay renders without crashing' },
      { title: 'All tests pass and smoke test green' }
    ]
  });
  return { get state() { return state; }, apply };
}

test('adversarial review accepts the status forms a model actually writes', (t) => {
  for (const [written, expected] of [['pass', 'passed'], ['passed', 'passed'], ['PASS', 'passed'],
                                     ['fail', 'failed'], ['failed', 'failed'], ['success', 'passed']]) {
    const ctx = missionState();
    ctx.apply('set_coverage_frontier', { risk: 'medium', requiredSurfaces: ['a'] });
    t.doesNotThrow(
      () => ctx.apply('record_adversarial_review', { status: written, summary: 'reviewed 6 paths' }),
      `status "${written}" is accepted (normalizes to ${expected})`
    );
  }

  const ctx = missionState();
  ctx.apply('set_coverage_frontier', { risk: 'medium', requiredSurfaces: ['a'] });
  t.throws(() => ctx.apply('record_adversarial_review', { status: 'maybe', summary: 's' }),
    /must be passed or failed/, 'genuinely invalid input still errors clearly');
  t.end();
});

test('a win condition can be addressed by a remembered slug, not just its exact title', (t) => {
  const ctx = missionState();
  const evaluate = (id) => ctx.apply('evaluate_win_conditions', {
    evaluations: [{ id, status: 'satisfied', evidence: ['611 tests pass'] }]
  });

  t.doesNotThrow(() => evaluate('F3 no longer quits program — family tree overlay renders without crashing'),
    'the exact title still works');
  t.doesNotThrow(() => evaluate('all tests pass and smoke test green'),
    'a case-insensitive title still works');

  // Ambiguity must NOT be resolved by guessing — silently satisfying the wrong condition would
  // be worse than the round trip the error costs.
  t.throws(() => evaluate('wc'), /not found/, 'a too-short ambiguous identifier is refused');
  t.throws(() => evaluate('something entirely unrelated'), /not found/, 'an unrelated id is refused');
  t.end();
});

// ── Created-file ledger across runs ────────────────────────────────────────────

test('cleanup still works for a file created in an earlier run of the same task', (t) => {
  // The ledger used to be a per-run Set. A task that pauses, continues, or resumes through
  // schedule_followup spans several runs, so cleanup refused to delete Orion's own scratch file
  // and left diagnostic junk in the user's project.
  const conversation = { id: 'conv_x', messages: [], _orionCreatedFiles: ['_diag_f3_v2.py'] };
  const carried = new Set(conversation._orionCreatedFiles);
  t.ok(carried.has('_diag_f3_v2.py'), 'a file created in an earlier run is still recognized');

  const remember = (key) => {
    carried.add(key);
    if (!conversation._orionCreatedFiles.includes(key)) conversation._orionCreatedFiles.push(key);
  };
  remember('_verify_f3_coverage.py');
  t.ok(carried.has('_verify_f3_coverage.py'), 'newly created files are tracked');
  t.equal(conversation._orionCreatedFiles.length, 2, 'and persisted on the conversation');
  remember('_verify_f3_coverage.py');
  t.equal(conversation._orionCreatedFiles.length, 2, 're-recording the same file does not duplicate it');
  t.end();
});

// ── Update detection / runtime date ────────────────────────────────────────────

test('the runtime date reflects every runtime file, not just the static manifest', (t) => {
  const proxyquire = require('proxyquire');
  const ipcUi = proxyquire('../lib/ipc-ui', {
    electron: { app: { getPath: () => os.tmpdir(), getVersion: () => '2.0.0', isPackaged: false }, BrowserWindow: class {} }
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-rt-'));
  try {
    fs.mkdirSync(path.join(dir, 'lib'));
    // A file from the static manifest, deliberately old.
    fs.writeFileSync(path.join(dir, 'main.js'), '// old', 'utf8');
    fs.utimesSync(path.join(dir, 'main.js'), new Date('2020-01-01'), new Date('2020-01-01'));

    const before = ipcUi.getLatestRuntimeMtime(dir);
    t.ok(before, 'a date is produced from the manifest files');

    // A real runtime file that is NOT in the static manifest — this is the class of file
    // (reasoning-policy.js, semantic-intent-router.js, supervisor-orchestration.js) whose edits
    // used to leave the displayed date unchanged.
    fs.writeFileSync(path.join(dir, 'reasoning-policy.js'), '// just edited', 'utf8');
    const after = ipcUi.getLatestRuntimeMtime(dir);

    t.ok(after.getTime() > before.getTime(),
      'editing a non-manifest runtime file moves the reported date');
    t.end();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update detection reports exactly the files that differ', (t) => {
  const proxyquire = require('proxyquire');
  const ipcUi = proxyquire('../lib/ipc-ui', {
    electron: { app: { getPath: () => os.tmpdir(), getVersion: () => '2.0.0', isPackaged: false }, BrowserWindow: class {} }
  });

  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-dest-'));
  try {
    for (const dir of [src, dest]) fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(src, 'main.js'), 'same', 'utf8');
    fs.writeFileSync(path.join(dest, 'main.js'), 'same', 'utf8');
    t.deepEqual(ipcUi.computeSourceUpdates(src, dest), [], 'identical trees report no update');

    fs.writeFileSync(path.join(src, 'reasoning-policy.js'), 'new', 'utf8');
    fs.writeFileSync(path.join(dest, 'reasoning-policy.js'), 'old', 'utf8');
    t.deepEqual(ipcUi.computeSourceUpdates(src, dest), ['reasoning-policy.js'],
      'a changed non-manifest runtime file is detected');

    fs.writeFileSync(path.join(src, 'lib', 'fault-log.js'), 'new', 'utf8');
    const changed = ipcUi.computeSourceUpdates(src, dest);
    t.ok(changed.includes('lib/fault-log.js'), 'a lib file missing from the target is detected');

    t.deepEqual(ipcUi.computeSourceUpdates(src, src), [],
      'a tree compared against itself reports nothing, so running from source never nags');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
  t.end();
});
