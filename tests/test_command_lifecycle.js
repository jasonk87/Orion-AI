const test = require('tape');
const { spawn } = require('child_process');

test('command lifecycle', (t) => {
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'cmd.exe' : 'bash', [isWin ? '/c' : '-c', 'echo "hello"'], {
    detached: !isWin,
    windowsHide: true
  });

  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });

  child.on('close', code => {
    t.equal(code, 0, 'exits cleanly');
    t.ok(output.includes('hello'), 'captures stdout');
    t.end();
  });
});
