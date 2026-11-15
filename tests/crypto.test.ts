import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, sha256 } from '../src/shared/serialization.js';
import { createWallet, getAddress } from '../src/wallet/wallet.service.js';
import { signTransaction, validateTransfer } from '../src/transactions/transaction.service.js';
import { merkleRoot } from '../src/blocks/merkle.js';

test('serialization sorts nested keys and preserves arrays', () => {
  assert.equal(serialize({ z: [2, 1], a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":[2,1]}');
  assert.equal(serialize({ a: 1, b: 2 }), serialize({ b: 2, a: 1 }));
  assert.throws(() => serialize({ value: Number.NaN }));
});

test('wallet has an address derived from its public key', () => {
  const wallet = createWallet();
  assert.equal(wallet.address, getAddress(wallet.publicKey));
  assert.notEqual(wallet.address, createWallet().address);
});

test('signature authenticates every transfer field', () => {
  const wallet = createWallet();
  const transaction = signTransaction(wallet.privateKey, { recipient: createWallet().address, amount: 1, fee: 0, nonce: 1 });
  validateTransfer(transaction);
  assert.throws(() => validateTransfer({ ...transaction, amount: 2 }), /signature/);
  assert.throws(() => validateTransfer({ ...transaction, signature: '0'.repeat(128) }), /signature/);
  assert.throws(() => validateTransfer({ ...transaction, sender: createWallet().address }), /sender/);
});

test('transfer rejects fractional, negative and unsafe amounts', () => {
  const wallet = createWallet();
  for (const amount of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => signTransaction(wallet.privateKey, { recipient: wallet.address, amount, fee: 0, nonce: 1 }));
  }
});

test('Merkle root handles zero and one leaf', () => {
  assert.equal(merkleRoot([]), sha256(''));
  assert.equal(merkleRoot(['a']), 'a');
});

test('Merkle root combines an even number of leaves', () => {
  const leaves = ['a', 'b', 'c', 'd'].map(sha256);
  assert.equal(merkleRoot(leaves), sha256(sha256(leaves[0]! + leaves[1]!) + sha256(leaves[2]! + leaves[3]!)));
});

test('Merkle root duplicates odd leaves on every level', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(sha256) as [string, string, string, string, string];
  assert.equal(merkleRoot([a, b, c]), sha256(sha256(a + b) + sha256(c + c)));
  const left = sha256(sha256(a + b) + sha256(c + d));
  const right = sha256(sha256(e + e) + sha256(e + e));
  assert.equal(merkleRoot([a, b, c, d, e]), sha256(left + right));
});
