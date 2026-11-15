import type { MerkleProofStep } from './merkle-proof-step.interface.js';

export interface MerkleProof {
  leafIndex: number;
  leafCount: number;
  siblings: MerkleProofStep[];
}
