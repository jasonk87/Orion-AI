(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OrionWorkspaceResolution = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const KINDS = Object.freeze({
    ACTIVE_PROJECT: 'active_project',
    PROJECT_SEARCH_ROOT: 'project_search_root',
    STANDALONE_CODER: 'standalone_coder',
    UNRESOLVED: 'unresolved'
  });

  function cleanPath(value) {
    return String(value || '').trim().replace(/[\\/]+$/, '');
  }

  function pathKey(value) {
    return cleanPath(value).replace(/[\\/]+/g, '\\').toLowerCase();
  }

  function baseName(value) {
    const cleaned = cleanPath(value);
    return cleaned.split(/[\\/]/).pop() || '';
  }

  function samePath(left, right) {
    return !!pathKey(left) && pathKey(left) === pathKey(right);
  }

  function isWithinPath(child, parent) {
    const childKey = pathKey(child);
    const parentKey = pathKey(parent);
    return !!childKey && !!parentKey && (childKey === parentKey || childKey.startsWith(parentKey + '\\'));
  }

  function normalizeProjectList(values) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const item = typeof value === 'string' ? { path: value } : (value || {});
      const projectPath = cleanPath(item.path || item.projectPath || item.workspace);
      if (!projectPath) continue;
      const key = pathKey(projectPath);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        path: projectPath,
        name: String(item.name || item.projectName || baseName(projectPath)).trim(),
        source: String(item.source || 'registered_project')
      });
    }
    return result;
  }

  function classifyWorkspace(input = {}) {
    const mode = input.mode === 'coder' ? 'coder' : 'orion';
    const searchRoot = cleanPath(input.searchRoot);
    const standaloneRoot = cleanPath(input.standaloneRoot);
    const projectPath = cleanPath(input.projectPath || input.dispatchProjectPath);
    const workspacePath = cleanPath(input.workspacePath || input.workspace || projectPath);
    const knownProjects = normalizeProjectList(input.knownProjects);
    const known = knownProjects.find(project => samePath(project.path, projectPath || workspacePath));

    if (mode === 'coder' && workspacePath && standaloneRoot && isWithinPath(workspacePath, standaloneRoot) && !projectPath) {
      return {
        kind: KINDS.STANDALONE_CODER,
        path: workspacePath,
        projectPath: '',
        projectName: baseName(workspacePath) || 'Standalone',
        source: 'standalone_workspace',
        changed: false
      };
    }

    if (projectPath || known) {
      const resolved = known ? known.path : projectPath;
      return {
        kind: KINDS.ACTIVE_PROJECT,
        path: resolved,
        projectPath: resolved,
        projectName: (known && known.name) || baseName(resolved),
        source: (known && known.source) || (input.dispatchProjectPath ? 'dispatch_binding' : 'conversation_project'),
        changed: false
      };
    }

    if (workspacePath && knownProjects.some(project => samePath(project.path, workspacePath))) {
      const resolved = knownProjects.find(project => samePath(project.path, workspacePath));
      return {
        kind: KINDS.ACTIVE_PROJECT,
        path: resolved.path,
        projectPath: resolved.path,
        projectName: resolved.name,
        source: resolved.source,
        changed: false
      };
    }

    if ((workspacePath && searchRoot && samePath(workspacePath, searchRoot)) || (!workspacePath && searchRoot && mode === 'orion')) {
      return {
        kind: KINDS.PROJECT_SEARCH_ROOT,
        path: searchRoot,
        projectPath: '',
        projectName: '',
        source: 'configured_search_root',
        changed: false
      };
    }

    if (mode === 'coder' && workspacePath) {
      return {
        kind: KINDS.STANDALONE_CODER,
        path: workspacePath,
        projectPath: '',
        projectName: baseName(workspacePath) || 'Standalone',
        source: 'conversation_workspace',
        changed: false
      };
    }

    return {
      kind: KINDS.UNRESOLVED,
      path: workspacePath || '',
      projectPath: '',
      projectName: '',
      source: workspacePath ? 'unclassified_workspace' : 'none',
      changed: false
    };
  }

  function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  }

  function extractProjectReferences(text) {
    const raw = String(text || '');
    const candidates = [];
    const add = value => {
      const cleaned = String(value || '').trim().replace(/^["'`]|["'`.,!?;:]$/g, '');
      if (cleaned.length < 2 || cleaned.length > 80) return;
      if (!candidates.some(item => normalizeName(item) === normalizeName(cleaned))) candidates.push(cleaned);
    };
    const namedPatterns = [
      /\b(?:project|app|application|program|game|repo(?:sitory)?)\s+(?:called|named)\s+["'`]?([a-z0-9][a-z0-9 _&.-]{1,60})/gi,
      /\b(?:in|for|about|on|inside)\s+(?:the\s+)?([A-Z][A-Z0-9_-]{2,})\b/g
    ];
    for (const pattern of namedPatterns) {
      let match;
      while ((match = pattern.exec(raw))) add(match[1]);
    }
    for (const match of raw.matchAll(/\b[A-Z][A-Z0-9_-]{2,}\b/g)) {
      if (!/^(?:PR|API|UI|URL|SQL|HTTP|HTTPS|JSON|AI|LLM|CPU|RAM|CI)$/.test(match[0])) add(match[0]);
    }
    return candidates.slice(0, 8);
  }

  function findNamedProject(text, projectSources = []) {
    const projects = normalizeProjectList(projectSources);
    if (!projects.length) return null;
    const normalizedText = normalizeName(text);
    const references = extractProjectReferences(text);
    let best = null;
    for (const project of projects) {
      const nameKey = normalizeName(project.name || baseName(project.path));
      if (!nameKey) continue;
      let score = 0;
      if (references.some(reference => normalizeName(reference) === nameKey)) score = 100;
      else if (normalizedText.includes(nameKey)) score = 80;
      else if (references.some(reference => {
        const refKey = normalizeName(reference);
        return refKey.length >= 4 && (nameKey.includes(refKey) || refKey.includes(nameKey));
      })) score = 60;
      if (!best || score > best.score) best = { ...project, score };
    }
    return best && best.score > 0 ? best : null;
  }

  function bindResolvedProject(resolution, project, source = '') {
    if (!project || !cleanPath(project.path || project.projectPath)) return resolution;
    const projectPath = cleanPath(project.path || project.projectPath);
    return {
      kind: KINDS.ACTIVE_PROJECT,
      path: projectPath,
      projectPath,
      projectName: String(project.name || project.projectName || baseName(projectPath)),
      source: source || project.source || 'resolved_project',
      changed: !resolution || !samePath(resolution.path, projectPath)
    };
  }

  function describeWorkspace(resolution, namedProject = '') {
    const value = resolution || { kind: KINDS.UNRESOLVED, path: '' };
    if (value.kind === KINDS.ACTIVE_PROJECT) {
      return `Active project workspace: ${value.path}${value.projectName ? ` (${value.projectName})` : ''}.`;
    }
    if (value.kind === KINDS.PROJECT_SEARCH_ROOT) {
      const target = String(namedProject || '').trim();
      return target
        ? `This conversation is not attached to a specific project yet. I will search the Projects directory for ${target}. Search root: ${value.path}.`
        : `This conversation is not attached to a specific project yet. ${value.path} is the project search root, not a selected project workspace.`;
    }
    if (value.kind === KINDS.STANDALONE_CODER) return `Standalone Coder workspace: ${value.path}.`;
    return 'This conversation does not have a resolved workspace yet.';
  }

  function canHandoffWorkspace(resolution) {
    const allowed = !!(resolution && (resolution.kind === KINDS.ACTIVE_PROJECT || resolution.kind === KINDS.STANDALONE_CODER) && resolution.path);
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: resolution && resolution.kind === KINDS.PROJECT_SEARCH_ROOT
        ? 'The Projects directory is only a search root; resolve a specific project before handoff.'
        : 'No concrete project or standalone workspace is resolved for handoff.' };
  }

  return {
    KINDS,
    cleanPath,
    pathKey,
    samePath,
    baseName,
    normalizeProjectList,
    classifyWorkspace,
    extractProjectReferences,
    findNamedProject,
    bindResolvedProject,
    describeWorkspace,
    canHandoffWorkspace
  };
});
