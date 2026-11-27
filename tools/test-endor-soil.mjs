import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { forestSlot, reviewedForest, soilMip } from '../public/js/forestfloor.js';
import { soilMaps } from '../public/js/soilmap-manifest.js';
const file = '_MP_LAND_ENDOR.TED',
  layer = { texture: 'W_SmoothDirt00.tga', bump: 'W_SmoothDirt00_B.tga', tile: 215 };
assert.equal(forestSlot('stock', file, [{}, layer]), 1);
for (const [profile, map, l] of [
  ['other', file, layer],
  ['stock', 'other.ted', layer],
  ['stock', file, { ...layer, bump: 'different' }],
  ['stock', file, { ...layer, hole: true }],
  ['stock', file, { ...layer, tile: 64 }],
  ...['W_TempGrnd08.tga', 'W_GrndMoss00.tga', 'W_Forest_Grass00.tga', 'W_DirtRock00.tga', 'W_Mud00.tga'].map(texture => [
    'stock',
    file,
    { ...layer, texture }
  ])
])
  assert.equal(forestSlot(profile, map, [l]), -1);
const hashes = [
  '0ee3bfc9d65d954d5a7d2a8dd3839e8d2010af8a4c5c609ff4cf48500a69a8c2',
  'c96fa8cebf140cb81fed1dbb8bb105bf447487477d7b2b78fe00694ebd93e691'
];
const foc = '63e89b0f57d88e108a2947993319e923c671e85a38b33dc20d76670c4768bf08';
assert(reviewedForest('foc', foc, hashes));
assert(!reviewedForest('eaw', foc, hashes));
assert(!reviewedForest('foc', null, hashes));
for (let k = 0; k < 2; k++) {
  const changed = hashes.slice();
  changed[k] = 'changed';
  assert(!reviewedForest('foc', foc, changed));
}
assert.deepEqual(
  [0, 1, 2].map(detail => 4096 >> soilMip(detail, 8192)),
  [4096, 2048, 1024]
);
assert.equal(4096 >> soilMip(0, 2048), 2048);
for (const [name, hash] of soilMaps) {
  const b = await readFile(new URL('../public/art/forest-ground-04/' + name, import.meta.url));
  assert.equal(createHash('sha256').update(b).digest('hex'), hash);
  assert.equal(b.toString('ascii', 0, 4), 'DDS ');
  assert.equal(b.toString('ascii', 84, 88), 'DXT5');
  assert.deepEqual(
    [12, 16, 28].map(i => b.readUInt32LE(i)),
    [4096, 4096, 13]
  );
  let n = 128;
  for (let w = 4096; w; w >>= 1) n += 16 * Math.max(1, w >> 2) ** 2;
  assert.equal(n, b.length);
}
console.log('PASS: bare-earth-only identity, both source guards, texture tiers and complete native 4096 BC3 chains');
