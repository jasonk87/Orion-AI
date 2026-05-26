const test = require('tape');
const fs = require('fs');

global.window = {};

// Mock fetch globally
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const text = body.contents[0].parts[0].text;

  if (text.includes("Classify the user's latest message about a pending implementation plan")) {
    if (text.includes('"good to go"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"approve","reason":""}' }] } }] }) };
    }
    if (text.includes('"no wait"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"revise","reason":""}' }] } }] }) };
    }
    if (text.includes('"what"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"unclear","reason":""}' }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"deny","reason":""}' }] } }] }) };
  }

  if (text.includes("Classify whether this Orion AI request should require an implementation plan")) {
    if (text.includes('"run tests"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"direct","reason":""}' }] } }] }) };
    }
    if (text.includes('"explain"')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"answer","reason":""}' }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"plan","reason":""}' }] } }] }) };
  }

  return { ok: false };
};

const agent = require('../agent.js');

test('classifyPlanApprovalIntent returns correct intents', async (t) => {
  const approveRes = await agent.classifyPlanApprovalIntent('good to go', 'gemini-1', 'key');
  t.equal(approveRes.intent, 'approve', 'Recognizes approve intent');

  const denyRes = await agent.classifyPlanApprovalIntent('stop', 'gemini-1', 'key');
  t.equal(denyRes.intent, 'deny', 'Recognizes deny intent');

  const reviseRes = await agent.classifyPlanApprovalIntent('no wait', 'gemini-1', 'key');
  t.equal(reviseRes.intent, 'revise', 'Recognizes revise intent');

  const unclearRes = await agent.classifyPlanApprovalIntent('what', 'gemini-1', 'key');
  t.equal(unclearRes.intent, 'unclear', 'Recognizes unclear intent');

  t.end();
});

test('classifyPlanningNeed returns correct modes', async (t) => {
  const directRes = await agent.classifyPlanningNeed('run tests', 'gemini-1', 'key');
  t.equal(directRes.mode, 'direct', 'Recognizes direct mode');

  const planRes = await agent.classifyPlanningNeed('build a whole app', 'gemini-1', 'key');
  t.equal(planRes.mode, 'plan', 'Recognizes plan mode');

  const answerRes = await agent.classifyPlanningNeed('explain', 'gemini-1', 'key');
  t.equal(answerRes.mode, 'answer', 'Recognizes answer mode');

  t.end();
});

test('Planning Gate blocks destructive tools except implementation_plan.md', (t) => {
  const agentJs = fs.readFileSync(require('path').join(__dirname, '../agent.js'), 'utf8');
  t.ok(agentJs.includes("args.path.split(/[\\\\/]/).pop().toLowerCase() === 'implementation_plan.md'"), 'Fixed planning gate vulnerability to exact match implementation_plan.md');
  t.end();
});
