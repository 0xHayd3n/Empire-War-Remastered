// A real player save slot in a fresh browser profile (never touches an existing
// player's games). LandScars isn't called directly to save or restore anything.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto((process.env.EW_BASE || 'http://127.0.0.1:8590/') + '#ground-offensive');
    const f = page.frameLocator('#game');
    const ready = () => f.locator('body').evaluate(async () => {
      const end = performance.now() + 180000;
      while (!(window.game?.ui && !game.warming && game.craters?.ready && game.world?.units?.length)) {
        if (performance.now() > end) throw Error('No playable tactical map');
        await new Promise(r => setTimeout(r, 100));
      }
    });
    await ready();
    const before = await f.locator('body').evaluate(async () => {
      const { blast } = await import('/js/game/landabilities.js'), { db } = await import('/js/gamedata.js');
      const g = game, w = g.world, t = w.terrain; g.paused = true;
      for (let y = 113; y < (t.height - 2) * 20; y += 40) for (let x = 107; x < (t.width - 2) * 20; x += 40) {
        if (w.viewFogged(x,y) || w.wet[Math.round(y / 20) * t.size + Math.round(x / 20)] || w.units.some(u => Math.hypot(u.x-x,u.y-y) < Math.max(65, u.hitRadius+30))) continue;
        blast(w, db.type('Proj_Empire_Bombardment_Turbolaser'), x, y, g.me);
        const depth = g.craters.offsetAt(x,y); if (depth < -2) return { map: g.map.file, x,y,depth };
      }
      throw Error('No visible excavated parcel');
    });
    const button = id => f.locator(`[data-id="${id}"]:visible`).last();
    await f.locator('canvas').first().click({ position: {x: 280, y: 175}, force: true });
    await page.keyboard.press('Escape');
    await button('IDC_SAVE_GAME').click();
    const slot = 'Crater field verification';
    const name = f.locator('input:visible').last(); await name.fill(slot);
    await button('IDC_SAVE_GAME_BUTTON').click();
    await button('IDC_LOAD_GAME').click();
    await f.getByRole('option', {name:slot, exact:true}).click();
    await button('IDC_LOAD_GAME_BUTTON').click();
    const end = Date.now() + 180000;
    // Universal's game can live on a different mount/port than its shell.
    while (!await f.locator('body').evaluate(() => !!window.game?.setup?.restore).catch(() => false)) {
      if (Date.now() > end) throw Error('Player-selected slot did not resume');
      await page.waitForTimeout(200);
    }
    await ready();
    const after = await f.locator('body').evaluate((_,{x,y}) => ({
      map:game.map.file, rule:game.setup.restore.battle.craterRule, walkable:game.scars.walkable,
      depth:game.craters.offsetAt(x,y), drawn:game.craters.drawnOffsetAt(x,y)
    }), before);
    assert.equal(after.map,before.map);assert.equal(after.rule,1);assert.equal(after.walkable,true);
    assert.equal(after.depth,before.depth);assert.ok(Math.abs(after.drawn-before.depth)<.003);assert.deepEqual(errors,[]);
    console.log('PASS pause menu Save → Load, new battle restored the walkable and drawn bowl', {before,after});
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
