'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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

function readAppConfig() {
  const configPath = getConfigPath();
  const legacyConfigPath = path.join(__dirname, '..', 'config.json');
  try {
    if (!fs.existsSync(configPath) && configPath !== legacyConfigPath && fs.existsSync(legacyConfigPath)) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.copyFileSync(legacyConfigPath, configPath);
    }
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tempPath, configPath);
  } catch (e) {
    console.error('Error writing config:', e);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw e;
  }
}

module.exports = { getConfigPath, atomicWriteFileSync, readAppConfig, writeAppConfig };
