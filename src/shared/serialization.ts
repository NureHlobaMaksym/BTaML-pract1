import { createHash } from 'node:crypto';
import { AppError } from './app-error.js';

export function serialize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${serialize(object[key])}`).join(',')}}`;
  }
  throw new AppError('Unsupported value for deterministic serialization');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
