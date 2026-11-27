// Mounted Universal: make the authored crush pass decide the kill; never call
// hurt/die/present directly. The test changes placement, not XML eligibility.
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
    await f.waitForFunction(() => window.game?.ui && !game.warming && game.world?.units.length && game.vehicleWrecks, null, {
      timeout: 180000
    });
    const out = await f.evaluate(async () => {
      const g = game,
        w = g.world,
        t = w.terrain;
      g.paused = true;
      w.aiSuspended = true;
      const a = w.units.find(u => u.type.name === 'AT_AT_Walker'),
        cases = [];
      if (!a?.supercrusher || !a.crusher) throw Error('no stock supercrusher');
      const move = (u, x, y) => {
        u.x = x;
        u.y = y;
        u.z = w.groundZ(x, y) + (u.lift || 0) + (u.hoverZ || 0);
        u.holder.position.set(x, y, u.z);
      };
      // Find two authored dry sites without a third participant.
      const sites = [];
      for (let x = 160; x < (t.width - 2) * 20 && sites.length < 3; x += 90)
        for (let y = 160; y < (t.height - 2) * 20 && sites.length < 3; y += 90) {
          if (
            !w.viewFogged(x, y) &&
            w.isOpen(x, y, 1) &&
            !w.wet[Math.round(y / 20) * t.size + Math.round(x / 20)] &&
            w.units.every(u => Math.hypot(u.x - x, u.y - y) > 65)
          )
            sites.push([x, y]);
        }
      if (sites.length !== 3) throw Error('no dry open sites');
      const deaths = w.onDeath,
        called = [];
      w.onDeath = (...args) => {
        called.push(args);
        return deaths(...args);
      };
      for (const [i, name] of ['Rebel_Trooper', 'T2B_Tank'].entries()) {
        const target = w.units.find(u => u.type.name === name && !u.dead && !(u.invulnUntil > w.time)),
          [x, y] = sites[i];
        if (!(target?.squashable || target?.squashableBig) || w.ally(target.side, a.side)) throw Error('ineligible victim ' + name);
        move(target, x, y);
        move(a, x - 1, y);
        a.path = [{ x: x + 35, y }];
        const prior = w.groundZ(x, y);
        w.crushPass();
        const killed = called.filter(([u]) => u === target);
        const r = g.crushedRemains?.rows.find(r => r.x === x && r.y === y),
          layer = g.vehicleWrecks;
        cases.push({
          name,
          dead: target.dead,
          cause: killed[0]?.[1],
          confirmed: killed.length,
          supercrusher: killed[0]?.[2] === a,
          pose: r?.root.name,
          meshes: r?.root.children.length,
          visible: r?.root.visible && r?.root.parent === g.scene,
          hidden: !target.holder.visible,
          replaced: layer.replaced.has(target),
          noFlyingDoll: !layer.live.some(row => row.u === target),
          impression: w.groundZ(x, y) - prior
        });
      }
      // Exercise the touchdown path for Workshop-style leaping crushers. Stock
      // AT-ATs cannot jump: use their real hull/flags with an explicit flight
      // fixture, not a claim about a stock ability. No damage call is injected.
      const b = w.units.find(u => u.type.name === 'Rebel_Trooper' && !u.dead && !(u.invulnUntil > w.time));
      const [x, y] = sites[2];
      move(b, x, y);
      move(a, x - 3, y);
      a.path = [];
      a.flight = { x0: x - 3, y0: y, x1: x, y1: y, t: 0, T: 0.6 };
      let airborne = true;
      for (let i = 0; i < 25 && !b.dead; i++) {
        w.update(1 / 30);
        if (a.flight && b.dead) airborne = false;
      }
      const landing = {
        survivedAirborne: airborne,
        landed: !a.flight,
        flattened: g.crushedRemains?.rows.some(r => r.x === b.x && r.y === b.y),
        cause: called.find(([u]) => u === b)?.[1]
      };
      return { map: g.map.file, cases, landing };
    });
    console.log(JSON.stringify(out));
    assert.ok(
      out.landing.survivedAirborne && out.landing.landed && out.landing.flattened && out.landing.cause === 'CRUSHED',
      'only a qualifying touchdown can flatten the victim'
    );
    for (const c of out.cases) {
      assert.ok(c.dead && c.confirmed === 1 && c.cause === 'CRUSHED' && c.supercrusher);
      assert.ok(c.visible && c.meshes && c.hidden && c.replaced && c.noFlyingDoll);
      assert.ok(c.impression < -0.02, 'stomp should compress the terrain below the victim');
    }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
