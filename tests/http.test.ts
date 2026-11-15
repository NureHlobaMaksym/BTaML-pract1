import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createNode } from '../src/http/node.controller.js';
import { createWallet } from '../src/wallet/wallet.service.js';
import { signTransaction } from '../src/transactions/transaction.service.js';

test('three REST nodes propagate transfers, blocks and synchronize missed history', async () => {
  const nodes = Array.from({ length: 3 }, () => createNode({ host: '127.0.0.1', port: 0 }));
  try {
    const urls: string[] = [];
    for (const node of nodes) {
      node.server.listen(0, '127.0.0.1');
      await once(node.server, 'listening');
      const address = node.server.address();
      assert.ok(address && typeof address === 'object');
      urls.push(`http://127.0.0.1:${address.port}`);
    }
    const request = async (index: number, path: string, body?: unknown, method?: string) => {
      const response: Response = await fetch(`${urls[index]}${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    };
    const root = await fetch(`${urls[0]}/`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/docs');
    const page = await fetch(`${urls[0]}/docs`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /swagger-ui-bundle.js/);
    for (const file of ['swagger-ui.css', 'swagger-ui-bundle.js', 'initializer.js']) {
      const asset = await fetch(`${urls[0]}/docs/${file}`);
      assert.equal(asset.status, 200);
      assert.ok((await asset.text()).length > 100);
    }
    const specification = await request(0, '/api/openapi.json');
    assert.equal(specification.status, 200);
    assert.equal(specification.data.openapi, '3.0.3');
    const paths = specification.data.paths as Record<string, Record<string, unknown>>;
    assert.ok(paths['/api/transfers']?.post);
    assert.equal(paths['/api/transactions/sign'], undefined);
    assert.equal(paths['/api/network/blocks'], undefined);
    assert.equal(paths['/api/chain/validate-candidate'], undefined);
    assert.ok(paths['/api/mining']?.post);
    const documentedWallet = await request(0, '/api/wallets', {});
    assert.equal(documentedWallet.status, 201);
    assert.equal(typeof documentedWallet.data.privateKey, 'string');
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i !== j) assert.equal((await request(i, '/api/peers', { url: urls[j] })).status, 201);
      }
    }
    const alice = createWallet();
    const bob = createWallet();
    assert.equal((await request(0, '/api/mining', { recipient: alice.address })).status, 201);
    assert.deepEqual(nodes.map(node => node.blockchain.status().height), [1, 1, 1]);
    const sent = await request(0, '/api/transfers', { privateKey: alice.privateKey, recipient: bob.address, amount: 10, fee: 1 });
    assert.equal(sent.status, 201);
    assert.equal(JSON.stringify(sent.data).includes(alice.privateKey), false);
    const signed = { data: { transaction: sent.data.transaction } };
    assert.deepEqual(nodes.map(node => node.blockchain.getMempool().length), [1, 1, 1]);
    await request(1, '/api/mining', { recipient: bob.address });
    assert.deepEqual(nodes.map(node => node.blockchain.getAccount(alice.address).balance), [39, 39, 39]);
    const replay = await request(2, '/api/transactions', signed.data.transaction);
    assert.equal(replay.status, 400);
    assert.match(String(replay.data.error), /nonce/);
    for (let i = 0; i < 2; i++) await request(i, '/api/peers', { url: urls[2] }, 'DELETE');
    await request(0, '/api/mining', { recipient: bob.address });
    assert.equal(nodes[2]!.blockchain.status().height, 2);
    assert.equal((await request(2, '/api/network/sync', {})).data.replaced, true);
    assert.equal(nodes[2]!.blockchain.status().tip, nodes[0]!.blockchain.status().tip);
    const invalid = await request(0, '/api/transactions', { ...signTransaction(alice.privateKey, { recipient: bob.address, amount: 1, fee: 0, nonce: 2 }), signature: '0'.repeat(128) });
    assert.equal(invalid.status, 400);
    assert.match(String(invalid.data.error), /signature/);
    assert.equal((await request(0, '/api/chain/validate', {})).data.valid, true);
    assert.equal((await request(0, '/missing')).status, 404);
  } finally {
    await Promise.all(nodes.map(node => new Promise<void>(resolve => {
      node.stopMining();
      node.server.close(() => resolve());
      node.server.closeAllConnections();
    })));
  }
});

test('REST rejects malformed JSON and unexpected input fields', async () => {
  const node = createNode({ host: '127.0.0.1', port: 0 });
  try {
    node.server.listen(0, '127.0.0.1');
    await once(node.server, 'listening');
    const address = node.server.address();
    assert.ok(address && typeof address === 'object');
    for (const body of ['{', '{"recipient":"invalid","extra":1}']) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/api/mining`, { method: 'POST', body });
      assert.equal(response.status, 400);
    }
  } finally {
    node.stopMining();
    await new Promise<void>(resolve => {
      node.server.close(() => resolve());
      node.server.closeAllConnections();
    });
  }
});

test('simple transfers pick the next pending nonce and reject overspending', async () => {
  const node = createNode({ host: '127.0.0.1', port: 0 });
  try {
    node.server.listen(0, '127.0.0.1');
    await once(node.server, 'listening');
    const location = node.server.address();
    assert.ok(location && typeof location === 'object');
    const alice = createWallet();
    const bob = createWallet();
    await node.blockchain.mine(alice.address);
    const send = async (amount: number) => {
      const response: Response = await fetch(`http://127.0.0.1:${location.port}/api/transfers`, {
        method: 'POST',
        body: JSON.stringify({ privateKey: alice.privateKey, recipient: bob.address, amount, fee: 1 }),
      });
      return { status: response.status, data: await response.json() as { transaction: { nonce: number }; error?: string } };
    };
    const first = await send(10);
    const second = await send(10);
    assert.equal(first.status, 201);
    assert.equal(first.data.transaction.nonce, 1);
    assert.equal(second.status, 201);
    assert.equal(second.data.transaction.nonce, 2);
    const excessive = await send(50);
    assert.equal(excessive.status, 400);
    assert.match(excessive.data.error ?? '', /Insufficient/);
    assert.equal(node.blockchain.getMempool().length, 2);
    await node.blockchain.mine(bob.address);
    assert.equal(node.blockchain.getAccount(alice.address).balance, 28);
    assert.equal(node.blockchain.getAccount(bob.address).balance, 72);
  } finally {
    node.stopMining();
    await new Promise<void>(resolve => {
      node.server.close(() => resolve());
      node.server.closeAllConnections();
    });
  }
});
