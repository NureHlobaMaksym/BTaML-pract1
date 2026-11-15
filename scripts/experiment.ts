import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mineBlock } from '../src/blocks/block.service.js';
import { merkleRoot } from '../src/blocks/merkle.js';
import { createReward } from '../src/transactions/transaction.service.js';
import { renderChart } from '../src/experiment/chart.js';
import type { Measurement } from '../src/experiment/interfaces/measurement.interface.js';
import type { Summary } from '../src/experiment/interfaces/summary.interface.js';

const measurements: Measurement[] = [];
const recipient = 'a'.repeat(64);
const transactions = [createReward(recipient, 50, 1)];
const root = merkleRoot(transactions.map(transaction => transaction.id));
const template = () => ({ header: { height: 1, timestamp: Date.now(), previousHash: randomBytes(32).toString('hex'), merkleRoot: root, difficulty: 1, nonce: 0 }, transactions, hash: '' });
for (let warmup = 0; warmup < 20; warmup++) await mineBlock(template());
for (let run = 1; run <= 10; run++) {
  for (const difficulty of [1, 2, 3, 4]) {
    const candidate = template();
    candidate.header.difficulty = difficulty;
    const result = await mineBlock(candidate);
    measurements.push({ difficulty, run, durationMs: result.durationMs, attempts: result.attempts });
    console.log(`Difficulty ${difficulty}, run ${run}/10: ${result.durationMs.toFixed(3)} ms, ${result.attempts} attempts`);
  }
}
const summary: Summary[] = [1, 2, 3, 4].map(difficulty => {
  const rows = measurements.filter(row => row.difficulty === difficulty);
  const meanMs = rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length;
  return {
    difficulty,
    runs: rows.length,
    meanMs,
    standardDeviationMs: Math.sqrt(rows.reduce((sum, row) => sum + (row.durationMs - meanMs) ** 2, 0) / (rows.length - 1)),
    minimumMs: Math.min(...rows.map(row => row.durationMs)),
    maximumMs: Math.max(...rows.map(row => row.durationMs)),
    meanAttempts: rows.reduce((sum, row) => sum + row.attempts, 0) / rows.length,
  };
});
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/mining-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, measurements, summary }, null, 2));
writeFileSync('artifacts/mining-results.csv', ['difficulty,run,durationMs,attempts', ...measurements.map(row => `${row.difficulty},${row.run},${row.durationMs},${row.attempts}`)].join('\n') + '\n');
writeFileSync('artifacts/mining-time.svg', renderChart(summary, measurements));
console.table(summary);
