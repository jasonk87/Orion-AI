const parser = require('@babel/parser');

function extractSymbols(code) {
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

module.exports = { extractSymbols };
