import { resolve } from 'node:path';
import { createNode } from './http/node.controller.js';
import { ensure } from './shared/validation.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
ensure(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid PORT');
const node = createNode({
  port,
  host,
  dataFile: resolve(process.env.DATA_FILE ?? `data/node-${port}/chain.json`),
  peers: (process.env.PEERS ?? '').split(',').filter(Boolean),
});
node.server.listen(port, host, () => {
  console.log(`Node listening on http://${host}:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    node.stopMining();
    node.server.close();
    node.server.closeAllConnections();
  });
}
