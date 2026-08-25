const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const testsDir = path.join(__dirname, 'tests');
const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.js')).sort();
const TEST_FILE_TIMEOUT_MS = 30000;

// Isolated, this file is consistently correct and fast (~4s across repeated runs, with fake
// timers and window teardown both verified sound by hand). But it reliably blew the default
// budget when run as part of the full suite specifically — twice, on the same machine, with no
// other file ever timing out — which is resource contention under a busy desktop plus per-file
// V8/JSDOM startup cost compounding over 56 spawns, not an infinite hang: given more budget it
// finishes. Bumping the shared timeout for every file would risk hiding a real hang elsewhere, so
// only this file gets more headroom.
const TEST_FILE_TIMEOUT_OVERRIDES_MS = {
  'test_crash_safety.js': 90000
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
