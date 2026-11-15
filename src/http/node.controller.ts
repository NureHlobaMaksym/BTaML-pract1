import { createServer } from 'node:http';
import { serveDocumentation } from '../docs/docs.controller.js';
import { BlockchainService } from '../blockchain/blockchain.service.js';
import { ChainRepository } from '../blockchain/chain.repository.js';
import { LightClient } from '../light-client/light-client.js';
import { NetworkService } from '../network/network.service.js';
import { AppError } from '../shared/app-error.js';
import { ensure, object } from '../shared/validation.js';
import { signTransaction } from '../transactions/transaction.service.js';
import { createWallet, getAddressFromPrivateKey } from '../wallet/wallet.service.js';
import { REQUEST_TIMEOUT_MS } from './http-limits.js';
import { readBody, respond } from './http-helpers.js';
import type { NodeOptions } from './node-options.interface.js';

export function createNode(options: NodeOptions) {
  const blockchain = new BlockchainService(options.dataFile ? new ChainRepository(options.dataFile) : undefined);
  const network = new NetworkService(blockchain, `http://${options.host}:${options.port}`);
  for (const peer of options.peers ?? []) network.add(peer);
  const miningAbort = new AbortController();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = request.method;
      const proofRoute = /^\/api\/transactions\/([^/]+)\/proof$/.exec(path);
      if (serveDocumentation(method, path, response)) return;
      if (method === 'GET' && path === '/api/status') {
        respond(response, 200, { ...blockchain.status(), peers: network.list() });
      } else if (method === 'POST' && path === '/api/wallets') {
        respond(response, 201, createWallet());
      } else if (method === 'GET' && path === '/api/chain') {
        respond(response, 200, { chain: blockchain.getChain(), cumulativeWork: blockchain.status().cumulativeWork });
      } else if (method === 'GET' && path === '/api/headers') {
        respond(response, 200, { headers: blockchain.getHeaders() });
      } else if (method === 'GET' && proofRoute) {
        const transactionId = proofRoute[1]!;
        respond(response, 200, { transaction: blockchain.getConfirmedTransaction(transactionId), proof: blockchain.getTransactionProof(transactionId) });
      } else if (method === 'POST' && path === '/api/proofs/verify') {
        const body = await readBody(request);
        object(body, ['transaction', 'proof']);
        const client = new LightClient(blockchain.getHeaders());
        respond(response, 200, { valid: client.verifyTransaction(body.transaction, body.proof), ...client.status() });
      } else if (method === 'POST' && path === '/api/chain/validate') {
        const body = await readBody(request);
        object(body, []);
        respond(response, 200, blockchain.validate());
      } else if (method === 'POST' && path === '/api/chain/validate-candidate') {
        const body = await readBody(request);
        object(body, ['chain']);
        respond(response, 200, blockchain.validate(body.chain));
      } else if (method === 'GET' && path.startsWith('/api/accounts/')) {
        respond(response, 200, blockchain.getAccount(path.slice('/api/accounts/'.length)));
      } else if (method === 'GET' && path === '/api/mempool') {
        respond(response, 200, { transactions: blockchain.getMempool() });
      } else if (method === 'POST' && path === '/api/transfers') {
        const body = await readBody(request);
        object(body, ['privateKey', 'recipient', 'amount', 'fee']);
        ensure(typeof body.privateKey === 'string', 'Private key must be a string');
        ensure(typeof body.recipient === 'string', 'Recipient must be a string');
        ensure(typeof body.amount === 'number' && typeof body.fee === 'number', 'Amount and fee must be numbers');
        const sender = getAddressFromPrivateKey(body.privateKey);
        const nonce = blockchain.getAccount(sender).nextNonce;
        const signed = signTransaction(body.privateKey, { recipient: body.recipient, amount: body.amount, fee: body.fee, nonce });
        const transaction = blockchain.addTransaction(signed);
        const propagation = await network.broadcast('/api/network/transactions', transaction);
        respond(response, 201, { transaction, propagation });
      } else if (method === 'POST' && path === '/api/transactions/sign') {
        const body = await readBody(request);
        object(body, ['privateKey', 'recipient', 'amount', 'fee', 'nonce']);
        ensure(typeof body.privateKey === 'string', 'Private key must be a string');
        ensure(typeof body.recipient === 'string', 'Recipient must be a string');
        ensure(typeof body.amount === 'number' && typeof body.fee === 'number' && typeof body.nonce === 'number', 'Amount, fee and nonce must be numbers');
        const transaction = signTransaction(body.privateKey, { recipient: body.recipient, amount: body.amount, fee: body.fee, nonce: body.nonce });
        respond(response, 200, { transaction });
      } else if (method === 'POST' && path === '/api/transactions') {
        const transaction = blockchain.addTransaction(await readBody(request));
        const propagation = await network.broadcast('/api/network/transactions', transaction);
        respond(response, 201, { transaction, propagation });
      } else if (method === 'POST' && path === '/api/network/transactions') {
        const body = await readBody(request);
        object(body, ['type', 'sender', 'recipient', 'amount', 'fee', 'nonce', 'publicKey', 'signature', 'id']);
        if (blockchain.getMempool().some(transaction => transaction.id === body.id)) {
          respond(response, 200, { known: true });
        } else {
          const transaction = blockchain.addTransaction(body);
          respond(response, 201, { transaction });
          void network.broadcast('/api/network/transactions', transaction);
        }
      } else if (method === 'POST' && path === '/api/mining') {
        const body = await readBody(request);
        object(body, ['recipient']);
        ensure(typeof body.recipient === 'string', 'Recipient must be a string');
        const result = await blockchain.mine(body.recipient, miningAbort.signal);
        const propagation = await network.broadcast('/api/network/blocks', result.block);
        respond(response, 201, { ...result, propagation });
      } else if (method === 'POST' && path === '/api/network/blocks') {
        const block = await readBody(request);
        object(block, ['header', 'transactions', 'hash']);
        if (blockchain.getChain().some(known => known.hash === block.hash)) {
          respond(response, 200, { known: true });
        } else {
          try {
            blockchain.addBlock(block);
          } catch {
            await network.synchronize();
            if (!blockchain.getChain().some(known => known.hash === block.hash)) blockchain.addBlock(block);
          }
          respond(response, 201, { accepted: true });
          void network.broadcast('/api/network/blocks', block);
        }
      } else if (method === 'GET' && path === '/api/peers') {
        respond(response, 200, { peers: network.list() });
      } else if (method === 'POST' && path === '/api/peers') {
        const body = await readBody(request);
        object(body, ['url']);
        respond(response, 201, { peer: network.add(body.url) });
      } else if (method === 'DELETE' && path === '/api/peers') {
        const body = await readBody(request);
        object(body, ['url']);
        respond(response, 200, { removed: network.remove(body.url) });
      } else if (method === 'POST' && path === '/api/network/sync') {
        const body = await readBody(request);
        object(body, []);
        respond(response, 200, await network.synchronize());
      } else {
        throw new AppError('Route not found', 404);
      }
    } catch (error) {
      const status = error instanceof AppError ? error.status : 400;
      respond(response, status, { error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return { server, blockchain, network, stopMining: () => miningAbort.abort() };
}
