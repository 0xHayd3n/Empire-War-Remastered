// Installed-library benchmark. All times use the game document's clock, not Playwright's
// locator polling. Only the UI drives selection. A dark fallback globe is not ready art.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8780),
    s = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'inherit']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      s.stdout.on('data', d => d.toString().includes('Universal game:') && ok());
      s.once('exit', () => no(Error('Test server exited')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (let n = 0; n < Number(process.env.SWR_SWITCH_SESSIONS || 3); n++) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(120000);
      page.on('pageerror', e => console.error(e.message));
      await page.addInitScript(() => {
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          if (window.ucWatch && this.canvas.classList?.contains('uc-active-globes')) {
            window.ucPainted = true;
            window.ucWatch = false;
          }
          return draw.apply(this, args);
        };
      });
      if (process.env.SWR_SWITCH_PIXELS)
        await page.addInitScript(() => {
          const post = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function (q, ...rest) {
            if (q?.pass === 'lanes' && q.backplate) {
              const c = new OffscreenCanvas(q.w, q.h),
                ctx = c.getContext('2d');
              ctx.fillStyle = '#45546b';
              ctx.fillRect(0, 0, q.w, q.h);
              // Asymmetric opaque regions also catch an inverted or shifted plate.
              ctx.fillStyle = '#563322';
              ctx.fillRect(0, 0, q.w, Math.floor(q.h / 3));
              ctx.fillStyle = '#162b58';
              ctx.fillRect(0, 0, Math.floor(q.w / 5), q.h);
              const plate = c.transferToImageBitmap();
              try {
                return post.call(this, { ...q, backplate: plate }, ...rest);
              } finally {
                plate.close();
              }
            }
            return post.call(this, q, ...rest);
          };
        });
      await page.goto(`http://127.0.0.1:${port}/`);
      const f = page.frameLocator('#game'),
        gc = f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]'),
        board = f.locator('.uc-atlas'),
        year = board.getByRole('slider', { name: 'Starting year' });
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      async function measure(control, key, target) {
        await control.evaluate(
          (el, { type, target }) => {
            window.ucWait = new Promise((ok, no) =>
              el.addEventListener(
                type,
                () => {
                  window.ucPainted = false;
                  window.ucWatch = true;
                  const start = performance.now();
                  let bodies,
                    complete,
                    frames = 0;
                  function frame() {
                    const b = document.querySelector('.uc-atlas[open]'),
                      selected = b?.dataset.campaign,
                      scene = b?.querySelector('.uc-canvas'),
                      g = b?.querySelector('.uc-active-globes');
                    const now = performance.now() - start;
                    const valid =
                      window.ucPainted &&
                      !!selected &&
                      (!target || selected === target) &&
                      g &&
                      +g.dataset.worlds > 0 &&
                      +g.dataset.detailed ===
                        +g.dataset.worlds - b.querySelectorAll('[data-planet][title$="No visible surface in source model"]').length &&
                      +g.dataset.worlds === b.querySelectorAll('[data-planet]').length;
                    if (valid) {
                      bodies ??= now;
                      if (scene?.dataset.scene === 'native') {
                        if (++frames >= 2) {
                          complete ??= now;
                          // Native ink is already visible; separately time the end of intentional motion.
                          if (
                            !scene.querySelector('.uc-map[data-moving],.uc-route-detail[data-refining],.uc-context[data-names-fading]') &&
                            !scene.getAnimations({ subtree: true }).length
                          )
                            return ok({
                              campaign: selected,
                              bodies: Math.round(bodies),
                              complete: Math.round(complete),
                              settled: Math.round(now)
                            });
                        }
                      } else frames = 0;
                    }
                    if (now > 90000) return no(Error('Preview did not finish: ' + selected + ' vs ' + target));
                    requestAnimationFrame(frame);
                  }
                  requestAnimationFrame(frame);
                },
                { once: true, capture: true }
              )
            );
          },
          { type: key ? 'keydown' : 'click', target }
        );
        if (key) await control.press(key);
        else await control.click();
        const measurement = await f.locator('html').evaluate(() => window.ucWait);
        if (process.env.SWR_SWITCH_PIXELS)
          measurement.plate = await board.locator('.uc-planets').evaluate(async c => {
            const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rgba)), n => n.toString(16).padStart(2, '0')).join('');
          });
        return measurement;
      }
      const open = await measure(gc),
        all = board.locator('.uc-context'),
        sheets = await all.getAttribute('data-sheet-count');
      await board.locator(`.uc-context[data-loaded-sheets="${sheets}"]`).waitFor();
      await page.keyboard.press('Escape');
      await board.waitFor({ state: 'detached' });
      const reopen = await measure(gc);
      await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
      await year.focus();
      await year.press('Home');
      await year.press('ArrowRight');
      const results = [];
      for (const [action, size, era] of [
        ['Small', 'Small', 2],
        ['ArrowRight', 'Small', 3],
        ['ArrowRight', 'Small', 4],
        ['ArrowRight', 'Small', 5],
        ['Medium', 'Medium', 5],
        ['ArrowLeft', 'Medium', 4],
        ['ArrowLeft', 'Medium', 3],
        ['Small', 'Small', 3],
        ['ArrowLeft', 'Small', 2]
      ]) {
        const key = action.startsWith('Arrow') ? action : null,
          target = `Known_Galaxy_${size}_Era_${era}_Empire`;
        const row = await measure(key ? year : board.getByRole('button', { name: new RegExp('Known Galaxy - ' + action) }), key, target);
        assert.equal(row.campaign, target);
        results.push(row);
      }
      console.log(JSON.stringify({ session: n + 1, open, reopen, results }));
      await page.close();
    }
  } finally {
    await browser?.close();
    s.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
