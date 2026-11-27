// Mounted acceptance: apply preferences on a phone-size screen, then use real touch input in a live space spectator match.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      tab = name => s.getByRole('tab', { name, exact: true });
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await tab('Controls').click();
    for (const [label, value] of [
      ['Hold for right-click', 250],
      ['Finger movement before dragging', 24],
      ['Two-finger pan speed', 2],
      ['Pinch zoom sensitivity', 2],
      ['Two-finger rotation', 0]
    ])
      await s.getByLabel(label).selectOption(String(value));
    await s.getByLabel('Show ring on long press').uncheck();
    await s.getByLabel('Two-finger pan speed').focus();
    if (process.env.SWR_TOUCH_SHOT) await page.screenshot({ path: process.env.SWR_TOUCH_SHOT });
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await page.setViewportSize({ width: 1280, height: 800 });
    await tab('Gameplay').click();
    await tab('Replays and Spectate').click();
    await s.getByLabel('Group repeated events within').selectOption('0');
    await s.getByLabel('Maximum displayed event rows').selectOption('20');
    await s.getByLabel('Jump to event location instead of following the unit').check();
    if (process.env.SWR_OBSERVER_SHOT) await page.screenshot({ path: process.env.SWR_OBSERVER_SHOT });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_INSTANT_BATTLE_BUTTON'])
      await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Kuat Forces of Corruption space');
    await board.locator('[data-world="Kuat"][data-domain="space"][data-source="stock"]').first().click();
    await board.getByRole('tab', { name: 'Forces' }).click();
    await board.getByRole('button', { name: 'Edit fleets' }).click();
    await board.locator('.ib-team').first().selectOption({ label: 'Spectator' });
    await board.getByRole('button', { name: 'Add AI' }).click();
    await board.getByRole('button', { name: 'Randomize All' }).click();
    await board.locator('.ib-editor .ib-go').click();
    await f.locator('#spectatorTop').waitFor({ timeout: 120000 });
    const frame = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await frame.waitForFunction(() => game?.spectatorView && !document.querySelector('.battle-plate') && !game.cine?.on, null, {
      timeout: 120000
    });
    const events = await frame.evaluate(() => {
      const v = game.spectatorView,
        u = game.world.units.find(u => !u.dead && u.player?.id >= 0 && u.type),
        who = v.src.who(u.player);
      for (let i = 0; i < 24; i++) v.add({ kind: 'unit', ...who, type: u.type, count: 1 });
      v.renderLog();
      const count = v.list.childElementCount,
        separate = v.log[0].count;
      v.add({ kind: 'spawn', ...who, type: u.type, count: 1, entity: u, x: u.x + 321, y: u.y + 123 });
      game.ui.following = u;
      const newest = v.log[0];
      newest.row.click();
      return [
        count,
        separate,
        v.list.childElementCount,
        game.ui.following === null,
        game.renderer.rig.x === newest.x,
        game.renderer.rig.y === newest.y
      ];
    });
    assert.deepEqual(events, [20, 1, 20, true, true, true]);
    const spot = await frame.evaluate(() => {
      const canvas = game.renderer.dom;
      for (let y = 170; y < innerHeight - 200; y += 40)
        for (let x = Math.floor(innerWidth * 0.35); x < innerWidth * 0.75 - 180; x += 25) {
          if (
            ![0, 10, 60, 90, 128, 160].every(
              dx => document.elementFromPoint(x + dx, y) === canvas && document.elementFromPoint(x + dx, y + 32) === canvas
            )
          )
            continue;
          window.gestures = { moves: [], wheels: [], buttons: [] };
          const orig = game.touchView.bind(game);
          game.touchView = (dx, dy, turn) => {
            gestures.moves.push([dx, dy, turn]);
            return orig(dx, dy, turn);
          };
          canvas.addEventListener('wheel', e => gestures.wheels.push(e.deltaY), true);
          canvas.addEventListener('mousedown', e => gestures.buttons.push(e.button), true);
          return { x, y };
        }
      return null;
    });
    assert(spot, 'Found exposed battlefield canvas');
    const cdp = await page.context().newCDPSession(page),
      rect = await page.locator('#game').boundingBox(),
      x = rect.x + spot.x,
      y = rect.y + spot.y;
    const event = (type, pts) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([id, dx, dy]) => ({ id, x: x + dx, y: y + dy })) });
    await event('touchStart', [[1, 0, 0]]);
    await event('touchMove', [[1, 14, 0]]);
    await frame.waitForFunction(() => gestures.buttons.includes(2));
    assert.deepEqual(await frame.evaluate(() => [gestures.buttons.includes(0), !!document.querySelector('.touch-ring')]), [false, false]);
    await event('touchEnd', []);
    await event('touchStart', [
      [1, 0, 0],
      [2, 100, 0]
    ]);
    await event('touchMove', [
      [1, 0, 0],
      [2, 140, 30]
    ]);
    await event('touchMove', [
      [1, 0, 0],
      [2, 150, 10]
    ]);
    await event('touchEnd', []);
    const result = await frame.evaluate(() => ({
      pan: gestures.moves.reduce(([x, y], [dx, dy]) => [x + dx, y + dy], [0, 0]),
      rotated: gestures.moves.some(m => m[2] !== 0),
      zoom: gestures.wheels.reduce((n, d) => n - d / 100, 0)
    }));
    assert(Math.abs(result.pan[0] - 50) < 1 && Math.abs(result.pan[1] - 10) < 1, JSON.stringify(result));
    assert(!result.rotated);
    assert.equal(result.zoom, Math.floor((Math.log(Math.hypot(150, 10) / 100) * 2) / Math.log(1.12)));
    assert.deepEqual(errors, []);
    console.log(
      'PASS: mounted Instant Battle observer used row limit/grouping/location jump; trusted touch input used hold, drag tolerance, ring, pan, pinch and rotation settings.'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
