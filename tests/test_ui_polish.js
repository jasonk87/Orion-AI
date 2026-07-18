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
  t.ok(html.includes('id="setting-phone-https-origin"'), 'desktop settings include a secure phone URL field');
  t.ok(renderer.includes('normalizePhoneHttpsOrigin'), 'renderer normalizes the secure phone URL before saving');
  t.ok(fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').includes("el.chatInput.value += `${needsSpace ? ' ' : ''}@`;"), 'file mention button performs a real action');
  t.end();
});

test('phone companion finishes with the same dark theme and complete mission hierarchy', (t) => {
  const rootIndex = companionHtml.indexOf('Single consolidated :root');
  t.ok(rootIndex !== -1, 'phone theme is consolidated into one root layer');
  t.ok(companionHtml.includes('color-scheme: dark'), 'phone declares dark controls');
  t.ok(companionHtml.includes('--bg: #090b12'), 'phone uses the desktop graphite background');
  t.ok(companionHtml.includes('--accent: #8273f4'), 'phone uses the desktop violet-blue accent');
  t.ok(companionHtml.includes('--success: #46d59b'), 'phone uses the desktop success color');
  t.ok(companionHtml.includes('#task-list-card { grid-area: mission; }'), 'Task List has an explicit mobile layout area');
  t.ok(companionHtml.includes('@media (prefers-reduced-motion: reduce)'), 'phone respects reduced motion');
  t.ok(companionHtml.includes('button.send-button::before { content: "\\\\2191"'), 'phone send icon is encoding-safe');
  t.ok(companionHtml.includes('dispatch-project-entry-v20'), 'phone shell exposes the current UI build version');
  t.ok(fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8').includes("orion-phone-companion-v20"), 'phone service worker cache is bumped for the current UI build');
  t.ok(companionHtml.includes('window.isSecureContext'), 'phone explains when browser push is blocked by an insecure context');
  t.ok(companionHtml.includes('Phone push needs HTTPS or localhost'), 'phone tells the user that HTTPS is required for push notifications');
  t.ok(companionHtml.includes("companionFetch('/api/push-subscribe'"), 'phone stores push subscriptions through the authenticated fetch path');
  t.end();
});

test('phone companion renders approvals and tool calls as first-class mobile UI', (t) => {
  const ipcServer = fs.readFileSync(path.join(__dirname, '../lib/ipc-server.js'), 'utf8');
  t.ok(companionHtml.includes('id="plan-panel"'), 'phone includes the approval panel');
  t.ok(companionHtml.includes('Start Implementation'), 'phone keeps the approval start action');
  t.ok(companionHtml.includes('id="deny-plan"'), 'phone keeps deny action');
  t.ok(companionHtml.includes('id="revise-plan"'), 'phone keeps revise action');
  t.ok(companionHtml.includes('function renderToolCallRows'), 'phone renders tool calls with a dedicated renderer');
  t.ok(companionHtml.includes('function formatToolResultPreview'), 'phone formats tool results before rendering them');
  t.ok(companionHtml.includes('function summarizeFileListResult'), 'phone summarizes large workspace inventory results');
  t.ok(companionHtml.includes('function formatToolParams'), 'phone formats tool params compactly');
  t.ok(companionHtml.includes('function splitAssistantOutput'), 'phone splits appended walkthroughs out of assistant prose');
  t.ok(companionHtml.includes('<script src="/marked.min.js"></script>'), 'phone loads the shared Markdown parser');
  t.ok(companionHtml.includes('function renderInlineMarkdown'), 'phone formats assistant Markdown instead of plain escaped text');
  t.ok(companionHtml.includes('function renderMarkdownFallback'), 'phone keeps a local Markdown fallback if the parser fails');
  t.ok(companionHtml.includes('function sanitizeMarkdownHtml'), 'phone sanitizes parsed Markdown before rendering');
  t.ok(companionHtml.includes("html.push('<p>' + renderInlineMarkdown"), 'phone renders Markdown paragraphs');
  t.ok(companionHtml.includes("html.push('<h' + level"), 'phone renders Markdown headings');
  t.ok(companionHtml.includes("'<li>' + renderInlineMarkdown"), 'phone renders Markdown lists');
  t.ok(companionHtml.includes('function consumeMarkdownTable'), 'phone fallback renderer supports Markdown tables');
  t.ok(ipcServer.indexOf("url.pathname === '/marked.min.js'") < ipcServer.indexOf('const device = authenticateCompanionRequest'), 'phone Markdown parser asset is served before companion auth');
  t.ok(ipcServer.includes("'/marked.min.js'"), 'phone service worker caches the Markdown parser asset');
  t.ok(companionHtml.includes('.message .message-answer h2'), 'phone styles Markdown headings inside assistant messages');
  t.ok(companionHtml.includes('.message .message-answer ul'), 'phone styles Markdown lists inside assistant messages');
  t.ok(companionHtml.includes('function renderWorkWalkthroughBlock'), 'phone renders walkthroughs with structured UI');
  t.ok(companionHtml.includes('agent-logs-container'), 'phone reuses the desktop execution log container');
  t.ok(companionHtml.includes('tool-run-badge'), 'phone reuses the desktop tool-call badge');
  t.ok(companionHtml.includes('tool-result-label'), 'phone labels bounded tool result previews');
  t.ok(companionHtml.includes('msg.logs || []'), 'phone renders per-message tool logs in chat bubbles');
  t.ok(renderer.includes("logs: replayMsg.role === 'assistant' ? replayLogs : []"), 'desktop state sends assistant logs to phone chat replay');
  t.notOk(renderer.includes("replayLogs.map(log => log.content || log.result || '')"), 'desktop state does not leak raw tool results into phone assistant prose');
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
  t.notOk(companionHtml.includes('id="clarification-panel"'), 'phone no longer renders clarification questions as a separate panel outside the transcript');
  t.ok(companionHtml.includes('function renderClarificationMessage'), 'phone renders clarification questions through the chat-message renderer');
  t.ok(companionHtml.includes('data-clarification-card="true"'), 'phone clarification cards are addressable inside the scrollable transcript');
  t.ok(companionHtml.includes('clarificationHtml + typingHtml'), 'phone appends clarification cards inside the messages container before typing dots');
  t.ok(companionHtml.includes('wasNearBottom'), 'phone only auto-scrolls the transcript when the user is already near the bottom');
  t.end();
});

test('phone companion uses a global drawer and Coder-only operations surfaces', (t) => {
  t.ok(companionHtml.includes('id="app-drawer-overlay"'), 'phone has a global app drawer');
  t.ok(companionHtml.includes('data-drawer-destination="orion"'), 'drawer exposes Dispatch as a top-level destination');
  t.notOk(companionHtml.includes('data-drawer-destination="history"'), 'History is not a top-level destination');
  t.ok(companionHtml.includes('data-drawer-destination="coder"'), 'drawer exposes Coder as a top-level destination');
  t.ok(companionHtml.includes('data-drawer-destination="settings"'), 'drawer exposes Settings as an app-level destination');
  t.ok(companionHtml.includes('id="screen-settings"'), 'phone has a dedicated Settings screen');
  t.ok(companionHtml.includes('Check local Orion files'), 'update controls live in Settings copy');
  t.ok(companionHtml.includes('bottomNav.classList.toggle(\'hidden\', !isCoder)'), 'Coder operations tabs are hidden outside Coder');
  t.ok(companionHtml.includes('id="task-list-card"'), 'Status shows the task-list card');
  t.ok(companionHtml.includes('function renderPhoneTaskList'), 'Status renders the actual conversation checklist');
  t.ok(companionHtml.includes('id="home-approvals-section"'), 'Coder home has a top-level approval section');
  t.ok(companionHtml.includes('Needs Approval'), 'approval section is labeled plainly');
  t.ok(companionHtml.includes('data-deny-plan'), 'approval cards can deny without opening the plan');
  t.notOk(companionHtml.includes('id="panel-skills"'), 'Skills tab is removed from the phone UI');
  t.notOk(companionHtml.includes('Skill Registry'), 'phone no longer exposes the skill registry page');
  t.notOk(companionHtml.includes('<div class="section-title">Recent Tasks</div>'), 'Status no longer duplicates recent tasks');
  t.end();
});

test('Dispatch hides Coder-style tool logs behind compact activity', (t) => {
  t.ok(renderer.includes('function formatDispatchToolActivity'), 'renderer has a Dispatch-specific compact tool activity renderer');
  t.ok(renderer.includes("conversationMode(activeConv) === 'orion'"), 'Dispatch detection is based on conversation mode');
  // Regression: a delegated Coder transcript viewed while the app is in the Dispatch space used
  // to render full Coder tool chips (raw JSON params, full result dumps) into Dispatch. The
  // presentation gate keys off the SPACE (appMode), not only the conversation's own mode.
  t.ok(renderer.includes("isDispatchConversation || (typeof appMode !== 'undefined' && appMode === 'orion')"), 'the whole Dispatch space gets the compact presentation, including delegated Coder transcripts');
  t.ok(renderer.includes('formatDispatchToolActivity(logs, isRunningThisConversation)'), 'Dispatch keeps a collapsed activity panel after the run instead of dropping logs entirely');
  t.ok(renderer.includes('dispatch-activity-log'), 'desktop Dispatch activity renders as a collapsed panel, phone-style');
  t.ok(renderer.includes('function renderDispatchWalkthroughPanel'), 'desktop condenses Work Walkthrough into a collapsed checklist panel in Dispatch');
  t.ok(styles.includes('.dispatch-activity-log'), 'compact Dispatch activity panel is styled');
  t.ok(styles.includes('.dispatch-current-tool'), 'the live current-tool line is styled');
  t.ok(companionHtml.includes('function renderDispatchToolActivity'), 'phone has a Dispatch-specific compact activity renderer');
  t.ok(companionHtml.includes('dispatch-activity-log collapsed'), 'phone Dispatch activity defaults to collapsed');
  t.ok(companionHtml.includes("isDispatchConversation ? renderDispatchToolActivity"), 'phone uses compact activity for Dispatch chat logs');
  t.end();
});

test('Dispatch walkthrough condensing parses statuses out of Coder walkthrough bullets', (t) => {
  const splitFn = renderer.match(/function splitDispatchAssistantText\(text\) \{[\s\S]*?\n\}/);
  const parseFn = renderer.match(/function parseDispatchWalkthroughRows\(walkthroughText\) \{[\s\S]*?\n\}/);
  t.ok(splitFn && parseFn, 'walkthrough split/parse helpers are present in renderer.js');

  const sandbox = new Function(`${splitFn[0]}\n${parseFn[0]}\nreturn { splitDispatchAssistantText, parseDispatchWalkthroughRows };`)();
  const sample = 'All done.\n\n## Work Walkthrough\n- **Done**: Ran the test suite\n- **Failed**: Write `_tmp_check.py` - EDIT BLOCKED';
  const split = sandbox.splitDispatchAssistantText(sample);
  t.equal(split.answer, 'All done.', 'the conversational answer is separated from the walkthrough');
  t.ok(/^## Work Walkthrough/.test(split.walkthrough), 'the walkthrough block is captured intact');

  const rows = sandbox.parseDispatchWalkthroughRows(split.walkthrough);
  t.equal(rows.length, 2, 'each bullet becomes one row');
  t.equal(rows[0].status, 'success', '"Done" bullets map to the success chip');
  t.equal(rows[1].status, 'error', '"Failed" bullets map to the error chip');
  t.equal(rows[1].detail.includes('EDIT BLOCKED'), true, 'the row keeps its detail text');

  const noWalkthrough = sandbox.splitDispatchAssistantText('Just a plain answer.');
  t.equal(noWalkthrough.answer, 'Just a plain answer.', 'text without a walkthrough passes through untouched');
  t.equal(noWalkthrough.walkthrough, '', 'no phantom walkthrough is created');
  t.end();
});

// Regression: updating an updateExisting system chip (e.g. "Supervisor requested one bounded
// correction attempt.") re-rendered the ENTIRE conversation via selectConversation() while the
// agent was still streaming. The replay orphaned the live assistant bubble — leaving a frozen
// duplicate of the partial message with a permanently stuck "Working (Step N)…" spinner — and
// the agent's next render appended a second copy of the same message below the chips.
test('updating a system chip mid-run does not re-render the transcript or orphan the live bubble', (t) => {
  t.notOk(renderer.includes('selectConversation(targetId);\n      return;'), 'the updateExisting branch no longer re-renders the whole conversation');
  t.ok(renderer.includes('data-sys-dedupe'), 'system chips are stamped with their dedupe key');
  t.ok(renderer.includes('function renderSystemBubble(text, dedupeKey'), 'renderSystemBubble accepts the dedupe key');
  t.ok(renderer.includes('CSS.escape(dedupeKey)'), 'the rendered chip is updated in place by key');
  t.ok(renderer.includes('renderSystemBubble(replayMsg.text, replayMsg.dedupeKey'), 'replayed chips keep their key so later updates still find them');
  t.ok(renderer.includes('Stale-spinner sweep'), 'orphaned running indicators are swept whenever a bubble renders');
  t.end();
});

// The four confirmed gaps from a Dispatch self-assessment run (supervisor blind spots and
// context loss at the Coder handoff), each now closed:
test('Dispatch supervisor escalates stalls, previews Coder state, and continues unfinished work', (t) => {
  const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
  // Stall escalation (was: monitor polled forever showing "Working…")
  t.ok(renderer.includes('quietSince'), 'supervisor monitor tracks how long Coder has been quiet');
  t.ok(renderer.includes("'supervisor-stall'"), 'a stalled run notifies the Dispatch conversation');
  t.ok(renderer.includes('Went quiet without completing'), 'stalled work is parked as a receipt instead of spinning forever');
  // Quick peek (was: sub-status and elapsed time only)
  t.ok(renderer.includes('coder-status-preview'), 'status card carries a last-message preview');
  t.ok(html.includes('coder-status-preview'), 'status card markup has the preview line');
  t.ok(styles.includes('.coder-status-preview'), 'preview line is styled');
  // One-click continuation (was: "you can queue a continuation" with no mechanism)
  t.ok(renderer.includes('function continueDelegatedWork'), 'unfinished delegated work has a continuation mechanism');
  t.ok(renderer.includes('data-dispatch-continue-work'), 'the Dispatch landing renders a Continue action');
  t.ok(styles.includes('.dispatch-desktop-work-continue'), 'the Continue action is styled');
  // Findings survive packet-less handoffs (was: silently dropped without inspect_code_context)
  t.ok(renderer.includes("Findings from Dispatch's prior investigation"), 'handoffs without context packets fold findings into the queued prompt');
  t.ok(agentJs.includes('Evidence discipline:'), 'system facts carry the zero-match-is-weak-evidence rule');
  t.ok(agentJs.includes('generated ONLY by inspect_code_context') || agentJs.includes('only inspect_code_context produces transferable context packets'), 'handoff schema tells the model when findings are load-bearing');
  t.end();
});

test('Dispatch opens as a fresh front door with project re-entry inside chat', (t) => {
  t.ok(companionHtml.includes("let companionMode = 'orion'"), 'each fresh phone launch starts at Dispatch');
  t.ok(companionHtml.includes('function enterDispatch'), 'phone has one explicit chat-first Dispatch entry path');
  t.ok(companionHtml.includes("if (companionMode === 'orion') setTimeout(() => startDispatchDraft(), 0)"), 'the first connected state starts a fresh uncommitted Dispatch draft');
  t.ok(companionHtml.includes('let dispatchDraftActive = true'), 'cold-launch Dispatch begins as a local draft');
  t.notOk(companionHtml.includes('function resolveDispatchFocus'), 'cold launch does not resolve and reopen an old conversation');
  t.ok(companionHtml.includes("enterDispatch({ fresh: true })"), 'New starts a clean Dispatch draft');
  t.ok(companionHtml.includes('function openDispatchBrowser'), 'saved discussions stay accessible inside Dispatch');
  t.ok(companionHtml.includes('function buildDispatchProjectGroups'), 'Dispatch groups discussions by project');
  t.ok(companionHtml.includes('Continue latest conversation'), 'project re-entry can continue the latest discussion');
  t.ok(companionHtml.includes('Start fresh with project context'), 'project re-entry can start a clean contextual draft');
  t.ok(companionHtml.includes('dispatch-work-row'), 'Dispatch keeps delegated work visible outside history');
  t.ok(renderer.includes('function collectDispatchActiveWork'), 'desktop and phone share one delegated-work status model');
  t.ok(renderer.includes("? 'Queued for Coder'"), 'queued delegated work is waiting rather than falsely blocked');
  t.ok(renderer.includes('function createDispatchConversationFromDraft'), 'desktop creates a Dispatch conversation lazily');
  t.ok(renderer.includes("if (!normalizedPrompt) return null"), 'an empty Dispatch draft is never persisted');
  t.ok(renderer.includes('dispatchProjectPath'), 'Dispatch persists a project association separate from Coder task identity');
  t.ok(renderer.includes("window.markConversationDirty(orionConv.id)"), 'delegated-work completion receipts persist with their Dispatch transcript');
  t.ok(companionHtml.includes("if (resetRequested) {\n      localStorage.removeItem(sessionKey);"), 'ordinary phone UI updates preserve the paired device session');
  t.ok(companionHtml.includes('Pick up a project'), 'phone landing offers project re-entry without requiring history search');
  t.ok(companionHtml.includes('coder-workspace-picker'), 'phone keeps the Coder workspace picker');
  t.ok(companionHtml.includes("#screen-new-chat.dispatch-mode .coder-workspace-picker { display: none; }"), 'Dispatch hides the workspace picker on new chat');
  t.ok(companionHtml.includes("newChatPromptEl.placeholder = isDispatchStart ? 'Ask Orion anything...' : 'What should we build?'"), 'new chat placeholder is mode-aware');
  t.ok(html.includes('Pick up a project') && html.includes('<span>Discussions</span>'), 'desktop uses the same project/discussion language');
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
  t.ok(html.includes('id="btn-check-update"'), 'desktop titlebar exposes a manual local update check');
  t.ok(styles.includes('.update-check-btn'), 'manual update check has desktop titlebar styling');
  t.ok(renderer.includes("addEventListener('click', () => checkForLocalUpdates({ manual: true }))"), 'manual update check triggers the local comparison');
  t.ok(main.includes('buildUpdateSplashHtml'), 'main process owns the pre-render update splash');
  t.ok(ipcUiJs.includes('Updating local build'), 'update splash has user-facing maintenance copy');
  t.ok(main.includes('syncSourceUpdateFiles'), 'source updater copies files through a named sync helper');
  t.ok(preload.includes('checkLocalUpdate'), 'preload exposes local-file update checks');
  t.ok(preload.includes('applyLocalUpdate'), 'preload exposes local-file update application');
  t.ok(renderer.includes('checkForLocalUpdates'), 'desktop update checker uses local-file update wording');
  t.ok(renderer.includes('Syncing...'), 'desktop update action describes local file sync instead of git pull');
  t.notOk(renderer.includes('Pulling...'), 'desktop update action no longer presents GitHub pull wording');
  t.ok(ipcUiJs.includes("ipcMain.handle('check-local-update'"), 'main process exposes local-file update IPC');
  t.ok(ipcUiJs.includes('computeSourceUpdates(srcDir, appRoot)'), 'update check compares local source files against runtime files');
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
  t.ok(renderer.includes('function renderInlineArtifactCards'), 'renderer shows screenshot artifacts inline in chat');
  t.ok(renderer.includes('data-open-artifact'), 'inline artifact cards open the file viewer');
  t.ok(renderer.includes('orion-artifact://'), 'renderer supports conversation-scoped artifact links');
  t.ok(renderer.includes("artifactType === 'screenshot'"), 'renderer identifies screenshot artifacts');
  t.ok(renderer.includes('readWorkspaceFileBase64'), 'renderer loads screenshot bytes through IPC');
  t.ok(styles.includes('.artifact-item.previewable'), 'previewable artifacts have interaction styling');
  t.ok(styles.includes('.inline-artifact-card'), 'inline artifact cards are styled');
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

// Regression: the Workspace Files panel is the sidebar's one flex-grow section (meant to fill
// whatever vertical space is available), but the shared .panel-content.scrollable rule hardcoded a
// 250px max-height meant for the small fixed-size panels (checklist, artifacts). That cap silently
// overrode the flex-grow intent, cramming the entire file tree into a tiny scroll box regardless of
// how much sidebar room existed — visually indistinguishable from "most files are missing/cut off"
// even though the underlying file list (and its count badge) were complete.
test('the Workspace Files panel fills available sidebar height instead of being capped at 250px', (t) => {
  t.ok(html.includes('class="panel-section flex-grow" id="workspace-files-panel"'),
    'the Workspace Files panel is the sidebar\'s flex-grow section');
  t.ok(styles.includes('#workspace-files-panel .panel-content.scrollable'),
    'a scoped override targets the Workspace Files panel\'s scrollable content area');
  const overrideMatch = styles.match(/#workspace-files-panel \.panel-content\.scrollable\s*\{([^}]*)\}/);
  t.ok(overrideMatch && /max-height:\s*none/.test(overrideMatch[1]),
    'the override removes the 250px cap so the panel can use its flex:1 to fill available space');
  // The base rule (and therefore the other fixed-size panels like the checklist/artifacts, which
  // are NOT flex-grow) must keep the 250px cap — this should not be a blanket removal.
  const baseMatch = styles.match(/\.panel-content\.scrollable\s*\{([^}]*)\}/);
  t.ok(baseMatch && /max-height:\s*250px/.test(baseMatch[1]),
    'the base rule still caps the small fixed-size panels at 250px');
  t.end();
});

// Regression: initModelDropdown() in renderer.js wipes and fully rebuilds #model-select
// (modelSelect.innerHTML = '') on startup, populating it only from its own hardcoded Gemini list
// plus a dynamic Ollama probe. Adding Claude/DeepSeek <option> tags directly to index.html's static
// markup was dead on arrival — those options never survive to be seen, regardless of whether an
// API key is configured, because this function erases and replaces them before the page is ever
// shown. Claude and DeepSeek must be built into this same JS-generated list, not just added to the
// static HTML (which would recreate the identical invisible-option bug).
test('the model dropdown is rebuilt from a single JS source that includes Claude and DeepSeek', (t) => {
  t.ok(renderer.includes("modelSelect.innerHTML = ''"), 'initModelDropdown fully rebuilds the dropdown from scratch');
  t.ok(renderer.includes("claudeGroup.label = 'Claude'"), 'a Claude optgroup is built in JS, not left to static HTML');
  t.ok(renderer.includes("value: 'claude-opus-4-8'") && renderer.includes("value: 'claude-sonnet-5'"),
    'the JS-built Claude list includes the models offered in the model picker');
  t.ok(renderer.includes("deepseekGroup.label = 'DeepSeek'"), 'a DeepSeek optgroup is built in JS, not left to static HTML');
  t.ok(renderer.includes("value: 'deepseek-v4-flash'") && renderer.includes("value: 'deepseek-v4-pro'"),
    'the JS-built DeepSeek list includes both V4 tiers');
  // The static HTML list should not carry Claude/DeepSeek options that initModelDropdown() would
  // just erase anyway — that duplication is exactly what caused them to silently never appear.
  t.notOk(html.includes('value="claude-opus-4-8"'), 'index.html no longer has a dead duplicate Claude option');
  t.notOk(html.includes('value="deepseek-v4-flash"'), 'index.html no longer has a dead duplicate DeepSeek option');
  t.end();
});

// The chat area used to show nothing at all — no bubble, no spinner — between the user sending a
// message and the model's first response arriving, because renderAiMessage's placeholder guard
// unconditionally skipped the very first "Thinking..." call of a run. Fixed to only skip it when
// no run is actually in progress, so a live run's running-indicator spinner shows immediately.
test('the AI thinking placeholder only suppresses stale renders, not an actively running turn', (t) => {
  t.ok(renderer.includes('const runningNow = window.isAgentRunning && window.isAgentRunning()'),
    'renderAiMessage checks whether a run is actively in progress before suppressing the placeholder');
  t.ok(renderer.includes('if (!runningNow) return;'),
    'the placeholder is only suppressed when nothing is actually running');
  const agentJsSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
  const placeholderRenderCalls = agentJsSource.match(/window\.renderAiMessage\('Thinking\.\.\.', \[\]/g) || [];
  t.ok(placeholderRenderCalls.length >= 2,
    'agent.js renders the placeholder immediately at both points a fresh "Thinking..." message is created');
  t.end();
});

test('agent status messages update in place instead of spamming transcript tails', (t) => {
  const agentJsSource = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
  t.ok(renderer.includes('options.updateExisting && options.dedupeKey'), 'system messages can update an existing keyed status');
  t.ok(renderer.includes('msg.dedupeKey === dedupeKey'), 'existing keyed system messages are found by dedupe key');
  t.ok(agentJsSource.includes("source: 'supervisor-extension'"), 'supervisor extension status is marked as a status source');
  t.ok(agentJsSource.includes("dedupeKey: `supervisor-extension-${conversation.id}`"), 'supervisor extension status uses one stable key per conversation');
  t.ok(agentJsSource.includes("source: 'planning-mode'"), 'planning/direct mode status is marked as a status source');
  t.ok(agentJsSource.includes("dedupeKey: `planning-mode-${conversation.id}`"), 'planning/direct mode status uses one stable key per conversation');
  t.ok(agentJsSource.includes('updateExisting: true'), 'agent status system messages request in-place updates');
  t.end();
});
