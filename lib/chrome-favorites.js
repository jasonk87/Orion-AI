'use strict';

const fs = require('fs');
const path = require('path');

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function labelTokens(value) {
  return normalizeLabel(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function validateFavoriteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('The Chrome favorite does not contain a URL.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error('The Chrome favorite contains an invalid URL.');
  }
  if (!['http:', 'https:', 'chrome:', 'file:'].includes(parsed.protocol)) {
    throw new Error(`Chrome favorite URLs using ${parsed.protocol || 'that protocol'} are not allowed.`);
  }
  return raw;
}

function defaultChromeUserDataRoot(localAppData = process.env.LOCALAPPDATA || '') {
  return localAppData ? path.join(localAppData, 'Google', 'Chrome', 'User Data') : '';
}

function discoverBookmarkFiles(options = {}) {
  const fsImpl = options.fs || fs;
  const root = options.userDataRoot || defaultChromeUserDataRoot(options.localAppData);
  if (!root || !fsImpl.existsSync(root)) return [];
  const files = [];
  for (const entry of fsImpl.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const bookmarksPath = path.join(root, entry.name, 'Bookmarks');
    if (fsImpl.existsSync(bookmarksPath)) {
      files.push({ profile: entry.name, path: bookmarksPath });
    }
  }
  return files.sort((left, right) => {
    if (left.profile === 'Default') return -1;
    if (right.profile === 'Default') return 1;
    return left.profile.localeCompare(right.profile);
  });
}

function flattenBookmarkNode(node, context, output) {
  if (!node || typeof node !== 'object') return;
  const name = String(node.name || '').trim();
  if (node.type === 'url' && name && node.url) {
    output.push({
      name,
      url: String(node.url),
      folder: context.folders.join(' / '),
      profile: context.profile,
      dateAdded: String(node.date_added || '')
    });
    return;
  }
  if (!Array.isArray(node.children)) return;
  const folders = name ? [...context.folders, name] : context.folders;
  node.children.forEach(child => flattenBookmarkNode(child, { ...context, folders }, output));
}

function readChromeFavorites(options = {}) {
  const fsImpl = options.fs || fs;
  const bookmarkFiles = Array.isArray(options.bookmarkFiles)
    ? options.bookmarkFiles.map(item => typeof item === 'string'
      ? { profile: path.basename(path.dirname(item)), path: item }
      : item)
    : discoverBookmarkFiles(options);
  const favorites = [];
  const unreadableProfiles = [];
  for (const item of bookmarkFiles) {
    try {
      const data = JSON.parse(fsImpl.readFileSync(item.path, 'utf8'));
      const roots = data && data.roots && typeof data.roots === 'object' ? data.roots : {};
      Object.values(roots).forEach(rootNode => flattenBookmarkNode(rootNode, {
        profile: String(item.profile || 'Default'),
        folders: []
      }, favorites));
    } catch (_) {
      unreadableProfiles.push(String(item.profile || path.basename(path.dirname(item.path)) || 'unknown'));
    }
  }
  return { favorites, bookmarkFiles, unreadableProfiles };
}

function boundedMatchSummary(item) {
  return {
    name: item.name,
    folder: item.folder,
    profile: item.profile,
    url: item.url
  };
}

function resolveChromeFavorite(input = {}, options = {}) {
  const query = String(input.name || '').trim();
  if (!query) return { success: false, error: 'A Chrome favorite name is required.' };
  if (query.length > 300) return { success: false, error: 'Chrome favorite names are limited to 300 characters.' };

  const requestedName = normalizeLabel(query);
  const requestedTokens = new Set(labelTokens(query));
  const requestedFolder = normalizeLabel(input.folder || '');
  const { favorites, bookmarkFiles, unreadableProfiles } = readChromeFavorites(options);
  if (!bookmarkFiles.length) {
    return { success: false, error: 'No local Google Chrome profile with a Bookmarks file was found.' };
  }

  const folderFiltered = favorites.filter(item => {
    if (!requestedFolder) return true;
    return normalizeLabel(item.folder).includes(requestedFolder);
  });
  const scored = folderFiltered.map(item => {
    const candidateName = normalizeLabel(item.name);
    let score = -1;
    let matchKind = '';
    if (candidateName === requestedName) {
      score = 300;
      matchKind = 'exact';
    } else if (candidateName.startsWith(requestedName)) {
      score = 200;
      matchKind = 'prefix';
    } else if (candidateName.includes(requestedName)) {
      score = 100;
      matchKind = 'contains';
    } else {
      const candidateTokens = [...new Set(labelTokens(item.name))];
      if (candidateTokens.length >= 2 && candidateTokens.every(token => requestedTokens.has(token))) {
        score = 75 + candidateTokens.length;
        matchKind = 'token';
      }
    }
    if (score >= 0 && requestedFolder && normalizeLabel(item.folder) === requestedFolder) score += 25;
    return { ...item, score, matchKind };
  }).filter(item => item.score >= 0);

  if (!scored.length) {
    return {
      success: false,
      notFound: true,
      reasonCode: 'favorite_not_found',
      error: `No Chrome favorite matched "${query}"${input.folder ? ` in "${String(input.folder)}"` : ''}.`,
      unreadableProfiles
    };
  }
  const bestScore = Math.max(...scored.map(item => item.score));
  const best = scored.filter(item => item.score === bestScore);
  const uniqueUrls = [...new Set(best.map(item => item.url))];
  if (uniqueUrls.length > 1) {
    return {
      success: false,
      ambiguous: true,
      reasonCode: 'favorite_ambiguous',
      error: `More than one Chrome favorite matched "${query}". Use the folder name to choose one.`,
      matches: best.slice(0, 8).map(boundedMatchSummary)
    };
  }

  const selected = best[0];
  try {
    selected.url = validateFavoriteUrl(selected.url);
  } catch (error) {
    return { success: false, error: error.message };
  }
  return {
    success: true,
    favorite: boundedMatchSummary(selected),
    matchKind: selected.matchKind,
    duplicateCount: best.length
  };
}

function encodePowerShellData(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function buildOpenChromeUrlScript(url) {
  const safeUrl = validateFavoriteUrl(url);
  const encodedUrl = encodePowerShellData(safeUrl);
  return `$ErrorActionPreference = 'Stop'\n` +
    `$url = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedUrl}'))\n` +
    `$candidates = [System.Collections.Generic.List[string]]::new()\n` +
    `@(Get-Process chrome -ErrorAction SilentlyContinue) | ForEach-Object { try { if ($_.Path) { $candidates.Add($_.Path) } } catch {} }\n` +
    `@((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(default)', (Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(default)', "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe", "\${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe", "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe") | ForEach-Object { if ($_ -and (Test-Path -LiteralPath $_)) { $candidates.Add([string]$_) } }\n` +
    `$chrome = @($candidates | Select-Object -Unique | Select-Object -First 1)[0]\n` +
    `if (-not $chrome) { [pscustomobject]@{ success=$false; error='Google Chrome is not installed in a discoverable location.' } | ConvertTo-Json -Compress; exit 0 }\n` +
    `Start-Process -FilePath $chrome -ArgumentList @('--new-tab', $url)\n` +
    `[pscustomobject]@{ success=$true; method='chrome-new-tab'; processName='chrome'; url=$url } | ConvertTo-Json -Compress\n`;
}

module.exports = {
  normalizeLabel,
  labelTokens,
  validateFavoriteUrl,
  defaultChromeUserDataRoot,
  discoverBookmarkFiles,
  readChromeFavorites,
  resolveChromeFavorite,
  buildOpenChromeUrlScript
};
