// One preview-only coordinate system. Never write these positions into a campaign/atlas row.
// Prefer the broad EAWX galactic chart when installed; stock supplies a complete fallback.
const priority = ['1125571106', '1976399102', '3417277973', 'stock'];
const rank = p => (priority.includes(p.id) ? priority.indexOf(p.id) : priority.length);
const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const key = (profile, p) => (profile.id === '1770851727' ? p[0].replace(/_WW$/i, '') : p[0]).toUpperCase().replace(/[^A-Z0-9]/g, '');
const worldIds = p => [...new Set(p.maps.flatMap(m => m.worlds.map(([i]) => i)))];
// Robust 2-D similarity (scale, yaw, translation). The median of anchor-pair transforms
// avoids moving a whole pack because one author put one planet somewhere else.
function registration(matches) {
  const xs = [],
    ys = [];
  // Bounded sampling. Anchors estimate a transform; they never override a map's positions.
  const stride = Math.max(1, Math.ceil(matches.length / 48)),
    sample = matches.filter((_, i) => i % stride === 0);
  for (let i = 0; i < sample.length; i++)
    for (let j = 0; j < i; j++) {
      const [[a, A], [b, B]] = [sample[i], sample[j]],
        dx = b[2] - a[2],
        dy = b[3] - a[3],
        X = B[0] - A[0],
        Y = B[1] - A[1],
        d = dx * dx + dy * dy;
      if (d < 1 || X * X + Y * Y < 1) continue;
      xs.push((dx * X + dy * Y) / d);
      ys.push((dx * Y - dy * X) / d);
    }
  let a = xs.length ? median(xs) : 1,
    b = ys.length ? median(ys) : 0;
  // Inconsistent anchors can cancel out. Fall back to translation, not zero map area.
  if (Math.hypot(a, b) < 1e-6) {
    a = 1;
    b = 0;
  }
  const tx = matches.length ? median(matches.map(([p, r]) => r[0] - a * p[2] + b * p[3])) : 0,
    ty = matches.length ? median(matches.map(([p, r]) => r[1] - b * p[2] - a * p[3])) : 0;
  return { scale: Math.hypot(a, b) || 1, xy: p => [a * p[2] - b * p[3] + tx, b * p[2] + a * p[3] + ty] };
}
export function galaxyChart(profiles) {
  const ordered = [...profiles]
    .filter(p => p.maps.some(m => m.worlds.length))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  const reference = ordered[0],
    full = reference.maps.reduce((a, b) => (a.worlds.length > b.worlds.length ? a : b)),
    sky = full.scenery.map(i => reference.planets[i]).filter(p => p[7] === 1),
    coordinates = new Map(),
    rows = new Map(),
    catalog = new Map(),
    ambiguous = new Set(),
    frame = [];
  for (const p of ordered) {
    const seen = new Map();
    for (const i of worldIds(p)) {
      const w = p.planets[i],
        k = key(p, w);
      if (seen.has(k) && seen.get(k) !== w[0]) ambiguous.add(k);
      seen.set(k, w[0]);
    }
  }
  const identity = (p, w) => (ambiguous.has(key(p, w)) ? p.id + ':' + w[0] : key(p, w));
  const anchors = worldIds(reference).map(i => reference.planets[i]);
  const extent = Math.max(1, ...anchors.map(p => Math.hypot(p[2], p[3])));
  for (const p of ordered) {
    const indices = worldIds(p),
      context = new Set(p.maps.filter(m => m.worlds.length > 1).flatMap(m => m.worlds.map(([i]) => i))),
      matches = indices.map(i => [p.planets[i], coordinates.get(identity(p, p.planets[i]))]).filter(([, r]) => r);
    const { scale, xy } = registration(matches),
      locations = new Map();
    // Place all active worlds with the same transform, preserving their formation.
    // The first ordinary placement for an identity supplies its inactive chart marker.
    for (const i of indices) {
      const world = p.planets[i],
        k = identity(p, world),
        shared = coordinates.get(k);
      let pos = xy(world),
        uncharted = false;
      // AotR parks this setup placeholder at (10000,10000). Distance by itself is
      // not evidence of a dummy: never relocate an ordinary outlying campaign world.
      if (p.id === '1397421866' && world[0] === 'Tutorial_Planet' && Math.hypot(...pos) > extent * 2.5) {
        pos = shared || [0, 0];
        uncharted = true;
      }
      const placed = [...world];
      [placed[2], placed[3]] = pos;
      placed[4] = reference.camera.plane + (world[4] - p.camera.plane) * scale;
      if (!shared && !uncharted) coordinates.set(k, placed.slice(2, 5));
      placed[6] *= scale;
      locations.set(i, { id: k, placed, uncharted });
      if (!uncharted && context.has(i) && !catalog.has(k)) catalog.set(k, { id: k, planet: placed });
      frame.push(placed);
    }
    rows.set(p, locations);
  }
  return { reference, sky, frame, catalog: [...catalog.values()], world: (p, i) => rows.get(p).get(i) };
}
export function sectorView(labels) {
  if (!labels.length) return { zoom: 1, u: 0.5, v: 0.5 };
  const us = labels.map(l => l[0]),
    vs = labels.map(l => l[1]);
  const x = Math.min(...us),
    X = Math.max(...us),
    y = Math.min(...vs),
    Y = Math.max(...vs);
  return { zoom: Math.max(1, Math.min(4, 0.84 / Math.max(0.001, X - x), 0.84 / Math.max(0.001, Y - y))), u: (x + X) / 2, v: (y + Y) / 2 };
}
