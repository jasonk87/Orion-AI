(function attachOrionPromptSubmission(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrionPromptSubmission = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptSubmission() {
  'use strict';

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function createRequestId(prefix = 'prompt') {
    if (typeof globalThis !== 'undefined' && globalThis.crypto
        && typeof globalThis.crypto.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function fingerprint(input = {}) {
    const imageCount = Array.isArray(input.images) ? input.images.length : Number(input.imageCount) || 0;
    return stableHash([
      compact(input.conversationId),
      compact(input.source || 'user'),
      compact(input.prompt),
      imageCount
    ].join('|'));
  }

  class SubmissionRegistry {
    constructor(options = {}) {
      this.ttlMs = Math.max(1000, Number(options.ttlMs) || 30000);
      this.now = typeof options.now === 'function' ? options.now : () => Date.now();
      this.entries = new Map();
    }

    prune() {
      const cutoff = Number(this.now()) - this.ttlMs;
      for (const [key, entry] of this.entries.entries()) {
        if (entry.createdAt < cutoff && entry.settled) this.entries.delete(key);
      }
    }

    keyFor(input = {}) {
      const requestId = compact(input.requestId);
      return requestId ? `id:${requestId}` : `fingerprint:${fingerprint(input)}`;
    }

    run(input, operation) {
      this.prune();
      const key = this.keyFor(input);
      const existing = this.entries.get(key);
      if (existing) return existing.promise;

      const entry = {
        createdAt: Number(this.now()),
        settled: false,
        promise: null
      };
      entry.promise = Promise.resolve().then(operation).finally(() => {
        entry.settled = true;
      });
      this.entries.set(key, entry);
      return entry.promise;
    }

    clear() {
      this.entries.clear();
    }
  }

  return {
    SubmissionRegistry,
    createRequestId,
    fingerprint,
    stableHash
  };
});
