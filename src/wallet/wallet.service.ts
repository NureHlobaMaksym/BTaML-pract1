import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { sha256 } from '../shared/serialization.js';
import { ensure } from '../shared/validation.js';
import type { Wallet } from './wallet.interface.js';

export function getAddress(publicKey: string): string {
  return sha256(publicKey);
}

export function createWallet(): Wallet {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  return {
    address: getAddress(publicKey),
    publicKey,
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
  };
}

export function importPrivateKey(privateKey: string) {
  ensure(/^[a-f0-9]+$/.test(privateKey), 'Invalid private key encoding');
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'hex'), type: 'pkcs8', format: 'der' });
  ensure(key.asymmetricKeyType === 'ed25519', 'Expected an Ed25519 private key');
  return key;
}

export function importPublicKey(publicKey: string) {
  ensure(/^[a-f0-9]+$/.test(publicKey), 'Invalid public key encoding');
  const bytes = Buffer.from(publicKey, 'hex');
  const key = createPublicKey({ key: bytes, type: 'spki', format: 'der' });
  ensure(key.asymmetricKeyType === 'ed25519', 'Expected an Ed25519 public key');
  ensure(key.export({ type: 'spki', format: 'der' }).equals(bytes), 'Noncanonical public key');
  return key;
}

export function getAddressFromPrivateKey(privateKey: string): string {
  const publicKey = createPublicKey(importPrivateKey(privateKey)).export({ type: 'spki', format: 'der' }).toString('hex');
  return getAddress(publicKey);
}
