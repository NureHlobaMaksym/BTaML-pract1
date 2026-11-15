import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { hashHeader, satisfiesProof } from '../src/blocks/block.service.js';
import { createMerkleProof, merkleRoot, verifyMerkleProof } from '../src/blocks/merkle.js';
import { sha256 } from '../src/shared/serialization.js';
import { LightClient } from '../src/light-client/light-client.js';
import { BlockchainService } from '../src/blockchain/blockchain.service.js';
import { createNode } from '../src/http/node.controller.js';
import { funded } from './helpers.js';

test('Merkle proofs verify every position for single, even and odd trees', () => {
  for (const count of [1, 2, 3, 5, 6, 7, 10, 17]) {
    const leaves = Array.from({ length: count }, (_, index) => sha256(`leaf-${index}`));
    for (let index = 0; index < count; index++) {
      assert.equal(verifyMerkleProof(leaves[index]!, createMerkleProof(leaves, index), merkleRoot(leaves)), true);
    }
  }
});

test('odd Merkle proof includes the duplicated last leaf', () => {
  const leaves = ['a', 'b', 'c'].map(sha256);
  const proof = createMerkleProof(leaves, 2);
  assert.deepEqual(proof.siblings, [
    { hash: leaves[2], side: 'right' },
    { hash: sha256(leaves[0]! + leaves[1]!), side: 'left' },
  ]);
});

test('Merkle verification rejects altered leaves, roots and siblings', () => {
  const leaves = ['a', 'b', 'c'].map(sha256);
  const proof = createMerkleProof(leaves, 1);
  assert.equal(verifyMerkleProof(sha256('other'), proof, merkleRoot(leaves)), false);
  assert.equal(verifyMerkleProof(leaves[1]!, proof, sha256('other')), false);
  proof.siblings[0]!.hash = sha256('other');
  assert.equal(verifyMerkleProof(leaves[1]!, proof, merkleRoot(leaves)), false);
});

test('Merkle verification rejects wrong direction and incomplete or extra paths', () => {
  const leaves = ['a', 'b', 'c'].map(sha256);
  const proof = createMerkleProof(leaves, 1);
  const reversed = structuredClone(proof);
  reversed.siblings[0]!.side = 'right';
  assert.equal(verifyMerkleProof(leaves[1]!, reversed, merkleRoot(leaves)), false);
  assert.equal(verifyMerkleProof(leaves[1]!, { ...proof, siblings: proof.siblings.slice(1) }, merkleRoot(leaves)), false);
  assert.equal(verifyMerkleProof(leaves[1]!, { ...proof, siblings: [...proof.siblings, proof.siblings[0]!] }, merkleRoot(leaves)), false);
  assert.throws(() => createMerkleProof([], 0), /outside/);
});

test('light client verifies a signed transfer while storing only headers', async () => {
  const { chain, transfer, miner } = await funded();
  const transaction = transfer();
  chain.addTransaction(transaction);
  await chain.mine(miner.address);
  const client = new LightClient(chain.getHeaders());
  assert.equal(client.verifyTransaction(transaction, chain.getTransactionProof(transaction.id)), true);
  assert.equal(client.status().cumulativeWork, chain.status().cumulativeWork);
  assert.ok(client.getHeaders().every(record => Object.keys(record).sort().join(',') === 'hash,header'));
  const snapshot = client.getHeaders();
  snapshot[1]!.header.nonce++;
  assert.notDeepEqual(snapshot, client.getHeaders());
});

test('light client rejects tampered transfers and proofs from another block', async () => {
  const { chain, transfer, miner } = await funded();
  const transaction = transfer();
  chain.addTransaction(transaction);
  await chain.mine(miner.address);
  const client = new LightClient(chain.getHeaders());
  const proof = chain.getTransactionProof(transaction.id);
  assert.throws(() => client.verifyTransaction({ ...transaction, amount: 11 }, proof), /signature/);
  assert.equal(client.verifyTransaction(transaction, { ...proof, blockHash: sha256('fake') }), false);
  assert.equal(client.verifyTransaction(transaction, { ...proof, blockHeight: 1 }), false);
  assert.equal(client.verifyTransaction(transaction, { ...proof, transactionId: sha256('other') }), false);
});

test('light client validates header links, hashes, difficulty and PoW', async () => {
  const { chain, miner } = await funded();
  await chain.mine(miner.address);
  const headers = chain.getHeaders();
  const alteredHash = structuredClone(headers);
  alteredHash[1]!.hash = sha256('wrong');
  assert.throws(() => new LightClient(alteredHash), /header hash/);
  const alteredLink = structuredClone(headers);
  alteredLink[2]!.header.previousHash = sha256('wrong');
  assert.throws(() => new LightClient(alteredLink), /header link/);
  const alteredDifficulty = structuredClone(headers);
  alteredDifficulty[1]!.header.difficulty++;
  assert.throws(() => new LightClient(alteredDifficulty), /difficulty/);
  const invalidWork = structuredClone(headers);
  invalidWork[1]!.header.nonce = 0;
  while (satisfiesProof(hashHeader(invalidWork[1]!.header), 2)) invalidWork[1]!.header.nonce++;
  invalidWork[1]!.hash = hashHeader(invalidWork[1]!.header);
  assert.throws(() => new LightClient(invalidWork), /proof of work/);
});

test('light client replaces a fork only when cumulative work increases', async () => {
  const { chain: left, alice, bob, miner, transfer } = await funded();
  const right = new BlockchainService();
  right.replaceChain(left.getChain());
  const transaction = transfer();
  left.addTransaction(transaction);
  await left.mine(miner.address);
  const client = new LightClient(left.getHeaders());
  await right.mine(bob.address);
  assert.equal(client.replaceHeaders(right.getHeaders()), false);
  assert.equal(client.verifyTransaction(transaction, left.getTransactionProof(transaction.id)), true);
  await right.mine(bob.address);
  assert.equal(client.replaceHeaders(right.getHeaders()), true);
  assert.equal(client.verifyTransaction(transaction, left.getTransactionProof(transaction.id)), false);
  assert.equal(right.getAccount(alice.address).balance, 50);
});

test('a proof is available only for a confirmed transfer', async () => {
  const { chain, transfer, miner } = await funded();
  const transaction = transfer();
  chain.addTransaction(transaction);
  assert.throws(() => chain.getTransactionProof(transaction.id), /not found/);
  await chain.mine(miner.address);
  assert.equal(chain.getTransactionProof(transaction.id).blockHeight, 2);
});

test('light client CLI requests headers and proof and persists no block bodies', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'btaml-light-test-'));
  const node = createNode({ host: '127.0.0.1', port: 0 });
  const requests: string[] = [];
  node.server.on('request', request => requests.push(request.url ?? ''));
  try {
    const { chain, transfer, miner } = await funded();
    const transaction = transfer();
    chain.addTransaction(transaction);
    await chain.mine(miner.address);
    node.blockchain.replaceChain(chain.getChain());
    node.server.listen(0, '127.0.0.1');
    await once(node.server, 'listening');
    const location = node.server.address();
    assert.ok(location && typeof location === 'object');
    const url = `http://127.0.0.1:${location.port}`;
    const transactionFile = join(directory, 'transaction.json');
    const cacheFile = join(directory, 'headers.json');
    writeFileSync(transactionFile, JSON.stringify(transaction));
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', resolve('scripts/light-client.ts'), url, transactionFile, cacheFile]);
    const result = JSON.parse(stdout);
    assert.equal(result.valid, true);
    assert.equal(result.storedHeaders, 3);
    assert.deepEqual(requests, ['/api/headers', `/api/transactions/${transaction.id}/proof`]);
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    assert.ok(cached.every((record: object) => !('transactions' in record)));
    const proof = node.blockchain.getTransactionProof(transaction.id);
    const response = await fetch(`${url}/api/proofs/verify`, { method: 'POST', body: JSON.stringify({ transaction, proof }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { valid: boolean }).valid, true);
  } finally {
    node.stopMining();
    await new Promise<void>(resolveClose => {
      node.server.close(() => resolveClose());
      node.server.closeAllConnections();
    });
    rmSync(directory, { recursive: true, force: true });
  }
});


test('light client accepts an ID without a transaction file and retries interactive input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'btaml-light-interactive-'));
  const node = createNode({ host: '127.0.0.1', port: 0 });
  try {
    const { chain, transfer, miner } = await funded();
    const transaction = transfer();
    chain.addTransaction(transaction);
    node.blockchain.replaceChain(chain.getChain());
    node.server.listen(0, '127.0.0.1');
    await once(node.server, 'listening');
    const location = node.server.address();
    assert.ok(location && typeof location === 'object');
    const url = `http://127.0.0.1:${location.port}`;
    const script = resolve('scripts/light-client.ts');
    const cache = join(directory, 'headers.json');
    await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', script, url, transaction.id, cache]), /Підтверджений переказ не знайдено/);
    await chain.mine(miner.address);
    node.blockchain.replaceChain(chain.getChain());
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', script, url, transaction.id, cache]);
    assert.equal(JSON.parse(result.stdout).valid, true);
    const child = spawn(process.execPath, ['--import', 'tsx', script, url, '', cache], { stdio: 'pipe' });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => output += String(chunk));
    child.stderr.on('data', chunk => errors += String(chunk));
    const completion = once(child, 'close');
    child.stdin.end(`invalid-id\n${transaction.id}\n\n`);
    const [code] = await completion;
    assert.equal(code, 0);
    assert.match(errors, /Не вдалося перевірити/);
    assert.match(output, /Переказ підтверджено/);
    assert.doesNotMatch(output, /Адреса вузла|Файл створювати/);
    assert.match(output, /"valid": true/);
    assert.ok(JSON.parse(readFileSync(cache, 'utf8')).every((record: object) => !('transactions' in record)));
  } finally {
    node.stopMining();
    await new Promise<void>(resolveClose => {
      node.server.close(() => resolveClose());
      node.server.closeAllConnections();
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
