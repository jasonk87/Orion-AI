'use strict';

// Real bug (from a real transcript Jason ran): Orion stated "the pattern you've settled on is
// Dispatch owns the mission and routes to specialists" as if Jason had personally decided and told
// it that, when it is actually just how Orion's own architecture is currently built - and said "I
// don't have a routing design doc" as a flat denial, when the honest claim was narrower ("I have no
// durable-memory reference to one" - that specific lookup was never attempted in that run, it was
// intentionally blocked). Both collapse different kinds of evidence (user-told memory, Orion's own
// configuration, inference, an unchecked absence) into one confident, undifferentiated voice.
//
// The fix is a shared prompt fragment (ATTRIBUTION_DISCIPLINE in orion-operating-contract.js),
// wired into all four role instructions the same way VERIFICATION_DISCIPLINE already is, so the
// rule is canonical rather than hand-copied per role. This is prompt-behavior guidance, not a
// deterministic code invariant like evidenceTarget/scope - there is no code path to intercept and
// correct a mis-attributed sentence after the fact the way normalizeClassification corrects a
// wrong inspectionTarget. What CAN be verified without a live model call: that the rule exists,
// says the right things, and actually reaches every role's rendered system instruction (not just
// sitting unused in the source). Whether a real model reliably follows it in a live response is a
// live-model behavioral question this sandbox cannot verify - outbound network access to the model
// APIs is blocked here (confirmed by a direct connectivity check), the same limitation noted for
// the evidenceTarget classifier probe earlier in this project's work. That gap is reported plainly
// rather than papered over with an assertion that doesn't actually exercise model behavior.

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const contract = require('../orion-operating-contract.js');
const agent = require('../agent.js');

test('ATTRIBUTION_DISCIPLINE exists and names all four evidence categories from the real bug', t => {
  const rule = contract.ATTRIBUTION_DISCIPLINE;
  t.equal(typeof rule, 'string', 'the fragment is exported as a string, the same shape as VERIFICATION_DISCIPLINE');
  t.match(rule, /You've told me/, 'durable user-told memory has its own required phrasing');
  t.match(rule, /Orion is currently designed to/, "Orion's own configuration has its own required phrasing, distinct from user-told memory");
  t.match(rule, /My impression is/, 'inference/synthesis has its own required, explicitly hedged phrasing');
  t.match(rule, /more than one of these at once/, 'mixed evidence is addressed as its own case, not left to fall through to one of the others');
  t.match(rule, /durable-memory reference/, 'the absence-claim guidance uses the exact narrower phrasing from the real bug, not a blanket denial');
  t.end();
});

test('the rule explicitly forbids the two real mistakes from the transcript', t => {
  const rule = contract.ATTRIBUTION_DISCIPLINE;
  t.match(rule, /Never phrase Orion's own architecture or behavior this way/i,
    "Orion's own design can never be phrased as something the user told it or decided - the exact 'pattern you've settled on' mistake");
  t.match(rule, /imply a broader search than you performed/i,
    'an absence claim can never imply a check that was not actually done - the exact "I don\'t have a routing design doc" mistake');
  t.end();
});

test('every role instruction actually renders the attribution rule, not just Dispatch', t => {
  for (const mode of ['orion', 'coder', 'operator', 'researcher']) {
    agent.__setActiveConversationModeForTest(mode);
    const prompt = agent.getSystemInstruction(false, '', 'gemini-2.5-flash') || '';
    agent.__setActiveConversationModeForTest('orion');
    t.ok(prompt.includes("Phrase a claim according to where it actually came from"),
      `${mode}'s rendered system instruction includes the attribution rule`);
    t.notOk(prompt.includes('${OrionOperatingContract'),
      `${mode}'s rendered system instruction has no unresolved template placeholder`);
  }
  t.end();
});

test('the rule is a single canonical fragment, not hand-copied per role', t => {
  const fs = require('fs');
  const path = require('path');
  const agentSource = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
  const contractSource = fs.readFileSync(path.join(__dirname, '..', 'orion-operating-contract.js'), 'utf8');
  const literalInContract = contractSource.split("Phrase a claim according to where it actually came from").length - 1;
  t.equal(literalInContract, 1, 'the rule text is written exactly once, in orion-operating-contract.js');
  const literalInAgent = agentSource.split("Phrase a claim according to where it actually came from").length - 1;
  t.equal(literalInAgent, 0, 'agent.js never hand-copies the rule text - it only references the shared fragment');
  const referenceCount = (agentSource.match(/OrionOperatingContract\.ATTRIBUTION_DISCIPLINE/g) || []).length;
  t.equal(referenceCount, 4, 'all four role instructions (Coder, Dispatch, Operator, Researcher) reference the shared fragment');
  t.end();
});
