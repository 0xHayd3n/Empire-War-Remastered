// Fresh mounted Universal profile: persist via the actual settings control, then
// verify the authored opening blast, two independent skin islands, and frozen-pose cleanup.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const menu = await ctx.newPage(),
      errors = [];
    menu.on('pageerror', e => errors.push(e.message));
    await menu.goto('http://127.0.0.1:8590/');
    const mf = menu.frameLocator('#game');
    await mf.getByRole('button', { name: 'System menu' }).click({ timeout: 65000 });
    await mf.getByRole('button', { name: 'Settings', exact: true }).click();
    const dlg = mf.getByRole('dialog', { name: 'Settings', exact: true });
    await dlg.getByRole('tab', { name: 'Graphics Quality' }).click();
    const toggle = dlg.getByRole('checkbox', { name: 'Keep fallen infantry' });
    assert(await toggle.isChecked());
    await menu.setViewportSize({ width: 390, height: 844 });
    await toggle.focus();
    await toggle.press('Space');
    assert(!(await toggle.isChecked()));
    await toggle.press('Space');
    assert(await toggle.isChecked());
    assert(await toggle.evaluate(() => JSON.parse(localStorage.getItem('swr-gfx')).keepInfantryBodies));
    await menu.close();
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8590/#ground-offensive');
    const f = page.frameLocator('#game'),
      body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 160000 });
    const info = await body.evaluate(async () => {
      const until = performance.now() + 90000;
      while ((!window.game?.vehicleWrecks || game.warming || !game.ui) && performance.now() < until)
        await new Promise(r => setTimeout(r, 100));
      const w = game.world,
        units = w.units.filter(u => (u.side === 0 || u.side === 1) && !u.structure && !u.dead);
      return {
        paused: game.paused,
        keep: game.vehicleWrecks.keepBodies(),
        size: units.length,
        types: [...new Set(units.map(u => u.type.name))]
      };
    });
    console.log('roster', info);
    assert(info.paused && info.keep && info.size >= 88 && info.types.length >= 9);
    await f
      .locator('canvas')
      .first()
      .evaluate(c => c.ownerDocument.defaultView.focus());
    await page.keyboard.press('p');
    const outcome = await body.evaluate(async () => {
      const g = game,
        layer = g.vehicleWrecks,
        until = performance.now() + 80000;
      let d;
      while (!(d = layer.live.find(r => r.doll?.detached)?.doll) && g.world.time < 8 && performance.now() < until)
        await new Promise(r => setTimeout(r, 50));
      g.paused = true;
      if (!d) throw Error('Expected an explosive limb separation during the opener');
      const limb = d.nodes.find(n => n.name === d.detached),
        before = limb.position.distanceTo(d.nodes[0].position);
      for (let i = 0; i < 45; i++) layer.step(1 / 60);
      const travel = limb.position.distanceTo(d.nodes[0].position) - before,
        root = d.root;
      const originalClip = d.owned.length;
      for (let i = 0; i < 800; i++) layer.step(1 / 60);
      const kept = layer.settled.some(o => o.root === root) && root.parent === g.scene;
      const freed = !layer.world.bodies.len() && !layer.world.colliders.len() && !layer.world.impulseJoints.len();
      (await import('/js/gfx.js')).gfx.keepInfantryBodies = false;
      layer.step(0);
      return { part: d.detached, travel, originalClip, kept, freed, removed: !root.parent && !layer.settled.length };
    });
    console.log('physics', outcome);
    assert(
      /^(FArm|Calf)_[LR]$/.test(outcome.part) &&
        outcome.originalClip > 0 &&
        Math.abs(outcome.travel) > 0.1 &&
        outcome.kept &&
        outcome.freed &&
        outcome.removed
    );
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
