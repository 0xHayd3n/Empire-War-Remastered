const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8810),
    root = require('node:path').join(__dirname, '..'),
    url = `http://127.0.0.1:${port}/`,
    s = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  let b;
  try {
    await new Promise((ok, no) => {
      s.stdout.on('data', d => {
        if (d.includes('Universal game:')) ok();
      });
      s.once('exit', () => no(Error('Could not start test host')));
    });
    b = await chromium.launch({ channel: 'chrome' });
    const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(90000);
    page.on('pageerror', e => console.log('ERROR', e.message));
    page.on('console', m => {
      if (/checkpoint unavailable|failed to load the save/i.test(m.text())) console.log(m.text());
    });
    await page.goto(url);
    const f = page.frameLocator('#game'),
      ctl = id => f.locator(`[data-id="${id}"]:visible`).first();
    await ctl('TITLE_PLAY').click();
    await ctl('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES').click();
    await ctl('IDC_CUSTOM_CAMPAIGN_BUTTON').click();
    const board = f.locator('.uc-atlas');
    await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
    await board.getByRole('button', { name: 'New Republic', exact: true }).click();
    const leaf = board.locator('[data-family^="Custom_Small_Era_1_" i]').first();
    await leaf.waitFor({ state: 'attached' });
    if (!(await leaf.isVisible()))
      await board.locator(`[aria-controls~="${await leaf.locator('xpath=ancestor::tr').getAttribute('id')}"]`).click();
    await leaf.click();
    await board.getByRole('tab', { name: 'Faction', exact: true }).click();
    await board.locator('[data-field="faction"] input[value="Rebel"]').check();
    await board.locator('.uc-start').click();
    await page.waitForFunction(
      () => Object.keys(JSON.parse(localStorage.getItem('universal-conquest-checkpoints') || '{}')).some(k => k !== 'stock'),
      null,
      { timeout: 90000 }
    );
    const runtime = () => page.frames().find(fr => fr.parentFrame() === page.mainFrame());
    const before = await runtime().evaluate(() => ({ origin: location.origin, name: game.galaxy.campaign.name, side: game.me }));
    console.log('Checkpoint written', before);
    await page.goto(url);
    await f.locator('.title-menu[data-section="home"] [data-id=CONTINUE]:enabled').waitFor();
    if (process.env.SWR_CAMPAIGN_HOME_SCREENSHOT) await page.screenshot({ path: process.env.SWR_CAMPAIGN_HOME_SCREENSHOT });
    await Promise.all([
      page.waitForEvent('framenavigated', { predicate: fr => fr.url().includes('universal-mode=continue') }),
      f.locator('[data-id=CONTINUE]:enabled').click()
    ]);
    await runtime().waitForFunction(() => !!window.game?.setup.restore && !!window.game?.galaxy, null, { timeout: 90000 });
    const after = await runtime().evaluate(() => ({ origin: location.origin, name: game.galaxy.campaign.name, side: game.me }));
    assert.deepEqual(after, before);
    console.log('PASS: real opening checkpoint and Continue across eras', after);
    await runtime().evaluate(async () => {
      const { getSave, putSave } = await import('/js/game/savegame.js');
      const older = await getSave('conquest-opening');
      older.name = 'Earlier campaign checkpoint';
      older.saved = '2020-01-01T00:00:00.000Z';
      older.galaxy.time = 123.45; // distinct saved simulation clock identifies the exact restored slot
      await putSave(older, 'older-picker-fixture');
    });
    await page.goto(url);
    await ctl('CHOOSE_CAMPAIGN').click();
    await f.getByLabel('Campaign profile').selectOption('1125571106');
    const earlier = f.locator('.checkpoint-rows button').filter({ hasText: 'Earlier campaign checkpoint' });
    await earlier.waitFor();
    if (process.env.SWR_PICKER_SCREENSHOT) await page.screenshot({ path: process.env.SWR_PICKER_SCREENSHOT });
    await earlier.click();
    await runtime().waitForFunction(() => window.game?.setup?.restore?.time === 123.45 && !!window.game?.galaxy);
    console.log('PASS: Home campaign picker restored the selected older checkpoint from its owning mod.');
  } finally {
    await b?.close();
    s.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
