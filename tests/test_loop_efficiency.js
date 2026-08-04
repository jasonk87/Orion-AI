// Why this file exists: Orion would run the same search dozens of times on a single task and
// take minutes to reach an answer other agents reach in seconds. Three separate causes, all
// covered here.
//
//  1. Reads were deduplicated; SEARCHES WERE NOT. getRecentRedundantContextRead only ever
//     handled read_file and read_multiple_ranges, so grep_search/semantic_search/etc. were
//     completely unbounded — the literal "it greps 100 times" behavior.
//  2. Every ordinary tool turn paid HIGH reasoning effort. The DeepSeek provider mapping
//     collapsed medium into 'high', and the phase that qualifies for cheap reasoning omitted
//     inspect_code_context/semantic_search — so using the BETTER retrieval tools cost more.
//  3. Repeated failure WIDENED exploration to the whole project, feeding the thrash loop it
//     was meant to break.

const test = require('tape');
global.window = global.window || {};
global.fetch = global.fetch || (async () => ({ ok: false }));
const agent = require('../agent.js');
const policy = require('../reasoning-policy.js');

// ── Search deduplication ───────────────────────────────────────────────────────

function ledgerWithSearch(toolName, args, result) {
  const ledger = agent.createContextAcquisitionLedger();
  agent.recordContextAcquisitionToolResult(ledger, toolName, args, result);
  return ledger;
}

test('an identical repeated search is replayed once, then refused', (t) => {
  const args = { pattern: 'loadSettings', filePattern: '*.js' };
  const original = { success: true, matches: ['renderer.js:538'] };
  const ledger = ledgerWithSearch('grep_search', args, original);

  const first = agent.getRepeatedSearchResult(ledger, 'grep_search', args);
  t.ok(first, 'the second identical search is intercepted');
  t.equal(first.success, true, 'the cached result is served rather than failing the turn');
  t.deepEqual(first.matches, ['renderer.js:538'], 'the real prior result is returned, not an empty stub');
  t.ok(first.reusedEvidence, 'it is marked as reused evidence');
  t.ok(/already ran this exact/i.test(first.redundantSearchNote), 'the model is told it already ran this');

  const second = agent.getRepeatedSearchResult(ledger, 'grep_search', args);
  t.equal(second.success, false, 'a third identical search is refused outright');
  t.equal(second.failureCategory, 'redundant_context_loop', 'it is categorized as a loop, not a tool error');
  t.equal(second.retryable, false, 'the model is told retrying will not help');
  t.ok(/different query|read a specific file|answer/i.test(second.requiredNextAction),
    'the refusal names concrete alternatives instead of just saying no');

  const third = agent.getRepeatedSearchResult(ledger, 'grep_search', args);
  t.equal(third.success, false, 'further repeats stay blocked');
  t.equal(ledger.repeatedSearchBlocks, 2, 'blocked repeats are counted for the run receipt');
  t.end();
});

test('every search tool is covered, not just grep', (t) => {
  for (const tool of ['grep_search', 'semantic_search', 'search_embeddings',
                      'inspect_code_context', 'find_references', 'get_file_symbols',
                      'get_symbol_index', 'list_files']) {
    const args = { query: 'x', pattern: 'x', symbolName: 'x', path: 'x' };
    const ledger = ledgerWithSearch(tool, args, { success: true, data: tool });
    t.ok(agent.getRepeatedSearchResult(ledger, tool, args), `${tool} is deduplicated`);
  }
  t.end();
});

test('a different search is never blocked', (t) => {
  const ledger = ledgerWithSearch('grep_search', { pattern: 'alpha' }, { success: true });
  t.equal(agent.getRepeatedSearchResult(ledger, 'grep_search', { pattern: 'beta' }), null,
    'a different pattern runs normally');
  t.equal(agent.getRepeatedSearchResult(ledger, 'semantic_search', { pattern: 'alpha' }), null,
    'the same term through a different tool runs normally');
  t.equal(agent.getRepeatedSearchResult(ledger, 'read_file', { path: 'a.js' }), null,
    'non-search tools are untouched by this guard');
  t.end();
});

test('argument key order does not create a false new search', (t) => {
  const ledger = ledgerWithSearch('grep_search', { pattern: 'x', filePattern: '*.js' }, { success: true });
  t.ok(agent.getRepeatedSearchResult(ledger, 'grep_search', { filePattern: '*.js', pattern: 'x' }),
    'the same search with reordered arguments is recognized as identical');
  t.end();
});

test('a write invalidates cached searches so results can never go stale', (t) => {
  const args = { pattern: 'loadSettings' };
  const ledger = ledgerWithSearch('grep_search', args, { success: true, matches: ['old.js:1'] });
  t.ok(agent.getRepeatedSearchResult(ledger, 'grep_search', args), 'cached before any edit');

  // The edited file is unrelated to the search term on purpose: a search is workspace-scoped,
  // so any write can change what any query would now return.
  agent.invalidateContextAcquisitionForFile(ledger, 'some/other/file.js', 'write_file');

  t.equal(agent.getRepeatedSearchResult(ledger, 'grep_search', args), null,
    'after a write the search runs for real again instead of serving a stale result');
  t.end();
});

test('failed searches are not cached, so a transient failure cannot trap the agent', (t) => {
  const args = { pattern: 'x' };
  const ledger = ledgerWithSearch('grep_search', args, { error: 'index unavailable' });
  t.equal(agent.getRepeatedSearchResult(ledger, 'grep_search', args), null,
    'a retry after a failed search is allowed through');
  t.end();
});

test('a replayed result is not re-cached as if it were fresh', (t) => {
  const args = { pattern: 'x' };
  const ledger = ledgerWithSearch('grep_search', args, { success: true, matches: ['a'] });
  const replayed = agent.getRepeatedSearchResult(ledger, 'grep_search', args);
  agent.recordContextAcquisitionToolResult(ledger, 'grep_search', args, replayed);
  t.equal(ledger.recentSearchResults.get(agent.searchRequestKey('grep_search', args)).result.matches[0], 'a',
    'the original result stays cached rather than being overwritten by its own replay');
  t.end();
});

test('the run receipt reports repeated searching', (t) => {
  const args = { pattern: 'x' };
  const ledger = ledgerWithSearch('grep_search', args, { success: true });
  agent.getRepeatedSearchResult(ledger, 'grep_search', args);
  agent.getRepeatedSearchResult(ledger, 'grep_search', args);

  const receipt = agent.buildContextAcquisitionReceipt(ledger);
  t.equal(receipt.blockedRepeatedSearches, 1, 'blocked repeats are surfaced');
  t.ok(receipt.repeatedSearchAttempts.length > 0, 'the offending query is named');
  t.ok(/grep_search/.test(receipt.repeatedSearchAttempts[0].request), 'the receipt identifies the tool');
  t.end();
});

// ── Reasoning cost per turn ────────────────────────────────────────────────────

test('DeepSeek gets four distinct effort levels, not two', (t) => {
  t.deepEqual(policy.providerControls('deepseek-v4', { effort: 'low' }),
    { thinking: { type: 'disabled' } }, 'low disables thinking entirely');
  t.deepEqual(policy.providerControls('deepseek-v4', { effort: 'medium' }),
    { thinking: { type: 'enabled' }, reasoning_effort: 'medium' },
    'medium costs medium — it used to be silently upgraded to high on every ordinary turn');
  t.deepEqual(policy.providerControls('deepseek-v4', { effort: 'high' }),
    { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, 'high stays high');
  t.deepEqual(policy.providerControls('deepseek-v4', { effort: 'max' }),
    { thinking: { type: 'enabled' }, reasoning_effort: 'max' }, 'max stays max');
  t.end();
});

test('a turn that only consumed reads and searches qualifies for cheap reasoning', (t) => {
  const cheap = agent.LOW_EFFORT_RESULT_TOOLS;
  // Interpreting a grep result needs no extended thinking; deciding the next tool is the job.
  for (const tool of ['grep_search', 'read_file', 'read_multiple_ranges', 'list_files',
                      'run_tests', 'git_diff', 'read_command_output']) {
    t.ok(cheap.has(tool), `${tool} results are cheap to interpret`);
  }
  // The regression: index-backed retrieval was missing, so using Orion's better tools forced
  // the turn into 'implementation' and paid high effort while a plain grep stayed cheap.
  for (const tool of ['inspect_code_context', 'semantic_search', 'find_references', 'get_file_symbols']) {
    t.ok(cheap.has(tool), `${tool} is cheap too — using the better retrieval tool must not cost more`);
  }
  // Anything that changes the world still deserves real deliberation.
  for (const tool of ['write_file', 'patch_file', 'modify_file', 'handoff_to_coder', 'git_push']) {
    t.notOk(cheap.has(tool), `${tool} still gets full reasoning effort`);
  }
  t.end();
});

test('mechanical turns resolve to low effort end to end', (t) => {
  const selected = policy.select({ phase: 'mechanical_execution' });
  t.equal(selected.effort, 'low', 'the phase resolves to low effort');
  t.deepEqual(policy.providerControls('deepseek-v4', selected),
    { thinking: { type: 'disabled' } },
    'and that reaches DeepSeek as thinking-disabled, which is the actual latency saving');
  t.end();
});

// ── Failure response ───────────────────────────────────────────────────────────

test('repeated failure tightens exploration instead of widening it', (t) => {
  const scopes = [0, 1, 3].map(failureCount =>
    policy.select({ phase: 'failure_diagnosis', failureCount }).explorationScope);
  t.deepEqual(scopes, ['bounded', 'bounded', 'narrow'],
    'exploration only ever tightens as failures accumulate');

  const worst = policy.select({ phase: 'failure_diagnosis', failureCount: 5 });
  t.equal(worst.effort, 'max', 'reasoning still escalates — think harder, search less');
  t.equal(worst.contextScope, 'project', 'evidence already gathered is not taken away');
  t.end();
});

// ── Offered tool surface ───────────────────────────────────────────────────────
// Every turn shipped all ~65 tool schemas (~13.7k tokens) regardless of which gate was active.
// Beyond the token cost, the model could call a tool the gate was certain to refuse and burn a
// whole round trip at whatever reasoning effort that turn was running.

// Coder is the mode the implementation loop runs in; Dispatch has its own narrow allowlist.
function toolNamesForProfile(profile, mode = 'coder') {
  agent.__setActiveConversationModeForTest(mode);
  agent.setActiveToolGateProfile(profile);
  const names = new Set(agent.buildAgentToolDeclarations().map(tool => tool.name));
  agent.setActiveToolGateProfile(null);
  agent.__setActiveConversationModeForTest('orion');
  return names;
}

test('an unrestricted turn still sees the full tool surface', (t) => {
  const names = toolNamesForProfile(null);
  t.ok(names.size > 40, 'no gate means no filtering');
  t.ok(names.has('patch_file'), 'editing tools are available');
  t.ok(names.has('run_tests'), 'verification tools are available');
  t.end();
});

test('the gate applies to Dispatch conversations too, not just Coder', (t) => {
  // Regression: the Dispatch allowlist used to return early and skip gate filtering entirely,
  // so a review-only Dispatch turn still saw tools it would refuse.
  const ungated = toolNamesForProfile(null, 'orion');
  const gated = toolNamesForProfile({ reviewOnly: true }, 'orion');
  for (const name of gated) t.ok(ungated.has(name), `${name} is still within the Dispatch allowlist`);
  t.ok(gated.size <= ungated.size, 'gating never widens the Dispatch surface');
  t.end();
});

test('planning mode stops offering tools it would refuse', (t) => {
  const names = toolNamesForProfile({ planningMode: true, canExecute: false });

  for (const blocked of agent.PLANNING_BLOCKED_TOOLS) {
    t.notOk(names.has(blocked), `${blocked} is not offered while it would be refused`);
  }
  // write_file survives on purpose: during planning it is ALLOWED for STRATEGY.md and
  // implementation_plan.md, so removing it would break the planning ritual itself.
  t.ok(names.has('write_file'), 'write_file stays — planning genuinely needs it for the plan artifacts');
  t.ok(names.has('read_file'), 'reading is untouched');
  t.ok(names.has('grep_search'), 'searching is untouched');
  t.end();
});

test('an approved plan restores the full surface', (t) => {
  const names = toolNamesForProfile({ planningMode: true, canExecute: true });
  t.ok(names.has('patch_file'), 'once execution is approved, editing is offered again');
  t.ok(names.has('run_tests'), 'and so is verification');
  t.end();
});

test('review-only and plan-revision turns are filtered to their own gates', (t) => {
  const review = toolNamesForProfile({ reviewOnly: true });
  for (const blocked of agent.REVIEW_ONLY_BLOCKED_TOOLS) {
    t.notOk(review.has(blocked), `review-only does not offer ${blocked}`);
  }
  t.ok(review.has('read_file'), 'a review can still read');
  t.ok(review.has('write_file'), 'write_file stays: STRATEGY.md is an allowed review artifact');

  const revision = toolNamesForProfile({ planRevision: true });
  for (const blocked of agent.PLAN_REVISION_BLOCKED_TOOLS) {
    t.notOk(revision.has(blocked), `plan revision does not offer ${blocked}`);
  }
  t.ok(revision.has('write_file') && revision.has('modify_file') && revision.has('patch_file'),
    'the three plan-artifact editors stay, since revision is allowed to edit the plan');
  t.end();
});

test('filtering measurably shrinks the per-turn schema', (t) => {
  const sizeFor = (profile) => {
    agent.__setActiveConversationModeForTest('coder');
    agent.setActiveToolGateProfile(profile);
    const size = JSON.stringify(agent.buildAgentToolDeclarations()).length;
    agent.setActiveToolGateProfile(null);
    agent.__setActiveConversationModeForTest('orion');
    return size;
  };

  const full = sizeFor(null);
  const planning = sizeFor({ planningMode: true, canExecute: false });
  const review = sizeFor({ reviewOnly: true });
  const pct = (n) => Math.round((1 - n / full) * 100);

  t.ok(planning < full, `planning schema is ${pct(planning)}% smaller (${planning} vs ${full} chars)`);
  t.ok(review < full, `review-only schema is ${pct(review)}% smaller (${review} vs ${full} chars)`);
  t.end();
});

test('the gate and the offered schema cannot drift apart', (t) => {
  // Both now read the same frozen constants. If someone adds a tool to one list only, the
  // model would either be offered a tool that gets refused, or denied one it needs.
  t.ok(Object.isFrozen(agent.PLANNING_BLOCKED_TOOLS), 'the planning list is immutable');
  t.ok(Object.isFrozen(agent.REVIEW_ONLY_BLOCKED_TOOLS), 'the review list is immutable');
  t.ok(Object.isFrozen(agent.PLAN_REVISION_BLOCKED_TOOLS), 'the revision list is immutable');

  t.deepEqual([...agent.getToolsBlockedByActiveGate()], [], 'no profile blocks nothing');
  agent.setActiveToolGateProfile({ reviewOnly: true, planRevision: true, planningMode: true, canExecute: false });
  t.deepEqual([...agent.getToolsBlockedByActiveGate()].sort(), [...agent.REVIEW_ONLY_BLOCKED_TOOLS].sort(),
    'review-only wins when several gates overlap, matching the runtime order');
  agent.setActiveToolGateProfile(null);
  t.end();
});

// ── Run instrumentation ────────────────────────────────────────────────────────

test('every run records the numbers needed to tell if the loop is efficient', (t) => {
  const ledger = agent.createContextAcquisitionLedger();
  ledger.readCalls = 4;
  ledger.searchCalls = 31;
  ledger.repeatedSearchBlocks = 12;

  const stats = agent.recordRunEfficiency({
    loopCount: 18,
    maxLoops: 20,
    elapsedMs: 96000,
    startupMs: 3100,
    totalElapsedMs: 99100,
    intentClassificationMs: 2700,
    modelName: 'deepseek-v4',
    ledger,
    workWalkthrough: new Array(44)
  });

  t.equal(stats.turns, 18, 'turns per task is recorded');
  t.equal(stats.seconds, 96, 'wall clock is recorded');
  t.equal(stats.startupSeconds, 3.1, 'pre-model startup latency is recorded separately');
  t.equal(stats.totalSeconds, 99.1, 'the user-visible total is recorded');
  t.equal(stats.intentClassificationSeconds, 2.7, 'semantic classification latency is visible');
  t.equal(stats.secondsPerTurn, 5.3, 'per-turn latency is derived');
  t.equal(stats.toolCalls, 44, 'total tool calls are recorded');
  t.equal(stats.searchCalls, 31, 'search volume is visible');
  t.equal(stats.blockedRepeatedSearches, 12, 'wasted repeated searching is visible');
  t.equal(stats.model, 'deepseek-v4', 'the model is recorded so runs can be compared across models');
  t.end();
});

test('utility classification has a bounded timeout and preserves user cancellation', async t => {
  const originalFetch = global.fetch;
  const hangingFetch = (_url, options = {}) => new Promise((resolve, reject) => {
    if (!options.signal) return;
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  global.fetch = hangingFetch;

  const startedAt = Date.now();
  const timedOut = await agent.callUtilityModel(
    'Return JSON.',
    'deepseek-v4-flash',
    { deepseekApiKey: 'test-key' },
    true,
    { timeoutMs: 20 }
  );
  t.equal(timedOut, null, 'a stalled classifier safely returns no classification');
  t.ok(Date.now() - startedAt < 500, 'the timeout is bounded instead of hanging for minutes');

  const controller = new AbortController();
  const cancelled = agent.callUtilityModel(
    'Return JSON.',
    'deepseek-v4-flash',
    { deepseekApiKey: 'test-key' },
    true,
    { timeoutMs: 1000, signal: controller.signal }
  );
  controller.abort();
  try {
    await cancelled;
    t.fail('cancellation should reject the utility request');
  } catch (error) {
    t.ok(error, 'the active run receives the cancellation instead of swallowing it');
  }

  global.fetch = originalFetch;
  t.end();
});

test('instrumentation never breaks a run', (t) => {
  t.doesNotThrow(() => agent.recordRunEfficiency(), 'a missing summary does not throw');
  t.doesNotThrow(() => agent.recordRunEfficiency({ loopCount: 0, ledger: null }), 'a null ledger does not throw');
  const zero = agent.recordRunEfficiency({ loopCount: 0, elapsedMs: 0, ledger: {} });
  t.equal(zero.secondsPerTurn, 0, 'a zero-turn run does not divide by zero');
  t.end();
});

// ── Conversational quality and honest status ───────────────────────────────────
// From a real session: four consecutive replies opened with "Morning, Jason.", a question about
// Orion was answered with a GRITLIFE status report, and a plain "how are you doing?" displayed
// "Preparing implementation plan (Step 1)..." for the whole wait.

test('casual conversation never reaches for the cross-project fact store', (t) => {
  // The Orion prompt ranks stored facts by similarity to the message. For chat that returned
  // whichever project had the most entries, which is how "I've been working on you this
  // morning" got answered with GRITLIFE's version and test count.
  // 'project'/'task' rank the global stored-fact corpus, which is the path that returned facts
  // about the wrong project. They must not be reachable from chat.
  for (const contextNeed of ['project', 'task']) {
    const selected = policy.select({ phase: 'casual_conversation', hint: { contextNeed } });
    t.notEqual(selected.contextScope, 'project', `contextNeed=${contextNeed} cannot reach the project fact store from chat`);
    t.ok(['none', 'recent'].includes(selected.contextScope),
      `contextNeed=${contextNeed} stays within the live conversation (got ${selected.contextScope})`);
  }

  // 'historical' stays reachable: it routes to the conversation-evidence search over real past
  // conversations, which is the correct mechanism for "what did we talk about last week?".
  t.equal(policy.select({ phase: 'casual_conversation', hint: { contextNeed: 'historical' } }).contextScope,
    'historical', 'a genuine recall request can still search past conversations');

  t.equal(policy.select({ phase: 'casual_conversation' }).contextScope, 'recent',
    'a standalone greeting sees only this conversation, not stored project/session facts');
  t.equal(policy.select({ phase: 'casual_conversation', contextDependent: true }).contextScope, 'recent',
    'a follow-up reaction still sees the recent exchange');
  t.equal(policy.select({ phase: 'casual_conversation', hint: { contextNeed: 'recent' } }).contextScope, 'recent',
    'an explicit recent request is honored');

  // A real retrieval question is not casual conversation, so stored knowledge is still reachable.
  t.equal(policy.select({ phase: 'context_resolution', hint: { contextNeed: 'project' } }).contextScope, 'project',
    'genuine retrieval phases can still reach project knowledge');
  t.end();
});

test('an ongoing thread suppresses the greeting the prompt keeps inviting', (t) => {
  agent.__setActiveConversationModeForTest('orion');
  try {
    agent.setOrionConversationHasHistory({ messages: [{ role: 'user', text: 'hi' }] });
    const firstTurn = agent.getSystemInstruction(false, 'Name: Jason', 'deepseek-v4');
    t.notOk(/CONVERSATION IN PROGRESS/.test(firstTurn), 'the opening turn may greet normally');

    for (const priorRole of ['assistant', 'model', 'ai', 'orion']) {
      agent.setOrionConversationHasHistory({
        messages: [{ role: 'user', text: 'hi' }, { role: priorRole, text: 'Morning, Jason.' }]
      });
      const later = agent.getSystemInstruction(false, 'Name: Jason', 'deepseek-v4');
      t.ok(/CONVERSATION IN PROGRESS/.test(later), `a prior "${priorRole}" reply marks the thread as in progress`);
    }

    const ongoing = agent.getSystemInstruction(false, 'Name: Jason', 'deepseek-v4');
    t.ok(/Do not open with a greeting/i.test(ongoing), 'it explicitly forbids re-greeting');
    t.ok(/time of day/i.test(ongoing), 'it names the time-of-day block as the thing not to open with');
    t.ok(/Do not restate points you already made/i.test(ongoing),
      'it also addresses repeating an acknowledgement it already gave');
    // The reference material must still be present — it is useful, just not an opener.
    t.ok(/Current time:/.test(ongoing), 'the time context itself is still available to the model');
    t.ok(/Name: Jason/.test(ongoing), 'known context about the user is still available');
  } finally {
    agent.setOrionConversationHasHistory(null);
    agent.__setActiveConversationModeForTest('orion');
  }
  t.end();
});

test('the progress pill tells the truth before the request has been classified', (t) => {
  const { loadRenderer } = require('./helpers/renderer-harness');
  const { win } = loadRenderer({ t });
  const label = win.buildAgentStatusLabel;

  t.equal(label('analyzing', 1, false), 'Reading your request...',
    'the pre-classification window does not claim to be preparing an implementation plan');
  t.notOk(/implementation plan/i.test(label('analyzing', 1, false)),
    'a greeting never sees a plan-preparation banner while it is being read');

  t.equal(label('answer', 2, false), 'Working (Step 2)...', 'an answer run reports working');
  t.equal(label('direct', 3, false), 'Working (Step 3)...', 'a direct run reports working');
  t.equal(label('executing', 4, false), 'Working (Step 4)...', 'an executing run reports working');
  t.equal(label('planning', 1, true), 'Working (Step 1)...', 'an approved plan reports working');
  t.equal(label('planning', 1, false), 'Preparing implementation plan (Step 1)...',
    'genuine plan preparation still says so');
  t.end();
});
