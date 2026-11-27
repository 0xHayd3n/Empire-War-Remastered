// Start a stock land skirmish from the mounted title. A fresh browser profile keeps player data untouched.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      tab = name => s.getByRole('tab', { name, exact: true });
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await tab('Gameplay').click();
    await s.getByLabel('Battlefront mode (land battles)').check();
    await s.getByRole('slider', { name: 'Soldiers per side' }).fill('10');
    await tab('HUD').click();
    await s.getByLabel('Crosshair opacity').fill('0.6');
    await s.getByRole('button', { name: 'Restore combat feedback defaults' }).click();
    assert.equal(await s.getByLabel('Crosshair opacity').inputValue(), '0.2');
    await s.getByLabel('Crosshair size', { exact: true }).fill('1.5');
    await s.getByLabel('Crosshair opacity').fill('0.8');
    await s.getByLabel('Expand crosshair with weapon spread').uncheck();
    await s.getByLabel('Directional damage indicators').uncheck();
    await s.getByLabel('Score pop-ups near the crosshair').uncheck();
    await s.getByLabel('Aimed target name and health').uncheck();
    await s.getByLabel('Distance beneath capture point markers').uncheck();
    await s.getByLabel('Elimination feed display time').fill('10');
    await s.getByLabel('Eliminations shown').selectOption('personal');
    if (process.env.SWR_FEEDBACK_SHOT) await page.screenshot({ path: process.env.SWR_FEEDBACK_SHOT });
    await tab('Accessibility').click();
    await s.getByLabel('Land weather lightning brightness').selectOption('0');
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Kuat Forces of Corruption land');
    await board.locator('[data-world="Kuat"][data-domain="land"][data-source="stock"]').first().click();
    await board.locator('.op-go').click();
    await f.locator('.sh-deploy').waitFor({ state: 'attached', timeout: 150000 });
    const frame = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await frame.waitForFunction(() => game?.shooter?.world.units.length && !document.querySelector('.battle-plate'), null, {
      timeout: 150000
    });
    const result = await frame.evaluate(async () => {
      const { lighting } = await import('/js/model.js');
      const s = game.shooter,
        w = s.world;
      // Spawn a real infantry unit so this test does not depend on a particular opening garrison.
      const { db } = await import('/js/gamedata.js'),
        from = s.spawnSpots()[0] || w.units.find(u => u.side === s.me && !u.dead),
        type = db.type('Imperial_Stormtrooper') || db.type('Stormtrooper');
      s.spawning = true;
      let q;
      try {
        q = await w.spawn(type.name, from.x, from.y, 0, s.me);
      } finally {
        s.spawning = false;
      }
      s.possess(q, q.members[0], false);
      const target = s.body;
      s.aimHit = target;
      s.hurtMarks = [{ from: target, at: performance.now() }];
      s.spread = 0.01;
      s.drawHud();
      const width = s.sight.el.style.width;
      s.spread = 0.23;
      s.drawHud();
      const steady = width === s.sight.el.style.width,
        arcHidden = s.arcs[0].style.display === 'none';
      s.popup('Test score', 'kill');
      const now = performance.now();
      s.feed = [
        { a: 'You', v: 'Personal', as: s.me, vs: s.me, mine: true, at: now - 9000 },
        { a: 'Nearby', v: 'Other', as: s.me, vs: s.me, mine: false, at: now }
      ];
      s.feedDirty = true;
      s.drawFeed(now);
      const personal = s.feedEl.textContent;
      s.drawFeed(now + 1001);
      // Sample the real weather lighting uniform while a flash is active, rather than waiting for a random storm.
      game.lightningNow = { L: 1, wait: 0, flash: 1, step: 0, light: { dir: [0, 1, 0], strength: 0.4 } };
      game.weatherLightning(1, 0);
      return {
        width: parseInt(width),
        expected: Math.round((Math.max(48, Math.min(innerWidth, innerHeight) * 0.14) + 3) * 1.5),
        steady,
        arcHidden,
        opacity: s.sight.el.style.opacity,
        target: s.readout.el.dataset.mode,
        health: s.readout.center.style.visibility,
        score: !!s.hud.querySelector('.sh-pop'),
        personal,
        expired: s.feedEl.textContent,
        light: lighting.fillColor2.value.toArray()
      };
    });
    assert.equal(result.width, result.expected);
    assert.deepEqual(
      [result.steady, result.arcHidden, result.opacity, result.target, result.health, result.score],
      [true, true, '0.8', 'ally', 'hidden', false]
    );
    assert.match(result.personal, /Personal/);
    assert.doesNotMatch(result.personal, /Nearby/);
    assert.equal(result.expired, '');
    assert.deepEqual(result.light, [0, 0, 0]);
    await frame.evaluate(() => game.shooter.openSettings());
    const classic = f.locator('.sh-set:visible');
    assert.equal(await classic.locator('[name="feedScope"]').inputValue(), 'personal');
    assert(await classic.locator('.sh-set-body').evaluate(e => e.scrollHeight > e.clientHeight));
    await classic.getByRole('button', { name: 'Done' }).click();
    assert.deepEqual(errors, []);
    console.log(
      'PASS: mounted Kuat land skirmish used the selected crosshair, damage indicators, target readout, personal feed, score pop-ups and lightning.'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
