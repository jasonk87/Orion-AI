// Configure marked to escape raw HTML blocks to prevent XSS in Electron renderer.
// Must NOT escape & first — doing so then letting marked parse the output causes
// double-escaping (&amp; → &amp;amp;). Escape in a single pass using a regex that
// replaces only the raw characters, never already-escaped sequences.
if (typeof marked !== 'undefined') {
  marked.use({
    renderer: {
      html(htmlText) {
        // Single-pass escape: replace raw &, < and > but skip &xxx; entities already present.
        return String(htmlText).replace(/&(?![a-zA-Z#]\w{0,24};)|[<>]/g, ch => {
          if (ch === '&') return '&amp;';
          if (ch === '<') return '&lt;';
          return '&gt;';
        });
      }
    }
  });
}

function sanitizeRenderedMarkdown(container) {
  container.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:|mailto:|orion-file:|orion-artifact:\/\/)/i.test(href)) {
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
// Every cold launch begins at a clean Dispatch draft. Mode changes during the running app are
// still preserved in memory, but an old persisted UI preference must not reopen Coder or an old
// Dispatch transcript on the next launch.
let appMode = 'orion'; // 'orion' | 'coder'
let lastDispatchConversationId = '';
let dispatchDraft = {
  active: true,
  projectPath: '',
  contextSummary: ''
};
const RendererTaskOrchestration = window.OrionTaskOrchestration;
const RendererWorkspaceResolution = window.OrionWorkspaceResolution;
let orchestrationTasksReady = Promise.resolve();
const orchestrationTaskCache = new Map();

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
  btnAddConversationCoder: document.getElementById('btn-add-conversation-coder'),
  btnNewConversationCoder: document.getElementById('btn-new-conversation-coder'),
  newConvPickerMenu: document.getElementById('new-conv-picker-menu'),
  newConvPickerStandalone: document.getElementById('new-conv-picker-standalone'),
  newConvPickerDivider: document.getElementById('new-conv-picker-divider'),
  newConvPickerProjects: document.getElementById('new-conv-picker-projects'),
  projectList: document.getElementById('project-list'),
  conversationList: document.getElementById('conversation-list'),
  conversationListCoder: document.getElementById('conversation-list-coder'),
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
  settingPhoneHttpsOrigin: document.getElementById('setting-phone-https-origin'),
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
  initUpdateChecker();
  initImageAttach();

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
  
  const btnShowAgentBrowser = document.getElementById('btn-show-agent-browser');
  if (btnShowAgentBrowser) {
    btnShowAgentBrowser.addEventListener('click', async () => {
      if (window.api && typeof window.api.showAgentBrowser === 'function') {
        const result = await window.api.showAgentBrowser();
        if (!result.success) {
          alert(`Failed to show agent browser: ${result.error}`);
        }
      }
    });
  }
  
  // Load projects from local storage
  loadProjectsFromStorage();
  renderProjectsList();
  
  // Load conversations from local storage
  await loadConversationsFromStorage();
  orchestrationTasksReady = initializeOrchestrationTasks();
  await orchestrationTasksReady;
  
  // Migrate any project conversations that accumulated in standalone list
  migrateConversations();
  
  // A cold launch is an uncommitted Dispatch draft. Existing transcripts remain available inside
  // Dispatch, but none is selected and no empty record is created merely by opening Orion.
  startDispatchDraft({ coldLaunch: true });
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

// ── Auto-update checker ────────────────────────────────────────────────────────

function showUpdateBadge({ changedCount, changed, sourceDir } = {}) {
  const btn = document.getElementById('btn-update-available');
  if (!btn) return;
  const count = changedCount || (Array.isArray(changed) ? changed.length : 0);
  btn.textContent = `⬆ Update${count ? ` (${count})` : ''}`;
  const fileCopy = count ? `${count} local file${count !== 1 ? 's' : ''} changed` : 'Local update available';
  btn.title = `${fileCopy}${sourceDir ? ` from ${sourceDir}` : ''} — click to sync local files and restart`;
  btn.style.display = '';
}

function hideUpdateBadge() {
  const btn = document.getElementById('btn-update-available');
  if (btn) btn.style.display = 'none';
}

function restoreUpdateCheckButton(btn) {
  if (!btn) return;
  btn.textContent = '↻ Check';
  btn.disabled = false;
}

function getUpdateApi() {
  if (!window.api) return {};
  return {
    check: window.api.checkLocalUpdate || window.api.checkGitUpdate,
    apply: window.api.applyLocalUpdate || window.api.applyGitUpdate
  };
}

async function checkForLocalUpdates({ manual = false } = {}) {
  const updateApi = getUpdateApi();
  if (!updateApi.check) return;
  const checkBtn = document.getElementById('btn-check-update');
  if (manual && checkBtn) {
    checkBtn.textContent = 'Checking...';
    checkBtn.disabled = true;
  }
  try {
    const result = await updateApi.check();
    if (result && result.hasUpdate) {
      showUpdateBadge(result);
      if (manual && checkBtn) restoreUpdateCheckButton(checkBtn);
    } else {
      hideUpdateBadge();
      if (manual && checkBtn) {
        checkBtn.textContent = 'Current';
        checkBtn.title = 'No local source file updates found';
        setTimeout(() => {
          restoreUpdateCheckButton(checkBtn);
          checkBtn.title = 'Check local source files for updates';
        }, 1800);
      }
    }
  } catch (e) {
    if (manual) {
      appendSystemMessage(`Update check failed: ${e.message}`);
      if (checkBtn) restoreUpdateCheckButton(checkBtn);
    }
  }
}

function initUpdateChecker() {
  const checkBtn = document.getElementById('btn-check-update');
  if (checkBtn) {
    checkBtn.addEventListener('click', () => checkForLocalUpdates({ manual: true }));
  }
  const btn = document.getElementById('btn-update-available');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const orig = btn.textContent;
      btn.textContent = 'Syncing...';
      btn.disabled = true;
      try {
        const updateApi = getUpdateApi();
        if (!updateApi.apply) throw new Error('Update is not available in this build');
        await updateApi.apply();
        btn.textContent = 'Restarting...';
      } catch (e) {
        btn.textContent = orig;
        btn.disabled = false;
        appendSystemMessage(`Update failed: ${e.message}`);
      }
    });
  }
  // First check after 15 seconds on startup, then every 30 minutes
  setTimeout(checkForLocalUpdates, 15000);
  setInterval(checkForLocalUpdates, 30 * 60 * 1000);
}

// Phone companion bridge functions for update
window.checkPhoneCompanionUpdate = async () => {
  const updateApi = getUpdateApi();
  if (!updateApi.check) return { hasUpdate: false };
  try { return await updateApi.check(); } catch (_) { return { hasUpdate: false }; }
};
window.applyPhoneCompanionUpdate = async () => {
  const updateApi = getUpdateApi();
  if (!updateApi.apply) return { success: false, error: 'Not available' };
  try { return await updateApi.apply(); } catch (e) { return { success: false, error: e.message }; }
};
window.restartApp = async () => {
  if (!window.api || !window.api.restartApp) return { success: false };
  try { return await window.api.restartApp(); } catch (e) { return { success: false }; }
};

// ── Image attach (desktop) ─────────────────────────────────────────────────────

let pendingImages = []; // Array of { data: base64string, mimeType: string, previewUrl: string, name: string }

function addPendingImage(img) {
  if (pendingImages.length >= 4) {
    appendSystemMessage('Maximum 4 images per message.');
    return;
  }
  pendingImages.push(img);
  renderImagePreviews();
}

function clearPendingImages() {
  pendingImages = [];
  renderImagePreviews();
}

function renderImagePreviews() {
  const container = document.getElementById('image-preview-container');
  const thumbnails = document.getElementById('image-preview-thumbnails');
  if (!container || !thumbnails) return;
  if (pendingImages.length === 0) {
    container.style.display = 'none';
    thumbnails.innerHTML = '';
    return;
  }
  container.style.display = '';
  thumbnails.innerHTML = pendingImages.map((img, i) =>
    `<div class="img-preview-thumb" data-idx="${i}">` +
    `<img src="${img.previewUrl}" alt="${escapeHtml(img.name || 'image')}" title="${escapeHtml(img.name || 'image')}">` +
    `<button class="img-preview-remove" data-idx="${i}" title="Remove image" aria-label="Remove image">&times;</button>` +
    `</div>`
  ).join('');
  thumbnails.querySelectorAll('.img-preview-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx)) {
        pendingImages.splice(idx, 1);
        renderImagePreviews();
      }
    });
  });
}

function attachImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    appendSystemMessage('Only image files can be attached to messages.');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    appendSystemMessage('Image too large — maximum size is 15 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(',')[1];
    addPendingImage({ data: base64, mimeType: file.type, previewUrl: dataUrl, name: file.name });
  };
  reader.readAsDataURL(file);
}

function initImageAttach() {
  // Image attach button opens file picker
  const btnAttach = document.getElementById('btn-attach-image');
  const fileInput = document.getElementById('image-file-input');
  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        for (const file of fileInput.files) {
          attachImageFile(file);
        }
        fileInput.value = '';
      }
    });
  }

  // Paste image from clipboard (Ctrl+V into chat area or globally when chat is focused)
  document.addEventListener('paste', (e) => {
    const active = document.activeElement;
    const isChatFocused = active && (active.id === 'chat-input' || active.closest('#chat-input-wrapper'));
    if (!isChatFocused && active && active.id !== 'chat-input') return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) attachImageFile(file);
        break;
      }
    }
  });
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
  if (el.settingPhoneHttpsOrigin) el.settingPhoneHttpsOrigin.value = appConfig.phoneCompanionHttpsOrigin || '';
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

function normalizePhoneHttpsOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.origin : '';
  } catch (_) {
    return '';
  }
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
    const rawPhoneHttpsOrigin = el.settingPhoneHttpsOrigin ? el.settingPhoneHttpsOrigin.value.trim() : '';
    const normalizedPhoneHttpsOrigin = normalizePhoneHttpsOrigin(rawPhoneHttpsOrigin);
    if (rawPhoneHttpsOrigin && !normalizedPhoneHttpsOrigin) {
      appendSystemMessage("Secure Phone URL must start with https:// so mobile notifications can work.");
      return;
    }
    appConfig.phoneCompanionHttpsOrigin = normalizedPhoneHttpsOrigin;
    if (el.settingPhoneHttpsOrigin) el.settingPhoneHttpsOrigin.value = normalizedPhoneHttpsOrigin;
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
  addProjectPath(folderPath);
  
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

function setAppMode(mode, persist = true) {
  appMode = mode;
  document.body.setAttribute('data-mode', mode);

  const orionBtn = document.getElementById('btn-mode-orion');
  const coderBtn = document.getElementById('btn-mode-coder');
  const orionContent = document.getElementById('sidebar-orion-content');
  const coderContent = document.getElementById('sidebar-coder-content');
  if (orionBtn) orionBtn.classList.toggle('active', mode === 'orion');
  if (coderBtn) coderBtn.classList.toggle('active', mode === 'coder');
  if (orionContent) orionContent.classList.toggle('active', mode === 'orion');
  if (coderContent) coderContent.classList.toggle('active', mode === 'coder');

  // Dispatch preserves its current in-session focus, including an uncommitted draft, but never
  // chooses an old transcript merely because the user opened the mode. Coder keeps its existing
  // task-oriented selection behavior.
  const activeConv = conversations.find(c => c.id === activeConversationId);
  if (mode === 'orion') {
    if (activeConv && conversationMode(activeConv) === 'orion') {
      lastDispatchConversationId = activeConv.id;
      dispatchDraft.active = false;
    } else if (dispatchDraft.active) {
      startDispatchDraft(dispatchDraft);
    } else {
      const remembered = conversations.find(c => c.id === lastDispatchConversationId && conversationMode(c) === 'orion');
      if (remembered) selectConversation(remembered.id);
      else startDispatchDraft();
    }
  } else if (!activeConv || conversationMode(activeConv) !== 'coder') {
    const replacement = conversations.find(c => conversationMode(c) === 'coder');
    if (replacement) selectConversation(replacement.id);
    else createNewConversation('coder');
  }

  // Adapt main workspace for mode
  const chatInput = document.getElementById('chat-input');
  const orionSplash = document.getElementById('orion-welcome-splash');

  if (mode === 'orion') {
    if (chatInput) chatInput.placeholder = 'Ask Orion anything…';
    // Show Orion greeting splash if no active conversation with messages
    const conv = conversations.find(c => c.id === activeConversationId);
    const hasMessages = conv && conv.messages && conv.messages.length > 0;
    if (!hasMessages) {
      if (el.welcomeSplash) el.welcomeSplash.style.display = 'none';
      if (orionSplash) orionSplash.style.display = 'flex';
      if (el.messagesContainer) el.messagesContainer.style.display = 'none';
    }
    // Update greeting time
    updateOrionGreeting();
  } else {
    if (chatInput) chatInput.placeholder = 'Ask Orion to build, fix, or investigate…';
    if (orionSplash) orionSplash.style.display = 'none';
    // Restore coder splash if no messages
    const conv = conversations.find(c => c.id === activeConversationId);
    const hasMessages = conv && conv.messages && conv.messages.length > 0;
    if (!hasMessages) {
      if (el.welcomeSplash) el.welcomeSplash.style.display = 'flex';
    }
  }

  if (persist) localStorage.setItem('appMode', mode);
}

function updateOrionGreeting() {
  const nameEl = document.getElementById('orion-greeting-name');
  if (!nameEl) return;
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  nameEl.textContent = `${tod}, Jason.`;
}

function collectDispatchActiveWork(isGlobalRunning = false, globalRunningId = '') {
  const activeWork = [];
  conversations.filter(conversation => conversationMode(conversation) === 'orion').forEach(dispatchConversation => {
    const coderId = dispatchConversation.launchedCoderConvId;
    const coderConversation = coderId ? conversations.find(conversation => conversation.id === coderId) : null;
    if (coderConversation) {
      const taskId = dispatchConversation.launchedCoderTaskId || dispatchConversation.lastOwnedTaskId || '';
      const durableTask = taskId ? orchestrationTaskCache.get(taskId) : null;
      const running = isGlobalRunning && globalRunningId === coderConversation.id;
      const queued = Array.isArray(window.promptQueue)
        && window.promptQueue.some(item => item && (item.taskId === taskId || item.conversationId === coderConversation.id));
      const waitingForInput = !!coderConversation.awaitingClarification;
      const waitingForReview = !!(coderConversation.awaitingPlanApproval && !coderConversation.planApproved);
      const status = durableTask
        ? durableTask.status
        : (running ? 'active' : ((queued || waitingForInput || waitingForReview) ? 'pending' : 'failed'));
      const subStatus = durableTask && RendererTaskOrchestration
        ? RendererTaskOrchestration.describeTaskStatus(durableTask)
        : (running && window.getAgentSubStatus
          ? window.getAgentSubStatus()
          : (queued
            ? 'Queued for Coder'
            : (waitingForInput
              ? 'Waiting for your input'
              : (waitingForReview ? 'Plan ready for review' : 'Needs attention'))));
      const projectPath = (durableTask && durableTask.workspacePath) || coderConversation.projectPath || inferDispatchProjectPath(dispatchConversation);
      activeWork.push({
        id: coderConversation.id,
        taskId,
        supervisingConversationId: dispatchConversation.id,
        title: (durableTask && durableTask.title) || dispatchConversation.launchedCoderTaskTitle || coderConversation.title || 'Coder task',
        projectPath,
        projectName: (projectPath || 'Standalone').replace(/[\\\/]+$/, '').split(/[\\\/]/).pop(),
        status,
        subStatus,
        startedAt: (durableTask && durableTask.startedAt) || dispatchConversation.launchedCoderTaskStart || coderConversation.createdAt || 0,
        completedAt: (durableTask && (durableTask.completedAt || durableTask.cancelledAt || durableTask.failedAt)) || 0,
        canContinue: status === 'failed'
      });
    } else if (dispatchConversation.lastDelegatedWork) {
      const receipt = dispatchConversation.lastDelegatedWork;
      const projectPath = receipt.projectPath || inferDispatchProjectPath(dispatchConversation);
      activeWork.push({
        id: receipt.coderConversationId || '',
        supervisingConversationId: dispatchConversation.id,
        title: receipt.title || 'Coder task',
        projectPath,
        projectName: (projectPath || 'Standalone').replace(/[\\\/]+$/, '').split(/[\\\/]/).pop(),
        status: receipt.status || 'completed',
        subStatus: receipt.subStatus || 'Completed',
        startedAt: receipt.startedAt || 0,
        completedAt: receipt.completedAt || 0,
        // Unfinished delegated work can be resumed with one click instead of a manual re-queue.
        canContinue: !!receipt.coderConversationId && (receipt.status === 'blocked' || (receipt.pendingCount || 0) > 0)
      });
    }
  });
  return activeWork.sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0));
}

function renderDesktopDispatchLanding() {
  const activeSection = document.getElementById('dispatch-desktop-active-work');
  if (!activeSection) return;
  const runningConversationId = window.getRunningConversationId ? window.getRunningConversationId() : '';
  const globallyRunning = !!(window.isAgentRunning && window.isAgentRunning());
  const activeWork = collectDispatchActiveWork(globallyRunning, runningConversationId);

  const visibleWork = activeWork.slice(0, 3);
  activeSection.hidden = visibleWork.length === 0;
  activeSection.innerHTML = visibleWork.length ? `<div class="dispatch-desktop-section-head"><span>Active work</span></div>
    <div class="dispatch-desktop-work-list">${visibleWork.map(work => `<div class="dispatch-desktop-work-item">
      <button class="dispatch-desktop-work-row" type="button" data-dispatch-supervisor="${escapeHtml(work.supervisingConversationId)}">
        <span class="dispatch-desktop-work-copy">
          <span class="dispatch-desktop-work-title">${escapeHtml(work.title)}</span>
          <span class="dispatch-desktop-work-meta">${escapeHtml(work.projectName)} · ${escapeHtml(work.subStatus || work.status)}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      ${work.canContinue ? `<button class="dispatch-desktop-work-continue" type="button" data-dispatch-continue-work="${escapeHtml(work.id)}" data-dispatch-supervising="${escapeHtml(work.supervisingConversationId)}" title="Queue Coder to finish the remaining work">Continue</button>` : ''}
    </div>`).join('')}</div>` : '';
}

// One-click continuation of unfinished delegated work (a completion receipt with pending tasks,
// or a stalled run). Previously the completion summary said "you can queue a continuation" but
// there was no mechanism behind it — resuming meant manually re-prompting the Coder conversation.
async function continueDelegatedWork(coderConvId, supervisingOrionConvId) {
  const coderConv = conversations.find(c => c.id === coderConvId);
  if (!coderConv) {
    showToast('The Coder conversation for this work no longer exists.', 'attention');
    return;
  }
  const prompt = 'Continue the previous task from where it left off. Review the task checklist and the last few messages to see what is done and what remains, then complete the remaining pending work. Do not redo finished work; if you hit the same blocker again, stop and describe it precisely.';
  const modelValue = window.getSelectedModel ? window.getSelectedModel() : undefined;

  const orionConv = conversations.find(c => c.id === supervisingOrionConvId);
  if (!orionConv) {
    showToast('The supervising Dispatch conversation no longer exists.', 'attention');
    return;
  }
  const messageId = createConversationMessageId(coderConv.id);
  coderConv.messages.push({ id: messageId, role: 'user', source: 'dispatch-continue', text: prompt, createdAt: Date.now() });
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(coderConv.id);
  const taskTitle = (orionConv.lastDelegatedWork && orionConv.lastDelegatedWork.title) || coderConv.title || 'Continue Coder task';
  const queued = await enqueueOrchestrationTask({
    prompt,
    originalUserMessage: prompt,
    resolvedObjective: prompt,
    title: taskTitle,
    modelSelectValue: modelValue,
    originConversationId: orionConv.id,
    originMessageId: messageId,
    targetConversationId: coderConv.id,
    workspace: structuredWorkspaceForConversation(coderConv),
    precedingMessages: taskContextMessages(coderConv),
    constraints: ['Do not redo completed work.', 'Stop and report precisely if the same blocker recurs.'],
    source: 'dispatch-continue',
    alreadyRendered: true
  });
  if (!queued.success) {
    showToast(queued.error || queued.clarification || 'Could not queue the continuation.', 'attention');
    return;
  }

  orionConv.launchedCoderConvId = coderConvId;
  orionConv.launchedCoderTaskId = queued.task.taskId;
  orionConv.lastOwnedTaskId = queued.task.taskId;
  orionConv.launchedCoderTaskTitle = taskTitle;
  orionConv.launchedCoderTaskStart = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
  await flushConversationsToStorage();
  if (typeof window.startCoderTaskMonitor === 'function') {
    window.startCoderTaskMonitor(orionConv.id, coderConvId, queued.task.taskId);
  }
  renderDesktopDispatchLanding();

  if (window.isAgentRunning && window.isAgentRunning()) {
    // Something else is mid-turn — the queue drains when it finishes.
    showToast('Continuation queued — Coder will pick it up when the current turn finishes.');
  } else {
    showToast('Coder is continuing the remaining work.');
    window.promptQueue = window.promptQueue.filter(item => item.taskId !== queued.task.taskId);
    window.runAgentLoop(queued.queueItem.prompt, modelValue, coderConv, {
      source: 'queue',
      taskId: queued.task.taskId
    });
  }
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

  // Mode switcher
  document.getElementById('btn-mode-orion')?.addEventListener('click', () => setAppMode('orion'));
  document.getElementById('btn-mode-coder')?.addEventListener('click', () => setAppMode('coder'));
  setAppMode(appMode, false); // Initialize from stored preference

  // Orion prompt chips — populate input (with focus) so Jason can review/edit before sending
  document.getElementById('orion-welcome-splash')?.addEventListener('click', async (e) => {
    const continueWorkButton = e.target.closest('[data-dispatch-continue-work]');
    if (continueWorkButton) {
      continueDelegatedWork(
        continueWorkButton.getAttribute('data-dispatch-continue-work'),
        continueWorkButton.getAttribute('data-dispatch-supervising')
      );
      return;
    }
    const continueButton = e.target.closest('[data-dispatch-continue], [data-dispatch-supervisor]');
    if (continueButton) {
      const conversationId = continueButton.getAttribute('data-dispatch-continue')
        || continueButton.getAttribute('data-dispatch-supervisor');
      if (conversationId) selectConversation(conversationId);
      return;
    }
    const freshProjectButton = e.target.closest('[data-dispatch-fresh-project]');
    if (freshProjectButton) {
      await window.beginNewFocus(activeConversationId);
      startDispatchDraft({
        projectPath: freshProjectButton.getAttribute('data-dispatch-fresh-project') || '',
        contextSummary: freshProjectButton.getAttribute('data-dispatch-summary') || ''
      });
      return;
    }
    const chip = e.target.closest('.orion-prompt-chip');
    if (!chip) return;
    const prompt = chip.dataset.prompt || '';
    if (!prompt) return;
    const input = el.chatInput;
    if (!input) return;
    input.value = prompt;
    input.focus();
    // Put cursor at end
    input.setSelectionRange(prompt.length, prompt.length);
    // Trigger resize in case the input uses auto-height
    input.dispatchEvent(new Event('input'));
  });
  document.getElementById('btn-dispatch-browse')?.addEventListener('click', () => {
    setLeftSidebarCollapsed(false);
    el.conversationList?.querySelector('.conversation-item, .empty-state')?.scrollIntoView({ block: 'nearest' });
  });

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

function parseToolResultObject(result) {
  if (!result) return null;
  if (typeof result === 'object') return result;
  if (typeof result !== 'string') return null;
  try {
    return JSON.parse(result);
  } catch (_) {
    return null;
  }
}

function getInlineVisualArtifactsFromLogs(logs = []) {
  const visualTools = new Set(['take_screenshot', 'preview_app', 'capture_screen']);
  const seen = new Set();
  return (Array.isArray(logs) ? logs : [])
    .filter(log => log && visualTools.has(log.tool))
    .map(log => {
      const result = parseToolResultObject(log.result);
      if (!result || result.success === false || !result.path) return null;
      const path = String(result.path || '');
      const key = `${path}|${result.width || 0}|${result.height || 0}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        toolName: log.tool,
        path,
        width: result.width || 0,
        height: result.height || 0,
        size: result.size || 0,
        summary: result.summary || '',
        displayName: path.split(/[\\/]/).pop() || 'screenshot.png'
      };
    })
    .filter(Boolean);
}

function renderInlineArtifactCards(logs = []) {
  const artifacts = getInlineVisualArtifactsFromLogs(logs);
  if (!artifacts.length) return '';
  const cards = artifacts.map(item => {
    const meta = [
      item.width && item.height ? `${item.width}x${item.height}` : '',
      item.size ? `${Math.round(item.size / 1024)} KB` : '',
      item.toolName || 'screenshot'
    ].filter(Boolean).join(' / ');
    return `
      <button class="inline-artifact-card" type="button" data-open-artifact="${escapeHtml(item.path)}" data-artifact-tool="${escapeHtml(item.toolName || 'screenshot')}" data-artifact-width="${escapeHtml(item.width || '')}" data-artifact-height="${escapeHtml(item.height || '')}" data-artifact-size="${escapeHtml(item.size || '')}">
        <span class="inline-artifact-icon">IMG</span>
        <span class="inline-artifact-copy">
          <span class="inline-artifact-title">${escapeHtml(item.displayName)}</span>
          <span class="inline-artifact-meta">${escapeHtml(meta || 'Screenshot')}</span>
        </span>
      </button>
    `;
  }).join('');
  return `<div class="inline-artifacts">${cards}</div>`;
}

function wireInlineArtifactOpeners(container) {
  if (!container) return;
  container.querySelectorAll('[data-open-artifact]').forEach(button => {
    button.addEventListener('click', () => {
      const path = button.getAttribute('data-open-artifact') || '';
      if (!path) return;
      openImageArtifact({
        artifactType: 'screenshot',
        displayName: path.split(/[\\/]/).pop() || 'screenshot.png',
        screenshotPath: path,
        toolName: button.getAttribute('data-artifact-tool') || 'screenshot',
        width: Number(button.getAttribute('data-artifact-width') || 0),
        height: Number(button.getAttribute('data-artifact-height') || 0),
        size: Number(button.getAttribute('data-artifact-size') || 0)
      });
    });
  });
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
  
  // createNewConversation(mode = appMode) must not be passed directly as a listener -- the click
  // Event object would be passed as `mode` and silently fail the 'coder' check, so wrap each call.
  el.btnNewChat.addEventListener('click', () => createNewConversation());
  if (el.btnAddConversation) {
    el.btnAddConversation.addEventListener('click', () => createNewConversation());
  }
  if (el.btnAddConversationCoder) {
    el.btnAddConversationCoder.addEventListener('click', () => createNewConversation('coder'));
  }
  if (el.btnNewConversationCoder && el.newConvPickerMenu) {
    const closePicker = () => { el.newConvPickerMenu.hidden = true; };
    const openPicker = () => {
      el.newConvPickerProjects.innerHTML = '';
      if (projects.length === 0) {
        el.newConvPickerDivider.hidden = true;
        el.newConvPickerProjects.innerHTML = '<div class="new-conv-picker-empty">No projects added yet</div>';
      } else {
        el.newConvPickerDivider.hidden = false;
        projects.forEach(path => {
          const name = path.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || path;
          const item = document.createElement('div');
          item.className = 'new-conv-picker-item';
          item.textContent = name;
          item.title = path;
          item.addEventListener('click', () => {
            closePicker();
            createNewConversationUnderProject(path);
          });
          el.newConvPickerProjects.appendChild(item);
        });
      }
      el.newConvPickerMenu.hidden = false;
    };
    el.btnNewConversationCoder.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!el.newConvPickerMenu.hidden) { closePicker(); return; }
      openPicker();
    });
    if (el.newConvPickerStandalone) {
      el.newConvPickerStandalone.addEventListener('click', () => {
        closePicker();
        createNewConversation('coder');
      });
    }
    el.newConvPickerMenu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closePicker);
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

function createConversationMessageId(conversationId = activeConversationId) {
  return `msg_${String(conversationId || 'conversation')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function structuredWorkspaceForConversation(conv, explicitPath = '') {
  const searchRoot = getDispatchWorkspaceRoot();
  const mode = conversationMode(conv);
  const workspacePath = String(explicitPath || (conv && (conv.workspace || conv.projectPath || conv.dispatchProjectPath)) || '').trim();
  if (!RendererWorkspaceResolution) {
    return {
      role: workspacePath ? (mode === 'coder' ? 'standalone_coder' : 'active_project') : 'unresolved',
      path: workspacePath,
      project: { name: workspacePath.split(/[\\/]/).pop() || '', path: (conv && (conv.projectPath || conv.dispatchProjectPath)) || '' },
      source: 'legacy',
      resolved: !!workspacePath
    };
  }
  const resolution = RendererWorkspaceResolution.classifyWorkspace({
    mode,
    workspacePath,
    projectPath: conv && conv.projectPath,
    dispatchProjectPath: conv && conv.dispatchProjectPath,
    searchRoot,
    standaloneRoot: getStandaloneWorkspaceRoot(),
    knownProjects: projects
  });
  return {
    role: resolution.kind,
    path: resolution.path || '',
    project: {
      name: resolution.projectName || '',
      path: resolution.projectPath || ''
    },
    source: resolution.source || '',
    resolved: resolution.kind !== RendererWorkspaceResolution.KINDS.UNRESOLVED && !!resolution.path
  };
}

function taskContextMessages(conv) {
  return (conv && Array.isArray(conv.messages) ? conv.messages : [])
    .filter(message => message && ['user', 'assistant', 'model', 'orion'].includes(String(message.role || '').toLowerCase()))
    .slice(-16)
    .map(message => ({
      id: String(message.id || message.messageId || ''),
      role: String(message.role || ''),
      text: String(message.text || message.content || '').slice(0, 5000),
      createdAt: message.createdAt || 0
    }));
}

function persistTaskClarification(conv, clarification) {
  if (!conv || !clarification) return;
  conv.messages = Array.isArray(conv.messages) ? conv.messages : [];
  conv.messages.push({
    id: createConversationMessageId(conv.id),
    role: 'assistant',
    source: 'task-resolution-clarification',
    text: clarification,
    createdAt: Date.now()
  });
  conv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
  saveConversationsToStorage();
  if (conv.id === activeConversationId) {
    window.clearActiveAiBubble?.();
    renderAiMessage(clarification, [], conv.id);
  }
}

async function enqueueOrchestrationTask(options = {}) {
  if (!RendererTaskOrchestration || !window.api || typeof window.api.createOrchestrationTask !== 'function') {
    return { success: false, error: 'Durable task orchestration is unavailable.' };
  }
  const targetConversationId = String(options.targetConversationId || options.conversationId || activeConversationId || '');
  const originConversationId = String(options.originConversationId || targetConversationId || '');
  const targetConv = conversations.find(conv => conv.id === targetConversationId);
  const originConv = conversations.find(conv => conv.id === originConversationId) || targetConv;
  if (!targetConv || !originConv) return { success: false, error: 'Task conversation could not be resolved.' };
  const originalUserMessage = String(options.originalUserMessage || options.prompt || '').trim();
  const workspace = options.workspace && typeof options.workspace === 'object'
    ? options.workspace
    : structuredWorkspaceForConversation(originConv, options.workspacePath || '');
  const packetResult = RendererTaskOrchestration.buildTaskPacket({
    originalUserMessage,
    resolvedObjective: options.resolvedObjective || '',
    title: options.title || '',
    precedingMessages: options.precedingMessages || taskContextMessages(originConv),
    precedingConversationSummary: options.precedingConversationSummary || '',
    workspace,
    requirements: options.requirements || [],
    constraints: options.constraints || [],
    unresolvedDecisions: options.unresolvedDecisions || [],
    origin: {
      conversationId: originConversationId,
      sessionId: String(options.originSessionId || originConv.sessionId || originConversationId),
      messageId: String(options.originMessageId || '')
    },
    target: {
      conversationId: targetConversationId,
      sessionId: String(options.targetSessionId || targetConv.sessionId || targetConversationId),
      mode: conversationMode(targetConv)
    },
    source: options.source || 'user-queue',
    timestamp: options.createdAt || Date.now()
  });
  if (!packetResult.success || !packetResult.task) {
    persistTaskClarification(originConv, packetResult.clarification || 'What specific work should I queue?');
    return { success: false, needsClarification: true, clarification: packetResult.clarification, task: null };
  }

  const persisted = await window.api.createOrchestrationTask(packetResult.task);
  if (!persisted || persisted.success === false || !persisted.task) {
    return { success: false, error: (persisted && persisted.error) || 'Task could not be persisted.' };
  }
  const task = persisted.task;
  orchestrationTaskCache.set(task.taskId, task);
  const runtimePrompt = RendererTaskOrchestration.renderTaskPrompt(task);
  window.promptQueue = Array.isArray(window.promptQueue) ? window.promptQueue : [];
  const queueItem = {
    id: options.queueId || createQueuedPromptId(),
    taskId: task.taskId,
    prompt: runtimePrompt,
    originalUserMessage: task.originalUserMessage,
    taskTitle: task.title,
    modelSelectValue: options.modelSelectValue || (el.modelSelect && el.modelSelect.value),
    conversationId: targetConversationId,
    originConversationId,
    source: options.source || task.source,
    createdAt: task.createdAt,
    alreadyRendered: !!options.alreadyRendered,
    images: Array.isArray(options.images) ? options.images : [],
    contextPacketIds: Array.isArray(options.contextPacketIds) ? options.contextPacketIds : []
  };
  window.promptQueue.push(queueItem);
  targetConv.lastOrchestrationTaskId = task.taskId;
  originConv.lastOwnedTaskId = task.taskId;
  if (typeof window.markConversationDirty === 'function') {
    window.markConversationDirty(targetConv.id);
    window.markConversationDirty(originConv.id);
  }
  await flushConversationsToStorage();
  return { success: true, task, queueItem };
}
window.enqueueOrchestrationTask = enqueueOrchestrationTask;

async function initializeOrchestrationTasks() {
  if (!window.api || typeof window.api.listOrchestrationTasks !== 'function') return;
  try {
    await window.api.migrateOrchestrationTasks?.();
    await window.api.reconcileOrchestrationTasks?.({ reason: 'Orion restarted before the active task recorded a terminal result.' });
    const listed = await window.api.listOrchestrationTasks({ sort: 'desc' });
    const tasks = listed && Array.isArray(listed.tasks) ? listed.tasks : [];
    tasks.forEach(task => {
      if (task && task.taskId) orchestrationTaskCache.set(task.taskId, task);
    });
    window.promptQueue = Array.isArray(window.promptQueue) ? window.promptQueue : [];
    for (const task of tasks.filter(item => item && item.status === 'pending')) {
      if (!task || !task.taskId || window.promptQueue.some(item => item && item.taskId === task.taskId)) continue;
      const targetId = task.target && task.target.conversationId;
      if (!targetId || !conversations.some(conv => conv.id === targetId)) continue;
      window.promptQueue.push({
        id: createQueuedPromptId(),
        taskId: task.taskId,
        prompt: RendererTaskOrchestration.renderTaskPrompt(task),
        originalUserMessage: task.originalUserMessage,
        taskTitle: task.title,
        conversationId: targetId,
        originConversationId: task.origin && task.origin.conversationId,
        source: task.source || 'restored-queue',
        createdAt: task.createdAt,
        alreadyRendered: true
      });
    }
  } catch (error) {
    console.error('Could not initialize durable task queue:', error);
  }
}

window.claimOrchestrationTask = async function(taskId) {
  if (!taskId || !window.api || typeof window.api.getOrchestrationTask !== 'function') return { success: true, task: null };
  await orchestrationTasksReady;
  const read = await window.api.getOrchestrationTask(taskId);
  if (!read || read.success === false || !read.task) return { success: false, reason: (read && read.error) || 'Task no longer exists.' };
  let task = read.task;
  if (task.status !== 'pending') return { success: false, reason: `Task is ${task.status}.`, task };
  const claimed = await window.api.transitionOrchestrationTask(taskId, 'active', { startedBy: 'agent-loop' });
  if (!claimed || claimed.success === false || !claimed.task) return { success: false, reason: (claimed && claimed.error) || 'Task could not be claimed.' };
  task = claimed.task;
  orchestrationTaskCache.set(task.taskId, task);
  return { success: true, task, prompt: RendererTaskOrchestration.renderTaskPrompt(task) };
};

window.finalizeOrchestrationTask = async function(taskId, status, details = {}) {
  if (!taskId || !window.api || typeof window.api.getOrchestrationTask !== 'function') return null;
  const read = await window.api.getOrchestrationTask(taskId);
  if (!read || read.success === false || !read.task) return null;
  if (read.task.status === 'cancelled') return read.task;
  if (read.task.status === status) return read.task;
  const transitioned = await window.api.transitionOrchestrationTask(taskId, status, details);
  if (transitioned && transitioned.success && transitioned.task) {
    orchestrationTaskCache.set(transitioned.task.taskId, transitioned.task);
    return transitioned.task;
  }
  return null;
};

window.getOwnedOrchestrationTasks = async function(conversationId, statuses = []) {
  if (!window.api || typeof window.api.listOrchestrationTasks !== 'function') return [];
  const result = await window.api.listOrchestrationTasks({
    originConversationId: String(conversationId || ''),
    ...(statuses.length ? { status: statuses } : {}),
    sort: 'desc'
  });
  return result && Array.isArray(result.tasks) ? result.tasks : [];
};

window.getOrchestrationTaskStatus = async function(taskId, requesterConversationId = '') {
  if (!taskId || !window.api || typeof window.api.getOrchestrationTask !== 'function') {
    return { success: false, error: 'Task status is unavailable.' };
  }
  const result = await window.api.getOrchestrationTask(taskId);
  if (!result || result.success === false || !result.task) return result || { success: false, error: 'Task not found.' };
  orchestrationTaskCache.set(result.task.taskId, result.task);
  if (requesterConversationId && RendererTaskOrchestration && !RendererTaskOrchestration.canRequesterControlTask(result.task, { conversationId: requesterConversationId })) {
    return { success: false, error: 'This conversation does not own that task.', code: 'TASK_CONTROL_FORBIDDEN' };
  }
  return {
    success: true,
    task: result.task,
    taskId: result.task.taskId,
    status: result.task.status,
    description: RendererTaskOrchestration ? RendererTaskOrchestration.describeTaskStatus(result.task) : result.task.status
  };
};

window.cancelOwnedOrchestrationTask = async function(taskId, requesterConversationId, reason = 'Cancelled by user.') {
  if (!taskId || !window.api || typeof window.api.cancelOrchestrationTask !== 'function') {
    return { success: false, error: 'Task cancellation is unavailable.' };
  }
  const result = await window.api.cancelOrchestrationTask(taskId, { conversationId: requesterConversationId }, reason);
  if (!result || result.success === false || !result.task) return result || { success: false, error: 'Cancellation failed.' };
  orchestrationTaskCache.set(result.task.taskId, result.task);
  window.promptQueue = (Array.isArray(window.promptQueue) ? window.promptQueue : []).filter(item => item && item.taskId !== taskId);
  const targetId = result.task.target && result.task.target.conversationId;
  const originId = result.task.origin && result.task.origin.conversationId;
  setQueuedPromptMessageState(taskId, targetId, 'cancelled');
  if (result.wasActive && window.getActiveRunTaskId && window.getActiveRunTaskId() === taskId && window.stopAgentExecution) {
    window.stopAgentExecution({ mode: 'hard', taskId });
  }
  const originConv = conversations.find(conv => conv.id === originId);
  if (originConv) {
    originConv.lastDelegatedWork = {
      taskId,
      coderConversationId: targetId || '',
      title: result.task.title,
      projectPath: result.task.workspacePath || '',
      status: 'cancelled',
      subStatus: 'Cancelled',
      startedAt: result.task.startedAt || 0,
      completedAt: result.task.cancelledAt || Date.now(),
      pendingCount: 0
    };
    originConv.launchedCoderConvId = null;
    originConv.launchedCoderTaskId = null;
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(originConv.id);
  }
  saveConversationsToStorage();
  renderDesktopDispatchLanding();
  return { ...result, stopped: !!result.wasActive };
};

async function cancelPendingTasksForNewFocus(conversationId) {
  const ownerId = String(conversationId || '');
  if (!ownerId) return { cancelled: [], count: 0 };
  const tasks = await window.getOwnedOrchestrationTasks(ownerId, ['pending']);
  const cancelled = [];
  for (const task of tasks) {
    const result = await window.cancelOwnedOrchestrationTask(task.taskId, ownerId, 'Cancelled when a new focus was started.');
    if (result && result.success) cancelled.push(task.taskId);
  }
  return { cancelled, count: cancelled.length };
}

window.beginNewFocus = async function(conversationId = activeConversationId) {
  return cancelPendingTasksForNewFocus(conversationId);
};

async function triggerQueue() {
  const text = el.chatInput.value.trim();
  if (!text) return;
  const queueId = createQueuedPromptId();
  const result = await enqueueOrchestrationTask({
    queueId,
    prompt: text,
    modelSelectValue: el.modelSelect.value,
    targetConversationId: activeConversationId,
    originConversationId: activeConversationId,
    source: 'user-queue'
  });
  if (result.success) appendQueuedMessage(result.task.objective, result.queueItem, result.task);
  else if (!result.needsClarification) showToast(result.error || 'Could not queue that task.', 'attention');
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

function appendQueuedMessage(text, queueItem = {}, task = null) {
  const item = {
    id: queueItem.id || createQueuedPromptId(),
    prompt: text,
    modelSelectValue: queueItem.modelSelectValue || (el.modelSelect && el.modelSelect.value),
    conversationId: queueItem.conversationId || activeConversationId,
    source: queueItem.source || 'user-queue',
    createdAt: queueItem.createdAt || Date.now(),
    taskId: queueItem.taskId || (task && task.taskId) || '',
    taskTitle: queueItem.taskTitle || (task && task.title) || ''
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
      taskId: item.taskId,
      taskTitle: item.taskTitle,
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
  const message = conv.messages.find(msg => msg && (msg.queueId === queueId || msg.taskId === queueId));
  return { conv, message };
}

function getQueuedPromptStatus(item) {
  const queueId = item.id || item.queueId;
  const conversationId = item.conversationId || activeConversationId;
  const queueIndex = getPromptQueueIndex(queueId, conversationId);
  const queueState = item.queueState || 'queued';
  if (queueState === 'steered') return 'Converted to steering';
  if (queueState === 'sent') return 'Sent to Orion';
  if (queueState === 'cancelled') return 'Cancelled';
  if (queueIndex === 0) return 'Runs next';
  if (queueIndex > 0) return `Queued #${queueIndex + 1}`;
  return 'No longer queued';
}

function buildQueuedPromptBubble(item) {
  const queueId = String(item.id || item.queueId || '');
  const conversationId = String(item.conversationId || activeConversationId || '');
  const prompt = String(item.prompt || item.queuedPrompt || '');
  const taskTitle = String(item.taskTitle || '');
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
      ${taskTitle ? `<div class="queued-prompt-title">${escapeHtml(taskTitle)}</div>` : ''}
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
    } else if (queueState === 'cancelled') {
      message.text = `Queued task cancelled: "${message.taskTitle || message.queuedPrompt || ''}"`;
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

async function promoteQueuedPromptToSteering(queueId, conversationId) {
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
  if (item.taskId) {
    const requesterId = item.originConversationId || conversationId;
    await window.cancelOwnedOrchestrationTask(item.taskId, requesterId, 'Converted from a pending task into steering.');
  }
  const steeringText = item.originalUserMessage || item.prompt;
  if (enqueueSteeringForConversation(steeringText, conversationId)) {
    setQueuedPromptMessageState(queueId, conversationId, 'steered');
    checkpointSteeringInstruction(steeringText, conversationId);
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
  const queuedImages = Array.isArray(item.images) ? item.images : [];
  if (!item.alreadyRendered && conv.messages) {
    conv.messages.push({ role: 'user', source: item.source || 'queue', text: item.prompt, createdAt: Date.now(), ...(queuedImages.length ? { images: queuedImages } : {}) });
    saveConversationsToStorage();
  }
  if (conversationId === activeConversationId && !item.alreadyRendered) {
    renderUserMessage(item.prompt, queuedImages, Date.now());
  }
  window.runAgentLoop(item.prompt, item.modelSelectValue || (el.modelSelect && el.modelSelect.value), conv, {
    source: item.source || 'queue',
    taskId: item.taskId || '',
    ...(queuedImages.length ? { images: queuedImages } : {})
  }).catch(error => {
    console.error('Queued prompt send-now run failed:', error);
    appendSystemMessage(`Queued prompt failed to start: ${error.message}`, { conversationId });
  });
}

function markQueuedPromptRunning(queueId, conversationId) {
  setQueuedPromptMessageState(queueId, conversationId, 'sent');
}

// Dispatch (Orion) and Coder are separate entities with their own conversation histories --
// a standalone chat started in Coder is not the same as one started in Dispatch, even though
// neither has a projectPath. Legacy conversations saved before this field existed infer their
// mode from projectPath (only Coder ever had projects), so old data keeps behaving as before.
function conversationMode(conv) {
  if (!conv) return 'orion';
  if (conv.mode === 'orion' || conv.mode === 'coder') return conv.mode;
  return conv.projectPath ? 'coder' : 'orion';
}

function compactDispatchDiscussionText(value, fallback = '') {
  const text = String(value || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[`*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return String(fallback || '').trim();
  return text.length > 150 ? `${text.slice(0, 147).trim()}...` : text;
}

function deriveDispatchDiscussionSummary(conv) {
  if (!conv) return '';
  if (conv.dispatchDiscussionSummary) return compactDispatchDiscussionText(conv.dispatchDiscussionSummary, conv.title);
  const messages = Array.isArray(conv.messages) ? conv.messages : [];
  const latestUser = [...messages].reverse().find(message => normalizeConversationMessageRole(message) === 'user');
  return compactDispatchDiscussionText(
    latestUser ? extractConversationMessageText(latestUser) : '',
    conv.title && conv.title !== 'New Conversation' && conv.title !== 'New Phone Task' ? conv.title : ''
  );
}

function inferDispatchProjectPath(conv) {
  if (!conv || conversationMode(conv) !== 'orion') return '';
  const explicit = String(conv.dispatchProjectPath || '').trim();
  if (explicit) return explicit;
  const workspace = String(conv.workspace || '').trim();
  if (!workspace || isGeneratedStandaloneWorkspace(workspace)) return '';
  const normalizedWorkspace = normalizePathForComparison(workspace);
  return projects.find(projectPath => normalizePathForComparison(projectPath) === normalizedWorkspace) || '';
}

function createDispatchConversationFromDraft(prompt = '') {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) return null;
  const projectPath = String(dispatchDraft.projectPath || '').trim();
  const conv = {
    id: 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    title: generateConversationTitle(normalizedPrompt) || 'New Conversation',
    mode: 'orion',
    projectPath: '',
    dispatchProjectPath: projectPath,
    dispatchContextSummary: compactDispatchDiscussionText(dispatchDraft.contextSummary),
    dispatchDiscussionSummary: compactDispatchDiscussionText(normalizedPrompt),
    workspace: projectPath,
    messages: [],
    tasks: [],
    testResults: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isStub: false
  };
  conversations.unshift(conv);
  activeConversationId = conv.id;
  lastDispatchConversationId = conv.id;
  dispatchDraft = { active: false, projectPath: '', contextSummary: '' };
  return conv;
}

function startDispatchDraft(options = {}) {
  appMode = 'orion';
  dispatchDraft = {
    active: true,
    projectPath: String(options.projectPath || '').trim(),
    contextSummary: compactDispatchDiscussionText(options.contextSummary)
  };
  activeConversationId = null;
  currentWorkspace = dispatchDraft.projectPath || getDispatchWorkspaceRoot();
  document.body.setAttribute('data-mode', 'orion');
  document.getElementById('btn-mode-orion')?.classList.add('active');
  document.getElementById('btn-mode-coder')?.classList.remove('active');
  document.getElementById('sidebar-orion-content')?.classList.add('active');
  document.getElementById('sidebar-coder-content')?.classList.remove('active');
  el.chatTitle.textContent = dispatchDraft.projectPath
    ? (dispatchDraft.projectPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || 'Orion')
    : 'Orion';
  el.workspaceLabel.textContent = dispatchDraft.projectPath
    ? (dispatchDraft.projectPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || '')
    : '';
  el.chatInput.value = '';
  el.chatInput.placeholder = 'Ask Orion anything...';
  if (el.welcomeSplash) el.welcomeSplash.style.display = 'none';
  const orionSplash = document.getElementById('orion-welcome-splash');
  if (orionSplash) orionSplash.style.display = 'flex';
  if (el.messagesContainer) {
    el.messagesContainer.innerHTML = '';
    el.messagesContainer.style.display = 'none';
  }
  if (el.workspaceFilesPanel) el.workspaceFilesPanel.classList.add('contextual-panel-hidden');
  updateOrionGreeting();
  renderConversationList();
  renderDesktopDispatchLanding();
  el.chatInput.focus();
}

async function createNewConversation(mode = appMode) {
  if (mode !== 'coder') {
    await window.beginNewFocus(activeConversationId);
    startDispatchDraft();
    return null;
  }
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const title = 'New Conversation';

  const newConv = {
    id: newId,
    title: title,
    mode: mode === 'coder' ? 'coder' : 'orion',
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
    mode: 'coder', // projects only ever exist under Coder
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

function createCoderConversationForProject(projectPath, { title = 'New Coder Task', select = false } = {}) {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const newConv = {
    id: newId,
    title: title || 'New Coder Task',
    mode: 'coder',
    projectPath,
    workspace: projectPath,
    messages: [],
    tasks: [],
    testResults: null
  };

  conversations.unshift(newConv);
  saveConversationsToStorage();

  if (select) {
    selectConversation(newId);
    el.chatInput.focus();
  } else {
    renderConversationList();
  }

  return newConv;
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

function addProjectPath(folderPath) {
  const normalized = normalizePathForComparison(folderPath);
  if (!normalized) return false;
  const exists = projects.some(pathValue => normalizePathForComparison(pathValue) === normalized);
  if (exists) return false;
  projects.push(folderPath);
  saveProjectsToStorage();
  renderProjectsList();
  return true;
}

function normalizePathForComparison(path) {
  return String(path || '').replace(/[\\/]+/g, '\\').replace(/[\\]+$/, '').toLowerCase();
}

function isGeneratedStandaloneWorkspace(path) {
  const normalizedPath = normalizePathForComparison(path);
  const standaloneRoot = normalizePathForComparison(getStandaloneWorkspaceRoot());
  return !!(normalizedPath && standaloneRoot && (normalizedPath === standaloneRoot || normalizedPath.startsWith(standaloneRoot + '\\')));
}

function inferDesktopProjectsRoot(pathValue) {
  const normalized = String(pathValue || '').replace(/[\\/]+/g, '\\').replace(/[\\]+$/, '');
  const match = normalized.match(/^([a-zA-Z]:\\Users\\[^\\]+\\Desktop\\Projects)(?:\\|$)/i);
  return match ? match[1] : '';
}

function getDispatchWorkspaceRoot() {
  const configured = String(appConfig.dispatchWorkspaceRoot || '').trim();
  if (configured) return configured.replace(/[\\\/]+$/, '');

  for (const projectPath of projects) {
    const inferred = inferDesktopProjectsRoot(projectPath);
    if (inferred) return inferred;
  }

  const fromStandaloneRoot = inferDesktopProjectsRoot(getStandaloneWorkspaceRoot());
  if (fromStandaloneRoot) return fromStandaloneRoot;

  const fromDefaultWorkspace = inferDesktopProjectsRoot(appConfig.defaultWorkspacePath);
  if (fromDefaultWorkspace) return fromDefaultWorkspace;

  return 'C:\\Users\\Owner\\Desktop\\Projects';
}

function getConversationRunWorkspace(conv) {
  if (!conv) return currentWorkspace || getDispatchWorkspaceRoot();
  if (conversationMode(conv) === 'orion') {
    const workspace = String(conv.workspace || '').trim();
    if (workspace && !isGeneratedStandaloneWorkspace(workspace)) return workspace;
    return getDispatchWorkspaceRoot();
  }
  return conv.workspace || conv.projectPath || '';
}

function createPhoneConversation({ projectPath = '', dispatchProjectPath = '', contextSummary = '', mode = 'orion', title = 'New Phone Task' } = {}) {
  const convId = 'conv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const normalizedProjectPath = String(projectPath || '').trim();
  const normalizedDispatchProjectPath = mode === 'orion' ? String(dispatchProjectPath || '').trim() : '';
  const conv = {
    id: convId,
    title,
    // A project conversation only ever belongs to Coder, regardless of what the phone's mode
    // toggle happened to be set to when the request came in.
    mode: normalizedProjectPath ? 'coder' : (mode === 'coder' ? 'coder' : 'orion'),
    messages: [],
    createdAt: Date.now(),
    workspace: normalizedProjectPath || normalizedDispatchProjectPath || '',
    projectPath: normalizedProjectPath,
    dispatchProjectPath: normalizedDispatchProjectPath,
    dispatchContextSummary: compactDispatchDiscussionText(contextSummary),
    dispatchDiscussionSummary: '',
    tasks: [],
    awaitingPlanApproval: false,
    planApproved: false,
    awaitingClarification: null
  };
  conversations.unshift(conv);
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
  if (window.api && typeof window.api.readConversationsIndex === 'function') {
    try {
      const result = await window.api.readConversationsIndex();
      if (result && result.success && Array.isArray(result.index)) {
        disk = result.index;
      } else if (result && result.error) {
        console.warn('Failed to read disk conversation index', result.error);
      }
    } catch (error) {
      console.warn('Disk conversation index is unavailable', error);
    }
  }
  
  // Merge and enforce stub formatting
  conversations = mergeConversationSets(disk, local, backup).map(c => {
    // A conversation is a stub if it explicitly says so, OR if it has no messages in its payload
    const isStub = c.isStub !== false && (!Array.isArray(c.messages) || c.messages.length === 0);
    return {
      ...c,
      isStub,
      messages: Array.isArray(c.messages) ? c.messages : [],
      tasks: Array.isArray(c.tasks) ? c.tasks : [],
    };
  });
  
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

  // One-time bulk fix: Dispatch (Orion) mode didn't exist before it shipped, so every standalone
  // conversation that existed at that point was actually done in what is now Coder mode, not
  // Dispatch. Runs exactly once so it never touches genuinely new Dispatch conversations created
  // after this point.
  if (!localStorage.getItem('orionCoderModeBackfillDone')) {
    conversations.forEach(c => {
      if (!c.projectPath && c.mode !== 'orion' && c.mode !== 'coder') {
        c.mode = 'coder';
      }
    });
    localStorage.setItem('orionCoderModeBackfillDone', 'true');
    updated = true;
  }

  conversations.forEach(c => {
    const hasExplicitMode = c.mode === 'orion' || c.mode === 'coder';
    const matchingWorkspaceProject = (!c.projectPath && c.workspace && !isGeneratedStandaloneWorkspace(c.workspace))
      ? projects.find(proj => {
        const lowerWorkspace = c.workspace.toLowerCase();
        const lowerProj = proj.toLowerCase();
        return lowerWorkspace.startsWith(lowerProj);
      })
      : null;

    if (!hasExplicitMode) {
      c.mode = (c.projectPath || matchingWorkspaceProject) ? 'coder' : 'orion';
      updated = true;
    }
    if (c.mode === 'orion' && c.projectPath) {
      // Preserve useful legacy Dispatch linkage while moving it off the Coder-owned field.
      if (!c.dispatchProjectPath && !isGeneratedStandaloneWorkspace(c.projectPath)) {
        c.dispatchProjectPath = c.projectPath;
      }
      c.projectPath = '';
      updated = true;
    }
    if (c.mode === 'orion' && !c.dispatchProjectPath && matchingWorkspaceProject) {
      c.dispatchProjectPath = matchingWorkspaceProject;
      updated = true;
    }
    if (c.mode === 'orion' && c.dispatchProjectPath && isGeneratedStandaloneWorkspace(c.dispatchProjectPath)) {
      c.dispatchProjectPath = '';
      updated = true;
    }
    if (c.mode === 'orion' && c.workspace && isGeneratedStandaloneWorkspace(c.workspace)) {
      c.workspace = '';
      updated = true;
    }
    if (c.projectPath && isGeneratedStandaloneWorkspace(c.workspace)) {
      c.projectPath = '';
      updated = true;
    }
    if (conversationMode(c) === 'coder' && !c.projectPath && c.workspace && !isGeneratedStandaloneWorkspace(c.workspace)) {
      // Find if workspace is inside any project folder
      if (matchingWorkspaceProject) {
        c.projectPath = matchingWorkspaceProject;
        updated = true;
      }
    }
    if (Array.isArray(c.messages)) {
      const before = c.messages.length;
      c.messages = c.messages.filter(msg => !isLegacyPhoneCompanionTokenMessage(msg && msg.text));
      if (c.messages.length !== before) updated = true;
    }
    if (c.mode === 'orion') {
      const summary = deriveDispatchDiscussionSummary(c);
      if (summary && summary !== c.dispatchDiscussionSummary) {
        c.dispatchDiscussionSummary = summary;
        updated = true;
      }
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

function latestToolActivity(logs = []) {
  return [...logs].reverse().find(log => log && (log.type === 'tool_call' || log.tool));
}

// ── Dispatch presentation (phone parity) ─────────────────────────────────────
// Dispatch is a conversational space, not an engineering console. Tool activity renders as one
// collapsed line the user can expand into compact, truncated rows — never the Coder-grade chips
// with full JSON params and raw result dumps.

function formatDispatchValuePreview(value, maxLength) {
  const text = String(value === undefined || value === null ? '' : (typeof value === 'string' ? value : JSON.stringify(value))).trim();
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '…';
}

function formatDispatchParamsPreview(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatDispatchValuePreview(value, 90)}`)
    .join('  ·  ');
}

function formatDispatchActivityRows(logs = []) {
  return logs.slice(-8).map(log => {
    if (log.type === 'thought' && log.content) {
      return `<div class="thought-block">${escapeHtml(formatDispatchValuePreview(log.content, 240))}</div>`;
    }
    if (!(log.type === 'tool_call' || log.tool)) return '';
    const status = log.status === 'completed' ? 'success' : (log.status || 'running');
    const paramsPreview = formatDispatchParamsPreview(log.params);
    const resultPreview = formatDispatchValuePreview(log.result, 240);
    return `
      <div class="tool-run-badge dispatch-activity-row">
        <div class="tool-call-info">
          <span class="tool-name">${escapeHtml(log.tool || 'tool')}</span>
          <span class="tool-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
        </div>
        ${paramsPreview ? `<div class="tool-params">${escapeHtml(paramsPreview)}</div>` : ''}
        ${resultPreview ? `<div class="tool-result-box dispatch-result-preview">${escapeHtml(resultPreview)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function formatDispatchToolActivity(logs = [], isRunning = false) {
  const meaningfulLogs = (logs || []).filter(log => log && (log.type === 'tool_call' || log.tool || (log.type === 'thought' && log.content)));
  if (!meaningfulLogs.length) return '';
  const activity = latestToolActivity(logs);
  const status = activity ? (activity.status === 'completed' ? 'success' : (activity.status || 'running')) : 'success';
  const stepCount = meaningfulLogs.filter(log => log.type === 'tool_call' || log.tool).length;
  const headerLabel = isRunning && activity
    ? `${status === 'error' ? 'Had trouble with' : 'Using'} <code>${escapeHtml(activity.tool || 'tool')}</code>`
    : `Worked through ${stepCount} step${stepCount === 1 ? '' : 's'}`;
  return `
    <div class="agent-logs-container dispatch-activity-log${status === 'error' ? ' error' : ''}">
      <div class="agent-logs-header" onclick="toggleLogs(this)">
        <span class="dispatch-current-tool${isRunning ? ' running' : ''}"><span class="dispatch-tool-pulse"></span>${headerLabel}</span>
        <span>▼</span>
      </div>
      <div class="agent-logs-body" style="display: none;">${formatDispatchActivityRows(meaningfulLogs)}</div>
    </div>
  `;
}

// A "## Work Walkthrough" block in a delegated Coder response is a wall of markdown bullets on
// desktop. In the Dispatch space it becomes a tidy collapsed checklist panel, same as the phone.
function splitDispatchAssistantText(text) {
  const raw = String(text || '');
  const match = raw.match(/(?:^|\n)## Work Walkthrough\s*/);
  if (!match) return { answer: raw, walkthrough: '' };
  const start = match.index + (raw[match.index] === '\n' ? 1 : 0);
  return {
    answer: raw.slice(0, start).trim(),
    walkthrough: raw.slice(start).trim()
  };
}

function parseDispatchWalkthroughRows(walkthroughText) {
  const body = String(walkthroughText || '').replace(/^## Work Walkthrough\s*/i, '').trim();
  if (!body) return [];
  return body.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
    const cleaned = line.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
    const match = cleaned.match(/^([^:]+):\s*(.*)$/);
    const rawStatus = match ? match[1].trim() : 'Done';
    const detail = match ? match[2].trim() : cleaned;
    const status = /^fail/i.test(rawStatus)
      ? 'error'
      : (/^done|^complete|^passed/i.test(rawStatus) ? 'success' : rawStatus.toLowerCase().replace(/\s+/g, '-'));
    return { status, label: rawStatus, detail };
  });
}

function renderDispatchWalkthroughPanel(walkthroughText) {
  const rows = parseDispatchWalkthroughRows(walkthroughText);
  if (!rows.length) return '';
  const renderedRows = rows.slice(-20).map(row => `
    <div class="tool-run-badge dispatch-activity-row walkthrough-row">
      <div class="tool-call-info">
        <span class="tool-name">${escapeHtml(formatDispatchValuePreview(row.detail || 'Work item', 180))}</span>
        <span class="tool-status ${escapeHtml(row.status)}">${escapeHtml(row.label)}</span>
      </div>
    </div>
  `).join('');
  return `
    <div class="agent-logs-container dispatch-activity-log">
      <div class="agent-logs-header" onclick="toggleLogs(this)">
        <span>Work walkthrough · ${rows.length} item${rows.length === 1 ? '' : 's'}</span>
        <span>▼</span>
      </div>
      <div class="agent-logs-body" style="display: none;">${renderedRows}</div>
    </div>
  `;
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

let saveConversationsTimeout = null;
let dirtyConversationIds = new Set();

window.markConversationDirty = function(id) {
  if (id) dirtyConversationIds.add(id);
};

function saveConversationsToStorage() {
  if (saveConversationsTimeout) clearTimeout(saveConversationsTimeout);
  saveConversationsTimeout = setTimeout(() => {
    saveConversationsTimeout = null;
    executeSaveConversationsToStorage().catch(error => {
      console.error('Failed to save conversations', error);
    });
  }, 300);
}

async function flushConversationsToStorage(conversationId = '') {
  if (conversationId) dirtyConversationIds.add(conversationId);
  if (saveConversationsTimeout) {
    clearTimeout(saveConversationsTimeout);
    saveConversationsTimeout = null;
  }
  return executeSaveConversationsToStorage();
}

async function executeSaveConversationsToStorage() {
  const revision = ++conversationSaveRevision;
  
  // 1. Build the lightweight index
  const index = conversations.map(c => {
    return {
      id: c.id,
      title: c.title,
      mode: c.mode,
      projectPath: c.projectPath,
      dispatchProjectPath: c.dispatchProjectPath || '',
      dispatchContextSummary: c.dispatchContextSummary || '',
      dispatchDiscussionSummary: deriveDispatchDiscussionSummary(c),
      workspace: c.workspace,
      launchedCoderConvId: c.launchedCoderConvId,
      launchedCoderTaskTitle: c.launchedCoderTaskTitle,
      launchedCoderTaskStart: c.launchedCoderTaskStart,
      lastDelegatedWork: c.lastDelegatedWork || null,
      planApproved: c.planApproved,
      awaitingPlanApproval: c.awaitingPlanApproval,
      updatedAt: c.updatedAt || Date.now(),
      createdAt: c.createdAt || Date.now(),
      isStub: true, // index always represents stubs
      hasMessages: c.isStub ? !!c.hasMessages : (Array.isArray(c.messages) && c.messages.length > 0)
    };
  });

  // 2. Identify dirty, fully-loaded conversations to write individually
  const dirtyIds = [...dirtyConversationIds];
  dirtyConversationIds.clear();
  
  if (typeof activeConversationId !== 'undefined' && activeConversationId) dirtyIds.push(activeConversationId);
  if (window.getRunningConversationId) {
    const rId = window.getRunningConversationId();
    if (rId) dirtyIds.push(rId);
  }
  
  const uniqueDirtyIds = [...new Set(dirtyIds)];
  const conversationsToWrite = uniqueDirtyIds
    .map(id => conversations.find(c => c.id === id))
    .filter(c => c && !c.isStub); // Only write full payloads

  // 3. Dispatch to disk
  const diskWrites = [];
  if (window.api) {
    if (typeof window.api.writeConversationsIndex === 'function') {
      const indexWrite = window.api.writeConversationsIndex({ revision, index }).then(result => {
        if (result && result.success) {
          lastConversationDiskSaveError = '';
          return true;
        } else {
          lastConversationDiskSaveError = result && result.error ? result.error : 'Unknown disk index save error';
          return false;
        }
      }).catch(error => {
        lastConversationDiskSaveError = error.message || String(error);
        console.error("Failed to save conversation index", error);
        return false;
      });
      diskWrites.push(indexWrite);
    }
    
    if (typeof window.api.writeConversation === 'function') {
      conversationsToWrite.forEach(c => {
        const conversationWrite = window.api.writeConversation(c).then(result => {
          if (result && result.success) return true;
          const message = result && result.error ? result.error : 'Unknown conversation save error';
          throw new Error(message);
        }).catch(error => {
          // Keep failed payloads dirty so the next scheduled or explicit flush retries them.
          dirtyConversationIds.add(c.id);
          console.error(`Save failed for conv ${c.id}`, error);
          return false;
        });
        diskWrites.push(conversationWrite);
      });
    }
  }

  // 4. Save index to localStorage for instant boot
  try {
    const serializedIndex = JSON.stringify(index);
    localStorage.setItem('ag2_conversations', serializedIndex);
    localStorage.setItem('ag2_conversations_backup', serializedIndex);
  } catch (err) {
    console.warn("Failed to write conversations index to localStorage", err);
  }

  if (window.api && typeof window.api.syncPhoneCompanion === 'function') {
    window.api.syncPhoneCompanion();
  }

  const writeResults = await Promise.all(diskWrites);
  return { success: writeResults.every(Boolean), revision, writtenConversationIds: conversationsToWrite.map(c => c.id) };
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
  // Dispatch (Orion) and Coder each keep their own standalone-conversation history -- a chat
  // started in one never appears in the other's list, even though neither has a projectPath.
  const listConfigs = [
    { container: el.conversationList, mode: 'orion' },
    { container: el.conversationListCoder, mode: 'coder' }
  ].filter(cfg => cfg.container);
  if (listConfigs.length === 0) return;

  listConfigs.forEach(({ container, mode }) => {
    container.innerHTML = '';

    const standaloneConversations = conversations.filter(c => {
      const convMode = conversationMode(c);
      if (convMode !== mode) return false;
      return mode === 'orion' || !c.projectPath;
    });

    if (standaloneConversations.length === 0) {
      container.innerHTML = mode === 'orion'
        ? '<p class="empty-state" style="font-size:0.75rem; font-style:italic;">No history yet</p>'
        : '<p class="empty-state" style="font-size:0.75rem; font-style:italic;">No standalone conversations yet</p>';
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

      container.appendChild(item);
    });
  });
}

async function selectConversation(id) {
  activeConversationId = id;
  if (window.clearOrionMemoryInactivityTimer) window.clearOrionMemoryInactivityTimer();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;

  if (conversationMode(conv) === 'orion') {
    dispatchDraft = { active: false, projectPath: '', contextSummary: '' };
    lastDispatchConversationId = conv.id;
  }

  if (conv.isStub) {
    el.messagesContainer.innerHTML = '<div class="loading-state" style="text-align:center; padding:20px; color:#888;">Loading conversation...</div>';
    el.messagesContainer.style.display = 'flex';
    const orionSplashEl = document.getElementById('orion-welcome-splash');
    if (orionSplashEl) orionSplashEl.style.display = 'none';
    el.welcomeSplash.style.display = 'none';
    
    try {
      if (window.api && typeof window.api.readConversation === 'function') {
        const result = await window.api.readConversation(id);
        if (activeConversationId !== id) return;
        
        if (result && result.success && result.conversation) {
          const loadedConv = result.conversation;
          conv.messages = Array.isArray(loadedConv.messages) ? loadedConv.messages : [];
          conv.tasks = Array.isArray(loadedConv.tasks) ? loadedConv.tasks : [];
          conv.testResults = loadedConv.testResults;
          conv.fileTree = loadedConv.fileTree;
          conv.scratchpad = loadedConv.scratchpad;
          conv.isStub = false;
        } else {
          el.messagesContainer.innerHTML = `<div class="error-state" style="text-align:center; padding:20px; color:var(--red);">Failed to load conversation</div>`;
          return;
        }
      }
    } catch (err) {
      if (activeConversationId !== id) return;
      console.error("Hydration failed", err);
      el.messagesContainer.innerHTML = `<div class="error-state" style="text-align:center; padding:20px; color:var(--red);">Error loading conversation</div>`;
      return;
    }
    
    const fullConvs = conversations.filter(c => !c.isStub && c.id !== activeConversationId && c.id !== (window.getRunningConversationId ? window.getRunningConversationId() : null));
    if (fullConvs.length > 50) {
      fullConvs.sort((a, b) => conversationSortTime(a) - conversationSortTime(b));
      fullConvs.slice(0, fullConvs.length - 50).forEach(c => {
        c.messages = [];
        c.tasks = [];
        c.testResults = null;
        c.fileTree = null;
        c.scratchpad = '';
        c.isStub = true;
      });
    }
  }
  
  el.chatTitle.textContent = conv.title;
  normalizeConversationWorkspace(conv);
  const convMode = conversationMode(conv);
  
  // Set active workspace to conversation workspace if initialized,
  // otherwise show pending first message
  const runWorkspace = getConversationRunWorkspace(conv);
  if (convMode === 'orion') {
    currentWorkspace = runWorkspace;
    expandedFileFolders = new Set();
    const wsName = currentWorkspace.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentWorkspace;
    el.workspaceLabel.textContent = wsName;
    el.fileTree.innerHTML = '<p class="empty-state">Dispatch can inspect known projects. Open Coder for file-tree editing.</p>';
    el.fileCountBadge.textContent = '0';
    if (el.workspaceFilesPanel) el.workspaceFilesPanel.classList.add('contextual-panel-hidden');
  } else if (conv.workspace) {
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
  const orionSplashEl = document.getElementById('orion-welcome-splash');
  if (conv.messages.length === 0) {
    if (appMode === 'orion' && orionSplashEl) {
      orionSplashEl.style.display = 'flex';
      el.welcomeSplash.style.display = 'none';
    } else {
      el.welcomeSplash.style.display = 'flex';
      if (orionSplashEl) orionSplashEl.style.display = 'none';
    }
    el.messagesContainer.style.display = 'none';
    el.messagesContainer.innerHTML = '';
  } else {
    if (orionSplashEl) orionSplashEl.style.display = 'none';
    el.welcomeSplash.style.display = 'none';
    el.messagesContainer.style.display = 'flex';
    el.messagesContainer.innerHTML = '';
    
    const replayMessages = conv.messages.map(normalizeConversationMessageForReplay);
    replayMessages.forEach(replayMsg => {
      const replayLogs = Array.isArray(replayMsg.logs) ? replayMsg.logs : [];
      window.clearActiveAiBubble();
      if (replayMsg.role === 'user') {
        renderUserMessage(replayMsg.text, Array.isArray(replayMsg.images) ? replayMsg.images : [], replayMsg.createdAt || null);
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
          renderSystemBubble(replayMsg.text, replayMsg.dedupeKey || '');
        }
      }
    });
    const queuedForThisConversation = Array.isArray(window.promptQueue)
      && window.promptQueue.some(item => item && item.conversationId === activeConversationId);
    const recoveredAssistantMessage = buildMissingAssistantResponseMessage(replayMessages, {
      queued: queuedForThisConversation
    });
    const isThisConversationRunning = window.isAgentRunning && window.isAgentRunning() && 
      (window.getRunningConversationId ? window.getRunningConversationId() === activeConversationId : true);
    if (recoveredAssistantMessage && !isThisConversationRunning) {
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
  
  let conv = conversations.find(c => c.id === activeConversationId);
  if (!conv && appMode === 'orion' && dispatchDraft.active) {
    conv = createDispatchConversationFromDraft(prompt);
  }
  if (!conv) return;
  normalizeConversationWorkspace(conv);
  
  // Hide splash
  el.welcomeSplash.style.display = 'none';
  el.messagesContainer.style.display = 'flex';

  // Capture and clear pending images before rendering
  const imagesToSend = pendingImages.length > 0 ? [...pendingImages] : [];
  clearPendingImages();

  // Render user prompt (with any attached images)
  const userMsgTs = Date.now();
  renderUserMessage(prompt, imagesToSend, userMsgTs);
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

    if (typeof callUtilityModel === 'function' && window.appConfig && window.selectedModel) {
      const titlePrompt = `Generate a very short, concise title (maximum 3 to 5 words) for a conversation that starts with the following prompt. Do not use quotes or punctuation in the title.\n\nPrompt: "${prompt}"`;
      callUtilityModel(titlePrompt, window.selectedModel, window.appConfig, false)
        .then(betterTitle => {
          if (betterTitle) {
            const cleanTitle = betterTitle.replace(/["']/g, '').trim();
            if (cleanTitle && cleanTitle.length < 50) {
              conv.title = cleanTitle;
              if (activeConversationId === conv.id) {
                el.chatTitle.textContent = conv.title;
              }
              renderConversationList();
              if (typeof saveConversationsToStorage === 'function') {
                saveConversationsToStorage();
              }
            }
          }
        })
        .catch(err => console.error("Async title generation failed:", err));
    }
  }

  // Initialize the folder path if this is still the first prompt (project-scoped conversations
  // already have this from normalizeConversationWorkspace above).
  if (!conv.workspace) {
    if (conv.projectPath) {
      conv.workspace = conv.projectPath;
    } else if (conversationMode(conv) === 'coder') {
      conv.workspace = getStandaloneWorkspaceForTitle(conv.title, conv.id);
    }
  }

  // Ensure currentWorkspace is useful for this mode. Coder standalone chats use isolated folders;
  // Dispatch stays rooted at the real Projects directory unless it explicitly changes workspace.
  currentWorkspace = getConversationRunWorkspace(conv);
  expandedFileFolders = new Set();
  el.workspaceLabel.textContent = currentWorkspace.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentWorkspace;
  if (conversationMode(conv) === 'coder') {
    syncWorkspaceFiles();
  } else {
    el.fileTree.innerHTML = '<p class="empty-state">Dispatch can inspect known projects. Open Coder for file-tree editing.</p>';
    el.fileCountBadge.textContent = '0';
    if (el.workspaceFilesPanel) el.workspaceFilesPanel.classList.add('contextual-panel-hidden');
  }
  
  // Update messages history (store compact image refs for replay)
  const msgImages = imagesToSend.map(i => ({ data: i.data, mimeType: i.mimeType }));
  conv.messages.push({ id: createConversationMessageId(conv.id), role: 'user', text: prompt, createdAt: userMsgTs, ...(msgImages.length ? { images: msgImages } : {}) });
  if (conversationMode(conv) === 'orion') {
    conv.dispatchProjectPath = inferDispatchProjectPath(conv);
    conv.dispatchDiscussionSummary = compactDispatchDiscussionText(prompt, conv.title);
  }
  conv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
  saveConversationsToStorage();

  renderConversationList();
  renderProjectsList();

  // Scroll to bottom for the local send action.
  scrollChatToBottom();

  // ── Supervisor interception: Orion message while a supervised Coder task runs ──
  if (window.runAgentLoop) {
    const selectedModel = el.modelSelect.value;
    const runOptions = imagesToSend.length ? { images: imagesToSend } : {};

    if (window.isAgentRunning && window.isAgentRunning()) {
      const runningConvId = window.getRunningConversationId ? window.getRunningConversationId() : null;
      const isOrionConv = conversationMode(conv) === 'orion';
      const launchedCoderConvId = conv.launchedCoderConvId;

      // If this Orion conversation launched the currently running Coder task, intercept
      if (isOrionConv && launchedCoderConvId && runningConvId === launchedCoderConvId) {
        handleSupervisorMessage(conv, prompt, selectedModel);
        return;
      }

      // Default: queue as normal
      const queued = await enqueueOrchestrationTask({
        prompt,
        modelSelectValue: selectedModel,
        targetConversationId: conv.id,
        originConversationId: conv.id,
        source: 'user-queue',
        alreadyRendered: true,
        images: imagesToSend,
        originMessageId: conv.messages[conv.messages.length - 1]?.id || ''
      });
      if (queued.success) {
        persistAssistantStatusMessage(conv.id, `Queued as ${queued.task.title}. Orion will start it after the current task finishes.`, {
          source: 'queue-status',
          dedupeKey: `queued-${queued.task.taskId}`
        });
      } else if (!queued.needsClarification) {
        persistAssistantStatusMessage(conv.id, `Could not queue the task: ${queued.error || 'unknown error'}`, {
          source: 'queue-status', dedupeKey: `queue-error-${conv.id}-${Date.now()}`
        });
      }
    } else {
      await window.runAgentLoop(prompt, selectedModel, conv, runOptions);
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
          const queued = await enqueueOrchestrationTask({
            prompt: pendingPrompt,
            modelSelectValue: selectedModel,
            targetConversationId: pendingConv.id,
            originConversationId: pendingConv.id,
            source: 'user-queue',
            alreadyRendered: true
          });
          if (queued.success) persistAssistantStatusMessage(pendingConv.id, `Queued as ${queued.task.title}.`, {
            source: 'queue-status', dedupeKey: `queued-${queued.task.taskId}`
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

function formatMsgTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function renderUserMessage(text, images = [], timestamp = null) {
  const stickToBottom = shouldAutoScrollChat();
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const timeStr = formatMsgTime(timestamp || Date.now());
  const imgsHtml = (images && images.length)
    ? images.map(img =>
        `<img src="data:${escapeHtml(img.mimeType)};base64,${img.data}" alt="attached image" ` +
        `style="max-width:100%;max-height:280px;border-radius:8px;margin-top:8px;display:block;border:1px solid rgba(151,164,196,.15);">`
      ).join('')
    : '';
  bubble.innerHTML = `
    <div class="message-header user">
      <span>🧑 You</span>
      <span class="msg-timestamp">${timeStr}</span>
    </div>
    <div class="message-body">${escapeHtml(text).replace(/\n/g, '<br>')}${imgsHtml}</div>
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
  const conv = conversations.find(c => c.id === targetId);
  if (conv && options.updateExisting && options.dedupeKey) {
    const existing = (conv.messages || []).slice().reverse().find(msg =>
      msg &&
      msg.role === 'system' &&
      msg.dedupeKey === dedupeKey
    );
    if (existing) {
      existing.text = text;
      existing.updatedAt = Date.now();
      if (options.source) existing.source = options.source;
      saveConversationsToStorage();
      // Update the already-rendered chip in place. The old behavior re-rendered the entire
      // conversation via selectConversation() — mid-run, that replay orphaned the live
      // assistant bubble (leaving a frozen duplicate with a stuck "Working…" spinner) and the
      // agent's next render then appended a second copy of the same message below the chips.
      if (targetId === activeConversationId && el.messagesContainer) {
        const chip = el.messagesContainer.querySelector(`[data-sys-dedupe="${CSS.escape(dedupeKey)}"]`);
        const chipBody = chip && chip.querySelector('.message-body');
        if (chipBody) {
          chipBody.textContent = text;
        } else {
          renderSystemBubble(text, dedupeKey);
        }
      }
      return;
    }
  }
  const windowMs = Number(options.windowMs || 1500);
  window.recentSystemMessages = window.recentSystemMessages || {};
  const now = Date.now();
  const lastAt = window.recentSystemMessages[dedupeKey] || 0;
  if (now - lastAt < windowMs) {
    return;
  }
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
    renderSystemBubble(text, options.dedupeKey || '');
  }
  if (conv) {
    const sysMsg = { role: 'system', text: text };
    if (options.dedupeKey) sysMsg.dedupeKey = options.dedupeKey;
    if (options.source === 'plan-approval') {
      sysMsg.source = 'plan-approval'; // Matches: role: 'system', source: 'plan-approval'
    } else if (options.source) {
      sysMsg.source = options.source;
    }
    conv.messages.push(sysMsg);
    saveConversationsToStorage();
  }
}

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
  // An orphaned user turn with no assistant reply (run ended before a response was saved) is
  // skipped silently rather than replaced with a fake error bubble -- the incomplete turn just
  // doesn't render. The only case worth a status bubble is a legitimate queued follow-up.
  if (!options.queued) return null;
  if (!Array.isArray(normalizedMessages) || normalizedMessages.length === 0) return null;
  const lastUserIndex = normalizedMessages.map(msg => msg.role).lastIndexOf('user');
  if (lastUserIndex === -1) return null;
  const hasMeaningfulAssistantAfterUser = normalizedMessages.slice(lastUserIndex + 1).some(msg => {
    if (!msg || msg.role !== 'assistant') return false;
    const logs = Array.isArray(msg.logs) ? msg.logs : [];
    return !isEmptyThinkingPlaceholder(msg.text, logs);
  });
  if (hasMeaningfulAssistantAfterUser) return null;
  const text = 'Queued. Orion will start this after the current task finishes.';
  return {
    role: 'assistant',
    source: 'queue-status',
    text,
    content: text,
    logs: [],
    turns: [],
    statusOnly: true
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
  const secureEnabled = payload.preferredUrlType === 'https' || /^https:\/\//i.test(pairUrl);
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
      ? `${expiresText}. ${secureEnabled ? 'HTTPS enabled for phone notifications.' : 'Live view only; add an HTTPS phone URL in Settings for mobile notifications.'}`
      : 'LAN companion mode is disabled by default. No localhost QR is shown for phones.';
  }
  // Tailscale panel: show/hide the Tailscale QR block inside the pairing panel
  const tsBlock = document.getElementById('phone-companion-tailscale-block');
  const tsQrEl = document.getElementById('phone-companion-tailscale-qr');
  const tsUrlEl = document.getElementById('phone-companion-tailscale-url');
  if (tsBlock && payload.tailscaleQrSvg) {
    tsBlock.style.display = '';
    if (tsQrEl) tsQrEl.innerHTML = String(payload.tailscaleQrSvg || '');
    if (tsUrlEl) tsUrlEl.textContent = String(payload.tailscaleStableUrl || payload.tailscalePairUrl || '');
  } else if (tsBlock) {
    tsBlock.style.display = 'none';
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
      const activeDevices = devices.filter(d => !d.revoked);
      const revokeAllBtn = activeDevices.length > 1
        ? `<button class="btn-secondary btn-revoke-all-devices" type="button" style="margin-bottom:8px; font-size:0.75rem; opacity:0.8;">Revoke All (${activeDevices.length})</button>`
        : '';
      listContainer.innerHTML = revokeAllBtn + devices.map(d => {
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
      const revokeAllButton = listContainer.querySelector('.btn-revoke-all-devices');
      if (revokeAllButton) {
        revokeAllButton.addEventListener('click', () => window.revokeAllDevices());
      }
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

window.revokeAllDevices = async () => {
  const approved = await showOrionConfirmDialog({
    title: 'Revoke all devices?',
    message: "All paired phones will lose access immediately. You can pair them again later.",
    confirmLabel: 'Revoke All',
    danger: true
  });
  if (approved?.confirmed && window.api && typeof window.api.revokeAllPhoneCompanionDevices === 'function') {
    await window.api.revokeAllPhoneCompanionDevices();
    await refreshPairedDevicesList();
  }
};

setInterval(() => {
  if (el.phoneCompanionModal && el.phoneCompanionModal.classList.contains('active')) {
    refreshPairedDevicesList().catch(() => {});
  }
}, 4000);

function renderSystemBubble(text, dedupeKey = '') {
  if (isLegacyPhoneCompanionTokenMessage(text)) {
    return;
  }
  const stickToBottom = shouldAutoScrollChat();
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  // Stamped so updateExisting system messages can refresh the rendered chip in place instead of
  // re-rendering the whole conversation (see appendSystemMessage).
  if (dedupeKey) bubble.dataset.sysDedupe = String(dedupeKey);
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
  const secureEnabled = payload.preferredUrlType === 'https' || /^https:\/\//i.test(pairUrl);
  const expiresText = payload.expiresAt ? `Expires: ${new Date(payload.expiresAt).toLocaleTimeString()}` : 'Short-lived pairing link';

  // Tailscale section — only shown when Tailscale is active on the desktop
  const tailscaleQrSvg = String(payload.tailscaleQrSvg || '');
  const tailscalePairUrl = String(payload.tailscalePairUrl || '');
  const tailscaleStableUrl = String(payload.tailscaleStableUrl || '');
  const tailscaleSection = tailscaleQrSvg ? `
    <div style="border-top:1px solid var(--border-color); margin-top:14px; padding-top:14px;">
      <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#34d399; margin-bottom:8px;">🌐 Anywhere via Tailscale</div>
      <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
        <div aria-label="Tailscale pairing QR code" style="background:#fff; padding:8px; border-radius:8px; line-height:0; border:2px solid #34d399;">${tailscaleQrSvg}</div>
        <div style="min-width:180px; flex:1;">
          <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:6px;">Scan this from any network — coffee shop, cell data, anywhere Tailscale is connected.</div>
          <div style="font-family:var(--font-mono); font-size:.72rem; word-break:break-all; color:#34d399;">${escapeHtml(tailscaleStableUrl || tailscalePairUrl)}</div>
        </div>
      </div>
    </div>
  ` : '';

  bubble.innerHTML = `
    <div class="message-header" style="color: var(--accent-secondary);">Phone Companion Pairing</div>
    <div class="message-body" style="font-family: var(--font-sans); color: var(--text);">
      <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--accent-secondary); margin-bottom:8px;">📶 Local Wi-Fi</div>
      <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
        <div data-companion-qr="true" aria-label="Phone Companion pairing QR code" style="background:#fff; padding:8px; border-radius:8px; line-height:0;">${qrSvg}</div>
        <div style="min-width:220px; flex:1;">
          <div style="font-weight:700; margin-bottom:6px;">Scan once to trust this phone</div>
          <div style="color: var(--text-muted); margin-bottom:8px;">${secureEnabled ? 'This HTTPS link can request phone notifications. Add the clean URL to your home screen after pairing.' : 'This local link keeps live view working. Add a Secure Phone URL in Settings to enable background notifications.'}</div>
          <div data-pair-url="${escapeHtml(pairUrl)}" style="font-family: var(--font-mono); font-size:.76rem; word-break:break-all;">${escapeHtml(pairUrl)}</div>
          <div data-stable-phone-url="${escapeHtml(stableUrl)}" style="font-family: var(--font-mono); font-size:.76rem; word-break:break-all; margin-top:6px; color:var(--success-color);">${escapeHtml(stableUrl)}</div>
          <div data-pairing-metadata="true" style="color: var(--text-muted); font-size:.74rem; margin-top:8px;">${escapeHtml(expiresText)}</div>
        </div>
      </div>
      ${tailscaleSection}
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
  if (isNew) hideOrionTyping(); // remove typing indicator when real bubble appears

  if (!isNew) {
    bubble = activeAiBubble;
  } else {
    bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    activeAiBubble = bubble;
  }

  const runningConversationId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const activeConv = typeof conversations !== 'undefined'
    ? conversations.find(c => c.id === activeConversationId)
    : null;
  const isDispatchConversation = activeConv && conversationMode(activeConv) === 'orion';
  // The clean presentation belongs to the Dispatch SPACE, not just Dispatch-mode conversations:
  // a delegated Coder transcript opened while the app is in Dispatch must not dump Coder-grade
  // tool chips into that space. The same conversation opened from Coder keeps the full console.
  const isDispatchPresentation = isDispatchConversation || (typeof appMode !== 'undefined' && appMode === 'orion');
  const isRunningThisConversation = !!(window.isAgentRunning && window.isAgentRunning() && runningConversationId === activeConversationId);

  let logsHtml = '';
  if (hasLogs) {
    if (isDispatchPresentation) {
      logsHtml = formatDispatchToolActivity(logs, isRunningThisConversation);
    } else {
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
        const elapsedBadge = (log.elapsed != null && log.status !== 'running')
          ? `<span class="tool-elapsed">${log.elapsed >= 1000 ? (log.elapsed / 1000).toFixed(1) + 's' : log.elapsed + 'ms'}</span>`
          : '';
        logsHtml += `
          <div class="tool-run-badge">
            <div class="tool-call-info">
              <span class="tool-name">🛠️ ${escapeHtml(log.tool)}</span>
              <span class="tool-status ${statusClass}">${statusClass}</span>
              ${elapsedBadge}
            </div>
            <div class="tool-params">Params: ${escapeHtml(JSON.stringify(log.params))}</div>
            ${resBox}
          </div>
        `;
      }
    });
    
    logsHtml += `</div></div>`;
    }
  }
  
  // Render markdown text
  const displayText = isThinkingPlaceholder ? '' : String(text || '');
  let bodyText = displayText;
  let walkthroughHtml = '';
  if (isDispatchPresentation && displayText) {
    const split = splitDispatchAssistantText(displayText);
    if (split.walkthrough) {
      bodyText = split.answer;
      walkthroughHtml = renderDispatchWalkthroughPanel(split.walkthrough);
    }
  }
  const renderedMarkdown = bodyText
    ? (typeof marked !== 'undefined' ? marked.parse(bodyText) : escapeHtml(bodyText))
    : '';
  const inlineArtifactsHtml = renderInlineArtifactCards(logs);
  
  let runningIndicatorHtml = '';
  let planApprovalHtml = '';
  let clarificationHtml = '';
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
  let isLastAssistantMsg = true;
  if (msgMeta && activeConv && activeConv.messages) {
    const lastAsst = activeConv.messages.slice().reverse().find(m => {
      const r = String((m && m.role) || '').toLowerCase();
      return r === 'assistant' || r === 'model' || r === 'ai' || r === 'orion';
    });
    if (lastAsst) {
      if (lastAsst.createdAt && msgMeta.createdAt) {
        isLastAssistantMsg = lastAsst.createdAt === msgMeta.createdAt;
      } else {
        isLastAssistantMsg = lastAsst.text === msgMeta.text;
      }
    }
  }

  if (isLastAssistantMsg && window.isAgentRunning && window.isAgentRunning() && runningConversationId === activeConversationId) {
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
  
  const aiMsgTime = isNew ? formatMsgTime(Date.now()) : '';
  bubble.innerHTML = `
    <div class="message-header ai">
      <span>✦ Orion AI</span>
      ${aiMsgTime ? `<span class="msg-timestamp">${aiMsgTime}</span>` : ''}
    </div>
    ${logsHtml}
    <div class="message-body">
      ${renderedMarkdown}
      ${walkthroughHtml}
      ${inlineArtifactsHtml}
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
  // Stale-spinner sweep: a running indicator in any bubble other than the one just rendered is
  // an orphan from an interrupted render path (e.g. a mid-run transcript re-render detaching the
  // live bubble). A bubble that is not the live bubble cannot be "Working…".
  el.messagesContainer.querySelectorAll('.agent-running-indicator').forEach(node => {
    if (!bubble.contains(node)) node.remove();
  });
  bubble.querySelectorAll('a[href^="orion-file:"]').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const href = link.getAttribute('href') || '';
      const relPath = decodeURIComponent(href.replace('orion-file:', ''));
      openFileViewer(relPath);
    });
  });
  bubble.querySelectorAll('a[href^="orion-artifact://"]').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const href = link.getAttribute('href') || '';
      openImageArtifact({
        artifactType: 'screenshot',
        displayName: href.split(/[\\/]/).pop() || 'screenshot.png',
        screenshotPath: href,
        toolName: 'artifact'
      });
    });
  });
  wireInlineArtifactOpeners(bubble);
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

// ── CLARIFICATION CARD ────────────────────────────────────────────────────────
// Builds the interactive question-card HTML. Also used by the supervisor proxy.
function buildClarificationCardHtml(clarData) {
  const { intro, questions } = clarData || {};
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

async function submitClarificationAnswers({ button, bubble, targetConversationId } = {}) {
  const targetId = targetConversationId || activeConversationId;
  const conv = conversations.find(c => c.id === targetId);
  if (!conv || !conv.awaitingClarification) return;

  const clarData = conv.awaitingClarification;
  const questions = clarData.questions || [];

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

  const formattedAnswers = answers.map(a => `${a.header}: ${a.answer}`).join('\n');
  const userMessage = `Here are my answers:\n${formattedAnswers}`;

  // Supervisor proxy: if these answers belong to a Coder conversation, relay them there
  const relayConvId = clarData._relayToConvId;
  if (relayConvId) {
    const coderConv = conversations.find(c => c.id === relayConvId);
    if (coderConv) {
      window.steeringQueue = window.steeringQueue || {};
      window.steeringQueue[relayConvId] = window.steeringQueue[relayConvId] || [];
      window.steeringQueue[relayConvId].push(`[CLARIFICATION ANSWER]\n${formattedAnswers}`);
      coderConv.awaitingClarification = null;
      conv.awaitingClarification = null;
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      appendSystemMessage('Answers relayed to Coder.', { conversationId: targetId });
    }
    return;
  }

  conv.awaitingClarification = null;
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
window.changeActiveWorkspace = function(folderPath, options = {}) {
  const targetConversationId = options.conversationId || activeConversationId;
  let promoteProjectForWorkspace = options.promoteProject === true;
  let targetMode = appMode;
  if (targetConversationId) {
    const conv = conversations.find(c => c.id === targetConversationId);
    if (conv) {
      conv.workspace = folderPath;
      targetMode = conversationMode(conv);
      const promoteProject = options.promoteProject === true || (options.promoteProject !== false && conversationMode(conv) === 'coder');
      promoteProjectForWorkspace = promoteProject;
      if (promoteProject) {
        conv.projectPath = folderPath;
      } else if (conversationMode(conv) === 'orion') {
        conv.projectPath = '';
        const normalizedFolder = normalizePathForComparison(folderPath);
        const knownProject = projects.find(projectPath => normalizePathForComparison(projectPath) === normalizedFolder);
        if (knownProject) conv.dispatchProjectPath = knownProject;
      }
      saveConversationsToStorage();
    }
  }
  if (promoteProjectForWorkspace) addProjectPath(folderPath);
  currentWorkspace = folderPath;
  expandedFileFolders = new Set();
  el.workspaceLabel.textContent = folderPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || folderPath;
  if (promoteProjectForWorkspace || targetMode === 'coder') {
    syncWorkspaceFiles();
  } else {
    el.fileTree.innerHTML = '<p class="empty-state">Dispatch is inspecting this folder. Promote it to Coder when you want to build or edit here.</p>';
    el.fileCountBadge.textContent = '0';
    if (el.workspaceFilesPanel) el.workspaceFilesPanel.classList.add('contextual-panel-hidden');
  }
  refreshOperationalContext();
};
window.promoteWorkspaceToCoder = async function(options = {}) {
  const folderPath = String(options.path || currentWorkspace || '').trim();
  if (!folderPath) return { success: false, error: 'No workspace path to promote.' };
  addProjectPath(folderPath);

  const prompt = String(options.prompt || '').trim();
  const title = String(options.title || '').trim()
    || (prompt ? generateConversationTitle(prompt) : 'New Coder Task');
  const conv = createCoderConversationForProject(folderPath, {
    title,
    select: options.open === true
  });

  const requestedPacketIds = Array.isArray(options.contextPacketIds)
    ? [...new Set(options.contextPacketIds.map(String).filter(Boolean))].slice(-5)
    : [];
  let assignedPacketIds = [];
  let contextTransferError = '';
  if (requestedPacketIds.length > 0 && window.api && typeof window.api.assignContextPackets === 'function') {
    try {
      const assignment = await window.api.assignContextPackets(folderPath, requestedPacketIds, {
        sourceConversationId: String(options.sourceConversationId || ''),
        targetConversationId: conv.id,
        requestedWork: prompt,
        findings: Array.isArray(options.findings) ? options.findings : []
      });
      assignedPacketIds = assignment && Array.isArray(assignment.assignedPacketIds)
        ? assignment.assignedPacketIds
        : [];
      if (!assignment || assignment.success === false) contextTransferError = (assignment && assignment.error) || 'Context packet assignment failed.';
    } catch (error) {
      contextTransferError = error.message || String(error);
    }
  }
  if (assignedPacketIds.length > 0) {
    conv.inheritedContext = {
      packetIds: assignedPacketIds,
      sourceConversationId: String(options.sourceConversationId || ''),
      workspace: folderPath,
      assignedAt: Date.now(),
      active: true
    };
  }
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
  saveConversationsToStorage();

  if (prompt) {
    // Context packets only exist when Dispatch explored with inspect_code_context. If it worked
    // with grep/read_file instead, its findings would otherwise be silently dropped here (they
    // only ride inside packets) — fold them into the queued prompt so the investigation isn't
    // lost at the handoff boundary.
    const looseFindings = Array.isArray(options.findings)
      ? options.findings.map(f => String(f || '').trim()).filter(Boolean).slice(0, 12)
      : [];
    const queuedPrompt = (assignedPacketIds.length === 0 && looseFindings.length > 0)
      ? `${prompt}\n\nFindings from Dispatch's prior investigation (verify before relying on them):\n${looseFindings.map(f => `- ${f}`).join('\n')}`
      : prompt;
    const originConv = conversations.find(item => item.id === String(options.sourceConversationId || ''));
    const handoffTask = await enqueueOrchestrationTask({
      prompt: queuedPrompt,
      resolvedObjective: RendererTaskOrchestration && RendererTaskOrchestration.isContextDependentRequest(prompt) ? '' : queuedPrompt,
      title,
      targetConversationId: conv.id,
      originConversationId: String(options.sourceConversationId || conv.id),
      originSessionId: String(options.sourceSessionId || ''),
      originMessageId: String(options.sourceMessageId || ''),
      precedingMessages: taskContextMessages(originConv || conv),
      workspace: structuredWorkspaceForConversation(conv, folderPath),
      requirements: looseFindings,
      source: 'dispatch-handoff',
      modelSelectValue: window.getSelectedModel(),
      contextPacketIds: assignedPacketIds,
      createdAt: Date.now()
    });
    if (!handoffTask.success) {
      return {
        success: false,
        needsClarification: !!handoffTask.needsClarification,
        error: handoffTask.clarification || handoffTask.error || 'The handoff task could not be resolved.'
      };
    }
    conv.lastOrchestrationTaskId = handoffTask.task.taskId;
    if (originConv) originConv.lastOwnedTaskId = handoffTask.task.taskId;
    persistAssistantStatusMessage(conv.id, `Queued from Dispatch as ${handoffTask.task.title}. Coder will start when the current turn finishes.`, {
      source: 'queue-status',
      dedupeKey: `dispatch-handoff-${handoffTask.task.taskId}`
    });
    options._createdTask = handoffTask.task;
  }

  renderProjectsList();
  renderConversationList();
  return {
    success: true,
    projectPath: folderPath,
    conversationId: conv.id,
    title: conv.title,
    queued: !!prompt,
    taskId: options._createdTask ? options._createdTask.taskId : '',
    status: options._createdTask ? options._createdTask.status : (prompt ? 'pending' : 'completed'),
    contextPacketIds: assignedPacketIds,
    contextTransferred: assignedPacketIds.length > 0,
    contextTransferError
  };
};
window.getSelectedModel = () => el.modelSelect ? el.modelSelect.value : appConfig.defaultModel;
window.getKnownProjects = () => projects.slice();
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
window.flushConversationsToStorage = flushConversationsToStorage;
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

// Typing indicator for Orion mode
let orionTypingEl = null;
function showOrionTyping() {
  if (typeof appMode === 'undefined' || appMode !== 'orion') return;
  if (orionTypingEl) return;
  orionTypingEl = document.createElement('div');
  orionTypingEl.className = 'orion-typing-indicator';
  orionTypingEl.innerHTML = `
    <span class="orion-typing-dot"></span>
    <span class="orion-typing-dot"></span>
    <span class="orion-typing-dot"></span>
    <span class="orion-typing-label">Orion is thinking…</span>
  `;
  el.messagesContainer.appendChild(orionTypingEl);
  el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
}
function hideOrionTyping() {
  if (orionTypingEl) {
    orionTypingEl.remove();
    orionTypingEl = null;
  }
}

window.onAgentStatusChange = (running) => {
  const submitBtn = el.btnSubmit;
  const steerBtn = document.getElementById('btn-steer');
  const queueBtn = document.getElementById('btn-queue');

  if (running) {
    // ── Supervisor: record which conversation just started ──
    _supervisorLastRunningConvId = window.getRunningConversationId ? window.getRunningConversationId() : null;

    showOrionTyping();
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
    hideOrionTyping();
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

    // ── Supervisor: notify the Orion conversation that launched this Coder task ──
    // We check all conversations because the finished conv may not be the active one.
    // Multi-pass coder tasks auto-continue: this handler can fire with running=false
    // right before the next pass is queued (via a 500ms setTimeout) and restarts the
    // run. Defer the notification and skip it if the same conversation is running again.
    const capturedJustFinishedId = _supervisorLastRunningConvId;
    _supervisorLastRunningConvId = null;
    if (capturedJustFinishedId) {
      setTimeout(() => {
        const stillRunning = window.isAgentRunning && window.isAgentRunning()
          && window.getRunningConversationId
          && window.getRunningConversationId() === capturedJustFinishedId;
        if (!stillRunning) notifySupervisorOfCoderCompletion(capturedJustFinishedId);
      }, 800);
    }
    hideCoderStatusCard();
  }
};
window.renderUserMessageInChat = renderUserMessage;
window.getPhoneCompanionState = async (targetConversationId) => {
  const requestedId = String(targetConversationId || '');
  const requestedConv = requestedId ? conversations.find(c => c.id === requestedId) : null;
  const activeConv = activeConversationId ? conversations.find(c => c.id === activeConversationId) : null;
  const conv = requestedConv || activeConv || conversations[0] || null;
  if (conv && conv.isStub && conv.hasMessages && window.api && typeof window.api.readConversation === 'function') {
    try {
      const result = await window.api.readConversation(conv.id);
      if (result && result.success && result.conversation) {
        const loadedConv = result.conversation;
        conv.messages = Array.isArray(loadedConv.messages) ? loadedConv.messages : [];
        conv.tasks = Array.isArray(loadedConv.tasks) ? loadedConv.tasks : [];
        conv.testResults = loadedConv.testResults;
        conv.fileTree = loadedConv.fileTree;
        conv.scratchpad = loadedConv.scratchpad;
        conv.isStub = false;
      }
    } catch (err) {
      console.error('Phone companion stub hydration failed', err);
    }
  }
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
      mode: conversationMode(c),
      workspace: c.workspace || '',
      projectPath: c.projectPath || '',
      dispatchProjectPath: inferDispatchProjectPath(c),
      discussionSummary: deriveDispatchDiscussionSummary(c),
      launchedCoderConvId: c.launchedCoderConvId || '',
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
    const dispatchConversations = conversations.filter(c => conversationMode(c) === 'orion' && inferDispatchProjectPath(c) === path);
    const latestDispatch = dispatchConversations
      .slice()
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
    return {
      path,
      name,
      conversationCount: projectConversations.length,
      dispatchConversationCount: dispatchConversations.length,
      latestDispatchConversationId: latestDispatch ? latestDispatch.id : '',
      latestDiscussion: latestDispatch ? deriveDispatchDiscussionSummary(latestDispatch) : '',
      updatedAt: [...projectConversations, ...dispatchConversations]
        .reduce((latest, c) => Math.max(latest, c.updatedAt || c.createdAt || 0), 0)
    };
  });

  const activeWork = collectDispatchActiveWork(isGlobalRunning, globalRunningId);
  
  const companionWorkspace = conv ? getConversationRunWorkspace(conv) : currentWorkspace;
  const companionWorkspaceResolution = conv
    ? structuredWorkspaceForConversation(conv, companionWorkspace)
    : { role: 'unresolved', path: '', project: { name: '', path: '' }, resolved: false };
  const orchestrationTasks = [...orchestrationTaskCache.values()]
    .filter(task => task && ((task.origin && task.origin.conversationId === resolvedId)
      || (task.target && task.target.conversationId === resolvedId)))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .slice(0, 12)
    .map(task => ({
      taskId: task.taskId,
      title: task.title,
      objective: task.objective,
      status: task.status,
      workspacePath: task.workspacePath || '',
      originConversationId: task.origin && task.origin.conversationId,
      targetConversationId: task.target && task.target.conversationId,
      updatedAt: task.updatedAt || task.createdAt || 0
    }));
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
    mode: conversationMode(conv),
    conversations: conversationsSummary,
    projects: projectSummaries,
    activeWork: activeWork.slice(0, 6),
    workspace: companionWorkspace,
    workspaceKind: companionWorkspaceResolution.role,
    workspaceDescription: RendererWorkspaceResolution
      ? RendererWorkspaceResolution.describeWorkspace({
          kind: companionWorkspaceResolution.role,
          path: companionWorkspaceResolution.path,
          searchRoot: getDispatchWorkspaceRoot(),
          projectName: companionWorkspaceResolution.project && companionWorkspaceResolution.project.name
        })
      : companionWorkspace,
    running: isActiveTargetRunning,
    globalRunning: isGlobalRunning,
    runningConversationId: globalRunningId,
    queuedPrompts: window.promptQueue ? window.promptQueue.filter(q => q.conversationId === resolvedId).length : 0,
    queuedPromptPreview: window.promptQueue ? window.promptQueue.filter(q => q.conversationId === resolvedId).map(q => q.taskTitle || q.originalUserMessage || q.prompt).slice(0, 3) : [],
    subStatus: isActiveTargetRunning && window.getAgentSubStatus ? window.getAgentSubStatus() : '',
    executionMode: isActiveTargetRunning && window.getAgentExecutionMode ? window.getAgentExecutionMode() : 'idle',
    awaitingPlanApproval: !!(conv && conv.awaitingPlanApproval && !conv.planApproved),
    awaitingClarification: (conv && conv.awaitingClarification) ? conv.awaitingClarification : null,
    tasks: conv && Array.isArray(conv.tasks) ? conv.tasks : [],
    orchestrationTasks,
    activeTaskId: orchestrationTasks.find(task => task.status === 'active')?.taskId
      || orchestrationTasks.find(task => task.status === 'pending')?.taskId
      || '',
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
    dispatchProjectPath: options.dispatchProjectPath || '',
    contextSummary: options.contextSummary || '',
    mode: options.mode || 'orion',
    title: 'New Phone Task'
  });

  let prompt = String(options.prompt || '').trim();
  if (prompt && typeof options.fileContent === 'string' && options.fileContent.length > 0) {
    const fileName = String(options.fileName || 'file.txt').replace(/[^\w.\-]/g, '_').slice(0, 80);
    const content = options.fileContent.length > 80000
      ? options.fileContent.slice(0, 80000) + '\n[... truncated]'
      : options.fileContent;
    prompt = `[Attached file: ${fileName}]\n\`\`\`\n${content}\n\`\`\`\n\n${prompt}`;
  }
  if (prompt) {
    try {
      await window.submitPhoneCompanionPrompt({
        prompt,
        conversationId: conv.id,
        imageData: options.imageData,
        imageMimeType: options.imageMimeType,
        fileContent: options.fileContent,
        fileName: options.fileName
      });
    } catch (error) {
      conversations = conversations.filter(item => item.id !== conv.id);
      throw error;
    }
  } else if (conversationMode(conv) === 'coder') {
    saveConversationsToStorage();
  } else {
    // A blank Dispatch request is only a client-side draft. Never leave an empty conversation in
    // the durable index if an older phone client still calls this endpoint before the first send.
    conversations = conversations.filter(item => item.id !== conv.id);
    return { success: true, draft: true, conversationId: '', workspace: '', projectPath: '', dispatchProjectPath: '' };
  }
  return {
    success: true,
    conversationId: conv.id,
    workspace: conv.workspace,
    projectPath: conv.projectPath,
    dispatchProjectPath: conv.dispatchProjectPath || ''
  };
};

window.submitPhoneCompanionPrompt = async (options) => {
  // Can be called with either a string or an options object
  const text = typeof options === 'string' ? options.trim() : String(options.prompt || '').trim();
  let targetId = (typeof options === 'object' && options.conversationId) ? options.conversationId : activeConversationId;
  // Image data from phone companion (optional)
  const phoneImageData = typeof options === 'object' && options.imageData ? options.imageData : null;
  const phoneImageMime = typeof options === 'object' && options.imageMimeType ? options.imageMimeType : 'image/jpeg';
  const phoneImages = phoneImageData ? [{ data: phoneImageData, mimeType: phoneImageMime }] : [];

  if (!text) return { success: false, error: 'Missing prompt' };

  let conv = conversations.find(c => c.id === targetId);
  if (!conv) {
    conv = createPhoneConversation({
      projectPath: typeof options === 'object' ? options.projectPath || '' : '',
      dispatchProjectPath: typeof options === 'object' ? options.dispatchProjectPath || '' : '',
      contextSummary: typeof options === 'object' ? options.contextSummary || '' : '',
      mode: typeof options === 'object' ? options.mode || 'orion' : 'orion',
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
  const incomingDispatchProjectPath = typeof options === 'object' ? String(options.dispatchProjectPath || '').trim() : '';
  if (conversationMode(conv) === 'orion' && incomingDispatchProjectPath) {
    conv.dispatchProjectPath = incomingDispatchProjectPath;
    conv.workspace = incomingDispatchProjectPath;
  }

  // Generate a short title if it's new
  if (conv.messages.length === 0 || conv.title === 'New Phone Task' || conv.title === 'Untitled Conversation') {
    conv.title = text.length > 40 ? text.substring(0, 40) + '...' : text;
  }
  if (conversationMode(conv) === 'orion') {
    conv.dispatchDiscussionSummary = compactDispatchDiscussionText(text, conv.title);
  }
  normalizeConversationWorkspace(conv);
  if (!conv.workspace) {
    if (conv.projectPath) {
      conv.workspace = conv.projectPath;
    } else if (conversationMode(conv) === 'coder') {
      conv.workspace = getStandaloneWorkspaceForTitle(conv.title, conv.id);
    }
  }
  conv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
  saveConversationsToStorage();

  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;

  if (isGlobalRunning) {
    const runningConvId = window.getRunningConversationId ? window.getRunningConversationId() : null;
    const convMode = conv.mode || (typeof conversationMode === 'function' ? conversationMode(conv) : '');
    const isOrionConv = convMode === 'orion' || (!convMode && conv.mode !== 'coder');
    const launchedCoderConvId = conv.launchedCoderConvId;

    if (isOrionConv && launchedCoderConvId && runningConvId === launchedCoderConvId) {
      // Push the user message to history first
      conv.messages.push({ role: 'user', source: 'phone', text, createdAt: Date.now(), ...(phoneImages.length ? { images: phoneImages } : {}) });
      saveConversationsToStorage();
      if (targetId === activeConversationId) renderUserMessage(text, phoneImages, Date.now());
      handleSupervisorMessage(conv, text, window.getSelectedModel(), { source: 'phone', images: phoneImages });
      return { success: true, queued: false, conversationId: targetId, title: conv.title || 'New Conversation' };
    }

    window.promptQueue.push({ prompt: text, modelSelectValue: window.getSelectedModel(), conversationId: targetId, source: 'phone', images: phoneImages, alreadyRendered: true });
    if (conv.messages) {
      conv.messages.push({ role: 'user', source: 'phone', text, createdAt: Date.now(), ...(phoneImages.length ? { images: phoneImages } : {}) });
      saveConversationsToStorage();
    }
    persistAssistantStatusMessage(targetId, "Queued. Orion will start this after the current task finishes.", {
      source: 'queue-status',
      dedupeKey: `phone-queued-${targetId}-${text}`
    });
    if (targetId === activeConversationId) {
      renderUserMessage(text, phoneImages, Date.now());
    }
    return { success: true, queued: true, conversationId: targetId, title: conv.title || 'New Conversation' };
  }

  // Directly run agent loop on the target conversation (without forcing desktop UI switch)
  if (conv.messages) {
    conv.messages.push({ role: 'user', source: 'phone', text, createdAt: Date.now(), ...(phoneImages.length ? { images: phoneImages } : {}) });
    saveConversationsToStorage();
  }
  if (targetId === activeConversationId) {
    renderUserMessage(text, phoneImages, Date.now());
  }
  window.runAgentLoop(text, window.getSelectedModel(), conv, { source: 'phone', images: phoneImages })
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
    renderUserMessage(userMessage, [], Date.now());
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
  if (window.api && typeof window.api.deleteConversation === 'function') {
    window.api.deleteConversation(id);
  }
  
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
  removedConversationIds.forEach(id => {
    cleanupConversationArtifacts(id);
    if (window.api && typeof window.api.deleteConversation === 'function') {
      window.api.deleteConversation(id);
    }
  });
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

// Serve a workspace file to the phone companion for download/view.
// Security: path must be absolute and start with the current workspace root.
window.readWorkspaceFileForPhone = (filePath) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const fp = String(filePath || '').trim();
    if (!fp) return { success: false, error: 'No path provided' };
    const workspace = currentWorkspace || '';
    const normalized = path.resolve(fp);
    if (workspace && !normalized.startsWith(path.resolve(workspace))) {
      return { success: false, error: 'Path outside workspace' };
    }
    if (!fs.existsSync(normalized)) return { success: false, error: 'File not found' };
    const stat = fs.statSync(normalized);
    if (!stat.isFile()) return { success: false, error: 'Not a file' };
    if (stat.size > 10 * 1024 * 1024) return { success: false, error: 'File too large (>10 MB)' };
    const ext = path.extname(normalized).toLowerCase().replace('.', '');
    const textExts = new Set(['txt','md','csv','json','js','mjs','cjs','ts','jsx','tsx','py','html','htm','css','sh','bash','yml','yaml','xml','sql','toml','ini','env','log','gitignore','prettierrc','eslintrc']);
    const fileContent = fs.readFileSync(normalized);
    if (textExts.has(ext)) {
      return { success: true, content: fileContent.toString('utf8'), encoding: 'utf8', mimeType: 'text/plain' };
    }
    const mimeMap = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', zip: 'application/zip' };
    return { success: true, content: fileContent.toString('base64'), encoding: 'base64', mimeType: mimeMap[ext] || 'application/octet-stream' };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCHER-AS-SUPERVISOR LAYER
// Manages the Orion → Coder supervision relationship:
//   • Live steering channel (check-in / steering / normal routing)
//   • Coder task state monitoring with notifications
//   • Floating status card
//   • Clarification proxy
// ═══════════════════════════════════════════════════════════════════════════════

// Track which conversation ID was running when onAgentStatusChange fired (needed
// for the completion notification because running ID is already cleared by then).
let _supervisorLastRunningConvId = null;

// Polling interval handle for the Coder task monitor.
let _coderTaskMonitorInterval = null;
// { orionConvId, coderConvId, lastKnownState }
let _coderTaskMonitorMeta = null;

// ── Intent classifier ─────────────────────────────────────────────────────────
// Returns 'checkin' | 'steering' | 'conversational'
function classifySupervisorIntent(text) {
  const t = text.trim().toLowerCase();
  const checkinPatterns = [
    /\b(how'?s it going|how is it going|any updates?|what'?s happening|what is happening)\b/,
    /\b(status|progress|update|what'?s? (it|cody|the coder) (doing|working on|up to))\b/,
    /\b(check in|checking in|where are (we|you|things)|what have (you|we|they) done)\b/,
    /\b(what (all|did|has) it (do|done|finished|completed|changed))\b/,
    /\b(give me (an? )?update|what('?s| is) (going on|the status|happening))\b/,
    /\b(how far|how much|how many|almost done|are (you|we|it) done|finished yet)\b/,
    /^(how|what|where|any|is it|did it|has it).{0,80}\?$/,
  ];
  const steeringPatterns = [
    /\b(also|additionally|on top of that|in addition)\b/,
    /\b(instead|skip|ignore|don't|do not|forget about|drop|remove)\b/,
    /\b(focus on|prioritize|make sure|be sure|actually)\b/,
    /\b(change|add|include|don't include|avoid|use|don't use)\b/,
    /\b(while you'?re at it|while (it'?s|cody'?s) working)\b/,
  ];
  if (checkinPatterns.some(p => p.test(t))) return 'checkin';
  if (steeringPatterns.some(p => p.test(t))) return 'steering';
  // Short imperative sentences are usually steering
  if (t.length < 120 && /^(also|add|skip|use|make|don't|do|change|include|avoid|focus|prioritize)/.test(t)) return 'steering';
  // Everything else: conversational — Orion answers directly while coder runs
  return 'conversational';
}

// ── Build a human-readable status summary from Coder conversation data ────────
// Returns { text, rawActivity, tasks, doneTasks, pendingTasks } so callers can either
// show the text directly or hand rawActivity to an LLM for natural-language synthesis.
function buildCoderStatusSummary(coderConvId) {
  if (typeof window.getCoderConversationSummary !== 'function') return null;
  const data = window.getCoderConversationSummary(coderConvId);
  if (!data) return null;

  const lines = [];
  const { tasks, doneTasks, pendingTasks, recentActivity, subStatus } = data;

  // Task progress
  if (tasks.length > 0) {
    lines.push(`**Tasks:** ${doneTasks.length}/${tasks.length} done.`);
    const inProg = tasks.find(t => t.status === 'in-progress' || t.status === '/');
    if (inProg) lines.push(`Currently working on: _${inProg.title || inProg.text || 'a task'}_`);
    if (pendingTasks.length) lines.push(`Pending: ${pendingTasks.slice(0, 3).map(t => t.title || t.text || 'task').join(', ')}`);
  }

  // Most recent tool activity
  const toolCalls = recentActivity.filter(a => a.tool && a.tool !== '_thought').slice(-10);
  if (toolCalls.length > 0) {
    const toolSummary = toolCalls.map(tc => `${tc.tool}${tc.result ? ': ' + tc.result.slice(0, 80) : ''}`).join('\n');
    lines.push(`Recent tool calls:\n${toolSummary}`);
  }

  // Latest thought/text
  const lastThought = [...recentActivity].reverse().find(a => a.tool === '_thought');
  if (lastThought && lastThought.text) {
    lines.push(`Last update: "${lastThought.text.slice(0, 200).replace(/\s+/g, ' ')}${lastThought.text.length > 200 ? '…' : ''}"`);
  }

  if (subStatus) lines.push(`Currently: ${subStatus}`);

  return { text: lines.join('\n'), rawActivity: recentActivity, tasks, doneTasks, pendingTasks };
}

// ── Orion answers conversationally while Coder runs in the background ─────────
async function respondOrionConversationally(orionConv, prompt, model, options = {}) {
  const config = window.getAppConfig ? window.getAppConfig() : {};

  // Build context: recent conversation history (last 10 messages)
  const recentMsgs = (orionConv.messages || []).slice(-10).map(m => ({
    role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
    content: String(m.text || m.content || '').slice(0, 500)
  }));

  // Add coder context if a coder task is running
  let coderContext = '';
  const coderConvId = orionConv.launchedCoderConvId;
  if (coderConvId) {
    const summary = buildCoderStatusSummary(coderConvId);
    if (summary && summary.text) {
      coderContext = `\n\nCoder task status:\n${summary.text}`;
    }
  }

  const systemPrompt = `You are Orion, an AI supervisor. You are having a conversation with the user while a separate Coder agent works on a task in the background. Answer the user's question conversationally and helpfully. Do not tell the user to wait for the coder to finish — you can talk freely. Be concise and direct.${coderContext}`;

  if (typeof window.clearActiveAiBubble === 'function') window.clearActiveAiBubble();

  try {
    const replyText = await window.quickOrionLLMCall(systemPrompt, recentMsgs, config);
    if (!replyText) return;
    orionConv.messages.push({ role: 'assistant', text: replyText, source: 'supervisor-conversational', createdAt: Date.now() });
    orionConv.updatedAt = Date.now();
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
    if (activeConversationId === orionConv.id && typeof window.renderAiMessage === 'function') {
      window.renderAiMessage(replyText, [], orionConv.id);
    }
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
  } catch (err) {
    console.error('respondOrionConversationally error:', err);
    const fallback = "I'm juggling the coder task right now — ask me again in a moment and I'll have a better answer.";
    orionConv.messages.push({ role: 'assistant', text: fallback, source: 'supervisor-conversational-error', createdAt: Date.now() });
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    if (activeConversationId === orionConv.id && typeof window.renderAiMessage === 'function') {
      window.renderAiMessage(fallback, [], orionConv.id);
    }
  }
}

// ── Main supervisor message handler ──────────────────────────────────────────
// Called from submitMessage() when user types in Orion while Coder is running.
function handleSupervisorMessage(orionConv, prompt, model, options = {}) {
  const coderConvId = orionConv.launchedCoderConvId;
  const intent = classifySupervisorIntent(prompt);

  if (intent === 'checkin') {
    // If there's rich raw activity, let the LLM synthesize a natural-language status update.
    const summary = buildCoderStatusSummary(coderConvId);
    if (summary && summary.rawActivity && summary.rawActivity.length > 0 && window.quickOrionLLMCall) {
      respondOrionConversationally(orionConv, prompt, model, options);
      return;
    }

    const replyText = (summary && summary.text)
      ? `Here's what Coder is up to:\n\n${summary.text}`
      : 'Coder is still working — no detailed status available yet.';

    // Persist as an assistant message in the Orion conversation
    orionConv.messages.push({ role: 'assistant', text: replyText, source: 'supervisor-checkin', createdAt: Date.now() });
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    if (typeof window.renderAiMessage === 'function') {
      // Clear any lingering active bubble so this renders as a fresh new bubble
      if (typeof window.clearActiveAiBubble === 'function') window.clearActiveAiBubble();
      window.renderAiMessage(replyText, [], orionConv.id);
    }
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
    return;
  }

  if (intent === 'steering') {
    // Inject directly into the Coder's steering queue
    window.steeringQueue = window.steeringQueue || {};
    window.steeringQueue[coderConvId] = window.steeringQueue[coderConvId] || [];
    window.steeringQueue[coderConvId].push(prompt);
    appendSystemMessage(`Steering sent to Coder: "${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`, { conversationId: orionConv.id });
    return;
  }

  if (intent === 'conversational') {
    respondOrionConversationally(orionConv, prompt, model, options);
    return;
  }

  // Fallback — queue for after Coder finishes
  window.promptQueue = window.promptQueue || [];
  window.promptQueue.push({ prompt, modelSelectValue: model, conversationId: orionConv.id, alreadyRendered: true });
  persistAssistantStatusMessage(orionConv.id, 'Queued — Coder is busy. Orion will handle this when it finishes.', {
    source: 'queue-status',
    dedupeKey: `supervisor-queued-${orionConv.id}-${Date.now()}`
  });
}

// ── Coder task state monitor ──────────────────────────────────────────────────
// Polls the Coder conversation every 2s to detect state changes.
window.startCoderTaskMonitor = function(orionConvId, coderConvId) {
  // Clear any existing monitor
  if (_coderTaskMonitorInterval) {
    clearInterval(_coderTaskMonitorInterval);
    _coderTaskMonitorInterval = null;
  }

  _coderTaskMonitorMeta = {
    orionConvId,
    coderConvId,
    lastAwaitingClarification: false,
    lastAwaitingPlanApproval: false,
    lastRunning: true,        // Coder just started, so it's running
    startTime: Date.now(),
    notifiedClarification: false,
    quietSince: 0,
  };

  _coderTaskMonitorInterval = setInterval(() => {
    if (!_coderTaskMonitorMeta) return;
    const { orionConvId, coderConvId } = _coderTaskMonitorMeta;

    const orionConv = conversations.find(c => c.id === orionConvId);
    const coderConv = conversations.find(c => c.id === coderConvId);
    if (!orionConv || !coderConv) {
      stopCoderTaskMonitor();
      return;
    }

    const isCoderRunning = !!(window.isAgentRunning && window.isAgentRunning()
      && window.getRunningConversationId && window.getRunningConversationId() === coderConvId);
    const nowAwaitingClarification = !!(coderConv.awaitingClarification) && !isCoderRunning;
    const nowAwaitingPlan = !!(coderConv.awaitingPlanApproval && !coderConv.planApproved) && !isCoderRunning;
    const elapsed = Math.round((Date.now() - _coderTaskMonitorMeta.startTime) / 1000);

    // Stall escalation: not running, nothing queued, not waiting on the user, and no completion
    // receipt ever arrived — the run ended without the completion hook (crash, killed process,
    // queued-but-never-started). Without this, the monitor polled forever showing "Working…" and
    // nobody was told; the user discovered the stuck task by accident much later.
    const isQueuedForCoder = Array.isArray(window.promptQueue)
      && window.promptQueue.some(item => item && item.conversationId === coderConvId);
    const isQuiet = !isCoderRunning && !isQueuedForCoder && !nowAwaitingClarification && !nowAwaitingPlan;
    if (isQuiet) {
      if (!_coderTaskMonitorMeta.quietSince) _coderTaskMonitorMeta.quietSince = Date.now();
      if (Date.now() - _coderTaskMonitorMeta.quietSince > 60000) {
        const stalledTitle = orionConv.launchedCoderTaskTitle || coderConv.title || 'Coder task';
        const pendingCount = (coderConv.tasks || []).filter(t => t.status !== 'completed' && t.status !== 'x').length;
        notifyOrionConversation(orionConv, `Coder went quiet on **${stalledTitle}** — the run ended without recording completion (it may have crashed or stalled). The work is parked under Active work; use its Continue action or open the Coder conversation to inspect it.`, 'supervisor-stall');
        orionConv.lastDelegatedWork = {
          coderConversationId: coderConvId,
          title: stalledTitle,
          projectPath: coderConv.projectPath || inferDispatchProjectPath(orionConv),
          status: 'blocked',
          subStatus: 'Went quiet without completing',
          startedAt: orionConv.launchedCoderTaskStart || 0,
          completedAt: Date.now(),
          pendingCount
        };
        orionConv.launchedCoderConvId = null;
        orionConv.launchedCoderTaskTitle = null;
        orionConv.launchedCoderTaskStart = null;
        if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
        if (window.saveConversationsToStorage) window.saveConversationsToStorage();
        renderDesktopDispatchLanding();
        stopCoderTaskMonitor();
        return;
      }
    } else {
      _coderTaskMonitorMeta.quietSince = 0;
    }

    // Update the status card if active Orion conv is watching
    if (isCoderRunning && activeConversationId === orionConvId) {
      const subStatus = window.getAgentSubStatus ? window.getAgentSubStatus() : '';
      const lastAssistant = [...(coderConv.messages || [])].reverse().find(m =>
        (m.role === 'assistant' || m.role === 'model') && String(m.text || '').trim() && String(m.text || '').trim() !== 'Thinking...');
      const preview = lastAssistant ? String(lastAssistant.text).replace(/\s+/g, ' ').trim().slice(0, 110) : '';
      showCoderStatusCard(coderConv.title || 'Coder Task', subStatus, elapsed, preview);
    }

    // Detect: Coder needs clarification → proxy it into Orion
    if (nowAwaitingClarification && !_coderTaskMonitorMeta.notifiedClarification) {
      _coderTaskMonitorMeta.notifiedClarification = true;
      renderCoderClarificationProxy(orionConv, coderConv.awaitingClarification, coderConvId);
      showCoderStatusCard(coderConv.title || 'Coder Task', 'Waiting for your input…', elapsed);
    }
    // Reset flag if coder cleared its clarification
    if (!coderConv.awaitingClarification) {
      _coderTaskMonitorMeta.notifiedClarification = false;
    }

    // Detect: Coder is awaiting plan approval → notify Orion
    if (nowAwaitingPlan && !_coderTaskMonitorMeta.lastAwaitingPlanApproval) {
      _coderTaskMonitorMeta.lastAwaitingPlanApproval = true;
      notifyOrionConversation(orionConv, `Coder has written an implementation plan and is waiting for your approval. Switch to the Coder conversation to review it.`, 'supervisor-plan');
    }
    if (!nowAwaitingPlan) _coderTaskMonitorMeta.lastAwaitingPlanApproval = false;

    _coderTaskMonitorMeta.lastRunning = isCoderRunning;
  }, 2000);
};

function stopCoderTaskMonitor() {
  if (_coderTaskMonitorInterval) {
    clearInterval(_coderTaskMonitorInterval);
    _coderTaskMonitorInterval = null;
  }
  _coderTaskMonitorMeta = null;
  hideCoderStatusCard();
}
window.stopCoderTaskMonitor = stopCoderTaskMonitor;

// ── Supervisor completion notification ────────────────────────────────────────
function notifySupervisorOfCoderCompletion(finishedCoderConvId) {
  if (!finishedCoderConvId) return;
  const orionConv = conversations.find(c => c.launchedCoderConvId === finishedCoderConvId);
  if (!orionConv) return;

  // Stop the monitor now that the task finished
  if (_coderTaskMonitorMeta && _coderTaskMonitorMeta.coderConvId === finishedCoderConvId) {
    stopCoderTaskMonitor();
  }

  const coderConv = conversations.find(c => c.id === finishedCoderConvId);
  const taskTitle = orionConv.launchedCoderTaskTitle || (coderConv && coderConv.title) || 'Coder Task';
  const tasks = (coderConv && coderConv.tasks) || [];
  const doneTasks = tasks.filter(t => t.status === 'completed' || t.status === 'x');
  const pendingTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'x');
  const elapsed = orionConv.launchedCoderTaskStart
    ? Math.round((Date.now() - orionConv.launchedCoderTaskStart) / 60000)
    : null;

  // Determine outcome
  const blockedFlag = coderConv && Array.isArray(coderConv.messages)
    && coderConv.messages.slice(-3).some(m => /blocked|cannot|error|failed/i.test(m.text || ''));

  let summaryText;
  if (pendingTasks.length > 0 && doneTasks.length === 0) {
    summaryText = `Coder stopped on **${taskTitle}** — ${pendingTasks.length} task${pendingTasks.length > 1 ? 's' : ''} still pending. It may have hit a blocker. Check the Coder conversation for details.`;
  } else if (pendingTasks.length > 0) {
    summaryText = `Coder finished part of **${taskTitle}** — ${doneTasks.length} done, ${pendingTasks.length} remaining. You can queue a continuation or check the Coder conversation.`;
  } else {
    const elapsed_str = elapsed ? ` (${elapsed}m)` : '';
    summaryText = `Coder finished **${taskTitle}**${elapsed_str}. ${doneTasks.length > 0 ? `${doneTasks.length} task${doneTasks.length > 1 ? 's' : ''} completed.` : ''} Ready for your next direction.`;
  }

  notifyOrionConversation(orionConv, summaryText, 'supervisor-completion');

  orionConv.lastDelegatedWork = {
    coderConversationId: finishedCoderConvId,
    title: taskTitle,
    projectPath: (coderConv && coderConv.projectPath) || inferDispatchProjectPath(orionConv),
    status: blockedFlag || pendingTasks.length > 0 ? 'blocked' : 'completed',
    subStatus: blockedFlag
      ? 'Stopped with a blocker'
      : (pendingTasks.length > 0 ? `${doneTasks.length} complete, ${pendingTasks.length} remaining` : 'Completed'),
    startedAt: orionConv.launchedCoderTaskStart || 0,
    completedAt: Date.now(),
    pendingCount: pendingTasks.length
  };

  // Clear the launched coder conv reference so we don't double-notify
  orionConv.launchedCoderConvId = null;
  orionConv.launchedCoderTaskTitle = null;
  orionConv.launchedCoderTaskStart = null;
  orionConv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();
}

// Appends a message to an Orion conversation, rendering it if active.
function notifyOrionConversation(orionConv, text, source) {
  if (!orionConv || !text) return;
  orionConv.messages.push({ role: 'assistant', text, source, createdAt: Date.now() });
  orionConv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();
  if (activeConversationId === orionConv.id && typeof window.renderAiMessage === 'function') {
    window.clearActiveAiBubble();
    window.renderAiMessage(text, [], orionConv.id);
  }
}

// ── Clarification proxy ────────────────────────────────────────────────────────
// Renders the Coder's clarification question in the Orion conversation so the
// user can answer without switching to the Coder tab.
function renderCoderClarificationProxy(orionConv, clarData, coderConvId) {
  if (!orionConv || !clarData) return;

  // Tag the clarification data so submitClarificationAnswers knows to relay it
  const proxyClarData = { ...clarData, _relayToConvId: coderConvId };

  // Set the clarification on the Orion conversation so the bubble renders it
  orionConv.awaitingClarification = proxyClarData;

  const introText = `Coder needs your input before continuing:\n\n${clarData.intro || ''}`;
  // Mark this message as a clarification card
  orionConv.messages.push({
    role: 'assistant',
    text: introText,
    source: 'supervisor-clarification',
    isClarificationCard: true,
    createdAt: Date.now()
  });
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();

  // Render it in the active chat if we're looking at this Orion conversation
  if (activeConversationId === orionConv.id) {
    if (typeof window.clearActiveAiBubble === 'function') window.clearActiveAiBubble();
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const clarHtml = buildClarificationCardHtml(proxyClarData);
    bubble.innerHTML = `
      <div class="message-header ai">
        <span>✦ Orion AI</span>
      </div>
      <div class="message-body">
        <p>${escapeHtml(introText)}</p>
        ${clarHtml}
      </div>
    `;
    const container = document.getElementById('messages-container');
    if (container) {
      container.style.display = 'flex';
      container.appendChild(bubble);
    }
    // Wire clarification UI interactions
    bubble.querySelectorAll('.clarification-option, .clarification-other-row').forEach(row => {
      row.addEventListener('click', () => {
        const radio = row.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        const block = row.closest('.clarification-question-block');
        if (block) block.querySelectorAll('.clarification-option, .clarification-other-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      });
    });
    bubble.querySelectorAll('.clarification-other-input').forEach(input => {
      input.addEventListener('focus', () => {
        const row = input.closest('.clarification-other-row');
        if (row) {
          const radio = row.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;
          const block = row.closest('.clarification-question-block');
          if (block) block.querySelectorAll('.clarification-option, .clarification-other-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
        }
      });
    });
    const clarSubmitBtn = bubble.querySelector('.btn-clarification-submit');
    if (clarSubmitBtn) {
      clarSubmitBtn.addEventListener('click', () => submitClarificationAnswers({
        button: clarSubmitBtn,
        bubble,
        targetConversationId: orionConv.id
      }));
    }
    scrollChatToBottom();
    showToast('Coder is waiting for your input.', 'default');
  }
}


// ── Status card ───────────────────────────────────────────────────────────────
function showCoderStatusCard(taskTitle, subStatus, elapsedSec, preview = '') {
  const card = document.getElementById('coder-task-status-card');
  if (!card) return;
  const titleEl = card.querySelector('.coder-status-task-name');
  const subEl = card.querySelector('.coder-status-substatus');
  const elapsedEl = card.querySelector('.coder-status-elapsed');
  const previewEl = card.querySelector('.coder-status-preview');
  if (titleEl) titleEl.textContent = taskTitle || 'Coder Task';
  if (subEl) subEl.textContent = subStatus || 'Working…';
  if (elapsedEl) {
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    elapsedEl.textContent = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
  }
  // Quick peek at what Coder is actually doing, so following along doesn't require a tab switch.
  if (previewEl) {
    previewEl.textContent = preview || '';
    previewEl.style.display = preview ? '' : 'none';
  }
  card.classList.add('visible');
}

function hideCoderStatusCard() {
  const card = document.getElementById('coder-task-status-card');
  if (card) card.classList.remove('visible');
}
