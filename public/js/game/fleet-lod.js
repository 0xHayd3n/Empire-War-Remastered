// Return authored alternatives only. Lower LOD suffixes are not reliably the cheaper mesh.
export function rigidLodPairs(meshes) {
  const chains = new Map(),
    pairs = new Map();
  for (const mesh of meshes) {
    const match = /^(.*)_LOD(\d)$/i.exec(mesh.name);
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key).push(mesh);
  }
  const cost = m => m.subs.reduce((sum, s) => sum + (s.geometry?.indices?.length || 0), 0);
  const rigid = m =>
    !m.hidden &&
    !m.collision &&
    m.subs.length === 1 &&
    !m.subs[0].geometry.boneMap &&
    !/RSkin|B4I4/i.test(m.subs[0].geometry.format) &&
    m.subs[0].geometry.stride &&
    m.subs[0].material;
  for (const list of chains.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => cost(b) - cost(a));
    const high = list[0];
    if (!rigid(high) || cost(high) === cost(list[1]) || !high.bbox?.every(Number.isFinite)) continue;
    const extent = Math.max(...[0, 1, 2].map(i => high.bbox[i + 3] - high.bbox[i]));
    const lo = list
      .slice(1)
      .find(
        m =>
          rigid(m) &&
          m.bone === high.bone &&
          m.subs[0].geometry.format === high.subs[0].geometry.format &&
          cost(m) > 0 &&
          cost(m) <= 0.8 * cost(high) &&
          m.bbox?.length === 6 &&
          extent > 0 &&
          m.bbox.every((v, i) => Math.abs(v - high.bbox[i]) <= 0.05 * extent) &&
          JSON.stringify(m.subs[0].material) === JSON.stringify(high.subs[0].material)
      );
    if (lo) pairs.set(high, lo);
  }
  return pairs;
}

// Conservative projected diameter in drawing-buffer pixels, with hysteresis on approach.
export function distantFleetHull(wasFar, radius, depth, focalHeight) {
  return (
    radius > 0 &&
    Number.isFinite(depth) &&
    depth > radius &&
    focalHeight > 0 &&
    (focalHeight * radius) / (depth - radius) < (wasFar ? 24 : 18)
  );
}
