import { fork } from 'node:child_process';
import { resolve } from 'node:path';

const ports = [3001, 3002, 3003];
const root = resolve(process.env.DATA_ROOT ?? 'data');
const children = ports.map(port => fork(resolve('src/main.ts'), [], {
  execArgv: ['--import', 'tsx'],
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_FILE: resolve(root, `node-${port}/chain.json`),
    PEERS: ports.filter(other => other !== port).map(other => `http://127.0.0.1:${other}`).join(','),
  },
  stdio: 'inherit',
}));
let stopping = false;
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop(0));
for (const child of children) child.once('exit', code => stop(code ?? 1));
