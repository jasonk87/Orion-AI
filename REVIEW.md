# Orion AI — Active Issue Review

> Last audited: 2026-07-19
> Source reviewed: `feature/structural-optimizations` (PR #9), based on `codex/conversation-scoped-artifacts`.

This review describes the active development branch. It does not claim to describe `main` or an older branch snapshot.

## Resolved in the stabilization pass

| Area | Resolution |
|---|---|
| Context fallback crash | `buildSectionsForPath()` estimates the actual selected source when no symbol or lexical range matches. A no-match regression test covers the fallback. |
| Database safety | `db_query` now uses a dedicated main-process executor. It accepts one allowlisted read-only statement, blocks mutation keywords and writable PRAGMAs, opens SQLite with `-readonly`, wraps Postgres/MySQL work in read-only transactions, and keeps passwords out of process arguments. |
| Terminal session contract | `terminal_exec` now accurately promises persistent working-directory state only. It no longer claims that environment variables or activated shells survive a fresh process. |
| Memory/file-knowledge write races | JSON stores use unique sibling temp files and per-file IPC write queues. File knowledge is persisted in the workspace-intelligence cache rather than a second independently hashed ledger. |
| Workspace startup load | Factory-created index services defer reconciliation until the next event-loop turn or first real lookup, so service construction no longer performs an immediate recursive walk. |
| Embedding throughput/cache growth | Workspace chunks and fact embeddings use bounded concurrency. Persisted workspace vectors are capped, and stale fact vectors are removed during full ranking passes. |
| Durable identity memory | Facts and preferences can be pinned so age filtering cannot remove stable identity/preferences from recall ranking. |
| Prompt/token overhead | Dispatch receives only its executable tool schemas; the redundant per-turn tool contract is gone; recent chat, background memory extraction, classifier examples, and aged read-only tool payloads are bounded more tightly. |
| Phone reliability | Completed responses are explicitly flushed, unchanged polling no longer rebuilds/scans the current screen, phone-server startup is awaited and reports bind failures, and the unused standalone typing-indicator DOM was removed in favor of the active inline indicator. |
| Push notification documentation | The branch does contain service-worker registration, Push API subscription, VAPID setup, device subscription endpoints, `notifyPhoneDevice`, and `notifyAllPhoneDevices`. Previous “zero push infrastructure” language was incorrect. |
| Generated personal artifacts | Unrelated Wi-Fi help and personal review files were removed from the application branch. |
| Branch verification | A Windows GitHub Actions workflow now runs `npm ci` and `npm test` for PRs and pushes to the active development/default branches. |

## Resolved in the orchestration-correctness pass

This pass corrects the connected orchestration failures exposed by the live GRITLIFE conversation. All items are structural (code-enforced contracts with regression tests), not prompt-only reminders.

| Area | Resolution |
|---|---|
| Evidence-backed memory claims | `orchestration-contracts.js` defines a typed response basis (conversation evidence / project knowledge / general inference). The agent loop records retrieved conversation evidence, validates explicit recall claims ("I remember", "we discussed") against it, and rewrites unsupported recall into an honest could-not-retrieve statement instead of a fabricated conversation. |
| Conversation-memory retrieval | `lib/conversation-memory.js` searches persisted conversations and session memory before project summaries, expands queries with entities from the recent exchange, and applies recency weighting for phrases like "earlier"/"we talked about". Same-millisecond session memories persist distinctly and remain retrievable in deterministic order. |
| Resolved task packets | `task-orchestration.js` converts context-dependent utterances ("Let's do it", "Continue") into self-contained task packets (title, resolved objective, conversation summary, workspace, requirements, provenance identifiers, lifecycle status) before queuing or handoff. Unresolvable references ("Use the second one" with no context) produce a targeted clarifying question, not a queued raw phrase. |
| Task ownership and cancellation | `lib/orchestration-task-store.js` persists tasks atomically with unique IDs and a strict lifecycle (pending/active/completed/cancelled/failed). Handoffs return the task ID; Dispatch can inspect and cancel tasks it launched, scoped by conversation provenance. Cancellation reuses the existing AbortController path, pending tasks are removable, and cancelled tasks cannot emit stale success notifications. Phone New Focus cancels only pending tasks owned by the selected conversation. |
| Quoted-example protection | `dispatch-intent.js` classifies executable intent only for active user instructions. Command-like text inside blockquotes, fenced/inline code, quoted strings, pasted transcripts, test descriptions, and status reports does not trigger a handoff, while the genuine direct request still produces exactly one `handoff_to_coder` call. |
| Workspace resolution | `workspace-resolution.js` distinguishes active project workspace, generic Projects search root, standalone Coder workspace, and unresolved. Named projects resolve through registered projects, conversation context, and filesystem search; the search root is never described as the selected workspace, and resolved workspaces ride along in task packets. |
| Factual status accuracy | Structured status facts (e.g., PR open/mergeable) are carried through the response contract; a validator rejects wording that upgrades "mergeable" to "merged", "queued" to "running", or "cancelled" to "completed", and restores the accurate structured state. |

## Verified phone push infrastructure

The current branch includes:

- `web-push` and VAPID initialization
- phone device subscriptions and revocation
- service-worker caching and notification handling
- `notifyPhoneDevice` and `notifyAllPhoneDevices`
- desktop/phone delivery reporting through IPC

## Remaining structural debt

These are maintainability/performance follow-ups, not known correctness or data-safety blockers for PR #9:

1. A first cold workspace lookup still performs the reconciliation work synchronously. Deferring it removes startup-constructor stalls, but a worker-thread index builder remains the right long-term boundary for very large repositories.
2. `agent.js`, `renderer.js`, and `lib/companion-html.js` remain large. This pass extracted database execution and consolidated knowledge persistence; provider adapters, planning/classification, Dispatch supervision, conversation persistence, and phone rendering should continue moving into focused modules.
3. The persisted workspace cache is bounded by semantic-chunk count rather than a total byte budget. A future schema can use an explicit on-disk byte ceiling and compact binary/vector storage.

## Merge position

The previously identified merge blockers have regression coverage. Merge readiness should be determined by the clean-install test run and the GitHub Actions result on PR #9.
