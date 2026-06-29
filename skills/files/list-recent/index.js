'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function listRecent({ directory, days = 7 }) {
  if (!directory) throw new Error("Input 'directory' is required");

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return; // skip unreadable dirs
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs >= cutoff) {
            results.push({
              path: fullPath,
              modified: new Date(stat.mtimeMs).toISOString(),
              size: stat.size
            });
          }
        } catch (e) {
          // skip files we can't stat
        }
      }
    }
  }

  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }

  walk(resolved);
  results.sort((a, b) => b.modified.localeCompare(a.modified));

  return { files: results, count: results.length };
};
