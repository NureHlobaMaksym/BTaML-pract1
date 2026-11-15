import type { BlockHeader } from './block-header.interface.js';

export interface HeaderRecord {
  header: BlockHeader;
  hash: string;
}
