'use strict';

// Ground truth from a real run: Researcher finished a spawn/family-proximity investigation for the
// "This is Life" project and wrote a complete report - verdict, the verified chain with file:line
// references, a ranked candidate-fix table, a design-intent note, confidence, and sources. The
// Researcher conversation showed all of it. What arrived in Dispatch stopped dead in the middle of
// row 2 of the fix table, at "`_find", with no marker of any kind.
//
// Cause: the report passed through TWO independent hard `.slice(0, 5000)` calls - one when the run
// recorded its durable result, one when the supervisor relayed it. Neither cut on a boundary and
// neither said it had cut, so a decapitated report was indistinguishable from a finished one.
//
// The report is the deliverable, not chatter. It stays bounded, because it lands in the supervisor
// transcript and then in every later context window, but it must cut on a structural boundary and
// must say that it cut.

process.env.NODE_ENV = 'test';

const test = require('tape');
const contracts = require('../orchestration-contracts');
const { loadRenderer } = require('./helpers/renderer-harness');

const DISPATCH_ID = 'dispatch-owner-report-relay';
const RESEARCHER_ID = 'researcher-worker-report-relay';
const TASK_ID = 'task-completed-report-relay';

// Reconstructs the shape of the real report: prose sections, fenced code, and the markdown table
// that actually got cut. Size is tunable so one builder covers both the incident case and the
// genuinely-oversized case.
function investigationReport(targetChars) {
  const header = [
    '# Spawn / Family Proximity Investigation - Findings',
    '',
    '## Verdict (short)',
    'The player spawns far from family because of a two-stage failure in `_find_starting_position`.',
    ''
  ].join('\n');
  const tableHead = [
    '## Ranked candidate fixes',
    '',
    '| # | Fix | Location | Why it works |',
    '| --- | --- | --- | --- |'
  ].join('\n');
  const row1 = '| 1 | Make the entrance check use the generating `get_tile_at` | `_is_usable_building_entrance` (8059-8071) | Eliminates the None-tile failure |';
  const row2 = '| 2 | Change the final fallback center from `self.player.x/y` to the family home | `_find_starting_position` (13963-13964) | Player spawns near the family village |';
  const filler = [];
  let body = `${header}\n## The full chain\n\n`;
  let index = 0;
  while ((body + filler.join('\n')).length < targetChars - (tableHead.length + row1.length + row2.length + 200)) {
    index += 1;
    filler.push(`${index}. Verified against source: engine.py:${1200 + index} shows the ordering that makes this step load-bearing.`);
  }
  return `${body}${filler.join('\n')}\n\n${tableHead}\n${row1}\n${row2}\n\n## Sources\nengine.py, world_generation.py\n`;
}

const MARKER = /\[Orion\] Report truncated at (\d+) of (\d+) characters\./;

// ── The contract itself ──────────────────────────────────────────────────────

test('a report that fits is passed through completely untouched', t => {
  const report = investigationReport(6000);
  const result = contracts.truncateSpecialistReport(report);
  t.equal(result.truncated, false, 'nothing was cut');
  t.equal(result.text, report, 'the text is byte-identical, not normalized or re-wrapped');
  t.notOk(MARKER.test(result.text), 'and no truncation marker is invented for an intact report');
  t.end();
});

test('the real incident report - about 7000 characters - now survives whole', t => {
  const report = investigationReport(7000);
  t.ok(report.length > 5000, 'precondition: this report exceeded the old 5000-character cap (' + report.length + ')');
  const result = contracts.truncateSpecialistReport(report);
  t.equal(result.truncated, false, 'the report that used to be decapitated now arrives complete');
  t.ok(/_find_starting_position/.test(result.text),
    'row 2 of the fix table - the exact row that got cut at "`_find" - is present in full');
  t.ok(/## Sources/.test(result.text), 'and the sections after the table survive too');
  t.end();
});

test('an oversized report is cut on a structural boundary, never mid-token', t => {
  const report = investigationReport(40000);
  const result = contracts.truncateSpecialistReport(report);
  t.equal(result.truncated, true, 'a genuinely oversized report is still bounded');
  const body = result.text.replace(MARKER, '').replace(/\s+$/, '');
  // The defining symptom was a cut in the middle of a token. The kept text must end at a real
  // boundary in the source document.
  t.ok(report.startsWith(body), 'the kept text is an exact prefix of the report, not a reflow');
  const nextChar = report.charAt(body.length);
  t.ok(/\s/.test(nextChar) || nextChar === '',
    'the character immediately after the cut is whitespace, so no word or table cell is split');
  t.end();
});

test('truncation is always announced, and says where the whole report still lives', t => {
  const result = contracts.truncateSpecialistReport(investigationReport(40000), {
    fullReportLocation: 'Researcher conversation'
  });
  const match = result.text.match(MARKER);
  t.ok(match, 'the cut is stated explicitly rather than left silent');
  t.equal(Number(match[1]), result.keptLength, 'the marker reports how much was kept');
  t.ok(Number(match[2]) > Number(match[1]), 'and how much there actually was');
  t.ok(/complete report is in the Researcher conversation/.test(result.text),
    'and points at the conversation that still holds the full text');
  t.end();
});

test('the relay pass cannot truncate an already-truncated report a second time', t => {
  const once = contracts.truncateSpecialistReport(investigationReport(40000), {
    fullReportLocation: 'Researcher conversation'
  });
  t.ok(once.text.length <= contracts.SPECIALIST_REPORT_MAX_CHARS,
    'the marker is reserved INSIDE the budget, so the output fits the cap (' + once.text.length + ')');
  const twice = contracts.truncateSpecialistReport(once.text, {
    fullReportLocation: 'Researcher conversation'
  });
  t.equal(twice.truncated, false, 'the second pass is a no-op');
  t.equal(twice.text, once.text, 'so the first marker is never eaten by a second cut');
  t.end();
});

test('a report made of one enormous line still keeps most of its budget', t => {
  // Guards the boundary search: with no newline to find, a naive "cut at the last boundary" would
  // fall back to index -1 and throw away everything.
  const result = contracts.truncateSpecialistReport('x'.repeat(60000));
  t.equal(result.truncated, true, 'it is still bounded');
  t.ok(result.keptLength > contracts.SPECIALIST_REPORT_MAX_CHARS * 0.5,
    'and it still keeps the majority of the budget (' + result.keptLength + ')');
  t.end();
});

// ── The real relay path ──────────────────────────────────────────────────────

function completedTask(summary) {
  return {
    taskId: TASK_ID,
    status: 'completed',
    title: 'This is Life - spawn/family proximity investigation',
    objective: 'Investigate how the game begins and why the player spawns far from family.',
    target: { conversationId: RESEARCHER_ID, mode: 'researcher' },
    result: { summary, changedFiles: [], verification: [], images: [] }
  };
}

function conversationsFor() {
  return [
    {
      id: DISPATCH_ID,
      title: 'Dispatch',
      mode: 'orion',
      messages: [],
      tasks: [],
      launchedCoderConvId: RESEARCHER_ID,
      launchedCoderTaskId: TASK_ID,
      launchedCoderTaskTitle: 'This is Life - spawn/family proximity investigation',
      launchedTaskRole: 'researcher',
      launchedCoderTaskStart: 1699999000000
    },
    { id: RESEARCHER_ID, title: 'Researcher', mode: 'researcher', messages: [], tasks: [] }
  ];
}

async function relayedCompletionText(t, summary) {
  const { win, read } = loadRenderer({
    t,
    set: { conversations: conversationsFor(), activeConversationId: DISPATCH_ID },
    api: { getOrchestrationTask: async () => ({ success: true, task: completedTask(summary) }) }
  });
  await win.onOrchestrationTaskFinalized(TASK_ID, RESEARCHER_ID, 'completed');
  const dispatch = (read('conversations') || []).find(conv => conv.id === DISPATCH_ID);
  const completion = ((dispatch && dispatch.messages) || []).find(m => m.source === 'supervisor-completion');
  return completion ? String(completion.text || '') : '';
}

test('the incident report reaches Dispatch intact through the real completion relay', async t => {
  const report = investigationReport(7000);
  const relayed = await relayedCompletionText(t, report);
  t.ok(relayed, 'a supervisor-completion message reached Dispatch');
  t.ok(/_find_starting_position/.test(relayed),
    'the fix-table row that used to be cut at "`_find" arrives in Dispatch complete');
  t.ok(/## Sources/.test(relayed), 'and so does everything after it');
  t.notOk(MARKER.test(relayed), 'with no truncation marker, because nothing was truncated');
  t.end();
});

test('an oversized report reaching Dispatch is marked rather than silently cut', async t => {
  const relayed = await relayedCompletionText(t, investigationReport(40000));
  t.ok(MARKER.test(relayed), 'Dispatch can tell that it is holding a partial report');
  t.ok(/complete report is in the Researcher conversation/.test(relayed),
    'and is told where the rest of it is, named from the registry role rather than hardcoded');
  t.end();
});
