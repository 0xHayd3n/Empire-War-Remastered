// Fresh Chrome storage; measure the real selected stock hull, not a skeleton or cached screenshot.
const assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  path = require('node:path');
const { chromium } = require('playwright-core');
(async () => {
  const port = 9081,
    server = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'inherit']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', d => {
        if (d.includes('Universal game:')) ok();
      });
      server.once('exit', n => no(Error('server exit ' + n)));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1360, height: 850 } }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const Native = Worker,
        t = (window.armoryTiming = { workers: 0, closed: 0, draws: 0, assets: 0, start: 0, first: 0, ready: 0, frame: 0 });
      document.addEventListener(
        'click',
        e => {
          if (e.target.closest('[data-id="TITLE_CUSTOMIZE"]')) {
            t.start = performance.now();
            t.first = t.ready = t.frame = 0;
          }
        },
        true
      );
      window.Worker = class extends Native {
        constructor(url, options) {
          super(url, options);
          this.stage = String(url).includes('armorystageworker.js');
          if (!this.stage) return;
          t.workers++;
          this.addEventListener('message', ({ data: q }) => {
            if (q.kind === 'asset') {
              t.assets++;
              if (!t.first) t.first = performance.now();
            }
            if (q.kind === 'ready' && !t.ready) t.ready = performance.now();
            if (q.kind === 'frame' && !t.frame) t.frame = performance.now();
          });
        }
        postMessage(q, ...rest) {
          if (this.stage && q.kind === 'draw') t.draws++;
          return super.postMessage(q, ...rest);
        }
        terminate() {
          if (this.stage) t.closed++;
          return super.terminate();
        }
      };
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    const f = page.frameLocator('#game'),
      ctl = id => f.locator(`[data-id="${id}"]`).first(),
      section = () => f.locator('.title-menu').getAttribute('data-section');
    // Every switch is a real player route: Home is the only place with the Workshop/Customize/Play entries,
    // so a revisit leaves the desk through Back and comes back in from Home.
    const goHome = async () => {
      for (let i = 0; i < 4 && (await section()) !== 'home'; i++) await f.locator('.title-menu .mode-back:visible').first().click();
      await f.locator('.title-menu[data-section="home"]').waitFor();
    };
    const visit = async id => {
      await goHome();
      await ctl(id).click();
    };
    const reports = [];
    for (let i = 0; i < 4; i++) {
      if (i) await visit(i % 2 ? 'TITLE_PLAY' : 'TITLE_WORKSHOP');
      await visit('TITLE_CUSTOMIZE');
      const canvas = f.locator('armory-live-stage canvas:visible');
      await canvas.waitFor({ timeout: 12000 }).catch(async e => {
        console.error({
          visit: i,
          errors,
          status: await f.locator('.command-desk').innerText(),
          metrics: await ctl('TITLE_CUSTOMIZE').evaluate(() => ({ ...armoryTiming }))
        });
        throw e;
      });
      reports.push(
        await canvas.evaluate(c => {
          const t = armoryTiming;
          return {
            hull: document.querySelector('.stage-status').textContent,
            ms: Math.round(performance.now() - t.start),
            frameMs: Math.round(t.frame - t.start),
            firstRequestMs: t.first ? Math.round(t.first - t.start) : null,
            readyMs: t.ready ? Math.round(t.ready - t.start) : null,
            workers: t.workers,
            assets: t.assets
          };
        })
      );
    }
    console.table(reports);
    assert.deepEqual(errors, []);
    assert(reports.every(r => r.hull === reports[0].hull));
    assert.equal(reports.at(-1).assets, reports[0].assets, 'Customize revisits must not reload the same mounted hull assets');
    assert.equal(reports.at(-1).workers, 1, 'reuse live geometry, not a static screenshot');
    // Leaving the desk and coming back from Home must reuse the mounted renderer instead of reloading the hull.
    const warmed = await ctl('TITLE_CUSTOMIZE').evaluate(() => ({ workers: armoryTiming.workers, assets: armoryTiming.assets }));
    assert.equal(warmed.assets, reports.at(-1).assets);
    await visit('TITLE_CUSTOMIZE');
    await f.locator('armory-live-stage canvas:visible').waitFor({ timeout: 12000 });
    assert.deepEqual(
      await ctl('TITLE_CUSTOMIZE').evaluate(() => ({ workers: armoryTiming.workers, assets: armoryTiming.assets })),
      { workers: 1, assets: warmed.assets },
      'a Home return loop reloaded the hull or started a second worker'
    );
    await goHome();
    const snap = await ctl('TITLE_PLAY').evaluate(b => {
      b.click();
      const moving = document.querySelector('.mode-body').getAnimations().length;
      document.querySelector('.mode-back').click();
      b.click();
      return {
        moving,
        section: document.querySelector('.title-menu').dataset.section,
        runs: document.querySelector('.mode-body').getAnimations().length,
        draws: armoryTiming.draws
      };
    });
    assert.deepEqual([snap.moving, snap.section, snap.runs], [1, 'play', 1]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [375, 1360]) {
      await page.setViewportSize({ width, height: 850 });
      for (const id of ['TITLE_WORKSHOP', 'TITLE_PLAY']) {
        await goHome();
        const layout = await ctl(id).evaluate(b => {
          b.click();
          const menu = document.querySelector('.title-menu'),
            heading = menu.querySelector('.mode-heading h1'),
            back = heading.previousElementSibling;
          return {
            left: back?.classList.contains('mode-back') && back.getBoundingClientRect().right <= heading.getBoundingClientRect().left,
            fit: menu.scrollWidth <= innerWidth,
            focused: document.activeElement === back,
            runs: menu.querySelector('.mode-body').getAnimations().length
          };
        });
        assert.deepEqual(layout, { left: true, fit: true, focused: true, runs: 0 });
      }
    }
    const frame = page.frames().find(fr => fr.url().includes('/play.html'));
    await frame.waitForFunction(() => armoryTiming.workers === armoryTiming.closed, null, { timeout: 19000 });
    assert.equal(await frame.evaluate(() => armoryTiming.draws), snap.draws, 'parked renderer drew in the background');
    assert.deepEqual(errors, []);
    console.log('PASS: live reuse, expiry without background rendering, rapid section swaps, Back placement and reduced motion.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
