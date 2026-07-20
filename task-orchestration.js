(function attachOrionTaskOrchestration(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrionTaskOrchestration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOrionTaskOrchestration() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const TASK_STATES = Object.freeze({
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    FAILED: 'failed'
  });
  const TERMINAL_STATES = new Set([
    TASK_STATES.COMPLETED,
    TASK_STATES.CANCELLED,
    TASK_STATES.FAILED
  ]);
  const ALLOWED_TRANSITIONS = Object.freeze({
    [TASK_STATES.PENDING]: new Set([TASK_STATES.ACTIVE, TASK_STATES.CANCELLED, TASK_STATES.FAILED]),
    // A run may yield for plan approval/clarification or schedule an internal continuation. In
    // those cases execution is no longer active, but the same durable task remains pending.
    [TASK_STATES.ACTIVE]: new Set([TASK_STATES.PENDING, TASK_STATES.COMPLETED, TASK_STATES.CANCELLED, TASK_STATES.FAILED]),
    [TASK_STATES.COMPLETED]: new Set(),
    [TASK_STATES.CANCELLED]: new Set(),
    [TASK_STATES.FAILED]: new Set()
  });
  const STATUS_ALIASES = Object.freeze({
    queued: TASK_STATES.PENDING,
    waiting: TASK_STATES.PENDING,
    pending: TASK_STATES.PENDING,
    running: TASK_STATES.ACTIVE,
    in_progress: TASK_STATES.ACTIVE,
    'in-progress': TASK_STATES.ACTIVE,
    active: TASK_STATES.ACTIVE,
    done: TASK_STATES.COMPLETED,
    succeeded: TASK_STATES.COMPLETED,
    success: TASK_STATES.COMPLETED,
    completed: TASK_STATES.COMPLETED,
    canceled: TASK_STATES.CANCELLED,
    cancelled: TASK_STATES.CANCELLED,
    stopped: TASK_STATES.CANCELLED,
    error: TASK_STATES.FAILED,
    interrupted: TASK_STATES.FAILED,
    blocked: TASK_STATES.FAILED,
    failed: TASK_STATES.FAILED
  });

  let generatedIdSequence = 0;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function compactWhitespace(value) {
    return text(value).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function compactInline(value) {
    return compactWhitespace(value).replace(/\s+/g, ' ').trim();
  }

  function uniqueStrings(values, limit = 30) {
    const output = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = compactWhitespace(value);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
      if (output.length >= limit) break;
    }
    return output;
  }

  function resolveNow(value) {
    const candidate = typeof value === 'function' ? value() : value;
    const numeric = Number(candidate);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : Date.now();
  }

  function generateTaskId(now, idFactory) {
    if (typeof idFactory === 'function') {
      const supplied = compactInline(idFactory());
      if (supplied) return supplied;
    }
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return `task_${globalThis.crypto.randomUUID()}`;
    }
    generatedIdSequence = (generatedIdSequence + 1) % 0xFFFFFF;
    return `task_${Number(now).toString(36)}_${generatedIdSequence.toString(36).padStart(4, '0')}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function stableTextHash(value) {
    let hash = 2166136261;
    const input = text(value);
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function legacyTaskId(record, now, legacyIndex) {
    const seed = [
      record.prompt || record.message || record.objective || record.title || '',
      record.conversationId || record.targetConversationId || '',
      record.originConversationId || record.ownerConversationId || '',
      record.source || '',
      record.createdAt || record.timestamp || now,
      legacyIndex == null ? '' : legacyIndex
    ].map(compactInline).join('|');
    return seed.replace(/\|/g, '')
      ? `task_legacy_${Number(now).toString(36)}_${stableTextHash(seed)}`
      : '';
  }

  function normalizeStatus(value) {
    const status = compactInline(value).toLowerCase().replace(/\s+/g, '_');
    return STATUS_ALIASES[status] || TASK_STATES.PENDING;
  }

  function normalizeTransitionStatus(value) {
    const raw = compactInline(value).toLowerCase().replace(/\s+/g, '_');
    if (!Object.prototype.hasOwnProperty.call(STATUS_ALIASES, raw)) {
      const error = new Error(`Unknown task state: ${compactInline(value) || '(empty)'}`);
      error.code = 'UNKNOWN_TASK_STATE';
      throw error;
    }
    return normalizeStatus(raw);
  }

  function isContextDependentRequest(value) {
    const request = compactInline(value);
    if (!request || request.length > 220) return false;
    const normalized = request.toLowerCase().replace(/[.!?]+$/g, '').trim();
    // A bare affirmation ("Yes", "yeah, do it") answers a pending assistant question, so the real
    // request lives entirely in the preceding context.
    if (/^(?:yes|yeah|yep|yup|sure|absolutely|definitely|correct|confirmed|affirmative|please\s+do|go\s+for\s+it|send\s+it|route\s+it)(?:[,!. ]+(?:please|now|do\s+it|go\s+ahead|route\s+it|send\s+it))*$/.test(normalized)) {
      return true;
    }
    const withoutLeadingAffirmation = normalized.replace(/^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|alright)[,!. ]+/, '');
    const directPatterns = [
      /^(?:okay[, ]*)?(?:let['’]?s|lets)\s+(?:do|build|implement|ship|make)\s+(?:it|that|this)$/,
      /^(?:okay[, ]*)?go\s+ahead(?:\s+(?:with\s+)?(?:it|that|this))?$/,
      /^(?:please\s+)?(?:fix|change|update|remove|add|build|implement|ship|do|make)\s+(?:it|that|this|those|them)$/,
      /^(?:please\s+)?use\s+(?:the\s+)?(?:first|second|third|fourth|fifth|last|option\s*\d+|\d+(?:st|nd|rd|th)?)(?:\s+(?:one|option))?$/,
      /^(?:please\s+)?make\s+it\s+(?:like|how|the\s+way)\s+(?:we|you)\s+(?:discussed|described|said|planned)$/,
      /^(?:please\s+)?continue(?:\s+(?:that|it|this|from\s+there|with\s+that))?$/,
      /^(?:please\s+)?(?:proceed|do\s+it|ship\s+it|make\s+that\s+change|carry\s+on)$/
    ];
    if (directPatterns.some(pattern => pattern.test(normalized) || pattern.test(withoutLeadingAffirmation))) return true;
    return /^(?:please\s+)?(?:fix|use|change|update|remove|add|build|implement|make|continue)\b/.test(normalized)
      && /\b(?:it|that|this|those|them|one|ones|earlier|above|discussed)\b/.test(normalized);
  }

  function messageText(message) {
    if (typeof message === 'string') return compactWhitespace(message);
    if (!message || typeof message !== 'object') return '';
    if (typeof message.text === 'string') return compactWhitespace(message.text);
    if (typeof message.content === 'string') return compactWhitespace(message.content);
    if (Array.isArray(message.parts)) {
      return compactWhitespace(message.parts.map(part => typeof part === 'string' ? part : (part && part.text) || '').join('\n'));
    }
    return '';
  }

  function normalizePrecedingMessages(input, originalMessage) {
    const supplied = input.precedingMessages || input.recentMessages || input.messages || [];
    const messages = (Array.isArray(supplied) ? supplied : [])
      .map((message, index) => ({
        role: compactInline(message && typeof message === 'object' ? message.role : '') || 'context',
        source: compactInline(message && typeof message === 'object' ? message.source : ''),
        value: messageText(message),
        index
      }))
      .filter(message => {
        if (!message.value) return false;
        if (/^(system|tool|function)$/i.test(message.role)) return false;
        if (/^(queue-status|queued-prompt|agent-start-blocked)$/i.test(message.source)) return false;
        return true;
      });

    const originalKey = compactInline(originalMessage).toLowerCase();
    if (messages.length && originalKey && compactInline(messages[messages.length - 1].value).toLowerCase() === originalKey) {
      messages.pop();
    }
    return messages.slice(-14);
  }

  function buildPrecedingSummary(input, messages) {
    const explicit = compactWhitespace(input.precedingConversationSummary || input.contextSummary || '');
    if (explicit) return explicit.slice(0, 8000);
    const lines = [];
    let characters = 0;
    for (const message of messages.slice().reverse()) {
      const role = /assistant|model/i.test(message.role) ? 'Assistant' : (/user/i.test(message.role) ? 'User' : 'Context');
      const line = `${role}: ${message.value}`;
      if (characters + line.length > 8000) break;
      lines.unshift(line);
      characters += line.length + 1;
    }
    return lines.join('\n').trim();
  }

  function normalizeOptions(input, messages) {
    const explicit = Array.isArray(input.options) ? input.options : [];
    const options = explicit.map((option, index) => {
      if (typeof option === 'string') return { index, label: compactWhitespace(option) };
      const label = compactWhitespace(option && (option.description || option.objective || option.title || option.label));
      return { index, label };
    }).filter(option => option.label);
    if (options.length) return options;

    const ordinalMap = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
    const discovered = new Map();
    const lines = messages.flatMap(message => message.value.split(/\n/));
    for (const line of lines) {
      const match = line.match(/^\s*(?:option\s*)?(\d+|first|second|third|fourth|fifth)\s*[).:\-]\s*(.+?)\s*$/i);
      if (!match) continue;
      const parsedIndex = /^\d+$/.test(match[1]) ? Number(match[1]) - 1 : ordinalMap[match[1].toLowerCase()];
      if (parsedIndex < 0 || !Number.isFinite(parsedIndex)) continue;
      discovered.set(parsedIndex, compactWhitespace(match[2]));
    }
    return [...discovered.entries()].sort((a, b) => a[0] - b[0]).map(([index, label]) => ({ index, label }));
  }

  function requestedOptionIndex(request) {
    const normalized = compactInline(request).toLowerCase();
    const words = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1 };
    for (const [word, index] of Object.entries(words)) {
      if (new RegExp(`\\b${word}\\b`).test(normalized)) return index;
    }
    const numeric = normalized.match(/\b(?:option\s*)?(\d+)(?:st|nd|rd|th)?\b/);
    return numeric ? Number(numeric[1]) - 1 : null;
  }

  function hasEnoughContext(summary, messages, explicitRequirements) {
    if (Array.isArray(explicitRequirements) && explicitRequirements.some(value => compactInline(value))) return true;
    const corpus = compactInline(summary);
    if (corpus.length < 45) return false;
    const meaningfulTokens = new Set((corpus.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [])
      .filter(token => !/^(the|and|that|this|with|from|have|will|would|could|should|about|what|when|where|then|just|into|like|user|assistant|context)$/.test(token)));
    const hasActionableDetail = /\b(?:build|implement|design|fix|replace|evolve|merge|derive|create|change|add|remove|enroll|subscribe|system|feature|workflow|option|approach|plan|require|allow|organize|restart|relaunch|reboot|kill|stop|start|launch|run|execute|install|uninstall|delete|deploy)\b/i.test(corpus);
    return messages.length > 0 && meaningfulTokens.size >= 6 && hasActionableDetail;
  }

  function splitCandidateStatements(values) {
    const output = [];
    for (const value of values) {
      const normalized = compactWhitespace(value);
      if (!normalized) continue;
      const lines = normalized.split(/\n+/).flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/));
      lines.forEach(line => {
        const statement = compactInline(line.replace(/^[-*]\s*/, ''));
        if (statement.length >= 18) output.push(statement);
      });
    }
    return output;
  }

  function extractRequirements(input, messages, selectedOption) {
    const explicit = uniqueStrings(input.requirements || input.knownRequirements || []);
    if (explicit.length) return explicit;
    const statements = splitCandidateStatements(messages.map(message => message.value));
    const requirementSignals = /\b(?:must|should|need(?:s|ed)?|require(?:s|d)?|include|allow|support|organize|browse|enroll|subscribe|carry|cost|benefit|replace|merge|derive|implement|design|build|category|location|recurring)\b/i;
    const inferred = statements.filter(statement => requirementSignals.test(statement));
    if (selectedOption) inferred.unshift(`Use the selected option: ${selectedOption}`);
    return uniqueStrings(inferred, 20);
  }

  function extractUnresolvedDecisions(input, messages) {
    const explicit = uniqueStrings(input.unresolvedDecisions || []);
    if (explicit.length) return explicit;
    const statements = splitCandidateStatements(messages.map(message => message.value));
    return uniqueStrings(statements.filter(statement =>
      /\?|\b(?:decide|evaluate|determine|choose)\s+(?:whether|how|which)|\bwhether\b.+\bor\b/i.test(statement)
    ), 12);
  }

  function deriveContextObjective(input, messages, summary, selectedOption) {
    const explicit = compactWhitespace(input.objective || input.resolvedObjective || '');
    if (explicit) return explicit;
    if (selectedOption) return `Implement the selected option from the preceding discussion: ${selectedOption}`;

    const scored = messages.map(message => {
      const value = compactWhitespace(message.value);
      let score = Math.min(value.length, 1200) / 100;
      if (/\b(?:build|implement|design|fix|replace|evolve|merge|derive|create|change|system|feature|workflow|subscription|enrollment|commitment|restart|relaunch|reboot|kill|stop|launch|execute|install|uninstall|delete|deploy)\b/i.test(value)) score += 8;
      if (/\b(?:must|should|need|require|include|allow|support|evaluate)\b/i.test(value)) score += 4;
      if (/user/i.test(message.role)) score += 1;
      return { value, score, index: message.index };
    }).filter(item => item.value);
    scored.sort((a, b) => b.score - a.score || b.index - a.index);
    const selected = scored.slice(0, 4).sort((a, b) => a.index - b.index).map(item => item.value);
    const detail = uniqueStrings(selected, 4).join('\n');
    const resolvedDetail = detail || compactWhitespace(summary);
    return resolvedDetail
      ? `Implement the agreed direction from the preceding conversation:\n${resolvedDetail}`
      : '';
  }

  function titleFromObjective(objective, projectName) {
    let candidate = compactInline(objective)
      .replace(/^implement the (?:agreed direction|selected option) from the preceding (?:conversation|discussion):?\s*/i, '')
      .replace(/^(?:i think\s+)?(?:we\s+should\s+|please\s+)?/i, '')
      .replace(/^(?:design and implement|design|implement|build|create|fix|change|replace)\s+/i, '');
    if (!candidate) candidate = 'New task';
    const sentenceEnd = candidate.search(/[.!?](?:\s|$)/);
    if (sentenceEnd > 20) candidate = candidate.slice(0, sentenceEnd);
    if (candidate.length > 92) candidate = `${candidate.slice(0, 89).trimEnd()}...`;
    candidate = candidate.charAt(0).toUpperCase() + candidate.slice(1);
    if (projectName && !candidate.toLowerCase().includes(projectName.toLowerCase())) {
      candidate = `${projectName} — ${candidate}`;
    }
    return candidate;
  }

  function baseName(pathValue) {
    return compactInline(pathValue).replace(/[\\/]+$/g, '').split(/[\\/]/).pop() || '';
  }

  function normalizeWorkspace(input) {
    const supplied = input && typeof input.workspace === 'object' ? input.workspace : {};
    const path = compactInline(supplied.path || input.workspacePath || input.path || '');
    const projectValue = supplied.project && typeof supplied.project === 'object' ? supplied.project : {};
    const projectPath = compactInline(projectValue.path || supplied.projectPath || input.projectPath || '');
    const projectName = compactInline(projectValue.name || supplied.projectName || input.projectName || baseName(projectPath));
    let role = compactInline(supplied.role || supplied.kind || input.workspaceRole || input.workspaceKind || '').toLowerCase();
    const aliases = {
      project: 'active_project',
      active: 'active_project',
      active_project_workspace: 'active_project',
      search_root: 'project_search_root',
      projects_root: 'project_search_root',
      generic_projects_root: 'project_search_root',
      standalone: 'standalone_coder',
      coder: 'standalone_coder',
      unknown: 'unresolved'
    };
    role = aliases[role] || role;
    if (!['active_project', 'project_search_root', 'standalone_coder', 'unresolved'].includes(role)) {
      if (projectPath && path) role = 'active_project';
      else if (/standalone-workspaces/i.test(path)) role = 'standalone_coder';
      else role = 'unresolved';
    }
    return {
      role,
      path,
      project: {
        name: projectName,
        path: projectPath
      },
      source: compactInline(supplied.source || input.workspaceSource || ''),
      resolved: role !== 'unresolved' && !!path
    };
  }

  function normalizeIdentity(value, fallbacks) {
    const supplied = value && typeof value === 'object' ? value : {};
    return {
      conversationId: compactInline(supplied.conversationId || fallbacks.conversationId || ''),
      sessionId: compactInline(supplied.sessionId || fallbacks.sessionId || ''),
      messageId: compactInline(supplied.messageId || fallbacks.messageId || '')
    };
  }

  function clarificationForRequest(request, reason) {
    const normalized = compactInline(request);
    if (/\b(?:first|second|third|fourth|fifth|last|option\s*\d+)\b/i.test(normalized)) {
      return `Which option do you mean by “${normalized}”? I do not have the referenced choices in the available conversation context.`;
    }
    return `What specific work should I carry out? I do not have enough preceding context to resolve “${normalized}” into a durable task${reason ? ` (${reason})` : ''}.`;
  }

  function buildTaskPacket(inputValue) {
    const input = inputValue && typeof inputValue === 'object' ? inputValue : { originalUserMessage: inputValue };
    const originalUserMessage = compactWhitespace(input.originalUserMessage || input.originalMessage || input.message || input.prompt || '');
    if (!originalUserMessage) {
      return {
        success: false,
        needsClarification: true,
        clarification: 'What task would you like me to carry out?',
        task: null
      };
    }

    const precedingMessages = normalizePrecedingMessages(input, originalUserMessage);
    const precedingConversationSummary = buildPrecedingSummary(input, precedingMessages);
    const contextDependent = isContextDependentRequest(originalUserMessage);
    const options = normalizeOptions(input, precedingMessages);
    const optionIndex = requestedOptionIndex(originalUserMessage);
    const selectedOptionRecord = optionIndex == null
      ? null
      : (optionIndex === -1 ? options[options.length - 1] : options.find(option => option.index === optionIndex));
    const selectedOption = selectedOptionRecord ? selectedOptionRecord.label : '';
    const explicitObjective = compactWhitespace(input.objective || input.resolvedObjective || '');

    if (contextDependent && optionIndex != null && !selectedOption) {
      return {
        success: false,
        needsClarification: true,
        clarification: clarificationForRequest(originalUserMessage, 'the referenced option is unavailable'),
        task: null
      };
    }
    if (contextDependent && !explicitObjective && !selectedOption
      && !hasEnoughContext(precedingConversationSummary, precedingMessages, input.requirements || input.knownRequirements)) {
      return {
        success: false,
        needsClarification: true,
        clarification: clarificationForRequest(originalUserMessage, 'the referenced discussion is unavailable'),
        task: null
      };
    }

    const workspace = normalizeWorkspace(input);
    const objective = contextDependent
      ? deriveContextObjective(input, precedingMessages, precedingConversationSummary, selectedOption)
      : (explicitObjective || originalUserMessage);
    if (!objective) {
      return {
        success: false,
        needsClarification: true,
        clarification: clarificationForRequest(originalUserMessage, 'no objective could be established'),
        task: null
      };
    }

    const now = resolveNow(input.timestamp || input.createdAt || input.now);
    const origin = normalizeIdentity(input.origin, {
      conversationId: input.originConversationId,
      sessionId: input.originSessionId,
      messageId: input.originMessageId
    });
    const target = normalizeIdentity(input.target, {
      conversationId: input.targetConversationId,
      sessionId: input.targetSessionId,
      messageId: ''
    });
    target.mode = compactInline((input.target && input.target.mode) || input.targetMode || 'coder') || 'coder';
    const requirements = extractRequirements(input, precedingMessages, selectedOption);
    const constraints = uniqueStrings(input.constraints || []);
    const unresolvedDecisions = extractUnresolvedDecisions(input, precedingMessages);
    const title = compactInline(input.title) || titleFromObjective(objective, workspace.project.name);
    const taskId = compactInline(input.taskId || input.id) || generateTaskId(now, input.idFactory);

    const task = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      title,
      objective,
      originalUserMessage,
      precedingConversationSummary,
      workspace,
      workspacePath: workspace.path,
      selectedProject: { ...workspace.project },
      requirements,
      constraints,
      unresolvedDecisions,
      origin,
      target,
      source: compactInline(input.source || 'user'),
      status: TASK_STATES.PENDING,
      timestamp: now,
      createdAt: now,
      updatedAt: now
    };

    return {
      success: true,
      needsClarification: false,
      clarification: '',
      task
    };
  }

  function normalizeTaskRecord(recordValue, options = {}) {
    const record = typeof recordValue === 'string'
      ? { prompt: recordValue }
      : (recordValue && typeof recordValue === 'object' ? recordValue : {});
    const now = resolveNow(record.createdAt || record.timestamp || options.now);
    const workspace = normalizeWorkspace({
      ...record,
      workspace: record.workspace,
      workspacePath: record.workspacePath || (typeof record.workspace === 'string' ? record.workspace : ''),
      projectPath: record.projectPath || (record.selectedProject && record.selectedProject.path),
      projectName: record.projectName || (record.selectedProject && record.selectedProject.name)
    });
    const originalUserMessage = compactWhitespace(record.originalUserMessage || record.originalMessage || record.prompt || record.message || '');
    const objective = compactWhitespace(record.objective || record.resolvedObjective || record.prompt || record.message || originalUserMessage);
    const taskId = compactInline(record.taskId || record.id)
      || (!options.forceUniqueId ? legacyTaskId(record, now, options.legacyIndex) : '')
      || generateTaskId(now, options.idFactory);
    const origin = normalizeIdentity(record.origin, {
      conversationId: record.originConversationId || record.ownerConversationId || record.supervisingConversationId,
      sessionId: record.originSessionId,
      messageId: record.originMessageId
    });
    const target = normalizeIdentity(record.target, {
      conversationId: record.targetConversationId || record.conversationId || record.coderConversationId,
      sessionId: record.targetSessionId,
      messageId: ''
    });
    target.mode = compactInline((record.target && record.target.mode) || record.targetMode || 'coder') || 'coder';
    const createdAt = resolveNow(record.createdAt || record.timestamp || now);
    const updatedAt = resolveNow(record.updatedAt || createdAt);
    const rawStatus = record.status == null ? record.state : record.status;
    let status = TASK_STATES.PENDING;
    let invalidStatus = '';
    if (compactInline(rawStatus)) {
      try {
        status = normalizeTransitionStatus(rawStatus);
      } catch (_) {
        // A corrupt or future persisted state must never silently re-enter the runnable queue.
        status = TASK_STATES.FAILED;
        invalidStatus = compactInline(rawStatus);
      }
    }
    const normalized = {
      ...record,
      schemaVersion: SCHEMA_VERSION,
      taskId,
      title: compactInline(record.title) || titleFromObjective(objective || originalUserMessage, workspace.project.name),
      objective,
      originalUserMessage,
      precedingConversationSummary: compactWhitespace(record.precedingConversationSummary || record.contextSummary || ''),
      workspace,
      workspacePath: workspace.path,
      selectedProject: { ...workspace.project },
      requirements: uniqueStrings(record.requirements || record.knownRequirements || []),
      constraints: uniqueStrings(record.constraints || []),
      unresolvedDecisions: uniqueStrings(record.unresolvedDecisions || []),
      origin,
      target,
      source: compactInline(record.source || 'unknown'),
      status,
      timestamp: createdAt,
      createdAt,
      updatedAt
    };
    delete normalized.id;
    delete normalized.prompt;
    delete normalized.message;
    delete normalized.state;
    if (invalidStatus) {
      normalized.failure = {
        ...(normalized.failure && typeof normalized.failure === 'object' ? normalized.failure : {}),
        code: 'invalid_persisted_status',
        message: `Unrecognized persisted task state: ${invalidStatus}`
      };
    }
    return normalized;
  }

  function transitionTask(taskValue, nextStateValue, details = {}) {
    const task = normalizeTaskRecord(taskValue);
    const nextState = normalizeTransitionStatus(nextStateValue);
    const currentState = task.status;
    if (currentState === nextState) {
      // A second active claim means two runners could execute the same durable task. Reject it.
      if (nextState === TASK_STATES.ACTIVE) {
        const error = new Error(`Task is already active: ${task.taskId}`);
        error.code = 'TASK_ALREADY_ACTIVE';
        throw error;
      }
      // Replayed terminal/pending transitions are idempotent and cannot rewrite result metadata.
      return task;
    }
    if (currentState !== nextState && !(ALLOWED_TRANSITIONS[currentState] || new Set()).has(nextState)) {
      const error = new Error(`Invalid task transition: ${currentState} -> ${nextState}`);
      error.code = 'INVALID_TASK_TRANSITION';
      throw error;
    }
    const now = Math.max(resolveNow(details.timestamp || details.now), Number(task.updatedAt) || 0);
    const currentExecution = task.execution && typeof task.execution === 'object' ? task.execution : {};
    const expectedExecutionId = compactInline(details.expectedExecutionId || '');
    if (currentState === TASK_STATES.ACTIVE && nextState !== TASK_STATES.CANCELLED) {
      const currentExecutionId = compactInline(currentExecution.executionId || '');
      if (currentExecutionId && !expectedExecutionId) {
        const error = new Error(`Execution ID is required to transition active task ${task.taskId}.`);
        error.code = 'TASK_EXECUTION_ID_REQUIRED';
        throw error;
      }
      if (expectedExecutionId && expectedExecutionId !== currentExecutionId) {
        const error = new Error(`Stale execution cannot transition task ${task.taskId}.`);
        error.code = 'STALE_TASK_EXECUTION';
        throw error;
      }
    }
    const next = {
      ...task,
      status: nextState,
      updatedAt: now
    };
    if (nextState === TASK_STATES.ACTIVE) {
      const attempt = Math.max(0, Number(currentExecution.attempt) || 0) + 1;
      const executionId = compactInline(details.executionId) || `${task.taskId}:run:${attempt}`;
      if (attempt > 1 && executionId === compactInline(currentExecution.executionId || '')) {
        const error = new Error(`Execution ID must be unique for each run of task ${task.taskId}.`);
        error.code = 'DUPLICATE_EXECUTION_ID';
        throw error;
      }
      if (!next.startedAt) next.startedAt = now;
      next.lastStartedAt = now;
      next.execution = {
        ...currentExecution,
        attempt,
        executionId,
        state: TASK_STATES.ACTIVE,
        startedAt: now
      };
    }
    if (nextState === TASK_STATES.PENDING && currentState === TASK_STATES.ACTIVE) {
      next.pendingAt = now;
      next.execution = {
        ...currentExecution,
        state: TASK_STATES.PENDING,
        yieldedAt: now,
        reason: compactWhitespace(details.reason || details.pendingReason || '')
      };
    }
    if (nextState === TASK_STATES.COMPLETED) {
      next.completedAt = now;
      next.execution = { ...currentExecution, state: TASK_STATES.COMPLETED, endedAt: now };
      if (Object.prototype.hasOwnProperty.call(details, 'result')) next.result = details.result;
    }
    if (nextState === TASK_STATES.CANCELLED) {
      next.cancelledAt = now;
      if (Object.keys(currentExecution).length) {
        next.execution = { ...currentExecution, state: TASK_STATES.CANCELLED, endedAt: now };
      }
      next.cancellation = {
        ...(task.cancellation && typeof task.cancellation === 'object' ? task.cancellation : {}),
        requestedAt: Number(details.requestedAt || now),
        completedAt: now,
        reason: compactWhitespace(details.reason || (task.cancellation && task.cancellation.reason) || 'Cancelled by request.'),
        requestedByConversationId: compactInline(details.requestedByConversationId || '')
      };
    }
    if (nextState === TASK_STATES.FAILED) {
      next.failedAt = now;
      if (Object.keys(currentExecution).length) {
        next.execution = { ...currentExecution, state: TASK_STATES.FAILED, endedAt: now };
      }
      next.failure = {
        ...(task.failure && typeof task.failure === 'object' ? task.failure : {}),
        code: compactInline(details.code || (task.failure && task.failure.code) || 'task_failed'),
        message: compactWhitespace(details.error || details.reason || (task.failure && task.failure.message) || 'Task failed.')
      };
    }
    return next;
  }

  function canRequesterControlTask(taskValue, requesterValue) {
    const task = normalizeTaskRecord(taskValue);
    const requester = typeof requesterValue === 'string'
      ? { conversationId: compactInline(requesterValue) }
      : (requesterValue && typeof requesterValue === 'object' ? requesterValue : {});
    const conversationId = compactInline(requester.conversationId || requester.requesterConversationId || '');
    if (conversationId) {
      const permitted = new Set([
        task.origin && task.origin.conversationId,
        task.target && task.target.conversationId,
        task.ownerConversationId,
        task.supervisingConversationId
      ].map(compactInline).filter(Boolean));
      if (permitted.has(conversationId)) return true;
    }
    const sessionId = compactInline(requester.sessionId || '');
    return !conversationId && !!sessionId && !!task.origin.sessionId && sessionId === task.origin.sessionId;
  }

  function renderList(label, values) {
    const items = uniqueStrings(values || []);
    return items.length ? `${label}:\n${items.map(item => `- ${item}`).join('\n')}` : `${label}: None recorded.`;
  }

  function renderTaskPrompt(taskValue) {
    const task = normalizeTaskRecord(taskValue);
    const workspace = task.workspace || normalizeWorkspace({});
    const project = workspace.project || {};
    return [
      `Task: ${task.title}`,
      `Task ID: ${task.taskId}`,
      '',
      'Objective:',
      task.objective || 'No objective was resolved.',
      '',
      'Relevant preceding conversation:',
      task.precedingConversationSummary || 'No preceding conversation was required.',
      '',
      `Workspace role: ${workspace.role}`,
      `Exact workspace path: ${workspace.path || '(unresolved)'}`,
      `Selected project: ${project.name || '(none)'}${project.path ? ` (${project.path})` : ''}`,
      '',
      renderList('Known requirements', task.requirements),
      '',
      renderList('Constraints', task.constraints),
      '',
      renderList('Unresolved decisions', task.unresolvedDecisions),
      '',
      'Original user message (provenance only):',
      task.originalUserMessage || '(missing)',
      '',
      `Origin conversation: ${task.origin.conversationId || '(unknown)'}`,
      `Origin session: ${task.origin.sessionId || '(unknown)'}`,
      `Origin message: ${task.origin.messageId || '(unknown)'}`
    ].join('\n').trim();
  }

  function describeTaskStatus(taskOrStatus) {
    const task = taskOrStatus && typeof taskOrStatus === 'object' ? normalizeTaskRecord(taskOrStatus) : null;
    let status = task ? task.status : TASK_STATES.FAILED;
    if (!task) {
      try { status = normalizeTransitionStatus(taskOrStatus); } catch (_) {}
    }
    const reason = task && status === TASK_STATES.CANCELLED && task.cancellation ? compactInline(task.cancellation.reason) : '';
    const failure = task && status === TASK_STATES.FAILED && task.failure ? compactInline(task.failure.message) : '';
    if (status === TASK_STATES.PENDING) return 'Queued — waiting to start.';
    if (status === TASK_STATES.ACTIVE) return 'Running.';
    if (status === TASK_STATES.COMPLETED) return 'Completed.';
    if (status === TASK_STATES.CANCELLED) return reason ? `Cancelled — ${reason}` : 'Cancelled.';
    return failure ? `Failed — ${failure}` : 'Failed.';
  }

  return {
    SCHEMA_VERSION,
    TASK_STATES,
    normalizeTransitionStatus,
    isContextDependentRequest,
    buildTaskPacket,
    normalizeTaskRecord,
    transitionTask,
    canRequesterControlTask,
    renderTaskPrompt,
    describeTaskStatus
  };
});
