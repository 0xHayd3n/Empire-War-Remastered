// Cache extremal skin vertices for each physical span. Capsule centres aren't
// the visible surface: boots, helmets, backpacks and carried kit extend past them.
import { Vector3, Matrix4 } from 'three';
const FLOOR = 0.07;
const v = new Vector3(),
  p = new Vector3(),
  t = new Vector3();
const directions = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) directions.push([x, y, z]);
function vertex(c, j, out) {
  const { position, skinIndex, skinWeight } = c.mesh.geometry.attributes;
  v.fromBufferAttribute(position, j);
  out.set(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const w = skinWeight.getComponent(j, k);
    if (!w) continue;
    const slot = c.weights[skinIndex.getComponent(j, k)];
    if (slot) out.addScaledVector(t.copy(v).applyMatrix4(slot.world), w);
  }
  return out;
}
export function supportClearance(c, height, separate, lift) {
  for (const w of c.weights) (w.world ||= new Matrix4()).multiplyMatrices(w.s.matrix, w.bind);
  if (!c.support) {
    const g = c.mesh.geometry,
      { skinIndex, skinWeight, position } = g.attributes,
      bySpan = new Map();
    const used = g.index ? new Set(g.index.array) : Array.from({ length: position.count }, (_, i) => i);
    for (const j of used) {
      let k = 0;
      for (let h = 1; h < 4; h++) if (skinWeight.getComponent(j, h) > skinWeight.getComponent(j, k)) k = h;
      const span = c.weights[skinIndex.getComponent(j, k)]?.s;
      if (!span) continue;
      let bounds = bySpan.get(span);
      if (!bounds) bySpan.set(span, (bounds = directions.map(() => [-Infinity, 0])));
      const a = vertex(c, j, p);
      for (let i = 0; i < directions.length; i++) {
        const [x, y, z] = directions[i],
          val = x * a.x + y * a.y + z * a.z;
        if (val > bounds[i][0]) {
          bounds[i][0] = val;
          bounds[i][1] = j;
        }
      }
    }
    c.support = [...bySpan].flatMap(([span, rows]) => [...new Set(rows.map(r => r[1]))].map(j => [span, j]));
  }
  for (const [span, j] of c.support) {
    const a = vertex(c, j, p),
      side = span === separate ? 1 : 0;
    lift[side] = Math.max(lift[side], height(a.x, a.y) + FLOOR - a.z);
  }
}
// Exact floor fit for a pose that will not be stepped again. The cached support
// samples above are directional extremes, which is enough while a body can still
// settle, but a slope, a boot or a helmet can leave an interior vertex deeper in
// the terrain than every one of those extremes, and a frozen island never gets
// another frame to correct itself. Runs once, at park time, over every drawn
// vertex of the island: the skinned surface and its rigid kit (weapons, packs).
export function exactClearance(copies, height, separate, limit, lift) {
  const at = new Vector3(),
    toWorld = new Matrix4();
  for (const c of copies) {
    const g = c.mesh.geometry;
    if (!c.mesh.visible || !g?.attributes?.position) continue;
    const { position } = g.attributes,
      index = g.index?.array,
      n = index ? index.length : position.count,
      seen = index ? new Uint8Array(position.count) : null;
    // Rigid kit rides one span; skin blends several, so its island comes from the
    // influences the triangles actually draw with.
    if (c.weights) for (const w of c.weights) (w.world ||= new Matrix4()).multiplyMatrices(w.s.matrix, w.bind);
    else toWorld.multiplyMatrices(c.s.matrix, c.bind);
    for (let i = 0; i < n; i++) {
      const j = index ? index[i] : i;
      if (seen) {
        if (seen[j]) continue;
        seen[j] = 1;
      }
      let island;
      if (c.weights) {
        const { skinIndex, skinWeight } = g.attributes;
        island = 0;
        let drawn = 0;
        for (let k = 0; k < 4; k++) {
          const w = skinWeight.getComponent(j, k),
            slot = c.weights[skinIndex.getComponent(j, k)];
          if (!w || !slot) continue;
          drawn += w;
          if (slot.s === separate) island = 1;
        }
        // A vertex with no resolved influence draws at the origin; ignoring it
        // keeps a stray rig from lifting the corpse by its whole body length.
        if (!(drawn > 0)) continue;
        vertex(c, j, at);
      } else {
        island = c.s === separate ? 1 : 0;
        at.fromBufferAttribute(position, j).applyMatrix4(toWorld);
      }
      const need = height(at.x, at.y) + FLOOR - at.z;
      // A NaN height fails this test instead of poisoning the lift.
      if (need > lift[island]) lift[island] = need;
    }
  }
  // One translation per island is enough, since the terrain is a height field.
  // Bound it so a stray hidden/off-model vertex cannot fling the frozen corpse.
  for (let i = 0; i < 2; i++) lift[i] = Number.isFinite(lift[i]) ? Math.min(limit, Math.max(0, lift[i])) : 0;
}
// Remove only triangles crossing the separation border. Retained triangles
// have influences on exactly one island: the shared skin never stretches across the gap.
export function splitIndex(c, span) {
  const g = c.mesh.geometry,
    { position, skinIndex, skinWeight } = g.attributes;
  const side = new Int8Array(position.count),
    kept = [];
  for (let i = 0; i < side.length; i++)
    for (let k = 0; k < 4; k++)
      if (skinWeight.getComponent(i, k) > 0) {
        side[i] |= c.weights[skinIndex.getComponent(i, k)]?.s === span ? 2 : 1;
      }
  const src = g.index?.array,
    n = src?.length ?? position.count;
  let detached = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = src ? src[i] : i,
      b = src ? src[i + 1] : i + 1,
      d = src ? src[i + 2] : i + 2,
      mask = side[a] | side[b] | side[d];
    if (mask === 1 || mask === 2) {
      kept.push(a, b, d);
      if (mask === 2) detached++;
    }
  }
  return { kept, detached, changed: kept.length !== n };
}
