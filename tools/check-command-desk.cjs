// Local Chrome, disposable browser storage. A temporary registry keeps the playset smoke check out of the player's library.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8840),
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-playset-')),
    server = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_PLAYSET_HOME: tmp },
      stdio: ['ignore', 'pipe', 'inherit']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', d => {
        if (d.includes('Universal game:')) ok();
      });
      server.once('exit', c => no(Error('server exit ' + c)));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(65000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    const f = page.frameLocator('#game'),
      ctl = id => f.locator(`[data-id="${id}"]:visible`).first(),
      click = id => ctl(id).click(),
      shot = async name => {
        if (process.env.SWR_DESK_SHOTS) await page.screenshot({ path: path.join(process.env.SWR_DESK_SHOTS, name + '.png') });
      };
    // Workshop/Customize are Home destinations; nav, bell and cog only exist on Home.
    const section = root => root.locator('.title-menu').getAttribute('data-section');
    const goHome = async (root = f) => {
      for (let i = 0; i < 4 && (await section(root)) !== 'home'; i++)
        await root.locator('.title-menu .mode-back:visible').first().click();
      await root.locator('.title-menu[data-section="home"]').waitFor();
    };
    await click('TITLE_WORKSHOP');
    const mod = f.locator('[data-mod="1125571106"]');
    await mod.click();
    const find = f.getByRole('searchbox', { name: 'Search mods' });
    await find.fill('xxxxxxxxxxxxx');
    await f.getByText('No matching mods.').waitFor();
    await find.fill('1125571106');
    await mod.click();
    await f.getByRole('button', { name: 'Add to playset', exact: true }).click();
    await find.fill('');
    await f.getByLabel('Playset name').fill('New Republic');
    await f.getByRole('button', { name: 'Save playset', exact: true }).click();
    await f.getByRole('button', { name: 'Remove from playset', exact: true }).click();
    await f.getByLabel('Saved playset').selectOption({ label: 'New Republic' });
    await f.getByRole('button', { name: 'Use saved', exact: true }).click();
    // A Home round trip must not drop the saved playset or its mounted order.
    await goHome();
    await click('TITLE_WORKSHOP');
    await mod.click();
    await shot('workshop-desk');
    await f.locator('.set-order strong').first().waitFor();
    assert.match(await f.locator('.set-order strong').innerText(), /Thrawn/i);
    await f.getByRole('button', { name: 'Prepare playset', exact: true }).click();
    const newGame = f.getByRole('link', { name: 'Open playset game' });
    await newGame.waitFor();
    const launched = await page.request.get(new URL('/api/mounted', await newGame.getAttribute('href')).href);
    assert.deepEqual(
      (await launched.json()).map(m => m.workshop),
      ['1125571106']
    );
    // Follow the real playset link as a player would. The source session must remain in Workshop;
    // the independent mod game must expose Play and Customize with the selected mod actually mounted.
    const [separate] = await Promise.all([page.context().waitForEvent('page'), newGame.click()]);
    try {
      await separate.locator('[data-id="TITLE_PLAY"]').click();
      await separate.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').waitFor();
      await goHome(separate);
      await separate.locator('[data-id="TITLE_CUSTOMIZE"]:visible').click();
      await separate.locator('#armyPainter[open] #ap-title').waitFor();
      const mountedIds = await separate.evaluate(async () => (await (await fetch('/api/mounted')).json()).map(row => row.workshop));
      assert.deepEqual(mountedIds, ['1125571106']);
      await f.locator('.title-menu[data-section="workshop"]').waitFor();
    } finally {
      await separate.close();
    }
    await goHome();
    await click('TITLE_CUSTOMIZE');
    await f.getByRole('button', { name: 'Fleet registry', exact: true }).click();
    const fac = f.locator('.faction');
    await fac.locator('option').first().waitFor({ state: 'attached' });
    const v = await fac.locator('option').evaluateAll(os => os.find(o => /^empire$/i.test(o.value))?.value || os[0].value);
    await fac.selectOption(v);
    const unit = f.locator('.unit-row:not(:disabled)').first();
    await unit.click();
    const selected = await unit.getAttribute('data-unit'),
      fleet = 'Patrol Aurek';
    await f.getByPlaceholder('e.g. Outer Rim patrol').fill(fleet);
    await f.getByRole('button', { name: 'Save preset', exact: true }).click();
    await f.getByText('Saved. Select this preset in Instant Battle for this faction.').waitFor();
    await shot('customize-desk');
    await f.getByRole('button', { name: 'Delete preset', exact: true }).click();
    await f.getByRole('button', { name: 'Cancel', exact: true }).click();
    await goHome();
    await click('TITLE_PLAY');
    await click('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES');
    await click('IDC_INSTANT_BATTLE_BUTTON');
    await f.getByRole('button', { name: 'Edit fleets', exact: true }).click();
    const preset = f.getByLabel('Fleet preset', { exact: true });
    await preset.selectOption({ label: fleet });
    await f.getByRole('button', { name: 'Apply preset' }).click();
    assert.equal(await f.locator('#instantBattle .ib-unit.has').count(), 1);
    assert.equal(await f.locator('#instantBattle .ib-unit.has .ib-count').innerText(), '1');
    console.log('Preset applied to live staging:', selected);
    await page.goto(`http://127.0.0.1:${port}/`);
    await click('TITLE_CUSTOMIZE');
    await f.getByRole('button', { name: 'Fleet registry', exact: true }).click();
    const ps = f.locator('select.profile');
    await ps.locator('option[value="1125571106"]').waitFor({ state: 'attached' });
    await ps.selectOption('1125571106');
    await f.getByRole('button', { name: 'Fleet registry', exact: true }).click();
    await f
      .locator('.title-menu[data-section="customize"] select.profile option[value="1125571106"]:checked')
      .waitFor({ state: 'attached' });
    assert.equal(
      await f
        .locator('.blueprints option')
        .allTextContents()
        .then(a => a.includes(fleet)),
      false
    );
    await f.locator('.unit-row').first().waitFor();
    await page.setViewportSize({ width: 375, height: 667 });
    assert(await f.locator('.title-menu').evaluate(e => e.scrollWidth <= innerWidth));
    await goHome();
    await click('TITLE_WORKSHOP');
    await f.locator('.index-row').first().waitFor();
    assert(await f.locator('.title-menu').evaluate(e => e.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(
      'PASS: actual installed catalog, search, persistent playset, mounted selection, preset application, isolated mod roster, and mobile layout.'
    );
  } finally {
    await browser?.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
