const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 800 } }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8590/#combined-arms');
    const f = page.frameLocator('#game'),
      body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 160000 });
    const before = await body.evaluate(async () => {
      const until = performance.now() + 90000;
      while ((!window.game?.vehicleWrecks || !game.ui || game.warming) && performance.now() < until)
        await new Promise(r => setTimeout(r, 120));
      const g = game,
        w = g.world,
        t = g.openingWreck,
        live = w.units.filter(u => [0, 1].includes(u.side) && !u.structure && !u.dead);
      if (!t) throw Error('Opening tank is missing');
      const blast = g.infantryBlast;
      const result = (window.blastEvidence = { near: 0, outside: 0, peakDuck: 0, restored: 0, bursts: 0 });
      const emit = blast.emit.bind(blast),
        apply = blast.applyOne.bind(blast),
        restore = blast.restore.bind(blast),
        burst = g.fx.burst.bind(g.fx);
      g.fx.burst = (file, x, y, z, ...args) => {
        if (t.health <= 0 && Math.hypot(t.x - x, t.y - y) < 1) result.bursts++;
        return burst(file, x, y, z, ...args);
      };
      blast.emit = (units, x, y, z, r) => {
        const opening = t.health <= 0 && Math.hypot(t.x - x, t.y - y) < 1,
          prev = opening && new Map(blast.active);
        emit(units, x, y, z, r);
        if (opening) {
          const newReactions = [...blast.active.values()].filter(v => prev.get(v.u) !== v);
          result.near = newReactions.filter(v => Math.hypot(v.u.x - x, v.u.y - y) < r).length;
          result.outside += newReactions.filter(v => Math.hypot(v.u.x - x, v.u.y - y) > r + 2).length;
        }
      };
      blast.applyOne = u => {
        const z = u.holder.position.z,
          ok = apply(u);
        if (ok && t.dead) result.peakDuck = Math.max(result.peakDuck, z - u.holder.position.z);
        return ok;
      };
      blast.restore = () => {
        const row = blast.posed[0];
        restore();
        if (row && row.h.position.z === row.r.z && row.bones[0].quaternion.equals(row.r.saved[0])) result.restored++;
      };
      return {
        paused: g.paused,
        name: t.type.name,
        exp: t.type.list('Death_Explosions'),
        tankClearance: t.z - (await import('/js/game/terrain.js')).heightAt(g.terrain,t.x,t.y),
        units: live.length,
        foot: live.filter(u => u.foot).length,
        vehicles: live.filter(u => !u.foot).length
      };
    });
    console.log('start', before);
    assert(before.paused && before.foot === 80 && before.vehicles === 8 && before.tankClearance >= 0);
    await f
      .locator('canvas')
      .first()
      .evaluate(c => c.ownerDocument.defaultView.focus());
    await page.keyboard.press('p');
    const result = await body.evaluate(async () => {
      const end = performance.now() + 90000;
      while (game.world.time < 4.5 && performance.now() < end) await new Promise(r => setTimeout(r, 120));
      return { ...window.blastEvidence, time: game.world.time, over: game.over };
    });
    console.log('after', result);
    assert.deepEqual(errors, []);
    assert(
      result.bursts > 0 &&
        result.near > 0 &&
        result.outside === 0 &&
        result.peakDuck > 0.3 &&
        result.restored > 0 &&
        result.time >= 4.5 &&
        !result.over
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
