// Run after the two destruction observations so an order or a combat tick cannot
// affect their captures. Spawn the same mounted guest definition in a dry lane.
module.exports = async function workshopSteps() {
  const { g, veh } = window.__detailTest,
    w = g.world,
    t = w.terrain;
  w.aiSuspended = true;
  const type = veh.type.name,
    side = veh.side,
    min = g.map.playMin,
    max = g.map.playMax;
  let lane;
  for (let y = min[1] + 130; y < max[1] - 130 && !lane; y += 50)
    for (let x = min[0] + 130; x < max[0] - 130 && !lane; x += 50) {
      if (w.units.some(u => Math.hypot(x - u.x, y - u.y) < 250)) continue;
      let ok = true;
      for (let k = -80; k <= 80 && ok; k += 6)
        ok =
          w.isOpen(x + k, y, 2) &&
          !w.wet[Math.round(y / 20) * t.size + Math.round((x + k) / 20)] &&
          Math.abs(w.groundZ(x + k, y) - w.groundZ(x, y)) < 3;
      if (ok) lane = { x, y };
    }
  if (!lane) throw Error('No dry Workshop lane');
  const { x, y } = lane,
    q = await w.spawn(type, x - 60, y, 0, side),
    u = q?.members[0];
  if (!u || !w.order(q, x + 65, y)) throw Error('Native walker order refused');
  for (let i = 0; i < 400 && u.x < x + 40; i++) w.update(1 / 30);
  const marks = [...g.craters.pads].filter(p => Math.abs(p.x - x) < 80 && Math.abs(p.y - y) < 25),
    depth = marks.length ? Math.max(...marks.map(p => -g.craters.offsetAt(p.x, p.y))) : 0;
  return { type, map: g.map.file, travel: u.x - x + 60, marks: marks.length, depth };
};
