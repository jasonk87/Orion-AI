const path = require('path');
const parser = require('@babel/parser');

const JS_TS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const PYTHON_EXTENSIONS = new Set(['.py']);
const SUPPORTED_EXTENSIONS = new Set([...JS_TS_EXTENSIONS, ...PYTHON_EXTENSIONS]);

function normalizedIndent(rawIndent) {
  return rawIndent.replace(/\t/g, '    ').length;
}

function extractPythonSymbols(code) {
  const lines = code.split(/\r?\n/);
  const symbols = [];
  const stack = [];
  const pendingDecoratorStart = new Map();

  function closeContainers(indent, endLine) {
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      const item = stack.pop();
      item.symbol.endLine = Math.max(item.symbol.startLine, endLine);
    }
  }

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const indentMatch = rawLine.match(/^[ \t]*/);
    const indent = normalizedIndent(indentMatch ? indentMatch[0] : '');

    if (trimmed.startsWith('@')) {
      if (!pendingDecoratorStart.has(indent)) pendingDecoratorStart.set(indent, lineNo);
      return;
    }

    const match = rawLine.match(/^([ \t]*)(async\s+def|def|class)\s+([A-Za-z_]\w*)\b(.*)$/);
    if (!match) {
      pendingDecoratorStart.delete(indent);
      return;
    }

    closeContainers(indent, lineNo - 1);

    const keyword = match[2];
    const name = match[3];
    const parentPath = stack.map(item => item.symbol.name).join('.');
    const parent = stack[stack.length - 1];
    const isClass = keyword === 'class';
    const isMethod = !isClass && parent && parent.symbol.type === 'Class' && indent > parent.indent;
    const symbol = {
      type: isClass ? 'Class' : (isMethod ? 'Method' : 'Function'),
      name,
      signature: trimmed,
      startLine: pendingDecoratorStart.get(indent) || lineNo,
      endLine: lineNo,
      path: parentPath
    };

    symbols.push(symbol);
    stack.push({ indent, symbol });
    pendingDecoratorStart.delete(indent);
  });

  while (stack.length) {
    const item = stack.pop();
    item.symbol.endLine = Math.max(item.symbol.startLine, lines.length);
  }

  return { success: true, symbols };
}

function extractJavaScriptSymbols(code) {
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'importAssertions'
      ],
      attachComment: false,
      ranges: true
    });
  } catch (e) {
    return { success: false, error: e.message };
  }

  const symbols = [];

  function getSignature(node) {
    if (!node.loc) return '';
    if (node.body && node.body.start !== undefined && node.start !== undefined) {
      let sig = code.slice(node.start, node.body.start).trim();
      if (sig.endsWith('{')) sig = sig.slice(0, -1).trim();
      // clean up excessive whitespace/newlines in signature
      return sig.replace(/\s+/g, ' ');
    }
    const lines = code.slice(node.start, node.end).split('\n');
    return lines[0].trim();
  }

  function walk(node, path = '') {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach(n => walk(n, path));
      return;
    }

    switch (node.type) {
      case 'FunctionDeclaration':
        symbols.push({
          type: 'Function',
          name: node.id ? node.id.name : '<anonymous>',
          signature: getSignature(node),
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          path
        });
        break;
      case 'ClassDeclaration':
        const className = node.id ? node.id.name : '<anonymous>';
        symbols.push({
          type: 'Class',
          name: className,
          signature: getSignature(node),
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          path
        });
        if (node.body && node.body.type === 'ClassBody') {
          walk(node.body.body, path ? `${path}.${className}` : className);
        }
        return;
      case 'ClassMethod':
      case 'ClassPrivateMethod':
        symbols.push({
          type: 'Method',
          name: node.key && node.key.name ? node.key.name : '<computed>',
          signature: getSignature(node),
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          path
        });
        break;
      case 'VariableDeclarator':
        if (node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
          symbols.push({
            type: 'Function',
            name: node.id && node.id.name ? node.id.name : '<anonymous>',
            signature: `const ${node.id && node.id.name ? node.id.name : ''} = ${getSignature(node.init)}`,
            startLine: node.loc.start.line,
            endLine: node.loc.end.line,
            path
          });
        }
        break;
      case 'ObjectMethod':
        symbols.push({
          type: 'ObjectMethod',
          name: node.key && node.key.name ? node.key.name : '<computed>',
          signature: getSignature(node),
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          path
        });
        break;
    }

    for (const key in node) {
      if (key !== 'loc' && key !== 'start' && key !== 'end' && key !== 'tokens' && key !== 'comments') {
        walk(node[key], path);
      }
    }
  }

  walk(ast.program);
  
  return { success: true, symbols };
}

function extractSymbols(code, options = {}) {
  const filePath = typeof options === 'string' ? options : (options.filePath || options.path || '');
  const ext = path.extname(filePath).toLowerCase();
  if (PYTHON_EXTENSIONS.has(ext)) return extractPythonSymbols(code);
  if (ext && !SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      success: false,
      symbols: [],
      error: `get_file_symbols supports JS/TS/JSX/TSX and Python files, not ${ext} files.`
    };
  }
  return extractJavaScriptSymbols(code);
}

module.exports = { extractSymbols, extractJavaScriptSymbols, extractPythonSymbols };
