// Opt-in real Chrome check. Requires the stock install, built Revan and Awakening of the Rebellion packs, and playwright-core.
const assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  path = require('node:path');
const { chromium } = require('playwright-core');
(async () => {
  const port = process.env.SWR_TEST_WINDOW_PORT || '8680',
    url = `http://127.0.0.1:${port}/`,
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: port },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser, page;
  const errors = [];
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Universal test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(90000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    const f = page.frameLocator('#game');
    const shell = await page.evaluate(() => (window.acceptanceMarker = crypto.randomUUID()));
    const screen = k => f.locator(`[data-universal-screen="${k}"]:visible`),
      eras = screen('eras'),
      setup = screen('campaign'),
      rules = screen('rules');
    const shot = async name => {
      if (process.env.SWR_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SWR_TEST_SCREENSHOTS, name.replace(/[^\w-]+/g,'-') + '.png') });
    };
    async function storyline(period, name) {
      await eras.getByRole('option', { name: period, exact: true }).click();
      await eras.getByRole('option', { name, exact: true }).click();
      await eras.getByRole('button', { name: 'Continue' }).click();
    }
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').filter({ hasNotText: 'Instant Battle' }).click();
    await storyline('Old Republic', 'Revan’s Revenge');
    await f.locator('[data-id="IDC_SKIRMISH_START_GAME_BUTTON"]').waitFor();
    await f.locator('[data-id="IDC_CANCEL_BUTTON"]').click();
    await eras.getByRole('button', { name: 'Back' }).click();
    await f.getByText('Instant Battle', { exact: true }).click();
    await storyline('Galactic Civil War', 'Forces of Corruption');
    await f.locator('#instantBattle').getByRole('button', { name: 'Back', exact: true }).click();
    await eras.getByRole('button', { name: 'Back' }).click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    await eras.getByRole('option', { name: 'Galactic Civil War', exact: true }).waitFor();
    await shot('timeline');
    await storyline('Galactic Civil War', 'Forces of Corruption');
    await setup.locator('.campaign-preview img').first().waitFor();
    await shot('stock');
    await setup.getByRole('button', { name: 'Back' }).click();
    await storyline('Old Republic', 'Revan’s Revenge');
    await setup.locator('.campaign-preview img').first().waitFor();
    assert.match(await setup.getAttribute('aria-label'), /Revan/);
    await shot('revan');
    const advanced = setup.locator('[data-id="IDC_SELECT_OPTIONS"]');
    if (await advanced.isVisible()) {
      await advanced.click();
      await f.locator('.uc-window:not([data-universal-screen]) [data-id="IDC_BUTTON_ACCEPT"]').waitFor();
      await page.keyboard.press('Escape');
    }
    await setup.getByRole('button', { name: 'Back' }).click();
    if (process.env.SWR_TEST_ALL_ERAS) {
      for (const [period, name] of [
        ['New Republic', 'Thrawn’s Revenge'],
        ['Clone Wars', 'Fall of the Republic'],
        ['Clone Wars', 'Awakening of the Clone Wars'],
        ['Galactic Civil War', 'Empire at War: Remake']
      ]) {
        await storyline(period, name);
        await setup.getByRole('listbox', { name: 'Campaign map' }).waitFor();
        if (await setup.locator('[data-id="IDC_IMAGE"]').count()) {
          await setup.locator('[data-id="IDC_IMAGE"] .dlg-img[style*="background-image"]').first().waitFor();
        }
        await shot(name);
        await setup.getByRole('button', { name: 'Continue' }).click();
        await rules.getByRole('option', { name: 'Campaign defaults', exact: true }).waitFor();
        await rules.getByRole('button', { name: 'Back' }).click();
        await setup.getByRole('button', { name: 'Back' }).click();
      }
    }
    await storyline('Galactic Civil War', 'Awakening of the Rebellion');
    await setup.getByRole('combobox', { name: 'Faction' }).waitFor();
    assert.match(await setup.getAttribute('aria-label'), /Rebellion/);
    assert.equal(await setup.locator('[data-id="IDC_IMAGE"]').count(), 0); // this skin authors a briefing instead
    const factionCombo = setup.getByRole('combobox', { name: 'Faction' });
    const initial = await setup.getAttribute('data-campaign');
    await factionCombo.press('ArrowDown');
    assert.notEqual(await setup.getAttribute('data-campaign'), initial);
    await setup.getByRole('listbox', { name: 'Campaign map' }).press('ArrowDown');
    await setup.locator('[data-id="IDC_RADIO_CUSTOM_HARD"]').click();
    const campaign = await setup.getAttribute('data-campaign');
    await shot('rebellion');
    await setup.getByRole('button', { name: 'Continue' }).click();
    const opt = name => rules.getByRole('option', { name, exact: typeof name === 'string' });
    assert.equal(await opt('Campaign defaults').getAttribute('aria-selected'), 'true');
    await opt(/Thrawn/).click();
    await opt('Political control').click();
    await opt(/^Campaign default/).click();
    await opt('Economy and politics preset').click();
    assert.equal(await opt('Custom mix').getAttribute('aria-selected'), 'true');
    await opt('Political control').click();
    await opt(/^160 seconds/).click();
    await opt('Treasury cap').click();
    assert.equal(await opt(/^100,000 credits/).getAttribute('aria-selected'), 'true');
    await shot('rules');
    await page.keyboard.press('Escape');
    assert.equal(await setup.getAttribute('data-campaign'), campaign);
    assert.equal(await setup.locator('[data-id="IDC_RADIO_CUSTOM_HARD"]').getAttribute('aria-checked'), 'true');
    await setup.getByRole('button', { name: 'Continue' }).click();
    await rules.getByRole('button', { name: 'Start campaign' }).click();
    const runtime = page.frames().find(fr => fr.parentFrame() === page.mainFrame());
    await runtime.waitForFunction(() => !!window.game?.galaxy?.planets.length && !!window.game?.story, null, { timeout: 120000 });
    const observed = await runtime.evaluate(() => ({
      campaign: game.galaxy.campaign.name,
      rules: game.galaxy.universalRules,
      isolated: crossOriginIsolated
    }));
    assert.equal(observed.campaign, campaign);
    assert.equal(observed.rules.treasury, 100000);
    assert.equal(observed.rules.politics, 160);
    assert.equal(observed.isolated, true);
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => window.acceptanceMarker), shell);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: native timeline, authored campaign skins, faction/map/difficulty selection, rules and back navigation; Rebellion started the exact campaign with both overrides in one isolated game window.'
    );
  } catch (e) {
    if (page) {
      console.error(
        'Frames:',
        page.frames().map(f => f.url())
      );
      for (const fr of page.frames())
        console.error(
          (
            await fr
              .locator('body')
              .innerText({ timeout: 1500 })
              .catch(() => '')
          ).slice(-800)
        );
      console.error(errors);
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
