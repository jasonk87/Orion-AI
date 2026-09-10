# ChatGPT Subscription (Codex)

Select **ChatGPT Subscription (Codex)** in Orion's model picker. Settings shows the
connected account, refreshable model list, supported reasoning choices, and the
quota/reset information returned by Codex. **Sign in with ChatGPT** opens the
official OAuth flow when needed. Existing Codex login and automatic token refresh
are managed by Codex; Orion never copies authentication tokens or supplies an API key.

Orion prefers the Codex desktop app's installed server on Windows, then searches
for the official CLI. `ORION_CODEX_PATH` can select a particular native executable.
The integration uses local stdio JSON-RPC, with `initialize`, `account/read`,
`account/login/start`, `model/list`, `account/rateLimits/read`, `thread/start`,
`turn/start`, streamed item events, and `turn/interrupt`.

Orion remains responsible for its conversation persistence, compaction, tools,
permissions, and specialist lifecycle. Each provider request sends the current
Orion history (including tool results) to an isolated ephemeral Codex thread.
Codex's structured output describes Orion tool calls, which return to the existing
Orion execution loop. Native Codex environment access is disabled. Parallel requests
use separate threads and request IDs, so comparison lanes cannot share history or
cancel each other. Restarting Orion reconstructs context from its saved conversation.

This trades native Codex thread reuse for compatibility with Orion's existing
history editing and compaction. Subscription usage limits still apply. A request
requires ChatGPT authentication and cannot fall back to API-key billing. Model
availability and supported reasoning come from the installed Codex server; updating
Codex can change the available catalog. Protocol features are version-sensitive.

Validation:

- `node tests/test_codex_subscription.js` — transport, auth, concurrency, deadlines,
  cancellation, and Orion response conversion.
- `node tests/test_codex_provider.js` — real agent adapter, desktop/phone model
  selection, and reasoning persistence.
- `node scripts/smoke-codex-subscription.js` — opt-in live account checks for
  streaming, history, tool/result continuation, parallel requests, and interruption.

Official protocol: https://learn.chatgpt.com/docs/app-server
