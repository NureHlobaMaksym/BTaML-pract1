import { blockWork, hashHeader, satisfiesProof } from '../blocks/block.service.js';
import { MAX_FUTURE_TIME_MS } from '../blocks/block-rules.js';
import type { HeaderRecord } from '../blocks/interfaces/header-record.interface.js';
import { nextDifficulty } from '../blockchain/difficulty.js';
import { createGenesis } from '../blockchain/genesis.js';
import { serialize } from '../shared/serialization.js';
import { address, ensure, integer, object } from '../shared/validation.js';

export function validateHeaders(value: unknown, now = Date.now()): bigint {
  ensure(Array.isArray(value) && value.length > 0, 'Headers must contain genesis');
  const genesis = createGenesis();
  ensure(serialize(value[0]) === serialize({ header: genesis.header, hash: genesis.hash }), 'Invalid genesis header');
  const headers = value as HeaderRecord[];
  let work = 0n;
  for (let index = 1; index < headers.length; index++) {
    const record = headers[index]!;
    object(record, ['header', 'hash']);
    object(record.header, ['height', 'timestamp', 'previousHash', 'merkleRoot', 'difficulty', 'nonce']);
    const header = record.header;
    integer(header.height, 1);
    integer(header.timestamp);
    integer(header.difficulty, 1);
    integer(header.nonce);
    address(header.previousHash);
    address(header.merkleRoot);
    address(record.hash);
    const previous = headers[index - 1]!;
    ensure(header.height === index, 'Invalid header height');
    ensure(header.previousHash === previous.hash, 'Broken header link');
    ensure(header.timestamp >= previous.header.timestamp && header.timestamp <= now + MAX_FUTURE_TIME_MS, 'Invalid header timestamp');
    ensure(header.difficulty === nextDifficulty(headers.slice(0, index)), 'Invalid header difficulty');
    ensure(record.hash === hashHeader(header), 'Invalid header hash');
    ensure(satisfiesProof(record.hash, header.difficulty), 'Invalid header proof of work');
    work += blockWork(header.difficulty);
  }
  return work;
}
