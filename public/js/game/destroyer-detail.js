// These fittings are generated locally, in the *named hull mesh's local coordinates*.
// Do not substitute these anchors on a different Workshop model with the same file name.
import * as T from 'three';
const matches = new WeakMap();
export function stockHull(u) {
  const mesh = u.model?.meshByName?.get('EV_STARDESTROYER')?.children[0];
  if (
    !mesh?.isMesh ||
    !mesh.material?.uniforms?.shadowMap ||
    mesh.material.transparent ||
    mesh.material.defines?.UNLIT ||
    mesh.material.defines?.NATIVE_MESH_GLOSS_EMISSIVE
  )
    return null;
  const g = mesh.geometry.battleSource || mesh.geometry;
  if (!matches.has(g)) {
    let h = 2166136261;
    if (g.attributes.position.count === 5507 && g.index?.count === 11442) {
      for (const a of [g.attributes.position.array, g.index.array])
        for (const v of new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) h = Math.imul(h ^ v, 16777619);
    }
    matches.set(g, h >>> 0 === 1011994460);
  }
  return matches.get(g) ? mesh : null;
}
const v = (x, y, z) => new T.Vector3(x, y, z);
export function shipFittings(geometry) {
  const out = {},
    uv0 = [0, 0];
  function tri(kind, a, b, c, uv = [uv0, uv0, uv0]) {
    const part = (out[kind] ??= { pos: [], nrm: [], tan: [], bin: [], uv: [] });
    const e = b.clone().sub(a),
      f = c.clone().sub(a),
      n = e.clone().cross(f).normalize();
    const dx = uv[1][0] - uv[0][0],
      dy = uv[1][1] - uv[0][1],
      ex = uv[2][0] - uv[0][0],
      ey = uv[2][1] - uv[0][1],
      d = dx * ey - dy * ex;
    const t =
      Math.abs(d) > 1e-8
        ? e
            .clone()
            .multiplyScalar(ey / d)
            .addScaledVector(f, -dy / d)
            .normalize()
        : e.normalize();
    const bn = n
      .clone()
      .cross(t)
      .multiplyScalar(d < 0 ? -1 : 1);
    for (const [i, p] of [a, b, c].entries()) {
      part.pos.push(...p.toArray());
      part.nrm.push(...n.toArray());
      part.tan.push(...t.toArray());
      part.bin.push(...bn.toArray());
      part.uv.push(...uv[i]);
    }
  }
  function quad(k, a, b, c, d) {
    tri(k, a, b, c);
    tri(k, c, d, a);
  }
  function box(k, x, y, z, w, l, h) {
    const p = [];
    for (const zz of [z, z + h])
      for (const [xx, yy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ])
        p.push(v(x + (xx * w) / 2, y + (yy * l) / 2, zz));
    quad(k, ...p.slice(4));
    for (let i = 0; i < 4; i++) {
      let j = (i + 1) % 4;
      quad(k, p[i], p[j], p[j + 4], p[i + 4]);
    }
    quad(k, p[3], p[2], p[1], p[0]);
  }
  const pick = new T.Raycaster(),
    target = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
  // Index the dorsal triangles in XY once. Raycasting the full 3814-triangle hull for
  // every plate corner stalls the first close-up. Barycentric interpolation also lets a
  // whole plate stay in one UV chart instead of stretching paint across a texture seam.
  const grid = new Map(),
    ps = geometry.attributes.position,
    uvs = geometry.attributes.uv,
    idx = geometry.index.array;
  const key = (x, y) => x + 64 * y;
  for (let i = 0; i < idx.length; i += 3) {
    const ids = [idx[i], idx[i + 1], idx[i + 2]],
      p = ids.map(j => new T.Vector3().fromBufferAttribute(ps, j));
    const [a, b, c] = p,
      e = b.clone().sub(a),
      f = c.clone().sub(a),
      n = e.clone().cross(f),
      det = n.z;
    if (Math.abs(det) < 1e-6) continue;
    n.normalize();
    const uv = ids.map(j => new T.Vector2().fromBufferAttribute(uvs, j));
    const face = { a, e, f, n, det, uv };
    const xx = p.map(q => Math.floor(q.x / 24)),
      yy = p.map(q => Math.floor(q.y / 24));
    for (let y = Math.min(...yy); y <= Math.max(...yy); y++)
      for (let x = Math.min(...xx); x <= Math.max(...xx); x++) {
        const k = key(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(face);
      }
  }
  const weights = (f, x, y) => [((x - f.a.x) * f.f.y - (y - f.a.y) * f.f.x) / f.det, (f.e.x * (y - f.a.y) - f.e.y * (x - f.a.x)) / f.det];
  function hit(x, y) {
    let best = null;
    for (const f of grid.get(key(Math.floor(x / 24), Math.floor(y / 24))) || []) {
      const [s, t] = weights(f, x, y);
      if (s < 0 || t < 0 || s + t > 1) continue;
      const z = f.a.z + s * f.e.z + t * f.f.z;
      if (!best || z > best.point.z) best = { point: v(x, y, z), face: f };
    }
    return best;
  }
  function tex(f, p) {
    const [s, t] = weights(f, p.x, p.y);
    return [0, 1].map(j => {
      const k = j ? 'y' : 'x';
      return (1 - s - t) * f.uv[0][k] + s * f.uv[1][k] + t * f.uv[2][k];
    });
  }
  // Cut independent stepped armor plates. Carry the mounted UVs (including team paint) across each top.
  // Reject steps/gaps rather than bridging a gun, trench or superstructure with a floating plate.
  for (let row = 0; row < 25; row++)
    for (let col = -9; col <= 9; col++) {
      const y = -236 + row * 19,
        x = col * 17 + (row % 2) * 8.5;
      if (Math.abs(x) < 6 || Math.abs(x) > 0.31 * (y + 316) - 3) continue;
      const w = 14 + (Math.abs(col + row) % 3),
        l = 15.8,
        corners = [
          [-w / 2 + 2, -l / 2],
          [w / 2, -l / 2],
          [w / 2, l / 2 - 2],
          [w / 2 - 2, l / 2],
          [-w / 2, l / 2],
          [-w / 2, -l / 2 + 2]
        ];
      const a = corners.map(([dx, dy]) => hit(x + dx, y + dy));
      if (a.some(q => !q || Math.abs(q.face.n.z) < 0.86)) continue;
      const center = hit(x, y);
      if (!center || a.some(q => Math.abs(q.point.clone().sub(center.point).dot(center.face.n)) > 0.65)) continue;
      // Do not repaint a livery boundary or a separately unwrapped panel with a neighbour's UVs.
      const paint = a.map(q => tex(center.face, q.point));
      if (a.some((q, i) => tex(q.face, q.point).some((c, j) => Math.abs(c - paint[i][j] - Math.round(c - paint[i][j])) > 0.012))) continue;
      const b = a.map(q => q.point.clone().add(v(0, 0, 0.55 + (row % 3) * 0.13)));
      for (let i = 1; i < b.length - 1; i++) tri('armor', b[0], b[i], b[i + 1], [paint[0], paint[i], paint[i + 1]]);
      for (let i = 0; i < b.length; i++) {
        const j = (i + 1) % b.length;
        quad('edge', a[i].point, a[j].point, b[j], b[i]);
      }
      if ((row + Math.abs(col) * 2) % 7 === 0) {
        const z = center.point.z + 1.05;
        box('edge', x, y, z, 7, 7, 0.5);
        for (let k = -2; k <= 2; k++) box('metal', x, y + k * 1.1, z + 0.5, 6, 0.46, 0.45);
      }
    }
  // Command-tower projecting visor, broken window bands, and vertical mullions.
  // The shipped tower is asymmetric (the bridge front spans x=-23…55, not ±55).
  box('edge', 16, 206.2, 165, 77.6, 6.2, 3.7);
  for (const sign of [-1, 1]) {
    const cx = 16 + sign * 19.5;
    box('trim', cx, 206.8, 169, 38.7, 10, 1.6);
    for (let j = 0; j < 13; j++) box('glass', cx - 16.6 + j * 2.76, 203.0, 167.1, 1.95, 0.85, 1.05);
    for (let j = -1; j <= 1; j++) box('metal', cx + 12 * j, 204.8, 162.6, 1.25, 4.5, 3.5);
  }
  // Annular lips and radial ribs; leave the three original emissive nozzle apertures entirely open.
  for (const x of [-87.2, -0.04, 87.2])
    for (let i = 0; i < 48; i++) {
      const ring = (j, r, y) => v(x + Math.cos((j * Math.PI) / 24) * r, y, 50.6 + Math.sin((j * Math.PI) / 24) * r);
      quad('metal', ring(i, 22.6, 302), ring(i + 1, 22.6, 302), ring(i + 1, 22, 308), ring(i, 22, 308));
      quad('trim', ring(i, 22, 308), ring(i + 1, 22, 308), ring(i + 1, 20.3, 308), ring(i, 20.3, 308));
      if (i % 3 === 0) quad('edge', ring(i, 23, 301), ring(i + 1, 23, 301), ring(i + 1, 22.6, 307), ring(i, 22.6, 307));
    }
  // Shoulder of the equatorial trench. Follow the actual side wall, leaving its negative space open.
  for (const sign of [-1, 1])
    for (let i = 0; i < 36; i++) {
      const y = -211 + i * 12.3;
      pick.set(v(sign * 260, y, 52), v(-sign, 0, 0));
      const h = pick.intersectObject(target, false)[0];
      if (!h || Math.abs(h.face.normal.x) < 0.62) continue;
      box('edge', h.point.x, y, 51.5, 3.2, 8.2, 1.5);
      box('trim', h.point.x + sign * 0.8, y, 53, 2.4, 7.2, 0.65);
    }
  target.material.dispose();
  return Object.fromEntries(
    Object.entries(out).map(([k, a]) => {
      const g = new T.BufferGeometry();
      for (const [key, src, n] of [
        ['position', 'pos', 3],
        ['normal', 'nrm', 3],
        ['tangent', 'tan', 3],
        ['binormal', 'bin', 3],
        ['uv', 'uv', 2]
      ])
        g.setAttribute(key, new T.Float32BufferAttribute(a[src], n));
      g.computeBoundingSphere();
      return [k, g];
    })
  );
}
