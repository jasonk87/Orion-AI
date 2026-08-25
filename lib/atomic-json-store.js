'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordSwallowedFault } = require('./fault-log');

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
        try {
          fs.renameSync(backupPath, filePath);
        } catch (rollbackError) {
          // Worst case: the replace failed AND the original could not be put back, so the
          // only copy of the user's data is sitting at a random .bak-<pid>-<ts> sibling.
          // movedExisting stays false so the finally block does NOT delete it — but without
          // recording the path, nobody could ever find it again.
          recordSwallowedFault('atomic-write:rollback-failed', rollbackError, { filePath, backupPath });
          replaceError.orionSurvivingBackupPath = backupPath;
        }
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
