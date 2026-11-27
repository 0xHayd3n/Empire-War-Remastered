import { decodeDXT } from '../ddsdecode.js';
import { encodeDXT } from '../ddsmips.js';
import { sizeOfMip, outputBytes } from './recipes.js';
import { forestPixel } from './forest.js';

// Source-guided material treatments. Luminance-only edits retain paint hues; no writes to normal/gloss/light maps.
const styles = {
  imperialHull: [0.72, 3.3],
  republicHull: [0.53, 2.7],
  planet: [0.45, 1.6],
  grassRock: [0.57, 5.8],
  gravel: [0.68, 6.2],
  meadow: [0.42, 3.8]
};
const clamp8 = v => Math.max(0, Math.min(255, v));
const linear = Float32Array.from({ length: 256 }, (_, i) => {
  const x = i / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
});
const srgb = Uint8Array.from({ length: 65536 }, (_, i) => {
  const x = i / 65535;
  return Math.round(255 * (x < 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
});
function noise(x, y) {
  let h = Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 3, 0x119de1f3);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) & 65535) / 32767.5 - 1;
}
function finishBase(p, n, role) {
  const [detail, grain] = styles[role],
    ground = ['grassRock', 'gravel', 'meadow'].includes(role),
    hull = role.endsWith('Hull'),
    luma = new Uint8Array(n * n),
    out = p.slice();
  for (let i = 0; i < luma.length; i++) luma[i] = (54 * p[i * 4] + 183 * p[i * 4 + 1] + 19 * p[i * 4 + 2] + 128) >> 8;
  const ix = x => (ground || role === 'planet' ? (x + n) % n : Math.max(0, Math.min(n - 1, x)));
  const iy = y => (ground ? (y + n) % n : Math.max(0, Math.min(n - 1, y)));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        o = i * 4,
        m = luma[i],
        left = luma[y * n + ix(x - 1)],
        right = luma[y * n + ix(x + 1)],
        up = luma[iy(y - 1) * n + x],
        down = luma[iy(y + 1) * n + x];
      const edge = m - (left + right + up + down) * 0.25,
        grainMask = Math.min(1, m / 40, (255 - m) / 35),
        painted = Math.max(p[o], p[o + 1], p[o + 2]) - Math.min(p[o], p[o + 1], p[o + 2]);
      // Hulls: directional brushed metal on low-chroma panels, not on saturated squadron paint.
      // Kuat: irregular rock/gravel grains, finer and less contrast on the meadow. Globe: spare blue water.
      const grainField = hull ? 0.7 * noise(x >> 2, y) + 0.3 * noise(x, y) : noise(x, y);
      const material = hull ? Math.max(0.18, 1 - painted / 85) : role === 'planet' && p[o + 2] > p[o] * 1.15 ? 0.22 : 1;
      const delta = Math.max(-15, Math.min(15, edge * detail)) + grainField * grain * material * grainMask;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(clamp8(p[o + c] + delta));
    }
  return out;
}
// Bounded separable Catmull-Rom for RGB, ordinary linear coverage for alpha. No sharpening of masks.
function double(src, n, wrapX, wrapY) {
  let a = src,
    w = n,
    h = n;
  for (let axis = 0; axis < 2; axis++) {
    const nw = axis ? w : w * 2,
      nh = axis ? h * 2 : h,
      next = new Uint8Array(nw * nh * 4),
      limit = axis ? h : w,
      stride = axis ? w * 4 : 4,
      wrap = axis ? wrapY : wrapX;
    const clamp = v => (wrap ? (v + limit) % limit : Math.min(limit - 1, Math.max(0, v)));
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const q = axis ? y : x,
          k = (q - 1) >> 1,
          t = q & 1 ? 0.25 : 0.75,
          base = axis ? x * 4 : y * w * 4;
        const i = base + clamp(k) * stride,
          j = base + clamp(k + 1) * stride,
          l = base + clamp(k - 1) * stride,
          r = base + clamp(k + 2) * stride,
          o = (y * nw + x) * 4;
        for (let c = 0; c < 3; c++) {
          const u = a[i + c],
            v = a[j + c],
            v0 = a[l + c],
            v3 = a[r + c],
            f = u + 0.5 * t * (v - v0 + t * (2 * v0 - 5 * u + 4 * v - v3 + t * (3 * (u - v) + v3 - v0)));
          next[o + c] = Math.round(Math.max(Math.min(u, v), Math.min(Math.max(u, v), f)));
        }
        next[o + 3] = Math.round(a[i + 3] * (1 - t) + a[j + 3] * t);
      }
    a = next;
    w = nw;
    h = nh;
  }
  return a;
}
function down(p, n) {
  const w = n >> 1,
    out = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * 2 * n + x * 2),
        o = (y * w + x) * 4,
        j = i + n * 4;
      for (let c = 0; c < 3; c++)
        out[o + c] = srgb[Math.round(16383.75 * (linear[p[i + c]] + linear[p[i + 4 + c]] + linear[p[j + c]] + linear[p[j + 4 + c]]))];
      out[o + 3] = (p[i + 3] + p[i + 7] + p[j + 3] + p[j + 7] + 2) >> 2;
    }
  return out;
}
export function rebuildDDS(bytes, r) {
  const n = r.side,
    d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u = i => d.getUint32(i * 4, true);
  if (u(0) !== 0x20534444 || u(3) !== n || u(4) !== n || u(21) !== 0x35545844 || u(28) !== 0 || bytes.length < 128 + sizeOfMip(n))
    throw Error('Expected the reviewed 2D BC3 texture: ' + r.file);
  const existing = new Map();
  let at = 128;
  for (let w = n, level = 0; w >= 1 && level < Math.max(1, u(7)); w >>= 1, level++) {
    const end = at + sizeOfMip(w);
    if (end > bytes.length) throw Error('Incomplete input mip chain');
    existing.set(w, bytes.subarray(at, end));
    at = end;
  }
  const forest = r.role === 'endorAtlas' || r.role === 'endorSoil';
  const base = decodeDXT(existing.get(n), n, n, 5);
  const native = forest ? base : finishBase(base, n, r.role),
    top = n * r.scale,
    out = new Uint8Array(outputBytes(r));
  out.set(bytes.subarray(0, 128));
  const header = new DataView(out.buffer);
  for (const [i, v] of [
    [2, 0xa1007],
    [3, top],
    [4, top],
    [5, sizeOfMip(top)],
    [7, Math.log2(top) + 1],
    [20, 4],
    [27, 0x401008]
  ])
    header.setUint32(i * 4, v, true);
  let p = native;
  for (let w = n; w < top; w *= 2) p = double(p, w, r.role === 'planet', false);
  if (forest) {
    for (let y = 0; y < top; y++) for (let x = 0; x < top; x++) {
      const o = 4 * (y * top + x), u = (x + 0.5) / top, v = (y + 0.5) / top;
      // Both reviewed 256px atlases reserve the top-left 50 x 100 texels for trunk.
      const bark = r.role === 'endorAtlas' && u < 50 / 256 && v < 100 / 256;
      if (r.role === 'endorAtlas' && !bark && !p[o+3]) continue;
      const rgb = forestPixel(bark ? 'endorBark' : r.role === 'endorAtlas' ? 'endorLeaves' : 'endorSoil',
        bark ? u * 256 / 50 : u, bark ? v * 256 / 100 : v, p[o], p[o+1], p[o+2], top);
      for (let c = 0; c < 3; c++) p[o+c] = Math.round(clamp8(rgb[c]));
    }
  }
  at = 128;
  for (let w = top; w >= 1; w >>= 1) {
    const orig = existing.get(w);
    let blocks;
    if (orig && w <= 64) blocks = orig;
    else {
      blocks = encodeDXT(p, w, w, 5);
      // At authored resolutions copy the complete BC3 alpha blocks, not a lossy decode/re-encode of team paint/gloss/city masks.
      if (orig) for (let i = 0; i < blocks.length; i += 16) for (let j = 0; j < 8; j++) blocks[i + j] = orig[i + j];
    }
    out.set(blocks, at);
    at += blocks.length;
    if (w > 1) p = !forest && w === 2 * n ? native : down(p, w);
  }
  return out;
}
