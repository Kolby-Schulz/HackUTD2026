// Started by spawn.test.ts: a long-running process with a child of its own, like a worker and the
// Claude Code run it starts. Stop must end both.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
console.log(`grandchild ${child.pid}`);
setInterval(() => {}, 1000);
