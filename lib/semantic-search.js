const fs = require('fs');
const path = require('path');
const { extractSymbols } = require('./ast-parser');

const CACHE_VERSION = 2;
const SEARCHABLE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.md', '.html', '.css', '.json', '.go', '.rs', '.java', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.orion', '.claude']);
const AST_CHUNK_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py']);

function collectSearchableFiles(dirPath) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const fullPath = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(fullPath); } catch (_) { continue; }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (SEARCHABLE_EXTS.has(path.extname(name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  walk(dirPath);
  return results;
}

function cachePath(workspacePath) {
  return path.join(workspacePath, '.orion', 'semantic-index-cache.json');
}

function readCache(workspacePath) {
  try {
    const raw = fs.readFileSync(cachePath(workspacePath), 'utf8');
    const data = JSON.parse(raw);
    if (data && data.version === CACHE_VERSION && data.files) {
      return data.files;
    }
  } catch (_) {}
  return {};
}

function writeCache(workspacePath, files) {
  try {
    const file = cachePath(workspacePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files }), 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.writeFileSync(file, fs.readFileSync(tmp, 'utf8'), 'utf8');
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  } catch (_) {}
}

async function generateEmbedding(text, config) {
  // DeepSeek is a remote API — it does not run through Ollama and has no embeddings endpoint.
  // Only true local Ollama models (llama, mistral, etc.) should route to localhost:11434.
  const isOllama = config.embeddingBackend === 'ollama' ||
    (config.modelName && (config.modelName.includes('llama') || config.modelName.includes('mistral')) &&
     !config.modelName.includes('deepseek'));

  if (isOllama) {
    // Ollama embeddings (local models only)
    const model = config.embeddingModel || 'nomic-embed-text';
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Ollama embedding failed: The model '${model}' was not found. Please run 'ollama pull ${model}' in your terminal to download it.`);
      }
      throw new Error('Ollama embedding failed: ' + res.statusText);
    }
    const data = await res.json();
    return data.embedding;
  } else {
    // Gemini embeddings — used for all remote providers (Gemini, DeepSeek, Anthropic).
    // DeepSeek has no embeddings API; Gemini text-embedding-004 is the shared backend.
    if (!config.geminiApiKey) {
      throw new Error(
        'Semantic search requires a Gemini API key for embeddings (even when using DeepSeek for chat). ' +
        'Add your Gemini key in Settings, or set embeddingBackend: "ollama" to use a local model.'
      );
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${config.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] }
      })
    });
    if (!res.ok) throw new Error('Gemini embedding failed: ' + await res.text());
    const data = await res.json();
    return data.embedding.values;
  }
}

function chunkText(text, filePath) {
  const lines = text.split(/\r?\n/);
  const astChunks = chunkTextBySymbols(text, filePath, lines);
  if (astChunks.length > 0) {
    return astChunks.concat(chunkUncoveredLineRanges(lines, filePath, astChunks));
  }

  return chunkLineRange(lines, filePath, 1, lines.length);
}

function chunkTextBySymbols(text, filePath, lines = text.split(/\r?\n/)) {
  if (!AST_CHUNK_EXTS.has(path.extname(filePath).toLowerCase())) return [];

  const parsed = extractSymbols(text, { filePath, path: filePath });
  if (!parsed || !parsed.success || !Array.isArray(parsed.symbols) || parsed.symbols.length === 0) {
    return [];
  }

  const chunks = [];
  const seenRanges = new Set();
  const sortedSymbols = parsed.symbols
    .filter(symbol => Number.isInteger(symbol.startLine) && Number.isInteger(symbol.endLine))
    .filter(symbol => symbol.startLine > 0 && symbol.endLine >= symbol.startLine && symbol.startLine <= lines.length)
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  for (const symbol of sortedSymbols) {
    const startLine = Math.max(1, symbol.startLine);
    const endLine = Math.min(lines.length, symbol.endLine);
    const rangeKey = `${startLine}:${endLine}`;
    if (seenRanges.has(rangeKey)) continue;
    seenRanges.add(rangeKey);

    const body = lines.slice(startLine - 1, endLine).join('\n').trim();
    if (body.length <= 20) continue;

    const qualifiedName = symbol.path ? `${symbol.path}.${symbol.name}` : symbol.name;
    chunks.push({
      text: [
        `File: ${filePath}`,
        `Symbol: ${qualifiedName} (${symbol.type || 'Symbol'})`,
        `Lines ${startLine}-${endLine}`,
        symbol.signature ? `Signature: ${symbol.signature}` : null,
        body
      ].filter(Boolean).join('\n'),
      startLine,
      endLine,
      symbolName: symbol.name,
      symbolType: symbol.type || 'Symbol',
      symbolPath: symbol.path || ''
    });
  }

  return chunks;
}

function chunkUncoveredLineRanges(lines, filePath, coveredChunks) {
  const covered = new Array(lines.length).fill(false);
  for (const chunk of coveredChunks) {
    const start = Math.max(0, chunk.startLine - 1);
    const end = Math.min(lines.length - 1, chunk.endLine - 1);
    for (let i = start; i <= end; i++) covered[i] = true;
  }

  const chunks = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && covered[index]) index++;
    const start = index;
    while (index < lines.length && !covered[index]) index++;
    const end = index - 1;
    if (end >= start && lines.slice(start, end + 1).join('\n').trim().length > 20) {
      chunks.push(...chunkLineRange(lines, filePath, start + 1, end + 1));
    }
  }
  return chunks;
}

function chunkLineRange(lines, filePath, startLine, endLine) {
  const chunks = [];
  const chunkSize = 50;
  const overlap = 10;
  const step = chunkSize - overlap;
  for (let lineNo = startLine; lineNo <= endLine; lineNo += step) {
    const sliceEnd = Math.min(endLine, lineNo + chunkSize - 1);
    const chunkLines = lines.slice(lineNo - 1, sliceEnd);
    if (chunkLines.length === 0) break;
    const lineChunkText = chunkLines.join('\n').trim();
    if (lineChunkText.length > 20) {
      chunks.push({
        text: `File: ${filePath}\nLines ${lineNo}-${sliceEnd}\n${lineChunkText}`,
        startLine: lineNo,
        endLine: sliceEnd
      });
    }
    if (sliceEnd >= endLine) break;
  }
  return chunks;
}

async function buildOrUpdateIndex(workspacePath, config) {
  const files = collectSearchableFiles(workspacePath);
  const cachedFiles = readCache(workspacePath);
  const nextCache = {};
  
  // Batch processing to avoid rate limits while remaining fast
  for (const fullPath of files) {
    const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
    try {
      const stat = fs.statSync(fullPath);
      const cached = cachedFiles[relPath];
      
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        nextCache[relPath] = cached;
      } else {
        const content = fs.readFileSync(fullPath, 'utf8');
        const chunks = chunkText(content, relPath);
        
        const chunkData = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
          const batch = chunks.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (chunk) => {
            try {
              const vector = await generateEmbedding(chunk.text, config);
              chunkData.push({ ...chunk, vector });
            } catch (e) {
              console.error(`Failed to embed chunk in ${relPath}: ${e.message}`);
            }
          }));
        }
        
        if (chunkData.length > 0) {
          nextCache[relPath] = {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            chunks: chunkData
          };
        }
      }
    } catch (_) {}
  }
  
  writeCache(workspacePath, nextCache);
  return nextCache;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function semanticSearch(query, workspacePath, config, topK = 10) {
  const queryVector = await generateEmbedding(query, config);
  const index = await buildOrUpdateIndex(workspacePath, config);
  
  const results = [];
  for (const relPath in index) {
    for (const chunk of index[relPath].chunks) {
      const score = cosineSimilarity(queryVector, chunk.vector);
      results.push({
        file: relPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score,
        snippet: chunk.text
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK).map(r => ({
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    score: r.score.toFixed(3),
    snippet: r.snippet
  }));
}

module.exports = { semanticSearch, chunkText, chunkTextBySymbols, chunkLineRange };
