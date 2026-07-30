'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const writeQueues = new Map();

function uniqueSiblingPath(filePath, label) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return `${filePath}.${label}-${suffix}`;
}

function atomicWriteTextSync(filePath, content, encoding = 'utf8') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = uniqueSiblingPath(filePath, 'tmp');
  const backupPath = uniqueSiblingPath(filePath, 'bak');
  let movedExisting = false;
  fs.writeFileSync(tempPath, content, encoding);
  try {
    try {
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (!fs.existsSync(filePath)) throw error;
      fs.renameSync(filePath, backupPath);
      movedExisting = true;
      try {
        fs.renameSync(tempPath, filePath);
      } catch (replaceError) {
        try { fs.renameSync(backupPath, filePath); } catch (_) {}
        movedExisting = false;
        throw replaceError;
      }
    }
    if (movedExisting) {
      try { fs.unlinkSync(backupPath); } catch (_) {}
    }
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    if (movedExisting) {
      try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (_) {}
    }
  }
  return content;
}

function atomicWriteJsonSync(filePath, data, { trailingNewline = false, space = 2 } = {}) {
  const serialized = JSON.stringify(data, null, space) + (trailingNewline ? '\n' : '');
  atomicWriteTextSync(filePath, serialized, 'utf8');
  return data;
}

function enqueueFileWrite(filePath, operation) {
  const key = path.resolve(filePath).toLowerCase();
  const previous = writeQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writeQueues.set(key, current);
  return current.finally(() => {
    if (writeQueues.get(key) === current) writeQueues.delete(key);
  });
}

module.exports = {
  atomicWriteTextSync,
  atomicWriteJsonSync,
  enqueueFileWrite
};
