'use strict';

// Real bug (from a real transcript Jason ran): the remember_fact tool description carried the
// literal example text "e.g. 'Jason hates keyword-matching hacks'" - Jason's actual real name
// paired with a plausible-sounding, entirely made-up preference, presented as an illustration of
// what a global fact might look like. Orion later stated this back to Jason as if it were a
// verified, previously-stored fact about him - it was never stored anywhere; it was prompt-
// injected example text the model mistook for retrieved memory. This is a strictly worse failure
// than an ordinary hallucination, because the exact wording lives in Orion's own system prompt on
// every single turn, giving the model a persistent, plausible-looking source to misattribute.
//
// The fix has two parts: (1) the example text itself no longer pairs the real name with a
// specific personal claim - it now describes the SHAPE of a fact/preference generically ("the
// user prefers concise status updates") instead of asserting one; (2) a standing rule was added to
// the MEMORY REASONING CONTRACT telling the model explicitly that instructional examples are not
// stored values, so this class of confusion is guarded structurally, not just by scrubbing today's
// specific wording.

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const fs = require('fs');
const path = require('path');
const agent = require('../agent.js');

const agentSource = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');

test('the real user name never appears paired with a specific claim inside a memory tool description', t => {
  agent.__setActiveConversationModeForTest('orion');
  const declarations = agent.buildAgentToolDeclarations();
  agent.__setActiveConversationModeForTest('orion');
  const byName = Object.fromEntries(declarations.map(d => [d.name, d]));

  for (const toolName of ['remember_fact', 'remember_preference', 'recall_memory', 'remember_decision']) {
    const description = String((byName[toolName] && byName[toolName].description) || '');
    t.notOk(/Jason/.test(description), `${toolName}'s top-level description does not name the real user`);
    const properties = (byName[toolName] && byName[toolName].parameters && byName[toolName].parameters.properties) || {};
    for (const [paramName, schema] of Object.entries(properties)) {
      const paramDescription = String((schema && schema.description) || '');
      t.notOk(/Jason/.test(paramDescription), `${toolName}.${paramName}'s description does not name the real user`);
    }
  }
  t.end();
});

test('the specific contaminated example is gone, not just relocated', t => {
  t.notOk(agentSource.includes('Jason hates keyword-matching hacks'),
    'the exact reported example text no longer appears anywhere in agent.js');
  t.notOk(/e\.g\.\s*['"]Jason\s/.test(agentSource),
    'no example anywhere introduces a specific claim by writing "e.g. \'Jason ..."');
  t.end();
});

test('memory-tool example text is phrased as an illustration, not an assertion', t => {
  agent.__setActiveConversationModeForTest('orion');
  const declarations = agent.buildAgentToolDeclarations();
  agent.__setActiveConversationModeForTest('orion');
  const byName = Object.fromEntries(declarations.map(d => [d.name, d]));
  const rememberFactDescription = byName.remember_fact.description;
  const rememberPreferenceDescription = byName.remember_preference.description;
  t.match(rememberFactDescription, /the user prefers/i, 'remember_fact\'s example uses generic third-person "the user" phrasing');
  t.match(rememberPreferenceDescription, /the user wants/i, 'remember_preference\'s example uses generic third-person "the user" phrasing');
  t.match(rememberFactDescription, /not real stored facts|not something already known/i,
    'remember_fact explicitly disclaims that its examples are illustrations, not real values');
  t.match(rememberPreferenceDescription, /not a real stored preference|not something already known/i,
    'remember_preference explicitly disclaims that its examples are illustrations, not real values');
  t.end();
});

test('a standing rule tells the model examples in these instructions are not retrieved memory', t => {
  t.ok(agentSource.includes('Tool descriptions and the examples below illustrate the SHAPE'),
    'the MEMORY REASONING CONTRACT carries an explicit anti-confusion rule');
  t.ok(agentSource.includes('a claim about the user is only real if it came from recall_memory\'s results or the user\'s own words'),
    'the rule states exactly what makes a claim about the user legitimate');
  t.end();
});
