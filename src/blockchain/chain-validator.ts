import { blockWork, hashHeader, satisfiesProof } from '../blocks/block.service.js';
import { MAX_BLOCK_TRANSACTIONS, MAX_FUTURE_TIME_MS } from '../blocks/block-rules.js';
import type { Block } from '../blocks/interfaces/block.interface.js';
import { merkleRoot } from '../blocks/merkle.js';
import { serialize } from '../shared/serialization.js';
import { address, ensure, integer, object, safeAdd } from '../shared/validation.js';
import type { SignedTransaction } from '../transactions/interfaces/signed-transaction.interface.js';
import { validateReward, validateTransfer } from '../transactions/transaction.service.js';
import { BLOCK_REWARD } from './chain-rules.js';
import { nextDifficulty } from './difficulty.js';
import { createGenesis } from './genesis.js';
import type { AccountState } from './interfaces/account-state.interface.js';
import type { ChainState } from './interfaces/chain-state.interface.js';

export function account(state: ChainState, owner: string): AccountState {
  let current = state.accounts.get(owner);
  if (!current) {
    current = { balance: 0, nonce: 0 };
    state.accounts.set(owner, current);
  }
  return current;
}

export function applyTransfer(state: ChainState, transaction: SignedTransaction): void {
  validateTransfer(transaction);
  const sender = account(state, transaction.sender);
  ensure(transaction.nonce === sender.nonce + 1, `Invalid nonce: expected ${sender.nonce + 1}`);
  ensure(!state.transactionIds.has(transaction.id), 'Duplicate transaction');
  const cost = safeAdd(transaction.amount, transaction.fee);
  ensure(sender.balance >= cost, 'Insufficient balance');
  sender.balance -= cost;
  sender.nonce = transaction.nonce;
  const recipient = account(state, transaction.recipient);
  recipient.balance = safeAdd(recipient.balance, transaction.amount);
  state.transactionIds.add(transaction.id);
}

export function validateChain(value: unknown, now = Date.now()): ChainState {
  ensure(Array.isArray(value) && value.length > 0, 'Chain must contain genesis');
  ensure(serialize(value[0]) === serialize(createGenesis()), 'Invalid genesis block');
  const chain = value as Block[];
  const state: ChainState = { accounts: new Map(), transactionIds: new Set(), work: 0n };
  for (let i = 1; i < chain.length; i++) {
    const block = chain[i]!;
    object(block, ['header', 'transactions', 'hash']);
    object(block.header, ['height', 'timestamp', 'previousHash', 'merkleRoot', 'difficulty', 'nonce']);
    const header = block.header;
    integer(header.height, 1);
    integer(header.timestamp);
    integer(header.difficulty, 1);
    integer(header.nonce);
    address(header.previousHash);
    address(header.merkleRoot);
    address(block.hash);
    ensure(header.height === i, 'Invalid block height');
    const previous = chain[i - 1]!;
    ensure(header.previousHash === previous.hash, 'Broken previous block link');
    ensure(header.timestamp >= previous.header.timestamp && header.timestamp <= now + MAX_FUTURE_TIME_MS, 'Invalid block timestamp');
    ensure(header.difficulty === nextDifficulty(chain.slice(0, i)), 'Invalid block difficulty');
    ensure(block.hash === hashHeader(header), 'Invalid block hash');
    ensure(satisfiesProof(block.hash, header.difficulty), 'Invalid proof of work');
    ensure(Array.isArray(block.transactions) && block.transactions.length >= 1 && block.transactions.length <= MAX_BLOCK_TRANSACTIONS, 'Invalid block transaction count');
    let fees = 0;
    for (const transaction of block.transactions.slice(1)) {
      validateTransfer(transaction);
      applyTransfer(state, transaction);
      fees = safeAdd(fees, transaction.fee);
    }
    const reward = block.transactions[0];
    validateReward(reward, i, safeAdd(BLOCK_REWARD, fees));
    ensure(!state.transactionIds.has(reward.id), 'Duplicate reward');
    const miner = account(state, reward.recipient);
    miner.balance = safeAdd(miner.balance, reward.amount);
    state.transactionIds.add(reward.id);
    ensure(header.merkleRoot === merkleRoot(block.transactions.map(transaction => transaction.id)), 'Invalid Merkle root');
    state.work += blockWork(header.difficulty);
  }
  return state;
}
