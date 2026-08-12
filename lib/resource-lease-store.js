'use strict';

// Phase 3 (concurrency/resource leases): explicit ownership records for resources that are
// shared across conversations but have no cross-conversation exclusivity today - see the recon
// in tests/test_resource_lease_store.js's header comment for the exact gaps this closes:
//   - the single module-level browserWorker BrowserWindow (lib/ipc-shell.js) has zero isolation
//     between conversations
//   - computer_action's freshness gate (agent.js) is per-run-local, not cross-conversation
//   - OS processes started by start_command have no registry tying them to "is this workspace
//     already busy," so a second run into the same workspace has no way to know
//   - workspace paths have a resolver (workspace-resolution.js) but no ownership registry at all
// This module intentionally mirrors lib/orchestration-task-store.js's shape (file-backed, atomic
// writes, injectable `now`, a `_mutate`/`_read` pair guarded by the same enqueueFileWrite mutex)
// so it behaves identically under concurrent IPC calls and is testable the same way.

const fs = require('fs');
const path = require('path');
const { atomicWriteJsonSync, enqueueFileWrite } = require('./atomic-json-store');

const SCHEMA_VERSION = 1;

const RESOURCE_TYPES = Object.freeze({
  DESKTOP: 'desktop',
  BROWSER: 'browser',
  WORKSPACE: 'workspace',
  PROCESS: 'process'
});

// Desktop input and the browser worker are process-wide singletons today (one BrowserWindow, one
// physical mouse/keyboard) - there is exactly one thing to lease regardless of which resourceKey a
// caller supplies, so these two types ignore the caller's key and use a fixed one. Workspace and
// process leases are per-target (per workspace path) because there can legitimately be many
// workspaces in play.
const SINGLETON_RESOURCE_KEYS = Object.freeze({
  [RESOURCE_TYPES.DESKTOP]: 'desktop',
  [RESOURCE_TYPES.BROWSER]: 'browser-worker'
});

// No heartbeat for this long without a matching durable task backing the lease means the holder
// is presumed gone (renderer reload without clean release, a bug, a crash that reconcileInterrupted
// did not catch because the lease was never tied to a task). Five minutes is generous relative to
// the 2s monitor poll interval and 60s stall-escalation timeout already used elsewhere in this app
// (renderer.js's Coder/Operator task monitors), so it will not fire ahead of those.
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

function text(value) {
  return value == null ? '' : String(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function numericTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeResourceType(value) {
  const normalized = text(value).trim().toLowerCase();
  return Object.values(RESOURCE_TYPES).includes(normalized) ? normalized : '';
}

// Same normalization workspace-resolution.js uses for path comparison (case-insensitive,
// backslash-normalized, no trailing separator) so a lease on "C:\Projects\Foo\" and one acquired
// for "c:/projects/foo" are recognized as the same resource.
function normalizeWorkspacePathKey(value) {
  return text(value).trim().replace(/[\\/]+$/g, '').replace(/\//g, '\\').toLowerCase();
}

function normalizeResourceKey(resourceType, resourceKey) {
  if (SINGLETON_RESOURCE_KEYS[resourceType]) return SINGLETON_RESOURCE_KEYS[resourceType];
  if (resourceType === RESOURCE_TYPES.WORKSPACE || resourceType === RESOURCE_TYPES.PROCESS) {
    return normalizeWorkspacePathKey(resourceKey);
  }
  return text(resourceKey).trim();
}

function leaseIdentity(resourceType, resourceKey) {
  return `${resourceType}::${normalizeResourceKey(resourceType, resourceKey)}`;
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = text(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

class ResourceLeaseStore {
  constructor(options = {}) {
    if (!options.filePath) throw new Error('ResourceLeaseStore requires filePath.');
    this.filePath = path.resolve(String(options.filePath));
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.staleAfterMs = numericTime(options.staleAfterMs, DEFAULT_STALE_AFTER_MS);
  }

  _emptyState() {
    const now = Number(this.now());
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      updatedAt: Number.isFinite(now) ? now : Date.now(),
      leases: []
    };
  }

  _readStateSync() {
    if (!fs.existsSync(this.filePath)) return this._emptyState();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      // A corrupt lease file must never crash startup - resource leases are a safety net, not a
      // record the app cannot function without. Start clean; any genuinely still-held resource
      // (e.g. a still-running background process) will simply not be lease-protected until its
      // holder next heartbeats or a new acquire re-registers it.
      return this._emptyState();
    }
    const leases = Array.isArray(parsed && parsed.leases) ? parsed.leases : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(0, Number(parsed && parsed.revision) || 0),
      updatedAt: numericTime(parsed && parsed.updatedAt, Number(this.now())),
      leases: leases.filter(lease => lease && typeof lease === 'object' && lease.identity)
    };
  }

  _writeStateSync(state) {
    state.schemaVersion = SCHEMA_VERSION;
    atomicWriteJsonSync(this.filePath, state, { trailingNewline: true });
  }

  _locked(operation) {
    return enqueueFileWrite(this.filePath, operation);
  }

  async _read(operation) {
    return this._locked(() => {
      const state = this._readStateSync();
      return clone(operation(state));
    });
  }

  async _mutate(operation) {
    return this._locked(async () => {
      const state = this._readStateSync();
      const result = await operation(state);
      state.revision += 1;
      state.updatedAt = Math.max(numericTime(state.updatedAt, 0), numericTime(this.now(), Date.now()));
      this._writeStateSync(state);
      return clone(result);
    });
  }

  async list(filters = {}) {
    return this._read(state => {
      let leases = state.leases.slice();
      const resourceType = normalizeResourceType(filters.resourceType);
      if (resourceType) leases = leases.filter(lease => lease.resourceType === resourceType);
      if (filters.conversationId) {
        leases = leases.filter(lease => lease.conversationId === String(filters.conversationId));
      }
      if (filters.taskId) leases = leases.filter(lease => lease.taskId === String(filters.taskId));
      return leases;
    });
  }

  async acquire(input = {}) {
    const resourceType = normalizeResourceType(input.resourceType);
    if (!resourceType) {
      const error = new Error(`Unknown lease resource type: ${text(input.resourceType) || '(empty)'}`);
      error.code = 'UNKNOWN_LEASE_RESOURCE_TYPE';
      throw error;
    }
    const conversationId = text(input.conversationId).trim();
    if (!conversationId) {
      const error = new Error('A lease must be acquired on behalf of a conversation.');
      error.code = 'LEASE_CONVERSATION_ID_REQUIRED';
      throw error;
    }
    const resourceKey = normalizeResourceKey(resourceType, input.resourceKey);
    if ((resourceType === RESOURCE_TYPES.WORKSPACE || resourceType === RESOURCE_TYPES.PROCESS) && !resourceKey) {
      const error = new Error(`A ${resourceType} lease requires a resourceKey (workspace path).`);
      error.code = 'LEASE_RESOURCE_KEY_REQUIRED';
      throw error;
    }
    const identity = leaseIdentity(resourceType, resourceKey);
    const taskId = text(input.taskId).trim();
    const executionId = text(input.executionId).trim();
    const role = text(input.role).trim().toLowerCase();
    const processIds = resourceType === RESOURCE_TYPES.PROCESS ? uniqueStrings(input.processIds) : [];

    return this._mutate(state => {
      const now = Number(this.now());
      const index = state.leases.findIndex(lease => lease.identity === identity);
      const existing = index === -1 ? null : state.leases[index];

      if (!existing) {
        const lease = {
          identity, resourceType, resourceKey, conversationId, taskId, executionId, role,
          acquiredAt: now, heartbeatAt: now, processIds, needsLivenessCheck: false
        };
        state.leases.push(lease);
        return { success: true, acquired: true, reacquired: false, stolen: false, lease };
      }

      if (existing.conversationId === conversationId) {
        // Re-entrant hold: the same conversation acting again on a resource it already leases
        // (e.g. a second computer_action call in the same run) just refreshes the heartbeat and
        // merges any newly reported process IDs, rather than treating it as a conflict.
        const refreshed = {
          ...existing,
          taskId: taskId || existing.taskId,
          executionId: executionId || existing.executionId,
          role: role || existing.role,
          heartbeatAt: now,
          processIds: resourceType === RESOURCE_TYPES.PROCESS
            ? uniqueStrings([...(existing.processIds || []), ...processIds])
            : existing.processIds,
          needsLivenessCheck: false
        };
        state.leases[index] = refreshed;
        return { success: true, acquired: false, reacquired: true, stolen: false, lease: refreshed };
      }

      const heldFor = now - numericTime(existing.heartbeatAt, existing.acquiredAt);
      if (heldFor > this.staleAfterMs) {
        // Abandoned: no heartbeat in the stale window and it belongs to someone else. Steal it -
        // this is what makes the lease system self-healing when a holder disappears without
        // calling release (renderer reload, a bug, a crash reconcileInterrupted did not reach
        // because it never had a task to key off of).
        const stolen = {
          identity, resourceType, resourceKey, conversationId, taskId, executionId, role,
          acquiredAt: now, heartbeatAt: now, processIds, needsLivenessCheck: false
        };
        state.leases[index] = stolen;
        return { success: true, acquired: true, reacquired: false, stolen: true, previousHolder: existing, lease: stolen };
      }

      return { success: false, acquired: false, reacquired: false, stolen: false, conflict: existing };
    });
  }

  async release(input = {}) {
    const resourceType = normalizeResourceType(input.resourceType);
    const resourceKey = normalizeResourceKey(resourceType, input.resourceKey);
    const identity = leaseIdentity(resourceType, resourceKey);
    const conversationId = text(input.conversationId).trim();
    return this._mutate(state => {
      const index = state.leases.findIndex(lease => lease.identity === identity);
      if (index === -1) return { success: true, released: false, reason: 'not_held' };
      const existing = state.leases[index];
      if (conversationId && existing.conversationId !== conversationId) {
        return { success: false, released: false, reason: 'not_the_holder', lease: existing };
      }
      if (resourceType === RESOURCE_TYPES.PROCESS) {
        const requestedProcessIds = uniqueStrings(input.processIds);
        if (requestedProcessIds.length) {
          const removedSet = new Set(requestedProcessIds);
          const remainingProcessIds = uniqueStrings(existing.processIds)
            .filter(processId => !removedSet.has(processId));
          if (remainingProcessIds.length) {
            const updated = {
              ...existing,
              processIds: remainingProcessIds,
              heartbeatAt: Number(this.now()),
              needsLivenessCheck: false
            };
            state.leases[index] = updated;
            return {
              success: true,
              released: false,
              partial: true,
              removedProcessIds: requestedProcessIds.filter(processId => (existing.processIds || []).includes(processId)),
              lease: updated
            };
          }
        }
      }
      state.leases.splice(index, 1);
      return { success: true, released: true, lease: existing };
    });
  }

  async releaseAllForConversation(conversationId) {
    const id = text(conversationId).trim();
    if (!id) return { success: true, released: [] };
    return this._mutate(state => {
      const released = state.leases.filter(lease => lease.conversationId === id);
      state.leases = state.leases.filter(lease => lease.conversationId !== id);
      return { success: true, released };
    });
  }

  async heartbeat(input = {}) {
    const resourceType = normalizeResourceType(input.resourceType);
    const resourceKey = normalizeResourceKey(resourceType, input.resourceKey);
    const identity = leaseIdentity(resourceType, resourceKey);
    const conversationId = text(input.conversationId).trim();
    const processIds = resourceType === RESOURCE_TYPES.PROCESS ? uniqueStrings(input.processIds) : [];
    return this._mutate(state => {
      const index = state.leases.findIndex(lease => lease.identity === identity);
      if (index === -1) return { success: true, refreshed: false, reason: 'not_held' };
      const existing = state.leases[index];
      if (conversationId && existing.conversationId !== conversationId) {
        return { success: false, refreshed: false, reason: 'not_the_holder', lease: existing };
      }
      const refreshed = {
        ...existing,
        heartbeatAt: Number(this.now()),
        processIds: processIds.length ? uniqueStrings([...(existing.processIds || []), ...processIds]) : existing.processIds
      };
      state.leases[index] = refreshed;
      return { success: true, refreshed: true, lease: refreshed };
    });
  }

  // Phase 3 (restart/recovery): the counterpart to OrchestrationTaskStore#reconcileInterrupted.
  // Call this after the task store's own reconcileInterrupted, passing the taskIds it just marked
  // failed with code 'interrupted'. A lease's fate depends on what kind of resource it names:
  //   - desktop/browser/workspace leases are claims a renderer-process object holds in memory
  //     (the single BrowserWindow, the per-run desktop snapshot gate, an in-memory workspace bind).
  //     None of those can survive the app restart that just happened, so releasing them
  //     immediately is correct - there is nothing left alive to protect.
  //   - process leases name real OS child processes, which CAN outlive an Electron restart
  //     (a detached dev server, a long build). Blindly releasing would let a second conversation
  //     collide with a process that is, in fact, still running; blindly keeping the lease forever
  //     would starve that workspace if the process actually died with the crash. So these are
  //     flagged needsLivenessCheck instead of resolved here - the caller (renderer.js, which owns
  //     the IPC bridge to actually check `tasklist`/`get_command_status`) probes each processId and
  //     reports back through resolveProcessLiveness.
  async reconcileInterrupted(options = {}) {
    const interruptedTaskIds = new Set(uniqueStrings(options.interruptedTaskIds));
    return this._mutate(state => {
      const released = [];
      const flaggedForLivenessCheck = [];
      const now = Number(this.now());
      const staleAfterMs = numericTime(options.staleAfterMs, this.staleAfterMs);
      const survivors = [];
      for (const lease of state.leases) {
        const tiedToInterruptedTask = lease.taskId && interruptedTaskIds.has(lease.taskId);
        if (tiedToInterruptedTask && lease.resourceType === RESOURCE_TYPES.PROCESS) {
          const flagged = { ...lease, needsLivenessCheck: true };
          flaggedForLivenessCheck.push(flagged);
          survivors.push(flagged);
          continue;
        }
        if (tiedToInterruptedTask) {
          released.push(lease);
          continue;
        }
        // Ad-hoc leases with no durable task behind them (or whose task is not among the ones
        // just marked interrupted) still get swept if they have gone stale - covers a holder that
        // released cleanly from the app's perspective but crashed before its own release call, or
        // a lease acquired outside any orchestration task.
        if (!lease.taskId && now - numericTime(lease.heartbeatAt, lease.acquiredAt) > staleAfterMs) {
          released.push(lease);
          continue;
        }
        survivors.push(lease);
      }
      state.leases = survivors;
      return { released, flaggedForLivenessCheck };
    });
  }

  // Resolves a process lease that reconcileInterrupted flagged needsLivenessCheck, once the caller
  // has actually checked whether its processIds are still alive on the OS.
  async resolveProcessLiveness(input = {}) {
    const resourceKey = normalizeResourceKey(RESOURCE_TYPES.PROCESS, input.resourceKey);
    const identity = leaseIdentity(RESOURCE_TYPES.PROCESS, resourceKey);
    const stillAlive = input.stillAlive === true;
    return this._mutate(state => {
      const index = state.leases.findIndex(lease => lease.identity === identity);
      if (index === -1) return { success: true, resolved: false, reason: 'not_held' };
      if (!stillAlive) {
        const [removed] = state.leases.splice(index, 1);
        return { success: true, resolved: true, released: true, lease: removed };
      }
      const kept = { ...state.leases[index], needsLivenessCheck: false, heartbeatAt: Number(this.now()) };
      state.leases[index] = kept;
      return { success: true, resolved: true, released: false, lease: kept };
    });
  }
}

module.exports = {
  ResourceLeaseStore,
  RESOURCE_TYPES,
  DEFAULT_STALE_AFTER_MS,
  normalizeResourceKey,
  leaseIdentity
};
