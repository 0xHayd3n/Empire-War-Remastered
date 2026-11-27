// Disposable stock save; authored Hoth station, one controlled Imperial attacker.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8940),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser, r;
  try {
    await new Promise((ok, no) => {
      host.stdout.on('data', b => {
        if (String(b).includes('Universal game:')) ok();
      });
      host.once('exit', () => no(Error('test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(90000);
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator('#game'),
      btn = name => f.getByRole('button', { name });
    await f.locator('[data-id="TITLE_PLAY"]').click();
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const b = f.locator('.uc-atlas');
    await b.getByRole('button', { name: /Equal Footing/ }).click();
    await b.getByRole('tab', { name: 'Faction', exact: true }).click();
    await b.locator('[data-field="faction"] input[value="Rebel"]').check();
    await b.getByRole('tab', { name: 'Settings', exact: true }).click();
    for (const k of ['mercenaries', 'fighterSupport']) await b.locator(`[data-field="${k}"]`).selectOption('offer');
    await b.locator('.uc-start').click();
    await page.locator('.battle-plate').waitFor();
    await page.locator('.battle-plate').waitFor({ state: 'hidden' });
    r = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await r.waitForFunction(() => window.game?.galaxy?.hire && game.galaxy.fighterSupport);
    const stats = () =>
      r.evaluate(() => {
        const g = game.galaxy;
        return {
          credits: g.players.find(p => p.faction === g.active).credits,
          hired: g.fleets.flatMap(f => f.units).filter(u => u.hireId).length,
          fighters: g.fleets
            .filter(f => f.owner === 'Rebel')
            .flatMap(f => f.units)
            .filter(u => u.type.name === 'Rebel_X-Wing_Squadron').length,
          state: g.hire.state,
          end: g.hire.end
        };
      });
    const reload = async () => {
      await r.evaluate(async () => {
        const { putSave, snapshot } = await import('/js/game/savegame.js');
        sessionStorage.setItem('swr-load', await putSave(snapshot(game, 'Station services test')));
      });
      await Promise.all([
        page.waitForEvent('framenavigated', frame => frame === r),
        r.evaluate(() => setTimeout(() => location.reload(), 0))
      ]);
    };
    await r.evaluate(() => game.galacticLog.show(0));
    const before = await stats();
    await btn(/^Hire corvette/).press('Enter');
    const hired = await stats();
    assert.equal(hired.credits, before.credits - 750);
    assert.equal(hired.hired, 1);
    await r.evaluate(() => game.galacticLog.close());
    await reload();
    await r.waitForFunction(() => window.game?.galaxy?.hire?.state === 'serving');
    assert.deepEqual(await stats(), hired);
    console.log('Hire and OPFS restore:', hired);
    const hothFighters = await r.evaluate(
      () =>
        game.galaxy.fleets
          .filter(f => f.owner === 'Rebel' && game.galaxy.planets[f.planet]?.name === 'Hoth')
          .flatMap(f => f.units)
          .filter(u => u.type.name === 'Rebel_X-Wing_Squadron').length
    );
    await r.evaluate(async () => {
      const g = game.galaxy,
        { db } = await import('/js/gamedata.js'),
        { stageStart } = await import('/js/game/transit.js'),
        p = g.planets.find(p => p.name === 'Hoth');
      game.setUserPaused(true);
      g.fleets = g.fleets.filter(f => f.planet !== p.index);
      g.fleets.push({
        planet: p.index,
        owner: 'Empire',
        units: [{ type: db.type('Tartan_Patrol_Cruiser') }],
        path: [],
        dest: -1,
        leg: null,
        pos: null,
        slot: 0
      });
      game.battle = { p: p.index, mode: 'space', attacker: 'Empire', defender: 'Rebel' };
      const setup = game.battleSetup();
      if (!setup.campaign.stationSupport) throw Error('not a supported station defense');
      setTimeout(() => stageStart(setup), 0);
    });
    await r.waitForFunction(() => !!window.game?.stationSupportHud && !game.cine?.on && !game.controlsLocked);
    await r.evaluate(() => {
      game.world.aiSuspended = true;
    });
    await btn(/^Call X-wing support/).press('Enter');
    await r.waitForFunction(() => game.campaignBook.support.left < 565);
    const pending = await r.evaluate(() => {
      game.paused = true;
      return { credits: game.human.credits, left: game.campaignBook.support.left };
    });
    assert.equal(pending.credits, hired.credits - 1500);
    await reload();
    await r.waitForFunction(() => !!window.game?.loadedSave && !!game.stationSupportHud);
    await r.evaluate(() => {
      game.world.aiSuspended = true;
      game.paused = false;
    });
    await r.waitForFunction(() => game.campaignBook.support.phase === 'deployed', null, { timeout: 80000 });
    const wave = await r.evaluate(() => ({
      squads: game.world.squads.filter(
        s => s.type.name === 'Rebel_X-Wing_Squadron' && s.player === game.human && !s.dead && !s.garrisonedBy
      ).length,
      credits: game.human.credits,
      repeat: game.campaignBook.support.phase
    }));
    assert(wave.squads >= 2);
    assert.equal(wave.credits, pending.credits);
    assert(await btn(/^Call X-wing support/).isDisabled());
    console.log('Reload during dispatch; wave:', wave);
    await r.evaluate(() => {
      for (const r of game.setup.campaign.attacker.units) {
        const e = game.campaignBook.entity.get(r.gid);
        if (e && !e.dead) game.world.kill(e, null);
      }
    });
    await r.waitForFunction(() => !!game.campaignOutcome, null, { timeout: 60000 });
    await r.evaluate(() => setTimeout(() => game.returnToGalaxy(), 0));
    await r.waitForFunction(() => window.game?.galaxy?.hire?.state === 'serving');
    const after = await stats();
    assert.equal(after.credits, wave.credits);
    assert.equal(after.fighters, hired.fighters - hothFighters);
    console.log('Galaxy after victory:', after);
    // Advance only the test's campaign clock near each boundary; let the normal game update end the hire.
    await r.evaluate(() => {
      game.galaxy.time = game.galaxy.hire.end - 0.1;
      game.setUserPaused(false);
    });
    await r.waitForFunction(() => {
      if (game.storyDialog?.opened) game.storyDialog.close();
      return game.galaxy.hire.state === 'expired';
    });
    assert.equal((await stats()).hired, 0);
    await r.evaluate(() => game.galacticLog.show(0));
    assert.equal(await btn(/^Hire corvette/).count(), 0);
    await r.evaluate(() => {
      game.galacticLog.close();
      game.galaxy.time = game.galaxy.hire.next;
      game.galacticLog.show(0);
    });
    const renew = await stats();
    await btn(/^Hire corvette/).press('Enter');
    assert.equal((await stats()).hired, 1);
    assert.equal((await stats()).credits, renew.credits - 750);
    console.log('Contract expired, cooldown blocked hire, renewal charged once.');
    assert.deepEqual(errors, []);
  } catch (e) {
    if (r)
      console.error(
        await r
          .evaluate(() => ({
            c: window.game?.setup?.campaign?.stationSupport,
            m: window.game?.campaignBook?.support,
            station: window.game?.campaignBook?.station?.type?.name,
            text: document.body.innerText.slice(-350)
          }))
          .catch(() => null)
      );
    throw e;
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
