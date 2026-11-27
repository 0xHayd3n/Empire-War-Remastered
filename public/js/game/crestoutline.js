// Subpixel isocontours of a mounted insignia. This runs on the native crop in
// the atlas worker, before any UI thumbnail is made. Preserve islands AND holes;
// a dark gap through a cog must still be a hole viewed from the other side.
const RANGE = 8192;
function simplify(points, epsilon) {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const work = [[0, points.length - 1]];
  while (work.length) {
    const [a, b] = work.pop(),
      [x, y] = points[a],
      dx = points[b][0] - x,
      dy = points[b][1] - y,
      L = dx * dx + dy * dy;
    let best = epsilon * epsilon,
      j = -1;
    for (let i = a + 1; i < b; i++) {
      const rx = points[i][0] - x,
        ry = points[i][1] - y,
        t = L ? Math.max(0, Math.min(1, (rx * dx + ry * dy) / L)) : 0,
        d = (rx - t * dx) ** 2 + (ry - t * dy) ** 2;
      if (d > best) {
        best = d;
        j = i;
      }
    }
    if (j >= 0) {
      keep[j] = 1;
      work.push([a, j], [j, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
export function traceCrestField(field, w, h, iso, scale) {
  const links = new Map(),
    pos = new Map(),
    line = (a, b) => {
      for (const [u, v] of [
        [a, b],
        [b, a]
      ]) {
        const p = links.get(u);
        if (p) p.push(v);
        else links.set(u, [v]);
      }
    };
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const k = x + y * w,
        idx = [k, k + 1, k + w + 1, k + w],
        v = idx.map(i => field[i]),
        inside = v.map(n => n > iso);
      if (inside.every(b => b === inside[0])) continue;
      const ids = [2 * k, 2 * (k + 1) + 1, 2 * (k + w), 2 * k + 1],
        cross = [];
      for (let e = 0; e < 4; e++) {
        const n = (e + 1) % 4;
        if (inside[e] === inside[n]) continue;
        const id = ids[e];
        cross.push(id);
        if (!pos.has(id)) {
          const t = (iso - v[e]) / (v[n] - v[e]);
          pos.set(id, [x + [t, 1, 1 - t, 0][e], y + [0, t, 1, 1 - t][e]]);
        }
      }
      if (cross.length === 2) line(...cross);
      else if (v.reduce((s, a) => s + a, 0) / 4 > iso === inside[0]) {
        line(cross[0], cross[1]);
        line(cross[2], cross[3]);
      } else {
        line(cross[0], cross[3]);
        line(cross[1], cross[2]);
      }
    }
  const paths = [];
  for (const start of links.keys()) {
    let prev = -1,
      cur = start;
    const p = [];
    do {
      const edge = links.get(cur);
      if (!edge) break;
      links.delete(cur);
      p.push(pos.get(cur));
      const next = edge[0] === prev ? edge[1] : edge[0];
      prev = cur;
      cur = next;
    } while (cur !== start);
    if (cur !== start || p.length < 3) continue;
    const area = p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0);
    if (Math.abs(area) < 1.1) continue;
    // Split the closed path at a distant point so RDP can't collapse a ring.
    let j = 1,
      r = 0;
    for (let i = 1; i < p.length; i++) {
      const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2;
      if (d > r) {
        r = d;
        j = i;
      }
    }
    const eps = Math.max(0.14, scale * 0.0008),
      loop = [...simplify(p.slice(0, j + 1), eps).slice(0, -1), ...simplify([...p.slice(j), p[0]], eps).slice(0, -1)];
    if (loop.length >= 3)
      paths.push(loop.flatMap(([a, b]) => [Math.round(((a - 0.5) * RANGE) / scale), Math.round(((b - 0.5) * RANGE) / scale)]));
  }
  return paths;
}
export function crestOutline(src, { x = 0, y = 0, w = src.width, h = src.height } = {}, mode = 'device') {
  if (!w || !h || x + w > src.width || y + h > src.height) return null;
  const W = w + 2,
    H = h + 2,
    size = Math.max(w, h),
    v = new Float32Array(W * H),
    hist = new Uint32Array(256),
    colors = new Map();
  let white = 0,
    ink = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const p = ((j + y) * src.width + i + x) * 4,
        s = src.data;
      if (s[p + 3] > 64) {
        ink++;
        if (mode === 'relief' && i > w * 0.15 && i < w * 0.85 && j > h * 0.15 && j < h * 0.85) {
          const q = (s[p] >> 4) * 256 + (s[p + 1] >> 4) * 16 + (s[p + 2] >> 4);
          colors.set(q, (colors.get(q) || 0) + 1);
        }
        if (Math.min(s[p], s[p + 1], s[p + 2]) > 196) white++;
      }
    }
  if (!ink) return null;
  const device = white > ink * 0.045,
    dominant = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0] || 0,
    back = [(dominant >> 8) * 16 + 8, ((dominant >> 4) & 15) * 16 + 8, (dominant & 15) * 16 + 8],
    detail = mode === 'relief' ? new Float32Array(W * H) : null,
    dh = new Uint32Array(256);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const p = ((j + y) * src.width + i + x) * 4,
        s = src.data,
        hi = Math.max(s[p], s[p + 1], s[p + 2]),
        lo = Math.min(s[p], s[p + 1], s[p + 2]);
      const k = (j + 1) * W + i + 1,
        alpha = s[p + 3] / 255;
      let value = device ? lo + 0.07 * (hi - lo) : hi;
      if (mode === 'relief' || mode === 'ink') value = hi;
      if (mode === 'chroma') value = hi - lo;
      if (mode === 'event-red' || mode === 'event-blue') {
        const r = Math.hypot(i + 0.5 - w / 2, j + 0.5 - h / 2);
        value =
          r > h * 0.445
            ? 0
            : mode === 'event-red'
              ? Math.max(0, s[p] - Math.max(s[p + 1], s[p + 2]) * 0.75)
              : Math.max(0, s[p + 2] - Math.max(s[p], s[p + 1]));
      }
      const a = value * alpha;
      v[k] = a;
      if (detail) {
        detail[k] = Math.min(255, Math.max(...back.map((b, c) => Math.abs(b - s[p + c])))) * alpha;
        dh[Math.round(detail[k])]++;
      }
      if (a > 1) hist[Math.round(a)]++;
    }
  let peak = 255,
    n = 0;
  while (peak > 1 && (n += hist[peak]) < ink * 0.035) peak--;
  const cut = Math.max(3, peak * (mode === 'relief' ? 0.16 : mode === 'ink' ? 0.22 : 0.42)) + 0.013,
    body = traceCrestField(v, W, H, cut, size);
  if (!body.length) return null;
  if (detail) {
    let top = 255,
      sum = 0;
    while (top > 1 && (sum += dh[top]) < ink * 0.04) top--;
    const level = Math.max(17, top * 0.31) + 0.01;
    for (let i = 0; i < v.length; i++) if (v[i] <= cut) detail[i] = 0;
    const relief = traceCrestField(detail, W, H, level, size);
    if (relief.length) return { w, h, body, relief };
  }
  return { w, h, body };
}
