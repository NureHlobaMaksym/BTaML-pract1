import type { TransactionPayload } from './transaction-payload.interface.js';

export interface SignedTransaction extends TransactionPayload {
  signature: string;
  id: string;
}
