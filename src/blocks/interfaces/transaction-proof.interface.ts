import type { MerkleProof } from './merkle-proof.interface.js';

export interface TransactionProof extends MerkleProof {
  transactionId: string;
  blockHeight: number;
  blockHash: string;
}
