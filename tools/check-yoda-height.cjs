// Measure visible pixels on the actual held stage with the same camera and
// ground plane. Merely reporting a smaller scale parameter is insufficient.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    const board = f.locator('[data-universal-screen="skirmish"]');
    await board.evaluate(async () => {
      const { CommandRing } = await import('/js/game/commandring.js'),
        orig = CommandRing.prototype.set;
      CommandRing.prototype.set = function (...args) {
        window.heightRing = this;
        CommandRing.prototype.set = orig;
        return orig.apply(this, args);
      };
    });
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.locator('[data-choose-seat="0"]').click();
    const stage = board.locator('.op-command-stage'),
      search = stage.getByRole('searchbox'),
      samples = [];
    for (const name of ['Republic Navy Trooper', 'Yoda']) {
      await search.fill(name);
      await stage.locator(`.op-ring-assign[data-commander="${name}"]`).waitFor();
      await board.locator('.op-command-stage[data-ready="true"][data-motion="held"]').waitFor();
      samples.push(
        await stage.evaluate(() => {
          const r = window.heightRing,
            rig = r.cache.get(r.focus.key).rig,
            h = r.hologram.mesh,
            vis = h.visible;
          h.visible = false;
          const others = [...r.live].filter(o => o !== rig);
          for (const o of others) o.root.visible = false;
          r.paint(0);
          const gl = r.gl.getContext(),
            w = gl.drawingBufferWidth,
            H = gl.drawingBufferHeight,
            px = new Uint8Array(w * H * 4);
          gl.readPixels(0, 0, w, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let lo = H,
            hi = 0;
          for (let y = 0; y < H; y++)
            for (let x = 0; x < w; x++)
              if (px[(y * w + x) * 4 + 3] > 128) {
                lo = Math.min(lo, y);
                hi = Math.max(hi, y);
              }
          h.visible = vis;
          for (const o of others) o.root.visible = true;
          r.paint(0);
          return {
            key: r.focus.key,
            name: r.focus.c.name,
            height: hi - lo + 1,
            bottom: lo,
            canvas: H,
            camera: [...r.camera.position.toArray(), r.camera.top, r.camera.bottom, r.camera.zoom],
            floor: rig.root.position.z
          };
        })
      );
      if (process.env.SHOTS)
        await stage.screenshot({
          path: require('node:path').join(process.env.SHOTS, name === 'Yoda' ? 'yoda-commander.png' : 'republic-trooper-commander.png')
        });
    }
    const [human, yoda] = samples,
      ratio = yoda.height / yoda.canvas / (human.height / human.canvas);
    console.log({ human, yoda, ratio });
    const nativeRatio = (7.2656 * 0.8) / (9.9601 * 1.1);
    assert(Math.abs(ratio - nativeRatio) < 0.035, `ring should retain the pack's Yoda/trooper ratio (${nativeRatio})`);
    assert.deepEqual(yoda.camera, human.camera, 'shrinking a body must not zoom/reposition the camera');
    assert.equal(yoda.floor, human.floor, 'both focused rigs use the same ground plane');
    assert(Math.abs(human.bottom - yoda.bottom) < human.canvas * 0.08, 'both exhibits must stand on the same floor');
    // Also rotate away and back in a populated ring, not just isolated search
    // results. The depth emphasis must not cancel the native size correction.
    await search.fill('Galactic Republic');
    const focus = stage.locator('.op-ring-assign');
    assert.equal(await focus.getAttribute('data-commander'), 'Yoda');
    await stage.locator('.op-ring-next').click();
    assert.notEqual(await focus.getAttribute('data-commander'), 'Yoda');
    await stage.locator('.op-ring-prev').click();
    await board.locator('.op-command-stage[data-model="RI_YODA.ALO"][data-ready="true"]:not([data-figures="1"])').waitFor();
    if (process.env.SHOTS) await stage.screenshot({path: require('node:path').join(process.env.SHOTS, 'yoda-on-ring.png')});
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
