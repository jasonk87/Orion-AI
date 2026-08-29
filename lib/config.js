'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SECRET_CONFIG_FIELDS = ['geminiApiKey', 'googleSearchApiKey', 'anthropicApiKey', 'deepseekApiKey', 'openaiApiKey', 'groqApiKey'];
const DEFAULT_CONFIG_VALUES = {
  enablePhoneCompanion: true,
  // 5000 is Flask's default dev port, so it routinely collides with the very projects Orion is
  // used to build/run (launch_workspace_app landing on the same port as the workspace's own app).
  phoneCompanionPort: 45678,
  phoneCompanionHttpsOrigin: '',
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
    try {
      fs.renameSync(tempPath, filePath);
    } catch (renameErr) {
      // Windows EPERM: target file locked — fall back to direct overwrite
      if (renameErr.code === 'EPERM' || renameErr.code === 'EACCES') {
        fs.writeFileSync(filePath, content, encoding);
        try { fs.unlinkSync(tempPath); } catch (_) {}
      } else {
        throw renameErr;
      }
    }
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
  // phoneCompanionPort has never been exposed in any settings UI, so a persisted value of
  // exactly 5000 can only be the old hardcoded default that some earlier writeAppConfig call
  // baked into config.json — never a deliberate user choice. Treat it as unset so the new
  // default (which no longer collides with Flask's own default dev port) takes over.
  if (hasValue(merged.phoneCompanionPort) && Number(merged.phoneCompanionPort) === 5000) {
    delete merged.phoneCompanionPort;
  }
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

// Mutex for writeAppConfig: prevents two concurrent callers from racing on the same .tmp file.
// Uses a promise chain so callers queue up rather than collide.
let _configWriteQueue = Promise.resolve();

function writeAppConfig(config) {
  // Capture the caller's state now. Several callers retain and mutate their config object after
  // scheduling a write; queueing that live object made the eventual disk contents timing-dependent.
  const snapshot = JSON.parse(JSON.stringify(config || {}));
  // Enqueue behind any in-flight write to prevent concurrent-write race on the temp file.
  _configWriteQueue = _configWriteQueue.then(() => _doWriteAppConfig(snapshot)).catch(() => _doWriteAppConfig(snapshot));
  return _configWriteQueue;
}

function updateAppConfig(mutator) {
  if (typeof mutator !== 'function') {
    return Promise.reject(new TypeError('Config updater must be a function'));
  }
  const applyUpdate = () => {
    const current = readAppConfig();
    const updated = mutator(current);
    const next = updated && typeof updated === 'object' ? updated : current;
    _doWriteAppConfig(next);
    return next;
  };
  // Read-modify-write must happen inside the same queue as ordinary writes. This lets callers
  // update one durable record without replacing arrays from a stale config snapshot.
  _configWriteQueue = _configWriteQueue.then(applyUpdate, applyUpdate);
  return _configWriteQueue;
}

function _doWriteAppConfig(config) {
  const configPath = getConfigPath();
  // Use atomicWriteFileSync which also handles Windows EPERM on renameSync
  try {
    const currentConfig = readJsonIfExists(configPath);
    const sourceConfigPath = findSourceConfigPath(configPath);
    const sourceConfig = sourceConfigPath ? readJsonIfExists(sourceConfigPath) : {};
    const protectedConfig = mergeConfigWithSource({ ...currentConfig, ...(config || {}) }, mergeConfigWithSource(currentConfig, sourceConfig));
    atomicWriteFileSync(configPath, JSON.stringify(protectedConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing config:', e);
    throw e;
  }
}

module.exports = {
  getConfigPath,
  atomicWriteFileSync,
  readAppConfig,
  writeAppConfig,
  updateAppConfig,
  mergeConfigWithSource
};
