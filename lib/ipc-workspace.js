'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow } = require('electron');
const { isIndexableWorkspaceFile, isDestructiveCommand } = require('../safety');
const { readAppConfig, writeAppConfig, atomicWriteFileSync } = require('./config');
const { killProcessTree } = require('./ipc-shell');
const shared = require('./shared');

// ── Workspace config helpers ──────────────────────────────────────────────────

function workspaceKey(workspacePath) {
  return path.resolve(workspacePath || '').toLowerCase();
}

function getWorkspaceEntrypoint(config, workspacePath) {
  const map = config.workspaceEntrypoints || {};
  return map[workspaceKey(workspacePath)] || null;
}

function setWorkspaceEntrypoint(config, workspacePath, entrypoint) {
  config.workspaceEntrypoints = config.workspaceEntrypoints || {};
  const key = workspaceKey(workspacePath);
  if (!entrypoint || !String(entrypoint.command || '').trim()) {
    delete config.workspaceEntrypoints[key];
  } else {
    config.workspaceEntrypoints[key] = {
      command: String(entrypoint.command).trim(),
      label: entrypoint.label ? String(entrypoint.label).trim() : '',
      updatedAt: new Date().toISOString()
    };
  }
  writeAppConfig(config);
  return config.workspaceEntrypoints[key] || null;
}

// ── Shell launch helpers ──────────────────────────────────────────────────────

function escapePowerShellSingle(value) {
  return String(value).replace(/'/g, "''");
}

let lastLaunchLogs = '';

function appendLaunchLog(data) {
  lastLaunchLogs += data;
  if (lastLaunchLogs.length > 50000) {
    lastLaunchLogs = lastLaunchLogs.slice(-20000);
  }
  if (shared.mainWindow && !shared.mainWindow.isDestroyed()) {
    shared.mainWindow.webContents.executeJavaScript(`window.lastLaunchLogs = ${JSON.stringify(lastLaunchLogs)}`).catch(() => {});
  }
}

function spawnInternalCommand(workspacePath, executable, args = []) {
  if (!executable) throw new Error('Missing executable');
  lastLaunchLogs = '';
  if (shared.mainWindow && !shared.mainWindow.isDestroyed()) {
    shared.mainWindow.webContents.executeJavaScript(`window.lastLaunchLogs = ''; window.lastLaunchUrl = '';`).catch(() => {});
  }
  const child = spawn(executable, args, {
    cwd: workspacePath,
    env: { ...process.env, PAGER: 'cat' },
    windowsHide: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => {
    const text = data.toString();
    appendLaunchLog(text);
    const match = text.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/i);
    if (match) {
      const url = match[0];
      if (shared.mainWindow && !shared.mainWindow.isDestroyed()) {
        shared.mainWindow.webContents.executeJavaScript(`window.lastLaunchUrl = ${JSON.stringify(url)}`).catch(() => {});
      }
    }
  });
  child.stderr.on('data', data => { appendLaunchLog(data.toString()); });
  child.unref();
  return child;
}

function launchCommandInWorkspace(workspacePath, command) {
  if (!command) throw new Error('Missing command');
  if (isDestructiveCommand(command)) {
    throw new Error('Command is in the deny-list and cannot be executed.');
  }

  if (process.platform === 'win32') {
    const commandText = `Set-Location -LiteralPath '${escapePowerShellSingle(workspacePath)}'; ${command}`;
    spawn('cmd.exe', [
      '/c', 'start', 'powershell.exe', '-NoExit', '-Command', commandText
    ], { windowsHide: true, detached: true, stdio: 'ignore' });
  } else {
    spawn('bash', ['-lc', command], { cwd: workspacePath, detached: true, stdio: 'ignore' });
  }
}

function launchInternalCommandInWorkspace(workspacePath, executable, args = []) {
  spawnInternalCommand(workspacePath, executable, args);
}

// ── Git helper ────────────────────────────────────────────────────────────────

function runGitCommand(cwd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, PAGER: 'cat' },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      killProcessTree(child);
      resolve({ success: false, stdout, stderr, error: `git ${args.join(' ')} timed out after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ success: code === 0, exitCode: code, stdout, stderr, error: code === 0 ? '' : stderr || stdout });
    });
    child.on('error', error => {
      clearTimeout(timeout);
      resolve({ success: false, stdout, stderr, error: error.message });
    });
  });
}

// ── RAG / Workspace indexing ──────────────────────────────────────────────────

function listFilesRecursive(dirPath) {
  const getFiles = (dir, rootDir) => {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.lstatSync(filePath);
      const relPath = path.relative(rootDir, filePath);
      if (['node_modules', '.git', 'dist', '.gemini', 'build', '.ruff_cache', '.pytest_cache', '__pycache__', '.venv', 'venv', 'env', '.tox', '.next', '.codex-remote-attachments', '.idea', '.vscode', 'coverage'].includes(file)) return;
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        results.push({ name: file, path: relPath, isDir: true });
        results = results.concat(getFiles(filePath, rootDir));
      } else {
        results.push({ name: file, path: relPath, isDir: false, size: stat.size });
      }
    });
    return results;
  };
  return getFiles(dirPath, dirPath);
}

function chunkText(text, maxChunkSize = 1200, overlap = 150) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunk.push(line);
    currentLength += line.length + 1;

    if (currentLength >= maxChunkSize) {
      chunks.push({ text: currentChunk.join('\n'), startLine, endLine: i + 1 });
      const backtrackLines = Math.min(currentChunk.length - 1, Math.ceil(overlap / 50));
      currentChunk = currentChunk.slice(-backtrackLines);
      currentLength = currentChunk.join('\n').length + 1;
      startLine = i + 1 - backtrackLines + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({ text: currentChunk.join('\n'), startLine, endLine: lines.length });
  }
  return chunks;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getGeminiEmbedding(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text }] }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API returned HTTP ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  if (!data.embedding || !data.embedding.values) throw new Error('Embedding values missing in API response');
  return data.embedding.values;
}

function updateRagStatusInRenderer(workspacePath, statusText) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.executeJavaScript(`if (window.onRagStatusChange) window.onRagStatusChange(${JSON.stringify(statusText)});`).catch(() => {});
    }
  });
}

const activeWorkspaceIndices = {};

async function runBackgroundIndexing(workspacePath, apiKey) {
  if (activeWorkspaceIndices[workspacePath]?.status === 'indexing') return;

  activeWorkspaceIndices[workspacePath] = { status: 'indexing', progress: 0, total: 0 };
  updateRagStatusInRenderer(workspacePath, 'Scanning...');

  try {
    const files = listFilesRecursive(workspacePath);
    const indexableFiles = files.filter(f => !f.isDir && isIndexableWorkspaceFile(f.name));

    const indexDir = path.join(app.getPath('userData'), 'orion-embeddings');
    if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });

    const indexFilename = crypto.createHash('sha256').update(workspacePath).digest('hex') + '.json';
    const indexPath = path.join(indexDir, indexFilename);

    let indexData = { workspace: workspacePath, files: {}, chunks: [] };
    if (fs.existsSync(indexPath)) {
      try {
        indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      } catch (_) {
        indexData = { workspace: workspacePath, files: {}, chunks: [] };
      }
    }

    const relativePaths = new Set(indexableFiles.map(f => f.path));
    let indexChanged = false;
    for (const relPath of Object.keys(indexData.files)) {
      if (!relativePaths.has(relPath)) {
        delete indexData.files[relPath];
        indexData.chunks = indexData.chunks.filter(c => c.path !== relPath);
        indexChanged = true;
      }
    }

    const filesToEmbed = [];
    indexableFiles.forEach(f => {
      const fullPath = path.join(workspacePath, f.path);
      if (!fs.existsSync(fullPath)) return;
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const hash = crypto.createHash('md5').update(content).digest('hex');
        const existingFile = indexData.files[f.path];
        if (!existingFile || existingFile.hash !== hash) {
          filesToEmbed.push({ relPath: f.path, fullPath, content, hash });
        }
      } catch (e) {
        console.error(`Skipping unreadable file during indexing: ${f.path}:`, e.message);
      }
    });

    if (filesToEmbed.length === 0) {
      if (indexChanged) atomicWriteFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
      activeWorkspaceIndices[workspacePath] = { status: 'ready', progress: indexableFiles.length, total: indexableFiles.length };
      updateRagStatusInRenderer(workspacePath, 'Semantic Ready');
      return;
    }

    let progress = 0;
    const total = filesToEmbed.length;
    activeWorkspaceIndices[workspacePath] = { status: 'indexing', progress, total };
    updateRagStatusInRenderer(workspacePath, `Indexing (0/${total})`);

    for (const file of filesToEmbed) {
      indexData.chunks = indexData.chunks.filter(c => c.path !== file.relPath);
      const chunks = chunkText(file.content);
      let embeddedAllChunks = true;

      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        try {
          const vector = await getGeminiEmbedding(chunk.text, apiKey);
          indexData.chunks.push({ path: file.relPath, startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.text, vector });
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          embeddedAllChunks = false;
          console.error(`Failed to embed chunk ${idx} of ${file.relPath}:`, err);
        }
      }

      if (embeddedAllChunks) {
        indexData.files[file.relPath] = { hash: file.hash };
      } else {
        delete indexData.files[file.relPath];
      }
      atomicWriteFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');

      progress++;
      activeWorkspaceIndices[workspacePath] = { status: 'indexing', progress, total };
      updateRagStatusInRenderer(workspacePath, `Indexing (${progress}/${total})`);
    }

    activeWorkspaceIndices[workspacePath] = { status: 'ready', progress: indexableFiles.length, total: indexableFiles.length };
    updateRagStatusInRenderer(workspacePath, 'Semantic Ready');
  } catch (err) {
    console.error('Error in background indexing:', err);
    updateRagStatusInRenderer(workspacePath, 'Indexing Failed');
  }
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain, { startStaticWorkspaceServer } = {}) {
  const { dialog, shell } = require('electron');

  ipcMain.handle('select-workspace', async () => {
    const result = await dialog.showOpenDialog(shared.mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('read-config', async () => {
    return readAppConfig();
  });

  ipcMain.handle('write-config', async (event, config) => {
    try {
      writeAppConfig(config);
      return true;
    } catch (e) {
      console.error('Error writing config:', e);
      return false;
    }
  });

  ipcMain.handle('launch-workspace-app', async (event, workspacePath) => {
    try {
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return { success: false, error: 'No active workspace directory found.' };
      }
      const configuredEntry = getWorkspaceEntrypoint(readAppConfig(), workspacePath);
      if (configuredEntry && configuredEntry.command) {
        launchCommandInWorkspace(workspacePath, configuredEntry.command);
        return { success: true, message: `Started configured entry point: "${configuredEntry.command}"`, entrypoint: configuredEntry };
      }

      const files = fs.readdirSync(workspacePath);

      if (files.includes('index.html')) {
        const url = await startStaticWorkspaceServer(workspacePath);
        await shell.openExternal(url);
        return { success: true, message: `Opened index.html at ${url}.`, url };
      }

      if (files.includes('package.json')) {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        let cmd = '';
        if (scripts.start) cmd = 'npm start';
        else if (scripts.dev) cmd = 'npm run dev';
        if (cmd) {
          if (cmd === 'npm start') {
            launchInternalCommandInWorkspace(workspacePath, 'npm', ['start']);
          } else {
            launchInternalCommandInWorkspace(workspacePath, 'npm', ['run', 'dev']);
          }
          return { success: true, message: `Started background server with command: "${cmd}"` };
        }
      }

      const pythonFiles = ['main.py', 'app.py', 'index.py', 'game.py'];
      const foundPy = pythonFiles.find(f => files.includes(f));
      if (foundPy) {
        launchCommandInWorkspace(workspacePath, `python ${foundPy}`);
        return { success: true, message: `Started Python application in terminal: "python ${foundPy}"` };
      }

      if (files.includes('Cargo.toml')) {
        launchCommandInWorkspace(workspacePath, 'cargo run');
        return { success: true, message: 'Started Cargo application in terminal: "cargo run"' };
      }

      if (files.includes('go.mod') || files.some(f => f.endsWith('.go'))) {
        launchCommandInWorkspace(workspacePath, 'go run .');
        return { success: true, message: 'Started Go application in terminal: "go run ."' };
      }

      return { success: false, error: 'Could not auto-detect a runnable entry point.' };
    } catch (e) {
      console.error('Error launching workspace app:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-workspace-entrypoint', async (event, workspacePath) => {
    try {
      return { success: true, entrypoint: getWorkspaceEntrypoint(readAppConfig(), workspacePath) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('set-workspace-entrypoint', async (event, { workspacePath, entrypoint }) => {
    try {
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return { success: false, error: 'No active workspace directory found.' };
      }
      const saved = setWorkspaceEntrypoint(readAppConfig(), workspacePath, entrypoint);
      return { success: true, entrypoint: saved };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-workspace-folder', async (event, workspacePath) => {
    try {
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return { success: false, error: 'No active workspace directory found.' };
      }
      await shell.openPath(workspacePath);
      return { success: true, path: workspacePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('git-push', async (event, { workspacePath, remote, branch, setUpstream }) => {
    try {
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return { success: false, error: 'No active workspace directory found.' };
      }
      const resolvedRemote = remote || 'origin';
      const branchResult = await runGitCommand(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (!branchResult.success) return branchResult;
      const currentBranch = branchResult.stdout.trim();
      const targetBranch = branch || currentBranch;
      const args = ['push'];
      if (setUpstream !== false) args.push('-u');
      args.push(resolvedRemote, `${currentBranch}:${targetBranch}`);
      const pushResult = await runGitCommand(workspacePath, args, 120000);
      return { ...pushResult, remote: resolvedRemote, currentBranch, targetBranch, command: `git ${args.join(' ')}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('index-workspace', async (event, workspacePath) => {
    if (!workspacePath) return { success: false, error: 'No workspace path' };
    const config = readAppConfig();
    const apiKey = config.geminiApiKey;
    if (!apiKey) {
      updateRagStatusInRenderer(workspacePath, 'Awaiting API Key');
      return { success: false, error: 'Awaiting API Key' };
    }
    runBackgroundIndexing(workspacePath, apiKey);
    return { success: true };
  });

  ipcMain.handle('search-embeddings', async (event, { query, limit }) => {
    try {
      const config = readAppConfig();
      const apiKey = config.geminiApiKey;
      if (!apiKey) throw new Error('API key is not configured');

      const queryVector = await getGeminiEmbedding(query, apiKey);

      const windows = BrowserWindow.getAllWindows();
      let currentWorkspacePath = '';
      if (windows.length > 0) {
        const activeProj = await windows[0].webContents.executeJavaScript('window.getCurrentProject ? window.getCurrentProject() : null').catch(() => null);
        currentWorkspacePath = activeProj || '';
      }
      if (!currentWorkspacePath) currentWorkspacePath = config.defaultWorkspacePath || '';
      if (!currentWorkspacePath) throw new Error('No active workspace');

      const indexDir = path.join(app.getPath('userData'), 'orion-embeddings');
      const indexFilename = crypto.createHash('sha256').update(currentWorkspacePath).digest('hex') + '.json';
      const indexPath = path.join(indexDir, indexFilename);

      if (!fs.existsSync(indexPath)) {
        return { success: true, results: [], message: 'No index built yet for this workspace.' };
      }

      const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const chunks = indexData.chunks || [];

      const scoredChunks = chunks.map(chunk => ({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        similarity: cosineSimilarity(queryVector, chunk.vector)
      }));

      scoredChunks.sort((a, b) => b.similarity - a.similarity);
      const topResults = scoredChunks.slice(0, parseInt(limit, 10) || 5);

      return { success: true, results: topResults };
    } catch (err) {
      console.error('Error searching embeddings:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  registerHandlers,
  getWorkspaceEntrypoint,
  setWorkspaceEntrypoint,
  workspaceKey,
  escapePowerShellSingle,
  spawnInternalCommand,
  runGitCommand,
  listFilesRecursive,
  chunkText,
  cosineSimilarity,
  getGeminiEmbedding
};
