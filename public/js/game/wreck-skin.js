import * as T from 'three';

// Snapshot the authored breakup rig. Bones connected by even one triangle stay in
// the same body. Don't tear a skinned wing in half just because it uses two bones.
export function wreckSkin(mesh, skin, onlySplit = false) {
  const g = mesh.geometry,
    { position: p, skinIndex: b, skinWeight: w } = g.attributes,
    palette = skin?.mats;
  if (!palette || !p || !b || !w || !g.index || g.index.count > 150000 || p.count > 150000) return [];
  const count = palette.length / 16;
  if (!Number.isInteger(count) || count < 1 || count > 256 || b.count !== p.count || w.count !== p.count || g.index.count % 3) return [];
  const parent = Array.from({ length: count }, (_, i) => i),
    ids = g.index.array.subarray(g.drawRange.start, Math.min(g.index.count, g.drawRange.start + g.drawRange.count));
  if (ids.length % 3) return [];
  const find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const link = (a, b) => {
    parent[find(a)] = find(b);
  };
  const bone = new Uint16Array(p.count),
    posed = new T.BufferAttribute(new Float32Array(p.count * 3), 3),
    v = new T.Vector3(),
    tmp = new T.Vector3(),
    out = new T.Vector3();
  const mats = parent.map((_, i) => new T.Matrix4().fromArray(palette, 16 * i));
  for (let i = 0; i < p.count; i++) {
    let first = -1;
    v.fromBufferAttribute(p, i);
    out.set(0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const k = b.getComponent(i, j),
        weight = w.getComponent(i, j);
      if (!(weight > 0)) continue;
      if (!Number.isInteger(k) || k < 0 || k >= count) return [];
      first < 0 ? (first = k) : link(first, k);
      out.addScaledVector(tmp.copy(v).applyMatrix4(mats[k]), weight);
    }
    bone[i] = Math.max(0, first);
    posed.setXYZ(i, out.x, out.y, out.z);
  }
  for (let i = 0; i < ids.length; i += 3) {
    if (ids[i] >= p.count || ids[i + 1] >= p.count || ids[i + 2] >= p.count) return [];
    link(bone[ids[i]], bone[ids[i + 1]]);
    link(bone[ids[i]], bone[ids[i + 2]]);
  }
  const sets = new Map(),
    tri = new T.Triangle();
  for (let i = 0; i < ids.length; i += 3) {
    const a = ids[i],
      b = ids[i + 1],
      c = ids[i + 2];
    tri.a.fromBufferAttribute(posed, a);
    tri.b.fromBufferAttribute(posed, b);
    tri.c.fromBufferAttribute(posed, c);
    if (tri.getArea() < 1e-7) continue; // invisible animation keys collapse triangles
    const k = find(bone[a]);
    let group = sets.get(k);
    if (!group) sets.set(k, (group = { ids: [], box: new T.Box3() }));
    group.ids.push(a, b, c);
    group.box.expandByPoint(tri.a).expandByPoint(tri.b).expandByPoint(tri.c);
  }
  if (onlySplit && sets.size < 2) return [];
  const frozen = palette.slice();
  return [...sets.values()].map(s => {
    const part = new T.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) part.setAttribute(k, a);
    part.setIndex(s.ids);
    part.boundingBox = s.box;
    part.boundingSphere = s.box.getBoundingSphere(new T.Sphere());
    const m = new T.Mesh(part, mesh.material);
    m.matrixWorld.copy(mesh.matrixWorld);
    m.userData.frozenPalette = frozen;
    return m;
  });
}
// Some DIE clips collapse the rig to a point before the last animation frame.
// Find the first final hide key in the closing tenth of the clip, and snapshot
// immediately before it rather than trying to recover a vanished section.
export function releaseTime(state) {
  if (!state) return 1;
  const { frames, fps, duration } = state.anim;
  let last = frames - 1;
  const used = new Set();
  for (const s of state.inst.skins) {
    for (const id of s.boneMap) {
      for (let b = state.inst.bones[id]; b && !used.has(b) && b !== state.inst.root; b = b.parent) used.add(b);
    }
  }
  for (const { t, bone } of state.bound) {
    if (!t.vis || (used.size && !used.has(bone))) continue;
    let f = frames - 1;
    while (f >= 0 && !((t.vis[f >> 3] >> (f & 7)) & 1)) f--;
    if (f >= frames * 0.9) last = Math.min(last, f);
  }
  return Math.max(0, Math.min(duration - 1 / fps, (last - 1) / fps));
}
export function releaseSkinGeometry(g) {
  for (const k of Object.keys(g.attributes)) g.deleteAttribute(k);
  g.dispose();
}
