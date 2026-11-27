import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { habitat, randomAt } from '../public/js/game/endor-grove.js';
const root = new URL('../public/art/endor-grove/', import.meta.url),
  rows = JSON.parse(await readFile(new URL('models.json', root)));
for (const r of rows) {
  const b = await readFile(new URL(r.file, root));
  assert.equal(createHash('sha256').update(b).digest('hex'), r.sha256);
  assert.equal(b.length, r.vertices * 32 + r.triangles * 6);
  const seen = new Set();
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < r.vertices; i++) {
    const z = b.readFloatLE(i * 32 + 8);
    min = Math.min(z, min);
    max = Math.max(z, max);
  }
  assert(max - min > 0.01);
  for (let j = r.vertices * 32; j < b.length; j += 2) {
    const idx = b.readUInt16LE(j);
    assert(idx < r.vertices);
    seen.add(idx);
  }
  assert.equal(seen.size, r.vertices);
}
assert.deepEqual([...new Set(rows.map(r => r.kind))].sort(), ['bush','fern', 'grass', 'meadow', 'sapling']);
const t = { size: 3, heights: new Float32Array(9), layerIndex: new Uint8Array(9), water: { mode: 0 } },
  types = [0, 1, 2, 3, 4, 5, 6, 7, -1];
assert.equal(habitat(t, types, 12, 14).meadow, 1);
t.layerIndex.fill(1);
assert.equal(habitat(t, types, 10, 10).wood, 1);
for (const type of [3, 4, 5, 6, 7, 8]) {
  t.layerIndex.fill(type);
  assert.equal(habitat(t, types, 12, 14), null);
}
t.layerIndex.fill(0);
t.layerIndex[0] = 7;
assert.equal(habitat(t, types, 3, 2), null);
t.layerIndex.fill(0);
t.water = { mode: 1, level: 4 };
assert.equal(habitat(t, types, 10, 10), null);
t.water.mode = 0;
t.heights[0] = 40;
assert.equal(habitat(t, types, 10, 10), null);
assert.equal(habitat(t, types, 41, 20), null);
assert.equal(randomAt(110, -4, 3), randomAt(110, -4, 3));
console.log('PASS real indexed CC0 plant meshes, measured depth, deterministic habitat, and path/paving/water/slope exclusions');
