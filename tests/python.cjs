'use strict';
const {spawn, spawnSync} = require('node:child_process');

let invocation;
function getInvocation() {
  if (invocation) return invocation;
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON, []]]
    : process.platform === 'win32'
      ? [['py', ['-3']], ['python3', []], ['python', []]]
      : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '--version'], {encoding:'utf8', windowsHide:true});
    if (!probe.error && probe.status === 0) {
      invocation = {command, prefix};
      return invocation;
    }
  }
  throw new Error('Python 3 was not found. Install Python 3 or set the PYTHON environment variable.');
}

function spawnPythonSync(args, options) {
  const {command, prefix} = getInvocation();
  return spawnSync(command, [...prefix, ...args], options);
}

function spawnPython(args, options) {
  const {command, prefix} = getInvocation();
  return spawn(command, [...prefix, ...args], options);
}

module.exports = {spawnPython, spawnPythonSync};

if (require.main === module) {
  const child = spawnPython(process.argv.slice(2), {stdio:'inherit'});
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', error => {
    console.error(`Could not start Python: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
