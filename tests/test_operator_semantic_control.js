'use strict';

process.env.NODE_ENV = 'test';
global.window = global.window || {};
global.fetch = global.fetch || (async () => ({ ok: false }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('tape');
const favorites = require('../lib/chrome-favorites');
const computerUse = require('../lib/ipc-computer-use');
const shared = require('../lib/shared');
const agent = require('../agent');
const policy = require('../operator-execution-policy');
const { loadRenderer } = require('./helpers/renderer-harness');

function createChromeProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-chrome-profile-'));
  const profile = path.join(root, 'Default');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks bar',
        children: [
          { type: 'url', name: 'DeepSeek Platform', url: 'https://platform.deepseek.com/', date_added: '10' },
          { type: 'url', name: 'Orion Docs', url: 'https://example.com/orion', date_added: '11' }
        ]
      }
    }
  }));
  return root;
}

test('Chrome favorites resolve deterministic user-facing names without screen coordinates', t => {
  const root = createChromeProfile();
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));

  const exact = favorites.resolveChromeFavorite({ name: 'DeepSeek Platform' }, { userDataRoot: root });
  t.ok(exact.success, 'an exact saved title resolves');
  t.equal(exact.matchKind, 'exact');
  t.equal(exact.favorite.url, 'https://platform.deepseek.com/');

  const conversational = favorites.resolveChromeFavorite(
    { name: 'deepseek desktop platform' },
    { userDataRoot: root }
  );
  t.ok(conversational.success, 'an extra descriptive token does not force pixel navigation');
  t.equal(conversational.matchKind, 'token');
  t.equal(conversational.favorite.name, 'DeepSeek Platform');

  const missing = favorites.resolveChromeFavorite({ name: 'Definitely absent' }, { userDataRoot: root });
  t.equal(missing.notFound, true, 'a missing favorite is reported instead of opening a guess');
  t.end();
});

test('duplicate Chrome favorite names return bounded choices instead of opening arbitrarily', t => {
  const root = createChromeProfile();
  const bookmarkFile = path.join(root, 'Default', 'Bookmarks');
  const data = JSON.parse(fs.readFileSync(bookmarkFile, 'utf8'));
  data.roots.other = {
    type: 'folder',
    name: 'Other bookmarks',
    children: [{ type: 'url', name: 'DeepSeek Platform', url: 'https://example.com/other' }]
  };
  fs.writeFileSync(bookmarkFile, JSON.stringify(data));
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));

  const ambiguous = favorites.resolveChromeFavorite({ name: 'DeepSeek Platform' }, { userDataRoot: root });
  t.equal(ambiguous.ambiguous, true);
  t.equal(ambiguous.matches.length, 2);
  const narrowed = favorites.resolveChromeFavorite(
    { name: 'DeepSeek Platform', folder: 'Bookmarks bar' },
    { userDataRoot: root }
  );
  t.ok(narrowed.success, 'folder scope deterministically resolves the duplicate');
  t.equal(narrowed.favorite.folder, 'Bookmarks bar');
  t.end();
});

test('semantic Windows actions keep labels and favorite URLs out of PowerShell source', t => {
  const uiScript = computerUse.buildAccessibleUiActionScript({
    targetText: 'Favorites; Stop-Process *',
    appName: 'Google Chrome',
    matchMode: 'exact'
  });
  t.notOk(uiScript.includes('Favorites; Stop-Process *'), 'accessible label is encoded as data');

  const chromeScript = favorites.buildOpenChromeUrlScript('https://example.com/?q=%22;Stop-Process');
  t.notOk(chromeScript.includes('https://example.com/?q='), 'favorite URL is encoded as data');
  t.ok(chromeScript.includes("Start-Process -FilePath $chrome"), 'Chrome is launched directly rather than through the default browser');
  t.end();
});

test('accessible control and Chrome favorite IPC actions capture their resulting screens', async t => {
  const handlers = {};
  const calls = [];
  const oldWindow = shared.mainWindow;
  shared.mainWindow = {
    isDestroyed: () => false,
    hide: () => calls.push('hide'),
    showInactive: () => calls.push('showInactive')
  };
  t.teardown(() => { shared.mainWindow = oldWindow; });
  computerUse.registerHandlers({ handle: (name, handler) => { handlers[name] = handler; } }, {
    runUiAction: async input => ({ success: true, method: 'invoke', name: input.targetText }),
    resolveChromeFavorite: async input => ({
      success: true,
      matchKind: 'exact',
      favorite: { name: input.name, folder: 'Bookmarks bar', profile: 'Default', url: 'https://example.com/' }
    }),
    openFavorite: async favorite => ({ success: true, method: 'chrome-new-tab', url: favorite.url }),
    captureDesktopScreenshot: async (workspace, destination, prefix, options) => {
      calls.push(`capture:${prefix}:${options.conversationId}`);
      return {
        rel: `orion-artifact://${options.conversationId}/screenshots/${prefix}.png`,
        png: Buffer.from('png'),
        size: { width: 1920, height: 1080 },
        artifactPath: `C:\\artifacts\\${prefix}.png`,
        artifactRelativePath: `screenshots/${prefix}.png`
      };
    }
  });

  const clicked = await handlers['click-accessible-ui'](null, {
    targetText: 'Favorites',
    appName: 'Google Chrome',
    settleMs: 0,
    conversationId: 'operator-1'
  });
  t.ok(clicked.success);
  t.equal(clicked.path, 'orion-artifact://operator-1/screenshots/accessible-ui.png');

  const opened = await handlers['open-chrome-favorite'](null, {
    name: 'DeepSeek Platform',
    settleMs: 0,
    conversationId: 'operator-1'
  });
  t.ok(opened.success);
  t.equal(opened.favorite.name, 'DeepSeek Platform');
  t.equal(opened.path, 'orion-artifact://operator-1/screenshots/chrome-favorite.png');
  t.deepEqual(calls, [
    'hide', 'capture:accessible-ui:operator-1', 'showInactive',
    'hide', 'capture:chrome-favorite:operator-1', 'showInactive'
  ]);
  t.end();
});

test('Operator alone receives semantic desktop controls and they require observed screen state', async t => {
  agent.__setActiveConversationModeForTest('operator');
  const operatorTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  agent.__setActiveConversationModeForTest('coder');
  const coderTools = agent.buildAgentToolDeclarations().map(tool => tool.name);
  t.ok(operatorTools.includes('click_ui_element'));
  t.ok(operatorTools.includes('open_chrome_favorite'));
  t.notOk(coderTools.includes('click_ui_element'));
  t.notOk(coderTools.includes('open_chrome_favorite'));

  const oldApi = global.window.api;
  let favoriteCalls = 0;
  global.window.api = {
    openChromeFavorite: async () => {
      favoriteCalls += 1;
      return { success: true };
    }
  };
  const blocked = await agent.executeTool('open_chrome_favorite', { name: 'DeepSeek Platform' }, '', {}, {
    id: 'operator-1', mode: 'operator'
  }, {
    lastDesktopSnapshot: { path: 'before.png', width: 100, height: 100, capturedAt: Date.now(), inspectedAt: 0 },
    operatorExecutionSurface: 'browser',
    operatorPolicyState: policy.createState('browser')
  });
  t.equal(blocked.success, false);
  t.match(String(blocked.error || ''), /capture and inspect the screen/i);
  t.equal(favoriteCalls, 0, 'favorite lookup never opens a page before observation');
  global.window.api = oldApi;
  agent.__setActiveConversationModeForTest('orion');
  t.end();
});

test('Dispatch steers the owned Operator conversation and acknowledges naturally', async t => {
  const taskOrchestration = require('../task-orchestration');
  const supervisorOrchestration = require('../supervisor-orchestration');
  const harness = loadRenderer({
    t,
    globals: {
      OrionTaskOrchestration: taskOrchestration,
      OrionSupervisorOrchestration: supervisorOrchestration
    },
    set: { activeConversationId: 'dispatch-1' },
    expose: ['handleSupervisorMessage', 'conversations', 'orchestrationTaskCache']
  });
  const dispatch = {
    id: 'dispatch-1',
    mode: 'orion',
    messages: [],
    launchedCoderConvId: 'operator-1',
    launchedCoderTaskId: 'task-operator-1',
    launchedTaskRole: 'operator'
  };
  const operator = { id: 'operator-1', mode: 'operator', messages: [] };
  harness.expose.conversations.push(dispatch, operator);
  harness.expose.orchestrationTaskCache.set('task-operator-1', {
    taskId: 'task-operator-1',
    status: 'active',
    origin: { conversationId: 'dispatch-1' },
    target: { conversationId: 'operator-1', mode: 'operator' }
  });

  const result = await harness.expose.handleSupervisorMessage(dispatch, 'I use Google Chrome for internet.', 'test-model', {
    semanticIntent: {
      intent: 'steer_active_task',
      target: 'active_owned_task',
      resolvedRequest: 'Use Google Chrome for the active browser task.',
      needsClarification: false
    }
  });
  t.ok(result.success && result.steered);
  t.equal(result.targetRole, 'operator');
  t.equal(harness.win.steeringQueue['operator-1'].length, 1);
  t.equal(harness.win.steeringQueue['operator-1'][0], 'Use Google Chrome for the active browser task.');
  const acknowledgement = dispatch.messages.find(message => message.source === 'supervisor-steering');
  t.ok(acknowledgement, 'Dispatch persists a real assistant acknowledgement');
  t.match(acknowledgement.text, /passed that update to Operator/i);
  t.notOk(dispatch.messages.some(message => /active Coder task/i.test(message.text || '')), 'Operator steering is never mislabeled as Coder');
  await harness.expose.handleSupervisorMessage(dispatch, 'The favorite is in my bookmarks bar.', 'test-model', {
    semanticIntent: {
      intent: 'steer_active_task',
      target: 'active_owned_task',
      resolvedRequest: 'The favorite is in the Chrome bookmarks bar.',
      needsClarification: false
    }
  });
  t.equal(
    dispatch.messages.filter(message => message.source === 'supervisor-steering').length,
    2,
    'each steering update receives its own acknowledgement'
  );
  t.end();
});
