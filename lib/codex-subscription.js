'use strict';

// Official local app-server JSONL transport. Authentication stays in Codex's store.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

function findCodexExecutable(env = process.env) {
  const candidates = [];
  if (env.ORION_CODEX_PATH) candidates.push(env.ORION_CODEX_PATH);
  if (env.LOCALAPPDATA) {
    const desktopBin = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const desktopExecutables = fs.readdirSync(desktopBin, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(desktopBin, entry.name, 'codex.exe'))
        .filter(candidate => fs.existsSync(candidate))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      candidates.push(...desktopExecutables);
    } catch (_) { /* The standalone CLI is supported when the desktop app is not installed. */ }
  }
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  for (const dir of dirs) {
    candidates.push(path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex'));
    for (const arch of ['x64', 'arm64']) {
      candidates.push(path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', `${arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`, 'bin', 'codex.exe'));
    }
  }
  const found = candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch (_) { return false; }
  });
  if (!found) throw new Error('Codex CLI was not found. Install the official Codex CLI or set ORION_CODEX_PATH to its executable, then refresh ChatGPT Subscription in Settings.');
  return found;
}

function abortError() {
  const error = new Error('Codex request stopped.');
  error.name = 'AbortError';
  return error;
}

class CodexSubscription extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawn = options.spawn || spawn;
    this.executable = options.executable;
    this.requestTimeoutMs = options.requestTimeoutMs || 30000;
    this.turnTimeoutMs = options.turnTimeoutMs || 180000;
    this.pending = new Map();
    this.turns = new Map();
    this.sequence = 0;
    this.child = null;
    this.starting = null;
    this.models = [];
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = this._start().catch(error => {
      this.close(error);
      throw error;
    });
    return this.starting;
  }

  async _start() {
    const env = { ...process.env };
    // Never fall through to API billing even when Orion's parent process has an API key.
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    const child = this.spawn(this.executable || findCodexExecutable(env), [
      'app-server', '--listen', 'stdio://',
      '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
      '-c', 'web_search="disabled"', '-c', 'features.shell_tool=false',
      '-c', 'features.multi_agent=false', '-c', 'features.code_mode=false'
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env, cwd: os.tmpdir() });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); } catch (_) { this.close(new Error('Codex returned an invalid protocol message.')); }
      }
      if (buffer.length > 16 * 1024 * 1024) this.close(new Error('Codex protocol message exceeded the size limit.'));
    });
    // Drain diagnostics, but never relay raw server logs or credential-bearing URLs to the UI.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.close(new Error('Codex connection closed.')));
    child.once('error', error => this.close(new Error(`Could not start Codex: ${error.message}`)));
    child.once('exit', code => {
      if (this.child === child) this.close(new Error(`Codex app-server exited (${code}). Refresh the provider to reconnect.`));
    });
    await this.rpc('initialize', {
      clientInfo: { name: 'orion_ai', title: 'Orion AI', version: '2.0.0' },
      capabilities: { experimentalApi: true }
    });
    this.send({ method: 'initialized', params: {} });
  }

  send(message) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Codex is disconnected.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  rpc(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex ${method} timed out. Please retry or refresh the connection.`);
        reject(error);
        // A late turn/start response could otherwise leave a billable turn running invisibly.
        this.close(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }

  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`Codex: ${message.error.message || 'Request failed'}`));
      else pending.resolve(message.result);
      return;
    }
    const params = message.params || {};
    if (message.id !== undefined) {
      // Codex is a model provider here. Only Orion's tool loop owns local execution/approvals.
      this.send({ id: message.id, error: { code: -32601, message: 'This client delegates all tools and user interaction to Orion.' } });
      const turn = this.turns.get(params.threadId);
      if (turn) turn.fail(new Error('Codex requested a native action outside the Orion provider interface.'));
      return;
    }
    if (message.method.startsWith('account/')) this.emit('account', { method: message.method, ...params });
    const turn = this.turns.get(params.threadId);
    if (!turn) return;
    if (message.method === 'turn/started') turn.id = params.turn.id;
    if (message.method === 'item/agentMessage/delta') {
      const id = params.itemId || 'response';
      turn.text.set(id, (turn.text.get(id) || '') + (params.delta || ''));
      turn.onDelta({ text: [...turn.text.values()].join('\n'), delta: params.delta || '', threadId: params.threadId });
    }
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage') {
      turn.text.set(params.item.id, params.item.text || '');
      if (params.item.phase === 'final_answer') turn.finalText = params.item.text;
    }
    if (message.method === 'error' && params.willRetry !== true) {
      turn.fail(new Error(`Codex: ${params.error?.message || 'Response failed'}`));
    }
    if (message.method === 'turn/completed') {
      const result = params.turn;
      if (result.status === 'interrupted') turn.fail(abortError());
      else if (result.status !== 'completed') turn.fail(new Error(`Codex: ${result.error?.message || result.status || 'Response failed'}`));
      else {
        const finalItems = (result.items || []).filter(item => item.type === 'agentMessage' && item.phase === 'final_answer');
        const text = finalItems.length ? finalItems.map(item => item.text).join('\n') : turn.finalText || [...turn.text.values()].join('\n');
        if (!text.trim()) turn.fail(new Error('Codex finished without a response.'));
        else turn.finish({ text, threadId: params.threadId });
      }
    }
  }

  async account() {
    await this.start();
    return this.rpc('account/read', { refreshToken: false });
  }

  async status() {
    const { account } = await this.account();
    if (account?.type !== 'chatgpt') return { connected: false, account: null, models: [], error: 'Sign in with ChatGPT to use your Codex subscription.' };
    const models = [];
    let cursor = null;
    const cursors = new Set();
    do {
      const page = await this.rpc('model/list', { cursor, limit: 100 });
      models.push(...page.data.filter(model => !model.hidden));
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Codex model discovery returned a repeated page.');
      cursors.add(cursor);
    } while (cursor);
    this.models = models;
    let quota = null;
    let quotaError = '';
    try { quota = await this.rpc('account/rateLimits/read'); } catch (error) { quotaError = error.message; }
    return { connected: true, account, models, quota, quotaError };
  }

  async login() {
    await this.start();
    return this.rpc('account/login/start', { type: 'chatgpt' });
  }

  complete(input, options = {}) {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const abort = () => reject(abortError());
      signal?.addEventListener('abort', abort, { once: true });
      this._complete(input, options).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
    });
  }

  async _complete(input, { signal, onDelta = () => {} } = {}) {
    if (signal?.aborted) throw abortError();
    const { account } = await this.account();
    if (account?.type !== 'chatgpt') throw new Error('ChatGPT Subscription requires a Codex ChatGPT login. Sign in from Orion Settings.');
    if (!this.models.length) await this.status();
    const model = this.models.find(candidate => candidate.model === input.model || candidate.id === input.model);
    if (!model) throw new Error('That model is not available from your Codex account. Refresh the model list in Settings.');
    if (input.input.some(item => item.type === 'image') && !model.inputModalities?.includes('image')) {
      throw new Error('This Codex model does not accept images. Select an image-capable model from ChatGPT Subscription.');
    }
    const supported = model.supportedReasoningEfforts.map(option => option.reasoningEffort);
    let effort = input.effort;
    if (effort && !supported.includes(effort)) {
      if (input.forcedEffort) throw new Error(`This Codex model does not support ${effort} reasoning. Choose ${supported.join(', ')} or Auto.`);
      effort = model.defaultReasoningEffort;
    }
    if (signal?.aborted) throw abortError();
    // Orion is the history authority. Ephemeral threads receive its complete current context,
    // including compaction and tool results, and cannot leak history across Compare lanes.
    const { thread } = await this.rpc('thread/start', {
      model: model.model, modelProvider: 'openai', ephemeral: true,
      baseInstructions: input.instructions, developerInstructions: 'Respond using the Orion protocol supplied in your instructions. Orion executes all actions. Do not invoke native Codex tools or inspect the local environment.',
      approvalPolicy: 'never', sandbox: 'read-only', environments: [],
      config: { web_search: 'disabled', project_doc_max_bytes: 0 },
      allowProviderModelFallback: false
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.turns.delete(thread.id);
        this.rpc('thread/unsubscribe', { threadId: thread.id }).catch(() => {});
      };
      const finish = result => { if (!settled) { settled = true; cleanup(); resolve(result); } };
      const fail = error => { if (!settled) { settled = true; cleanup(); reject(error); } };
      const interrupt = () => {
        if (turn.id) this.rpc('turn/interrupt', { threadId: thread.id, turnId: turn.id }).catch(() => {});
      };
      const onAbort = () => { interrupt(); fail(abortError()); };
      const turn = { id: null, text: new Map(), onDelta, finish, fail };
      this.turns.set(thread.id, turn);
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { interrupt(); fail(new Error('Codex response timed out. The request was stopped; please retry.')); }, Math.min(Number(input.timeoutMs) || this.turnTimeoutMs, this.turnTimeoutMs));
      if (signal?.aborted) { onAbort(); return; }
      this.rpc('turn/start', {
        threadId: thread.id, model: model.model,
        input: input.input, ...(effort ? { effort } : {}),
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
        environments: []
      }).then(result => {
        turn.id = result.turn.id;
        if (signal?.aborted || settled) interrupt();
      }, fail);
    });
  }

  close(error = new Error('Codex connection closed.')) {
    const child = this.child;
    this.child = null;
    this.starting = null;
    this.models = [];
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const turn of [...this.turns.values()]) turn.fail(error);
    if (child && !child.killed) child.kill();
  }
}

module.exports = { CodexSubscription, findCodexExecutable };
