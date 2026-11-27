// Same visible T2-B mesh pieces after settling, then an allied heavy tank is
// ordered through them. No impulses, position changes during travel, steering
// patches, or damage to the mover by this fixture.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ serviceWorkers: 'block' }),
      err = [];
    p.on('pageerror', e => err.push(e.message));
    await p.goto((process.env.EW_BASE || 'http://127.0.0.1:8590/') + '#ground-offensive');
    const f = await (await p.waitForSelector('#game')).contentFrame();
    await f.waitForFunction(() => window.game?.ui && !game.warming && game.world?.units.length && game.vehicleWrecks, null, {
      timeout: 180000
    });
    const result = await f.evaluate(() => {
      const g = game,
        w = g.world,
        t = w.terrain,
        layer = g.vehicleWrecks;
      g.paused = true;
      w.aiSuspended = true;
      w.look = null;
      const tank = w.units.find(u => u.type.name === 'T4B_Tank' && !u.dead && u.squad.members.length === 1),
        victim = w.units.find(u => u.type.name === 'T2B_Tank' && !(u.invulnUntil > w.time));
      if (!tank || !victim) throw Error('no tank pair');
      const span = (t.width - 1) * 20;
      let lane;
      for (let y = Math.floor(span * 0.2); y < span * 0.8 && !lane; y += 40)
        for (let x = Math.floor(span * 0.2); x < span * 0.8 && !lane; x += 40) {
          if (w.units.some(u => !u.dead && Math.hypot(x - u.x, y - u.y) < 250)) continue;
          let ok = true;
          for (let d = -120; d <= 120 && ok; d += 5)
            ok =
              !w.viewFogged(x + d, y) &&
              w.isOpen(x + d, y, 2) &&
              !w.wet[Math.round(y / 20) * t.size + Math.round((x + d) / 20)] &&
              Math.abs(w.groundZ(x + d, y) - w.groundZ(x, y)) < 3;
          if (ok) lane = { x, y };
        }
      if (!lane) throw Error('no open site');
      const put = (u, x, y) => {
        u.x = x;
        u.y = y;
        u.z = w.groundZ(x, y) + u.lift + u.hoverZ;
        u.holder.position.set(x, y, u.z);
        u.heading = 0;
        u.holder.rotation.z = Math.PI / 2;
        u.path = [];
        u.target = null;
        u.squad.foe = null;
      };
      put(victim, lane.x, lane.y);
      w.hurt(victim, 1e9, null);
      const roots = layer.live.find(r => r.u === victim)?.pieces.map(p => p.root);
      if (!roots?.length) throw Error('no T2-B wreck');
      for (let i = 0; i < 1080; i++) layer.step(1 / 60, w.units);
      if (!roots.every(r => g.scene.getObjectById(r.id) === r)) throw Error('original sections removed');
      const start = roots.map(r => r.position.clone()),
        at = start[0],
        hp = tank.health;
      put(tank, at.x - 85, at.y);
      if (tank.squad.box) {
        tank.squad.box.x = tank.x;
        tank.squad.box.y = tank.y;
      }
      for (let i = 0; i < 10; i++) layer.step(1 / 30, w.units);
      const drift = Math.max(...roots.map((r, i) => r.position.distanceTo(start[i])));
      if (!w.order(tank.squad, at.x + 95, at.y)) throw Error('move refused');
      let clearance = Infinity,
        travel = 0,
        kick = 0,
        pushAt = null;
      for (let i = 0; i < 500 && travel < 150; i++) {
        w.update(1 / 30);
        layer.step(1 / 30, w.units);
        travel = tank.x - at.x + 85;
        const distance = Math.hypot(at.x - tank.x, at.y - tank.y);
        clearance = Math.min(clearance, distance);
        const motion = Math.max(...roots.map((r, j) => r.position.distanceTo(start[j])));
        if (motion > 0.15 && pushAt === null) pushAt = travel;
        kick = Math.max(kick, motion);
      }
      return {
        map: g.map.file,
        mover: tank.type.name,
        casualty: victim.type.name,
        kept: roots.length,
        drift,
        closest: clearance,
        travel,
        kick,
        pushAt,
        hpChange: tank.health - hp,
        stockHidden: !victim.holder.visible
      };
    });
    console.log(result);
    assert.ok(
      result.drift < 0.02 && result.travel > 125 && result.pushAt > 20 && result.kick > 1 && result.stockHidden && result.hpChange === 0,
      'wreck should move on contact only, without stopping or harming the tank'
    );
    assert.deepEqual(err, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
