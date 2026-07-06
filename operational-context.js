(function initOperationalContext(globalScope) {
  'use strict';

  const VERSION = 1;
  const MAX_RESOLVED_BLOCKERS = 100;
  const MAX_DISCOVERIES = 100;
  const MAX_DISCARDED = 50;
  const MAX_EVIDENCE = 50;
  const MAX_CHAT_VIEW_MESSAGES = 16;
  const COMPLETION_STATUSES = ['continue_work', 'ask_clarification', 'blocked', 'ready_for_final'];

  function isoNow(now) {
    return typeof now === 'string' ? now : (now instanceof Date ? now.toISOString() : new Date().toISOString());
  }

  function cleanText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, maxLength);
  }

  function makeId(prefix, text, now) {
    const slug = cleanText(text, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
    return `${prefix}-${slug}-${String(Date.parse(now) || Date.now()).slice(-8)}`;
  }

  function createEmptyContext(now = new Date()) {
    const at = isoNow(now);
    return {
      version: VERSION,
      revision: 0,
      mission: { statement: '', createdAt: null, updatedAt: null },
      winConditions: [],
      activeObjective: null,
      activeSubplan: null,
      blockers: { active: [], resolved: [] },
      discoveries: [],
      discarded: [],
      latestEvidence: [],
      lastDistillation: null,
      lastCheckpoint: null,
      createdAt: at,
      updatedAt: at
    };
  }

  function normalizeStatus(value, allowed, fallback) {
    const status = cleanText(value, 40).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    return allowed.includes(status) ? status : fallback;
  }

  function normalizeSeverity(value) {
    return normalizeStatus(value, ['critical', 'major', 'minor'], 'major');
  }

  function normalizeNature(value) {
    return normalizeStatus(value, ['transient', 'fixable', 'terminal'], 'fixable');
  }

  function normalizeBlocker(item, now) {
    const source = item && typeof item === 'object' ? item : { title: item };
    const title = cleanText(source.title, 1000);
    return {
      ...source,
      id: cleanText(source.id, 100) || makeId('blocker', title || 'blocker', now),
      title,
      details: cleanText(source.details, 3000),
      source: cleanText(source.source, 500),
      severity: normalizeSeverity(source.severity),
      nature: normalizeNature(source.nature),
      count: Number.isFinite(source.count) ? source.count : 1,
      createdAt: source.createdAt || now,
      updatedAt: source.updatedAt || now
    };
  }

  function blockerSortKey(item) {
    const severityRank = { critical: 0, major: 1, minor: 2 };
    const natureRank = { terminal: 0, fixable: 1, transient: 2 };
    return [
      severityRank[normalizeSeverity(item && item.severity)],
      natureRank[normalizeNature(item && item.nature)],
      cleanText(item && item.title, 1000).toLowerCase()
    ];
  }

  function compareBlockers(a, b) {
    const left = blockerSortKey(a);
    const right = blockerSortKey(b);
    for (let index = 0; index < left.length; index++) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  }

  function normalizeWinCondition(item, index, previous, now) {
    const source = typeof item === 'string' ? { title: item } : (item || {});
    const title = cleanText(source.title || source.condition, 500);
    const prior = previous.find(candidate => candidate.id === source.id || candidate.title.toLowerCase() === title.toLowerCase());
    return {
      id: cleanText(source.id, 100) || (prior && prior.id) || makeId('win', title || `condition-${index + 1}`, now),
      title,
      status: normalizeStatus(source.status || (prior && prior.status), ['pending', 'in_progress', 'satisfied'], 'pending'),
      evidence: Array.isArray(source.evidence) ? source.evidence.map(value => cleanText(value, 1000)).filter(Boolean).slice(-20) : ((prior && prior.evidence) || []),
      notes: cleanText(source.notes || (prior && prior.notes), 2000)
    };
  }

  function normalizeContext(input, now = new Date()) {
    const at = isoNow(now);
    const base = createEmptyContext(at);
    const source = input && typeof input === 'object' ? input : {};
    const blockers = source.blockers && typeof source.blockers === 'object' ? source.blockers : {};
    return {
      ...base,
      ...source,
      version: VERSION,
      revision: Number.isFinite(source.revision) ? source.revision : 0,
      mission: {
        statement: cleanText(source.mission && source.mission.statement, 8000),
        createdAt: source.mission && source.mission.createdAt || null,
        updatedAt: source.mission && source.mission.updatedAt || null
      },
      winConditions: Array.isArray(source.winConditions)
        ? source.winConditions.map((item, index) => normalizeWinCondition(item, index, [], at)).filter(item => item.title)
        : [],
      activeObjective: source.activeObjective && source.activeObjective.title ? {
        title: cleanText(source.activeObjective.title, 1000),
        rationale: cleanText(source.activeObjective.rationale, 2000),
        startedAt: source.activeObjective.startedAt || at,
        updatedAt: source.activeObjective.updatedAt || at
      } : null,
      activeSubplan: source.activeSubplan && source.activeSubplan.title ? {
        id: cleanText(source.activeSubplan.id, 100) || makeId('subplan', source.activeSubplan.title, at),
        title: cleanText(source.activeSubplan.title, 1000),
        status: normalizeStatus(source.activeSubplan.status, ['active', 'blocked', 'completed'], 'active'),
        steps: Array.isArray(source.activeSubplan.steps) ? source.activeSubplan.steps.map(step => cleanText(step, 1000)).filter(Boolean).slice(0, 50) : [],
        summary: cleanText(source.activeSubplan.summary, 4000),
        nextAction: cleanText(source.activeSubplan.nextAction, 2000),
        evidence: Array.isArray(source.activeSubplan.evidence) ? source.activeSubplan.evidence.map(value => cleanText(value, 1000)).filter(Boolean).slice(-20) : [],
        startedAt: source.activeSubplan.startedAt || at,
        updatedAt: source.activeSubplan.updatedAt || at,
        completedAt: source.activeSubplan.completedAt || null
      } : null,
      blockers: {
        active: Array.isArray(blockers.active) ? blockers.active.slice(-100).map(item => normalizeBlocker(item, at)).filter(item => item.title).sort(compareBlockers) : [],
        resolved: Array.isArray(blockers.resolved) ? blockers.resolved.map(item => normalizeBlocker(item, at)).filter(item => item.title).slice(-MAX_RESOLVED_BLOCKERS) : []
      },
      discoveries: Array.isArray(source.discoveries) ? source.discoveries.slice(-MAX_DISCOVERIES) : [],
      discarded: Array.isArray(source.discarded) ? source.discarded.slice(-MAX_DISCARDED) : [],
      latestEvidence: Array.isArray(source.latestEvidence) ? source.latestEvidence.map(item => ({
        id: cleanText(item && item.id, 100) || makeId('evidence', item && item.summary, at),
        toolName: cleanText(item && item.toolName, 100),
        summary: cleanText(item && item.summary, 1200),
        outcome: normalizeStatus(item && item.outcome, ['success', 'failure'], 'success'),
        checkpoint: cleanText(item && item.checkpoint, 500),
        at: item && item.at || at
      })).filter(item => item.summary).slice(-MAX_EVIDENCE) : [],
      lastDistillation: source.lastDistillation && typeof source.lastDistillation === 'object' ? {
        subplanId: cleanText(source.lastDistillation.subplanId, 100),
        subplanTitle: cleanText(source.lastDistillation.subplanTitle, 1000),
        kept: Array.isArray(source.lastDistillation.kept) ? source.lastDistillation.kept.map(item => cleanText(item, 4000)).filter(Boolean).slice(-20) : [],
        discarded: Array.isArray(source.lastDistillation.discarded) ? source.lastDistillation.discarded.map(item => cleanText(item, 2000)).filter(Boolean).slice(-20) : [],
        at: source.lastDistillation.at || null
      } : null,
      createdAt: source.createdAt || at,
      updatedAt: source.updatedAt || at
    };
  }

  function requireText(args, key, label) {
    const value = cleanText(args && args[key]);
    if (!value) throw new Error(`${label || key} is required`);
    return value;
  }

  function applyAction(input, action, args = {}, now = new Date()) {
    const at = isoNow(now);
    const state = normalizeContext(input, at);
    const event = { action, at, summary: '' };

    switch (action) {
      case 'update_mission_context': {
        const statement = requireText(args, 'mission', 'mission');
        state.mission = { statement, createdAt: state.mission.createdAt || at, updatedAt: at };
        if (Array.isArray(args.winConditions)) {
          state.winConditions = args.winConditions
            .map((item, index) => normalizeWinCondition(item, index, state.winConditions, at))
            .filter(item => item.title);
        }
        if (Object.prototype.hasOwnProperty.call(args, 'activeObjective')) {
          const objectiveTitle = cleanText(args.activeObjective, 1000);
          state.activeObjective = objectiveTitle
            ? { title: objectiveTitle, rationale: cleanText(args.rationale, 2000), startedAt: state.activeObjective && state.activeObjective.title === objectiveTitle ? state.activeObjective.startedAt : at, updatedAt: at }
            : null;
        }
        event.summary = `Mission updated: ${statement}`;
        break;
      }
      case 'start_subplan': {
        const title = requireText(args, 'title', 'subplan title');
        state.activeSubplan = {
          id: cleanText(args.id, 100) || makeId('subplan', title, at), title, status: 'active',
          steps: Array.isArray(args.steps) ? args.steps.map(step => cleanText(step, 1000)).filter(Boolean).slice(0, 50) : [],
          summary: cleanText(args.summary, 4000), nextAction: cleanText(args.nextAction, 2000), evidence: [],
          startedAt: at, updatedAt: at, completedAt: null
        };
        state.activeObjective = { title: cleanText(args.objective || title, 1000), rationale: cleanText(args.rationale, 2000), startedAt: at, updatedAt: at };
        event.summary = `Subplan started: ${title}`;
        break;
      }
      case 'update_subplan_context': {
        if (!state.activeSubplan) throw new Error('No active subplan exists');
        if (cleanText(args.title)) state.activeSubplan.title = cleanText(args.title, 1000);
        if (Array.isArray(args.steps)) state.activeSubplan.steps = args.steps.map(step => cleanText(step, 1000)).filter(Boolean).slice(0, 50);
        if (args.summary !== undefined) state.activeSubplan.summary = cleanText(args.summary, 4000);
        if (args.nextAction !== undefined) state.activeSubplan.nextAction = cleanText(args.nextAction, 2000);
        if (args.status !== undefined) state.activeSubplan.status = normalizeStatus(args.status, ['active', 'blocked'], state.activeSubplan.status);
        state.activeSubplan.updatedAt = at;
        event.summary = `Subplan updated: ${state.activeSubplan.title}`;
        break;
      }
      case 'complete_subplan': {
        if (!state.activeSubplan) throw new Error('No active subplan exists');
        if (state.blockers.active.length > 0) throw new Error('Subplan completion requires resolving active blockers first');
        const evidence = Array.isArray(args.evidence) ? args.evidence.map(value => cleanText(value, 1000)).filter(Boolean) : [];
        if (evidence.length === 0) throw new Error('Subplan completion requires concrete evidence');
        state.activeSubplan.status = 'completed';
        state.activeSubplan.summary = cleanText(args.summary, 4000) || state.activeSubplan.summary;
        state.activeSubplan.evidence = [...state.activeSubplan.evidence, ...evidence].slice(-20);
        state.activeSubplan.nextAction = cleanText(args.nextAction, 2000);
        state.activeSubplan.updatedAt = at;
        state.activeSubplan.completedAt = at;
        const explicitKeep = Array.isArray(args.keep) ? args.keep.map(item => typeof item === 'string' ? { text: item } : item).filter(Boolean) : [];
        const kept = explicitKeep.length ? explicitKeep : [{
          text: `Completed ${state.activeSubplan.title}: ${state.activeSubplan.summary || 'Verified subplan outcome.'}`,
          category: 'verified_outcome',
          evidence: evidence.join('; ')
        }];
        kept.forEach(item => {
          const text = cleanText(item.text, 4000);
          if (!text || state.discoveries.some(existing => existing.text.toLowerCase() === text.toLowerCase())) return;
          state.discoveries.push({
            id: makeId('discovery', text, at),
            text,
            category: cleanText(item.category, 100) || 'subplan_lesson',
            evidence: cleanText(item.evidence, 2000) || evidence.join('; ').slice(0, 2000),
            promotedAt: at
          });
        });
        state.discoveries = state.discoveries.slice(-MAX_DISCOVERIES);

        const explicitDiscard = Array.isArray(args.discard) ? args.discard.map(item => typeof item === 'string' ? { summary: item } : item).filter(Boolean) : [];
        const tossed = explicitDiscard.length ? explicitDiscard : [{
          summary: `Temporary working details from completed subplan: ${state.activeSubplan.title}`,
          reason: 'Subplan is complete; verified outcome and evidence were retained.'
        }];
        tossed.forEach(item => {
          const summary = cleanText(item.summary, 2000);
          if (!summary) return;
          state.discarded.push({ id: makeId('discarded', summary, at), summary, reason: cleanText(item.reason, 1000), discardedAt: at });
        });
        state.discarded = state.discarded.slice(-MAX_DISCARDED);
        state.lastDistillation = {
          subplanId: state.activeSubplan.id,
          subplanTitle: state.activeSubplan.title,
          kept: kept.map(item => cleanText(item.text, 4000)).filter(Boolean),
          discarded: tossed.map(item => cleanText(item.summary, 2000)).filter(Boolean),
          at
        };
        event.summary = `Subplan completed and distilled: ${state.activeSubplan.title} (${state.lastDistillation.kept.length} kept, ${state.lastDistillation.discarded.length} discarded)`;
        break;
      }
      case 'record_blocker': {
        const title = requireText(args, 'title', 'blocker title');
        const severity = normalizeSeverity(args.severity);
        const nature = normalizeNature(args.nature);
        const existing = state.blockers.active.find(item => item.title.toLowerCase() === title.toLowerCase());
        if (existing) {
          existing.details = cleanText(args.details, 3000) || existing.details;
          existing.severity = severity;
          existing.nature = nature;
          existing.updatedAt = at;
          existing.count = (existing.count || 1) + 1;
        } else {
          state.blockers.active.push({
            id: cleanText(args.id, 100) || makeId('blocker', title, at),
            title,
            details: cleanText(args.details, 3000),
            source: cleanText(args.source, 500),
            severity,
            nature,
            count: 1,
            createdAt: at,
            updatedAt: at
          });
        }
        state.blockers.active = state.blockers.active.sort(compareBlockers);
        if (state.activeSubplan) state.activeSubplan.status = 'blocked';
        event.summary = `Blocker recorded: [${severity.toUpperCase()} / ${nature.toUpperCase()}] ${title}`;
        break;
      }
      case 'resolve_blocker': {
        const identity = requireText(args, 'id', 'blocker id or title');
        const index = state.blockers.active.findIndex(item => item.id === identity || item.title.toLowerCase() === identity.toLowerCase());
        if (index === -1) throw new Error(`Active blocker not found: ${identity}`);
        const blocker = state.blockers.active.splice(index, 1)[0];
        state.blockers.resolved.push({ ...blocker, resolution: requireText(args, 'resolution', 'resolution'), lesson: cleanText(args.lesson, 2000), resolvedAt: at, resolutionType: 'resolved' });
        state.blockers.resolved = state.blockers.resolved.slice(-MAX_RESOLVED_BLOCKERS);
        if (state.activeSubplan && state.blockers.active.length === 0 && state.activeSubplan.status === 'blocked') state.activeSubplan.status = 'active';
        event.summary = `Blocker resolved: ${blocker.title}`;
        break;
      }
      case 'convert_blocker_to_backlog': {
        const identity = requireText(args, 'id', 'blocker id or title');
        const index = state.blockers.active.findIndex(item => item.id === identity || item.title.toLowerCase() === identity.toLowerCase());
        if (index === -1) throw new Error(`Active blocker not found: ${identity}`);
        const blocker = state.blockers.active[index];
        if (blocker.severity !== 'minor') throw new Error('Only minor blockers can be converted to backlog/technical debt');
        const moved = state.blockers.active.splice(index, 1)[0];
        const resolution = cleanText(args.resolution, 1000) || 'Converted to backlog/technical debt; not required for current evidence-backed completion.';
        const lesson = cleanText(args.lesson, 2000) || `${moved.title}: ${moved.details || 'Minor blocker deferred as backlog/technical debt.'}`;
        state.blockers.resolved.push({ ...moved, resolution, lesson, resolvedAt: at, resolutionType: 'backlog', backlog: true });
        state.blockers.resolved = state.blockers.resolved.slice(-MAX_RESOLVED_BLOCKERS);
        const discoveryText = cleanText(args.discovery || `Backlog/technical debt candidate: ${lesson}`, 4000);
        if (discoveryText && !state.discoveries.some(item => item.text.toLowerCase() === discoveryText.toLowerCase())) {
          state.discoveries.push({
            id: makeId('discovery', discoveryText, at),
            text: discoveryText,
            category: 'backlog_candidate',
            evidence: `${moved.severity}/${moved.nature}: ${moved.title}`,
            promotedAt: at
          });
          state.discoveries = state.discoveries.slice(-MAX_DISCOVERIES);
        }
        if (state.activeSubplan && state.blockers.active.length === 0 && state.activeSubplan.status === 'blocked') state.activeSubplan.status = 'active';
        event.summary = `Minor blocker converted to backlog: ${moved.title}`;
        break;
      }
      case 'promote_discovery': {
        const text = requireText(args, 'text', 'discovery text');
        const duplicate = state.discoveries.some(item => item.text.toLowerCase() === text.toLowerCase());
        if (!duplicate) state.discoveries.push({ id: makeId('discovery', text, at), text, category: cleanText(args.category, 100) || 'general', evidence: cleanText(args.evidence, 2000), promotedAt: at });
        state.discoveries = state.discoveries.slice(-MAX_DISCOVERIES);
        event.summary = duplicate ? `Discovery already retained: ${text}` : `Discovery retained: ${text}`;
        break;
      }
      case 'discard_noise': {
        const summary = requireText(args, 'summary', 'discarded context summary');
        state.discarded.push({ id: makeId('discarded', summary, at), summary, reason: cleanText(args.reason, 1000), discardedAt: at });
        state.discarded = state.discarded.slice(-MAX_DISCARDED);
        const discardedKey = summary.toLowerCase();
        state.latestEvidence = state.latestEvidence.filter(item => {
          const evidenceKey = item.summary.toLowerCase();
          return !evidenceKey.includes(discardedKey) && !discardedKey.includes(evidenceKey);
        });
        if (state.lastCheckpoint && cleanText(state.lastCheckpoint.summary, 4000).toLowerCase().includes(discardedKey)) {
          state.lastCheckpoint = null;
        }
        event.summary = `Noise discarded: ${summary}`;
        break;
      }
      case 'record_tool_result': {
        const toolName = requireText(args, 'toolName', 'tool name');
        const summary = requireText(args, 'summary', 'tool result summary');
        const outcome = args.success === false ? 'failure' : 'success';
        state.latestEvidence.push({
          id: makeId('evidence', `${toolName}-${summary}`, at),
          toolName,
          summary,
          outcome,
          checkpoint: cleanText(args.checkpoint, 500),
          at
        });
        state.latestEvidence = state.latestEvidence.slice(-MAX_EVIDENCE);
        state.lastCheckpoint = {
          reason: 'tool_result',
          summary: `${toolName} ${outcome}: ${summary}`.slice(0, 4000),
          nextAction: cleanText(args.nextAction, 2000),
          at
        };
        event.summary = `Tool result recorded: ${toolName} (${outcome})`;
        break;
      }
      case 'evaluate_win_conditions': {
        if (!Array.isArray(args.evaluations) || args.evaluations.length === 0) throw new Error('evaluations array is required');
        args.evaluations.forEach(evaluation => {
          const identity = cleanText(evaluation.id || evaluation.title, 500);
          const condition = state.winConditions.find(item => item.id === identity || item.title.toLowerCase() === identity.toLowerCase());
          if (!condition) {
            const available = state.winConditions.length
              ? state.winConditions.map(c => `"${c.title}"`).join(', ')
              : 'none — call update_mission_context first to define win conditions';
            throw new Error(`Win condition not found: "${identity}". Available win conditions: ${available}`);
          }
          // Normalize status: accept "completed" as an alias for "satisfied" since the model
          // naturally uses "completed" when marking work done. If the value is unrecognized,
          // throw a clear error instead of silently falling back to the existing status (which
          // would cause the condition to stay "pending" forever with no feedback to the model).
          const rawStatus = cleanText(evaluation.status, 40).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
          const normalizedStatus = rawStatus === 'completed' ? 'satisfied' : rawStatus;
          const VALID_WIN_STATUSES = ['pending', 'in_progress', 'satisfied'];
          if (!VALID_WIN_STATUSES.includes(normalizedStatus)) {
            throw new Error(`Invalid win condition status "${evaluation.status}" for "${condition.title}". Valid values: ${VALID_WIN_STATUSES.join(', ')} (or "completed" as alias for "satisfied").`);
          }
          const status = normalizedStatus;
          const evidence = Array.isArray(evaluation.evidence) ? evaluation.evidence.map(value => cleanText(value, 1000)).filter(Boolean) : [];
          if (status === 'satisfied' && evidence.length === 0 && condition.evidence.length === 0) throw new Error(`Win condition '${condition.title}' requires evidence before it can be satisfied`);
          condition.status = status;
          condition.evidence = [...condition.evidence, ...evidence].slice(-20);
          if (evaluation.notes !== undefined) condition.notes = cleanText(evaluation.notes, 2000);
        });
        event.summary = `Evaluated ${args.evaluations.length} win condition(s)`;
        break;
      }
      case 'checkpoint': {
        state.lastCheckpoint = { reason: cleanText(args.reason, 200) || 'agent_checkpoint', summary: cleanText(args.summary, 4000), nextAction: cleanText(args.nextAction, 2000), at };
        event.summary = `Checkpoint: ${state.lastCheckpoint.summary || state.lastCheckpoint.reason}`;
        break;
      }
      default:
        throw new Error(`Unknown operational context action: ${action}`);
    }

    state.revision += 1;
    state.updatedAt = at;
    return { state, event };
  }

  function formatForPrompt(input) {
    const state = normalizeContext(input);
    const hasMissionState = !!(state.mission.statement || state.winConditions.length || state.activeObjective || state.activeSubplan);
    if (!hasMissionState && state.blockers.active.length > 0) return '';
    if (!hasMissionState && state.blockers.active.length === 0) return '';
    const lines = ['[ORION OPERATIONAL CONTEXT - canonical working state]'];
    lines.push(`Mission: ${state.mission.statement || 'Not defined'}`);
    lines.push(`Active objective: ${state.activeObjective ? state.activeObjective.title : 'None'}`);
    lines.push(`Current subplan: ${state.activeSubplan ? `${state.activeSubplan.title} (${state.activeSubplan.status})` : 'None'}`);
    if (state.activeSubplan && state.activeSubplan.nextAction) lines.push(`Next action: ${state.activeSubplan.nextAction}`);
    lines.push('Win conditions:');
    state.winConditions.forEach(item => lines.push(`- [${item.status}] ${item.title}${item.evidence.length ? ` | evidence: ${item.evidence.slice(-2).join('; ')}` : ''}`));
    lines.push('Active blockers:');
    if (state.blockers.active.length === 0) lines.push('- None');
    state.blockers.active.slice().sort(compareBlockers).forEach(item => {
      const label = `[${item.severity.toUpperCase()} / ${item.nature.toUpperCase()}]`;
      lines.push(`- ${label} ${item.id}: ${item.title}${item.details ? ` — ${item.details}` : ''}`);
    });
    lines.push('Blocker triage guidance: resolve critical blockers before major or minor blockers; do not spend loops on minor blockers while critical blockers exist; terminal blockers are plan-invalidating evidence but do not automatically replan yet; transient blockers are retry/backoff candidates; fixable blockers are implementation repair candidates; minor blockers may become backlog/technical debt if all win conditions have evidence.');
    if (state.discoveries.length) {
      lines.push('Retained discoveries:');
      state.discoveries.slice(-12).forEach(item => lines.push(`- ${item.text}`));
    }
    if (state.latestEvidence.length) {
      lines.push('Latest evidence/checkpoints:');
      state.latestEvidence.slice(-8).forEach(item => lines.push(`- [${item.outcome}] ${item.toolName}: ${item.summary}`));
    }
    if (state.lastCheckpoint) {
      lines.push(`Latest checkpoint: ${state.lastCheckpoint.summary || state.lastCheckpoint.reason}`);
      if (state.lastCheckpoint.nextAction) lines.push(`Checkpoint next action: ${state.lastCheckpoint.nextAction}`);
    }
    lines.push('Treat this as working memory, not a transcript. Update it when mission-level state changes; do not store raw logs or temporary output. Never satisfy a win condition without concrete evidence.');
    return lines.join('\n');
  }

  // Assistant text that narrates the agent's own operational status (auth/tool failures,
  // "I will now do X" promises) must not be replayed as if it were still current — the
  // operational context above is the canonical source for that. A substantive answer to the
  // user's actual question (e.g. a list of suggestions) is not self-diagnosis and is safe to
  // replay so later turns can resolve references like "number 1" or "that idea" back to it.
  //
  // This also covers agent.js's own canned run-status fallback templates (e.g. "I inspected the
  // workspace but did not produce the requested answer", "Task finished.", the completion-gate
  // "blocked" message). Those are scaffolding narration about the run itself, not an answer —
  // replaying one back to the model caused it to literally continue/echo its own prior status
  // line instead of treating the next turn as fresh, once assistant messages started being kept
  // in the chat view for conversational continuity.
  function looksLikeSelfDiagnosisOrPromise(text) {
    const normalized = String(text || '').toLowerCase();
    return /\bi (?:encountered|previously|will now|cannot|can't|couldn't|could not|am unable|was unable)\b/.test(normalized) ||
      /\b(prevents? me from|blocked me from|api (?:key|authentication) error|access (?:is|was) denied)\b/.test(normalized) ||
      /did not produce the requested answer/.test(normalized) ||
      /cannot honestly mark this complete yet/.test(normalized) ||
      /completed the next batch of implementation steps/.test(normalized) ||
      /i paused after several automatic continuation passes/.test(normalized) ||
      /did not verify the change with a real test/.test(normalized) ||
      /regression test check that ran after one of these edits failed/.test(normalized) ||
      /i made progress but the plan is not finished yet/.test(normalized) ||
      normalized.trim().startsWith('task finished.');
  }

  function buildRecentChatView(messages, currentInput = '', limit = MAX_CHAT_VIEW_MESSAGES) {
    const input = cleanText(currentInput, 12000);
    const view = (Array.isArray(messages) ? messages : [])
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map(message => ({ role: message.role, text: cleanText(message.text, 3000) }))
      .filter(message => message.text && message.text !== 'Thinking...' && !message.text.startsWith('[COMPACTED CONTEXT SUMMARY]'))
      .filter(message => message.role !== 'assistant' || !looksLikeSelfDiagnosisOrPromise(message.text));
    if (view.length && view[view.length - 1].role === 'user' && view[view.length - 1].text === input) view.pop();
    return view.slice(-Math.max(0, Number(limit) || MAX_CHAT_VIEW_MESSAGES));
  }

  function buildReasoningMessages(input, conversationMessages, currentInput) {
    const state = normalizeContext(input);
    const statePrompt = formatForPrompt(state) || [
      '[ORION OPERATIONAL CONTEXT - canonical working state]',
      'Mission: Not defined',
      'Win conditions: Not defined',
      'Establish the mission and evidence-backed win conditions before treating chat as task state.'
    ].join('\n');
    const messages = [
      { role: 'user', parts: [{ text: statePrompt }] },
      { role: 'model', parts: [{ text: 'Working state loaded. I will reason from it and treat chat as an input/view channel.' }] }
    ];
    const chatView = buildRecentChatView(conversationMessages, currentInput);
    if (chatView.length) {
      messages.push({ role: 'user', parts: [{ text: `[RECENT USER CHAT VIEW - non-canonical]\nThis carries the user's recent intent plus your own recent substantive replies, so you can resolve references like "number 1" or "that idea" back to what you actually said. Self-diagnosis of your own past errors/blockers and "I will now..." promises are deliberately excluded from this view — those are not replayed, so use operational context, notes, files, and tool results for task facts, blockers, and completion evidence, not this chat view.\n\n${chatView.map(item => `${item.role}: ${item.text}`).join('\n\n')}` }] });
      messages.push({ role: 'model', parts: [{ text: 'Recent chat (including my own prior replies, excluding self-diagnosis/promises) received as non-canonical context.' }] });
    }
    messages.push({ role: 'user', parts: [{ text: cleanText(currentInput, 12000) }] });
    return messages;
  }

  function gatherEvidenceText(state) {
    const parts = [];
    state.winConditions.forEach(condition => {
      condition.evidence.forEach(item => parts.push(item));
      if (condition.notes) parts.push(condition.notes);
    });
    if (state.activeSubplan) {
      state.activeSubplan.evidence.forEach(item => parts.push(item));
      if (state.activeSubplan.summary) parts.push(state.activeSubplan.summary);
    }
    state.latestEvidence.forEach(item => {
      parts.push(item.summary);
      if (item.checkpoint) parts.push(item.checkpoint);
    });
    if (state.lastCheckpoint) {
      parts.push(state.lastCheckpoint.summary);
      parts.push(state.lastCheckpoint.nextAction);
    }
    return parts.map(item => cleanText(item, 1200)).filter(Boolean);
  }

  function normalizeExplicitRequirements(requirements) {
    return (Array.isArray(requirements) ? requirements : [])
      .map(item => {
        if (typeof item === 'string') return { title: cleanText(item, 500), status: 'pending' };
        return {
          title: cleanText(item && (item.title || item.text || item.requirement), 500),
          status: normalizeStatus(item && item.status, ['pending', 'in_progress', 'completed', 'x'], 'pending'),
          evidence: Array.isArray(item && item.evidence) ? item.evidence.map(value => cleanText(value, 1000)).filter(Boolean) : []
        };
      })
      .filter(item => item.title);
  }

  function makeGate(status, reasons, details = {}) {
    return {
      status: COMPLETION_STATUSES.includes(status) ? status : 'continue_work',
      reasons: reasons.map(reason => cleanText(reason, 1200)).filter(Boolean),
      missingEvidence: (details.missingEvidence || []).map(item => cleanText(item, 1200)).filter(Boolean),
      blockers: details.blockers || [],
      remainingMinorBlockers: details.remainingMinorBlockers || [],
      backlogCandidates: details.backlogCandidates || [],
      pendingWinConditions: details.pendingWinConditions || [],
      pendingRequirements: details.pendingRequirements || []
    };
  }

  function evaluateCompletionGate(input, options = {}) {
    const state = normalizeContext(input);
    const explicitRequirements = normalizeExplicitRequirements(options.explicitRequirements);
    const reasons = [];
    const missingEvidence = [];
    const evidenceText = gatherEvidenceText(state);
    const hasEvidence = evidenceText.length > 0;
    const hasVerificationEvidence = evidenceText.some(text => /\b(test|tests|smoke|manual|verified|verification|passed|inspected|screenshot|build|lint|typecheck|exit\s*code\s*0|exitcode=0|npm test)\b/i.test(text));

    if (!state.mission.statement) {
      return makeGate('ask_clarification', ['Mission statement is missing; Orion needs a canonical mission before it can judge completion.'], { missingEvidence: ['mission statement'] });
    }

    const activeBlockers = state.blockers.active.slice().sort(compareBlockers);
    const completionBlockingBlockers = activeBlockers.filter(item =>
      item.severity === 'critical' ||
      item.severity === 'major' ||
      item.nature === 'terminal'
    );
    const remainingMinorBlockers = activeBlockers.filter(item => item.severity === 'minor' && item.nature !== 'terminal');
    if (completionBlockingBlockers.length > 0) {
      return makeGate('blocked', ['Critical, major, or terminal blockers remain in operational state.'], {
        blockers: completionBlockingBlockers.map(item => ({ id: item.id, title: item.title, details: item.details, severity: item.severity, nature: item.nature }))
      });
    }

    const pendingWinConditions = state.winConditions
      .filter(condition => condition.status !== 'satisfied')
      .map(condition => ({ id: condition.id, title: condition.title, status: condition.status }));
    if (state.winConditions.length === 0) {
      missingEvidence.push('measurable win conditions');
      reasons.push('No win conditions are defined.');
    } else if (pendingWinConditions.length > 0) {
      reasons.push('One or more win conditions are not satisfied.');
    }

    const unsupportedSatisfied = state.winConditions
      .filter(condition => condition.status === 'satisfied' && condition.evidence.length === 0)
      .map(condition => condition.title);
    unsupportedSatisfied.forEach(title => missingEvidence.push(`evidence for satisfied win condition: ${title}`));

    if (state.activeSubplan && state.activeSubplan.status === 'blocked') {
      return makeGate('blocked', ['The active subplan is blocked.'], { blockers: [{ id: state.activeSubplan.id, title: state.activeSubplan.title, details: state.activeSubplan.summary }] });
    }
    if (state.activeSubplan && state.activeSubplan.status === 'active') {
      reasons.push(`Active subplan is still in progress: ${state.activeSubplan.title}`);
    }
    if (state.activeSubplan && state.activeSubplan.status === 'completed' && state.activeSubplan.evidence.length === 0) {
      missingEvidence.push(`evidence for completed subplan: ${state.activeSubplan.title}`);
    }

    const pendingRequirements = explicitRequirements
      .filter(requirement => requirement.status !== 'completed' && requirement.status !== 'x')
      .map(requirement => ({ title: requirement.title, status: requirement.status }));
    if (pendingRequirements.length > 0) {
      reasons.push('Explicit user requirements or checklist items are still pending.');
    }

    if (!hasEvidence) {
      missingEvidence.push('latest evidence or checkpoint');
      reasons.push('No latest evidence/checkpoints are available.');
    }

    if (options.requireVerificationEvidence !== false && !hasVerificationEvidence) {
      missingEvidence.push('tests, smoke check, manual verification, or inspected evidence');
      reasons.push('No test/smoke/manual verification evidence is recorded.');
    }

    if (reasons.length || missingEvidence.length || pendingWinConditions.length || pendingRequirements.length) {
      return makeGate('continue_work', reasons, { missingEvidence, pendingWinConditions, pendingRequirements });
    }

    return makeGate('ready_for_final', [
      remainingMinorBlockers.length
        ? 'Mission has evidence-backed satisfied win conditions and only minor non-terminal blockers remain as backlog candidates.'
        : 'Mission has evidence-backed satisfied win conditions, no active completion-blocking blockers, and verification evidence.'
    ], {
      remainingMinorBlockers: remainingMinorBlockers.map(item => ({ id: item.id, title: item.title, details: item.details, severity: item.severity, nature: item.nature })),
      backlogCandidates: remainingMinorBlockers.map(item => ({ id: item.id, title: item.title, details: item.details, severity: item.severity, nature: item.nature }))
    });
  }

  const api = { VERSION, createEmptyContext, normalizeContext, applyAction, formatForPrompt, buildRecentChatView, buildReasoningMessages, evaluateCompletionGate, normalizeSeverity, normalizeNature, compareBlockers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionOperationalContext = api;
})(typeof window !== 'undefined' ? window : globalThis);
