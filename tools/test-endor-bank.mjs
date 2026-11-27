// Two adjoining relief cells: a low, dry edge is also the edge of a partially submerged cell.
// Compare the actual vertices the rasterizer receives on either side, not the simulation heights.
import assert from 'node:assert/strict';
import * as T from 'three';
import { reliefPatch } from '../public/js/game/endor-relief.js';
import { BED } from '../public/js/game/endor-habitat.js';
const n = 9,
  geo = new T.BufferGeometry(),
  H = new Float32Array(n * n),
  ids = new Float32Array(64 * 6 * 4);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = i < 4 ? -1 : i === 4 ? 1.4 : 5;
for (let j = 0; j < 8; j++)
  for (let i = 0; i < 8; i++)
    for (let v = 0; v < 6; v++)
      ids.set(
        [i, i + 1, i, i + 1].map(x => (x < 4 ? BED : 0)),
        ((8 * j + i) * 6 + v) * 4
      );
geo.setAttribute('layers', new T.BufferAttribute(ids, 4));
const N = new T.BufferAttribute(new Float32Array(64 * 6 * 3), 3);
for (let i = 0; i < N.count; i++) N.setXYZ(i, 0, 0, 1);
geo.setAttribute('normal', N);
const grid = {
  size: n,
  heights: H,
  water: { mode: 1, level: 0 },
  paint: { geo, triAt: Int32Array.from({ length: 128 }, (_, i) => i * 3) }
};
const planes = y => Array.from({ length: 64 }, (_, s) => new T.Vector4(y ? 0 : 0.05, y ? 0.05 : 0, 0, y ? 1 : s === BED ? 4 : 0));
const ground = new T.Mesh(
  geo,
  new T.ShaderMaterial({
    uniforms: { texU: { value: planes(false) }, texV: { value: planes(true) }, reliefPatch: { value: new T.Vector4() } }
  })
);
const maps = Array.from({ length: 5 }, (_, id) => ({
  size: 2,
  data: Uint8Array.of(255, 0, 0, 255),
  mean: 0.5,
  amplitude: id === 4 ? 1 : 2
}));
const p = reliefPatch(ground, grid, maps);
p.update({ x: 80, y: 80, dist: 80 }, true);
const pos = ground.children[0].geometry.attributes.position,
  edges = new Map();
let worst = 0;
for (let i = 0; i < pos.count; i++) {
  const key = [pos.getX(i), pos.getY(i)].join(','),
    z = pos.getZ(i);
  if (edges.has(key)) worst = Math.max(worst, Math.abs(z - edges.get(key)));
  else edges.set(key, z);
}
assert(worst < 0.00001, `crack between neighboring cells: ${worst.toFixed(4)} world units`);
p.dispose();
console.log('PASS: wet and dry cells share the same displaced shoreline vertices');
