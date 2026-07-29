const test = require('tape');
const supervisor = require('../supervisor-orchestration');
const taskContracts = require('../task-orchestration');
const contracts = require('../orchestration-contracts');
const workspaceResolution = require('../workspace-resolution');

function handlerDependencies(overrides = {}) {
  return {
    taskContracts,
    cancelOwnedTask: async () => ({ success: true, status: 'cancelled' }),
    enqueueTask: async () => ({ success: true, status: 'pending' }),
    steerActiveTask: async () => ({ success: true, steered: true }),
    respondCheckin: async () => ({ success: true, status: 'active' }),
    respondConversationally: async () => ({ success: true, conversational: true }),
    ...overrides
  };
}

test('supervised Dispatch resolves a contextual approval through the durable task path', async t => {
  let packetResult;
  let conversationalCalls = 0;
  let steeringCalls = 0;
  const precedingMessages = [
    {
      role: 'user',
      text: 'For GRITLIFE, replace or evolve intent with recurring subscriptions and enrollments organized by locations: Body & Physical, Medical, Community, Education, and Work. Include gyms, yoga, massages, therapy, clubs, classes, recurring costs, and benefits.'
    },
    {
      role: 'assistant',
      text: 'That can merge or derive the existing Grind, Connect, and Survive intent behavior. I can implement this direction.'
    }
  ];
  const semanticIntent = {
    intent: 'context_followup',
    target: 'current_conversation',
    requiresExecution: true,
    contextDependent: true,
    resolvedRequest: 'Design and implement recurring GRITLIFE subscriptions and enrollments organized by Body & Physical, Medical, Community, Education, and Work locations. Include gyms, yoga, massages, therapy, clubs, classes, recurring costs, and benefits. Evaluate how this replaces, merges with, or derives Grind, Connect, and Survive.',
    needsClarification: false,
    taskResolution: {
      title: 'GRITLIFE location enrollments',
      requirements: ['Support recurring costs and benefits.'],
      constraints: [],
      unresolvedDecisions: ['Evaluate the relationship to Grind, Connect, and Survive.']
    }
  };
  const result = await supervisor.handleSupervisorMessage({
    prompt: "Let's do it",
    semanticIntent
  }, handlerDependencies({
    enqueueTask: async classification => {
      packetResult = taskContracts.buildTaskPacket({
        originalUserMessage: "Let's do it",
        semanticIntent: classification,
        precedingMessages,
        workspace: {
          role: 'active_project',
          path: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
          project: {
            name: 'GRITLIFE',
            path: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'
          },
          resolved: true
        },
        origin: { conversationId: 'dispatch-1', sessionId: 'dispatch-1', messageId: 'message-3' },
        target: { conversationId: 'dispatch-1', sessionId: 'dispatch-1', mode: 'orion' }
      });
      return packetResult;
    },
    respondConversationally: async () => {
      conversationalCalls += 1;
    },
    steerActiveTask: async () => {
      steeringCalls += 1;
    }
  }));

  t.equal(result.success, true, 'the supervised handler creates a resolvable task');
  t.equal(conversationalCalls, 0, 'the contextual approval is not consumed as casual conversation');
  t.equal(steeringCalls, 0, 'the raw phrase is not injected into the active Coder');
  t.equal(packetResult.task.originalUserMessage, "Let's do it", 'the raw phrase survives only as provenance');
  t.equal(packetResult.task.workspacePath, 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE', 'the exact project workspace is durable');
  t.match(packetResult.task.objective, /subscriptions|enrollments/i, 'the resolved objective carries the preceding concept');
  t.end();
});

test('unresolvable contextual supervised requests clarify instead of steering', async t => {
  let steerCalls = 0;
  const result = await supervisor.handleSupervisorMessage({
    prompt: 'Use the second one',
    semanticIntent: {
      intent: 'clarification_required',
      target: 'current_conversation',
      contextDependent: true,
      requiresExecution: false,
      resolvedRequest: '',
      needsClarification: true,
      clarificationQuestion: 'Which second option do you mean?'
    }
  }, handlerDependencies({
    enqueueTask: async () => taskContracts.buildTaskPacket({
      originalUserMessage: 'Use the second one',
      precedingMessages: [],
      workspace: {
        role: 'active_project',
        path: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE',
        project: { name: 'GRITLIFE', path: 'C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE' },
        resolved: true
      }
    }),
    steerActiveTask: async () => {
      steerCalls += 1;
    }
  }));

  t.equal(result.success, false, 'the unresolved reference is rejected');
  t.equal(result.needsClarification, true, 'a targeted clarification is requested');
  t.equal(steerCalls, 0, 'the ambiguous phrase is never injected into active work');
  t.end();
});

test('supervised Dispatch distinguishes direct execution from quoted status material', async t => {
  let steeringCalls = 0;
  let conversationCalls = 0;
  const deps = handlerDependencies({
    steerActiveTask: async () => {
      steeringCalls += 1;
      return { success: true, steered: true };
    },
    respondConversationally: async () => {
      conversationCalls += 1;
      return { success: true, conversational: true };
    }
  });
  await supervisor.handleSupervisorMessage({
    prompt: 'Can you kill Claude and restart it again?',
    semanticIntent: {
      intent: 'steer_active_task',
      target: 'active_owned_task',
      requiresExecution: true,
      resolvedRequest: 'Identify the correct Claude process, restart it, and verify the replacement.',
      contextDependent: false,
      needsClarification: false
    }
  }, deps);
  await supervisor.handleSupervisorMessage({
    prompt: 'The exact request:\n> Can you kill Claude and restart it again?\nis now covered by tests and the fix was pushed.',
    semanticIntent: {
      intent: 'conversation',
      target: 'current_conversation',
      requiresExecution: false,
      resolvedRequest: '',
      contextDependent: false,
      needsClarification: false
    }
  }, deps);

  t.equal(steeringCalls, 1, 'only the genuine direct request reaches Coder');
  t.equal(conversationCalls, 1, 'the quoted status update stays conversational');
  t.end();
});

test('supervised conversational recall uses retrieved evidence and records its basis', async t => {
  const evidence = [{
    id: 'conversation:gritlife:42',
    sourceKind: 'conversation',
    role: 'user',
    excerpt: 'Replace intent with subscriptions and enrollments by location, including gyms, yoga, massage, therapy, and classes.',
    provenance: { conversationId: 'gritlife-earlier', messageId: '42' },
    scores: { total: 0.92 }
  }];
  let retrievalCalls = 0;
  const result = await supervisor.buildContractedConversationalReply({
    conversation: { id: 'dispatch-live', mode: 'orion', messages: [] },
    prompt: 'Do you remember our earlier conversation about the GRITLIFE intent system?',
    messageId: 'current-message',
    workspacePaths: ['C:\\Users\\Owner\\Desktop\\Projects\\GRITLIFE'],
    semanticIntent: {
      intent: 'conversation',
      target: 'current_conversation',
      requiresExecution: false,
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
    },
    systemPrompt: 'Answer conversationally.',
    messages: []
  }, {
    contracts,
    retrieveEvidence: async payload => {
      retrievalCalls += 1;
      t.deepEqual(payload.excludeMessageIds, ['current-message'], 'the current question cannot serve as its own evidence');
      return { success: true, evidence, queryTerms: ['gritlife', 'intent', 'subscriptions', 'locations'] };
    },
    generateReply: async () => 'I remember the earlier discussion: replace intent with subscriptions and enrollments organized by locations, including gyms, yoga, massage, therapy, and classes.'
  });

  t.equal(retrievalCalls, 1, 'persisted conversations are searched in the supervised path');
  t.match(result.text, /subscriptions.*enrollments|enrollments.*subscriptions/i, 'the retrieved discussion is returned');
  t.equal(result.responseBasis.conversationEvidence.length, 1, 'the assistant message carries evidence provenance');
  t.end();
});

test('supervised conversational recall cannot invent a missing conversation', async t => {
  const result = await supervisor.buildContractedConversationalReply({
    conversation: { id: 'dispatch-live', mode: 'orion', messages: [] },
    prompt: 'Do you remember our earlier conversation about intent?',
    semanticIntent: {
      intent: 'conversation',
      target: 'current_conversation',
      requiresExecution: false,
      reasoningPolicyHint: { complexity: 'low', risk: 'low', contextNeed: 'historical' }
    },
    systemPrompt: 'Answer conversationally.',
    messages: []
  }, {
    contracts,
    retrieveEvidence: async () => ({ success: true, evidence: [], queryTerms: ['intent'] }),
    generateReply: async () => 'The earlier plan centered on traits, Grind, Connect, and Survive.'
  });

  t.match(result.text, /could(?: not|n['’]t) retrieve/i, 'the response discloses the retrieval gap');
  t.notOk(/Grind|Connect|Survive/i.test(result.text), 'the plausible fabrication is removed');
  t.equal(result.responseBasis.conversationEvidence.length, 0, 'the basis records the absence of evidence');
  t.end();
});

test('supervised source and status replies retain their real response basis', async t => {
  const result = await supervisor.buildContractedConversationalReply({
    conversation: { id: 'dispatch-live', mode: 'orion', messages: [] },
    prompt: 'Give me the current project and PR status.',
    projectKnowledge: true,
    statusText: 'PR #9 is open, synchronized, and mergeable.',
    systemPrompt: 'The selected project workspace was resolved from local state.',
    messages: []
  }, {
    contracts,
    generateReply: async () => 'The project is selected, and PR #9 has now been merged.'
  });

  t.equal(result.responseBasis.projectKnowledge, true, 'local project/source knowledge is recorded');
  t.equal(result.responseBasis.generalInference, false, 'known project/status facts are not mislabeled as inference');
  t.equal(result.responseBasis.structuredStatuses.length, 1, 'structured PR provenance is retained');
  t.notOk(/PR #9 (?:has (?:now )?been|is) merged/i.test(result.text), 'mergeable status cannot be upgraded to merged');
  t.match(result.text, /open/i, 'the corrected reply preserves the actual lifecycle state');
  t.end();
});

test('supervisor resolves an unregistered named project from the Projects search root', async t => {
  const searchRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const currentResolution = workspaceResolution.classifyWorkspace({
    mode: 'orion',
    workspacePath: searchRoot,
    searchRoot,
    knownProjects: []
  });
  let listCalls = 0;
  const result = await supervisor.resolveNamedProjectWorkspace({
    prompt: 'Let us continue the GRITLIFE intent work.',
    mode: 'orion',
    searchRoot,
    currentResolution,
    registeredProjects: [],
    recentProjects: []
  }, {
    workspaceResolution,
    listDirectoryChildren: async path => {
      listCalls += 1;
      t.equal(path, searchRoot, 'the configured Projects directory is used only as a search root');
      return [
        { name: 'OrionAI', path: `${searchRoot}\\OrionAI`, isDir: true },
        { name: 'GRITLIFE', path: `${searchRoot}\\GRITLIFE`, isDir: true }
      ];
    }
  });

  t.equal(listCalls, 1, 'the filesystem is inspected after registered and recent bindings miss');
  t.equal(result.resolution.kind, workspaceResolution.KINDS.ACTIVE_PROJECT, 'the concrete directory becomes the selected project');
  t.equal(result.resolution.path, `${searchRoot}\\GRITLIFE`, 'the exact GRITLIFE path is selected');
  t.notEqual(result.resolution.path, searchRoot, 'the generic root is never presented as the project');
  t.equal(result.resolution.source, 'projects_directory', 'the binding records how it was resolved');
  t.end();
});

test('supervisor can use unique project-memory evidence without inventing a binding', async t => {
  const searchRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const currentResolution = workspaceResolution.classifyWorkspace({
    mode: 'orion',
    workspacePath: searchRoot,
    searchRoot,
    knownProjects: []
  });
  const result = await supervisor.resolveNamedProjectWorkspace({
    prompt: 'Open the project called Life Commitments.',
    mode: 'orion',
    searchRoot,
    currentResolution
  }, {
    workspaceResolution,
    listDirectoryChildren: async () => [
      { name: 'grit-app', path: `${searchRoot}\\grit-app`, isDir: true },
      { name: 'other-app', path: `${searchRoot}\\other-app`, isDir: true }
    ],
    readProjectMemory: async path => (
      path.endsWith('grit-app')
        ? { success: true, facts: [{ text: 'The product is named Life Commitments.' }] }
        : { success: true, facts: [{ text: 'Unrelated inventory application.' }] }
    )
  });

  t.equal(result.resolution.path, `${searchRoot}\\grit-app`, 'one corroborated memory match resolves its concrete directory');
  t.equal(result.resolution.source, 'project_memory', 'memory provenance is retained');
  t.equal(result.searchedMemory, true, 'memory lookup is visible in structured resolution state');
  t.end();
});

test('supervisor preserves the Projects search-root classification when a named project is unresolved', async t => {
  const searchRoot = 'C:\\Users\\Owner\\Desktop\\Projects';
  const currentResolution = workspaceResolution.classifyWorkspace({
    mode: 'orion',
    workspacePath: searchRoot,
    searchRoot,
    knownProjects: []
  });
  const result = await supervisor.resolveNamedProjectWorkspace({
    prompt: 'Find the UNKNOWNAPP project.',
    mode: 'orion',
    searchRoot,
    currentResolution
  }, {
    workspaceResolution,
    listDirectoryChildren: async () => [
      { name: 'OrionAI', path: `${searchRoot}\\OrionAI`, isDir: true }
    ],
    readProjectMemory: async () => ({ success: true, facts: [] })
  });

  t.equal(result.project, null, 'no project is invented');
  t.equal(result.resolution.kind, workspaceResolution.KINDS.PROJECT_SEARCH_ROOT, 'the root remains explicitly classified as a search root');
  t.match(
    workspaceResolution.describeWorkspace(result.resolution, 'UNKNOWNAPP'),
    /not attached to a specific project.*search the Projects directory/i,
    'user-facing wording distinguishes search from selection'
  );
  t.end();
});
