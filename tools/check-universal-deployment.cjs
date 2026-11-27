// Hold real ticket issue/consume on a disposable host. Verify the same opaque
// host-owned plate covers both requests, navigation/boot, and actual galaxy start.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8840),
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Disposable test host unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (const kind of ['conquest', 'cross-profile conquest', 'native story']) {
      const cross = kind === 'cross-profile conquest', story = kind === 'native story';
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(90000);
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="TITLE_PLAY"]').click();
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator(`[data-id="${story ? 'IDC_NEW_CAMPAIGN_BUTTON' : 'IDC_CUSTOM_CAMPAIGN_BUTTON'}"]`).click();
      const board = f.locator(story ? '.op-setup' : '.uc-atlas');
      if (story) {
        await board.getByRole('tab', { name: /Faction/ }).click();
        await board.getByRole('radio', { disabled:false }).first().check();
      } else await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
      if (cross) {
        await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
        await board.locator('tr[data-profile="1976399102"] .uc-map-choice:visible').first().click();
      }
      const target = story ? await board.getByRole('radio', { checked:true }).inputValue() : await board.getAttribute('data-campaign'),
        title = story ? await board.locator('.op-name').innerText() : await board.locator('.uc-map-choice[aria-pressed="true"]').getAttribute('aria-label');
      if (!cross) await board.evaluate(async () => {
        const { GalacticGame } = await import('/js/game/galactic.js');
        const present = GalacticGame.prototype.present;
        GalacticGame.prototype.present = function (...args) {
          const result = present.apply(this,args);
          window.firstGalaxyDraw ??= { covered:window.universalLaunch.pending, planets:this.planetViews.filter(p=>p.inst && p.show).length };
          return result;
        };
      });
      let nav = 0;
      page.on('request', r => {
        // A story may open a linked tactical child; that isn't a host profile remount.
        if (r.isNavigationRequest() && r.url().includes('play.html') && r.frame().parentFrame() === page.mainFrame()) nav++;
      });
      async function hold(pattern) {
        let release, hit;
        const wait = new Promise(ok => (release = ok)),
          seen = new Promise(ok => (hit = ok));
        await page.route(pattern, async r => {
          hit();
          await wait;
          return r.continue();
        });
        return { release, seen };
      }
      const issue = await hold('**/atlas/start'),
        consume = await hold('**/atlas/consume'),
        plate = page.locator('.battle-plate');
      await board.locator(story ? '.op-go' : '.uc-start').click();
      await issue.seen;
      await plate.waitFor();
      assert(
        title.includes(await plate.locator('h2').innerText()) ||
          title.toLowerCase().includes((await plate.locator('h2').innerText()).toLowerCase())
      );
      await plate.evaluate(el => {
        window.samePlate = el;
        window.coverChanges = [];
        new MutationObserver(() => window.coverChanges.push(el.hidden)).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      });
      const covered = () =>
        plate.evaluate(
          el =>
            window.samePlate === el &&
            !el.hidden &&
            el.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2)) &&
            document.querySelector('iframe').inert
        );
      assert(await covered());
      issue.release();
      await consume.seen;
      assert(await covered());
      const art = await plate
        .locator('.battle-scene')
        .evaluate(e => e.querySelector('img')?.naturalWidth || getComputedStyle(e).backgroundImage);
      if (process.env.SWR_TEST_SCREENSHOTS)
        await page.screenshot({ path: path.join(process.env.SWR_TEST_SCREENSHOTS, `campaign-deploy-${cross ? 'cross' : 'same'}.png`) });
      consume.release();
      await plate.waitFor({ state: 'hidden' });
      const game = page.frames().find(f => f.parentFrame() === page.mainFrame());
      const actual = await game.evaluate(() => ({
        target: window.game?.galaxy?.campaign?.name,
        rendered: !!window.game?.renderer?.domElement?.width,
        ready: !!window.game?.story,
        isolated: crossOriginIsolated
      }));
      assert.deepEqual(actual, { target, rendered: true, ready: true, isolated: true });
      assert.deepEqual(await page.evaluate(() => window.coverChanges), [true]);
      assert.equal(nav, Number(cross));
      if (!cross) {
        const draw = await game.evaluate(() => window.firstGalaxyDraw);
        assert(draw?.covered && draw.planets > 0, 'first galaxy draw must precede host reveal');
      }
      console.log(JSON.stringify({ kind, target, art, onePlate: true, nav }));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
