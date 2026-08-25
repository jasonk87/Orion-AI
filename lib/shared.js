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
  commandAliases: {},
  // Main-process ownership for a visible computer/browser-control session. The durable task
  // remains canonical; this state exists only to keep Orion minimized and the passive monitor
  // indicator alive for exactly the same run.
  operatorControlSession: null,
  operatorControlWindow: null
};

module.exports = shared;
