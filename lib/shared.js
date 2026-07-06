'use strict';

// Shared mutable state accessible across all lib/ modules.
// Each module requires this file and reads/writes from the exported object.
const shared = {
  mainWindow: null,
  companionServer: null,
  companionToken: '',
  staticWorkspaceServers: new Map(),
  // Shell session tracking
  activeProcesses: {},
  commandSessions: {},
  commandAliases: {}
};

module.exports = shared;
