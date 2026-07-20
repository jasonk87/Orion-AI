const test = require('tape');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

// Regression: index.html loads renderer.js and agent.js (and the orchestration contract
// scripts) as plain <script> tags, which all share ONE browser global scope. renderer.js and
// agent.js both declared `const WorkspaceResolution`/`const TaskOrchestration`, so the second
// script died at parse time with "Identifier 'WorkspaceResolution' has already been declared"
// and window.runAgentLoop was never defined — the desktop queued messages forever and the
// phone companion failed with "window.runAgentLoop is not a function". Node's module loader
// gives every test file its own scope, so only the packaged app ever hit this. This test
// statically forbids duplicate top-level const/let/class declarations across the scripts
// index.html actually loads.

const repoRoot = path.join(__dirname, '..');

function appScriptsFromIndexHtml() {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const scripts = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!m[1].startsWith('node_modules/')) scripts.push(m[1]);
  }
  return scripts;
}

function topLevelLexicalDeclarations(file) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const ast = parser.parse(source, { sourceType: 'script' });
  const names = [];
  for (const node of ast.program.body) {
    if (node.type === 'VariableDeclaration' && (node.kind === 'const' || node.kind === 'let')) {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') names.push(decl.id.name);
        else if (decl.id.type === 'ObjectPattern') {
          for (const prop of decl.id.properties) {
            if (prop.value && prop.value.type === 'Identifier') names.push(prop.value.name);
          }
        }
      }
    } else if (node.type === 'ClassDeclaration' && node.id) {
      names.push(node.id.name);
    }
  }
  return names;
}

test('browser-loaded scripts do not collide in the shared global scope', (t) => {
  const scripts = appScriptsFromIndexHtml();
  t.ok(scripts.includes('renderer.js') && scripts.includes('agent.js'), 'index.html loads the app scripts this test guards');

  const declaredIn = new Map(); // identifier -> first file
  for (const file of scripts) {
    for (const name of topLevelLexicalDeclarations(file)) {
      if (declaredIn.has(name)) {
        t.fail(`top-level '${name}' is declared in both ${declaredIn.get(name)} and ${file}; the second <script> will throw "already been declared" and never run`);
      } else {
        declaredIn.set(name, file);
      }
    }
  }
  t.ok(declaredIn.size > 0, 'top-level declarations were actually collected');
  t.end();
});
