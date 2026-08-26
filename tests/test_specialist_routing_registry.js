'use strict';

// Specialist routing used to be decided by two parts of Orion that disagreed about reality. The
// specialist registry knew Coder, Operator AND Researcher were first-class roles, each with its
// own prompt, tool policy and handoff support. The semantic intent router carried a hard-coded
// list of execution targets that stopped at Operator. Three concrete defects fell out of that one
// root cause:
//
//   1. The classifier was never offered `researcher` in its schema, so it could not choose it.
//   2. resolveExecutionTarget returned Coder the moment inspectionTarget was workspace/project,
//      BEFORE consulting the classifier's explicit choice - so evidence LOCATION overrode work
//      SHAPE. "Read the recent pushes and tell me what changed" is investigation that happens to
//      involve a repository; it was routed as source work because a repository was involved.
//   3. taskTargetMode filtered through the same list, so a Researcher-owned durable task returned
//      '' and the next turn silently re-resolved to Coder, losing task ownership outright.
//
// The fix is structural: targets, capability guidance and ownership all derive from the registry,
// and a specialist is chosen by whether it can actually do the shape of work requested.
//
// NOTE ON SCOPE: these tests own the deterministic half - given a classification, does the router
// route correctly. Whether the model *produces* `researcher` for a given sentence is the
// classifier's judgment and is validated separately against the live model, not asserted here.

const test = require('tape');
const router = require('../semantic-intent-router');
const registry = require('../specialist-registry');

function classification(overrides = {}) {
  return {
    intent: 'new_task',
    requiresExecution: true,
    executionScope: 'none',
    executionTarget: 'none',
    executionSurface: 'none',
    inspectionTarget: 'none',
    inspectionBreadth: 'none',
    standaloneSystemOperation: false,
    orchestrationAction: 'none',
    ...overrides
  };
}

const route = (overrides, input = {}) => router.resolveExecutionTarget(classification(overrides), input);

// ── The list itself is registry-derived ───────────────────────────────────────

test('execution targets are derived from the specialist registry, not maintained in the router', t => {
  const registered = registry.list().map(definition => definition.role);
  t.deepEqual(
    router.EXECUTION_TARGETS.slice().sort(),
    ['none', 'dispatch', ...registered].sort(),
    'targets are exactly none + dispatch + every registered specialist'
  );
  registered.forEach(role => {
    t.ok(router.EXECUTION_TARGETS.includes(role), role + ' is a first-class execution target');
  });
  t.ok(router.EXECUTION_TARGETS.includes('researcher'),
    'Researcher in particular - the role the hard-coded list omitted');
  t.end();
});

test('the classifier schema offers every registered specialist', t => {
  const prompt = router.buildClassifierPrompt({ userMessage: 'anything' });
  const schemaLine = (prompt.match(/"executionTarget": "([^"]*)"/) || [])[1] || '';
  const offered = schemaLine.split('|').map(part => part.trim()).filter(Boolean);
  registry.list().forEach(definition => {
    t.ok(offered.includes(definition.role),
      definition.role + ' is offered to the model as a choosable target');
  });
  t.ok(offered.includes('dispatch') && offered.includes('none'), 'dispatch and none remain offered');
  t.end();
});

test('the classifier is told each role capabilities from the registry, not example phrasings', t => {
  const prompt = router.buildClassifierPrompt({ userMessage: 'anything' });
  registry.list().forEach(definition => {
    t.ok(prompt.includes(definition.role + ' (' + definition.label + ')'),
      definition.role + ' has its own capability line');
    definition.capabilitySummary.forEach(capability => {
      t.ok(prompt.includes(capability), definition.role + ' capability is passed through verbatim: ' + capability);
    });
  });
  // The guidance must argue from work shape, not from trigger phrases.
  t.ok(/not by where its evidence happens to live/i.test(prompt),
    'the prompt states that evidence location does not decide the specialist');
  t.end();
});

test('registering a specialist is the only thing needed to teach the router about it', t => {
  // The derivation, not a snapshot: every guidance line corresponds to a registered role and
  // vice versa, so a new registry entry cannot be silently missing from routing.
  const guidance = router.specialistCapabilityGuidance();
  t.equal(guidance.length, registry.list().length, 'exactly one guidance line per registered role');
  registry.list().forEach(definition => {
    t.equal(
      guidance.filter(line => line.includes(definition.role + ' (' + definition.label + ')')).length,
      1,
      definition.role + ' appears exactly once'
    );
  });
  t.end();
});

// ── Work shape decides, not evidence location ─────────────────────────────────

test('the same repository evidence routes by the shape of the work, not by being a repository', t => {
  // Read the history to explain what it means: investigation and synthesis.
  t.equal(
    route({
      executionTarget: 'researcher', executionScope: 'read_only',
      inspectionTarget: 'project', inspectionBreadth: 'broad'
    }),
    'researcher',
    'historical multi-artifact synthesis stays with Researcher even though the evidence is a codebase'
  );
  // Read the same history to find and correct a defect: diagnosis and mutation.
  t.equal(
    route({
      executionTarget: 'coder', executionScope: 'mutating',
      inspectionTarget: 'project', inspectionBreadth: 'broad'
    }),
    'coder',
    'diagnosing and fixing over the same evidence is Coder work'
  );
  t.end();
});

test('the reported regression: an explicit Researcher choice is no longer overridden by project evidence', t => {
  ['workspace', 'project'].forEach(inspectionTarget => {
    t.equal(
      route({ executionTarget: 'researcher', executionScope: 'read_only', inspectionTarget }),
      'researcher',
      'inspectionTarget=' + inspectionTarget + ' does not steal the work back to Coder'
    );
  });
  t.end();
});

test('each paraphrase of the reported request routes to Researcher on its structure alone', t => {
  // These are the structured classifications a competent classifier returns for the user paraphrases
  // ("look through the last several pushes and tell me what changed", "read the recent commits and
  // explain the pattern", "compare the last few architectural changes", "why has Orion been getting
  // better lately? check the history"). What they share is SHAPE - read-only, broad, historical,
  // multi-artifact - not any particular wording, and that shape is what routes them.
  const shapes = [
    { label: 'tell me what changed across recent pushes', contextNeed: 'historical', inspectionBreadth: 'broad' },
    { label: 'explain the pattern in recent commits', contextNeed: 'historical', inspectionBreadth: 'broad' },
    { label: 'compare the last few architectural changes', contextNeed: 'project', inspectionBreadth: 'broad' },
    { label: 'why has this been getting better lately', contextNeed: 'historical', inspectionBreadth: 'broad' }
  ];
  shapes.forEach(shape => {
    t.equal(
      route({
        executionTarget: 'researcher',
        executionScope: 'read_only',
        inspectionTarget: 'project',
        inspectionBreadth: shape.inspectionBreadth,
        reasoningPolicyHint: { complexity: 'high', risk: 'low', contextNeed: shape.contextNeed }
      }),
      'researcher',
      shape.label + ' -> Researcher'
    );
  });
  // The counterexample from the same family: diagnosis plus a fix is Coder work.
  t.equal(
    route({
      executionTarget: 'coder', executionScope: 'mutating',
      inspectionTarget: 'project', inspectionBreadth: 'broad'
    }),
    'coder',
    'find the commit that broke scheduling and fix it -> Coder'
  );
  t.end();
});

// ── Capability coherence: an incapable choice is redirected, not obeyed ────────

test('a specialist that cannot do the requested work does not receive it', t => {
  t.equal(
    route({ executionTarget: 'researcher', executionScope: 'mutating', inspectionTarget: 'project' }),
    'coder',
    'Researcher cannot edit the workspace, so mutating project work goes to the role that can'
  );
  t.equal(
    route({ executionTarget: 'researcher', executionSurface: 'desktop', inspectionTarget: 'project' }),
    'operator',
    'Researcher cannot control the desktop, so desktop work goes to the role that can'
  );
  t.equal(
    route({ executionTarget: 'researcher', inspectionTarget: 'local_system' }),
    'operator',
    'Researcher cannot inspect the local machine, so machine facts go to the role that can'
  );
  t.equal(
    route({ executionTarget: 'coder', executionSurface: 'desktop', inspectionTarget: 'project' }),
    'operator',
    'Coder cannot control the desktop either - the rule is capability, not role identity'
  );
  t.end();
});

test('capability checks read the registry rather than a role name list', t => {
  // Every redirect above must be explainable by a registry flag, so the routing rule generalizes
  // to a specialist that does not exist yet.
  const researcher = registry.get('researcher');
  const coder = registry.get('coder');
  const operator = registry.get('operator');
  t.equal(researcher.canEditWorkspace, false, 'Researcher is declared unable to edit the workspace');
  t.equal(researcher.canControlDesktop, false, 'Researcher is declared unable to control the desktop');
  t.equal(researcher.canInspectLocalSystem, false, 'Researcher is declared unable to inspect the machine');
  t.equal(coder.canEditWorkspace, true, 'Coder is the workspace-editing capability');
  t.equal(operator.canControlDesktop, true, 'Operator is the desktop capability');
  t.equal(operator.canInspectLocalSystem, true, 'Operator is the local-machine capability');
  t.end();
});

test('a read-only browser surface survives for Researcher instead of being flattened to none', t => {
  t.equal(
    route({ executionTarget: 'researcher', executionScope: 'read_only', executionSurface: 'browser' }),
    'researcher',
    'Researcher keeps browser work it is registered to perform'
  );
  t.deepEqual(registry.get('researcher').executionSurfaces.slice().sort(), ['browser', 'none'],
    'and the registry is the reason why');
  t.end();
});

// ── Durable ownership is a fact, not a preference ─────────────────────────────

test('an owned durable task keeps its specialist across a follow-up turn, for every role', t => {
  registry.list().forEach(definition => {
    ['steer_active_task', 'context_followup'].forEach(intent => {
      t.equal(
        route({ intent, executionTarget: 'coder' }, { activeOwnedTask: { targetMode: definition.role } }),
        definition.role,
        'a ' + definition.role + '-owned task survives ' + intent + ' regardless of what the classifier guessed'
      );
    });
    t.equal(
      route({ intent: 'context_followup', executionTarget: 'none' }, { recentOwnedTask: { targetMode: definition.role } }),
      definition.role,
      'a recent ' + definition.role + ' task supplies the target for a continuation'
    );
  });
  t.end();
});

test('the Researcher ownership bug specifically: continuing Researcher work no longer becomes Coder work', t => {
  const resolved = route(
    { intent: 'context_followup', executionTarget: 'researcher' },
    { activeOwnedTask: { targetMode: 'researcher' } }
  );
  t.equal(resolved, 'researcher', 'the durable task binding is preserved');
  t.notEqual(resolved, 'coder', 'and cannot silently become a second Coder task');
  t.end();
});

// ── Existing routing behavior must not regress ────────────────────────────────

test('previously correct routing is unchanged', t => {
  t.equal(route({ requiresExecution: false, intent: 'conversation' }), 'none',
    'non-executable turns still route nowhere');
  t.equal(
    route({ executionTarget: 'dispatch', orchestrationAction: 'schedule_followup' }),
    'dispatch',
    'Dispatch keeps its own orchestration'
  );
  t.equal(
    route({ executionTarget: 'operator', executionSurface: 'desktop', inspectionTarget: 'project' }),
    'operator',
    'a desktop playtest of a project stays with Operator rather than being stolen by project evidence'
  );
  t.equal(route({ standaloneSystemOperation: true }), 'operator', 'standalone machine work stays with Operator');
  t.equal(route({ inspectionTarget: 'local_system' }), 'operator', 'local-system evidence stays with Operator');
  t.equal(route({ inspectionTarget: 'project' }), 'coder',
    'project evidence with no explicit specialist still defaults to Coder');
  t.equal(route({ executionTarget: 'none' }), 'coder', 'unclassified executable work still defaults to Coder');
  t.end();
});

test('end to end through classify(), a Researcher classification survives normalization', async t => {
  const result = await router.classify(
    { userMessage: 'Look through the last several pushes and tell me what changed.', conversationId: 'dispatch-1', mode: 'orion' },
    {
      classify: async () => ({
        intent: 'new_task',
        requiresExecution: true,
        target: 'current_conversation',
        resolvedRequest: 'Review the recent pushes and summarize what changed and what pattern they show.',
        confidence: 0.95,
        reasoningPolicyHint: { complexity: 'high', risk: 'low', contextNeed: 'historical' },
        executionScope: 'read_only',
        executionTarget: 'researcher',
        executionSurface: 'none',
        inspectionTarget: 'project',
        inspectionBreadth: 'broad'
      })
    }
  );
  t.equal(result.executionTarget, 'researcher', 'normalization does not downgrade Researcher to Coder');
  t.equal(result.executionScope, 'read_only', 'the read-only scope survives');
  t.equal(result.inspectionBreadth, 'broad', 'the broad evidence requirement survives');
  t.equal(result.requiresExecution, true, 'it is still executable work');
  t.end();
});
