import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Block } from '../blocks/interfaces/block.interface.js';

export class ChainRepository {
  constructor(private readonly path: string) {}

  load(): unknown | undefined {
    return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : undefined;
  }

  save(chain: Block[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(chain, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
