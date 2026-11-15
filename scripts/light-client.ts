import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { DEFAULT_HEADER_CACHE, DEFAULT_NODE_URL } from '../src/light-client/client-defaults.js';
import { LightClientConnection } from '../src/light-client/light-client-connection.js';
import { ensure } from '../src/shared/validation.js';
import { validateTransfer } from '../src/transactions/transaction.service.js';

async function interactive(nodeUrl: string, cacheFile: string): Promise<void> {
  const input = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY && stdout.isTTY) });
  const answers = input[Symbol.asyncIterator]();
  async function ask(prompt: string): Promise<string | undefined> {
    stdout.write(prompt);
    const answer = await answers.next();
    return answer.done ? undefined : answer.value.trim();
  }
  try {
    console.log('Легкий клієнт');
    const connection = new LightClientConnection(nodeUrl, cacheFile);
    const status = await connection.synchronize();
    console.log(`Підключено до ${nodeUrl}. Збережено заголовків: ${status.storedHeaders}.`);
    while (true) {
      const transactionId = await ask('ID переказу (Enter — вихід): ');
      if (!transactionId) break;
      try {
        const result = await connection.verify(transactionId);
        console.log('Переказ підтверджено. Доказ правильний.');
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(`Не вдалося перевірити: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    input.close();
  }
}

try {
  const [nodeUrl = DEFAULT_NODE_URL, target, cacheFile = DEFAULT_HEADER_CACHE] = process.argv.slice(2);
  if (!target) {
    await interactive(nodeUrl, cacheFile);
  } else {
    ensure(nodeUrl, 'Укажіть адресу вузла');
    const connection = new LightClientConnection(nodeUrl, cacheFile);
    let transactionId: string;
    let transaction: unknown;
    if (/^[a-f0-9]{64}$/.test(target)) {
      transactionId = target;
    } else {
      ensure(existsSync(target), `Файл не знайдено: ${target}. Для запуску без файла виконайте npm run light-client.`);
      transaction = JSON.parse(readFileSync(target, 'utf8'));
      validateTransfer(transaction);
      transactionId = transaction.id;
    }
    console.log(JSON.stringify(await connection.verify(transactionId, transaction), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
