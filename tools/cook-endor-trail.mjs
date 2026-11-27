// Reuse the verified native 2K mip and every lower mip from the licensed 4K earth pair.
// Copy BC3 blocks, not decompressed pixels. The separate close-earth mode remains 4K.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../public/art/', import.meta.url),
  sha = b => createHash('sha256').update(b).digest('hex'),
  row = { id: 'soil', asset: 'forest_ground_04', tileMeters: 3.15 };
for (const [src, dst, expected] of [
  ['color-height', 'color', '6cae7adbe4d3da2b40c00f405325f6cbe34f859e8d475175a8fa3870ddea1937'],
  ['normal-roughness', 'surface', 'a7e497499b42fbc886e43c4cb116feaa96763e9e6382a6213313058897775634']
]) {
  const b = fs.readFileSync(new URL(`forest-ground-04/${src}.dds`, root));
  if (sha(b) !== expected) throw Error('Unreviewed 4K donor: ' + src);
  const out = Buffer.concat([b.subarray(0, 128), b.subarray(128 + 4096 * 4096)]);
  for (const [at, v] of [
    [12, 2048],
    [16, 2048],
    [20, 2048 ** 2],
    [28, 12]
  ])
    out.writeUInt32LE(v, at);
  row[dst + 'Hash'] = sha(out);
  fs.writeFileSync(new URL(`endor-terrain/soil-${dst}.dds`, root), out);
}
const idx = new URL('endor-terrain/materials.json', root),
  all = JSON.parse(fs.readFileSync(idx));
all[3] = row;
fs.writeFileSync(idx, JSON.stringify(all, null, 2) + '\n');
console.log(row);
