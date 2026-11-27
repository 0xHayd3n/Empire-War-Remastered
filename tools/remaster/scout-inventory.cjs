// Serialized into the already authenticated stock battle by Playwright. No imports or game writes.
function scoutInventory(_body, g = globalThis.game) {
  const t = g.terrain,
    active = [...t.paint.slot.keys()].sort((a, b) => a - b);
  const rows = new Map(active.map(slot => [slot, { slot, slopes: [], low: Infinity, high: -Infinity, example: null }]));
  for (let y = 0; y < t.height; y++)
    for (let x = 0; x < t.width; x++) {
      const i = y * t.size + x,
        r = rows.get(t.layerIndex[i]);
      if (!r) continue;
      const dx = (t.heights[i + (x < t.width - 1 ? 1 : 0)] - t.heights[i - (x > 0 ? 1 : 0)]) / (x && x < t.width - 1 ? 40 : 20);
      const dy = (t.heights[i + (y < t.height - 1 ? t.size : 0)] - t.heights[i - (y > 0 ? t.size : 0)]) / (y && y < t.height - 1 ? 40 : 20);
      r.slopes.push(Math.hypot(dx, dy));
      r.low = Math.min(r.low, t.heights[i]);
      r.high = Math.max(r.high, t.heights[i]);
      r.example ??= [x * 20, y * 20];
    }
  const props = new Map(),
    foot = new Map();
  for (const p of g.props) {
    const model = p.modelFile || '(unresolved)',
      r = props.get(model) || { model, count: 0, example: [p.x, p.y] };
    r.count++;
    props.set(model, r);
  }
  for (const u of g.world.units) {
    if (!u.foot || u.dead) continue;
    const r = foot.get(u.side) || { side: u.side, count: 0, example: [u.x, u.y] };
    r.count++;
    foot.set(u.side, r);
  }
  return {
    slots: [...rows.values()].map(r => {
      const v = r.slopes.sort((a, b) => a - b),
        n = v.length,
        l = t.layers[r.slot];
      return {
        slot: r.slot,
        texture: l.texture,
        bump: l.bump,
        tilt: l.tilt,
        turn: l.turn,
        vertices: n,
        height: n ? [r.low, r.high] : null,
        grade: n ? [0.1, 0.5, 0.9].map(p => v[Math.floor((n - 1) * p)]) : null,
        example: r.example
      };
    }),
    props: [...props.values()].sort((a, b) => b.count - a.count),
    foot: [...foot.values()],
    sites: g.world.sites.map(s => [s.x, s.y])
  };
}
module.exports = { scoutInventory };
