import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { decodeDXT } from '../public/js/ddsdecode.js';
import { tileFootprint, scatteredHeight } from '../public/js/endor-tiles.js';
import { BED, DUFF, MOSS, floorSlot, dryFootprint, forestFloorLayout, drawFloorSlots } from '../public/js/game/endor-habitat.js';
// Test the one-tile lattice in the actual trail donor (128px mip), not on a solid swatch.
const dds = readFileSync(new URL('../public/art/endor-terrain/soil-color.dds', import.meta.url));
let off = 128;
for (let w = 2048; w > 128; w >>= 1) off += w * w;
const d = decodeDXT(dds.subarray(off, off + 128 * 128), 128, 128, 5),
  sample = (_, u, v) => {
    const i = 4 * ((Math.floor(v * 128) & 127) * 128 + (Math.floor(u * 128) & 127));
    return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  };
const corr = (a, b) => {
  const mu = x => x.reduce((s, v) => s + v, 0) / x.length,
    m = mu(a),
    n = mu(b);
  let xy = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - m,
      y = b[i] - n;
    xy += x * y;
    xx += x * x;
    yy += y * y;
  }
  return xy / Math.sqrt(xx * yy);
};
const plain = [],
  copy = [],
  random = [],
  east = [],
  north = [];
for (let j = 0; j < 65; j++)
  for (let i = 0; i < 95; i++) {
    const u = -3 + i * 0.1591,
      v = 1 - j * 0.1317;
    plain.push(sample(null, u, v));
    copy.push(sample(null, u + 1, v));
    const z = (u, v) => scatteredHeight(sample, null, u, v, 3);
    random.push(z(u, v));
    east.push(z(u + 1, v));
    north.push(z(u, v + 1));
  }
assert(corr(plain, copy) > 0.99);
const autocorrelation = [corr(random, east), corr(random, north)];
assert(autocorrelation.every(n => Math.abs(n) < 0.15));
// The transforms at a shared patch edge agree for both triangles, even for negative coordinates.
const smooth = (_, u, v) => Math.sin(2 * Math.PI * u) + Math.cos(2 * Math.PI * v);
for (let j = -2; j < 3; j++)
  for (let i = -3; i < 3; i++)
    for (const [x, y] of [
      [0.35, 0.65],
      [0, 0.37],
      [0.23, 0]
    ]) {
      const v = (j + y) / (0.93 * 1.15470054),
        u = (i + x) / 0.93 + 0.57735027 * v,
        z = scatteredHeight(smooth, null, u, v, 3);
      for (const e of [-1e-7, 1e-7]) assert(Math.abs(z - scatteredHeight(smooth, null, u + e, v - e, 3)) < 0.0001);
      assert(Math.abs(tileFootprint(u, v, 3).reduce((s, p) => s + p[2], 0) - 1) < 1e-7);
      assert.equal(scatteredHeight(smooth, null, u, v, 7), smooth(null, u, v));
    }
// Position continuity alone doesn't catch a crease in a lit height field. Its slope must
// also agree when the third donor changes across the edge between two scan patches.
for (const [a,b] of [[0.3,0.7],[0,0.42],[0.64,0]]) {
  const v=(1+b)/(.93*1.15470054), u=(-2+a)/.93+.57735027*v, e=1e-5;
  const z=t=>scatteredHeight(smooth,null,u+t,v+t*.41,3);
  assert(Math.abs(z(e)+z(-e)-2*z(0))/e < .01, 'visible crease at scan patch boundary');
}
assert.equal(floorSlot(0, 4, false, 0, 0, 0, 0), 4);
assert.equal(floorSlot(0, 4, false, 1, 1, 0, 0), DUFF);
assert.equal(floorSlot(0, 4, false, 0.3, 0.7, 0, 0), MOSS);
for (const id of [3, 4, 5, 6, 7]) assert.equal(floorSlot(id, 17, false, 1, 1, 0, 0), 17);
const heights = new Float32Array([4, 4, 4, 8, -4, 4, 4, 8]),
  paint = Uint8Array.of(9, 9, 9, 0, 9, 9, 9, 0),
  orig = paint.slice(),
  geo = new T.BufferGeometry(),
  attr = new T.BufferAttribute(new Float32Array(4 * 12), 4);
geo.setAttribute('layers', attr);
const t = {
  width: 3,
  height: 2,
  size: 4,
  water: { level: 0, mode: 1 },
  heights,
  layerIndex: paint,
  paint: {
    geo,
    slot: new Map([
      [9, 0],
      [2, 1]
    ]),
    triAt: [0, 3, 6, 9]
  }
};
assert(dryFootprint(t, 1, 3));
assert(!dryFootprint(t, 1, 12, 9));
assert(!dryFootprint(t, 0, 20));
assert(dryFootprint({ ...t, water: null }, 0, 20));
t.paint.floorLayout = forestFloorLayout(t, [0, 7], { image: { width: 1, height: 1, data: [0, 255, 0, 255] } });
drawFloorSlots(t);
assert.deepEqual([...attr.array.slice(0, 4)], [DUFF, DUFF, BED, DUFF]);
assert.deepEqual(paint, orig);
assert.equal(t.paint.floorLayout.counts.sedimentVertices, 1);
paint[1] = 2;
drawFloorSlots(t);
assert.equal(attr.array[1], 1, 'new paving remains visible');
t.paint.floorLayout = null;
drawFloorSlots(t);
assert.deepEqual([...attr.array.slice(0, 4)], [0, 1, 0, 0]);
console.log(
  'PASS trail donor one-tile correlation 1.00 ->',
  autocorrelation.map(n => n.toFixed(3)).join(' / '),
  '(U / V); continuous patches, fixed paving, canopy, liquid shoreline and draw-slot rollback'
);
