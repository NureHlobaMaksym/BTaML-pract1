import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlockchainService } from '../src/blockchain/blockchain.service.js';
import { ChainRepository } from '../src/blockchain/chain.repository.js';
import { validateChain } from '../src/blockchain/chain-validator.js';
import { nextDifficulty } from '../src/blockchain/difficulty.js';
import { createGenesis } from '../src/blockchain/genesis.js';
import { blockWork, hashHeader, satisfiesProof } from '../src/blocks/block.service.js';
import { BLOCK_REWARD } from '../src/blockchain/chain-rules.js';
import { DIFFICULTY_INTERVAL, TARGET_BLOCK_TIME_MS } from '../src/blocks/block-rules.js';
import { createWallet } from '../src/wallet/wallet.service.js';
import { createReward, signTransaction } from '../src/transactions/transaction.service.js';
import { sha256 } from '../src/shared/serialization.js';
import { funded, remine } from './helpers.js';

test('genesis is identical for independent nodes', () => {
  assert.deepEqual(new BlockchainService().getChain(), new BlockchainService().getChain());
  assert.equal(createGenesis().hash, hashHeader(createGenesis().header));
});

test('mining creates valid PoW and credits the miner', async () => {
  const { chain, alice } = await funded();
  const block = chain.getChain()[1]!;
  assert.ok(satisfiesProof(block.hash, block.header.difficulty));
  assert.equal(chain.getAccount(alice.address).balance, BLOCK_REWARD);
  assert.equal(validateChain(chain.getChain()).work, blockWork(2));
});

test('mempool rejects forged signatures and duplicate transfers', async () => {
  const { chain, transfer } = await funded();
  assert.throws(() => chain.addTransaction({ ...transfer(), signature: '0'.repeat(128) }), /signature/);
  chain.addTransaction(transfer());
  assert.throws(() => chain.addTransaction(transfer()), /Duplicate/);
});

test('mempool reserves funds and rejects double spending', async () => {
  const { chain, transfer, alice } = await funded();
  chain.addTransaction(transfer(50, 0, 1));
  assert.equal(chain.getAccount(alice.address).pendingBalance, 0);
  assert.throws(() => chain.addTransaction(transfer(50, 0, 2)), /Insufficient/);
});

test('mempool enforces sequential nonces including queued transfers', async () => {
  const { chain, transfer, alice } = await funded();
  assert.throws(() => chain.addTransaction(transfer(1, 0, 2)), /nonce/);
  chain.addTransaction(transfer(1, 0, 1));
  chain.addTransaction(transfer(1, 0, 2));
  assert.equal(chain.getAccount(alice.address).nextNonce, 3);
  assert.throws(() => chain.addTransaction(transfer(2, 0, 2)), /nonce/);
});

test('mining settles transfers and adds all fees to the reward', async () => {
  const { chain, transfer, alice, bob, miner } = await funded();
  chain.addTransaction(transfer());
  await chain.mine(miner.address);
  assert.equal(chain.getAccount(alice.address).balance, 39);
  assert.equal(chain.getAccount(bob.address).balance, 10);
  assert.equal(chain.getAccount(miner.address).balance, 51);
  assert.equal(chain.getMempool().length, 0);
  assert.equal(chain.validate().valid, true);
});

test('replay of a confirmed transaction is rejected by nonce', async () => {
  const { chain, transfer, miner } = await funded();
  const transaction = transfer();
  chain.addTransaction(transaction);
  await chain.mine(miner.address);
  assert.throws(() => chain.addTransaction(transaction), /nonce/);
});

test('tampering with an old transfer amount is detected', async () => {
  const { chain, transfer, miner } = await funded();
  chain.addTransaction(transfer());
  await chain.mine(miner.address);
  const altered = chain.getChain();
  altered[2]!.transactions[1]!.amount++;
  assert.throws(() => validateChain(altered), /signature/);
});

test('remining a modified old block breaks the next block link', async () => {
  const { chain, miner } = await funded();
  await chain.mine(miner.address);
  const altered = chain.getChain();
  altered[1]!.header.timestamp++;
  altered[1] = await remine(altered[1]!);
  assert.throws(() => validateChain(altered), /previous block link/);
});

test('validator checks Merkle roots, PoW, block hash and difficulty', async () => {
  const { chain } = await funded();
  const altered = chain.getChain();
  altered[1]!.header.merkleRoot = sha256('wrong');
  altered[1] = await remine({ ...altered[1]!, header: { ...altered[1]!.header } });
  altered[1]!.header.merkleRoot = sha256('wrong');
  const { mineBlock } = await import('../src/blocks/block.service.js');
  altered[1] = (await mineBlock(altered[1]!)).block;
  assert.throws(() => validateChain(altered), /Merkle/);
  const badHash = chain.getChain();
  badHash[1]!.hash = '0'.repeat(64);
  assert.throws(() => validateChain(badHash), /block hash/);
  const badWork = chain.getChain();
  badWork[1]!.header.nonce = 0;
  while (satisfiesProof(hashHeader(badWork[1]!.header), 2)) badWork[1]!.header.nonce++;
  badWork[1]!.hash = hashHeader(badWork[1]!.header);
  assert.throws(() => validateChain(badWork), /proof of work/);
  const badDifficulty = chain.getChain();
  badDifficulty[1]!.header.difficulty = 1;
  assert.throws(() => validateChain(badDifficulty), /difficulty/);
});

test('validator rejects excess reward even after remining', async () => {
  const { chain, alice } = await funded();
  const altered = chain.getChain();
  altered[1]!.transactions[0] = createReward(alice.address, 51, 1);
  altered[1] = await remine(altered[1]!);
  assert.throws(() => validateChain(altered), /reward/);
});

test('validator rejects overspending and wrong nonces inside mined blocks', async () => {
  const { chain, transfer, miner } = await funded();
  chain.addTransaction(transfer());
  await chain.mine(miner.address);
  for (const [transaction, reason] of [[transfer(100, 1, 1), /Insufficient/], [transfer(1, 1, 2), /nonce/]] as const) {
    const altered = chain.getChain();
    altered[2]!.transactions[1] = transaction;
    altered[2] = await remine(altered[2]!);
    assert.throws(() => validateChain(altered), reason);
  }
});

test('difficulty adjusts up, down and stays stable each K blocks', () => {
  for (const [duration, expected] of [[1, 3], [TARGET_BLOCK_TIME_MS, 2], [TARGET_BLOCK_TIME_MS * 3, 1]]) {
    const chain = [createGenesis()];
    for (let height = 1; height <= DIFFICULTY_INTERVAL; height++) {
      const block = createGenesis();
      block.header.height = height;
      block.header.timestamp += height * duration!;
      block.header.difficulty = 2;
      chain.push(block);
    }
    assert.equal(nextDifficulty(chain), expected);
    chain.pop();
    assert.equal(nextDifficulty(chain), 2);
  }
});

test('chain persists and corrupt storage is rejected on restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'btaml-test-'));
  try {
    const file = join(directory, 'chain.json');
    const chain = new BlockchainService(new ChainRepository(file));
    await chain.mine(createWallet().address);
    assert.deepEqual(new BlockchainService(new ChainRepository(file)).getChain(), chain.getChain());
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    stored[1].transactions[0].amount++;
    writeFileSync(file, JSON.stringify(stored));
    assert.throws(() => new BlockchainService(new ChainRepository(file)), /reward/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reorganization restores valid orphan transfers and later confirms them', async () => {
  const { chain: left, alice, bob, miner, transfer } = await funded();
  const right = new BlockchainService();
  right.replaceChain(left.getChain());
  const transaction = transfer();
  left.addTransaction(transaction);
  await left.mine(miner.address);
  await right.mine(bob.address);
  assert.equal(left.replaceChain(right.getChain()), false);
  await right.mine(bob.address);
  assert.equal(left.replaceChain(right.getChain()), true);
  assert.equal(left.getMempool()[0]!.id, transaction.id);
  assert.equal(left.getAccount(alice.address).balance, 50);
  await left.mine(miner.address);
  assert.equal(left.getAccount(alice.address).balance, 39);
  assert.equal(left.getMempool().length, 0);
});

test('reorganization discards orphan transfers conflicting with winning branch', async () => {
  const { chain: left, alice, bob, miner, transfer } = await funded();
  const right = new BlockchainService();
  right.replaceChain(left.getChain());
  left.addTransaction(transfer(10, 0));
  await left.mine(miner.address);
  right.addTransaction(signTransaction(alice.privateKey, { recipient: miner.address, amount: 50, fee: 0, nonce: 1 }));
  await right.mine(bob.address);
  await right.mine(bob.address);
  left.replaceChain(right.getChain());
  assert.equal(left.getMempool().length, 0);
});

test('a shorter chain with more accumulated work wins', async () => {
  const { chain: fast, alice } = await funded();
  for (let i = 0; i < 5; i++) await fast.mine(alice.address);
  const slow = new BlockchainService();
  const base = Date.now() - 300_000;
  for (let height = 1; height <= 8; height++) {
    const transactions = [createReward(alice.address, 50, height)];
    const { merkleRoot } = await import('../src/blocks/merkle.js');
    const { mineBlock } = await import('../src/blocks/block.service.js');
    const { block } = await mineBlock({ header: { height, timestamp: base + height * 30_000, previousHash: slow.status().tip, merkleRoot: merkleRoot(transactions.map(transaction => transaction.id)), difficulty: nextDifficulty(slow.getChain()), nonce: 0 }, transactions, hash: '' });
    slow.addBlock(block);
  }
  assert.ok(slow.status().height > fast.status().height);
  assert.ok(BigInt(slow.status().cumulativeWork) < BigInt(fast.status().cumulativeWork));
  assert.equal(slow.replaceChain(fast.getChain()), true);
  assert.equal(slow.status().tip, fast.status().tip);
});

test('snapshots cannot mutate internal chain or mempool', async () => {
  const { chain, transfer } = await funded();
  chain.getChain()[1]!.transactions[0]!.amount = 0;
  chain.addTransaction(transfer());
  chain.getMempool()[0]!.amount = 0;
  assert.equal(chain.validate().valid, true);
  assert.equal(chain.getMempool()[0]!.amount, 10);
});

test('fee selection respects sender nonce dependencies and block rewards', async () => {
  const { chain, alice, bob, miner, transfer } = await funded();
  await chain.mine(bob.address);
  const first = transfer(1, 1, 1);
  const second = transfer(1, 10, 2);
  const independent = signTransaction(bob.privateKey, { recipient: alice.address, amount: 1, fee: 5, nonce: 1 });
  chain.addTransaction(first);
  chain.addTransaction(second);
  chain.addTransaction(independent);
  const { block } = await chain.mine(miner.address);
  assert.deepEqual(block.transactions.slice(1).map(transaction => transaction.id), [independent.id, first.id, second.id]);
  assert.equal(block.transactions[0]!.amount, 66);
  assert.equal(chain.validate().valid, true);
});

test('validator rejects blocks above the transaction count limit', async () => {
  const { chain, transfer } = await funded();
  const altered = chain.getChain();
  altered[1]!.transactions.push(...Array.from({ length: 100 }, () => transfer(1, 0)));
  altered[1] = await remine(altered[1]!);
  assert.throws(() => validateChain(altered), /transaction count/);
});

test('mempool selection caps a block without dropping queued transactions', async () => {
  const { Mempool } = await import('../src/transactions/mempool.js');
  const { validateChain } = await import('../src/blockchain/chain-validator.js');
  const { chain, transfer } = await funded();
  const pool = new Mempool();
  const state = validateChain(chain.getChain());
  for (let nonce = 1; nonce <= 4; nonce++) pool.add(transfer(1, nonce, nonce), state);
  assert.deepEqual(pool.select(state, 2).map(transaction => transaction.nonce), [1, 2]);
  assert.equal(pool.list().length, 4);
});
