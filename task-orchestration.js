(function attachOrionTaskOrchestration(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrionTaskOrchestration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOrionTaskOrchestration() {
  'use strict';

  const SpecialistRegistry = typeof require === 'function'
    ? require('./specialist-registry')
    : (typeof globalThis !== 'undefined' ? globalThis.OrionSpecialistRegistry : null);

  function isRegisteredTaskTarget(modeValue) {
    const mode = String(modeValue || '').trim().toLowerCase();
    return mode === 'orion' || !!(SpecialistRegistry && SpecialistRegistry.has(mode));
  }

  // Generalized so a new specialist role only needs to be added to specialist-registry.js, not
  // hand-copied into this message too. 'Dispatch' is prepended since it is a valid task target
  // ('orion') but is not itself a specialist-registry entry.
  function describeRegisteredTaskTargets() {
    const specialistLabels = SpecialistRegistry && typeof SpecialistRegistry.list === 'function'
      ? SpecialistRegistry.list().map(definition => definition.label)
      : [];
    return ['Dispatch', ...specialistLabels];
  }

  // "Dispatch, Coder, Operator, or Researcher" instead of a bare comma join — reads as a real
  // English list regardless of how many specialist roles are registered.
  function joinAsEnglishList(items) {
    const values = (items || []).filter(Boolean);
    if (values.length <= 1) return values.join('');
    if (values.length === 2) return `${values[0]} or ${values[1]}`;
    return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
  }

  // ── Delegation chain guard (handoff-generalization piece) ──────────────────────────────────
  // Real, code-enforced replacement for the old "please don't create another handoff for the same
  // completed child" prose-only instruction. A task's delegationChain is the ordered list of
  // specialist roles that have already handled this lineage, from the original Dispatch handoff
  // down to (and including) the task currently deciding whether to delegate further. Every
  // specialist role can now hand off to every other role (see specialist-registry.js
  // handoffToolNamesFor), which means an unchecked chain could bounce forever
  // (coder -> operator -> coder -> operator -> ...) once more than one role can initiate a
  // handoff. This guard makes that structurally impossible rather than relying on the model
  // reading and honoring an instruction.
  // One hop per registered specialist. Hard-coding 3 re-created the same role-count assumption the
  // registry was introduced to eliminate: adding a fourth specialist would silently cap its chains
  // one hop short. Derived here, with 3 as the floor for environments where the registry has not
  // evaluated yet (renderer <script> load order), so the guard can never become more permissive
  // than it was.
  const MAX_DELEGATION_DEPTH = Math.max(
    3,
    SpecialistRegistry && typeof SpecialistRegistry.list === 'function' ? SpecialistRegistry.list().length : 0
  );

  function evaluateDelegationHandoff(currentChainValue, targetRoleValue) {
    const chain = uniqueStrings(Array.isArray(currentChainValue) ? currentChainValue : [])
      .map(role => String(role || '').trim().toLowerCase())
      .filter(Boolean);
    const targetRole = String(targetRoleValue || '').trim().toLowerCase();
    if (!targetRole) {
      return { allowed: false, reason: 'No target specialist role was specified for this handoff.', chain, nextChain: chain };
    }
    if (chain.includes(targetRole)) {
      const attempted = [...chain, targetRole].join(' → ');
      return {
        allowed: false,
        reason: `Handoff blocked: ${attempted} would hand this task back to "${targetRole}", which already appears earlier in this same delegation chain. Blocked to prevent an infinite handoff loop.`,
        chain,
        nextChain: chain
      };
    }
    const nextChain = [...chain, targetRole];
    if (nextChain.length > MAX_DELEGATION_DEPTH) {
      return {
        allowed: false,
        reason: `Handoff blocked: this would extend the delegation chain to ${nextChain.length} hops (${nextChain.join(' → ')}), past the maximum of ${MAX_DELEGATION_DEPTH}.`,
        chain,
        nextChain: chain
      };
    }
    return { allowed: true, reason: '', chain, nextChain };
  }

  const SCHEMA_VERSION = 6;
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

  function normalizeImageAttachments(inputValue, limit = 4) {
    const values = Array.isArray(inputValue) ? inputValue : [];
    const output = [];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const data = text(value.data);
      const mimeType = compactInline(value.mimeType || value.mime_type || value.type);
      if (!data || !mimeType || !/^image\//i.test(mimeType)) continue;
      const image = { data, mimeType };
      const name = compactInline(value.name || value.fileName || value.filename);
      if (name) image.name = name;
      output.push(image);
      if (output.length >= limit) break;
    }
    return output;
  }

  function taskImageInput(record) {
    if (Array.isArray(record && record.images)) return record.images;
    if (Array.isArray(record && record.imageAttachments)) return record.imageAttachments;
    if (Array.isArray(record && record.attachments)) return record.attachments;
    return [];
  }

  function taskContextPacketIds(record) {
    const values = Array.isArray(record && record.contextPacketIds)
      ? record.contextPacketIds
      : (record && record.contextPacketId ? [record.contextPacketId] : []);
    return uniqueStrings(values, 5);
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
    return !!(value && typeof value === 'object' && value.contextDependent === true);
  }

  function isContinuationRequest(value) {
    return !!(value && typeof value === 'object'
      && value.intent === 'context_followup'
      && value.target === 'active_owned_task');
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
        if (['system', 'tool', 'function'].includes(compactInline(message.role).toLowerCase())) return false;
        if (['queue-status', 'queued-prompt', 'agent-start-blocked'].includes(compactInline(message.source).toLowerCase())) return false;
        return true;
      });

    const originalKey = compactInline(originalMessage).toLowerCase();
    if (messages.length && originalKey && compactInline(messages[messages.length - 1].value).toLowerCase() === originalKey) {
      messages.pop();
    }
    return messages.slice(-14);
  }

  // A handoff packet carries EVIDENCE, not chatter. The objective, requirements, constraints and
  // unresolved decisions are the specialist's actual brief; this field exists only to resolve
  // referents the objective could not absorb ("that", "the one we discussed"), so it is a short
  // excerpt rather than a transcript.
  //
  // It used to inline the last 14 messages up to 8000 characters verbatim. A real run handed
  // Operator the entire preceding Dispatch conversation — release-notes discussion, branch
  // commentary, security debate, and a stale claim the user had already corrected — in front of a
  // task whose whole content was "read the DeepSeek balance from a browser favorite". That is paid
  // for on every handoff, slows orientation, and invites the specialist to act on material that is
  // no longer true.
  const MAX_PRECEDING_SUMMARY_CHARS = 1200;
  const MAX_PRECEDING_SUMMARY_MESSAGES = 4; // the last two exchanges
  const MAX_PRECEDING_MESSAGE_CHARS = 300;

  function buildPrecedingSummary(input, messages) {
    const explicit = compactWhitespace(input.precedingConversationSummary || input.contextSummary || '');
    // An explicit summary was already distilled by the caller, but it is still capped: a caller
    // passing a whole transcript through this field would reintroduce exactly the same bloat.
    if (explicit) return explicit.slice(0, MAX_PRECEDING_SUMMARY_CHARS);
    const lines = [];
    let characters = 0;
    for (const message of messages.slice(-MAX_PRECEDING_SUMMARY_MESSAGES).reverse()) {
      const normalizedRole = compactInline(message.role).toLowerCase();
      const role = ['assistant', 'model', 'orion'].includes(normalizedRole)
        ? 'Assistant'
        : (normalizedRole === 'user' ? 'User' : 'Context');
      const value = message.value.length > MAX_PRECEDING_MESSAGE_CHARS
        ? `${message.value.slice(0, MAX_PRECEDING_MESSAGE_CHARS)}…`
        : message.value;
      const line = `${role}: ${value}`;
      if (characters + line.length > MAX_PRECEDING_SUMMARY_CHARS) break;
      lines.unshift(line);
      characters += line.length + 1;
    }
    return lines.join('\n').trim();
  }

  function titleFromObjective(objective, projectName) {
    let candidate = compactInline(objective);
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

  function localPathKey(pathValue) {
    return compactInline(pathValue).replace(/[\\/]+$/g, '').replace(/[\\/]+/g, '\\').toLowerCase();
  }

  function sameLocalPath(left, right) {
    return !!localPathKey(left) && localPathKey(left) === localPathKey(right);
  }

  function normalizedProjectName(value) {
    return compactInline(value).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  }

  function projectMentionIndex(contextText, projectName) {
    const parts = compactInline(projectName).match(/[a-z0-9]+/gi) || [];
    if (!parts.length) return -1;
    const escaped = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped.join('(?:[^a-z0-9]+|\\s*)')}(?=$|[^a-z0-9])`, 'gi');
    let lastIndex = -1;
    let match;
    while ((match = pattern.exec(String(contextText || ''))) !== null) {
      lastIndex = match.index;
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    }
    return lastIndex;
  }

  function resolveKnownProjectFromContext(input, contextText, searchRoot) {
    const values = input.knownProjects || input.registeredProjects || input.projectCandidates || [];
    const projects = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const item = typeof value === 'string' ? { path: value } : (value || {});
      const projectPath = compactInline(item.path || item.projectPath || item.workspace || '');
      if (!projectPath || (searchRoot && sameLocalPath(projectPath, searchRoot))) continue;
      const key = localPathKey(projectPath);
      if (seen.has(key)) continue;
      seen.add(key);
      projects.push({
        path: projectPath,
        name: compactInline(item.name || item.projectName || baseName(projectPath)),
        source: compactInline(item.source || 'registered_project')
      });
    }
    let best = null;
    for (const project of projects) {
      const nameKey = normalizedProjectName(project.name || baseName(project.path));
      if (!nameKey || nameKey.length < 3) continue;
      const index = projectMentionIndex(contextText, project.name || baseName(project.path));
      if (index < 0) continue;
      if (!best || index > best.index || (index === best.index && nameKey.length > best.nameKey.length)) {
        best = { ...project, index, nameKey };
      }
    }
    return best;
  }

  function normalizeWorkspace(input, contextText = '') {
    const supplied = input && typeof input.workspace === 'object' ? input.workspace : {};
    const searchRoot = compactInline(input.searchRoot || input.projectSearchRoot || '');
    let path = compactInline(supplied.path || input.workspacePath || input.path || '');
    const projectValue = supplied.project && typeof supplied.project === 'object' ? supplied.project : {};
    let projectPath = compactInline(projectValue.path || supplied.projectPath || input.projectPath || input.dispatchProjectPath || '');
    let projectName = compactInline(projectValue.name || supplied.projectName || input.projectName || baseName(projectPath));
    let role = compactInline(supplied.role || supplied.kind || input.workspaceRole || input.workspaceKind || '').toLowerCase();
    let workspaceSource = compactInline(supplied.source || input.workspaceSource || '');
    const aliases = {
      project: 'active_project',
      active: 'active_project',
      active_project_workspace: 'active_project',
      search_root: 'project_search_root',
      projects_root: 'project_search_root',
      generic_projects_root: 'project_search_root',
      standalone: 'standalone_specialist',
      coder: 'standalone_specialist',
      operator: 'standalone_specialist',
      standalone_coder: 'standalone_specialist',
      unknown: 'unresolved'
    };
    role = aliases[role] || role;
    const pathIsSearchRoot = !!searchRoot && sameLocalPath(path, searchRoot);
    const projectIsSearchRoot = !!searchRoot && sameLocalPath(projectPath, searchRoot);
    if (pathIsSearchRoot || projectIsSearchRoot) {
      path = searchRoot;
      projectPath = '';
      projectName = '';
      role = 'project_search_root';
    }
    if (role === 'project_search_root' || role === 'unresolved' || !role) {
      const project = resolveKnownProjectFromContext(input, contextText, searchRoot);
      if (project) {
        path = project.path;
        projectPath = project.path;
        projectName = project.name;
        role = 'active_project';
        workspaceSource = workspaceSource || project.source;
      }
    }
    if (!['active_project', 'project_search_root', 'standalone_specialist', 'unresolved'].includes(role)) {
      if (projectPath && path) role = 'active_project';
      else if (/standalone-workspaces/i.test(path)) role = 'standalone_specialist';
      else role = 'unresolved';
    }
    return {
      role,
      path,
      project: {
        name: projectName,
        path: projectPath
      },
      source: workspaceSource,
      resolved: (role === 'active_project' || role === 'standalone_specialist') && !!path
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

  function normalizeExecutionProfile(value, fallbacks = {}) {
    const supplied = value && typeof value === 'object' ? value : {};
    const requestedModel = compactInline(
      supplied.requestedModel
      || supplied.model
      || fallbacks.requestedModel
      || fallbacks.modelSelectValue
      || ''
    );
    const requestedReasoningValue = compactInline(
      supplied.requestedReasoning
      || supplied.reasoningEffort
      || supplied.reasoning
      || fallbacks.requestedReasoning
      || fallbacks.reasoningEffort
      || 'auto'
    ).toLowerCase() || 'auto';
    const requestedReasoning = requestedReasoningValue === 'ultra'
      ? 'max'
      : (['auto', 'low', 'medium', 'high', 'max'].includes(requestedReasoningValue)
          ? requestedReasoningValue
          : 'auto');
    return {
      requestedModel,
      requestedReasoning,
      allowEscalation: supplied.allowEscalation !== false,
      allowDowngrade: supplied.allowDowngrade === true,
      capturedAt: resolveNow(supplied.capturedAt || fallbacks.capturedAt || fallbacks.now)
    };
  }

  function clarificationForRequest(request, reason, classifierQuestion) {
    const supplied = compactWhitespace(classifierQuestion);
    if (supplied) return supplied;
    const normalized = compactInline(request);
    return `What specific work should I carry out? I could not safely resolve “${normalized}” into a durable task${reason ? ` (${reason})` : ''}.`;
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

    const semanticIntent = input.semanticIntent && typeof input.semanticIntent === 'object'
      ? input.semanticIntent
      : (input.intentClassification && typeof input.intentClassification === 'object'
          ? input.intentClassification
          : {});
    const taskResolution = semanticIntent.taskResolution && typeof semanticIntent.taskResolution === 'object'
      ? semanticIntent.taskResolution
      : {};
    const precedingMessages = normalizePrecedingMessages(input, originalUserMessage);
    const precedingConversationSummary = buildPrecedingSummary(input, precedingMessages);
    const contextDependent = semanticIntent.contextDependent === true;
    const explicitObjective = compactWhitespace(
      input.objective
      || input.resolvedObjective
      || semanticIntent.resolvedRequest
      || ''
    );

    if (semanticIntent.needsClarification === true || semanticIntent.intent === 'clarification_required'
      || (contextDependent && !explicitObjective)) {
      return {
        success: false,
        needsClarification: true,
        clarification: clarificationForRequest(
          originalUserMessage,
          'the referenced discussion is unavailable',
          semanticIntent.clarificationQuestion
        ),
        task: null
      };
    }

    const workspace = normalizeWorkspace(
      input,
      [precedingConversationSummary, originalUserMessage].filter(Boolean).join('\n')
    );
    if (contextDependent && workspace.role === 'project_search_root') {
      return {
        success: false,
        needsClarification: true,
        clarification: 'Which specific project workspace should I use? The Projects directory is only a search root, so I will not queue this context-dependent task until the project is resolved.',
        task: null
      };
    }
    const objective = explicitObjective || originalUserMessage;
    if (!objective) {
      return {
        success: false,
        needsClarification: true,
        clarification: clarificationForRequest(originalUserMessage, 'no objective could be established', semanticIntent.clarificationQuestion),
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
    // target.mode is the canonical specialist-role field. Missing legacy values default to Coder;
    // an explicit unknown role fails closed instead of inheriting Coder behavior.
    target.mode = compactInline((input.target && input.target.mode) || input.targetMode || 'coder') || 'coder';
    if (!isRegisteredTaskTarget(target.mode)) {
      return {
        success: false,
        needsClarification: true,
        clarification: `Orion does not have a registered task role named "${target.mode}". Choose ${joinAsEnglishList(describeRegisteredTaskTargets())} before this task is queued.`,
        task: null
      };
    }
    const requirements = uniqueStrings([
      ...(input.requirements || input.knownRequirements || []),
      ...(taskResolution.requirements || [])
    ]);
    const constraints = uniqueStrings([...(input.constraints || []), ...(taskResolution.constraints || [])]);
    const unresolvedDecisions = uniqueStrings([
      ...(input.unresolvedDecisions || []),
      ...(taskResolution.unresolvedDecisions || [])
    ]);
    const title = compactInline(input.title || taskResolution.title) || titleFromObjective(objective, workspace.project.name);
    const taskId = compactInline(input.taskId || input.id) || generateTaskId(now, input.idFactory);
    const supersedesTaskId = compactInline(
      input.supersedesTaskId
      || input.predecessorTaskId
      || semanticIntent.supersedesTaskId
      || ''
    );
    const parentTaskId = compactInline(input.parentTaskId || '');
    const rootOriginConversationId = compactInline(
      input.rootOriginConversationId
      || (input.rootOrigin && input.rootOrigin.conversationId)
      || origin.conversationId
      || ''
    );
    // Ordered specialist-role lineage for this task, already vetted by evaluateDelegationHandoff
    // before this packet was built (see agent.js's shared handoff execution path). Stored verbatim
    // (sanitized) rather than recomputed here so buildTaskPacket stays a pure "shape the input"
    // function and the one guard decision lives in one place.
    const delegationChain = uniqueStrings(input.delegationChain || []).map(role => String(role).trim().toLowerCase()).filter(Boolean);
    const executionProfile = normalizeExecutionProfile(input.executionProfile, {
      modelSelectValue: input.modelSelectValue,
      reasoningEffort: input.reasoningEffort,
      capturedAt: now,
      now
    });
    const executionSurface = ['none', 'desktop', 'browser', 'process'].includes(
      compactInline(input.executionSurface || semanticIntent.executionSurface).toLowerCase()
    )
      ? compactInline(input.executionSurface || semanticIntent.executionSurface).toLowerCase()
      : 'none';

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
      images: normalizeImageAttachments(taskImageInput(input)),
      contextPacketIds: taskContextPacketIds(input),
      executionProfile,
      executionSurface,
      origin,
      target,
      parentTaskId,
      rootOriginConversationId,
      delegationChain,
      supersedesTaskId,
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
    // Legacy records without a role are Coder tasks. Unknown persisted roles are retained for
    // provenance but made non-runnable below.
    target.mode = compactInline((record.target && record.target.mode) || record.targetMode || 'coder') || 'coder';
    const invalidTargetMode = isRegisteredTaskTarget(target.mode) ? '' : target.mode;
    const createdAt = resolveNow(record.createdAt || record.timestamp || now);
    const updatedAt = resolveNow(record.updatedAt || createdAt);
    const rawStatus = record.status == null ? record.state : record.status;
    const continuationRecord = record.continuation && typeof record.continuation === 'object'
      ? record.continuation
      : null;
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
    const persistedResultSummary = compactWhitespace(
      record.result && typeof record.result === 'object' ? record.result.summary : ''
    );
    const legacyCompletedProviderFailure = status === TASK_STATES.COMPLETED
      && persistedResultSummary.startsWith('Error contacting Model API:');
    if (legacyCompletedProviderFailure) status = TASK_STATES.FAILED;
    if (invalidTargetMode && !TERMINAL_STATES.has(status)) status = TASK_STATES.FAILED;
    const persistedTitle = compactInline(record.title);
    const title = !persistedTitle || persistedTitle.toLowerCase() === 'execute dispatch request'
      ? titleFromObjective(objective || originalUserMessage, workspace.project.name)
      : persistedTitle;
    const normalized = {
      ...record,
      schemaVersion: SCHEMA_VERSION,
      taskId,
      title,
      objective,
      originalUserMessage,
      precedingConversationSummary: compactWhitespace(record.precedingConversationSummary || record.contextSummary || ''),
      workspace,
      workspacePath: workspace.path,
      selectedProject: { ...workspace.project },
      requirements: uniqueStrings(record.requirements || record.knownRequirements || []),
      constraints: uniqueStrings(record.constraints || []),
      unresolvedDecisions: uniqueStrings(record.unresolvedDecisions || []),
      images: normalizeImageAttachments(taskImageInput(record)),
      contextPacketIds: taskContextPacketIds(record),
      executionProfile: normalizeExecutionProfile(record.executionProfile, {
        modelSelectValue: record.modelSelectValue,
        reasoningEffort: record.reasoningEffort,
        capturedAt: record.createdAt || record.timestamp || now,
        now
      }),
      executionSurface: ['none', 'desktop', 'browser', 'process'].includes(compactInline(record.executionSurface).toLowerCase())
        ? compactInline(record.executionSurface).toLowerCase()
        : 'none',
      continuation: continuationRecord && compactWhitespace(continuationRecord.input || continuationRecord.prompt || '')
        ? {
            input: compactWhitespace(continuationRecord.input || continuationRecord.prompt || ''),
            source: compactInline(continuationRecord.source || 'task-continuation'),
            kind: compactInline(continuationRecord.kind || ''),
            messageId: compactInline(continuationRecord.messageId || ''),
            createdAt: resolveNow(continuationRecord.createdAt || updatedAt)
          }
        : null,
      origin,
      target,
      parentTaskId: compactInline(record.parentTaskId || ''),
      rootOriginConversationId: compactInline(
        record.rootOriginConversationId
        || (record.rootOrigin && record.rootOrigin.conversationId)
        || origin.conversationId
        || ''
      ),
      delegationChain: uniqueStrings(record.delegationChain || []).map(role => String(role).trim().toLowerCase()).filter(Boolean),
      supersedesTaskId: compactInline(
        record.supersedesTaskId
        || record.predecessorTaskId
        || record.continuationOfTaskId
        || ''
      ),
      ...(invalidTargetMode ? {
        failure: {
          code: 'unknown_specialist_role',
          message: `Persisted task targets unregistered specialist "${invalidTargetMode}" and cannot be executed.`
        }
      } : {}),
      supersededByTaskId: compactInline(record.supersededByTaskId || ''),
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
    } else if (legacyCompletedProviderFailure) {
      normalized.failure = {
        ...(normalized.failure && typeof normalized.failure === 'object' ? normalized.failure : {}),
        code: 'legacy_model_api_failure',
        message: persistedResultSummary.slice(0, 1000)
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
      if (details.consumeContinuation === true && next.continuation) {
        next.continuation = null;
      }
    }
    if (nextState === TASK_STATES.PENDING && currentState === TASK_STATES.ACTIVE) {
      next.pendingAt = now;
      const resumePolicy = ['automatic', 'scheduled', 'user', 'manual'].includes(compactInline(details.resumePolicy).toLowerCase())
        ? compactInline(details.resumePolicy).toLowerCase()
        : 'manual';
      next.execution = {
        ...currentExecution,
        state: TASK_STATES.PENDING,
        yieldedAt: now,
        reason: compactWhitespace(details.reason || details.pendingReason || ''),
        reasonCode: compactInline(details.reasonCode || ''),
        resumePolicy
      };
      if (details.continuation && typeof details.continuation === 'object') {
        const continuationInput = compactWhitespace(details.continuation.input || details.continuation.prompt || '');
        if (continuationInput) {
          next.continuation = {
            input: continuationInput,
            source: compactInline(details.continuation.source || 'task-continuation'),
            kind: compactInline(details.continuation.kind || ''),
            messageId: compactInline(details.continuation.messageId || ''),
            createdAt: Number(details.continuation.createdAt || now)
          };
        }
      }
      if (details.notificationKind === 'checkpoint') {
        const scheduleValue = details.schedule && typeof details.schedule === 'object'
          ? details.schedule
          : null;
        const checkpoint = {
          checkpointId: compactInline(details.checkpointId)
            || `${task.taskId}:checkpoint:${Math.max(1, Number(currentExecution.attempt) || 1)}:${now}`,
          attempt: Math.max(1, Number(currentExecution.attempt) || 1),
          summary: compactWhitespace(details.summary || ''),
          result: details.result && typeof details.result === 'object' ? details.result : null,
          reason: compactWhitespace(details.reason || details.pendingReason || ''),
          reasonCode: compactInline(details.reasonCode || ''),
          resumePolicy,
          schedule: scheduleValue
            ? {
                scheduleId: compactInline(scheduleValue.scheduleId || ''),
                sourceTaskId: compactInline(scheduleValue.sourceTaskId || task.taskId),
                dueAt: Number(scheduleValue.dueAt || scheduleValue.nextRunAt) || 0,
                nextRunAt: Number(scheduleValue.nextRunAt || scheduleValue.dueAt) || 0,
                purpose: compactWhitespace(scheduleValue.purpose || '')
              }
            : null,
          checkpointedAt: now
        };
        next.checkpoint = checkpoint;
        next.checkpointHistory = [
          ...(Array.isArray(task.checkpointHistory) ? task.checkpointHistory : []),
          checkpoint
        ].slice(-20);
      }
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
        task.rootOriginConversationId,
        task.ownerConversationId,
        task.supervisingConversationId
      ].map(compactInline).filter(Boolean));
      if (permitted.has(conversationId)) return true;
    }
    const sessionId = compactInline(requester.sessionId || '');
    return !conversationId && !!sessionId && !!task.origin.sessionId && sessionId === task.origin.sessionId;
  }

  // Continuations remain bound to one explicit registered specialist role.
  function selectOwnedContinuationTask(tasksValue, requesterConversationIdValue, preferredTaskIdsValue = [], options = {}) {
    const requesterConversationId = compactInline(requesterConversationIdValue);
    const preferredTaskIds = uniqueStrings(preferredTaskIdsValue).map(compactInline).filter(Boolean);
    const role = compactInline(options.role).toLowerCase() || 'coder';
    if (!SpecialistRegistry || !SpecialistRegistry.has(role)) {
      return { action: 'unknown_specialist', task: null, candidates: [] };
    }
    const tasks = filterSupersededTasks(tasksValue)
      .filter(task =>
        task.taskId
        && [TASK_STATES.PENDING, TASK_STATES.ACTIVE].includes(task.status)
        && compactInline(task.target && task.target.mode).toLowerCase() === role
        && canRequesterControlTask(task, { conversationId: requesterConversationId }))
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    if (!tasks.length) return { action: 'none', task: null, candidates: [] };

    const active = tasks.filter(task => task.status === TASK_STATES.ACTIVE);
    const pending = tasks.filter(task => task.status === TASK_STATES.PENDING);
    const preferredActive = preferredTaskIds
      .map(taskId => active.find(task => task.taskId === taskId))
      .find(Boolean);
    if (preferredActive || active.length === 1) {
      return { action: 'already_active', task: preferredActive || active[0], candidates: active };
    }
    if (active.length > 1) return { action: 'ambiguous_active', task: null, candidates: active };

    const preferredPending = preferredTaskIds
      .map(taskId => pending.find(task => task.taskId === taskId))
      .find(Boolean);
    if (preferredPending || pending.length === 1) {
      return { action: 'resume_pending', task: preferredPending || pending[0], candidates: pending };
    }
    return { action: 'ambiguous_pending', task: null, candidates: pending };
  }

  function renderList(label, values) {
    const items = uniqueStrings(values || []);
    return items.length ? `${label}:\n${items.map(item => `- ${item}`).join('\n')}` : `${label}: None recorded.`;
  }

  function renderTaskPrompt(taskValue) {
    const task = normalizeTaskRecord(taskValue);
    const workspace = task.workspace || normalizeWorkspace({});
    const project = workspace.project || {};
    const sections = [
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
      `Requested model: ${task.executionProfile.requestedModel || '(use current default)'}`,
      `Requested reasoning: ${task.executionProfile.requestedReasoning || 'auto'}`,
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
    ];
    if (task.parentTaskId) {
      sections.push(
        `Parent task: ${task.parentTaskId}`,
        `Root owner conversation: ${task.rootOriginConversationId || '(unknown)'}`
      );
    }
    if (task.continuation && task.continuation.input) {
      sections.push(
        '',
        'Latest continuation input:',
        task.continuation.input,
        `Continuation source: ${task.continuation.source || 'task-continuation'}`,
        `Continuation message: ${task.continuation.messageId || '(unknown)'}`
      );
    }
    return sections.join('\n').trim();
  }

  // A pending task is not one shape. "Queued — waiting to start" is only true before the first
  // execution pass; once a pass has checkpointed, pending means the mission is mid-flight and
  // waiting on something specific. Reporting all of them as "queued" reads as idle, which is the
  // same class of error as reporting them as complete.
  function describePendingReason(task) {
    const execution = task && task.execution && typeof task.execution === 'object' ? task.execution : {};
    const attempt = Math.max(0, Number(execution.attempt) || 0);
    if (attempt === 0) return 'Queued — waiting to start.';
    const reasonCode = compactInline(execution.reasonCode || '').toLowerCase();
    const scheduledAt = Number(
      task && task.checkpoint && task.checkpoint.schedule
      && (task.checkpoint.schedule.nextRunAt || task.checkpoint.schedule.dueAt)
    ) || 0;
    if (reasonCode === 'scheduled_followup'
        || compactInline(execution.resumePolicy).toLowerCase() === 'scheduled') {
      return scheduledAt
        ? `Waiting for a scheduled follow-up at ${new Date(scheduledAt).toLocaleString()}.`
        : 'Waiting for a scheduled follow-up.';
    }
    if (reasonCode === 'automatic_action_boundary') return 'Checkpointed — continuing automatically.';
    if (reasonCode === 'awaiting_delegated_task') return 'Waiting for a delegated task.';
    if (reasonCode === 'awaiting_plan_approval') return 'Waiting for plan approval.';
    if (reasonCode === 'awaiting_clarification' || reasonCode === 'awaiting_input') {
      return 'Waiting for your answer.';
    }
    return 'Checkpointed — waiting to continue.';
  }

  function describeTaskStatus(taskOrStatus) {
    const task = taskOrStatus && typeof taskOrStatus === 'object' ? normalizeTaskRecord(taskOrStatus) : null;
    let status = task ? task.status : TASK_STATES.FAILED;
    if (!task) {
      try { status = normalizeTransitionStatus(taskOrStatus); } catch (_) {}
    }
    const reason = task && status === TASK_STATES.CANCELLED && task.cancellation ? compactInline(task.cancellation.reason) : '';
    const failure = task && status === TASK_STATES.FAILED && task.failure ? compactInline(task.failure.message) : '';
    if (status === TASK_STATES.PENDING) return task ? describePendingReason(task) : 'Queued — waiting to start.';
    if (status === TASK_STATES.ACTIVE) return 'Running.';
    if (status === TASK_STATES.COMPLETED) return 'Completed.';
    if (status === TASK_STATES.CANCELLED) return reason ? `Cancelled — ${reason}` : 'Cancelled.';
    return failure ? `Failed — ${failure}` : 'Failed.';
  }

  function taskConversationId(task, role) {
    if (!task || typeof task !== 'object') return '';
    const nested = task[role] && typeof task[role] === 'object'
      ? task[role].conversationId : '';
    return compactInline(nested || task[`${role}ConversationId`] || '');
  }

  function findTaskSupersessions(tasksValue) {
    const tasks = (Array.isArray(tasksValue) ? tasksValue : [])
      .filter(task => task && typeof task === 'object')
      .map(normalizeTaskRecord);
    const supersessions = new Map();

    for (const successor of tasks) {
      const successorOrigin = taskConversationId(successor, 'origin');
      const successorCreatedAt = Number(successor.createdAt || successor.updatedAt || 0);
      for (const predecessor of tasks) {
        if (!predecessor.taskId || predecessor.taskId === successor.taskId) continue;
        if (predecessor.status !== TASK_STATES.PENDING) continue;
        const predecessorOrigin = taskConversationId(predecessor, 'origin');
        if (!successorOrigin || successorOrigin !== predecessorOrigin) continue;
        if (successorCreatedAt <= Number(predecessor.createdAt || predecessor.updatedAt || 0)) continue;

        const explicitlyLinked = compactInline(successor.supersedesTaskId) === predecessor.taskId;
        // Schema-v1 replacement tasks did not have a structured predecessor field. Recover only an
        // exact machine task ID embedded in the successor objective; this is format parsing, not
        // natural-language or title-similarity inference.
        const legacyExactLink = !explicitlyLinked
          && predecessor.taskId.startsWith('task_')
          && compactWhitespace(successor.objective).includes(predecessor.taskId);
        if (!explicitlyLinked && !legacyExactLink) continue;

        const existing = supersessions.get(predecessor.taskId);
        if (!existing || successorCreatedAt > Number(existing.supersedingTask.createdAt || 0)) {
          supersessions.set(predecessor.taskId, {
            task: predecessor,
            supersedingTask: successor,
            source: explicitlyLinked ? 'structured' : 'legacy_exact_task_id'
          });
        }
      }
    }
    return [...supersessions.values()];
  }

  function filterSupersededTasks(tasksValue) {
    const tasks = (Array.isArray(tasksValue) ? tasksValue : [])
      .filter(task => task && typeof task === 'object')
      .map(normalizeTaskRecord);
    const supersededIds = new Set([
      ...tasks
        .filter(task => compactInline(task.supersededByTaskId))
        .map(task => task.taskId),
      ...findTaskSupersessions(tasks).map(item => item.task.taskId)
    ]);
    return tasks.filter(task => !supersededIds.has(task.taskId));
  }

  function selectSupervisedTask(tasksValue, viewingConversationIdValue, activeTaskIdValue = '', options = {}) {
    const viewingConversationId = compactInline(viewingConversationIdValue);
    const activeTaskId = compactInline(activeTaskIdValue);
    const delegatedOnly = options.delegatedOnly === true;
    const allTasks = filterSupersededTasks(tasksValue);
    const tasks = allTasks.filter(task => {
        if (!viewingConversationId) return false;
        const originConversationId = taskConversationId(task, 'origin');
        const targetConversationId = taskConversationId(task, 'target');
        if (delegatedOnly) {
          return originConversationId === viewingConversationId
            && !!targetConversationId
            && targetConversationId !== viewingConversationId;
        }
        return targetConversationId === viewingConversationId
          || (originConversationId === viewingConversationId
            && !!targetConversationId
            && targetConversationId !== viewingConversationId);
      });
    const byNewest = (a, b) => Number(b.updatedAt || b.createdAt || 0)
      - Number(a.updatedAt || a.createdAt || 0)
      || compactInline(a.taskId).localeCompare(compactInline(b.taskId));
    const preferred = activeTaskId
      ? tasks.find(task => compactInline(task.taskId) === activeTaskId)
      : null;
    const active = tasks.filter(task => task.status === TASK_STATES.ACTIVE).sort(byNewest)[0];
    const pending = tasks.filter(task => task.status === TASK_STATES.PENDING).sort(byNewest)[0];
    // `activeTaskId` comes from a live run snapshot, not from the durable store transaction that
    // creates/claims the next specialist task. During that handoff boundary it can briefly name a
    // terminal predecessor. Never let that stale preference paint the visible conversation FAILED
    // or COMPLETE while newer durable work is pending/active. It remains a valid preference only
    // while it is itself nonterminal, or as terminal history when no ongoing mission exists.
    let selected = (preferred && [TASK_STATES.ACTIVE, TASK_STATES.PENDING].includes(preferred.status))
      ? preferred
      : (active || pending || preferred)
      || tasks.sort(byNewest)[0]
      || null;
    if (!selected || options.followDescendants !== true) return selected;

    // The visible Dispatch conversation owns the root task, while Coder/Operator descendants are
    // owned by their immediate specialist conversations. Follow the durable lineage instead of
    // requiring every descendant to pretend Dispatch is its direct origin. This keeps the phone
    // on the task that is actually executing through arbitrarily deep specialist handoffs.
    const visited = new Set();
    while (selected && !visited.has(selected.taskId)) {
      visited.add(selected.taskId);
      const delegatedChildId = compactInline(selected.delegation && selected.delegation.childTaskId);
      const children = allTasks.filter(task =>
        compactInline(task.parentTaskId) === compactInline(selected.taskId)
        || (delegatedChildId && compactInline(task.taskId) === delegatedChildId)
      );
      if (!children.length) break;
      const child = children.filter(task => task.status === TASK_STATES.ACTIVE).sort(byNewest)[0]
        || children.filter(task => task.status === TASK_STATES.PENDING).sort(byNewest)[0]
        || children.sort(byNewest)[0];
      if (!child) break;
      selected = child;
    }
    return selected;
  }

  function pendingTaskNeedsRuntimeQueue(taskValue) {
    if (!taskValue || taskValue.status !== TASK_STATES.PENDING) return false;
    const execution = taskValue.execution && typeof taskValue.execution === 'object'
      ? taskValue.execution
      : {};
    const attempt = Math.max(0, Number(execution.attempt) || 0);
    if (attempt === 0) return true;
    return compactInline(execution.resumePolicy).toLowerCase() === 'automatic';
  }

  function describeSupervisedTaskPresentation(taskValue, context = {}) {
    if (!taskValue || typeof taskValue !== 'object') {
      return {
        taskId: '',
        status: '',
        phase: 'idle',
        label: 'Idle',
        detail: '',
        agentState: 'Ready',
        badgeClass: 'muted',
        isOngoing: false
      };
    }
    // Real bug: this used to read the status through normalizeTransitionStatus, which is a
    // STRICT validator meant for approving/rejecting an actual state transition (it deliberately
    // throws on anything it doesn't recognize) - not a display helper. A task object built before
    // it round-trips through the store's own normalization (e.g. the manually-constructed
    // fallback child-task record agent.js builds immediately after a handoff commits, before the
    // canonical persisted record is what's actually shown) can legitimately have no `status`
    // field yet. That threw here, and the catch defaulted straight to TASK_STATES.FAILED - so a
    // task that was merely still being wired up got presented as "Failed" the instant it was
    // queued, before it had done any work, let alone failed at any. Presentation should never
    // assume the worst just because a status string is momentarily missing or unrecognized; use
    // the lenient normalizeStatus (already used when persisting/reading real task records
    // elsewhere in this file), which defaults an unrecognized value to PENDING instead of FAILED.
    const status = normalizeStatus(taskValue.status);
    const awaitingReview = context.awaitingReview === true || taskValue.awaitingReview === true;
    const revisingPlan = context.revisingPlan === true || taskValue.revisingPlan === true;
    const planApproved = context.planApproved === true || taskValue.planApproved === true;
    const resumePolicy = compactInline(
      context.resumePolicy
      || taskValue.execution && taskValue.execution.resumePolicy
      || ''
    ).toLowerCase();
    const reasonCode = compactInline(
      context.reasonCode
      || taskValue.execution && taskValue.execution.reasonCode
      || ''
    ).toLowerCase();
    const executionMode = compactInline(context.executionMode || taskValue.executionMode).toLowerCase();
    const subStatus = compactWhitespace(context.subStatus || taskValue.subStatus || '');
    const verifying = status === TASK_STATES.ACTIVE
      && (/verif|test/.test(executionMode) || /run_tests|test|verif/i.test(subStatus));
    const roleMode = compactInline(
      context.roleMode
      || taskValue.target && taskValue.target.mode
      || ''
    ).toLowerCase();
    const registeredRole = SpecialistRegistry && SpecialistRegistry.get(roleMode);
    const roleLabel = compactWhitespace(context.roleLabel || taskValue.roleLabel || '')
      || (registeredRole && registeredRole.label)
      || 'Specialist';
    const operatorTask = roleMode === 'operator' || roleLabel.toLowerCase() === 'operator';
    const operatorControlling = operatorTask
      && (subStatus.startsWith('Operator is controlling') || subStatus.startsWith('Operator is opening'));
    const operatorObserving = operatorTask
      && (subStatus.startsWith('Operator is observing') || subStatus.startsWith('Operator is inspecting'));

    let phase = status;
    let label;
    let detail = subStatus;
    let agentState;
    let badgeClass;
    if (awaitingReview && (status === TASK_STATES.PENDING || status === TASK_STATES.ACTIVE)) {
      phase = 'review';
      label = 'Review';
      detail = detail || `${roleLabel}’s implementation plan is ready for approval.`;
      agentState = 'Review';
      badgeClass = 'warning';
    } else if (revisingPlan && (status === TASK_STATES.PENDING || status === TASK_STATES.ACTIVE)) {
      phase = 'revising-plan';
      label = `${roleLabel} revising plan`;
      detail = detail || `${roleLabel} is applying your feedback and preparing a revised implementation plan.`;
      agentState = `${roleLabel} revising`;
      badgeClass = 'success';
    } else if (status === TASK_STATES.PENDING && reasonCode === 'awaiting_delegated_task') {
      const childRoleMode = compactInline(taskValue.delegation && taskValue.delegation.childRole).toLowerCase();
      const childRoleRecord = SpecialistRegistry && SpecialistRegistry.get(childRoleMode);
      const childRole = childRoleRecord && childRoleRecord.label
        || (childRoleMode === 'operator' ? 'Operator' : (childRoleMode === 'coder' ? 'Coder' : 'Specialist'));
      phase = 'delegated';
      label = `${childRole} active`;
      detail = detail || `${roleLabel} is waiting for ${childRole} to return the delegated result.`;
      agentState = `${childRole} active`;
      badgeClass = childRoleMode === 'operator' ? 'operator' : 'success';
    } else if (status === TASK_STATES.PENDING && (reasonCode === 'scheduled_followup' || resumePolicy === 'scheduled')) {
      const scheduledAt = Number(
        taskValue.checkpoint
        && taskValue.checkpoint.schedule
        && (taskValue.checkpoint.schedule.nextRunAt || taskValue.checkpoint.schedule.dueAt)
      ) || 0;
      phase = 'scheduled-followup';
      label = `${roleLabel} waiting`;
      detail = detail || (scheduledAt
        ? `Waiting for the scheduled follow-up at ${new Date(scheduledAt).toLocaleString()}.`
        : 'Waiting for the scheduled follow-up.');
      agentState = 'Waiting';
      badgeClass = 'warning';
    } else if (status === TASK_STATES.PENDING && reasonCode === 'awaiting_plan_approval') {
      phase = 'review';
      label = 'Review';
      detail = detail || `${roleLabel}'s implementation plan is ready for approval.`;
      agentState = 'Review';
      badgeClass = 'warning';
    } else if (status === TASK_STATES.PENDING && ['awaiting_clarification', 'awaiting_input'].includes(reasonCode)) {
      phase = 'awaiting-input';
      label = 'Input needed';
      detail = detail || `${roleLabel} is waiting for your answer.`;
      agentState = 'Input needed';
      badgeClass = 'warning';
    } else if (status === TASK_STATES.PENDING && resumePolicy === 'automatic') {
      phase = 'continuing';
      label = `${roleLabel} continuing`;
      detail = detail || `${roleLabel} checkpointed its progress and is starting the next pass automatically.`;
      agentState = `${roleLabel} continuing`;
      badgeClass = 'success';
    } else if (status === TASK_STATES.PENDING) {
      phase = 'queued';
      label = `${roleLabel} queued`;
      detail = detail || `Waiting for ${roleLabel} to claim this task.`;
      agentState = `${roleLabel} queued`;
      badgeClass = 'warning';
    } else if (status === TASK_STATES.ACTIVE && operatorControlling) {
      phase = 'controlling-screen';
      label = 'Operator controlling';
      detail = detail || 'Operator is controlling the desktop for this task.';
      agentState = 'Operator active';
      badgeClass = 'operator';
    } else if (status === TASK_STATES.ACTIVE && operatorObserving) {
      phase = 'observing-screen';
      label = 'Operator observing';
      detail = detail || 'Operator is inspecting the visible desktop state.';
      agentState = 'Operator active';
      badgeClass = 'operator';
    } else if (status === TASK_STATES.ACTIVE && operatorTask) {
      phase = 'operator-active';
      label = 'Operator active';
      detail = detail || 'Operator is working through the visible desktop task.';
      agentState = 'Operator active';
      badgeClass = 'operator';
    } else if (status === TASK_STATES.ACTIVE && verifying) {
      phase = 'verifying';
      label = `${roleLabel} verifying`;
      detail = detail || `${roleLabel} is verifying the implementation.`;
      agentState = `${roleLabel} verifying`;
      badgeClass = 'success';
    } else if (status === TASK_STATES.ACTIVE && planApproved) {
      phase = 'implementing';
      label = `${roleLabel} implementing`;
      detail = detail || `${roleLabel} is implementing the approved plan.`;
      agentState = `${roleLabel} implementing`;
      badgeClass = 'success';
    } else if (status === TASK_STATES.ACTIVE) {
      phase = 'planning';
      label = `${roleLabel} planning`;
      detail = detail || `${roleLabel} is inspecting the workspace and preparing the plan.`;
      agentState = `${roleLabel} planning`;
      badgeClass = 'success';
    } else if (status === TASK_STATES.COMPLETED) {
      label = 'Completed';
      detail = detail || `${roleLabel} recorded this task as completed.`;
      agentState = 'Complete';
      badgeClass = 'success';
    } else if (status === TASK_STATES.CANCELLED) {
      label = 'Cancelled';
      detail = detail || `This ${roleLabel} task was cancelled.`;
      agentState = 'Cancelled';
      badgeClass = 'muted';
    } else {
      label = 'Failed';
      detail = detail || `${roleLabel} recorded this task as failed.`;
      agentState = 'Failed';
      badgeClass = 'danger';
    }
    return {
      taskId: compactInline(taskValue.taskId),
      status,
      phase,
      label,
      detail,
      agentState,
      badgeClass,
      isOngoing: status === TASK_STATES.PENDING || status === TASK_STATES.ACTIVE
    };
  }

  function resolvePhoneConversationPresentation(input = {}) {
    const conversationRunning = input.conversationRunning === true;
    const awaitingPlanApproval = input.awaitingPlanApproval === true;
    const supervisedPresentation = input.supervisedPresentation
      && typeof input.supervisedPresentation === 'object'
      ? input.supervisedPresentation
      : null;
    const subStatus = compactWhitespace(input.subStatus || '');
    const executionMode = compactInline(input.executionMode || '').toLowerCase();
    const liveRole = compactInline(input.liveRole || '').toLowerCase();
    const liveAgentState = /run_tests|test|verif/i.test(subStatus)
      ? 'Verifying'
      : (/running tool/i.test(subStatus) || executionMode === 'executing' || executionMode === 'direct'
        ? 'Acting'
        : 'Thinking');
    const agentState = conversationRunning
      ? (liveRole === 'operator' ? 'Operator active' : liveAgentState)
      : (awaitingPlanApproval
        ? 'Review'
        : (supervisedPresentation ? supervisedPresentation.agentState : 'Ready'));
    const useSupervisedTaskCard = !!(
      supervisedPresentation
      && (supervisedPresentation.isOngoing || !conversationRunning)
    );
    return {
      agentState,
      detail: conversationRunning
        ? (subStatus || text(input.workspace))
        : (supervisedPresentation
          ? supervisedPresentation.detail
          : (subStatus || text(input.workspace))),
      isRunning: conversationRunning || !!(supervisedPresentation && supervisedPresentation.isOngoing),
      useSupervisedTaskCard
    };
  }

  async function cancelPendingOwnedTasks(input = {}, dependencies = {}) {
    const conversationId = compactInline(input.conversationId || input.ownerConversationId || '');
    if (!conversationId) return { success: true, cancelled: [], failures: [], count: 0 };
    if (typeof dependencies.listTasks !== 'function' || typeof dependencies.cancelTask !== 'function') {
      return {
        success: false,
        cancelled: [],
        failures: [{ taskId: '', error: 'Task-store cancellation services are unavailable.' }],
        count: 0
      };
    }
    let tasks;
    try {
      tasks = await dependencies.listTasks(conversationId, [TASK_STATES.PENDING]);
      if (!Array.isArray(tasks)) throw new Error('Task-store listing returned an invalid result.');
    } catch (error) {
      return {
        success: false,
        cancelled: [],
        failures: [{ taskId: '', error: error.message || String(error) }],
        count: 0
      };
    }
    const cancelled = [];
    const failures = [];
    for (const task of tasks) {
      const taskId = compactInline(task && task.taskId);
      if (!taskId || !canRequesterControlTask(task, { conversationId })) {
        failures.push({ taskId, error: 'The pending task is not owned by this conversation.' });
        continue;
      }
      try {
        const result = await dependencies.cancelTask(taskId, conversationId);
        if (result && result.success && result.task && result.task.status === TASK_STATES.CANCELLED) {
          cancelled.push(taskId);
        } else {
          failures.push({
            taskId,
            error: (result && (result.error || result.reason)) || 'Cancellation was not confirmed.'
          });
        }
      } catch (error) {
        failures.push({ taskId, error: error.message || String(error) });
      }
    }
    return { success: failures.length === 0, cancelled, failures, count: cancelled.length };
  }

  return {
    SCHEMA_VERSION,
    TASK_STATES,
    normalizeTransitionStatus,
    normalizeExecutionProfile,
    isContextDependentRequest,
    isContinuationRequest,
    deriveTaskTitle: titleFromObjective,
    isRegisteredTaskTarget,
    describeRegisteredTaskTargets,
    joinAsEnglishList,
    MAX_DELEGATION_DEPTH,
    evaluateDelegationHandoff,
    buildTaskPacket,
    normalizeTaskRecord,
    transitionTask,
    canRequesterControlTask,
    findTaskSupersessions,
    filterSupersededTasks,
    selectOwnedContinuationTask,
    cancelPendingOwnedTasks,
    renderTaskPrompt,
    describeTaskStatus,
    pendingTaskNeedsRuntimeQueue,
    selectSupervisedTask,
    describeSupervisedTaskPresentation,
    resolvePhoneConversationPresentation
  };
});
