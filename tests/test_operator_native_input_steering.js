'use strict';

// Regression coverage for the second half of the same playtest bug pair: to focus the game window
// and send movement keys to "This is Life", Operator shelled out via run_command to PowerShell
// (WScript.Shell-style AppActivate/SendKeys) instead of using the dedicated open_application and
// computer_action tools. Investigation found the necessary tools already existed and were already
// exempt from operator-execution-policy.js's raw-diagnostic-call cap (open_application and
// computer_action are in SCREEN_ACTION_TOOLS, never RAW_DIAGNOSTIC_TOOLS) - so this was never a
// missing-capability gap, it was a prompt/tool-description clarity gap: nothing told the model not
// to reach for run_command for input, and open_application's description implied it only mattered
// when an app was "not already visible."
//
// By the time this file was written, OPERATOR_INSTRUCTION, open_application's tool description, and
// operator-execution-policy.js's policy-violation message had already been tightened (in commits
// fb431c7/92501f3/1169d20) to steer input/focus toward computer_action/open_application and away
// from run_command/PowerShell/WScript.Shell/SendKeys, and to cover "covered, minimized, or in the
// background" windows explicitly, not just "not visible" ones. The one place this guidance was
// still missing was run_command's own tool-schema description - the thing the model is told is the
// authoritative source of truth for a tool's behavior (see OrionOperatingContract.TOOL_SCHEMA_NOTE).
// This file locks in that fix and guards the rest of the steering against regressing.

const fs = require('fs');
const path = require('path');

const test = require('tape');

const agentJs = fs.readFileSync(path.join(__dirname, '../agent.js'), 'utf8').replace(/\r\n/g, '\n');
const policyJs = fs.readFileSync(path.join(__dirname, '../operator-execution-policy.js'), 'utf8').replace(/\r\n/g, '\n');

function extractToolDescription(source, toolName) {
  // Tool declarations are object literals like: name: "run_command", description: "...",
  // possibly single- or double-quoted. Grab the description string that immediately follows the
  // matching name so this test evolves with quoting changes and single-line reflow, without regex
  // over the whole file (a narrow, targeted match, not a broad pattern-matching hack on prose).
  const nameIndex = source.indexOf(`name: "${toolName}"`) >= 0
    ? source.indexOf(`name: "${toolName}"`)
    : source.indexOf(`name: '${toolName}'`);
  if (nameIndex === -1) return null;
  const descriptionKey = 'description:';
  const descStart = source.indexOf(descriptionKey, nameIndex);
  if (descStart === -1) return null;
  let cursor = descStart + descriptionKey.length;
  while (source[cursor] === ' ') cursor += 1;
  const quoteChar = source[cursor];
  if (quoteChar !== '"' && quoteChar !== "'") return null;
  let end = cursor + 1;
  while (end < source.length) {
    if (source[end] === '\\') { end += 2; continue; }
    if (source[end] === quoteChar) break;
    end += 1;
  }
  return source.slice(cursor + 1, end);
}

test('run_command tool schema description warns against native keyboard/window input and points to the dedicated tools', t => {
  const description = extractToolDescription(agentJs, 'run_command');
  t.ok(description, 'run_command tool declaration is present');
  t.match(description, /never use this for keyboard|never use.*(keyboard|input)/i, 'the schema itself (not just prompt prose) warns against using run_command for input');
  t.match(description, /computer_action/, 'the schema points to computer_action as the correct tool for input');
  t.match(description, /open_application/, 'the schema points to open_application as the correct tool for window focus/activation');
  t.end();
});

test('open_application tool description already covers a visible-but-unfocused window, not just an absent one', t => {
  const description = extractToolDescription(agentJs, 'open_application');
  t.ok(description, 'open_application tool declaration is present');
  t.match(description, /covered|minimized|background/i, 'the description explicitly covers a window that is visible but not focused, not only a genuinely absent app');
  t.end();
});

test('OPERATOR_INSTRUCTION explicitly steers native input away from run_command/PowerShell', t => {
  const instructionStart = agentJs.indexOf('const OPERATOR_INSTRUCTION');
  t.ok(instructionStart >= 0, 'OPERATOR_INSTRUCTION is defined');
  const instructionSlice = agentJs.slice(instructionStart, instructionStart + 6000);
  t.match(instructionSlice, /Use computer_action for visible clicks, typing, hotkeys/i, 'the prompt tells Operator to use computer_action for real input');
  t.match(instructionSlice, /Never use run_command, terminal_exec, PowerShell automation, WScript\.Shell, or SendKeys/i, 'the prompt explicitly names and forbids the exact failure mode from the playtest');
  // The invariant is that open_application covers an existing-but-unfocused window, not only a
  // missing one. It used to be phrased "after the first inspection", which is no longer true and
  // was never what this guard was about: a named application is grounded by its name, and the
  // launcher's own existing-window check is what prevents the duplicate launch.
  t.match(instructionSlice, /open_application to activate an application's existing window even if it is merely covered, minimized, or in the background/i, 'the prompt tells Operator open_application covers an existing-but-unfocused window, not only a missing one');
  t.match(instructionSlice, /launches a new instance only when none exists/i, 'and that a duplicate launch is prevented by the tool itself');
  t.end();
});

test('operator-execution-policy.js steers a blocked raw-diagnostic attempt toward the dedicated tools instead of PowerShell', t => {
  t.match(policyJs, /Do not use PowerShell, WScript, SendKeys, or terminal commands as a substitute for visible input/i, 'the policy-violation message itself names and forbids the PowerShell/WScript/SendKeys pattern');
  t.match(policyJs, /open_application for a named app/i, 'the policy-violation message redirects to open_application');
  t.match(policyJs, /computer_action only for a visual target/i, 'the policy-violation message redirects to computer_action');
  t.end();
});

test("operator-execution-policy.js's raw-diagnostic cap does not apply to open_application or computer_action - they were never the bottleneck", t => {
  const policy = require('../operator-execution-policy');
  t.notOk(policy.RAW_DIAGNOSTIC_TOOLS.has('open_application'), 'open_application is not a raw diagnostic tool');
  t.notOk(policy.RAW_DIAGNOSTIC_TOOLS.has('computer_action'), 'computer_action is not a raw diagnostic tool');
  t.ok(policy.SCREEN_ACTION_TOOLS.has('open_application'), 'open_application is tracked as a screen action instead');
  t.ok(policy.SCREEN_ACTION_TOOLS.has('computer_action'), 'computer_action is tracked as a screen action instead');
  t.end();
});
