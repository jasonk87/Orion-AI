const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

let mainWindow;
let companionServer = null;
let companionToken = '';

function resolveWorkspacePath(workspacePath, relativePath = '') {
  if (!workspacePath) throw new Error('Missing workspace path');
  const workspaceRoot = path.resolve(workspacePath);
  const fullPath = path.resolve(workspaceRoot, relativePath || '');
  const relative = path.relative(workspaceRoot, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the active workspace');
  }
  return fullPath;
}

function createFileBackup(fullPath, workspaceRoot) {
  if (!fs.existsSync(fullPath)) return null;
  const backupRoot = path.join(workspaceRoot, '.orion', 'backups');
  const relative = path.relative(workspaceRoot, fullPath);
  const safeRelative = relative.replace(/[:<>|"?*]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupRoot, `${safeRelative}.${timestamp}.bak`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(fullPath, backupPath);
  return path.relative(workspaceRoot, backupPath);
}

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
  startPhoneCompanionServer();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (companionServer) {
    companionServer.close();
    companionServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

function readAppConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading config:', e);
  }
  return {};
}

function writeAppConfig(config) {
  const configPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function getLocalWifiAddress() {
  const nets = os.networkInterfaces();
  for (const interfaces of Object.values(nets)) {
    for (const net of interfaces || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function ensureCompanionToken(config) {
  if (config.phoneCompanionToken && String(config.phoneCompanionToken).length >= 16) {
    return config.phoneCompanionToken;
  }
  config.phoneCompanionToken = crypto.randomBytes(18).toString('base64url');
  writeAppConfig(config);
  return config.phoneCompanionToken;
}

function companionHtml(token) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orion AI Phone Companion</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #09090d; color: #f4f2ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, rgba(128, 90, 213, .24), transparent 30%), #09090d; }
    header { position: sticky; top: 0; z-index: 2; padding: 16px; border-bottom: 1px solid #252235; background: rgba(9, 9, 13, .92); backdrop-filter: blur(16px); }
    h1 { margin: 0; font-size: 1.05rem; letter-spacing: 0; }
    .meta { margin-top: 6px; color: #9d96b8; font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    main { padding: 14px; padding-bottom: 150px; }
    .status { color: #a78bfa; font-size: .78rem; margin-bottom: 10px; min-height: 18px; }
    .message { padding: 12px; border: 1px solid #252235; border-radius: 8px; margin: 10px 0; line-height: 1.45; white-space: pre-wrap; word-break: break-word; background: #111019; }
    .message.user { border-color: rgba(167,139,250,.4); background: #171326; }
    .message.assistant { border-color: rgba(72,187,120,.25); }
    .message.system { color: #a9a3bf; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .78rem; }
    .role { display: block; margin-bottom: 6px; color: #b8a7ff; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    form { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px; border-top: 1px solid #252235; background: rgba(9, 9, 13, .96); backdrop-filter: blur(16px); }
    textarea { width: 100%; min-height: 72px; resize: vertical; border: 1px solid #312b46; border-radius: 8px; padding: 12px; background: #12111a; color: #fff; font: inherit; }
    button { width: 100%; margin-top: 10px; min-height: 44px; border: 0; border-radius: 8px; background: #8b5cf6; color: #fff; font-weight: 800; font-size: .95rem; }
    button:disabled { opacity: .55; }
    .empty { color: #9d96b8; text-align: center; padding: 48px 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Orion AI</h1>
    <div class="meta" id="meta">Connecting...</div>
  </header>
  <main>
    <div class="status" id="status"></div>
    <div id="messages"><div class="empty">Loading conversation...</div></div>
  </main>
  <form id="prompt-form">
    <textarea id="prompt" placeholder="Send a prompt to Orion..." autocomplete="off"></textarea>
    <button id="send" type="submit">Send to Orion</button>
  </form>
  <script>
    const token = ${JSON.stringify(token)};
    const messagesEl = document.getElementById('messages');
    const metaEl = document.getElementById('meta');
    const statusEl = document.getElementById('status');
    const form = document.getElementById('prompt-form');
    const promptEl = document.getElementById('prompt');
    const sendEl = document.getElementById('send');
    let lastSignature = '';

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
    }

    async function loadState() {
      try {
        const res = await fetch('/api/state?token=' + encodeURIComponent(token));
        const state = await res.json();
        if (!state.success) throw new Error(state.error || 'Failed to load state');
        metaEl.textContent = (state.title || 'No active conversation') + (state.workspace ? ' · ' + state.workspace : '');
        statusEl.textContent = state.running ? 'Orion is working...' : '';
        const signature = JSON.stringify({ running: state.running, messages: state.messages });
        if (signature !== lastSignature) {
          lastSignature = signature;
          if (!state.messages || state.messages.length === 0) {
            messagesEl.innerHTML = '<div class="empty">No messages yet.</div>';
          } else {
            messagesEl.innerHTML = state.messages.map(msg => (
              '<div class="message ' + escapeHtml(msg.role) + '"><span class="role">' + escapeHtml(msg.role) + '</span>' + escapeHtml(msg.text) + '</div>'
            )).join('');
            window.scrollTo(0, document.body.scrollHeight);
          }
        }
      } catch (error) {
        statusEl.textContent = error.message;
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const prompt = promptEl.value.trim();
      if (!prompt) return;
      sendEl.disabled = true;
      statusEl.textContent = 'Sending...';
      try {
        const res = await fetch('/api/prompt?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Send failed');
        promptEl.value = '';
        await loadState();
      } catch (error) {
        statusEl.textContent = error.message;
      } finally {
        sendEl.disabled = false;
      }
    });

    loadState();
    setInterval(loadState, 2500);
  </script>
</body>
</html>`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

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

async function callRendererFunction(functionName, arg) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Orion window is not ready');
  const script = arg === undefined
    ? `window.${functionName} && window.${functionName}()`
    : `window.${functionName} && window.${functionName}(${JSON.stringify(arg)})`;
  const result = await mainWindow.webContents.executeJavaScript(script, true);
  if (!result) throw new Error('Phone companion bridge is not ready yet');
  return result;
}

function startPhoneCompanionServer() {
  if (companionServer) return;
  const config = readAppConfig();
  const port = Number(config.phoneCompanionPort || 5000);
  companionToken = ensureCompanionToken(config);

  companionServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(companionHtml(companionToken));
        return;
      }

      if (url.searchParams.get('token') !== companionToken) {
        sendJson(res, 401, { success: false, error: 'Unauthorized companion request' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const state = await callRendererFunction('getPhoneCompanionState');
        sendJson(res, 200, { success: true, ...state });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/prompt') {
        const bodyText = await readRequestBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const prompt = String(body.prompt || '').trim();
        if (!prompt) {
          sendJson(res, 400, { success: false, error: 'Missing prompt' });
          return;
        }
        const result = await callRendererFunction('submitPhoneCompanionPrompt', prompt);
        sendJson(res, 200, { success: true, ...result });
        return;
      }

      sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
  });

  companionServer.listen(port, '0.0.0.0', () => {
    const address = getLocalWifiAddress();
    const url = `http://${address}:${port}/?token=${companionToken}`;
    console.log(`Orion phone companion listening at ${url}`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          `window.appendSystemMessage && window.appendSystemMessage(${JSON.stringify(`Phone Companion is available on this Wi-Fi at ${url}`)}, { dedupeKey: 'phone-companion-url', windowMs: 60000 })`
        ).catch(() => {});
      }
    }, 2500);
  });

  companionServer.on('error', (error) => {
    console.error('Phone companion server failed:', error);
  });
}

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
    const configuredEntry = getWorkspaceEntrypoint(readAppConfig(), workspacePath);
    if (configuredEntry && configuredEntry.command) {
      launchCommandInWorkspace(workspacePath, configuredEntry.command);
      return {
        success: true,
        message: `Started configured entry point: "${configuredEntry.command}"`,
        entrypoint: configuredEntry
      };
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
        launchCommandInWorkspace(workspacePath, cmd);
        return { success: true, message: `Started background server with command: "${cmd}"` };
      }
    }
    
    // 3. Check for Python main files
    const pythonFiles = ['main.py', 'app.py', 'index.py', 'game.py'];
    const foundPy = pythonFiles.find(f => files.includes(f));
    if (foundPy) {
      launchCommandInWorkspace(workspacePath, `python ${foundPy}`);
      return { success: true, message: `Started Python application: "python ${foundPy}"` };
    }
    
    // 4. Check for Cargo.toml (Rust)
    if (files.includes('Cargo.toml')) {
      launchCommandInWorkspace(workspacePath, 'cargo run');
      return { success: true, message: 'Started Cargo application: "cargo run"' };
    }
    
    // 5. Check for Go files
    if (files.includes('go.mod') || files.some(f => f.endsWith('.go'))) {
      launchCommandInWorkspace(workspacePath, 'go run .');
      return { success: true, message: 'Started Go application: "go run ."' };
    }
    
    return { success: false, error: 'Could not auto-detect a runnable entry point (index.html, package.json, main.py, Cargo.toml, etc.).' };
    
  } catch (e) {
    console.error('Error launching workspace app:', e);
    return { success: false, error: e.message };
  }
});

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

function escapePowerShellSingle(value) {
  return String(value).replace(/'/g, "''");
}

function launchCommandInWorkspace(workspacePath, command) {
  if (process.platform === 'win32') {
    const commandText = `Set-Location -LiteralPath '${escapePowerShellSingle(workspacePath)}'; ${command}`;
    const runCmd = `Start-Process powershell -ArgumentList '-NoExit', '-Command', '${escapePowerShellSingle(commandText)}'`;
    exec(runCmd);
  } else {
    spawn('bash', ['-lc', command], { cwd: workspacePath, detached: true, stdio: 'ignore' });
  }
}

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
    const { shell } = require('electron');
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
    return {
      ...pushResult,
      remote: resolvedRemote,
      currentBranch,
      targetBranch,
      command: `git ${args.join(' ')}`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- IPC FILE SYSTEM OPERATIONS ---
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

ipcMain.handle('read-file', async (event, { workspacePath, relativePath, options }) => {
  try {
    const fullPath = resolveWorkspacePath(workspacePath, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error('File does not exist');
    const content = fs.readFileSync(fullPath, 'utf8');
    const readOptions = options || {};
    const startLine = parseInt(readOptions.startLine, 10);
    const endLine = parseInt(readOptions.endLine, 10);
    if (Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine) {
      const lines = content.split(/\r?\n/);
      const selected = lines.slice(startLine - 1, endLine);
      return selected.map((line, index) => `${startLine + index}: ${line}`).join('\n');
    }
    const maxChars = parseInt(readOptions.maxChars, 10);
    if (Number.isInteger(maxChars) && maxChars > 0 && content.length > maxChars) {
      return content.slice(0, maxChars) + `\n\n[Orion] File truncated at ${maxChars} characters. Use startLine/endLine to inspect targeted sections.`;
    }
    return content;
  } catch (e) {
    console.error('Error reading file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('write-file', async (event, { workspacePath, relativePath, content }) => {
  try {
    const workspaceRoot = path.resolve(workspacePath);
    const fullPath = resolveWorkspacePath(workspacePath, relativePath);
    const backupPath = createFileBackup(fullPath, workspaceRoot);
    // Create folder structure if it doesn't exist
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    return { success: true, backupPath };
  } catch (e) {
    console.error('Error writing file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('patch-file', async (event, { workspacePath, relativePath, operation }) => {
  try {
    if (!operation || !operation.type) throw new Error('Missing patch operation');
    const workspaceRoot = path.resolve(workspacePath);
    const fullPath = resolveWorkspacePath(workspacePath, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error('File does not exist');

    const original = fs.readFileSync(fullPath, 'utf8');
    let updated = original;
    let details = {};

    if (operation.type === 'replace') {
      if (!operation.target) throw new Error('replace requires target');
      if (operation.replacement === undefined) throw new Error('replace requires replacement');
      const count = Math.max(parseInt(operation.count, 10) || 1, 1);
      let replacements = 0;
      while (replacements < count) {
        const index = updated.indexOf(operation.target);
        if (index === -1) break;
        updated = updated.slice(0, index) + operation.replacement + updated.slice(index + operation.target.length);
        replacements++;
      }
      if (replacements === 0) throw new Error('Target content block not found');
      details = { replacements };
    } else if (operation.type === 'replace_regex') {
      if (!operation.pattern) throw new Error('replace_regex requires pattern');
      if (operation.replacement === undefined) throw new Error('replace_regex requires replacement');
      const flags = operation.flags || '';
      const safeFlags = Array.from(new Set(flags.replace(/[^gimsuy]/g, '').split(''))).join('');
      const regex = new RegExp(operation.pattern, safeFlags.includes('g') ? safeFlags : safeFlags + 'g');
      const matches = updated.match(regex);
      const replacements = matches ? matches.length : 0;
      updated = updated.replace(regex, operation.replacement);
      if (replacements === 0) throw new Error('Regex pattern did not match');
      details = { replacements };
    } else if (operation.type === 'insert') {
      if (!operation.anchor) throw new Error('insert requires anchor');
      if (operation.content === undefined) throw new Error('insert requires content');
      const position = operation.position === 'before' ? 'before' : 'after';
      const index = updated.indexOf(operation.anchor);
      if (index === -1) throw new Error('Anchor content not found');
      const insertAt = position === 'before' ? index : index + operation.anchor.length;
      updated = updated.slice(0, insertAt) + operation.content + updated.slice(insertAt);
      details = { position };
    } else if (operation.type === 'replace_range') {
      const startLine = parseInt(operation.startLine, 10);
      const endLine = parseInt(operation.endLine, 10);
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
        throw new Error('replace_range requires valid 1-based startLine and endLine');
      }
      if (operation.content === undefined) throw new Error('replace_range requires content');
      const hasFinalNewline = updated.endsWith('\n');
      const lines = updated.split(/\r?\n/);
      if (hasFinalNewline) lines.pop();
      if (endLine > lines.length) throw new Error(`Line range exceeds file length (${lines.length} lines)`);
      const newLines = String(operation.content).split(/\r?\n/);
      lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
      updated = lines.join('\n') + (hasFinalNewline ? '\n' : '');
      details = { startLine, endLine };
    } else {
      throw new Error(`Unsupported patch operation: ${operation.type}`);
    }

    if (updated === original) {
      return { success: true, changed: false, message: 'Patch produced no content changes.', details };
    }

    const backupPath = createFileBackup(fullPath, workspaceRoot);
    fs.writeFileSync(fullPath, updated, 'utf8');
    return { success: true, changed: true, message: `Patched ${relativePath} successfully.`, details, backupPath };
  } catch (e) {
    console.error('Error patching file:', e);
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
let commandAliases = {};

function registerCommandSession(processId, session, child) {
  commandSessions[processId] = session;
  activeProcesses[processId] = child;

  const match = processId.match(/^cmd_(conv_\d+)_(.+)$/);
  if (match && match[2]) {
    commandAliases[match[2]] = processId;
  }
}

function resolveCommandSessionId(processId) {
  return commandSessions[processId] ? processId : commandAliases[processId];
}

function killProcessTree(child, callback) {
  if (!child || !child.pid) {
    if (callback) callback();
    return;
  }

  if (process.platform === 'win32') {
    exec(`taskkill /PID ${child.pid} /T /F`, (error) => {
      if (error) {
        try { child.kill(); } catch (e) {}
      }
      if (callback) callback(error);
    });
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch (e) {}
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch (e) {}
    if (callback) callback();
  }, 1000);
}

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
  const child = spawn(shell, [...shellArgs, command], {
    cwd: cwd,
    env: { ...process.env, PAGER: 'cat' },
    windowsHide: true
  });
  
  registerCommandSession(processId, session, child);
  
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
      killProcessTree(child);
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
  const resolvedId = resolveCommandSessionId(processId);
  const session = commandSessions[resolvedId];
  if (!session) return { success: false, error: 'Unknown command session' };
  return { success: true, ...commandSessionSummary(session, 2000) };
});

ipcMain.handle('read-command-output', (event, { processId, maxChars }) => {
  const resolvedId = resolveCommandSessionId(processId);
  const session = commandSessions[resolvedId];
  if (!session) return { success: false, error: 'Unknown command session' };
  return { success: true, ...commandSessionSummary(session, parseInt(maxChars, 10) || 12000) };
});

ipcMain.handle('kill-command', (event, processId) => {
  const resolvedId = resolveCommandSessionId(processId);
  if (activeProcesses[resolvedId]) {
    try {
      if (commandSessions[resolvedId]) {
        commandSessions[resolvedId].killed = true;
        commandSessions[resolvedId].status = 'killed';
      }
      killProcessTree(activeProcesses[resolvedId]);
      return { success: true };
    } catch (e) {
      console.error('Failed to kill process:', e);
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'No running process found for that session.' };
});

ipcMain.handle('kill-commands-for-conversation', (event, conversationId) => {
  if (!conversationId) return { success: false, error: 'Missing conversation id' };
  let killed = 0;
  Object.keys(activeProcesses).forEach((processId) => {
    if (processId.includes(`_${conversationId}_`)) {
      const session = commandSessions[processId];
      if (session) {
        session.killed = true;
        session.status = 'killed';
      }
      killProcessTree(activeProcesses[processId]);
      killed++;
    }
  });
  return { success: true, killed };
});
