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
      field = k => board.locator(`[data-field="${k}"]`),
      radio = (k, v) => field(k).locator(`input[type=radio][value="${v}"]`),
      checkedValue = k => field(k).locator('input:checked').inputValue(),
      slider = k => field(k).getByRole('slider'),
      group = id => board.locator(`.uc-roster section[data-profile="${id}"]`),
      current = board.locator('.uc-map-choice[aria-pressed="true"]'),
      eras = board.getByRole('group', { name: 'Era', exact: true }),
      eraCard = name => eras.getByRole('button', { name, exact: true }),
      dates = board.getByRole('group', { name: 'Time period', exact: true }),
      year = dates.getByRole('slider', { name: 'Starting year' }),
      selectPeriod = async label => {
        const tick = dates.locator(`[data-year="${label}"]`);
        if (!(await tick.count())) return dates.getByRole('button', { name: label, exact: true }).click();
        const { width, height } = await year.boundingBox();
        const x = 8 + (width - 16) * (await tick.evaluate(e => parseFloat(e.style.left) / 100));
        await year.click({ position: { x, y: height / 2 } });
        assert.equal(await year.getAttribute('aria-valuetext'), label === '4 ABY' ? '4 ABY · FTGU available' : label);
      };
    await current.waitFor();
    // Escape leaves setup without a visible Back control.
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    await current.waitFor();
    assert.equal(await board.count(), 1);
    assert.equal(await board.locator('[data-field="story"],[data-field="campaign"],[data-field="date"],[role="tab"]').count(), 0);
    assert.equal(await eras.getByRole('button').count(), 4);
    assert.deepEqual(await eras.getByRole('button').allTextContents(), [
      'Old Republic',
      'Clone Wars',
      'Galactic Civil War',
      'New Republic'
    ]);
    const { decodePNG } = await import('../public/js/png.js');
    async function checkCrests() {
      const palettes = new Set();
      for (const card of await eras.getByRole('button').all()) {
        const crest = card.locator('svg.uc-era-crest');
        assert.equal(await crest.count(), 1);
        const palette = await card.evaluate(e =>
          ['--crest-left', '--crest-right'].map(k => getComputedStyle(e).getPropertyValue(k).trim())
        );
        palettes.add(palette.join('/'));
        const sides = await card.evaluate(e => ['--era-left', '--era-right'].map(k => getComputedStyle(e).getPropertyValue(k).trim()));
        const shot = await decodePNG(Uint8Array.from(await card.screenshot()).buffer);
        for (const [i, x] of [5, shot.width - 6].entries()) {
          const rgb = shot.data.subarray(4 * (6 * shot.width + x), 4 * (6 * shot.width + x) + 3);
          const distance = hex =>
            hex
              .slice(1)
              .match(/../g)
              .reduce((sum, v, j) => sum + Math.abs(rgb[j] - parseInt(v, 16)), 0);
          assert(distance(sides[i]) + 35 < distance(sides[1 - i]), `Wrong background side on ${await card.textContent()}`);
        }
        const { width: w, height: h, data } = await decodePNG(Uint8Array.from(await crest.screenshot()).buffer);
        for (const [side, color] of palette.entries()) {
          assert.match(color, /^#[a-f\d]{6}$/i);
          const rgb = color
            .slice(1)
            .match(/../g)
            .map(v => parseInt(v, 16));
          let hits = 0,
            wrong = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
              if (rgb.every((n, c) => Math.abs(data[4 * (y * w + x) + c] - n) < 10)) {
                if (x < w / 2 === (side === 0)) hits++;
                else wrong++;
              }
          assert(
            hits > w * h * 0.035 && wrong < w * h * 0.015,
            `Split emblem: ${await card.textContent()}, ${color}, ${hits}/${wrong} at ${w}x${h}`
          );
        }
      }
      assert.equal(palettes.size, 4);
    }
    await checkCrests();
    assert.equal(await year.count(), 0, 'undated era has no synthetic year axis');
    assert.equal(await eraCard('Galactic Civil War').getAttribute('aria-pressed'), 'true');
    assert.equal(await board.locator('.uc-map-list section').count(), 3);
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
      const name =
        { 3417277973: 'Old Republic', 1976399102: 'Clone Wars', 3387971722: 'Clone Wars', 1125571106: 'New Republic' }[id] ||
        'Galactic Civil War';
      const changed = (await eraCard(name).getAttribute('aria-pressed')) !== 'true';
      await eraCard(name).click();
      if (changed) {
        assert.equal(await board.getAttribute('data-campaign'), '');
        assert(await board.getByRole('button', { name: 'Start campaign' }).isDisabled());
      }
      const date = { 3417277973: '3964 BBY', 1976399102: '22 BBY', 1125571106: '4 ABY' }[id] || 'Scenario starts';
      await selectPeriod(date);
      await group(id).locator('.uc-map-choice').first().click();
      assert.equal(await board.getAttribute('data-profile'), id);
      assert.equal(await board.evaluate(e => e.marker), root);
      times.push(Math.round(performance.now() - t));
      if (process.env.SWR_TEST_ALL_ERAS && !checked.has(id)) {
        await board.locator('[data-scene="native"],[data-scene="unavailable"]').waitFor();
        assert.equal(await board.locator('.uc-canvas').getAttribute('data-scene'), 'native', id + ' preview');
        assert(
          await field('faction')
            .locator('.uc-face')
            .evaluateAll(
              es => es.length > 0 && es.every(e => ['img.uc-crest', 'img.uc-portrait'].every(k => e.querySelector(k)?.naturalWidth > 0))
            ),
          id + ' faction pictures'
        );
        const keyOwners = await board.locator('.uc-key > span').evaluateAll(es =>
          es.map(e => {
            if (!e.querySelector('img.uc-crest,b.uc-monogram')) throw Error('no owner badge');
            return e.dataset.owner;
          })
        );
        assert.deepEqual(
          keyOwners.sort(),
          [...new Set(await board.locator('[data-planet]').evaluateAll(es => es.map(e => e.dataset.owner)))].sort()
        );
        checked.add(id);
      }
    }
    await select('1976399102');
    await radio('faction', 'Rebel').check();
    assert.match(await board.getAttribute('data-campaign'), /Rebel/i);
    await radio('faction', 'Empire').check();
    const fall = group('1976399102');
    await selectPeriod('20 BBY');
    await fall.getByRole('button', { name: /Known Galaxy - Medium/ }).click();
    assert.match(await board.getAttribute('data-campaign'), /Medium_Era_4_Empire/i);
    assert.equal(await year.getAttribute('aria-valuetext'), '20 BBY');
    await fall.getByRole('button', { name: /From the Ground Up/ }).click();
    assert.equal(await year.getAttribute('aria-valuetext'), '20 BBY');
    await year.focus();
    await page.keyboard.press('Home');
    assert.equal(await year.getAttribute('aria-valuetext'), 'FTGU · pre-22 BBY');
    assert.equal(await fall.locator('.uc-map-choice').count(), 1);
    assert.equal(await dates.getByRole('button', { name: /FTGU/i }).count(), 0);
    await page.keyboard.press('ArrowRight');
    assert.equal(await year.getAttribute('aria-valuetext'), '22 BBY');
    await selectPeriod('FTGU · pre-22 BBY');
    await selectPeriod('21 BBY');
    assert.equal(await board.getAttribute('data-campaign'), 'Sandbox_FTGU_Republic');
    await board.getByRole('button', { name: 'Reset settings' }).click();
    assert.equal(await year.getAttribute('aria-valuetext'), '19 BBY');
    assert.equal(await board.getAttribute('data-campaign'), 'Sandbox_FTGU_Republic');
    assert.equal(await fall.getByRole('button', { name: /Foerost Campaign/ }).count(), 0);
    await selectPeriod('20 BBY');
    await fall.getByRole('button', { name: /Foerost Campaign/ }).click();
    assert.match(await current.textContent(), /Foerost/);
    assert.equal(await group('3387971722').count(), 0);
    await selectPeriod('21 BBY');
    assert.equal(await current.count(), 0);
    assert(await board.getByRole('button', { name: 'Start campaign' }).isDisabled());
    await selectPeriod('20 BBY');
    await fall.getByRole('button', { name: /Known Galaxy - Small/ }).click();
    assert.equal(await year.getAttribute('aria-valuetext'), '20 BBY');
    await select('3417277973');
    assert.equal(await dates.getByRole('button').count(), 1);
    assert.equal(await dates.locator('[data-year="3976 BBY"]').count(), 0);
    const stops = await dates.locator('[data-year]').evaluateAll(es => es.map(e => parseFloat(e.style.left) / 100));
    assert(Math.abs(stops[1] - 2 / 7) < 1e-5);
    assert(Math.abs(stops[2] - 5 / 7) < 1e-5);
    await selectPeriod('Scenario starts');
    assert.equal(await current.count(), 0);
    await group('3417277973')
      .getByRole('button', { name: /Mandalorian Onslaught/ })
      .click();
    assert.match(await current.textContent(), /3964 - 3962 BBY/);
    assert.equal(
      await group('3417277973')
        .getByRole('button', { name: /From the Ground Up/ })
        .count(),
      1
    );
    await year.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await year.getAttribute('aria-valuetext'), '3964 BBY');
    assert.equal(await current.count(), 0);
    await page.keyboard.press('ArrowRight');
    assert.equal(await year.getAttribute('aria-valuetext'), '3962 BBY');
    const track = await year.boundingBox(),
      pos = t => track.x + 8 + (track.width - 16) * t;
    await page.mouse.move(pos(2 / 7), track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(pos(0.64), track.y + track.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await year.getAttribute('aria-valuetext'), '3959 BBY');
    assert.equal(await group('3417277973').locator('.uc-map-choice').count(), 1);
    assert.equal(await dates.locator('button[aria-pressed="true"]').count(), 0);
    await select('1397421866');
    if (process.env.SWR_TEST_ALL_ERAS) for (const id of ['1125571106', '3387971722', '1770851727', 'stock']) await select(id);
    await select('1976399102');
    await radio('faction', 'Empire').check();
    await fall.getByRole('button', { name: /Known Galaxy - Small/ }).click();
    await selectPeriod('20 BBY');
    if (process.env.SWR_TEST_THR) {
      await select('1125571106');
      await radio('faction', 'Empire').check();
      await group('1125571106').locator('[data-family="KnownSmall_Era_1_Rebel"]').click();
      await selectPeriod('11.5 ABY');
      assert.equal(await year.inputValue(), '11.5');
      await selectPeriod('6 ABY');
      const regimes = board.getByRole('group', { name: 'Starting variant' });
      await regimes.getByRole('button', { name: '6 ABY · Central Committee', exact: true }).click();
      assert.equal(await field('faction').getByRole('radio').count(), 1);
    }
    const opening = process.env.SWR_TEST_FTGU;
    if (opening) {
      if (process.env.SWR_TEST_THR) {
        await selectPeriod('4 ABY');
        const label = dates.locator('[data-year="4 ABY"] small');
        assert.match(await label.innerText(), /FTGU/);
        assert(await label.evaluate(e => e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) + 1));
        assert.match(await group('1125571106').locator('.uc-map-choice').first().innerText(), /From the Ground Up/);
        await group('1125571106')
          .getByRole('button', { name: /From the Ground Up/ })
          .click();
        await radio('faction', 'Empire').check();
        await field('progression').selectOption('on');
        await board.getByRole('button', { name: 'Reset settings' }).click();
        assert.equal(await field('progression').inputValue(), '');
        await field('progression').selectOption('on');
      } else {
        await selectPeriod('FTGU · pre-22 BBY');
        await fall.getByRole('button', { name: /From the Ground Up/ }).click();
        await radio('faction', 'Rebel').check();
      }
    }
    const target = await board.getAttribute('data-campaign');
    assert.match(
      target,
      process.env.SWR_TEST_THR
        ? opening
          ? /^FTGU_Era_1_Empire$/i
          : /KnownSmall_Era_2_Empire_CCoGM/i
        : opening
          ? /^Sandbox_FTGU_CIS$/i
          : /Era_4_Empire/i
    );
    const stars = await board.locator('[data-planet]').evaluateAll(es => es.map(e => [e.dataset.planet, e.dataset.owner]));
    assert(stars.length > 10 && new Set(stars.map(p => p[1])).size > 1);
    assert.equal(await board.getByRole('button', { name: /Zoom|Fit|Configure|Back/i }).count(), 0);
    assert.equal(await field('difficulty').getByRole('radio').count(), 3);
    assert.equal(await slider('preset').getAttribute('aria-valuetext'), 'Campaign defaults');
    await slider('preset').focus();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await slider('preset').getAttribute('aria-valuetext'), 'Campaign defaults');
    await page.keyboard.press('Home');
    assert.equal(await checkedValue('treasury'), '');
    await slider('politics').focus();
    const nativePolitics = await slider('politics').getAttribute('aria-valuetext');
    await page.keyboard.press('End');
    if ((await slider('politics').getAttribute('aria-valuetext')) === nativePolitics) await page.keyboard.press('Home');
    const politics = Number.parseInt((await slider('politics').getAttribute('aria-valuetext')).replaceAll(',', ''));
    assert(Number.isFinite(politics));
    await radio('difficulty', 'hard').check();
    const cap = await field('treasury')
      .locator('input')
      .evaluateAll(os => os.find(o => o.value !== '')?.value);
    await radio('treasury', cap).check();
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
    await current.scrollIntoViewIfNeeded();
    await field('faction').scrollIntoViewIfNeeded();
    await snap('era-map-browser');
    await field('politics').scrollIntoViewIfNeeded();
    await snap('rule-controls');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await inline());
    assert.equal(await checkedValue('difficulty'), 'hard');
    await field('faction').scrollIntoViewIfNeeded();
    assert(await board.locator('.uc-fields').evaluate(e => e.scrollWidth === e.clientWidth));
    assert(await board.locator('.uc-roster').evaluate(e => e.scrollWidth === e.clientWidth));
    assert(await eras.evaluate(e => e.scrollWidth === e.clientWidth && [...e.children].every(b => b.getBoundingClientRect().width > 0)));
    await checkCrests();
    await snap('era-narrow');
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await checkedValue('treasury'), cap);
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
      startingTech: game.setup.startingTechLevel ?? game.setup.campaignSettings?.tech,
      rules: game.galaxy.universalRules,
      origin: location.origin,
      isolated: crossOriginIsolated
    }));
    assert.equal(actual.origin, `http://127.0.0.1:${port + (process.env.SWR_TEST_THR ? 2 : 3)}`);
    assert.equal(actual.target, target);
    assert.equal(actual.campaign, target);
    if (opening) assert.equal(actual.startingTech, process.env.SWR_TEST_THR ? 4 : 0);
    assert.deepEqual(
      actual.planets,
      stars.map(p => p[0])
    );
    assert.equal(actual.difficulty, 'hard');
    assert.equal(actual.rules.treasury, +cap);
    assert.equal(actual.rules.politics, politics);
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
