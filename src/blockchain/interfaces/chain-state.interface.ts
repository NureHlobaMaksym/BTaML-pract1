import type { AccountState } from './account-state.interface.js';

export interface ChainState {
  accounts: Map<string, AccountState>;
  transactionIds: Set<string>;
  work: bigint;
}
