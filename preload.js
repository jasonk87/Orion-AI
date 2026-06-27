const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window Controls
  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  
  // Workspace Actions
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
  showConfirmDialog: (message, title) => ipcRenderer.invoke('show-confirm-dialog', { message, title }),
  launchWorkspaceApp: (workspacePath) => ipcRenderer.invoke('launch-workspace-app', workspacePath),
  getWorkspaceEntrypoint: (workspacePath) => ipcRenderer.invoke('get-workspace-entrypoint', workspacePath),
  setWorkspaceEntrypoint: (workspacePath, entrypoint) => ipcRenderer.invoke('set-workspace-entrypoint', { workspacePath, entrypoint }),
  openWorkspaceFolder: (workspacePath) => ipcRenderer.invoke('open-workspace-folder', workspacePath),
  gitPush: (workspacePath, remote, branch, setUpstream) => ipcRenderer.invoke('git-push', { workspacePath, remote, branch, setUpstream }),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  readFile: (workspacePath, relativePath, options) => ipcRenderer.invoke('read-file', { workspacePath, relativePath, options }),
  deletePath: (workspacePath, relativePath) => ipcRenderer.invoke('delete-path', { workspacePath, relativePath }),
  movePath: (workspacePath, fromPath, toPath) => ipcRenderer.invoke('move-path', { workspacePath, fromPath, toPath }),
  renamePath: (workspacePath, relativePath, newName) => ipcRenderer.invoke('rename-path', { workspacePath, relativePath, newName }),
  copyPath: (workspacePath, fromPath, toPath) => ipcRenderer.invoke('copy-path', { workspacePath, fromPath, toPath }),
  downloadFile: (workspacePath, url, destination) => ipcRenderer.invoke('download-file', { workspacePath, url, destination }),
  inspectArchive: (workspacePath, relativePath) => ipcRenderer.invoke('inspect-archive', { workspacePath, relativePath }),
  extractArchive: (workspacePath, relativePath, destination) => ipcRenderer.invoke('extract-archive', { workspacePath, relativePath, destination }),
  inspectBinaryAsset: (workspacePath, relativePath) => ipcRenderer.invoke('inspect-binary-asset', { workspacePath, relativePath }),
  listAssetMetadata: (workspacePath, relativePath) => ipcRenderer.invoke('list-asset-metadata', { workspacePath, relativePath }),
  writeFile: (workspacePath, relativePath, content) => ipcRenderer.invoke('write-file', { workspacePath, relativePath, content }),
  patchFile: (workspacePath, relativePath, operation) => ipcRenderer.invoke('patch-file', { workspacePath, relativePath, operation }),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  writeRunArtifact: (payload) => ipcRenderer.invoke('write-run-artifact', payload),
  listRunArtifacts: (conversationId) => ipcRenderer.invoke('list-run-artifacts', conversationId),
  googleSearch: (query, apiKey, searchEngineId, numResults) => ipcRenderer.invoke('google-search', { query, apiKey, searchEngineId, numResults }),
  fetchWebPage: (url) => ipcRenderer.invoke('fetch-web-page', { url }),
  getPhoneCompanionPairing: () => ipcRenderer.invoke('get-phone-companion-pairing'),
  enablePhoneCompanionLan: () => ipcRenderer.invoke('enable-phone-companion-lan'),
  getPhoneCompanionDevices: () => ipcRenderer.invoke('get-phone-companion-devices'),
  revokePhoneCompanionDevice: (deviceId) => ipcRenderer.invoke('revoke-phone-companion-device', deviceId),
  browserOpenUrl: (url) => ipcRenderer.invoke('browser-open-url', { url }),
  browserSearchWeb: (query) => ipcRenderer.invoke('browser-search-web', { query }),
  browserClickElement: (selector, text) => ipcRenderer.invoke('browser-click-element', { selector, text }),
  browserFillInput: (selector, value) => ipcRenderer.invoke('browser-fill-input', { selector, value }),
  browserNavigateBack: () => ipcRenderer.invoke('browser-navigate-back'),
  browserDownloadFromPage: (workspacePath, selector, url, destination) => ipcRenderer.invoke('browser-download-from-page', { workspacePath, selector, url, destination }),
  browserWaitForPage: (timeoutMs) => ipcRenderer.invoke('browser-wait-for-page', { timeoutMs }),
  takeScreenshot: (workspacePath, destination) => ipcRenderer.invoke('take-screenshot', { workspacePath, destination }),
  previewApp: (workspacePath, options = {}) => ipcRenderer.invoke('preview-workspace-app', { workspacePath, command: options.command, warmupMs: options.warmupMs, destination: options.destination, processId: options.processId, timeoutMs: options.timeoutMs }),
  captureScreen: (workspacePath, options = {}) => ipcRenderer.invoke('capture-screen', { workspacePath, destination: options.destination, delayMs: options.delayMs }),
  inspectScreenshot: (workspacePath, relativePath) => ipcRenderer.invoke('inspect-screenshot', { workspacePath, relativePath }),
  readWorkspaceFileBase64: (workspacePath, relativePath) => ipcRenderer.invoke('read-workspace-file-base64', { workspacePath, relativePath }),
  compareScreenshotToGoal: (workspacePath, relativePath, goal, observations) => ipcRenderer.invoke('compare-screenshot-to-goal', { workspacePath, relativePath, goal, observations }),
  indexWorkspace: (workspacePath) => ipcRenderer.invoke('index-workspace', workspacePath),
  searchEmbeddings: (query, limit) => ipcRenderer.invoke('search-embeddings', { query, limit }),
  
  // Config Controls
  readConfig: () => ipcRenderer.invoke('read-config'),
  writeConfig: (config) => ipcRenderer.invoke('write-config', config),
  
  // Shell Runner
  runCommand: (command, cwd, processId, timeoutMs) => ipcRenderer.invoke('run-command', { command, cwd, processId, timeoutMs }),
  startCommand: (command, cwd, processId, timeoutMs) => ipcRenderer.invoke('start-command', { command, cwd, processId, timeoutMs }),
  getCommandStatus: (processId) => ipcRenderer.invoke('get-command-status', processId),
  readCommandOutput: (processId, maxChars) => ipcRenderer.invoke('read-command-output', { processId, maxChars }),
  killCommand: (processId) => ipcRenderer.invoke('kill-command', processId),
  killCommandsForConversation: (conversationId) => ipcRenderer.invoke('kill-commands-for-conversation', conversationId),
  onCommandOutput: (processId, callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on(`cmd-output-${processId}`, listener);
    // Return clean-up function
    return () => {
      ipcRenderer.removeListener(`cmd-output-${processId}`, listener);
    };
  }
});
