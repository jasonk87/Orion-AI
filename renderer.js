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
  reasoningEffort: 'auto',
  modelSelectionRevision: 0,
  reasoningSelectionRevision: 0,
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
let desktopPromptSubmissionInFlight = false;
const promptSubmissionRegistry = window.OrionPromptSubmission
  ? new window.OrionPromptSubmission.SubmissionRegistry({ ttlMs: 30000 })
  : null;
let currentWorkspaceTestCommand = null; // { command, autoDetected, updatedAt } | null — per-workspace override
let cachedUserDataPath = '';
let activeConversationId = null;
let conversationSelectionEpoch = 0;
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
let appMode = 'orion'; // 'orion' | 'coder' | 'operator'
// Item 9 (UI polish): a plain client-side title filter per sidebar tab. Kept as one small object
// rather than three separate variables so renderConversationList can look a mode up generically.
let conversationSearchQueries = { orion: '', coder: '', operator: '' };
let lastDispatchConversationId = '';
let dispatchDraft = {
  active: true,
  projectPath: '',
  contextSummary: ''
};
const RendererTaskOrchestration = window.OrionTaskOrchestration;
const RendererWorkspaceResolution = window.OrionWorkspaceResolution;
const RendererOrchestrationContracts = window.OrionOrchestrationContracts;
const RendererSupervisorOrchestration = window.OrionSupervisorOrchestration;
const RendererSemanticIntentRouter = window.OrionSemanticIntentRouter;
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
  conversationListOperator: document.getElementById('conversation-list-operator'),
  btnAddConversationOperator: document.getElementById('btn-add-conversation-operator'),
  btnNewConversationOperator: document.getElementById('btn-new-conversation-operator'),
  conversationSearchOrion: document.getElementById('conversation-search-orion'),
  conversationSearchCoder: document.getElementById('conversation-search-coder'),
  conversationSearchOperator: document.getElementById('conversation-search-operator'),
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
  reasoningSelect: document.getElementById('reasoning-select'),
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
  fileViewerImageViewport: document.getElementById('file-viewer-image-viewport'),
  fileViewerImage: document.getElementById('file-viewer-image'),
  fileViewerImageMeta: document.getElementById('file-viewer-image-meta'),
  fileViewerZoomLabel: document.getElementById('file-viewer-zoom-label'),
  btnFileViewerZoomOut: document.getElementById('btn-file-viewer-zoom-out'),
  btnFileViewerZoomReset: document.getElementById('btn-file-viewer-zoom-reset'),
  btnFileViewerZoomIn: document.getElementById('btn-file-viewer-zoom-in'),
  btnFileViewerClose: document.getElementById('btn-file-viewer-close'),
  btnFileViewerMention: document.getElementById('btn-file-viewer-mention')
};

let viewedFilePath = '';
let fileViewerImageZoom = 1;
let fileViewerImageFitWidth = 0;
let fileViewerImageFitHeight = 0;
let agentPresenceTimer = null;
let agentCompletionTimer = null;

// INITIALIZE APP
// Boot used to be one unguarded sequence, and `await loadSettings()` was its second
// statement. When that threw — window.api missing because the preload bridge did not load,
// a malformed config on disk — the rejection skipped EVERY remaining step: workspace
// handlers, chat wiring, the update checker, image attach, every button binding. The window
// still rendered, so it looked like a hang rather than a failure.
//
// Each step is now independent. A step that fails is reported through the same banner and
// crash log as any other fault, and the rest of the UI still wires up.
async function runInitStep(label, step) {
  try {
    await step();
    return true;
  } catch (error) {
    const detail = (error && (error.stack || error.message)) || String(error);
    if (typeof window.__orionReportFault === 'function') {
      window.__orionReportFault(`init:${label}`, `Orion could not finish starting up (${label})`, detail);
    } else {
      console.error(`[orion:init:${label}]`, detail);
    }
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // window.api is the renderer's only route to the main process. Without it every step
  // below fails the same way, so say that once and plainly instead of emitting a dozen
  // identical "Cannot read properties of undefined" traces.
  if (!window.api && typeof window.__orionReportFault === 'function') {
    window.__orionReportFault(
      'preload-bridge-missing',
      'Orion cannot reach its main process',
      'window.api is unavailable, so settings, workspaces, and chat cannot start. This means ' +
      'preload.js did not load. Restart Orion; your conversations on disk are unaffected.'
    );
  }

  await runInitStep('window-controls', setupWindowControls);
  await runInitStep('settings', loadSettings);
  await runInitStep('runtime-info', refreshAppRuntimeInfo);
  try { cachedUserDataPath = await window.api.getUserDataPath(); } catch (_) {}
  await runInitStep('settings-modal', setupSettingsModal);
  await runInitStep('file-viewer', setupFileViewerModal);
  await runInitStep('operational-context', setupOperationalContextEditor);
  await runInitStep('workspace-handlers', setupWorkspaceHandlers);
  await runInitStep('start-actions', setupStartActions);
  await runInitStep('entrypoint-controls', setupEntrypointControls);
  await runInitStep('progressive-disclosure', setupProgressiveDisclosure);
  await runInitStep('right-sidebar', setupRightSidebarToggle);
  await runInitStep('chat-handlers', setupChatHandlers);
  await runInitStep('update-checker', initUpdateChecker);
  await runInitStep('image-attach', initImageAttach);

  // The inline bindings below were the one part of boot still running unguarded. A throw here
  // produced an unhandled rejection that killed the rest of startup silently — the same class
  // of failure the runInitStep wrapping above was added to stop. Wrapped as one step because
  // these are all button bindings: if the markup is intact they all succeed, and if it is not,
  // the fault is reported once with the real cause.
  await runInitStep('inline-bindings', () => bindInlineControls());
});

async function bindInlineControls() {
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
}

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
    `<div class="img-preview-thumb" data-idx="${i}">`
    `<img src="${img.previewUrl}" alt="${escapeHtml(img.name || 'image')}" title="${escapeHtml(img.name || 'image')}">`
    `<button class="img-preview-remove" data-idx="${i}" title="Remove image" aria-label="Remove image">&times;</button>`
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
  // Independent of the model dropdown: the reasoning picker must restore even when the model
  // select is missing, otherwise a saved Ultra silently reverts to Auto.
  restoreReasoningEffortSelection();
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

// The reasoning picker next to the input box. 'auto' is the default and means the phase
// engine keeps deciding per step; any explicit level is forced for every answer until the
// user changes it back. Sticky on purpose — same behavior as the model select beside it.
function restoreReasoningEffortSelection() {
  if (!el.reasoningSelect) return;
  const normalize = window.OrionReasoningPolicy
    ? window.OrionReasoningPolicy.normalizeEffortOverride
    : value => value || 'auto';
  const saved = normalize(localStorage.getItem('ag2_reasoning_effort') || appConfig.reasoningEffort || 'auto');
  el.reasoningSelect.value = saved;
  if (!el.reasoningSelect.value) el.reasoningSelect.value = 'auto';
  appConfig.reasoningEffort = el.reasoningSelect.value;
  el.reasoningSelect.classList.toggle('reasoning-forced', el.reasoningSelect.value !== 'auto');
}

function getSelectionRevisions() {
  return {
    model: Math.max(0, Number(appConfig.modelSelectionRevision) || 0),
    reasoning: Math.max(0, Number(appConfig.reasoningSelectionRevision) || 0)
  };
}

function bumpSelectionRevision(field) {
  const configKey = field === 'model' ? 'modelSelectionRevision' : 'reasoningSelectionRevision';
  const next = Math.max(Date.now(), (Number(appConfig[configKey]) || 0) + 1);
  appConfig[configKey] = next;
  return next;
}

async function persistSelectionConfig() {
  const result = await window.api.writeConfig(appConfig);
  if (result === false || (result && result.success === false)) {
    throw new Error('Orion could not persist the selection to config.');
  }
}

window.setReasoningEffortSelection = async (value) => {
  const normalize = window.OrionReasoningPolicy
    ? window.OrionReasoningPolicy.normalizeEffortOverride
    : v => v || 'auto';
  const level = normalize(value);
  const previousLevel = appConfig.reasoningEffort || 'auto';
  const previousRevision = Number(appConfig.reasoningSelectionRevision) || 0;
  const previousStored = localStorage.getItem('ag2_reasoning_effort');
  if (level === previousLevel) {
    return { success: true, reasoning: level, selectionRevisions: getSelectionRevisions() };
  }
  appConfig.reasoningEffort = level;
  bumpSelectionRevision('reasoning');
  if (el.reasoningSelect) {
    el.reasoningSelect.value = level;
    el.reasoningSelect.classList.toggle('reasoning-forced', level !== 'auto');
  }
  localStorage.setItem('ag2_reasoning_effort', level);
  try {
    await persistSelectionConfig();
    return { success: true, reasoning: level, selectionRevisions: getSelectionRevisions() };
  } catch (error) {
    appConfig.reasoningEffort = previousLevel;
    appConfig.reasoningSelectionRevision = previousRevision;
    if (el.reasoningSelect) {
      el.reasoningSelect.value = previousLevel;
      el.reasoningSelect.classList.toggle('reasoning-forced', previousLevel !== 'auto');
    }
    if (previousStored == null) localStorage.removeItem('ag2_reasoning_effort');
    else localStorage.setItem('ag2_reasoning_effort', previousStored);
    return { success: false, error: error.message || String(error), reasoning: previousLevel, selectionRevisions: getSelectionRevisions() };
  }
};

async function setModelPreferenceSelection(modelValue) {
  if (!el.modelSelect) return { success: false, error: 'Model selector not available on desktop' };
  const option = Array.from(el.modelSelect.options).find(item => item.value === modelValue);
  if (!option) return { success: false, error: `Unknown model: ${modelValue}` };
  const previousModel = appConfig.defaultModel || el.modelSelect.value;
  const previousRevision = Number(appConfig.modelSelectionRevision) || 0;
  const previousStored = localStorage.getItem('ag2_default_model');
  if (modelValue === previousModel) {
    el.modelSelect.value = modelValue;
    return { success: true, model: modelValue, selectionRevisions: getSelectionRevisions() };
  }
  el.modelSelect.value = modelValue;
  appConfig.defaultModel = modelValue;
  bumpSelectionRevision('model');
  localStorage.setItem('ag2_default_model', modelValue);
  try {
    await persistSelectionConfig();
    return { success: true, model: modelValue, selectionRevisions: getSelectionRevisions() };
  } catch (error) {
    appConfig.defaultModel = previousModel;
    appConfig.modelSelectionRevision = previousRevision;
    el.modelSelect.value = previousModel;
    if (previousStored == null) localStorage.removeItem('ag2_default_model');
    else localStorage.setItem('ag2_default_model', previousStored);
    return { success: false, error: error.message || String(error), model: previousModel, selectionRevisions: getSelectionRevisions() };
  }
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
    // Preserve the stored value when the control is absent. The settings modal no longer renders
    // an auto-test checkbox, and falling back to `true` meant every settings save silently
    // re-enabled auto-test — a setting agent.js still acts on in five places, that the user has
    // no way to turn off. Missing UI must not overwrite configuration.
    appConfig.autoTest = el.settingAutoTest ? el.settingAutoTest.checked : appConfig.autoTest;
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

  // list-files answers with an array on success but { error } on failure, so an unreadable or
  // mid-mutation workspace used to reach buildFileTree as a non-array and throw
  // "files.forEach is not a function" out of an unhandled promise. Surface the failure in the
  // panel instead, and leave the last good tree data alone rather than half-clearing it.
  const listed = await window.api.listFiles(currentWorkspace);
  if (!Array.isArray(listed)) {
    const reason = listed && listed.error ? String(listed.error) : 'The directory could not be read.';
    el.fileCountBadge.textContent = '—';
    el.fileTree.innerHTML = `<p class="empty-state">Could not list files: ${escapeHtml(reason)}</p>`;
    loadRunArtifacts();
    return;
  }
  const files = listed;
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
  // Invalidate any stub hydration that began for the mode the user just left. Without this
  // token, its awaited disk read can finish later and repaint the old conversation over the
  // newly selected Dispatch/Coder view.
  if (mode !== appMode) conversationSelectionEpoch += 1;
  appMode = mode;
  document.body.setAttribute('data-mode', mode);

  const orionBtn = document.getElementById('btn-mode-orion');
  const coderBtn = document.getElementById('btn-mode-coder');
  const operatorBtn = document.getElementById('btn-mode-operator');
  const orionContent = document.getElementById('sidebar-orion-content');
  const coderContent = document.getElementById('sidebar-coder-content');
  const operatorContent = document.getElementById('sidebar-operator-content');
  if (orionBtn) orionBtn.classList.toggle('active', mode === 'orion');
  if (coderBtn) coderBtn.classList.toggle('active', mode === 'coder');
  if (operatorBtn) operatorBtn.classList.toggle('active', mode === 'operator');
  if (orionContent) orionContent.classList.toggle('active', mode === 'orion');
  if (coderContent) coderContent.classList.toggle('active', mode === 'coder');
  if (operatorContent) operatorContent.classList.toggle('active', mode === 'operator');

  // Dispatch preserves its current in-session focus, including an uncommitted draft, but never
  // chooses an old transcript merely because the user opened the mode. Coder and Operator each
  // keep their own task-oriented selection behavior, scoped to their own mode — this used to be
  // a blanket "anything that isn't orion is coder" check, which meant selecting an Operator
  // conversation immediately bounced the view to a Coder one because setAppMode had never heard
  // of a third mode. Item 10 of the Operator architecture plan.
  const activeConv = conversations.find(c => c.id === activeConversationId);
  if (mode === 'orion') {
    if (activeConv && conversationMode(activeConv) === 'orion') {
      lastDispatchConversationId = activeConv.id;
      dispatchDraft.active = false;
    } else if (dispatchDraft.active) {
      startDispatchDraft(dispatchDraft);
    } else {
      const remembered = conversations.find(c => c.id === lastDispatchConversationId && conversationMode(c) === 'orion');
      if (remembered) selectConversation(remembered.id, { selectionEpoch: conversationSelectionEpoch });
      else startDispatchDraft();
    }
  } else if (!activeConv || conversationMode(activeConv) !== mode) {
    const replacement = conversations.find(c => conversationMode(c) === mode);
    if (replacement) selectConversation(replacement.id, { selectionEpoch: conversationSelectionEpoch });
    else createNewConversation(mode);
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
    if (chatInput) {
      chatInput.placeholder = mode === 'operator'
        ? 'Ask Operator to click, type, or navigate…'
        : 'Ask Orion to build, fix, or investigate…';
    }
    if (orionSplash) orionSplash.style.display = 'none';
    // Restore the shared splash if no messages
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

// Phase 2 of the Operator architecture plan: display name per specialist role, keyed by the same
// target.mode value task-orchestration.js already stores on every task. 'coder' and 'operator' are
// the two real specialists; describeSupervisedTaskPresentation's roleLabel option defaults to
// 'Coder' on its own, so an unregistered/missing role still renders exactly as before this
// registry existed.
const AGENT_ROLE_DISPLAY_NAMES = {
  coder: 'Coder',
  operator: 'Operator'
};

function supervisedTaskContext(task, isGlobalRunning = false, globalRunningId = '') {
  const taskId = String(task && task.taskId || '');
  const originConversationId = String(task && task.origin && task.origin.conversationId || '');
  const targetConversationId = String(task && task.target && task.target.conversationId || '');
  const targetRole = String(task && task.target && task.target.mode || '').toLowerCase();
  const roleLabel = AGENT_ROLE_DISPLAY_NAMES[targetRole] || undefined;
  const originConversation = conversations.find(conversation => conversation.id === originConversationId);
  const targetConversation = conversations.find(conversation => conversation.id === targetConversationId);
  const activeRunTaskId = window.getActiveRunTaskId ? String(window.getActiveRunTaskId() || '') : '';
  const live = !!(
    isGlobalRunning
    && globalRunningId === targetConversationId
    && (!activeRunTaskId || activeRunTaskId === taskId)
  );
  const awaitingReview = !!(
    (originConversation
      && originConversation.awaitingDelegatedPlan
      && String(originConversation.awaitingDelegatedPlan.taskId || '') === taskId)
    || (targetConversation
      && targetConversation.awaitingPlanApproval
      && !targetConversation.planApproved
      && (!targetConversation.awaitingPlanApprovalTaskId
        || String(targetConversation.awaitingPlanApprovalTaskId) === taskId))
  );
  const revisingPlan = !!(
    (originConversation
      && originConversation.revisingDelegatedPlan
      && String(originConversation.revisingDelegatedPlan.taskId || '') === taskId)
    || (targetConversation
      && targetConversation.planRevisionInProgress
      && String(targetConversation.planRevisionInProgress.taskId || '') === taskId)
  );
  return {
    originConversation,
    targetConversation,
    originConversationId,
    targetConversationId,
    roleLabel,
    awaitingReview,
    revisingPlan,
    planApproved: !!(targetConversation && targetConversation.planApproved),
    executionMode: live && window.getAgentExecutionMode ? window.getAgentExecutionMode() : '',
    subStatus: live && window.getAgentSubStatus ? window.getAgentSubStatus() : '',
    live
  };
}

function getSupervisedTaskForConversation(conversationId, activeTaskId = '') {
  if (!RendererTaskOrchestration || typeof RendererTaskOrchestration.selectSupervisedTask !== 'function') return null;
  return RendererTaskOrchestration.selectSupervisedTask(
    [...orchestrationTaskCache.values()],
    conversationId,
    activeTaskId,
    { delegatedOnly: true }
  );
}

function getSupervisedTaskPresentation(task, isGlobalRunning = false, globalRunningId = '') {
  if (!task || !RendererTaskOrchestration
      || typeof RendererTaskOrchestration.describeSupervisedTaskPresentation !== 'function') return null;
  const context = supervisedTaskContext(task, isGlobalRunning, globalRunningId);
  return {
    ...RendererTaskOrchestration.describeSupervisedTaskPresentation(task, context),
    ...context
  };
}

function collectDispatchActiveWork(isGlobalRunning = false, globalRunningId = '') {
  const activeWork = [];
  conversations.filter(conversation => conversationMode(conversation) === 'orion').forEach(dispatchConversation => {
    const preferredTaskId = dispatchConversation.launchedCoderTaskId || dispatchConversation.lastOwnedTaskId || '';
    const durableTask = getSupervisedTaskForConversation(dispatchConversation.id, preferredTaskId);
    const coderId = String(
      (durableTask && durableTask.target && durableTask.target.conversationId)
      || dispatchConversation.launchedCoderConvId
      || ''
    );
    const coderConversation = coderId ? conversations.find(conversation => conversation.id === coderId) : null;
    if (durableTask || coderConversation) {
      const taskId = String((durableTask && durableTask.taskId) || preferredTaskId);
      const running = isGlobalRunning && !!coderId && globalRunningId === coderId;
      const queued = Array.isArray(window.promptQueue)
        && window.promptQueue.some(item => item && (item.taskId === taskId || item.conversationId === coderId));
      const waitingForInput = !!(coderConversation && coderConversation.awaitingClarification);
      const waitingForReview = !!(coderConversation && coderConversation.awaitingPlanApproval && !coderConversation.planApproved);
      const status = durableTask
        ? durableTask.status
        : (running ? 'active' : ((queued || waitingForInput || waitingForReview) ? 'pending' : 'failed'));
      const presentation = durableTask
        ? getSupervisedTaskPresentation(durableTask, isGlobalRunning, globalRunningId)
        : null;
      const subStatus = presentation
        ? presentation.label
        : (running && window.getAgentSubStatus
          ? window.getAgentSubStatus()
          : (queued
            ? 'Queued for Coder'
            : (waitingForInput
              ? 'Waiting for your input'
              : (waitingForReview ? 'Plan ready for review' : 'Needs attention'))));
      const projectPath = (durableTask && durableTask.workspacePath)
        || (coderConversation && coderConversation.projectPath)
        || inferDispatchProjectPath(dispatchConversation);
      activeWork.push({
        id: coderId,
        taskId,
        supervisingConversationId: dispatchConversation.id,
        title: (durableTask && durableTask.title) || dispatchConversation.launchedCoderTaskTitle || (coderConversation && coderConversation.title) || 'Coder task',
        projectPath,
        projectName: (projectPath || 'Standalone').replace(/[\\\/]+$/, '').split(/[\\\/]/).pop(),
        status,
        subStatus,
        startedAt: (durableTask && durableTask.startedAt) || dispatchConversation.launchedCoderTaskStart || (coderConversation && coderConversation.createdAt) || 0,
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
  if (!syncDispatchCoderStatusCard(activeConversationId, globallyRunning, runningConversationId)) {
    hideCoderStatusCard();
  }
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
  const delegatedReceipt = orionConv.lastDelegatedWork || {};
  const taskTitle = delegatedReceipt.title || coderConv.title || 'Continue Coder task';
  const resumableTaskId = String(delegatedReceipt.taskId || '');
  let resumableTask = resumableTaskId ? orchestrationTaskCache.get(resumableTaskId) : null;
  if (resumableTaskId && (!resumableTask || resumableTask.status !== 'pending')
      && typeof window.getOrchestrationTaskStatus === 'function') {
    const read = await window.getOrchestrationTaskStatus(resumableTaskId, orionConv.id);
    resumableTask = read && read.success ? read.task : null;
  }
  if (resumableTaskId && !resumableTask) {
    showToast('Orion could not verify the existing task state, so it did not create a duplicate continuation.', 'attention');
    return;
  }
  const queued = resumableTask && resumableTask.status === 'pending'
    ? await queueTaskContinuation({
        taskId: resumableTaskId,
        prompt,
        modelSelectValue: modelValue,
        originConversationId: orionConv.id,
        originMessageId: messageId,
        targetConversationId: coderConv.id,
        workspace: structuredWorkspaceForConversation(coderConv),
        source: 'dispatch-continue',
        requireExistingTask: true
      })
    : await enqueueOrchestrationTask({
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
    window.runAgentLoop(queued.queueItem.prompt, queued.queueItem.modelSelectValue || modelValue, coderConv, {
      source: 'queue',
      taskId: queued.task.taskId,
      reasoningEffort: queued.queueItem.reasoningEffort,
      executionProfile: queued.queueItem.executionProfile
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
  document.getElementById('btn-mode-operator')?.addEventListener('click', () => setAppMode('operator'));
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
      const focusResult = await window.beginNewFocus(activeConversationId);
      if (!focusResult || focusResult.success === false) {
        showToast('Could not cancel the pending work. The current focus was preserved.', 'error');
        return;
      }
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
  if (el.btnFileViewerZoomOut) el.btnFileViewerZoomOut.addEventListener('click', () => setFileViewerImageZoom(fileViewerImageZoom / 1.25));
  if (el.btnFileViewerZoomReset) el.btnFileViewerZoomReset.addEventListener('click', () => setFileViewerImageZoom(1));
  if (el.btnFileViewerZoomIn) el.btnFileViewerZoomIn.addEventListener('click', () => setFileViewerImageZoom(fileViewerImageZoom * 1.25));
  if (el.fileViewerImage) {
    el.fileViewerImage.addEventListener('load', fitFileViewerImage);
    el.fileViewerImage.addEventListener('dblclick', () => setFileViewerImageZoom(fileViewerImageZoom > 1 ? 1 : 2));
  }
  if (el.fileViewerImageViewport) {
    el.fileViewerImageViewport.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setFileViewerImageZoom(fileViewerImageZoom * (event.deltaY < 0 ? 1.15 : (1 / 1.15)));
    }, { passive: false });
  }
}

function fitFileViewerImage() {
  if (!el.fileViewerImage || !el.fileViewerImageViewport || !el.fileViewerImage.naturalWidth) return;
  const viewportWidth = Math.max(1, el.fileViewerImageViewport.clientWidth - 2);
  const viewportHeight = Math.max(1, el.fileViewerImageViewport.clientHeight - 2);
  const fitScale = Math.min(
    1,
    viewportWidth / el.fileViewerImage.naturalWidth,
    viewportHeight / el.fileViewerImage.naturalHeight
  );
  fileViewerImageFitWidth = Math.max(1, Math.round(el.fileViewerImage.naturalWidth * fitScale));
  fileViewerImageFitHeight = Math.max(1, Math.round(el.fileViewerImage.naturalHeight * fitScale));
  setFileViewerImageZoom(1);
}

function setFileViewerImageZoom(value) {
  fileViewerImageZoom = Math.min(8, Math.max(0.25, Number(value) || 1));
  if (el.fileViewerImage && fileViewerImageFitWidth && fileViewerImageFitHeight) {
    el.fileViewerImage.style.width = `${Math.round(fileViewerImageFitWidth * fileViewerImageZoom)}px`;
    el.fileViewerImage.style.height = `${Math.round(fileViewerImageFitHeight * fileViewerImageZoom)}px`;
    el.fileViewerImage.style.cursor = fileViewerImageZoom > 1 ? 'zoom-out' : 'zoom-in';
  }
  if (el.fileViewerZoomLabel) el.fileViewerZoomLabel.textContent = `${Math.round(fileViewerImageZoom * 100)}%`;
}

function openChatImageViewer(image) {
  const source = image && (image.currentSrc || image.getAttribute('src'));
  if (!source) {
    showToast('That image is still loading.', 'attention');
    return;
  }
  viewedFilePath = '';
  el.fileViewerTitle.textContent = image.getAttribute('alt') || 'Chat image';
  setFileViewerMode('image');
  if (el.fileViewerImageMeta) el.fileViewerImageMeta.textContent = 'Use the controls, Ctrl+wheel, or double-click to zoom.';
  if (el.fileViewerImage) el.fileViewerImage.src = source;
  if (el.btnFileViewerMention) el.btnFileViewerMention.hidden = true;
  el.fileViewerModal.classList.add('active');
  if (el.fileViewerImage && el.fileViewerImage.complete) requestAnimationFrame(fitFileViewerImage);
}

function wireChatImageOpeners(container) {
  if (!container) return;
  container.querySelectorAll('.assistant-response-image img, .user-message-image').forEach(image => {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `Open ${image.getAttribute('alt') || 'chat image'} at full size`);
    image.addEventListener('click', () => openChatImageViewer(image));
    image.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openChatImageViewer(image);
      }
    });
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
  if (el.btnFileViewerMention) el.btnFileViewerMention.hidden = false;
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

function renderAssistantResponseImages(images = [], conversationId = '') {
  const safeImages = (Array.isArray(images) ? images : [])
    .filter(image => image && (image.path || (image.data && image.mimeType)))
    .slice(0, 4);
  if (!safeImages.length) return '';
  const rendered = safeImages.map(image => {
    const alt = escapeHtml(image.alt || 'Orion screenshot');
    const caption = image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : '';
    if (image.data && image.mimeType) {
      return `<figure class="assistant-response-image"><img src="data:${escapeHtml(image.mimeType)};base64,${image.data}" alt="${alt}">${caption}</figure>`;
    }
    return `<figure class="assistant-response-image"><img data-assistant-image-path="${escapeHtml(image.path)}" data-assistant-image-workspace="${escapeHtml(image.workspacePath || '')}" data-assistant-image-conversation="${escapeHtml(image.sourceConversationId || conversationId)}" alt="${alt}">${caption}</figure>`;
  }).join('');
  return `<div class="assistant-response-images">${rendered}</div>`;
}

function hydrateAssistantResponseImages(container) {
  if (!container || !window.api || typeof window.api.readWorkspaceFileBase64 !== 'function') return;
  container.querySelectorAll('img[data-assistant-image-path]').forEach(image => {
    if (image.dataset.loading === 'true' || image.getAttribute('src')) return;
    image.dataset.loading = 'true';
    const imagePath = image.getAttribute('data-assistant-image-path') || '';
    const workspacePath = image.getAttribute('data-assistant-image-workspace') || currentWorkspace || '';
    const conversationId = image.getAttribute('data-assistant-image-conversation') || '';
    window.api.readWorkspaceFileBase64(workspacePath, imagePath, conversationId).then(file => {
      if (!file || file.success === false || !file.data || !String(file.mimeType || '').startsWith('image/')) {
        image.closest('.assistant-response-image')?.classList.add('image-load-failed');
        return;
      }
      image.src = `data:${file.mimeType};base64,${file.data}`;
    }).catch(() => {
      image.closest('.assistant-response-image')?.classList.add('image-load-failed');
    });
  });
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
  fileViewerImageFitWidth = 0;
  fileViewerImageFitHeight = 0;
  setFileViewerImageZoom(1);
  if (el.fileViewerImage) el.fileViewerImage.removeAttribute('src');
  if (el.btnFileViewerMention) el.btnFileViewerMention.hidden = false;
  setFileViewerMode('text');
  if (el.fileViewerModal) el.fileViewerModal.classList.remove('active');
}

// --- CHAT INTERFACE & RENDERERS ---
function setupChatHandlers() {
  el.btnSubmit.addEventListener('click', () => {
    submitMessage();
  });
  if (el.btnStopAgent) {
    el.btnStopAgent.addEventListener('click', async () => {
      if (window.isAgentRunning && window.isAgentRunning() && window.stopAgentExecution) {
        el.btnStopAgent.disabled = true;
        const result = await stopExpectedTaskForConversation(activeConversationId);
        if (!result || result.success === false) {
          el.btnStopAgent.disabled = false;
          showToast((result && result.error) || 'Could not stop that task.', 'attention');
        }
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
  if (el.btnAddConversationOperator) {
    el.btnAddConversationOperator.addEventListener('click', () => createNewConversation('operator'));
  }
  if (el.btnNewConversationOperator) {
    el.btnNewConversationOperator.addEventListener('click', () => createNewConversation('operator'));
  }

  // Item 9 (UI polish): sidebar conversation search, one plain substring filter per mode.
  [
    { input: el.conversationSearchOrion, mode: 'orion' },
    { input: el.conversationSearchCoder, mode: 'coder' },
    { input: el.conversationSearchOperator, mode: 'operator' }
  ].forEach(({ input, mode }) => {
    if (!input) return;
    input.addEventListener('input', () => {
      conversationSearchQueries[mode] = input.value;
      renderConversationList();
    });
  });
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
    const result = await setModelPreferenceSelection(val);
    if (!result.success) showToast(result.error || 'Could not save model selection.', 'error');
  });

  // Reasoning level select — sticky per-answer override beside the model select
  if (el.reasoningSelect) {
    el.reasoningSelect.addEventListener('change', () => {
      window.setReasoningEffortSelection(el.reasoningSelect.value).then(result => {
        if (!result.success) showToast(result.error || 'Could not save reasoning selection.', 'error');
      });
    });
  }
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
      role: workspacePath ? ((mode === 'coder' || mode === 'operator') ? 'standalone_coder' : 'active_project') : 'unresolved',
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
    .filter(isConversationMessageVisible)
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

function clearCurrentTurnTaskResolutionClarifications(conv) {
  if (!conv || !Array.isArray(conv.messages)) return 0;
  let latestUserIndex = -1;
  for (let index = conv.messages.length - 1; index >= 0; index--) {
    if (String(conv.messages[index] && conv.messages[index].role || '').toLowerCase() === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return 0;
  const before = conv.messages.length;
  conv.messages = conv.messages.filter((message, index) => !(
    index > latestUserIndex
    && message
    && message.source === 'task-resolution-clarification'
  ));
  const removed = before - conv.messages.length;
  if (removed > 0 && typeof window.markConversationDirty === 'function') {
    window.markConversationDirty(conv.id);
  }
  return removed;
}

function captureTaskExecutionProfile(options = {}, existingTask = null) {
  const persisted = existingTask && existingTask.executionProfile && typeof existingTask.executionProfile === 'object'
    ? existingTask.executionProfile
    : null;
  if (persisted && RendererTaskOrchestration) {
    return RendererTaskOrchestration.normalizeExecutionProfile(persisted, {
      capturedAt: existingTask.createdAt || Date.now()
    });
  }
  const supplied = options.executionProfile && typeof options.executionProfile === 'object'
    ? options.executionProfile
    : {};
  const selectedModel = String(
    supplied.requestedModel
    || options.modelSelectValue
    || (window.getSelectedModel && window.getSelectedModel())
    || (el.modelSelect && el.modelSelect.value)
    || ''
  ).trim();
  const selectedReasoning = String(
    supplied.requestedReasoning
    || options.reasoningEffort
    || appConfig.reasoningEffort
    || 'auto'
  ).trim().toLowerCase() || 'auto';
  return RendererTaskOrchestration
    ? RendererTaskOrchestration.normalizeExecutionProfile({
        ...supplied,
        requestedModel: selectedModel,
        requestedReasoning: selectedReasoning,
        capturedAt: supplied.capturedAt || Date.now()
      })
    : {
        requestedModel: selectedModel,
        requestedReasoning: selectedReasoning,
        allowEscalation: supplied.allowEscalation !== false,
        allowDowngrade: supplied.allowDowngrade === true,
        capturedAt: supplied.capturedAt || Date.now()
      };
}

function queueExecutionFields(task, options = {}) {
  const executionProfile = captureTaskExecutionProfile(options, task);
  return {
    executionProfile,
    modelSelectValue: executionProfile.requestedModel
      || options.modelSelectValue
      || (el.modelSelect && el.modelSelect.value),
    reasoningEffort: executionProfile.requestedReasoning || 'auto'
  };
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
  const semanticIntent = options.semanticIntent || await classifyCurrentConversationIntent(
    originConv,
    originalUserMessage,
    { model: options.modelSelectValue, taskId: options.taskId || '' }
  );
  const workspace = options.workspace && typeof options.workspace === 'object'
    ? options.workspace
    : structuredWorkspaceForConversation(originConv, options.workspacePath || '');
  const executionProfile = captureTaskExecutionProfile(options);
  const packetResult = RendererTaskOrchestration.buildTaskPacket({
    originalUserMessage,
    resolvedObjective: options.resolvedObjective || '',
    title: options.title || '',
    precedingMessages: options.precedingMessages || taskContextMessages(originConv),
    precedingConversationSummary: options.precedingConversationSummary || '',
    workspace,
    knownProjects: projects,
    searchRoot: getDispatchWorkspaceRoot(),
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
    images: Array.isArray(options.images) ? options.images : [],
    contextPacketIds: Array.isArray(options.contextPacketIds) ? options.contextPacketIds : [],
    executionProfile,
    semanticIntent,
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
  const previousTargetTaskId = targetConv.lastOrchestrationTaskId || '';
  const previousOriginTaskId = originConv.lastOwnedTaskId || '';
  let queueItem = null;
  try {
    orchestrationTaskCache.set(task.taskId, task);
    const runtimePrompt = RendererTaskOrchestration.renderTaskPrompt(task);
    window.promptQueue = Array.isArray(window.promptQueue) ? window.promptQueue : [];
    const executionFields = queueExecutionFields(task, options);
    queueItem = {
      id: options.queueId || createQueuedPromptId(),
      taskId: task.taskId,
      prompt: runtimePrompt,
      originalUserMessage: task.originalUserMessage,
      taskTitle: task.title,
      ...executionFields,
      conversationId: targetConversationId,
      originConversationId,
      source: options.source || task.source,
      createdAt: task.createdAt,
      alreadyRendered: !!options.alreadyRendered,
      images: Array.isArray(task.images) ? task.images : [],
      contextPacketIds: Array.isArray(task.contextPacketIds) ? task.contextPacketIds : []
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
  } catch (error) {
    window.promptQueue = (Array.isArray(window.promptQueue) ? window.promptQueue : [])
      .filter(item => item && item.taskId !== task.taskId);
    orchestrationTaskCache.delete(task.taskId);
    if (targetConv.lastOrchestrationTaskId === task.taskId) {
      targetConv.lastOrchestrationTaskId = previousTargetTaskId;
    }
    if (originConv.lastOwnedTaskId === task.taskId) {
      originConv.lastOwnedTaskId = previousOriginTaskId;
    }
    let rollbackError = '';
    let rollbackTask = null;
    try {
      const rollback = window.api && typeof window.api.cancelOrchestrationTask === 'function'
        ? await window.api.cancelOrchestrationTask(
            task.taskId,
            { conversationId: originConversationId },
            'Rolled back because the task could not be attached to the runtime queue.'
          )
        : null;
      rollbackTask = rollback && rollback.task ? rollback.task : null;
      if (!rollback || !rollback.task || rollback.task.status !== 'cancelled') {
        rollbackError = (rollback && rollback.error) || 'durable rollback was not confirmed';
      }
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure.message || String(rollbackFailure);
    }
    if (!rollbackError) {
      return {
        success: false,
        error: `Task setup failed: ${error.message || error}`,
        taskId: task.taskId,
        rollbackConfirmed: true
      };
    }

    // The durable create is already committed and cancellation could not be verified. Returning an
    // ordinary failure here invites the caller/model to retry the handoff and create a duplicate
    // task while this one still exists. Restore the runtime attachment and report committed success
    // with a warning; the canonical task ID remains the sole work item.
    const retainedTask = rollbackTask && rollbackTask.status !== 'cancelled' ? rollbackTask : task;
    orchestrationTaskCache.set(retainedTask.taskId, retainedTask);
    if (!queueItem) {
      const executionFields = queueExecutionFields(retainedTask, options);
      queueItem = {
        id: options.queueId || createQueuedPromptId(),
        taskId: retainedTask.taskId,
        prompt: retainedTask.objective || retainedTask.originalUserMessage || originalUserMessage,
        originalUserMessage: retainedTask.originalUserMessage || originalUserMessage,
        taskTitle: retainedTask.title || options.title || 'Queued task',
        ...executionFields,
        conversationId: targetConversationId,
        originConversationId,
        source: options.source || retainedTask.source || 'user-queue',
        createdAt: retainedTask.createdAt || Date.now(),
        alreadyRendered: !!options.alreadyRendered,
        images: Array.isArray(retainedTask.images) ? retainedTask.images : [],
        contextPacketIds: Array.isArray(retainedTask.contextPacketIds) ? retainedTask.contextPacketIds : []
      };
    }
    window.promptQueue = Array.isArray(window.promptQueue) ? window.promptQueue : [];
    if (!window.promptQueue.some(item => item && item.taskId === retainedTask.taskId)) {
      window.promptQueue.push(queueItem);
    }
    targetConv.lastOrchestrationTaskId = retainedTask.taskId;
    originConv.lastOwnedTaskId = retainedTask.taskId;
    try {
      if (typeof window.markConversationDirty === 'function') {
        window.markConversationDirty(targetConv.id);
        window.markConversationDirty(originConv.id);
      }
    } catch (_) {}
    return {
      success: true,
      task: retainedTask,
      queueItem,
      committedWithWarning: true,
      warning: `Task ${retainedTask.taskId} was durably created, but runtime setup failed (${error.message || error}) and rollback could not be verified (${rollbackError}). Orion retained the original task instead of retrying it.`
    };
  }
}
window.enqueueOrchestrationTask = enqueueOrchestrationTask;

async function queueDispatchWorkForCoder(options = {}) {
  const originConversationId = String(options.originConversationId || options.conversationId || activeConversationId || '');
  const originConv = conversations.find(conv => conv.id === originConversationId);
  const originalUserMessage = String(options.originalUserMessage || options.prompt || '').trim();
  if (!originConv || conversationMode(originConv) !== 'orion') {
    return { success: false, error: 'The Dispatch conversation for this task could not be resolved.' };
  }
  if (!originalUserMessage || !RendererTaskOrchestration || !RendererWorkspaceResolution) {
    return { success: false, error: 'Durable Dispatch-to-Coder task resolution is unavailable.' };
  }
  const semanticIntent = options.semanticIntent || await classifyCurrentConversationIntent(
    originConv,
    originalUserMessage,
    { model: options.modelSelectValue }
  );
  if (semanticIntent.needsClarification || semanticIntent.intent === 'clarification_required') {
    const clarification = semanticIntent.clarificationQuestion || 'What specific work should I hand to Coder?';
    persistTaskClarification(originConv, clarification);
    return { success: false, needsClarification: true, clarification, task: null };
  }

  const contextText = [
    ...taskContextMessages(originConv).map(message => message.text),
    semanticIntent.resolvedRequest || originalUserMessage
  ].join('\n');
  const standaloneSystemWork = semanticIntent.standaloneSystemOperation === true;
  const workspace = standaloneSystemWork
    ? structuredWorkspaceForConversation(originConv)
    : await bindNamedProjectForSupervisor(originConv, contextText);
  const hasConcreteWorkspace = workspace.role === 'active_project' || workspace.role === 'standalone_coder';
  const standalone = standaloneSystemWork || (!hasConcreteWorkspace
    && RendererSemanticIntentRouter
    && RendererSemanticIntentRouter.canUseStandaloneCoderWorkspace(semanticIntent));
  let standaloneWorkspacePath = '';
  if (standalone) {
    if (standaloneSystemWork) {
      try {
        const homeDir = await window.api.getHomeDir();
        standaloneWorkspacePath = typeof homeDir === 'string' ? homeDir.trim() : '';
      } catch (_) {}
    } else {
      const standaloneTitle = String(
        options.title
        || semanticIntent.taskResolution && semanticIntent.taskResolution.title
        || semanticIntent.resolvedRequest
        || originalUserMessage
      ).trim();
      standaloneWorkspacePath = getStandaloneWorkspaceForTitle(
        standaloneTitle,
        `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      );
    }
  }
  const taskWorkspace = standalone
    ? {
        role: 'standalone_coder',
        path: standaloneWorkspacePath || getDispatchWorkspaceRoot(),
        project: { name: '', path: '' },
        source: standaloneSystemWork ? 'standalone-system-task' : 'standalone-coder-task',
        resolved: true
      }
    : workspace;

  if (!standalone && taskWorkspace.role !== 'active_project' && taskWorkspace.role !== 'standalone_coder') {
    const reference = (RendererWorkspaceResolution.extractProjectReferences(contextText) || [])[0] || '';
    const clarification = reference
      ? `I could not resolve ${reference} to a specific project workspace. Which project folder should Coder use?`
      : 'Which specific project workspace should Coder use? The Projects directory is only a search root.';
    persistTaskClarification(originConv, clarification);
    return { success: false, needsClarification: true, clarification, task: null };
  }

  const packetResult = RendererTaskOrchestration.buildTaskPacket({
    originalUserMessage,
    resolvedObjective: String(options.resolvedObjective || semanticIntent.resolvedRequest || '').trim(),
    title: String(options.title || '').trim(),
    precedingMessages: options.precedingMessages || taskContextMessages(originConv),
    precedingConversationSummary: String(options.precedingConversationSummary || ''),
    workspace: taskWorkspace,
    knownProjects: projects,
    searchRoot: getDispatchWorkspaceRoot(),
    requirements: Array.isArray(options.requirements) ? options.requirements : [],
    constraints: Array.isArray(options.constraints) ? options.constraints : [],
    unresolvedDecisions: Array.isArray(options.unresolvedDecisions) ? options.unresolvedDecisions : [],
    origin: {
      conversationId: originConv.id,
      sessionId: String(options.originSessionId || originConv.sessionId || originConv.id),
      messageId: String(options.originMessageId || '')
    },
    target: {
      conversationId: 'pending-coder-conversation',
      sessionId: 'pending-coder-conversation',
      mode: 'coder'
    },
    source: options.source || 'dispatch-direct-coder-queue',
    images: Array.isArray(options.images) ? options.images : [],
    contextPacketIds: Array.isArray(options.contextPacketIds) ? options.contextPacketIds : [],
    semanticIntent,
    timestamp: options.createdAt || Date.now()
  });
  if (!packetResult.success || !packetResult.task) {
    persistTaskClarification(originConv, packetResult.clarification || 'What specific work should I hand to Coder?');
    return {
      success: false,
      needsClarification: true,
      clarification: packetResult.clarification,
      task: null
    };
  }

  const packet = packetResult.task;
  const promoted = await window.promoteWorkspaceToCoder({
    path: taskWorkspace.path,
    standalone,
    prompt: packet.objective,
    originalUserMessage,
    resolvedObjective: packet.objective,
    title: packet.title,
    taskPacket: packet,
    sourceConversationId: originConv.id,
    sourceSessionId: packet.origin.sessionId,
    sourceMessageId: packet.origin.messageId,
    contextPacketIds: packet.contextPacketIds,
    findings: packet.requirements,
    requirements: packet.requirements,
    constraints: packet.constraints,
    unresolvedDecisions: packet.unresolvedDecisions,
    precedingConversationSummary: packet.precedingConversationSummary,
    semanticIntent,
    standaloneSystemOperation: standaloneSystemWork,
    open: options.open === true
  });
  if (!promoted || promoted.success === false || !promoted.task) {
    return {
      success: false,
      needsClarification: !!(promoted && promoted.needsClarification),
      clarification: promoted && promoted.needsClarification ? promoted.error : '',
      error: (promoted && promoted.error) || 'Coder task handoff failed.'
    };
  }

  originConv.lastOwnedTaskId = promoted.task.taskId;
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(originConv.id);
  await flushConversationsToStorage();
  renderDesktopDispatchLanding();
  return { ...promoted, success: true, task: promoted.task, queueItem: promoted.queueItem };
}
window.queueDispatchWorkForCoder = queueDispatchWorkForCoder;

async function queueTaskContinuation(options = {}) {
  const targetConversationId = String(options.targetConversationId || options.conversationId || '');
  const targetConv = conversations.find(conv => conv.id === targetConversationId);
  if (!targetConv) return { success: false, error: 'Task conversation could not be resolved.' };
  let existingTaskId = String(options.taskId || '');
  if (!existingTaskId && options.requireExistingTask) {
    let candidates = [...orchestrationTaskCache.values()].filter(task =>
      task
      && task.status === 'pending'
      && task.target
      && String(task.target.conversationId || '') === targetConversationId);
    if (window.api && typeof window.api.listOrchestrationTasks === 'function') {
      const listed = await window.api.listOrchestrationTasks({
        status: 'pending',
        targetConversationId,
        sort: 'desc'
      });
      if (listed && listed.success !== false && Array.isArray(listed.tasks)) {
        listed.tasks.forEach(task => {
          if (task && task.taskId) orchestrationTaskCache.set(task.taskId, task);
        });
        candidates = listed.tasks.filter(task =>
          task
          && task.status === 'pending'
          && task.target
          && String(task.target.conversationId || '') === targetConversationId);
      }
    }
    if (candidates.length !== 1) {
      return {
        success: false,
        error: candidates.length
          ? 'More than one pending task belongs to this conversation, so Orion cannot safely guess which task to resume.'
          : 'The pending task ID could not be recovered, so Orion did not create a duplicate continuation task.'
      };
    }
    existingTaskId = String(candidates[0].taskId || '');
  }
  let existingTask = existingTaskId ? orchestrationTaskCache.get(existingTaskId) : null;
  if (existingTaskId && (!existingTask || existingTask.status !== 'pending') && window.api && typeof window.api.getOrchestrationTask === 'function') {
    const read = await window.api.getOrchestrationTask(existingTaskId);
    existingTask = read && read.success ? read.task : null;
    if (existingTask && existingTask.taskId) orchestrationTaskCache.set(existingTask.taskId, existingTask);
  }
  if (existingTaskId && (!existingTask || existingTask.status !== 'pending')) {
    return {
      success: false,
      error: existingTask
        ? `Task ${existingTaskId} is ${existingTask.status}; it cannot be resumed as pending work.`
        : `Task ${existingTaskId} could not be found for this continuation.`
    };
  }
  if (existingTask && existingTask.status === 'pending'
      && existingTask.target && existingTask.target.conversationId === targetConversationId) {
    const explicitContinuationInput = String(options.prompt || '').trim();
    const durableContinuationInput = String(
      existingTask.continuation && existingTask.continuation.input || ''
    ).trim();
    const continuationInput = explicitContinuationInput || durableContinuationInput;
    if (explicitContinuationInput && window.api && typeof window.api.updateOrchestrationTask === 'function') {
      const updated = await window.api.updateOrchestrationTask(existingTask.taskId, {
        continuation: {
          input: explicitContinuationInput,
          source: options.source || 'task-continuation',
          kind: options.planRevision === true ? 'plan_revision' : '',
          messageId: String(options.originMessageId || ''),
          createdAt: Date.now()
        },
        images: [
          ...(Array.isArray(existingTask.images) ? existingTask.images : []),
          ...(Array.isArray(options.images) ? options.images : [])
        ],
        contextPacketIds: [
          ...(Array.isArray(existingTask.contextPacketIds) ? existingTask.contextPacketIds : []),
          ...(Array.isArray(options.contextPacketIds) ? options.contextPacketIds : [])
        ]
      });
      if (!updated || updated.success === false || !updated.task) {
        return {
          success: false,
          error: (updated && updated.error) || `Task ${existingTask.taskId} could not persist its continuation input.`
        };
      }
      existingTask = updated.task;
      orchestrationTaskCache.set(existingTask.taskId, existingTask);
    }
    const executionFields = queueExecutionFields(existingTask, options);
    const queueItem = {
      id: createQueuedPromptId(),
      taskId: existingTask.taskId,
      prompt: continuationInput || RendererTaskOrchestration.renderTaskPrompt(existingTask),
      originalUserMessage: existingTask.originalUserMessage,
      taskTitle: existingTask.title,
      ...executionFields,
      conversationId: targetConversationId,
      originConversationId: existingTask.origin && existingTask.origin.conversationId,
      source: options.source || 'task-continuation',
      alreadyRendered: true,
      preserveUserPrompt: !!continuationInput,
      createdAt: Date.now(),
      images: Array.isArray(existingTask.images) ? existingTask.images : [],
      contextPacketIds: Array.isArray(existingTask.contextPacketIds) ? existingTask.contextPacketIds : []
    };
    queueItem.planRevision = options.planRevision === true
      || String(existingTask.continuation && existingTask.continuation.kind || '') === 'plan_revision';
    window.promptQueue = (Array.isArray(window.promptQueue) ? window.promptQueue : [])
      .filter(item => item && item.taskId !== existingTask.taskId);
    window.promptQueue.push(queueItem);
    return { success: true, task: existingTask, queueItem, resumed: true };
  }
  if (options.requireExistingTask) {
    return {
      success: false,
      error: 'The existing pending task could not be resumed, so Orion did not create a second task.'
    };
  }
  return enqueueOrchestrationTask({
    ...options,
    prompt: options.prompt,
    resolvedObjective: options.resolvedObjective || options.prompt,
    originalUserMessage: options.originalUserMessage || options.prompt,
    targetConversationId,
    originConversationId: options.originConversationId || targetConversationId,
    alreadyRendered: true
  });
}
window.queueTaskContinuation = queueTaskContinuation;

function pendingTaskNeedsRuntimeQueue(task) {
  const explicitlyRestorable = !!(
    RendererTaskOrchestration
    && typeof RendererTaskOrchestration.pendingTaskNeedsRuntimeQueue === 'function'
    && RendererTaskOrchestration.pendingTaskNeedsRuntimeQueue(task)
  );
  if (explicitlyRestorable) return true;
  // Backward-compatible migration for tasks written before resumePolicy existed. This inspects
  // Orion's own exact lifecycle fields, never user language. A claimed pending task with no
  // recorded reason and no conversation-owned approval/input gate was an action-boundary yield.
  if (!task || task.status !== 'pending') return false;
  const execution = task.execution && typeof task.execution === 'object' ? task.execution : {};
  if (!Number(execution.attempt) || execution.resumePolicy) return false;
  const targetId = String(task.target && task.target.conversationId || '');
  const targetConv = conversations.find(conv => conv.id === targetId);
  if (targetConv && (targetConv.awaitingPlanApproval || targetConv.awaitingClarification)) return false;
  const legacyReason = String(execution.reason || '').trim().toLowerCase();
  const legacyReasonCode = String(execution.reasonCode || '').trim();
  return legacyReason.includes('continue automatically') || (!legacyReason && !legacyReasonCode);
}

function ensureContinuationQueued(continuation) {
  if (!continuation || !continuation.task || !continuation.queueItem) return;
  window.promptQueue = (Array.isArray(window.promptQueue) ? window.promptQueue : [])
    .filter(item => item && item.taskId !== continuation.task.taskId);
  window.promptQueue.push(continuation.queueItem);
}

function startOrQueueTaskContinuation(continuation, conv, options = {}) {
  if (!continuation || !continuation.success || !continuation.task || !continuation.queueItem || !conv) {
    return { success: false, queued: false, error: 'Task continuation is incomplete.' };
  }
  const taskId = continuation.task.taskId;
  const currentlyBusy = !!(window.isAgentRunning && window.isAgentRunning());
  if (currentlyBusy) {
    ensureContinuationQueued(continuation);
    return { success: true, queued: true, taskId, taskStatus: continuation.task.status };
  }

  window.promptQueue = (Array.isArray(window.promptQueue) ? window.promptQueue : [])
    .filter(item => item && item.taskId !== taskId);
  const runPromise = window.runAgentLoop(
    continuation.queueItem.prompt,
    continuation.queueItem.modelSelectValue || options.modelSelectValue || window.getSelectedModel(),
    conv,
    {
      source: options.source || continuation.queueItem.source || 'task-continuation',
      internalPrompt: true,
      preserveUserPrompt: !!continuation.queueItem.preserveUserPrompt,
      taskId,
      reasoningEffort: continuation.queueItem.reasoningEffort,
      executionProfile: continuation.queueItem.executionProfile,
      images: continuation.queueItem.images || [],
      contextPacketIds: continuation.queueItem.contextPacketIds || [],
      planRevision: continuation.queueItem.planRevision === true
    }
  );

  // runAgentLoop reserves the task synchronously before its first await. If another
  // run won the race during persistence, the reservation will belong to that other
  // task; put this exact continuation back instead of silently losing it.
  const reservedTaskId = window.getActiveRunTaskId ? String(window.getActiveRunTaskId() || '') : '';
  const reservedConversationId = window.getRunningConversationId ? String(window.getRunningConversationId() || '') : '';
  const ownsReservation = reservedTaskId === taskId
    && (!reservedConversationId || reservedConversationId === conv.id);
  Promise.resolve(runPromise).then(result => {
    if (result && result.reason === 'agent_busy') ensureContinuationQueued(continuation);
  }).catch(error => {
    console.error(`${options.errorLabel || 'Task continuation'} failed:`, error);
  });
  if (!ownsReservation) {
    ensureContinuationQueued(continuation);
    return { success: true, queued: true, taskId, taskStatus: continuation.task.status };
  }
  return { success: true, queued: false, taskId, taskStatus: 'active' };
}
window.startOrQueueTaskContinuation = startOrQueueTaskContinuation;

// Phase 3 (restart/recovery, item 12): populated by initializeOrchestrationTasks when a process
// lease from an interrupted task is confirmed still alive after restart. Keyed by taskId, consumed
// (and cleared) the first time notifySupervisorOfCoderCompletion/OfOperatorCompletion reports that
// task, so the user is told the difference between "this task failed and left nothing behind" and
// "this task failed, but the process it started may still be running."
const interruptedTaskLivenessNotes = new Map();

// Phase 3 (restart/recovery, item 12). The task store's own reconcileInterrupted already marks any
// task that was ACTIVE when the app last stopped as FAILED unconditionally — safe, but dumb: it
// cannot tell "this task's background process crashed with the app" from "this task's background
// process is still out there running." This function is the smarter half. It takes the just-
// reconciled tasks, asks the lease store which of them left a process lease behind (see
// lib/resource-lease-store.js's reconcileInterrupted — desktop/browser/workspace leases are
// released immediately there since none of those can survive a restart, but process leases are
// flagged instead of resolved), actually checks whether each flagged PID is still alive via a raw
// OS probe (lib/ipc-shell.js's isProcessAlive, which works even though the in-memory command-
// session registry itself was wiped by the restart), and records a note for any task whose process
// is confirmed still running so the eventual completion notification can say so instead of
// silently treating the workspace as clean.
async function reconcileResourceLeasesAfterRestart(taskReconciliation) {
  if (!window.api || typeof window.api.reconcileResourceLeases !== 'function') return;
  try {
    const reconciledTasks = (taskReconciliation && Array.isArray(taskReconciliation.tasks)) ? taskReconciliation.tasks : [];
    const interruptedTaskIds = reconciledTasks
      .filter(task => task && task.failure && task.failure.code === 'interrupted')
      .map(task => task.taskId)
      .filter(Boolean);
    const leaseReconciliation = await window.api.reconcileResourceLeases({ interruptedTaskIds });
    const flagged = (leaseReconciliation && Array.isArray(leaseReconciliation.flaggedForLivenessCheck))
      ? leaseReconciliation.flaggedForLivenessCheck
      : [];
    for (const lease of flagged) {
      let stillAlive = false;
      if (typeof window.api.checkProcessAlive === 'function') {
        for (const pid of (lease.processIds || [])) {
          try {
            const checked = await window.api.checkProcessAlive(pid);
            if (checked && checked.alive) { stillAlive = true; break; }
          } catch (error) {
            console.error('Could not check process liveness during restart recovery:', error);
          }
        }
      }
      if (typeof window.api.resolveResourceLeaseLiveness === 'function') {
        await window.api.resolveResourceLeaseLiveness({ resourceKey: lease.resourceKey, stillAlive });
      }
      if (stillAlive && lease.taskId) {
        interruptedTaskLivenessNotes.set(
          lease.taskId,
          'A background process this task started may still be running (confirmed alive after restart) — check before starting another one in the same workspace.'
        );
      }
    }
  } catch (error) {
    console.error('Could not reconcile resource leases after restart:', error);
  }
}

async function initializeOrchestrationTasks() {
  if (!window.api || typeof window.api.listOrchestrationTasks !== 'function') return;
  try {
    await window.api.migrateOrchestrationTasks?.();
    const taskReconciliation = await window.api.reconcileOrchestrationTasks?.({ reason: 'Orion restarted before the active task recorded a terminal result.' });
    await reconcileResourceLeasesAfterRestart(taskReconciliation);
    const listed = await window.api.listOrchestrationTasks({ sort: 'desc' });
    const tasks = listed && Array.isArray(listed.tasks) ? listed.tasks : [];
    tasks.forEach(task => {
      if (task && task.taskId) orchestrationTaskCache.set(task.taskId, task);
    });
    let taskPresentationChanged = false;
    for (const task of tasks) {
      for (const conversation of conversations) {
        if (reconcileConversationTaskPresentation(conversation, task)) {
          taskPresentationChanged = true;
          if (!conversation.isStub && typeof window.markConversationDirty === 'function') {
            window.markConversationDirty(conversation.id);
          }
        }
      }
    }
    conversations.forEach(conversation =>
      scheduleTerminalDelegatedTaskReconciliation(conversation, orchestrationTaskCache)
    );
    if (taskPresentationChanged) saveConversationsToStorage();
    window.promptQueue = Array.isArray(window.promptQueue) ? window.promptQueue : [];
    for (const task of tasks.filter(pendingTaskNeedsRuntimeQueue)) {
      if (!task || !task.taskId || window.promptQueue.some(item => item && item.taskId === task.taskId)) continue;
      const targetId = task.target && task.target.conversationId;
      if (!targetId || !conversations.some(conv => conv.id === targetId)) continue;
      const automaticCheckpoint = String(
        task.execution && task.execution.resumePolicy || ''
      ).toLowerCase() === 'automatic';
      const executionFields = queueExecutionFields(task);
      window.promptQueue.push({
        id: createQueuedPromptId(),
        taskId: task.taskId,
        prompt: (task.continuation && task.continuation.input)
          || RendererTaskOrchestration.renderTaskPrompt(task),
        originalUserMessage: task.originalUserMessage,
        taskTitle: task.title,
        ...executionFields,
        conversationId: targetId,
        originConversationId: task.origin && task.origin.conversationId,
        source: automaticCheckpoint ? 'system' : (task.source || 'restored-queue'),
        createdAt: task.createdAt,
        alreadyRendered: true,
        preserveUserPrompt: !!(task.continuation && task.continuation.input),
        planRevision: String(task.continuation && task.continuation.kind || '') === 'plan_revision',
        images: Array.isArray(task.images) ? task.images : [],
        contextPacketIds: Array.isArray(task.contextPacketIds) ? task.contextPacketIds : []
      });
    }
    if (window.promptQueue.length > 0 && typeof window.resumeDurableTaskQueue === 'function') {
      window.resumeDurableTaskQueue(100);
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
  const prompt = RendererTaskOrchestration.renderTaskPrompt(task);
  const claimed = await window.api.transitionOrchestrationTask(taskId, 'active', {
    startedBy: 'agent-loop',
    consumeContinuation: true
  });
  if (!claimed || claimed.success === false || !claimed.task) return { success: false, reason: (claimed && claimed.error) || 'Task could not be claimed.' };
  task = claimed.task;
  orchestrationTaskCache.set(task.taskId, task);
  const originConversationId = String(task.origin && task.origin.conversationId || '');
  const targetConversationId = String(task.target && task.target.conversationId || '');
  const originConv = conversations.find(conv => conv.id === originConversationId);
  const targetConv = conversations.find(conv => conv.id === targetConversationId);
  if (originConv && targetConv && conversationMode(originConv) === 'orion' && conversationMode(targetConv) === 'coder') {
    try {
      originConv.launchedCoderConvId = targetConversationId;
      originConv.launchedCoderTaskId = task.taskId;
      originConv.lastOwnedTaskId = task.taskId;
      originConv.launchedCoderTaskTitle = task.title;
      originConv.launchedCoderTaskStart = task.startedAt || Date.now();
      if (typeof window.markConversationDirty === 'function') window.markConversationDirty(originConv.id);
      saveConversationsToStorage();
      if (typeof window.startCoderTaskMonitor === 'function') {
        window.startCoderTaskMonitor(originConv.id, targetConversationId, task.taskId);
      }
      renderDesktopDispatchLanding();
    } catch (error) {
      // The durable active transition is already committed. Pointer/status presentation must
      // never turn a successful claim into a retry that duplicates or strands canonical work.
      console.error('Could not publish the claimed Dispatch-owned Coder task:', error);
    }
  }
  return { success: true, task, prompt };
};

window.finalizeOrchestrationTask = async function(taskId, status, details = {}) {
  if (!taskId || !window.api || typeof window.api.getOrchestrationTask !== 'function') return null;
  const read = await window.api.getOrchestrationTask(taskId);
  if (!read || read.success === false || !read.task) return null;
  if (read.task.status === 'cancelled' || read.task.status === status) {
    orchestrationTaskCache.set(read.task.taskId, read.task);
    return read.task;
  }
  const transitioned = await window.api.transitionOrchestrationTask(taskId, status, details);
  if (transitioned && transitioned.success && transitioned.task) {
    orchestrationTaskCache.set(transitioned.task.taskId, transitioned.task);
    return transitioned.task;
  }
  return null;
};

window.getOwnedOrchestrationTasks = async function(conversationId, statuses = []) {
  if (!window.api || typeof window.api.listOrchestrationTasks !== 'function') {
    throw new Error('Task-store listing is unavailable.');
  }
  const result = await window.api.listOrchestrationTasks({
    originConversationId: String(conversationId || ''),
    ...(statuses.length ? { status: statuses } : {}),
    sort: 'desc'
  });
  if (!result || result.success === false || !Array.isArray(result.tasks)) {
    throw new Error((result && result.error) || 'Task-store listing failed.');
  }
  return result.tasks;
};

async function resumeOwnedCoderTaskFromDispatch(conv, prompt, options = {}) {
  const isContinuation = !!(
    conv
    && conversationMode(conv) === 'orion'
    && RendererTaskOrchestration
    && typeof RendererTaskOrchestration.isContinuationRequest === 'function'
    && RendererTaskOrchestration.isContinuationRequest(options.semanticIntent)
  );
  if (!isContinuation) return { handled: false };

  try {
    await orchestrationTasksReady;
    const owned = (await window.getOwnedOrchestrationTasks(conv.id, ['pending', 'active']))
      .filter(task => {
        if (!task || !['pending', 'active'].includes(task.status)) return false;
        const targetId = String(task.target && task.target.conversationId || '');
        const targetConv = conversations.find(item => item.id === targetId);
        return !!(targetConv && conversationMode(targetConv) === 'coder');
      })
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    owned.forEach(task => orchestrationTaskCache.set(task.taskId, task));
    if (!owned.length) return { handled: false };

    const preferredIds = [
      conv.launchedCoderTaskId,
      conv.lastDelegatedWork && conv.lastDelegatedWork.taskId,
      conv.lastOwnedTaskId
    ].map(value => String(value || '')).filter(Boolean);
    const selection = RendererTaskOrchestration.selectOwnedContinuationTask(
      owned,
      conv.id,
      preferredIds
    );

    if (selection.action === 'already_active') {
      const task = selection.task;
      const targetId = String(task.target && task.target.conversationId || '');
      conv.launchedCoderConvId = targetId;
      conv.launchedCoderTaskId = task.taskId;
      conv.lastOwnedTaskId = task.taskId;
      conv.launchedCoderTaskTitle = task.title;
      if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
      saveConversationsToStorage();
      if (typeof window.startCoderTaskMonitor === 'function') {
        window.startCoderTaskMonitor(conv.id, targetId, task.taskId);
      }
      persistAssistantStatusMessage(
        conv.id,
        `Coder is already continuing **${task.title || 'the task'}**. I kept the existing task ${task.taskId}; no duplicate was created.`,
        {
          source: options.source || 'dispatch-task-continuation',
          dedupeKey: `continuation-already-active-${task.taskId}`
        }
      );
      return { success: true, handled: true, resumed: false, alreadyActive: true, task };
    }

    if (selection.action === 'ambiguous_active') {
      persistTaskClarification(
        conv,
        `More than one Coder task is active for this conversation. Which one should I continue: ${selection.candidates.slice(0, 4).map(task => `${task.title} (${task.taskId})`).join('; ')}?`
      );
      return { success: false, handled: true, needsClarification: true };
    }

    const task = selection.action === 'resume_pending' ? selection.task : null;
    if (selection.action === 'ambiguous_pending') {
      persistTaskClarification(
        conv,
        `More than one paused Coder task belongs to this conversation. Which one should I continue: ${selection.candidates.slice(0, 4).map(item => `${item.title} (${item.taskId})`).join('; ')}?`
      );
      return { success: false, handled: true, needsClarification: true };
    }
    if (!task) return { handled: false };

    const targetId = String(task.target && task.target.conversationId || '');
    const targetConv = conversations.find(item => item.id === targetId);
    const messageId = String(options.messageId || '');
    const continuation = await queueTaskContinuation({
      taskId: task.taskId,
      prompt,
      originalUserMessage: prompt,
      modelSelectValue: options.modelSelectValue || window.getSelectedModel(),
      targetConversationId: targetId,
      originConversationId: conv.id,
      originMessageId: messageId,
      source: options.source || 'dispatch-task-continuation',
      images: options.images || [],
      requireExistingTask: true,
      alreadyRendered: true
    });
    if (!continuation.success) {
      persistAssistantStatusMessage(
        conv.id,
        continuation.error || `Task ${task.taskId} could not be resumed.`,
        {
          source: 'dispatch-task-continuation-error',
          dedupeKey: `continuation-error-${task.taskId}`
        }
      );
      return { ...continuation, handled: true };
    }

    conv.launchedCoderConvId = targetId;
    conv.launchedCoderTaskId = task.taskId;
    conv.lastOwnedTaskId = task.taskId;
    conv.launchedCoderTaskTitle = task.title;
    conv.launchedCoderTaskStart = task.startedAt || Date.now();
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
    saveConversationsToStorage();
    const launch = startOrQueueTaskContinuation(continuation, targetConv, {
      source: options.source || 'dispatch-task-continuation',
      modelSelectValue: options.modelSelectValue || window.getSelectedModel(),
      errorLabel: 'Dispatch task continuation'
    });
    if (typeof window.startCoderTaskMonitor === 'function') {
      window.startCoderTaskMonitor(conv.id, targetId, task.taskId);
    }
    persistAssistantStatusMessage(
      conv.id,
      `${launch.queued ? 'Queued' : 'Continuing'} **${task.title || 'the task'}** as ${task.taskId}. No new task was created.`,
      {
        source: options.source || 'dispatch-task-continuation',
        dedupeKey: `continuation-resumed-${task.taskId}`
      }
    );
    return { ...launch, success: true, handled: true, resumed: true, task: continuation.task };
  } catch (error) {
    persistAssistantStatusMessage(
      conv.id,
      `I could not verify the existing Coder task, so I did not create a duplicate: ${error.message || error}`,
      {
        source: 'dispatch-task-continuation-error',
        dedupeKey: `continuation-lookup-error-${conv.id}`
      }
    );
    return { success: false, handled: true, error: error.message || String(error) };
  }
}

async function classifyCurrentConversationIntent(conv, prompt, options = {}) {
  if (options.semanticIntent && typeof options.semanticIntent === 'object') return options.semanticIntent;
  if (!RendererSemanticIntentRouter || typeof window.classifySemanticIntent !== 'function') {
    return RendererSemanticIntentRouter
      ? RendererSemanticIntentRouter.safeFallback({
          pendingPlan: conv && (conv.awaitingDelegatedPlan || conv.awaitingPlanApproval),
          activeOwnedTask: null,
          pendingOwnedTask: null,
          taskBound: !!options.taskId
        }, 'Semantic classifier is unavailable.')
      : {
          intent: 'clarification_required',
          requiresExecution: false,
          target: 'current_conversation',
          contextDependent: true,
          needsClarification: true,
          clarificationQuestion: 'I could not safely determine what that message should do. Could you clarify?'
        };
  }

  let ownedTasks = [];
  if (conv && conversationMode(conv) === 'orion' && typeof window.getOwnedOrchestrationTasks === 'function') {
    try {
      await orchestrationTasksReady;
      ownedTasks = await window.getOwnedOrchestrationTasks(
        conv.id,
        ['pending', 'active', 'completed', 'failed', 'cancelled']
      );
    } catch (error) {
      console.warn('Could not load owned tasks for semantic classification:', error);
    }
  }
  if (RendererTaskOrchestration && typeof RendererTaskOrchestration.filterSupersededTasks === 'function') {
    ownedTasks = RendererTaskOrchestration.filterSupersededTasks(ownedTasks);
  }
  const byNewest = (left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0);
  const activeOwnedTask = ownedTasks.filter(task => task && task.status === 'active').sort(byNewest)[0] || null;
  const pendingOwnedTask = ownedTasks.filter(task => task && task.status === 'pending').sort(byNewest)[0] || null;
  const recentOwnedTask = ownedTasks
    .filter(task => task && ['completed', 'failed', 'cancelled'].includes(task.status))
    .sort(byNewest)[0] || null;
  const delegated = conv && conv.awaitingDelegatedPlan;
  const pendingPlan = delegated
    ? {
        planId: delegated.planMessageId || delegated.planId || '',
        taskId: delegated.taskId || '',
        ownerConversationId: conv.id,
        coderConversationId: delegated.coderConversationId || '',
        title: delegated.title || '',
        status: 'pending'
      }
    : (conv && conv.awaitingPlanApproval
        ? {
            planId: conv.awaitingPlanApprovalPlanId || '',
            taskId: conv.awaitingPlanApprovalTaskId || options.taskId || '',
            ownerConversationId: conv.id,
            coderConversationId: conv.id,
            title: conv.title || '',
            status: 'pending'
          }
        : null);
  const boundTask = activeOwnedTask || pendingOwnedTask;
  const recentVisibleConversation = taskContextMessages(conv);
  // Resolve an explicitly named project before asking the semantic model what the turn means.
  // Otherwise a Dispatch conversation that was last attached to Project A can make an unambiguous
  // request about Project B look contradictory, and the classifier will repeatedly ask the user to
  // choose a target that the visible conversation already identified.
  const semanticWorkspace = conv && conversationMode(conv) === 'orion'
    ? bindNamedProjectForSupervisor(conv, [
        ...recentVisibleConversation.map(message => message && (message.text || message.content || '')),
        prompt
      ].filter(Boolean).join('\n'))
    : (conv ? structuredWorkspaceForConversation(conv) : null);
  const classification = await window.classifySemanticIntent({
    userMessage: prompt,
    recentVisibleConversation,
    conversationId: conv && conv.id,
    mode: conv && conversationMode(conv),
    workspace: semanticWorkspace,
    pendingPlan,
    activeOwnedTask,
    pendingOwnedTask,
    recentOwnedTask,
    taskBound: !!(options.taskId || boundTask || pendingPlan),
    durableTaskObjective: (boundTask || recentOwnedTask) && (boundTask || recentOwnedTask).objective || ''
  }, options.model || window.getSelectedModel(), window.getAppConfig ? window.getAppConfig() : {});
  const supersedesTaskId = recentOwnedTask
    && classification
    && classification.intent === 'context_followup'
    && classification.contextDependent === true
    && classification.requiresExecution === true
      ? recentOwnedTask.taskId
      : '';
  return supersedesTaskId ? { ...classification, supersedesTaskId } : classification;
}
window.classifyCurrentConversationIntent = classifyCurrentConversationIntent;
window.resumeOwnedCoderTaskFromDispatch = resumeOwnedCoderTaskFromDispatch;

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
  const cancelledLaunchedTask = !!(
    originConv
    && String(originConv.launchedCoderTaskId || '') === String(taskId)
  );
  if (originConv && cancelledLaunchedTask) {
    reconcileDelegatedTaskCancellation(originConv, result.task, originConv.launchedTaskRole || 'coder');
  }
  saveConversationsToStorage();
  renderDesktopDispatchLanding();
  return { ...result, stopped: !!result.wasActive };
};

async function cancelPendingTasksForNewFocus(conversationId) {
  const ownerId = String(conversationId || '');
  if (!RendererTaskOrchestration || typeof RendererTaskOrchestration.cancelPendingOwnedTasks !== 'function') {
    return {
      success: false,
      cancelled: [],
      failures: [{ taskId: '', error: 'Task lifecycle contracts are unavailable.' }],
      count: 0
    };
  }
  return RendererTaskOrchestration.cancelPendingOwnedTasks({ conversationId: ownerId }, {
    listTasks: (requesterId, statuses) => window.getOwnedOrchestrationTasks(requesterId, statuses),
    cancelTask: (taskId, requesterId) => window.cancelOwnedOrchestrationTask(
      taskId,
      requesterId,
      'Cancelled when a new focus was started.'
    )
  });
}

window.beginNewFocus = async function(conversationId = activeConversationId) {
  return cancelPendingTasksForNewFocus(conversationId);
};

async function stopExpectedTaskForConversation(conversationId) {
  const requesterId = String(conversationId || '');
  const conv = conversations.find(item => item.id === requesterId);
  if (!conv) return { success: false, stopped: false, error: 'Conversation not found.' };
  const runningId = window.getRunningConversationId ? window.getRunningConversationId() : '';
  const activeTaskId = runningId === requesterId && window.getActiveRunTaskId ? window.getActiveRunTaskId() : '';
  // A visible direct response may not have a durable task ID. In that case Stop
  // belongs to the active response itself; do not cancel an older pending task
  // merely because its ID is still retained on the conversation.
  if (runningId === requesterId && !activeTaskId && window.stopAgentExecution) {
    return window.stopAgentExecution({ mode: 'hard' });
  }
  // Stop the task the user can currently see running before older delegated
  // references retained on the conversation. A stale launchedCoderTaskId must
  // never steal the Stop action from the exact active run.
  const candidates = [activeTaskId, conv.launchedCoderTaskId, conv.lastOwnedTaskId, conv.lastOrchestrationTaskId]
    .map(value => String(value || ''))
    .filter((value, index, values) => value && values.indexOf(value) === index);
  try {
    for (const taskId of candidates) {
      const status = await window.getOrchestrationTaskStatus(taskId, requesterId);
      if (!status || !status.success || !['pending', 'active'].includes(status.status)) continue;
      return window.cancelOwnedOrchestrationTask(taskId, requesterId, 'Cancelled from the Stop control.');
    }
  } catch (error) {
    return { success: false, stopped: false, error: error.message || String(error) };
  }
  if (runningId === requesterId && window.stopAgentExecution) {
    return window.stopAgentExecution({ mode: 'hard' });
  }
  return { success: false, stopped: false, error: 'This conversation does not own the currently running task.' };
}
window.stopExpectedTaskForConversation = stopExpectedTaskForConversation;

function ownsActiveSupervisedRun(conv) {
  if (!conv || conversationMode(conv) !== 'orion') return false;
  const launchedConversationId = String(conv.launchedCoderConvId || '');
  const launchedTaskId = String(conv.launchedCoderTaskId || '');
  const runningConversationId = String(
    window.getRunningConversationId ? window.getRunningConversationId() || '' : ''
  );
  const activeRunTaskId = String(
    window.getActiveRunTaskId ? window.getActiveRunTaskId() || '' : ''
  );
  return !!(
    launchedConversationId
    && launchedTaskId
    && runningConversationId === launchedConversationId
    && activeRunTaskId === launchedTaskId
  );
}

async function cancelOwnedTaskRequestedInPrompt(conv, prompt, source = 'user-task-cancellation', semanticIntent = null) {
  if (
    !conv
    || conversationMode(conv) !== 'orion'
    || !semanticIntent
    || semanticIntent.intent !== 'cancel_active_task'
    || semanticIntent.target !== 'active_owned_task'
  ) {
    return { handled: false };
  }

  const result = await stopExpectedTaskForConversation(conv.id);
  const taskId = String(
    (result && result.task && result.task.taskId)
    || (result && result.taskId)
    || ''
  );
  const cancelled = !!(
    result
    && result.success
    && result.task
    && result.task.status === 'cancelled'
  );
  const stopped = !!(result && result.success && result.stopped);
  const success = cancelled || stopped;
  const taskTitle = String(result && result.task && result.task.title || 'Coder task');
  const replyText = success
    ? (cancelled
        ? `Cancelled **${taskTitle}**${taskId ? ` (${taskId})` : ''}. Its final state is cancelled.`
        : 'Stopped the active Orion response.')
    : `I could not cancel an owned task: ${(result && (result.error || result.reason)) || 'no cancellable task was found for this conversation'}.`;

  notifyOrionConversation(conv, replyText, source);
  return {
    ...(result && typeof result === 'object' ? result : {}),
    handled: true,
    success,
    cancelled,
    stopped,
    taskId
  };
}

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
    reasoningEffort: item.reasoningEffort,
    executionProfile: item.executionProfile,
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
  // Phase 3 of the Operator architecture plan: an explicitly-tagged operator conversation is
  // recognized directly, the same way 'orion'/'coder' already are, rather than falling through to
  // the projectPath-presence guess below (which predates operator and only distinguishes Coder
  // from Dispatch).
  if (conv.mode === 'orion' || conv.mode === 'coder' || conv.mode === 'operator') return conv.mode;
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
  const messages = Array.isArray(conv.messages) ? conv.messages.filter(isConversationMessageVisible) : [];
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
  if (mode === 'orion') {
    const focusResult = await window.beginNewFocus(activeConversationId);
    if (!focusResult || focusResult.success === false) {
      showToast('Could not cancel the pending work. The current focus was preserved.', 'error');
      return null;
    }
    startDispatchDraft();
    return null;
  }
  // Coder and Operator both get a real standalone conversation record. Operator previously had
  // no branch here at all, so calling this with 'operator' silently fell into the Dispatch-draft
  // path above and produced an 'orion' conversation instead — item 10 of the Operator
  // architecture plan.
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const title = 'New Conversation';

  const newConv = {
    id: newId,
    title: title,
    mode: mode === 'coder' || mode === 'operator' ? mode : 'orion',
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

function createStandaloneCoderConversation({ title = 'New Coder Task', workspacePath = '', select = false } = {}) {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const resolvedWorkspace = String(workspacePath || '').trim()
    || getStandaloneWorkspaceForTitle(title, newId);
  const newConv = {
    id: newId,
    title: title || 'New Coder Task',
    mode: 'coder',
    projectPath: '',
    workspace: resolvedWorkspace,
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

// Phase 3 piece 5 of the Operator architecture plan. Parallel to createCoderConversationForProject/
// createStandaloneCoderConversation above rather than a shared parameterized helper: those two are
// tiny and this keeps the 'operator' mode tag explicit at the literal call site instead of adding a
// role parameter two functions have to thread through, for a pair this small.
function createOperatorConversationForProject(projectPath, { title = 'New Operator Task', select = false } = {}) {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const newConv = {
    id: newId,
    title: title || 'New Operator Task',
    mode: 'operator',
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

function createStandaloneOperatorConversation({ title = 'New Operator Task', workspacePath = '', select = false } = {}) {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const resolvedWorkspace = String(workspacePath || '').trim()
    || getStandaloneWorkspaceForTitle(title, newId);
  const newConv = {
    id: newId,
    title: title || 'New Operator Task',
    mode: 'operator',
    projectPath: '',
    workspace: resolvedWorkspace,
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
  const requestedMode = mode === 'coder' || mode === 'operator' ? mode : 'orion';
  const normalizedProjectPath = String(projectPath || '').trim();
  const normalizedDispatchProjectPath = requestedMode === 'orion' ? String(dispatchProjectPath || '').trim() : '';
  const conv = {
    id: convId,
    title,
    // Coder remains the default owner for a project selected from the phone's project picker.
    // An explicit Operator request is different: Operator may be standalone or workspace-bound,
    // so preserve that role instead of silently coercing it into Dispatch or Coder.
    mode: requestedMode === 'operator' ? 'operator' : (normalizedProjectPath ? 'coder' : requestedMode),
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

// Item 9 (UI polish): the sidebar previously hardcoded every conversation's displayed age to the
// literal string 'now', regardless of how old it actually was. conversationSortTime already
// computes the best-available last-activity timestamp for a conversation (used for the >50
// stub-eviction sort); this turns that same timestamp into the short relative label the list
// actually needs.
function formatRelativeConversationTime(timestampMs) {
  const ts = Number(timestampMs) || 0;
  if (!ts) return 'new';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'now'; // clock skew or a timestamp set slightly ahead - never show a negative age
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diffMs < minute) return 'now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < week) return `${Math.floor(diffMs / day)}d`;
  if (diffMs < 5 * week) return `${Math.floor(diffMs / week)}w`;
  // Beyond ~a month, a relative count stops being useful at a glance - a short date reads better.
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

// Rehydrate the complete persisted record in place so callers holding the lightweight index
// object keep a valid reference. Actionable state such as delegated-plan approval ownership must
// survive a restart just as reliably as transcript messages.
function findDelegatedPlanMessage(conversation, taskId = '') {
  const expectedTaskId = String(taskId || '');
  return [...(Array.isArray(conversation && conversation.messages) ? conversation.messages : [])]
    .reverse()
    .find(message => message
      && message.isDelegatedPlanCard
      && message.delegatedPlan
      && (!expectedTaskId || String(message.delegatedPlan.taskId || '') === expectedTaskId)) || null;
}

function markDelegatedPlanMessageState(conversation, taskId, stateField) {
  const message = findDelegatedPlanMessage(conversation, taskId);
  if (message && stateField) message[stateField] = true;
  return message;
}

const LEGACY_DISPATCH_TASK_TITLE = 'Execute Dispatch request';

function reconcileConversationTaskPresentation(conversation, task) {
  if (!conversation || !task || !task.taskId || !task.title) return false;
  const originId = String(task.origin && task.origin.conversationId || '');
  const targetId = String(task.target && task.target.conversationId || '');
  const ownsTask = String(conversation.id || '') === originId
    || String(conversation.id || '') === targetId
    || String(conversation.launchedCoderTaskId || '') === String(task.taskId)
    || String(conversation.lastOrchestrationTaskId || '') === String(task.taskId);
  if (!ownsTask) return false;

  const canonicalTitle = String(task.title).trim();
  if (!canonicalTitle || canonicalTitle === LEGACY_DISPATCH_TASK_TITLE) return false;
  let changed = false;
  const replaceLegacyTitle = value => {
    const text = String(value || '');
    return text.includes(LEGACY_DISPATCH_TASK_TITLE)
      ? text.split(LEGACY_DISPATCH_TASK_TITLE).join(canonicalTitle)
      : text;
  };

  if (String(conversation.title || '').trim() === LEGACY_DISPATCH_TASK_TITLE) {
    conversation.title = canonicalTitle;
    changed = true;
  }
  if (String(conversation.launchedCoderTaskId || '') === String(task.taskId)
      && String(conversation.launchedCoderTaskTitle || '').trim() === LEGACY_DISPATCH_TASK_TITLE) {
    conversation.launchedCoderTaskTitle = canonicalTitle;
    changed = true;
  }
  if (conversation.lastDelegatedWork
      && String(conversation.lastDelegatedWork.taskId || '') === String(task.taskId)
      && String(conversation.lastDelegatedWork.title || '').trim() === LEGACY_DISPATCH_TASK_TITLE) {
    conversation.lastDelegatedWork.title = canonicalTitle;
    changed = true;
  }
  for (const field of ['dispatchDiscussionSummary', 'dispatchContextSummary']) {
    const next = replaceLegacyTitle(conversation[field]);
    if (next !== String(conversation[field] || '')) {
      conversation[field] = next;
      changed = true;
    }
  }

  for (const message of Array.isArray(conversation.messages) ? conversation.messages : []) {
    if (!message || typeof message.text !== 'string' || !message.text.includes(LEGACY_DISPATCH_TASK_TITLE)) continue;
    const taskBoundSource = [
      'dispatch-handoff',
      'queue-status',
      'supervisor-pending',
      'supervisor-completion',
      'supervisor-plan',
      'supervisor-plan-approved',
      'supervisor-plan-revision'
    ].includes(String(message.source || ''));
    const namesExactTask = message.text.includes(String(task.taskId));
    if (!taskBoundSource && !namesExactTask) continue;
    message.text = replaceLegacyTitle(message.text);
    changed = true;
  }
  if (changed) conversation.updatedAt = Date.now();
  return changed;
}

function scheduleTerminalDelegatedTaskReconciliation(conversation, durableTasks = orchestrationTaskCache) {
  if (!conversation || conversation.isStub || !durableTasks || typeof durableTasks.get !== 'function') return false;
  const taskId = String(conversation.launchedCoderTaskId || '');
  const coderConversationId = String(conversation.launchedCoderConvId || '');
  if (!taskId || !coderConversationId) return false;
  const task = durableTasks.get(taskId);
  if (!task || !['completed', 'failed', 'cancelled'].includes(String(task.status || ''))) return false;
  if (String(task.origin && task.origin.conversationId || '') !== String(conversation.id || '')) return false;
  if (String(task.target && task.target.conversationId || '') !== coderConversationId) return false;
  if (String(conversation._terminalTaskReconciliationScheduled || '') === taskId) return true;
  conversation._terminalTaskReconciliationScheduled = taskId;
  // Route by the target conversation's own role rather than always assuming Coder - the same fix
  // already applied to window.onOrchestrationTaskFinalized (Phase 3 piece 5) applies here too, for
  // the separate startup-reconciliation path: a terminal Operator task discovered at startup
  // (rather than during a live run) would otherwise still be reported as "Coder failed/completed."
  const targetConv = conversations.find(c => c.id === coderConversationId);
  const notifier = targetConv && conversationMode(targetConv) === 'operator'
    ? notifySupervisorOfOperatorCompletion
    : notifySupervisorOfCoderCompletion;
  Promise.resolve()
    .then(() => notifier(coderConversationId, taskId))
    .catch(error => console.error('Could not reconcile terminal delegated task presentation:', error))
    .finally(() => {
      if (String(conversation._terminalTaskReconciliationScheduled || '') === taskId) {
        delete conversation._terminalTaskReconciliationScheduled;
      }
    });
  return true;
}

function hydrateConversationRecord(
  conversation,
  persistedConversation,
  durableTasks = orchestrationTaskCache
) {
  if (!conversation || !persistedConversation || typeof persistedConversation !== 'object') {
    return conversation;
  }
  const stableId = conversation.id;
  Object.assign(conversation, persistedConversation);
  conversation.id = stableId;
  conversation.messages = Array.isArray(persistedConversation.messages) ? persistedConversation.messages : [];
  conversation.tasks = Array.isArray(persistedConversation.tasks) ? persistedConversation.tasks : [];
  conversation.isStub = false;
  conversation.hasMessages = conversation.messages.length > 0;
  if (durableTasks && typeof durableTasks.values === 'function') {
    for (const task of durableTasks.values()) {
      reconcileConversationTaskPresentation(conversation, task);
    }
  }
  if (!conversation.awaitingDelegatedPlan) {
    const planMessage = findDelegatedPlanMessage(conversation);
    const delegatedPlan = planMessage && planMessage.delegatedPlan;
    const taskId = String(delegatedPlan && delegatedPlan.taskId || '');
    const durableTask = taskId && durableTasks && typeof durableTasks.get === 'function'
      ? durableTasks.get(taskId)
      : null;
    const taskStatus = String(durableTask && durableTask.status || '');
    const originConversationId = String(durableTask && durableTask.origin && durableTask.origin.conversationId || '');
    if (delegatedPlan
        && !planMessage.delegatedPlanApproved
        && !planMessage.delegatedPlanDenied
        && !planMessage.delegatedPlanRevisionRequested
        && (taskStatus === 'pending' || taskStatus === 'active')
        && (!originConversationId || originConversationId === conversation.id)) {
      conversation.awaitingDelegatedPlan = delegatedPlan;
      conversation.awaitingPlanApprovalTaskId = taskId;
    }
  }
  scheduleTerminalDelegatedTaskReconciliation(conversation, durableTasks);
  return conversation;
}

// True only after the on-disk index has been read successfully this session. If startup
// crashes before that read, the in-memory list holds at most a freshly created conversation,
// and writing the index from it would clobber every persisted conversation stub.
let diskConversationIndexLoaded = false;

async function loadConversationsFromStorage() {
  const local = parseConversationStorageCandidate(localStorage.getItem('ag2_conversations'), 'ag2_conversations');
  const backup = parseConversationStorageCandidate(localStorage.getItem('ag2_conversations_backup'), 'ag2_conversations_backup');
  let disk = [];
  if (window.api && typeof window.api.readConversationsIndex === 'function') {
    try {
      const result = await window.api.readConversationsIndex();
      if (result && result.success && Array.isArray(result.index)) {
        disk = result.index;
        diskConversationIndexLoaded = true;
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
    // Phase 3 of the Operator architecture plan: this runs on every load (unlike the one-time
    // backfill above), so an operator-tagged conversation must count as already explicit here.
    // Without this, the inference below would silently stomp c.mode back to 'coder'/'orion' on
    // every single app start.
    const hasExplicitMode = c.mode === 'orion' || c.mode === 'coder' || c.mode === 'operator';
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
    if ((conversationMode(c) === 'coder' || conversationMode(c) === 'operator') && !c.projectPath && c.workspace && !isGeneratedStandaloneWorkspace(c.workspace)) {
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

function truncatePhoneTransportText(value, maxLength) {
  const text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value); } catch (_) { return String(value || ''); }
  })();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}\n...[trimmed for phone transport]`;
}

function compactPhoneToolParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  return Object.fromEntries(Object.entries(params).slice(0, 8).map(([key, value]) => [
    key,
    typeof value === 'string'
      ? truncatePhoneTransportText(value, 500)
      : truncatePhoneTransportText(value, 800)
  ]));
}

function compactPhoneToolLogs(logs, limit = 8) {
  return (Array.isArray(logs) ? logs : [])
    .filter(log => log && (log.type === 'tool_call' || log.tool || (log.type === 'thought' && log.content)))
    .slice(-limit)
    .map(log => ({
      type: log.type || 'tool_call',
      content: truncatePhoneTransportText(log.content || '', 1200),
      tool: log.tool || '',
      status: log.status || 'running',
      params: compactPhoneToolParams(log.params),
      result: truncatePhoneTransportText(log.result || '', 2400)
    }));
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
      launchedCoderTaskId: c.launchedCoderTaskId || '',
      lastOwnedTaskId: c.lastOwnedTaskId || '',
      lastOrchestrationTaskId: c.lastOrchestrationTaskId || '',
      launchedCoderTaskTitle: c.launchedCoderTaskTitle,
      launchedCoderTaskStart: c.launchedCoderTaskStart,
      lastDelegatedWork: c.lastDelegatedWork || null,
      planApproved: c.planApproved,
      awaitingPlanApproval: c.awaitingPlanApproval,
      awaitingPlanApprovalTaskId: c.awaitingPlanApprovalTaskId || '',
      awaitingDelegatedPlan: c.awaitingDelegatedPlan || null,
      planRevisionInProgress: c.planRevisionInProgress || null,
      revisingDelegatedPlan: c.revisingDelegatedPlan || null,
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
    if (typeof window.api.writeConversationsIndex === 'function' && diskConversationIndexLoaded) {
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
  // Dispatch (Orion), Coder, and Operator each keep their own standalone-conversation history --
  // a chat started in one never appears in another's list, even though none but Coder has a
  // projectPath.
  const listConfigs = [
    { container: el.conversationList, mode: 'orion' },
    { container: el.conversationListCoder, mode: 'coder' },
    { container: el.conversationListOperator, mode: 'operator' }
  ].filter(cfg => cfg.container);
  if (listConfigs.length === 0) return;

  listConfigs.forEach(({ container, mode }) => {
    container.innerHTML = '';

    const standaloneConversations = conversations.filter(c => {
      const convMode = conversationMode(c);
      if (convMode !== mode) return false;
      return mode !== 'coder' || !c.projectPath;
    });

    const query = String((conversationSearchQueries && conversationSearchQueries[mode]) || '').trim().toLowerCase();
    const visibleConversations = query
      ? standaloneConversations.filter(c => String(c.title || '').toLowerCase().includes(query))
      : standaloneConversations;

    if (visibleConversations.length === 0) {
      if (query) {
        container.innerHTML = '<p class="empty-state" style="font-size:0.75rem; font-style:italic;">No conversations match your search</p>';
      } else {
        container.innerHTML = mode === 'orion'
          ? '<p class="empty-state" style="font-size:0.75rem; font-style:italic;">No history yet</p>'
          : '<p class="empty-state" style="font-size:0.75rem; font-style:italic;">No standalone conversations yet</p>';
      }
      return;
    }

    visibleConversations.forEach(conv => {
      const item = document.createElement('div');
      item.className = `conversation-item ${conv.id === activeConversationId ? 'active' : ''}`;

      const age = formatRelativeConversationTime(conversationSortTime(conv));

      item.innerHTML = `
        <div class="conversation-details row-details-flex">
          <span class="conversation-name">${escapeHtml(conv.title)}</span>
          <span class="conversation-time">${age}</span>
        </div>
        <button class="rename-btn icon-btn-ghost icon-btn-spaced" title="Rename conversation">&#9998;</button>
        <button class="delete-btn icon-btn-ghost" title="Delete conversation">&times;</button>
      `;

      item.querySelector('.conversation-details').addEventListener('click', () => selectConversation(conv.id));

      item.querySelector('.rename-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        renameConversation(conv.id);
      });

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

// Item 9 (UI polish): manual rename. Distinct from the automatic first-message title generation
// in the send-prompt flow -- that only fires while a conversation still has zero messages and its
// default "New Conversation" title; this lets the user override the title at any point after.
function renameConversation(id) {
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  const currentTitle = conv.title || 'New Conversation';
  const newTitle = prompt('Rename conversation to:', currentTitle);
  if (newTitle == null) return; // cancelled
  const trimmed = newTitle.trim();
  if (!trimmed || trimmed === currentTitle) return;
  conv.title = trimmed.slice(0, 200);
  conv.updatedAt = Date.now();
  if (activeConversationId === id && el.chatTitle) el.chatTitle.textContent = conv.title;
  renderConversationList();
  if (typeof saveConversationsToStorage === 'function') saveConversationsToStorage();
}

async function selectConversation(id, options = {}) {
  const suppliedEpoch = Number(options.selectionEpoch);
  let selectionEpoch = Number.isFinite(suppliedEpoch)
    ? suppliedEpoch
    : ++conversationSelectionEpoch;
  activeConversationId = id;
  if (window.clearOrionMemoryInactivityTimer) window.clearOrionMemoryInactivityTimer();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  const targetMode = conversationMode(conv);
  if (appMode !== targetMode) {
    // Selecting a conversation is an explicit navigation action. Keep the mode chrome and the
    // selected transcript atomic so a Coder conversation cannot be displayed inside Dispatch
    // (or vice versa) until the next background refresh flips it back.
    setAppMode(targetMode);
    selectionEpoch = conversationSelectionEpoch;
  }

  if (targetMode === 'orion') {
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
        if (activeConversationId !== id || conversationSelectionEpoch !== selectionEpoch) return;

        if (result && result.success && result.conversation) {
          hydrateConversationRecord(conv, result.conversation);
        } else {
          el.messagesContainer.innerHTML = `<div class="error-state" style="text-align:center; padding:20px; color:var(--red);">Failed to load conversation</div>`;
          return;
        }
      }
    } catch (err) {
      if (activeConversationId !== id || conversationSelectionEpoch !== selectionEpoch) return;
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

  if (activeConversationId !== id || conversationSelectionEpoch !== selectionEpoch) return;

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
    
    const replayMessages = conv.messages
      .filter(isConversationMessageVisible)
      .map(normalizeConversationMessageForReplay);
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
  if (desktopPromptSubmissionInFlight) return;
  desktopPromptSubmissionInFlight = true;
  try {

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
    } else if (conversationMode(conv) === 'coder' || conversationMode(conv) === 'operator') {
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
  const currentMessageId = conv.messages[conv.messages.length - 1]?.id || '';
  const semanticIntent = await classifyCurrentConversationIntent(conv, prompt, {
    model: el.modelSelect.value,
    taskId: conv.awaitingPlanApprovalTaskId || ''
  });

  // A Dispatch cancellation is a lifecycle command, not another model prompt.
  // Resolve it before clarification routing, the global busy queue, or supervisor
  // steering so an owned pending/running task is deterministically stopped.
  const cancellation = await cancelOwnedTaskRequestedInPrompt(
    conv,
    prompt,
    'dispatch-task-cancellation',
    semanticIntent
  );
  if (cancellation.handled) return;

  // Free-text plan decisions are model-classified, then validated and applied by the same
  // deterministic task/plan-ID-bound handlers used by the UI buttons.
  if (conversationMode(conv) === 'orion' && conv.awaitingDelegatedPlan
      && ['approve_plan', 'deny_plan', 'revise_plan'].includes(semanticIntent.intent)) {
    const delegatedPlan = conv.awaitingDelegatedPlan;
    const result = semanticIntent.intent === 'approve_plan'
      ? await window.approvePhoneCompanionPlan(conv.id)
      : (semanticIntent.intent === 'deny_plan'
          ? await window.denyPhoneCompanionPlan(conv.id)
          : await window.revisePhoneCompanionPlan({
              conversationId: delegatedPlan.coderConversationId,
              feedback: semanticIntent.resolvedRequest || prompt
            }));
    if (!result || result.success === false) {
      persistAssistantStatusMessage(
        conv.id,
        `Could not apply that plan decision: ${(result && result.error) || 'unknown error'}`,
        { source: 'supervisor-plan-error', dedupeKey: `plan-revision-error-${delegatedPlan.taskId}` }
      );
    }
    return;
  }

  // ── Supervisor interception: Orion message while a supervised Coder task runs ──
  // "Continue" is a lifecycle command when this Dispatch conversation already owns paused or
  // active Coder work. Resolve it before the model can interpret stale chat context and issue a
  // second handoff. A failed lookup is also terminal for this turn: uncertainty must never create
  // a duplicate task.
  const ownedContinuation = await resumeOwnedCoderTaskFromDispatch(conv, prompt, {
    messageId: currentMessageId,
    modelSelectValue: el.modelSelect.value,
    images: imagesToSend,
    source: 'desktop-dispatch-continuation',
    semanticIntent
  });
  if (ownedContinuation.handled) return;

  if (window.runAgentLoop) {
    const selectedModel = el.modelSelect.value;
    const pendingReplyTaskId = String(
      conv.awaitingPlanApprovalTaskId
      || (conv.awaitingClarification && conv.awaitingClarification.taskId)
      || ''
    );
    const runOptions = {
      ...(imagesToSend.length ? { images: imagesToSend } : {}),
      ...(pendingReplyTaskId ? { taskId: pendingReplyTaskId, preserveUserPrompt: true } : {}),
      semanticIntent
    };
    if (conv.awaitingClarification && pendingReplyTaskId) {
      const clarificationState = conv.awaitingClarification;
      const continuation = await queueTaskContinuation({
        taskId: pendingReplyTaskId,
        prompt,
        modelSelectValue: selectedModel,
        targetConversationId: conv.id,
        originConversationId: conv.id,
        source: 'free-text-clarification',
        alreadyRendered: true,
        images: imagesToSend,
        originMessageId: conv.messages[conv.messages.length - 1]?.id || ''
      });
      if (!continuation.success) {
        conv.awaitingClarification = clarificationState;
        saveConversationsToStorage();
        persistAssistantStatusMessage(conv.id, continuation.error || 'Could not attach that answer to the waiting task.', {
          source: 'clarification-error',
          dedupeKey: `clarification-error-${pendingReplyTaskId}`
        });
        return;
      }
      conv.awaitingClarification = null;
      saveConversationsToStorage();
      const launch = startOrQueueTaskContinuation(continuation, conv, {
        source: 'free-text-clarification',
        modelSelectValue: selectedModel,
        errorLabel: 'Free-text clarification resume'
      });
      if (launch.queued) {
        persistAssistantStatusMessage(conv.id, 'Answer saved. Orion will continue this task after the current work finishes.', {
          source: 'queue-status',
          dedupeKey: `free-text-clarification-${pendingReplyTaskId}`
        });
      }
      return;
    }

    if (window.isAgentRunning && window.isAgentRunning()) {
      // Intercept only when both halves of the durable launch identity match.
      // A reused Coder conversation ID must not let a stale Dispatch task steer
      // or cancel a different active run.
      if (ownsActiveSupervisedRun(conv)) {
        await handleSupervisorMessage(conv, prompt, selectedModel, {
          messageId: conv.messages[conv.messages.length - 1]?.id || '',
          images: imagesToSend,
          semanticIntent
        });
        return;
      }

      if (conversationMode(conv) === 'orion'
          && RendererSemanticIntentRouter
          && RendererSemanticIntentRouter.canRespondDuringActiveRun(semanticIntent, 'orion')) {
        await respondOrionConversationally(conv, prompt, selectedModel, {
          messageId: currentMessageId,
          images: imagesToSend,
          semanticIntent,
          statusCheckin: semanticIntent.intent === 'status_check'
            && semanticIntent.target === 'active_owned_task'
        });
        return;
      }

      // Default: queue as normal
      const queued = pendingReplyTaskId
        ? await queueTaskContinuation({
            taskId: pendingReplyTaskId,
            prompt,
            modelSelectValue: selectedModel,
            targetConversationId: conv.id,
            originConversationId: conv.id,
            source: 'user-continuation',
            alreadyRendered: true,
            images: imagesToSend,
            originMessageId: conv.messages[conv.messages.length - 1]?.id || '',
            semanticIntent
          })
        : await enqueueOrchestrationTask({
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
  } finally {
    desktopPromptSubmissionInFlight = false;
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
  // Titles are display formatting, not a second intent classifier. Preserve the user's wording
  // and apply only mechanical whitespace/length normalization.
  let text = String(prompt || '').replace(/\s+/g, ' ').trim();

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
        `<img class="user-message-image" src="data:${escapeHtml(img.mimeType)};base64,${img.data}" alt="attached image" `
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
  wireChatImageOpeners(bubble);
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

// Last push delivery result, recorded by agent.js after every run-end notification.
//
// Push failure had no visible symptom on the desktop: a phone that never subscribed and a phone
// that got the notification looked identical from here, so "notifications don't work" could only
// be diagnosed by reading source. notifyAllPhoneDevices already returns a precise reason
// ("no subscribed phone devices", "web-push not available") — it was simply thrown away.
let lastPhonePushOutcome = null;

function describeLastPhonePush() {
  if (!lastPhonePushOutcome) return '';
  if (lastPhonePushOutcome.delivered) {
    const count = lastPhonePushOutcome.sent || 1;
    return ` Last push: delivered to ${count} device${count === 1 ? '' : 's'}.`;
  }
  const reason = String(lastPhonePushOutcome.reason || '').trim();
  // "no subscribed phone devices" is the signature of an insecure origin: the companion page
  // refuses to subscribe outside a secure context, so nothing ever registered.
  const hint = /no subscribed phone devices/i.test(reason)
    ? ' The phone has not subscribed — open the companion over its HTTPS URL and allow notifications.'
    : '';
  return ` Last push FAILED${reason ? `: ${reason}` : ''}.${hint}`;
}

function updatePhonePushDiagnostic(outcome) {
  lastPhonePushOutcome = outcome || null;
  // Re-render just the meta line; a full panel refresh would need a fresh pairing payload.
  if (el.phoneCompanionMeta && el.phoneCompanionMeta.textContent) {
    const base = el.phoneCompanionMeta.textContent.replace(/ Last push[^]*$/, '');
    el.phoneCompanionMeta.textContent = `${base}${describeLastPhonePush()}`;
  }
}
window.updatePhonePushDiagnostic = updatePhonePushDiagnostic;

function updatePhoneCompanionPairingPanel(payload = {}) {
  const pairUrl = String(payload.pairUrl || '');
  const networkEnabled = payload.networkEnabled !== false && !!pairUrl;
  const secureEnabled = payload.preferredUrlType === 'https' || /^https:\/\//i.test(pairUrl);
  const secureUnavailable = !!payload.secureOrigin && payload.secureOriginReachable === false;
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
      ? `${expiresText}. ${secureEnabled
        ? 'HTTPS enabled for phone notifications.'
        : secureUnavailable
          ? 'The configured HTTPS route is unavailable, so Orion is using a reachable direct route without discarding paired access.'
          : 'Live view only; add an HTTPS phone URL in Settings for mobile notifications.'}${describeLastPhonePush()}`
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
  const secureUnavailable = !!payload.secureOrigin && payload.secureOriginReachable === false;
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
          <div style="color: var(--text-muted); margin-bottom:8px;">${secureEnabled
            ? 'This HTTPS link can request phone notifications. Add the clean URL to your home screen after pairing.'
            : secureUnavailable
              ? 'The saved HTTPS route is not responding. Orion is showing a reachable direct link and will preserve existing paired-device credentials.'
              : 'This local link keeps live view working. Add a Secure Phone URL in Settings to enable background notifications.'}</div>
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
  const responseImagesHtml = renderAssistantResponseImages(msgMeta && msgMeta.images, targetId);
  
  let runningIndicatorHtml = '';
  let planApprovalHtml = '';
  let clarificationHtml = '';
  // Decide whether THIS bubble is the plan-approval card. On a fresh live render the message
  // object is not threaded in, so fall back to conversation state (the active bubble during a
  // planning yield is the plan bubble). On reloads the persisted msgMeta.isPlanApprovalCard
  // identifies the exact bubble so the card does not bleed onto execution bubbles.
  const delegatedPlan = msgMeta && msgMeta.delegatedPlan;
  const isPlanBubble = msgMeta
    ? !!(msgMeta.isPlanApprovalCard || msgMeta.isDelegatedPlanCard)
    : !!(activeConv && activeConv.awaitingPlanApproval && !activeConv.planApproved);
  if (isPlanBubble) {
    const delegatedPlanApproved = !!(delegatedPlan && msgMeta.delegatedPlanApproved);
    const delegatedPlanPending = !!(
      delegatedPlan
      && activeConv
      && activeConv.awaitingDelegatedPlan
      && activeConv.awaitingDelegatedPlan.taskId === delegatedPlan.taskId
    );
    if ((activeConv && activeConv.planApproved) || delegatedPlanApproved) {
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
    } else if ((delegatedPlanPending || (activeConv && activeConv.awaitingPlanApproval))
        && !(window.isAgentRunning && window.isAgentRunning())) {
      planApprovalHtml = `
        <div class="plan-approval-actions">
          <div class="plan-approval-copy">
            <span class="plan-approval-title">Plan ready for review</span>
            <span class="plan-approval-subtitle">Start when the direction looks right.</span>
          </div>
          <button class="btn-approve-plan" type="button">${delegatedPlan ? 'Approve & Continue' : 'Start Implementation'}</button>
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
    const statusLabel = buildAgentStatusLabel(executionMode, stepNum, isApproved);
      
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
  
  // Prefer the message's stored send time; replayed transcripts must not restamp every bubble
  // with the render-time clock. Date.now() is correct only for a brand-new bubble with no
  // persisted message behind it (ad-hoc status replies).
  const aiMsgTs = msgMeta ? Number(msgMeta.createdAt || msgMeta.timestamp || msgMeta.updatedAt) || 0 : 0;
  const aiMsgTime = aiMsgTs ? formatMsgTime(aiMsgTs) : (isNew && !msgMeta ? formatMsgTime(Date.now()) : '');
  bubble.innerHTML = `
    <div class="message-header ai">
      <span>✦ Orion AI</span>
      ${aiMsgTime ? `<span class="msg-timestamp">${aiMsgTime}</span>` : ''}
    </div>
    ${logsHtml}
    <div class="message-body">
      ${renderedMarkdown}
      ${responseImagesHtml}
      ${walkthroughHtml}
      ${inlineArtifactsHtml}
      ${clarificationHtml}
      ${planApprovalHtml}
      ${runningIndicatorHtml}
    </div>
  `;
  sanitizeRenderedMarkdown(bubble);
  hydrateAssistantResponseImages(bubble);
  wireChatImageOpeners(bubble);

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
    approveButton.addEventListener('click', () => {
      if (delegatedPlan) {
        approveDelegatedPlanAndContinue(delegatedPlan, msgMeta, { button: approveButton });
      } else {
        approveCurrentPlanAndContinue({ button: approveButton });
      }
    });
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
  
  // `result.code === 0` alone collapsed four very different outcomes into "tests failed":
  // a genuine failure, a timeout, a killed process, and a runner that never started. The agent
  // saw `{success:false, output:"........"}` — passing pytest dots with no explanation — and
  // could not tell "my change broke tests" from "the command never ran", so it re-ran tests
  // through run_command instead of trusting its own tool.
  const exitCode = result.code;
  const neverRan = !!result.error || exitCode === null || exitCode === undefined;
  const success = exitCode === 0 && !result.timedOut && !result.killed && !result.error;

  let outcome = 'passed';
  if (result.timedOut) outcome = 'timed_out';
  else if (result.killed) outcome = 'killed';
  else if (neverRan) outcome = 'did_not_run';
  else if (!success) outcome = 'failed';

  const command = getEffectiveTestCommand();
  const diagnosis = {
    passed: '',
    failed: `The test command exited with code ${exitCode}. This is a real test failure — read the output above.`,
    timed_out: `The test command did not finish within ${appConfig.commandTimeoutMs || 120000}ms and was stopped. This is NOT a test failure; the suite may just be slow, or the command may be waiting on input.`,
    killed: 'The test process was stopped before it finished. This is NOT a test failure.',
    did_not_run: `The test command could not be run${result.error ? ` (${result.error})` : ''}. This is NOT a test failure — check that \`${command}\` is the right command for this workspace.`
  }[outcome];

  const testRunInfo = {
    output: [testOutput, diagnosis].filter(Boolean).join('\n\n') || `Exit code: ${exitCode}`,
    success,
    outcome,
    ranToCompletion: !neverRan && !result.timedOut && !result.killed,
    exitCode: exitCode === undefined ? null : exitCode,
    command,
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
  const clarificationTaskId = String(clarData.taskId || '');

  // Supervisor proxy: if these answers belong to a Coder conversation, relay them there
  const relayConvId = clarData._relayToConvId;
  if (relayConvId) {
    const coderConv = conversations.find(c => c.id === relayConvId);
    if (!coderConv) {
      if (button) {
        button.disabled = false;
        button.textContent = 'Submit';
      }
      return;
    }

    const coderClarificationState = coderConv.awaitingClarification;
    coderConv.awaitingClarification = null;
    conv.awaitingClarification = null;
    const messageId = createConversationMessageId(coderConv.id);
    coderConv.messages.push({ id: messageId, role: 'user', text: userMessage, source: 'clarification-answers' });
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();

    const continuation = await queueTaskContinuation({
      taskId: clarificationTaskId,
      prompt: userMessage,
      resolvedObjective: `Continue the existing task using these clarification answers:\n${formattedAnswers}`,
      title: `Continue after clarification: ${coderConv.title || 'Coder task'}`,
      modelSelectValue: el.modelSelect.value,
      targetConversationId: relayConvId,
      originConversationId: targetId,
      originMessageId: messageId,
      workspace: structuredWorkspaceForConversation(coderConv),
      source: 'clarification-answers'
    });
    if (!continuation.success) {
      coderConv.awaitingClarification = coderClarificationState;
      conv.awaitingClarification = clarData;
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
      if (button) {
        button.disabled = false;
        button.textContent = 'Submit';
      }
      return;
    }
    appendSystemMessage('Answers relayed to Coder.', { conversationId: targetId });
    if (window.isAgentRunning && window.isAgentRunning()) {
      persistAssistantStatusMessage(targetId, 'Queued. Coder will continue once the current task finishes.', {
        source: 'queue-status',
        dedupeKey: `clarification-proxy-queued-${continuation.task.taskId}`
      });
      return;
    }
    window.promptQueue = window.promptQueue.filter(item => item.taskId !== continuation.task.taskId);
    window.runAgentLoop(continuation.queueItem.prompt, continuation.queueItem.modelSelectValue || el.modelSelect.value, coderConv, {
      source: 'clarification-answers',
      internalPrompt: true,
      taskId: continuation.task.taskId,
      reasoningEffort: continuation.queueItem.reasoningEffort,
      executionProfile: continuation.queueItem.executionProfile,
      images: continuation.queueItem.images || [],
      contextPacketIds: continuation.queueItem.contextPacketIds || []
    }).catch(err => console.error('Proxied clarification resume failed:', err));
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

  const supervisingConversation = conversations.find(item => item.launchedCoderConvId === targetId);
  const continuation = await queueTaskContinuation({
    taskId: clarificationTaskId,
    prompt: userMessage,
    resolvedObjective: `Continue the existing task using these clarification answers:\n${formattedAnswers}`,
    title: `Continue after clarification: ${conv.title || 'task'}`,
    modelSelectValue: el.modelSelect.value,
    targetConversationId: targetId,
    originConversationId: supervisingConversation ? supervisingConversation.id : targetId,
    workspace: structuredWorkspaceForConversation(conv),
    source: 'clarification-answers'
  });
  if (!continuation.success) {
    conv.awaitingClarification = clarData;
    saveConversationsToStorage();
    if (button) {
      button.disabled = false;
      button.textContent = 'Submit';
    }
    return;
  }
  if (window.isAgentRunning && window.isAgentRunning()) {
    persistAssistantStatusMessage(targetId, 'Queued. Orion will continue once the current task finishes.', {
      source: 'queue-status',
      dedupeKey: `clarification-answers-queued-${continuation.task.taskId}`
    });
    return;
  }
  window.promptQueue = window.promptQueue.filter(item => item.taskId !== continuation.task.taskId);
  window.runAgentLoop(continuation.queueItem.prompt, continuation.queueItem.modelSelectValue || el.modelSelect.value, conv, {
    source: 'clarification-answers',
    internalPrompt: true,
    taskId: continuation.task.taskId,
    reasoningEffort: continuation.queueItem.reasoningEffort,
    executionProfile: continuation.queueItem.executionProfile,
    images: continuation.queueItem.images || [],
    contextPacketIds: continuation.queueItem.contextPacketIds || []
  }).catch(err => console.error('Clarification resume failed:', err));
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
      const promoteProject = options.promoteProject === true || (options.promoteProject !== false && (conversationMode(conv) === 'coder' || conversationMode(conv) === 'operator'));
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
  const standalone = options.standalone === true;
  const prompt = String(options.prompt || '').trim();
  const originalUserMessage = String(options.originalUserMessage || prompt).trim();
  const title = String(options.title || '').trim()
    || (prompt ? generateConversationTitle(prompt) : 'New Coder Task');
  const originConv = conversations.find(item => item.id === String(options.sourceConversationId || ''));
  if (originConv) clearCurrentTurnTaskResolutionClarifications(originConv);
  const semanticIntent = options.semanticIntent || (originConv && prompt
    ? await classifyCurrentConversationIntent(originConv, originalUserMessage, { model: options.modelSelectValue })
    : null);
  const standaloneSystemOperation = standalone && (
    options.standaloneSystemOperation === true
    || !!(semanticIntent && semanticIntent.standaloneSystemOperation)
  );
  let standaloneWorkspacePath = '';
  if (standalone) {
    if (standaloneSystemOperation) {
      try {
        const homeDir = await window.api.getHomeDir();
        standaloneWorkspacePath = typeof homeDir === 'string' ? homeDir.trim() : '';
      } catch (_) {}
    } else {
      standaloneWorkspacePath = String(options.path || '').trim()
        || getStandaloneWorkspaceForTitle(
          title,
          `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        );
    }
  }
  const folderPath = String(
    (standalone ? standaloneWorkspacePath : options.path)
    || currentWorkspace
    || (standalone ? getDispatchWorkspaceRoot() : '')
  ).trim();
  if (!folderPath) return { success: false, error: 'No workspace path to promote.' };
  let preflightTask = options.taskPacket && RendererTaskOrchestration
    ? RendererTaskOrchestration.normalizeTaskRecord(options.taskPacket)
    : null;
  const handoffWorkspace = {
    role: standalone ? 'standalone_coder' : 'active_project',
    path: folderPath,
    project: {
      name: standalone ? '' : (folderPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || ''),
      path: standalone ? '' : folderPath
    },
    source: standalone ? 'standalone-dispatch-handoff' : 'dispatch-handoff',
    resolved: true
  };
  if (prompt && RendererTaskOrchestration && !preflightTask) {
    const executionProfile = captureTaskExecutionProfile(options);
    const preflight = RendererTaskOrchestration.buildTaskPacket({
      originalUserMessage,
      resolvedObjective: String(options.resolvedObjective || '').trim()
        || (semanticIntent && semanticIntent.resolvedRequest)
        || prompt,
      title,
      precedingMessages: taskContextMessages(originConv),
      precedingConversationSummary: String(options.precedingConversationSummary || ''),
      workspace: handoffWorkspace,
      requirements: [
        ...(Array.isArray(options.requirements) ? options.requirements : []),
        ...(Array.isArray(options.findings) ? options.findings : [])
      ],
      constraints: Array.isArray(options.constraints) ? options.constraints : [],
      unresolvedDecisions: Array.isArray(options.unresolvedDecisions) ? options.unresolvedDecisions : [],
      originConversationId: String(options.sourceConversationId || ''),
      originSessionId: String(options.sourceSessionId || ''),
      originMessageId: String(options.sourceMessageId || ''),
      targetConversationId: 'pending-coder-conversation',
      targetMode: 'coder',
      source: 'dispatch-handoff',
      semanticIntent,
      executionProfile,
      timestamp: Date.now()
    });
    if (!preflight.success || !preflight.task) {
      const clarification = preflight.clarification || 'What specific work should I hand to Coder?';
      if (originConv) persistTaskClarification(originConv, clarification);
      return { success: false, needsClarification: true, error: clarification };
    }
    preflightTask = preflight.task;
  }

  if (!standalone) addProjectPath(folderPath);
  const conv = standalone
    ? createStandaloneCoderConversation({
        title,
        workspacePath: folderPath,
        select: options.open === true
      })
    : createCoderConversationForProject(folderPath, {
        title,
        select: options.open === true
      });

  const requestedPacketIds = Array.isArray(options.contextPacketIds)
    ? [...new Set(options.contextPacketIds.map(String).filter(Boolean))].slice(-5)
    : [];
  let assignedPacketIds = [];
  let contextTransferError = '';
  let createdTask = null;
  const handoffWarnings = [];
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
    const handoffTask = await enqueueOrchestrationTask({
      prompt: queuedPrompt,
      originalUserMessage: (preflightTask && preflightTask.originalUserMessage) || originalUserMessage,
      resolvedObjective: preflightTask ? preflightTask.objective : queuedPrompt,
      title,
      targetConversationId: conv.id,
      originConversationId: String(options.sourceConversationId || conv.id),
      originSessionId: String(options.sourceSessionId || ''),
      originMessageId: String(options.sourceMessageId || ''),
      precedingMessages: taskContextMessages(originConv || conv),
      precedingConversationSummary: preflightTask ? preflightTask.precedingConversationSummary : '',
      workspace: handoffWorkspace,
      requirements: preflightTask
        ? [...new Set([...(preflightTask.requirements || []), ...looseFindings])]
        : looseFindings,
      constraints: preflightTask ? preflightTask.constraints : [],
      semanticIntent,
      unresolvedDecisions: preflightTask ? preflightTask.unresolvedDecisions : [],
      source: 'dispatch-handoff',
      modelSelectValue: (preflightTask && preflightTask.executionProfile && preflightTask.executionProfile.requestedModel)
        || window.getSelectedModel(),
      reasoningEffort: (preflightTask && preflightTask.executionProfile && preflightTask.executionProfile.requestedReasoning)
        || appConfig.reasoningEffort
        || 'auto',
      executionProfile: (preflightTask && preflightTask.executionProfile)
        || captureTaskExecutionProfile(options),
      contextPacketIds: assignedPacketIds,
      createdAt: Date.now()
    });
    if (!handoffTask.success) {
      conversations = conversations.filter(item => item.id !== conv.id);
      saveConversationsToStorage();
      return {
        success: false,
        needsClarification: !!handoffTask.needsClarification,
        error: handoffTask.clarification || handoffTask.error || 'The handoff task could not be resolved.'
      };
    }
    conv.lastOrchestrationTaskId = handoffTask.task.taskId;
    if (originConv) originConv.lastOwnedTaskId = handoffTask.task.taskId;
    createdTask = handoffTask.task;
    if (handoffTask.warning) handoffWarnings.push(handoffTask.warning);
    try {
      persistAssistantStatusMessage(conv.id, `Queued from Dispatch as ${handoffTask.task.title}. Coder will start when the current turn finishes.`, {
        source: 'queue-status',
        dedupeKey: `dispatch-handoff-${handoffTask.task.taskId}`
      });
    } catch (error) {
      // The durable task is already committed. A presentation/persistence warning must not turn
      // this into a false handoff failure that prompts a duplicate retry.
      handoffWarnings.push(`The task was queued, but its Coder status message could not be saved: ${error.message || error}`);
    }
  }

  try {
    renderProjectsList();
    renderConversationList();
  } catch (error) {
    handoffWarnings.push(`The handoff was queued, but the conversation list could not refresh: ${error.message || error}`);
  }
  return {
    success: true,
    projectPath: standalone ? '' : folderPath,
    workspacePath: folderPath,
    standalone,
    conversationId: conv.id,
    title: conv.title,
    queued: !!prompt,
    taskId: createdTask ? createdTask.taskId : '',
    status: createdTask ? createdTask.status : (prompt ? 'pending' : 'completed'),
    task: createdTask,
    queueItem: createdTask
      ? (window.promptQueue || []).find(item => item && item.taskId === createdTask.taskId) || null
      : null,
    contextPacketIds: assignedPacketIds,
    contextTransferred: assignedPacketIds.length > 0,
    contextTransferError,
    committedWithWarning: handoffWarnings.length > 0,
    warning: handoffWarnings.join(' ')
  };
};

// Phase 3 piece 5 of the Operator architecture plan. Deliberate close parallel of
// window.promoteWorkspaceToCoder above rather than a generalized/parameterized version of it: the
// underlying machinery this delegates to (RendererTaskOrchestration.buildTaskPacket, which already
// takes a free targetMode string; enqueueOrchestrationTask; captureTaskExecutionProfile;
// taskContextMessages) was already role-generic before this piece, so the only things that
// actually differ below are the literal 'operator' mode tag, the operator conversation
// constructors, and role-specific copy (title default, status message). Generalizing
// promoteWorkspaceToCoder itself into a shared role-parameterized function would touch a large,
// working, Coder-battle-tested function for a payoff this small — the "write a parallel one"
// option from the brief, not the "reuse/generalize" one.
window.promoteWorkspaceToOperator = async function(options = {}) {
  const standalone = options.standalone === true;
  const prompt = String(options.prompt || '').trim();
  const originalUserMessage = String(options.originalUserMessage || prompt).trim();
  const title = String(options.title || '').trim()
    || (prompt ? generateConversationTitle(prompt) : 'New Operator Task');
  const originConv = conversations.find(item => item.id === String(options.sourceConversationId || ''));
  if (originConv) clearCurrentTurnTaskResolutionClarifications(originConv);
  const semanticIntent = options.semanticIntent || (originConv && prompt
    ? await classifyCurrentConversationIntent(originConv, originalUserMessage, { model: options.modelSelectValue })
    : null);
  const standaloneSystemOperation = standalone && (
    options.standaloneSystemOperation === true
    || !!(semanticIntent && semanticIntent.standaloneSystemOperation)
  );
  let standaloneWorkspacePath = '';
  if (standalone) {
    if (standaloneSystemOperation) {
      try {
        const homeDir = await window.api.getHomeDir();
        standaloneWorkspacePath = typeof homeDir === 'string' ? homeDir.trim() : '';
      } catch (_) {}
    } else {
      standaloneWorkspacePath = String(options.path || '').trim()
        || getStandaloneWorkspaceForTitle(
          title,
          `operator_handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        );
    }
  }
  const folderPath = String(
    (standalone ? standaloneWorkspacePath : options.path)
    || currentWorkspace
    || (standalone ? getDispatchWorkspaceRoot() : '')
  ).trim();
  if (!folderPath) return { success: false, error: 'No workspace path to promote.' };
  let preflightTask = options.taskPacket && RendererTaskOrchestration
    ? RendererTaskOrchestration.normalizeTaskRecord(options.taskPacket)
    : null;
  // role stays 'active_project'/'standalone_coder' even for Operator: those are WorkspaceResolution's
  // own KINDS constants (see workspace-resolution.js), and piece 2's classifyWorkspace fix already
  // made 'operator' mode classify identically to 'coder' mode — there is no separate "standalone
  // operator" kind, by design.
  const handoffWorkspace = {
    role: standalone ? 'standalone_coder' : 'active_project',
    path: folderPath,
    project: {
      name: standalone ? '' : (folderPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || ''),
      path: standalone ? '' : folderPath
    },
    source: standalone ? 'standalone-dispatch-operator-handoff' : 'dispatch-operator-handoff',
    resolved: true
  };
  if (prompt && RendererTaskOrchestration && !preflightTask) {
    const executionProfile = captureTaskExecutionProfile(options);
    const preflight = RendererTaskOrchestration.buildTaskPacket({
      originalUserMessage,
      resolvedObjective: String(options.resolvedObjective || '').trim()
        || (semanticIntent && semanticIntent.resolvedRequest)
        || prompt,
      title,
      precedingMessages: taskContextMessages(originConv),
      precedingConversationSummary: String(options.precedingConversationSummary || ''),
      workspace: handoffWorkspace,
      requirements: [
        ...(Array.isArray(options.requirements) ? options.requirements : []),
        ...(Array.isArray(options.findings) ? options.findings : [])
      ],
      constraints: Array.isArray(options.constraints) ? options.constraints : [],
      unresolvedDecisions: Array.isArray(options.unresolvedDecisions) ? options.unresolvedDecisions : [],
      originConversationId: String(options.sourceConversationId || ''),
      originSessionId: String(options.sourceSessionId || ''),
      originMessageId: String(options.sourceMessageId || ''),
      targetConversationId: 'pending-operator-conversation',
      targetMode: 'operator',
      source: 'dispatch-operator-handoff',
      semanticIntent,
      executionProfile,
      timestamp: Date.now()
    });
    if (!preflight.success || !preflight.task) {
      const clarification = preflight.clarification || 'What specific work should I hand to Operator?';
      if (originConv) persistTaskClarification(originConv, clarification);
      return { success: false, needsClarification: true, error: clarification };
    }
    preflightTask = preflight.task;
  }

  if (!standalone) addProjectPath(folderPath);
  const conv = standalone
    ? createStandaloneOperatorConversation({
        title,
        workspacePath: folderPath,
        select: options.open === true
      })
    : createOperatorConversationForProject(folderPath, {
        title,
        select: options.open === true
      });

  const requestedPacketIds = Array.isArray(options.contextPacketIds)
    ? [...new Set(options.contextPacketIds.map(String).filter(Boolean))].slice(-5)
    : [];
  let assignedPacketIds = [];
  let contextTransferError = '';
  let createdTask = null;
  const handoffWarnings = [];
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
    const looseFindings = Array.isArray(options.findings)
      ? options.findings.map(f => String(f || '').trim()).filter(Boolean).slice(0, 12)
      : [];
    const queuedPrompt = (assignedPacketIds.length === 0 && looseFindings.length > 0)
      ? `${prompt}\n\nFindings from Dispatch's prior investigation (verify before relying on them):\n${looseFindings.map(f => `- ${f}`).join('\n')}`
      : prompt;
    const handoffTask = await enqueueOrchestrationTask({
      prompt: queuedPrompt,
      originalUserMessage: (preflightTask && preflightTask.originalUserMessage) || originalUserMessage,
      resolvedObjective: preflightTask ? preflightTask.objective : queuedPrompt,
      title,
      targetConversationId: conv.id,
      originConversationId: String(options.sourceConversationId || conv.id),
      originSessionId: String(options.sourceSessionId || ''),
      originMessageId: String(options.sourceMessageId || ''),
      precedingMessages: taskContextMessages(originConv || conv),
      precedingConversationSummary: preflightTask ? preflightTask.precedingConversationSummary : '',
      workspace: handoffWorkspace,
      requirements: preflightTask
        ? [...new Set([...(preflightTask.requirements || []), ...looseFindings])]
        : looseFindings,
      constraints: preflightTask ? preflightTask.constraints : [],
      semanticIntent,
      unresolvedDecisions: preflightTask ? preflightTask.unresolvedDecisions : [],
      source: 'dispatch-operator-handoff',
      modelSelectValue: (preflightTask && preflightTask.executionProfile && preflightTask.executionProfile.requestedModel)
        || window.getSelectedModel(),
      reasoningEffort: (preflightTask && preflightTask.executionProfile && preflightTask.executionProfile.requestedReasoning)
        || appConfig.reasoningEffort
        || 'auto',
      executionProfile: (preflightTask && preflightTask.executionProfile)
        || captureTaskExecutionProfile(options),
      contextPacketIds: assignedPacketIds,
      createdAt: Date.now()
    });
    if (!handoffTask.success) {
      conversations = conversations.filter(item => item.id !== conv.id);
      saveConversationsToStorage();
      return {
        success: false,
        needsClarification: !!handoffTask.needsClarification,
        error: handoffTask.clarification || handoffTask.error || 'The handoff task could not be resolved.'
      };
    }
    conv.lastOrchestrationTaskId = handoffTask.task.taskId;
    if (originConv) originConv.lastOwnedTaskId = handoffTask.task.taskId;
    createdTask = handoffTask.task;
    if (handoffTask.warning) handoffWarnings.push(handoffTask.warning);
    try {
      persistAssistantStatusMessage(conv.id, `Queued from Dispatch as ${handoffTask.task.title}. Operator will start when the current turn finishes.`, {
        source: 'queue-status',
        dedupeKey: `dispatch-operator-handoff-${handoffTask.task.taskId}`
      });
    } catch (error) {
      handoffWarnings.push(`The task was queued, but its Operator status message could not be saved: ${error.message || error}`);
    }
  }

  try {
    renderProjectsList();
    renderConversationList();
  } catch (error) {
    handoffWarnings.push(`The handoff was queued, but the conversation list could not refresh: ${error.message || error}`);
  }
  return {
    success: true,
    projectPath: standalone ? '' : folderPath,
    workspacePath: folderPath,
    standalone,
    conversationId: conv.id,
    title: conv.title,
    queued: !!prompt,
    taskId: createdTask ? createdTask.taskId : '',
    status: createdTask ? createdTask.status : (prompt ? 'pending' : 'completed'),
    task: createdTask,
    queueItem: createdTask
      ? (window.promptQueue || []).find(item => item && item.taskId === createdTask.taskId) || null
      : null,
    contextPacketIds: assignedPacketIds,
    contextTransferred: assignedPacketIds.length > 0,
    contextTransferError,
    committedWithWarning: handoffWarnings.length > 0,
    warning: handoffWarnings.join(' ')
  };
};
window.getSelectedModel = () => el.modelSelect ? el.modelSelect.value : appConfig.defaultModel;
window.getKnownProjects = () => projects.slice();
window.getRecentProjectCandidates = () => conversations
  .slice()
  .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
  .flatMap(conversation => [
    conversation.dispatchProjectPath
      ? { path: conversation.dispatchProjectPath, source: 'recent_dispatch_binding' }
      : null,
    conversation.projectPath
      ? { path: conversation.projectPath, source: 'recent_coder_project' }
      : null
  ])
  .filter((item, index, values) => item && values.findIndex(candidate => candidate && candidate.path === item.path) === index)
  .slice(0, 30);
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

window.onAgentStatusChange = (running, details = {}) => {
  const submitBtn = el.btnSubmit;
  const steerBtn = document.getElementById('btn-steer');
  const queueBtn = document.getElementById('btn-queue');

  if (running) {
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
    if (details.status === 'finalizing') {
      renderAgentPresence('verifying', 'Verifying', 'Saving the response and recording the canonical task state');
    } else if (conv && conv.awaitingPlanApproval && !conv.planApproved) {
      revealAgentPanel('A plan is ready for review.');
      renderAgentPresence('attention', 'Review needed', 'Implementation plan is waiting for approval');
    } else {
      renderAgentPresence('idle', 'Ready', '');
    }
    if (details.status !== 'finalizing'
        && !syncDispatchCoderStatusCard(activeConversationId, false, '')) {
      hideCoderStatusCard();
    }
  }
};

window.onAgentRunFinalized = async function(conversationId, status, details = {}) {
  const canonicalStatus = String(status || 'unknown');
  if (String(conversationId || '') !== String(activeConversationId || '')) return;
  const conv = conversations.find(item => item.id === conversationId);
  clearTimeout(agentCompletionTimer);
  if (canonicalStatus === 'completed') {
    renderAgentPresence('complete', 'Complete', 'Orion recorded the task as completed');
    showToast('Orion completed the task.', 'success');
    agentCompletionTimer = setTimeout(() => renderAgentPresence('idle', 'Ready', ''), 2600);
  } else if (canonicalStatus === 'cancelled') {
    renderAgentPresence('idle', 'Ready', 'The task was cancelled');
    showToast('Task stopped.', 'info');
  } else if (canonicalStatus === 'failed') {
    revealAgentPanel('The task failed.');
    renderAgentPresence('attention', 'Failed', 'Open the transcript for the recorded error');
    showToast('The task failed.', 'error');
  } else if (canonicalStatus === 'pending') {
    if (details.automaticContinuation) {
      renderAgentPresence('working', 'Continuing', 'Orion checkpointed this pass and is continuing the same task');
    } else if (conv && conv.awaitingPlanApproval && !conv.planApproved) {
      revealAgentPanel('A plan is ready for review.');
      renderAgentPresence('attention', 'Review needed', 'Implementation plan is waiting for approval');
    } else if (conv && conv.awaitingClarification) {
      renderAgentPresence('attention', 'Input needed', 'Orion is waiting for your answer');
    } else {
      renderAgentPresence('verifying', 'Paused', details.pendingWork ? 'Work remains queued for continuation' : 'The task is waiting to continue');
    }
  } else {
    renderAgentPresence('attention', 'Status unknown', 'The run ended without a verified terminal task state');
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
        hydrateConversationRecord(conv, result.conversation);
      }
    } catch (err) {
      console.error('Phone companion stub hydration failed', err);
    }
  }
  const resolvedId = conv ? conv.id : '';
  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;
  const globalRunningId = window.getRunningConversationId ? window.getRunningConversationId() : null;
  const globalActiveTaskId = window.getActiveRunTaskId ? String(window.getActiveRunTaskId() || '') : '';
  const isActiveTargetRunning = isGlobalRunning && globalRunningId === resolvedId;
  const queuedForResolvedConversation = Array.isArray(window.promptQueue)
    && window.promptQueue.some(q => q && q.conversationId === resolvedId);
  const normalizedPhoneMessages = conv && conv.messages
    ? conv.messages.filter(isConversationMessageVisible).slice(-40).map(normalizeConversationMessageForReplay)
    : [];
  const recoveredAssistantMessage = buildMissingAssistantResponseMessage(normalizedPhoneMessages, {
    queued: queuedForResolvedConversation
  });
  const messages = normalizedPhoneMessages.map(replayMsg => {
    const replayLogs = compactPhoneToolLogs(replayMsg.logs, 8);
    const text = replayMsg.text;
    return {
      role: replayMsg.role,
      content: text,
      text,
      createdAt: replayMsg.createdAt || 0,
      requestId: replayMsg.requestId || '',
      logs: replayMsg.role === 'assistant' ? replayLogs : [],
      images: Array.isArray(replayMsg.images) ? replayMsg.images.slice(0, 4) : []
    };
  });
  if (recoveredAssistantMessage && !isActiveTargetRunning) {
    messages.push(recoveredAssistantMessage);
  }
  const latestOutput = messages.slice().reverse().find(msg => msg.role === 'assistant' || msg.role === 'system');
  const latestAssistant = conv && conv.messages
    ? conv.messages.filter(isConversationMessageVisible).slice().reverse().map(normalizeConversationMessageForReplay).find(msg => msg.role === 'assistant')
    : null;
  const latestText = latestAssistant ? (latestAssistant.text || '') : '';
  const changedFiles = [];
  const testResults = [];
  const latestToolCalls = compactPhoneToolLogs(latestAssistant && latestAssistant.logs, 8);
  (latestAssistant && Array.isArray(latestAssistant.logs) ? latestAssistant.logs : []).forEach(log => {
    if (log.tool === 'write_file' || log.tool === 'modify_file' || log.tool === 'patch_file') {
      const params = log.params || {};
      if (params.path && !changedFiles.includes(params.path)) changedFiles.push(params.path);
    }
    if (log.tool === 'run_tests' || log.tool === 'run_command') {
      testResults.push(truncatePhoneTransportText(log.result || '', 2400));
    }
  });
  const walkthroughIndex = latestText.indexOf('\n\n## Work Walkthrough');
  const workWalkthrough = walkthroughIndex === -1 ? '' : latestText.slice(walkthroughIndex).trim();
  const conversationsSummary = conversations.map(c => {
    const messageCount = (Array.isArray(c.messages) ? c.messages : []).filter(msg =>
      isConversationMessageVisible(msg)
      && ['user', 'assistant', 'steering'].includes(normalizeConversationMessageRole(msg))
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
      launchedCoderTaskId: c.launchedCoderTaskId || '',
      lastOwnedTaskId: c.lastOwnedTaskId || '',
      active: c.id === resolvedId,
      isDesktopActive: c.id === activeConversationId,
      awaitingPlanApproval: !!((c.awaitingPlanApproval && !c.planApproved) || c.awaitingDelegatedPlan),
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
    .map(task => {
      const presentation = getSupervisedTaskPresentation(task, isGlobalRunning, globalRunningId);
      return {
        taskId: task.taskId,
        title: task.title,
        objective: task.objective,
        status: task.status,
        workspacePath: task.workspacePath || '',
        originConversationId: task.origin && task.origin.conversationId,
        targetConversationId: task.target && task.target.conversationId,
        updatedAt: task.updatedAt || task.createdAt || 0,
        awaitingReview: !!(presentation && presentation.awaitingReview),
        revisingPlan: !!(presentation && presentation.revisingPlan),
        planApproved: !!(presentation && presentation.planApproved),
        executionMode: presentation && presentation.executionMode || '',
        subStatus: presentation && presentation.subStatus || '',
        presentation: presentation ? {
          taskId: presentation.taskId,
          status: presentation.status,
          phase: presentation.phase,
          label: presentation.label,
          detail: presentation.detail,
          agentState: presentation.agentState,
          badgeClass: presentation.badgeClass,
          isOngoing: presentation.isOngoing
        } : null
      };
    });
  const selectedSupervisedTask = RendererTaskOrchestration
    && typeof RendererTaskOrchestration.selectSupervisedTask === 'function'
    ? RendererTaskOrchestration.selectSupervisedTask(
        orchestrationTasks,
        resolvedId,
        globalActiveTaskId,
        { delegatedOnly: !!(conv && conversationMode(conv) === 'orion') }
      )
    : orchestrationTasks.find(task => task.status === 'active')
      || orchestrationTasks.find(task => task.status === 'pending')
      || null;
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
    awaitingPlanApproval: !!(conv && ((conv.awaitingPlanApproval && !conv.planApproved) || conv.awaitingDelegatedPlan)),
    awaitingClarification: (conv && conv.awaitingClarification) ? conv.awaitingClarification : null,
    tasks: conv && Array.isArray(conv.tasks) ? conv.tasks : [],
    orchestrationTasks,
    activeTaskId: selectedSupervisedTask ? selectedSupervisedTask.taskId : '',
    model: window.getSelectedModel(),
    reasoning: appConfig.reasoningEffort || 'auto',
    selectionRevisions: getSelectionRevisions(),
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
        requestId: options.requestId,
        imageData: options.imageData,
        imageMimeType: options.imageMimeType,
        fileContent: options.fileContent,
        fileName: options.fileName
      });
    } catch (error) {
      conversations = conversations.filter(item => item.id !== conv.id);
      throw error;
    }
  } else if (conversationMode(conv) === 'coder' || conversationMode(conv) === 'operator') {
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

async function submitPhoneCompanionPromptOnce(options) {
  // Can be called with either a string or an options object
  const text = typeof options === 'string' ? options.trim() : String(options.prompt || '').trim();
  let targetId = (typeof options === 'object' && options.conversationId) ? options.conversationId : activeConversationId;
  const phoneRequestId = typeof options === 'object' ? String(options.requestId || '').trim() : '';
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
    } else if (conversationMode(conv) === 'coder' || conversationMode(conv) === 'operator') {
      conv.workspace = getStandaloneWorkspaceForTitle(conv.title, conv.id);
    }
  }
  conv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
  saveConversationsToStorage();

  const pendingReplyTaskId = String(
    conv.awaitingPlanApprovalTaskId
    || (conv.awaitingClarification && conv.awaitingClarification.taskId)
    || ''
  );
  const semanticIntent = await classifyCurrentConversationIntent(conv, text, {
    model: window.getSelectedModel(),
    taskId: pendingReplyTaskId
  });
  if (conversationMode(conv) === 'orion' && semanticIntent.intent === 'cancel_active_task') {
    const messageId = createConversationMessageId(conv.id);
    conv.messages.push({
      id: messageId,
      role: 'user',
      source: 'phone',
      requestId: phoneRequestId,
      text,
      createdAt: Date.now(),
      ...(phoneImages.length ? { images: phoneImages } : {})
    });
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
    saveConversationsToStorage();
    if (targetId === activeConversationId) renderUserMessage(text, phoneImages, Date.now());
    const cancellation = await cancelOwnedTaskRequestedInPrompt(conv, text, 'phone-task-cancellation', semanticIntent);
    return {
      ...cancellation,
      queued: false,
      conversationId: targetId,
      title: conv.title || 'New Conversation'
    };
  }
  if (conversationMode(conv) === 'orion' && conv.awaitingDelegatedPlan
      && ['approve_plan', 'deny_plan', 'revise_plan'].includes(semanticIntent.intent)) {
    const result = semanticIntent.intent === 'approve_plan'
      ? await window.approvePhoneCompanionPlan(conv.id)
      : (semanticIntent.intent === 'deny_plan'
          ? await window.denyPhoneCompanionPlan(conv.id)
          : await window.revisePhoneCompanionPlan({
              conversationId: conv.awaitingDelegatedPlan.coderConversationId,
              feedback: semanticIntent.resolvedRequest || text
            }));
    return {
      ...(result || {}),
      queued: !!(result && result.queued),
      conversationId: targetId,
      title: conv.title || 'New Conversation'
    };
  }
  if (conv.awaitingClarification && pendingReplyTaskId) {
    const clarificationState = conv.awaitingClarification;
    const messageId = createConversationMessageId(conv.id);
    conv.messages.push({
      id: messageId,
      role: 'user',
      source: 'phone',
      requestId: phoneRequestId,
      text,
      createdAt: Date.now(),
      ...(phoneImages.length ? { images: phoneImages } : {})
    });
    if (targetId === activeConversationId) renderUserMessage(text, phoneImages, Date.now());
    const continuation = await queueTaskContinuation({
      taskId: pendingReplyTaskId,
      prompt: text,
      originalUserMessage: text,
      modelSelectValue: window.getSelectedModel(),
      targetConversationId: targetId,
      originConversationId: targetId,
      originMessageId: messageId,
            source: 'phone-continuation',
            images: phoneImages,
            alreadyRendered: true,
            semanticIntent
    });
    if (!continuation.success) {
      conv.awaitingClarification = clarificationState;
      saveConversationsToStorage();
      return {
        success: false,
        queued: false,
        error: continuation.error || 'Could not attach that answer to the waiting task.',
        conversationId: targetId
      };
    }
    conv.awaitingClarification = null;
    saveConversationsToStorage();
    const launch = startOrQueueTaskContinuation(continuation, conv, {
      source: 'phone-continuation',
      modelSelectValue: window.getSelectedModel(),
      errorLabel: 'Phone free-text clarification'
    });
    return { ...launch, conversationId: targetId, title: conv.title || 'New Conversation' };
  }

  const isOwnedContinuation = !!(
    conversationMode(conv) === 'orion'
    && !conv.awaitingDelegatedPlan
    && !conv.awaitingPlanApproval
    && RendererTaskOrchestration
    && typeof RendererTaskOrchestration.isContinuationRequest === 'function'
    && RendererTaskOrchestration.isContinuationRequest(semanticIntent)
  );
  if (isOwnedContinuation) {
    const messageId = createConversationMessageId(conv.id);
    conv.messages.push({
      id: messageId,
      role: 'user',
      source: 'phone',
      requestId: phoneRequestId,
      text,
      createdAt: Date.now(),
      ...(phoneImages.length ? { images: phoneImages } : {})
    });
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
    saveConversationsToStorage();
    if (targetId === activeConversationId) renderUserMessage(text, phoneImages, Date.now());
    const continuationResult = await resumeOwnedCoderTaskFromDispatch(conv, text, {
      messageId,
      modelSelectValue: window.getSelectedModel(),
      images: phoneImages,
      source: 'phone-dispatch-continuation'
      ,
      semanticIntent
    });
    if (continuationResult.handled) {
      return {
        ...continuationResult,
        queued: !!continuationResult.queued,
        conversationId: targetId,
        title: conv.title || 'New Conversation'
      };
    }
    // No live owned task exists. Remove the provisional message so the ordinary path below can
    // record and resolve this contextual request exactly once.
    conv.messages = conv.messages.filter(message => message.id !== messageId);
    saveConversationsToStorage();
    if (targetId === activeConversationId) await selectConversation(targetId);
  }
  const isGlobalRunning = window.isAgentRunning ? window.isAgentRunning() : false;

  if (isGlobalRunning) {
    if (ownsActiveSupervisedRun(conv)) {
      // Push the user message to history first
      const messageId = createConversationMessageId(conv.id);
      conv.messages.push({ id: messageId, role: 'user', source: 'phone', requestId: phoneRequestId, text, createdAt: Date.now(), ...(phoneImages.length ? { images: phoneImages } : {}) });
      saveConversationsToStorage();
      if (targetId === activeConversationId) renderUserMessage(text, phoneImages, Date.now());
      const supervisorResult = await handleSupervisorMessage(
        conv,
        text,
        window.getSelectedModel(),
        { source: 'phone', images: phoneImages, messageId, semanticIntent }
      );
      if (supervisorResult && supervisorResult.success === false) {
        return {
          success: false,
          queued: false,
          error: supervisorResult.error || 'Supervisor response failed.',
          conversationId: targetId,
          title: conv.title || 'New Conversation'
        };
      }
      return { success: true, queued: false, conversationId: targetId, title: conv.title || 'New Conversation' };
    }

    if (conversationMode(conv) === 'orion'
        && RendererSemanticIntentRouter
        && RendererSemanticIntentRouter.canRespondDuringActiveRun(semanticIntent, 'orion')) {
      const messageId = createConversationMessageId(conv.id);
      conv.messages.push({
        id: messageId,
        role: 'user',
        source: 'phone',
        requestId: phoneRequestId,
        text,
        createdAt: Date.now(),
        ...(phoneImages.length ? { images: phoneImages } : {})
      });
      if (typeof window.markConversationDirty === 'function') window.markConversationDirty(conv.id);
      saveConversationsToStorage();
      if (targetId === activeConversationId) renderUserMessage(text, phoneImages, Date.now());
      const conversationalResult = await respondOrionConversationally(
        conv,
        text,
        window.getSelectedModel(),
        {
          source: 'phone',
          images: phoneImages,
          messageId,
          semanticIntent,
          statusCheckin: semanticIntent.intent === 'status_check'
            && semanticIntent.target === 'active_owned_task'
        }
      );
      return {
        success: conversationalResult.success !== false,
        queued: false,
        replyText: conversationalResult.replyText || '',
        error: conversationalResult.error || '',
        conversationId: targetId,
        title: conv.title || 'New Conversation'
      };
    }

    const messageId = createConversationMessageId(conv.id);
    conv.messages.push({ id: messageId, role: 'user', source: 'phone', requestId: phoneRequestId, text, createdAt: Date.now(), ...(phoneImages.length ? { images: phoneImages } : {}) });
    saveConversationsToStorage();
    if (targetId === activeConversationId) {
      renderUserMessage(text, phoneImages, Date.now());
    }
    const queued = pendingReplyTaskId
      ? await queueTaskContinuation({
          taskId: pendingReplyTaskId,
          prompt: text,
          originalUserMessage: text,
          modelSelectValue: window.getSelectedModel(),
          targetConversationId: targetId,
          originConversationId: targetId,
          originMessageId: messageId,
          source: 'phone-continuation',
          images: phoneImages,
          alreadyRendered: true
        })
      : await enqueueOrchestrationTask({
          prompt: text,
          originalUserMessage: text,
          modelSelectValue: window.getSelectedModel(),
          targetConversationId: targetId,
          originConversationId: targetId,
          originMessageId: messageId,
            source: 'phone',
            images: phoneImages,
            alreadyRendered: true,
            semanticIntent
        });
    if (!queued.success) {
      return {
        success: false,
        queued: false,
        needsClarification: !!queued.needsClarification,
        error: queued.error || queued.clarification || 'Could not queue this request.',
        conversationId: targetId
      };
    }
    persistAssistantStatusMessage(targetId, `Queued task ${queued.task.taskId}. Orion will start it after the current task finishes.`, {
      source: 'queue-status',
      dedupeKey: `phone-queued-${queued.task.taskId}`
    });
    return { success: true, queued: true, taskId: queued.task.taskId, taskStatus: queued.task.status, conversationId: targetId, title: conv.title || 'New Conversation' };
  }

  // Directly run agent loop on the target conversation (without forcing desktop UI switch)
  if (conv.messages) {
    conv.messages.push({ id: createConversationMessageId(conv.id), role: 'user', source: 'phone', requestId: phoneRequestId, text, createdAt: Date.now(), ...(phoneImages.length ? { images: phoneImages } : {}) });
    saveConversationsToStorage();
  }
  if (targetId === activeConversationId) {
    renderUserMessage(text, phoneImages, Date.now());
  }
  window.runAgentLoop(text, window.getSelectedModel(), conv, {
      source: 'phone',
      images: phoneImages,
      ...(pendingReplyTaskId ? { taskId: pendingReplyTaskId, preserveUserPrompt: true } : {}),
      semanticIntent
  })
    .catch(err => {
      console.error("Phone-started agent loop failed:", err);
      persistAssistantStatusMessage(targetId, `The phone-started Orion run ended unexpectedly: ${err.message}`, {
        source: 'agent-run-error',
        dedupeKey: `phone-run-error-${targetId}-${text}`
      });
    });

  return { success: true, queued: false, conversationId: targetId, title: conv.title || 'New Conversation' };
}

window.submitPhoneCompanionPrompt = function(options) {
  const normalizedOptions = typeof options === 'string' ? { prompt: options } : (options || {});
  if (!promptSubmissionRegistry) return submitPhoneCompanionPromptOnce(normalizedOptions);
  return promptSubmissionRegistry.run({
    requestId: normalizedOptions.requestId,
    conversationId: normalizedOptions.conversationId || activeConversationId,
    source: normalizedOptions.source || 'phone',
    prompt: normalizedOptions.prompt,
    imageCount: normalizedOptions.imageData ? 1 : 0
  }, () => submitPhoneCompanionPromptOnce(normalizedOptions));
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
  if (conv && conv.awaitingDelegatedPlan) {
    const delegatedPlan = conv.awaitingDelegatedPlan;
    const result = await window.approvePhoneCompanionPlan(delegatedPlan.coderConversationId);
    if (result && result.success !== false) {
      markDelegatedPlanMessageState(conv, delegatedPlan.taskId, 'delegatedPlanApproved');
      conv.awaitingDelegatedPlan = null;
      notifyOrionConversation(
        conv,
        `Plan approved for **${delegatedPlan.title || 'the Coder task'}**. Coder is continuing implementation; I’ll report the verified result here.`,
        'supervisor-plan-approved'
      );
    }
    return result;
  }
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

  const approvalTaskId = String(conv.awaitingPlanApprovalTaskId || '');
  conv.planApproved = true;
  conv.awaitingPlanApproval = false;
  conv.awaitingPlanApprovalTaskId = '';

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
  const supervisingConversation = conversations.find(item => item.launchedCoderConvId === resolvedId);
  const continuation = await queueTaskContinuation({
    taskId: approvalTaskId,
    prompt,
    resolvedObjective: 'Execute the approved implementation plan, complete every remaining task, run the test suite, and provide a work walkthrough.',
    title: `Execute approved plan: ${conv.title || 'Coder task'}`,
    modelSelectValue: window.getSelectedModel(),
    targetConversationId: resolvedId,
    originConversationId: supervisingConversation ? supervisingConversation.id : resolvedId,
    workspace: structuredWorkspaceForConversation(conv),
    source: 'plan-approval',
    requireExistingTask: true
  });
  if (!continuation.success) {
    conv.planApproved = false;
    conv.awaitingPlanApproval = true;
    conv.awaitingPlanApprovalTaskId = approvalTaskId;
    saveConversationsToStorage();
    return { success: false, error: continuation.error || 'Could not resume the approved plan.' };
  }
  const launch = startOrQueueTaskContinuation(continuation, conv, {
    source: 'plan-approval',
    modelSelectValue: window.getSelectedModel(),
    errorLabel: 'Phone-started approved plan'
  });
  if (launch.queued) {
    persistAssistantStatusMessage(resolvedId, "Queued. Orion will continue the approved plan after the current task finishes.", {
      source: 'queue-status',
      dedupeKey: `plan-approval-queued-${continuation.task.taskId}`
    });
    return launch;
  }
  return launch;
};

window.denyPhoneCompanionPlan = async (targetId) => {
  const resolvedId = targetId || activeConversationId;
  const conv = conversations.find(c => c.id === resolvedId);
  if (conv && conv.awaitingDelegatedPlan) {
    const delegatedPlan = conv.awaitingDelegatedPlan;
    const result = await window.denyPhoneCompanionPlan(delegatedPlan.coderConversationId);
    if (result && result.success !== false) {
      markDelegatedPlanMessageState(conv, delegatedPlan.taskId, 'delegatedPlanDenied');
      conv.awaitingDelegatedPlan = null;
    }
    return result;
  }
  if (!conv) return { success: false, error: 'No active conversation' };
  const deniedTaskId = String(conv.awaitingPlanApprovalTaskId || '');
  if (deniedTaskId) {
    const cancelled = await window.cancelOwnedOrchestrationTask(
      deniedTaskId,
      resolvedId,
      'The pending implementation plan was denied.'
    );
    if (!cancelled || !cancelled.success || !cancelled.task || cancelled.task.status !== 'cancelled') {
      return {
        success: false,
        denied: false,
        taskId: deniedTaskId,
        error: (cancelled && (cancelled.error || cancelled.reason)) || 'Could not cancel the denied plan task.'
      };
    }
  }
  conv.awaitingPlanApproval = false;
  conv.awaitingPlanApprovalTaskId = '';
  conv.planApproved = false;
  if (resolvedId === activeConversationId) {
    const cards = document.querySelectorAll('.plan-approval-actions');
    cards.forEach(card => card.remove());
    appendSystemMessage("Phone companion denied the pending plan.");
  }
  saveConversationsToStorage();
  return { success: true, denied: true, taskId: deniedTaskId, taskStatus: deniedTaskId ? 'cancelled' : '' };
};

window.revisePhoneCompanionPlan = async (options) => {
  const normalizedOptions = typeof options === 'string' ? { feedback: options } : (options || {});
  const text = String(normalizedOptions.feedback || 'Revise the pending plan before implementing.').trim();
  const requestedId = String(normalizedOptions.conversationId || activeConversationId || '');
  if (!text) return { success: false, error: 'Missing revision feedback' };

  let originConv = conversations.find(c => c.id === requestedId) || null;
  let delegatedPlan = originConv && originConv.awaitingDelegatedPlan
    ? originConv.awaitingDelegatedPlan
    : null;
  let targetId = delegatedPlan
    ? String(delegatedPlan.coderConversationId || '')
    : requestedId;
  let targetConv = conversations.find(c => c.id === targetId) || null;

  if (!delegatedPlan && targetConv) {
    originConv = conversations.find(c =>
      c
      && c.awaitingDelegatedPlan
      && String(c.awaitingDelegatedPlan.coderConversationId || '') === targetId
      && (!targetConv.awaitingPlanApprovalTaskId
        || String(c.awaitingDelegatedPlan.taskId || '') === String(targetConv.awaitingPlanApprovalTaskId || ''))
    ) || null;
    delegatedPlan = originConv && originConv.awaitingDelegatedPlan
      ? originConv.awaitingDelegatedPlan
      : null;
  }

  const taskId = String(
    delegatedPlan && delegatedPlan.taskId
    || targetConv && targetConv.awaitingPlanApprovalTaskId
    || ''
  );
  if (!targetConv || conversationMode(targetConv) !== 'coder') {
    return { success: false, error: 'The Coder conversation for this plan could not be resolved.' };
  }
  if (!taskId || !targetConv.awaitingPlanApproval || targetConv.planApproved) {
    return { success: false, error: 'No pending implementation plan is available to revise.' };
  }

  const requesterConversationId = originConv ? originConv.id : targetConv.id;
  const status = await window.getOrchestrationTaskStatus(taskId, requesterConversationId);
  if (!status || !status.success || !status.task || status.task.status !== 'pending') {
    return {
      success: false,
      error: (status && status.error)
        || `Task ${taskId} is not pending, so its plan cannot be revised safely.`
    };
  }
  if (String(status.task.target && status.task.target.conversationId || '') !== targetConv.id) {
    return { success: false, error: 'The pending plan does not belong to this Coder conversation.' };
  }

  const revisionPrompt = [
    '[PLAN REVISION REQUEST - SAME DURABLE TASK]',
    'Revise the existing implementation plan using the feedback below.',
    'Do not implement source changes. Do not create a new task. Return the revised plan for approval.',
    '',
    text
  ].join('\n');
  const continuation = await queueTaskContinuation({
    taskId,
    prompt: revisionPrompt,
    originalUserMessage: text,
    modelSelectValue: window.getSelectedModel(),
    targetConversationId: targetConv.id,
    originConversationId: requesterConversationId,
    source: 'plan-revision',
    requireExistingTask: true,
    alreadyRendered: true,
    planRevision: true
  });
  if (!continuation.success) {
    return { success: false, error: continuation.error || 'Could not queue the plan revision.' };
  }

  const revisionState = {
    taskId,
    originConversationId: originConv ? originConv.id : '',
    coderConversationId: targetConv.id,
    title: String(delegatedPlan && delegatedPlan.title || status.task.title || targetConv.title || 'Coder task'),
    requestedAt: Date.now()
  };
  targetConv.planApproved = false;
  targetConv.awaitingPlanApproval = false;
  targetConv.awaitingPlanApprovalTaskId = '';
  targetConv.planRevisionInProgress = revisionState;
  if (originConv) {
    markDelegatedPlanMessageState(originConv, taskId, 'delegatedPlanRevisionRequested');
    originConv.awaitingDelegatedPlan = null;
    originConv.revisingDelegatedPlan = revisionState;
  }
  if (typeof window.markConversationDirty === 'function') {
    window.markConversationDirty(targetConv.id);
    if (originConv) window.markConversationDirty(originConv.id);
  }
  await flushConversationsToStorage();

  if (originConv && typeof window.startCoderTaskMonitor === 'function') {
    window.startCoderTaskMonitor(originConv.id, targetConv.id, taskId);
  }
  const launch = startOrQueueTaskContinuation(continuation, targetConv, {
    source: 'plan-revision',
    modelSelectValue: window.getSelectedModel(),
    errorLabel: 'Plan revision'
  });
  if (!launch || launch.success === false) {
    targetConv.planRevisionInProgress = null;
    targetConv.awaitingPlanApproval = true;
    targetConv.awaitingPlanApprovalTaskId = taskId;
    if (originConv) {
      originConv.revisingDelegatedPlan = null;
      originConv.awaitingDelegatedPlan = delegatedPlan;
    }
    saveConversationsToStorage();
    return { success: false, error: (launch && launch.error) || 'Could not start the plan revision.' };
  }
  if (originConv) {
    notifyOrionConversation(
      originConv,
      `Coder is revising the plan for **${revisionState.title}**. I’ll replace the review card here when the revised plan is ready.`,
      'supervisor-plan-revision'
    );
  }
  return {
    ...launch,
    success: true,
    revising: true,
    taskId,
    taskStatus: launch.queued ? 'pending' : 'active'
  };
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

  const clarificationState = conv.awaitingClarification;
  const formattedAnswers = answers.map(a => `${a.header}: ${a.answer}`).join('\n');
  const userMessage = `Here are my answers:\n${formattedAnswers}`;
  const clarificationTaskId = String(conv.awaitingClarification.taskId || '');

  conv.awaitingClarification = null;
  if (resolvedId === activeConversationId) {
    renderUserMessage(userMessage, [], Date.now());
  }
  const messageId = createConversationMessageId(conv.id);
  conv.messages.push({ id: messageId, role: 'user', text: userMessage, source: 'clarification-answers' });
  saveConversationsToStorage();

  const supervisingConversation = conversations.find(item => item.launchedCoderConvId === resolvedId);
  const continuation = await queueTaskContinuation({
    taskId: clarificationTaskId,
    prompt: userMessage,
    resolvedObjective: `Continue the existing task using these clarification answers:\n${formattedAnswers}`,
    title: `Continue after clarification: ${conv.title || 'task'}`,
    modelSelectValue: window.getSelectedModel(),
    targetConversationId: resolvedId,
    originConversationId: supervisingConversation ? supervisingConversation.id : resolvedId,
    originMessageId: messageId,
    workspace: structuredWorkspaceForConversation(conv),
    source: 'clarification-answers'
  });
  if (!continuation.success) {
    conv.awaitingClarification = clarificationState;
    saveConversationsToStorage();
    return { success: false, error: continuation.error || 'Could not resume after clarification.' };
  }
  const launch = startOrQueueTaskContinuation(continuation, conv, {
    source: 'clarification-answers',
    modelSelectValue: window.getSelectedModel(),
    errorLabel: 'Phone clarification resume'
  });
  if (launch.queued) {
    persistAssistantStatusMessage(resolvedId, "Queued. Orion will continue once the current task finishes.", {
      source: 'queue-status',
      dedupeKey: `clarification-answers-queued-${continuation.task.taskId}`
    });
    return launch;
  }
  return launch;
};

window.stopPhoneCompanionTask = async (targetId) => {
  const resolvedId = targetId || activeConversationId;
  const result = await stopExpectedTaskForConversation(resolvedId);
  if (!result || result.success === false) {
    if (result && /does not own|no longer running/i.test(String(result.error || ''))) {
      return { success: true, stopped: false, cancelled: false };
    }
    return result || { success: false, stopped: false, error: 'Task cancellation failed.' };
  }
  const taskId = String((result.task && result.task.taskId) || result.taskId || '');
  const cancelled = !!(result.task && result.task.status === 'cancelled');
  if (cancelled && resolvedId === activeConversationId) {
    appendSystemMessage(`Phone companion cancelled task ${taskId}.`, {
      dedupeKey: `phone-stop-${taskId}`,
      windowMs: 3000
    });
  }
  return {
    success: true,
    stopped: !!result.stopped,
    cancelled,
    taskId,
    status: result.task && result.task.status
  };
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
  const reasoning = window.OrionReasoningPolicy
    ? window.OrionReasoningPolicy.normalizeEffortOverride(appConfig.reasoningEffort)
    : (appConfig.reasoningEffort || 'auto');
  const reasoningLevels = window.OrionReasoningPolicy
    ? window.OrionReasoningPolicy.EFFORT_OVERRIDES.map(option => ({ ...option }))
    : [{ value: 'auto', label: 'Auto' }];
  return { current, models, reasoning, reasoningLevels, selectionRevisions: getSelectionRevisions() };
};

window.setPhoneCompanionReasoning = async (level) => {
  return window.setReasoningEffortSelection(level);
};

window.setPhoneCompanionModel = async (modelValue) => {
  return setModelPreferenceSelection(modelValue);
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

  const approvalTaskId = String(conv.awaitingPlanApprovalTaskId || '');
  conv.planApproved = true;
  conv.awaitingPlanApproval = false;
  conv.awaitingPlanApprovalTaskId = '';

  const approvalText = "Plan approved. Continuing implementation.";
  appendSystemMessage(approvalText, { conversationId: activeConversationId, source: 'plan-approval' });

  const prompt = 'PLAN APPROVED — EXECUTE NOW. Do not summarize, describe, or restate the plan. Do not rewrite STRATEGY.md or implementation_plan.md — they are already approved. Read implementation_plan.md once to understand the tasks, then immediately start creating and editing the actual source code files. Work through every task. Update the checklist only for completed milestones. Run the test suite when done. Provide a Work Walkthrough.';

  if (window.runAgentLoop) {
    const supervisingConversation = conversations.find(item => item.launchedCoderConvId === conv.id);
    const continuation = await queueTaskContinuation({
      taskId: approvalTaskId,
      prompt,
      resolvedObjective: 'Execute the approved implementation plan, complete every remaining task, run the test suite, and provide a work walkthrough.',
      title: `Execute approved plan: ${conv.title || 'task'}`,
      modelSelectValue: el.modelSelect.value,
      targetConversationId: conv.id,
      originConversationId: supervisingConversation ? supervisingConversation.id : conv.id,
      workspace: structuredWorkspaceForConversation(conv),
      source: 'plan-approval',
      requireExistingTask: true
    });
    if (!continuation.success) {
      conv.planApproved = false;
      conv.awaitingPlanApproval = true;
      conv.awaitingPlanApprovalTaskId = approvalTaskId;
      saveConversationsToStorage();
      restoreButton();
      return { success: false, error: continuation.error || 'Could not resume the approved plan.' };
    }
    if (window.isAgentRunning && window.isAgentRunning()) {
      appendSystemMessage("Another task is currently running. Approved plan execution was queued.");
      return { success: true, queued: true, taskId: continuation.task.taskId };
    }
    window.promptQueue = window.promptQueue.filter(item => item.taskId !== continuation.task.taskId);
    window.runAgentLoop(continuation.queueItem.prompt, continuation.queueItem.modelSelectValue || el.modelSelect.value, conv, {
      source: 'plan-approval',
      internalPrompt: true,
      taskId: continuation.task.taskId,
      reasoningEffort: continuation.queueItem.reasoningEffort,
      executionProfile: continuation.queueItem.executionProfile,
      images: continuation.queueItem.images || [],
      contextPacketIds: continuation.queueItem.contextPacketIds || []
    })
      .catch(err => console.error("Desktop-started agent loop failed:", err));
    return { success: true, queued: false, taskId: continuation.task.taskId };
  }
  return { success: false, error: 'Agent engine is not ready' };
}

async function approveDelegatedPlanAndContinue(delegatedPlan, message, options = {}) {
  const button = options.button || null;
  const orionConv = conversations.find(c => c.id === activeConversationId);
  if (!orionConv || !delegatedPlan || !delegatedPlan.coderConversationId) {
    return { success: false, error: 'Delegated plan ownership could not be resolved.' };
  }
  const pending = orionConv.awaitingDelegatedPlan;
  if (!pending || String(pending.taskId || '') !== String(delegatedPlan.taskId || '')) {
    return { success: false, error: 'This delegated plan is no longer pending.' };
  }
  if (button) {
    button.disabled = true;
    button.textContent = 'Starting…';
  }
  const result = await window.approvePhoneCompanionPlan(delegatedPlan.coderConversationId);
  if (!result || result.success === false) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Approve & Continue';
    }
    showToast((result && result.error) || 'Could not approve the delegated plan.', 'attention');
    return result || { success: false };
  }
  orionConv.awaitingDelegatedPlan = null;
  if (message) message.delegatedPlanApproved = true;
  notifyOrionConversation(
    orionConv,
    `Plan approved for **${delegatedPlan.title || 'the Coder task'}**. Coder is continuing implementation; I’ll report the verified result here.`,
    'supervisor-plan-approved'
  );
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
  saveConversationsToStorage();
  return result;
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

// Conversation images are served by reference rather than embedded into every phone-state poll.
// The lookup is scoped to the exact conversation and only succeeds for an image actually attached
// to one of its persisted messages, so the endpoint cannot become an arbitrary filesystem reader.
window.readChatImageForPhone = async (payload = {}) => {
  const conversationId = String(payload.conversationId || '');
  const imagePath = String(payload.path || '');
  const conv = conversations.find(conversation => conversation.id === conversationId);
  if (!conv || !imagePath) return { success: false, error: 'Conversation image not found.' };
  const image = (Array.isArray(conv.messages) ? conv.messages : [])
    .flatMap(message => Array.isArray(message && message.images) ? message.images : [])
    .find(candidate => candidate && String(candidate.path || '') === imagePath);
  if (!image) return { success: false, error: 'Image is not attached to this conversation.' };
  const workspacePath = String(image.workspacePath || conv.workspace || conv.projectPath || '');
  const sourceConversationId = String(image.sourceConversationId || conversationId);
  const result = await window.api.readWorkspaceFileBase64(workspacePath, imagePath, sourceConversationId);
  if (!result || result.success === false || !String(result.mimeType || '').startsWith('image/')) {
    return { success: false, error: (result && result.error) || 'Attached image is unavailable.' };
  }
  return result;
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

// Polling interval handle for the Coder task monitor.
let _coderTaskMonitorInterval = null;
// { orionConvId, coderConvId, lastKnownState }
let _coderTaskMonitorMeta = null;
let _coderTaskMonitorGeneration = 0;

// Polling interval handle for the Operator task monitor (Phase 3 piece 5). Deliberately a
// separate, simpler pair of variables/functions rather than folding Operator into the Coder
// monitor: see the comment above startOperatorTaskMonitor for why.
let _operatorTaskMonitorInterval = null;
let _operatorTaskMonitorMeta = null;
let _operatorTaskMonitorGeneration = 0;

// Kept as a thin renderer adapter for older callers; the deterministic policy
// lives in supervisor-orchestration.js and is exercised independently.
function classifySupervisorIntent(text) {
  return RendererSupervisorOrchestration
    ? RendererSupervisorOrchestration.classifySupervisorIntent(text)
    : 'conversational';
}

// ── Build a human-readable status summary from Coder conversation data ────────
// Raw tool results and model thoughts are deliberately excluded; Dispatch only needs a bounded
// progress snapshot to produce a natural user-facing answer.
function buildCoderStatusSummary(coderConvId) {
  if (typeof window.getCoderConversationSummary !== 'function') return null;
  const data = window.getCoderConversationSummary(coderConvId);
  if (!data) return null;

  const lines = [];
  const {
    tasks = [],
    doneTasks = [],
    pendingTasks = [],
    subStatus = ''
  } = data;

  if (tasks.length > 0) {
    lines.push(`Checklist progress: ${doneTasks.length} of ${tasks.length} complete.`);
    const inProg = tasks.find(t => t.status === 'in-progress' || t.status === '/');
    if (inProg) lines.push(`Current step: ${inProg.title || inProg.text || 'Working through the active task'}.`);
    if (pendingTasks.length) {
      lines.push(`Next steps: ${pendingTasks.slice(0, 3).map(t => t.title || t.text || 'Pending task').join('; ')}.`);
    }
  }

  if (subStatus) lines.push(`Live status: ${String(subStatus).replace(/\s+/g, ' ').trim().slice(0, 240)}.`);

  return { text: lines.join('\n'), tasks, doneTasks, pendingTasks, subStatus };
}

function isConversationMessageVisible(message) {
  return !(window.OrionOperationalContext
    && typeof window.OrionOperationalContext.isInternalContextMessage === 'function'
    && window.OrionOperationalContext.isInternalContextMessage(message));
}

function bindNamedProjectForSupervisor(orionConv, prompt) {
  if (!RendererWorkspaceResolution || !orionConv) return structuredWorkspaceForConversation(orionConv);
  const coderConv = orionConv.launchedCoderConvId
    ? conversations.find(conversation => conversation.id === orionConv.launchedCoderConvId)
    : null;
  const candidates = [
    ...projects,
    orionConv.projectPath,
    orionConv.dispatchProjectPath,
    coderConv && (coderConv.projectPath || coderConv.workspace)
  ].filter(Boolean);
  const namedProject = RendererWorkspaceResolution.findNamedProject(prompt, candidates);
  const searchRoot = getDispatchWorkspaceRoot();
  if (namedProject && namedProject.path && !RendererWorkspaceResolution.samePath(namedProject.path, searchRoot)) {
    const changed = !RendererWorkspaceResolution.samePath(orionConv.dispatchProjectPath, namedProject.path)
      || !RendererWorkspaceResolution.samePath(orionConv.workspace, namedProject.path);
    orionConv.dispatchProjectPath = namedProject.path;
    orionConv.workspace = namedProject.path;
    if (changed) {
      orionConv.updatedAt = Date.now();
      if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
      if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    }
  }
  return structuredWorkspaceForConversation(orionConv);
}

// Distinguishes small talk from a question that actually needs thinking. Greetings and
// acknowledgements are genuinely cheap; explanation, comparison, and justification are not,
// and answering them at the casual tier is what produced restated non-answers.
function isSubstantiveConversationalTurn(semanticIntent, prompt) {
  const hint = (semanticIntent && semanticIntent.reasoningPolicyHint) || {};
  if (hint.complexity === 'medium' || hint.complexity === 'high') return true;
  if (hint.risk === 'medium' || hint.risk === 'high') return true;
  const text = String(prompt || '').trim();
  if (text.length > 180) return true;
  // "why", "how come", "compare", "versus", "instead of", "rather than", "explain",
  // "what about" — the shapes of a question that wants reasons rather than a reply.
  return /\b(?:why|how come|compare|comparison|versus|vs\.?|instead of|rather than|explain|walk me through|what about|trade-?offs?|pros and cons|better than|difference between)\b/i.test(text);
}

// ── Orion answers conversationally while Coder runs in the background ─────────
async function respondOrionConversationally(orionConv, prompt, model, options = {}) {
  const config = window.getAppConfig ? window.getAppConfig() : {};

  const contextNeed = options.semanticIntent
    && options.semanticIntent.reasoningPolicyHint
    && options.semanticIntent.reasoningPolicyHint.contextNeed
    || 'none';
  const recentLimit = contextNeed === 'none' ? 0 : (contextNeed === 'recent' ? 4 : 10);
  // Recent conversation is candidate evidence only when the semantic route says it is needed.
  const recentMsgs = (orionConv.messages || [])
    .filter(message => !options.statusCheckin || !String(message && message.source || '').startsWith('supervisor-checkin'))
    .slice(recentLimit ? -recentLimit : 0)
    .map(m => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
      content: String(m.text || m.content || '').slice(0, 500)
    }));
  if (recentLimit === 0) recentMsgs.length = 0;

  // Add coder context if a coder task is running
  let coderContext = '';
  let liveCoderContext = false;
  const coderConvId = orionConv.launchedCoderConvId;
  if (coderConvId) {
    const summary = buildCoderStatusSummary(coderConvId);
    if (summary && summary.text) {
      coderContext = `\n\nCoder task status:\n${summary.text}`;
      liveCoderContext = true;
    }
  }
  // No live task: supply the finished run's recorded result instead. The completion notice the
  // user sees is deliberately conversational and truncated to 500 chars in recentMsgs, so this
  // is the only way Dispatch can answer questions like "did you test it?" about the last run.
  if (!liveCoderContext) {
    const finished = orionConv.lastDelegatedWork;
    if (finished && finished.taskId) {
      const finishedLines = [`- Task: ${finished.title || 'Coder task'}`];
      const recordedStatus = String(finished.subStatus || finished.status || '').trim();
      if (recordedStatus) finishedLines.push(`- Recorded status: ${recordedStatus}`);
      if (Array.isArray(finished.changedFiles) && finished.changedFiles.length) {
        finishedLines.push(`- Files Coder changed: ${finished.changedFiles.join(', ')}`);
      }
      finishedLines.push(Array.isArray(finished.verification) && finished.verification.length
        ? `- Verification Coder recorded: ${finished.verification.join('; ')}`
        : '- Verification Coder recorded: none was recorded for this run.');
      coderContext = `\n\nMost recent Coder run (already finished, not running):\n${finishedLines.join('\n')}`;
    }
  }

  const workspace = bindNamedProjectForSupervisor(orionConv, prompt);
  const workspaceDescription = RendererWorkspaceResolution
    ? RendererWorkspaceResolution.describeWorkspace({
        kind: workspace.role,
        path: workspace.path,
        projectPath: workspace.project && workspace.project.path,
        projectName: workspace.project && workspace.project.name,
        source: workspace.source
      }, (RendererWorkspaceResolution.extractProjectReferences(prompt) || [])[0] || '')
    : '';
  const statusGuidance = options.statusCheckin
    ? '\n\nThe user is checking on Coder. Answer naturally in one short progress update using only the Coder task status supplied below. Summarize what is complete, what is happening now, and what remains when those facts are available. Do not print raw JSON, tool-call payloads, internal thoughts, or a mechanical field dump. Do not guess percentages or claim completion that is not recorded.'
    : '';
  const concurrencyGuidance = liveCoderContext
    ? ' A separate Coder agent is working in the background; its verified status is supplied below. You can still talk freely.'
    : (coderContext
      ? ' The most recent Coder run has already finished; its recorded result is supplied below. Do not say a Coder task is still running. If the user asks what was done, changed, tested, or verified, answer from that record in ordinary prose — never as a bulleted evidence dump. If no verification was recorded, say so plainly instead of implying the work was tested.'
      : ' Another response may still be finishing, but no owned Coder status is supplied. Do not claim that a Coder task exists.');
  const systemPrompt = `You are Orion, an AI supervisor. Answer the user's current message conversationally and helpfully.${concurrencyGuidance} Be concise and direct. Never invent a remembered conversation or upgrade a reported status. If this message is a follow-up to your previous reply, answer the NEW question — never restate your last message. When the user asks why you preferred something over specific alternatives they name, address each named alternative and give the actual basis for the ranking.${statusGuidance}${workspaceDescription ? `\n\nWorkspace state: ${workspaceDescription}` : ''}${coderContext}`;

  const runningConversationId = window.getRunningConversationId
    ? String(window.getRunningConversationId() || '')
    : '';
  if (runningConversationId !== String(orionConv.id || '')
      && typeof window.clearActiveAiBubble === 'function') {
    window.clearActiveAiBubble();
  }

  try {
    if (!RendererSupervisorOrchestration || !RendererOrchestrationContracts) {
      throw new Error('Supervisor response contracts are unavailable.');
    }
    const result = await RendererSupervisorOrchestration.buildContractedConversationalReply({
      conversation: orionConv,
      prompt,
      messageId: options.messageId || '',
      workspacePaths: [
        workspace.path,
        workspace.project && workspace.project.path,
        ...projects.map(project => typeof project === 'string' ? project : project.path)
      ].filter(Boolean),
      systemPrompt,
      messages: recentMsgs,
      semanticIntent: options.semanticIntent || null
    }, {
      contracts: RendererOrchestrationContracts,
      retrieveEvidence: payload => (
        window.api && typeof window.api.searchConversationEvidence === 'function'
          ? window.api.searchConversationEvidence(payload)
          : Promise.resolve({ success: false, evidence: [], queryTerms: [] })
      ),
      generateReply: (contractPrompt, messages) => window.quickOrionLLMCall(contractPrompt, messages, config, {
        // Not every Dispatch turn is small talk. 'casual_conversation' resolves to low effort,
        // which on DeepSeek disables thinking entirely — so a genuine question ("why that one
        // over these three?") was being answered with no reasoning budget at all, and came back
        // as a near-verbatim restatement of the previous reply. A turn the classifier rates as
        // non-trivial gets a phase that actually affords comparison.
        phase: options.statusCheckin
          ? 'final_response'
          : (isSubstantiveConversationalTurn(options.semanticIntent, prompt)
            ? 'final_response'
            : 'casual_conversation'),
        hint: options.semanticIntent && options.semanticIntent.reasoningPolicyHint || {}
      })
    });
    const replyText = String(result.text || '').trim();
    if (!replyText) throw new Error('Supervisor response was empty.');
    orionConv.messages.push({
      id: createConversationMessageId(orionConv.id),
      role: 'assistant',
      text: replyText,
      source: options.statusCheckin ? 'supervisor-checkin' : 'supervisor-conversational',
      createdAt: Date.now(),
      responseBasis: result.responseBasis
    });
    orionConv.updatedAt = Date.now();
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    if (activeConversationId === orionConv.id && typeof window.renderAiMessage === 'function') {
      window.renderAiMessage(replyText, [], orionConv.id);
    }
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
    return {
      success: true,
      replyText,
      responseBasis: result.responseBasis
    };
  } catch (err) {
    console.error('respondOrionConversationally error:', err);
    const fallback = String(options.fallbackText || "I'm juggling the coder task right now — ask me again in a moment and I'll have a better answer.");
    orionConv.messages.push({
      id: createConversationMessageId(orionConv.id),
      role: 'assistant',
      text: fallback,
      source: options.statusCheckin ? 'supervisor-checkin-error' : 'supervisor-conversational-error',
      createdAt: Date.now()
    });
    orionConv.updatedAt = Date.now();
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    if (activeConversationId === orionConv.id && typeof window.renderAiMessage === 'function') {
      window.renderAiMessage(fallback, [], orionConv.id);
    }
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
    return {
      success: false,
      error: err && err.message ? err.message : String(err),
      replyText: fallback,
      responsePersisted: true
    };
  }
}

// ── Main supervisor message handler ──────────────────────────────────────────
// Called from submitMessage() when user types in Orion while Coder is running.
async function handleSupervisorMessage(orionConv, prompt, model, options = {}) {
  const coderConvId = orionConv.launchedCoderConvId;
  if (!RendererSupervisorOrchestration) {
    throw new Error('Supervisor orchestration is unavailable.');
  }
  const semanticIntent = options.semanticIntent || await classifyCurrentConversationIntent(orionConv, prompt, { model });
  const enqueueTask = async classification => {
    const projectResolutionText = [
      ...taskContextMessages(orionConv).map(message => message.text),
      prompt
    ].join('\n');
    const workspace = bindNamedProjectForSupervisor(orionConv, projectResolutionText);
    const queued = await enqueueOrchestrationTask({
      prompt,
      originalUserMessage: prompt,
      modelSelectValue: model,
      originConversationId: orionConv.id,
      targetConversationId: orionConv.id,
      originMessageId: options.messageId || '',
      source: options.source || 'supervisor-queue',
      images: options.images || [],
      workspace,
      alreadyRendered: true,
      semanticIntent: classification || semanticIntent
    });
    if (queued.success) {
      persistAssistantStatusMessage(orionConv.id, `Queued as ${queued.task.title}. Orion will handle it after the active Coder task.`, {
        source: 'queue-status',
        dedupeKey: `supervisor-queued-${queued.task.taskId}`
      });
    } else if (!queued.needsClarification) {
      persistAssistantStatusMessage(orionConv.id, queued.error || 'Could not queue this request.', {
        source: 'queue-status',
        dedupeKey: `supervisor-queue-error-${orionConv.id}-${Date.now()}`
      });
    }
    return queued;
  };
  return RendererSupervisorOrchestration.handleSupervisorMessage({
    conversation: orionConv,
    prompt,
    model,
    options,
    semanticIntent
  }, {
    classifyIntent: () => Promise.resolve(semanticIntent),
    cancelOwnedTask: async () => {
      const cancelled = await stopExpectedTaskForConversation(orionConv.id);
      const taskId = String((cancelled && cancelled.task && cancelled.task.taskId) || (cancelled && cancelled.taskId) || '');
      const replyText = cancelled && cancelled.success
        ? `Cancelled **${(cancelled.task && cancelled.task.title) || 'Coder task'}**${taskId ? ` (${taskId})` : ''}. Its final state is cancelled.`
        : `I could not cancel the owned Coder task: ${(cancelled && (cancelled.error || cancelled.reason)) || 'cancellation failed'}.`;
      notifyOrionConversation(orionConv, replyText, 'supervisor-cancellation');
      return cancelled;
    },
    enqueueTask,
    askClarification: question => {
      persistTaskClarification(orionConv, question || 'What would you like me to do?');
      return { success: false, needsClarification: true, clarification: question };
    },
    steerActiveTask: async ({ reason, classification }) => {
      const steeringPrompt = String(classification && classification.resolvedRequest || prompt);
      window.steeringQueue = window.steeringQueue || {};
      window.steeringQueue[coderConvId] = window.steeringQueue[coderConvId] || [];
      window.steeringQueue[coderConvId].push(steeringPrompt);
      appendSystemMessage(
        `Steering sent to the active Coder task: "${steeringPrompt.slice(0, 80)}${steeringPrompt.length > 80 ? '…' : ''}"`,
        { conversationId: orionConv.id }
      );
      return { success: true, steered: true, coderConversationId: coderConvId };
    },
    respondCheckin: async () => {
      const summary = buildCoderStatusSummary(coderConvId);
      const fallbackText = (summary && summary.text)
        ? `Coder is still working. ${summary.text.replace(/\n+/g, ' ')}`
        : 'Coder is active, but it has not recorded a detailed progress update yet.';
      return respondOrionConversationally(orionConv, prompt, model, {
        ...options,
        semanticIntent,
        statusCheckin: true,
        fallbackText
      });
    },
    respondConversationally: () => respondOrionConversationally(orionConv, prompt, model, { ...options, semanticIntent })
  });
}

// ── Coder task state monitor ──────────────────────────────────────────────────
// Polls the Coder conversation every 2s to detect state changes.
window.startCoderTaskMonitor = function(orionConvId, coderConvId, taskId = '') {
  // Clear any existing monitor
  stopCoderTaskMonitor(_coderTaskMonitorMeta);

  _coderTaskMonitorMeta = {
    generation: ++_coderTaskMonitorGeneration,
    orionConvId,
    coderConvId,
    taskId: String(taskId || ''),
    lastAwaitingClarification: false,
    lastAwaitingPlanApproval: false,
    lastRunning: true,        // Coder just started, so it's running
    startTime: Date.now(),
    notifiedClarification: false,
    quietSince: 0,
    inFlight: false
  };

  _coderTaskMonitorInterval = setInterval(async () => {
    const monitorMeta = _coderTaskMonitorMeta;
    if (!monitorMeta || monitorMeta.inFlight) return;
    monitorMeta.inFlight = true;
    try {
    const { orionConvId, coderConvId, taskId } = monitorMeta;

    const orionConv = conversations.find(c => c.id === orionConvId);
    const coderConv = conversations.find(c => c.id === coderConvId);
    if (!orionConv || !coderConv) {
      stopCoderTaskMonitor(monitorMeta);
      return;
    }
    const durableTask = taskId ? orchestrationTaskCache.get(taskId) : null;
    if (durableTask && ['cancelled', 'completed', 'failed'].includes(durableTask.status)) {
      await notifySupervisorOfCoderCompletion(coderConvId, taskId);
      if (_coderTaskMonitorMeta === monitorMeta) stopCoderTaskMonitor(monitorMeta);
      return;
    }

    const isCoderRunning = !!(window.isAgentRunning && window.isAgentRunning()
      && window.getRunningConversationId && window.getRunningConversationId() === coderConvId
      && (!taskId || !window.getActiveRunTaskId || window.getActiveRunTaskId() === taskId));
    const nowAwaitingClarification = !!(coderConv.awaitingClarification) && !isCoderRunning;
    const nowAwaitingPlan = !!(coderConv.awaitingPlanApproval && !coderConv.planApproved) && !isCoderRunning;
    const elapsed = Math.round((Date.now() - monitorMeta.startTime) / 1000);

    // Stall escalation: not running, nothing queued, not waiting on the user, and no completion
    // receipt ever arrived — the run ended without the completion hook (crash, killed process,
    // queued-but-never-started). Without this, the monitor polled forever showing "Working…" and
    // nobody was told; the user discovered the stuck task by accident much later.
    const isQueuedForCoder = Array.isArray(window.promptQueue)
      && window.promptQueue.some(item => item && (taskId ? item.taskId === taskId : item.conversationId === coderConvId));
    const isQuiet = !isCoderRunning && !isQueuedForCoder && !nowAwaitingClarification && !nowAwaitingPlan;
    if (isQuiet) {
      if (!monitorMeta.quietSince) monitorMeta.quietSince = Date.now();
      if (Date.now() - monitorMeta.quietSince > 60000) {
        const stalledTitle = orionConv.launchedCoderTaskTitle || coderConv.title || 'Coder task';
        const pendingCount = (coderConv.tasks || []).filter(t => t.status !== 'completed' && t.status !== 'x').length;
        let canonicalTask = durableTask;
        if (taskId && typeof window.getOrchestrationTaskStatus === 'function') {
          const statusRead = await window.getOrchestrationTaskStatus(taskId, orionConv.id);
          if (_coderTaskMonitorMeta !== monitorMeta) return;
          if (statusRead && statusRead.success && statusRead.task) canonicalTask = statusRead.task;
        }
        // Pending can mean either a user/input pause or an automatic action-boundary checkpoint.
        // The durable resume policy is authoritative across queue timing gaps and renderer
        // restarts. Recover automatic work under the same task ID; only user/manual pauses should
        // be parked behind a Continue action.
        if (canonicalTask && canonicalTask.status === 'pending') {
          if (String(orionConv.launchedCoderTaskId || '') !== taskId) return;
          if (pendingTaskNeedsRuntimeQueue(canonicalTask)) {
            const continuation = await queueTaskContinuation({
              targetConversationId: coderConvId,
              originConversationId: orionConvId,
              taskId,
              requireExistingTask: true,
              source: 'automatic-action-boundary-recovery'
            });
            if (_coderTaskMonitorMeta !== monitorMeta) return;
            if (continuation && continuation.success) {
              startOrQueueTaskContinuation(continuation, coderConv, {
                source: 'automatic-action-boundary-recovery',
                modelSelectValue: window.getSelectedModel(),
                errorLabel: 'Automatic Coder continuation'
              });
              monitorMeta.quietSince = 0;
              return;
            }
            monitorMeta.quietSince = Date.now();
            return;
          }
          const pendingReason = String(
            canonicalTask.execution && canonicalTask.execution.reason || ''
          ).trim();
          notifyOrionConversation(
            orionConv,
            `Coder paused **${stalledTitle}** before completion. The durable task remains pending${pendingReason ? `: ${pendingReason}.` : '.'} Use Continue to resume it without treating the work as completed or failed.`,
            'supervisor-pending'
          );
          orionConv.lastDelegatedWork = {
            taskId,
            coderConversationId: coderConvId,
            title: stalledTitle,
            projectPath: coderConv.projectPath || inferDispatchProjectPath(orionConv),
            status: 'pending',
            subStatus: pendingReason || 'Paused before completion',
            startedAt: orionConv.launchedCoderTaskStart || 0,
            completedAt: canonicalTask.pendingAt || canonicalTask.updatedAt || Date.now(),
            pendingCount: Math.max(1, pendingCount)
          };
          orionConv.launchedCoderConvId = null;
          orionConv.launchedCoderTaskId = null;
          orionConv.launchedCoderTaskTitle = null;
          orionConv.launchedCoderTaskStart = null;
          if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
          if (window.saveConversationsToStorage) window.saveConversationsToStorage();
          renderDesktopDispatchLanding();
          stopCoderTaskMonitor(monitorMeta);
          return;
        }
        if (canonicalTask && ['completed', 'cancelled', 'failed'].includes(canonicalTask.status)) {
          await notifySupervisorOfCoderCompletion(coderConvId, taskId);
          if (_coderTaskMonitorMeta === monitorMeta) stopCoderTaskMonitor(monitorMeta);
          return;
        }
        let stalledTask = null;
        if (taskId && canonicalTask && canonicalTask.status === 'active'
            && typeof window.finalizeOrchestrationTask === 'function') {
          stalledTask = await window.finalizeOrchestrationTask(taskId, 'failed', {
            reason: 'The Coder run went quiet without recording completion.',
            expectedExecutionId: canonicalTask.execution && canonicalTask.execution.executionId
          });
          if (_coderTaskMonitorMeta !== monitorMeta) return;
        }
        if (taskId && !stalledTask) {
          monitorMeta.quietSince = Date.now();
          return;
        }
        if (taskId && stalledTask.status !== 'failed') {
          if (['completed', 'cancelled'].includes(stalledTask.status)) {
            await notifySupervisorOfCoderCompletion(coderConvId, taskId);
            if (_coderTaskMonitorMeta !== monitorMeta) return;
          }
          stopCoderTaskMonitor(monitorMeta);
          return;
        }
        if (_coderTaskMonitorMeta !== monitorMeta
            || (taskId && String(orionConv.launchedCoderTaskId || '') !== taskId)) return;
        notifyOrionConversation(orionConv, `Coder went quiet on **${stalledTitle}** — the run ended without recording completion (it may have crashed or stalled). The work is parked under Active work; use its Continue action or open the Coder conversation to inspect it.`, 'supervisor-stall');
        orionConv.lastDelegatedWork = {
          taskId,
          coderConversationId: coderConvId,
          title: stalledTitle,
          projectPath: coderConv.projectPath || inferDispatchProjectPath(orionConv),
          status: taskId ? 'failed' : 'blocked',
          subStatus: 'Went quiet without completing',
          startedAt: orionConv.launchedCoderTaskStart || 0,
          completedAt: Date.now(),
          pendingCount
        };
        orionConv.launchedCoderConvId = null;
        orionConv.launchedCoderTaskId = null;
        orionConv.launchedCoderTaskTitle = null;
        orionConv.launchedCoderTaskStart = null;
        if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
        if (window.saveConversationsToStorage) window.saveConversationsToStorage();
        renderDesktopDispatchLanding();
        stopCoderTaskMonitor(monitorMeta);
        return;
      }
    } else {
      monitorMeta.quietSince = 0;
    }

    // The durable task drives presentation across the queued gap and Coder execution. Live
    // conversation activity only enriches the detail; it is not proof that the task exists.
    if (activeConversationId === orionConvId) {
      syncDispatchCoderStatusCard(orionConvId, isCoderRunning, isCoderRunning ? coderConvId : '');
    }

    // Detect: Coder needs clarification → proxy it into Orion
    if (nowAwaitingClarification && !monitorMeta.notifiedClarification) {
      monitorMeta.notifiedClarification = true;
      renderCoderClarificationProxy(orionConv, coderConv.awaitingClarification, coderConvId);
      showCoderStatusCard(coderConv.title || 'Coder Task', 'Waiting for your input…', elapsed);
    }
    // Reset flag if coder cleared its clarification
    if (!coderConv.awaitingClarification) {
      monitorMeta.notifiedClarification = false;
    }

    // Detect: Coder is awaiting plan approval → notify Orion
    if (nowAwaitingPlan && !monitorMeta.lastAwaitingPlanApproval) {
      monitorMeta.lastAwaitingPlanApproval = true;
      const relayed = await relayCoderPlanToDispatch(orionConv, coderConv, taskId);
      if (!relayed.success) {
        notifyOrionConversation(
          orionConv,
          `Coder is waiting for plan approval, but Dispatch could not load the saved plan: ${relayed.error}`,
          'supervisor-plan-error'
        );
      } else if (activeConversationId === orionConvId) {
        syncDispatchCoderStatusCard(orionConvId, false, '');
      }
    }
    if (!nowAwaitingPlan) monitorMeta.lastAwaitingPlanApproval = false;

    monitorMeta.lastRunning = isCoderRunning;
    } finally {
      if (_coderTaskMonitorMeta === monitorMeta) monitorMeta.inFlight = false;
    }
  }, 2000);
};

function stopCoderTaskMonitor(expectedMeta = null) {
  if (expectedMeta && _coderTaskMonitorMeta !== expectedMeta) return false;
  if (_coderTaskMonitorInterval) {
    clearInterval(_coderTaskMonitorInterval);
    _coderTaskMonitorInterval = null;
  }
  _coderTaskMonitorMeta = null;
  hideCoderStatusCard();
  return true;
}
window.stopCoderTaskMonitor = stopCoderTaskMonitor;

async function relayCoderPlanToDispatch(orionConv, coderConv, taskId) {
  if (!orionConv || !coderConv) return { success: false, error: 'Plan relay conversations are missing.' };
  let planText = '';
  try {
    planText = await readConversationTextArtifact(coderConv, 'implementation_plan.md', { maxChars: 50000 });
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
  if (!String(planText || '').trim()) {
    return { success: false, error: 'Coder did not save a readable implementation plan.' };
  }
  const delegatedPlan = {
    taskId: String(taskId || coderConv.awaitingPlanApprovalTaskId || ''),
    coderConversationId: coderConv.id,
    title: orionConv.launchedCoderTaskTitle || coderConv.title || 'Coder task',
    createdAt: Date.now()
  };
  coderConv.planRevisionInProgress = null;
  orionConv.revisingDelegatedPlan = null;
  orionConv.awaitingDelegatedPlan = delegatedPlan;
  if (typeof window.markConversationDirty === 'function') {
    window.markConversationDirty(coderConv.id);
    window.markConversationDirty(orionConv.id);
  }
  notifyOrionConversation(
    orionConv,
    `Coder prepared this implementation plan for **${delegatedPlan.title}**:\n\n${String(planText).trim()}\n\nApprove it here to continue. If you want changes, reply in this Dispatch conversation and I’ll relay the revision to Coder.`,
    'supervisor-plan',
    {
      isDelegatedPlanCard: true,
      delegatedPlan
    }
  );
  return { success: true, delegatedPlan };
}

function summarizeCoderCompletion(durableTask, coderConv) {
  const result = durableTask && durableTask.result && typeof durableTask.result === 'object'
    ? durableTask.result : {};
  // A summary that answers the completion gate ("all coverage surfaces are inspected and
  // verified, no blockers remain...") is internal machinery narration, never something to relay
  // to the user. Agent-side selection now avoids recording it, but tasks finalized by older
  // builds still carry it — treat it as absent and fall back to the last real answer.
  const isGateNarration = text => !!(RendererOrchestrationContracts
    && typeof RendererOrchestrationContracts.isCompletionGateNarration === 'function'
    && RendererOrchestrationContracts.isCompletionGateNarration(text));
  let summary = String(result.summary || '').trim();
  if (isGateNarration(summary)) summary = '';
  const finalMessage = coderConv && Array.isArray(coderConv.messages)
    ? [...coderConv.messages].reverse().find(message =>
      message
      && (message.role === 'assistant' || message.role === 'model')
      && String(message.text || '').trim()
      && String(message.text || '').trim() !== 'Thinking...'
      && !message.isPlanApprovalCard
      && !isGateNarration(message.text)
    )
    : null;
  if (!summary && finalMessage) {
    summary = String(finalMessage.text || '').trim();
  }
  // Older task records sometimes appended a generated tool ledger under a final Work
  // Walkthrough heading. Remove only that mechanical tail. A user-authored report may itself
  // begin with "## Work Walkthrough" and must survive intact.
  const stripGeneratedWalkthroughTail = text => {
    const value = String(text || '');
    const marker = '## Work Walkthrough';
    let searchFrom = value.length;
    while (searchFrom >= 0) {
      const index = value.lastIndexOf(marker, searchFrom);
      if (index < 0) break;
      const tail = value.slice(index + marker.length).trimStart();
      if (/^-\s+\*\*(?:Done|Failed|Working):\*\*/i.test(tail)) {
        return value.slice(0, index).trim();
      }
      searchFrom = index - 1;
    }
    return value;
  };
  summary = stripGeneratedWalkthroughTail(summary)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000);
  return {
    summary,
    changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles.slice(0, 20) : [],
    verification: Array.isArray(result.verification) ? result.verification.slice(0, 12) : [],
    images: (Array.isArray(result.images) ? result.images : (finalMessage && Array.isArray(finalMessage.images) ? finalMessage.images : []))
      .filter(image => image && image.path)
      .slice(0, 4)
      .map(image => ({
        ...image,
        sourceConversationId: image.sourceConversationId || (coderConv && coderConv.id) || ''
      }))
  };
}

function reconcileDelegatedTaskCancellation(orionConv, durableTask, fallbackRole = 'coder') {
  if (!orionConv || !durableTask || String(durableTask.status || '') !== 'cancelled') return false;
  const taskId = String(durableTask.taskId || durableTask.id || '');
  if (!taskId) return false;
  const targetConversationId = String(durableTask.target && durableTask.target.conversationId || '');
  const targetConv = targetConversationId ? conversations.find(conv => conv.id === targetConversationId) : null;
  const targetMode = String(
    durableTask.target && durableTask.target.mode
    || targetConv && conversationMode(targetConv)
    || orionConv.launchedTaskRole
    || fallbackRole
  ).toLowerCase();
  const role = targetMode === 'operator' ? 'operator' : 'coder';
  const roleName = role === 'operator' ? 'Operator' : 'Coder';
  const taskTitle = String(durableTask.title || orionConv.launchedCoderTaskTitle || `${roleName} task`);

  notifyOrionConversation(
    orionConv,
    `Cancelled **${taskTitle}**. ${roleName} will not continue this task, and it was not recorded as completed.`,
    'supervisor-cancellation',
    {
      orchestrationTaskId: taskId,
      orchestrationStatus: 'cancelled'
    }
  );
  orionConv.lastDelegatedWork = {
    taskId,
    coderConversationId: targetConversationId,
    title: taskTitle,
    objective: durableTask.objective || '',
    projectPath: durableTask.workspacePath || inferDispatchProjectPath(orionConv),
    status: 'cancelled',
    subStatus: 'Cancelled',
    startedAt: durableTask.startedAt || orionConv.launchedCoderTaskStart || 0,
    completedAt: durableTask.cancelledAt || Date.now(),
    pendingCount: 0,
    role
  };
  if (String(orionConv.launchedCoderTaskId || '') === taskId) {
    orionConv.launchedCoderConvId = null;
    orionConv.launchedCoderTaskId = null;
    orionConv.launchedCoderTaskTitle = null;
    orionConv.launchedCoderTaskStart = null;
    orionConv.launchedTaskRole = null;
    orionConv.awaitingDelegatedPlan = null;
    orionConv.revisingDelegatedPlan = null;
  }
  orionConv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();
  return true;
}

// ── Supervisor completion notification ────────────────────────────────────────
async function notifySupervisorOfCoderCompletion(finishedCoderConvId, expectedTaskId = '') {
  if (!finishedCoderConvId) return;
  const normalizedExpectedTaskId = String(expectedTaskId || '');
  const orionConv = conversations.find(c => c.launchedCoderConvId === finishedCoderConvId
    && (!normalizedExpectedTaskId || String(c.launchedCoderTaskId || '') === normalizedExpectedTaskId));
  if (!orionConv) return;
  const taskId = String(normalizedExpectedTaskId || orionConv.launchedCoderTaskId
    || (_coderTaskMonitorMeta && _coderTaskMonitorMeta.coderConvId === finishedCoderConvId && _coderTaskMonitorMeta.taskId)
    || '');
  let durableTask = null;
  if (taskId) {
    const read = await window.getOrchestrationTaskStatus(taskId, orionConv.id);
    if (!read || !read.success || !read.task) return;
    durableTask = read.task;
  }
  if (taskId && String(orionConv.launchedCoderTaskId || '') !== taskId) return;
  if (durableTask && (durableTask.status === 'pending' || durableTask.status === 'active')) return;
  const existingTerminalNotification = Array.isArray(orionConv.messages)
    ? orionConv.messages.find(message =>
        message
        && message.source === 'supervisor-completion'
        && String(message.orchestrationTaskId || '') === taskId
      )
    : null;
  if (existingTerminalNotification) {
    orionConv.launchedCoderConvId = null;
    orionConv.launchedCoderTaskId = null;
    orionConv.launchedCoderTaskTitle = null;
    orionConv.launchedCoderTaskStart = null;
    orionConv.awaitingDelegatedPlan = null;
    orionConv.revisingDelegatedPlan = null;
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    return;
  }
  if (durableTask && durableTask.status === 'cancelled') {
    if (_coderTaskMonitorMeta && _coderTaskMonitorMeta.coderConvId === finishedCoderConvId
        && (!_coderTaskMonitorMeta.taskId || _coderTaskMonitorMeta.taskId === taskId)) {
      stopCoderTaskMonitor(_coderTaskMonitorMeta);
    }
    reconcileDelegatedTaskCancellation(orionConv, durableTask, 'coder');
    return;
  }

  // Stop the monitor now that the task finished
  if (_coderTaskMonitorMeta && _coderTaskMonitorMeta.coderConvId === finishedCoderConvId
      && (!_coderTaskMonitorMeta.taskId || _coderTaskMonitorMeta.taskId === taskId)) {
    stopCoderTaskMonitor(_coderTaskMonitorMeta);
  }

  const coderConv = conversations.find(c => c.id === finishedCoderConvId);
  const taskTitle = String(
    durableTask && durableTask.title
    || orionConv.launchedCoderTaskTitle
    || (coderConv && coderConv.title)
    || 'Coder Task'
  );
  const tasks = (coderConv && coderConv.tasks) || [];
  const doneTasks = tasks.filter(t => t.status === 'completed' || t.status === 'x');
  const pendingTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'x');
  const elapsed = orionConv.launchedCoderTaskStart
    ? Math.round((Date.now() - orionConv.launchedCoderTaskStart) / 60000)
    : null;

  // Determine outcome
  const blockedFlag = coderConv && Array.isArray(coderConv.messages)
    && coderConv.messages.slice(-3).some(m => /blocked|cannot|error|failed/i.test(m.text || ''));
  const completion = summarizeCoderCompletion(durableTask, coderConv);

  let summaryText;
  if (durableTask && durableTask.status === 'failed') {
    summaryText = `Coder failed **${taskTitle}**. The task state is failed; check the Coder conversation for the recorded error before retrying.`;
  } else if (durableTask && durableTask.status === 'completed') {
    const elapsed_str = elapsed ? ` (${elapsed}m)` : '';
    summaryText = `Coder completed **${taskTitle}**${elapsed_str}.`;
    if (completion.summary) summaryText += `\n\n${completion.summary}`;
    if (completion.changedFiles.length) {
      summaryText += `\n\nChanged: ${completion.changedFiles.map(file => `\`${file}\``).join(', ')}`;
    }
    // Coder still records verification evidence on the durable task result, but the Dispatch
    // relay does not print it — a bulleted evidence dump reads like a machine log, not a reply.
    // It rides along in message metadata so it stays recoverable without being shown.
  } else if (pendingTasks.length > 0 && doneTasks.length === 0) {
    summaryText = `Coder stopped on **${taskTitle}** — ${pendingTasks.length} task${pendingTasks.length > 1 ? 's' : ''} still pending. It may have hit a blocker. Check the Coder conversation for details.`;
  } else if (pendingTasks.length > 0) {
    summaryText = `Coder finished part of **${taskTitle}** — ${doneTasks.length} done, ${pendingTasks.length} remaining. You can queue a continuation or check the Coder conversation.`;
  } else {
    const elapsed_str = elapsed ? ` (${elapsed}m)` : '';
    summaryText = `Coder finished **${taskTitle}**${elapsed_str}. ${doneTasks.length > 0 ? `${doneTasks.length} task${doneTasks.length > 1 ? 's' : ''} completed.` : ''} Ready for your next direction.`;
  }
  // Phase 3 (restart/recovery, item 12): if this task was reconciled at startup and its background
  // process was confirmed still alive, say so explicitly instead of letting a generic "failed"
  // message imply the workspace is clean.
  if (interruptedTaskLivenessNotes.has(taskId)) {
    summaryText += `\n\n${interruptedTaskLivenessNotes.get(taskId)}`;
    interruptedTaskLivenessNotes.delete(taskId);
  }

  notifyOrionConversation(orionConv, summaryText, 'supervisor-completion', {
    orchestrationTaskId: taskId,
    orchestrationStatus: durableTask && durableTask.status || '',
    verificationEvidence: completion.verification,
    images: completion.images
  });

  orionConv.lastDelegatedWork = {
    taskId,
    coderConversationId: finishedCoderConvId,
    title: taskTitle,
    objective: durableTask && durableTask.objective || '',
    // Cached from the durable result so Dispatch can answer "did you test it?" after the run
    // ends, when launchedCoderConvId is already cleared and no live status is available.
    changedFiles: completion.changedFiles,
    verification: completion.verification,
    images: completion.images,
    projectPath: (coderConv && coderConv.projectPath) || inferDispatchProjectPath(orionConv),
    status: durableTask ? durableTask.status : (blockedFlag || pendingTasks.length > 0 ? 'blocked' : 'completed'),
    subStatus: durableTask
      ? (RendererTaskOrchestration ? RendererTaskOrchestration.describeTaskStatus(durableTask) : durableTask.status)
      : (blockedFlag
      ? 'Stopped with a blocker'
      : (pendingTasks.length > 0 ? `${doneTasks.length} complete, ${pendingTasks.length} remaining` : 'Completed')),
    startedAt: orionConv.launchedCoderTaskStart || 0,
    completedAt: (durableTask && (durableTask.completedAt || durableTask.failedAt || durableTask.cancelledAt)) || Date.now(),
    pendingCount: pendingTasks.length
  };

  // Clear the launched coder conv reference so we don't double-notify
  orionConv.launchedCoderConvId = null;
  orionConv.launchedCoderTaskId = null;
  orionConv.launchedCoderTaskTitle = null;
  orionConv.launchedCoderTaskStart = null;
  orionConv.awaitingDelegatedPlan = null;
  orionConv.revisingDelegatedPlan = null;
  if (coderConv) coderConv.planRevisionInProgress = null;
  orionConv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') {
    window.markConversationDirty(orionConv.id);
    if (coderConv) window.markConversationDirty(coderConv.id);
  }
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();
}

// ── Operator task monitor (Phase 3 piece 5) ────────────────────────────────────
//
// Deliberately not a full mirror of startCoderTaskMonitor above. Most of that function's ~215
// lines exist to service two Coder-only pause states: awaitingClarification (Coder can call
// ask_clarifying_questions) and awaitingPlanApproval (Coder has a plan-approval workflow, relayed
// to Dispatch via relayCoderPlanToDispatch). Operator has neither: piece 4 did not put
// ask_clarifying_questions on OPERATOR_TOOL_ALLOWLIST, and OPERATOR_INSTRUCTION (piece 3) defines
// no plan-approval step. Building the clarification-proxy and plan-relay machinery for pause
// states Operator cannot enter would be dead code, not parity. What Operator's monitor still
// needs, and has: terminal-status detection (the primary path is actually
// window.onOrchestrationTaskFinalized below; this poll is the backstop for missed events) and a
// quiet-stall backstop so a crashed/killed Operator run doesn't poll forever with no notification.
window.startOperatorTaskMonitor = function(orionConvId, operatorConvId, taskId = '') {
  stopOperatorTaskMonitor(_operatorTaskMonitorMeta);

  _operatorTaskMonitorMeta = {
    generation: ++_operatorTaskMonitorGeneration,
    orionConvId,
    operatorConvId,
    taskId: String(taskId || ''),
    startTime: Date.now(),
    quietSince: 0,
    inFlight: false
  };

  _operatorTaskMonitorInterval = setInterval(async () => {
    const monitorMeta = _operatorTaskMonitorMeta;
    if (!monitorMeta || monitorMeta.inFlight) return;
    monitorMeta.inFlight = true;
    try {
      const { orionConvId, operatorConvId, taskId } = monitorMeta;

      const orionConv = conversations.find(c => c.id === orionConvId);
      const operatorConv = conversations.find(c => c.id === operatorConvId);
      if (!orionConv || !operatorConv) {
        stopOperatorTaskMonitor(monitorMeta);
        return;
      }
      const durableTask = taskId ? orchestrationTaskCache.get(taskId) : null;
      if (durableTask && ['cancelled', 'completed', 'failed'].includes(durableTask.status)) {
        await notifySupervisorOfOperatorCompletion(operatorConvId, taskId);
        if (_operatorTaskMonitorMeta === monitorMeta) stopOperatorTaskMonitor(monitorMeta);
        return;
      }

      const isOperatorRunning = !!(window.isAgentRunning && window.isAgentRunning()
        && window.getRunningConversationId && window.getRunningConversationId() === operatorConvId
        && (!taskId || !window.getActiveRunTaskId || window.getActiveRunTaskId() === taskId));
      const isQueuedForOperator = Array.isArray(window.promptQueue)
        && window.promptQueue.some(item => item && (taskId ? item.taskId === taskId : item.conversationId === operatorConvId));
      const isQuiet = !isOperatorRunning && !isQueuedForOperator;

      if (isQuiet) {
        if (!monitorMeta.quietSince) monitorMeta.quietSince = Date.now();
        if (Date.now() - monitorMeta.quietSince > 60000) {
          const stalledTitle = orionConv.launchedCoderTaskTitle || operatorConv.title || 'Operator task';
          let canonicalTask = durableTask;
          if (taskId && typeof window.getOrchestrationTaskStatus === 'function') {
            const statusRead = await window.getOrchestrationTaskStatus(taskId, orionConv.id);
            if (_operatorTaskMonitorMeta !== monitorMeta) return;
            if (statusRead && statusRead.success && statusRead.task) canonicalTask = statusRead.task;
          }
          if (canonicalTask && ['completed', 'cancelled', 'failed'].includes(canonicalTask.status)) {
            await notifySupervisorOfOperatorCompletion(operatorConvId, taskId);
            if (_operatorTaskMonitorMeta === monitorMeta) stopOperatorTaskMonitor(monitorMeta);
            return;
          }
          let stalledTask = null;
          if (taskId && canonicalTask && canonicalTask.status === 'active'
              && typeof window.finalizeOrchestrationTask === 'function') {
            stalledTask = await window.finalizeOrchestrationTask(taskId, 'failed', {
              reason: 'The Operator run went quiet without recording completion.',
              expectedExecutionId: canonicalTask.execution && canonicalTask.execution.executionId
            });
            if (_operatorTaskMonitorMeta !== monitorMeta) return;
          }
          if (taskId && !stalledTask) {
            monitorMeta.quietSince = Date.now();
            return;
          }
          if (taskId && stalledTask.status !== 'failed') {
            if (['completed', 'cancelled'].includes(stalledTask.status)) {
              await notifySupervisorOfOperatorCompletion(operatorConvId, taskId);
              if (_operatorTaskMonitorMeta !== monitorMeta) return;
            }
            stopOperatorTaskMonitor(monitorMeta);
            return;
          }
          if (_operatorTaskMonitorMeta !== monitorMeta
              || (taskId && String(orionConv.launchedCoderTaskId || '') !== taskId)) return;
          notifyOrionConversation(orionConv, `Operator went quiet on **${stalledTitle}** — the run ended without recording completion (it may have crashed or stalled). The work is parked under Active work; open the Operator conversation to inspect it.`, 'supervisor-stall');
          orionConv.lastDelegatedWork = {
            taskId,
            coderConversationId: operatorConvId,
            title: stalledTitle,
            projectPath: operatorConv.projectPath || inferDispatchProjectPath(orionConv),
            status: taskId ? 'failed' : 'blocked',
            subStatus: 'Went quiet without completing',
            startedAt: orionConv.launchedCoderTaskStart || 0,
            completedAt: Date.now(),
            pendingCount: 0
          };
          orionConv.launchedCoderConvId = null;
          orionConv.launchedCoderTaskId = null;
          orionConv.launchedCoderTaskTitle = null;
          orionConv.launchedCoderTaskStart = null;
          orionConv.launchedTaskRole = null;
          if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
          if (window.saveConversationsToStorage) window.saveConversationsToStorage();
          renderDesktopDispatchLanding();
          stopOperatorTaskMonitor(monitorMeta);
          return;
        }
      } else {
        monitorMeta.quietSince = 0;
      }

      if (activeConversationId === orionConvId) {
        syncDispatchCoderStatusCard(orionConvId, isOperatorRunning, isOperatorRunning ? operatorConvId : '');
      }
    } finally {
      if (_operatorTaskMonitorMeta === monitorMeta) monitorMeta.inFlight = false;
    }
  }, 2000);
};

function stopOperatorTaskMonitor(expectedMeta = null) {
  if (expectedMeta && _operatorTaskMonitorMeta !== expectedMeta) return false;
  if (_operatorTaskMonitorInterval) {
    clearInterval(_operatorTaskMonitorInterval);
    _operatorTaskMonitorInterval = null;
  }
  _operatorTaskMonitorMeta = null;
  return true;
}
window.stopOperatorTaskMonitor = stopOperatorTaskMonitor;

// Parallel to notifySupervisorOfCoderCompletion, with Operator-phrased messages. Reuses
// summarizeCoderCompletion directly (confirmed role-agnostic: it reads durableTask.result and the
// specialist conversation's messages generically, with no "Coder"-specific text). Does not reuse
// notifySupervisorOfCoderCompletion itself, which hardcodes "Coder" throughout its summary text.
async function notifySupervisorOfOperatorCompletion(finishedOperatorConvId, expectedTaskId = '') {
  if (!finishedOperatorConvId) return;
  const normalizedExpectedTaskId = String(expectedTaskId || '');
  const orionConv = conversations.find(c => c.launchedCoderConvId === finishedOperatorConvId
    && (!normalizedExpectedTaskId || String(c.launchedCoderTaskId || '') === normalizedExpectedTaskId));
  if (!orionConv) return;
  const taskId = String(normalizedExpectedTaskId || orionConv.launchedCoderTaskId
    || (_operatorTaskMonitorMeta && _operatorTaskMonitorMeta.operatorConvId === finishedOperatorConvId && _operatorTaskMonitorMeta.taskId)
    || '');
  let durableTask = null;
  if (taskId) {
    const read = await window.getOrchestrationTaskStatus(taskId, orionConv.id);
    if (!read || !read.success || !read.task) return;
    durableTask = read.task;
  }
  if (taskId && String(orionConv.launchedCoderTaskId || '') !== taskId) return;
  if (durableTask && (durableTask.status === 'pending' || durableTask.status === 'active')) return;
  const existingTerminalNotification = Array.isArray(orionConv.messages)
    ? orionConv.messages.find(message =>
        message
        && message.source === 'supervisor-completion'
        && String(message.orchestrationTaskId || '') === taskId
      )
    : null;
  if (existingTerminalNotification) {
    orionConv.launchedCoderConvId = null;
    orionConv.launchedCoderTaskId = null;
    orionConv.launchedCoderTaskTitle = null;
    orionConv.launchedCoderTaskStart = null;
    orionConv.launchedTaskRole = null;
    if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
    if (window.saveConversationsToStorage) window.saveConversationsToStorage();
    return;
  }
  if (durableTask && durableTask.status === 'cancelled') {
    if (_operatorTaskMonitorMeta && _operatorTaskMonitorMeta.operatorConvId === finishedOperatorConvId
        && (!_operatorTaskMonitorMeta.taskId || _operatorTaskMonitorMeta.taskId === taskId)) {
      stopOperatorTaskMonitor(_operatorTaskMonitorMeta);
    }
    reconcileDelegatedTaskCancellation(orionConv, durableTask, 'operator');
    return;
  }

  if (_operatorTaskMonitorMeta && _operatorTaskMonitorMeta.operatorConvId === finishedOperatorConvId
      && (!_operatorTaskMonitorMeta.taskId || _operatorTaskMonitorMeta.taskId === taskId)) {
    stopOperatorTaskMonitor(_operatorTaskMonitorMeta);
  }

  const operatorConv = conversations.find(c => c.id === finishedOperatorConvId);
  const taskTitle = String(
    durableTask && durableTask.title
    || orionConv.launchedCoderTaskTitle
    || (operatorConv && operatorConv.title)
    || 'Operator Task'
  );
  const elapsed = orionConv.launchedCoderTaskStart
    ? Math.round((Date.now() - orionConv.launchedCoderTaskStart) / 60000)
    : null;
  const completion = summarizeCoderCompletion(durableTask, operatorConv);

  let summaryText;
  if (durableTask && durableTask.status === 'failed') {
    summaryText = `Operator failed **${taskTitle}**. The task state is failed; check the Operator conversation for the recorded error before retrying.`;
  } else if (durableTask && durableTask.status === 'completed') {
    const elapsed_str = elapsed ? ` (${elapsed}m)` : '';
    summaryText = `Operator completed **${taskTitle}**${elapsed_str}.`;
    if (completion.summary) summaryText += `\n\n${completion.summary}`;
  } else {
    const elapsed_str = elapsed ? ` (${elapsed}m)` : '';
    summaryText = `Operator finished **${taskTitle}**${elapsed_str}. Ready for your next direction.`;
  }
  // Phase 3 (restart/recovery, item 12): see the matching comment in notifySupervisorOfCoderCompletion.
  if (interruptedTaskLivenessNotes.has(taskId)) {
    summaryText += `\n\n${interruptedTaskLivenessNotes.get(taskId)}`;
    interruptedTaskLivenessNotes.delete(taskId);
  }

  notifyOrionConversation(orionConv, summaryText, 'supervisor-completion', {
    orchestrationTaskId: taskId,
    orchestrationStatus: durableTask && durableTask.status || '',
    verificationEvidence: completion.verification,
    images: completion.images
  });

  orionConv.lastDelegatedWork = {
    taskId,
    coderConversationId: finishedOperatorConvId,
    title: taskTitle,
    objective: durableTask && durableTask.objective || '',
    changedFiles: completion.changedFiles,
    verification: completion.verification,
    images: completion.images,
    projectPath: (operatorConv && operatorConv.projectPath) || inferDispatchProjectPath(orionConv),
    status: durableTask ? durableTask.status : 'completed',
    subStatus: durableTask
      ? (RendererTaskOrchestration ? RendererTaskOrchestration.describeTaskStatus(durableTask) : durableTask.status)
      : 'Completed',
    startedAt: orionConv.launchedCoderTaskStart || 0,
    completedAt: (durableTask && (durableTask.completedAt || durableTask.failedAt || durableTask.cancelledAt)) || Date.now(),
    pendingCount: 0
  };

  orionConv.launchedCoderConvId = null;
  orionConv.launchedCoderTaskId = null;
  orionConv.launchedCoderTaskTitle = null;
  orionConv.launchedCoderTaskStart = null;
  orionConv.launchedTaskRole = null;
  orionConv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') {
    window.markConversationDirty(orionConv.id);
    if (operatorConv) window.markConversationDirty(operatorConv.id);
  }
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();
}

window.onOrchestrationTaskFinalized = async function(taskId, targetConversationId, status) {
  if (!taskId || !targetConversationId || !['completed', 'failed', 'cancelled'].includes(String(status || ''))) return;
  // Route by the target conversation's own role rather than always assuming Coder. Before this
  // fix, an Operator task's completion would still call notifySupervisorOfCoderCompletion (which
  // matches on the reused launchedCoderConvId field, so it would "work" but mislabel every message
  // as "Coder failed/completed..." for a run that was never Coder).
  const targetConv = conversations.find(c => c.id === targetConversationId);
  if (targetConv && conversationMode(targetConv) === 'operator') {
    await notifySupervisorOfOperatorCompletion(targetConversationId, taskId);
  } else {
    await notifySupervisorOfCoderCompletion(targetConversationId, taskId);
  }
};

// Appends a message to an Orion conversation, rendering it if active.
function notifyOrionConversation(orionConv, text, source, metadata = {}) {
  if (!orionConv || !text) return;
  if (!Array.isArray(orionConv.messages)) orionConv.messages = [];
  if (metadata.orchestrationTaskId
      && orionConv.messages.some(message =>
        message
        && message.source === source
        && String(message.orchestrationTaskId || '') === String(metadata.orchestrationTaskId)
      )) {
    return;
  }
  const message = { ...metadata, role: 'assistant', text, source, createdAt: Date.now() };
  orionConv.messages.push(message);
  orionConv.updatedAt = Date.now();
  if (typeof window.markConversationDirty === 'function') window.markConversationDirty(orionConv.id);
  if (window.saveConversationsToStorage) window.saveConversationsToStorage();
  if (activeConversationId === orionConv.id && typeof window.renderAiMessage === 'function') {
    window.clearActiveAiBubble();
    window.renderAiMessage(text, [], orionConv.id, message);
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
function showCoderStatusCard(taskTitle, subStatus, elapsedSec, preview = '', statusLabel = 'Coder working on') {
  const card = document.getElementById('coder-task-status-card');
  if (!card) return;
  const labelEl = card.querySelector('.coder-status-label');
  const titleEl = card.querySelector('.coder-status-task-name');
  const subEl = card.querySelector('.coder-status-substatus');
  const elapsedEl = card.querySelector('.coder-status-elapsed');
  const previewEl = card.querySelector('.coder-status-preview');
  if (labelEl) labelEl.textContent = statusLabel || 'Coder working on';
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

function syncDispatchCoderStatusCard(
  conversationId = activeConversationId,
  isGlobalRunning = !!(window.isAgentRunning && window.isAgentRunning()),
  globalRunningId = window.getRunningConversationId ? window.getRunningConversationId() : ''
) {
  const dispatchConversation = conversations.find(conversation =>
    conversation.id === conversationId && conversationMode(conversation) === 'orion');
  if (!dispatchConversation) return false;
  const preferredTaskId = dispatchConversation.launchedCoderTaskId
    || dispatchConversation.lastOwnedTaskId
    || '';
  const task = getSupervisedTaskForConversation(dispatchConversation.id, preferredTaskId);
  const presentation = getSupervisedTaskPresentation(task, isGlobalRunning, globalRunningId);
  if (!task || !presentation || !presentation.isOngoing) return false;
  const targetConversation = presentation.targetConversation;
  const lastAssistant = targetConversation && [...(targetConversation.messages || [])].reverse().find(message =>
    (message.role === 'assistant' || message.role === 'model')
    && String(message.text || '').trim()
    && String(message.text || '').trim() !== 'Thinking...');
  const preview = lastAssistant
    ? String(lastAssistant.text).replace(/\s+/g, ' ').trim().slice(0, 110)
    : '';
  const startedAt = Number(task.startedAt || task.createdAt || Date.now());
  const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  showCoderStatusCard(
    task.title || (targetConversation && targetConversation.title) || 'Coder task',
    presentation.detail,
    elapsed,
    preview,
    presentation.label
  );
  const card = document.getElementById('coder-task-status-card');
  if (card) {
    card.dataset.taskId = String(task.taskId || '');
    card.dataset.taskStatus = presentation.status;
    card.dataset.taskPhase = presentation.phase;
    card.dataset.agentRole = String(task.target && task.target.mode || 'coder').toLowerCase();
    card.setAttribute('aria-label', card.dataset.agentRole === 'operator'
      ? `Operator screen control: ${task.title || 'desktop task'}`
      : `Coder task: ${task.title || 'task'}`);
  }
  return true;
}

function hideCoderStatusCard() {
  const card = document.getElementById('coder-task-status-card');
  if (card) {
    card.classList.remove('visible');
    delete card.dataset.agentRole;
  }
}

// The label shown on the live progress pill.
//
// 'analyzing' is the pre-classification window — the run has started but the request has not
// been read yet. It used to fall through to "Preparing implementation plan", which was a guess
// made before Orion knew what was asked, so a plain "how are you doing?" displayed a
// plan-preparation banner for the whole classification round trip.
function buildAgentStatusLabel(executionMode, stepNum, isApproved) {
  if (executionMode === 'analyzing') return 'Reading your request...';
  const working = isApproved
    || executionMode === 'direct'
    || executionMode === 'executing'
    || executionMode === 'answer';
  return working ? `Working (Step ${stepNum})...` : `Preparing implementation plan (Step ${stepNum})...`;
}
window.buildAgentStatusLabel = buildAgentStatusLabel;

// The "Working (Step N)..." / "Preparing implementation plan (Step N)..." pill is baked into an
// assistant bubble's innerHTML by renderAiMessage, so it only disappears if that bubble is
// re-rendered after the run ends. It never was: runAgentLoop does its FINAL render while
// isAgentRunning() is still true and only clears the flag afterwards, in its finally block. The
// result was a finished answer sitting under a live-looking progress pill while the header
// already read "Ready" — two contradictory states, until the next reload.
//
// Called from runAgentLoop's finally once the run flags are down. Guarded so a still-running
// (or immediately re-queued) run keeps its indicator.
function clearAgentRunningIndicators() {
  if (window.isAgentRunning && window.isAgentRunning()) return;
  document.querySelectorAll('.agent-running-indicator').forEach(node => node.remove());
}
window.clearAgentRunningIndicators = clearAgentRunningIndicators;
