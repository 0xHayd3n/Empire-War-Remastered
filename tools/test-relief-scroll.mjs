// Compare scrolling mesh data against a cold rebuild, including both patch rims,
// a missing cell, shoreline, a large jump and repaint. No mounted data needed.
import * as T from 'three';
import assert from 'node:assert/strict';
import { reliefPatch } from '../public/js/game/endor-relief.js';
const width = 25,
  height = 13,
  geo = new T.BufferGeometry(),
  n = (width - 1) * (height - 1) * 6,
  triAt = new Int32Array(n / 3).fill(-1);
const N = new T.BufferAttribute(new Float32Array(n * 3), 3),
  L = new T.BufferAttribute(new Float32Array(n * 4), 4),
  S = new T.BufferAttribute(new Float32Array(n), 1);
geo.setAttribute('normal', N);
geo.setAttribute('layers', L);
geo.setAttribute('shade', S);
let o = 0;
for (let y = 0; y < height - 1; y++)
  for (let x = 0; x < width - 1; x++) {
    if (x === 9 && y === 6) continue;
    const q = 2 * (y * (width - 1) + x);
    triAt[q] = o;
    triAt[q + 1] = o + 3;
    for (let k = 0; k < 6; k++, o++) {
      L.setXYZW(o, x % 2, 1, y % 2, 1);
      N.setXYZ(o, 0.1 + x * 0.003, 0.13 + y * 0.004, 0.98 - k * 0.002);
      S.setX(o, 0.37 + ((o * 23) % 64) / 128);
    }
  }
const heights = Float32Array.from({ length: width * height }, (_, i) => 1.5 * Math.sin(i * 0.15));
const t = { size: width, width, height, heights, paint: { triAt, geo }, water: { mode: 1, level: 0.25 } };
let reads = 0;
const h = Array.from({ length: 5 }, (_, i) => ({
  size: 16,
  data: Uint8Array.from({ length: 256 }, (_, k) => (k * 43 + i * 7) & 255),
  mean: 0.5,
  get amplitude() {
    reads++;
    return 1.13 + i * 0.17;
  }
}));
function make(mixed) {
  const U = Array.from({ length: 64 }, (_, s) => new T.Vector4(0.04, s === 1 ? 0.02 : 0, 0, s === 63 ? 4 : 0)),
    V = U.map((_, s) => new T.Vector4(0, 0.04, 0, mixed && s === 1 ? -1 : 1));
  const m = new T.Mesh(
    geo,
    new T.ShaderMaterial({ uniforms: { reliefPatch: { value: new T.Vector4() }, texU: { value: U }, texV: { value: V } } })
  );
  return { m, p: reliefPatch(m, t, h, mixed ? [0, 0] : null) };
}
let normalReads = 0;
const getX = N.getX;
N.getX = function (i) {
  normalReads++;
  return getX.call(this, i);
};
for (const mixed of [false, true]) {
  const { m, p } = make(mixed);
  for (const [x, y, repaint, expectStrip, revisit] of [
    [80, 80, false, false],
    [100, 80, false, true],
    [80, 80, false, false, true], // reversing across one cell should not resample any donor
    [120, 100, false, false],
    [400, 160, false, false],
    [380, 160, false, true],
    [380, 160, 'paint', false],
    [380, 160, 'normal', false],
    [380, 160, 'shade', false]
  ]) {
    if (repaint === 'normal') {
      N.setXYZ(triAt[2 * (6 * (width - 1) + 18)], 0.3, 0.4, 0.5);
      N.needsUpdate = true;
    }
    if (repaint === 'shade') {
      S.setX(triAt[2 * (6 * (width - 1) + 18)], mixed ? 0.23 : 0.94);
      S.needsUpdate = true;
    }
    if (repaint === 'paint') {
      L.setXYZW(triAt[2 * (6 * (width - 1) + 18)], 1, 1, 0, 1);
      L.needsUpdate = true;
    }
    const v = { x, y, dist: 100 };
    reads = normalReads = 0;
    p.update(v, true);
    const moved = reads,
      movedNormals = normalReads;
    const { m: ref, p: cold } = make(mixed);
    reads = normalReads = 0;
    cold.update(v, true);
    const all = reads;
    if (revisit) assert.equal(moved + movedNormals, 0, 'a short reverse pan refetched physical heights or normals');
    if (expectStrip) assert(movedNormals < normalReads * 0.23, `one-cell pan reread ${movedNormals} corner normals vs ${normalReads} cold`);
    const a = m.children[0].geometry,
      b = ref.children[0].geometry;
    const count = a.drawRange.count;
    assert.equal(count, b.drawRange.count);
    assert.deepEqual(a.index.array.subarray(0, count), b.index.array.subarray(0, count));
    const vertices = (count / (12 * 12 * 6)) * 169;
    for (const [k, attr] of Object.entries(a.attributes))
      assert.deepEqual(attr.array.subarray(0, vertices * attr.itemSize), b.attributes[k].array.subarray(0, vertices * attr.itemSize), k);
    assert.equal(p.heightRange, cold.heightRange);
    cold.dispose();
    if (expectStrip) assert(moved < all * 0.23, `one-cell pan resampled ${moved} donor heights vs ${all} for the whole patch`);
  }
  p.dispose();
}
console.log('PASS scrolling strip reuse equals a cold rebuild (paint, holes, mud, both projection modes)');
