import assert from 'node:assert/strict';
import { composeGround } from '../public/js/game/ground-composition.js';
import { validatePatchReview, checkComposition } from './remaster/composition-audit.mjs';
const w = 29,
  h = 13,
  n = 32,
  t = { width: w, height: h, size: n, layerIndex: new Uint8Array(n * n), heights: new Float32Array(n * n) },
  cover = new Float32Array(n * n),
  used = [0, 1, 2, 3, 4, 5, 6, 7],
  z = { built: new Set([7]), authorized: (i, s) => s === 7 && i === 4 };
const c = {
  channels: used.slice(0, 7),
  rockHints: [6],
  laneHints: [1, 2],
  dampHints: [5],
  clearings: [],
  tracks: [
    [
      [0, 100],
      [400, 100]
    ]
  ],
  outcrops: ['ROCK'],
  rockRadius: 60
};
t.layerIndex[4] = t.layerIndex[7] = 7;
const original = t.layerIndex.slice(),
  make = () => composeGround(t, used, c, cover, [{ modelFile: 'rock', x: 520, y: 220 }], z),
  a = make(),
  weights = (x, y) => Array.from(a.sample(x, y, new Float64Array(7)));
assert.deepEqual(t.layerIndex, original);
assert.deepEqual(make().bytes, a.bytes);
assert.equal(a.slotAt(4, 7), 7);
assert.notEqual(a.slotAt(7, 7), 7);
assert(weights(520, 220)[6] > 0.9);
assert(weights(150, 100)[1] + weights(150, 100)[2] > 0.95);
assert(weights(20, 240)[0] > 0.95);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const u = weights(x * 20, y * 20);
    assert(Math.abs(u.reduce((a, b) => a + b) - 1) < 1e-9);
    for (let q = 0; q < 7; q++) assert.equal(u[q], a.corner(y * w + x, q));
  }
const left = weights(199.9999, 102),
  right = weights(200.0001, 102);
assert(left.every((s, i) => Math.abs(right[i] - s) < 0.0001));
assert.throws(() => composeGround(t, used, { ...c, channels: [0, 1, 2, 3, 4, 5, 7] }, cover, [], z), /palette/);
const region = { name: 'field', view: 'command', grid: [0, 0, 8, 7], maxBoundary: 0.4, maxSmallShare: 0.1, maxJump: 0.06 },
  r2 = { ...region, name: 'edge', view: 'jungle', grid: [20, 9, 4, 4] },
  review = { design: 'physical layout', evidence: ['a', 'b'], regions: [region, r2] },
  brief = { views: [{ sha256: 'a' }, { sha256: 'b' }] };
validatePatchReview(review, brief);
assert.throws(() => validatePatchReview({ ...review, regions: [region, { ...r2, maxJump: undefined }] }, brief));
const metrics = {
    included: 40,
    adjacency: { edges: 61, fraction: 0.2 },
    patches: { smallVertexFraction: 0.01 },
    materials: { distinct: 2 }
  },
  audit = r => ({
    name: r.name,
    grid: r.grid,
    prior: metrics,
    modern: structuredClone(metrics),
    jump: { prior: { mean: 0.05 }, modern: { mean: 0.02 } },
    replay: { match: true, changed: 200 }
  }),
  report = { views: { command: {}, jungle: {} }, patchAudit: review.regions.map(audit) };
checkComposition(review, report);
report.patchAudit[0].modern.adjacency.fraction = 0.75;
assert.throws(() => checkComposition(review, report));
report.patchAudit[0] = audit(region);
report.patchAudit[0].modern.materials.distinct = 1;
assert.throws(() => checkComposition(review, report));
region.uniformReason = 'evidenced uninterrupted sand';
checkComposition(review, report);
console.log(
  'PASS physical route and outcrop, continuous normalized cover, padded terrain, permitted paving, unchanged paint and regional blend gate'
);
