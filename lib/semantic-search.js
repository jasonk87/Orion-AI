const fs = require('fs');
const path = require('path');
const { collectJsFiles } = require('./symbol-index');

const CACHE_VERSION = 1;

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
  const isLocal = config.modelName && (config.modelName.includes('llama') || config.modelName.includes('deepseek') || config.modelName.includes('mistral'));
  
  if (isLocal) {
    // Ollama embeddings
    const model = config.embeddingModel || 'nomic-embed-text';
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    });
    if (!res.ok) throw new Error('Ollama embedding failed: ' + res.statusText);
    const data = await res.json();
    return data.embedding;
  } else {
    // Gemini embeddings
    if (!config.geminiApiKey) throw new Error('Gemini API key missing for semantic search');
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
  const chunks = [];
  const chunkSize = 50;
  const overlap = 10;
  for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
    const chunkLines = lines.slice(i, i + chunkSize);
    if (chunkLines.length === 0) break;
    const chunkText = chunkLines.join('\n').trim();
    if (chunkText.length > 20) {
      chunks.push({
        text: `File: ${filePath}\nLines ${i + 1}-${i + chunkLines.length}\n${chunkText}`,
        startLine: i + 1,
        endLine: i + chunkLines.length
      });
    }
  }
  return chunks;
}

async function buildOrUpdateIndex(workspacePath, config) {
  const files = collectJsFiles(workspacePath);
  const cachedFiles = readCache(workspacePath);
  const nextCache = {};
  
  // Note: in a production app with huge codebases, this blocks.
  // For this context, we iterate sequentially to avoid rate limits.
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
        for (const chunk of chunks) {
          try {
            const vector = await generateEmbedding(chunk.text, config);
            chunkData.push({ ...chunk, vector });
          } catch (e) {
            console.error(`Failed to embed chunk in ${relPath}: ${e.message}`);
          }
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

async function semanticSearch(query, workspacePath, config, topK = 5) {
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

module.exports = { semanticSearch };
