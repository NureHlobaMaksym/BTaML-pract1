import { AppError } from './app-error.js';

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AppError(message);
}

export function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  ensure(typeof value === 'object' && value !== null && !Array.isArray(value), 'Expected an object');
  ensure(Object.keys(value).sort().join(',') === [...keys].sort().join(','), `Expected fields: ${keys.join(', ')}`);
}

export function integer(value: unknown, minimum = 0): asserts value is number {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum, `Expected a safe integer >= ${minimum}`);
}

export function address(value: unknown): asserts value is string {
  ensure(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Invalid address');
}

export function safeAdd(left: number, right: number): number {
  const sum = left + right;
  ensure(Number.isSafeInteger(sum), 'Amount exceeds safe integer range');
  return sum;
}
