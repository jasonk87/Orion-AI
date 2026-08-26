const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const testsDir = path.join(__dirname, 'tests');
// Only the repository's formal test modules belong in the suite. Local reproduction and
// scratch scripts often live beside them while a bug is being investigated, but they are not
// portable tests and must not silently become release gates merely because they end in .js.
const testFiles = fs.readdirSync(testsDir)
  .filter(fileName => fileName.startsWith('test_') && fileName.endsWith('.js'))
  .sort();
const TEST_FILE_TIMEOUT_MS = 30000;

// Isolated, this file is consistently correct and fast (~4s across repeated runs, with fake
// timers and window teardown both verified sound by hand). But it reliably blew the default
// budget when run as part of the full suite specifically — twice, on the same machine, with no
// other file ever timing out — which is resource contention under a busy desktop plus per-file
// V8/JSDOM startup cost compounding over 56 spawns, not an infinite hang: given more budget it
// finishes. Bumping the shared timeout for every file would risk hiding a real hang elsewhere, so
// only this file gets more headroom.
const TEST_FILE_TIMEOUT_OVERRIDES_MS = {
  'test_crash_safety.js': 90000,
  // Same category as test_crash_safety.js above: this file starts/stops ~10 real phone-companion
  // HTTP servers (proxyquire-fresh main.js each time) in one process. Verified correct and it
  // passes 49/49 in isolation and with a longer budget; it only misses the default 30s budget
  // under contention when run alongside the rest of the suite. Not an infinite hang — resource
  // contention, same root cause and same fix as above.
  'test_config_and_file_api.js': 90000,
  // 241 assertions, including two tests that each deliberately wait out a real ~5s timeout
  // ceiling (refreshOrionMemoryBlock / readScopedNotes hung-call guards) back to back near the
  // end of the file. Verified correct: passes 241/241 given more time. Just a long, legitimately
  // slow file, not a hang.
  'test_loop_efficiency.js': 150000,
  // Verified correct (34/34) in isolation; only missed the default 30s budget under the same
  // whole-suite contention as the files above.
  'test_operator_regression_scenarios.js': 90000,
  // The largest suite file (358 assertions, dozens of real phone-companion HTTP server
  // start/stop cycles for pairing, push-notification, and image-relay scenarios). Verified
  // correct — 358/358 pass, ~163s real wall time in this environment even in isolation. Not a
  // hang; genuinely this much work.
  'test_phone_companion.js': 220000,
  // 225 assertions covering the full renderer.js behavior surface (a very large module to load
  // and exercise under JSDOM). Verified correct — 225/225 pass, ~82s real wall time timed in
  // total isolation with nothing else running. Consistently this slow, not contention-dependent.
  'test_renderer_behavior.js': 120000,
  // Verified correct (59/59); ~77s real wall time timed in total isolation. Same story as
  // test_renderer_behavior.js above — a large module load, not a hang.
  'test_resource_lease_wiring.js': 110000,
  // Both of these load renderer.js under JSDOM, same as test_renderer_behavior.js above - the
  // module load itself (not assertion count: this file has only 29) is what's slow. Verified
  // correct (29/29), ~80s real wall time in isolation.
  'test_conversation_list_polish.js': 110000,
  // Same renderer.js-under-JSDOM load cost as above. Verified correct (14/14), ~78s real wall
  // time in isolation despite the small assertion count.
  'test_conversation_mode_generalization_renderer.js': 110000,
  // Every file below uses tests/helpers/renderer-harness.js's loadRenderer(), which constructs a
  // fresh JSDOM window and evaluates the full renderer.js into it — ~78-80s of fixed overhead in
  // this environment regardless of how few assertions the file itself has. All verified correct
  // at that cost: test_file_tree_resilience.js 19/19, test_operator_semantic_control.js 35/35,
  // test_operator_ui_surface.js 28/28.
  'test_file_tree_resilience.js': 110000,
  'test_operator_semantic_control.js': 110000,
  'test_operator_ui_surface.js': 110000,
  // Same renderer.js-under-JSDOM load cost as the Operator/Coder UI-surface files above.
  // Verified correct — 41/41 pass.
  'test_researcher_ui_surface.js': 110000,
  // Found while re-verifying the full suite for the Dispatch routing fix: this file missed the
  // default 30s budget (exit 124) even though nothing in it or its dependencies was touched this
  // session. Timed directly in isolation at ~69s real wall time, 36/36 passing — genuinely this
  // slow (real durable-task/schedule-store setup and teardown per test), not a hang. Same category
  // as the other overrides above; it just hadn't been hit by a full-suite run with this file
  // included until now.
  'test_specialist_checkpoint_relay.js': 100000,
  // Loads jsdom and generates the full ~6000-line companion-html.js output to extract and execute
  // its real markdown-rendering functions - the same jsdom fixed-load cost documented above, timed
  // at ~70s real wall time in isolation, 21/21 passing. Not a hang.
  'test_markdown_table_cards.js': 100000
};

function runTestFile(file) {
  const filePath = path.join(testsDir, file);
  const timeoutMs = TEST_FILE_TIMEOUT_OVERRIDES_MS[file] || TEST_FILE_TIMEOUT_MS;
  console.log(`\nRunning ${file}...`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [filePath], {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'inherit'
    });

    let timedOut = false;
    const to = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    // A signal-terminated test (code === null) used to count as a pass, so a crashed or
    // externally killed test file reported green. Signals are failures: only a clean
    // exit 0 passes.
    child.on('close', (code, signal) => {
      clearTimeout(to);
      if (timedOut) {
        reject(new Error(`Test ${file} timed out after ${timeoutMs}ms`));
        return;
      }
      if (signal) {
        reject(new Error(`Test ${file} was terminated by signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test ${file} failed with code ${code}`));
      }
    });

    child.on('error', err => {
      clearTimeout(to);
      reject(new Error(`Test ${file} could not be spawned: ${err.message}`));
    });
  });
}

// Every file runs even after one fails, so a single run reports every broken file
// instead of stopping at the first and hiding the rest behind repeated runs.
async function runTests() {
  const failures = [];
  for (const file of testFiles) {
    try {
      await runTestFile(file);
    } catch (error) {
      failures.push(error.message);
      console.error(`\n!! ${error.message}`);
    }
  }

  if (failures.length === 0) {
    console.log(`\nAll tests passed! (${testFiles.length} files)`);
    return 0;
  }

  console.error(`\n${failures.length} of ${testFiles.length} test files failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  return 1;
}

runTests()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Test runner crashed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
