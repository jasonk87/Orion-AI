'use strict';

// Google retired text-embedding-004 (its embedContent endpoint now returns 404), which silently
// killed semantic_search and search_embeddings app-wide and forced agent runs onto grep alone.
// The model id is resolved from config with a current default, so the next retirement is a
// settings change instead of a code fix.
const GEMINI_EMBEDDING_MODEL_DEFAULT = 'gemini-embedding-001';

function resolveGeminiEmbeddingModel(config = {}) {
  const configured = String(config.geminiEmbeddingModel || '').trim();
  return configured || GEMINI_EMBEDDING_MODEL_DEFAULT;
}

module.exports = { GEMINI_EMBEDDING_MODEL_DEFAULT, resolveGeminiEmbeddingModel };
