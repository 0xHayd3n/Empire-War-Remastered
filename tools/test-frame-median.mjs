import assert from 'node:assert/strict';
import { Diag } from '../public/js/diag.js';
const d = new Diag(),
  samples = [];
assert.equal(d.median(), 0);
for (let i = 0; i < 2300; i++) {
  const interval = [5.555, 5.557, 16.667, ((i * 73) % 131) / 7 + 3, 100.25][i % 5];
  d.sample(interval);
  samples.push(Math.fround(interval));
  if (samples.length > d.recent.length) samples.shift();
  assert.equal(d.median(), samples.length < 30 ? 16.7 : [...samples].sort((a, b) => a - b)[samples.length >> 1]);
}
console.log('Exact rolling frame median matches a fresh sort, including duplicates and expiration.');
