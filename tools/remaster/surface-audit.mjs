// Production-byte check. UV origin is the first row of the uploaded DDS, not the DCC viewport.
import fs from 'node:fs';
import { parseDDS } from '../../public/js/dds.js';
import { decodeDXT } from '../../public/js/ddsdecode.js';
export function normalHeightAgreement(color, surface, size = 256) {
  function plane(bytes) {
    const d = parseDDS(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      m = d.mipmaps.find(m => m.width === size && m.height === size);
    if (!m) throw Error('Missing registration mip');
    return decodeDXT(m.data, size, size, 5);
  }
  const h = plane(color),
    n = plane(surface),
    m = size - 1,
    at = (x, y) => h[4 * ((y & m) * size + (x & m)) + 3];
  const xy = [0, 0],
    xx = [0, 0],
    yy = [0, 0];
  let heightLo = 255,
    heightHi = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = at(x, y);
      heightLo = Math.min(v, heightLo);
      heightHi = Math.max(v, heightHi);
      for (let k = 0; k < 2; k++) {
        const slope = k ? at(x, y - 1) - at(x, y + 1) : at(x - 1, y) - at(x + 1, y),
          normal = n[(y * size + x) * 4 + k] - 127.5;
        xy[k] += slope * normal;
        xx[k] += slope * slope;
        yy[k] += normal * normal;
      }
    }
  return { heightSpan: heightHi - heightLo, normalCorrelation: xy.map((s, k) => s / Math.max(1, Math.sqrt(xx[k] * yy[k]))) };
}
export function auditDonors(rows) {
  const out = {};
  for (const row of rows) {
    const mats = ['color', 'surface'].map(k =>
      fs.readFileSync(new URL(`../../public/art/${row.pack || 'endor-terrain'}/${row.id}-${k}.dds`, import.meta.url))
    );
    const r = (out[row.id] = normalHeightAgreement(...mats));
    if (r.heightSpan < 2 || Math.min(...r.normalCorrelation) < -0.12)
      throw Error(`Invalid height/normal registration: ${row.id} ${JSON.stringify(r)}`);
  }
  return out;
}
