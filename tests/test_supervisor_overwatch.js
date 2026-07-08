const test = require('tape');
global.window = {};
const agent = require('../agent.js');

test('evaluateLoopStateWithSupervisor identifies STUCK state', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'STUCK' }] } }] }) };
  };

  const workWalkthrough = Array(15).fill({ toolName: 'run_command', toolArgs: { command: 'echo hi' } });
  
  const oldEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  
  const isStuck = await agent.evaluateLoopStateWithSupervisor('gemini-1.5-flash', workWalkthrough, false, {});
  
  process.env.NODE_ENV = oldEnv;
  global.fetch = originalFetch;

  t.equal(isStuck, true, 'returns true when supervisor says STUCK');
  t.end();
});

test('evaluateLoopStateWithSupervisor identifies CONTINUE state', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'CONTINUE' }] } }] }) };
  };

  const workWalkthrough = Array(15).fill({ toolName: 'run_command', toolArgs: { command: 'echo hi' } });
  
  const oldEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  
  const isStuck = await agent.evaluateLoopStateWithSupervisor('gemini-1.5-flash', workWalkthrough, false, {});
  
  process.env.NODE_ENV = oldEnv;
  global.fetch = originalFetch;

  t.equal(isStuck, false, 'returns false when supervisor says CONTINUE');
  t.end();
});


test('evaluateLoopStateWithSupervisor respects disableTools', async (t) => {
  const isStuck = await agent.evaluateLoopStateWithSupervisor('gemini-1.5-flash', [{}], true, {});
  t.equal(isStuck, false, 'returns false immediately if tools are disabled');
  t.end();
});
