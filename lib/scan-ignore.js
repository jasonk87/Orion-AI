'use strict';

// One skip list for every recursive workspace walk (grep, semantic search, symbol index,
// references, file listing, workspace indexing). These lists used to be maintained separately
// per tool and drifted: grep-search was missing venv/__pycache__/site-packages entirely, so a
// Dispatch-rooted grep across Desktop\Projects synchronously read tens of thousands of Python
// interpreter files in the Electron main process and froze the whole app ("not responding").
const SCAN_SKIP_DIRECTORIES = new Set([
  // VCS / tool state
  '.git', '.orion', '.claude', '.gemini', '.idea', '.vscode', '.codex-remote-attachments',
  // Build output
  'dist', 'build', 'coverage', '.next', '.nuxt',
  // Dependency trees
  'node_modules',
  // Python environments and caches
  '.venv', 'venv', 'env', 'site-packages', '__pycache__',
  '.ruff_cache', '.pytest_cache', '.mypy_cache', '.tox',
  // Generic caches
  '.cache'
]);

module.exports = { SCAN_SKIP_DIRECTORIES };
