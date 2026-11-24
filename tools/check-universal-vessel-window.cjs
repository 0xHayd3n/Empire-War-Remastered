// Native title -> disposable stock galaxy -> staged tactical encounter -> OPFS
// tactical reload -> actual retreat/result -> fleet split/galactic reload -> re-entry.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8940),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      const timeout = setTimeout(() => no(Error('Startup timed out')), 40000);
      host.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) {
          clearTimeout(timeout);
          ok();
        }
      });
      host.once('exit', () => {
        clearTimeout(timeout);
        no(Error('Port unavailable'));
      });
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(90000);
    page.on('pageerror', e => console.error('page', e));
    page.on('console', m => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.error('console:', m.text().slice(0, 1500));
    });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const board = f.locator('.uc-atlas');
    await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
    await board.getByRole('button', { name: /Equal Footing/ }).click();
    await board.getByRole('tab', { name: 'Faction', exact: true }).click();
    await board.locator('[data-field="faction"] input[value="Rebel"]').check();
    await board.getByRole('tab', { name: 'Settings', exact: true }).click();
    const option = board.getByLabel('Rebel flagship', { exact: true });
    assert.equal(await option.inputValue(), '');
    await option.selectOption('commission');
    await board.locator('.uc-start').click();
    await page.locator('.battle-plate').waitFor();
    await page.locator('.battle-plate').waitFor({ state: 'hidden' });
    const run = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await run.waitForFunction(
      () => window.game?.galaxy?.campaign.name === 'Sandbox_Equal_Footing_Rebel' && game.renderer.domElement.width > 0
    );
    const btn = s => f.getByRole('button', { name: s, exact: true });
    await run.evaluate(async () => {
      const g = game.galaxy,
        { db } = await import('/js/gamedata.js');
      if (g.vessels?.flagship !== null) throw Error('Flagship commission not enabled by setup');
      game.paused = true;
      const p = g.planets.find(p => p.name === 'Bespin');
      g.fleets = g.fleets.filter(f => f.planet !== p.index);
      g.fleets.push({
        planet: p.index,
        owner: 'Rebel',
        units: [{ type: db.type('Calamari_Cruiser') }, { type: db.type('Calamari_Cruiser') }],
        path: [],
        dest: -1,
        leg: null,
        pos: null,
        slot: 0
      });
      await game.galacticLog.show(0);
    });
    const choice = btn('Designate: Bespin · Fleet 1 · Cruiser 2');
    await choice.press('Enter');
    await btn('Cancel').click();
    assert.equal(await run.evaluate(() => game.galaxy.vessels.flagship), null);
    await choice.click();
    await btn('Confirm designation').press('Enter');
    const flagId = await run.evaluate(() => {
      game.galacticLog.close();
      const g = game.galaxy;
      const f = g.fleets.find(f => f.units.some(u => u.vessel));
      if (f.units[0].vessel || f.units[1].vessel.id !== g.vessels.flagship) throw Error('Wrong cruiser commissioned');
      return g.vessels.flagship;
    });
    const enter = first =>
      run.evaluate(async first => {
        const g = game.galaxy,
          { db } = await import('/js/gamedata.js'),
          { stageStart } = await import('/js/game/transit.js');
        game.paused = true;
        const p = first ? g.planets.find(p => p.name === 'Bespin') : g.planets[g.fleets.find(f => f.units.some(u => u.vessel)).planet];
        g.fleets = g.fleets.filter(
          f => f.planet !== p.index || (f.owner === 'Rebel' && f.units.some(u => u.type.name === 'Calamari_Cruiser'))
        );
        if (!first) {
          const local = g.fleets.filter(f => f.planet === p.index);
          for (const f of local) {
            f.units = f.units.filter(u => u.type.name === 'Calamari_Cruiser');
            for (const u of f.units) delete u.pathfinder;
          }
          local[0].units.unshift({ type: db.type('Corellian_Corvette'), pathfinder: true });
        }
        const fleet = (owner, units) => ({ planet: p.index, owner, units, path: [], dest: -1, leg: null, pos: null, slot: 0 });
        g.fleets.push(fleet('Empire', [{ type: db.type('Tartan_Patrol_Cruiser') }]));
        p.station = null;
        p.spaceLevel = 0;
        p.orbitalStructures = [];
        game.battle = { p: p.index, mode: 'space', attacker: 'Empire', defender: 'Rebel' };
        const setup = game.battleSetup();
        setTimeout(() => stageStart(setup), 0);
        return setup.campaign.vesselBattle;
      }, first);
    const ready = async nonce =>
      run.waitForFunction(
        n =>
          window.game?.setup?.campaign?.vesselBattle === n &&
          !!game.campaignBook &&
          !!game.retreat &&
          !!game.ui &&
          !!game.tacticalCampaign &&
          game.renderer?.dom?.width > 0,
        nonce,
        { timeout: 120000 }
      );
    console.log('Rendered stock galaxy');
    const nonce = await enter(true);
    await ready(nonce);
    console.log('First rendered battle');
    const ids = await run.evaluate(async () => {
      game.paused = true;
      const w = game.world,
        twins = [...game.campaignBook.entity.values()].filter(e => e.type.name === 'Calamari_Cruiser'),
        a = twins.find(e => e.vesselId),
        b = twins.find(e => !e.vesselId);
      if (!a || !b || twins.length !== 2) throw Error('missing twin');
      a.shield = 0;
      w.damage(a, 1000, { damageType: 'Damage_Default' });
      const hp = a.hardpoints.find(h => h.destroyable);
      w.damage(a, hp.maxHealth / 2, { damageType: 'Damage_Default', hp });
      const { snapshot, putSave } = await import('/js/game/savegame.js');
      const save = await putSave(snapshot(game, 'Disposable tracked fleet'));
      sessionStorage.setItem('swr-load', save);
      return { a: a.vesselId, b: b.vesselId, hull: a.health, other: b.health, part: hp.def.name, hp: hp.health, save };
    });
    assert.equal(ids.a, flagId);
    assert.equal(ids.hull, ids.other - 1000);
    await run.evaluate(() => setTimeout(() => location.reload(), 0));
    await run.waitForFunction(
      n => window.game?.setup?.restore && game.setup.campaign?.vesselBattle === n && game.loadedSave && game.retreat,
      nonce,
      { timeout: 120000 }
    );
    console.log('Tactical OPFS reload');
    await run
      .evaluate(async ({ a, hull, save }) => {
        const e = [...game.campaignBook.entity.values()].find(e => e.vesselId === a);
        if (e?.health !== hull) throw Error('Tactical load lost hull');
        const { deleteSave } = await import('/js/game/savegame.js');
        await deleteSave(save);
        game.paused = true;
        game.world.time += game.retreat.allowedAfter() + 1;
        const code = game.retreat.request(game.human);
        if (code !== 0) throw Error('retreat refused: ' + code);
        for (let i = 0; i < 2000 && (game.retreat.active || game.retreat.flight); i++) game.retreat.step(1 / 30);
        if (!e.retreated) throw Error('ship failed to retreat');
        for (let i = 0; i < 300 && !game.campaignOutcome; i++) game.campaignVictoryStep();
        if (!game.campaignOutcome) throw Error('missing native campaign outcome');
        const out = game.campaignOutcome;
        console.info('Returning tracked battle');
        setTimeout(() => game.returnToGalaxy(), 0);
        return {
          nonce: out.vesselBattle,
          open: out.galaxy?.vessels?.open,
          alive: out.alive,
          results: out.vesselOutcomes?.map(o => [o.id, o.survived])
        };
      }, ids)
      .then(x => console.log('Return', x));
    await run
      .waitForFunction(() => window.game?.galactic && game.lastResult?.vesselBattle && game.galaxy?.vessels?.open === null, null, {
        timeout: 45000
      })
      .catch(async e => {
        console.error(
          'Return state',
          await run.evaluate(() => ({
            galactic: game?.galactic,
            mode: game?.setup?.mode,
            open: game?.galaxy?.vessels?.open,
            restoreOpen: game?.setup?.restore?.vessels?.open,
            result: game?.setup?.result?.vesselBattle,
            last: game?.lastResult?.vesselBattle,
            tracked: game?.galaxy?.fleets.flatMap(f => f.units.filter(u => u.vessel).map(u => [f.planet, u.type.name, u.vessel.id])),
            message: document.body.innerText.slice(-500)
          }))
        );
        throw e;
      });
    const saved = await run.evaluate(async ({ a, b, hull }) => {
      game.paused = true;
      const g = game.galaxy,
        { stepFleets } = await import('/js/game/fleets.js'),
        { transferFleetUnits } = await import('/js/game/fleetmanagement.js');
      let f = g.fleets.find(f => f.units.some(u => u.vessel?.id === a));
      if (f.leg) stepFleets(g, 1e7);
      if (f.leg || !f.units.some(u => u.type.name === 'Calamari_Cruiser' && !u.vessel)) throw Error('return lost one of the twins');
      const u = f.units.find(u => u.vessel?.id === a);
      if (!(u.vessel.condition?.hull < 1)) throw Error('damage missing after result');
      const slot = [0, 1, 2].find(s => !g.fleets.some(x => x.planet === f.planet && x.owner === f.owner && x.slot === s));
      if (!transferFleetUnits(g, f, 'Rebel', slot, [u])) throw Error('split refused');
      const { putSave, snapshot } = await import('/js/game/savegame.js');
      const save = await putSave(snapshot(game, 'Disposable split fleet'));
      sessionStorage.setItem('swr-load', save);
      setTimeout(() => location.reload(), 0);
      return save;
    }, ids);
    await run.waitForFunction(
      () => window.game?.galactic && game.setup?.restore?.vessels && !game.lastResult && game.renderer?.domElement?.width > 0,
      null,
      { timeout: 90000 }
    );
    console.log('Galactic OPFS reload');
    const next = await enter(false);
    assert.notEqual(next, nonce);
    await ready(next);
    await run.waitForFunction(() => !document.body.classList.contains('cinematic') && !game.tacticalCinematics?.on, null, {
      timeout: 45000
    });
    await run.evaluate(() => {
      game.paused = true;
      game.ui.bar.bReinforce.click();
      game.ui.bar.refreshReinforce();
    });
    const named = f.locator('#reinforceWin .flagship-reserve'),
      normal = f.locator('#reinforceWin .rslot:not(.flagship-reserve)');
    assert.match(await named.getAttribute('aria-label'), /Flagship Valiant · 92% hull · 1 damaged hardpoint/);
    assert.equal(await normal.count(), 1);
    await named.press('Enter');
    await run.evaluate(() => {
      if (!game.ui.placing?.vessels[0]) throw Error('Card lost its ID');
      game.ui.cancelPlacing();
    });
    const call = async card => {
      await card.click();
      await run.evaluate(() => {
        const ui = game.ui,
          pl = ui.placing;
        if (!pl) throw Error('Card did not arm placement');
        for (let y = 80; y < ui.r.height - 120; y += 30)
          for (let x = 64; x < ui.r.width - 80; x += 50) {
            ui.mouse.x = x;
            ui.mouse.y = y;
            ui.updatePlacing();
            if (pl.ok) {
              ui.finishPlacing(x, y);
              ui.bar.refreshReinforce();
              return;
            }
          }
        throw Error('No legal screen placement');
      });
    };
    await call(named);
    assert.equal(await named.count(), 0);
    await call(normal);
    const after = await run.evaluate(({ a, b, part }) => {
      game.paused = true;
      const ents = [...game.campaignBook.entity.values()],
        damaged = ents.find(e => e.vesselId === a),
        other = ents.find(e => e.type?.name === 'Calamari_Cruiser' && !e.vesselId);
      return { damaged: damaged?.health, other: other?.health, hp: damaged?.hardpoints.find(h => h.def.name === part)?.health };
    }, ids);
    assert.deepEqual(after, { damaged: ids.hull, other: ids.other, hp: ids.hp });
    console.log('PASS: rendered second battle, selected exact reserves', after);
    // Independent repair branch from the same disposable split-fleet save.
    const loadGalaxy = async id => {
      await run.evaluate(async id => {
        const { getSave } = await import('/js/game/savegame.js'),
          { loadSaved } = await import('/js/game/transit.js');
        const s = await getSave(id);
        if (s?.mode !== 'galactic') throw Error('Missing disposable galaxy save: ' + id);
        window.beforeFlagshipLoad = game;
        setTimeout(() => loadSaved(id), 0);
      }, id);
      await run.waitForFunction(
        () => !!(window.game?.galactic && game !== window.beforeFlagshipLoad && game.galaxy?.vessels?.flagship && game.setup?.restore),
        null,
        { timeout: 65000 }
      );
    };
    await loadGalaxy(saved);
    console.log('Loaded repair branch');
    const before = await run.evaluate(async id => {
      const { deleteSave } = await import('/js/game/savegame.js');
      await deleteSave(id);
      game.paused = true;
      const g = game.galaxy,
        f = g.fleets.find(f => f.units.some(u => u.vessel));
      const p = g.planets.find(
        p => p.owner === g.active && p.spaceLevel >= 1 && p.station && (!p.stationOwner || p.stationOwner === g.active)
      );
      if (!p) throw Error('No friendly starbase');
      f.planet = p.index;
      f.leg = null;
      await game.galacticLog.show(0);
      return g.players.find(p => p.faction === g.active).credits;
    }, saved);
    const review = f.getByRole('button', { name: /^Review full repair/ });
    const price = +(await review.getAttribute('aria-label')).match(/(\d+) credits/)[1];
    assert(price > 0);
    console.log('Repair quote', { before, price });
    await review.click();
    await btn('Cancel').press('Enter');
    const credits = () => run.evaluate(() => game.galaxy.players.find(p => p.faction === 'Rebel').credits);
    assert.equal(await credits(), before);
    await review.press('Enter');
    await btn(`Confirm repair · ${price} credits`).click();
    assert.equal(await credits(), before - price);
    assert.equal(await review.count(), 0);
    const paidSave = await run.evaluate(async () => {
      game.galacticLog.close();
      const { snapshot, putSave } = await import('/js/game/savegame.js');
      const id = await putSave(snapshot(game, 'Disposable confirmed repair'));
      return id;
    });
    await loadGalaxy(paidSave);
    await run.waitForFunction(
      id =>
        window.game?.galactic &&
        game.setup?.restore &&
        game.galaxy.fleets.some(f => f.units.some(u => u.vessel?.id === id && !u.vessel.condition)),
      flagId
    );
    assert.equal(await credits(), before - price);
    await run.evaluate(async id => {
      const { deleteSave } = await import('/js/game/savegame.js');
      await deleteSave(id);
    }, paidSave);
    console.log('PASS: cancelled quote unchanged; confirmed once and reloaded', { before, price, after: before - price });
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
