// STATE MANAGEMENT
let appConfig = {
  geminiApiKey: '',
  googleSearchEngineId: '3354e92e98ab54b31',
  googleSearchApiKey: '',
  defaultModel: 'gemini-2.5-flash-lite',
  compactThresholdTokens: 100000,
  autoCompact: true,
  modelContextBudgets: {
    'gemini-2.5-flash-lite': 1000000,
    'gemini-2.5-flash': 1000000,
    'gemini-2.5-pro': 1000000,
    default: 128000
  },
  commandTimeoutMs: 120000,
  regressionTestCommand: 'npm test',
  autoTest: true,
  planningMode: true
};

let currentWorkspace = '';
let activeConversationId = null;
let conversations = []; // { id, title, messages, tasks, testResults }
let activeProcessId = null;
let projects = []; // Array of workspace folder paths
let activeAiBubble = null; // Currently rendering AI message bubble
let currentFileTreeItems = [];
let expandedFileFolders = new Set();

// DOM ELEMENTS
const el = {
  // Window controls
  btnMinimize: document.getElementById('btn-minimize'),
  btnMaximize: document.getElementById('btn-maximize'),
  btnClose: document.getElementById('btn-close'),
  workspaceLabel: document.getElementById('workspace-label'),
  
  // Sidebar items
  btnNewChat: document.getElementById('btn-new-chat'),
  btnAddConversation: document.getElementById('btn-add-conversation'),
  projectList: document.getElementById('project-list'),
  conversationList: document.getElementById('conversation-list'),
  btnSettings: document.getElementById('btn-settings'),
  btnChangeWorkspace: document.getElementById('btn-change-workspace'),
  btnSyncFiles: document.getElementById('btn-sync-files'),
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
  settingGoogleSearchEngineId: document.getElementById('setting-google-search-engine-id'),
  settingGoogleSearchApiKey: document.getElementById('setting-google-search-api-key'),
  settingWorkspacePath: document.getElementById('setting-workspace-path'),
  settingTestCmd: document.getElementById('setting-test-cmd'),
  settingCommandTimeout: document.getElementById('setting-command-timeout'),
  settingCompactThreshold: document.getElementById('setting-compact-threshold'),
  settingAutoTest: document.getElementById('setting-auto-test'),
  settingPlanningMode: document.getElementById('setting-planning-mode'),
  btnBrowseDefaultWorkspace: document.getElementById('btn-browse-default-workspace'),
  
  // Right Agent Panel
  taskChecklist: document.getElementById('task-checklist-container'),
  taskCompletionBadge: document.getElementById('task-completion-badge'),
  testIndicator: document.getElementById('test-indicator'),
  lblTestCmd: document.getElementById('lbl-test-cmd'),
  testResults: document.getElementById('test-results-container'),
  btnRunTestsManually: document.getElementById('btn-run-tests-manually'),
  fileTree: document.getElementById('file-tree-container'),
  fileCountBadge: document.getElementById('file-count-badge'),
  workspaceEntrypointInput: document.getElementById('workspace-entrypoint-input'),
  btnSaveEntrypoint: document.getElementById('btn-save-entrypoint'),
  fileViewerModal: document.getElementById('file-viewer-modal'),
  fileViewerTitle: document.getElementById('file-viewer-title'),
  fileViewerContent: document.getElementById('file-viewer-content'),
  btnFileViewerClose: document.getElementById('btn-file-viewer-close'),
  btnFileViewerMention: document.getElementById('btn-file-viewer-mention')
};

let viewedFilePath = '';

// INITIALIZE APP
document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  await loadSettings();
  setupSettingsModal();
  setupFileViewerModal();
  setupWorkspaceHandlers();
  setupEntrypointControls();
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
  loadConversationsFromStorage();
  
  // Migrate any project conversations that accumulated in standalone list
  migrateConversations();
  
  // Select first conversation if exists, otherwise create new one
  if (conversations.length > 0) {
    selectConversation(conversations[0].id);
  } else {
    createNewConversation();
  }
});

// --- ELECTRON WINDOW BINDINGS ---
function setupWindowControls() {
  el.btnMinimize.addEventListener('click', () => window.api.minimizeWindow());
  el.btnMaximize.addEventListener('click', () => window.api.maximizeWindow());
  el.btnClose.addEventListener('click', () => window.api.closeWindow());
}

// --- SETTINGS CONFIGURATION ---
async function loadSettings() {
  const loadedConfig = await window.api.readConfig();
  if (loadedConfig && Object.keys(loadedConfig).length > 0) {
    appConfig = { ...appConfig, ...loadedConfig };
  }
  
  // Apply settings to form fields
  el.settingApiKey.value = appConfig.geminiApiKey || '';
  el.settingGoogleSearchEngineId.value = appConfig.googleSearchEngineId || '';
  el.settingGoogleSearchApiKey.value = appConfig.googleSearchApiKey || '';
  el.settingWorkspacePath.value = appConfig.defaultWorkspacePath || '';
  if (el.settingTestCmd) el.settingTestCmd.value = appConfig.regressionTestCommand || 'npm test';
  if (el.settingCommandTimeout) el.settingCommandTimeout.value = appConfig.commandTimeoutMs || 120000;
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
    appConfig.googleSearchEngineId = el.settingGoogleSearchEngineId.value.trim();
    appConfig.googleSearchApiKey = el.settingGoogleSearchApiKey.value.trim();
    appConfig.defaultWorkspacePath = el.settingWorkspacePath.value.trim();
    appConfig.regressionTestCommand = el.settingTestCmd ? el.settingTestCmd.value.trim() : appConfig.regressionTestCommand;
    appConfig.commandTimeoutMs = el.settingCommandTimeout ? (parseInt(el.settingCommandTimeout.value) || 120000) : appConfig.commandTimeoutMs;
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
  el.workspaceLabel.textContent = folderPath;
  
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
  if (raw) {
    try {
      projects = JSON.parse(raw);
    } catch (e) {
      projects = [];
    }
  }
}

function saveProjectsToStorage() {
  localStorage.setItem('ag2_projects', JSON.stringify(projects));
}

// PROJECTS LIST ARCHITECTURE COMPLETED - DUPES REMOVED

async function syncWorkspaceFiles() {
  if (!currentWorkspace) return;
  el.fileTree.innerHTML = '<p class="empty-state">Scanning directory...</p>';
  loadWorkspaceEntrypoint();
  
  const files = await window.api.listFiles(currentWorkspace);
  el.fileCountBadge.textContent = files.length;
  
  if (files.length === 0) {
    el.fileTree.innerHTML = '<p class="empty-state">No files found.</p>';
    autoDetectTestCommand(files);
    return;
  }

  currentFileTreeItems = files;
  renderFileTree(files);
  autoDetectTestCommand(files);
  return;
  
  el.fileTree.innerHTML = '';
  
  // Sort files: directories first, then files alphabetically
  files.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && a.isDir) return 1;
    return a.path.localeCompare(b.path);
  });
  
  files.forEach(file => {
    const fileNode = document.createElement('div');
    fileNode.className = `file-node ${file.isDir ? 'folder' : 'file'}`;
    fileNode.style.paddingLeft = `${(file.path.split('\\').length - 1) * 8 + 6}px`;
    
    const icon = file.isDir ? '📁' : '📄';
    fileNode.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name" title="${file.path}">${file.name}</span>
    `;
    
    if (!file.isDir) {
      fileNode.addEventListener('click', () => insertFileReference(file.path));
    }
    
    el.fileTree.appendChild(fileNode);
  });
  
  autoDetectTestCommand(files);
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
    
    const isExpanded = expandedFileFolders.has(node.path);
    const hasChildren = node.isDir && node.children.size > 0;
    const caret = node.isDir ? (isExpanded ? 'v' : '>') : '';
    const icon = node.isDir ? (isExpanded ? '[-]' : '[+]') : '';
    
    row.innerHTML = `
      <span class="file-caret">${caret}</span>
      <span class="file-icon">${icon}</span>
      <span class="file-name" title="${escapeHtml(node.path)}">${escapeHtml(node.name)}</span>
      ${node.isDir ? '' : '<button class="file-mention-btn" title="Mention this file in chat">@</button>'}
    `;
    
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
    
    container.appendChild(row);
    
    if (node.isDir && isExpanded && hasChildren) {
      renderFileTreeChildren(node.children, container, depth + 1);
    }
  });
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
    
    if (detectedCmd && appConfig.regressionTestCommand !== detectedCmd) {
      const isDefault = appConfig.regressionTestCommand === 'npm test' || !appConfig.regressionTestCommand;
      const foundExplicitTestFile = (testJsFile || testPyFile || testGoFile) && !hasPackageJson;
      
      if (isDefault || foundExplicitTestFile) {
        appConfig.regressionTestCommand = detectedCmd;
        if (el.lblTestCmd) el.lblTestCmd.textContent = detectedCmd;
        if (el.settingTestCmd) el.settingTestCmd.value = detectedCmd;
        await window.api.writeConfig(appConfig);
        appendSystemMessage(`Detected workspace test suite. Regression test command updated to: "${detectedCmd}"`, {
          dedupeKey: `detected-test-command:${currentWorkspace}:${detectedCmd}`,
          windowMs: 60000
        });
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
  viewedFilePath = relPath;
  el.fileViewerTitle.textContent = relPath;
  el.fileViewerContent.textContent = 'Loading...';
  el.fileViewerModal.classList.add('active');
  
  const content = await window.api.readFile(currentWorkspace, relPath, { maxChars: 200000 });
  if (content && content.error) {
    el.fileViewerContent.textContent = `Error loading file: ${content.error}`;
    return;
  }
  el.fileViewerContent.textContent = content || '';
}

function closeFileViewer() {
  viewedFilePath = '';
  if (el.fileViewerModal) el.fileViewerModal.classList.remove('active');
}

// --- CHAT INTERFACE & RENDERERS ---
function setupChatHandlers() {
  el.btnSubmit.addEventListener('click', () => {
    if (window.isAgentRunning && window.isAgentRunning()) {
      window.stopAgentExecution();
    } else {
      submitMessage();
    }
  });
  
  el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (window.isAgentRunning && window.isAgentRunning()) {
        triggerSteer();
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
  
  if (window.steeringQueue) {
    window.steeringQueue.push(text);
    appendSteeringMessage(text);
  }
  el.chatInput.value = '';
  document.getElementById('btn-steer').style.display = 'none';
  document.getElementById('btn-queue').style.display = 'none';
}

function triggerQueue() {
  const text = el.chatInput.value.trim();
  if (!text) return;
  
  if (window.promptQueue) {
    window.promptQueue.push({ prompt: text, modelSelectValue: el.modelSelect.value, conversationId: activeConversationId });
    appendQueuedMessage(text);
  }
  el.chatInput.value = '';
  document.getElementById('btn-steer').style.display = 'none';
  document.getElementById('btn-queue').style.display = 'none';
}

function appendSteeringMessage(text) {
  renderUserMessage(`[🎯 Steering] ${text}`);
  const conv = conversations.find(c => c.id === activeConversationId);
  if (conv) {
    conv.messages.push({ role: 'user', text: `[🎯 Steering] ${text}` });
    saveConversationsToStorage();
  }
}

function appendQueuedMessage(text) {
  renderSystemBubble(`⏳ Prompt Queued: "${text}"`);
  const conv = conversations.find(c => c.id === activeConversationId);
  if (conv) {
    conv.messages.push({ role: 'system', text: `⏳ Prompt Queued: "${text}"` });
    saveConversationsToStorage();
  }
}

function createNewConversation() {
  const newId = 'conv_' + Date.now();
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
  const newId = 'conv_' + Date.now();
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

function loadConversationsFromStorage() {
  const raw = localStorage.getItem('ag2_conversations');
  if (raw) {
    try {
      conversations = JSON.parse(raw);
    } catch(e) {
      conversations = [];
    }
  }
}

function migrateConversations() {
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
  });
  if (updated) {
    saveConversationsToStorage();
  }
}

function saveConversationsToStorage() {
  localStorage.setItem('ag2_conversations', JSON.stringify(conversations));
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
      <div class="conversation-details" style="flex: 1; overflow: hidden;">
        <span class="conversation-name">${escapeHtml(conv.title)}</span>
        <span class="conversation-time">${age}</span>
      </div>
      <button class="delete-btn" title="Delete conversation" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1;">&times;</button>
    `;
    
    item.querySelector('.conversation-details').addEventListener('click', () => selectConversation(conv.id));
    
    item.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const approved = await window.api.showConfirmDialog(`Delete conversation "${conv.title}"?`, 'Delete Conversation');
      if (approved) {
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
    el.workspaceLabel.textContent = conv.workspace;
    syncWorkspaceFiles();
  } else {
    // Brand new conversation
    currentWorkspace = '';
    el.workspaceLabel.textContent = conv.projectPath ? `${conv.projectPath} > [Pending First Message]` : 'Pending First Message';
    el.fileTree.innerHTML = '<p class="empty-state">Workspace will initialize upon sending your first prompt.</p>';
    el.fileCountBadge.textContent = '0';
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
    
    conv.messages.forEach(msg => {
      window.clearActiveAiBubble();
      if (msg.role === 'user') {
        renderUserMessage(msg.text);
      } else if (msg.role === 'assistant') {
        renderAiMessage(msg.text, msg.logs);
      } else if (msg.role === 'system') {
        renderSystemBubble(msg.text);
      }
    });
    window.clearActiveAiBubble();
  }
  
  // Reload tasks & tests
  updateTasksChecklist(conv.tasks);
  updateTestResultsPanel(conv.testResults);
  
  // Scroll to bottom
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
  
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
  
  // Initialize title & folder path if first prompt
  if (!conv.workspace) {
    const title = prompt.length > 25 ? prompt.substring(0, 25) + '...' : prompt;
    conv.title = title;
    el.chatTitle.textContent = title;
    
    if (conv.projectPath) {
      conv.workspace = conv.projectPath;
    } else {
      const slug = slugify(title);
      conv.workspace = 'C:\\Users\\Owner\\.gemini\\antigravity\\scratch\\standalone' + '\\' + slug;
    }
  }
  
  // Ensure currentWorkspace is locked onto this isolated folder
  currentWorkspace = conv.workspace;
  expandedFileFolders = new Set();
  el.workspaceLabel.textContent = currentWorkspace;
  syncWorkspaceFiles();
  
  // Update messages history
  conv.messages.push({ role: 'user', text: prompt });
  saveConversationsToStorage();
  
  renderConversationList();
  renderProjectsList();
  
  // Scroll to bottom
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
  
  // Trigger local Agent loop
  if (window.runAgentLoop) {
    const selectedModel = el.modelSelect.value;
    if (window.isAgentRunning && window.isAgentRunning()) {
      window.promptQueue.push({ prompt, modelSelectValue: selectedModel, conversationId: conv.id, alreadyRendered: true });
      appendSystemMessage("Another conversation is currently running. This prompt was queued for this conversation.");
    } else {
      await window.runAgentLoop(prompt, selectedModel, conv);
    }
  } else {
    appendSystemMessage("Agent engine is loading... please try again in a moment.");
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
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
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="message-header user">🧑 User</div>
    <div class="message-body">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
  `;
  el.messagesContainer.appendChild(bubble);
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
}

function appendSystemMessage(text, options = {}) {
  const dedupeKey = options.dedupeKey || text;
  const windowMs = Number(options.windowMs || 1500);
  window.recentSystemMessages = window.recentSystemMessages || {};
  const now = Date.now();
  const lastAt = window.recentSystemMessages[dedupeKey] || 0;
  if (now - lastAt < windowMs) {
    return;
  }
  const conv = conversations.find(c => c.id === activeConversationId);
  if (conv && options.dedupeKey) {
    conv.systemMessageDedupe = conv.systemMessageDedupe || {};
    const convLastAt = conv.systemMessageDedupe[dedupeKey] || 0;
    if (now - convLastAt < windowMs) {
      return;
    }
    conv.systemMessageDedupe[dedupeKey] = now;
  }
  window.recentSystemMessages[dedupeKey] = now;
  
  renderSystemBubble(text);
  if (conv) {
    conv.messages.push({ role: 'system', text: text });
    saveConversationsToStorage();
  }
}

function renderSystemBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="message-header" style="color: var(--text-muted);">⚙️ System</div>
    <div class="message-body" style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(text)}</div>
  `;
  el.messagesContainer.appendChild(bubble);
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
}

// Generates structural AI Response with step thought details
function renderAiMessage(text, logs = []) {
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
  if (logs && logs.length > 0) {
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
  const renderedMarkdown = typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text);
  
  let runningIndicatorHtml = '';
  const runningConversationId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  if (window.isAgentRunning && window.isAgentRunning() && runningConversationId === activeConversationId) {
    const stepNum = window.currentLoopCount || 1;
    
    // Check if the current conversation's plan has been approved
    let isApproved = false;
    if (typeof conversations !== 'undefined' && typeof activeConversationId !== 'undefined') {
      const activeConv = conversations.find(c => c.id === activeConversationId);
      if (activeConv && activeConv.planApproved) {
        isApproved = true;
      }
    }
    
    const statusLabel = isApproved 
      ? `Executing autonomously (Step ${stepNum})...` 
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
      ${runningIndicatorHtml}
    </div>
  `;
  
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
  Prism.highlightAllUnder(bubble);
  
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
  
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
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
    el.taskCompletionBadge.textContent = '0%';
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
  
  const result = await window.api.runCommand(appConfig.regressionTestCommand, currentWorkspace, processId, appConfig.commandTimeoutMs || 120000);
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
window.getCurrentWorkspace = () => currentWorkspace;
window.getSelectedModel = () => el.modelSelect ? el.modelSelect.value : appConfig.defaultModel;
window.selectConversationById = selectConversation;
window.updateTasksChecklist = updateTasksChecklist;
window.updateTestResultsPanel = updateTestResultsPanel;
window.runRegressionTests = runRegressionTests;
window.renderAiMessage = renderAiMessage;
window.appendSystemMessage = appendSystemMessage;
window.syncWorkspaceFiles = syncWorkspaceFiles;
window.refreshWorkspaceEntrypoint = loadWorkspaceEntrypoint;

window.clearActiveAiBubble = () => {
  activeAiBubble = null;
};

window.onAgentStatusChange = (running) => {
  const submitBtn = el.btnSubmit;
  const steerBtn = document.getElementById('btn-steer');
  const queueBtn = document.getElementById('btn-queue');
  
  if (running) {
    submitBtn.classList.add('btn-stop');
    submitBtn.innerHTML = '⏹';
    submitBtn.title = 'Stop agent task execution';
  } else {
    submitBtn.classList.remove('btn-stop');
    submitBtn.innerHTML = '✦';
    submitBtn.title = 'Send message';
    steerBtn.style.display = 'none';
    queueBtn.style.display = 'none';
  }
};
window.renderUserMessageInChat = renderUserMessage;
window.getPhoneCompanionState = () => {
  const conv = conversations.find(c => c.id === activeConversationId);
  const messages = conv && conv.messages ? conv.messages.slice(-40).map(msg => ({
    role: msg.role,
    text: msg.role === 'assistant' && msg.text === 'Thinking...' && msg.logs && msg.logs.length
      ? msg.logs.map(log => log.content || log.result || '').filter(Boolean).join('\n')
      : (msg.text || '')
  })) : [];
  
  return {
    conversationId: activeConversationId,
    title: conv ? conv.title : '',
    workspace: conv ? (conv.workspace || conv.projectPath || currentWorkspace || '') : currentWorkspace,
    running: window.isAgentRunning ? window.isAgentRunning() : false,
    model: window.getSelectedModel(),
    messages
  };
};

window.submitPhoneCompanionPrompt = async (prompt) => {
  const text = String(prompt || '').trim();
  if (!text) return { success: false, error: 'Missing prompt' };
  if (!activeConversationId || !conversations.find(c => c.id === activeConversationId)) {
    createNewConversation();
  }
  el.chatInput.value = text;
  await submitMessage();
  return { success: true, queued: window.isAgentRunning && window.isAgentRunning() };
};

function deleteConversation(id) {
  const convToDelete = conversations.find(c => c.id === id);
  const parentProj = convToDelete ? convToDelete.projectPath : '';
  
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

function renderProjectsList() {
  el.projectList.innerHTML = '';
  
  const activeConv = conversations.find(c => c.id === activeConversationId);
  
  projects.forEach(path => {
    const isCurrent = path === currentWorkspace || (activeConv && activeConv.projectPath === path);
    const name = path.substring(path.lastIndexOf('\\') + 1) || path;
    
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
      <div class="project-details" style="flex: 1; overflow: hidden;">
        <span class="project-name" style="font-weight:600;">${escapeHtml(name)}</span>
        <span class="project-subtext" title="${escapeHtml(path)}" style="font-size: 0.65rem;">${escapeHtml(path)}</span>
      </div>
      <button class="add-conv-btn" title="New Conversation in Project" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1; margin-right:4px;">+</button>
      <button class="delete-btn" title="Remove project" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1;">&times;</button>
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
      const approved = await window.api.showConfirmDialog(`Remove project "${name}" and delete its conversations?`, 'Remove Project');
      if (approved) {
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
          <div class="conversation-details" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
            <span class="conversation-name" style="font-size: 0.8rem; color: ${isConvActive ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight: ${isConvActive ? '500' : 'normal'};">${escapeHtml(conv.title)}</span>
          </div>
          <button class="delete-btn" title="Delete conversation" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1;">&times;</button>
        `;
        
        convItem.querySelector('.conversation-details').addEventListener('click', () => {
          selectConversation(conv.id);
        });
        
        convItem.querySelector('.delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const approved = await window.api.showConfirmDialog(`Delete conversation "${conv.title}"?`, 'Delete Conversation');
          if (approved) {
            deleteConversation(conv.id);
          }
        });
        
        convsList.appendChild(convItem);
      });
    }
    
    projectContainer.appendChild(convsList);
    el.projectList.appendChild(projectContainer);
  });
  
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
  }
}

function filterProjects(query) {
  if (!query) {
    renderProjectsList();
    return;
  }
  
  el.projectList.innerHTML = '';
  
  projects.forEach(path => {
    const name = path.substring(path.lastIndexOf('\\') + 1) || path;
    if (!name.toLowerCase().includes(query.toLowerCase())) return;
    
    const activeConv = conversations.find(c => c.id === activeConversationId);
    const isCurrent = path === currentWorkspace || (activeConv && activeConv.projectPath === path);
    
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
      <div class="project-details" style="flex: 1; overflow: hidden;">
        <span class="project-name" style="font-weight:600;">${escapeHtml(name)}</span>
        <span class="project-subtext" title="${escapeHtml(path)}" style="font-size: 0.65rem;">${escapeHtml(path)}</span>
      </div>
      <button class="add-conv-btn" title="New Conversation in Project" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1; margin-right:4px;">+</button>
      <button class="delete-btn" title="Remove project" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1;">&times;</button>
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
      const approved = await window.api.showConfirmDialog(`Remove project "${name}" and delete its conversations?`, 'Remove Project');
      if (approved) {
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
          <div class="conversation-details" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
            <span class="conversation-name" style="font-size: 0.8rem; color: ${isConvActive ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight: ${isConvActive ? '500' : 'normal'};">${escapeHtml(conv.title)}</span>
          </div>
          <button class="delete-btn" title="Delete conversation" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; padding:0 4px; line-height:1;">&times;</button>
        `;
        
        convItem.querySelector('.conversation-details').addEventListener('click', () => {
          selectConversation(conv.id);
        });
        
        convItem.querySelector('.delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const approved = await window.api.showConfirmDialog(`Delete conversation "${conv.title}"?`, 'Delete Conversation');
          if (approved) {
            deleteConversation(conv.id);
          }
        });
        
        convsList.appendChild(convItem);
      });
    }
    
    projectContainer.appendChild(convsList);
    el.projectList.appendChild(projectContainer);
  });
}

window.renderConversationList = renderConversationList;
window.renderProjectsList = renderProjectsList;
