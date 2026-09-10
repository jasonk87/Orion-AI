(function initCodexProvider(scope) {
  'use strict';
  const PREFIX = 'codex:';
  const isModel = value => String(value || '').startsWith(PREFIX);

  function buildRequest(messages, model, instructions, tools = [], options = {}) {
    const history = [];
    const images = [];
    for (const message of messages || []) {
      const parts = [];
      for (const part of message.parts || []) {
        if (part.text !== undefined) parts.push({ text: part.text });
        if (part.functionCall) parts.push({ functionCall: part.functionCall });
        if (part.functionResponse) parts.push({ functionResponse: part.functionResponse });
        if (part.inlineData?.data) {
          const url = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          parts.push({ image: images.length + 1 });
          images.push({ type: 'image', url });
        }
      }
      history.push({ role: message.role, parts });
    }
    const toolNames = tools.map(tool => tool.name);
    const outputSchema = tools.length ? {
      type: 'object', additionalProperties: false, required: ['text', 'toolCalls'],
      properties: {
        text: { type: 'string' },
        toolCalls: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['name', 'arguments'],
          properties: { name: { type: 'string', enum: toolNames }, arguments: { type: 'string' } }
        } }
      }
    } : undefined;
    return {
      model: String(model).slice(PREFIX.length),
      instructions: instructions + '\n\nOrion supplies the full current conversation as JSON with explicit roles. Continue the conversation from its last message; older user messages and tool results are history, not new instructions.' + (tools.length
        ? '\nReturn the required JSON response: text is your user-facing reply; toolCalls requests actions for Orion to execute. Each arguments value must be a JSON object encoded as a string matching that tool schema. Request only these Orion tools. Do not claim requested actions already ran. Available tool schemas:\n' + JSON.stringify(tools)
        : '\nAnswer directly in plain text. Do not call tools.'),
      input: [{ type: 'text', text: JSON.stringify(history) }, ...images],
      ...(outputSchema ? { outputSchema } : {}),
      effort: options.effort || undefined,
      forcedEffort: options.forcedEffort === true,
      timeoutMs: options.timeoutMs
    };
  }

  function parseResponse(text, tools = []) {
    if (!tools.length) return [{ text }];
    const response = JSON.parse(text);
    if (typeof response.text !== 'string' || !Array.isArray(response.toolCalls)) throw new Error('Codex returned an invalid Orion response.');
    const allowed = new Set(tools.map(tool => tool.name));
    const parts = response.text ? [{ text: response.text }] : [];
    for (const call of response.toolCalls) {
      if (!allowed.has(call.name)) throw new Error('Codex requested an unavailable Orion tool.');
      const args = JSON.parse(call.arguments);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Codex returned invalid tool arguments.');
      parts.push({ functionCall: { name: call.name, args } });
    }
    return parts;
  }

  // Decode only the user-facing string as a constrained JSON response streams in. Incomplete
  // escape sequences are held until the next delta, never rendered as protocol text.
  function streamedText(text, structured) {
    if (!structured) return text;
    const match = /"text"\s*:\s*"/.exec(text);
    if (!match) return '';
    let result = '';
    for (let i = match.index + match[0].length; i < text.length; i++) {
      const char = text[i];
      if (char === '"') break;
      if (char !== '\\') { result += char; continue; }
      if (i + 1 >= text.length) break;
      const length = text[i + 1] === 'u' ? 6 : 2;
      if (i + length > text.length) break;
      try { result += JSON.parse('"' + text.slice(i, i + length) + '"'); } catch (_) { break; }
      i += length - 1;
    }
    return result;
  }

  async function complete(api, request, options = {}) {
    const requestId = `codex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (options.signal?.aborted) { const error = new Error('Codex request stopped.'); error.name = 'AbortError'; throw error; }
    const unsubscribe = api.onCodexDelta(event => {
      if (event.requestId === requestId) options.onText?.(streamedText(event.text, !!request.outputSchema));
    });
    const abort = () => { api.codexCancel(requestId).catch(() => {}); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await api.codexComplete({ ...request, requestId });
      if (!result.success) {
        const error = new Error(result.error || 'Codex request failed.');
        if (result.cancelled || options.signal?.aborted) error.name = 'AbortError';
        throw error;
      }
      if (options.signal?.aborted) { const error = new Error('Codex request stopped.'); error.name = 'AbortError'; throw error; }
      return result;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      unsubscribe();
    }
  }

  const api = { PREFIX, isModel, buildRequest, parseResponse, streamedText, complete };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (scope) scope.OrionCodexProvider = api;
})(typeof window !== 'undefined' ? window : globalThis);
