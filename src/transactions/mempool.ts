import { applyTransfer } from '../blockchain/chain-validator.js';
import type { ChainState } from '../blockchain/interfaces/chain-state.interface.js';
import { ensure } from '../shared/validation.js';
import type { SignedTransaction } from './interfaces/signed-transaction.interface.js';
import { validateTransfer } from './transaction.service.js';

export class Mempool {
  private transactions: SignedTransaction[] = [];

  list(): SignedTransaction[] {
    return structuredClone(this.transactions);
  }

  add(value: unknown, confirmed: ChainState): SignedTransaction {
    validateTransfer(value);
    ensure(!this.transactions.some(transaction => transaction.id === value.id), 'Duplicate transaction in mempool');
    const state = structuredClone(confirmed);
    for (const transaction of this.transactions) applyTransfer(state, transaction);
    applyTransfer(state, value);
    this.transactions.push(structuredClone(value));
    return structuredClone(value);
  }

  rebuild(candidates: SignedTransaction[], confirmed: ChainState): void {
    this.transactions = [];
    let remaining = candidates;
    while (remaining.length > 0) {
      const retry: SignedTransaction[] = [];
      let accepted = 0;
      for (const transaction of remaining) {
        try {
          this.add(transaction, confirmed);
          accepted++;
        } catch {
          retry.push(transaction);
        }
      }
      if (accepted === 0) break;
      remaining = retry;
    }
  }

  select(confirmed: ChainState, limit: number): SignedTransaction[] {
    const state = structuredClone(confirmed);
    const remaining = this.list();
    const selected: SignedTransaction[] = [];
    while (selected.length < limit) {
      remaining.sort((left, right) => right.fee - left.fee || left.id.localeCompare(right.id));
      const index = remaining.findIndex(transaction => {
        try {
          applyTransfer(structuredClone(state), transaction);
          return true;
        } catch {
          return false;
        }
      });
      if (index === -1) break;
      const transaction = remaining.splice(index, 1)[0]!;
      applyTransfer(state, transaction);
      selected.push(transaction);
    }
    return selected;
  }
}
