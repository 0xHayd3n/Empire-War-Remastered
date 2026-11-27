// Offline verification of every shipped 2K surface and the slot contract. No private game data required.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeDXT } from '../public/js/ddsdecode.js';
const root = new URL('../public/art/endor-terrain/', import.meta.url),
  m = [...JSON.parse(await readFile(new URL('materials.json', root))), JSON.parse(await readFile(new URL('paving.json', root)))];
assert.deepEqual(
  m.map(x => x.id),
  ['grass', 'moss', 'litter', 'soil', 'mud', 'rock', 'sand', 'concrete']
);
for (const row of m) {
  assert(row.tileMeters > 0);
  for (const kind of ['color', 'surface']) {
    const b = await readFile(new URL(`${row.id}-${kind}.dds`, root));
    assert.equal(createHash('sha256').update(b).digest('hex'), row[kind + 'Hash']);
    assert.equal(b.toString('ascii', 84, 88), 'DXT5');
    assert.deepEqual(
      [12, 16, 28].map(k => b.readUInt32LE(k)),
      [2048, 2048, 12]
    );
    let o = 128;
    for (let w = 2048; w; w >>= 1) {
      const size = Math.max(1, w >> 2) ** 2 * 16;
      if (w === 64) {
        const rgba = decodeDXT(b.subarray(o, o + size), w, w, 5);
        const alpha = rgba.filter((_, i) => i % 4 === 3);
        if (kind === 'color') assert(Math.max(...alpha) > Math.min(...alpha), row.id + ' flat height');
        else
          assert(
            alpha.some(v => v !== 0),
            row.id + ' missing roughness'
          );
      }
      o += size;
    }
    assert.equal(b.length, o);
  }
}
console.log('PASS eight licensed material families, sixteen 2048-square mip chains and packed height/roughness');
