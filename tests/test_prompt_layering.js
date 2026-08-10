'use strict';

// Phase 1 of the Operator architecture plan: SYSTEM_INSTRUCTION (Coder) and DISPATCHER_INSTRUCTION
// (Dispatch) used to be two fully independent hand-written prompts that had already drifted — both
// carried a "verify your claims before committing to them" rule, written twice with different
// wording. orion-operating-contract.js now holds the genuinely-shared fragments (verification
// discipline, and the db_query / "tools are schemas" tool descriptions both prompts described
// separately) as single canonical strings that each prompt interpolates.
//
// These tests exist to catch exactly the failure mode the refactor was meant to prevent: a shared
// fragment silently re-diverging (someone edits the copy inside one prompt instead of the shared
// constant), a fragment getting duplicated twice inside the same prompt, or content quietly lost
// during the extraction. They assert on the assembled runtime prompt text (what
// getSystemInstruction() actually returns), not on source layout, so they keep meaning whatever
// the internal structure looks like later.

const test = require('tape');

global.window = {};
global.fetch = async () => ({ ok: false });

const contract = require('../orion-operating-contract');
const agent = require('../agent');

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    index = haystack.indexOf(needle, index);
    if (index === -1) break;
    count++;
    index += needle.length;
  }
  return count;
}

function coderPrompt() {
  agent.__setActiveConversationModeForTest('coder');
  return agent.getSystemInstruction(false, '', '');
}

function dispatchPrompt() {
  agent.__setActiveConversationModeForTest('orion');
  agent.setOrionConversationHasHistory({ messages: [] });
  return agent.getSystemInstruction(false, '', '');
}

test('orion-operating-contract exports the shared fragments as non-empty strings', (t) => {
  t.equal(typeof contract.VERIFICATION_DISCIPLINE, 'string');
  t.ok(contract.VERIFICATION_DISCIPLINE.length > 0, 'verification discipline fragment is not empty');
  t.equal(typeof contract.TOOL_SCHEMA_NOTE, 'string');
  t.ok(contract.TOOL_SCHEMA_NOTE.length > 0, 'tool schema note fragment is not empty');
  t.equal(typeof contract.DB_QUERY_CORE, 'string');
  t.ok(contract.DB_QUERY_CORE.length > 0, 'db_query core fragment is not empty');
  t.end();
});

test('agent.js loads the same shared contract object, not a copy', (t) => {
  // window.OrionOperatingContract is how the renderer wires this up (see index.html's script
  // order); in Node/tests agent.js falls through to require('./orion-operating-contract')
  // directly. Either path must land on the exact same fragment text used in the assertions below.
  const agentJs = require('fs').readFileSync(require('path').join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(agentJs.includes("require('./orion-operating-contract')"),
    'agent.js sources the shared contract from the dedicated module rather than a local copy');
  t.end();
});

test('the verification-discipline rule is truly shared between Coder and Dispatch, not re-diverged', (t) => {
  const coder = coderPrompt();
  const dispatch = dispatchPrompt();

  t.ok(coder.includes(contract.VERIFICATION_DISCIPLINE), 'Coder prompt contains the exact shared fragment');
  t.ok(dispatch.includes(contract.VERIFICATION_DISCIPLINE), 'Dispatch prompt contains the exact shared fragment');

  // Guards the specific drift Jason found: the same rule hand-copied with different wording.
  // Any future edit that copies the block instead of editing the shared constant reintroduces a
  // second, differently-worded copy, which this equality check would catch.
  t.equal(countOccurrences(coder, contract.VERIFICATION_DISCIPLINE), 1,
    'the fragment appears exactly once in the Coder prompt (no accidental double-inclusion)');
  t.equal(countOccurrences(dispatch, contract.VERIFICATION_DISCIPLINE), 1,
    'the fragment appears exactly once in the Dispatch prompt (no accidental double-inclusion)');

  // Each prompt still keeps its own header in its own house style — the shared part is the body.
  t.ok(coder.includes('18A. DIAGNOSTIC RIGOR:'), 'Coder keeps its numbered-rule header style');
  t.ok(dispatch.includes('BEFORE YOU COMMIT TO A CLAIM OR DIAGNOSIS'), 'Dispatch keeps its own header style');

  // Coder-specific elaboration (get_symbol_index/get_file_symbols) must survive the extraction —
  // it was never part of the shared fragment, so it must still appear right after it in Coder only.
  t.ok(coder.includes('get_symbol_index/get_file_symbols'), 'Coder keeps its tool-specific tracing detail');
  t.notOk(dispatch.includes('get_symbol_index/get_file_symbols'),
    'that Coder-specific detail was not accidentally added to Dispatch');
  t.end();
});

test('the tool-schema note is shared between Coder and Dispatch', (t) => {
  const coder = coderPrompt();
  const dispatch = dispatchPrompt();
  t.ok(coder.includes(contract.TOOL_SCHEMA_NOTE), 'Coder TOOL USE section uses the shared opening line');
  t.ok(dispatch.includes(contract.TOOL_SCHEMA_NOTE), 'Dispatch TOOL USE section uses the shared opening line');
  t.equal(countOccurrences(coder, contract.TOOL_SCHEMA_NOTE), 1, 'appears exactly once in Coder');
  t.equal(countOccurrences(dispatch, contract.TOOL_SCHEMA_NOTE), 1, 'appears exactly once in Dispatch');
  t.end();
});

test('the db_query tool description core is shared between Coder and Dispatch', (t) => {
  const coder = coderPrompt();
  const dispatch = dispatchPrompt();
  t.ok(coder.includes(contract.DB_QUERY_CORE), 'Coder db_query section uses the shared core');
  t.ok(dispatch.includes(contract.DB_QUERY_CORE), 'Dispatch db_query section uses the shared core');
  t.equal(countOccurrences(coder, contract.DB_QUERY_CORE), 1, 'appears exactly once in Coder');
  t.equal(countOccurrences(dispatch, contract.DB_QUERY_CORE), 1, 'appears exactly once in Dispatch');

  // Each side keeps its own addendum that was NOT promoted to the shared fragment.
  t.ok(coder.includes('Output is returned as raw CLI JSON/CSV text'), 'Coder keeps its own output-format note');
  t.ok(dispatch.includes('rather than routing to Coder just to run a SELECT'),
    'Dispatch keeps its own routing note');
  t.notOk(coder.includes('routing to Coder just to run a SELECT'),
    "Dispatch's routing note was not accidentally added to Coder");
  t.notOk(dispatch.includes('Output is returned as raw CLI JSON/CSV text'),
    "Coder's output-format note was not accidentally added to Dispatch");
  t.end();
});

test('specialist-only content was not lost or cross-contaminated by the extraction', (t) => {
  const coder = coderPrompt();
  const dispatch = dispatchPrompt();

  // A representative sample of content that is genuinely specialist-specific and was deliberately
  // left untouched — if any of these vanish, something was lost in the refactor rather than merged.
  const coderOnly = [
    'TESTING AND REGRESSION DISCIPLINE',
    'PREVIEW_APP RULES',
    'FILE EDIT DISCIPLINE',
    'DESIGN QUALITY',
    'FOLLOW-UP TIMERS',
    'ADAPT INSTEAD OF QUITTING',
    'MEMORY REASONING CONTRACT',
    'MEMORY EXAMPLES',
    'SKILL REGISTRY GUIDANCE',
    'PERSISTENT TERMINAL'
  ];
  const dispatchOnly = [
    'WHO YOU\'RE TALKING TO',
    'Context ownership',
    'HOW YOU COMMUNICATE',
    'HOW YOU THINK',
    'Permission boundary rule',
    'ENVIRONMENT INSPECTION'
  ];

  for (const phrase of coderOnly) {
    t.ok(coder.includes(phrase), `Coder prompt still has "${phrase}"`);
    t.notOk(dispatch.includes(phrase), `Dispatch prompt did not gain "${phrase}"`);
  }
  for (const phrase of dispatchOnly) {
    t.ok(dispatch.includes(phrase), `Dispatch prompt still has "${phrase}"`);
    t.notOk(coder.includes(phrase), `Coder prompt did not gain "${phrase}"`);
  }
  t.end();
});

test('assembled prompts are not suspiciously short after extraction', (t) => {
  // A coarse content-loss tripwire: both prompts are long, structured documents. A refactor bug
  // that accidentally deletes a whole section would show up here even if the more specific
  // assertions above happened to miss it.
  const coder = coderPrompt();
  const dispatch = dispatchPrompt();
  t.ok(coder.length > 6000, `Coder prompt is still substantial (${coder.length} chars)`);
  t.ok(dispatch.length > 2000, `Dispatch prompt is still substantial (${dispatch.length} chars)`);
  t.end();
});

test('Dispatch is instructed to use schedule_followup and watch_condition, not just told it exists', (t) => {
  // Dispatch gained both tools when the allowlist fix landed (schedule_followup / watch_condition),
  // but DISPATCHER_INSTRUCTION never actually told it when to use them — a real gap noticed during
  // the Phase 1 prompt-layering review. This guards the fix: a dedicated SCHEDULING section that
  // names both tools and tells Dispatch when each applies.
  const dispatch = dispatchPrompt();
  t.ok(dispatch.includes('SCHEDULING (schedule_followup / watch_condition):'), 'Dispatch prompt has a dedicated scheduling section');
  t.ok(dispatch.includes('schedule_followup'), 'schedule_followup is named');
  t.ok(dispatch.includes('watch_condition'), 'watch_condition is named');
  t.ok(/every morning|check back|remind me/i.test(dispatch), 'gives Dispatch a concrete durable-request example, not just an abstract rule');
  t.ok(/tell me when/i.test(dispatch), 'gives Dispatch a concrete "notify me when" example for watch_condition');

  // This is Dispatch-specific behavior (Dispatch's own routing/ownership rules), not a shared
  // operating rule — it must not leak into Coder's prompt, which already has its own differently
  // worded FOLLOW-UP TIMERS rule for its own execution context.
  const coder = coderPrompt();
  t.notOk(coder.includes('SCHEDULING (schedule_followup / watch_condition):'),
    "Dispatch's scheduling section was not accidentally added to Coder");
  t.ok(coder.includes('FOLLOW-UP TIMERS'), 'Coder keeps its own, separate follow-up rule');
  t.end();
});
