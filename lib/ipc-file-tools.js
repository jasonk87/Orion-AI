'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { app } = require('electron');
const { spawn } = require('child_process');
const { resolveWorkspacePath } = require('../safety');
const { atomicWriteFileSync, readAppConfig } = require('./config');

// ── Artifact storage ─────────────────────────────────────────────────────────

function getArtifactRoot() {
  const base = app && app.getPath ? app.getPath('userData') : path.join(__dirname, '..');
  return path.join(base, 'artifacts');
}

function sanitizeArtifactSegment(value) {
  return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';
}

function getConversationArtifactDir(conversationId) {
  return path.join(getArtifactRoot(), sanitizeArtifactSegment(conversationId));
}

function normalizeArtifactRelativePath(relativePath) {
  const clean = String(relativePath || '').trim().replace(/^[/\\]+/, '');
  if (!clean) throw new Error('Missing artifact path');
  const safe = clean.replace(/[:<>|"?*]/g, '_');
  const normalized = path.normalize(safe);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) throw new Error('Artifact path escapes conversation storage');
  return normalized;
}

function makeArtifactRef(conversationId, relativePath) {
  return `orion-artifact://${encodeURIComponent(sanitizeArtifactSegment(conversationId))}/${normalizeArtifactRelativePath(relativePath).replace(/\\/g, '/')}`;
}

function parseArtifactRef(value) {
  const raw = String(value || '');
  const match = raw.match(/^orion-artifact:\/\/([^/]+)\/(.+)$/i);
  if (!match) return null;
  return {
    conversationId: decodeURIComponent(match[1]),
    relativePath: normalizeArtifactRelativePath(decodeURIComponent(match[2]))
  };
}

function resolveConversationArtifactPath(conversationId, relativePath) {
  const root = getConversationArtifactDir(conversationId);
  const rel = normalizeArtifactRelativePath(relativePath);
  const fullPath = path.resolve(root, rel);
  if (!fullPath.startsWith(path.resolve(root) + path.sep) && fullPath !== path.resolve(root)) {
    throw new Error('Artifact path escapes conversation storage');
  }
  return fullPath;
}

function resolveArtifactReferencePath(ref) {
  const parsed = parseArtifactRef(ref);
  if (!parsed) return null;
  return resolveConversationArtifactPath(parsed.conversationId, parsed.relativePath);
}

function writeConversationArtifactText(conversationId, relativePath, content) {
  const fullPath = resolveConversationArtifactPath(conversationId, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  atomicWriteFileSync(fullPath, String(content || ''), 'utf8');
  return {
    success: true,
    artifactPath: fullPath,
    artifactRef: makeArtifactRef(conversationId, relativePath),
    relativePath: normalizeArtifactRelativePath(relativePath).replace(/\\/g, '/')
  };
}

function readConversationArtifactText(conversationId, relativePath, options = {}) {
  const fullPath = resolveConversationArtifactPath(conversationId, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('Artifact does not exist');
  const content = fs.readFileSync(fullPath, 'utf8');
  const maxChars = parseInt(options.maxChars, 10);
  if (Number.isInteger(maxChars) && maxChars > 0 && content.length > maxChars) {
    return content.slice(0, maxChars) + `\n\n[Orion] Artifact truncated at ${maxChars} characters.`;
  }
  return content;
}

function writeConversationArtifactBuffer(conversationId, relativePath, buffer) {
  const fullPath = resolveConversationArtifactPath(conversationId, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return {
    success: true,
    artifactPath: fullPath,
    artifactRef: makeArtifactRef(conversationId, relativePath),
    relativePath: normalizeArtifactRelativePath(relativePath).replace(/\\/g, '/')
  };
}

function deleteConversationArtifacts(conversationId) {
  const dir = getConversationArtifactDir(conversationId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return { success: true };
}

function writeRunArtifact(payload = {}) {
  const conversationId = sanitizeArtifactSegment(payload.conversationId);
  const runId = sanitizeArtifactSegment(payload.runId || new Date().toISOString());
  const artifactDir = getConversationArtifactDir(conversationId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${runId}.json`);
  atomicWriteFileSync(artifactPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    ...payload
  }, null, 2), 'utf8');
  return artifactPath;
}

function listRunArtifacts(conversationId) {
  const root = getArtifactRoot();
  const entries = [];
  if (!fs.existsSync(root)) return entries;
  const conversationDirs = conversationId
    ? [sanitizeArtifactSegment(conversationId)]
    : fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isDirectory());
  conversationDirs.forEach(dirName => {
    const dirPath = path.join(root, dirName);
    if (!fs.existsSync(dirPath)) return;
    fs.readdirSync(dirPath).filter(name => name.endsWith('.json')).forEach(fileName => {
      const fullPath = path.join(dirPath, fileName);
      const stat = fs.statSync(fullPath);
      let payload = {};
      try {
        payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch (_) {
        payload = {};
      }
      const visual = payload.visualArtifact || {};
      const workspacePath = payload.workspacePath || (payload.task && payload.task.workspace) || '';
      const artifactType = payload.type === 'orion-visual-artifact' ? 'screenshot' : 'run';
      entries.push({
        conversationId: dirName,
        fileName,
        displayName: artifactType === 'screenshot'
          ? path.basename(visual.path || fileName)
          : fileName,
        artifactType,
        artifactPath: fullPath,
        workspacePath,
        screenshotPath: visual.path || '',
        width: visual.width || 0,
        height: visual.height || 0,
        toolName: payload.toolName || '',
        summary: visual.summary || '',
        createdAt: stat.mtime.toISOString(),
        size: stat.size
      });
    });
  });
  return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
}

// ── File backup ───────────────────────────────────────────────────────────────

function createFileBackup(fullPath, workspaceRoot) {
  if (!fs.existsSync(fullPath)) return null;
  const backupRoot = path.join(workspaceRoot, '.orion', 'backups');
  const relative = path.relative(workspaceRoot, fullPath);
  const safeRelative = relative.replace(/[:<>|"?*]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupRoot, `${safeRelative}.${timestamp}.bak`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.cpSync(fullPath, backupPath, { recursive: true });
  } else {
    fs.copyFileSync(fullPath, backupPath);
  }
  return path.relative(workspaceRoot, backupPath);
}

// ── Path operations ───────────────────────────────────────────────────────────

function deleteWorkspacePath(workspacePath, relativePath) {
  const workspaceRoot = path.resolve(workspacePath);
  const fullPath = resolveWorkspacePath(workspacePath, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('Path does not exist');
  const backupPath = createFileBackup(fullPath, workspaceRoot);
  fs.rmSync(fullPath, { recursive: true, force: false });
  return { success: true, backupPath };
}

function moveWorkspacePath(workspacePath, fromPath, toPath) {
  const fromFullPath = resolveWorkspacePath(workspacePath, fromPath);
  const toFullPath = resolveWorkspacePath(workspacePath, toPath);
  if (!fs.existsSync(fromFullPath)) throw new Error('Source path does not exist');
  if (fs.existsSync(toFullPath)) throw new Error('Destination already exists');
  fs.mkdirSync(path.dirname(toFullPath), { recursive: true });
  fs.renameSync(fromFullPath, toFullPath);
  return { success: true };
}

function copyWorkspacePath(workspacePath, fromPath, toPath) {
  const fromFullPath = resolveWorkspacePath(workspacePath, fromPath);
  const toFullPath = resolveWorkspacePath(workspacePath, toPath);
  if (!fs.existsSync(fromFullPath)) throw new Error('Source path does not exist');
  if (fs.existsSync(toFullPath)) throw new Error('Destination already exists');
  fs.mkdirSync(path.dirname(toFullPath), { recursive: true });
  const stat = fs.statSync(fromFullPath);
  if (stat.isDirectory()) {
    fs.cpSync(fromFullPath, toFullPath, { recursive: true });
  } else {
    fs.copyFileSync(fromFullPath, toFullPath);
  }
  return { success: true };
}

// ── Directory listing ─────────────────────────────────────────────────────────

function listWorkspaceTree(workspacePath, relativePath, limit = 200) {
  const root = resolveWorkspacePath(workspacePath, relativePath || '.');
  if (!fs.existsSync(root)) throw new Error('Path does not exist');
  const workspaceRoot = path.resolve(workspacePath);
  const entries = [];
  const visit = (fullPath) => {
    if (entries.length >= limit) return;
    const stat = fs.statSync(fullPath);
    const rel = path.relative(workspaceRoot, fullPath);
    entries.push({
      path: rel,
      isDir: stat.isDirectory(),
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
    if (stat.isDirectory()) {
      fs.readdirSync(fullPath).slice(0, 200).forEach(name => {
        if (entries.length < limit) visit(path.join(fullPath, name));
      });
    }
  };
  visit(root);
  return entries;
}

// ── Download & archive helpers ────────────────────────────────────────────────

function safeRelativeAssetPath(value, fallback) {
  const raw = String(value || fallback || '').trim().replace(/^[/\\]+/, '');
  const safe = raw.replace(/[:<>|"?*]/g, '_');
  return safe || fallback;
}

function inferFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const base = path.basename(decodeURIComponent(parsed.pathname || ''));
    return base && base !== '/' ? base : `download-${Date.now()}`;
  } catch (_) {
    return `download-${Date.now()}`;
  }
}

async function downloadFileToWorkspace(workspacePath, url, destination) {
  if (!url || !/^https?:\/\//i.test(String(url))) throw new Error('download_file requires an http(s) URL');
  const filename = inferFilenameFromUrl(url);
  const relativePath = safeRelativeAssetPath(destination, path.join('assets', 'downloads', filename));
  const fullPath = resolveWorkspacePath(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(fullPath, buffer);
  return {
    success: true,
    url,
    path: path.relative(path.resolve(workspacePath), fullPath),
    size: buffer.length,
    contentType: response.headers.get('content-type') || '',
    summary: `Downloaded ${filename} (${buffer.length} bytes)`
  };
}

function runUtilityCommand(executable, args, cwd, timeoutMs = 30000) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', error => {
      clearTimeout(timeout);
      resolve({ success: false, code: null, stdout, stderr, error: error.message });
    });
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ success: code === 0, code, stdout, stderr, error: code === 0 ? '' : stderr || stdout });
    });
  });
}

async function inspectArchiveInWorkspace(workspacePath, relativePath) {
  const fullPath = resolveWorkspacePath(workspacePath, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('Archive does not exist');
  const stat = fs.statSync(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const tarResult = await runUtilityCommand('tar', ['-tf', fullPath], workspacePath, 30000);
  const entries = tarResult.success
    ? tarResult.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 500)
    : [];
  return {
    success: tarResult.success,
    path: relativePath,
    extension: ext,
    size: stat.size,
    entries,
    entryCount: entries.length,
    error: tarResult.success ? '' : tarResult.error,
    summary: tarResult.success ? `Archive contains ${entries.length} visible entries.` : `Archive inspection failed: ${tarResult.error}`
  };
}

async function extractArchiveInWorkspace(workspacePath, relativePath, destination) {
  const sourceFullPath = resolveWorkspacePath(workspacePath, relativePath);
  if (!fs.existsSync(sourceFullPath)) throw new Error('Archive does not exist');
  const fallbackDest = path.join('assets', 'extracted', path.basename(relativePath, path.extname(relativePath)));
  const destRel = safeRelativeAssetPath(destination, fallbackDest);
  const destFullPath = resolveWorkspacePath(workspacePath, destRel);
  fs.mkdirSync(destFullPath, { recursive: true });
  const result = await runUtilityCommand('tar', ['-xf', sourceFullPath, '-C', destFullPath], workspacePath, 60000);
  if (!result.success) throw new Error(result.error || 'Archive extraction failed');
  const files = listWorkspaceTree(workspacePath, destRel, 250);
  return {
    success: true,
    path: relativePath,
    destination: destRel,
    files,
    summary: `Extracted archive to ${destRel} (${files.length} listed entries).`
  };
}

// ── Binary asset inspection ───────────────────────────────────────────────────

function detectBinaryAssetKind(buffer, ext) {
  const first = buffer.slice(0, 16).toString('hex');
  if (buffer.slice(0, 4).toString('utf8') === 'glTF') return 'glb';
  if (first.startsWith('89504e47')) return 'png';
  if (first.startsWith('ffd8ff')) return 'jpeg';
  if (first.startsWith('504b0304')) return 'zip';
  if (ext === '.gltf') return 'gltf';
  if (ext === '.glb') return 'glb';
  if (ext === '.obj') return 'obj';
  if (ext === '.fbx') return 'fbx';
  return ext.replace(/^\./, '') || 'binary';
}

function inspectBinaryAssetInWorkspace(workspacePath, relativePath) {
  const artifactPath = resolveArtifactReferencePath(relativePath);
  const fullPath = artifactPath || resolveWorkspacePath(workspacePath, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('Asset does not exist');
  const stat = fs.statSync(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const buffer = fs.readFileSync(fullPath);
  const kind = detectBinaryAssetKind(buffer, ext);
  const details = {};
  if (kind === 'glb' && buffer.length >= 12) {
    details.magic = buffer.slice(0, 4).toString('utf8');
    details.version = buffer.readUInt32LE(4);
    details.declaredLength = buffer.readUInt32LE(8);
  }
  if (kind === 'gltf') {
    try {
      const parsed = JSON.parse(buffer.toString('utf8'));
      details.asset = parsed.asset || {};
      details.meshes = Array.isArray(parsed.meshes) ? parsed.meshes.length : 0;
      details.materials = Array.isArray(parsed.materials) ? parsed.materials.length : 0;
      details.images = Array.isArray(parsed.images) ? parsed.images.length : 0;
    } catch (e) {
      details.parseError = e.message;
    }
  }
  return {
    success: true,
    path: relativePath,
    extension: ext,
    kind,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    details,
    summary: `Inspected ${kind} asset ${relativePath} (${stat.size} bytes).`
  };
}

function listAssetMetadataInWorkspace(workspacePath, relativePath) {
  const entries = listWorkspaceTree(workspacePath, relativePath || 'assets', 300);
  const assetExts = new Set(['.glb', '.gltf', '.obj', '.fbx', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.mtl', '.bin', '.zip']);
  const assets = entries
    .filter(entry => !entry.isDir && assetExts.has(path.extname(entry.path).toLowerCase()))
    .map(entry => ({ ...entry, extension: path.extname(entry.path).toLowerCase() }));
  return {
    success: true,
    path: relativePath || 'assets',
    assets,
    count: assets.length,
    summary: `Found ${assets.length} asset-like files under ${relativePath || 'assets'}.`
  };
}

function readWorkspaceFileBase64(workspacePath, relativePath) {
  let fullPath = resolveArtifactReferencePath(relativePath);
  
  // Allow absolute paths if they fall within the trusted artifacts directory
  if (!fullPath && path.isAbsolute(relativePath)) {
    const artifactRoot = getArtifactRoot();
    if (relativePath.startsWith(artifactRoot)) {
      fullPath = relativePath;
    }
  }
  
  fullPath = fullPath || resolveWorkspacePath(workspacePath, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('File does not exist');
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) throw new Error('Path is not a file');
  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };
  return {
    success: true,
    path: relativePath,
    mimeType: mimeTypes[ext] || 'application/octet-stream',
    size: stat.size,
    data: fs.readFileSync(fullPath).toString('base64')
  };
}

function inspectScreenshotInWorkspace(workspacePath, relativePath) {
  const asset = inspectBinaryAssetInWorkspace(workspacePath, relativePath);
  return {
    ...asset,
    screenshot: true,
    summary: `Screenshot ${relativePath}: ${asset.kind}, ${asset.size} bytes.`
  };
}

function compareScreenshotToGoalInWorkspace(workspacePath, relativePath, goal, observations) {
  const screenshot = inspectScreenshotInWorkspace(workspacePath, relativePath);
  const obs = String(observations || '').trim();
  const goalText = String(goal || '').trim();
  const satisfied = obs && /appears|visible|present|matches|satisfied|fits|shown|contains/i.test(obs) && !/not visible|missing|absent|does not|failed/i.test(obs);
  return {
    success: true,
    path: relativePath,
    goal: goalText,
    status: satisfied ? 'appears_satisfied' : 'needs_more_visual_evidence',
    confidence: satisfied ? 0.65 : 0.2,
    evidence: obs || `Local screenshot metadata is available (${screenshot.kind}, ${screenshot.size} bytes), but no visual observation text was provided.`,
    limitation: obs ? '' : 'This local tool does not perform semantic computer vision by itself; use the screenshot evidence with model/user visual inspection before marking visual win conditions complete.',
    summary: satisfied ? `Screenshot appears to satisfy goal based on supplied observations: ${goalText}` : `Screenshot comparison needs more visual evidence for: ${goalText}`
  };
}

// ── Patch helpers ─────────────────────────────────────────────────────────────

function applyPatch(original, operation) {
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
    const context = vm.createContext({
      updated,
      pattern: operation.pattern,
      flags: safeFlags.includes('g') ? safeFlags : safeFlags + 'g',
      replacement: operation.replacement,
      result: null,
      error: null
    });
    try {
      vm.runInContext(`
        try {
          const regex = new RegExp(pattern, flags);
          const matches = updated.match(regex);
          const replacements = matches ? matches.length : 0;
          const newUpdated = updated.replace(regex, replacement);
          result = { replacements, newUpdated };
        } catch (e) {
          error = e.message;
        }
      `, context, { timeout: 250 });
      if (context.error) throw new Error(context.error);
      if (!context.result) throw new Error('Regex evaluation failed');
      const { replacements, newUpdated } = context.result;
      if (replacements === 0) throw new Error('Regex pattern did not match');
      updated = newUpdated;
      details = { replacements };
    } catch (e) {
      if (e.message.includes('timed out')) throw new Error('Regex execution timed out (possible ReDoS)');
      throw e;
    }
  } else if (operation.type === 'insert') {
    if (!operation.anchor) throw new Error('insert requires anchor');
    if (operation.content === undefined) throw new Error('insert requires content');
    // Insert operations add new code (a method, a field, an import) that by definition shouldn't
    // already exist. A retried or re-issued insert call with the same content silently duplicates
    // it instead of failing loudly — guard against that for any non-trivial content block.
    const trimmedContent = String(operation.content).trim();
    if (trimmedContent.length >= 20 && updated.includes(trimmedContent)) {
      throw new Error('insert refused: this exact content already exists in the file. Read the file to confirm whether this change was already applied before retrying.');
    }
    const position = operation.position === 'before' ? 'before' : 'after';
    const index = updated.indexOf(operation.anchor);
    if (index === -1) throw new Error('Anchor content not found');
    const insertAt = position === 'before' ? index : index + operation.anchor.length;
    let content = operation.content;
    if (position === 'after') {
      const anchorEndsLine = insertAt >= updated.length || updated[insertAt] === '\n';
      if (anchorEndsLine && content.length && !content.startsWith('\n')) {
        content = '\n' + content;
      }
    } else {
      const anchorStartsLine = insertAt === 0 || updated[insertAt - 1] === '\n';
      if (anchorStartsLine && content.length && !content.endsWith('\n')) {
        content = content + '\n';
      }
    }
    updated = updated.slice(0, insertAt) + content + updated.slice(insertAt);
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

  return { updated, details };
}

function buildPatchProof(original, updated) {
  const originalLines = String(original).split(/\r?\n/);
  const updatedLines = String(updated).split(/\r?\n/);
  let start = 0;
  while (start < originalLines.length && start < updatedLines.length && originalLines[start] === updatedLines[start]) {
    start++;
  }
  let endOriginal = originalLines.length - 1;
  let endUpdated = updatedLines.length - 1;
  while (endOriginal >= start && endUpdated >= start && originalLines[endOriginal] === updatedLines[endUpdated]) {
    endOriginal--;
    endUpdated--;
  }
  const contextStart = Math.max(start - 2, 0);
  const contextEndOriginal = Math.min(endOriginal + 2, originalLines.length - 1);
  const contextEndUpdated = Math.min(endUpdated + 2, updatedLines.length - 1);
  return {
    startLine: start + 1,
    originalEndLine: Math.max(endOriginal + 1, start + 1),
    updatedEndLine: Math.max(endUpdated + 1, start + 1),
    originalSnippet: originalLines.slice(contextStart, contextEndOriginal + 1).join('\n'),
    updatedSnippet: updatedLines.slice(contextStart, contextEndUpdated + 1).join('\n')
  };
}

// ── IPC handler registration ──────────────────────────────────────────────────

function registerHandlers(ipcMain) {
  ipcMain.handle('list-directory-children', async (event, dirPath) => {
    try {
      if (!dirPath) return [];
      const resolvedDir = path.resolve(dirPath);
      if (!fs.existsSync(resolvedDir)) throw new Error(`Directory does not exist: ${resolvedDir}`);
      const stat = fs.lstatSync(resolvedDir);
      if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${resolvedDir}`);
      return fs.readdirSync(resolvedDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolvedDir, entry.name),
          isDir: true
        }));
    } catch (e) {
      console.error('Error listing directory children:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('list-files', async (event, dirPath) => {
    try {
      if (!dirPath) return [];
      if (!fs.existsSync(dirPath)) throw new Error(`Directory does not exist: ${dirPath}`);
      const getFiles = (dir, rootDir) => {
        let results = [];
        const list = fs.readdirSync(dir);
        list.forEach((file) => {
          const filePath = path.join(dir, file);
          const stat = fs.lstatSync(filePath);
          const relPath = path.relative(rootDir, filePath);
          if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.gemini' || file === 'build' || file === '.orion' || file === '.claude') return;
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
    } catch (e) {
      console.error('Error listing files:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('grep-search', async (event, { workspacePath, pattern, options }) => {
    try {
      if (!workspacePath) return { success: false, error: 'No active workspace directory found.' };
      if (!pattern) return { success: false, error: "Missing 'pattern' parameter." };
      if (!fs.existsSync(workspacePath)) throw new Error(`Directory does not exist: ${workspacePath}`);

      const opts = options || {};
      const maxResults = Number.isFinite(Number(opts.maxResults)) ? Math.max(1, Math.min(500, Number(opts.maxResults))) : 100;
      const caseSensitive = !!opts.caseSensitive;
      const filePattern = opts.filePattern ? String(opts.filePattern).toLowerCase() : null;
      const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip anything above 2MB — almost certainly not hand-authored source
      const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp', '.svg', '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wav', '.mov', '.avi', '.db', '.sqlite', '.node']);

      let matcher;
      try {
        matcher = opts.regex
          ? new RegExp(pattern, caseSensitive ? 'g' : 'gi')
          : null;
      } catch (e) {
        return { success: false, error: `Invalid regex pattern: ${e.message}` };
      }
      const needle = caseSensitive ? String(pattern) : String(pattern).toLowerCase();

      const results = [];
      let filesScanned = 0;
      let truncated = false;

      const walk = (dir, rootDir) => {
        if (truncated) return;
        let entries;
        try {
          entries = fs.readdirSync(dir);
        } catch (_) {
          return;
        }
        for (const entry of entries) {
          if (truncated) return;
          if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === '.gemini' || entry === 'build' || entry === '.orion' || entry === '.claude') continue;
          const fullPath = path.join(dir, entry);
          let stat;
          try {
            stat = fs.lstatSync(fullPath);
          } catch (_) {
            continue;
          }
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) {
            walk(fullPath, rootDir);
            continue;
          }
          const ext = path.extname(entry).toLowerCase();
          if (BINARY_EXTENSIONS.has(ext)) continue;
          if (filePattern && ext !== filePattern && !entry.toLowerCase().endsWith(filePattern)) continue;
          if (stat.size > MAX_FILE_BYTES) continue;

          filesScanned++;
          let content;
          try {
            content = fs.readFileSync(fullPath, 'utf8');
          } catch (_) {
            continue;
          }
          const relPath = path.relative(rootDir, fullPath);
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let isMatch;
            if (matcher) {
              matcher.lastIndex = 0;
              isMatch = matcher.test(line);
            } else {
              isMatch = (caseSensitive ? line : line.toLowerCase()).includes(needle);
            }
            if (isMatch) {
              results.push({
                path: relPath,
                line: i + 1,
                text: line.length > 300 ? line.slice(0, 300) + '…' : line
              });
              if (results.length >= maxResults) {
                truncated = true;
                return;
              }
            }
          }
        }
      };

      walk(workspacePath, workspacePath);

      return {
        success: true,
        results,
        filesScanned,
        truncated,
        message: truncated ? `Truncated at ${maxResults} matches — narrow the pattern or add filePattern if you need more.` : undefined
      };
    } catch (e) {
      console.error('Error in grep-search:', e);
      return { success: false, error: e.message };
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
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      atomicWriteFileSync(fullPath, content, 'utf8');
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
      const { updated, details } = applyPatch(original, operation);
      if (updated === original) {
        return { success: true, changed: false, message: 'Patch produced no content changes.', details };
      }
      const backupPath = createFileBackup(fullPath, workspaceRoot);
      atomicWriteFileSync(fullPath, updated, 'utf8');
      return { success: true, changed: true, message: `Patched ${relativePath} successfully.`, details, proof: buildPatchProof(original, updated), backupPath };
    } catch (e) {
      console.error('Error patching file:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('delete-path', async (event, { workspacePath, relativePath }) => {
    try {
      return deleteWorkspacePath(workspacePath, relativePath);
    } catch (e) {
      console.error('Error deleting path:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('move-path', async (event, { workspacePath, fromPath, toPath }) => {
    try {
      return moveWorkspacePath(workspacePath, fromPath, toPath);
    } catch (e) {
      console.error('Error moving path:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('rename-path', async (event, { workspacePath, relativePath, newName }) => {
    try {
      const safeName = String(newName || '').trim();
      if (!safeName || /[\\/]/.test(safeName)) throw new Error('Rename requires a plain file or folder name');
      const parent = path.dirname(relativePath);
      const toPath = parent === '.' ? safeName : path.join(parent, safeName);
      return moveWorkspacePath(workspacePath, relativePath, toPath);
    } catch (e) {
      console.error('Error renaming path:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('copy-path', async (event, { workspacePath, fromPath, toPath }) => {
    try {
      return copyWorkspacePath(workspacePath, fromPath, toPath);
    } catch (e) {
      console.error('Error copying path:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('download-file', async (event, { workspacePath, url, destination }) => {
    try {
      return await downloadFileToWorkspace(workspacePath, url, destination);
    } catch (e) {
      console.error('Error downloading file:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('inspect-archive', async (event, { workspacePath, relativePath }) => {
    try {
      return await inspectArchiveInWorkspace(workspacePath, relativePath);
    } catch (e) {
      console.error('Error inspecting archive:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('extract-archive', async (event, { workspacePath, relativePath, destination }) => {
    try {
      return await extractArchiveInWorkspace(workspacePath, relativePath, destination);
    } catch (e) {
      console.error('Error extracting archive:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('inspect-binary-asset', async (event, { workspacePath, relativePath }) => {
    try {
      return inspectBinaryAssetInWorkspace(workspacePath, relativePath);
    } catch (e) {
      console.error('Error inspecting binary asset:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('list-asset-metadata', async (event, { workspacePath, relativePath }) => {
    try {
      return listAssetMetadataInWorkspace(workspacePath, relativePath);
    } catch (e) {
      console.error('Error listing asset metadata:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('inspect-screenshot', async (event, { workspacePath, relativePath }) => {
    try {
      return inspectScreenshotInWorkspace(workspacePath, relativePath);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('read-workspace-file-base64', async (event, { workspacePath, relativePath }) => {
    try {
      return readWorkspaceFileBase64(workspacePath, relativePath);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('compare-screenshot-to-goal', async (event, { workspacePath, relativePath, goal, observations }) => {
    try {
      return compareScreenshotToGoalInWorkspace(workspacePath, relativePath, goal, observations);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('write-run-artifact', async (event, payload) => {
    try {
      const artifactPath = writeRunArtifact(payload || {});
      return { success: true, artifactPath };
    } catch (e) {
      console.error('Error writing run artifact:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('write-conversation-artifact', async (event, { conversationId, relativePath, content }) => {
    try {
      return writeConversationArtifactText(conversationId, relativePath, content);
    } catch (e) {
      console.error('Error writing conversation artifact:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('read-conversation-artifact', async (event, { conversationId, relativePath, options }) => {
    try {
      return { success: true, content: readConversationArtifactText(conversationId, relativePath, options || {}) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-conversation-artifacts', async (event, conversationId) => {
    try {
      return deleteConversationArtifacts(conversationId);
    } catch (e) {
      console.error('Error deleting conversation artifacts:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('list-run-artifacts', async (event, conversationId) => {
    try {
      return { success: true, artifacts: listRunArtifacts(conversationId) };
    } catch (e) {
      console.error('Error listing run artifacts:', e);
      return { success: false, error: e.message, artifacts: [] };
    }
  });

  ipcMain.handle('get-home-dir', () => os.homedir());
  ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

  ipcMain.handle('orion:get-file-symbols', async (event, { workspacePath, relativePath }) => {
    try {
      const fullPath = resolveWorkspacePath(workspacePath, relativePath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const { extractSymbols } = require('./ast-parser');
      return extractSymbols(content, { filePath: fullPath, path: relativePath });
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('orion:semantic-search', async (event, { query, workspacePath, config, topK }) => {
    try {
      const { semanticSearch } = require('./semantic-search');
      const results = await semanticSearch(query, workspacePath, config, topK);
      return { success: true, results };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  registerHandlers,
  createFileBackup,
  safeRelativeAssetPath,
  makeArtifactRef,
  parseArtifactRef,
  resolveArtifactReferencePath,
  writeConversationArtifactBuffer,
  writeConversationArtifactText,
  readConversationArtifactText,
  deleteConversationArtifacts,
  downloadFileToWorkspace,
  inspectBinaryAssetInWorkspace,
  listAssetMetadataInWorkspace,
  compareScreenshotToGoalInWorkspace,
  applyPatch,
  buildPatchProof,
  listWorkspaceTree,
  deleteWorkspacePath,
  moveWorkspacePath,
  copyWorkspacePath
};
