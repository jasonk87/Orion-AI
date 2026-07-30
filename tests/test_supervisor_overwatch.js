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

test('evaluateLoopStateWithSupervisorDecision parses bounded corrective JSON and includes context receipt', async (t) => {
  const originalFetch = global.fetch;
  let requestBody = '';
  global.fetch = async (url, options) => {
    requestBody = String(options && options.body || '');
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                status: 'stuck',
                pattern: 'fragmented_context_acquisition',
                evidence: ['duplicate reads'],
                recommendedAction: {
                  type: 'consolidate_context',
                  tool: 'inspect_code_context',
                  target: 'agent.js completion gate'
                },
                avoid: ['read_file agent.js'],
                confidence: 0.91
              })
            }]
          }
        }]
      })
    };
  };

  const oldEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  const decision = await agent.evaluateLoopStateWithSupervisorDecision(
    'gemini-1.5-flash',
    Array(3).fill({ toolName: 'read_file', label: 'Read `agent.js`', status: 'done' }),
    false,
    {},
    { duplicateLinesReturned: 1200, repeatedReads: [{ path: 'agent.js', readCalls: 3 }] }
  );

  process.env.NODE_ENV = oldEnv;
  global.fetch = originalFetch;

  t.equal(decision.status, 'stuck', 'structured status is preserved');
  t.equal(decision.recommendedAction.type, 'consolidate_context', 'structured corrective action is preserved');
  t.ok(requestBody.includes('duplicateLinesReturned'), 'context acquisition receipt is sent to the supervisor');
  t.ok(requestBody.includes('Judge patterns, not a single call'), 'prompt explicitly avoids one-call guessing');
  t.end();
});

test('context acquisition ledger tracks duplicate reads and invalidates after edits', (t) => {
  const ledger = agent.createContextAcquisitionLedger();
  agent.recordContextAcquisitionToolResult(ledger, 'read_file', { path: 'agent.js' }, { content: 'a\nb\nc' });
  const args = { path: 'agent.js' };
  agent.getRecentRedundantContextRead(ledger, 'read_file', args);
  agent.getRecentRedundantContextRead(ledger, 'read_file', args);

  let receipt = agent.buildContextAcquisitionReceipt(ledger);
  t.equal(receipt.readCalls, 1, 'only the physical read is counted as source acquisition');
  t.equal(receipt.duplicateLinesReturned, 0, 'cache reuse does not pretend duplicate source was returned from disk');
  t.equal(receipt.redundantReadAttempts[0].count, 2, 'the supervisor sees both exact retry attempts');
  t.equal(receipt.blockedRedundantReads, 1, 'the retry after cached replay is explicit loop evidence');

  agent.invalidateContextAcquisitionForFile(ledger, 'agent.js', 'patch_file');
  agent.recordContextAcquisitionToolResult(ledger, 'read_file', { path: 'agent.js' }, { content: 'a\nchanged\nc' });
  receipt = agent.buildContextAcquisitionReceipt(ledger);
  t.equal(receipt.invalidations, 1, 'file mutation invalidates the prior read state');
  t.equal(receipt.repeatedReads.length, 0, 'post-edit reread is not treated as duplicate');
  t.end();
});
