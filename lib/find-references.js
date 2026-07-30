'use strict';
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const { getWorkspaceIndexService } = require('./workspace-index-service');

const { SCAN_SKIP_DIRECTORIES: SKIP_DIRS } = require('./scan-ignore');

const INDEXABLE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

function collectFiles(dirPath, targetPath) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const fullPath = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(fullPath); } catch (_) { continue; }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(fullPath);
      }
    }
  }
  
  if (targetPath && targetPath !== '.') {
    const fullTarget = path.join(dirPath, targetPath);
    try {
      const stat = fs.statSync(fullTarget);
      if (stat.isDirectory()) {
        walk(fullTarget);
      } else {
        results.push(fullTarget);
      }
    } catch (_) {}
  } else {
    walk(dirPath);
  }
  return results;
}

function findReferences(workspacePath, symbolName, targetPath = '.') {
  try {
    return Promise.resolve(getWorkspaceIndexService(workspacePath).findReferences(symbolName, targetPath));
  } catch (_) {
    // Fall back to the legacy scanner if the shared index cannot initialize.
  }
  return new Promise((resolve) => {
    try {
      const files = collectFiles(workspacePath, targetPath);
      const regex = new RegExp(`\\b${symbolName}\\b`);
      let results = [];
      
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        let content;
        try {
          content = fs.readFileSync(file, 'utf8');
        } catch (_) { return; }
        
        if (!regex.test(content)) return;
        
        const lines = content.split(/\r?\n/);
        
        if (INDEXABLE_EXTS.has(ext)) {
          let ast;
          try {
            ast = parser.parse(content, {
              sourceType: 'unambiguous',
              plugins: ['typescript', 'jsx', 'decorators-legacy', 'importAssertions'],
              attachComment: false,
              ranges: true
            });
          } catch (_) {
            fallbackRegex(file, lines, regex, workspacePath, results);
            return;
          }
          
          let foundNodes = [];
          function walkNode(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
              node.forEach(walkNode);
              return;
            }
            if ((node.type === 'Identifier' || node.type === 'JSXIdentifier') && node.name === symbolName) {
              foundNodes.push(node);
            }
            for (const key in node) {
              if (key !== 'loc' && key !== 'range' && typeof node[key] === 'object') {
                walkNode(node[key]);
              }
            }
          }
          
          walkNode(ast);
          
          foundNodes.forEach(node => {
            if (node.loc) {
              const lineIdx = node.loc.start.line - 1;
              results.push({
                file: path.relative(workspacePath, file).replace(/\\/g, '/'),
                line: node.loc.start.line,
                content: lines[lineIdx].trim()
              });
            }
          });
        } else {
          fallbackRegex(file, lines, regex, workspacePath, results);
        }
      });
      
      resolve({ success: true, results });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

function fallbackRegex(file, lines, regex, workspacePath, results) {
  lines.forEach((line, idx) => {
    if (line.match(regex)) {
      results.push({
        file: path.relative(workspacePath, file).replace(/\\/g, '/'),
        line: idx + 1,
        content: line.trim()
      });
    }
  });
}

module.exports = { findReferences };
