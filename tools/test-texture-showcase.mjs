import assert from 'node:assert/strict';
import { rebuildDDS } from '../public/js/texture-showcase/enhance.js';
import { sizeOfMip, outputBytes, isOutput } from '../public/js/texture-showcase/recipes.js';
import { buildProfile } from '../public/js/texture-showcase/build.js';
import { storeZip, readTextureZip } from '../public/js/texture-showcase/archive.js';
const n = 128,
  r = { file: 'TEST.DDS', side: n, role: 'imperialHull', scale: 2 },
  src = new Uint8Array(outputBytes({ ...r, scale: 1 }));
for (let i = 128; i < src.length; i++) src[i] = (i * 73 + (i >> 4) * 19) % 256;
const d = new DataView(src.buffer);
for (const [i, v] of [
  [0, 0x20534444],
  [1, 124],
  [2, 0xa1007],
  [3, n],
  [4, n],
  [7, 8],
  [19, 32],
  [20, 4],
  [21, 0x35545844]
])
  d.setUint32(i * 4, v, true);
const immutable = src.slice(),
  out = rebuildDDS(src, r);
assert.deepEqual(src, immutable);
assert(isOutput(out, r));
assert.deepEqual(rebuildDDS(src, r), out);
let start = 128,
  to = 128 + sizeOfMip(2 * n);
for (let w = n; w >= 1; w >>= 1) {
  const size = sizeOfMip(w);
  if (w <= 64) assert.deepEqual(out.subarray(to, to + size), src.subarray(start, start + size));
  else {
    assert.notDeepEqual(out.subarray(to, to + size), src.subarray(start, start + size));
    for (let b = 0; b < size; b += 16) assert.deepEqual(out.subarray(to + b, to + b + 8), src.subarray(start + b, start + b + 8));
  }
  start += size;
  to += size;
}
assert.equal(to, out.length);
// Trees add three fresh levels, preserve the original alpha blocks at all authored sizes,
// and retain the far mip bytes. The terrain treatment must not overwrite its gloss channel.
for (const [role, scale] of [['endorAtlas', 8], ['endorSoil', 1]]) {
  const fixture = { ...r, role, scale }, forest = rebuildDDS(src, fixture);
  assert(isOutput(forest, fixture)); assert.deepEqual(src, immutable);
  let j = 128, k = 128; for (let w = n * scale; w > n; w >>= 1) j += sizeOfMip(w);
  for (let w = n; w; w >>= 1) {
    const len = sizeOfMip(w);
    if (w <= 64) assert.deepEqual(forest.subarray(j,j+len), src.subarray(k,k+len));
    else {
      assert.notDeepEqual(forest.subarray(j,j+len), src.subarray(k,k+len));
      for (let b=0;b<len;b+=16) assert.deepEqual(forest.subarray(j+b,j+b+8), src.subarray(k+b,k+b+8));
    }
    j+=len; k+=len;
  }
  assert.equal(j,forest.length);
}
const p = 'Data/Art/Textures/TEST.DDS',
  allowed = new Set([p]),
  zip = storeZip([[p, out]]);
assert.deepEqual(readTextureZip(zip, allowed).get(p), out);
assert.throws(() => readTextureZip(zip, new Set(['other'])));
zip[80] ^= 1;
assert.throws(() => readTextureZip(zip, allowed), /Damaged/);
await assert.rejects(
  buildProfile('stock', () => src),
  /changed/
);
await assert.rejects(
  buildProfile('other', () => src),
  /not in the showcase/
);
console.log('PASS: deterministic colour processing, immutable inputs and BC3 mask blocks, mip tail, profile and ZIP guards.');
