const test = require('tape');
const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').replace(/\r\n/g, '\n');
const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8').replace(/\r\n/g, '\n');
const companionHtml = fs.readFileSync(path.join(__dirname, '../lib/companion-html.js'), 'utf8').replace(/\r\n/g, '\n');
const ipcUiJs = fs.readFileSync(path.join(__dirname, '../lib/ipc-ui.js'), 'utf8').replace(/\r\n/g, '\n');

test('desktop uses the unified Orion command-center design system', (t) => {
  t.ok(styles.includes('--bg-primary: #090b12'), 'uses graphite Orion background');
  t.ok(styles.includes('--accent-color: #8273f4'), 'uses one violet-blue brand accent');
  t.ok(styles.includes('--success-color: #46d59b'), 'reserves emerald for success');
  t.ok(styles.includes('Segoe UI Variable'), 'uses a production system typography stack');
  t.ok(styles.includes('Orion command-center refinement'), 'loads the final desktop refinement layer');
  t.end();
});

test('desktop polish includes accessible focus and reduced-motion behavior', (t) => {
  t.ok(styles.includes('button:focus-visible'), 'provides keyboard focus rings');
  t.ok(styles.includes('@media (prefers-reduced-motion: reduce)'), 'respects reduced-motion preference');
  t.ok(styles.includes('@keyframes message-enter'), 'animates message entry');
  t.ok(styles.includes('@keyframes status-breathe'), 'animates live status intentionally');
  t.ok(html.includes('id="workspace-label" role="button" tabindex="0"'), 'workspace picker is keyboard focusable');
  t.ok(html.includes('id="operational-context-panel" aria-live="polite"'), 'Mission Control updates are announced');
  t.notOk(html.includes('id="nav-tasks"'), 'does not expose an unfinished Scheduled Tasks control');
  t.notOk(html.includes('id="btn-voice"'), 'does not expose an inert microphone control');
  t.notOk(html.includes('class="quick-tips"'), 'keeps the welcome state focused on the agent');
  t.ok(styles.includes('#btn-change-workspace,\n#btn-sync-files { display: none; }'), 'hides redundant workspace chrome');
  t.ok(html.includes('aria-label="Minimize window"'), 'window controls have accessible names');
  t.ok(fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').includes("el.chatInput.value += `${needsSpace ? ' ' : ''}@`;"), 'file mention button performs a real action');
  t.end();
});

test('phone companion finishes with the same dark theme and complete mission hierarchy', (t) => {
  const unifiedThemeIndex = companionHtml.indexOf('Unified Orion dark companion theme');
  const legacyLightIndex = companionHtml.indexOf('Codex-inspired mobile shell, Orion palette');
  const desktopAlignedIndex = companionHtml.indexOf('Desktop-aligned Orion mobile refinement');
  t.ok(unifiedThemeIndex > legacyLightIndex, 'unified dark theme wins the cascade');
  t.ok(desktopAlignedIndex > unifiedThemeIndex, 'desktop-aligned phone refinement is the final theme layer');
  t.ok(companionHtml.slice(unifiedThemeIndex).includes('color-scheme: dark'), 'phone declares dark controls');
  t.ok(companionHtml.slice(desktopAlignedIndex).includes('--bg: #090b12'), 'phone uses the desktop graphite background');
  t.ok(companionHtml.slice(desktopAlignedIndex).includes('--accent: #8273f4'), 'phone uses the desktop violet-blue accent');
  t.ok(companionHtml.slice(desktopAlignedIndex).includes('--success: #46d59b'), 'phone uses the desktop success color');
  t.ok(companionHtml.slice(unifiedThemeIndex).includes('#mission-context-card { grid-area: mission; }'), 'Mission Control has an explicit mobile layout area');
  t.ok(companionHtml.slice(unifiedThemeIndex).includes('@media (prefers-reduced-motion: reduce)'), 'phone respects reduced motion');
  t.ok(companionHtml.includes('button.send-button::before { content: "\\\\2191"'), 'phone send icon is encoding-safe');
  t.ok(companionHtml.includes('ui-polish-v13'), 'phone shell exposes the current UI build version');
  t.ok(fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8').includes("orion-phone-companion-v13"), 'phone service worker cache is bumped for the current UI build');
  t.end();
});

test('phone companion renders approvals and tool calls as first-class mobile UI', (t) => {
  t.ok(companionHtml.includes('id="plan-panel"'), 'phone includes the approval panel');
  t.ok(companionHtml.includes('Start Implementation'), 'phone keeps the approval start action');
  t.ok(companionHtml.includes('id="deny-plan"'), 'phone keeps deny action');
  t.ok(companionHtml.includes('id="revise-plan"'), 'phone keeps revise action');
  t.ok(companionHtml.includes('function renderToolCallRows'), 'phone renders tool calls with a dedicated renderer');
  t.ok(companionHtml.includes('function splitAssistantOutput'), 'phone splits appended walkthroughs out of assistant prose');
  t.ok(companionHtml.includes('function renderInlineMarkdown'), 'phone formats assistant Markdown instead of plain escaped text');
  t.ok(companionHtml.includes("html.push('<p>' + renderInlineMarkdown"), 'phone renders Markdown paragraphs');
  t.ok(companionHtml.includes("html.push('<h' + level"), 'phone renders Markdown headings');
  t.ok(companionHtml.includes("'<li>' + renderInlineMarkdown"), 'phone renders Markdown lists');
  t.ok(companionHtml.includes('.message .message-answer h2'), 'phone styles Markdown headings inside assistant messages');
  t.ok(companionHtml.includes('.message .message-answer ul'), 'phone styles Markdown lists inside assistant messages');
  t.ok(companionHtml.includes('function renderWorkWalkthroughBlock'), 'phone renders walkthroughs with structured UI');
  t.ok(companionHtml.includes('agent-logs-container'), 'phone reuses the desktop execution log container');
  t.ok(companionHtml.includes('tool-run-badge'), 'phone reuses the desktop tool-call badge');
  t.ok(companionHtml.includes('msg.logs || []'), 'phone renders per-message tool logs in chat bubbles');
  t.ok(renderer.includes("logs: replayMsg.role === 'assistant' ? replayLogs : []"), 'desktop state sends assistant logs to phone chat replay');
  t.notOk(companionHtml.includes('phone-tool-call'), 'phone does not use a separate phone-only tool-call UI');
  t.ok(companionHtml.includes('latest-output-card'), 'phone separates latest output from tool rows');
  t.ok(renderer.includes('latestToolCalls'), 'desktop state exposes tool calls to the phone companion');
  t.ok(renderer.includes('messageCount'), 'desktop state sends conversation message counts to phone');
  t.ok(renderer.includes('activityCount'), 'desktop state sends total activity counts to phone');
  const phoneStateSource = renderer.slice(
    renderer.indexOf('window.getPhoneCompanionState'),
    renderer.indexOf('window.deletePhoneCompanionConversation')
  );
  t.notOk(phoneStateSource.includes('isEmptyThinkingPlaceholder'), 'phone state does not drop saved assistant placeholders before mobile rendering');
  t.ok(companionHtml.includes('function conversationActivityLabel'), 'phone labels conversations by real message/task activity');
  t.notOk(companionHtml.includes("c.taskCount + ' items'"), 'phone no longer shows checklist count as generic items');
  t.ok(companionHtml.includes("history.replaceState(null, '', location.pathname || '/')"), 'phone cleans one-time pairing links after trust is saved');
  t.ok(companionHtml.includes("urlPairingCode && urlPairingCode !== pairingCode"), 'phone can recover from a stale saved pair URL');
  t.ok(renderer.includes('data-stable-phone-url'), 'desktop pairing card exposes the stable home-screen URL');
  t.ok(fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8').includes('stableUrl'), 'phone pairing payload includes a clean stable URL');
  t.ok(companionHtml.includes('function isAssistantThinkingPlaceholder'), 'phone treats Thinking as an internal placeholder');
  t.ok(companionHtml.includes('function shouldHideAssistantThinkingPlaceholder'), 'phone has a state-aware placeholder suppression rule');
  t.ok(companionHtml.includes('!!isRunning'), 'phone only hides empty Thinking placeholders while a run is active');
  t.ok(companionHtml.includes('function recoverIdleAssistantPlaceholder'), 'phone recovers stale saved placeholders after reload');
  t.ok(companionHtml.includes('Run ended before Orion saved an assistant response.'), 'phone shows a reload-safe fallback instead of blanking the agent side');
  t.notOk(companionHtml.includes('if (isThinkingOnly && !hasActivity) return'), 'phone no longer erases idle saved assistant placeholders');
  t.ok(companionHtml.includes("isThinkingOnly ? recoveredAnswer : split.answer"), 'phone keeps tool/log activity while hiding placeholder copy');
  t.ok(companionHtml.includes('function renderInlineTypingIndicator'), 'phone renders active dots inside the transcript');
  t.ok(companionHtml.includes('message assistant typing-assistant'), 'phone typing dots occupy the next assistant message position');
  t.ok(companionHtml.includes("const typingHtml = state.running ? renderInlineTypingIndicator() : ''"), 'phone appends dots after rendered messages while active');
  t.ok(companionHtml.includes("typingIndicatorEl.classList.remove('visible')"), 'phone does not show the old bottom typing strip');
  t.end();
});

test('conversation deletion has visible confirmation UI on desktop and phone', (t) => {
  t.ok(renderer.includes('function showOrionConfirmDialog'), 'desktop has an in-app confirmation modal');
  t.ok(renderer.includes('confirmConversationDelete'), 'desktop conversation delete uses confirmation helper');
  t.notOk(renderer.includes('showConfirmDialog(`Delete conversation'), 'desktop conversation delete no longer depends on native dialog only');
  t.notOk(renderer.includes('confirm("Are you sure you want to revoke'), 'paired phone revoke no longer uses raw browser confirm');
  t.ok(renderer.includes("title: 'Revoke phone access?'"), 'paired phone revoke uses the themed confirmation helper');
  t.ok(renderer.includes('data-revoke-device-id'), 'paired phone revoke uses event-bound buttons instead of inline JS');
  t.notOk(renderer.includes('onclick="revokeDevice'), 'paired phone revoke does not rely on inline event handlers');
  t.ok(renderer.includes('previousActiveElement.focus()'), 'desktop confirmation restores focus after closing');
  t.ok(styles.includes('.orion-confirm-card'), 'desktop confirmation modal is styled');
  t.ok(styles.includes('.device-item'), 'paired phone rows are themed instead of inline-styled');
  t.ok(styles.includes('.primary-btn.danger'), 'destructive confirmation action is styled');
  t.ok(styles.includes('opacity: 0.62'), 'sidebar delete controls are visible by default');

  t.ok(companionHtml.includes('id="phone-confirm-overlay"'), 'phone has an in-app delete confirmation overlay');
  t.ok(companionHtml.includes('function showPhoneConfirmDialog'), 'phone delete confirmation is rendered by app UI');
  t.notOk(companionHtml.includes("confirm('Delete this chat from Orion?')"), 'phone no longer relies on raw browser confirm');
  t.ok(companionHtml.includes('phoneConfirmPreviousFocus'), 'phone confirmation restores focus after closing');
  t.ok(companionHtml.includes("event.key === 'Escape'"), 'phone confirmation can be dismissed from the keyboard');
  t.ok(companionHtml.includes('transition: opacity 0.18s ease'), 'phone confirmation animates like a sheet');
  t.ok(companionHtml.includes('confirmed: true'), 'phone delete sends an explicit confirmation flag');
  t.ok(fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8').includes('Delete confirmation required'), 'phone delete API requires confirmation');
  t.end();
});

test('progressive disclosure keeps secondary surfaces contextual', (t) => {
  const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  t.ok(html.includes('id="btn-toggle-left-sidebar"'), 'provides a real navigation collapse control');
  t.ok(html.includes('id="command-palette-modal"'), 'provides a command palette');
  t.ok(renderer.includes("event.key.toLowerCase() === 'k'"), 'supports Ctrl+K command access');
  t.ok(renderer.includes("event.key === 'Tab'"), 'traps keyboard focus within the command palette');
  t.ok(renderer.includes("classList.toggle('contextual-panel-hidden', artifacts.length === 0)"), 'hides empty artifact surface');
  t.ok(renderer.includes("revealAgentPanel('A plan is ready for review.')"), 'reveals Agent Panel for approval');
  t.ok(renderer.includes('active blocker was recorded'), 'reveals Agent Panel for blockers');
  t.end();
});

test('agent presence communicates meaningful execution phases', (t) => {
  t.ok(html.includes('id="agent-state-pill"'), 'renders agent state beside conversation title');
  t.ok(html.includes('id="btn-stop-agent"'), 'desktop has a dedicated header stop control');
  t.ok(styles.includes('.agent-stop-button'), 'dedicated stop control is styled');
  t.ok(renderer.includes('btnStopAgent: document.getElementById'), 'renderer wires the dedicated stop control');
  t.ok(renderer.includes("window.stopAgentExecution({ mode: 'hard' })"), 'dedicated stop control requests hard cancellation');
  t.notOk(renderer.includes("submitBtn.classList.add('btn-stop')"), 'submit button no longer turns into stop');
  t.notOk(styles.includes('.btn-stop'), 'legacy submit-as-stop styling is removed');
  ['Thinking', 'Acting', 'Verifying', 'Review needed', 'Complete'].forEach(label => {
    t.ok(renderer.includes(`'${label}'`), `supports ${label} state`);
  });
  t.ok(styles.includes('.agent-state-pill.verifying'), 'styles verification distinctly');
  t.ok(styles.includes('.orion-toast.success'), 'provides completion feedback');
  t.ok(companionHtml.includes("? 'Verifying'"), 'phone uses the same verification state language');
  t.end();
});

test('window maximize control uses the correct Electron fullscreen API', (t) => {
  t.ok(ipcUiJs.includes('mainWindow.isFullScreen()'), 'main process uses BrowserWindow.isFullScreen()');
  t.notOk(ipcUiJs.includes('mainWindow.isFullscreen()'), 'main process does not call the non-existent isFullscreen() API');
  t.end();
});

test('desktop exposes quiet runtime version and update state UI', (t) => {
  t.ok(html.includes('id="app-version-meta"'), 'titlebar includes a quiet version/date metadata slot');
  t.ok(styles.includes('.app-version-meta'), 'version/date metadata has restrained titlebar styling');
  t.ok(styles.includes('font-family: var(--font-mono);'), 'metadata uses compact code-style numerals');
  t.ok(renderer.includes('refreshAppRuntimeInfo'), 'renderer populates runtime metadata on startup');
  t.ok(preload.includes('getAppRuntimeInfo'), 'preload exposes runtime metadata IPC');
  t.ok(main.includes('buildUpdateSplashHtml'), 'main process owns the pre-render update splash');
  t.ok(ipcUiJs.includes('Updating local build'), 'update splash has user-facing maintenance copy');
  t.ok(main.includes('syncSourceUpdateFiles'), 'source updater copies files through a named sync helper');
  t.end();
});

test('queued prompts have quiet in-chat action controls', (t) => {
  t.ok(renderer.includes('queued-prompt-bubble'), 'renderer uses a dedicated queued prompt card');
  t.ok(renderer.includes('Send now'), 'queued prompt card exposes send-now copy');
  t.ok(renderer.includes('Steer'), 'queued prompt card exposes steer copy');
  t.ok(styles.includes('.queued-prompt-bubble'), 'queued prompt card has theme styling');
  t.ok(styles.includes('.queued-prompt-action.primary'), 'primary queued action has distinct styling');
  t.ok(styles.includes('.queued-prompt-footer'), 'queued prompt actions have a stable footer layout');
  t.end();
});

test('screenshot artifacts are previewable from the artifact panel', (t) => {
  t.ok(html.includes('id="file-viewer-image-shell"'), 'file viewer includes an image preview shell');
  t.ok(html.includes('id="file-viewer-image"'), 'file viewer includes an image element');
  t.ok(renderer.includes('data-artifact-index'), 'artifact items use click-safe index routing');
  t.ok(renderer.includes("artifactType === 'screenshot'"), 'renderer identifies screenshot artifacts');
  t.ok(renderer.includes('readWorkspaceFileBase64'), 'renderer loads screenshot bytes through IPC');
  t.ok(styles.includes('.artifact-item.previewable'), 'previewable artifacts have interaction styling');
  t.ok(styles.includes('.file-viewer-image'), 'screenshot preview image is styled');
  t.end();
});

test('responsive app chrome preserves the agent canvas', (t) => {
  t.ok(styles.includes('@media (max-width: 980px)'), 'has compact laptop behavior');
  t.ok(styles.includes('@media (max-width: 760px)'), 'has narrow-window behavior');
  t.ok(styles.includes('#left-sidebar:not(.collapsed)'), 'uses an overlay navigation rail when narrow');
  t.ok(styles.includes('#right-sidebar:not(.collapsed)'), 'uses an overlay Agent Panel when narrow');
  t.end();
});
