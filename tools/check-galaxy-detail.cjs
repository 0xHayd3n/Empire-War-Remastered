// Exercise the normal mounted Galactic Conquest draw, including its clipped scene layers.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    const p = await b.newPage(),
      f = p.frameLocator('#game'),
      errors = [];
    p.setDefaultTimeout(120000);
    p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://127.0.0.1:8590/');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_CUSTOM_CAMPAIGN_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click();
    const board = f.locator('.uc-atlas');
    await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
    await board.locator('.uc-start').click();
    const result = await f.locator('body').evaluate(async () => {
      const start = performance.now(),
        tick = () => new Promise(requestAnimationFrame);
      while (!window.game?.modelDetail?.levels?.size || game.modelDetail.busy) {
        if (performance.now() - start > 120000) throw Error('No reduced campaign meshes');
        await tick();
      }
      const g = game,
        orig = g.modelDetail.draw;
      let saved = 0,
        calls = 0;
      g.modelDetail.draw = function (scene, cam, h, draw) {
        const before = new Map();
        scene.traverseVisible(o => {
          if (o.isMesh) before.set(o, o.geometry);
        });
        return orig.call(this, scene, cam, h, () => {
          for (const [o, geo] of before)
            if (o.geometry !== geo) {
              saved += (geo.index.count - o.geometry.index.count) / 3;
              calls++;
            }
          return draw();
        });
      };
      await tick();
      await tick();
      g.modelDetail.draw = orig;
      return { campaign: g.galaxy.campaign.name, saved, calls };
    });
    console.log(JSON.stringify(result));
    assert(result.saved > 0);
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
