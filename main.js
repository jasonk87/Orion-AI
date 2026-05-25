const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true, // Launch in fullscreen mode
    frame: false, // Borderless window to enable custom title bar matching screenshot
    backgroundColor: '#0c0c0e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Open DevTools in development if needed
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC WINDOW CONTROLS ---
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isFullscreen()) {
      mainWindow.setFullScreen(false);
      mainWindow.maximize();
    } else if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// --- IPC WORKSPACE SELECTION ---
ipcMain.handle('select-workspace', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('show-confirm-dialog', async (event, { message, title }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    title: title || 'Confirm',
    message: message
  });
  return result.response === 0;
});

ipcMain.handle('launch-workspace-app', async (event, workspacePath) => {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: 'No active workspace directory found.' };
    }
    
    const files = fs.readdirSync(workspacePath);
    
    // 1. Check for index.html (standard web games/apps)
    if (files.includes('index.html')) {
      const fullPath = path.join(workspacePath, 'index.html');
      const { shell } = require('electron');
      await shell.openPath(fullPath);
      return { success: true, message: 'Opened index.html in default browser.' };
    }
    
    // 2. Check for package.json
    if (files.includes('package.json')) {
      const pkgPath = path.join(workspacePath, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      
      let cmd = '';
      if (scripts.start) {
        cmd = 'npm start';
      } else if (scripts.dev) {
        cmd = 'npm run dev';
      }
      
      if (cmd) {
        // Spawn visible PowerShell terminal on Windows so the console is interactive
        if (process.platform === 'win32') {
          const runCmd = `Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '${workspacePath}'; ${cmd}"`;
          exec(runCmd);
        } else {
          spawn('npm', [cmd.split(' ')[1]], { cwd: workspacePath, detached: true, stdio: 'ignore' });
        }
        return { success: true, message: `Started background server with command: "${cmd}"` };
      }
    }
    
    // 3. Check for Python main files
    const pythonFiles = ['main.py', 'app.py', 'index.py', 'game.py'];
    const foundPy = pythonFiles.find(f => files.includes(f));
    if (foundPy) {
      if (process.platform === 'win32') {
        const runCmd = `Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '${workspacePath}'; python ${foundPy}"`;
        exec(runCmd);
      } else {
        spawn('python', [foundPy], { cwd: workspacePath, detached: true, stdio: 'ignore' });
      }
      return { success: true, message: `Started Python application: "python ${foundPy}"` };
    }
    
    // 4. Check for Cargo.toml (Rust)
    if (files.includes('Cargo.toml')) {
      if (process.platform === 'win32') {
        const runCmd = `Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '${workspacePath}'; cargo run"`;
        exec(runCmd);
      } else {
        spawn('cargo', ['run'], { cwd: workspacePath, detached: true, stdio: 'ignore' });
      }
      return { success: true, message: 'Started Cargo application: "cargo run"' };
    }
    
    // 5. Check for Go files
    if (files.includes('go.mod') || files.some(f => f.endsWith('.go'))) {
      if (process.platform === 'win32') {
        const runCmd = `Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '${workspacePath}'; go run ."`;
        exec(runCmd);
      } else {
        spawn('go', ['run', '.'], { cwd: workspacePath, detached: true, stdio: 'ignore' });
      }
      return { success: true, message: 'Started Go application: "go run ."' };
    }
    
    return { success: false, error: 'Could not auto-detect a runnable entry point (index.html, package.json, main.py, Cargo.toml, etc.).' };
    
  } catch (e) {
    console.error('Error launching workspace app:', e);
    return { success: false, error: e.message };
  }
});

// --- IPC FILE SYSTEM OPERATIONS ---
ipcMain.handle('read-config', async () => {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading config:', e);
  }
  return {};
});

ipcMain.handle('write-config', async (event, config) => {
  const configPath = path.join(__dirname, 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error writing config:', e);
    return false;
  }
});

ipcMain.handle('list-files', async (event, dirPath) => {
  try {
    if (!dirPath) return [];
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Recursive directory helper, excluding node_modules, .git, etc.
    const getFiles = (dir, rootDir) => {
      let results = [];
      const list = fs.readdirSync(dir);
      
      list.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const relPath = path.relative(rootDir, filePath);
        
        // Exclude common build/version control folders
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.gemini' || file === 'build') {
          return;
        }
        
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
  } catch (e) {
    console.error('Error listing files:', e);
    return [];
  }
});

ipcMain.handle('read-file', async (event, { workspacePath, relativePath }) => {
  try {
    const fullPath = path.join(workspacePath, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error('File does not exist');
    return fs.readFileSync(fullPath, 'utf8');
  } catch (e) {
    console.error('Error reading file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('write-file', async (event, { workspacePath, relativePath, content }) => {
  try {
    const fullPath = path.join(workspacePath, relativePath);
    // Create folder structure if it doesn't exist
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    return { success: true };
  } catch (e) {
    console.error('Error writing file:', e);
    return { error: e.message };
  }
});

// --- IPC WEB RESEARCH ---
ipcMain.handle('google-search', async (event, { query, apiKey, searchEngineId, numResults }) => {
  try {
    if (!query || !query.trim()) throw new Error('Missing search query');
    if (!apiKey || !apiKey.trim()) throw new Error('Missing Google Search API key');
    if (!searchEngineId || !searchEngineId.trim()) throw new Error('Missing Google Search Engine ID');
    
    const params = new URLSearchParams({
      key: apiKey.trim(),
      cx: searchEngineId.trim(),
      q: query.trim(),
      num: String(Math.min(Math.max(parseInt(numResults, 10) || 5, 1), 10))
    });
    
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);
    const data = await response.json();
    
    if (!response.ok) {
      const message = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
      throw new Error(message);
    }
    
    return {
      success: true,
      items: (data.items || []).map((item) => ({
        title: item.title || '',
        link: item.link || '',
        snippet: item.snippet || '',
        displayLink: item.displayLink || ''
      }))
    };
  } catch (e) {
    console.error('Google search failed:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fetch-web-page', async (event, { url }) => {
  try {
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be fetched');
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'OrionAI/2.0 (+https://localhost)'
      }
    });
    
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    
    let text = rawText;
    if (contentType.includes('html')) {
      text = rawText
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    return {
      success: true,
      url,
      contentType,
      text: text.slice(0, 12000)
    };
  } catch (e) {
    console.error('Web page fetch failed:', e);
    return { success: false, error: e.message };
  }
});

// --- IPC SHELL COMMAND EXECUTION ---
// Spawns shell command and streams updates through mainWindow.webContents
let activeProcesses = {};
let commandSessions = {};

function startCommandSession({ command, cwd, processId, timeoutMs }) {
  if (!command) throw new Error('Missing command');
  if (!processId) processId = 'cmd_' + Date.now();
  
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command'] : ['-c'];
  const resolvedTimeoutMs = Math.min(Math.max(parseInt(timeoutMs, 10) || 120000, 1000), 30 * 60 * 1000);
  
  const session = {
    id: processId,
    command,
    cwd,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    timeoutMs: resolvedTimeoutMs,
    exitCode: null,
    error: '',
    timedOut: false,
    killed: false,
    stdout: '',
    stderr: ''
  };
  commandSessions[processId] = session;
  
  const child = spawn(shell, [...shellArgs, command], {
    cwd: cwd,
    env: { ...process.env, PAGER: 'cat' }
  });
  
  activeProcesses[processId] = child;
  
  const appendOutput = (type, text) => {
    if (type === 'stderr') {
      session.stderr += text;
    } else {
      session.stdout += text;
    }
    mainWindow.webContents.send(`cmd-output-${processId}`, { type, text });
  };
  
  const timeout = setTimeout(() => {
    if (activeProcesses[processId]) {
      session.timedOut = true;
      session.status = 'timed_out';
      appendOutput('stderr', `\n[Orion] Command timed out after ${resolvedTimeoutMs}ms and was stopped.\n`);
      child.kill();
    }
  }, resolvedTimeoutMs);
  
  child.stdout.on('data', (data) => appendOutput('stdout', data.toString()));
  child.stderr.on('data', (data) => appendOutput('stderr', data.toString()));
  
  child.on('close', (code) => {
    clearTimeout(timeout);
    delete activeProcesses[processId];
    session.exitCode = code;
    session.finishedAt = Date.now();
    if (session.timedOut) {
      session.status = 'timed_out';
    } else if (session.killed) {
      session.status = 'killed';
    } else {
      session.status = code === 0 ? 'completed' : 'failed';
    }
  });
  
  child.on('error', (err) => {
    clearTimeout(timeout);
    delete activeProcesses[processId];
    session.error = err.message;
    session.finishedAt = Date.now();
    session.status = 'error';
  });
  
  return session;
}

function commandSessionSummary(session, maxChars = 8000) {
  if (!session) return null;
  const output = `${session.stdout || ''}${session.stderr || ''}`;
  return {
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    timeoutMs: session.timeoutMs,
    exitCode: session.exitCode,
    error: session.error,
    timedOut: session.timedOut,
    killed: session.killed,
    output: output.slice(-maxChars)
  };
}

ipcMain.handle('run-command', (event, { command, cwd, processId, timeoutMs }) => {
  return new Promise((resolve) => {
    try {
      const session = startCommandSession({ command, cwd, processId, timeoutMs });
      const poll = setInterval(() => {
        if (session.status !== 'running') {
          clearInterval(poll);
          resolve({
            code: session.exitCode,
            error: session.error,
            timedOut: session.timedOut,
            killed: session.killed
          });
        }
      }, 200);
    } catch (e) {
      resolve({ error: e.message });
    }
  });
});

ipcMain.handle('start-command', (event, { command, cwd, processId, timeoutMs }) => {
  try {
    const session = startCommandSession({ command, cwd, processId, timeoutMs });
    return { success: true, ...commandSessionSummary(session, 2000) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-command-status', (event, processId) => {
  const session = commandSessions[processId];
  if (!session) return { success: false, error: 'Unknown command session' };
  return { success: true, ...commandSessionSummary(session, 2000) };
});

ipcMain.handle('read-command-output', (event, { processId, maxChars }) => {
  const session = commandSessions[processId];
  if (!session) return { success: false, error: 'Unknown command session' };
  return { success: true, ...commandSessionSummary(session, parseInt(maxChars, 10) || 12000) };
});

ipcMain.handle('kill-command', (event, processId) => {
  if (activeProcesses[processId]) {
    try {
      if (commandSessions[processId]) {
        commandSessions[processId].killed = true;
        commandSessions[processId].status = 'killed';
      }
      activeProcesses[processId].kill();
      return { success: true };
    } catch (e) {
      console.error('Failed to kill process:', e);
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'No running process found for that session.' };
});
