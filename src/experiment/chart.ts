import type { Measurement } from './interfaces/measurement.interface.js';
import type { Summary } from './interfaces/summary.interface.js';

export function renderChart(summary: Summary[], measurements: Measurement[]): string {
  const minimum = Math.min(...measurements.map(row => row.durationMs));
  const maximum = Math.max(...measurements.map(row => row.durationMs));
  const low = Math.floor(Math.log10(Math.max(minimum, 0.0001)));
  const high = Math.max(low + 1, Math.ceil(Math.log10(maximum)));
  const x = (difficulty: number) => 160 + (difficulty - 1) * 210;
  const y = (time: number) => 480 - (Math.log10(Math.max(time, 10 ** low)) - low) / (high - low) * 370;
  const labels: string[] = [];
  for (let power = low; power <= high; power++) {
    const position = y(10 ** power);
    labels.push(`<line x1="110" y1="${position}" x2="850" y2="${position}" stroke="#dce2ed"/><text x="95" y="${position + 5}" text-anchor="end">${10 ** power}</text>`);
  }
  const dots = measurements.map(row => `<circle cx="${x(row.difficulty) + (row.run - 5.5) * 3}" cy="${y(row.durationMs)}" r="4" fill="#6687ac" opacity="0.55"/>`).join('');
  const ranges = summary.map(row => `<line x1="${x(row.difficulty)}" y1="${y(row.minimumMs)}" x2="${x(row.difficulty)}" y2="${y(row.maximumMs)}" stroke="#1d4ed8" stroke-width="2"/><path d="M${x(row.difficulty) - 10},${y(row.minimumMs)}h20 M${x(row.difficulty) - 10},${y(row.maximumMs)}h20" stroke="#1d4ed8"/><circle cx="${x(row.difficulty)}" cy="${y(row.meanMs)}" r="7" fill="#1d4ed8"/><text x="${x(row.difficulty)}" y="515" text-anchor="middle">${row.difficulty}</text><text x="${x(row.difficulty)}" y="${y(row.meanMs) - 14}" text-anchor="middle" font-size="13">${row.meanMs.toFixed(2)} ms</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#fff"/><g font-family="Arial,sans-serif" font-size="16" fill="#17243b"><text x="60" y="45" font-size="27" font-weight="bold">Proof of Work mining time</text><text x="60" y="77" fill="#52627a">10 independent runs per difficulty · SHA-256 · logarithmic time axis</text>${labels.join('')}<line x1="110" y1="110" x2="110" y2="480" stroke="#17243b"/><line x1="110" y1="480" x2="850" y2="480" stroke="#17243b"/><polyline points="${summary.map(row => `${x(row.difficulty)},${y(row.meanMs)}`).join(' ')}" fill="none" stroke="#1d4ed8" stroke-width="3"/>${dots}${ranges}<text x="480" y="553" text-anchor="middle">Difficulty (leading hexadecimal zeros)</text><text transform="translate(30,300) rotate(-90)" text-anchor="middle">Time (ms, logarithmic)</text><text x="110" y="595" fill="#52627a">Large dots: mean · small dots: individual runs · bars: observed minimum–maximum</text></g></svg>`;
}
