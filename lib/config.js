'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SECRET_CONFIG_FIELDS = ['geminiApiKey', 'googleSearchApiKey'];
const DEFAULT_CONFIG_VALUES = {
  enablePhoneCompanion: true,
  // 5000 is Flask's default dev port, so it routinely collides with the very projects Orion is
  // used to build/run (launch_workspace_app landing on the same port as the workspace's own app).
  phoneCompanionPort: 45678,
  phoneCompanionDevices: []
};

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null && value !== '';
}

function getConfigPath() {
  const base = app && app.getPath ? app.getPath('userData') : __dirname;
  return path.join(base, 'config.json');
}

function atomicWriteFileSync(filePath, content, encoding = 'utf8') {
  const tempPath = filePath + '.tmp';
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, content, encoding);
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw e;
  }
}

function readJsonIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    }
  } catch (e) {
    console.error('Error reading config candidate:', e);
  }
  return {};
}

function findSourceConfigPath(configPath) {
  const candidates = [
    path.join(__dirname, '..', 'config.json'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'config.json'),
    path.resolve(__dirname, '..', '..', '..', '..', 'config.json'),
    path.join(process.cwd(), 'config.json')
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key) || resolved === path.resolve(configPath)) continue;
    seen.add(key);
    if (fs.existsSync(resolved)) return resolved;
  }
  return '';
}

function mergeConfigWithSource(config, sourceConfig = {}) {
  const merged = { ...(config || {}) };
  for (const [field, value] of Object.entries(DEFAULT_CONFIG_VALUES)) {
    if (!hasValue(merged[field])) {
      merged[field] = Array.isArray(value) ? [...value] : value;
    }
  }
  for (const field of SECRET_CONFIG_FIELDS) {
    if (!hasValue(merged[field]) && hasValue(sourceConfig[field])) {
      merged[field] = sourceConfig[field];
    }
  }
  return merged;
}

function readAppConfig() {
  const configPath = getConfigPath();
  const legacyConfigPath = findSourceConfigPath(configPath);
  try {
    if (!fs.existsSync(configPath) && configPath !== legacyConfigPath && fs.existsSync(legacyConfigPath)) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.copyFileSync(legacyConfigPath, configPath);
    }
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
      const sourceConfig = legacyConfigPath ? readJsonIfExists(legacyConfigPath) : {};
      return mergeConfigWithSource(config, sourceConfig);
    }
  } catch (e) {
    console.error('Error reading config:', e);
  }
  return {};
}

function writeAppConfig(config) {
  const configPath = getConfigPath();
  const tempPath = path.join(path.dirname(configPath), 'config.tmp.json');
  try {
    const currentConfig = readJsonIfExists(configPath);
    const sourceConfigPath = findSourceConfigPath(configPath);
    const sourceConfig = sourceConfigPath ? readJsonIfExists(sourceConfigPath) : {};
    const protectedConfig = mergeConfigWithSource({ ...currentConfig, ...(config || {}) }, mergeConfigWithSource(currentConfig, sourceConfig));
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(protectedConfig, null, 2), 'utf8');
    fs.renameSync(tempPath, configPath);
  } catch (e) {
    console.error('Error writing config:', e);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw e;
  }
}

module.exports = { getConfigPath, atomicWriteFileSync, readAppConfig, writeAppConfig, mergeConfigWithSource };
