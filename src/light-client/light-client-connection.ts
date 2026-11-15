import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MAX_RESPONSE_BYTES, PEER_TIMEOUT_MS } from '../network/network-limits.js';
import { address, ensure } from '../shared/validation.js';
import { validateTransfer } from '../transactions/transaction.service.js';
import { DEFAULT_HEADER_CACHE } from './client-defaults.js';
import { LightClient } from './light-client.js';

export class LightClientConnection {
  private readonly url: URL;
  private readonly cache: string;
  private readonly client: LightClient;

  constructor(nodeUrl: string, cacheFile = DEFAULT_HEADER_CACHE) {
    this.url = new URL(nodeUrl);
    ensure((this.url.protocol === 'http:' || this.url.protocol === 'https:') && !this.url.username && !this.url.password && this.url.pathname === '/' && !this.url.search && !this.url.hash, 'Укажіть адресу вузла, наприклад http://127.0.0.1:3001');
    this.cache = resolve(cacheFile);
    this.client = new LightClient(existsSync(this.cache) ? JSON.parse(readFileSync(this.cache, 'utf8')) : undefined);
  }

  private async request(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.url.origin}${path}`, { signal: AbortSignal.timeout(PEER_TIMEOUT_MS), redirect: 'error' });
    const reader = response.body?.getReader();
    ensure(reader, 'Вузол повернув порожню відповідь');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        ensure(size <= MAX_RESPONSE_BYTES, 'Відповідь вузла завелика');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    ensure(response.ok, response.status === 404 ? 'Підтверджений переказ не знайдено. Перевірте ID та підтвердьте переказ майнінгом.' : String(data.error ?? `Вузол повернув HTTP ${response.status}`));
    return data;
  }

  async synchronize() {
    const { headers } = await this.request('/api/headers');
    this.client.replaceHeaders(headers);
    mkdirSync(dirname(this.cache), { recursive: true });
    writeFileSync(`${this.cache}.tmp`, JSON.stringify(this.client.getHeaders(), null, 2));
    renameSync(`${this.cache}.tmp`, this.cache);
    return this.client.status();
  }

  async verify(transactionId: string, knownTransaction?: unknown) {
    address(transactionId);
    await this.synchronize();
    const receipt = await this.request(`/api/transactions/${transactionId}/proof`);
    const transaction = knownTransaction ?? receipt.transaction;
    ensure(transaction !== undefined, 'Вузол не повернув дані переказу. Перезапустіть мережу командою npm run network.');
    validateTransfer(transaction);
    ensure(transaction.id === transactionId, 'Вузол повернув інший переказ');
    const valid = this.client.verifyTransaction(transaction, receipt.proof);
    ensure(valid, 'Доказ переказу не відповідає збереженим заголовкам');
    return { valid, transactionId, ...this.client.status() };
  }
}
