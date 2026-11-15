import { OPENAPI_SCHEMAS } from './openapi-schemas.js';

function ref(name: keyof typeof OPENAPI_SCHEMAS) {
  return { $ref: `#/components/schemas/${name}` };
}

function response(description: string, schema: object) {
  return { description, content: { 'application/json': { schema } } };
}

function properties(fields: Record<string, object>) {
  return { type: 'object', required: Object.keys(fields), properties: fields };
}

function operation(operationId: string, tag: string, summary: string, schema: object, status = '200', input?: keyof typeof OPENAPI_SCHEMAS, description?: string) {
  return {
    operationId, tags: [tag], summary,
    ...(description ? { description } : {}),
    ...(input ? { requestBody: { required: true, content: { 'application/json': { schema: ref(input) } } } } : {}),
    responses: { [status]: response('Успішно', schema), '400': response('Запит відхилено. Причина в полі error.', ref('Error')) },
  };
}

const propagation = { type: 'array', items: ref('PeerResult') };
const miningResponse = properties({ block: ref('Block'), attempts: { type: 'integer', example: 256 }, durationMs: { type: 'number', example: 1.5 }, propagation });

export const OPENAPI_DOCUMENT = {
  openapi: '3.0.3',
  info: {
    title: 'Власний блокчейн', version: '1.0.0',
    description: 'REST API блокчейну з підписаними транзакціями та Proof of Work. Усі суми задаються цілими монетами.',
  },
  servers: [{ url: '/', description: 'Вузол, відкритий у цій вкладці' }],
  tags: [
    { name: 'Гаманці та транзакції', description: 'Гаманці, баланс, майнінг і переказ' },
    { name: 'Історія', description: 'Блоки та перевірка ланцюга' },
    { name: 'Доказ Меркла', description: 'Перевірка переказу за заголовками блоків' },
    { name: 'Мережа', description: 'Керування сусідами та синхронізація ланцюга' },
  ],
  paths: {
    '/api/wallets': { post: operation('createWallet', 'Гаманці та транзакції', 'Створити гаманець', ref('Wallet'), '201', undefined, 'Генерує адресу та пару ключів Ed25519. Приватний ключ потрібно зберегти самостійно.') },
    '/api/mining': {
      post: {
        ...operation('mineBlock', 'Гаманці та транзакції', 'Намайнити блок', miningResponse, '201', 'MiningInput', 'Знаходить Proof of Work та додає блок із транзакціями з черги. На адресу recipient нараховується винагорода 50 нових монет плюс комісії транзакцій блока. recipient — адреса винагороди майнера, а не отримувача переказу.'),
        responses: { '201': response('Блок знайдено. Винагороду нараховано, перекази блоку підтверджено.', miningResponse), '400': response('Некоректна адреса або ланцюг змінився під час майнінгу.', ref('Error')), '409': response('Цей вузол уже шукає блок.', ref('Error')) },
      },
    },
    '/api/transfers': { post: operation('sendTransfer', 'Гаманці та транзакції', 'Надіслати переказ', properties({ transaction: ref('SignedTransaction'), propagation }), '201', 'TransferInput', 'Підписує переказ приватним ключем відправника та додає його в чергу. Наступний nonce визначається автоматично. recipient отримує amount, а fee нараховується майнеру після включення переказу в блок.') },
    '/api/accounts/{address}': {
      get: {
        ...operation('getAccount', 'Гаманці та транзакції', 'Переглянути баланс', ref('Account'), '200', undefined, 'Повертає підтверджений баланс, баланс з урахуванням черги та номери транзакцій.'),
        parameters: [{ name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$', example: '' }, description: 'Адреса гаманця, баланс якого потрібно отримати.' }],
      },
    },
    '/api/chain': { get: operation('getChain', 'Історія', 'Показати всі блоки', ref('Chain'), '200', undefined, 'Повертає всі блоки від генезису та сумарну роботу ланцюга.') },
    '/api/chain/validate': { post: operation('validateChain', 'Історія', 'Перевірити правильність історії', ref('Validation'), '200', 'EmptyInput', 'Перевіряє хеші, Proof of Work, підписи, баланси, nonce та винагороди всіх блоків.') },
    '/api/headers': { get: operation('getHeaders', 'Доказ Меркла', 'Отримати заголовки блоків', properties({ headers: { type: 'array', items: ref('HeaderRecord') } }), '200', undefined, 'Повертає лише заголовки та хеші, без списків транзакцій. Використовується легким клієнтом.') },
    '/api/transactions/{id}/proof': {
      get: {
        ...operation('getTransactionProof', 'Доказ Меркла', 'Отримати доказ входження переказу', properties({ transaction: ref('SignedTransaction'), proof: ref('TransactionProof') }), '200', undefined, 'Повертає один підтверджений переказ та його шлях Меркла. Для непідтвердженого або невідомого переказу повертає HTTP 404.'),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$', example: '' }, description: 'Ідентифікатор підтвердженого переказу.' }],
        responses: { '200': response('Доказ сформовано', properties({ transaction: ref('SignedTransaction'), proof: ref('TransactionProof') })), '400': response('Некоректний ідентифікатор', ref('Error')), '404': response('Підтверджений переказ не знайдено', ref('Error')) },
      },
    },
    '/api/proofs/verify': { post: operation('verifyTransactionProof', 'Доказ Меркла', 'Перевірити переказ і доказ', properties({ valid: { type: 'boolean' }, height: { type: 'integer' }, cumulativeWork: { type: 'string' }, storedHeaders: { type: 'integer' } }), '200', 'ProofVerificationInput', 'Зіставляє підписаний переказ і шлях Меркла з перевіреним заголовком. Пошкоджений шлях повертає valid: false. Для незалежної перевірки без завантаження блоків використовуйте npm run light-client.') },
    '/api/peers': {
      get: operation('getPeers', 'Мережа', 'Показати сусідні вузли', properties({ peers: { type: 'array', items: { type: 'string', format: 'uri', example: 'http://127.0.0.1:3002' } } })),
      post: operation('addPeer', 'Мережа', 'Під’єднати сусіда', properties({ peer: { type: 'string', example: 'http://127.0.0.1:3002' } }), '201', 'PeerInput', 'Додає адресу сусіда до цього вузла. З’єднання одностороннє.'),
      delete: operation('removePeer', 'Мережа', 'Від’єднати сусіда', properties({ removed: { type: 'boolean', example: true } }), '200', 'PeerInput', 'Видаляє адресу сусіда з цього вузла. Зворотне з’єднання не змінюється.'),
    },
    '/api/network/sync': { post: operation('synchronize', 'Мережа', 'Звірити історію із сусідами', properties({ replaced: { type: 'boolean', example: false }, height: { type: 'integer', example: 2 }, tip: { type: 'string', example: '' }, cumulativeWork: { type: 'string', example: '512' }, nextDifficulty: { type: 'integer', example: 2 }, mempoolSize: { type: 'integer', example: 0 }, mining: { type: 'boolean', example: false }, peers: propagation }), '200', 'EmptyInput', 'Вузол перевіряє історію сусідів та обирає правильну з більшою сумарною роботою. replaced: true — локальну гілку замінено. ') },
  },
  components: { schemas: OPENAPI_SCHEMAS },
};
