const test = require('tape');
process.env.NODE_ENV = 'test';
global.window = global.window || {};
const agent = require('../agent.js');

function containsKey(value, forbiddenKey) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, forbiddenKey)) return true;
  return Object.values(value).some(item => containsKey(item, forbiddenKey));
}

test('Gemini schema sanitizer removes unsupported arbitrary-object keywords recursively', t => {
  const input = {
    type: 'OBJECT',
    properties: {
      path: { type: 'STRING' },
      updates: {
        type: 'OBJECT',
        description: 'arbitrary updates',
        additionalProperties: true,
        properties: {
          nested: {
            type: 'ARRAY',
            items: { type: 'OBJECT', additionalProperties: { type: 'STRING' } }
          }
        }
      },
      fixedShape: {
        type: 'OBJECT',
        additionalProperties: false,
        properties: {
          nestedMaps: {
            type: 'ARRAY',
            items: { type: 'OBJECT', additionalProperties: { type: 'STRING' } }
          }
        }
      }
    },
    required: ['path', 'updates'],
    additionalProperties: false
  };

  const sanitized = agent.sanitizeGeminiFunctionSchema(input);
  t.equal(containsKey(sanitized, 'additionalProperties'), false, 'unsupported additionalProperties is absent at every depth');
  t.equal(sanitized.properties.updates.type, 'STRING', 'free-form object is represented as a Gemini-supported string');
  t.match(sanitized.properties.updates.description, /JSON-encoded string/i, 'free-form object tells Gemini how to encode the value');
  t.equal(sanitized.properties.fixedShape.type, 'OBJECT', 'fixed-shape object remains an object');
  t.equal(sanitized.properties.fixedShape.properties.nestedMaps.items.type, 'STRING', 'nested arbitrary maps are projected recursively');
  t.deepEqual(sanitized.required, ['path', 'updates'], 'required fields are preserved');
  t.equal(input.properties.updates.type, 'OBJECT', 'the provider projection does not mutate the canonical schema');
  t.end();
});

test('Gemini declarations are provider-safe before request serialization', t => {
  const declarations = agent.buildGeminiToolDeclarations();
  const canonicalEditConfig = agent.buildAgentToolDeclarations().find(tool => tool.name === 'edit_config');
  const geminiEditConfig = declarations.find(tool => tool.name === 'edit_config');
  t.ok(declarations.length > 0, 'tool declarations are produced');
  t.equal(containsKey(declarations, 'additionalProperties'), false, 'no declaration contains unsupported additionalProperties');
  t.ok(declarations.every(tool => tool.name && tool.parameters && tool.parameters.type === 'OBJECT'), 'every declaration retains a valid function schema');
  t.equal(geminiEditConfig.parameters.properties.updates.type, 'STRING', 'Gemini receives the JSON-string map representation');
  t.equal(canonicalEditConfig.parameters.properties.updates.type, 'OBJECT', 'canonical schema remains an object for other providers');
  t.equal(canonicalEditConfig.parameters.properties.updates.additionalProperties, true, 'canonical schema retains arbitrary-map semantics');
  t.match(agent.callGeminiAPI.toString(), /buildGeminiToolDeclarations\(\)/, 'Gemini request path uses the sanitized declaration builder');
  t.end();
});

test('Gemini request serialization sends the provider-safe declaration payload', async t => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
    };
  };

  try {
    await agent.callGeminiAPI(
      [{ role: 'user', parts: [{ text: 'Inspect the request schema.' }] }],
      'gemini-2.5-flash',
      'test-key',
      () => {}
    );
    const declarations = requestBody.tools[0].functionDeclarations;
    const editConfig = declarations.find(tool => tool.name === 'edit_config');
    t.equal(containsKey(requestBody.tools, 'additionalProperties'), false, 'serialized Gemini tools contain no unsupported arbitrary-object keyword');
    // Phase 3 piece 5 inserted a new handoff_to_operator declaration earlier in the master tool
    // array (alongside handoff_to_coder), which shifted every later Dispatch-mode declaration
    // index by one — edit_config moved from 24 to 25. The regression this test guards (a live
    // HTTP 400 caused by an unsanitized schema at edit_config's position) is about the tool
    // reaching Gemini with a provider-safe schema, not about a specific literal index, so the
    // fix is updating the pinned index rather than the surrounding assertions.
    t.equal(declarations[25].name, 'edit_config', 'regression reaches the same declaration index as the live HTTP 400');
    t.equal(containsKey(editConfig.parameters, 'additionalProperties'), false, 'the formerly rejected edit_config schema is provider-safe');
    t.equal(editConfig.parameters.properties.updates.type, 'STRING', 'serialized request preserves map usability through JSON encoding');
    t.match(editConfig.parameters.properties.updates.description, /decoded before the tool runs/i, 'serialized request explains executor normalization');
  } finally {
    global.fetch = originalFetch;
  }
  t.end();
});

test('edit_config executor decodes Gemini JSON strings without changing object callers', async t => {
  const originalApi = global.window.api;
  const calls = [];
  global.window.api = {
    editConfig: async (...args) => {
      calls.push(args);
      return { success: true };
    }
  };

  try {
    await agent.executeTool(
      'edit_config',
      { path: 'package.json', updates: '{"scripts":{"test":"node test.js"},"private":true}' },
      'C:\\workspace',
      {},
      {}
    );
    t.deepEqual(
      calls[0],
      ['C:\\workspace', 'package.json', { scripts: { test: 'node test.js' }, private: true }],
      'Gemini JSON-string updates are decoded before IPC execution'
    );

    const objectUpdates = { version: '2.0.0' };
    await agent.executeTool(
      'edit_config',
      { path: 'package.json', updates: objectUpdates },
      'C:\\workspace',
      {},
      {}
    );
    t.equal(calls[1][2], objectUpdates, 'existing object callers retain canonical behavior');

    try {
      await agent.executeTool(
        'edit_config',
        { path: 'package.json', updates: '{"broken":' },
        'C:\\workspace',
        {},
        {}
      );
      t.fail('invalid JSON should not reach the config editor');
    } catch (error) {
      t.match(error.message, /valid JSON object string/i, 'invalid serialized maps fail with a precise error');
    }
    t.equal(calls.length, 2, 'invalid serialized maps never reach IPC');
  } finally {
    global.window.api = originalApi;
  }
  t.end();
});

test('Gemini schema rejection is diagnosed as a non-retryable provider projection bug', t => {
  const diagnosis = agent.diagnoseModelApiFailure(
    'HTTP 400: Invalid JSON payload received. Unknown name "additionalProperties" at tools[0].function_declarations[24].parameters.properties[1].value: Cannot find field.'
  );
  t.match(diagnosis, /unsupported tool-schema field/i, 'diagnosis identifies the schema incompatibility');
  t.match(diagnosis, /must not retry the unchanged payload/i, 'diagnosis prevents a blind retry loop');
  t.end();
});
