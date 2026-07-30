const test = require('tape');
const { chunkText, chunkTextBySymbols } = require('../lib/semantic-search');

test('semantic chunking keeps large JavaScript functions as symbol chunks', (t) => {
  const body = Array.from({ length: 80 }, (_, index) => `  const value${index} = ${index};`);
  const code = [
    "import helper from './helper';",
    'const moduleSetting = true;',
    '',
    'function bigFeature() {',
    ...body,
    '  return value79;',
    '}',
    '',
    'const smallHelper = () => {',
    "  return 'ok';",
    '};'
  ].join('\n');

  const chunks = chunkText(code, 'src/example.js');
  const bigFeature = chunks.find(chunk => chunk.symbolName === 'bigFeature');
  const topLevelChunk = chunks.find(chunk => !chunk.symbolName && chunk.startLine === 1);

  t.ok(bigFeature, 'large function is indexed as a symbol chunk');
  t.equal(bigFeature.startLine, 4, 'symbol chunk starts at the function declaration');
  t.ok(bigFeature.endLine > 80, 'symbol chunk spans the full function instead of stopping at a 50-line boundary');
  t.ok(bigFeature.text.includes('Symbol: bigFeature (Function)'), 'symbol metadata is embedded with the chunk');
  t.ok(bigFeature.text.includes('value79'), 'symbol chunk includes the end of the large function body');
  t.ok(topLevelChunk && topLevelChunk.text.includes('moduleSetting'), 'top-level non-symbol code is still indexed');
  t.notOk(
    chunks.some(chunk => !chunk.symbolName && chunk.startLine === 4 && chunk.endLine === 53),
    'large function body is not duplicated as an arbitrary fallback line chunk'
  );
  t.end();
});

test('semantic chunking extracts Python classes, methods, and functions', (t) => {
  const code = [
    'class Player:',
    '    def score(self):',
    '        return 1',
    '',
    'def make_player():',
    '    return Player()'
  ].join('\n');

  const chunks = chunkTextBySymbols(code, 'game/player.py');
  const classChunk = chunks.find(chunk => chunk.symbolName === 'Player');
  const methodChunk = chunks.find(chunk => chunk.symbolName === 'score');
  const functionChunk = chunks.find(chunk => chunk.symbolName === 'make_player');

  t.ok(classChunk && classChunk.symbolType === 'Class', 'class symbol chunk is returned');
  t.ok(methodChunk && methodChunk.symbolPath === 'Player', 'method chunk keeps its class path');
  t.ok(methodChunk.text.includes('Symbol: Player.score (Method)'), 'method chunk uses a qualified symbol name');
  t.ok(functionChunk && functionChunk.symbolType === 'Function', 'top-level function symbol chunk is returned');
  t.end();
});

test('semantic chunking falls back to overlapping line chunks for non-code files', (t) => {
  const markdown = Array.from({ length: 70 }, (_, index) => `Line ${index + 1}: project note`).join('\n');
  const chunks = chunkText(markdown, 'README.md');

  t.equal(chunks.length, 2, '70-line markdown file uses two overlapping fallback chunks');
  t.equal(chunks[0].startLine, 1, 'first fallback chunk starts at line 1');
  t.equal(chunks[0].endLine, 50, 'first fallback chunk keeps the original 50-line size');
  t.equal(chunks[1].startLine, 41, 'second fallback chunk keeps the original 10-line overlap');
  t.equal(chunks[1].endLine, 70, 'second fallback chunk ends at the file end');
  t.end();
});
