(function initOrionOperatingContract(globalScope) {
  'use strict';

  // Shared Orion operating contract — Phase 1 of the Operator architecture plan.
  //
  // SYSTEM_INSTRUCTION (Coder) and DISPATCHER_INSTRUCTION (Dispatch), both in agent.js, used to
  // be two fully independent hand-written prompts. They drifted: both carried a "verify your
  // claims before committing to them" rule, written twice with different wording, and a couple
  // of smaller tool-behavior descriptions (db_query, "tools are schemas") duplicated the same
  // way. That is the exact failure mode this file exists to prevent — one canonical fragment per
  // genuinely-shared rule, referenced by both prompts, so a future edit only has to happen once.
  //
  // What belongs here: content that is the same OPERATING RULE for every mode/specialist,
  // regardless of what that mode is allowed to do — verification discipline, and factual tool
  // documentation for tools multiple specialists share unmodified.
  //
  // What does NOT belong here: anything that reads differently by design because the specialists
  // are genuinely different (voice/identity, routing/ownership rules, build-and-test discipline,
  // memory protocol mechanics). Those stay local to SYSTEM_INSTRUCTION/DISPATCHER_INSTRUCTION.
  // A few near-duplicate memory/tool-use lines were deliberately left unmerged in this pass even
  // though they are similar in spirit — see the Phase 1 commit message for the specific calls.
  //
  // Fragments are bodies only, no section headers: the two prompts use different heading styles
  // (SYSTEM_INSTRUCTION's numbered "18A. LABEL:" list items vs DISPATCHER_INSTRUCTION's bare
  // "ALL CAPS:" headers), so each prompt keeps its own header and interpolates the shared body.

  // Diagnostic self-check before committing to a claim about why something fails or how a system
  // behaves. Originally SYSTEM_INSTRUCTION's "18A. DIAGNOSTIC RIGOR" and DISPATCHER_INSTRUCTION's
  // "BEFORE YOU COMMIT TO A CLAIM OR DIAGNOSIS" — same three checks, different wording. Merged to
  // the union of both: nothing either version said was dropped.
  const VERIFICATION_DISCIPLINE = `- Load-bearing claims: if your explanation depends on something existing — a limit, a mechanism, an API, an external system or platform, a config value, a behavior — confirm you actually verified it with a tool (read the file, grep_search for it, search the web). If you have not verified it, verify it now or do not assert it. Never invent an external cause you never checked for — one grep_search that comes back empty kills a wrong theory for almost no cost, while asserting a phantom cause wastes far more and misleads the user.
- Trace the data, not just the code: reading where something is defined is not the same as knowing what it receives at runtime. Read the responsible function in full and confirm the inputs and properties it references actually exist and are populated — a reference to a property that is never set (so it is always undefined) is a common real bug that only shows when you trace the data.
- Prefer the boring internal cause: for "we built X to prevent Y, but Y still happens," the likely answer is a bug in X — is it wired in, does it receive the data it needs, does its condition actually fire? Exhaust the in-code explanations before blaming anything outside the codebase.`;

  // Opening line of each prompt's "TOOL USE:" section. Both said essentially this; SYSTEM_INSTRUCTION's
  // fuller wording was kept as the shared version since it adds precision, not new behavior.
  const TOOL_SCHEMA_NOTE = `Callable tools are supplied separately as formal JSON schemas — treat those schemas as the source of truth for available tool names, parameters, and behavior.`;

  // Shared factual core of the db_query tool description. Each prompt keeps its own addendum
  // (SYSTEM_INSTRUCTION: output format note; DISPATCHER_INSTRUCTION: routing note) locally.
  const DB_QUERY_CORE = `- Use "db_query" to read data from a local SQLite file or a Postgres/MySQL database. Read-only is enforced — it cannot perform mutations.
- For SQLite: provide "dbPath" as an absolute path to the .sqlite, .db, or .sqlite3 file.
- For Postgres/MySQL: provide "connectionString" (e.g. "postgresql://user:pass@host:5432/dbname") and optionally set "dbType" to "postgres" or "mysql".`;

  const api = { VERIFICATION_DISCIPLINE, TOOL_SCHEMA_NOTE, DB_QUERY_CORE };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionOperatingContract = api;
})(typeof window !== 'undefined' ? window : globalThis);
