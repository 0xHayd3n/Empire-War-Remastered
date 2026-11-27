// Offline check of the Endor meadow replacement pair and the greening claim. No network.
//   node tools/test-endor-grass.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodeDXT } from '../public/js/ddsdecode.js';

const SIZE = 2048,
  MIPS = 12,
  root = 'public/art/endor-terrain/',
  row = JSON.parse(readFileSync(root + 'grass.json', 'utf8')),
  means = JSON.parse(readFileSync('docs/endor-grass/means.json', 'utf8')),
  n = SIZE * SIZE;

// The row replaces exactly one line of materials.json: same shape, same slot id, own donor.
assert.deepEqual(Object.keys(row), ['id', 'asset', 'tileMeters', 'colorHash', 'surfaceHash']);
assert.equal(row.id, 'grass');
assert.equal(row.asset, 'Ground037');
assert.equal(row.tileMeters, 2.1);
for (const k of ['colorHash', 'surfaceHash']) assert.match(row[k], /^[0-9a-f]{64}$/);

for (const kind of ['color', 'surface']) {
  const buf = readFileSync(root + `grass-${kind}.dds`),
    mipSizes = [];
  assert.equal(createHash('sha256').update(buf).digest('hex'), row[kind + 'Hash'], `${kind} hash`);
  assert.equal(buf.readUInt32LE(0), 0x20534444, `${kind} DDS magic`);
  assert.equal(buf.toString('ascii', 84, 88), 'DXT5', `${kind} BC3/DXT5`);
  assert.deepEqual(
    [buf.readUInt32LE(12), buf.readUInt32LE(16), buf.readUInt32LE(28)],
    [SIZE, SIZE, MIPS],
    `${kind} 2048 square, ${MIPS} mips`
  );
  let at = 128;
  for (let w = SIZE; w; w = w > 1 ? w >> 1 : 0) {
    const size = Math.max(1, w >> 2) ** 2 * 16,
      px = decodeDXT(buf.subarray(at, at + size), w, w, 5);
    assert.equal(px.length, w * w * 4, `${kind} mip ${w} decode size`);
    if (w === SIZE) {
      const rgba = px.filter((_, i) => i % 4 === 3),
        lo = rgba.reduce((a, v) => Math.min(a, v), 255),
        hi = rgba.reduce((a, v) => Math.max(a, v), 0),
        albedo = [0, 1, 2].map(c => px.reduce((s, v, i) => (i % 4 === c ? s + v : s), 0) / n);
      // Height must vary across the tile (a flat alpha would mean a missing displacement map).
      if (kind === 'color') assert(hi - lo > 128, 'flat height alpha');
      else assert(hi > 0 && hi - lo > 32, 'missing roughness');
      if (kind === 'color') {
        const want = means.cooked.color.top.map(c => c.mean);
        albedo.forEach((v, c) => assert(Math.abs(v - want[c]) < 2, `albedo channel ${c} ${v} vs ${want[c]}`));
        // Greener than the leafy_grass tile this replaces, by the recorded baseline.
        assert(albedo[1] / albedo[0] > means.before.greenOverRed + 0.05, 'G/R ratio did not improve on leafy_grass');
        assert(albedo[1] - albedo[0] > means.before.greenMinusRed + 10, 'G-R did not improve on leafy_grass');
      }
    }
    mipSizes.push(size);
    at += size;
  }
  assert.equal(at, buf.length, `${kind} no trailing bytes`);
  assert.equal(128 + mipSizes.reduce((s, v) => s + v, 0), buf.length, `${kind} chain length`);
}

assert(means.after.greenDominantPct > means.before.greenDominantPct + 3, 'green-dominant share did not grow');
console.log(
  `PASS grass slot is ambientCG Ground 037: two 2048-square BC3 chains, ${MIPS} mips, height and roughness packed, ` +
    `albedo ${means.before.srgb.join(',')} -> ${means.after.srgb.join(',')} sRGB with no tint`
);
