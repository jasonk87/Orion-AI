(function initSupervisorOrchestration(globalScope) {
  'use strict';

  function classifySupervisorIntent(value) {
    const classification = value && typeof value === 'object' ? value : {};
    if (classification.intent === 'status_check') return 'checkin';
    if (classification.intent === 'steer_active_task') return 'steering';
    return 'conversational';
  }

  function compactConversation(conversation, excludedMessageId) {
    const excluded = String(excludedMessageId || '');
    return {
      id: String((conversation && conversation.id) || ''),
      title: String((conversation && conversation.title) || ''),
      mode: String((conversation && conversation.mode) || ''),
      workspace: String((conversation && conversation.workspace) || ''),
      projectPath: String((conversation && (conversation.projectPath || conversation.dispatchProjectPath)) || ''),
      updatedAt: (conversation && (conversation.updatedAt || conversation.createdAt)) || 0,
      messages: (conversation && Array.isArray(conversation.messages) ? conversation.messages : [])
        .filter(message => !excluded || String(message && (message.id || message.messageId) || '') !== excluded)
        .slice(-30)
        .map((message, index) => ({
          id: String(message.id || `${conversation.id || 'conversation'}-${index}`),
          role: String(message.role || ''),
          text: String(message.text || message.content || '').slice(0, 5000),
          createdAt: message.createdAt || 0
        }))
    };
  }

  function buildEvidenceSearchPayload({ conversation, prompt, messageId, workspacePaths = [] } = {}) {
    const query = String(prompt || '');
    return {
      query,
      recentContext: (conversation && Array.isArray(conversation.messages) ? conversation.messages : [])
        .slice(-12)
        .map(message => String(message && (message.text || message.content) || ''))
        .filter(Boolean),
      currentConversation: compactConversation(conversation, messageId),
      excludeConversationId: String((conversation && conversation.id) || ''),
      excludeMessageIds: messageId ? [String(messageId)] : [],
      excludeUserPrompt: query,
      workspacePaths: [...new Set((Array.isArray(workspacePaths) ? workspacePaths : []).map(String).filter(Boolean))],
      limit: 8
    };
  }

  function formatEvidence(searchResult) {
    const evidence = searchResult && Array.isArray(searchResult.evidence) ? searchResult.evidence : [];
    if (!evidence.length) return '';
    const lines = evidence.slice(0, 8).map((item, index) => {
      const provenance = [item.sourceKind || 'conversation', item.role || '', item.timestamp || ''].filter(Boolean).join('/');
      return `${index + 1}. [${provenance}] ${String(item.excerpt || item.text || item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 1400)}`;
    });
    return `[RETRIEVED CONVERSATION EVIDENCE]\nUse only these retrieved excerpts for claims about prior conversations. Do not fill gaps with a plausible reconstruction.\n\n${lines.join('\n')}`;
  }

  function memoryText(memory) {
    if (!memory || typeof memory !== 'object') return '';
    return [
      ...(Array.isArray(memory.facts) ? memory.facts : []),
      ...(Array.isArray(memory.decisions) ? memory.decisions : []),
      ...(Array.isArray(memory.preferences) ? memory.preferences : [])
    ].map(value => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object') return '';
      return String(value.text || value.content || value.fact || value.decision || value.preference || '');
    }).filter(Boolean).join('\n');
  }

  function normalizedEntity(value) {
    return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  }

  function usableProject(project, workspaceResolution, searchRoot) {
    const path = String(project && (project.path || project.projectPath || project.workspace) || '').trim();
    return !!(path && (!searchRoot || !workspaceResolution.samePath(path, searchRoot)));
  }

  /**
   * Resolve a project reference without turning the generic Projects directory into a project.
   *
   * Resolution order is deliberate: registered/current and recent conversation bindings are
   * trusted first, then the configured search root is inspected, and project memory is used only
   * as supporting evidence when a directory name alone does not identify the requested project.
   */
  async function resolveNamedProjectWorkspace(input = {}, dependencies = {}) {
    const workspaceResolution = dependencies.workspaceResolution;
    if (!workspaceResolution) {
      return {
        resolution: input.currentResolution || null,
        project: null,
        namedReference: '',
        searchedFilesystem: false,
        searchedMemory: false
      };
    }

    const prompt = String(input.prompt || '');
    const searchRoot = String(input.searchRoot || '').trim();
    const references = workspaceResolution.extractProjectReferences(prompt) || [];
    const currentResolution = input.currentResolution || workspaceResolution.classifyWorkspace({
      mode: input.mode,
      workspacePath: input.workspacePath,
      projectPath: input.projectPath,
      dispatchProjectPath: input.dispatchProjectPath,
      searchRoot,
      standaloneRoot: input.standaloneRoot,
      knownProjects: input.registeredProjects
    });
    const trustedCandidates = [
      ...(Array.isArray(input.registeredProjects) ? input.registeredProjects : []),
      ...(Array.isArray(input.recentProjects) ? input.recentProjects : []),
      ...(Array.isArray(input.conversationProjects) ? input.conversationProjects : [])
    ].filter(candidate => usableProject(candidate, workspaceResolution, searchRoot));

    let project = workspaceResolution.findNamedProject(prompt, trustedCandidates);
    if (project) {
      return {
        resolution: workspaceResolution.bindResolvedProject(currentResolution, project, project.source || 'known_project'),
        project,
        namedReference: references[0] || project.name || '',
        searchedFilesystem: false,
        searchedMemory: false
      };
    }

    // There is no named project to resolve. Preserve the current classification instead of
    // scanning Projects or implying that a workspace change occurred.
    if (!references.length || !searchRoot || typeof dependencies.listDirectoryChildren !== 'function') {
      return {
        resolution: currentResolution,
        project: null,
        namedReference: references[0] || '',
        searchedFilesystem: false,
        searchedMemory: false
      };
    }

    let directoryCandidates = [];
    try {
      const listed = await dependencies.listDirectoryChildren(searchRoot);
      if (Array.isArray(listed)) {
        directoryCandidates = listed
          .filter(entry => entry && entry.isDir !== false && usableProject(entry, workspaceResolution, searchRoot))
          .map(entry => ({ ...entry, source: entry.source || 'projects_directory' }));
      }
    } catch (_) {
      directoryCandidates = [];
    }

    project = workspaceResolution.findNamedProject(prompt, directoryCandidates);
    if (project) {
      return {
        resolution: workspaceResolution.bindResolvedProject(currentResolution, project, 'projects_directory'),
        project,
        namedReference: references[0] || project.name || '',
        searchedFilesystem: true,
        searchedMemory: false
      };
    }

    if (typeof dependencies.readProjectMemory !== 'function' || !directoryCandidates.length) {
      return {
        resolution: currentResolution,
        project: null,
        namedReference: references[0] || '',
        searchedFilesystem: true,
        searchedMemory: false
      };
    }

    const referenceKeys = references.map(normalizedEntity).filter(key => key.length >= 3);
    const memoryMatches = [];
    const maxCandidates = Math.max(1, Math.min(Number(input.maxMemoryCandidates) || 40, 80));
    for (const candidate of directoryCandidates.slice(0, maxCandidates)) {
      try {
        const memory = await dependencies.readProjectMemory(candidate.path);
        const contentKey = normalizedEntity(memoryText(memory));
        if (contentKey && referenceKeys.some(key => contentKey.includes(key))) {
          memoryMatches.push({ ...candidate, source: 'project_memory' });
        }
      } catch (_) {
        // One unreadable project memory must not block resolution through the other candidates.
      }
    }

    if (memoryMatches.length === 1) {
      project = memoryMatches[0];
      return {
        resolution: workspaceResolution.bindResolvedProject(currentResolution, project, 'project_memory'),
        project,
        namedReference: references[0] || project.name || '',
        searchedFilesystem: true,
        searchedMemory: true
      };
    }

    return {
      resolution: currentResolution,
      project: null,
      namedReference: references[0] || '',
      searchedFilesystem: true,
      searchedMemory: true
    };
  }

  async function buildContractedConversationalReply(input = {}, dependencies = {}) {
    const contracts = dependencies.contracts;
    const conversation = input.conversation || {};
    const prompt = String(input.prompt || '');
    const semanticIntent = input.semanticIntent && typeof input.semanticIntent === 'object'
      ? input.semanticIntent
      : {};
    const memoryIntent = String(semanticIntent.memoryIntent || 'none');
    const recallRequested = memoryIntent === 'conversation_recall';
    const memoryPolicyQuestion = memoryIntent === 'memory_policy';
    const suppliedStatuses = Array.isArray(input.structuredStatuses) ? input.structuredStatuses : [];
    const extractedStatuses = contracts
      ? contracts.extractStructuredStatusFacts([prompt, input.statusText || ''].filter(Boolean).join('\n'))
      : [];
    const statuses = suppliedStatuses.length
      ? (contracts && typeof contracts.mergeStructuredStatusFacts === 'function'
          ? contracts.mergeStructuredStatusFacts(extractedStatuses, suppliedStatuses)
          : [...extractedStatuses, ...suppliedStatuses])
      : extractedStatuses;
    let searchResult = { success: false, evidence: [], queryTerms: [] };
    if (recallRequested && typeof dependencies.retrieveEvidence === 'function') {
      searchResult = await dependencies.retrieveEvidence(buildEvidenceSearchPayload({
        conversation,
        prompt,
        messageId: input.messageId,
        workspacePaths: input.workspacePaths
      }));
      if (!searchResult || typeof searchResult !== 'object') {
        searchResult = { success: false, evidence: [], queryTerms: [] };
      }
    }
    const evidence = Array.isArray(searchResult.evidence) ? searchResult.evidence : [];
    const evidencePrompt = formatEvidence(searchResult);
    const systemPrompt = [
      String(input.systemPrompt || ''),
      recallRequested
        ? (evidencePrompt || '[MEMORY RETRIEVAL RESULT]\nNo relevant prior-conversation evidence was retrieved. Say so plainly and label any reasoning as inference.')
        : '',
      memoryPolicyQuestion && contracts && typeof contracts.buildMemoryPolicyContext === 'function'
        ? contracts.buildMemoryPolicyContext()
        : '',
      statuses.length
        ? `[STRUCTURED STATUS FACTS]\n${JSON.stringify(statuses)}\nPreserve these exact states; mergeable is not merged, queued is not running, cancelled is not completed, and reported/mock results are not independently verified.`
        : ''
    ].filter(Boolean).join('\n\n');
    const generationMessages = Array.isArray(input.messages)
      ? input.messages.map(message => ({ ...message }))
      : [];
    const lastGenerationMessage = generationMessages[generationMessages.length - 1];
    const lastGenerationText = String(
      lastGenerationMessage && (lastGenerationMessage.content || lastGenerationMessage.text) || ''
    ).trim();
    if (prompt.trim() && !(
      lastGenerationMessage
      && lastGenerationMessage.role === 'user'
      && lastGenerationText === prompt.trim()
    )) {
      // Historical context is optional, but the exact active user turn is not. Keeping this
      // requirement inside the shared contract prevents any caller from invoking the
      // conversational model with only a system prompt.
      generationMessages.push({ role: 'user', content: prompt });
    }
    const rawReply = await dependencies.generateReply(systemPrompt, generationMessages);
    let text = String(rawReply || '').trim();

    // A follow-up must get a new answer. Asked "why that one over these others?", a model on a
    // low reasoning budget will often re-emit its previous message nearly verbatim — responsive
    // in shape, useless in substance. One regeneration with the restatement named explicitly is
    // enough to break it; a second would just burn tokens, so this never loops.
    const priorAssistantText = (() => {
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message || (message.role !== 'assistant' && message.role !== 'model')) continue;
        const value = String(message.text || message.content || '').trim();
        if (value && value !== 'Thinking...') return value;
      }
      return '';
    })();
    let restated = false;
    if (contracts && typeof contracts.isRestatementOfPrevious === 'function'
        && priorAssistantText && contracts.isRestatementOfPrevious(text, priorAssistantText)) {
      restated = true;
      const retryMessages = [
        ...generationMessages,
        { role: 'assistant', content: text },
        { role: 'user', content: contracts.buildRestatementCorrectionPrompt(prompt) }
      ];
      const retryReply = await dependencies.generateReply(systemPrompt, retryMessages);
      const retryText = String(retryReply || '').trim();
      // Only accept the retry if it actually stopped restating; otherwise the original at least
      // answers in the user's own terms rather than being replaced by a second copy.
      if (retryText && !contracts.isRestatementOfPrevious(retryText, priorAssistantText)) {
        text = retryText;
      }
    }
    if (contracts && (recallRequested || (!memoryPolicyQuestion && contracts.hasExplicitRecallClaim(text)))) {
      const validation = contracts.validateMemoryResponse(text, {
        conversationEvidence: evidence,
        recallRequested
      });
      if (!validation.valid) text = contracts.buildEvidenceBackedRecallFallback(evidence);
    }
    if (contracts && statuses.length) {
      const statusValidation = contracts.validateStatusResponse(text, statuses);
      if (!statusValidation.valid) text = contracts.enforceStatusFallback(text, statuses);
    }
    const responseBasis = contracts
      ? contracts.createResponseBasis({
          conversationEvidence: evidence,
          projectKnowledge: input.projectKnowledge === true,
          generalInference: typeof input.generalInference === 'boolean'
            ? input.generalInference
            : (evidence.length === 0 && input.projectKnowledge !== true && statuses.length === 0),
          structuredStatuses: statuses
        })
      : null;
    return { text, responseBasis, searchResult, recallRequested, statuses, restated };
  }

  async function handleSupervisorMessage(input = {}, dependencies = {}) {
    const prompt = String(input.prompt || '');
    const classification = input.semanticIntent && typeof input.semanticIntent === 'object'
      ? input.semanticIntent
      : (typeof dependencies.classifyIntent === 'function'
          ? await dependencies.classifyIntent(input)
          : {
              intent: 'clarification_required',
              needsClarification: true,
              clarificationQuestion: 'What would you like me to do with the active task?'
            });

    if (classification.intent === 'clarification_required' || classification.needsClarification === true) {
      return typeof dependencies.askClarification === 'function'
        ? dependencies.askClarification(classification.clarificationQuestion)
        : { success: false, needsClarification: true, clarification: classification.clarificationQuestion };
    }
    if (classification.intent === 'cancel_active_task') {
      return dependencies.cancelOwnedTask(classification);
    }
    if (classification.intent === 'new_task') {
      return dependencies.enqueueTask(classification);
    }
    if (classification.intent === 'context_followup') {
      if (classification.target === 'active_owned_task') {
        return dependencies.steerActiveTask({ prompt, classification, reason: 'context_followup' });
      }
      return dependencies.enqueueTask(classification);
    }
    if (classification.intent === 'steer_active_task') {
      return dependencies.steerActiveTask({ prompt, classification, reason: 'explicit_steering' });
    }
    if (['approve_plan', 'deny_plan', 'revise_plan'].includes(classification.intent)
      && typeof dependencies.handlePlanIntent === 'function') {
      return dependencies.handlePlanIntent(classification);
    }
    const intent = classifySupervisorIntent(classification);
    if (intent === 'checkin') return dependencies.respondCheckin();
    if (intent === 'steering') return dependencies.steerActiveTask({ prompt, classification, reason: 'explicit_steering' });
    return dependencies.respondConversationally();
  }

  const api = {
    classifySupervisorIntent,
    buildEvidenceSearchPayload,
    resolveNamedProjectWorkspace,
    buildContractedConversationalReply,
    handleSupervisorMessage
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionSupervisorOrchestration = api;
})(typeof window !== 'undefined' ? window : globalThis);
