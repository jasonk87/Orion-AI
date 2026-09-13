'use strict';

// Discovery stays in the main process: it must not depend on renderer CORS permissions.
// These read-only endpoints list installed models; they never pull or load model weights.
function createOllamaDiscovery({ fetchImpl = (...args) => fetch(...args), timeoutMs = 5000 } = {}) {
  let inFlight = null;
  const details = new Map();
  async function discover() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const request = async (endpoint, body) => {
      const response = await fetchImpl(`http://127.0.0.1:11434/api/${endpoint}`, {
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Ollama ${endpoint} returned HTTP ${response.status}`);
      return response.json();
    };
    try {
      const tags = await request('tags');
      if (!Array.isArray(tags.models)) throw new Error('Ollama returned an invalid installed-model list.');
      const installed = [...new Map(tags.models.filter(model => typeof model.name === 'string' && model.name.trim())
        .map(model => [model.name, model])).values()];
      const models = [];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, installed.length) }, async () => {
        while (index < installed.length && !controller.signal.aborted) {
          const model = installed[index++];
          const cached = details.get(model.name);
          let capabilities = model.digest && cached?.digest === model.digest ? cached.capabilities : null;
          if (!capabilities) {
            try {
              const info = await request('show', { model: model.name });
              capabilities = Array.isArray(info.capabilities) ? info.capabilities.filter(value => typeof value === 'string') : null;
              if (capabilities) details.set(model.name, { digest: model.digest, capabilities });
            } catch (_) { /* A failed capability lookup must not hide an installed model. */ }
          }
          models.push({ name: model.name, value: `ollama:${model.name}`, capabilities });
        }
      }));
      // A partial timeout must not make the unqueried installed models disappear.
      for (const model of installed) if (!models.some(item => item.name === model.name)) {
        models.push({ name: model.name, value: `ollama:${model.name}`, capabilities: null });
      }
      for (const name of details.keys()) if (!installed.some(model => model.name === name)) details.delete(name);
      models.sort((a, b) => a.name.localeCompare(b.name));
      return { success: true, connected: true, models };
    } catch (error) {
      return { success: false, connected: false, models: [], error: controller.signal.aborted
        ? 'Ollama discovery timed out. Start Ollama; Orion will retry automatically.'
        : `Ollama is unavailable: ${error.message}. Orion will retry automatically.` };
    } finally { clearTimeout(timer); }
  }
  return () => {
    if (!inFlight) inFlight = discover().finally(() => { inFlight = null; });
    return inFlight;
  };
}

function registerHandlers(ipcMain) {
  const discover = createOllamaDiscovery();
  ipcMain.handle('ollama:models', () => discover());
}

module.exports = { createOllamaDiscovery, registerHandlers };
