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

module.exports = {
  getSkillManifests,
  getSkillsByGroup,
  runSkill,
  registerSkill
};
