// Reviewed Thrawn start: compare the chooser request with the same native Options order.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8910),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      host.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      host.once('exit', () => no(Error('Port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (const fromSetup of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(100000);
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const board = f.locator('.uc-atlas');
      await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
      await board.getByRole('button', { name: 'New Republic', exact: true }).click();
      const row = board.locator('[data-family="KnownSmall_Era_1_Rebel"]');
      if (!(await row.isVisible()))
        await board.locator(`[aria-controls~="${await row.locator('xpath=ancestor::tr').getAttribute('id')}"]`).click();
      await row.click();
      await board.getByRole('tab', { name: 'Faction', exact: true }).click();
      await board.locator('[data-field="faction"] input[value="Rebel"]').check();
      assert.equal(await board.getAttribute('data-campaign'), 'KnownSmall_Era_1_Rebel');
      if (fromSetup) {
        await board.getByRole('tab', { name: 'Settings', exact: true }).click();
        await board.locator('[data-field="canon"]').selectOption('request');
      }
      await board.locator('.uc-start').click();
      await page.locator('.battle-plate').waitFor();
      await page.locator('.battle-plate').waitFor({ state: 'hidden' });
      const run = page.frames().find(x => x.parentFrame() === page.mainFrame());
      await run.waitForFunction(
        () => window.game?.galaxy?.campaign?.name === 'KnownSmall_Era_1_Rebel' && game.renderer.domElement.width > 0
      );
      const info = () =>
        run.evaluate(async () => {
          const { db } = await import('/js/gamedata.js'),
            { queueUnit, availableUnits, productionBlock } = await import('/js/game/galacticproduction.js');
          const g = game.galaxy,
            p = g.players.find(x => x.faction === 'Rebel'),
            t = db.type('Option_Canon_Units'),
            planet = g.planets[game.selected];
          return {
            time: g.time,
            paused: game.paused,
            held: game.held,
            locked: game.controlsLocked,
            dialog: !!game.storyDialog?.opened,
            button: game.scriptUI.state('B_SAVE_FIXER'),
            selected: planet?.name,
            station: planet?.spaceLevel,
            available: planet && availableUnits(g, planet.index, g.active, 'space').includes(t),
            block: planet && productionBlock(g, planet.index, g.active, t),
            unlocked: p.unlockedTypes?.filter(n => /mc75|starhawk|raddus|hera/i.test(n)),
            built: p.builtCounts?.[t.name],
            order: g.universalRules?.canon
          };
        });
      await run.waitForFunction(() => game.controlsLocked === false || game.storyDialog?.opened);
      console.log('ready', await info());
      await run.evaluate(() => {
        if (game.storyDialog?.opened) game.storyDialog.close();
      });
      await run.waitForFunction(() => game.controlsLocked === false);
      if (!fromSetup) {
        await run.evaluate(() => {
          if (game.storyDialog?.opened) game.storyDialog.close();
          const p = game.galaxy.planets.find(p => p.owner === game.me && p.spaceLevel > 0 && p.selectable && !p.restricted);
          game.select(p.index);
          return game.scriptUI.click('b_save_fixer');
        });
        await run.waitForTimeout(2500);
        console.log('selected', await info());
        await run.evaluate(async () => {
          const { db } = await import('/js/gamedata.js'),
            { queueUnit } = await import('/js/game/galacticproduction.js');
          const why = queueUnit(game.galaxy, game.selected, game.me, db.type('Option_Canon_Units'));
          if (why) throw Error(why);
        });
      }
      await run.waitForFunction(
        () => game.galaxy.players.find(p => p.faction === game.me).unlockedTypes?.some(n => /^starhawk_mk1$/i.test(n)),
        null,
        { timeout: 50000 }
      );
      const end = await info();
      assert(end.unlocked.includes('MC75') && end.unlocked.includes('STARHAWK_MK1'));
      assert.equal(end.built, 1);
      if (fromSetup) assert.equal(end.order.state, 'ordered');
      console.log('unlocked', end);
      const yard = await run.evaluate(() => {
        const p = game.galaxy.planets.find(
          p => p.owner === game.me && p.orbitalStructures.some(u => u.type.name.toUpperCase() === 'NEWREPUBLIC_SHIPYARD_LEVEL_FOUR')
        );
        if (!p) throw Error('Native dreadnought yard missing');
        game.select(p.index);
        return p.name;
      });
      const ships = [];
      for (const [name, button] of [
        ['MC75', 'b_space_filter01'],
        ['Starhawk_MK1', 'b_space_filter02']
      ]) {
        await run.evaluate(b => game.scriptUI.click(b), button);
        await run.waitForFunction(
          async n =>
            (await import('/js/game/galacticproduction.js'))
              .availableUnits(game.galaxy, game.selected, game.me, 'space')
              .some(t => t.name.toUpperCase() === n.toUpperCase()),
          name,
          { timeout: 10000 }
        );
        ships.push(name);
      }
      console.log('Production', fromSetup, yard, ships);
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
