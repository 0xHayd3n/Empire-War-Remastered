// Exercise every choice on the player's ACTUAL, unfiltered Teams carousel. A
// detached one-model test scene won't find a focus that loaded but never drew.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1000, height: 690 } });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    const board = f.locator('[data-universal-screen="skirmish"]');
    await board.evaluate(async () => {
      const { CommandRing } = await import('/js/game/commandring.js'),
        set = CommandRing.prototype.set;
      CommandRing.prototype.set = function (...args) {
        window.auditStage = this;
        CommandRing.prototype.set = set;
        return set.apply(this, args);
      };
    });
    await f.getByRole('tab', { name: 'Teams' }).click();
    await f.locator('[data-choose-seat="0"]:enabled').click();
    const data = await f.locator('.op-command-stage[data-ready="true"]').evaluate(async el => {
      const ring = window.auditStage,
        button = el.querySelector('.op-ring-next'),
        sheet = document.createElement('canvas'),
        count = ring.rows.length,
        w = 152,
        h = 175;
      sheet.width = 8 * w;
      sheet.height = Math.ceil(count / 8) * h;
      const ctx = sheet.getContext('2d'),
        gl = ring.gl.getContext(),
        out = [];
      ctx.fillStyle = '#19212b';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      function sample() {
        ring.gl.render(ring.scene, ring.camera);
        const W = gl.drawingBufferWidth,
          H = gl.drawingBufferHeight,
          crop = Math.min(W, Math.ceil((H * w) / (h - 31))),
          left = Math.floor((W - crop) / 2);
        const a = new Uint8Array(crop * H * 4);
        gl.readPixels(left, 0, crop, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
        return { a, crop, left, H };
      }
      for (let i = 0; i < count; i++) {
        const r = ring.focus,
          end = performance.now() + 12000;
        let rig;
        while (performance.now() < end) {
          const e = ring.cache.get(r.key);
          if (e?.rig?.alpha === 1 && ring.phase === ring.stepTo && e.rig.root.parent === ring.scene) {
            rig = e.rig;
            break;
          }
          if (e?.failed) break;
          await new Promise(ok => requestAnimationFrame(ok));
        }
        if (!rig) {
          out.push({ key: r.key, error: 'No settled figure on actual stage' });
          button.click();
          continue;
        }
        // Keep the real placement, camera and lighting. Mask only the neighbors so
        // a working neighbor cannot satisfy the focused figure's pixel assertions.
        const others = [...ring.live].filter(q => q !== rig),
          holoVisible = ring.hologram.mesh.visible;
        for (const q of others) q.root.visible = false;
        ring.hologram.mesh.visible = false;
        try {
          const x = (i % 8) * w,
            y = Math.floor(i / 8) * h;
          const { a, crop, left, H } = sample();
          ctx.drawImage(ring.gl.domElement, left, 0, crop, H, x, y, w, h - 31);
          ctx.fillStyle = '#d9e1e6';
          ctx.font = '11px sans-serif';
          ctx.fillText(r.key, x + 2, y + h - 17, w - 4);
          ctx.fillText(r.c.name, x + 2, y + h - 3, w - 4);
          rig.tick(0.57);
          const { a: second } = sample();
          let ink = 0,
            changed = 0;
          for (let j = 3; j < a.length; j += 4) {
            if (a[j] > 40) ink++;
            if (a[j] !== second[j] || a[j - 3] !== second[j - 3]) changed++;
          }
          const attached = [];
          rig.root.traverseVisible(o => {
            if (o.userData.commandProp) attached.push([o.userData.commandProp, o.parent.name.toUpperCase()].join('@'));
          });
          const absent = (r.art.props || []).filter(q => !attached.includes(q.model + '@' + q.bone.toUpperCase()));
          out.push({ key: r.key, model: rig.model, bound: rig.bound, ink, changed, absent });
        } finally {
          ring.hologram.mesh.visible = holoVisible;
          for (const q of others) q.root.visible = true;
          ring.gl.render(ring.scene, ring.camera);
        }
        button.click();
      }
      delete window.auditStage;
      return { out, png: sheet.toDataURL('image/png').split(',')[1] };
    });
    if (process.env.SHOTS)
      fs.writeFileSync(require('node:path').join(process.env.SHOTS, 'ring-figures.png'), Buffer.from(data.png, 'base64'));
    const bad = data.out.filter(r => !r.model || r.bound < 4 || r.ink < 80 || r.changed < 8 || r.absent.length);
    assert.equal(new Set(data.out.map(r => r.key)).size, data.out.length, 'wrap once, without repeating seats');
    console.log(
      `${data.out.length} installed roster choices; ${data.out.length - bad.length} rendered a moving focused figure on the Teams carousel.`,
      bad
    );
    assert.deepEqual(bad, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
