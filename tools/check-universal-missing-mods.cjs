// Native title screen, actual stock-only Universal library on disposable loopback ports.
// No modification of the normal library or Steam subscriptions.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict');
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-discovery-')),
    port = +(process.env.SWR_TEST_WINDOW_PORT || 8840),
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port), SWR_UNIVERSAL_LIBRARY: home },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', d => {
        if (d.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Test server failed to start')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const board = f.locator('.uc-atlas'),
      mod = board.locator('[data-required-mod="1770851727"] .uc-locked-choice').first(),
      info = board.locator('.uc-submod-page');
    await mod.waitFor();
    const start = board.locator('.uc-start'),
      initial = await board.getAttribute('data-campaign');
    assert(initial);
    assert.equal(await board.locator('select[data-field="payment"]').count(), 0, 'Missing Remake does not offer installments');
    assert.equal(await board.locator('select[data-field="transport"]').count(), 0, 'Missing Remake does not offer its transport attrition');
    let launches = 0;
    page.on('request', r => {
      if (r.url().includes('/api/mount/') || r.url().includes('/atlas/start') || r.isNavigationRequest()) launches++;
    });
    await mod.hover();
    assert.match(await mod.getAttribute('title'), /^Requires Empire at War: Remake$/);
    await mod.click();
    assert(await info.isVisible());
    assert.equal(await info.getByRole('heading').innerText(), 'Empire at War: Remake');
    await page.keyboard.press('Escape');
    await info.waitFor({ state: 'detached' });
    assert(await mod.evaluate(b => document.activeElement === b));
    assert.equal(await board.getAttribute('data-campaign'), initial);
    assert(await start.isEnabled());
    await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
    assert(await start.isDisabled());
    assert.equal(await board.getAttribute('data-campaign'), '');
    assert.equal(await board.locator('[data-planet]').count(), 0);
    assert(await board.getByRole('slider', { name: 'Starting year' }).isHidden());
    const versions = board.getByRole('button', { name: 'Versions of The Clone Wars', exact: true });
    await versions.click();
    const locked = board.getByRole('button', { name: /The Clone Wars · Small · Requires Fall of the Republic/ });
    await locked.press('Enter');
    assert.equal(await info.getByRole('heading').innerText(), 'Fall of the Republic');
    await info.getByRole('button', { name: 'Close' }).click();
    await board.getByRole('tab', { name: 'Scenario-based', exact: true }).click();
    const genres = board.getByRole('tablist', { name: 'Scenario type' });
    assert.deepEqual(await genres.getByRole('tab').allTextContents(), ['Story', 'Random', 'Sandbox', 'Miscellaneous']);
    await genres.getByRole('tab', { name: 'Story' }).press('ArrowRight');
    assert.equal(await board.locator('tbody:visible').getAttribute('data-section'), 'Random');
    await board.locator('tbody:visible .uc-locked-choice').first().click();
    assert.equal(await info.getByRole('heading').innerText(), 'Awakening of the Clone Wars');
    await info.getByRole('button', { name: 'Close' }).click();
    assert(await board.locator('.uc-content').evaluate(e => e.scrollWidth === e.clientWidth));
    assert.equal(launches, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ stockSelectionPreserved: initial, unavailableEraBrowsable: true, discoveryLaunches: launches, errors }));
  } finally {
    await browser?.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
