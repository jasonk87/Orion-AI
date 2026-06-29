'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const skillLoader = require('./skill-loader');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:discover-skills', async (_event, { group } = {}) => {
    try {
      const manifests = group
        ? skillLoader.getSkillsByGroup(group)
        : skillLoader.getSkillManifests();
      return { success: true, skills: manifests };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:run-skill', async (_event, { name, inputs } = {}) => {
    try {
      if (!name) return { success: false, error: 'Missing skill name' };
      const outputs = await skillLoader.runSkill(name, inputs || {});
      return { success: true, outputs };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:create-skill', async (_event, payload = {}) => {
    const { name, group, description, inputs, outputs, implementation, test } = payload;

    if (!name || !group || !description || !implementation) {
      return { success: false, error: 'Missing required fields: name, group, description, implementation' };
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
      return { success: false, error: 'Skill name must be lowercase alphanumeric with dashes only' };
    }
    if (!/^[a-z0-9-]+$/.test(group)) {
      return { success: false, error: 'Group must be lowercase alphanumeric with dashes only' };
    }

    const skillDir = path.join(SKILLS_DIR, group, name);

    try {
      fs.mkdirSync(skillDir, { recursive: true });

      fs.writeFileSync(path.join(skillDir, 'index.js'), implementation, 'utf8');

      const testCode = test || buildDefaultTest(name);
      const testPath = path.join(skillDir, 'test.js');
      fs.writeFileSync(testPath, testCode, 'utf8');

      // Run the test via child_process — skill is rejected if it fails
      let testResult = { exitCode: 0, output: '' };
      try {
        const output = execSync(`node "${testPath}"`, { timeout: 15000, encoding: 'utf8' });
        testResult.output = output;
      } catch (e) {
        testResult.exitCode = e.status || 1;
        testResult.output = (e.stdout || '') + (e.stderr || '');
        // Clean up test file on failure but keep dir for debugging
        return {
          success: false,
          error: `Skill test failed (exit ${testResult.exitCode}): ${testResult.output.slice(0, 500)}`
        };
      }

      const manifest = {
        name,
        displayName: toDisplayName(name),
        description,
        group,
        version: '1.0.0',
        inputs: inputs || {},
        outputs: outputs || {},
        createdBy: 'orion',
        createdAt: new Date().toISOString(),
        tested: true
      };

      fs.writeFileSync(
        path.join(skillDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      skillLoader.registerSkill(manifest);

      return { success: true, manifest, testOutput: testResult.output };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:list-skill-groups', async () => {
    try {
      const manifests = skillLoader.getSkillManifests();
      const groups = {};
      manifests.forEach(m => {
        groups[m.group] = (groups[m.group] || 0) + 1;
      });
      return {
        success: true,
        groups: Object.entries(groups).map(([group, count]) => ({ group, count }))
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

function buildDefaultTest(name) {
  return `'use strict';
const assert = require('assert');
const skill = require('./index.js');

(async () => {
  const result = await skill({});
  assert(result !== undefined, 'Skill must return a result');
  console.log('${name} test passed:', JSON.stringify(result));
})().catch(e => { console.error(e); process.exit(1); });
`;
}

function toDisplayName(name) {
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

module.exports = { registerHandlers };
