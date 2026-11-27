// Exercise the REAL stage: an uncached signed donor file is slow just as the player
// jumps to its family. Count actual canvas pixels, not cached-model or DOM flags.
// Directory picks now name one exact roster under its family grouping key.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 820 } }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    const board = f.locator('[data-universal-screen="skirmish"]');
    await board.evaluate(async () => {
      const { CommandRing } = await import('/js/game/commandring.js');
      const original = CommandRing.prototype.draw;
      CommandRing.prototype.draw = function (t) {
        // Count the soldiers' pixels, not the luminous seal behind their backs.
        const mark = this.hologram.mesh,
          on = mark.visible;
        if (window.sampleRing) mark.visible = false;
        try {
          original.call(this, t);
        } finally {
          mark.visible = on;
        }
        if (!window.sampleRing || !this.active || !this.aspect) return;
        const gl = this.gl.getContext(),
          h = gl.drawingBufferHeight,
          w = gl.drawingBufferWidth,
          view = new Uint8Array(w * 4 * 3);
        gl.readPixels(0, Math.floor(h * 0.53), w, 3, gl.RGBA, gl.UNSIGNED_BYTE, view);
        let ink = 0;
        for (let i = 3; i < view.length; i += 4) if (view[i] > 8) ink++;
        window.sampleRing.push({
          ink,
          name: this.focus?.art?.model,
          alpha: this.cache.get(this.focus?.key)?.rig?.alpha,
          layers: [...this.live].map(r => r.alpha)
        });
      };
    });
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.locator('[data-choose-seat="0"]:enabled').click();
    const stage = board.locator('.op-command-stage'),
      assign = stage.locator('.op-ring-assign');
    await board.locator('.op-command-stage[data-ready="true"]').waitFor();
    await stage.getByRole('searchbox').fill('Palpatine Forces of Corruption');
    await board.locator('.op-command-stage[data-model="EI_PALPATINE.ALO"]').waitFor();
    let delayed = false;
    await page.route(/\/asset\/Data\/Art\/Models\/NUTE_GUNRAY\.ALO/i, async route => {
      delayed = true;
      await new Promise(ok => setTimeout(ok, 700));
      await route.continue();
    });
    await board.evaluate(() => {
      window.sampleRing = [];
    });
    await stage.getByRole('searchbox').fill('Nute Gunray');
    await board.locator('.op-command-stage[data-model="NUTE_GUNRAY.ALO"][data-ready="true"]').waitFor();
    const samples = await board.evaluate(() => {
      const a = window.sampleRing;
      window.sampleRing = null;
      return a;
    });
    console.log('Delayed donor, painted-frame coverage:', { delayed, empty: samples.filter(s => !s.ink).length, frames: samples.length });
    assert(delayed);
    assert(samples.length >= 2 && samples.every(s => s.ink > 0), 'stage painted empty instead of retaining the outgoing figure');
    assert(
      samples.some(s => s.name === 'NUTE_GUNRAY.ALO' && s.alpha > 0 && s.alpha < 1 && s.layers.length > 1),
      'real incoming and outgoing meshes should overlap in the fade'
    );
    // A 503 on the signed ALO is not a permanent verdict for this revision.
    let attempts = 0;
    await page.route(/\/asset\/Data\/Art\/Models\/TAMBOR\.ALO/i, route =>
      ++attempts === 1 ? route.fulfill({ status: 503, body: '' }) : route.continue()
    );
    const search = stage.getByRole('searchbox');
    await search.fill('Wat Tambor');
    await stage.getByText(/Figure unavailable/).waitFor();
    await board.locator('.op-command-stage[data-model="TAMBOR.ALO"]').waitFor({ timeout: 6000 });
    assert.equal(attempts, 2, 'recovers without leaving or reassigning');
    // Burst through cold exact rosters the way a player would: open the browser,
    // pick one member in a family, close, repeat across families. Each pick
    // rescopes the ring while the previous section's donor is still loading.
    // Resolved stale requests must not steal the selection, clip away every
    // figure, or move the seat.
    await search.fill('');
    const before = await board.locator('[data-choose-seat="0"]').getAttribute('aria-label');
    const toggle = stage.locator('.op-faction-toggle'),
      browser = f.locator('.op-faction-browser');
    await toggle.click();
    await browser.waitFor();
    const rosterButtons = browser.locator('button[data-roster]');
    const layout = await rosterButtons.evaluateAll(bs => bs.map(b => [b.dataset.roster, b.dataset.section]));
    assert(layout.length > 8, 'directory lists every exact roster, not one per section');
    assert.equal(new Set(layout.map(([key]) => key)).size, layout.length, 'one button per profile/faction key');
    // One exact roster per family section, so the burst crosses real families.
    const perSection = [...new Map(layout.map(([key, section]) => [section, key])).values()];
    assert(perSection.length > 1, 'rosters stay grouped by family section');
    let lastSection = '';
    for (let i = 0; i < 11; i++) {
      const key = perSection[i % perSection.length];
      lastSection = layout.find(([k]) => k === key)[1];
      if (!(await browser.isVisible())) await toggle.click();
      await browser.waitFor();
      await browser.locator(`button[data-roster="${key}"]`).click();
      if (await browser.isVisible()) await toggle.click();
      await browser.waitFor({ state: 'hidden' });
      assert.equal(
        [await assign.getAttribute('data-source'), await assign.getAttribute('data-faction')].join('/'),
        key,
        'the clicked exact roster is focused before any turn'
      );
    }
    // Rapid commander turns inside the last picked section, not a fresh section.
    await stage.evaluate(e => {
      for (let i = 0; i < 4; i++) e.querySelector('.op-ring-next')?.click();
    });
    await board.locator('.op-command-stage[data-ready="true"]').waitFor();
    assert.equal(
      (await stage.locator('.op-family-current strong').innerText()).trim(),
      lastSection.slice(lastSection.indexOf('/') + 1),
      'the barrage settles on the last picked directory family'
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stage.evaluate(el => {
      const gl = el.querySelector('canvas').getContext('webgl2'),
        ext = gl.getExtension('WEBGL_lose_context');
      window.restoreStage = () => ext.restoreContext();
      ext.loseContext();
    });
    await stage.getByText(/Graphics interrupted/).waitFor();
    await stage.evaluate(() => {
      window.restoreStage();
      delete window.restoreStage;
    });
    await board.locator('.op-command-stage[data-ready="true"]').waitFor();
    await stage.locator('.op-ring-caption').evaluate(el => {
      const c = el.parentElement.querySelector('canvas').getBoundingClientRect(),
        a = el.querySelector('button').getBoundingClientRect(),
        h = el.querySelector('h3').getBoundingClientRect();
      if (a.top < h.bottom || Math.abs(a.x + a.width / 2 - c.x - c.width / 2) > 3)
        throw Error('Assign should be centered beneath the focused body and name');
    });
    assert.equal(await board.locator('[data-choose-seat="0"]').getAttribute('aria-label'), before);
    if (process.env.SHOTS) await stage.screenshot({ path: require('node:path').join(process.env.SHOTS, 'crest-carousel.png') });
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
