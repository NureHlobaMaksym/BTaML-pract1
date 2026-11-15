import { hashHeader } from '../blocks/block.service.js';
import { merkleRoot } from '../blocks/merkle.js';
import type { Block } from '../blocks/interfaces/block.interface.js';
import { GENESIS_PREVIOUS_HASH, GENESIS_TIMESTAMP } from './chain-rules.js';

export function createGenesis(): Block {
  const header = {
    height: 0,
    timestamp: GENESIS_TIMESTAMP,
    previousHash: GENESIS_PREVIOUS_HASH,
    merkleRoot: merkleRoot([]),
    difficulty: 0,
    nonce: 0,
  };
  return { header, transactions: [], hash: hashHeader(header) };
}
