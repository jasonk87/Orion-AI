# OrionAI Code Review

## CRITICAL

### 1. Config write race condition (`lib/config.js`)
`writeAppConfig` writes to a hardcoded temp filename `config.tmp.json` then renames it. Two concurrent callers (SSE updating `lastSeenAt` on every request + another endpoint updating `selectedConversationId`) both write to the same temp file. Last rename wins, first write's data is silently lost. `atomicWriteFileSync()` already exists in the file and does this correctly — `writeAppConfig` just doesn't use it.

### 2. SSE drops on Android after ~60s (`lib/ipc-server.js`)
The `/api/events` endpoint sends no keepalive pings. Android Chrome aggressively kills idle connections. When it drops, the 3-second polling fallback is suppressed because `lastSseMessageAt` was recently set. The phone shows stale state and doesn't recover. **This is very likely contributing to the "everything unresponsive" issue on your Pixel.** Fix: send `': ping\n\n'` every ~20 seconds inside the SSE handler.

---

## MODERATE

### 3. Deny plan button: no error handling, no double-tap protection (`companion-html.js`)
The async click handler has no try/catch and doesn't disable the button. Network failure = unhandled promise rejection. Double-tap = two requests. The approve button handles both correctly; deny doesn't.

### 4. Orphan conversations on new chat failure (`companion-html.js`)
`startNewPhoneChat` (now defined) creates the conversation first, then sends the prompt separately. If the prompt call fails, the conversation exists in Orion but the UI stays on the new-chat screen. That conversation becomes unreachable from the phone.

### 5. Markdown double-escapes HTML entities in link labels (`companion-html.js`)
`renderInlineMarkdown` runs `escapeHtml()` on the whole string first, then the link regex captures text that's already HTML-escaped. Any `&`, `<`, `>`, `"`, or `'` in a link label renders as `&amp;amp;` etc.

### 6. Three `:root` CSS blocks — first two are dead (`companion-html.js`)
There are three separate `:root { }` declarations in the stylesheet. The third overrides everything. The first block (where most CSS variables like `--accent`, `--bg`, etc. are defined) has zero effect at runtime. All three should be collapsed into one.

### 7. `callRendererFunction` throws on any falsy return (`lib/ipc-server.js`)
`if (!result) throw new Error('Phone companion bridge is not ready yet')` — if any renderer function legitimately returns `false`, `0`, `null`, or `''`, the phone gets a 500 error. Should be `if (result === undefined)`.

---

## MINOR

- **`machineName` never passed to `companionHtml()`** — the connection badge always says "Connected to Desktop" regardless of actual machine name (`lib/ipc-server.js:292`)
- **`body { overflow: hidden }` breaks Android keyboard reflow** — known Chrome Android issue where the virtual keyboard opening doesn't shrink the layout, pushing the composer input off-screen (`companion-html.js:34`)
- **`#typing-indicator` element is dead** — `applyState()` always removes the `visible` class; the actual typing indicator is rendered directly into `messagesEl.innerHTML`. The standalone element does nothing.
- **`main.js.bak` (198KB) committed to repo** — should be deleted and added to `.gitignore`
- **Service worker caches `/marked.min.js`** — if marked isn't installed, SW install fails permanently and offline mode is broken
- **Tool log "open" expand/collapse is a dead placeholder** — every tool call renders `<span>open</span>` that was never wired up to anything
- **Hidden compat DOM elements never used** — `#project-select`, `#new-task-dup`, `#queue-line`, etc. are in a `display:none` div and are never queried by any JS
- **`startPhoneCompanionServer` not awaited** — returns the pairing payload before confirming the server has actually bound to the port
- **`stateRequestSerial` guard can silently drop state loads** — when `minSerial` is provided, the counter isn't incremented, so concurrent loads using the real counter can make the `minSerial` stale and silently discard state updates
- **Debug overlay in production** — the red TAP TEST button and `window.onerror` display (added this session for diagnostics) need to be removed once we confirm clicks work on your phone

---

## Priority Order

1. **SSE keepalive** — almost certainly part of the Android unresponsiveness
2. **Config write race** — silent data corruption
3. **Three `:root` blocks** — easy cleanup with visual impact
4. **`callRendererFunction` falsy check** — defensive fix
5. **`machineName`** — tiny fix, obvious improvement
6. **`body overflow: hidden`** — Android keyboard fix
7. **Deny plan error handling** — parity with approve button
