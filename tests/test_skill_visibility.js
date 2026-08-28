'use strict';

// The skill registry was fully built and completely unreachable. main.js registered the IPC,
// preload exposed it, agent.js declared discover_skills/run_skill/create_skill, the skills existed
// on disk and executed correctly - and three of the four roles could not see any of it, because
// DISPATCH/OPERATOR/RESEARCHER_TOOL_ALLOWLIST each omitted the skill tools. Coder was the only role
// that could use skills, and it got them by ACCIDENT: Coder's tool list is an exclusion set, so it
// inherited all three by omission rather than because anyone decided it should.
//
// Skill visibility is now a capability on the specialist registry, the same authority that owns
// specialist routing. Every role can discover, run and propose. AUTHORING is the one capability
// that is not universal: create_skill writes model-authored JavaScript and executes it, and its
// test gate cannot be a security gate because passing the test requires running that code.
// Researcher — the role that ingests untrusted web and source material — therefore proposes
// instead of authoring, which keeps a prompt injection from reaching host code execution. Coder
// already holds that authority through run_command, so keeping create there is no escalation.

process.env.NODE_ENV = 'test';
global.window = {};
global.fetch = async () => ({ ok: false });

const test = require('tape');
const agent = require('../agent');
const registry = require('../specialist-registry');
const skillLoader = require('../lib/skill-loader');

const ROLES = ['orion', 'coder', 'operator', 'researcher'];

function toolsFor(mode) {
  agent.__setActiveConversationModeForTest(mode);
  const names = agent.buildAgentToolDeclarations().map(tool => tool.name);
  agent.__setActiveConversationModeForTest('orion');
  return names;
}

function promptFor(mode) {
  agent.__setActiveConversationModeForTest(mode);
  const prompt = agent.getSystemInstruction(false, '', 'gemini-2.5-flash') || '';
  agent.__setActiveConversationModeForTest('orion');
  return prompt;
}

// ── Visibility comes from the registry ────────────────────────────────────────

test('every role can discover and run skills, and each matches its declared capability', t => {
  ROLES.forEach(mode => {
    const names = toolsFor(mode);
    const capabilities = registry.skillCapabilitiesFor(mode);
    t.equal(names.includes('discover_skills'), capabilities.discover,
      mode + ' discover_skills visibility matches the registry');
    t.equal(names.includes('run_skill'), capabilities.run,
      mode + ' run_skill visibility matches the registry');
    t.equal(names.includes('create_skill'), capabilities.create,
      mode + ' create_skill visibility matches the registry');
  });
  t.end();
});

test('every role can discover, run and propose; only Researcher is barred from authoring', t => {
  // Authoring writes model-authored JavaScript to disk and executes it, and the test gate cannot be
  // a security gate because passing it REQUIRES running that code. Researcher is the role that
  // ingests untrusted web and source material, so it is the one place where a successful prompt
  // injection would otherwise reach host code execution. Coder already holds that authority through
  // run_command, so keeping create there is no escalation. Researcher keeps propose_skill, which
  // records intent as inert data and executes nothing.
  ROLES.forEach(mode => {
    const names = toolsFor(mode);
    t.ok(names.includes('discover_skills'), mode + ' can discover skills');
    t.ok(names.includes('run_skill'), mode + ' can run skills');
    t.ok(names.includes('propose_skill'), mode + ' can propose skills');
  });
  t.notOk(toolsFor('researcher').includes('create_skill'),
    'Researcher cannot author skills - the untrusted-input role does not get code execution');
  ['orion', 'coder', 'operator'].forEach(mode => {
    t.ok(toolsFor(mode).includes('create_skill'), mode + ' retains authoring');
  });
  const authors = registry.list().filter(definition => definition.skillCapabilities.create === true);
  t.deepEqual(authors.map(definition => definition.role).sort(), ['coder', 'operator'],
    'Researcher is the only registered specialist without authoring');
  t.equal(registry.skillCapabilitiesFor('researcher').propose, true,
    'and it is granted proposing in exchange');
  t.end();
});

test('propose_skill is inert: it carries no implementation and no test', t => {
  agent.__setActiveConversationModeForTest('researcher');
  const declaration = agent.buildAgentToolDeclarations().find(tool => tool.name === 'propose_skill');
  agent.__setActiveConversationModeForTest('orion');
  t.ok(declaration, 'propose_skill is declared');
  const properties = Object.keys((declaration.parameters && declaration.parameters.properties) || {});
  t.notOk(properties.includes('implementation'), 'a proposal cannot carry executable code');
  t.notOk(properties.includes('test'), 'nor a test that would have to be executed to check it');
  t.ok(properties.includes('rationale'), 'it must say why a saved skill beats redoing the work');
  t.deepEqual((declaration.parameters.required || []).slice().sort(), ['description', 'name', 'rationale'],
    'name, description and rationale are all required');
  t.end();
});

test('skill visibility is not a fourth hand-maintained allowlist', t => {
  const agentSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(agentSource.includes('skillCapabilitiesFor'),
    'agent.js asks the registry for skill capabilities');
  t.ok(agentSource.includes('ALL_SKILL_TOOL_NAMES.filter(name => !permittedSkillTools.has(name))'),
    "Coder's exclusion set removes skill tools it was not granted, so nothing is inherited by omission");
  // Every registered specialist must declare the capability, so a new role cannot be silently
  // absent the way Researcher was absent from the router's execution targets.
  registry.list().forEach(definition => {
    t.equal(typeof definition.skillCapabilities, 'object',
      definition.role + ' declares skillCapabilities');
    ['discover', 'run', 'propose', 'create'].forEach(capability => {
      t.equal(typeof definition.skillCapabilities[capability], 'boolean',
        definition.role + '.' + capability + ' is an explicit boolean, not an omission');
    });
  });
  t.end();
});

test('an unregistered role gets no skill access at all', t => {
  const capabilities = registry.skillCapabilitiesFor('not-a-real-role');
  t.deepEqual(capabilities, { discover: false, run: false, propose: false, create: false },
    'an unknown role cannot discover, run, propose, or author skills');
  t.end();
});

// ── Guidance exists for every role, and is pull-based rather than a ritual ─────

test('every role prompt explains skills, including the three that never mentioned them', t => {
  ROLES.forEach(mode => {
    const prompt = promptFor(mode);
    t.ok(/SKILLS — REUSABLE PROCEDURES|SKILL REGISTRY GUIDANCE/.test(prompt),
      mode + ' prompt has a skills section');
    t.ok(/discover_skills/.test(prompt) && /run_skill/.test(prompt),
      mode + ' prompt names the tools it can actually call');
  });
  t.end();
});

test('skill lookup is pull-based by task shape, not a check-before-every-task ritual', t => {
  ROLES.forEach(mode => {
    const prompt = promptFor(mode);
    t.ok(/not a ritual/i.test(prompt), mode + ' is told explicitly that lookup is not a ritual');
    t.ok(/[Dd]o not call discover_skills before every/.test(prompt),
      mode + ' is told not to call discover_skills before every task');
    t.notOk(/Before starting a complex or repetitive task, call discover_skills/.test(prompt),
      mode + ' no longer carries the old always-check-first wording');
  });
  t.end();
});

test('the authoring bar is stated as value over a fresh turn, not as a filing habit', t => {
  const coder = promptFor('coder');
  t.ok(/as reliably, cheaply, and consistently/i.test(coder),
    'Coder is given the actual bar for authoring a skill');
  t.ok(/procedural memory/i.test(coder),
    'and is told a skill is permanent procedural memory rather than a note');
  t.ok(/Wrapping a single tool call/i.test(coder),
    'a single-tool-call wrapper is explicitly disqualified');
  ROLES.forEach(mode => {
    const prompt = promptFor(mode);
    t.ok(/as reliably, cheaply, and consistently/i.test(prompt),
      mode + ' is given the same bar, whether it authors or proposes');
  });
  ['orion', 'coder', 'operator'].forEach(mode => {
    t.ok(/procedural memory/i.test(promptFor(mode)),
      mode + ' is told an authored skill is permanent procedural memory');
  });
  const researcher = promptFor('researcher');
  t.ok(/do not author skills/i.test(researcher),
    'Researcher is told plainly that it does not author, so it does not try');
  t.ok(/propose_skill/.test(researcher), 'and is pointed at propose_skill instead');
  t.ok(/untrusted/i.test(researcher), 'with the reason stated, so it reads as deliberate rather than missing');
  t.end();
});

test('the post-task authoring nudge is gated on real capability, not on a role name', t => {
  const agentSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(agentSource.includes("const canAuthorSkills = skillToolsFor(runMode).has('create_skill')"),
    'the nudge asks whether this role may author');
  t.ok(agentSource.includes('if (canAuthorSkills && !bestVisibleAnswer && !skillGateFired'),
    'and gates on that, so a role that loses create_skill is never nudged toward a tool it cannot see');
  // Today every role can author, so the gate is open for all of them - but it stays capability-driven
  // so revoking create for a role cannot leave a dangling nudge behind.
  ['orion', 'coder', 'operator'].forEach(mode => {
    t.equal(registry.skillCapabilitiesFor(mode).create, true, mode + ' may author, so the nudge applies');
  });
  t.equal(registry.skillCapabilitiesFor('researcher').create, false,
    'Researcher may not author, so the capability-gated nudge never fires for it');
  t.end();
});

test('an authored skill records who made it and what prompted it', t => {
  const ipcSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'ipc-skill.js'), 'utf8');
  t.ok(/createdByRole:/.test(ipcSource), 'the manifest records the authoring role');
  t.ok(/sourceTask:/.test(ipcSource), 'and the work that prompted it');
  t.ok(/testProvidedByAuthor:/.test(ipcSource),
    'and whether a real test was supplied rather than the generated default');
  const agentSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'agent.js'), 'utf8');
  t.ok(/authorRole: String\(\(conversation && conversation\.mode\)/.test(agentSource),
    'agent.js passes the calling role through so provenance is not self-reported by the model');
  t.end();
});

// ── The machinery under it actually works ─────────────────────────────────────

test('registered skills execute, so discover/run are not pointing at nothing', async t => {
  const manifests = skillLoader.getSkillManifests();
  t.ok(Array.isArray(manifests) && manifests.length > 0, 'the registry lists skills');
  manifests.forEach(manifest => {
    t.ok(manifest.name && manifest.group && manifest.description,
      manifest.name + ' carries the metadata discovery matches against');
  });
  const result = await skillLoader.runSkill('word-count', { text: 'hello there world. and again!' });
  t.equal(result.wordCount, 5, 'a registered skill runs and returns its declared output');
  t.equal(result.sentenceCount, 2, 'and the rest of its output contract holds');
  t.end();
});

// ── The authoring gate is a smoke check, and must at least be a real one ───────

test('a test that never loads the skill is rejected, so a passing test means something', async t => {
  const handlers = {};
  require('../lib/ipc-skill').registerHandlers({ handle: (name, fn) => { handlers[name] = fn; } });
  const fs = require('fs');
  const path = require('path');
  const skillDir = path.join(__dirname, '..', 'skills', 'utility', 'zz-gate-regression');
  // skills/registry.json is a TRACKED file and this test registers into it. Snapshot the raw bytes
  // and restore them verbatim rather than reconstructing the JSON: re-serializing would rewrite
  // formatting and trailing-newline state even when the entries match, leaving the repo dirty after
  // a green test run, and a crash mid-test could otherwise leave a probe skill committed.
  const registryPath = path.join(__dirname, '..', 'skills', 'registry.json');
  const registrySnapshot = fs.readFileSync(registryPath);
  t.teardown(() => {
    try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    try { fs.writeFileSync(registryPath, registrySnapshot); } catch (_) { /* best effort */ }
  });

  const implementation = 'module.exports = async function(inputs){ return { doubled: (inputs.n || 0) * 2 }; };';
  const base = { name: 'zz-gate-regression', group: 'utility', description: 'Gate regression probe.', implementation, authorRole: 'researcher' };

  const trivial = await handlers['orion:create-skill'](null, {
    ...base,
    test: 'const assert = require("assert"); assert.ok(true); console.log("passed");'
  });
  t.equal(trivial.success, false, 'a test that asserts nothing about the skill is refused');
  t.match(String(trivial.error || ''), /must exercise the skill/i, 'and says why');
  t.notOk(fs.existsSync(skillDir), 'the rejected skill leaves nothing behind on disk');

  const real = await handlers['orion:create-skill'](null, {
    ...base,
    test: 'const s = require("./index.js"); const a = require("assert"); s({ n: 4 }).then(r => { a.strictEqual(r.doubled, 8); });'
  });
  t.equal(real.success, true, 'a test that actually runs the skill is accepted');
  t.equal(real.manifest.version, '1.0.0', 'a first registration is 1.0.0');
  t.equal(real.manifest.createdByRole, 'researcher', 'provenance records the authoring role');

  // Re-authoring is a new version of the same skill, not a silent in-place overwrite.
  const second = await handlers['orion:create-skill'](null, {
    ...base,
    description: 'Gate regression probe, revised.',
    authorRole: 'coder',
    test: 'const s = require("./index.js"); const a = require("assert"); s({ n: 5 }).then(r => { a.strictEqual(r.doubled, 10); });'
  });
  t.equal(second.success, true, 're-authoring succeeds');
  t.equal(second.manifest.version, '1.0.1', 'and bumps the version instead of overwriting 1.0.0');
  t.equal(second.manifest.previousVersion, '1.0.0', 'recording what it replaced');
  t.equal(second.manifest.createdByRole, 'coder', 'and who replaced it');
  t.end();
});

// ── Proposal store durability ─────────────────────────────────────────────────
// Same failure class as global memory: reading a malformed file as "an empty list" means the next
// write persists that emptiness over real data. A first run legitimately has no file; a file that
// exists but will not parse is a failure, not an absence.

test('a malformed proposals file is never mistaken for an empty proposal list', t => {
  const fs = require('fs');
  const path = require('path');
  const loader = require('../lib/skill-loader');
  const proposalsPath = path.join(__dirname, '..', 'skills', 'proposals.json');
  const existed = fs.existsSync(proposalsPath);
  const snapshot = existed ? fs.readFileSync(proposalsPath) : null;
  t.teardown(() => {
    try {
      if (existed) fs.writeFileSync(proposalsPath, snapshot);
      else if (fs.existsSync(proposalsPath)) fs.unlinkSync(proposalsPath);
    } catch (_) { /* best effort */ }
  });

  // A first run has no file at all, and must still work.
  if (fs.existsSync(proposalsPath)) fs.unlinkSync(proposalsPath);
  const firstRun = loader.recordSkillProposal({
    name: 'zz-first-run-probe', description: 'Probe.', rationale: 'Probe rationale.', proposedByRole: 'researcher'
  });
  t.equal(firstRun.name, 'zz-first-run-probe', 'a missing file is a legitimate empty start');

  // A file that exists but cannot be parsed is a failure.
  fs.writeFileSync(proposalsPath, '{ this is not a proposals array ', 'utf8');
  const damaged = fs.readFileSync(proposalsPath, 'utf8');
  const read = loader.readSkillProposalsWithRecovery();
  t.equal(read.proposals, null, 'the recovery read reports failure rather than an empty list');
  t.ok(read.error, 'and carries the parse error');

  let refused = false;
  try {
    loader.recordSkillProposal({ name: 'zz-must-not-write', description: 'x', rationale: 'y' });
  } catch (error) {
    refused = /Refusing to record a skill proposal/.test(error.message);
  }
  t.ok(refused, 'recording refuses rather than overwriting proposals it could not read');
  t.equal(fs.readFileSync(proposalsPath, 'utf8'), damaged,
    'and the damaged file is left byte-identical so it can be repaired or recovered');
  t.end();
});
