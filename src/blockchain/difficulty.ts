import { DIFFICULTY_INTERVAL, INITIAL_DIFFICULTY, MAX_DIFFICULTY, MIN_DIFFICULTY, TARGET_BLOCK_TIME_MS } from '../blocks/block-rules.js';
import type { HeaderRecord } from '../blocks/interfaces/header-record.interface.js';

export function nextDifficulty(chain: readonly HeaderRecord[]): number {
  const last = chain.at(-1)!;
  if (last.header.height === 0) return INITIAL_DIFFICULTY;
  if (last.header.height % DIFFICULTY_INTERVAL !== 0) return last.header.difficulty;
  const start = chain[chain.length - DIFFICULTY_INTERVAL]!;
  const elapsed = last.header.timestamp - start.header.timestamp;
  const expected = (DIFFICULTY_INTERVAL - 1) * TARGET_BLOCK_TIME_MS;
  const adjustment = elapsed < expected / 2 ? 1 : elapsed > expected * 2 ? -1 : 0;
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, last.header.difficulty + adjustment));
}
