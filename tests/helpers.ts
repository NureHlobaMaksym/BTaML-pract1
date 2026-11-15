import { BlockchainService } from '../src/blockchain/blockchain.service.js';
import { createWallet } from '../src/wallet/wallet.service.js';
import { signTransaction } from '../src/transactions/transaction.service.js';
import type { Block } from '../src/blocks/interfaces/block.interface.js';
import { mineBlock } from '../src/blocks/block.service.js';
import { merkleRoot } from '../src/blocks/merkle.js';

export async function funded() {
  const chain = new BlockchainService();
  const alice = createWallet();
  const bob = createWallet();
  const miner = createWallet();
  await chain.mine(alice.address);
  const transfer = (amount = 10, fee = 1, nonce = 1) => signTransaction(alice.privateKey, { recipient: bob.address, amount, fee, nonce });
  return { chain, alice, bob, miner, transfer };
}

export async function remine(block: Block): Promise<Block> {
  block.header.merkleRoot = merkleRoot(block.transactions.map(transaction => transaction.id));
  block.header.nonce = 0;
  return (await mineBlock(block)).block;
}
