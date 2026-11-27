// Fresh mounted profile. Capture real canvas operations (not a settings/storage round trip).
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const space = process.argv.includes('--space');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      field = label => s.getByLabel(label),
      tab = name => s.getByRole('tab', { name, exact: true }).click();
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await tab('Gameplay');
    if (!space) {
      await field('Battlefront mode (land battles)').check();
      await s.getByRole('slider', { name: 'Soldiers per side' }).fill('10');
    }
    await tab('HUD');
    await field('Overhead bar width').selectOption('1.5');
    await field('Local radar zoom').fill('2');
    await s.getByRole('button', { name: 'Restore radar and compass defaults' }).click();
    assert.equal(await field('Local radar zoom').inputValue(), '1');
    assert.equal(await field('Overhead bar width').inputValue(), '1.5');
    await s.getByRole('button', { name: 'Restore unit bar defaults' }).click();
    assert.equal(await field('Overhead bar width').inputValue(), '1');
    await field('Show overhead health bars').selectOption('focus');
    await field('Overhead bar width').selectOption('2');
    await field('Include shield bars').uncheck();
    await field('Keep north at the top of the radar').check();
    await field('Local radar zoom').fill('2');
    await field('Radar terrain opacity').fill('0.75');
    await field('Show camera view cone on radar').uncheck();
    await field('Pin distant command posts to radar edge').uncheck();
    await field('Compass bearings').selectOption('degrees');
    await field('Show command post letters on compass').uncheck();
    await field('Compass bearings').focus();
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    if (process.env.SWR_NAV_PHONE) await page.screenshot({ path: process.env.SWR_NAV_PHONE });
    await page.setViewportSize({ width: 1280, height: 800 });
    await field('Keep north at the top of the radar').focus();
    if (process.env.SWR_NAV_DESKTOP) await page.screenshot({ path: process.env.SWR_NAV_DESKTOP });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup'),
      domain = space ? 'space' : 'land';
    await board.getByRole('searchbox').fill('Kuat Forces of Corruption ' + domain);
    await board.locator(`[data-world="Kuat"][data-domain="${domain}"][data-source="stock"]`).first().click();
    await board.locator('.op-go').click();
    const frame = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await frame.waitForFunction(
      space =>
        window.game?.world?.units?.length &&
        (space ? game.ui?.groups && game.renderer.rig : game.shooter?.radar) &&
        !game.cine?.on &&
        !document.querySelector('.battle-plate'),
      space,
      { timeout: 150000 }
    );
    const bars = await frame.evaluate(async space => {
      const { setViewOption } = await import('/js/game/viewpreferences.js'),
        g = game,
        w = g.world,
        ui = g.ui;
      let unit, ctx, draw;
      if (space) {
        unit = w.units.find(u => u.player === g.human && !u.dead && !u.isPad && !u.squad && u.maxShield > 0);
        if (!unit) throw Error('Missing shielded ship or station');
        const rig = g.renderer.rig;
        rig.x = unit.x;
        rig.y = unit.y;
        rig.apply(0);
        g.renderer.camera.updateMatrixWorld();
        ctx = g.renderer.ctx;
        draw = () => ui.drawOverlay(ctx);
      } else {
        const ally = w.units.find(u => u.side === g.me && !u.dead);
        let squad = g.ownSquads().find(q => q.members.some(m => !m.inside));
        if (!squad) squad = await w.spawn('Imperial_Stormtrooper', ally.x, ally.y, 0, g.me);
        unit = squad.members[0];
        g.camera.position.set(unit.x, unit.y - 400, unit.z + 450);
        g.camera.lookAt(unit.x, unit.y, unit.z);
        g.camera.updateMatrixWorld();
        ctx = g.bars.getContext('2d');
        draw = () => g.drawBars();
      }
      const sel = space ? unit : unit.squad;
      const sample = () => {
        let widest = 0,
          shields = 0;
        const fill = ctx.fillRect;
        ctx.fillRect = function (x, y, w, h) {
          if (h === 3 && ['#35e04a', '#e0c435', '#e04535', '#5fe067', '#f2c744', '#ff5a4d'].includes(this.fillStyle))
            widest = Math.max(widest, w);
          if (h === 2 && ['#4aa8ff', '#4fb3ff'].includes(this.fillStyle)) shields++;
          return fill.call(this, x, y, w, h);
        };
        try {
          draw();
        } finally {
          ctx.fillRect = fill;
        }
        return { widest, shields };
      };
      ui.select([sel]);
      ui.hover = null;
      const big = sample();
      setViewOption('barWidth', 1);
      const base = sample();
      setViewOption('barShields', true);
      const withShield = sample();
      ui.select([]);
      ui.hover = null;
      const empty = sample();
      ui.hover = sel;
      const hovered = sample();
      setViewOption('barMode', 'off');
      const off = sample();
      return { big, base, withShield, empty, hovered, off };
    }, space);
    assert(bars.base.widest > 0, JSON.stringify(bars));
    assert(Math.abs(bars.big.widest / bars.base.widest - 2) < 0.01, JSON.stringify(bars));
    assert.equal(bars.big.shields, 0);
    if (space) assert(bars.withShield.shields > 0);
    assert.equal(bars.empty.widest, 0);
    assert.equal(bars.hovered.widest, bars.base.widest);
    assert.equal(bars.off.widest, 0);
    if (!space) {
      const nav = await frame.evaluate(() => {
        const s = game.shooter,
          post = s.world.points.find(p => p.reinforce),
          label = s.letterOf(post);
        s.yaw = 0;
        function trace(canvas, draw) {
          const c = canvas.getContext('2d'),
            logs = { text: [], arc: [], ground: [], moves: [] },
            old = [];
          for (const [key, add] of [
            ['fillText', (...a) => logs.text.push(a)],
            ['arc', (...a) => logs.arc.push(a)],
            ['drawImage', () => logs.ground.push(c.globalAlpha)],
            ['moveTo', (...a) => logs.moves.push(a)]
          ]) {
            const fn = c[key];
            old.push(() => (c[key] = fn));
            c[key] = function (...a) {
              add(...a);
              return fn.apply(this, a);
            };
          }
          try {
            draw();
          } finally {
            old.forEach(f => f());
          }
          return logs;
        }
        const pos = distance => ({ x: post.x - distance, y: post.y }),
          radar = d => trace(s.radar, () => s.drawRadar(pos(d))),
          compass = () => trace(s.compass, () => s.drawCompass(pos(145))).text;
        const near = radar(145),
          far = radar(1500),
          bearings = compass(),
          postAt = t => t.text.find(a => a[0] === label),
          cone = t => t.arc.find(a => a[2] === 99 && a[4] - a[3] < 6);
        const arrow = near.moves.at(-1); // Tip of the centre player's facing arrow.
        s.setCfg('radarPins', true);
        s.setCfg('radarCone', true);
        s.setCfg('compassPosts', true);
        s.setCfg('radarTerrain', 0);
        const withPins = radar(1500),
          on = radar(145),
          letters = compass();
        s.setCfg('radarNorth', false);
        s.setCfg('radarZoom', 1);
        s.setCfg('compassLabels', 'eight');
        const head = radar(145);
        return {
          near: postAt(near),
          head: postAt(head),
          arrow,
          headArrow: head.moves.at(-1),
          ground: near.ground,
          blank: on.ground,
          off: !cone(near) && !postAt(far),
          on: !!cone(on) && !!postAt(withPins),
          coneEast: (cone(on)[3] + cone(on)[4]) / 2,
          compass: bearings.some(a => a[0] === '90°') && !bearings.some(a => a[0] === label && a[2] === 7),
          letters: letters.some(a => a[0] === label && a[2] === 7),
          eight: compass().some(a => a[0] === 'NE')
        };
      });
      assert.deepEqual(nav.near.slice(1), [150, 100.5]);
      assert.deepEqual(nav.head.slice(1), [100, 75.5]);
      assert(nav.arrow[0] > 100 && nav.arrow[1] === 100 && nav.headArrow[1] < 100);
      assert(
        nav.ground.includes(0.75) &&
          !nav.blank.length &&
          nav.off &&
          nav.on &&
          nav.coneEast === 0 &&
          nav.compass &&
          nav.letters &&
          nav.eight,
        JSON.stringify(nav)
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS: mounted Kuat ${domain} drew selected/hovered, hidden and resized health bars${space ? ' and shield rows' : '; Battlefront radar and compass obeyed all seven navigation preferences'}.`
    );
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
