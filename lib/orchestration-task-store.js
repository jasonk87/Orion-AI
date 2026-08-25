'use strict';

const fs = require('fs');
const path = require('path');
const {
  SCHEMA_VERSION,
  TASK_STATES,
  normalizeTaskRecord,
  normalizeTransitionStatus,
  transitionTask,
  canRequesterControlTask,
  findTaskSupersessions
} = require('../task-orchestration');
const {
  atomicWriteJsonSync,
  enqueueFileWrite
} = require('./atomic-json-store');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function numericTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function taskSort(left, right) {
  return numericTime(left.createdAt, 0) - numericTime(right.createdAt, 0)
    || String(left.taskId).localeCompare(String(right.taskId));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const IMMUTABLE_TASK_FIELDS = Object.freeze([
  'schemaVersion',
  'taskId',
  'id',
  'createdAt',
  'timestamp',
  'updatedAt',
  'origin',
  'originConversationId',
  'originSessionId',
  'originMessageId',
  'target',
  'targetConversationId',
  'targetSessionId',
  'parentTaskId',
  'rootOriginConversationId',
  'originalUserMessage',
  'originalMessage',
  'source',
  'workspace',
  'workspacePath',
  'selectedProject',
  'supersedesTaskId',
  'supersededByTaskId'
]);

const LIFECYCLE_TASK_FIELDS = Object.freeze([
  'status',
  'state',
  'startedAt',
  'lastStartedAt',
  'pendingAt',
  'completedAt',
  'cancelledAt',
  'failedAt',
  'execution',
  'cancellation',
  'failure',
  'result'
]);

class OrchestrationTaskStore {
  constructor(options = {}) {
    if (!options.filePath) throw new Error('OrchestrationTaskStore requires filePath.');
    this.filePath = path.resolve(String(options.filePath));
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : null;
  }

  _emptyState() {
    const now = Number(this.now());
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      updatedAt: Number.isFinite(now) ? now : Date.now(),
      tasks: []
    };
  }

  _readJsonWithRecoverySync() {
    const candidates = [];
    if (fs.existsSync(this.filePath)) candidates.push(this.filePath);
    const directory = path.dirname(this.filePath);
    const basename = path.basename(this.filePath);
    try {
      for (const name of fs.readdirSync(directory)) {
        if (name.startsWith(`${basename}.tmp-`) || name.startsWith(`${basename}.bak-`)) {
          candidates.push(path.join(directory, name));
        }
      }
    } catch (_) {
      // A missing parent directory is the normal first-run state.
    }
    candidates.sort((left, right) => {
      if (left === this.filePath) return -1;
      if (right === this.filePath) return 1;
      let leftTime = 0;
      let rightTime = 0;
      try { leftTime = fs.statSync(left).mtimeMs; } catch (_) {}
      try { rightTime = fs.statSync(right).mtimeMs; } catch (_) {}
      return rightTime - leftTime || left.localeCompare(right);
    });

    let primaryError = null;
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(parsed) && (!parsed || typeof parsed !== 'object')) {
          throw new Error('Task store root must be an object or array.');
        }
        return { parsed, sourcePath: candidate };
      } catch (error) {
        if (candidate === this.filePath) primaryError = error;
      }
    }
    if (primaryError) {
      primaryError.message = `Could not read orchestration task store ${this.filePath}: ${primaryError.message}`;
      throw primaryError;
    }
    return null;
  }

  _readStateSync() {
    const recovered = this._readJsonWithRecoverySync();
    if (!recovered) return this._emptyState();
    const { parsed, sourcePath } = recovered;

    const rawTasks = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.tasks)
        ? parsed.tasks
        : (Array.isArray(parsed.queue) ? parsed.queue : (Array.isArray(parsed.records) ? parsed.records : [])));
    const byId = new Map();
    let sourceModifiedAt = 0;
    try { sourceModifiedAt = fs.statSync(sourcePath).mtimeMs; } catch (_) {}
    const envelopeUpdatedAt = Math.trunc(numericTime(
      !Array.isArray(parsed) && parsed.updatedAt,
      sourceModifiedAt || Number(this.now())
    ));
    rawTasks.forEach((rawTask, legacyIndex) => {
      const rawTimestamp = rawTask && typeof rawTask === 'object'
        ? (rawTask.createdAt || rawTask.timestamp || rawTask.updatedAt)
        : 0;
      const task = normalizeTaskRecord(rawTask, {
        now: numericTime(rawTimestamp, envelopeUpdatedAt),
        idFactory: this.idFactory,
        legacyIndex
      });
      const existing = byId.get(task.taskId);
      if (!existing || numericTime(task.updatedAt, 0) >= numericTime(existing.updatedAt, 0)) {
        byId.set(task.taskId, task);
      }
    });
    const fallback = this._emptyState();
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(0, Number(!Array.isArray(parsed) && parsed.revision) || 0),
      updatedAt: numericTime(!Array.isArray(parsed) && parsed.updatedAt, fallback.updatedAt),
      tasks: [...byId.values()].sort(taskSort)
    };
  }

  _writeStateSync(state) {
    state.schemaVersion = SCHEMA_VERSION;
    state.tasks = state.tasks.map(task => normalizeTaskRecord(task, { now: this.now, idFactory: this.idFactory })).sort(taskSort);
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

  async migrate() {
    return this._mutate(state => ({
      schemaVersion: state.schemaVersion,
      revision: state.revision + 1,
      taskCount: state.tasks.length
    }));
  }

  async list(filters = {}) {
    return this._read(state => {
      let tasks = state.tasks.slice();
      const statuses = filters.status == null
        ? []
        : (Array.isArray(filters.status) ? filters.status : [filters.status]);
      if (statuses.length) {
        const accepted = new Set(statuses.map(value => normalizeTransitionStatus(value)));
        tasks = tasks.filter(task => accepted.has(task.status));
      }
      if (filters.originConversationId) {
        tasks = tasks.filter(task => task.origin.conversationId === String(filters.originConversationId));
      }
      if (filters.targetConversationId) {
        tasks = tasks.filter(task => task.target.conversationId === String(filters.targetConversationId));
      }
      if (filters.source) tasks = tasks.filter(task => task.source === String(filters.source));
      tasks.sort(taskSort);
      if (filters.sort === 'desc') tasks.reverse();
      const limit = Math.max(0, Number(filters.limit) || 0);
      return limit ? tasks.slice(0, limit) : tasks;
    });
  }

  async get(taskId) {
    const id = String(taskId || '');
    return this._read(state => state.tasks.find(task => task.taskId === id) || null);
  }

  async create(record) {
    const task = normalizeTaskRecord(record, { now: this.now, idFactory: this.idFactory, forceUniqueId: true });
    if (task.status !== TASK_STATES.PENDING) {
      const error = new Error(`New tasks must begin pending, not ${task.status}.`);
      error.code = 'INVALID_INITIAL_TASK_STATE';
      throw error;
    }
    return this._mutate(state => {
      if (state.tasks.some(existing => existing.taskId === task.taskId)) {
        const error = new Error(`Task already exists: ${task.taskId}`);
        error.code = 'TASK_ALREADY_EXISTS';
        throw error;
      }
      state.tasks.push(task);
      return task;
    });
  }

  async update(taskId, patchOrUpdater) {
    const id = String(taskId || '');
    return this._mutate(state => {
      const index = state.tasks.findIndex(task => task.taskId === id);
      if (index === -1) {
        const error = new Error(`Task not found: ${id}`);
        error.code = 'TASK_NOT_FOUND';
        throw error;
      }
      const current = state.tasks[index];
      const patch = typeof patchOrUpdater === 'function'
        ? patchOrUpdater(clone(current))
        : patchOrUpdater;
      if (!patch || typeof patch !== 'object') return current;
      if (current.status === TASK_STATES.COMPLETED
        || current.status === TASK_STATES.CANCELLED
        || current.status === TASK_STATES.FAILED) {
        const error = new Error(`Cannot update a terminal ${current.status} task.`);
        error.code = 'TASK_ALREADY_TERMINAL';
        throw error;
      }
      const lifecycleField = LIFECYCLE_TASK_FIELDS.find(field => hasOwn(patch, field));
      if (lifecycleField) {
        const error = new Error(`Task lifecycle field "${lifecycleField}" must be changed through transition or cancel.`);
        error.code = 'TASK_LIFECYCLE_UPDATE_FORBIDDEN';
        throw error;
      }
      const immutableField = IMMUTABLE_TASK_FIELDS.find(field => hasOwn(patch, field)
        && !sameValue(patch[field], current[field]));
      if (immutableField) {
        const error = new Error(`Task provenance field "${immutableField}" cannot be changed.`);
        error.code = immutableField === 'taskId' || immutableField === 'id'
          ? 'IMMUTABLE_TASK_ID'
          : 'IMMUTABLE_TASK_PROVENANCE';
        throw error;
      }
      const nextTimestamp = Math.max(Number(current.updatedAt) || 0, numericTime(this.now(), Date.now()));
      let next = { ...current, ...patch, taskId: current.taskId, updatedAt: nextTimestamp };
      next = normalizeTaskRecord(next, { now: this.now, idFactory: this.idFactory });
      state.tasks[index] = next;
      return next;
    });
  }

  async transition(taskId, nextStatus, details = {}) {
    const id = String(taskId || '');
    return this._mutate(state => {
      const index = state.tasks.findIndex(task => task.taskId === id);
      if (index === -1) {
        const error = new Error(`Task not found: ${id}`);
        error.code = 'TASK_NOT_FOUND';
        throw error;
      }
      const next = transitionTask(state.tasks[index], nextStatus, {
        ...details,
        timestamp: details.timestamp || Number(this.now())
      });
      state.tasks[index] = next;
      return next;
    });
  }

  async cancel(taskId, requester, reason = '', options = {}) {
    const id = String(taskId || '');
    return this._mutate(state => {
      const index = state.tasks.findIndex(task => task.taskId === id);
      if (index === -1) {
        const error = new Error(`Task not found: ${id}`);
        error.code = 'TASK_NOT_FOUND';
        throw error;
      }
      const current = state.tasks[index];
      if (!options.system && !canRequesterControlTask(current, requester)) {
        const error = new Error('Requester does not control this task.');
        error.code = 'TASK_CONTROL_FORBIDDEN';
        throw error;
      }
      if (current.status === TASK_STATES.CANCELLED) {
        return { task: current, wasActive: false, alreadyCancelled: true };
      }
      if (current.status === TASK_STATES.COMPLETED || current.status === TASK_STATES.FAILED) {
        const error = new Error(`Cannot cancel a terminal ${current.status} task.`);
        error.code = 'TASK_ALREADY_TERMINAL';
        throw error;
      }
      const requesterConversationId = typeof requester === 'string'
        ? requester
        : (requester && (requester.conversationId || requester.requesterConversationId)) || '';
      const next = transitionTask(current, TASK_STATES.CANCELLED, {
        timestamp: Number(this.now()),
        reason: reason || 'Cancelled by request.',
        requestedByConversationId: requesterConversationId
      });
      state.tasks[index] = next;
      return { task: next, wasActive: current.status === TASK_STATES.ACTIVE };
    });
  }

  async remove(taskId, requester, options = {}) {
    const id = String(taskId || '');
    return this._mutate(state => {
      const index = state.tasks.findIndex(task => task.taskId === id);
      if (index === -1) return null;
      const task = state.tasks[index];
      if (!options.system && !canRequesterControlTask(task, requester)) {
        const error = new Error('Requester does not control this task.');
        error.code = 'TASK_CONTROL_FORBIDDEN';
        throw error;
      }
      if (task.status === TASK_STATES.ACTIVE) {
        const error = new Error('An active task must be cancelled before it is removed.');
        error.code = 'TASK_ACTIVE';
        throw error;
      }
      state.tasks.splice(index, 1);
      return task;
    });
  }

  async reconcileInterrupted(options = {}) {
    const reason = String(options.reason || 'Orion restarted before this active task recorded a terminal result.');
    return this._mutate(state => {
      const reconciled = [];
      const supersessions = new Map(
        findTaskSupersessions(state.tasks).map(item => [item.task.taskId, item])
      );
      state.tasks = state.tasks.map(task => {
        const supersession = supersessions.get(task.taskId);
        if (task.status === TASK_STATES.PENDING && supersession) {
          const supersedingTaskId = supersession.supersedingTask.taskId;
          const cancelled = transitionTask(task, TASK_STATES.CANCELLED, {
            timestamp: Number(this.now()),
            reason: `Superseded by continuation task ${supersedingTaskId}.`,
            requestedByConversationId: task.origin && task.origin.conversationId
          });
          cancelled.supersededByTaskId = supersedingTaskId;
          reconciled.push(cancelled);
          return cancelled;
        }
        if (task.status !== TASK_STATES.ACTIVE) return task;
        const failed = transitionTask(task, TASK_STATES.FAILED, {
          timestamp: Number(this.now()),
          code: 'interrupted',
          error: reason,
          expectedExecutionId: task.execution && task.execution.executionId
        });
        reconciled.push(failed);
        return failed;
      });
      return reconciled;
    });
  }
}

module.exports = {
  OrchestrationTaskStore,
  taskSort
};
