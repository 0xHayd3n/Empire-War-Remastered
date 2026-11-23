// Opt-in real Chrome check. Stock, built Revan + Rebellion, and playwright-core required.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
(async () => {
  const port = process.env.SWR_TEST_WINDOW_PORT || '8680',
    url = `http://127.0.0.1:${port}/`,
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: port },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser, page;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    const f = page.frameLocator('#game'),
      screen = k => f.locator(`[data-universal-screen="${k}"]:visible`),
      eras = screen('eras'),
      board = screen('campaign'),
      shell = await page.evaluate(() => (window.acceptanceMarker = crypto.randomUUID()));
    const snap = async n => {
      if (process.env.SWR_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SWR_TEST_SCREENSHOTS, n + '.png') });
    };
    async function pickModeStory(period, name) {
      await eras.getByRole('option', { name: period, exact: true }).click();
      await eras.getByRole('option', { name, exact: true }).click();
      await eras.getByRole('button', { name: 'Continue' }).click();
    }
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').filter({ hasNotText: 'Instant Battle' }).click();
    await pickModeStory('Old Republic', 'Revan’s Revenge');
    await f.locator('[data-id="IDC_SKIRMISH_START_GAME_BUTTON"]').waitFor();
    await f.locator('[data-id="IDC_CANCEL_BUTTON"]').click();
    await eras.getByRole('button', { name: 'Back' }).click();
    await f.getByText('Instant Battle', { exact: true }).click();
    await pickModeStory('Galactic Civil War', 'Forces of Corruption');
    await f.locator('#instantBattle').getByRole('button', { name: 'Back', exact: true }).click();
    await eras.getByRole('button', { name: 'Back' }).click();
    const gc = f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]');
    await gc.click();
    await board.getByRole('combobox', { name: 'Campaign objective' }).waitFor();
    assert.equal(await eras.count(), 0);
    const roster = board.getByRole('listbox', { name: 'Storylines' });
    assert.equal(await roster.getByRole('option').count(), 7);
    const play = board.getByRole('button', { name: 'Start campaign' }),
      ctl = id => board.locator(`[data-id="${id}"]`);
    await play.waitFor();
    await board.locator('.campaign-preview img').first().waitFor();
    await snap('stock');
    const boardOn = id => f.locator(`[data-universal-screen="campaign"][data-profile="${id}"]`);
    async function switchTo(name, id) {
      await roster.getByRole('option', { name, exact: true }).click();
      await boardOn(id).waitFor();
      await play.waitFor();
      assert.equal(await board.getByRole('button', { name: 'Continue' }).count(), 0);
      assert.equal(await page.locator('iframe').count(), 1);
    }
    // Simulate a failed mount: previous board stays visible and can still launch. Then cancel a delayed request.
    const target = `**/api/mount/3417277973`;
    await page.route(target, r => r.fulfill({ status: 409, body: 'Test mount unavailable' }));
    await roster.getByRole('option', { name: 'Revan’s Revenge' }).click();
    await board.getByRole('status', { name: 'Test mount unavailable' }).waitFor();
    assert.equal(await play.getAttribute('aria-disabled'), 'false');
    await page.unroute(target);
    let intercept;
    const intercepted = new Promise(ok => {
      intercept = ok;
    });
    await page.route(target, r => {
      intercept(r);
    });
    await roster.getByRole('option', { name: 'Revan’s Revenge' }).click();
    await boardOn('stock')
      .getByRole('status', { name: /Loading Revan/ })
      .waitFor();
    assert.equal(await play.getAttribute('aria-disabled'), 'true');
    await roster.getByRole('option', { name: 'Forces of Corruption' }).click();
    await (await intercepted).fulfill({ status: 409, body: 'Cancelled request completed' });
    await page.unroute(target);
    assert.equal(await play.getAttribute('aria-disabled'), 'false');
    await page.keyboard.press('Escape');
    await gc.click();
    await switchTo('Revan’s Revenge', '3417277973');
    await snap('revan');
    if (process.env.SWR_TEST_ALL_ERAS) {
      for (const [id, name] of [
        ['1125571106', 'Thrawn’s Revenge'],
        ['1976399102', 'Fall of the Republic'],
        ['3387971722', 'Awakening of the Clone Wars'],
        ['1770851727', 'Empire at War: Remake']
      ]) {
        await switchTo(name, id);
        if (id === '1976399102') {
          // Fall's authored variable year lives on its FTGU map, not the fixed historical starts.
          await board
            .getByRole('listbox', { name: 'Campaign map' })
            .getByRole('option', { name: /From the Ground Up/ })
            .click();
          const year = ctl('IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER'),
            readout = ctl('IDC_SKIRMISH_STARTING_TECH_LEVEL_VALUE');
          await year.waitFor();
          const initial = await readout.getAttribute('aria-label');
          await year.locator('.dlg-sb').nth(Number(initial) > 1 ? 0 : 1).click();
          assert.notEqual(await readout.getAttribute('aria-label'), initial);
          await snap(id);
          await board.getByRole('button', { name: 'Reset settings' }).click();
          assert.equal(await readout.getAttribute('aria-label'), initial);
        } else await snap(id);
      }
    }
    await switchTo('Awakening of the Rebellion', '1397421866');
    const faction = board.getByRole('combobox', { name: 'Faction' });
    const initial = await board.getAttribute('data-campaign');
    await faction.press('ArrowDown');
    assert.notEqual(await board.getAttribute('data-campaign'), initial);
    await board.getByRole('listbox', { name: 'Campaign map' }).press('ArrowDown');
    const campaign = await board.getAttribute('data-campaign');
    await ctl('UC_DIFFICULTY').press('ArrowDown');
    await ctl('UC_PRESET').click();
    await board.locator('.dlg-drop:not([hidden]) .dlg-opt').filter({ hasText: 'Thrawn' }).click();
    assert.equal(await ctl('UC_TREASURY').getAttribute('data-value'), '100000');
    assert.equal(await ctl('UC_POLITICS').getAttribute('data-value'), '160');
    await ctl('UC_POLITICS').click();
    await board.locator('.dlg-drop:not([hidden]) .dlg-opt').filter({ hasText: 'Campaign default' }).click();
    assert.equal(await ctl('UC_PRESET').getAttribute('data-value'), 'custom');
    await ctl('UC_PRESET').click();
    await board.locator('.dlg-drop:not([hidden]) .dlg-opt').filter({ hasText: 'Thrawn' }).click();
    await snap('rebellion');
    await play.click();
    const runtime = page.frames().find(fr => fr.parentFrame() === page.mainFrame());
    await runtime.waitForFunction(() => !!window.game?.galaxy?.planets.length && !!window.game?.story, null, { timeout: 120000 });
    const observed = await runtime.evaluate(() => ({
      campaign: game.galaxy.campaign.name,
      rules: game.galaxy.universalRules,
      difficulty: game.setup.difficulty,
      isolated: crossOriginIsolated
    }));
    assert.equal(observed.campaign, campaign);
    assert.equal(observed.rules.treasury, 100000);
    assert.equal(observed.rules.politics, 160);
    assert.equal(observed.difficulty, 'hard');
    assert(observed.isolated);
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => window.acceptanceMarker), shell);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: one conquest board, direct storyline swaps, cancel/failure recovery, inline faction/map/difficulty/rules and exact campaign launch.'
    );
  } catch (e) {
    if (page) {
      for (const fr of page.frames())
        console.error(
          fr.url(),
          (
            await fr
              .locator('body')
              .innerText({ timeout: 1500 })
              .catch(() => '')
          ).slice(-1300)
        );
    }
    throw e;
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
