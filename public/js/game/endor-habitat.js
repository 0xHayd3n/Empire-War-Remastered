// Derived DRAW slots, never simulation paint. 60/61/63 are reserved only in verified Endor
// full landscape; the terrain has 64 slots and both stock profiles use fewer than 30.
export const MOSS = 60,
  DUFF = 61,
  BED = 63;
// World-height band shared by the coarse material and its near-camera relief mesh.
export const BANK_HEIGHT = 2.8;
export function bankMud(z, level) {
  const t = Math.min(1, Math.max(0, (z - level) / BANK_HEIGHT));
  return 1 - t*t*(3-2*t);
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// A full shoreline cell may contain dry ground. Test the footprint against the actual
// triangles, not the cell's lowest corner, nor the transparent water quad's bounding box.
export function dryFootprint(t, x, y, r = 0) {
  if (t?.water?.mode !== 1) return true;
  const w = t.width ?? t.size,
    h = t.height ?? t.size,
    ground = (x, y) => {
      x = clamp(x / 20, 0, w - 1.0001);
      y = clamp(y / 20, 0, h - 1.0001);
      const a = Math.floor(y) * t.size + Math.floor(x),
        fx = x % 1,
        fy = y % 1,
        H = t.heights;
      return fx >= fy
        ? (1 - fx) * H[a] + (fx - fy) * H[a + 1] + fy * H[a + t.size + 1]
        : (1 - fy) * H[a] + (fy - fx) * H[a + t.size] + fx * H[a + t.size + 1];
    };
  const lo = t.water.level + 0.9;
  return (
    ground(x, y) > lo &&
    (!r ||
      [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-0.71, -0.71],
        [0.71, -0.71],
        [-0.71, 0.71],
        [0.71, 0.71]
      ].every(([a, b]) => ground(x + a * r, y + b * r) > lo))
  );
}
export function floorSlot(id, raw, wet, shade, brush, x, y) {
  if (wet) return BED;
  if (id !== 0 && id !== 1) return raw; // Don't grow leaves over a trail, cliff, beach, or construction.
  const pocket = 0.5 + 0.24 * Math.sin(x * 0.034 + y * 0.021 + 0.95 * Math.sin(y * 0.047)) + 0.22 * Math.sin(y * 0.071 - x * 0.014);
  const shelter = 0.66 * shade + 0.34 * brush;
  if (shelter > 0.48 + 0.19 * pocket || shade > 0.74 + 0.14 * pocket) return DUFF;
  if (id === 0 && (brush > 0.39 + 0.19 * pocket || shelter > 0.28 + 0.17 * pocket)) return MOSS;
  return raw;
}
export function coverAt(image, x, y, width, height) {
  const X = clamp((x / width) * image.width - 0.5, 0, image.width - 1),
    Y = clamp((y / height) * image.height - 0.5, 0, image.height - 1),
    ix = Math.floor(X),
    iy = Math.floor(Y),
    fx = X - ix,
    fy = Y - iy,
    p = image.data;
  const chan = k => {
    const a = (iy * image.width + ix) * 4 + k,
      b = a + (ix + 1 < image.width ? 4 : 0),
      d = iy + 1 < image.height ? 4 * image.width : 0;
    return ((1 - fy) * ((1 - fx) * p[a] + fx * p[b]) + fy * ((1 - fx) * p[a + d] + fx * p[b + d])) / 255;
  };
  return [chan(1), chan(3)];
}
export function forestFloorLayout(t, ids, lightMap) {
  const P = t.paint,
    w = t.width ?? t.size,
    h = t.height ?? t.size,
    slotAt = (i, raw) => {
      const x = (i % t.size) * 20,
        y = Math.floor(i / t.size) * 20,
        wet = t.water?.mode === 1 && t.heights[i] < t.water.level;
      if (wet) return BED;
      const id = ids[raw];
      if (id !== 0 && id !== 1) return raw;
      const [c, b] = coverAt(lightMap.image, x, y, (w - 1) * 20, (h - 1) * 20);
      return floorSlot(id, raw, false, c, b, x, y);
    };
  const counts = { sedimentVertices: 0, shrubMoss: 0, forestDuff: 0 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * t.size + x,
        s = slotAt(i, P.slot.get(t.layerIndex[i]));
      if (s === BED) counts.sedimentVertices++;
      else if (s === DUFF) counts.forestDuff++;
      else if (s === MOSS) counts.shrubMoss++;
    }
  return { slotAt, counts };
}
// Rebuild only the GPU-side layer indices, in the same quad order used by paving and relief.
export function drawFloorSlots(t) {
  const P = t.paint,
    w = t.width ?? t.size,
    h = t.height ?? t.size,
    attr = P.geo.attributes.layers;
  const cache = new Uint8Array(t.layerIndex.length);
  for (let i = 0; i < cache.length; i++) {
    const input = P.slot.get(t.layerIndex[i]);
    cache[i] = input === undefined ? 255 : (P.floorLayout?.slotAt(i, input) ?? input);
  }
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const n = y * t.size + x,
        q = y * (w - 1) + x,
        s = [cache[n], cache[n + 1], cache[n + t.size], cache[n + t.size + 1]],
        fallback = s.find(a => a !== 255) ?? 0;
      for (let k = 0; k < 4; k++) if (s[k] === 255) s[k] = fallback;
      for (let k = 0; k < 2; k++) {
        const o = P.triAt[q * 2 + k];
        if (o >= 0) for (let j = o; j < o + 3; j++) attr.setXYZW(j, ...s);
      }
    }
  attr.needsUpdate = true;
}
