// Compare accepted movement on two clean stock lanes. No manual foot events,
// no edit of the height buffer, and no direct call to a footprint producer.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ serviceWorkers: 'block' }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto((process.env.EW_BASE || 'http://127.0.0.1:8590/') + '#ground-offensive');
    const f = await (await p.waitForSelector('#game')).contentFrame();
    await f.waitForFunction(() => window.game?.ui && !game.warming && game.world?.units.length && game.craters?.ready, null, {
      timeout: 180000
    });
    const rows = await f.evaluate(async () => {
      const T = await import('three'),
        { heightAt } = await import('/js/game/terrain.js');
      const g = game,
        w = g.world,
        t = w.terrain,
        side = (t.width - 1) * 20,
        used = [],
        out = [];
      g.paused = true;
      w.aiSuspended = true;
      for (const name of ['AT_AT_Walker', 'Stormtrooper']) {
        const u = w.units.find(u => u.type.name === name && !u.dead && u.squad.members.length === 1 && !u.squad.box);
        if (!u) throw Error('no mobile ' + name);
        let lane;
        for (let y = Math.floor(side * 0.2) + 0.23; y < side * 0.8 && !lane; y += 40)
          for (let x = Math.floor(side * 0.2) + 0.67; x < side * 0.8 && !lane; x += 40) {
            if (w.units.some(o => !o.dead && Math.hypot(x - o.x, y - o.y) < 250) || used.some(o => Math.hypot(x - o.x, y - o.y) < 220))
              continue;
            let ok = true;
            for (let k = -85; k < 85 && ok; k += 5)
              ok =
                !w.viewFogged(x + k, y) &&
                w.isOpen(x + k, y, 2) &&
                !w.wet[Math.round(y / 20) * t.size + Math.round((x + k) / 20)] &&
                Math.abs(w.groundZ(x + k, y) - w.groundZ(x, y)) < 3;
            if (ok) lane = { x, y };
          }
        if (!lane) throw Error('no dry visible lane');
        const { x, y } = lane;
        used.push(lane);
        u.x = x - 65;
        u.y = y;
        u.z = w.groundZ(u.x, y) + u.lift + u.hoverZ;
        u.heading = 0;
        u.holder.position.set(u.x, u.y, u.z);
        u.path = [];
        u.target = null;
        u.squad.foe = null;
        u.startAt = u.blockFails = u.v = 0;
        g.view.x = x;
        g.view.y = y;
        w.look = null;
        const at = (a, b) => heightAt(t, a, b, true) - heightAt(t, a, b, true, null);
        const scan = () => {
          let depth = 0,
            ax = x,
            ay = y,
            cells = 0;
          for (let j = -22; j <= 22; j++)
            for (let i = -55; i <= 50; i++) {
              const off = at(x + i, y + j);
              if (off < -0.005) cells++;
              if (off < depth) {
                depth = off;
                ax = x + i;
                ay = y + j;
              }
            }
          return { depth, ax, ay, cells };
        };
        const before = scan();
        if (!w.order(u.squad, x + 80, y)) throw Error('move refused');
        for (let i = 0; i < 450 && u.x < x + 60; i++) w.update(1 / 30);
        const boss = scan(),
          { ax, ay } = boss;
        g.ground.updateWorldMatrix(true, true);
        const ray = new T.Raycaster(new T.Vector3(ax, ay, w.groundZ(ax, ay) + 200), new T.Vector3(0, 0, -1));
        const hit = ray.intersectObject(g.ground, true)[0];
        out.push({
          name,
          travel: u.x - x + 65,
          before: before.depth,
          after: boss.depth,
          displacedSamples: boss.cells,
          surfaceError: hit ? Math.abs(hit.point.z - w.groundZ(ax, ay)) : null
        });
      }
      return out;
    });
    console.log(rows);
    for (const a of rows) {
      assert.ok(a.travel > 115 && a.before === 0, 'clean walk');
      assert.ok(
        a.after < -0.01 && a.displacedSamples > 0 && a.surfaceError !== null && a.surfaceError < 0.005,
        'drawn and walkable footprint'
      );
    }
    assert.ok(rows[0].after < rows[1].after - 0.2, 'heavy walker leaves deeper impressions than infantry');
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
