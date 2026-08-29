# Orion Memory Architecture — Map & Two Bug Fixes

## 1. Correcting the prior claim

An earlier Researcher report called `memory.json` and `facts-index.json` under `OrionAI\.orion\` "the authoritative personal-memory stores." That's wrong. Those are **project-scoped** files for the OrionAI project specifically. Traced against real read/write call sites in `lib/memory-manager.js` and `lib/ipc-memory.js`:

- **Authoritative personal (global) memory**: `~/.orion/global-memory.json` — user-home-scoped, outside any project. Holds personal facts, preferences, profile fields, and auto-generated summaries (category `'auto-summary'`).
- **Global embeddings index**: `~/.orion/facts-index.json` (global scope) — cosine-similarity ranking cache for global facts.
- **Project memory**: `<workspace>/.orion/memory.json` — per-project facts, decisions, preferences. A *separate* store per project; OrionAI's own `.orion/memory.json` is just one instance of this, not the personal store.
- **Project facts index**: `<workspace>/.orion/facts-index.json` — same embedding mechanism, project-scoped.
- **Skill memory**: `~/.orion/skill-memory.json` — global, procedural patterns.
- **File knowledge**: `<workspace>/.orion/file-knowledge.json` — per-file digest notes, version-bound.
- **Sessions**: `<workspace>/.orion/sessions/*.json` — per-project session summaries.
- **Conversation history / compaction summaries**: live inside `conversation.messages` / `conversation.compactionHistory`, not in any `.orion` store at all — this is conversation state, not memory.

All writes go through `lib/memory-manager.js`'s `atomicWriteJsonSync`, wrapped by `lib/ipc-memory.js`'s `enqueueFileWrite` for serialization. `memory-manager.js` is the sole logic layer; nothing else touches these files directly.

## 2. How `remember_fact` actually gets triggered

Two independent paths, not one:

- **Model-initiated**: the model calls `remember_fact` / `remember_preference` / `recall_memory` as tools. **All three default `scope` to `'project'`** unless the model explicitly passes `scope: 'global'`. `remember_decision` has no `scope` parameter at all — it's always project. This means a fact the model intends as personal can silently land in whichever project happens to be active, unless the model remembers to say so.
- **Automatic (inactivity-based)**: `scheduleOrionMemoryInactivitySave` fires `autoSaveOrionMemory` after 10 minutes of inactivity in a Dispatch conversation. This runs its **own separate LLM call** to summarize the conversation and extract facts, writes to **global** memory under `'auto-summary'`, and also writes a project-scoped session summary. This is the only fully-automatic path — nothing automatically invokes `remember_fact` itself.

## 3. How `recall_memory` selects evidence

Same default-scope behavior as the write tools: **defaults to `'project'`** unless the model passes `'global'`. Ranks candidate facts by cosine similarity against the query embedding (via the facts-index cache), falling back to recency when the embedding cache misses.

Separately, `lib/conversation-memory.js` provides a **second, unrelated** notion of "memory": pure keyword/term-overlap plus recency scoring over raw past conversation transcripts and session records — no embeddings at all. This is what backs conversation-recall style answers and `buildOrionContinuityContext`'s session-summary injection. It is easy to conflate with `recall_memory`'s typed-fact retrieval, but they're different mechanisms with different failure modes.

## 4. Specialists vs. Dispatch

`getSystemInstruction` injects the cached `{{user_memory}}` block **only when `isOrion === true`** — i.e., Dispatch only. Coder, Operator, and Researcher never receive the passively-injected global memory block. They *can* still call `remember_fact` / `recall_memory` directly if those tools are in their allowlist, but they get no ambient personal context unless they ask for it.

## 5. Restart / staleness / conflict risks

**Survives restart**: everything under `.orion/` (global-memory, project memory, skill-memory, file-knowledge, facts-index at both scopes, sessions) — plain files on disk, `atomicWriteJsonSync`'d.

**Does not survive**: the rebuilt-per-session `orionCachedMemoryBlock` (rebuilt fresh via `refreshOrionMemoryBlock` each time), and anything only living in unpersisted conversation state.

**Where it can go stale or conflict**:

- The project-scope default on `remember_fact`/`remember_preference`/`recall_memory` is itself the biggest staleness risk — a fact meant as personal can end up invisible outside the project it was written under, or (as diagnosed below) a personal question can get answered as if it were project-scoped.
- Jaccard-similarity near-duplicate merging in `memory-manager.js` can collapse facts that are similar-worded but meaningfully different.
- The embedding cache is SHA1-hash-keyed on fact text; editing a fact's text leaves the old cache entry stale until natural eviction.
- `conversation-memory.js`'s keyword/recency answers and `recall_memory`'s embedding-ranked answers can disagree about "what Orion remembers" for the same question, since they're structurally different retrieval mechanisms.

## 6. The honest two-tier picture

**Real, typed, durable memory**: entries in `global-memory.json`, `<project>/.orion/memory.json`, `skill-memory.json`, `file-knowledge.json` — explicit records written by a tool call, independently readable and rankable.

**Very good searchable reconstruction, not memory**: conversation-recall answers (keyword+recency over raw transcripts), continuity-context session-summary injection, and compaction summaries embedded in conversation state. These can feel like memory to a user but are re-derived from transcripts each time rather than stored as discrete facts.

**Not fixed this round** (flagged only, per instruction): the `scope`-defaults-to-`'project'` behavior on `remember_fact`/`remember_preference`/`recall_memory` is a real architectural issue but out of scope here.

---

## 7. Bug 1 — stale "Yes" bound to the wrong preceding offer

**Root cause**: `conversation.lastDelegatedWork` (`renderer.js`, 8+ assignment sites, none of which clear or expire it) is "whatever was delegated most recently, ever." Forwarded into the classifier as `recentOwnedTask`, the pre-existing `failedTaskRetry` deterministic override fired on *any* contextual "yes" once structural conditions matched (`context_followup` + `requiresExecution` + `contextDependent` + a failed `recentOwnedTask` + no active/pending task) — with nothing checking that the reply was actually *about* that specific stale task. That's exactly how "Yes" (accepting a fresh offer to show stored memory entries) got rewritten into "Check DeepSeek balance + screenshot," a stale, unrelated failed task.

**Fix** (`semantic-intent-router.js`): added a model-judged boolean, `resumesRecentFailedTask`, with explicit prompt guidance distinguishing "this reply accepts a retry of the exact failed task" from "this reply answers a different, more recent offer." The deterministic override now requires `resumesRecentFailedTask === true` in addition to the existing structural conditions. Model decides meaning (which offer is this reply about); deterministic code enforces the invariant (never substitute a stale objective unless the model affirms the tie).

**Tests** (`tests/test_semantic_intent_router.js`): three new cases — an unrelated confirmation resolves to the new request, not the stale task; a genuine retry ("yes, try that again") still preserves the exact stale objective; `resumesRecentFailedTask: true` alone can't manufacture a retry outside a `context_followup` shape. Verified by temporarily removing the gate, confirming all three failed as expected, then restoring and confirming they pass.

## 8. Bug 2 — memory question scoped through the active project

**Root cause**: `memoryIntent` (`stored_memory_lookup` / `conversation_recall`) was already classified correctly, but nothing tied it to `inspectionTarget`. A model could set `inspectionTarget: 'project'` simply because `conversation.workspace` (GRITLIFE) was primed as "the resolved target," authorizing project-bound task construction exactly like a real project question would — the same context-leak pattern as the Bot-GPT bug, this time at task-construction time for memory questions.

**Fix**: a deterministic invariant forces `inspectionTarget = 'none'` whenever `memoryIntent` is `stored_memory_lookup` or `conversation_recall`, regardless of what the model set. This can't break a genuinely project-specific memory question, because it's `recall_memory`'s own `scope` parameter — not `inspectionTarget` — that selects which memory store gets read.

**Tests**: three new cases — a personal memory question never binds to the active project even when raw model output said `'project'`; a project-named memory question ("what did we discuss about GRITLIFE") still resolves to `inspectionTarget: 'none'`; a control case confirms an ordinary (non-memory) project question is unaffected. Verified the same revert-and-restore way.

## 9. Validation

- `tests/test_semantic_intent_router.js`: 162/162 passing (150 pre-existing + 12 new assertions across the 6 new test blocks for these two bugs).
- Full suite (all ~190 files via the resumable chunked runner): 8 failures, all matching the exact pre-existing/environment-unrelated categories already confirmed during the earlier Bot-GPT validation pass — resource-contention timeouts (`test_agent_presence_scoping.js`), OS process/signal-behavior (`test_command_lifecycle.js`, `test_computer_action_drag_multimonitor.js`, `test_computer_use.js`, `test_conditional_watches.js`, `test_repair_pass_regressions.js`), a Windows-path-on-Linux sandbox artifact (`test_file_knowledge.js`), and a stale undeletable leftover directory from an earlier interrupted sandbox run predating this session's tests (`test_skill_visibility.js`). No new failures.
- `node -c` clean on both touched files. ESLint clean. `git diff --check` clean (no whitespace/line-ending issues). Both files remain LF-only throughout — no CRLF churn introduced.

## 10. Files changed / preserved

**Changed (uncommitted)**: `semantic-intent-router.js`, `tests/test_semantic_intent_router.js`.

**Preserved untouched**, as instructed: your pre-existing uncommitted work — `dispatch-execution-route.js`, `lib/windows-window-capture.js`, `tests/test_dispatch_execution_route.js`, `tests/test_window_capture_fallback.js` — plus the other already-modified files from earlier work (`agent.js`, `lib/ipc-computer-use.js`, `lib/ipc-shell.js`, `lib/ipc-ui.js`, `specialist-registry.js`, and several test files).

## 11. Flags

- `.git/index.lock` is present again (no live git process attached) — same stuck-lock situation flagged before. Not force-removed; outside this task's scope.
- Running the pre-existing `test_skill_visibility.js` suite left `skills/registry.json` with a pure whitespace/formatting diff (content identical after JSON-normalizing both versions — no data changed). Attempted to restore it with `git checkout`, but that's blocked by the index lock above. Cosmetic only; needs a `git checkout -- skills/registry.json` once the lock clears.
- Nothing committed, pushed, packaged, or restarted.
