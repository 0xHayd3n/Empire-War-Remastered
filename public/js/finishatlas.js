// Three roughness bands convolved across cube-face seams in linear light. The kernels
// are deterministic spherical caps, not a path tracer or a GGX PMREM implementation.
import { toLinear } from './orbitcolor.js';
// Face forward, right, up; identical to the map capture camera and the shader's skyUV.
const axes = [
  [1, 0, 0, 0, -1, 0, 0, 0, 1],
  [-1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, 1, 0, 1, 0, 0, 0, 0, 1],
  [0, -1, 0, -1, 0, 0, 0, 0, 1],
  [0, 0, 1, -1, 0, 0, 0, 1, 0],
  [0, 0, -1, 1, 0, 0, 0, 1, 0]
];
function texel(x, y, z, size) {
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z);
  const face = ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5;
  const a = axes[face],
    d = Math.max(ax, ay, az),
    pixel = v => Math.min(size - 1, Math.max(0, Math.floor(((1 + v / d) * size) / 2)));
  const ix = pixel(x * a[3] + y * a[4] + z * a[5]),
    iy = pixel(x * a[6] + y * a[7] + z * a[8]);
  return 4 * (iy * 6 * size + face * size + ix);
}
// In a worker, drain the rows immediately. A browser that cannot start a worker
// can instead yield between rows without changing any sample positions or bytes.
export function* finishAtlasRows(px, size) {
  const out = new Uint8Array(px.length * 3),
    linear = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
  const encode = x => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  out.set(px);
  for (let band = 1; band <= 2; band++) {
    const kernel = Array.from({ length: 40 }, (_, i) => {
      const z = 1 - ((i + 0.5) / 40) * (band === 1 ? 0.075 : 0.42),
        r = Math.sqrt(1 - z * z);
      return [Math.cos(i * 2.39996) * r, Math.sin(i * 2.39996) * r, z];
    });
    for (let f = 0; f < axes.length; f++) {
      const a = axes[f];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = (2 * x + 1) / size - 1,
            v = (2 * y + 1) / size - 1,
            n = Math.hypot(1, u, v),
            nx = (a[0] + a[3] * u + a[6] * v) / n,
            ny = (a[1] + a[4] * u + a[7] * v) / n,
            nz = (a[2] + a[5] * u + a[8] * v) / n;
          const t = Math.hypot(nx, ny),
            tx = t ? -ny / t : 1,
            ty = t ? nx / t : 0,
            bx = -nz * ty,
            by = nz * tx,
            bz = nx * ty - ny * tx;
          let R = 0,
            G = 0,
            B = 0;
          for (const [j, k, l] of kernel) {
            const i = texel(nx * l + tx * j + bx * k, ny * l + ty * j + by * k, nz * l + bz * k, size);
            R += linear[px[i]];
            G += linear[px[i + 1]];
            B += linear[px[i + 2]];
          }
          out.set([encode(R / 40), encode(G / 40), encode(B / 40), 255], band * px.length + 4 * (y * 6 * size + f * size + x));
        }
        yield;
      }
    }
  }
  return out;
}
export function filterFinishAtlas(px, size) {
  const rows = finishAtlasRows(px, size);
  let row;
  do {
    row = rows.next();
  } while (!row.done);
  return row.value;
}
