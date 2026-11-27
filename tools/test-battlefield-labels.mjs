import assert from 'node:assert/strict';
import { placeNames } from '../public/js/game/battlefieldlabels.js';
const points = Array.from({ length: 60 }, (_, i) => ({
  id: String(i),
  x: 8 + (i % 10) * 49 + (i % 3) * 3,
  y: 10 + Math.floor(i / 10) * 29,
  width: 18 + (i % 5) * 9
}));
const prior = new Map(),
  results = placeNames(points, 500, 190, 5, prior, '31');
const collides = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
assert(results.length > 10 && results.some(n => n.i !== 0));
assert.equal(results[0].p.id, '31');
for (const [i, n] of results.entries()) {
  assert(results.slice(i + 1).every(k => !collides(k.box, n.box)));
  assert(points.every(p => !collides(n.box, [p.x - 6, p.y - 6, p.x + 6, p.y + 6])));
  prior.set(n.p.id, { i: n.i });
}
assert.deepEqual(placeNames(points, 500, 190, 5, prior, '31'), results);
console.log('Crowded tactical chart: names move to alternate sides, do not cover globes/each other, and remain stable at rest.');
