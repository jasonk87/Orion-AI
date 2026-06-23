(function initOperationalContext(globalScope) {
  'use strict';

  const VERSION = 1;
  const MAX_RESOLVED_BLOCKERS = 100;
  const MAX_DISCOVERIES = 100;
  const MAX_DISCARDED = 50;

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
        active: Array.isArray(blockers.active) ? blockers.active.slice(-100) : [],
        resolved: Array.isArray(blockers.resolved) ? blockers.resolved.slice(-MAX_RESOLVED_BLOCKERS) : []
      },
      discoveries: Array.isArray(source.discoveries) ? source.discoveries.slice(-MAX_DISCOVERIES) : [],
      discarded: Array.isArray(source.discarded) ? source.discarded.slice(-MAX_DISCARDED) : [],
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
        const existing = state.blockers.active.find(item => item.title.toLowerCase() === title.toLowerCase());
        if (existing) {
          existing.details = cleanText(args.details, 3000) || existing.details;
          existing.updatedAt = at;
          existing.count = (existing.count || 1) + 1;
        } else {
          state.blockers.active.push({ id: cleanText(args.id, 100) || makeId('blocker', title, at), title, details: cleanText(args.details, 3000), source: cleanText(args.source, 500), count: 1, createdAt: at, updatedAt: at });
        }
        if (state.activeSubplan) state.activeSubplan.status = 'blocked';
        event.summary = `Blocker recorded: ${title}`;
        break;
      }
      case 'resolve_blocker': {
        const identity = requireText(args, 'id', 'blocker id or title');
        const index = state.blockers.active.findIndex(item => item.id === identity || item.title.toLowerCase() === identity.toLowerCase());
        if (index === -1) throw new Error(`Active blocker not found: ${identity}`);
        const blocker = state.blockers.active.splice(index, 1)[0];
        state.blockers.resolved.push({ ...blocker, resolution: requireText(args, 'resolution', 'resolution'), lesson: cleanText(args.lesson, 2000), resolvedAt: at });
        state.blockers.resolved = state.blockers.resolved.slice(-MAX_RESOLVED_BLOCKERS);
        if (state.activeSubplan && state.blockers.active.length === 0 && state.activeSubplan.status === 'blocked') state.activeSubplan.status = 'active';
        event.summary = `Blocker resolved: ${blocker.title}`;
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
        event.summary = `Noise discarded: ${summary}`;
        break;
      }
      case 'evaluate_win_conditions': {
        if (!Array.isArray(args.evaluations) || args.evaluations.length === 0) throw new Error('evaluations array is required');
        args.evaluations.forEach(evaluation => {
          const identity = cleanText(evaluation.id || evaluation.title, 500);
          const condition = state.winConditions.find(item => item.id === identity || item.title.toLowerCase() === identity.toLowerCase());
          if (!condition) throw new Error(`Win condition not found: ${identity}`);
          const status = normalizeStatus(evaluation.status, ['pending', 'in_progress', 'satisfied'], condition.status);
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
    if (!state.mission.statement && state.winConditions.length === 0 && !state.activeSubplan && state.blockers.active.length === 0) return '';
    const lines = ['[ORION OPERATIONAL CONTEXT - canonical working state]'];
    lines.push(`Mission: ${state.mission.statement || 'Not defined'}`);
    lines.push(`Active objective: ${state.activeObjective ? state.activeObjective.title : 'None'}`);
    lines.push(`Current subplan: ${state.activeSubplan ? `${state.activeSubplan.title} (${state.activeSubplan.status})` : 'None'}`);
    if (state.activeSubplan && state.activeSubplan.nextAction) lines.push(`Next action: ${state.activeSubplan.nextAction}`);
    lines.push('Win conditions:');
    state.winConditions.forEach(item => lines.push(`- [${item.status}] ${item.title}${item.evidence.length ? ` | evidence: ${item.evidence.slice(-2).join('; ')}` : ''}`));
    lines.push('Active blockers:');
    if (state.blockers.active.length === 0) lines.push('- None');
    state.blockers.active.forEach(item => lines.push(`- ${item.id}: ${item.title}${item.details ? ` — ${item.details}` : ''}`));
    if (state.discoveries.length) {
      lines.push('Retained discoveries:');
      state.discoveries.slice(-12).forEach(item => lines.push(`- ${item.text}`));
    }
    lines.push('Treat this as working memory, not a transcript. Update it when mission-level state changes; do not store raw logs or temporary output. Never satisfy a win condition without concrete evidence.');
    return lines.join('\n');
  }

  const api = { VERSION, createEmptyContext, normalizeContext, applyAction, formatForPrompt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.OrionOperationalContext = api;
})(typeof window !== 'undefined' ? window : globalThis);
