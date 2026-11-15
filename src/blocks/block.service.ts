import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { serialize, sha256 } from '../shared/serialization.js';
import { ensure } from '../shared/validation.js';
import { MINING_BATCH_SIZE } from './block-rules.js';
import type { BlockHeader } from './interfaces/block-header.interface.js';
import type { Block } from './interfaces/block.interface.js';
import type { MiningResult } from './interfaces/mining-result.interface.js';

export function hashHeader(header: BlockHeader): string {
  return sha256(serialize(header));
}

export function satisfiesProof(hash: string, difficulty: number): boolean {
  return hash.startsWith('0'.repeat(difficulty));
}

export function blockWork(difficulty: number): bigint {
  return 16n ** BigInt(difficulty);
}

export async function mineBlock(candidate: Block, signal?: AbortSignal): Promise<MiningResult> {
  const block = structuredClone(candidate);
  const start = performance.now();
  let attempts = 0;
  while (true) {
    signal?.throwIfAborted();
    for (let i = 0; i < MINING_BATCH_SIZE; i++) {
      block.hash = hashHeader(block.header);
      attempts++;
      if (satisfiesProof(block.hash, block.header.difficulty)) {
        return { block, attempts, durationMs: performance.now() - start };
      }
      block.header.nonce++;
      ensure(Number.isSafeInteger(block.header.nonce), 'Mining nonce exhausted');
    }
    await setImmediate();
  }
}
