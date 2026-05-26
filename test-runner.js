const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const testsDir = path.join(__dirname, 'tests');
const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.js')).sort();

async function runTests() {
  for (const file of testFiles) {
    const filePath = path.join(testsDir, file);
    console.log(`\nRunning ${file}...`);

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [filePath], {
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: 'inherit'
      });

      let timedOut = false;
      const to = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 10000);

      child.on('close', code => {
        clearTimeout(to);
        if (timedOut) {
          reject(new Error(`Test ${file} timed out`));
          return;
        }
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Test ${file} failed with code ${code}`));
        }
      });
    });
  }
  console.log('\nAll tests passed!');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err.message);
  process.exit(1);
});
