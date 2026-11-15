import { sha256 } from '../shared/serialization.js';
import { address, ensure, integer, object } from '../shared/validation.js';
import type { MerkleProof } from './interfaces/merkle-proof.interface.js';
import type { MerkleProofStep } from './interfaces/merkle-proof-step.interface.js';

function nextLevel(level: string[]): string[] {
  const next: string[] = [];
  for (let index = 0; index < level.length; index += 2) {
    const left = level[index]!;
    next.push(sha256(left + (level[index + 1] ?? left)));
  }
  return next;
}

export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256('');
  let level = [...hashes];
  while (level.length > 1) level = nextLevel(level);
  return level[0]!;
}

export function createMerkleProof(hashes: string[], leafIndex: number): MerkleProof {
  integer(leafIndex);
  ensure(leafIndex < hashes.length, 'Transaction index is outside the Merkle tree');
  for (const hash of hashes) address(hash);
  const siblings: MerkleProofStep[] = [];
  let level = [...hashes];
  let index = leafIndex;
  while (level.length > 1) {
    const side = index % 2 === 0 ? 'right' : 'left';
    const neighbor = side === 'right' ? index + 1 : index - 1;
    siblings.push({ hash: level[neighbor] ?? level[index]!, side });
    level = nextLevel(level);
    index = Math.floor(index / 2);
  }
  return { leafIndex, leafCount: hashes.length, siblings };
}

export function verifyMerkleProof(transactionId: string, value: unknown, expectedRoot: string): boolean {
  address(transactionId);
  address(expectedRoot);
  object(value, ['leafIndex', 'leafCount', 'siblings']);
  integer(value.leafIndex);
  integer(value.leafCount, 1);
  ensure(Array.isArray(value.siblings), 'Merkle siblings must be an array');
  if (value.leafIndex >= value.leafCount) return false;
  let current = transactionId;
  let index = value.leafIndex;
  let width = value.leafCount;
  let depth = 0;
  while (width > 1) {
    const step: unknown = value.siblings[depth];
    if (step === undefined) return false;
    object(step, ['hash', 'side']);
    address(step.hash);
    ensure(step.side === 'left' || step.side === 'right', 'Invalid Merkle sibling side');
    const expectedSide = index % 2 === 0 ? 'right' : 'left';
    if (step.side !== expectedSide) return false;
    if (index % 2 === 0 && index + 1 === width && step.hash !== current) return false;
    current = step.side === 'left' ? sha256(step.hash + current) : sha256(current + step.hash);
    index = Math.floor(index / 2);
    width = Math.ceil(width / 2);
    depth++;
  }
  return depth === value.siblings.length && current === expectedRoot;
}
