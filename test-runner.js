const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const testsDir = path.join(__dirname, 'tests');
const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.js')).sort();
const TEST_FILE_TIMEOUT_MS = 30000;

function runTestFile(file) {
  const filePath = path.join(testsDir, file);
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
    }, TEST_FILE_TIMEOUT_MS);

    // A signal-terminated test (code === null) used to count as a pass, so a crashed or
    // externally killed test file reported green. Signals are failures: only a clean
    // exit 0 passes.
    child.on('close', (code, signal) => {
      clearTimeout(to);
      if (timedOut) {
        reject(new Error(`Test ${file} timed out after ${TEST_FILE_TIMEOUT_MS}ms`));
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
