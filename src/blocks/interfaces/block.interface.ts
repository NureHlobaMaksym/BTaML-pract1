import type { RewardTransaction } from '../../transactions/interfaces/reward-transaction.interface.js';
import type { SignedTransaction } from '../../transactions/interfaces/signed-transaction.interface.js';
import type { BlockHeader } from './block-header.interface.js';

export interface Block {
  header: BlockHeader;
  transactions: (RewardTransaction | SignedTransaction)[];
  hash: string;
}
