import type { Block } from './block.interface.js';

export interface MiningResult {
  block: Block;
  attempts: number;
  durationMs: number;
}
