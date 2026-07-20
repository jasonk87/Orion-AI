// Regression guard for the unescaped-backtick failure class (2026-07-20): markdown-style
// backticks pasted into the prose of a big prompt template literal do NOT cause a syntax error
// when they appear in even numbers — the file parses as alternating template chunks and garbage
// expressions (e.g. `.orion / rules.md`) and instead throws a ReferenceError at load time,
// killing the entire script in the packaged app while `node --check` stays green.
//
// The AST makes that state visible: a healthy prompt const is a single TemplateLiteral (or
// StringLiteral) initializer, while the mangled version parses as a BinaryExpression tree with
// TemplateLiterals as operands. No evaluation needed, so interpolations stay safe to add.
const test = require('tape');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const SCANNED_FILES = ['agent.js', 'renderer.js'];

function initContainsTemplateLiteral(node) {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'TemplateLiteral') return true;
  if (node.type === 'BinaryExpression') {
    return initContainsTemplateLiteral(node.left) || initContainsTemplateLiteral(node.right);
  }
  if (node.type === 'MemberExpression') return initContainsTemplateLiteral(node.object);
  return false;
}

function scanTopLevelConsts(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const ast = parser.parse(code, { sourceType: 'script' });
  const promptConsts = [];
  const mangledInits = [];
  for (const statement of ast.program.body) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declarator of statement.declarations) {
      if (!declarator.id || declarator.id.type !== 'Identifier' || !declarator.init) continue;
      const name = declarator.id.name;
      if (/INSTRUCTION|PROMPT/.test(name)) promptConsts.push({ name, initType: declarator.init.type });
      if (declarator.init.type === 'BinaryExpression' && initContainsTemplateLiteral(declarator.init)) {
        mangledInits.push(name);
      }
    }
  }
  return { promptConsts, mangledInits };
}

test('top-level prompt literals survive as single template strings', (t) => {
  for (const file of SCANNED_FILES) {
    const { promptConsts, mangledInits } = scanTopLevelConsts(file);
    t.deepEqual(mangledInits, [],
      `${file}: no top-level const parses as a template-literal expression soup (unescaped backticks)`);
    for (const item of promptConsts) {
      t.ok(item.initType === 'TemplateLiteral' || item.initType === 'StringLiteral',
        `${file}: ${item.name} is a plain string/template literal (got ${item.initType})`);
    }
  }
  const agentPrompts = scanTopLevelConsts('agent.js').promptConsts.map(item => item.name);
  t.ok(agentPrompts.includes('SYSTEM_INSTRUCTION') && agentPrompts.includes('DISPATCHER_INSTRUCTION'),
    'the scan still finds the two known agent.js prompt constants (guard is not vacuous)');
  t.end();
});
