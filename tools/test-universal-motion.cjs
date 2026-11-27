// Installed-library integration: real input, actual viewport pixels, no campaign start.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8830),
    srv = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser, release;
  try {
    await new Promise((yes, no) => {
      srv.stdout.on('data', b => {
        if (String(b).includes('Universal game:')) yes();
      });
      srv.once('exit', () => no(Error('Test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
      f = page.frameLocator('#game'),
      gc = f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]'),
      board = f.locator('.uc-atlas'),
      map = board.locator('.uc-map'),
      native = board.locator('.uc-canvas[data-scene="native"]');
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const held = new Promise(r => (release = r));
    await page.route('**/api/universal/atlas?*', async r => {
      await held;
      await r.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await f.locator('[data-id="TITLE_PLAY"]').click();
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await gc.click();
    await map.waitFor();
    const { decodePNG } = await import('../public/js/png.js');
    const box = await map.boundingBox(),
      png = await decodePNG(
        Uint8Array.from(
          await page.screenshot({
            clip: {
              x: box.x + box.width * 0.2,
              y: box.y + box.height * 0.2,
              width: Math.floor(box.width * 0.6),
              height: Math.floor(box.height * 0.6)
            }
          })
        ).buffer
      );
    let lit = 0,
      total = 0;
    for (let i = 0; i < png.data.length; i += 4 * 83) {
      total++;
      if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 35) lit++;
    }
    assert(lit / total > 0.65, `Pending atlas opens to black (${lit}/${total} lit samples)`);
    assert.equal(await board.locator('[data-planet]').count(), 0);
    assert(await board.getByRole('button', { name: 'Start campaign' }).isDisabled());
    release();
    await native.waitFor();
    const full = await native.locator('.uc-context').getAttribute('data-sheet-count');
    await native.locator(`.uc-context[data-loaded-sheets="${full}"]`).waitFor();
    const fades = await require('./check-universal-name-fades.cjs')(map);
    const peak = fades.up.at(-1),
      partial = v => v > peak * 0.02 && v < peak * 0.98;
    assert(
      fades.initial === 0 &&
        peak > 0 &&
        fades.up.some(partial) &&
        fades.down.some(partial) &&
        fades.down.at(-1) === 0 &&
        fades.steady.every(v => v > peak * 0.9),
      'Hover / camera label ink: ' + JSON.stringify(fades)
    );
    const wheel = async (delta, wanted) =>
      map.evaluate(
        async (e, [dy, z]) => {
          const plane = e.querySelector('.uc-plane'),
            globes = e.querySelector('.uc-active-globes'),
            r = e.getBoundingClientRect(),
            x = e.clientWidth * 0.43,
            y = e.clientHeight * 0.57,
            matrix = () => new DOMMatrix(getComputedStyle(plane).transform),
            before = matrix();
          e.dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: dy, clientX: r.left + x, clientY: r.top + y })
          );
          const frames = [],
            start = performance.now();
          let drift = 0,
            lag = 0;
          do {
            await new Promise(requestAnimationFrame);
            const m = matrix();
            frames.push(m.a);
            drift = Math.max(
              drift,
              Math.abs(((x - before.e) / before.a) * m.a + m.e - x),
              Math.abs(((y - before.f) / before.a) * m.a + m.f - y)
            );
            lag = Math.max(lag, Math.abs(m.a * 6 - Number(globes.dataset.diameter)));
            if (Math.abs(m.a - z) < 1e-6) break;
          } while (performance.now() - start < 2000);
          return { frames, drift, lag };
        },
        [delta, wanted]
      );
    await map.press('Home');
    await native.locator('.uc-active-globes[data-diameter="6"]').waitFor();
    const checkTravel = (report, from, to) => {
      assert(
        report.frames.some(v => v > Math.min(from, to) + 0.00001 && v < Math.max(from, to) - 0.00001),
        'No intermediate painted zoom'
      );
      assert(Math.abs(report.frames.at(-1) - to) < 0.000001);
      assert(report.drift < 1.1, 'Cursor anchor drift: ' + report.drift);
      assert(report.lag < 0.001, 'Portraits lagged native plate: ' + report.lag);
    };
    const zoomIn = await wheel(-120, 1.18),
      zoomOut = await wheel(120, 1);
    checkTravel(zoomIn, 1, 1.18);
    checkTravel(zoomOut, 1.18, 1);
    // Hold an uncached lane job, select another map, then deliver the obsolete reply.
    // The real renderer can paint the latest map only; do not dissolve via the old still.
    const choices = board.locator('tr[data-profile="stock"] .uc-map-choice:visible'),
      surface = board.locator('.uc-planets');
    await board.evaluate(e => {
      const post = Worker.prototype.postMessage,
        draw = CanvasRenderingContext2D.prototype.drawImage;
      window.lanePaints = [];
      Worker.prototype.postMessage = function (q, ...args) {
        if (q?.pass === 'lanes') {
          Worker.prototype.postMessage = post;
          window.releaseLane = () => post.call(this, q, ...args);
          return;
        }
        return post.call(this, q, ...args);
      };
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.classList?.contains('uc-planets')) window.lanePaints.push(e.dataset.campaign);
        return draw.apply(this, args);
      };
    });
    await choices.nth(1).click();
    await board.locator('.uc-canvas[data-scene="loading"]').waitFor();
    const obsolete = await board.getAttribute('data-campaign');
    assert(
      await surface.evaluate(c =>
        c
          .getContext('2d')
          .getImageData(0, 0, c.width, c.height)
          .data.every((v, i) => i % 4 !== 3 || !v)
      ),
      'Old lanes visible while waiting for target'
    );
    await choices.nth(2).click();
    const latest = await board.getAttribute('data-campaign');
    assert.notEqual(latest, obsolete);
    const dissolve = await surface.evaluate(async c => {
      const frames = [],
        start = performance.now();
      window.releaseLane();
      do {
        await new Promise(requestAnimationFrame);
        frames.push(Number(getComputedStyle(c).opacity));
        if (window.lanePaints.length && frames.at(-1) === 1 && !c.getAnimations().length) break;
      } while (performance.now() - start < 5000);
      return { frames, paints: window.lanePaints };
    });
    assert.deepEqual(dissolve.paints, [latest]);
    assert(dissolve.frames.some(v => v > 0 && v < 0.99) && dissolve.frames.at(-1) === 1, 'Incoming native layers did not ease in');
    await native.waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await map.press('Home');
    const closeSizes = await map.evaluate(e => {
      const label = e.querySelector('[data-planet]');
      const sample = () => ({
        font: label.getBoundingClientRect().height,
        screenFont: parseFloat(getComputedStyle(label).fontSize),
        scale: new DOMMatrix(getComputedStyle(e.querySelector('.uc-plane')).transform).a
      });
      const step = () => label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      step();
      step();
      step();
      const mid = sample();
      step();
      return { mid, near: sample(), shadow: getComputedStyle(label).textShadow };
    });
    assert.equal(closeSizes.near.scale, 8, 'Reduced motion should move immediately');
    assert(closeSizes.near.font >= 10.8 && closeSizes.near.font < closeSizes.mid.font, 'Names should taper at close zoom');
    assert.equal(closeSizes.shadow, 'none');
    assert(
      Math.abs(closeSizes.near.font - closeSizes.near.screenFont) < 0.1,
      'Close-up names must use screen-sized glyphs, not magnified 1px text'
    );
    const still = await require('./check-universal-name-fades.cjs')(map);
    assert(
      !still.up.some(partial) && !still.down.some(partial) && still.up.at(-1) > 0 && still.down.at(-1) === 0,
      'Reduced motion must skip name fades'
    );
    const detail = map.locator('.uc-route-detail');
    await detail.waitFor();
    const detailSize = await detail.evaluate(c => {
      const r = c.getBoundingClientRect(),
        m = c.parentNode.getBoundingClientRect();
      return {
        width: c.width,
        height: c.height,
        aligned: Math.abs(r.x - m.x) + Math.abs(r.y - m.y) + Math.abs(r.width - m.width) + Math.abs(r.height - m.height) < 1
      };
    });
    assert(
      detailSize.aligned && detailSize.width >= box.width && detailSize.height >= box.height,
      'Display-resolution lane crop must cover the current viewport'
    );
    const edges = await require('./check-universal-lane-detail.cjs')(map);
    assert(
      edges.routes === 1 &&
        edges.redrawnInk > 100 &&
        edges.columns > 200 &&
        edges.centerError < 1.5 &&
        edges.bgChecks === 4 &&
        edges.redrawnSoft < edges.scaledSoft * 0.55,
      JSON.stringify(edges)
    );
    // A late close-up must not cover an unselected chart or another map. Hold the
    // next crop in the real pool while leaving the selected story, then release it.
    await map.evaluate(e => {
      const post = Worker.prototype.postMessage;
      window.cropHeld = new Promise(held => {
        Worker.prototype.postMessage = function (q, ...args) {
          if (q?.crop) {
            Worker.prototype.postMessage = post;
            window.releaseCrop = () =>
              new Promise(done => {
                this.addEventListener('message', () => requestAnimationFrame(() => requestAnimationFrame(done)), { once: true });
                post.call(this, q, ...args);
              });
            held();
            return;
          }
          return post.call(this, q, ...args);
        };
      });
    });
    await map.press('-');
    await map.evaluate(() => window.cropHeld);
    await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
    await detail.waitFor({ state: 'hidden' });
    await map.evaluate(() => window.releaseCrop());
    assert(await detail.isHidden());
    assert.equal(await board.locator('[data-planet]').count(), 0);
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });
    console.log(JSON.stringify({ pendingLit: lit / total, zoomIn, zoomOut, closeSizes, dissolve, detailSize, edges, errors }));
    assert.deepEqual(errors, []);
  } finally {
    release?.();
    await browser?.close();
    srv.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
