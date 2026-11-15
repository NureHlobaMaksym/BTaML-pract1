import { AppError } from '../shared/app-error.js';
import { ensure } from '../shared/validation.js';
import { BlockchainService } from '../blockchain/blockchain.service.js';
import { MAX_PEERS, MAX_RESPONSE_BYTES, PEER_TIMEOUT_MS } from './network-limits.js';
import type { PeerResult } from './peer-result.interface.js';

export class NetworkService {
  private readonly peers = new Set<string>();

  constructor(private readonly blockchain: BlockchainService, private readonly ownUrl: string) {}

  list(): string[] {
    return [...this.peers].sort();
  }

  add(value: unknown): string {
    ensure(typeof value === 'string', 'Peer URL must be a string');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new AppError('Invalid peer URL');
    }
    ensure(url.protocol === 'http:' || url.protocol === 'https:', 'Peer must use HTTP or HTTPS');
    ensure(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Peer must be an origin without credentials, query or path');
    ensure(url.origin !== new URL(this.ownUrl).origin, 'Cannot add this node as its own peer');
    ensure(this.peers.has(url.origin) || this.peers.size < MAX_PEERS, 'Peer limit reached');
    this.peers.add(url.origin);
    return url.origin;
  }

  remove(value: unknown): boolean {
    ensure(typeof value === 'string', 'Peer URL must be a string');
    return this.peers.delete(new URL(value).origin);
  }

  private async request(peer: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${peer}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
      redirect: 'error',
    });
    ensure(response.ok, `Peer returned HTTP ${response.status}`);
    const reader = response.body?.getReader();
    ensure(reader, 'Peer returned an empty response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        ensure(size <= MAX_RESPONSE_BYTES, 'Peer response is too large');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async broadcast(path: string, body: unknown): Promise<PeerResult[]> {
    return Promise.all(this.list().map(async peer => {
      try {
        await this.request(peer, path, body);
        return { peer, ok: true };
      } catch (error) {
        return { peer, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));
  }

  async synchronize() {
    const before = this.blockchain.status().tip;
    const fetched = await Promise.all(this.list().map(async peer => {
      try {
        const response = await this.request(peer, '/api/chain');
        ensure(typeof response === 'object' && response !== null && 'chain' in response, 'Invalid chain response');
        return { peer, chain: response.chain };
      } catch (error) {
        return { peer, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    const results: PeerResult[] = [];
    for (const result of fetched) {
      if ('error' in result) {
        results.push({ peer: result.peer, ok: false, error: result.error ?? 'Peer request failed' });
        continue;
      }
      try {
        this.blockchain.replaceChain(result.chain);
        results.push({ peer: result.peer, ok: true });
      } catch (error) {
        results.push({ peer: result.peer, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { replaced: before !== this.blockchain.status().tip, ...this.blockchain.status(), peers: results };
  }
}
