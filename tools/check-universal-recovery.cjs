// Disposable rendered stock game. Control the enemy fixture and end it via a native kill;
// don't teleport a tactical ship, synthesize a capture, or edit the result/treasury.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8950),
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
      host.once('exit', () => no(Error('Test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
      errors = [];
    page.setDefaultTimeout(85000);
    page.on('pageerror', e => {
      console.error('page', e.message);
      errors.push(e.message);
    });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator('#game'),
      btn = name => f.getByRole('button', { name });
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const b = f.locator('.uc-atlas');
    await b.getByRole('button', { name: /Equal Footing/ }).click();
    await b.getByRole('tab', { name: 'Faction', exact: true }).click();
    await b.locator('[data-field="faction"] input[value="Rebel"]').check();
    await b.getByRole('tab', { name: 'Settings', exact: true }).click();
    await b.locator('[data-field="path"] input[value="recovery"]').check();
    await b.locator('.uc-start').click();
    await page.locator('.battle-plate').waitFor();
    await page.locator('.battle-plate').waitFor({ state: 'hidden' });
    r = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await r.waitForFunction(() => window.game?.galaxy?.recovery?.state === 'offer');
    await r.evaluate(() => game.galacticLog.show(0));
    const offers = btn(/^Embark crew: Hoth/);
    assert.equal(await offers.count(), 2);
    await offers.nth(1).press('Enter');
    await btn(/^Boarding ship: Hoth/).press('Enter');
    console.log('Second owned corvette assigned');
    if (process.env.SWR_TEST_RECOVERY_ROUTE) {
      const route = await r.evaluate(async () => {
        const g = game.galaxy,
          f = g.fleets.find(f => f.units.some(u => u.salvageId)),
          to = g.planets.find(p => p.name === 'Sullust');
        const { orderMove } = await import('/js/game/fleets.js');
        if (!orderMove(g, f, to.index, null, null, { human: true })) throw Error('Native route refused');
        game.setUserPaused(false);
        return f.path.map(i => g.planets[i].name);
      });
      console.log('Native movement route', route);
      await r.waitForFunction(
        () => {
          if (game.storyDialog?.opened) game.storyDialog.close();
          return window.game?.pendingBattle?.request || window.game?.recoveryHud;
        },
        null,
        { timeout: 100000 }
      );
      if (process.env.SWR_TEST_RECOVERY_ROUTE === 'auto') {
        await r.evaluate(() => game.pendingBattle.click('choice_button_right'));
        await r.waitForFunction(() => game.galaxy?.recovery?.state === 'missed');
        assert.deepEqual(errors, []);
        console.log('PASS: native galactic auto-resolve, no prize');
        return;
      }
      await r.evaluate(() => {
        if (game.pendingBattle?.request) {
          const r = game.pendingBattle.request;
          if (game.galaxy.planets[r.p].name !== 'Sullust') throw Error('Different battle pending');
          game.pendingBattle.click('choice_button_left');
          game.pendingBattle.click('attack_button_single');
        }
      });
      await r.waitForFunction(() => !!window.game?.recoveryHud && !game.cine?.on && !!game.tacticalCampaign, null, { timeout: 110000 });
      await r.evaluate(() => {
        const book = game.campaignBook,
          e = book.entity.get(game.setup.campaign.recovery.gid);
        if (!e || e.dead) throw Error('Boarder not fielded');
        game.world.kill(e, null);
        for (const u of [...game.world.units, ...game.world.squads]) if (u.player === game.human && !u.dead) game.world.kill(u, null);
      });
      await r.waitForFunction(() => !!game.campaignOutcome, null, { timeout: 65000 });
      assert(!(await r.evaluate(() => game.campaignOutcome.recovered)));
      await r.evaluate(() => setTimeout(() => game.returnToGalaxy(), 0));
      await r.waitForFunction(() => window.game?.galaxy?.recovery?.state === 'lost');
      assert.deepEqual(errors, []);
      console.log('PASS: authored fleets and native conflict, exact boarding ship killed, no prize');
      return;
    }
    await r.evaluate(async () => {
      const g = game.galaxy,
        { db } = await import('/js/gamedata.js'),
        { stageStart } = await import('/js/game/transit.js'),
        p = g.planets.find(p => p.name === 'Sullust'),
        carrier = g.fleets.find(f => f.units.some(u => u.salvageId)),
        crew = carrier.units.find(u => u.salvageId);
      game.paused = true;
      g.fleets = g.fleets.filter(f => f.planet !== p.index);
      carrier.units = carrier.units.filter(u => u !== crew);
      const fleet = (owner, units) => ({ planet: p.index, owner, units, path: [], dest: -1, leg: null, pos: null, slot: 0 });
      g.fleets.push(
        fleet('Rebel', [{ type: crew.type, pathfinder: true }, crew]),
        fleet('Empire', [{ type: db.type('Tartan_Patrol_Cruiser') }])
      );
      p.station = null;
      p.spaceLevel = 0;
      p.orbitalStructures = [];
      game.battle = { p: p.index, mode: 'space', attacker: 'Rebel', defender: 'Empire' };
      const setup = game.battleSetup();
      if (!setup.campaign.recovery) throw Error('Missing encounter');
      setTimeout(() => stageStart(setup), 0);
    });
    await r.waitForFunction(() => !!window.game?.recoveryHud && !!game.retreat);
    await r.evaluate(() => {
      game.world.aiSuspended = true;
    });
    await r.waitForFunction(() => !game.cine?.on && !game.tacticalCinematics?.on && !!game.ui.bar);
    await r.evaluate(() => {
      game.paused = true;
      game.ui.bar.bReinforce.click();
      game.ui.bar.refreshReinforce();
    });
    const card = f.locator('#reinforceWin .boarding-reserve');
    assert.match(await card.getAttribute('aria-label'), /Recovery boarding crew/);
    await card.press('Enter');
    await r.evaluate(() => {
      const ui = game.ui,
        pl = ui.placing;
      if (pl?.vessels[0] !== game.setup.campaign.recovery.id) throw Error('Wrong reserve card');
      for (let y = 80; y < ui.r.height - 120; y += 30)
        for (let x = 64; x < ui.r.width - 80; x += 50) {
          ui.mouse.x = x;
          ui.mouse.y = y;
          ui.updatePlacing();
          if (pl.ok) {
            ui.finishPlacing(x, y);
            ui.bar.refreshReinforce();
            game.paused = false;
            return;
          }
        }
      throw Error('No legal reserve position');
    });
    await btn('Plot boarding run').click();
    await r.waitForFunction(() => game.campaignBook.boarding.ticks >= 12, null, { timeout: 65000 });
    const at = await r.evaluate(async () => {
      game.paused = true;
      const { snapshot, putSave } = await import('/js/game/savegame.js'),
        b = game.campaignBook,
        m = b.boarding,
        e = b.entity.get(game.setup.campaign.recovery.gid),
        s = snapshot(game, 'Recovery in progress'),
        id = await putSave(s);
      sessionStorage.setItem('swr-load', id);
      return { ticks: m.ticks, dist: Math.hypot(e.x - m.x, e.y - m.y), id };
    });
    assert(at.ticks > 0 && at.ticks < 150);
    console.log('Natural boarding progress', at.ticks, at.dist);
    await r.evaluate(() => setTimeout(() => location.reload(), 0));
    await r.waitForFunction(() => window.game?.setup?.restore && !!game.loadedSave && !!game.recoveryHud);
    assert(
      await r.evaluate(
        t =>
          game.setup.restore.campaign.book.boarding.ticks === t &&
          game.campaignBook.boarding.ticks >= t &&
          !game.campaignBook.boarding.void,
        at.ticks
      )
    );
    await r.evaluate(() => {
      game.world.aiSuspended = true;
      game.paused = false;
    });
    await r.waitForFunction(() => game.campaignBook.boarding.ticks === 150);
    await r.evaluate(() => {
      const cb = game.setup.campaign,
        book = game.campaignBook;
      for (const v of cb.defender.units) {
        const e = book.entity.get(v.gid);
        if (e && !e.dead) game.world.kill(e, null);
      }
    });
    await r.waitForFunction(() => !!game.campaignOutcome, null, { timeout: 65000 });
    const result = await r.evaluate(() => ({ claim: game.campaignOutcome.recovered, id: game.setup.campaign.recovery.id }));
    assert.equal(result.claim, result.id);
    await r.evaluate(() => setTimeout(() => game.returnToGalaxy(), 0));
    await r.waitForFunction(() => window.game?.galactic && game.galaxy?.recovery?.state === 'tow');
    console.log('Manual victory, surviving crew towing prize');
    await r.evaluate(async () => {
      const g = game.galaxy,
        f = g.fleets.find(f => f.units.some(u => u.salvageId === g.recovery.id)),
        p = g.planets.find(p => p.name === 'Bespin');
      const { orderMove } = await import('/js/game/fleets.js');
      if (!orderMove(g, f, p.index, null, null, { human: true })) throw Error('Cannot order return to yard');
      game.setUserPaused(false);
    });
    await r.waitForFunction(() => {
      const g = game.galaxy;
      return g.fleets.some(f => !f.leg && g.planets[f.planet]?.name === 'Bespin' && f.units.some(u => u.salvageId === g.recovery.id));
    });
    await r.evaluate(() => game.galacticLog.show(0));
    const stats = () =>
      r.evaluate(() => {
        const g = game.galaxy;
        return {
          state: g.recovery.state,
          credits: g.players.find(p => p.faction === g.active).credits,
          ships: g.fleets
            .filter(f => f.owner === g.active)
            .flatMap(f => f.units)
            .filter(u => u.type.name === 'Nebulon_B_Frigate').length
        };
      });
    const before = await stats(),
      review = btn(/^Review refit/),
      price = Number((await review.getAttribute('aria-label')).match(/(\d+) credits/)[1]);
    await review.press('Enter');
    await btn('Cancel').click();
    assert.deepEqual(await stats(), before);
    await review.click();
    await btn(/^Confirm refit/).press('Enter');
    const after = await stats();
    assert.equal(after.credits, before.credits - price);
    assert.equal(after.ships, before.ships + 1);
    assert.equal(after.state, 'commissioned');
    await r.evaluate(async () => {
      game.galacticLog.close();
      const { putSave, snapshot } = await import('/js/game/savegame.js');
      sessionStorage.setItem('swr-load', await putSave(snapshot(game, 'Recommissioned frigate')));
      setTimeout(() => location.reload(), 0);
    });
    await r.waitForFunction(() => window.game?.setup?.restore && game.galaxy?.recovery?.state === 'commissioned');
    assert.deepEqual(await stats(), after);
    assert.deepEqual(errors, []);
    console.log('PASS: quote, cancel, one paid frigate and post-refit OPFS reload', before, price, after);
  } catch (e) {
    if (r)
      console.error(
        'state',
        await r
          .evaluate(() => ({
            g: game?.galaxy?.recovery,
            b: game?.campaignBook?.boarding,
            c: game?.setup?.campaign?.recovery,
            over: game?.over,
            paused: game?.paused,
            held: game?.held,
            userPaused: game?.userPaused,
            log: game?.galacticLog?.opened,
            briefing: game?.storyDialog?.opened,
            fleet: game?.galaxy?.fleets?.filter(f => f.units.some(u => u.salvageId)).map(f => ({ at: f.planet, to: f.dest, t: f.leg?.t })),
            pending: game?.pendingBattle?.request?.p,
            text: document.body.innerText.slice(-650)
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
