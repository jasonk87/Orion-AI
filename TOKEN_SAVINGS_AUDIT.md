# Token Savings Audit — OrionAI

Analyzed: `agent.js`, `operational-context.js`, `lib/memory-manager.js`, `lib/project-memory.js`

Existing optimizations noted first to avoid duplicate suggestions: (1) the OC short-header replacement on turns after the first (`useOCShortHeader`, lines 1020–1030); (2) `trimAgedToolResultsFromMessages` strips large read-only tool results older than 6 messages (line 8041); (3) `resolveUtilityModelName` routes cheap JSON classification/token-count calls to flash-lite instead of the main model (line 6826); (4) operational context tool declarations are only sent during `'executing'` mode (line 6918). All four are good and should stay.

The findings below are ordered by estimated impact.

---

## 1. Tool list text inside SYSTEM_INSTRUCTION duplicates the formal declarations

**Where:** `SYSTEM_INSTRUCTION`, lines 79–130. The block starting with `Tools available:` describes every tool in English — names, descriptions, behavioral guidance ("do not use capture_screen for web apps"). The exact same tools are sent in every API request via `buildAgentToolDeclarations()` (line 6916), which feeds the `tools` field of the request body in all three provider paths (Gemini line 7607, Anthropic line 7806, Ollama line 7607).

The model therefore receives two representations of the tool catalog on every turn: one in the system prompt as English prose, one as the structured schema the API actually uses. The prose is not needed for the model to call tools — the schema handles that — but it does carry some "when not to use" behavioral notes (e.g., `preview_app` vs `run_command` for GUI apps, `take_screenshot` vs `capture_screen`).

**Fix:** Move the behavioral "when to use / don't use for X" notes into the `description` fields of the affected tool declarations in `buildAgentToolDeclarations()`. Then delete the `Tools available:` block from `SYSTEM_INSTRUCTION` entirely. The formal schema is authoritative; the prose copy is waste.

**Estimated savings:** ~800–1,000 tokens per turn, every turn, every session. For a 20-turn session this is 16,000–20,000 tokens.

**Intelligence risk:** Low. The behavioral notes need to move, not disappear. The schema descriptions can carry them. Spot-check `preview_app`, `take_screenshot`/`capture_screen`, and `read_file`/`read_multiple_files` to confirm the behavioral constraints are preserved in the declaration `description` strings.

---

## 2. Dispatcher mode sends all ~50+ tool declarations; only ~18 are ever allowed

**Where:** `buildAgentToolDeclarations()` line 6916 is called unconditionally for all three providers. But in Orion/Dispatcher mode, `DISPATCH_TOOL_ALLOWLIST` (lines 6901–6910) restricts execution to ~18 tools (`recall_memory`, `google_search`, `read_file`, `grep_search`, `handoff_to_coder`, etc.). Every other declaration — `write_file`, `run_command`, `patch_file`, `preview_app`, `start_command`, `run_tests`, and roughly 30 more — is sent to the API even though the executor will always reject them.

**Fix:** In `buildAgentToolDeclarations()`, check `activeConversationMode === 'orion'` and filter the returned array to only the tools in `DISPATCH_TOOL_ALLOWLIST`. The allowlist already exists as the enforcement mechanism; the tool declarations should match it.

```js
function buildAgentToolDeclarations() {
  const allTools = [...];
  if (activeConversationMode === 'orion') {
    return allTools.filter(t => DISPATCH_TOOL_ALLOWLIST.has(t.name));
  }
  return allTools;
}
```

**Estimated savings:** ~400–600 tokens per Dispatcher turn. If Jason primarily uses Orion/Dispatcher mode for day-to-day questions, this fires constantly.

**Intelligence risk:** None. The tools are already hard-blocked at execution. The model calling a blocked tool today produces an error response anyway; removing it from the schema prevents the wasted attempt.

---

## 3. Six injected fake model-role "acknowledgment" messages, every turn

**Where:** `buildReasoningMessages()` (line 501) and `runAgentLoop()` (lines 1038–1113) inject 5–6 synthetic `model`-role messages as context-acceptance signals:

- Line 512: `"Working state loaded. I will reason from it..."` (~15 tokens)
- Line 517: `"Recent chat (including my own prior replies...) received..."` (~25 tokens)
- Line 1048: `"Understood. I will use these durable notes..."` (~15 tokens)
- Line 1075: `"Understood. I have the context data loaded."` (~12 tokens)
- Line 1098: `"Understood. Home directory is X. Web search: Y. Client: Z..."` (~40 tokens)
- Line 1111: `"Understood. I will use the known project paths directly..."` (~15 tokens)

These exist to complete the alternating user/model turn structure required by the API. But they add up to ~120 tokens per turn and they never carry real information.

**Fix:** Merge the context blocks that always appear together into fewer user-role messages. Notes, project memory, and the scratchpad are injected as three separate exchanges (lines 1038–1077). They can be one exchange: `[ORION CONTEXT]\n{notes}\n---\n{project memory}\n---\n{scratchpad}` with a single ack. Similarly, SYSTEM FACTS and KNOWN PROJECTS (lines 1091–1113) can merge into one exchange instead of two. Target: 2 model acks instead of 6.

**Estimated savings:** ~80–100 tokens per turn (the acks themselves). Modest on its own, but compounds with other fixes.

**Intelligence risk:** Low. These acks are scaffolding, not reasoning. Merging them does not remove any information from the model's view.

---

## 4. SYSTEM FACTS and KNOWN PROJECTS re-injected on every turn

**Where:** Lines 1091–1113 inject two message pairs every turn: one with the home directory, web search status, active workspace, and client type; one with the list of all registered local projects (up to 40 entries, line 6358).

None of this changes during a session. The home dir is resolved once at line 804 (`resolvedHomeDir`). The workspace is fixed unless `change_workspace` fires. The known projects list doesn't mutate at runtime.

**Fix:** Track whether these have been injected for this conversation already (a `conversation._systemFactsInjected` boolean is sufficient). On turn 2+, skip both blocks. If `change_workspace` fires, clear the flag so the updated workspace gets re-injected on the next turn. Alternatively, push these facts into `getSystemInstruction()` once, where they belong conceptually.

**Estimated savings:** ~150–300 tokens per turn × (N-1) turns. A 10-turn session with 40 registered projects saves roughly 1,500–3,000 tokens.

**Intelligence risk:** Low. The model needs these facts on turn 1. After that, it either used them or has them in turn history.

---

## 5. `buildToolUseContractPrompt()` added to every single turn

**Where:** Line 1141: `buildToolUseContractPrompt()` pushes a ~200-token message onto `messages` unconditionally every turn. The function (line 4498) tells the model to check whether it needs tools, to not end with a generic completion message, and to not paste planning documents into chat.

The first instruction ("decide whether you need tools") is already covered by SYSTEM_INSTRUCTION rules 1, 3, 8, and 9. The second instruction ("summarize what tests ran") is already in SYSTEM_INSTRUCTION rule 11 RESPONSE FORMAT. The third instruction ("don't paste planning docs into chat") is valid but could live in the system prompt.

**Fix:** Move the unique content from `buildToolUseContractPrompt()` (specifically the planning-document paste prohibition) into SYSTEM_INSTRUCTION, and delete the injection at line 1141. The generic tool-use guidance is redundant with existing rules.

**Estimated savings:** ~200 tokens per turn, every turn.

**Intelligence risk:** Medium. The "don't paste planning docs into chat" rule was probably added because the model was doing it without the nudge. Test whether its removal causes regression. If it does, add a compressed one-liner (30 tokens) to the system prompt instead of the current 200-token block.

---

## 6. `classifyPlanningNeed()` prompt carries 28 input/output examples

**Where:** Lines 5704–5731 in `classifyPlanningNeed()`. The classification prompt includes 28 labeled examples like `"what python environments do i have installed" -> direct`, `"build me a Python desktop app" -> plan`. These consume ~300–350 tokens of the ~500-token prompt. The classification task is a 3-way JSON response (`plan` / `direct` / `answer`) plus three boolean flags. It doesn't need 28 examples.

**Fix:** Cut to 10–12 examples: keep the hardest true positives for each class, especially the tricky ones (`"lets add this game" -> plan` vs `"recommend improvements" -> direct`). Drop all the obvious ones (`"run the tests" -> direct`, `"explain how PATH works" -> answer`). This is the prompt the model is least likely to need coaching on.

**Estimated savings:** ~150–200 tokens per `classifyPlanningNeed()` call. This function is called on every fresh non-internal user turn, and potentially multiple times per turn when plan approval intent is ambiguous (lines 861, 888, 914).

**Intelligence risk:** Low. The regex fallback at line 5657 catches failures gracefully. Cut the 16 most-obvious examples, keep the 12 that cover the genuinely ambiguous boundaries.

---

## 7. MAX_CHAT_VIEW_MESSAGES = 16 at 3,000 chars each

**Where:** `operational-context.js` line 9: `const MAX_CHAT_VIEW_MESSAGES = 16`. `buildRecentChatView()` at line 490 keeps up to 16 messages, each capped at 3,000 chars (line 492). This is potentially 48,000 chars (~12,000 tokens) of conversation history appended to the reasoning messages on every turn.

The chat view is labeled `[RECENT USER CHAT VIEW - non-canonical]` (line 515) — it's explicitly not the task source of truth (operational context handles that). It exists so the model can resolve references like "number 1" or "that idea." For that purpose, 6–8 messages is almost always enough.

**Fix:** Reduce `MAX_CHAT_VIEW_MESSAGES` from 16 to 8, or make it adaptive: start at 8 and expand only after compaction fires (which clears history anyway). Also consider reducing the per-message char cap from 3,000 to 2,000.

**Estimated savings:** 3,000–6,000 tokens per turn for conversations longer than 8 exchanges. Compounds across every turn in a long session.

**Intelligence risk:** Medium. References to things said earlier in the conversation will occasionally be missed. But since operational context captures all task-relevant state (mission, subplans, discoveries), the loss is mainly conversational continuity, not task accuracy.

---

## 8. `trimAgedToolResultsFromMessages` thresholds are conservative

**Where:** Lines 8033–8034: `TOOL_RESULT_TRIM_THRESHOLD_CHARS = 4000` and `TOOL_RESULT_TRIM_KEEP_RECENT_MESSAGES = 6`. A large `read_file` result (say, 20,000 chars on a 500-line file) is only trimmed if it's in a message at index `messages.length - 7` or older, and only if it's over 4,000 chars. This means up to 6 turns' worth of large file reads stay in the context window at full size.

**Fix:** Tighten both constants: `TOOL_RESULT_TRIM_KEEP_RECENT_MESSAGES = 3` (trim anything older than 3 turns) and `TOOL_RESULT_TRIM_THRESHOLD_CHARS = 1500` (trim anything over ~375 tokens). The trim note already tells the model to re-run the tool if it needs the data.

**Estimated savings:** Variable but significant for tool-heavy runs. A session with 10 `read_file` calls on 200-line files leaves ~100,000 chars in context without this fix; with it, only the last 3 reads stay full.

**Intelligence risk:** Low. The model is explicitly told to re-run the tool, and `filesSeenThisRun` / `filesFullyReadUnchanged` already guard against redundant re-reads.

---

## 9. DISPATCHER_INSTRUCTION lists tools in text again

**Where:** Lines 169–182 of `DISPATCHER_INSTRUCTION`. A text list of all available Dispatcher tools appears (`- recall_memory: Read memory for the given scope...`, etc.). This is on top of the formal tool schema sent via `buildAgentToolDeclarations()` (which, combined with fix #2 above, would be the allowlisted Dispatcher subset).

**Fix:** Delete lines 169–182 from `DISPATCHER_INSTRUCTION`. The schema makes this redundant.

**Estimated savings:** ~200 tokens per Orion mode turn.

**Intelligence risk:** None. The formal schema is authoritative.

---

## 10. `autoSaveOrionMemory` sends 20 messages at 400 chars each

**Where:** Lines 248–250: `msgs.slice(-20)` with `.substring(0, 400)`. The background auto-save summarization prompt can include up to 8,000 chars (~2,000 tokens) of conversation history. This is a separate API call to flash-lite, so it's cheap, but the payload is larger than necessary for a fact-extraction task.

**Fix:** Reduce to `slice(-10)` with `.substring(0, 300)`. A fact-extraction task over a conversation needs maybe the last 6–8 exchanges to work well; 20 is generous.

**Estimated savings:** ~800 tokens per auto-save call. Low priority since it goes to flash-lite, but easy to fix.

**Intelligence risk:** Low. The prompt asks only for clearly expressed facts and preferences, which appear in the last few turns, not 20 turns back.

---

## Summary table

| # | Fix | Where | Est. tokens saved per turn | Risk |
|---|-----|--------|---------------------------|------|
| 1 | Delete tool prose from SYSTEM_INSTRUCTION | `agent.js` lines 79–130 | 800–1,000 | Low |
| 2 | Filter tool declarations to allowlist in Dispatcher mode | `agent.js` line 6916 | 400–600 | None |
| 3 | Merge 6 fake model acks into 2 | `agent.js` lines 1038–1113 | 80–100 | Low |
| 4 | Skip SYSTEM FACTS / KNOWN PROJECTS after turn 1 | `agent.js` lines 1091–1113 | 150–300 | Low |
| 5 | Move tool-use contract into system prompt | `agent.js` line 1141 | 200 | Medium |
| 6 | Cut classifyPlanningNeed examples from 28 to 12 | `agent.js` lines 5704–5731 | 150–200 (per classify call) | Low |
| 7 | Reduce MAX_CHAT_VIEW_MESSAGES from 16 to 8 | `operational-context.js` line 9 | 3,000–6,000 for long convs | Medium |
| 8 | Tighten trim thresholds (keep 3, trim at 1,500 chars) | `agent.js` lines 8033–8034 | Variable (big for tool-heavy runs) | Low |
| 9 | Delete tool list from DISPATCHER_INSTRUCTION | `agent.js` lines 169–182 | 200 (Orion mode only) | None |
| 10 | Reduce autoSaveOrionMemory slice from 20 to 10 msgs | `agent.js` line 248 | ~800 (background call) | Low |

**Quick wins (no behavior risk, high yield):** #1, #2, #4, #9 together save 1,600–2,100 tokens per turn with essentially zero intelligence risk. Do these first.

**Highest absolute ceiling:** #7 (chat history reduction) and #8 (aggressive tool result trimming) matter most for long, tool-heavy sessions where the context window pressure is real.
