import { createPublicKey, sign, verify } from 'node:crypto';
import { serialize, sha256 } from '../shared/serialization.js';
import { address, ensure, integer, object, safeAdd } from '../shared/validation.js';
import { getAddress, importPrivateKey, importPublicKey } from '../wallet/wallet.service.js';
import { REWARD_FIELDS, TRANSFER_FIELDS } from './transaction-fields.js';
import type { TransactionPayload } from './interfaces/transaction-payload.interface.js';
import type { SignedTransaction } from './interfaces/signed-transaction.interface.js';
import type { RewardTransaction } from './interfaces/reward-transaction.interface.js';
import type { TransferInput } from './interfaces/transfer-input.interface.js';

export function payload(transaction: TransactionPayload): TransactionPayload {
  const { type, sender, recipient, amount, fee, nonce, publicKey } = transaction;
  return { type, sender, recipient, amount, fee, nonce, publicKey };
}

export function signTransaction(privateKey: string, input: TransferInput): SignedTransaction {
  const key = importPrivateKey(privateKey);
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('hex');
  const data: TransactionPayload = { type: 'transfer', sender: getAddress(publicKey), publicKey, recipient: input.recipient, amount: input.amount, fee: input.fee, nonce: input.nonce };
  const signature = sign(null, Buffer.from(serialize(data)), key).toString('hex');
  const transaction = { ...data, signature, id: sha256(serialize({ ...data, signature })) };
  validateTransfer(transaction);
  return transaction;
}

export function validateTransfer(value: unknown): asserts value is SignedTransaction {
  object(value, TRANSFER_FIELDS);
  ensure(value.type === 'transfer', 'Expected a transfer transaction');
  address(value.sender);
  address(value.recipient);
  integer(value.amount, 1);
  integer(value.fee);
  integer(value.nonce, 1);
  safeAdd(value.amount, value.fee);
  ensure(typeof value.publicKey === 'string', 'Missing public key');
  ensure(typeof value.signature === 'string' && /^[a-f0-9]{128}$/.test(value.signature), 'Invalid signature encoding');
  const key = importPublicKey(value.publicKey);
  ensure(getAddress(value.publicKey) === value.sender, 'Public key does not match sender');
  const transaction = value as unknown as SignedTransaction;
  const data = payload(transaction);
  ensure(verify(null, Buffer.from(serialize(data)), key, Buffer.from(value.signature, 'hex')), 'Invalid transaction signature');
  ensure(value.id === sha256(serialize({ ...data, signature: value.signature })), 'Invalid transaction id');
}

export function createReward(recipient: string, amount: number, height: number): RewardTransaction {
  const data = { type: 'reward' as const, recipient, amount, height };
  return { ...data, id: sha256(serialize(data)) };
}

export function validateReward(value: unknown, height: number, expectedAmount: number): asserts value is RewardTransaction {
  object(value, REWARD_FIELDS);
  ensure(value.type === 'reward', 'First transaction must be a mining reward');
  address(value.recipient);
  integer(value.amount, 1);
  ensure(value.height === height, 'Invalid reward height');
  ensure(value.amount === expectedAmount, 'Invalid mining reward');
  ensure(value.id === createReward(value.recipient, value.amount, height).id, 'Invalid reward id');
}
