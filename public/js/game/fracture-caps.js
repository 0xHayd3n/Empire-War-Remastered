import * as T from 'three';

// Follow the actual cut edges, not a convex hull of a ship. Don't fill the gap
// between two wings or the bore of an engine. Open/ambiguous contours stay open.
export function cutCap(segments, normal, scale) {
  if (!segments.length || segments.length > 768) return null;
  const verts = [],
    edges = [],
    links = [],
    map = new Map(),
    tol = Math.max(1e-6, scale * 1e-5);
  function id(p) {
    const key = [0, 1, 2].map(i => Math.round(p[i] / tol)).join(',');
    if (!map.has(key)) {
      map.set(key, verts.length);
      verts.push(new T.Vector3(p[0], p[1], p[2]));
      links.push([]);
    }
    return map.get(key);
  }
  for (const [p, q] of segments) {
    const a = id(p),
      b = id(q);
    if (a === b) continue;
    edges.push([a, b]);
    links[a].push(b);
    links[b].push(a);
  }
  const u = new T.Vector3(normal.y, -normal.x, 0);
  if (u.lengthSq() < 0.01) u.set(1, 0, 0);
  u.normalize();
  const v = new T.Vector3().crossVectors(normal, u).normalize();
  const seen = new Set(),
    loops = [];
  for (const [start] of edges) {
    if (seen.has(start)) continue;
    const ids = [];
    let prev = -1,
      at = start;
    while (!seen.has(at) && links[at].length === 2) {
      seen.add(at);
      ids.push(at);
      const next = links[at][0] === prev ? links[at][1] : links[at][0];
      prev = at;
      at = next;
    }
    if (at !== start || ids.length < 3) continue;
    const xy = ids.map(i => new T.Vector2(verts[i].dot(u), verts[i].dot(v)));
    loops.push({ ids, xy, area: Math.abs(T.ShapeUtils.area(xy)), parent: null, depth: 0 });
  }
  if (!loops.length || loops.length > 32) return null;
  function contains(r, p) {
    let inside = false;
    for (let j = r.length - 1, i = 0; i < r.length; j = i++) {
      const a = r[i],
        b = r[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  loops.sort((a, b) => b.area - a.area);
  for (let i = 1; i < loops.length; i++)
    for (let j = i - 1; j >= 0; j--)
      if (contains(loops[j].xy, loops[i].xy[0])) {
        loops[i].parent = loops[j];
        loops[i].depth = loops[j].depth + 1;
        break;
      }
  const indices = [];
  for (const loop of loops)
    if (!(loop.depth % 2)) {
      const holes = loops.filter(h => h.parent === loop),
        ids = loop.ids.concat(...holes.map(h => h.ids));
      for (const face of T.ShapeUtils.triangulateShape(
        loop.xy,
        holes.map(h => h.xy)
      ))
        indices.push(...face.map(i => ids[i]));
    }
  if (!indices.length) return null;
  const geo = new T.BufferGeometry();
  geo.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      verts.flatMap(p => p.toArray()),
      3
    )
  );
  geo.setAttribute(
    'uv',
    new T.Float32BufferAttribute(
      verts.flatMap(p => [(p.dot(u) / scale) * 8, (p.dot(v) / scale) * 8]),
      2
    )
  );
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function interiorMaterial() {
  // Matte scorched ribs on the *inside* only. Original exterior materials and
  // team paint stay on the surface triangles. No map/mod texture dependency.
  const pixels = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) {
    const x = i % 8,
      y = i >> 3,
      k = x === 0 || y === 0 ? 20 : y === 1 ? 51 : 31 + ((i * 13) % 11);
    pixels.set([k + 12, k + 7, k + 5, 255], 4 * i);
  }
  const map = new T.DataTexture(pixels, 8, 8);
  map.colorSpace = T.SRGBColorSpace;
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.needsUpdate = true;
  return new T.MeshBasicMaterial({ map, side: T.DoubleSide });
}
