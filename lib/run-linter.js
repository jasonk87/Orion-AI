'use strict';
const { exec } = require('child_process');
const path = require('path');

function runLinter(workspacePath, linterType, targetPath = '.') {
  return new Promise((resolve) => {
    let command = '';
    
    if (linterType === 'eslint') {
      command = `npx eslint --format json "${targetPath}"`;
    } else if (linterType === 'tsc') {
      command = `npx tsc --noEmit`;
    } else if (linterType === 'ruff') {
      command = `ruff check --output-format json "${targetPath}"`;
    } else {
      return resolve({ success: false, error: `Unsupported linter type: ${linterType}` });
    }

    exec(command, { cwd: workspacePath, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      try {
        let results = [];
        
        if (linterType === 'eslint') {
          if (!stdout || stdout.trim() === '') {
             if (stderr) throw new Error(stderr);
             return resolve({ success: true, results: [] });
          }
          const parsed = JSON.parse(stdout);
          parsed.forEach(fileRes => {
            fileRes.messages.forEach(msg => {
              results.push({
                file: path.relative(workspacePath, fileRes.filePath),
                line: msg.line,
                rule: msg.ruleId || 'syntax',
                message: msg.message,
                severity: msg.severity === 2 ? 'error' : 'warning'
              });
            });
          });
        } else if (linterType === 'ruff') {
          if (!stdout || stdout.trim() === '') {
             if (stderr) throw new Error(stderr);
             return resolve({ success: true, results: [] });
          }
          const parsed = JSON.parse(stdout);
          parsed.forEach(msg => {
            results.push({
              file: path.relative(workspacePath, msg.filename),
              line: msg.location.row,
              rule: msg.code,
              message: msg.message,
              severity: 'error'
            });
          });
        } else if (linterType === 'tsc') {
          const lines = stdout.split('\n');
          lines.forEach(line => {
            const match = line.match(/^(.+)\((\d+),\d+\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
            if (match) {
              results.push({
                file: match[1].replace(workspacePath + path.sep, ''),
                line: parseInt(match[2], 10),
                rule: match[4],
                message: match[5],
                severity: match[3]
              });
            }
          });
        }
        
        resolve({ success: true, results });
      } catch (e) {
        resolve({ 
          success: false, 
          error: `Failed to parse ${linterType} output: ${e.message}`,
          rawOutput: (stdout || '') + (stderr || '').slice(0, 500)
        });
      }
    });
  });
}

module.exports = { runLinter };
