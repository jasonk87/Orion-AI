# Orion Skill Registry

Skills are reusable, testable capabilities that Orion's agent can discover and invoke at runtime. They can be authored by humans or self-authored by the agent via `create_skill`.

## Directory layout

```
skills/
  registry.json          ← master index (array of manifests)
  {group}/{skill-name}/
    manifest.json        ← metadata
    index.js             ← implementation
    test.js              ← self-contained test (node test.js exits 0 on success)
```

## Manifest schema

```json
{
  "name": "skill-name",           // kebab-case, unique across the registry
  "displayName": "Skill Name",    // human-readable label
  "description": "...",           // used by the agent to decide when to invoke
  "group": "utility|files|coding|home|calendar|research",
  "version": "1.0.0",
  "inputs": {
    "paramName": { "type": "string|number|boolean|object|array", "description": "...", "required": true }
  },
  "outputs": {
    "resultName": { "type": "string", "description": "..." }
  },
  "createdBy": "human|orion",
  "createdAt": "ISO 8601 timestamp",
  "tested": true
}
```

## Implementation contract

`index.js` must export a single async function:

```js
module.exports = async function(inputs) {
  // ... do work ...
  return { ...outputs };
};
```

## Test contract

`test.js` must exit with code `0` on success and non-zero on failure. Use Node's built-in `assert` module:

```js
const assert = require('assert');
const skill = require('./index.js');

(async () => {
  const result = await skill({ myParam: 'value' });
  assert.strictEqual(result.someOutput, 'expected');
  console.log('test passed');
})().catch(e => { console.error(e); process.exit(1); });
```

## Groups

| Group      | Purpose                                      |
|------------|----------------------------------------------|
| `utility`  | Text processing, data transformation, maths  |
| `files`    | File system inspection and manipulation      |
| `coding`   | Code analysis, linting, generation helpers   |
| `home`     | Smart home, IoT, local device control        |
| `calendar` | Scheduling, reminders, time calculations     |
| `research` | Web search aggregation, summarisation        |

## Agent tools

The agent has three skill-related tools available:

- **`discover_skills`** — list registered skills, optionally filtered by group
- **`run_skill`** — execute a skill by name with given inputs
- **`create_skill`** — write, test, and register a new skill on the fly
