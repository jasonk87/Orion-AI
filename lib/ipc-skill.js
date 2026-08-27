'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
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

  // Inert by construction: records intent only. It accepts no implementation and no test, writes
  // no files under a skill directory, and executes nothing — so a role without create authority
  // can still surface a procedure worth keeping.
  ipcMain.handle('orion:propose-skill', async (_event, payload = {}) => {
    try {
      const proposal = skillLoader.recordSkillProposal(payload);
      return { success: true, proposal };
    } catch (error) {
      return { success: false, error: error.message || 'Skill proposal failed.' };
    }
  });

  ipcMain.handle('orion:list-skill-proposals', async () => {
    try {
      return { success: true, proposals: skillLoader.readSkillProposals() };
    } catch (error) {
      return { success: false, error: error.message || 'Could not read skill proposals.' };
    }
  });

  ipcMain.handle('orion:create-skill', async (_event, payload = {}) => {
    const { name, group, description, inputs, outputs, implementation, test, authorRole, sourceTask } = payload;

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
      // The same model authors both the implementation and its test, so "the test exited 0" is a
      // smoke check rather than a correctness proof — and a test that never loads the skill (the
      // degenerate `assert(true)`) would pass it while proving nothing at all. Requiring the test
      // to reference the skill module cannot judge test QUALITY, but it does make a passing test
      // mean the skill was at least executed. Cheap, static, and no judgement call.
      if (!/require\s*\(\s*['"`]\.[\\/]index(\.js)?['"`]\s*\)/.test(testCode)) {
        try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
        return {
          success: false,
          error: 'The test must exercise the skill: it has to require("./index.js") and assert on what the skill actually returns. A test that never loads the skill proves nothing.'
        };
      }
      const testPath = path.join(skillDir, 'test.js');
      fs.writeFileSync(testPath, testCode, 'utf8');

      // Run the test via child_process — skill is rejected if it fails
      let testResult = { exitCode: 0, output: '' };
      try {
        const { stdout, stderr } = await execAsync(`node "${testPath}"`, { timeout: 15000, encoding: 'utf8' });
        testResult.output = stdout + (stderr || '');
      } catch (e) {
        testResult.exitCode = e.code || 1;
        testResult.output = (e.stdout || '') + (e.stderr || '');
        // Clean up test file on failure but keep dir for debugging
        try { fs.unlinkSync(testPath); } catch (_) {}
        try { fs.unlinkSync(path.join(skillDir, 'index.js')); } catch (_) {}
        return {
          success: false,
          error: `Skill test failed (exit ${testResult.exitCode}): ${testResult.output.slice(0, 500)}`
        };
      }

      // Provenance. Every role can author skills, so the registry has to be able to answer "where
      // did this come from" months later: which role wrote it and what work prompted it. Note that
      // `tested` records only that the supplied test exited 0 — and the same model authored that
      // test, so it is a smoke check, not a correctness proof. testProvidedByAuthor distinguishes a
      // real supplied test from the generated default one.
      // Re-authoring an existing skill used to overwrite it in place, still stamped 1.0.0, so a
      // procedure could be silently replaced with no way to tell one revision from another. A
      // re-register is a new version of the same skill, and the manifest says what it replaced.
      const previous = skillLoader.getSkillManifests().find(item => item && item.name === name) || null;
      const version = previous ? nextPatchVersion(previous.version) : '1.0.0';

      const manifest = {
        name,
        displayName: toDisplayName(name),
        description,
        group,
        version,
        ...(previous ? { previousVersion: previous.version || '1.0.0', supersededAt: new Date().toISOString() } : {}),
        inputs: inputs || {},
        outputs: outputs || {},
        createdBy: 'orion',
        createdByRole: String(authorRole || '').trim().toLowerCase() || 'unknown',
        sourceTask: String(sourceTask || '').trim().slice(0, 500),
        createdAt: new Date().toISOString(),
        tested: true,
        testProvidedByAuthor: !!test
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

// Semver patch bump, tolerant of a malformed or missing prior version rather than throwing during
// skill registration.
function nextPatchVersion(value) {
  const parts = String(value || '').trim().split('.').map(part => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return '1.0.1';
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
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
