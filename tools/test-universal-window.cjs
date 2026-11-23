// Real Chrome, local stock + Fall, Revan and Rebellion packs. Set SWR_TEST_ALL_ERAS to check the whole roster.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8680),
    url = `http://127.0.0.1:${port}/`,
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let b, page;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', d => {
        if (d.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Test port unavailable')));
    });
    b = await chromium.launch({ channel: 'chrome' });
    page = await b.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.text().includes('Galaxy preview:')) console.error(m.text());
    });
    await page.goto(url);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    if (process.env.SWR_TEST_ALL_ERAS) {
      const eras = f.locator('[data-universal-screen="eras"]');
      async function choose(period, name) {
        await eras.getByRole('option', { name: period, exact: true }).click();
        await eras.getByRole('option', { name, exact: true }).click();
        await eras.getByRole('button', { name: 'Continue' }).click();
      }
      await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').filter({ hasNotText: 'Instant Battle' }).click();
      await choose('Old Republic', 'Revan’s Revenge');
      await f.locator('[data-id="IDC_SKIRMISH_START_GAME_BUTTON"]').waitFor();
      await f.locator('[data-id="IDC_CANCEL_BUTTON"]').click();
      await eras.getByRole('button', { name: 'Back' }).click();
      await f.getByText('Instant Battle', { exact: true }).click();
      await choose('Galactic Civil War', 'Forces of Corruption');
      await f.locator('#instantBattle').getByRole('button', { name: 'Back', exact: true }).click();
      await eras.getByRole('button', { name: 'Back' }).click();
    }
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const board = f.locator('[data-universal-screen="campaign"]'),
      field = k => board.locator(`[data-field="${k}"]`);
    await field('story').waitFor();
    // Escape leaves setup without a visible Back control.
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    await field('story').waitFor();
    assert.equal(await board.count(), 1);
    const root = await board.evaluate(e => (e.marker = crypto.randomUUID()));
    let docs = 0,
      mounts = 0,
      assets = 0;
    page.on('request', r => {
      if (r.isNavigationRequest() && r.url().includes('play.html')) docs++;
      if (r.url().includes('/api/mount/')) mounts++;
      if (r.url().includes('/asset/') && !r.url().startsWith(`http://127.0.0.1:${port + 1}/`)) assets++;
    });
    const times = [],
      checked = new Set();
    async function select(id) {
      const t = performance.now();
      await field('story').selectOption(id);
      assert.equal(await board.getAttribute('data-profile'), id);
      assert.equal(await board.evaluate(e => e.marker), root);
      times.push(Math.round(performance.now() - t));
      if (process.env.SWR_TEST_ALL_ERAS && !checked.has(id)) {
        await board.locator('[data-scene="native"],[data-scene="unavailable"]').waitFor();
        assert.equal(await board.locator('.uc-canvas').getAttribute('data-scene'), 'native', id + ' preview');
        checked.add(id);
      }
    }
    await select('1976399102');
    await field('faction').selectOption('Empire');
    await field('campaign').selectOption('Sandbox_FTGU_Republic');
    const ftguDate = await field('date')
      .locator('option')
      .evaluateAll(os => os.find(o => /21 BBY/.test(o.label))?.value);
    assert(ftguDate !== undefined);
    await field('date').selectOption(ftguDate);
    await board.getByRole('button', { name: 'Reset settings' }).click();
    assert.equal(await field('date').inputValue(), '');
    assert.equal(await field('campaign').inputValue(), 'Sandbox_FTGU_Republic');
    await select('3417277973');
    assert.equal(await field('date').locator('option').count(), 4);
    await select('1397421866');
    if (process.env.SWR_TEST_ALL_ERAS) for (const id of ['1125571106', '3387971722', '1770851727', 'stock']) await select(id);
    await select('1976399102');
    await field('faction').selectOption('Empire');
    const row = await field('campaign')
      .locator('option')
      .evaluateAll(os => os.find(o => /Known Galaxy.*Small/i.test(o.label))?.value);
    assert(row);
    await field('campaign').selectOption(row);
    await field('date').selectOption({ label: '20 BBY' });
    if (process.env.SWR_TEST_THR) {
      await select('1125571106');
      await field('faction').selectOption('Empire');
      await field('campaign').selectOption('KnownSmall_Era_1_Empire');
      await field('date').selectOption({ label: '6 ABY · Central Committee' });
    }
    const target = await board.getAttribute('data-campaign');
    assert.match(target, process.env.SWR_TEST_THR ? /KnownSmall_Era_2_Empire_CCoGM/i : /Era_4_Empire/i);
    const stars = await board.locator('[data-planet]').evaluateAll(es => es.map(e => [e.dataset.planet, e.dataset.owner]));
    assert(stars.length > 10 && new Set(stars.map(p => p[1])).size > 1);
    assert.equal(await board.getByRole('button', { name: /Zoom|Fit|Configure|Back/i }).count(), 0);
    await field('difficulty').selectOption('hard');
    const cap = await field('treasury')
      .locator('option')
      .evaluateAll(os => os.find(o => o.value !== '')?.value);
    await field('treasury').selectOption(cap);
    assert.equal(docs, 0);
    assert.equal(mounts, 0);
    assert.equal(assets, 0);
    const snap = async name => {
      if (process.env.SWR_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SWR_TEST_SCREENSHOTS, name + '.png') });
    };
    const inline = () =>
      board.evaluate(e => {
        const p = e.querySelector('aside').getBoundingClientRect(),
          m = e.querySelector('.uc-map').getBoundingClientRect();
        return p.right === innerWidth && p.top === 0 && p.height === innerHeight && m.right === p.left && m.height === innerHeight;
      });
    assert(await inline());
    assert((await board.locator('.uc-key span:visible').count()) > 1);
    await board.locator('[data-scene="native"],[data-scene="unavailable"]').waitFor();
    assert.equal(await board.locator('.uc-canvas').getAttribute('data-scene'), 'native');
    assert(Number(await board.locator('.uc-canvas').getAttribute('data-models')) > 10);
    await field('story').scrollIntoViewIfNeeded();
    await snap('fall-atlas');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await inline());
    assert.equal(await field('difficulty').inputValue(), 'hard');
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await field('treasury').inputValue(), cap);
    assert.equal(await board.getAttribute('data-campaign'), target);
    const mountUrl = `**/api/mount/${process.env.SWR_TEST_THR ? '1125571106' : '1976399102'}`;
    await page.route(mountUrl, r => r.fulfill({ status: 409, body: 'Test mount unavailable' }));
    await board.getByRole('button', { name: 'Start campaign' }).click();
    await board.getByRole('status').filter({ hasText: 'Test mount unavailable' }).waitFor();
    assert.equal(await board.getAttribute('data-campaign'), target);
    assert.equal(await board.getByRole('button', { name: 'Start campaign' }).getAttribute('aria-disabled'), 'false');
    await page.unroute(mountUrl);
    mounts = 0;
    await Promise.all([
      page.waitForEvent('framenavigated', { predicate: fr => fr.url().includes('universal-start') }),
      board.getByRole('button', { name: 'Start campaign' }).click()
    ]);
    const runtime = page.frames().find(fr => fr.parentFrame() === page.mainFrame());
    await runtime.waitForFunction(() => !!window.game?.story && !!game.galaxy?.planets.length, null, { timeout: 150000 });
    const actual = await runtime.evaluate(() => ({
      target: game.setup.campaign,
      campaign: game.galaxy.campaign.name,
      planets: game.galaxy.planets.filter(p => !p.background).map(p => p.name),
      difficulty: game.setup.difficulty,
      rules: game.galaxy.universalRules,
      origin: location.origin,
      isolated: crossOriginIsolated
    }));
    assert.equal(actual.origin, `http://127.0.0.1:${port + (process.env.SWR_TEST_THR ? 2 : 3)}`);
    assert.equal(actual.target, target);
    assert.equal(actual.campaign, target);
    assert.deepEqual(
      actual.planets,
      stars.map(p => p[0])
    );
    assert.equal(actual.difficulty, 'hard');
    assert.equal(actual.rules.treasury, +cap);
    assert(actual.isolated);
    assert.equal(docs, 1);
    assert.equal(mounts, 1);
    assert.equal(page.url(), url);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        switchChecksMs: times,
        previewPlanets: stars.length,
        uniqueOwners: new Set(stars.map(p => p[1])).size,
        nativeProfiles: [...checked],
        documentLoadsWhileBrowsing: 0,
        launchDocuments: docs,
        target,
        passed: true
      })
    );
  } catch (e) {
    if (page)
      for (const fr of page.frames())
        console.error(
          fr.url(),
          (
            await fr
              .locator('body')
              .innerText({ timeout: 1000 })
              .catch(() => '')
          ).slice(-950)
        );
    throw e;
  } finally {
    await b?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
