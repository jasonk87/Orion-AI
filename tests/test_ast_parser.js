const test = require('tape');
const { extractSymbols } = require('../lib/ast-parser');

test('extractSymbols supports Python classes, methods, and functions', (t) => {
  const code = [
    'from dataclasses import dataclass',
    '',
    '@dataclass',
    'class Trait:',
    '    id: str',
    '',
    '    def label(self):',
    '        return self.id',
    '',
    'async def load_traits(path):',
    '    return []',
    '',
    'def main():',
    '    return load_traits("traits.json")'
  ].join('\n');

  const result = extractSymbols(code, { path: 'data/traits.py' });
  t.equal(result.success, true, 'Python extraction succeeds');

  const trait = result.symbols.find(symbol => symbol.name === 'Trait');
  t.ok(trait, 'class symbol is returned');
  t.equal(trait.type, 'Class', 'class symbol has Class type');
  t.equal(trait.startLine, 3, 'decorated class starts at decorator line');

  const label = result.symbols.find(symbol => symbol.name === 'label');
  t.ok(label, 'method symbol is returned');
  t.equal(label.type, 'Method', 'class member def is a Method');
  t.equal(label.path, 'Trait', 'method path identifies parent class');

  const loadTraits = result.symbols.find(symbol => symbol.name === 'load_traits');
  t.ok(loadTraits, 'async module function is returned');
  t.equal(loadTraits.type, 'Function', 'async module def is a Function');
  t.ok(loadTraits.signature.startsWith('async def load_traits'), 'async function signature is preserved');

  const main = result.symbols.find(symbol => symbol.name === 'main');
  t.ok(main, 'plain module function is returned');
  t.equal(main.type, 'Function', 'plain module def is a Function');
  t.end();
});

test('extractSymbols keeps JavaScript/TypeScript parsing behavior', (t) => {
  const code = [
    'export class Runner {',
    '  run() {',
    '    return true;',
    '  }',
    '}',
    'const helper = () => true;'
  ].join('\n');

  const result = extractSymbols(code, { path: 'src/runner.ts' });
  t.equal(result.success, true, 'JS/TS extraction succeeds');
  t.ok(result.symbols.some(symbol => symbol.name === 'Runner' && symbol.type === 'Class'), 'class is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'run' && symbol.type === 'Method'), 'method is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'helper' && symbol.type === 'Function'), 'arrow function is returned');
  t.end();
});

test('extractSymbols returns a clear error for unsupported file types', (t) => {
  const result = extractSymbols('<root></root>', { path: 'layout.xml' });
  t.equal(result.success, false, 'unsupported extraction fails cleanly');
  t.deepEqual(result.symbols, [], 'unsupported extraction returns an empty symbols list');
  t.equal(
    result.error,
    'get_file_symbols supports JS/TS/JSX/TSX and Python files, not .xml files.',
    'unsupported extraction explains the supported file types'
  );
  t.end();
});

test('extractSymbols supports TypeScript interfaces, types, enums, and default exports', (t) => {
  const code = [
    'export interface User {',
    '  id: string;',
    '  getName(): string;',
    '}',
    'export type ID = string;',
    'export enum Role { ADMIN, USER }',
    'export default function() { return true; }',
    'export const fn = () => false;'
  ].join('\n');

  const result = extractSymbols(code, { path: 'types.ts' });
  t.equal(result.success, true, 'TS extraction succeeds');
  
  t.ok(result.symbols.some(symbol => symbol.name === 'User' && symbol.type === 'Interface'), 'interface is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'getName' && symbol.type === 'MethodSignature'), 'method signature is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'ID' && symbol.type === 'TypeAlias'), 'type alias is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'Role' && symbol.type === 'Enum'), 'enum is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'default export (function)' && symbol.type === 'Function'), 'anonymous default export is returned');
  t.ok(result.symbols.some(symbol => symbol.name === 'fn' && symbol.type === 'Function'), 'exported const function is returned');
  
  t.end();
});
