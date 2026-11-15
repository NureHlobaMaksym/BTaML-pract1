import { MAX_BLOCK_TRANSACTIONS } from '../blocks/block-rules.js';
import type { HeaderRecord } from '../blocks/interfaces/header-record.interface.js';
import { verifyMerkleProof } from '../blocks/merkle.js';
import { createGenesis } from '../blockchain/genesis.js';
import { address, ensure, integer, object } from '../shared/validation.js';
import { validateTransfer } from '../transactions/transaction.service.js';
import { validateHeaders } from './header-validator.js';

export class LightClient {
  private headers: HeaderRecord[];
  private work = 0n;

  constructor(initial?: unknown) {
    const genesis = createGenesis();
    this.headers = [{ header: genesis.header, hash: genesis.hash }];
    if (initial !== undefined) this.replaceHeaders(initial);
  }

  getHeaders(): HeaderRecord[] {
    return structuredClone(this.headers);
  }

  status() {
    return { height: this.headers.length - 1, cumulativeWork: this.work.toString(), storedHeaders: this.headers.length };
  }

  replaceHeaders(value: unknown, now = Date.now()): boolean {
    const work = validateHeaders(value, now);
    const headers = value as HeaderRecord[];
    if (work <= this.work) return false;
    this.headers = structuredClone(headers);
    this.work = work;
    return true;
  }

  verifyTransaction(transaction: unknown, value: unknown): boolean {
    validateTransfer(transaction);
    object(value, ['transactionId', 'blockHeight', 'blockHash', 'leafIndex', 'leafCount', 'siblings']);
    address(value.transactionId);
    address(value.blockHash);
    integer(value.blockHeight, 1);
    integer(value.leafCount, 1);
    ensure(value.leafCount <= MAX_BLOCK_TRANSACTIONS, 'Proof exceeds block transaction limit');
    const record = this.headers[value.blockHeight];
    if (!record || record.hash !== value.blockHash || transaction.id !== value.transactionId) return false;
    return verifyMerkleProof(transaction.id, { leafIndex: value.leafIndex, leafCount: value.leafCount, siblings: value.siblings }, record.header.merkleRoot);
  }
}
