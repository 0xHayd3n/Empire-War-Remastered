import assert from 'node:assert/strict';
import { rigidLodPairs, distantFleetHull } from '../public/js/game/fleet-lod.js';
const mesh = (name, n, bone = 0) => ({
  name,
  bone,
  bbox: [-10, -10, -10, 10, 10, 10],
  subs: [
    {
      material: { shader: 'meshgloss.fx', params: { BaseTexture: 'ship.tga' } },
      geometry: { indices: new Uint16Array(3 * n), stride: 128, format: 'alD3dVertNU2' }
    }
  ]
});
const high = mesh('fighter_LOD1', 1000),
  low = mesh('fighter_LOD0', 250);
assert.equal(rigidLodPairs([low, high]).get(high), low);
assert.equal(rigidLodPairs([high]).size, 0);
for (const edit of [
  m => m.bone++,
  m => (m.hidden = true),
  m => (m.collision = true),
  m => (m.bbox[3] += 4),
  m => m.subs.push(m.subs[0]),
  m => (m.subs[0].geometry.format = 'RSkin'),
  m => (m.subs[0].material.params.BaseTexture = 'other.tga'),
  m => (m.subs[0].geometry.indices = new Uint16Array(2900))
]) {
  const alt = structuredClone(low);
  edit(alt);
  assert.equal(rigidLodPairs([high, alt]).size, 0);
}
assert.equal(distantFleetHull(false, 5, 1000, 450), true);
assert.equal(distantFleetHull(false, 5, 80, 450), false);
assert.equal(distantFleetHull(false, 5, 115, 450), false);
assert.equal(distantFleetHull(true, 5, 115, 450), true);
assert.equal(distantFleetHull(true, 5, 4, 450), false);
assert.equal(distantFleetHull(true, NaN, 300, 450), false);
console.log('PASS: authored rigid pairs only; material, bounds, pose and size guards, screen-space hysteresis and close-up restore.');
