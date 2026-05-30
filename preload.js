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
  writeFile: (workspacePath, relativePath, content) => ipcRenderer.invoke('write-file', { workspacePath, relativePath, content }),
  patchFile: (workspacePath, relativePath, operation) => ipcRenderer.invoke('patch-file', { workspacePath, relativePath, operation }),
  writeRunArtifact: (payload) => ipcRenderer.invoke('write-run-artifact', payload),
  listRunArtifacts: (conversationId) => ipcRenderer.invoke('list-run-artifacts', conversationId),
  googleSearch: (query, apiKey, searchEngineId, numResults) => ipcRenderer.invoke('google-search', { query, apiKey, searchEngineId, numResults }),
  fetchWebPage: (url) => ipcRenderer.invoke('fetch-web-page', { url }),
  getPhoneCompanionPairing: () => ipcRenderer.invoke('get-phone-companion-pairing'),
  enablePhoneCompanionLan: () => ipcRenderer.invoke('enable-phone-companion-lan'),
  getPhoneCompanionDevices: () => ipcRenderer.invoke('get-phone-companion-devices'),
  revokePhoneCompanionDevice: (deviceId) => ipcRenderer.invoke('revoke-phone-companion-device', deviceId),
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
