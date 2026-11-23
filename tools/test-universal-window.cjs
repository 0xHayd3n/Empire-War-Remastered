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
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').filter({ hasNotText: 'Instant Battle' }).click();
    await f.locator('[data-era="3417277973"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_START_GAME_BUTTON"]').waitFor();
    await f.locator('[data-id="IDC_CANCEL_BUTTON"]').click();
    await f.locator('.era-panel footer button').click();
    await f.getByText('Instant Battle', { exact: true }).click();
    await f.locator('[data-era="stock"]').click();
    await f.locator('#instantBattle').getByRole('button', { name: 'Back', exact: true }).click();
    await f.locator('.era-panel footer button').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    await f.getByRole('heading', { name: 'Choose your era' }).waitFor();
    assert.equal(await f.locator('[data-era]').count(), 7);
    await f.locator('[data-era="3417277973"]').click();
    await f.locator('#uc-faction').waitFor();
    assert.match(await f.locator('#uc-profile').textContent(), /Revan/);
    await f.getByRole('button', { name: 'Back to eras' }).click();
    await f.locator('[data-era="1397421866"]').click();
    await f.locator('#uc-faction').waitFor();
    assert.match(await f.locator('#uc-profile').textContent(), /Rebellion/);
    assert.equal(await f.locator('#uc-preset').inputValue(), '');
    await f.locator('#uc-preset').selectOption(JSON.stringify(['100000', '160']));
    assert.equal(await f.locator('#uc-treasury').inputValue(), '100000');
    assert.equal(await f.locator('#uc-politics').inputValue(), '160');
    await f.locator('#uc-politics').selectOption('');
    assert.equal(await f.locator('#uc-preset').inputValue(), 'custom');
    await f.locator('#uc-politics').selectOption('160');
    const campaign = await f.locator('#uc-campaign').inputValue();
    await f.locator('#uc-start').click();
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
      'PASS: native menu → Galactic Conquest → Revan → change era to Rebellion → exact campaign and two presets; one persistent isolated game window.'
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
