'use strict';

// Dispatch restating its previous answer. Observed live: asked "what's your favorite project?"
// then "why that one compared to self-evolving AI and roomy?", Orion re-emitted its first reply
// nearly word for word — responsive in shape, and a complete non-answer to what was asked.

const test = require('tape');
const fs = require('fs');
const path = require('path');
const contracts = require('../orchestration-contracts');
const supervisor = require('../supervisor-orchestration');
const policy = require('../reasoning-policy');

const FIRST_ANSWER = [
  'Honestly? Evolve.AI is my favorite of the bunch.',
  'It is the one that feels most like you - a self-modifying bootloader/brain with rollback safety.',
  'That is the kind of project that is genuinely ambitious and a little dangerous in the best way.',
  'It is not just another app; it is an experiment in whether an AI can safely rewrite itself.',
  'The rollback mechanism is the smart part - it is the difference between a cool demo and something trusted to iterate on itself.',
  'Second place would be This is Life. But Evolve.AI is the one I would brag about. What is yours?'
].join(' ');

const NEAR_VERBATIM_REPEAT = [
  'Honestly, Evolve.AI is my pick because it is the one that feels most like you - a self-modifying bootloader/brain with rollback safety.',
  'That is genuinely ambitious and a little dangerous in the best way.',
  'It is not just another app; it is an experiment in whether an AI can safely rewrite itself.',
  'The rollback mechanism is the smart part - it is the difference between a cool demo and something trusted to iterate on itself.',
  'Second place would be This is Life. But Evolve.AI is the one I would brag about. What is yours?'
].join(' ');

const GENUINE_COMPARISON = [
  'Against Self-Evolving AI, the difference is the rollback boundary: mutation there is open-ended, so a bad generation has nothing to fall back to.',
  'Roomy is a conventional product - well built, but it never risks anything architecturally, so there is less to admire structurally.',
  'This is Life comes closest because emergent simulation is genuinely hard, though its worst case is a boring world rather than a corrupted self-image.',
  'That is the axis I am ranking on: how much a project must get right to avoid destroying itself.'
].join(' ');

test('a near-verbatim repeat of the previous answer is recognized', t => {
  const overlap = contracts.restatementOverlap(NEAR_VERBATIM_REPEAT, FIRST_ANSWER);
  t.ok(overlap > 0.6, `the observed repeat scores high (${overlap.toFixed(2)})`);
  t.equal(contracts.isRestatementOfPrevious(NEAR_VERBATIM_REPEAT, FIRST_ANSWER), true,
    'and is flagged as a restatement');
  t.end();
});

test('a genuine comparison on the same topic is not flagged', t => {
  const overlap = contracts.restatementOverlap(GENUINE_COMPARISON, FIRST_ANSWER);
  t.ok(overlap < 0.3, `a real answer reuses vocabulary but not phrasing (${overlap.toFixed(2)})`);
  t.equal(contracts.isRestatementOfPrevious(GENUINE_COMPARISON, FIRST_ANSWER), false,
    'so it is left alone');
  t.end();
});

test('short replies are never treated as restatements', t => {
  // "Yes." twice in a row is legitimate; only substantial answers are checked.
  t.equal(contracts.isRestatementOfPrevious('Yes, it is still running.', 'Yes, it is still running.'), false,
    'a short confirmation can repeat without being corrected');
  t.equal(contracts.isRestatementOfPrevious('', FIRST_ANSWER), false, 'an empty draft is not a restatement');
  t.equal(contracts.isRestatementOfPrevious(FIRST_ANSWER, ''), false,
    'and there is nothing to restate on the first turn');
  t.end();
});

test('padding a restatement with a new sentence does not defeat the check', t => {
  const padded = `${NEAR_VERBATIM_REPEAT} Anyway, that is my overall take on the whole situation here.`;
  t.equal(contracts.isRestatementOfPrevious(padded, FIRST_ANSWER), true,
    'overlap is measured against the smaller shingle set, so filler cannot hide a repeat');
  t.end();
});

test('the correction prompt names the actual question and forbids restating', t => {
  const correction = contracts.buildRestatementCorrectionPrompt(
    'Why would you choose that one compared to self-evolving AI and even roomy'
  );
  t.ok(/repeats your previous message/i.test(correction), 'it says what went wrong');
  t.ok(/self-evolving AI and even roomy/i.test(correction), 'it quotes the question that must be answered');
  t.ok(/compare it against each alternative/i.test(correction), 'it asks for the comparison requested');
  t.ok(/Do not restate/i.test(correction), 'and explicitly forbids another restatement');
  t.end();
});

// ── Regeneration behavior ─────────────────────────────────────────────────────

function conversationWith(previousAnswer) {
  return {
    id: 'c1',
    messages: [
      { role: 'user', text: 'What is your favorite project that we have right now?' },
      { role: 'assistant', text: previousAnswer }
    ]
  };
}

test('a restated draft is regenerated once with the correction', async t => {
  const calls = [];
  const result = await supervisor.buildContractedConversationalReply(
    {
      conversation: conversationWith(FIRST_ANSWER),
      prompt: 'Why would you choose that one compared to self-evolving AI and even roomy',
      systemPrompt: 'You are Orion.'
    },
    {
      contracts,
      generateReply: async (systemPrompt, messages) => {
        calls.push(messages);
        return calls.length === 1 ? NEAR_VERBATIM_REPEAT : GENUINE_COMPARISON;
      }
    }
  );
  t.equal(calls.length, 2, 'the model is asked again after a restatement');
  t.equal(result.restated, true, 'the retry is reported');
  t.equal(result.text, GENUINE_COMPARISON, 'and the real answer replaces the repeat');

  const retryTurn = calls[1][calls[1].length - 1];
  t.ok(/repeats your previous message/i.test(String(retryTurn.content)),
    'the retry carries the correction as its final turn');
  t.end();
});

test('a good first draft is never regenerated', async t => {
  let calls = 0;
  const result = await supervisor.buildContractedConversationalReply(
    {
      conversation: conversationWith(FIRST_ANSWER),
      prompt: 'Why would you choose that one compared to roomy',
      systemPrompt: 'You are Orion.'
    },
    {
      contracts,
      generateReply: async () => { calls++; return GENUINE_COMPARISON; }
    }
  );
  t.equal(calls, 1, 'no extra model call is spent when the draft is fine');
  t.equal(result.restated, false, 'and nothing is reported as corrected');
  t.equal(result.text, GENUINE_COMPARISON, 'the draft is returned unchanged');
  t.end();
});

test('a retry that restates again does not loop or replace the draft', async t => {
  let calls = 0;
  const result = await supervisor.buildContractedConversationalReply(
    {
      conversation: conversationWith(FIRST_ANSWER),
      prompt: 'Why that one?',
      systemPrompt: 'You are Orion.'
    },
    {
      contracts,
      generateReply: async () => { calls++; return NEAR_VERBATIM_REPEAT; }
    }
  );
  t.equal(calls, 2, 'exactly one retry — never an unbounded loop');
  t.equal(result.text, NEAR_VERBATIM_REPEAT,
    'a still-restating retry is discarded rather than swapped in as a second copy');
  t.end();
});

test('the first turn of a conversation has nothing to compare against', async t => {
  let calls = 0;
  const result = await supervisor.buildContractedConversationalReply(
    {
      conversation: { id: 'c1', messages: [{ role: 'user', text: 'hello' }] },
      prompt: 'hello',
      systemPrompt: 'You are Orion.'
    },
    {
      contracts,
      generateReply: async () => { calls++; return FIRST_ANSWER; }
    }
  );
  t.equal(calls, 1, 'no retry is attempted without a previous assistant message');
  t.equal(result.text, FIRST_ANSWER, 'and the reply stands');
  t.end();
});

test('contextNeed none preserves the immediate exchange for a conversational follow-up', async t => {
  const prompt = 'What do you have in mind? What would be useful?';
  const conversation = {
    id: 'c1',
    messages: [
      { role: 'user', text: "I'm bored. What can we do?" },
      { role: 'assistant', text: FIRST_ANSWER },
      { role: 'user', text: prompt }
    ]
  };
  const messages = supervisor.buildConversationalGenerationMessages(conversation.messages, {
    contextNeed: 'none'
  });

  t.equal(messages.length, 2, 'only the immediate assistant/user pair is retained');
  t.equal(messages[0].role, 'assistant', 'the answer being followed up is present');
  t.equal(messages[0].content, FIRST_ANSWER, 'the prior answer is not cut down to an unusable fragment');
  t.equal(messages[1].content, prompt, 'the exact current turn remains last');

  let calls = 0;
  const result = await supervisor.buildContractedConversationalReply({
    conversation,
    prompt,
    systemPrompt: 'You are Orion.',
    messages
  }, {
    contracts,
    generateReply: async (_systemPrompt, receivedMessages) => {
      calls++;
      t.ok(receivedMessages.some(message => message.role === 'assistant' && message.content === FIRST_ANSWER),
        'the live reply call can reason from the answer the user referenced');
      return GENUINE_COMPARISON;
    }
  });

  t.equal(calls, 1, 'a context-aware answer does not need a repetition retry');
  t.equal(result.text, GENUINE_COMPARISON, 'new information is returned instead of the previous answer');
  t.end();
});

test('bounded conversational context excludes older unrelated turns', t => {
  const messages = supervisor.buildConversationalGenerationMessages([
    { role: 'user', text: 'Old project question' },
    { role: 'assistant', text: 'Old project answer' },
    { role: 'user', text: "I'm bored. What can we do?" },
    { role: 'assistant', text: FIRST_ANSWER },
    { role: 'user', text: 'What do you have in mind?' }
  ], { contextNeed: 'none' });

  t.deepEqual(messages.map(message => message.content), [FIRST_ANSWER, 'What do you have in mind?'],
    'no old project/session history leaks into a no-history conversational turn');
  t.end();
});

// ── Reasoning budget ──────────────────────────────────────────────────────────

test('substantive conversational turns are not answered at the casual tier', t => {
  const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  t.ok(rendererJs.includes('function isSubstantiveConversationalTurn('),
    'small talk is distinguished from a question that needs reasoning');
  t.ok(rendererJs.includes('isSubstantiveConversationalTurn(options.semanticIntent, prompt)'),
    'and the distinction drives the reasoning phase for the reply');

  // The live failure: 'casual_conversation' resolves to low effort, which disables DeepSeek
  // thinking outright — so a comparison question got no reasoning budget at all.
  const casual = policy.select({ phase: 'casual_conversation' });
  const substantive = policy.select({ phase: 'final_response' });
  t.deepEqual(policy.providerControls('deepseek-v4-flash', casual), { thinking: { type: 'disabled' } },
    'the casual tier really does disable thinking on DeepSeek');
  t.notDeepEqual(policy.providerControls('deepseek-v4-flash', substantive), { thinking: { type: 'disabled' } },
    'while the substantive tier leaves it enabled');
  t.end();
});

test('question shapes that ask for reasons are classified as substantive', t => {
  const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const start = rendererJs.indexOf('function isSubstantiveConversationalTurn(');
  const body = rendererJs.slice(start, rendererJs.indexOf('\n}', start));
  const classify = new Function('semanticIntent', 'prompt', body.slice(body.indexOf('{') + 1));

  [
    'Why would you choose that one compared to self-evolving AI and even roomy',
    'How come you picked Evolve.AI?',
    'What are the trade-offs between those two?',
    'Explain the difference between them',
    'Is that better than the other approach?'
  ].forEach(prompt => {
    t.equal(classify({}, prompt), true, `"${prompt}" needs reasoning`);
  });

  ['hey', 'thanks!', 'ok cool', 'good morning'].forEach(prompt => {
    t.equal(classify({}, prompt), false, `"${prompt}" stays cheap small talk`);
  });

  t.equal(classify({ reasoningPolicyHint: { complexity: 'high' } }, 'hm'), true,
    'the classifier complexity hint also lifts a turn');
  t.end();
});
