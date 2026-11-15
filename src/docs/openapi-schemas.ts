const address = {
  type: 'string', pattern: '^[a-f0-9]{64}$',
  example: '',
};
const amount = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, example: 0 };
const positive = { ...amount, minimum: 1, example: 1 };

export const OPENAPI_SCHEMAS = {
  Error: {
    type: 'object', required: ['error'], properties: { error: { type: 'string', example: 'Insufficient balance' } },
  },
  Wallet: {
    type: 'object', required: ['address', 'publicKey', 'privateKey'],
    properties: {
      address: { ...address, description: 'Номер гаманця: на цю адресу надходять монети.' },
      publicKey: { type: 'string', example: '', description: 'Відкритий ключ: дозволяє перевіряти ваш підпис.' },
      privateKey: { type: 'string', example: '', description: 'Секретний ключ: дозволяє підписувати перекази з вашого гаманця.' },
    },
  },
  TransferInput: {
    type: 'object', additionalProperties: false, required: ['privateKey', 'recipient', 'amount', 'fee'],
    properties: {
      privateKey: { type: 'string', example: '', description: 'Приватний ключ відправника у hex.' },
      recipient: { ...address, description: 'Адреса отримувача переказу.' },
      amount: { ...positive, example: 10, description: 'Сума переказу в цілих монетах.' },
      fee: { ...amount, example: 1, description: 'Комісія майнеру. Списується з відправника додатково до суми переказу.' },
    },
    example: { privateKey: '', recipient: '', amount: 10, fee: 1 },
  },
  SignedTransaction: {
    type: 'object', additionalProperties: false,
    required: ['type', 'sender', 'recipient', 'amount', 'fee', 'nonce', 'publicKey', 'signature', 'id'],
    properties: {
      type: { type: 'string', enum: ['transfer'] }, sender: address, recipient: address,
      amount: { ...positive, example: 10 }, fee: { ...amount, example: 1 }, nonce: positive,
      publicKey: { type: 'string', example: '' }, signature: { type: 'string', example: '' }, id: address,
    },
  },
  RewardTransaction: {
    type: 'object', additionalProperties: false, required: ['type', 'recipient', 'amount', 'height', 'id'],
    properties: { type: { type: 'string', enum: ['reward'] }, recipient: address, amount: { ...positive, example: 50 }, height: positive, id: address },
  },
  BlockHeader: {
    type: 'object', additionalProperties: false,
    required: ['height', 'timestamp', 'previousHash', 'merkleRoot', 'difficulty', 'nonce'],
    properties: { height: amount, timestamp: { ...amount, example: 1794736800000 }, previousHash: address, merkleRoot: address, difficulty: { type: 'integer', minimum: 0, maximum: 5, example: 2 }, nonce: amount },
  },
  Block: {
    type: 'object', additionalProperties: false, required: ['header', 'transactions', 'hash'],
    properties: {
      header: { $ref: '#/components/schemas/BlockHeader' }, hash: address,
      transactions: { type: 'array', maxItems: 100, items: { oneOf: [{ $ref: '#/components/schemas/SignedTransaction' }, { $ref: '#/components/schemas/RewardTransaction' }] } },
    },
  },
  PeerResult: {
    type: 'object', required: ['peer', 'ok'], example: { peer: 'http://127.0.0.1:3002', ok: true },
    properties: { peer: { type: 'string', format: 'uri', example: 'http://127.0.0.1:3002' }, ok: { type: 'boolean', example: true }, error: { type: 'string', example: 'Сусід недоступний' } },
  },
  Account: {
    type: 'object', required: ['address', 'balance', 'nonce', 'pendingBalance', 'nextNonce'],
    properties: {
      address, balance: { ...amount, example: 50, description: 'Монети, вже записані в підтверджених блоках.' },
      nonce: { ...amount, description: 'Номер останнього підтвердженого переказу.' },
      pendingBalance: { ...amount, example: 39, description: 'Баланс з урахуванням переказів, які ще чекають підтвердження.' },
      nextNonce: { ...positive, example: 2, description: 'Номер наступного переказу. Програма підставляє його сама.' },
    },
  },
  Chain: {
    type: 'object', required: ['chain', 'cumulativeWork'],
    properties: { chain: { type: 'array', items: { $ref: '#/components/schemas/Block' } }, cumulativeWork: { type: 'string', example: '512' } },
  },
  Validation: {
    type: 'object', required: ['valid', 'cumulativeWork'],
    properties: { valid: { type: 'boolean', enum: [true] }, cumulativeWork: { type: 'string', example: '512' } },
  },
  MiningInput: {
    type: 'object', additionalProperties: false, required: ['recipient'],
    properties: { recipient: { ...address, description: 'Адреса отримувача винагороди за майнінг: 50 нових монет плюс комісії транзакцій блока.' } },
    example: { recipient: '' },
  },
  PeerInput: {
    type: 'object', additionalProperties: false, required: ['url'],
    properties: { url: { type: 'string', format: 'uri', example: 'http://127.0.0.1:3002' } },
  },
  HeaderRecord: {
    type: 'object', additionalProperties: false, required: ['header', 'hash'],
    properties: { header: { $ref: '#/components/schemas/BlockHeader' }, hash: address },
  },
  TransactionProof: {
    type: 'object', additionalProperties: false,
    required: ['transactionId', 'blockHeight', 'blockHash', 'leafIndex', 'leafCount', 'siblings'],
    properties: {
      transactionId: address, blockHeight: positive, blockHash: address, leafIndex: amount, leafCount: { ...positive, maximum: 100 },
      siblings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['hash', 'side'], properties: { hash: address, side: { type: 'string', enum: ['left', 'right'] } } } },
    },
  },
  ProofVerificationInput: {
    type: 'object', additionalProperties: false, required: ['transaction', 'proof'],
    properties: { transaction: { $ref: '#/components/schemas/SignedTransaction' }, proof: { $ref: '#/components/schemas/TransactionProof' } },
  },
  EmptyInput: { type: 'object', additionalProperties: false, example: {} },
};
