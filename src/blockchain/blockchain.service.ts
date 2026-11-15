import { mineBlock } from '../blocks/block.service.js';
import { MAX_BLOCK_TRANSACTIONS } from '../blocks/block-rules.js';
import type { Block } from '../blocks/interfaces/block.interface.js';
import type { HeaderRecord } from '../blocks/interfaces/header-record.interface.js';
import type { TransactionProof } from '../blocks/interfaces/transaction-proof.interface.js';
import { createMerkleProof, merkleRoot } from '../blocks/merkle.js';
import { AppError } from '../shared/app-error.js';
import { address, ensure, safeAdd } from '../shared/validation.js';
import type { SignedTransaction } from '../transactions/interfaces/signed-transaction.interface.js';
import { Mempool } from '../transactions/mempool.js';
import { createReward } from '../transactions/transaction.service.js';
import { ChainRepository } from './chain.repository.js';
import { account, validateChain } from './chain-validator.js';
import { BLOCK_REWARD } from './chain-rules.js';
import { nextDifficulty } from './difficulty.js';
import { createGenesis } from './genesis.js';

export class BlockchainService {
  private chain: Block[];
  private state;
  private readonly mempool = new Mempool();
  private mining = false;

  constructor(private readonly repository?: ChainRepository) {
    const loaded = repository?.load() ?? [createGenesis()];
    this.state = validateChain(loaded);
    this.chain = loaded as Block[];
    repository?.save(this.chain);
  }

  getChain(): Block[] {
    return structuredClone(this.chain);
  }

  getHeaders(): HeaderRecord[] {
    return this.chain.map(block => ({ header: structuredClone(block.header), hash: block.hash }));
  }

  private findConfirmedTransfer(transactionId: string) {
    address(transactionId);
    for (const block of this.chain) {
      const index = block.transactions.findIndex(transaction => transaction.type === 'transfer' && transaction.id === transactionId);
      const transaction = block.transactions[index];
      if (transaction?.type === 'transfer') return { block, index, transaction };
    }
    throw new AppError('Confirmed transfer not found', 404);
  }

  getConfirmedTransaction(transactionId: string): SignedTransaction {
    return structuredClone(this.findConfirmedTransfer(transactionId).transaction);
  }

  getTransactionProof(transactionId: string): TransactionProof {
    const { block, index } = this.findConfirmedTransfer(transactionId);
    return { transactionId, blockHeight: block.header.height, blockHash: block.hash, ...createMerkleProof(block.transactions.map(transaction => transaction.id), index) };
  }

  getMempool(): SignedTransaction[] {
    return this.mempool.list();
  }

  getAccount(owner: string) {
    address(owner);
    const confirmed = { ...account(this.state, owner) };
    const pending = structuredClone(this.state);
    for (const transaction of this.mempool.list()) {
      const sender = account(pending, transaction.sender);
      sender.balance -= transaction.amount + transaction.fee;
      sender.nonce = transaction.nonce;
      account(pending, transaction.recipient).balance += transaction.amount;
    }
    const projected = account(pending, owner);
    return { address: owner, balance: confirmed.balance, nonce: confirmed.nonce, pendingBalance: projected.balance, nextNonce: projected.nonce + 1 };
  }

  status() {
    return { height: this.chain.length - 1, tip: this.chain.at(-1)!.hash, cumulativeWork: this.state.work.toString(), nextDifficulty: nextDifficulty(this.chain), mempoolSize: this.mempool.list().length, mining: this.mining };
  }

  addTransaction(value: unknown): SignedTransaction {
    return this.mempool.add(value, this.state);
  }

  validate(value: unknown = this.chain) {
    const state = validateChain(value);
    return { valid: true, cumulativeWork: state.work.toString() };
  }

  private commit(chain: Block[], candidates: SignedTransaction[]): void {
    const state = validateChain(chain);
    this.repository?.save(chain);
    this.chain = structuredClone(chain);
    this.state = state;
    this.mempool.rebuild(candidates, state);
  }

  addBlock(value: unknown): void {
    const chain = [...this.chain, value] as Block[];
    this.commit(chain, this.mempool.list());
  }

  replaceChain(value: unknown): boolean {
    const candidate = validateChain(value);
    if (candidate.work <= this.state.work) return false;
    const orphans = this.chain.flatMap(block => block.transactions.filter((transaction): transaction is SignedTransaction => transaction.type === 'transfer'));
    this.commit(value as Block[], [...this.mempool.list(), ...orphans]);
    return true;
  }

  async mine(recipient: string, signal?: AbortSignal) {
    address(recipient);
    if (this.mining) throw new AppError('Mining is already in progress', 409);
    this.mining = true;
    try {
      const previous = this.chain.at(-1)!;
      const transfers = this.mempool.select(this.state, MAX_BLOCK_TRANSACTIONS - 1);
      const fees = transfers.reduce((total, transaction) => safeAdd(total, transaction.fee), 0);
      const height = this.chain.length;
      const transactions = [createReward(recipient, safeAdd(BLOCK_REWARD, fees), height), ...transfers];
      const result = await mineBlock({
        header: { height, timestamp: Math.max(Date.now(), previous.header.timestamp), previousHash: previous.hash, merkleRoot: merkleRoot(transactions.map(transaction => transaction.id)), difficulty: nextDifficulty(this.chain), nonce: 0 },
        transactions,
        hash: '',
      }, signal);
      ensure(this.chain.at(-1)!.hash === previous.hash, 'Chain changed during mining; retry');
      this.addBlock(result.block);
      return result;
    } finally {
      this.mining = false;
    }
  }
}
