// Two native Thrawn factions. Don't touch the mod flags: wait for the real queue and native Options handler.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8890),
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
    for (const faction of ['Empire', 'Greater_Maldrood']) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
        errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(90000);
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="TITLE_PLAY"]').click();
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const b = f.locator('.uc-atlas');
      await b.getByRole('button', { name: 'New Republic', exact: true }).click();
      const row = b.locator('[data-family="KnownSmall_Era_1_Rebel"]');
      if (!(await row.isVisible()))
        await b.locator(`[aria-controls~="${await row.locator('xpath=ancestor::tr').getAttribute('id')}"]`).click();
      await row.click();
      await b.getByRole('tab', { name: 'Faction', exact: true }).click();
      await b.locator(`[data-field="faction"] input[value="${faction}"]`).check();
      await b.getByRole('tab', { name: 'Settings', exact: true }).click();
      await b.locator('[data-field="fractal"]').selectOption('request');
      await b.locator('.uc-start').click();
      await page.locator('.battle-plate').waitFor();
      await page.locator('.battle-plate').waitFor({ state: 'hidden' });
      const r = page.frames().find(x => x.parentFrame() === page.mainFrame());
      await r.waitForFunction(w => window.game?.galaxy?.campaign.name === w, 'KnownSmall_Era_1_' + faction);
      await r.waitForFunction(() => game.controlsLocked === false || game.storyDialog?.opened);
      await r.evaluate(() => {
        if (game.storyDialog?.opened) game.storyDialog.close();
      });
      await r.waitForFunction(
        () =>
          game.galaxy.universalRules?.fractal?.state === 'unavailable' ||
          game.galaxy.players.find(p => p.faction === game.me).builtCounts?.Option_FS_Units === 1,
        null,
        { timeout: 75000 }
      );
      await r.waitForFunction(
        () => game.galaxy.players.find(p => p.faction === game.me).unlockedTypes?.some(n => /Impellor|Legator/i.test(n)),
        null,
        { timeout: 30000 }
      );
      const report = await r.evaluate(() => {
        const p = game.galaxy.players.find(p => p.faction === game.me);
        return {
          faction: game.me,
          state: game.galaxy.universalRules?.fractal,
          built: p.builtCounts?.Option_FS_Units,
          unlocks: p.unlockedTypes.filter(n => /Impellor|Compellor|Legator/i.test(n)),
          time: game.galaxy.time
        };
      });
      console.log(report);
      assert(report.built === 1 && report.state.state === 'ordered');
      const want = faction === 'Empire' ? ['impellor_carrier', 'compellor_battlecruiser'] : ['legator_star_dreadnought'];
      assert(want.every(n => report.unlocks.some(x => x.toLowerCase() === n)));
      const yard = await r.evaluate(() => {
        const g = game.galaxy,
          p = g.planets.find(p => p.owner === g.active && p.orbitalStructures.some(u => /SHIPYARD_LEVEL_FOUR$/i.test(u.type.name)));
        if (!p) return null;
        game.select(p.index);
        game.scriptUI.click('b_space_filter02');
        return p.name;
      });
      if (yard) {
        await r.waitForFunction(
          async name =>
            (await import('/js/game/galacticproduction.js'))
              .availableUnits(game.galaxy, game.selected, game.me, 'space')
              .some(t => t.name.toLowerCase() === name),
          want[0],
          { timeout: 15000 }
        );
        console.log('Visible in native production at', yard, want[0]);
      } else console.log('No starting dreadnought yard; only unlock verified');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
