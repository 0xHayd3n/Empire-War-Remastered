// Disposable stock GC: accept a charter, use the finder, save during travel, reload and deliver.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8970),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      host.stdout.on('data', b => {
        if (String(b).includes('Universal game:')) ok();
      });
      host.once('exit', () => no(Error('Test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const b = f.locator('.uc-atlas');
    await b.getByRole('button', { name: /Equal Footing/ }).click();
    await b.getByRole('tab', { name: 'Faction', exact: true }).click();
    await b.locator('[data-field="faction"] input[value="Rebel"]').check();
    await b.getByRole('tab', { name: 'Settings', exact: true }).click();
    await b.locator('[data-field="path"] input[value="convoy"]').check();
    await b.locator('.uc-start').click();
    await page.locator('.battle-plate').waitFor();
    await page.locator('.battle-plate').waitFor({ state: 'hidden' });
    const r = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await r.waitForFunction(() => window.game?.galaxy?.convoy?.state === 'offer');
    await r.evaluate(() => game.galacticLog.show(0));
    await f.getByRole('button', { name: 'Accept freight charter' }).press('Enter');
    await f.getByRole('button', { name: 'Locate freighter: Hoth' }).waitFor();
    console.log('Charter accepted');
    await f.getByRole('button', { name: /Shipyard finder/ }).press('Enter');
    const ship = f.getByRole('button', { name: /^Find yards:/ }).first();
    const shipName = await ship.getAttribute('aria-label');
    await ship.press('Enter');
    const yard = f.getByRole('button', { name: /^Go to yard:/ }).first();
    const yardName = await yard.getAttribute('aria-label');
    await yard.press('Enter');
    assert(await r.evaluate(() => !game.galacticLog.opened));
    console.log('Finder', shipName, yardName);
    const proof = await r.evaluate(async () => {
      const { orderMove } = await import('/js/game/fleets.js'),
        { snapshot, putSave } = await import('/js/game/savegame.js'),
        g = game.galaxy,
        freighter = g.fleets.find(f => f.units.some(u => u.charter === g.convoy.id)),
        to = g.planets.find(p => p.name === 'Bespin');
      if (!orderMove(g, freighter, to.index, null, null, { human: true })) throw Error('Move refused');
      const id = await putSave(snapshot(game, 'Freight QA'));
      sessionStorage.setItem('swr-load', id);
      return { id, carrier: g.convoy.id, credits: g.players.find(p => p.faction === g.active).credits };
    });
    await r.evaluate(() => setTimeout(() => location.reload(), 0));
    await r.waitForFunction(id => window.game?.setup?.restore && game.galaxy?.convoy?.id === id, proof.carrier);
    await r.evaluate(() => {
      if (game.storyDialog?.opened) game.storyDialog.close();
      game.setUserPaused(false);
    });
    await r.waitForFunction(() => game.galaxy?.convoy?.state === 'paid', null, { timeout: 90000 });
    const after = await r.evaluate(async id => {
      const g = game.galaxy;
      await (await import('/js/game/savegame.js')).deleteSave(id);
      return {
        credits: g.players.find(p => p.faction === g.active).credits,
        ships: g.fleets.flatMap(f => f.units).filter(u => u.charter).length
      };
    }, proof.id);
    assert.equal(after.ships, 0);
    assert.equal(after.credits - proof.credits, 1500);
    assert.deepEqual(errors, []);
    console.log('PASS: in-flight OPFS reload, exact freighter returned and one payment', proof.credits, after.credits);
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
