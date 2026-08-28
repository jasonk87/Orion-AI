'use strict';

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const REGISTRY_PATH = path.join(SKILLS_DIR, 'registry.json');

function readRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeRegistry(registry) {
  const tmp = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
  fs.renameSync(tmp, REGISTRY_PATH);
}

function getSkillManifests() {
  return readRegistry();
}

function getSkillsByGroup(group) {
  return readRegistry().filter(m => m.group === group);
}

async function runSkill(name, inputs) {
  const registry = readRegistry();
  const manifest = registry.find(m => m.name === name);
  if (!manifest) throw new Error(`Skill not found: ${name}`);

  const skillDir = path.join(SKILLS_DIR, manifest.group, manifest.name);
  const indexPath = path.join(skillDir, 'index.js');

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Skill implementation missing: ${indexPath}`);
  }

  // Clear require cache so hot-registered skills load fresh
  Object.keys(require.cache).forEach(cacheKey => {
    if (cacheKey.startsWith(skillDir)) {
      delete require.cache[cacheKey];
    }
  });
  const fn = require(indexPath);
  if (typeof fn !== 'function') throw new Error(`Skill ${name} does not export a function`);

  return await fn(inputs || {});
}

function registerSkill(manifest) {
  if (!manifest || !manifest.name || !manifest.group) {
    throw new Error('registerSkill requires manifest.name and manifest.group');
  }
  const registry = readRegistry();
  const idx = registry.findIndex(m => m.name === manifest.name);
  if (idx !== -1) {
    registry[idx] = manifest;
  } else {
    registry.push(manifest);
  }
  writeRegistry(registry);
  return manifest;
}

// ── Skill proposals ───────────────────────────────────────────────────────────
// A proposal is INERT DATA: what capability is wanted, what it would take in and return, and why
// it is worth saving. It deliberately carries no implementation and no test, and nothing here ever
// writes executable code or runs anything. That is the whole point of the split — a role that
// ingests untrusted material (Researcher reads the open web) can say "this procedure is worth
// keeping" without that sentence becoming a path to host code execution. Turning a proposal into a
// real skill stays a create_skill call by a role that already holds code-execution authority.

const PROPOSALS_PATH = path.join(SKILLS_DIR, 'proposals.json');

// Distinguishes "no proposals yet" from "the proposals file is unreadable". Collapsing both to an
// empty list is the same defect global memory had: the next write merges into that empty list and
// persists it, turning "could not read" into "there were never any proposals". A first run has no
// file at all; anything else that fails to parse is a real failure and is reported as one.
function readSkillProposalsWithRecovery() {
  if (!fs.existsSync(PROPOSALS_PATH)) return { proposals: [], error: null };
  // A crashed write leaves an atomic sibling behind; prefer it over declaring the data gone.
  const candidates = [PROPOSALS_PATH, PROPOSALS_PATH + '.tmp'];
  let primaryError = null;
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, ''));
      if (!Array.isArray(parsed)) throw new Error('Skill proposals must be a JSON array.');
      return { proposals: parsed, error: null, recoveredFrom: candidate === PROPOSALS_PATH ? '' : candidate };
    } catch (error) {
      if (candidate === PROPOSALS_PATH) primaryError = error;
    }
  }
  return { proposals: null, error: primaryError || new Error('Skill proposals could not be read.') };
}

function readSkillProposals() {
  const read = readSkillProposalsWithRecovery();
  return Array.isArray(read.proposals) ? read.proposals : [];
}

function writeSkillProposals(proposals) {
  const tmp = PROPOSALS_PATH + '.tmp';
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(proposals, null, 2), 'utf8');
  fs.renameSync(tmp, PROPOSALS_PATH);
  return proposals;
}

function recordSkillProposal(proposal) {
  const name = String(proposal && proposal.name || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error('Skill proposal name must be lowercase alphanumeric with dashes only.');
  }
  const description = String(proposal && proposal.description || '').trim();
  if (!description) throw new Error('A skill proposal needs a description of the capability.');
  const rationale = String(proposal && proposal.rationale || '').trim();
  if (!rationale) {
    throw new Error('A skill proposal needs a rationale: what would a saved skill do that a fresh turn plus ordinary tools does not already do as reliably, cheaply, and consistently?');
  }

  const record = {
    name,
    description: description.slice(0, 1000),
    rationale: rationale.slice(0, 1000),
    group: String(proposal.group || 'utility').trim().toLowerCase(),
    inputs: proposal.inputs && typeof proposal.inputs === 'object' ? proposal.inputs : {},
    outputs: proposal.outputs && typeof proposal.outputs === 'object' ? proposal.outputs : {},
    proposedByRole: String(proposal.proposedByRole || '').trim().toLowerCase() || 'unknown',
    sourceTask: String(proposal.sourceTask || '').trim().slice(0, 500),
    proposedAt: new Date().toISOString(),
    status: 'proposed'
  };

  // Refuse rather than overwrite. The damaged file is left exactly where it is so it can be
  // repaired or recovered; writing here would replace real proposals with a list of one.
  const read = readSkillProposalsWithRecovery();
  if (!Array.isArray(read.proposals)) {
    throw new Error(
      `Refusing to record a skill proposal: ${PROPOSALS_PATH} exists but could not be read `
      + `(${read.error && read.error.message}). The existing file has been left untouched.`
    );
  }
  const proposals = read.proposals;
  const existing = proposals.findIndex(item => item && item.name === record.name);
  if (existing !== -1) {
    record.supersedesProposedAt = proposals[existing].proposedAt || null;
    proposals[existing] = record;
  } else {
    proposals.push(record);
  }
  writeSkillProposals(proposals);
  return record;
}

module.exports = {
  getSkillManifests,
  getSkillsByGroup,
  runSkill,
  registerSkill,
  readSkillProposals,
  // Exposes the missing-vs-corrupt distinction, so callers (and tests) can tell "no proposals yet"
  // from "the proposals file could not be read".
  readSkillProposalsWithRecovery,
  recordSkillProposal
};
