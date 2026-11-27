import * as T from 'three';

// Project a mark onto the actual local triangles, not a billboard aimed at the camera.
// A stamp never crosses a hull gap to a back-facing or distant plate. Geometry is shared
// only for the triangle search; each mark belongs to one ship and carries no simulation state.
const cache = new WeakMap();
function triangles(g) {
  let list = cache.get(g);
  if (list) return list;
  list = [];
  const p = g.attributes.position,
    index = g.index,
    vertex = i => new T.Vector3().fromBufferAttribute(p, index ? index.getX(i) : i);
  for (let i = 0, n = index?.count ?? p.count; i < n; i += 3) {
    const tri = new T.Triangle(vertex(i), vertex(i + 1), vertex(i + 2)),
      normal = tri.getNormal(new T.Vector3());
    if (normal.lengthSq() > 0.9) list.push({ tri, normal, box: new T.Box3().setFromPoints([tri.a, tri.b, tri.c]) });
  }
  cache.set(g, list);
  return list;
}
export function surfacePatch(g, local, radius, shield = false) {
  const list = triangles(g),
    q = new T.Vector3(),
    center = new T.Vector3();
  let nearest = null,
    best = Infinity;
  for (const f of list) {
    if (f.box.distanceToPoint(local) ** 2 >= best) continue;
    f.tri.closestPointToPoint(local, q);
    const d = q.distanceToSquared(local);
    if (d < best) {
      best = d;
      nearest = f;
      center.copy(q);
    }
  }
  if (!nearest) return null;
  const normal = nearest.normal,
    axis = new T.Vector3(Math.abs(normal.z) < 0.9 ? 0 : 1, 0, Math.abs(normal.z) < 0.9 ? 1 : 0).cross(normal).normalize(),
    bit = normal.clone().cross(axis);
  const pos = [],
    uv = [];
  for (const f of list) {
    if (f.box.distanceToPoint(center) > radius * 1.3 || f.normal.dot(normal) < (shield ? 0.3 : 0.62)) continue;
    f.tri.closestPointToPoint(center, q);
    if (q.distanceToSquared(center) > radius * radius * 1.69 || Math.abs(q.sub(center).dot(normal)) > radius * 0.24) continue;
    for (const p of [f.tri.a, f.tri.b, f.tri.c]) {
      q.copy(p).addScaledVector(f.normal, shield ? 0.55 : 0.36);
      pos.push(q.x, q.y, q.z);
      q.copy(p).sub(center);
      uv.push(q.dot(axis) / radius, q.dot(bit) / radius);
    }
  }
  if (!pos.length) return null;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  return { geo, center };
}
// Cold interiors sit inside the three signature-checked main bells, leaving the metal lips visible.
export function coldBankGeometry() {
  const p = [],
    uv = [];
  for (const x of [-87.2, -0.04, 87.2])
    for (let i = 0; i < 40; i++)
      for (const [angle, r] of [
        [0, 0],
        [(i * 2 * Math.PI) / 40, 1],
        [((i + 1) * 2 * Math.PI) / 40, 1]
      ]) {
        const a = r * Math.cos(angle),
          b = r * Math.sin(angle);
        p.push(x + 20 * a, 304.6, 50.6 + 20 * b);
        uv.push(a, b);
      }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  return g;
}
