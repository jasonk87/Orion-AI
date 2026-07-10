# Orion AI — Active Issue Review

> Last audited: 2026-07-06
> All source claims verified against live `main` branch code.

This file tracks known issues, both fixed and open. Items move to **RESOLVED** only when confirmed against the actual source files.

---

## RESOLVED — Previously Reported, Now Fixed

All 7 issues from the original REVIEW.md have been verified fixed in the current source.

### Critical

| ID | Issue | Evidence |
|----|-------|----------|
| #1 | **Config write race** — `writeAppConfig` used `config.tmp.json`; concurrent callers could silently lose data | `atomicWriteFileSync` is used; no temp-file pattern remains (`lib/config.js:138`) |
| #2 | **SSE drops (~60s)** — No keepalive pings; phone companion showed stale state | Keepalive `: ping\n\n` fires every 20s (`lib/ipc-server.js:747-749`) |

### Moderate

| ID | Issue | Evidence |
|----|-------|----------|
| #3 | **Deny-plan lacks try/catch** — Button had no double-tap or error protection | `denyBtn.disabled = true` on click, `.catch()` re-enables, "Denying…" feedback (`companion-html.js:2714-2727`) |
| #4 | **Orphan conversations on phone** — `startNewPhoneChat` navigated away before creating conversation | Creates conversation first, navigates to chat, *then* sends prompt; error shown in-chat on failure (`companion-html.js:2225-2265`) |
| #5 | **Markdown double-escapes HTML entities** — `<br>` appeared as `&lt;br&gt;` in link labels | `renderInlineMarkdown` extracts code blocks and markdown links from raw text *before* HTML-escaping the rest (`companion-html.js:2442-2470`) |
| #6 | **Three `:root` CSS blocks** — Only the third took effect; first two were dead code | One `:root` block in `styles.css:2678`; companion-html has one with "Single consolidated :root" comment (line 22) |
| #7 | **callRendererFunction falsy rejection** — Returned `false`, `0`, or `''` was incorrectly rejected as missing | Checks `=== undefined \|\| === null`, not all falsy values (`lib/ipc-server.js:507`) |

### Minor — Also Fixed

| Issue | Evidence |
|-------|----------|
| `machineName` never passed to `companionHtml()` | Parameter is passed and used for connection badge, drawer meta, and conn-text (`companion-html.js:5, 1158, 1540, 1822, 1889, 1893`) |
| `body overflow:hidden` breaks Android keyboard | Comment explicitly notes: "overflow:hidden only on .app-root — keeping it on html/body breaks Android keyboard reflow" (`companion-html.js:39`); html/body have no `overflow` property |
| `main.js.bak` committed to repo | Not found anywhere in source tree — cleaned up |
| Debug overlay / tap-test elements in companion | Not found in source — removed |
| Hidden compat DOM elements (`#project-select`, etc.) | Not found in source — removed |
| Tool log expand placeholder dies on re-render | Not found in source — removed |
| SW caches `/marked.min.js` | No service worker registration exists; entire push/SW pipeline is absent from current codebase |

---

## OPEN — Verified Active Issues

These are the remaining known issues, confirmed against current source.

### Minor

1. **`#typing-indicator` is dead on phone companion**
   - Element exists in HTML (`companion-html.js:1353`), has visibility CSS rules (`.typing-indicator.visible` at line 600), and is queried into `typingIndicatorEl` (line 1605).
   - **No code ever toggles the `visible` class.** The desktop UI's typing indicator (`orion-typing-indicator` in renderer.js) works independently, but the phone companion's standalone element never appears.
   - *Fix: toggle `typingIndicatorEl.classList.toggle('visible', isTyping)` in the companion state update path.*

2. **`startPhoneCompanionServer` is fire-and-forget**
   - Called at `main.js:186` without `await`.
   - The function (`lib/ipc-server.js:519`) likely returns a Promise. If binding fails, the error is silently lost and the phone companion will never start.
   - *Fix: add `await` and handle rejection (log + desktop notification).*

3. **`stateRequestSerial` guard can silently drop state loads**
   - `companion-html.js:1710` initializes `stateRequestSerial = 0`.
   - When `minSerial` is provided (line 3134), the counter is NOT incremented, but the guard at line 3163 (`if (requestSerial < stateRequestSerial) return`) compares against the real counter.
   - A concurrent `minSerial` load followed by a real-counter load can cause the real-counter response to be discarded because `stateRequestSerial` advanced past it.
   - *Fix: increment `stateRequestSerial` even when `minSerial` is used, or track a separate counter for minSerial loads.*

---

## Architectural Notes (Not Bugs, Worth Knowing)

- **Monolithic core files**: `agent.js` (~8,634 lines), `renderer.js` (~5,704 lines), `companion-html.js` (~3,950 lines) carry the entire app. Duplicated function definitions exist (`buildClarificationCardHtml` at lines 3966 and 4825; `submitClarificationAnswers` at lines 4022 and 4881).
- **Push notification pipeline**: The `web-push` npm package is listed in dependencies and server-side VAPID/notify functions may exist in an earlier branch state, but the **current source has zero push infrastructure** — no service worker, no `PushManager.subscribe()`, no notification permission request, no `/api/subscribe` endpoint, no `notifyPhoneDevice` calls.
- **REVIEW.md audit gap**: Before this rewrite, the document listed 7 unfixed bugs that had actually been resolved for some time. Consider adding a CI check that greps for `RESOLVED` items with stale dates.
