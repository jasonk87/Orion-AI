// Configure marked to escape HTML content to prevent XSS vulnerability in Electron renderer
if (typeof marked !== 'undefined') {
  marked.use({
    renderer: {
      html(htmlText) {
        return htmlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    }
  });
}

function sanitizeRenderedMarkdown(container) {
  container.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:|mailto:|orion-file:)/i.test(href)) {
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
      return;
    }
    if (/^https?:/i.test(href)) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });
  container.querySelectorAll('img[src]').forEach(image => {
    const src = image.getAttribute('src') || '';
    if (!/^https?:/i.test(src)) image.removeAttribute('src');
  });
}

// STATE MANAGEMENT
let appConfig = {
  geminiApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',
  googleSearchEngineId: '3354e92e98ab54b31',
  googleSearchApiKey: '',
  defaultModel: 'gemini-2.5-flash-lite',
  compactThresholdTokens: 100000,
  autoCompact: true,
  modelContextBudgets: {
    'gemini-3.5-flash': 1000000,
    'gemini-3.1-pro-preview': 1000000,
    'gemini-3.1-flash-lite': 1000000,
    'gemini-3-flash-preview': 1000000,
    'gemini-2.5-flash-lite': 1000000,
    'gemini-2.5-flash': 1000000,
    'gemini-2.5-pro': 1000000,
    default: 128000
  },
  commandTimeoutMs: 120000,
  modelCallDelayMs: 0,
  regressionTestCommand: 'npm test',
  autoTest: true,
  planningMode: true
};

let currentWorkspace = '';
let currentWorkspaceTestCommand = null; // { command, autoDetected, updatedAt } | null — per-workspace override
let cachedUserDataPath = '';
let activeConversationId = null;
let conversations = []; // { id, title, messages, tasks, testResults }
let activeProcessId = null;
let projects = []; // Array of workspace folder paths
let activeAiBubble = null; // Currently rendering AI message bubble
let currentFileTreeItems = [];
let currentRunArtifacts = [];
let expandedFileFolders = new Set();

// DOM ELEMENTS
const el = {
  // Window controls
  btnMinimize: document.getElementById('btn-minimize'),
  btnMaximize: document.getElementById('btn-maximize'),
  btnClose: document.getElementById('btn-close'),
  appVersionMeta: document.getElementById('app-version-meta'),
  workspaceLabel: document.getElementById('workspace-label'),
  
  // Sidebar items
  btnNewChat: document.getElementById('btn-new-chat'),
  btnAddConversation: document.getElementById('btn-add-conversation'),
  projectList: document.getElementById('project-list'),
  conversationList: document.getElementById('conversation-list'),
  btnSettings: document.getElementById('btn-settings'),
  btnChangeWorkspace: document.getElementById('btn-change-workspace'),
  btnSyncFiles: document.getElementById('btn-sync-files'),
  btnPhoneCompanion: document.getElementById('btn-phone-companion'),
  btnAddProject: document.getElementById('btn-add-project'),
  btnProjectFilter: document.getElementById('btn-project-filter'),
  
  // Chat items
  chatFeed: document.getElementById('chat-feed'),
  welcomeSplash: document.getElementById('welcome-splash'),
  messagesContainer: document.getElementById('messages-container'),
  chatInput: document.getElementById('chat-input'),
  btnSubmit: document.getElementById('btn-submit'),
  modelSelect: document.getElementById('model-select'),
  chatTitle: document.getElementById('chat-title'),
  // Settings modal
  settingsModal: document.getElementById('settings-modal'),
  btnSettingsClose: document.getElementById('btn-settings-close'),
  btnSettingsSave: document.getElementById('btn-settings-save'),
  settingApiKey: document.getElementById('setting-api-key'),
  settingAnthropicApiKey: document.getElementById('setting-anthropic-api-key'),
  settingDeepseekApiKey: document.getElementById('setting-deepseek-api-key'),
  settingGoogleSearchEngineId: document.getElementById('setting-google-search-engine-id'),
  settingGoogleSearchApiKey: document.getElementById('setting-google-search-api-key'),
  settingWorkspacePath: document.getElementById('setting-workspace-path'),
  settingTestCmd: document.getElementById('setting-test-cmd'),
  settingCommandTimeout: document.getElementById('setting-command-timeout'),
  settingModelCallDelay: document.getElementById('setting-model-call-delay'),
  settingCompactThreshold: document.getElementById('setting-compact-threshold'),
  settingAutoTest: document.getElementById('setting-auto-test'),
  settingPlanningMode: document.getElementById('setting-planning-mode'),
  btnBrowseDefaultWorkspace: document.getElementById('btn-browse-default-workspace'),
  
  // Right Agent Panel
  taskChecklist: document.getElementById('task-checklist-container'),
  taskCompletionBadge: document.getElementById('task-completion-badge'),
  operationalContextPanel: document.getElementById('operational-context-panel'),
  operationalContextRevision: document.getElementById('operational-context-revision'),
  btnEditOperationalContext: document.getElementById('btn-edit-operational-context'),
  operationalContextModal: document.getElementById('operational-context-modal'),
  btnOperationalContextClose: document.getElementById('btn-operational-context-close'),
  btnOperationalContextSave: document.getElementById('btn-operational-context-save'),
  operationalMissionInput: document.getElementById('operational-mission-input'),
  operationalObjectiveInput: document.getElementById('operational-objective-input'),
  operationalWinConditionsInput: document.getElementById('operational-win-conditions-input'),
  testIndicator: document.getElementById('test-indicator'),
  lblTestCmd: document.getElementById('lbl-test-cmd'),
  testResults: document.getElementById('test-results-container'),
  btnRunTestsManually: document.getElementById('btn-run-tests-manually'),
  fileTree: document.getElementById('file-tree-container'),
  fileCountBadge: document.getElementById('file-count-badge'),
  artifactList: document.getElementById('artifact-list-container'),
  artifactCountBadge: document.getElementById('artifact-count-badge'),
  phoneCompanionModal: document.getElementById('phone-companion-modal'),
  btnPhoneCompanionClose: document.getElementById('btn-phone-companion-close'),
  phoneCompanionQr: document.getElementById('phone-companion-qr'),
  phoneCompanionPairUrl: document.getElementById('phone-companion-pair-url'),
  phoneCompanionMeta: document.getElementById('phone-companion-meta'),
  workspaceEntrypointInput: document.getElementById('workspace-entrypoint-input'),
  btnSaveEntrypoint: document.getElementById('btn-save-entrypoint'),
  rightSidebar: document.getElementById('right-sidebar'),
  btnToggleRightSidebar: document.getElementById('btn-toggle-right-sidebar'),
  btnToggleLeftSidebar: document.getElementById('btn-toggle-left-sidebar'),
  leftSidebar: document.getElementById('left-sidebar'),
  btnCommandPalette: document.getElementById('btn-command-palette'),
  commandPaletteModal: document.getElementById('command-palette-modal'),
  agentStatePill: document.getElementById('agent-state-pill'),
  agentStateText: document.getElementById('agent-state-text'),
  agentStateDetail: document.getElementById('agent-state-detail'),
  btnStopAgent: document.getElementById('btn-stop-agent'),
  workspaceFilesPanel: document.getElementById('workspace-files-panel'),
  runArtifactsPanel: document.getElementById('run-artifacts-panel'),
  toastRegion: document.getElementById('toast-region'),
  btnStartOpenRepo: document.getElementById('btn-start-open-repo'),
  btnStartNewTask: document.getElementById('btn-start-new-task'),
  btnStartResume: document.getElementById('btn-start-resume'),
  fileViewerModal: document.getElementById('file-viewer-modal'),
  fileViewerTitle: document.getElementById('file-viewer-title'),
  fileViewerContent: document.getElementById('file-viewer-content'),
  fileViewerMarkdown: document.getElementById('file-viewer-markdown'),
  fileViewerImageShell: document.getElementById('file-viewer-image-shell'),
  fileViewerImage: document.getElementById('file-viewer-image'),
  fileViewerImageMeta: document.getElementById('file-viewer-image-meta'),
  btnFileViewerClose: document.getElementById('btn-file-viewer-close'),
  btnFileViewerMention: document.getElementById('btn-file-viewer-mention')
};

let viewedFilePath = '';
let agentPresenceTimer = null;
let agentCompletionTimer = null;

// INITIALIZE APP
document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  await loadSettings();
  await refreshAppRuntimeInfo();
  try { cachedUserDataPath = await window.api.getUserDataPath(); } catch (_) {}
  setupSettingsModal();
  setupFileViewerModal();
  setupOperationalContextEditor();
  setupWorkspaceHandlers();
  setupStartActions();
  setupEntrypointControls();
  setupProgressiveDisclosure();
  setupRightSidebarToggle();
  setupChatHandlers();
  
  // Bind manual task checklist add button
  const btnAddTaskManual = document.getElementById('btn-add-task-manual');
  if (btnAddTaskManual) {
    btnAddTaskManual.addEventListener('click', () => {
      const activeConv = conversations.find(c => c.id === activeConversationId);
      if (!activeConv) {
        alert("Please start a conversation first.");
        return;
      }
      
      const title = prompt("Enter a description for the new queued task:");
      if (title && title.trim()) {
        if (!activeConv.tasks) activeConv.tasks = [];
        activeConv.tasks.push({ title: title.trim(), status: 'pending' });
        saveConversationsToStorage();
        updateTasksChecklist(activeConv.tasks);
        appendSystemMessage(`Queued manual task added: "${title.trim()}"`);
      }
    });
  }
  
  // Bind Launch button in Workspace Files panel
  const btnLaunchApp = document.getElementById('btn-launch-app');
  if (btnLaunchApp) {
    btnLaunchApp.addEventListener('click', async () => {
      const workspace = window.getCurrentWorkspace();
      if (!workspace) {
        alert("Please select a workspace directory or start a conversation first.");
        return;
      }
      
      const result = await window.api.launchWorkspaceApp(workspace);
      if (result.success) {
        appendSystemMessage(`🚀 App Launch: ${result.message}`);
      } else {
        alert(`Failed to launch app: ${result.error}`);
      }
    });
  }
  
  // Load projects from local storage
  loadProjectsFromStorage();
  renderProjectsList();
  
  // Load conversations from local storage
  await loadConversationsFromStorage();
  
  // Migrate any project conversations that accumulated in standalone list
  migrateConversations();
  
  // Select first conversation if exists, otherwise create new one
  if (conversations.length > 0) {
    selectConversation(conversations[0].id);
  } else {
    createNewConversation();
  }
  refreshPhoneCompanionPairing();
  removeLegacyPhoneCompanionTokenBubbles();
});

// --- ELECTRON WINDOW BINDINGS ---
function setupWindowControls() {
  el.btnMinimize.addEventListener('click', () => window.api.minimizeWindow());
  el.btnMaximize.addEventListener('click', () => window.api.maximizeWindow());
  el.btnClose.addEventListener('click', () => window.api.closeWindow());
}

async function refreshAppRuntimeInfo() {
  if (!el.appVersionMeta || !window.api || !window.api.getAppRuntimeInfo) return;
  try {
    const info = await window.api.getAppRuntimeInfo();
    const parts = [];
    if (info && info.version) parts.push(`v${info.version}`);
    if (info && info.runtimeDateLabel) parts.push(info.runtimeDateLabel);
    if (!parts.length) {
      el.appVersionMeta.textContent = '';
      el.appVersionMeta.style.display = 'none';
      return;
    }
    el.appVersionMeta.textContent = parts.join(' · ');
    el.appVersionMeta.title = `Orion AI ${parts.join(' · ')}`;
    el.appVersionMeta.style.display = 'inline-flex';
  } catch (e) {
    el.appVersionMeta.textContent = '';
    el.appVersionMeta.style.display = 'none';
  }
}

// --- SETTINGS CONFIGURATION ---
async function loadSettings() {
  const loadedConfig = await window.api.readConfig();
  if (loadedConfig && Object.keys(loadedConfig).length > 0) {
    appConfig = { ...appConfig, ...loadedConfig };
  }
  
  // Apply settings to form fields
  el.settingApiKey.value = appConfig.geminiApiKey || '';
  if (el.settingAnthropicApiKey) el.settingAnthropicApiKey.value = appConfig.anthropicApiKey || '';
  if (el.settingDeepseekApiKey) el.settingDeepseekApiKey.value = appConfig.deepseekApiKey || '';
  el.settingGoogleSearchEngineId.value = appConfig.googleSearchEngineId || '';
  el.settingGoogleSearchApiKey.value = appConfig.googleSearchApiKey || '';
  el.settingWorkspacePath.value = appConfig.defaultWorkspacePath || '';
  if (el.settingTestCmd) el.settingTestCmd.value = appConfig.regressionTestCommand || 'npm test';
  if (el.settingCommandTimeout) el.settingCommandTimeout.value = appConfig.commandTimeoutMs || 120000;
  if (el.settingModelCallDelay) el.settingModelCallDelay.value = appConfig.modelCallDelayMs || 0;
  el.settingCompactThreshold.value = appConfig.compactThresholdTokens || 100000;
  if (el.settingAutoTest) el.settingAutoTest.checked = appConfig.autoTest !== false;
  el.settingPlanningMode.checked = appConfig.planningMode !== false;
  
  if (el.lblTestCmd) el.lblTestCmd.textContent = appConfig.regressionTestCommand || 'npm test';
  
  // Auto-load workspace if saved
  if (appConfig.defaultWorkspacePath) {
    setWorkspace(appConfig.defaultWorkspacePath);
  }
  
  // Initialize dropdown with Gemini and dynamic Ollama models
  await initModelDropdown();
}

async function initModelDropdown() {
  const modelSelect = el.modelSelect;
  if (!modelSelect) return;
  
  // Clean first
  modelSelect.innerHTML = '';
  
  // Static Gemini list
  const geminiModels = [
    { value: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { value: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
    { value: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
    { value: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
    { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
  ];
  
  // Re-build Gemini Optgroup
  const geminiGroup = document.createElement('optgroup');
  geminiGroup.label = 'Gemini';
  geminiModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.name;
    geminiGroup.appendChild(opt);
  });
  modelSelect.appendChild(geminiGroup);

  // Static Claude list — listed unconditionally, same as Gemini above (selecting one without a
  // configured Anthropic key simply errors clearly when a call is attempted, matching how an
  // unconfigured Gemini key already behaves).
  const claudeModels = [
    { value: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
    { value: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
    { value: 'claude-fable-5', name: 'Claude Fable 5' },
    { value: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }
  ];
  const claudeGroup = document.createElement('optgroup');
  claudeGroup.label = 'Claude';
  claudeModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.name;
    claudeGroup.appendChild(opt);
  });
  modelSelect.appendChild(claudeGroup);

  // Static DeepSeek list
  const deepseekModels = [
    { value: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { value: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
  ];
  const deepseekGroup = document.createElement('optgroup');
  deepseekGroup.label = 'DeepSeek';
  deepseekModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.name;
    deepseekGroup.appendChild(opt);
  });
  modelSelect.appendChild(deepseekGroup);

  // Try to load saved model from localStorage or config
  let defaultModel = localStorage.getItem('ag2_default_model') || appConfig.defaultModel || 'gemini-2.5-flash-lite';
  
  // Fetch Ollama models
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      const data = await response.json();
      if (data.models && data.models.length > 0) {
        const ollamaGroup = document.createElement('optgroup');
        ollamaGroup.label = 'Ollama';
        
        data.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.name; // e.g. "llama3:latest"
          opt.textContent = m.name;
          ollamaGroup.appendChild(opt);
        });
        modelSelect.appendChild(ollamaGroup);
      }
    }
  } catch (e) {
    console.log("Ollama local service is not available or not running:", e.message);
  }
  
  // Select active preference (fallback to gemini-2.5-flash-lite if option doesn't exist)
  let found = false;
  for (let i = 0; i < modelSelect.options.length; i++) {
    if (modelSelect.options[i].value === defaultModel) {
      modelSelect.selectedIndex = i;
      found = true;
      break;
    }
  }
  if (!found) {
    // If preference not found (e.g. Ollama model deleted/stopped), default to flash-lite
    for (let i = 0; i < modelSelect.options.length; i++) {
      if (modelSelect.options[i].value === 'gemini-2.5-flash-lite') {
        modelSelect.selectedIndex = i;
        break;
      }
    }
  }
  
  // Sync back config
  appConfig.defaultModel = modelSelect.value;
}

function setupSettingsModal() {
  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.classList.add('active');
  });
  
  el.btnSettingsClose.addEventListener('click', () => {
    el.settingsModal.classList.remove('active');
  });
  
  el.btnSettingsSave.addEventListener('click', async () => {
    appConfig.geminiApiKey = el.settingApiKey.value.trim();
    if (el.settingAnthropicApiKey) appConfig.anthropicApiKey = el.settingAnthropicApiKey.value.trim();
    if (el.settingDeepseekApiKey) appConfig.deepseekApiKey = el.settingDeepseekApiKey.value.trim();
    appConfig.googleSearchEngineId = el.settingGoogleSearchEngineId.value.trim();
    appConfig.googleSearchApiKey = el.settingGoogleSearchApiKey.value.trim();
    appConfig.defaultWorkspacePath = el.settingWorkspacePath.value.trim();
    appConfig.regressionTestCommand = el.settingTestCmd ? el.settingTestCmd.value.trim() : appConfig.regressionTestCommand;
    appConfig.commandTimeoutMs = el.settingCommandTimeout ? (parseInt(el.settingCommandTimeout.value) || 120000) : appConfig.commandTimeoutMs;
    appConfig.modelCallDelayMs = el.settingModelCallDelay ? Math.min(Math.max(parseInt(el.settingModelCallDelay.value) || 0, 0), 60000) : (appConfig.modelCallDelayMs || 0);
    appConfig.compactThresholdTokens = parseInt(el.settingCompactThreshold.value) || 100000;
    appConfig.autoTest = el.settingAutoTest ? el.settingAutoTest.checked : true;
    appConfig.planningMode = el.settingPlanningMode.checked;
    
    await window.api.writeConfig(appConfig);
    if (el.lblTestCmd) el.lblTestCmd.textContent = appConfig.regressionTestCommand;
    el.settingsModal.classList.remove('active');
    
    if (appConfig.defaultWorkspacePath && appConfig.defaultWorkspacePath !== currentWorkspace) {
      setWorkspace(appConfig.defaultWorkspacePath);
    }
    
    appendSystemMessage("Settings saved successfully.");
  });
  
  el.btnBrowseDefaultWorkspace.addEventListener('click', async () => {
    const folderPath = await window.api.selectWorkspace();
    if (folderPath) {
      el.settingWorkspacePath.value = folderPath;
    }
  });
}

// --- WORKSPACE & FILE MANAGEMENT ---
function setupWorkspaceHandlers() {
  const triggerWorkspaceSelect = async () => {
    const folderPath = await window.api.selectWorkspace();
    if (folderPath) {
      setWorkspace(folderPath);
    }
  };
  
  el.workspaceLabel.addEventListener('click', triggerWorkspaceSelect);
  el.workspaceLabel.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      triggerWorkspaceSelect();
    }
  });
  el.btnChangeWorkspace.addEventListener('click', triggerWorkspaceSelect);
  
  if (el.btnAddProject) {
    el.btnAddProject.addEventListener('click', triggerWorkspaceSelect);
  }
  
  if (el.btnProjectFilter) {
    el.btnProjectFilter.addEventListener('click', () => {
      const query = prompt("Filter projects by name:");
      if (query !== null) {
        filterProjects(query.trim());
      }
    });
  }
  
  el.btnSyncFiles.addEventListener('click', () => {
    if (currentWorkspace) {
      syncWorkspaceFiles();
    } else {
      triggerWorkspaceSelect();
    }
  });
  if (el.btnPhoneCompanion) {
    el.btnPhoneCompanion.addEventListener('click', async () => {
      if (window.api && typeof window.api.enablePhoneCompanionLan === 'function') {
        try {
          const payload = await window.api.enablePhoneCompanionLan();
          if (payload && payload.success !== false) {
            updatePhoneCompanionPairingPanel(payload);
          }
        } catch (error) {
          console.warn('Could not enable phone companion LAN mode:', error);
          await refreshPhoneCompanionPairing();
        }
      } else {
        await refreshPhoneCompanionPairing();
      }
      if (el.phoneCompanionModal) el.phoneCompanionModal.classList.add('active');
    });
  }
  if (el.btnPhoneCompanionClose) {
    el.btnPhoneCompanionClose.addEventListener('click', () => {
      if (el.phoneCompanionModal) el.phoneCompanionModal.classList.remove('active');
    });
  }
  
  if (el.btnRunTestsManually) {
    el.btnRunTestsManually.addEventListener('click', () => {
      runRegressionTests();
    });
  }
}

async function setWorkspace(folderPath) {
  // If folderPath is in projects list, switch to it
  if (!projects.includes(folderPath)) {
    projects.push(folderPath);
    saveProjectsToStorage();
  }
  
  // Set current parent project
  currentWorkspace = folderPath;
  expandedFileFolders = new Set();
  el.workspaceLabel.textContent = folderPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || folderPath;
  
  renderProjectsList();
  
  // Check if there is any conversation under this project
  const projectConversations = conversations.filter(c => c.projectPath === folderPath);
  if (projectConversations.length > 0) {
    selectConversation(projectConversations[0].id);
  } else {
    createNewConversationUnderProject(folderPath);
  }
}

// PROJECTS LIST STORAGE & MANAGEMENT
function loadProjectsFromStorage() {
  const raw = localStorage.getItem('ag2_projects');
  const backup = localStorage.getItem('ag2_projects_backup');
  try {
    projects = JSON.parse(raw);
    if (!Array.isArray(projects)) throw new Error('Not an array');
  } catch (e) {
    console.warn("Failed to parse ag2_projects, trying backup", e);
    try {
      projects = JSON.parse(backup);
      if (!Array.isArray(projects)) throw new Error('Not an array');
    } catch (e2) {
      projects = [];
    }
  }
}

function saveProjectsToStorage() {
  try {
    const serialized = JSON.stringify(projects);
    localStorage.setItem('ag2_projects', serialized);
    localStorage.setItem('ag2_projects_backup', serialized);
  } catch (e) {
    console.error("Failed to save projects to storage", e);
  }
}

// PROJECTS LIST ARCHITECTURE COMPLETED - DUPES REMOVED

async function syncWorkspaceFiles() {
  if (!currentWorkspace) return;
  if (el.workspaceFilesPanel) el.workspaceFilesPanel.classList.remove('contextual-panel-hidden');
  el.fileTree.innerHTML = '<p class="empty-state">Scanning directory...</p>';
  loadWorkspaceEntrypoint();
  await loadWorkspaceTestCommand();

  if (window.api && typeof window.api.indexWorkspace === 'function') {
    window.api.indexWorkspace(currentWorkspace).catch(() => {});
  }

  const files = await window.api.listFiles(currentWorkspace);
  el.fileCountBadge.textContent = files.length;
  
  if (files.length === 0) {
    currentFileTreeItems = [];
    el.fileTree.innerHTML = '<p class="empty-state">No files found.</p>';
    autoDetectTestCommand(files);
    loadRunArtifacts();
    return;
  }

  currentFileTreeItems = files;
  renderFileTree(files);
  autoDetectTestCommand(files);
  loadRunArtifacts();
}

function setupEntrypointControls() {
  if (!el.btnSaveEntrypoint || !el.workspaceEntrypointInput) return;
  el.btnSaveEntrypoint.addEventListener('click', saveWorkspaceEntrypointFromInput);
  el.workspaceEntrypointInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveWorkspaceEntrypointFromInput();
    }
  });
}

function setupRightSidebarToggle() {
  if (!el.btnToggleRightSidebar || !el.rightSidebar) return;
  
  const storedCollapsed = localStorage.getItem('rightSidebarCollapsed');
  const isCollapsed = storedCollapsed === null ? true : (storedCollapsed === 'true');
  
  setRightSidebarCollapsed(isCollapsed, false);
  
  el.btnToggleRightSidebar.addEventListener('click', () => {
    setRightSidebarCollapsed(!el.rightSidebar.classList.contains('collapsed'));
  });
}

function setRightSidebarCollapsed(collapsed, persist = true) {
  if (!el.rightSidebar) return;
  el.rightSidebar.classList.toggle('collapsed', collapsed);
  if (el.btnToggleRightSidebar) el.btnToggleRightSidebar.setAttribute('aria-expanded', String(!collapsed));
  if (persist) localStorage.setItem('rightSidebarCollapsed', String(collapsed));
}

function revealAgentPanel(reason = '') {
  const wasCollapsed = el.rightSidebar && el.rightSidebar.classList.contains('collapsed');
  setRightSidebarCollapsed(false, false);
  if (reason && wasCollapsed) showToast(reason, 'attention');
}

function setLeftSidebarCollapsed(collapsed, persist = true) {
  if (!el.leftSidebar) return;
  el.leftSidebar.classList.toggle('collapsed', collapsed);
  if (el.btnToggleLeftSidebar) el.btnToggleLeftSidebar.setAttribute('aria-expanded', String(!collapsed));
  if (persist) localStorage.setItem('leftSidebarCollapsed', String(collapsed));
}

function runCommandPaletteAction(command) {
  const targets = {
    'new-task': el.btnNewChat,
    'open-workspace': el.btnChangeWorkspace,
    'sync-files': el.btnSyncFiles,
    'agent-panel': el.btnToggleRightSidebar,
    phone: el.btnPhoneCompanion,
    launch: document.getElementById('btn-launch-app'),
    settings: el.btnSettings
  };
  const target = targets[command];
  if (target) target.click();
}

function setupProgressiveDisclosure() {
  if (el.leftSidebar && el.btnToggleLeftSidebar) {
    const stored = localStorage.getItem('leftSidebarCollapsed');
    const collapsed = stored === null ? window.innerWidth < 980 : stored === 'true';
    setLeftSidebarCollapsed(collapsed, false);
    el.btnToggleLeftSidebar.addEventListener('click', () => {
      setLeftSidebarCollapsed(!el.leftSidebar.classList.contains('collapsed'));
    });
  }

  const closePalette = () => el.commandPaletteModal && el.commandPaletteModal.classList.remove('active');
  const openPalette = () => {
    if (!el.commandPaletteModal) return;
    el.commandPaletteModal.classList.add('active');
    const firstCommand = el.commandPaletteModal.querySelector('.command-item');
    if (firstCommand) firstCommand.focus();
  };
  if (el.btnCommandPalette) el.btnCommandPalette.addEventListener('click', openPalette);
  if (el.commandPaletteModal) {
    el.commandPaletteModal.addEventListener('click', event => {
      if (event.target === el.commandPaletteModal) closePalette();
      const item = event.target.closest('.command-item');
      if (!item) return;
      runCommandPaletteAction(item.dataset.command);
      closePalette();
    });
  }
  document.addEventListener('keydown', event => {
    const paletteOpen = el.commandPaletteModal && el.commandPaletteModal.classList.contains('active');
    if (paletteOpen && event.key === 'Tab') {
      const items = [...el.commandPaletteModal.querySelectorAll('.command-item')];
      if (items.length) {
        const currentIndex = items.indexOf(document.activeElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
          : (currentIndex >= items.length - 1 ? 0 : currentIndex + 1);
        event.preventDefault();
        items[nextIndex].focus();
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      paletteOpen ? closePalette() : openPalette();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      createNewConversation();
    } else if (event.key === 'Escape' && el.commandPaletteModal && el.commandPaletteModal.classList.contains('active')) {
      closePalette();
    }
  });
}

async function loadWorkspaceEntrypoint() {
  if (!el.workspaceEntrypointInput) return;
  if (!currentWorkspace) {
    el.workspaceEntrypointInput.value = '';
    return;
  }
  const result = await window.api.getWorkspaceEntrypoint(currentWorkspace);
  if (result && result.success && result.entrypoint) {
    el.workspaceEntrypointInput.value = result.entrypoint.command || '';
  } else {
    el.workspaceEntrypointInput.value = '';
  }
}

// Loads this workspace's own regression test command override, if any was set (manually or via
// autoDetectTestCommand) for THIS workspace path specifically. See getEffectiveTestCommand() for
// how this combines with the global Settings default.
async function loadWorkspaceTestCommand() {
  currentWorkspaceTestCommand = null;
  if (!currentWorkspace || !window.api.getWorkspaceTestCommand) {
    if (el.lblTestCmd) el.lblTestCmd.textContent = appConfig.regressionTestCommand || 'npm test';
    return;
  }
  const result = await window.api.getWorkspaceTestCommand(currentWorkspace);
  if (result && result.success && result.testCommand) {
    currentWorkspaceTestCommand = result.testCommand;
  }
  if (el.lblTestCmd) el.lblTestCmd.textContent = getEffectiveTestCommand();
}

// The regression test command to actually run: this workspace's own override if one has been
// set (manually or auto-detected for THIS project), otherwise the global Settings default.
function getEffectiveTestCommand() {
  return (currentWorkspaceTestCommand && currentWorkspaceTestCommand.command) || appConfig.regressionTestCommand || 'npm test';
}

async function saveWorkspaceEntrypointFromInput() {
  if (!currentWorkspace) {
    alert('Please choose a workspace first.');
    return;
  }
  const command = (el.workspaceEntrypointInput.value || '').trim();
  const result = await window.api.setWorkspaceEntrypoint(currentWorkspace, command ? { command } : null);
  if (result.success) {
    appendSystemMessage(command ? `Workspace entry point set to: ${command}` : 'Workspace entry point cleared.');
  } else {
    alert(`Failed to save entry point: ${result.error}`);
  }
}

function renderFileTree(files) {
  el.fileTree.innerHTML = '';
  const tree = buildFileTree(files);
  renderFileTreeChildren(tree.children, el.fileTree, 0);
}

function buildFileTree(files) {
  const root = { children: new Map() };
  
  files.forEach(file => {
    const pathParts = file.path.split(/[\\/]+/).filter(Boolean);
    let current = root;
    
    pathParts.forEach((part, index) => {
      const partialPath = pathParts.slice(0, index + 1).join('\\');
      const isLast = index === pathParts.length - 1;
      const isDir = isLast ? file.isDir : true;
      
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: partialPath,
          isDir,
          children: new Map()
        });
      }
      
      current = current.children.get(part);
      if (isLast) current.isDir = file.isDir;
    });
  });
  
  return root;
}

function renderFileTreeChildren(childrenMap, container, depth) {
  const children = Array.from(childrenMap.values()).sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  
  children.forEach(node => {
    const row = document.createElement('div');
    row.className = `file-node ${node.isDir ? 'folder' : 'file'}`;
    row.style.paddingLeft = `${depth * 14 + 6}px`;
    row.draggable = true;
    row.dataset.path = node.path;
    row.dataset.isdir = node.isDir ? 'true' : 'false';
    
    const isExpanded = expandedFileFolders.has(node.path);
    const hasChildren = node.isDir && node.children.size > 0;
    const caret = node.isDir ? (isExpanded ? 'v' : '>') : '';
    const icon = node.isDir ? (isExpanded ? '[-]' : '[+]') : '';
    
    row.innerHTML = `
      <span class="file-caret">${caret}</span>
      <span class="file-icon">${icon}</span>
      <span class="file-name" title="${escapeHtml(node.path)}">${escapeHtml(node.name)}</span>
      ${node.isDir ? '' : '<button class="file-mention-btn" title="Mention this file in chat">@</button>'}
      <button class="file-action-btn file-rename-btn" title="Rename">rn</button>
      <button class="file-action-btn file-copy-btn" title="Copy">cp</button>
      <button class="file-action-btn file-move-btn" title="Move or rename">mv</button>
      <button class="file-action-btn file-delete-btn" title="Delete">del</button>
    `;

    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/x-orion-path', node.path);
      event.dataTransfer.effectAllowed = 'move';
    });

    if (node.isDir) {
      row.addEventListener('dragover', (event) => {
        const sourcePath = event.dataTransfer.types.includes('text/x-orion-path');
        if (sourcePath) {
          event.preventDefault();
          row.classList.add('drag-over');
        }
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (event) => {
        event.preventDefault();
        row.classList.remove('drag-over');
        const sourcePath = event.dataTransfer.getData('text/x-orion-path');
        await moveWorkspacePathIntoDirectory(sourcePath, node.path);
      });
    }
    
    if (node.isDir) {
      row.addEventListener('click', () => {
        if (!hasChildren) return;
        if (isExpanded) {
          expandedFileFolders.delete(node.path);
        } else {
          expandedFileFolders.add(node.path);
        }
        renderFileTree(currentFileTreeItems);
      });
    } else {
      row.addEventListener('click', () => openFileViewer(node.path));
      const mentionButton = row.querySelector('.file-mention-btn');
      if (mentionButton) {
        mentionButton.addEventListener('click', (event) => {
          event.stopPropagation();
          insertFileReference(node.path);
        });
      }
    }
    const moveButton = row.querySelector('.file-move-btn');
    if (moveButton) {
      moveButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await moveWorkspacePath(node.path);
      });
    }
    const renameButton = row.querySelector('.file-rename-btn');
    if (renameButton) {
      renameButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await renameWorkspacePath(node.path);
      });
    }
    const copyButton = row.querySelector('.file-copy-btn');
    if (copyButton) {
      copyButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await copyWorkspacePath(node.path);
      });
    }
    const deleteButton = row.querySelector('.file-delete-btn');
    if (deleteButton) {
      deleteButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await deleteWorkspacePath(node.path);
      });
    }
    
    container.appendChild(row);
    
    if (node.isDir && isExpanded && hasChildren) {
      renderFileTreeChildren(node.children, container, depth + 1);
    }
  });
}

async function moveWorkspacePathIntoDirectory(sourcePath, directoryPath) {
  if (!sourcePath || !directoryPath || sourcePath === directoryPath) return;
  if (directoryPath.startsWith(`${sourcePath}\\`) || directoryPath.startsWith(`${sourcePath}/`)) {
    alert('Cannot move a folder into itself.');
    return;
  }
  const fileName = sourcePath.split(/[\\/]/).pop();
  const destination = `${directoryPath}\\${fileName}`;
  if (destination === sourcePath) return;
  const result = await window.api.movePath(currentWorkspace, sourcePath, destination);
  if (result.success) {
    appendSystemMessage(`Moved ${sourcePath} to ${destination}.`);
    await syncWorkspaceFiles();
  } else {
    alert(`Move failed: ${result.error}`);
  }
}

async function deleteWorkspacePath(relativePath) {
  if (!currentWorkspace || !relativePath) return;
  const approved = await window.api.showConfirmDialog(`Delete "${relativePath}" from the workspace?`, 'Delete Workspace Item');
  if (!approved?.confirmed) return;
  const result = await window.api.deletePath(currentWorkspace, relativePath);
  if (result.success) {
    appendSystemMessage(`Deleted ${relativePath}${result.backupPath ? ` (backup: ${result.backupPath})` : ''}.`);
    await syncWorkspaceFiles();
  } else {
    alert(`Delete failed: ${result.error}`);
  }
}

async function moveWorkspacePath(relativePath) {
  if (!currentWorkspace || !relativePath) return;
  const destination = prompt('Move or rename to this workspace-relative path:', relativePath);
  if (!destination || destination.trim() === relativePath) return;
  const result = await window.api.movePath(currentWorkspace, relativePath, destination.trim());
  if (result.success) {
    appendSystemMessage(`Moved ${relativePath} to ${destination.trim()}.`);
    await syncWorkspaceFiles();
  } else {
    alert(`Move failed: ${result.error}`);
  }
}

async function renameWorkspacePath(relativePath) {
  if (!currentWorkspace || !relativePath) return;
  const currentName = relativePath.split(/[\\/]/).pop();
  const newName = prompt('Rename to:', currentName);
  if (!newName || newName.trim() === currentName) return;
  const result = await window.api.renamePath(currentWorkspace, relativePath, newName.trim());
  if (result.success) {
    appendSystemMessage(`Renamed ${relativePath} to ${newName.trim()}.`);
    await syncWorkspaceFiles();
  } else {
    alert(`Rename failed: ${result.error}`);
  }
}

async function copyWorkspacePath(relativePath) {
  if (!currentWorkspace || !relativePath) return;
  const destination = prompt('Copy to this workspace-relative path:', relativePath);
  if (!destination || destination.trim() === relativePath) return;
  const result = await window.api.copyPath(currentWorkspace, relativePath, destination.trim());
  if (result.success) {
    appendSystemMessage(`Copied ${relativePath} to ${destination.trim()}.`);
    await syncWorkspaceFiles();
  } else {
    alert(`Copy failed: ${result.error}`);
  }
}

async function loadRunArtifacts() {
  if (!el.artifactList || !window.api.listRunArtifacts) return;
  const result = await window.api.listRunArtifacts(activeConversationId);
  const runArtifacts = result && result.success ? result.artifacts : [];
  const artifacts = mergeRunAndWorkspaceScreenshotArtifacts(runArtifacts);
  currentRunArtifacts = artifacts;
  if (el.artifactCountBadge) el.artifactCountBadge.textContent = artifacts.length;
  if (el.runArtifactsPanel) el.runArtifactsPanel.classList.toggle('contextual-panel-hidden', artifacts.length === 0);
  if (!artifacts.length) {
    el.artifactList.innerHTML = '<p class="empty-state">Artifacts are saved outside the project after runs.</p>';
    return;
  }
  el.artifactList.innerHTML = artifacts.slice(0, 12).map(renderArtifactListItem).join('');
  el.artifactList.querySelectorAll('[data-artifact-index]').forEach(button => {
    button.addEventListener('click', () => openRunArtifactByIndex(Number(button.dataset.artifactIndex)));
  });
}

function mergeRunAndWorkspaceScreenshotArtifacts(runArtifacts = []) {
  return (Array.isArray(runArtifacts) ? [...runArtifacts] : [])
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function normalizeViewerPath(pathValue) {
  return String(pathValue || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase();
}

function isViewerGovernanceArtifactPath(pathValue) {
  const normalized = normalizeViewerPath(pathValue);
  return normalized === 'implementation_plan.md' || normalized === 'strategy.md' || normalized === 'work_walkthrough.md';
}

function extractTextReadContent(result) {
  if (typeof result === 'string') return result;
  if (result && !result.error && typeof result.content === 'string') return result.content;
  if (result && result.error) throw new Error(result.error);
  return '';
}

async function readConversationTextArtifact(conv, relativePath, options = {}) {
  if (conv && conv.id && isViewerGovernanceArtifactPath(relativePath) && window.api.readConversationArtifact) {
    const artifact = await window.api.readConversationArtifact(conv.id, relativePath, options);
    if (artifact && artifact.success) return artifact.content || '';
  }
  const workspace = (conv && conv.workspace) || currentWorkspace;
  const result = await window.api.readFile(workspace, relativePath, options);
  return extractTextReadContent(result);
}

function getWorkspaceScreenshotArtifacts() {
  if (!currentWorkspace || !Array.isArray(currentFileTreeItems)) return [];
  return currentFileTreeItems
    .filter(file => file && !file.isDir && /^\.orion[\\/]+screenshots[\\/]+.+\.(png|jpe?g|webp)$/i.test(file.path))
    .map(file => ({
      artifactType: 'screenshot',
      displayName: file.path.split(/[\\/]/).pop(),
      fileName: file.path.split(/[\\/]/).pop(),
      artifactPath: file.path,
      workspacePath: currentWorkspace,
      screenshotPath: file.path,
      createdAt: new Date().toISOString(),
      size: file.size || 0,
      summary: 'Workspace screenshot'
    }));
}

function renderArtifactListItem(item, index) {
  const isScreenshot = item.artifactType === 'screenshot' && item.screenshotPath;
  const displayName = item.displayName || item.fileName || 'artifact';
  const metaParts = [];
  if (item.artifactType === 'screenshot') metaParts.push('Screenshot');
  else metaParts.push('Run summary');
  if (item.width && item.height) metaParts.push(`${item.width}x${item.height}`);
  if (item.createdAt) metaParts.push(new Date(item.createdAt).toLocaleString());
  const tag = isScreenshot ? 'button' : 'div';
  const actionAttrs = isScreenshot ? ` type="button" data-artifact-index="${index}" aria-label="View screenshot artifact ${escapeHtml(displayName)}"` : '';
  return `
    <${tag} class="artifact-item ${isScreenshot ? 'previewable' : ''}" title="${escapeHtml(item.summary || item.artifactPath || item.screenshotPath || '')}"${actionAttrs}>
      <span class="artifact-name">${escapeHtml(displayName)}</span>
      <span class="artifact-meta">${escapeHtml(metaParts.join(' / '))}</span>
    </${tag}>
  `;
}

async function openRunArtifactByIndex(index) {
  const item = currentRunArtifacts[index];
  if (!item || item.artifactType !== 'screenshot') return;
  await openImageArtifact(item);
}

async function autoDetectTestCommand(files) {
  if (!files || files.length === 0) return;
  
  try {
    const hasPackageJson = files.some(f => f.name === 'package.json');
    const hasPythonFiles = files.some(f => f.name.endsWith('.py'));
    const hasCargoToml = files.some(f => f.name === 'Cargo.toml');
    const hasGoMod = files.some(f => f.name === 'go.mod');
    
    // Check for specific test files
    const testJsFile = files.find(f => f.name === 'test.js' || f.name === 'tests.js' || f.name.endsWith('.test.js') || f.name.endsWith('.spec.js'));
    const testPyFile = files.find(f => f.name === 'test.py' || f.name === 'tests.py' || f.name.endsWith('_test.py'));
    const testGoFile = files.find(f => f.name.endsWith('_test.go'));
    
    let detectedCmd = '';
    
    if (hasPackageJson) {
      detectedCmd = 'npm test';
    } else if (testJsFile) {
      detectedCmd = `node ${testJsFile.path}`;
    } else if (hasCargoToml) {
      detectedCmd = 'cargo test';
    } else if (hasGoMod || testGoFile) {
      detectedCmd = 'go test ./...';
    } else if (testPyFile) {
      detectedCmd = `python ${testPyFile.path}`;
    } else if (hasPythonFiles) {
      detectedCmd = 'python -m unittest';
    } else {
      // If there are JS files but no package.json, default to node test.js as the target
      const hasJsFiles = files.some(f => f.name.endsWith('.js'));
      if (hasJsFiles) {
        detectedCmd = 'node test.js';
      }
    }
    
    const existingCommand = currentWorkspaceTestCommand ? currentWorkspaceTestCommand.command : '';
    if (detectedCmd && existingCommand !== detectedCmd) {
      // Only overwrite if there's no per-workspace override yet, or the existing one was itself
      // auto-detected (not something the user manually customized for this workspace) — a
      // stronger explicit test file signal can still override a weaker auto-detected guess.
      const noOverrideYet = !currentWorkspaceTestCommand;
      const previouslyAutoDetected = !!(currentWorkspaceTestCommand && currentWorkspaceTestCommand.autoDetected);
      const foundExplicitTestFile = (testJsFile || testPyFile || testGoFile) && !hasPackageJson;

      if (noOverrideYet || previouslyAutoDetected || foundExplicitTestFile) {
        const result = await window.api.setWorkspaceTestCommand(currentWorkspace, { command: detectedCmd, autoDetected: true });
        if (result && result.success) {
          currentWorkspaceTestCommand = result.testCommand;
          if (el.lblTestCmd) el.lblTestCmd.textContent = detectedCmd;
          appendSystemMessage(`Detected workspace test suite. Regression test command for this workspace set to: "${detectedCmd}"`, {
            dedupeKey: `detected-test-command:${currentWorkspace}:${detectedCmd}`,
            windowMs: 60000
          });
        }
      }
    }
  } catch (e) {
    console.error("Error auto-detecting test command:", e);
  }
}

function insertFileReference(relPath) {
  const currentText = el.chatInput.value;
  el.chatInput.value = currentText + ` @${relPath} `;
  el.chatInput.focus();
}

function setupFileViewerModal() {
  if (!el.fileViewerModal) return;
  el.btnFileViewerClose.addEventListener('click', closeFileViewer);
  el.fileViewerModal.addEventListener('click', (event) => {
    if (event.target === el.fileViewerModal) closeFileViewer();
  });
  el.btnFileViewerMention.addEventListener('click', () => {
    if (viewedFilePath) insertFileReference(viewedFilePath);
    closeFileViewer();
  });
}

async function openFileViewer(relPath) {
  if (!currentWorkspace || !relPath) return;
  if (/\.(png|jpe?g|webp|gif)$/i.test(relPath)) {
    await openImageArtifact({
      artifactType: 'screenshot',
      displayName: relPath.split(/[\\/]/).pop(),
      workspacePath: currentWorkspace,
      screenshotPath: relPath,
      toolName: 'workspace image'
    });
    return;
  }
  viewedFilePath = relPath;
  el.fileViewerTitle.textContent = relPath;
  const isMarkdown = /\.(md|markdown)$/i.test(relPath);
  setFileViewerMode(isMarkdown ? 'markdown' : 'text');
  if (isMarkdown && el.fileViewerMarkdown) {
    el.fileViewerMarkdown.innerHTML = '<p>Loading...</p>';
  } else {
    el.fileViewerContent.textContent = 'Loading...';
  }
  el.fileViewerModal.classList.add('active');

  let content = '';
  let readError = '';
  try {
    const conv = conversations.find(c => c.id === activeConversationId);
    content = await readConversationTextArtifact(conv, relPath, { maxChars: 200000 });
  } catch (err) {
    readError = err && err.message ? err.message : 'unknown error';
  }
  if (readError) {
    const errorText = `Error loading file: ${readError}`;
    if (isMarkdown && el.fileViewerMarkdown) {
      el.fileViewerMarkdown.textContent = errorText;
    } else {
      el.fileViewerContent.textContent = errorText;
    }
    return;
  }
  if (isMarkdown && el.fileViewerMarkdown) {
    el.fileViewerMarkdown.innerHTML = typeof marked !== 'undefined' ? marked.parse(content || '') : escapeHtml(content || '');
    sanitizeRenderedMarkdown(el.fileViewerMarkdown);
  } else {
    el.fileViewerContent.textContent = content || '';
  }
}

async function openImageArtifact(item) {
  const workspacePath = item.workspacePath || currentWorkspace;
  const relPath = item.screenshotPath || item.path;
  const isArtifactRef = /^orion-artifact:\/\//i.test(String(relPath || ''));
  if ((!workspacePath && !isArtifactRef) || !relPath || !window.api.readWorkspaceFileBase64) {
    showToast('Screenshot artifact is missing its workspace path.', 'attention');
    return;
  }
  viewedFilePath = relPath;
  el.fileViewerTitle.textContent = relPath;
  setFileViewerMode('image');
  if (el.fileViewerImageMeta) el.fileViewerImageMeta.textContent = 'Loading screenshot...';
  el.fileViewerModal.classList.add('active');

  const file = await window.api.readWorkspaceFileBase64(workspacePath, relPath);
  if (!file || file.success === false) {
    if (el.fileViewerImageMeta) el.fileViewerImageMeta.textContent = `Error loading screenshot: ${file && file.error ? file.error : 'unknown error'}`;
    if (el.fileViewerImage) el.fileViewerImage.removeAttribute('src');
    return;
  }
  const mimeType = file.mimeType || 'image/png';
  if (el.fileViewerImage) el.fileViewerImage.src = `data:${mimeType};base64,${file.data}`;
  const dimensions = item.width && item.height ? `${item.width}x${item.height}` : '';
  const size = item.size ? `${Math.round(item.size / 1024)} KB` : '';
  if (el.fileViewerImageMeta) {
    el.fileViewerImageMeta.textContent = [dimensions, size, item.toolName || 'screenshot'].filter(Boolean).join(' / ');
  }
}

function setFileViewerMode(mode) {
  const imageMode = mode === 'image';
  const markdownMode = mode === 'markdown';
  const textMode = !imageMode && !markdownMode;
  if (el.fileViewerContent) {
    el.fileViewerContent.hidden = !textMode;
    if (!textMode) el.fileViewerContent.textContent = '';
  }
  if (el.fileViewerMarkdown) {
    el.fileViewerMarkdown.hidden = !markdownMode;
    if (!markdownMode) el.fileViewerMarkdown.innerHTML = '';
  }
  if (el.fileViewerImageShell) el.fileViewerImageShell.hidden = !imageMode;
  if (!imageMode && el.fileViewerImage) el.fileViewerImage.removeAttribute('src');
  if (!imageMode && el.fileViewerImageMeta) el.fileViewerImageMeta.textContent = '';
}

function closeFileViewer() {
  viewedFilePath = '';
  setFileViewerMode('text');
  if (el.fileViewerModal) el.fileViewerModal.classList.remove('active');
}

// --- CHAT INTERFACE & RENDERERS ---
function setupChatHandlers() {
  el.btnSubmit.addEventListener('click', () => {
    submitMessage();
  });
  if (el.btnStopAgent) {
    el.btnStopAgent.addEventListener('click', () => {
      if (window.isAgentRunning && window.isAgentRunning() && window.stopAgentExecution) {
        el.btnStopAgent.disabled = true;
        window.stopAgentExecution({ mode: 'hard' });
      }
    });
  }
  
  el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      if (window.isAgentRunning && window.isAgentRunning()) {
        triggerSteer();
      } else {
        submitMessage();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (window.isAgentRunning && window.isAgentRunning()) {
        triggerQueue();
      } else {
        submitMessage();
      }
    }
  });
  
  el.chatInput.addEventListener('input', () => {
    const steerBtn = document.getElementById('btn-steer');
    const queueBtn = document.getElementById('btn-queue');
    if (window.isAgentRunning && window.isAgentRunning()) {
      const hasText = el.chatInput.value.trim().length > 0;
      steerBtn.style.display = hasText ? 'block' : 'none';
      queueBtn.style.display = hasText ? 'block' : 'none';
    } else {
      steerBtn.style.display = 'none';
      queueBtn.style.display = 'none';
    }
  });
  
  document.getElementById('btn-steer').addEventListener('click', triggerSteer);
  document.getElementById('btn-queue').addEventListener('click', triggerQueue);
  el.messagesContainer.addEventListener('click', handleQueuedPromptActionClick);
  const addFileButton = document.getElementById('btn-add-file');
  if (addFileButton) {
    addFileButton.addEventListener('click', () => {
      const needsSpace = el.chatInput.value && !/\s$/.test(el.chatInput.value);
      el.chatInput.value += `${needsSpace ? ' ' : ''}@`;
      el.chatInput.focus();
      el.chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  
  el.btnNewChat.addEventListener('click', createNewConversation);
  if (el.btnAddConversation) {
    el.btnAddConversation.addEventListener('click', createNewConversation);
  }
  
  // Model Select changes default
  el.modelSelect.addEventListener('change', async () => {
    const val = el.modelSelect.value;
    appConfig.defaultModel = val;
    localStorage.setItem('ag2_default_model', val);
    await window.api.writeConfig(appConfig);
  });
}

function triggerSteer() {
  const text = el.chatInput.value.trim();
  if (!text) return;
  
  if (enqueueSteeringForConversation(text, activeConversationId)) {
    appendSteeringMessage(text, activeConversationId);
    checkpointSteeringInstruction(text, activeConversationId);
  }
  el.chatInput.value = '';
  document.getElementById('btn-steer').style.display = 'none';
  document.getElementById('btn-queue').style.display = 'none';
}

function triggerQueue() {
  const text = el.chatInput.value.trim();
  if (!text) return;
  
  if (window.promptQueue) {
    const queueItem = {
      id: createQueuedPromptId(),
      prompt: text,
      modelSelectValue: el.modelSelect.value,
      conversationId: activeConversationId,
      source: 'user-queue',
      createdAt: Date.now()
    };
    window.promptQueue.push(queueItem);
    appendQueuedMessage(text, queueItem);
  }
  el.chatInput.value = '';
  document.getElementById('btn-steer').style.display = 'none';
  document.getElementById('btn-queue').style.display = 'none';
}

function enqueueSteeringForConversation(text, conversationId = activeConversationId) {
  if (!text || !conversationId) return false;
  if (!window.steeringQueue || Array.isArray(window.steeringQueue)) {
    window.steeringQueue = {};
  }
  window.steeringQueue[conversationId] = window.steeringQueue[conversationId] || [];
  window.steeringQueue[conversationId].push(text);
  return true;
}

function checkpointSteeringInstruction(text, conversationId = activeConversationId) {
  const conv = conversations.find(c => c.id === conversationId);
  const workspace = (conv && (conv.workspace || conv.projectPath)) || currentWorkspace;
  if (workspace && window.mutateOperationalContext) {
    window.mutateOperationalContext(workspace, 'checkpoint', {
      reason: 'user_steering',
      summary: `User steering received: ${text.slice(0, 800)}`,
      nextAction: 'Apply the steering instruction before continuing the active subplan.'
    }).catch(error => console.warn('Could not checkpoint steering:', error));
  }
}

function appendSteeringMessage(text, conversationId = activeConversationId) {
  if (conversationId === activeConversationId) {
    renderSystemBubble(`[Steering] ${text}`);
  }
  const conv = conversations.find(c => c.id === conversationId);
  if (conv) {
    conv.messages.push({ role: 'steering', source: 'steering', text: `[Steering] ${text}`, createdAt: Date.now() });
    saveConversationsToStorage();
  }
}

function setupStartActions() {
  if (el.btnStartOpenRepo) {
    el.btnStartOpenRepo.addEventListener('click', async () => {
      const folderPath = await window.api.selectWorkspace();
      if (folderPath) setWorkspace(folderPath);
    });
  }
  if (el.btnStartNewTask) {
    el.btnStartNewTask.addEventListener('click', () => {
      el.chatInput.focus();
    });
  }
  if (el.btnStartResume) {
    el.btnStartResume.addEventListener('click', () => {
      const existing = conversations.find(c => c.messages && c.messages.length > 0);
      if (existing) selectConversation(existing.id);
      el.chatInput.focus();
    });
  }
}

function createQueuedPromptId() {
  return 'queue_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function appendQueuedMessage(text, queueItem = {}) {
  const item = {
    id: queueItem.id || createQueuedPromptId(),
    prompt: text,
    modelSelectValue: queueItem.modelSelectValue || (el.modelSelect && el.modelSelect.value),
    conversationId: queueItem.conversationId || activeConversationId,
    source: queueItem.source || 'user-queue',
    createdAt: queueItem.createdAt || Date.now()
  };
  if (item.conversationId === activeConversationId) {
    el.welcomeSplash.style.display = 'none';
    el.messagesContainer.style.display = 'flex';
    renderQueuedPromptBubble(item);
  }
  const conv = conversations.find(c => c.id === item.conversationId);
  if (conv) {
    conv.messages.push({
      role: 'system',
      source: 'queued-prompt',
      text: `Prompt queued: "${text}"`,
      queueId: item.id,
      queuedPrompt: text,
      queueState: 'queued',
      modelSelectValue: item.modelSelectValue,
      createdAt: item.createdAt
    });
    saveConversationsToStorage();
  }
}

function getPromptQueueIndex(queueId, conversationId) {
  if (!queueId || !Array.isArray(window.promptQueue)) return -1;
  return window.promptQueue.findIndex(item =>
    item && item.id === queueId && (!conversationId || item.conversationId === conversationId)
  );
}

function removePromptQueueItem(queueId, conversationId) {
  const index = getPromptQueueIndex(queueId, conversationId);
  if (index === -1) return null;
  const [item] = window.promptQueue.splice(index, 1);
  return item || null;
}

function findQueuedPromptMessage(queueId, conversationId) {
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv || !Array.isArray(conv.messages)) return { conv: null, message: null };
  const message = conv.messages.find(msg => msg && msg.queueId === queueId);
  return { conv, message };
}

function getQueuedPromptStatus(item) {
  const queueId = item.id || item.queueId;
  const conversationId = item.conversationId || activeConversationId;
  const queueIndex = getPromptQueueIndex(queueId, conversationId);
  const queueState = item.queueState || 'queued';
  if (queueState === 'steered') return 'Converted to steering';
  if (queueState === 'sent') return 'Sent to Orion';
  if (queueIndex === 0) return 'Runs next';
  if (queueIndex > 0) return `Queued #${queueIndex + 1}`;
  return 'No longer queued';
}

function buildQueuedPromptBubble(item) {
  const queueId = String(item.id || item.queueId || '');
  const conversationId = String(item.conversationId || activeConversationId || '');
  const prompt = String(item.prompt || item.queuedPrompt || '');
  const queueIndex = getPromptQueueIndex(queueId, conversationId);
  const isPending = queueIndex !== -1;
  const runningId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const isThisConversationRunning = !!(window.isAgentRunning && window.isAgentRunning() && runningId === conversationId);
  const canSteer = isPending && isThisConversationRunning;
  const canSendNow = isPending;
  const statusText = getQueuedPromptStatus(item);
  const resolvedClass = isPending ? '' : ' is-resolved';
  const steerTitle = canSteer
    ? 'Turn this queued prompt into steering for the current run'
    : 'Steer is available only while this conversation is the running task';
  const sendTitle = canSendNow
    ? 'Move this prompt to the front of the queue, or start it if Orion is idle'
    : 'This queued prompt has already been handled';

  const bubble = document.createElement('div');
  bubble.className = `message-bubble queued-prompt-bubble${resolvedClass}`;
  bubble.dataset.queueId = queueId;
  bubble.dataset.conversationId = conversationId;
  bubble.innerHTML = `
    <div class="message-header queued">Queued Prompt</div>
    <div class="message-body queued-prompt-body">
      <div class="queued-prompt-copy">${escapeHtml(prompt).replace(/\n/g, '<br>')}</div>
      <div class="queued-prompt-footer">
        <span class="queued-prompt-status">${escapeHtml(statusText)}</span>
        <div class="queued-prompt-actions">
          <button class="queued-prompt-action" type="button" data-action="steer" data-queue-id="${escapeHtml(queueId)}" data-conversation-id="${escapeHtml(conversationId)}" title="${escapeHtml(steerTitle)}"${canSteer ? '' : ' disabled'}>Steer</button>
          <button class="queued-prompt-action primary" type="button" data-action="send-now" data-queue-id="${escapeHtml(queueId)}" data-conversation-id="${escapeHtml(conversationId)}" title="${escapeHtml(sendTitle)}"${canSendNow ? '' : ' disabled'}>Send now</button>
        </div>
      </div>
    </div>
  `;
  return bubble;
}

function renderQueuedPromptBubble(item) {
  const stickToBottom = shouldAutoScrollChat();
  el.messagesContainer.appendChild(buildQueuedPromptBubble(item));
  scrollChatToBottomIfNeeded(stickToBottom);
}

function refreshQueuedPromptBubble(queueId, conversationId) {
  if (conversationId !== activeConversationId || !el.messagesContainer) return;
  const bubble = el.messagesContainer.querySelector(`[data-queue-id="${queueId}"]`);
  if (!bubble) return;
  const { message } = findQueuedPromptMessage(queueId, conversationId);
  const item = message
    ? {
        ...message,
        id: message.queueId,
        prompt: message.queuedPrompt,
        conversationId
      }
    : { id: queueId, conversationId };
  const stickToBottom = shouldAutoScrollChat();
  bubble.replaceWith(buildQueuedPromptBubble(item));
  scrollChatToBottomIfNeeded(stickToBottom);
}

function setQueuedPromptMessageState(queueId, conversationId, queueState) {
  const { conv, message } = findQueuedPromptMessage(queueId, conversationId);
  if (message) {
    message.queueState = queueState;
    message.updatedAt = Date.now();
    if (queueState === 'steered') {
      message.text = `Queued prompt converted to steering: "${message.queuedPrompt || ''}"`;
    } else if (queueState === 'sent') {
      message.text = `Queued prompt sent: "${message.queuedPrompt || ''}"`;
    }
  }
  if (conv) saveConversationsToStorage();
  refreshQueuedPromptBubble(queueId, conversationId);
}

function handleQueuedPromptActionClick(event) {
  const button = event.target.closest('.queued-prompt-action');
  if (!button || button.disabled) return;
  event.preventDefault();
  const queueId = button.dataset.queueId;
  const conversationId = button.dataset.conversationId || activeConversationId;
  if (button.dataset.action === 'steer') {
    promoteQueuedPromptToSteering(queueId, conversationId);
  } else if (button.dataset.action === 'send-now') {
    sendQueuedPromptNow(queueId, conversationId);
  }
}

function promoteQueuedPromptToSteering(queueId, conversationId) {
  const runningId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const isThisConversationRunning = !!(window.isAgentRunning && window.isAgentRunning() && runningId === conversationId);
  if (!isThisConversationRunning) {
    showToast('Steer is available only for the task currently running.', 'attention');
    refreshQueuedPromptBubble(queueId, conversationId);
    return;
  }
  const item = removePromptQueueItem(queueId, conversationId);
  if (!item) {
    showToast('That queued prompt is no longer waiting.', 'attention');
    setQueuedPromptMessageState(queueId, conversationId, 'sent');
    return;
  }
  if (enqueueSteeringForConversation(item.prompt, conversationId)) {
    setQueuedPromptMessageState(queueId, conversationId, 'steered');
    checkpointSteeringInstruction(item.prompt, conversationId);
    showToast('Queued prompt changed to steering.', 'success');
  }
}

function sendQueuedPromptNow(queueId, conversationId) {
  const item = removePromptQueueItem(queueId, conversationId);
  if (!item) {
    showToast('That queued prompt is no longer waiting.', 'attention');
    setQueuedPromptMessageState(queueId, conversationId, 'sent');
    return;
  }
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return;

  if (window.isAgentRunning && window.isAgentRunning()) {
    window.promptQueue.unshift(item);
    setQueuedPromptMessageState(queueId, conversationId, 'queued');
    refreshQueuedPromptBubble(queueId, conversationId);
    showToast('Queued prompt moved to the front.', 'success');
    return;
  }

  if (!window.runAgentLoop) {
    window.promptQueue.unshift(item);
    showToast('Agent engine is still loading. The prompt is first in queue.', 'attention');
    refreshQueuedPromptBubble(queueId, conversationId);
    return;
  }

  setQueuedPromptMessageState(queueId, conversationId, 'sent');
  if (!item.alreadyRendered && conv.messages) {
    conv.messages.push({ role: 'user', source: item.source || 'queue', text: item.prompt, createdAt: Date.now() });
    saveConversationsToStorage();
  }
  if (conversationId === activeConversationId && !item.alreadyRendered) {
    renderUserMessage(item.prompt);
  }
  window.runAgentLoop(item.prompt, item.modelSelectValue || (el.modelSelect && el.modelSelect.value), conv, {
    source: item.source || 'queue'
  }).catch(error => {
    console.error('Queued prompt send-now run failed:', error);
    appendSystemMessage(`Queued prompt failed to start: ${error.message}`, { conversationId });
  });
}

function markQueuedPromptRunning(queueId, conversationId) {
  setQueuedPromptMessageState(queueId, conversationId, 'sent');
}

function createNewConversation() {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const title = 'New Conversation';
  
  const newConv = {
    id: newId,
    title: title,
    projectPath: '',
    workspace: '', // will slugify on first prompt
    messages: [],
    tasks: [],
    testResults: null
  };
  
  conversations.unshift(newConv);
  saveConversationsToStorage();
  
  // Clear any existing input text
  el.chatInput.value = '';
  
  // Properly select the new conversation to reset active state, workspace folders, and file trees
  selectConversation(newId);
  
  // Focus the input box so the user can type immediately
  el.chatInput.focus();
}

function createNewConversationUnderProject(projectPath) {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const title = 'New Conversation';
  
  const newConv = {
    id: newId,
    title: title,
    projectPath: projectPath,
    workspace: '', // set on first prompt
    messages: [],
    tasks: [],
    testResults: null
  };
  
  conversations.unshift(newConv);
  saveConversationsToStorage();
  
  // Clear any existing input text
  el.chatInput.value = '';
  
  // Properly select the new conversation to reset active state, workspace folders, and file trees
  selectConversation(newId);
  
  // Focus the input box so the user can type immediately
  el.chatInput.focus();
}

function getStandaloneWorkspaceRoot() {
  const configured = (appConfig.standaloneWorkspaceRoot || '').trim();
  if (configured) return configured.replace(/[\\\/]+$/, '');
  return appConfig.standaloneWorkspaceDefault || 'C:\\Users\\Owner\\Desktop\\Projects\\OrionAI\\standalone-workspaces';
}

function getStandaloneWorkspaceForTitle(title, convId) {
  const slug = slugify(title || 'new-conversation') || 'new-conversation';
  // Append a short unique suffix derived from the conversation ID so two
  // conversations with identical titles never share the same workspace folder.
  const suffix = convId ? '-' + String(convId).replace(/[^a-z0-9]/gi, '').slice(-8) : '';
  return getStandaloneWorkspaceRoot() + '\\' + slug + suffix;
}

function createPhoneConversation({ projectPath = '', title = 'New Phone Task' } = {}) {
  const convId = 'conv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const normalizedProjectPath = String(projectPath || '').trim();
  const conv = {
    id: convId,
    title,
    messages: [],
    createdAt: Date.now(),
    workspace: normalizedProjectPath || '',
    projectPath: normalizedProjectPath,
    tasks: [],
    awaitingPlanApproval: false,
    planApproved: false,
    awaitingClarification: null
  };
  conversations.unshift(conv);
  saveConversationsToStorage();
  return conv;
}

let conversationSaveRevision = 0;
let lastConversationDiskSaveError = '';

function parseConversationStorageCandidate(raw, label) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) throw new Error(`${label} is not an array`);
    return parsed;
  } catch (error) {
    console.warn(`Failed to parse ${label}`, error);
    return [];
  }
}

function conversationMessageValue(conversation) {
  const messages = Array.isArray(conversation && conversation.messages) ? conversation.messages : [];
  let meaningfulAssistant = 0;
  let logCount = 0;
  messages.forEach(message => {
    const role = normalizeConversationMessageRole(message);
    const text = extractConversationMessageText(message);
    const logs = extractConversationMessageLogs(message);
    if (role === 'assistant' && text && text.trim() !== 'Thinking...') meaningfulAssistant++;
    logCount += Array.isArray(logs) ? logs.length : 0;
  });
  return meaningfulAssistant * 100000 + logCount * 1000 + messages.length * 10;
}

function conversationSortTime(conversation) {
  const messages = Array.isArray(conversation && conversation.messages) ? conversation.messages : [];
  const messageTimes = messages
    .map(message => Number(message && (message.updatedAt || message.createdAt || message.timestamp || 0)))
    .filter(Boolean);
  return Math.max(
    Number(conversation && conversation.updatedAt || 0),
    Number(conversation && conversation.createdAt || 0),
    ...messageTimes,
    0
  );
}

function chooseRicherConversation(current, candidate) {
  if (!current) return candidate;
  const currentScore = conversationMessageValue(current);
  const candidateScore = conversationMessageValue(candidate);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }
  return conversationSortTime(candidate) >= conversationSortTime(current) ? candidate : current;
}

function mergeConversationSets(...sets) {
  const byId = new Map();
  sets.flat().forEach(conversation => {
    if (!conversation || !conversation.id) return;
    const existing = byId.get(conversation.id);
    byId.set(conversation.id, chooseRicherConversation(existing, conversation));
  });
  return [...byId.values()].sort((a, b) => conversationSortTime(b) - conversationSortTime(a));
}

async function loadConversationsFromStorage() {
  const local = parseConversationStorageCandidate(localStorage.getItem('ag2_conversations'), 'ag2_conversations');
  const backup = parseConversationStorageCandidate(localStorage.getItem('ag2_conversations_backup'), 'ag2_conversations_backup');
  let disk = [];
  if (window.api && typeof window.api.readConversations === 'function') {
    try {
      const result = await window.api.readConversations();
      if (result && result.success && Array.isArray(result.conversations)) {
        disk = result.conversations;
      } else if (result && result.error) {
        console.warn('Failed to read disk conversation store', result.error);
      }
    } catch (error) {
      console.warn('Disk conversation store is unavailable', error);
    }
  }
  conversations = mergeConversationSets(disk, local, backup);
  scrubLegacyPhoneCompanionTokenMessages();
  if (conversations.length > 0) {
    saveConversationsToStorage();
  }
}

function migrateConversations() {
  let projectsUpdated = false;
  
  // 1. Recover missing projects from orphaned conversations
  conversations.forEach(c => {
    if (c.projectPath) {
      const exists = projects.find(p => p.toLowerCase() === c.projectPath.toLowerCase());
      if (!exists) {
        projects.push(c.projectPath);
        projectsUpdated = true;
      }
    }
  });
  
  if (projectsUpdated) {
    saveProjectsToStorage();
  }

  let updated = false;
  conversations.forEach(c => {
    if (!c.projectPath && c.workspace) {
      // Find if workspace is inside any project folder
      const matchingProj = projects.find(proj => {
        const lowerWorkspace = c.workspace.toLowerCase();
        const lowerProj = proj.toLowerCase();
        return lowerWorkspace.startsWith(lowerProj);
      });
      if (matchingProj) {
        c.projectPath = matchingProj;
        updated = true;
      }
    }
    if (Array.isArray(c.messages)) {
      const before = c.messages.length;
      c.messages = c.messages.filter(msg => !isLegacyPhoneCompanionTokenMessage(msg && msg.text));
      if (c.messages.length !== before) updated = true;
    }
  });
  if (updated) {
    saveConversationsToStorage();
  }
}

function isLegacyPhoneCompanionTokenMessage(text) {
  return /Phone Companion is available on this Wi-Fi at .*[\?&]token=/i.test(String(text || ''));
}

function removeLegacyPhoneCompanionTokenBubbles() {
  if (!el.messagesContainer) return;
  el.messagesContainer.querySelectorAll('.message-bubble').forEach(bubble => {
    if (isLegacyPhoneCompanionTokenMessage(bubble.textContent || '')) {
      bubble.remove();
    }
  });
}

const CHAT_BOTTOM_THRESHOLD_PX = 96;

function shouldAutoScrollChat() {
  if (!el.chatFeed) return false;
  const distanceFromBottom = el.chatFeed.scrollHeight - el.chatFeed.scrollTop - el.chatFeed.clientHeight;
  return distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
}

function scrollChatToBottom() {
  if (el.chatFeed) {
    el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
  }
}

function scrollChatToBottomIfNeeded(shouldScroll) {
  if (shouldScroll) scrollChatToBottom();
}

function isEmptyThinkingPlaceholder(text, logs = []) {
  const hasLogs = Array.isArray(logs) && logs.length > 0;
  return String(text || '').trim() === 'Thinking...' && !hasLogs;
}

function normalizeConversationMessageRole(msg) {
  const role = String((msg && msg.role) || '').toLowerCase();
  if (role === 'assistant' || role === 'model' || role === 'ai' || role === 'orion') return 'assistant';
  if (role === 'user' || role === 'human') return 'user';
  return role;
}

function extractConversationMessageText(msg) {
  if (!msg) return '';
  const directFields = [msg.text, msg.content, msg.output, msg.result, msg.message];
  for (const field of directFields) {
    if (typeof field === 'string' && field.trim()) return field;
  }
  const arrayFields = [msg.parts, msg.content];
  for (const field of arrayFields) {
    if (!Array.isArray(field)) continue;
    const text = field.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.output_text === 'string') return part.output_text;
      return '';
    }).filter(Boolean).join('\n');
    if (text.trim()) return text;
  }
  return '';
}

function stringifyReplayToolResult(response) {
  if (response === undefined || response === null) return '';
  return typeof response === 'string' ? response : JSON.stringify(response, null, 2);
}

function responseLooksFailed(response) {
  if (!response || typeof response !== 'object') return false;
  if (response.error || response.failureCategory || response.repeatedFailure || response.blocked) return true;
  if (response.success === false) return true;
  if (response.exitCode !== undefined && Number(response.exitCode) !== 0) return true;
  if (response.code !== undefined && Number(response.code) !== 0) return true;
  return false;
}

function extractConversationMessageLogs(msg) {
  if (Array.isArray(msg && msg.logs) && msg.logs.length) return msg.logs;
  const turns = Array.isArray(msg && msg.turns) ? msg.turns : [];
  const rebuiltLogs = [];
  turns.forEach(turn => {
    const modelParts = Array.isArray(turn && turn.modelParts) ? turn.modelParts : [];
    modelParts.forEach(part => {
      const call = part && part.functionCall;
      if (!call) return;
      rebuiltLogs.push({
        type: 'tool_call',
        tool: call.name || 'tool',
        params: call.args || {},
        status: 'running'
      });
    });

    const responseParts = Array.isArray(turn && turn.toolResponseParts) ? turn.toolResponseParts : [];
    responseParts.forEach(part => {
      const fnResponse = part && part.functionResponse;
      if (!fnResponse) return;
      const response = fnResponse.response || {};
      const pending = [...rebuiltLogs].reverse().find(log =>
        log.type === 'tool_call' &&
        log.tool === (fnResponse.name || log.tool) &&
        (!log.result || log.status === 'running')
      );
      const target = pending || {
        type: 'tool_call',
        tool: fnResponse.name || 'tool',
        params: {},
        status: 'running'
      };
      target.status = responseLooksFailed(response) ? 'error' : 'success';
      target.result = stringifyReplayToolResult(response);
      if (!pending) rebuiltLogs.push(target);
    });
  });
  return rebuiltLogs;
}

function normalizeConversationMessageForReplay(msg) {
  return {
    ...(msg || {}),
    role: normalizeConversationMessageRole(msg),
    text: extractConversationMessageText(msg),
    logs: extractConversationMessageLogs(msg || {})
  };
}

function scrubLegacyPhoneCompanionTokenMessages() {
  let updated = false;
  conversations.forEach(c => {
    if (!Array.isArray(c.messages)) return;
    const before = c.messages.length;
    c.messages = c.messages.filter(msg => !isLegacyPhoneCompanionTokenMessage(msg && msg.text));
    if (c.messages.length !== before) updated = true;
  });
  if (updated) saveConversationsToStorage();
}

async function refreshPhoneCompanionPairing() {
  if (!window.api || typeof window.api.getPhoneCompanionPairing !== 'function') return;
  try {
    const payload = await window.api.getPhoneCompanionPairing();
    if (payload && payload.success !== false) {
      updatePhoneCompanionPairingPanel(payload);
    }
  } catch (error) {
    console.warn('Phone companion pairing payload unavailable:', error);
  }
}

function saveConversationsToStorage() {
  const revision = ++conversationSaveRevision;
  let snapshot = null;
  try {
    snapshot = JSON.parse(JSON.stringify(conversations));
  } catch (error) {
    console.error("Failed to serialize conversations", error);
    return;
  }

  if (window.api && typeof window.api.writeConversations === 'function') {
    window.api.writeConversations({ revision, conversations: snapshot }).then(result => {
      if (result && result.success) {
        lastConversationDiskSaveError = '';
      } else {
        lastConversationDiskSaveError = result && result.error ? result.error : 'Unknown disk save error';
        console.error("Failed to save conversations to disk", lastConversationDiskSaveError);
      }
    }).catch(error => {
      lastConversationDiskSaveError = error.message || String(error);
      console.error("Failed to save conversations to disk", error);
    });
  }

  try {
    const serialized = JSON.stringify(snapshot);
    localStorage.setItem('ag2_conversations', serialized);
    localStorage.setItem('ag2_conversations_backup', serialized);
  } catch (e) {
    console.error("Failed to save conversations to localStorage; disk persistence remains primary", e);
  }

  if (window.api && typeof window.api.syncPhoneCompanion === 'function') {
    window.api.syncPhoneCompanion();
  }
}

function showOrionConfirmDialog({ title = 'Confirm action', message = '', confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let overlay = document.getElementById('orion-confirm-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'orion-confirm-modal';
      overlay.className = 'modal-overlay orion-confirm-overlay';
      overlay.innerHTML = `
        <div class="modal-card orion-confirm-card" role="dialog" aria-modal="true" aria-labelledby="orion-confirm-title">
          <div class="modal-header">
            <h2 id="orion-confirm-title"></h2>
            <button class="modal-close" id="orion-confirm-close" type="button" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">
            <p id="orion-confirm-message" class="orion-confirm-message"></p>
          </div>
          <div class="modal-footer orion-confirm-actions">
            <button class="secondary-btn" id="orion-confirm-cancel" type="button">Cancel</button>
            <button class="primary-btn" id="orion-confirm-accept" type="button"></button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const titleEl = overlay.querySelector('#orion-confirm-title');
    const messageEl = overlay.querySelector('#orion-confirm-message');
    const acceptBtn = overlay.querySelector('#orion-confirm-accept');
    const cancelBtn = overlay.querySelector('#orion-confirm-cancel');
    const closeBtn = overlay.querySelector('#orion-confirm-close');
    const previousActiveElement = document.activeElement;
    titleEl.textContent = title;
    messageEl.textContent = message;
    acceptBtn.textContent = confirmLabel;
    acceptBtn.classList.toggle('danger', !!danger);

    const finish = confirmed => {
      overlay.classList.remove('active');
      acceptBtn.removeEventListener('click', onAccept);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKeydown);
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
      resolve({ confirmed: !!confirmed });
    };
    const onAccept = () => finish(true);
    const onCancel = () => finish(false);
    const onOverlay = event => {
      if (event.target === overlay) finish(false);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') {
        finish(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(node => !node.disabled && node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    acceptBtn.addEventListener('click', onAccept);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKeydown);
    overlay.classList.add('active');
    cancelBtn.focus();
  });
}

function confirmConversationDelete(title) {
  return showOrionConfirmDialog({
    title: 'Delete conversation?',
    message: `Delete "${title || 'Untitled Conversation'}" from Orion? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true
  });
}

function renderConversationList() {
  el.conversationList.innerHTML = '';
  
  // Standalone conversations have no projectPath
  const standaloneConversations = conversations.filter(c => !c.projectPath);
  
  if (standaloneConversations.length === 0) {
    el.conversationList.innerHTML = '<p class="empty-state" style="font-size:0.75rem; font-style:italic;">No standalone conversations yet</p>';
    return;
  }
  
  standaloneConversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = `conversation-item ${conv.id === activeConversationId ? 'active' : ''}`;
    
    const age = 'now';
    
    item.innerHTML = `
      <div class="conversation-details row-details-flex">
        <span class="conversation-name">${escapeHtml(conv.title)}</span>
        <span class="conversation-time">${age}</span>
      </div>
      <button class="delete-btn icon-btn-ghost" title="Delete conversation">&times;</button>
    `;

    item.querySelector('.conversation-details').addEventListener('click', () => selectConversation(conv.id));
    
    item.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const approved = await confirmConversationDelete(conv.title);
      if (approved?.confirmed) {
        deleteConversation(conv.id);
      }
    });

    el.conversationList.appendChild(item);
  });
}

function selectConversation(id) {
  activeConversationId = id;
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  
  el.chatTitle.textContent = conv.title;
  normalizeConversationWorkspace(conv);
  
  // Set active workspace to conversation workspace if initialized,
  // otherwise show pending first message
  if (conv.workspace) {
    currentWorkspace = conv.workspace;
    expandedFileFolders = new Set();
    const wsName = conv.workspace.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || conv.workspace;
    el.workspaceLabel.textContent = wsName;
    syncWorkspaceFiles();
  } else {
    // Brand new conversation
    currentWorkspace = '';
    el.workspaceLabel.textContent = conv.projectPath ? conv.projectPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || conv.projectPath : '';
    el.fileTree.innerHTML = '<p class="empty-state">Workspace will initialize upon sending your first prompt.</p>';
    el.fileCountBadge.textContent = '0';
    if (el.workspaceFilesPanel) el.workspaceFilesPanel.classList.add('contextual-panel-hidden');
  }
  
  renderConversationList();
  renderProjectsList(); // Re-render projects to update active state highlights
  
  // Reload messages
  if (conv.messages.length === 0) {
    el.welcomeSplash.style.display = 'flex';
    el.messagesContainer.style.display = 'none';
    el.messagesContainer.innerHTML = '';
  } else {
    el.welcomeSplash.style.display = 'none';
    el.messagesContainer.style.display = 'flex';
    el.messagesContainer.innerHTML = '';
    
    const replayMessages = conv.messages.map(normalizeConversationMessageForReplay);
    replayMessages.forEach(replayMsg => {
      const replayLogs = Array.isArray(replayMsg.logs) ? replayMsg.logs : [];
      window.clearActiveAiBubble();
      if (replayMsg.role === 'user') {
        renderUserMessage(replayMsg.text);
      } else if (replayMsg.role === 'assistant') {
        if (isEmptyThinkingPlaceholder(replayMsg.text, replayLogs)) return;
        renderAiMessage(replayMsg.text, replayLogs, activeConversationId, replayMsg);
      } else if (replayMsg.role === 'steering') {
        renderSystemBubble(replayMsg.text);
      } else if (replayMsg.role === 'system') {
        if (replayMsg.source === 'queued-prompt') {
          renderQueuedPromptBubble({
            ...replayMsg,
            id: replayMsg.queueId,
            prompt: replayMsg.queuedPrompt,
            conversationId: activeConversationId
          });
        } else {
          renderSystemBubble(replayMsg.text);
        }
      }
    });
    const queuedForThisConversation = Array.isArray(window.promptQueue)
      && window.promptQueue.some(item => item && item.conversationId === activeConversationId);
    const recoveredAssistantMessage = buildMissingAssistantResponseMessage(replayMessages, {
      queued: queuedForThisConversation
    });
    if (recoveredAssistantMessage) {
      window.clearActiveAiBubble();
      renderAiMessage(recoveredAssistantMessage.text, [], activeConversationId, recoveredAssistantMessage);
    }
    window.clearActiveAiBubble();
    removeLegacyPhoneCompanionTokenBubbles();
  }
  
  // Reload tasks & tests
  updateTasksChecklist(conv.tasks);
  updateTestResultsPanel(conv.testResults);
  refreshOperationalContext(conv.workspace);
  loadRunArtifacts();
  if (conv.awaitingPlanApproval && !conv.planApproved) {
    revealAgentPanel('A plan is ready for review.');
    renderAgentPresence('attention', 'Review needed', 'Implementation plan is waiting for approval');
  } else if (!(window.isAgentRunning && window.isAgentRunning())) {
    renderAgentPresence('idle', 'Ready', '');
  }
  
  // Scroll to bottom
  scrollChatToBottom();
  
  // Focus the input box so the user can immediately type
  el.chatInput.focus();
}

// Submits User prompt to Gemini Agent Loop
async function submitMessage() {
  const prompt = el.chatInput.value.trim();
  if (!prompt) return;
  
  if (!appConfig.geminiApiKey) {
    el.settingsModal.classList.add('active');
    appendSystemMessage("Please enter and save your Gemini API Key first.");
    return;
  }
  
  const conv = conversations.find(c => c.id === activeConversationId);
  if (!conv) return;
  normalizeConversationWorkspace(conv);
  
  // Hide splash
  el.welcomeSplash.style.display = 'none';
  el.messagesContainer.style.display = 'flex';
  
  // Render user prompt
  renderUserMessage(prompt);
  el.chatInput.value = '';
  
  // Rename the conversation from its first message. Gated on message count/title rather than
  // `!conv.workspace` — for project-scoped conversations, normalizeConversationWorkspace() above
  // already fills in conv.workspace from conv.projectPath before this point, which made the old
  // `!conv.workspace` check always false and silently skipped the rename for every conversation
  // created under a project (they kept the "New Conversation" title forever).
  if (conv.messages.length === 0 && (!conv.title || conv.title === 'New Conversation')) {
    conv.title = generateConversationTitle(prompt);
    el.chatTitle.textContent = conv.title;
    renderConversationList();
  }

  // Initialize the folder path if this is still the first prompt (project-scoped conversations
  // already have this from normalizeConversationWorkspace above).
  if (!conv.workspace) {
    if (conv.projectPath) {
      conv.workspace = conv.projectPath;
    } else {
      conv.workspace = getStandaloneWorkspaceForTitle(conv.title, conv.id);
    }
  }

  // Ensure currentWorkspace is locked onto this isolated folder
  currentWorkspace = conv.workspace;
  expandedFileFolders = new Set();
  el.workspaceLabel.textContent = currentWorkspace.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentWorkspace;
  syncWorkspaceFiles();
  
  // Update messages history
  conv.messages.push({ role: 'user', text: prompt });
  saveConversationsToStorage();
  
  renderConversationList();
  renderProjectsList();
  
  // Scroll to bottom for the local send action.
  scrollChatToBottom();
  
  // Trigger local Agent loop
  if (window.runAgentLoop) {
    const selectedModel = el.modelSelect.value;
    if (window.isAgentRunning && window.isAgentRunning()) {
      window.promptQueue.push({ prompt, modelSelectValue: selectedModel, conversationId: conv.id, alreadyRendered: true });
      persistAssistantStatusMessage(conv.id, "Queued. Orion will start this after the current task finishes.", {
        source: 'queue-status',
        dedupeKey: `queued-${conv.id}-${prompt}`
      });
    } else {
      await window.runAgentLoop(prompt, selectedModel, conv);
      loadRunArtifacts();
    }
  } else {
    appendSystemMessage("Agent engine is loading... your message will run automatically when ready.");
    const pendingPrompt = prompt;
    const pendingConv = conv;
    const waitForEngine = setInterval(async () => {
      if (window.runAgentLoop) {
        clearInterval(waitForEngine);
        const selectedModel = el.modelSelect.value;
        if (window.isAgentRunning && window.isAgentRunning()) {
          window.promptQueue.push({ prompt: pendingPrompt, modelSelectValue: selectedModel, conversationId: pendingConv.id, alreadyRendered: true });
          persistAssistantStatusMessage(pendingConv.id, "Queued. Orion will start this after the current task finishes.", {
            source: 'queue-status',
            dedupeKey: `queued-${pendingConv.id}-${pendingPrompt}`
          });
        } else {
          await window.runAgentLoop(pendingPrompt, selectedModel, pendingConv);
          loadRunArtifacts();
        }
      }
    }, 500);
    setTimeout(() => clearInterval(waitForEngine), 30000);
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function toTitleCase(str) {
  const minors = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'in', 'of', 'up', 'as', 'is', 'it', 'vs']);
  const upperAbbrevs = new Set(['ai', 'llm', 'gpt', 'api', 'url', 'ui', 'ux', 'css', 'html', 'json', 'sql', 'db', 'cli', 'sdk', 'aws', 'ide', 'gpu', 'cpu', 'ram', 'os', 'ci', 'cd', 'qa', 'jwt', 'ssh', 'ftp', 'http', 'https', 'xml', 'csv', 'pdf', 'id', 'io']);
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/\b\w+/g, (word, offset) => {
      if (upperAbbrevs.has(word)) return word.toUpperCase();
      if (offset === 0 || !minors.has(word)) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    });
}

function generateConversationTitle(prompt) {
  let text = String(prompt || '').trim();

  // Strip common leading filler patterns
  const leadingFillers = [
    /^i have a (?:program|project|app|application|file|script|tool|repo|repository) called\s+/i,
    /^(?:can|could) you (?:please\s+)?/i,
    /^please\s+/i,
    /^i (?:need|want|would like) (?:you to\s+)?/i,
    /^help me (?:with\s+)?/i,
    /^orion[,\s]+/i,
  ];
  for (const pat of leadingFillers) {
    text = text.replace(pat, '').trim();
  }

  // If the text contains multiple sentences, take only the first meaningful one
  const sentenceBreak = text.search(/[.!?]\s+[A-Za-z]/);
  if (sentenceBreak > 8) text = text.substring(0, sentenceBreak).trim();

  // Strip location context ("in my projects folder on my desktop", etc.)
  text = text
    .replace(/\s+in my (?:projects?\s+folder(?:\s+on my desktop)?|desktop(?:\s+projects?\s+folder)?|projects?)\s*$/i, '')
    .replace(/\s+on my desktop\s*$/i, '')
    .replace(/\s+located (?:at|in)\s+\S+\s*$/i, '')
    .trim();

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Truncate at word boundary to ~45 chars
  if (text.length > 45) {
    const cut = text.substring(0, 45);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > 15 ? cut.substring(0, lastSpace) : cut) + '...';
  }

  return toTitleCase(text) || 'New Conversation';
}

function normalizeConversationWorkspace(conv) {
  if (!conv || !conv.projectPath) return;
  
  const projectPath = conv.projectPath;
  const workspace = conv.workspace || '';
  const nestedProjectWorkspace = workspace &&
    workspace.toLowerCase().startsWith((projectPath + '\\').toLowerCase());
  
  if (!workspace || nestedProjectWorkspace) {
    conv.workspace = projectPath;
    saveConversationsToStorage();
  }
}

// RENDER HELPER FUNCTIONS
function renderUserMessage(text) {
  const stickToBottom = shouldAutoScrollChat();
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="message-header user">🧑 User</div>
    <div class="message-body">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
  `;
  sanitizeRenderedMarkdown(bubble);
  el.messagesContainer.appendChild(bubble);
  scrollChatToBottomIfNeeded(stickToBottom);
}

function appendSystemMessage(text, options = {}) {
  if (isLegacyPhoneCompanionTokenMessage(text)) {
    removeLegacyPhoneCompanionTokenBubbles();
    return;
  }
  const runningId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const targetId = options.conversationId || runningId || activeConversationId;
  const dedupeKey = options.dedupeKey || text;
  const windowMs = Number(options.windowMs || 1500);
  window.recentSystemMessages = window.recentSystemMessages || {};
  const now = Date.now();
  const lastAt = window.recentSystemMessages[dedupeKey] || 0;
  if (now - lastAt < windowMs) {
    return;
  }
  const conv = conversations.find(c => c.id === targetId);
  if (conv && options.dedupeKey) {
    conv.systemMessageDedupe = conv.systemMessageDedupe || {};
    const convLastAt = conv.systemMessageDedupe[dedupeKey] || 0;
    if (now - convLastAt < windowMs) {
      return;
    }
    conv.systemMessageDedupe[dedupeKey] = now;
  }
  window.recentSystemMessages[dedupeKey] = now;
  
  if (targetId === activeConversationId) {
    renderSystemBubble(text);
  }
  if (conv) {
    const sysMsg = { role: 'system', text: text };
    if (options.source === 'plan-approval') {
      sysMsg.source = 'plan-approval'; // Matches: role: 'system', source: 'plan-approval'
    } else if (options.source) {
      sysMsg.source = options.source;
    }
    conv.messages.push(sysMsg);
    saveConversationsToStorage();
  }
}

const MISSING_ASSISTANT_RESPONSE_TEXT = 'Run ended before Orion saved an assistant response. This transcript only contains your prompt, so there is no assistant answer to replay.';

function persistAssistantStatusMessage(conversationId, text, options = {}) {
  const targetId = conversationId || activeConversationId;
  const conv = conversations.find(c => c.id === targetId);
  if (!conv) return null;
  if (!Array.isArray(conv.messages)) conv.messages = [];

  const dedupeKey = options.dedupeKey || `${options.source || 'assistant-status'}:${text}`;
  const duplicate = conv.messages.some(msg =>
    msg &&
    msg.role === 'assistant' &&
    msg.statusOnly &&
    msg.dedupeKey === dedupeKey
  );
  if (duplicate) return null;

  const message = {
    role: 'assistant',
    source: options.source || 'assistant-status',
    text,
    logs: Array.isArray(options.logs) ? options.logs : [],
    turns: [],
    statusOnly: true,
    dedupeKey,
    createdAt: Date.now()
  };
  conv.messages.push(message);
  saveConversationsToStorage();
  if (targetId === activeConversationId) {
    renderAiMessage(text, message.logs, targetId, message);
  }
  renderConversationList();
  renderProjectsList();
  return message;
}

function buildMissingAssistantResponseMessage(normalizedMessages, options = {}) {
  if (!Array.isArray(normalizedMessages) || normalizedMessages.length === 0) return null;
  const lastUserIndex = normalizedMessages.map(msg => msg.role).lastIndexOf('user');
  if (lastUserIndex === -1) return null;
  const hasMeaningfulAssistantAfterUser = normalizedMessages.slice(lastUserIndex + 1).some(msg => {
    if (!msg || msg.role !== 'assistant') return false;
    const logs = Array.isArray(msg.logs) ? msg.logs : [];
    return !isEmptyThinkingPlaceholder(msg.text, logs);
  });
  if (hasMeaningfulAssistantAfterUser) return null;
  const queued = !!options.queued;
  const text = queued
    ? 'Queued. Orion will start this after the current task finishes.'
    : MISSING_ASSISTANT_RESPONSE_TEXT;
  return {
    role: 'assistant',
    source: queued ? 'queue-status' : 'missing-assistant-recovery',
    text,
    content: text,
    logs: [],
    turns: [],
    statusOnly: true,
    recovered: !queued
  };
}

function shouldDedupeSystemCard(dedupeKey, windowMs = 1500) {
  const key = dedupeKey || 'system-card';
  const now = Date.now();
  window.recentSystemMessages = window.recentSystemMessages || {};
  const lastAt = window.recentSystemMessages[key] || 0;
  if (now - lastAt < windowMs) return true;
  const conv = conversations.find(c => c.id === activeConversationId);
  if (conv) {
    conv.systemMessageDedupe = conv.systemMessageDedupe || {};
    const convLastAt = conv.systemMessageDedupe[key] || 0;
    if (now - convLastAt < windowMs) return true;
    conv.systemMessageDedupe[key] = now;
  }
  window.recentSystemMessages[key] = now;
  return false;
}

function showPhoneCompanionPairingCard(payload = {}, options = {}) {
  updatePhoneCompanionPairingPanel(payload);
  removeLegacyPhoneCompanionTokenBubbles();
}

function updatePhoneCompanionPairingPanel(payload = {}) {
  const pairUrl = String(payload.pairUrl || '');
  const networkEnabled = payload.networkEnabled !== false && !!pairUrl;
  const expiresText = payload.expiresAt ? `Expires: ${new Date(payload.expiresAt).toLocaleTimeString()}` : 'Short-lived pairing link';
  if (el.btnPhoneCompanion) {
    el.btnPhoneCompanion.style.display = '';
    el.btnPhoneCompanion.classList.toggle('has-pairing', networkEnabled);
  }
  if (el.phoneCompanionQr) {
    el.phoneCompanionQr.innerHTML = networkEnabled
      ? String(payload.qrSvg || '')
      : '<div class="phone-companion-disabled">Wi-Fi pairing is off</div>';
  }
  if (el.phoneCompanionPairUrl) {
    el.phoneCompanionPairUrl.textContent = networkEnabled
      ? pairUrl
      : 'Click Phone to enable Wi-Fi pairing for this session.';
  }
  if (el.phoneCompanionMeta) {
    el.phoneCompanionMeta.textContent = networkEnabled
      ? `${expiresText}. Desktop approval required.`
      : 'LAN companion mode is disabled by default. No localhost QR is shown for phones.';
  }
  refreshPairedDevicesList().catch(() => {});
}

async function refreshPairedDevicesList() {
  const listContainer = document.getElementById('paired-devices-list');
  const sectionContainer = document.getElementById('paired-devices-section');
  if (!listContainer || !sectionContainer || !window.api || typeof window.api.getPhoneCompanionDevices !== 'function') return;

  try {
    const devices = await window.api.getPhoneCompanionDevices();
    if (devices && devices.length > 0) {
      sectionContainer.style.display = 'block';
      listContainer.innerHTML = devices.map(d => {
        const lastSeen = d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleTimeString() : 'Never';
        const statusText = d.revoked ? 'Revoked' : 'Active';
        const badgeClass = d.revoked ? 'fail' : 'pass';
        
        return `
          <div class="device-item">
            <div class="device-copy">
              <div class="device-name">${escapeHtml(d.name)}</div>
              <div class="device-meta">Last seen: ${escapeHtml(lastSeen)}</div>
            </div>
            <div class="device-actions">
              <span class="status-indicator ${badgeClass}">${statusText}</span>
              ${!d.revoked ? `<button class="btn-secondary btn-revoke-device" type="button" data-revoke-device-id="${escapeHtml(d.id)}">Revoke</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
      listContainer.querySelectorAll('[data-revoke-device-id]').forEach(button => {
        button.addEventListener('click', () => window.revokeDevice(button.dataset.revokeDeviceId || ''));
      });
    } else {
      sectionContainer.style.display = 'none';
    }
  } catch (error) {
    console.warn('Failed to fetch phone companion devices:', error);
  }
}

window.revokeDevice = async (id) => {
  const approved = await showOrionConfirmDialog({
    title: 'Revoke phone access?',
    message: "This phone will lose access to Orion immediately. You can pair it again later.",
    confirmLabel: 'Revoke',
    danger: true
  });
  if (approved?.confirmed && window.api && typeof window.api.revokePhoneCompanionDevice === 'function') {
    await window.api.revokePhoneCompanionDevice(id);
    await refreshPairedDevicesList();
  }
};

setInterval(() => {
  if (el.phoneCompanionModal && el.phoneCompanionModal.classList.contains('active')) {
    refreshPairedDevicesList().catch(() => {});
  }
}, 4000);

function renderSystemBubble(text) {
  if (isLegacyPhoneCompanionTokenMessage(text)) {
    return;
  }
  const stickToBottom = shouldAutoScrollChat();
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="message-header" style="color: var(--text-muted);">⚙️ System</div>
    <div class="message-body" style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(text)}</div>
  `;
  el.messagesContainer.appendChild(bubble);
  scrollChatToBottomIfNeeded(stickToBottom);
}

function renderPhoneCompanionPairingCard(payload) {
  const stickToBottom = shouldAutoScrollChat();
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble companion-pairing-card';
  const qrSvg = String(payload.qrSvg || '');
  const pairUrl = String(payload.pairUrl || '');
  const stableUrl = String(payload.stableUrl || pairUrl.replace(/\?.*$/, ''));
  const expiresText = payload.expiresAt ? `Expires: ${new Date(payload.expiresAt).toLocaleTimeString()}` : 'Short-lived pairing link';
  bubble.innerHTML = `
    <div class="message-header" style="color: var(--accent-secondary);">Phone Companion Pairing</div>
    <div class="message-body" style="font-family: var(--font-sans); color: var(--text);">
      <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
        <div data-companion-qr="true" aria-label="Phone Companion pairing QR code" style="background:#fff; padding:8px; border-radius:8px; line-height:0;">${qrSvg}</div>
        <div style="min-width:220px; flex:1;">
          <div style="font-weight:700; margin-bottom:6px;">Scan once to trust this phone</div>
          <div style="color: var(--text-muted); margin-bottom:8px;">After it connects, add the clean URL to your home screen so the icon opens your saved device session.</div>
          <div data-pair-url="${escapeHtml(pairUrl)}" style="font-family: var(--font-mono); font-size:.76rem; word-break:break-all;">${escapeHtml(pairUrl)}</div>
          <div data-stable-phone-url="${escapeHtml(stableUrl)}" style="font-family: var(--font-mono); font-size:.76rem; word-break:break-all; margin-top:6px; color:var(--success-color);">${escapeHtml(stableUrl)}</div>
          <div data-pairing-metadata="true" style="color: var(--text-muted); font-size:.74rem; margin-top:8px;">${escapeHtml(expiresText)}</div>
        </div>
      </div>
    </div>
  `;
  el.messagesContainer.appendChild(bubble);
  scrollChatToBottomIfNeeded(stickToBottom);
}

// Generates structural AI Response with step thought details
function renderAiMessage(text, logs = [], conversationId = null, msgMeta = null) {
  const targetId = conversationId || activeConversationId;
  if (targetId !== activeConversationId) {
    return;
  }
  const hasLogs = Array.isArray(logs) && logs.length > 0;
  const isThinkingPlaceholder = String(text || '').trim() === 'Thinking...';
  if (!activeAiBubble && isThinkingPlaceholder && !hasLogs) {
    // A stale "Thinking..." placeholder from a run that ended without ever producing real text
    // must not reappear on conversation load/replay. But while a run is actively in progress for
    // this conversation, this is the very first call for the turn — before any tool call has
    // happened — and skipping it left the chat area completely blank (no bubble, no spinner)
    // until either a tool call fired or the whole run finished, which could be the entire
    // duration of the model's first response. Let it through so the running-indicator spinner
    // below shows immediately instead of leaving the user with no feedback at all.
    const runningNow = window.isAgentRunning && window.isAgentRunning() &&
      (window.getRunningConversationId ? window.getRunningConversationId() === targetId : true);
    if (!runningNow) return;
  }
  const stickToBottom = shouldAutoScrollChat();
  let bubble;
  const isNew = !activeAiBubble;
  
  if (!isNew) {
    bubble = activeAiBubble;
  } else {
    bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    activeAiBubble = bubble;
  }
  
  let logsHtml = '';
  if (hasLogs) {
    const isRunning = window.isAgentRunning && window.isAgentRunning();
    const displayStyle = isRunning ? 'flex' : 'none';
    const arrowSymbol = isRunning ? '▲' : '▼';
    
    logsHtml = `
      <div class="agent-logs-container">
        <div class="agent-logs-header" onclick="toggleLogs(this)">
          <span>🤖 Execution Logs (${logs.length} operations)</span>
          <span>${arrowSymbol}</span>
        </div>
        <div class="agent-logs-body" style="display: ${displayStyle};">
    `;
    
    logs.forEach(log => {
      if (log.type === 'thought') {
        logsHtml += `<div class="thought-block"><strong>Thought:</strong> ${escapeHtml(log.content)}</div>`;
      } else if (log.type === 'tool_call') {
        const statusClass = log.status || 'running';
        const resBox = log.result ? `<div class="tool-result-box">${escapeHtml(log.result)}</div>` : '';
        logsHtml += `
          <div class="tool-run-badge">
            <div class="tool-call-info">
              <span class="tool-name">🛠️ ${escapeHtml(log.tool)}</span>
              <span class="tool-status ${statusClass}">${statusClass}</span>
            </div>
            <div class="tool-params">Params: ${escapeHtml(JSON.stringify(log.params))}</div>
            ${resBox}
          </div>
        `;
      }
    });
    
    logsHtml += `</div></div>`;
  }
  
  // Render markdown text
  const displayText = isThinkingPlaceholder ? '' : String(text || '');
  const renderedMarkdown = displayText
    ? (typeof marked !== 'undefined' ? marked.parse(displayText) : escapeHtml(displayText))
    : '';
  
  let runningIndicatorHtml = '';
  let planApprovalHtml = '';
  let clarificationHtml = '';
  const runningConversationId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const activeConv = typeof conversations !== 'undefined'
    ? conversations.find(c => c.id === activeConversationId)
    : null;
  // Decide whether THIS bubble is the plan-approval card. On a fresh live render the message
  // object is not threaded in, so fall back to conversation state (the active bubble during a
  // planning yield is the plan bubble). On reloads the persisted msgMeta.isPlanApprovalCard
  // identifies the exact bubble so the card does not bleed onto execution bubbles.
  const isPlanBubble = msgMeta
    ? !!msgMeta.isPlanApprovalCard
    : !!(activeConv && activeConv.awaitingPlanApproval && !activeConv.planApproved);
  if (isPlanBubble) {
    if (activeConv && activeConv.planApproved) {
      // The plan was approved — show a persistent "started" state instead of removing the card,
      // so the chat clearly reflects that the button was pressed.
      planApprovalHtml = `
        <div class="plan-approval-actions approved">
          <div class="plan-approval-copy">
            <span class="plan-approval-title">Implementation started</span>
            <span class="plan-approval-subtitle">Orion is building from this approved plan.</span>
          </div>
          <button class="btn-approve-plan approved" type="button" disabled>✓ Implementation Started</button>
        </div>
      `;
    } else if (activeConv && activeConv.awaitingPlanApproval && !(window.isAgentRunning && window.isAgentRunning())) {
      planApprovalHtml = `
        <div class="plan-approval-actions">
          <div class="plan-approval-copy">
            <span class="plan-approval-title">Plan ready for review</span>
            <span class="plan-approval-subtitle">Start when the direction looks right.</span>
          </div>
          <button class="btn-approve-plan" type="button">Start Implementation</button>
        </div>
      `;
    }
  }
  // Clarification question card — same live/reload dual-detection pattern as plan approval.
  const isClarificationBubble = msgMeta
    ? !!msgMeta.isClarificationCard
    : !!(activeConv && activeConv.awaitingClarification);
  if (isClarificationBubble && activeConv && activeConv.awaitingClarification) {
    clarificationHtml = buildClarificationCardHtml(activeConv.awaitingClarification);
  }
  if (window.isAgentRunning && window.isAgentRunning() && runningConversationId === activeConversationId) {
    const stepNum = window.currentLoopCount || 1;
    
    // Check if the current conversation's plan has been approved
    let isApproved = false;
    if (activeConv && activeConv.planApproved) {
      isApproved = true;
    }
    
    const executionMode = window.getAgentExecutionMode ? window.getAgentExecutionMode() : 'planning';
    const statusLabel = isApproved || executionMode === 'direct' || executionMode === 'executing' || executionMode === 'answer'
      ? `Working (Step ${stepNum})...`
      : `Preparing implementation plan (Step ${stepNum})...`;
      
    const subStatus = window.getAgentSubStatus ? window.getAgentSubStatus() : '';
    const displayLabel = subStatus ? `${statusLabel} — ${subStatus}` : statusLabel;
      
    runningIndicatorHtml = `
      <div class="agent-running-indicator">
        <div class="spinner-dots">
          <span class="spinner-dot"></span>
          <span class="spinner-dot"></span>
          <span class="spinner-dot"></span>
        </div>
        <span class="status-text">${displayLabel}</span>
      </div>
    `;
  }
  
  bubble.innerHTML = `
    <div class="message-header ai">✦ Orion AI</div>
    ${logsHtml}
    <div class="message-body">
      ${renderedMarkdown}
      ${clarificationHtml}
      ${planApprovalHtml}
      ${runningIndicatorHtml}
    </div>
  `;
  sanitizeRenderedMarkdown(bubble);

  // Format code blocks
  if (isNew) {
    el.messagesContainer.appendChild(bubble);
  }
  bubble.querySelectorAll('a[href^="orion-file:"]').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const href = link.getAttribute('href') || '';
      const relPath = decodeURIComponent(href.replace('orion-file:', ''));
      openFileViewer(relPath);
    });
  });
  const approveButton = bubble.querySelector('.btn-approve-plan');
  if (approveButton) {
    approveButton.addEventListener('click', () => approveCurrentPlanAndContinue({ button: approveButton }));
  }
  // Wire clarification option rows for selection highlight
  bubble.querySelectorAll('.clarification-option, .clarification-other-row').forEach(row => {
    row.addEventListener('click', () => {
      const radio = row.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      const block = row.closest('.clarification-question-block');
      if (block) {
        block.querySelectorAll('.clarification-option, .clarification-other-row').forEach(r => r.classList.remove('selected'));
      }
      row.classList.add('selected');
    });
  });
  // Auto-select "Other" row when user types in the text input
  bubble.querySelectorAll('.clarification-other-input').forEach(input => {
    input.addEventListener('focus', () => {
      const row = input.closest('.clarification-other-row');
      if (row) {
        row.click();
      }
    });
  });
  const clarSubmitBtn = bubble.querySelector('.btn-clarification-submit');
  if (clarSubmitBtn) {
    clarSubmitBtn.addEventListener('click', () => submitClarificationAnswers({ button: clarSubmitBtn, bubble }));
  }
  if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bubble);
  
  // Inject copy & edit buttons into pre blocks
  bubble.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;
    
    const preHeader = document.createElement('div');
    preHeader.className = 'code-header';
    
    const lang = code.className.replace('language-', '') || 'text';
    preHeader.innerHTML = `
      <span class="code-lang">${lang}</span>
      <div class="code-actions">
        <button class="code-action-btn copy-btn">Copy</button>
        <button class="code-action-btn apply-btn">Apply File</button>
      </div>
    `;
    
    pre.parentNode.insertBefore(preHeader, pre);
    
    // Wire up buttons
    preHeader.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent);
      preHeader.querySelector('.copy-btn').textContent = 'Copied!';
      setTimeout(() => { preHeader.querySelector('.copy-btn').textContent = 'Copy'; }, 2000);
    });
    
    preHeader.querySelector('.apply-btn').addEventListener('click', async () => {
      const relPath = prompt("Enter the relative path inside your workspace to write this file to:", "script.js");
      if (relPath) {
        const result = await window.api.writeFile(currentWorkspace, relPath, code.textContent);
        if (result.success) {
          alert(`File written to ${relPath} successfully.`);
          syncWorkspaceFiles();
        } else {
          alert(`Error writing file: ${result.error}`);
        }
      }
    });
  });
  
  scrollChatToBottomIfNeeded(stickToBottom);
}

// LOG TOGGLING HELPER
window.toggleLogs = function(headerElement) {
  const body = headerElement.nextElementSibling;
  const arrow = headerElement.querySelector('span:last-child');
  if (body.style.display === 'none') {
    body.style.display = 'flex';
    arrow.textContent = '▲';
  } else {
    body.style.display = 'none';
    arrow.textContent = '▼';
  }
};

// --- TASKS PANEL UPDATES ---
function updateTasksChecklist(tasks) {
  if (!tasks || tasks.length === 0) {
    el.taskChecklist.innerHTML = '<p class="empty-state">No tasks active. Start a conversation with a plan to see items here.</p>';
    el.taskCompletionBadge.style.display = 'none';
    return;
  }
  
  el.taskChecklist.innerHTML = '';
  let completedCount = 0;
  
  tasks.forEach(task => {
    const item = document.createElement('div');
    const isDone = task.status === 'completed' || task.status === 'x';
    const isInProgress = task.status === 'in-progress' || task.status === '/';
    
    item.className = `checklist-item ${isDone ? 'done' : ''} ${isInProgress ? 'in-progress' : ''}`;
    
    if (isDone) completedCount++;
    
    item.innerHTML = `
      <input type="checkbox" ${isDone ? 'checked' : ''} disabled>
      <span class="item-text">${escapeHtml(task.title)}</span>
    `;
    el.taskChecklist.appendChild(item);
  });
  
  const percentage = Math.round((completedCount / tasks.length) * 100);
  el.taskCompletionBadge.textContent = `${percentage}%`;
  el.taskCompletionBadge.style.display = '';
}

function updateOperationalContext(state) {
  if (!el.operationalContextPanel || !el.operationalContextRevision) return;
  const context = state && window.OrionOperationalContext
    ? window.OrionOperationalContext.normalizeContext(state)
    : null;
  if (!context || (!context.mission.statement && context.winConditions.length === 0)) {
    el.operationalContextRevision.style.display = 'none';
    el.operationalContextRevision.textContent = '';
    el.operationalContextPanel.innerHTML = '<p class="empty-state">Define a mission to give Orion durable operational direction.</p>';
    return;
  }

  const satisfied = context.winConditions.filter(item => item.status === 'satisfied').length;
  const winProgress = context.winConditions.length ? `${satisfied}/${context.winConditions.length}` : 'No conditions';
  const blockers = context.blockers.active;
  if (blockers.length > 0) {
    revealAgentPanel('Orion needs attention: an active blocker was recorded.');
    if (!(window.isAgentRunning && window.isAgentRunning())) {
      renderAgentPresence('attention', 'Needs attention', blockers[0].title);
    }
  }
  const conditionMarkup = context.winConditions.slice(0, 8).map(item => `
    <div class="mission-condition ${item.status}">
      <span class="mission-condition-dot"></span>
      <span>${escapeHtml(item.title)}</span>
    </div>
  `).join('');
  const blockerMarkup = blockers.slice(0, 4).map(item => `<div class="mission-blocker">${escapeHtml(item.title)}</div>`).join('');

  el.operationalContextRevision.textContent = `r${context.revision}`;
  el.operationalContextRevision.style.display = '';
  el.operationalContextPanel.innerHTML = `
    <div class="mission-label">Mission</div>
    <div class="mission-statement">${escapeHtml(context.mission.statement || 'Not defined')}</div>
    <div class="mission-meta-row">
      <span>${escapeHtml(context.activeObjective ? context.activeObjective.title : 'No active objective')}</span>
      <span>${winProgress}</span>
    </div>
    ${context.activeSubplan ? `<div class="mission-subplan"><strong>Now:</strong> ${escapeHtml(context.activeSubplan.title)} <span class="mission-status">${escapeHtml(context.activeSubplan.status)}</span></div>` : ''}
    ${conditionMarkup ? `<div class="mission-conditions">${conditionMarkup}</div>` : ''}
    ${blockerMarkup ? `<div class="mission-blockers"><div class="mission-label">Blockers</div>${blockerMarkup}</div>` : ''}
  `;
}

async function refreshOperationalContext(workspace = currentWorkspace) {
  if (!workspace || !window.readOperationalContext) {
    updateOperationalContext(null);
    return;
  }
  const result = await window.readOperationalContext(workspace);
  updateOperationalContext(result && result.state);
}

function closeOperationalContextEditor() {
  if (el.operationalContextModal) el.operationalContextModal.classList.remove('active');
}

async function openOperationalContextEditor() {
  if (!currentWorkspace) {
    alert('Choose a workspace or start a conversation before defining a mission.');
    return;
  }
  const result = await window.readOperationalContext(currentWorkspace);
  const context = result && result.state
    ? window.OrionOperationalContext.normalizeContext(result.state)
    : window.OrionOperationalContext.createEmptyContext();
  el.operationalMissionInput.value = context.mission.statement;
  el.operationalObjectiveInput.value = context.activeObjective ? context.activeObjective.title : '';
  el.operationalWinConditionsInput.value = context.winConditions.map(item => item.title).join('\n');
  el.operationalContextModal.classList.add('active');
  el.operationalMissionInput.focus();
}

async function saveOperationalContextEditor() {
  const mission = el.operationalMissionInput.value.trim();
  if (!mission) {
    alert('Mission is required.');
    el.operationalMissionInput.focus();
    return;
  }
  const winConditions = el.operationalWinConditionsInput.value
    .split(/\r?\n/)
    .map(title => title.trim())
    .filter(Boolean)
    .filter((title, index, all) => all.findIndex(candidate => candidate.toLowerCase() === title.toLowerCase()) === index)
    .map(title => ({ title }));
  el.btnOperationalContextSave.disabled = true;
  try {
    await window.mutateOperationalContext(currentWorkspace, 'update_mission_context', {
      mission,
      activeObjective: el.operationalObjectiveInput.value.trim(),
      winConditions
    });
    closeOperationalContextEditor();
    appendSystemMessage(`Mission Control updated with ${winConditions.length} win condition${winConditions.length === 1 ? '' : 's'}.`);
  } catch (error) {
    alert(`Could not save mission: ${error.message}`);
  } finally {
    el.btnOperationalContextSave.disabled = false;
  }
}

function setupOperationalContextEditor() {
  if (!el.operationalContextModal) return;
  el.btnEditOperationalContext.addEventListener('click', openOperationalContextEditor);
  el.btnOperationalContextClose.addEventListener('click', closeOperationalContextEditor);
  el.btnOperationalContextSave.addEventListener('click', saveOperationalContextEditor);
  el.operationalContextModal.addEventListener('click', event => {
    if (event.target === el.operationalContextModal) closeOperationalContextEditor();
  });
}

// --- REGRESSION TEST PANEL ---
function updateTestResultsPanel(results) {
  if (!el.testResults || !el.testIndicator) return;
  
  if (!results) {
    el.testResults.innerHTML = '<p class="empty-state">No tests run yet.</p>';
    el.testIndicator.className = 'status-indicator idle';
    el.testIndicator.textContent = 'Idle';
    return;
  }
  
  el.testResults.textContent = results.output;
  if (results.success) {
    el.testIndicator.className = 'status-indicator pass';
    el.testIndicator.textContent = 'Pass';
    el.testResults.className = 'test-log-box pass';
  } else {
    el.testIndicator.className = 'status-indicator fail';
    el.testIndicator.textContent = 'Fail';
    el.testResults.className = 'test-log-box fail';
  }
}

async function runRegressionTests() {
  if (!currentWorkspace) {
    return { success: false, output: "Select a workspace directory first.", timestamp: Date.now() };
  }
  
  if (el.testIndicator) {
    el.testIndicator.className = 'status-indicator testing';
    el.testIndicator.textContent = 'Running';
  }
  if (el.testResults) {
    el.testResults.innerHTML = '<p class="empty-state">Executing test command...</p>';
  }
  
  const processId = 'test_' + Date.now();
  activeProcessId = processId;
  
  let testOutput = '';
  
  const cleanListener = window.api.onCommandOutput(processId, (data) => {
    testOutput += data.text;
    if (el.testResults) {
      el.testResults.textContent = testOutput;
      el.testResults.scrollTop = el.testResults.scrollHeight;
    }
  });
  
  const result = await window.api.runCommand(getEffectiveTestCommand(), currentWorkspace, processId, appConfig.commandTimeoutMs || 120000);
  cleanListener();
  
  const success = result.code === 0;
  const testRunInfo = {
    output: testOutput || result.error || `Exit code: ${result.code}`,
    success: success,
    timedOut: !!result.timedOut,
    timestamp: Date.now()
  };
  
  updateTestResultsPanel(testRunInfo);
  
  // Save to active conversation
  const conv = conversations.find(c => c.id === activeConversationId);
  if (conv) {
    conv.testResults = testRunInfo;
    saveConversationsToStorage();
  }
  
  return testRunInfo;
}

// UTILITY ESCAPE HTML
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Export config so agent.js can use it
window.getAppConfig = () => appConfig;
window.getActiveConversationId = () => activeConversationId;
window.getCurrentWorkspace = () => currentWorkspace;
window.changeActiveWorkspace = function(folderPath) {
  if (activeConversationId) {
    const conv = conversations.find(c => c.id === activeConversationId);
    if (conv) {
      conv.workspace = folderPath;
      conv.projectPath = folderPath;
      saveConversationsToStorage();
    }
  }
  if (!projects.includes(folderPath)) {
    projects.push(folderPath);
    saveProjectsToStorage();
    renderProjectsList();
  }
  currentWorkspace = folderPath;
  expandedFileFolders = new Set();
  el.workspaceLabel.textContent = folderPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || folderPath;
  syncWorkspaceFiles();
  refreshOperationalContext();
};
window.getSelectedModel = () => el.modelSelect ? el.modelSelect.value : appConfig.defaultModel;
window.selectConversationById = selectConversation;
window.updateTasksChecklist = updateTasksChecklist;
window.updateOperationalContext = updateOperationalContext;
window.refreshOperationalContext = refreshOperationalContext;
window.updateTestResultsPanel = updateTestResultsPanel;
window.runRegressionTests = runRegressionTests;
window.loadRunArtifacts = loadRunArtifacts;
window.renderAiMessage = renderAiMessage;
window.appendSystemMessage = appendSystemMessage;
window.persistAssistantStatusMessage = persistAssistantStatusMessage;
window.markQueuedPromptRunning = markQueuedPromptRunning;
window.saveConversationsToStorage = saveConversationsToStorage;
window.showPhoneCompanionPairingCard = showPhoneCompanionPairingCard;
window.syncWorkspaceFiles = syncWorkspaceFiles;
window.refreshWorkspaceEntrypoint = loadWorkspaceEntrypoint;


window.clearActiveAiBubble = () => {
  activeAiBubble = null;
};

function renderAgentPresence(state, label, detail) {
  if (!el.agentStatePill) return;
  el.agentStatePill.className = `agent-state-pill ${state}`;
  el.agentStateText.textContent = label;
  el.agentStateDetail.textContent = detail || '';
}

function refreshAgentPresence() {
  const running = window.isAgentRunning && window.isAgentRunning();
  const conv = conversations.find(item => item.id === activeConversationId);
  if (conv && conv.awaitingPlanApproval && !conv.planApproved) {
    renderAgentPresence('attention', 'Review needed', 'Implementation plan is waiting for approval');
    return;
  }
  if (!running) return;
  const mode = window.getAgentExecutionMode ? window.getAgentExecutionMode() : 'executing';
  const subStatus = window.getAgentSubStatus ? window.getAgentSubStatus() : '';
  if (/run_tests|test|verif/i.test(subStatus)) {
    renderAgentPresence('verifying', 'Verifying', subStatus);
  } else if (/running tool/i.test(subStatus) || mode === 'executing' || mode === 'direct') {
    renderAgentPresence('acting', 'Acting', subStatus || 'Working through the current objective');
  } else if (/waiting|cooldown|retry/i.test(subStatus)) {
    renderAgentPresence('waiting', 'Waiting', subStatus);
  } else {
    renderAgentPresence('thinking', 'Thinking', subStatus || 'Choosing the next useful action');
  }
}

function showToast(message, tone = 'default') {
  if (!el.toastRegion || !message) return;
  const toast = document.createElement('div');
  toast.className = `orion-toast ${tone}`;
  toast.textContent = message;
  el.toastRegion.replaceChildren(toast);
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

window.onAgentStatusChange = (running) => {
  const submitBtn = el.btnSubmit;
  const steerBtn = document.getElementById('btn-steer');
  const queueBtn = document.getElementById('btn-queue');
  
  if (running) {
    submitBtn.innerHTML = '&#10022;';
    submitBtn.title = 'Send or queue message';
    if (el.btnStopAgent) {
      el.btnStopAgent.classList.add('visible');
      el.btnStopAgent.disabled = false;
    }
    clearTimeout(agentCompletionTimer);
    refreshAgentPresence();
    clearInterval(agentPresenceTimer);
    agentPresenceTimer = setInterval(refreshAgentPresence, 250);
  } else {
    clearInterval(agentPresenceTimer);
    agentPresenceTimer = null;
    submitBtn.innerHTML = '&#10022;';
    submitBtn.title = 'Send message';
    if (el.btnStopAgent) {
      el.btnStopAgent.classList.remove('visible');
      el.btnStopAgent.disabled = false;
    }
    steerBtn.style.display = 'none';
    queueBtn.style.display = 'none';
    const conv = conversations.find(item => item.id === activeConversationId);
    if (conv && conv.awaitingPlanApproval && !conv.planApproved) {
      revealAgentPanel('A plan is ready for review.');
      renderAgentPresence('attention', 'Review needed', 'Implementation plan is waiting for approval');
    } else {
      renderAgentPresence('complete', 'Complete', 'Orion finished the current run');
      showToast('Orion finished the current run.', 'success');
      agentCompletionTimer = setTimeout(() => renderAgentPresence('idle', 'Ready', ''), 2600);
    }
  }
};
window.renderUserMessageInChat = renderUserMessage;
window.getPhoneCompanionState = async (targetConversationId) => {
  const requestedId = String(targetConversationId || '');
  const requestedConv = requestedId ? conversations.find(c => c.id === requestedId) : null;
  const activeConv = activeConversationId ? conversations.find(c => c.id === activeConversationId) : null;
  const conv = requestedConv || activeConv || conversations[0] || null;
  const resolvedId = conv ? conv.id : '';
  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;
  const globalRunningId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const isActiveTargetRunning = isGlobalRunning && globalRunningId === resolvedId;
  const queuedForResolvedConversation = Array.isArray(window.promptQueue)
    && window.promptQueue.some(q => q && q.conversationId === resolvedId);
  const normalizedPhoneMessages = conv && conv.messages
    ? conv.messages.slice(-40).map(normalizeConversationMessageForReplay)
    : [];
  const recoveredAssistantMessage = buildMissingAssistantResponseMessage(normalizedPhoneMessages, {
    queued: queuedForResolvedConversation
  });
  const messages = normalizedPhoneMessages.map(replayMsg => {
    const replayLogs = Array.isArray(replayMsg.logs) ? replayMsg.logs : [];
    const text = replayMsg.text;
    return {
      role: replayMsg.role,
      content: text,
      text,
      logs: replayMsg.role === 'assistant' ? replayLogs : []
    };
  });
  if (recoveredAssistantMessage && !isActiveTargetRunning) {
    messages.push(recoveredAssistantMessage);
  }
  const latestOutput = messages.slice().reverse().find(msg => msg.role === 'assistant' || msg.role === 'system');
  const latestAssistant = conv && conv.messages
    ? conv.messages.slice().reverse().map(normalizeConversationMessageForReplay).find(msg => msg.role === 'assistant')
    : null;
  const latestText = latestAssistant ? (latestAssistant.text || '') : '';
  const changedFiles = [];
  const testResults = [];
  const latestToolCalls = [];
  (latestAssistant && Array.isArray(latestAssistant.logs) ? latestAssistant.logs : []).forEach(log => {
    if (log.tool === 'write_file' || log.tool === 'modify_file' || log.tool === 'patch_file') {
      const params = log.params || {};
      if (params.path && !changedFiles.includes(params.path)) changedFiles.push(params.path);
    }
    if (log.tool === 'run_tests' || log.tool === 'run_command') {
      testResults.push(log.result || '');
    }
    if (log.type === 'tool_call' || log.tool || log.type === 'thought') {
      latestToolCalls.push({
        type: log.type || 'tool_call',
        content: log.content || '',
        tool: log.tool || '',
        status: log.status || 'running',
        params: log.params || {},
        result: log.result || ''
      });
    }
  });
  const walkthroughIndex = latestText.indexOf('\n\n## Work Walkthrough');
  const workWalkthrough = walkthroughIndex === -1 ? '' : latestText.slice(walkthroughIndex).trim();
  const conversationsSummary = conversations.map(c => {
    const normalizedMessages = Array.isArray(c.messages)
      ? c.messages.map(normalizeConversationMessageForReplay)
      : [];
    const messageCount = normalizedMessages.filter(msg =>
      msg.role === 'user' || msg.role === 'assistant' || msg.role === 'steering'
    ).length;
    const taskCount = Array.isArray(c.tasks) ? c.tasks.length : 0;
    return {
      id: c.id,
      title: c.title || 'New Conversation',
      workspace: c.workspace || '',
      projectPath: c.projectPath || '',
      active: c.id === resolvedId,
      isDesktopActive: c.id === activeConversationId,
      awaitingPlanApproval: !!(c.awaitingPlanApproval && !c.planApproved),
      awaitingClarification: !!c.awaitingClarification,
      taskCount,
      messageCount,
      activityCount: messageCount + taskCount,
      updatedAt: c.updatedAt || c.createdAt || 0
    };
  });
  const projectSummaries = projects.map(path => {
    const name = path.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || path;
    const projectConversations = conversations.filter(c => c.projectPath === path);
    return {
      path,
      name,
      conversationCount: projectConversations.length,
      updatedAt: projectConversations.reduce((latest, c) => Math.max(latest, c.updatedAt || c.createdAt || 0), 0)
    };
  });
  
  const companionWorkspace = conv ? (conv.workspace || conv.projectPath || currentWorkspace || '') : currentWorkspace;
  const operationalResult = companionWorkspace && window.readOperationalContext
    ? await window.readOperationalContext(companionWorkspace)
    : null;
  const operationalState = operationalResult && operationalResult.state
    ? window.OrionOperationalContext.normalizeContext(operationalResult.state)
    : window.OrionOperationalContext.createEmptyContext();
  const operationalContext = {
    revision: operationalState.revision,
    mission: operationalState.mission.statement,
    activeObjective: operationalState.activeObjective ? operationalState.activeObjective.title : '',
    activeSubplan: operationalState.activeSubplan ? {
      title: operationalState.activeSubplan.title,
      status: operationalState.activeSubplan.status,
      nextAction: operationalState.activeSubplan.nextAction
    } : null,
    winConditions: operationalState.winConditions.map(item => ({ id: item.id, title: item.title, status: item.status, evidenceCount: item.evidence.length })),
    blockers: operationalState.blockers.active.map(item => ({ id: item.id, title: item.title, details: item.details })),
    lastDistillation: operationalState.lastDistillation
  };

  return {
    conversationId: resolvedId,
    title: conv ? conv.title : '',
    conversations: conversationsSummary,
    projects: projectSummaries,
    workspace: companionWorkspace,
    running: isActiveTargetRunning,
    globalRunning: isGlobalRunning,
    runningConversationId: globalRunningId,
    queuedPrompts: window.promptQueue ? window.promptQueue.filter(q => q.conversationId === resolvedId).length : 0,
    queuedPromptPreview: window.promptQueue ? window.promptQueue.filter(q => q.conversationId === resolvedId).map(q => q.prompt).slice(0, 3) : [],
    subStatus: isActiveTargetRunning && window.getAgentSubStatus ? window.getAgentSubStatus() : '',
    executionMode: isActiveTargetRunning && window.getAgentExecutionMode ? window.getAgentExecutionMode() : 'idle',
    awaitingPlanApproval: !!(conv && conv.awaitingPlanApproval && !conv.planApproved),
    awaitingClarification: (conv && conv.awaitingClarification) ? conv.awaitingClarification : null,
    tasks: conv && Array.isArray(conv.tasks) ? conv.tasks : [],
    model: window.getSelectedModel(),
    messages,
    latestOutput: latestOutput ? latestOutput.text : '',
    operationalContext,
    preview: {
      latestAssistantOutput: latestText,
      latestToolCalls,
      workWalkthrough,
      changedFiles,
      testResults,
      appLaunchUrl: window.lastLaunchUrl || '',
      appLaunchLogs: window.lastLaunchLogs || ''
    }
  };
};

window.deletePhoneCompanionConversation = async (conversationId) => {
  const id = String(conversationId || '');
  if (!id) return { success: false, error: 'Missing conversation id' };
  const conv = conversations.find(c => c.id === id);
  if (!conv) return { success: false, error: 'Conversation not found' };
  deleteConversation(id);
  return { success: true, deleted: id };
};

let isPairingConfirmOpen = false;
let lastConfirmTime = 0;
window.approvePhoneCompanionPairing = async (request) => {
  if (isPairingConfirmOpen) {
    return { approved: false, pending: true };
  }
  const now = Date.now();
  if (now - lastConfirmTime < 5000) {
    return { approved: false, pending: true };
  }
  isPairingConfirmOpen = true;
  lastConfirmTime = now;
  const name = request && request.deviceName ? request.deviceName : 'Phone';
  let approved = true;
  try {
    if (window.confirm) {
      approved = window.confirm(`Allow ${name} to control Orion from Phone Companion?`);
    }
  } finally {
    isPairingConfirmOpen = false;
  }
  return { approved, pending: false };
};


// No longer switches desktop conversation
window.switchPhoneCompanionConversation = async (conversationId) => {
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return { success: false, error: 'Conversation not found' };
  // We don't call selectConversation(conversationId) because we want the phone to be independent
  return { success: true, conversationId: conv.id, title: conv.title || 'New Conversation' };
};

function hasRequiredTestingPlanSection(content) {
  if (!content || typeof content !== 'string') return false;
  const testingPlanRegex = /^#+\s*.*?(?:testing\s+plan|test\s+plan|validation\s+plan)\b/im;
  return testingPlanRegex.test(content);
}

window.startPhoneCompanionTask = async (options = {}) => {
  const conv = createPhoneConversation({
    projectPath: options.projectPath || '',
    title: 'New Phone Task'
  });

  const prompt = String(options.prompt || '').trim();
  if (prompt) {
    await window.submitPhoneCompanionPrompt({ prompt, conversationId: conv.id });
  }
  return { success: true, conversationId: conv.id, workspace: conv.workspace, projectPath: conv.projectPath };
};

window.submitPhoneCompanionPrompt = async (options) => {
  // Can be called with either a string or an options object
  const text = typeof options === 'string' ? options.trim() : String(options.prompt || '').trim();
  let targetId = (typeof options === 'object' && options.conversationId) ? options.conversationId : activeConversationId;

  if (!text) return { success: false, error: 'Missing prompt' };

  let conv = conversations.find(c => c.id === targetId);
  if (!conv) {
    conv = createPhoneConversation({
      projectPath: typeof options === 'object' ? options.projectPath || '' : '',
      title: 'New Phone Task'
    });
    targetId = conv.id;
  }
  const incomingProjectPath = typeof options === 'object' ? String(options.projectPath || '').trim() : '';
  if (incomingProjectPath && !conv.projectPath) {
    conv.projectPath = incomingProjectPath;
  }
  if (conv.projectPath && !conv.workspace) {
    conv.workspace = conv.projectPath;
  }

  // Generate a short title if it's new
  if (conv.messages.length === 0 || conv.title === 'New Phone Task' || conv.title === 'Untitled Conversation') {
    conv.title = text.length > 40 ? text.substring(0, 40) + '...' : text;
  }
  normalizeConversationWorkspace(conv);
  if (!conv.workspace) {
    conv.workspace = conv.projectPath || getStandaloneWorkspaceForTitle(conv.title, conv.id);
  }
  saveConversationsToStorage();

  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;

  if (isGlobalRunning) {
    window.promptQueue.push({ prompt: text, modelSelectValue: window.getSelectedModel(), conversationId: targetId, source: 'phone' });
    if (conv.messages) {
      conv.messages.push({ role: 'user', source: 'phone', text, createdAt: Date.now() });
      saveConversationsToStorage();
    }
    persistAssistantStatusMessage(targetId, "Queued. Orion will start this after the current task finishes.", {
      source: 'queue-status',
      dedupeKey: `phone-queued-${targetId}-${text}`
    });
    if (targetId === activeConversationId) {
      renderUserMessage(text);
    }
    return { success: true, queued: true, conversationId: targetId, title: conv.title || 'New Conversation' };
  }

  // Directly run agent loop on the target conversation (without forcing desktop UI switch)
  if (conv.messages) {
    conv.messages.push({ role: 'user', source: 'phone', text, createdAt: Date.now() });
    saveConversationsToStorage();
  }
  if (targetId === activeConversationId) {
    renderUserMessage(text);
  }
  window.runAgentLoop(text, window.getSelectedModel(), conv, { source: 'phone' })
    .catch(err => {
      console.error("Phone-started agent loop failed:", err);
      persistAssistantStatusMessage(targetId, `Orion could not start this phone request: ${err.message}`, {
        source: 'agent-start-error',
        dedupeKey: `phone-start-error-${targetId}-${text}`
      });
    });

  return { success: true, queued: false, conversationId: targetId, title: conv.title || 'New Conversation' };
};

window.steerPhoneCompanionTask = async (options) => {
  const text = typeof options === 'string' ? options.trim() : String(options.prompt || '').trim();
  const targetId = (typeof options === 'object' && options.conversationId) ? options.conversationId : activeConversationId;
  if (!text) return { success: false, error: 'Missing steering prompt' };

  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;
  const globalRunningId = window.getRunningConversationId ? window.getRunningConversationId() : null;

  if (!isGlobalRunning || globalRunningId !== targetId) {
    return await window.submitPhoneCompanionPrompt(options);
  }

  window.steeringQueue = window.steeringQueue || {};
  window.steeringQueue[targetId] = window.steeringQueue[targetId] || [];
  window.steeringQueue[targetId].push(text);
  if (targetId === activeConversationId) {
    appendSystemMessage("Phone companion steering note received.");
  }
  return { success: true, steered: true };
};

window.approvePhoneCompanionPlan = async (targetId) => {
  const resolvedId = targetId || activeConversationId;
  const conv = conversations.find(c => c.id === resolvedId);
  if (!conv || !conv.awaitingPlanApproval) return { success: false, error: 'No plan waiting for approval' };

  if (!appConfig.geminiApiKey) {
    return { success: false, error: 'Missing Gemini API key on desktop' };
  }

  // Re-validate the testing plan section in implementation_plan.md
  let planIsValid = false;
  try {
    const planText = await readConversationTextArtifact(conv, 'implementation_plan.md', { maxChars: 100000 });
    planIsValid = hasRequiredTestingPlanSection(planText);
  } catch (err) {
    console.error('Error validating plan during phone approval:', err);
  }

  if (!planIsValid) {
    return { success: false, error: "Missing or invalid '## Testing Plan' section in implementation_plan.md" };
  }

  conv.planApproved = true;
  conv.awaitingPlanApproval = false;

  if (resolvedId === activeConversationId) {
    const buttons = document.querySelectorAll('.btn-approve-plan:not(.approved)');
    buttons.forEach(button => {
      button.classList.add('approved');
      button.disabled = true;
      button.textContent = '✓ Implementation Started';
      const card = button.closest('.plan-approval-actions');
      if (card) {
        card.classList.add('approved');
        const title = card.querySelector('.plan-approval-title');
        if (title) title.textContent = 'Implementation started';
        const subtitle = card.querySelector('.plan-approval-subtitle');
        if (subtitle) subtitle.textContent = 'Orion is building from this approved plan.';
      }
    });
  }

  const approvalText = "Plan approved via Phone Companion. Continuing implementation.";
  appendSystemMessage(approvalText, { conversationId: resolvedId, source: 'plan-approval' });

  const prompt = 'PLAN APPROVED — EXECUTE NOW. Do not summarize, describe, or restate the plan. Do not rewrite STRATEGY.md or implementation_plan.md — they are already approved. Read implementation_plan.md once to understand the tasks, then immediately start creating and editing the actual source code files. Work through every task. Update the checklist only for completed milestones. Run the test suite when done. Provide a Work Walkthrough.';
  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;
  if (isGlobalRunning) {
    window.promptQueue.push({ prompt, modelSelectValue: window.getSelectedModel(), conversationId: resolvedId, source: 'plan-approval' });
    persistAssistantStatusMessage(resolvedId, "Queued. Orion will continue the approved plan after the current task finishes.", {
      source: 'queue-status',
      dedupeKey: `plan-approval-queued-${resolvedId}`
    });
    return { success: true, queued: true };
  }

  window.runAgentLoop(prompt, window.getSelectedModel(), conv, { source: 'plan-approval', internalPrompt: true })
    .catch(err => console.error("Phone-started agent loop failed:", err));
  return { success: true, queued: false };
};

window.denyPhoneCompanionPlan = async (targetId) => {
  const resolvedId = targetId || activeConversationId;
  const conv = conversations.find(c => c.id === resolvedId);
  if (!conv) return { success: false, error: 'No active conversation' };
  conv.awaitingPlanApproval = false;
  conv.planApproved = false;
  if (resolvedId === activeConversationId) {
    const cards = document.querySelectorAll('.plan-approval-actions');
    cards.forEach(card => card.remove());
    appendSystemMessage("Phone companion denied the pending plan.");
  }
  saveConversationsToStorage();
  return { success: true, denied: true };
};

window.revisePhoneCompanionPlan = async (options) => {
  const text = typeof options === 'string' ? options.trim() : String(options.feedback || 'Revise the pending plan before implementing.').trim();
  const targetId = (typeof options === 'object' && options.conversationId) ? options.conversationId : activeConversationId;
  if (!text) return { success: false, error: 'Missing revision feedback' };
  return await window.submitPhoneCompanionPrompt({ prompt: `[Plan revision] ${text}`, conversationId: targetId });
};

// Mirrors desktop's submitClarificationAnswers (which reads answers directly out of DOM radio
// inputs), except the phone client already collected/validated the answers itself and just sends
// them as {header, question, answer} objects — this reuses the exact same conv.awaitingClarification
// shape and resume mechanism (a formatted "Here are my answers" user message, then window.runAgentLoop).
window.submitPhoneCompanionClarification = async ({ conversationId, answers } = {}) => {
  const resolvedId = conversationId || activeConversationId;
  const conv = conversations.find(c => c.id === resolvedId);
  if (!conv || !conv.awaitingClarification) return { success: false, error: 'No clarification questions waiting for answers' };
  if (!Array.isArray(answers) || answers.length === 0) return { success: false, error: 'Missing answers' };

  if (!appConfig.geminiApiKey) {
    return { success: false, error: 'Missing Gemini API key on desktop' };
  }

  const formattedAnswers = answers.map(a => `${a.header}: ${a.answer}`).join('\n');
  const userMessage = `Here are my answers:\n${formattedAnswers}`;

  conv.awaitingClarification = null;
  if (resolvedId === activeConversationId) {
    renderUserMessage(userMessage);
  }
  conv.messages.push({ role: 'user', text: userMessage, source: 'clarification-answers' });
  saveConversationsToStorage();

  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;
  if (isGlobalRunning) {
    window.promptQueue.push({ prompt: userMessage, modelSelectValue: window.getSelectedModel(), conversationId: resolvedId, source: 'clarification-answers' });
    persistAssistantStatusMessage(resolvedId, "Queued. Orion will continue once the current task finishes.", {
      source: 'queue-status',
      dedupeKey: `clarification-answers-queued-${resolvedId}`
    });
    return { success: true, queued: true };
  }

  window.runAgentLoop(userMessage, window.getSelectedModel(), conv, { source: 'clarification-answers', internalPrompt: true })
    .catch(err => console.error('Phone clarification resume failed:', err));
  return { success: true, queued: false };
};

window.stopPhoneCompanionTask = async (targetId) => {
  const resolvedId = targetId || activeConversationId;
  const globalRunningId = window.getRunningConversationId ? window.getRunningConversationId() : null;

  if (globalRunningId === resolvedId && window.stopAgentExecution) {
    window.stopAgentExecution();
    if (resolvedId === activeConversationId) {
      appendSystemMessage("Phone companion requested pause/stop.", {
        dedupeKey: `phone-stop-${resolvedId}`,
        windowMs: 3000
      });
    }
    return { success: true, stopped: true };
  }
  return { success: true, stopped: false };
};

window.resumePhoneCompanionTask = async (targetId) => {
  const resolvedId = targetId || activeConversationId;
  const prompt = 'Continue the previous task. First inspect current state and recent output, then continue only if it is still safe and useful.';
  return await window.submitPhoneCompanionPrompt({ prompt, conversationId: resolvedId });
};

window.discoverPhoneCompanionSkills = async (group) => {
  const result = await window.api.discoverSkills(group || null);
  if (!result || !result.success) return { skills: [], count: 0 };
  return { skills: result.skills, count: result.skills.length };
};

window.getPhoneCompanionModels = () => {
  const current = el.modelSelect ? el.modelSelect.value : (appConfig.defaultModel || 'gemini-2.5-flash-lite');
  const models = [];
  if (el.modelSelect) {
    for (const opt of el.modelSelect.options) {
      const group = opt.parentElement && opt.parentElement.tagName === 'OPTGROUP'
        ? opt.parentElement.label : 'Other';
      models.push({ value: opt.value, label: opt.textContent.trim(), group });
    }
  }
  return { current, models };
};

window.setPhoneCompanionModel = async (modelValue) => {
  if (!el.modelSelect) return { success: false, error: 'Model selector not available on desktop' };
  let found = false;
  for (let i = 0; i < el.modelSelect.options.length; i++) {
    if (el.modelSelect.options[i].value === modelValue) {
      el.modelSelect.selectedIndex = i;
      found = true;
      break;
    }
  }
  if (!found) return { success: false, error: `Unknown model: ${modelValue}` };
  appConfig.defaultModel = modelValue;
  localStorage.setItem('ag2_default_model', modelValue);
  try { await window.api.writeConfig(appConfig); } catch (_) {}
  return { success: true, model: modelValue };
};

window.runPhoneCompanionSkill = async ({ name, inputs } = {}) => {
  if (!name) return { success: false, error: "Missing 'name' parameter" };
  const result = await window.api.runSkill(name, inputs || {});
  if (!result || !result.success) return { success: false, error: (result && result.error) || `Skill '${name}' failed` };
  return { success: true, outputs: result.outputs };
};

function buildClarificationCardHtml(clarData) {
  const { intro, questions } = clarData;
  const escapedIntro = (intro || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const questionsHtml = (questions || []).map((q, qi) => {
    const escapedHeader = (q.header || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedQuestion = (q.question || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const optionsHtml = (q.options || []).map((opt, oi) => {
      const escapedLabel = (opt.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escapedDesc = (opt.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const recommendedBadge = opt.recommended
        ? `<span class="clarification-recommended-badge">Recommended</span>`
        : '';
      const descHtml = escapedDesc
        ? `<span class="clarification-option-desc">${escapedDesc}</span>`
        : '';
      return `
        <label class="clarification-option">
          <input type="radio" name="clarq_${qi}" value="${oi}" />
          <span class="clarification-option-body">
            <span class="clarification-option-label-row">
              <span class="clarification-option-label">${escapedLabel}</span>
              ${recommendedBadge}
            </span>
            ${descHtml}
          </span>
        </label>`;
    }).join('');

    return `
      <div class="clarification-question-block" data-qi="${qi}">
        <div class="clarification-question-header">
          <span class="clarification-chip">${escapedHeader}</span>
          <span class="clarification-question-text">${escapedQuestion}</span>
        </div>
        <div class="clarification-options">
          ${optionsHtml}
          <label class="clarification-other-row">
            <input type="radio" name="clarq_${qi}" value="__other__" />
            <input class="clarification-other-input" type="text" placeholder="Other — type your answer…" data-qi="${qi}" />
          </label>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="clarification-card">
      ${escapedIntro ? `<div class="clarification-intro">${escapedIntro}</div>` : ''}
      ${questionsHtml}
      <div class="clarification-actions">
        <button class="btn-clarification-submit" type="button">Submit</button>
      </div>
    </div>`;
}

async function submitClarificationAnswers({ button, bubble } = {}) {
  const conv = conversations.find(c => c.id === activeConversationId);
  if (!conv || !conv.awaitingClarification) return;

  const clarData = conv.awaitingClarification;
  const questions = clarData.questions || [];

  // Collect answers from the bubble's form controls
  const answers = [];
  let allAnswered = true;
  questions.forEach((q, qi) => {
    const block = bubble ? bubble.querySelector(`.clarification-question-block[data-qi="${qi}"]`) : null;
    let answer = null;
    if (block) {
      const checked = block.querySelector(`input[type="radio"][name="clarq_${qi}"]:checked`);
      if (checked) {
        if (checked.value === '__other__') {
          const otherInput = block.querySelector(`.clarification-other-input[data-qi="${qi}"]`);
          answer = otherInput ? otherInput.value.trim() : '';
        } else {
          const optIdx = parseInt(checked.value, 10);
          answer = (q.options[optIdx] && q.options[optIdx].label) || '';
        }
      }
    }
    if (!answer) allAnswered = false;
    answers.push({ header: q.header, question: q.question, answer: answer || '(no answer)' });
  });

  if (!allAnswered) {
    // Briefly flash the submit button to signal something is missing
    if (button) {
      button.textContent = 'Answer all questions first';
      setTimeout(() => { button.textContent = 'Submit'; }, 1800);
    }
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Submitting…';
  }
  if (bubble) {
    const card = bubble.querySelector('.clarification-card');
    if (card) card.classList.add('answered');
  }

  // Format answers as a readable user message
  const formattedAnswers = answers.map(a => `${a.header}: ${a.answer}`).join('\n');
  const userMessage = `Here are my answers:\n${formattedAnswers}`;

  // Clear the awaiting state
  conv.awaitingClarification = null;

  // Render answers as a visible user message and persist to history
  renderUserMessage(userMessage);
  conv.messages.push({ role: 'user', text: userMessage, source: 'clarification-answers' });
  saveConversationsToStorage();

  if (!appConfig.geminiApiKey) {
    el.settingsModal.classList.add('active');
    appendSystemMessage("Please enter and save your Gemini API Key first.");
    return;
  }

  window.runAgentLoop(userMessage, el.modelSelect.value, conv, { source: 'clarification-answers' })
    .catch(err => console.error('Clarification resume failed:', err));
}

async function approveCurrentPlanAndContinue(options = {}) {
  const button = options.button || null;
  const originalLabel = button ? button.textContent : '';
  const restoreButton = () => {
    if (!button) return;
    button.disabled = false;
    button.classList.remove('approved');
    button.textContent = originalLabel || 'Start Implementation';
  };
  if (button) {
    button.disabled = true;
    button.textContent = 'Starting…';
  }

  const conv = conversations.find(c => c.id === activeConversationId);
  if (!conv) { restoreButton(); return { success: false, error: 'No active conversation' }; }
  if (!conv.awaitingPlanApproval) { restoreButton(); return { success: false, error: 'No plan is awaiting approval' }; }
  if (!appConfig.geminiApiKey) {
    el.settingsModal.classList.add('active');
    appendSystemMessage("Please enter and save your Gemini API Key first.");
    restoreButton();
    return { success: false, error: 'Missing Gemini API key' };
  }

  // Re-validate the testing plan section in implementation_plan.md
  let planIsValid = false;
  try {
    const planText = await readConversationTextArtifact(conv, 'implementation_plan.md', { maxChars: 100000 });
    planIsValid = hasRequiredTestingPlanSection(planText);
  } catch (err) {
    console.error('Error validating plan during approval:', err);
  }

  if (!planIsValid) {
    appendSystemMessage("Approval rejected: The implementation plan is missing a valid '## Testing Plan' section. Please ask the agent to revise the plan.");
    restoreButton();
    return { success: false, error: "Missing or invalid '## Testing Plan' section in implementation_plan.md" };
  }

  if (button) {
    button.classList.add('approved');
    button.disabled = true;
    button.textContent = '✓ Implementation Started';
    // Update the surrounding card immediately so it matches the persistent "started" state
    // rendered on reload — no flicker, and it clearly reflects that the button was pressed.
    const card = button.closest('.plan-approval-actions');
    if (card) card.classList.add('approved');
    const title = card && card.querySelector('.plan-approval-title');
    if (title) title.textContent = 'Implementation started';
    const subtitle = card && card.querySelector('.plan-approval-subtitle');
    if (subtitle) subtitle.textContent = 'Orion is building from this approved plan.';
  }

  conv.planApproved = true;
  conv.awaitingPlanApproval = false;

  const approvalText = "Plan approved. Continuing implementation.";
  appendSystemMessage(approvalText, { conversationId: activeConversationId, source: 'plan-approval' });

  const prompt = 'PLAN APPROVED — EXECUTE NOW. Do not summarize, describe, or restate the plan. Do not rewrite STRATEGY.md or implementation_plan.md — they are already approved. Read implementation_plan.md once to understand the tasks, then immediately start creating and editing the actual source code files. Work through every task. Update the checklist only for completed milestones. Run the test suite when done. Provide a Work Walkthrough.';

  if (window.runAgentLoop) {
    if (window.isAgentRunning && window.isAgentRunning()) {
      window.promptQueue.push({ prompt, modelSelectValue: el.modelSelect.value, conversationId: conv.id, alreadyRendered: true, source: 'plan-approval' });
      appendSystemMessage("Another task is currently running. Approved plan execution was queued.");
      return { success: true, queued: true };
    }
    window.runAgentLoop(prompt, el.modelSelect.value, conv, { source: 'plan-approval', internalPrompt: true })
      .catch(err => console.error("Desktop-started agent loop failed:", err));
    return { success: true, queued: false };
  }
  return { success: false, error: 'Agent engine is not ready' };
}

function deleteConversation(id) {
  const convToDelete = conversations.find(c => c.id === id);
  const parentProj = convToDelete ? convToDelete.projectPath : '';
  cleanupConversationArtifacts(id);
  
  conversations = conversations.filter(c => c.id !== id);
  saveConversationsToStorage();
  
  if (activeConversationId === id) {
    const siblingConversations = conversations.filter(c => c.projectPath === parentProj);
    if (siblingConversations.length > 0) {
      selectConversation(siblingConversations[0].id);
    } else {
      if (parentProj) {
        createNewConversationUnderProject(parentProj);
      } else {
        createNewConversation();
      }
    }
  } else {
    renderConversationList();
    renderProjectsList();
  }
}

function removeProject(path) {
  const removedConversationIds = conversations.filter(c => c.projectPath === path).map(c => c.id);
  removedConversationIds.forEach(cleanupConversationArtifacts);
  projects = projects.filter(p => p !== path);
  saveProjectsToStorage();
  
  // Cascade delete all conversations belonging to this project
  conversations = conversations.filter(c => c.projectPath !== path);
  saveConversationsToStorage();
  
  const activeConv = conversations.find(c => c.id === activeConversationId);
  if (!activeConv) {
    createNewConversation();
  } else {
    renderConversationList();
    renderProjectsList();
  }
}

function cleanupConversationArtifacts(id) {
  if (!id || !window.api || typeof window.api.deleteConversationArtifacts !== 'function') return;
  window.api.deleteConversationArtifacts(id).catch(err => {
    console.warn('Failed to delete conversation artifacts:', err);
  });
}

// Shared helper — builds one project card and appends it to el.projectList
function buildProjectCard(path) {
  const activeConv = conversations.find(c => c.id === activeConversationId);
  const isCurrent = path === currentWorkspace || (activeConv && activeConv.projectPath === path);
  const rawName = path.substring(path.lastIndexOf('\\') + 1) || path;
  const name = toTitleCase(rawName);

  const projectContainer = document.createElement('div');
  projectContainer.className = 'project-container';
  projectContainer.style.display = 'flex';
  projectContainer.style.flexDirection = 'column';
  projectContainer.style.marginBottom = '8px';

  const projectHeader = document.createElement('div');
  projectHeader.className = `project-item ${isCurrent ? 'active' : ''}`;
  projectHeader.style.display = 'flex';
  projectHeader.style.alignItems = 'center';

  projectHeader.innerHTML = `
    <span class="folder-icon">📁</span>
    <div class="project-details row-details-flex">
      <span class="project-name" style="font-weight:600;">${escapeHtml(name)}</span>
      <span class="project-subtext" title="${escapeHtml(path)}" style="font-size: 0.65rem;">${escapeHtml(path)}</span>
    </div>
    <button class="add-conv-btn icon-btn-ghost icon-btn-spaced" title="New Conversation in Project">+</button>
    <button class="delete-btn icon-btn-ghost" title="Remove project">&times;</button>
  `;

  projectHeader.querySelector('.project-details').addEventListener('click', () => {
    setWorkspace(path);
  });

  projectHeader.querySelector('.add-conv-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setWorkspace(path);
    createNewConversationUnderProject(path);
  });

  projectHeader.querySelector('.delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const approved = await showOrionConfirmDialog({
      title: 'Remove project?',
      message: `Remove "${name}" and delete its conversations from Orion? This cannot be undone.`,
      confirmLabel: 'Remove',
      danger: true
    });
    if (approved?.confirmed) {
      removeProject(path);
    }
  });

  projectContainer.appendChild(projectHeader);

  // Indented child conversations
  const convsList = document.createElement('div');
  convsList.className = 'project-conversations-list';
  convsList.style.paddingLeft = '20px';
  convsList.style.display = 'flex';
  convsList.style.flexDirection = 'column';
  convsList.style.gap = '2px';
  convsList.style.marginTop = '2px';

  const projectConversations = conversations.filter(c => c.projectPath === path);
  if (projectConversations.length === 0) {
    convsList.innerHTML = `<div class="empty-state" style="padding: 4px; text-align: left; font-size: 0.75rem; font-style: italic; color: var(--text-muted);">No conversations yet</div>`;
  } else {
    projectConversations.forEach(conv => {
      const isConvActive = conv.id === activeConversationId;
      const convItem = document.createElement('div');
      convItem.className = `conversation-item ${isConvActive ? 'active' : ''}`;
      convItem.style.padding = '4px 8px';
      convItem.style.borderRadius = '4px';
      convItem.style.display = 'flex';
      convItem.style.alignItems = 'center';

      convItem.innerHTML = `
        <div class="conversation-details row-details-flex" style="display: flex; flex-direction: column;">
          <span class="conversation-name" style="font-size: 0.8rem; color: ${isConvActive ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight: ${isConvActive ? '500' : 'normal'};">${escapeHtml(conv.title)}</span>
        </div>
        <button class="delete-btn icon-btn-ghost" title="Delete conversation">&times;</button>
      `;

      convItem.querySelector('.conversation-details').addEventListener('click', () => {
        selectConversation(conv.id);
      });

      convItem.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const approved = await confirmConversationDelete(conv.title);
        if (approved?.confirmed) {
          deleteConversation(conv.id);
        }
      });

      convsList.appendChild(convItem);
    });
  }

  projectContainer.appendChild(convsList);
  el.projectList.appendChild(projectContainer);
}

function renderProjectsList() {
  el.projectList.innerHTML = '';

  if (projects.length === 0) {
    el.projectList.innerHTML = `
      <div class="project-item active" id="default-proj-item">
        <span class="folder-icon">📁</span>
        <div class="project-details">
          <span class="project-name">Default Workspace</span>
          <span class="project-subtext">Select folder to start</span>
        </div>
      </div>
    `;
    return;
  }

  projects.forEach(path => buildProjectCard(path));
}

function filterProjects(query) {
  if (!query) {
    renderProjectsList();
    return;
  }

  el.projectList.innerHTML = '';

  projects.forEach(path => {
    const rawName = path.substring(path.lastIndexOf('\\') + 1) || path;
    const name = toTitleCase(rawName);
    if (!name.toLowerCase().includes(query.toLowerCase())) return;
    buildProjectCard(path);
  });
}

window.renderConversationList = renderConversationList;
window.renderProjectsList = renderProjectsList;

window.onRagStatusChange = (statusText) => {
  const badge = document.getElementById('rag-index-status');
  if (!badge) return;
  badge.textContent = statusText;
  badge.style.display = statusText ? 'inline-block' : 'none';
  
  if (statusText.startsWith('Indexing')) {
    badge.textContent = 'Indexing…';
    badge.className = 'badge warning pulse';
  } else if (statusText === 'Semantic Ready') {
    badge.textContent = 'Indexed';
    badge.className = 'badge success';
  } else if (statusText === 'Awaiting API Key') {
    badge.className = 'badge danger';
  } else {
    badge.className = 'badge muted';
  }
};

window.getCurrentProject = () => currentWorkspace;
