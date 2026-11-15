import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import type { Block } from '../src/blocks/interfaces/block.interface.js';
import type { Wallet } from '../src/wallet/wallet.interface.js';
import { mineBlock } from '../src/blocks/block.service.js';
import { signTransaction } from '../src/transactions/transaction.service.js';

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
}

const directory = mkdtempSync(join(tmpdir(), 'btaml-demo-'));
const ports = [await freePort(), await freePort(), await freePort()];
const urls = ports.map(port => `http://127.0.0.1:${port}`);
const children = ports.map((port, index) => fork(resolve('src/main.ts'), [], {
  execArgv: ['--import', 'tsx'],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: join(directory, `${port}.json`), PEERS: urls.filter((_, other) => other !== index).join(',') },
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
}));
const evidence: Record<string, unknown> = { processes: children.map(child => child.pid), nodes: urls };

async function raw(index: number, path: string, body?: unknown, method?: string) {
  const response = await fetch(`${urls[index]}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, data: await response.json() as Record<string, unknown> };
}

async function api(index: number, path: string, body?: unknown, method?: string) {
  const result = await raw(index, path, body, method);
  assert.ok(result.status < 400, JSON.stringify(result));
  return result.data;
}

async function rejectAttack(name: string, path: string, body: unknown, reason: RegExp) {
  const result = await raw(0, path, body);
  assert.equal(result.status, 400, name);
  assert.match(String(result.data.error), reason);
  console.log(`${name}: BLOCKED (${result.data.error})`);
  return { name, ...result };
}

try {
  for (let index = 0; index < urls.length; index++) {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await api(index, '/api/status');
        ready = true;
        break;
      } catch {
        await setTimeout(100);
      }
    }
    assert.ok(ready, `Node ${index + 1} failed to start`);
  }
  const alice = await api(0, '/api/wallets', {}) as unknown as Wallet;
  const bob = await api(0, '/api/wallets', {}) as unknown as Wallet;
  const miner = await api(0, '/api/wallets', {}) as unknown as Wallet;
  await api(0, '/api/mining', { recipient: alice.address });
  const transfer = signTransaction(alice.privateKey, { recipient: bob.address, amount: 10, fee: 1, nonce: 1 });
  await api(0, '/api/transactions', transfer);
  await api(1, '/api/mining', { recipient: miner.address });
  await api(2, '/api/mining', { recipient: miner.address });
  const statuses = await Promise.all(urls.map((_, index) => api(index, '/api/status')));
  assert.equal(new Set(statuses.map(status => status.tip)).size, 1);
  evidence.initialSynchronization = statuses;
  console.log('Three independent processes synchronized at height 3');
  const { chain } = await api(0, '/api/chain') as unknown as { chain: Block[] };
  const alteredAmount = structuredClone(chain);
  alteredAmount[2]!.transactions[1]!.amount++;
  const attacks = [];
  attacks.push(await rejectAttack('1. Old amount modified', '/api/chain/validate-candidate', { chain: alteredAmount }, /signature/));
  const alteredHeader = structuredClone(chain);
  alteredHeader[2]!.header.timestamp++;
  alteredHeader[2]!.header.nonce = 0;
  alteredHeader[2] = (await mineBlock(alteredHeader[2]!)).block;
  attacks.push(await rejectAttack('2. Old block modified and remined', '/api/chain/validate-candidate', { chain: alteredHeader }, /previous block link/));
  const forged = signTransaction(alice.privateKey, { recipient: bob.address, amount: 1, fee: 0, nonce: 2 });
  attacks.push(await rejectAttack('3. Forged signature', '/api/transactions', { ...forged, signature: '0'.repeat(128) }, /signature/));
  const spend = signTransaction(alice.privateKey, { recipient: bob.address, amount: 39, fee: 0, nonce: 2 });
  await api(0, '/api/transactions', spend);
  const doubleSpend = signTransaction(alice.privateKey, { recipient: bob.address, amount: 39, fee: 0, nonce: 3 });
  attacks.push(await rejectAttack('4. Double spending', '/api/transactions', doubleSpend, /Insufficient/));
  attacks.push(await rejectAttack('5. Confirmed transaction replay', '/api/transactions', transfer, /nonce/));
  evidence.attacks = attacks;
  await api(0, '/api/mining', { recipient: miner.address });
  for (let index = 0; index < urls.length; index++) {
    for (const peer of urls.filter((_, other) => other !== index)) await api(index, '/api/peers', { url: peer }, 'DELETE');
  }
  const orphan = signTransaction(bob.privateKey, { recipient: alice.address, amount: 2, fee: 1, nonce: 1 });
  await api(0, '/api/transactions', orphan);
  await api(0, '/api/mining', { recipient: miner.address });
  await api(2, '/api/mining', { recipient: miner.address });
  await api(2, '/api/mining', { recipient: miner.address });
  evidence.fork = await Promise.all(urls.map((_, index) => api(index, '/api/status')));
  for (let index = 0; index < urls.length; index++) {
    for (const peer of urls.filter((_, other) => other !== index)) await api(index, '/api/peers', { url: peer });
  }
  const sync = await api(0, '/api/network/sync', {});
  assert.equal(sync.replaced, true);
  const mempool = await api(0, '/api/mempool') as unknown as { transactions: { id: string }[] };
  assert.ok(mempool.transactions.some(transaction => transaction.id === orphan.id));
  evidence.reorganization = { sync, restoredTransactionId: orphan.id, mempool };
  console.log('Fork resolved by cumulative work; orphan transfer restored to mempool');
  await api(1, '/api/network/sync', {});
  await api(0, '/api/mining', { recipient: miner.address });
  const final = await Promise.all(urls.map((_, index) => api(index, '/api/status')));
  assert.equal(new Set(final.map(status => status.tip)).size, 1);
  for (let index = 0; index < urls.length; index++) assert.equal((await api(index, '/api/chain/validate', {})).valid, true);
  evidence.finalSynchronization = final;
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/demo-results.json', JSON.stringify(evidence, null, 2));
  console.log('All attacks blocked; all nodes agree; evidence: artifacts/demo-results.json');
} finally {
  await Promise.all(children.map(child => new Promise<void>(resolveExit => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    child.once('exit', () => resolveExit());
    child.kill('SIGTERM');
  })));
  rmSync(directory, { recursive: true, force: true });
}
