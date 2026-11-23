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
  // Deterministic, bounded sampling; exact shared planets need no approximation at all.
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
  const a = xs.length ? median(xs) : 1,
    b = ys.length ? median(ys) : 0,
    tx = matches.length ? median(matches.map(([p, r]) => r[0] - a * p[2] + b * p[3])) : 0,
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
    frame = [];
  const anchors = worldIds(reference).map(i => reference.planets[i]);
  const extent = Math.max(1, ...anchors.map(p => Math.hypot(p[2], p[3])));
  for (const p of ordered) {
    const indices = worldIds(p),
      matches = indices.map(i => [p.planets[i], coordinates.get(key(p, p.planets[i]))]).filter(([, r]) => r);
    const { scale, xy } = registration(matches),
      locations = new Map();
    // Compute the transform from the prior charts, then resolve exact anchors. Preserve
    // native model, scale ratio and faction-local row indices; never key launches on names.
    for (const i of indices) {
      const world = p.planets[i],
        k = key(p, world),
        shared = coordinates.get(k);
      let pos = shared || xy(world),
        uncharted = false;
      // Some packs park a tutorial/selector thousands of units off the authored galaxy.
      // Center its preview marker rather than stretching every real sector around a dummy.
      if (!shared && Math.hypot(...pos) > extent * 2.5) {
        pos = [0, 0];
        uncharted = true;
      }
      const placed = [...world];
      [placed[2], placed[3]] = pos;
      placed[4] = shared?.[2] ?? reference.camera.plane + (world[4] - p.camera.plane) * scale;
      if (!shared && !uncharted) coordinates.set(k, placed.slice(2, 5));
      placed[6] *= scale;
      locations.set(i, { placed, uncharted });
      frame.push(placed);
    }
    rows.set(p, locations);
  }
  return { reference, sky, frame, world: (p, i) => rows.get(p).get(i) };
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
