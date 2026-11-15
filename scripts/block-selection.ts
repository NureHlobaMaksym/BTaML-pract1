import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BlockchainService } from '../src/blockchain/blockchain.service.js';
import { MAX_BLOCK_TRANSACTIONS } from '../src/blocks/block-rules.js';
import { signTransaction } from '../src/transactions/transaction.service.js';
import { createWallet } from '../src/wallet/wallet.service.js';

const chain = new BlockchainService();
const sender = createWallet();
const prioritySender = createWallet();
const recipient = createWallet();
const miner = createWallet();
for (let index = 0; index < 5; index++) await chain.mine(sender.address);
await chain.mine(prioritySender.address);
const transfers = Array.from({ length: 101 }, (_, index) => signTransaction(sender.privateKey, { recipient: recipient.address, amount: 1, fee: 1, nonce: index + 1 }));
for (const transaction of transfers) chain.addTransaction(transaction);
const priority = signTransaction(prioritySender.privateKey, { recipient: recipient.address, amount: 1, fee: 10, nonce: 1 });
chain.addTransaction(priority);
const pendingBefore = chain.getMempool().length;
const { block } = await chain.mine(miner.address);
const pendingAfter = chain.getMempool().length;
assert.equal(pendingBefore, 102);
assert.equal(block.transactions.length, MAX_BLOCK_TRANSACTIONS);
assert.equal(block.transactions[1]!.id, priority.id);
assert.equal(pendingAfter, 3);
await chain.mine(miner.address);
assert.equal(chain.getMempool().length, 0);
const evidence = {
  blockSelection: { pendingBefore, blockTransactionLimit: MAX_BLOCK_TRANSACTIONS, blockTransactions: block.transactions.length, firstTransferFee: 10, pendingAfter, pendingAfterNextBlock: chain.getMempool().length },
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/block-selection-results.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
