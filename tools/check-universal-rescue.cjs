// Native launches and a disposable save. Battle locations/forces are staged; the
// battle resolver, casualty callbacks, invasion result, and load are the game's.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8870),
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
      host.stderr.on('data', b => process.stderr.write(b));
      host.once('exit', () => no(Error('Disposable port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (const alternate of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(90000);
      page.on('pageerror', e => console.error('Page error', e));
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const b = f.locator('.uc-atlas');
      await b.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
      console.log('Opened', await b.getAttribute('data-campaign'));
      await b.getByRole('button', { name: /Equal Footing/ }).click();
      await b.getByRole('tab', { name: 'Faction', exact: true }).click();
      await b.locator('[data-field="faction"] input[value="Rebel"]').check();
      await b.getByRole('tab', { name: 'Settings', exact: true }).click();
      const t = b.locator('[data-field="transport"]');
      assert.equal(await t.inputValue(), '');
      if (alternate) {
        await t.selectOption('0.75');
        await b.locator('[data-field="path"] input[value="rescue"]').check();
      }
      await b.locator('.uc-start').click();
      const plate = page.locator('.battle-plate');
      await plate.waitFor();
      await plate.waitFor({ state: 'hidden' });
      let run = page.frames().find(x => x.parentFrame() === page.mainFrame());
      await run.waitForFunction(
        () => window.game?.story && game.galaxy?.campaign.name === 'Sandbox_Equal_Footing_Rebel' && game.renderer.domElement.width > 0
      );
      const result = await run.evaluate(async alternate => {
        const g = game.galaxy,
          { db } = await import('/js/gamedata.js');
        game.paused = true;
        const owner = g.active;
        const planet =
          g.planets.find(p => p.owner === 'Rebel' && !p.station && !g.fleets.some(f => f.planet === p.index)) ||
          g.planets.find(p => p.owner === owner);
        const add = (type, n) => Array.from({ length: n }, () => ({ type: db.type(type) })),
          company = db.type('Rebel_Infantry_Squad'),
          troops = Array.from({ length: 4 }, () => ({ type: db.type(company.list('Company_Transport_Unit')[0]), carries: company }));
        const fleet = (faction, units) => {
          const f = { owner: faction, units, planet: planet.index, path: [], dest: -1, leg: null, pos: null };
          g.fleets.push(f);
          return f;
        };
        // Isolate the space engagement at this planet. Different fleets elsewhere are untouched.
        g.fleets = g.fleets.filter(f => f.planet !== planet.index);
        planet.station = null;
        planet.spaceLevel = 0;
        const human = fleet(owner, [...add('Corellian_Corvette', 1), ...troops]);
        fleet('Empire', add('Star_Destroyer', 12));
        const row = game.battles.space(planet.index, owner, 'Empire');
        const survived = human.units.filter(u => troops.includes(u)).length;
        if (!alternate) return { winner: row.winner, survived, rule: g.universalRules?.transportLosses ?? null };
        // Stage the approved team against a superior enemy fleet. No story death,
        // callback, capture flag or battle outcome is manually injected.
        const han = db.type('Han_Solo_Team'),
          isHan = u => (u.carries || u.type) === han;
        let rec;
        for (const f of g.fleets) {
          rec ||= f.units.find(isHan);
          f.units = f.units.filter(u => !isHan(u));
        }
        for (const p of g.planets) {
          rec ||= p.garrison.find(isHan);
          p.garrison = p.garrison.filter(u => !isHan(u));
        }
        const nativeHero = !!rec;
        if (!nativeHero) throw Error('Expected the authored Han Solo team');
        rec.type = db.type(han.list('Company_Transport_Unit')[0]);
        rec.carries = han;
        rec.dead = false;
        const enemy = g.fleets.find(f => f.planet === planet.index && f.owner === 'Empire');
        if (!enemy) throw Error('Missing surviving fleet');
        const first = fleet(owner, [rec]);
        game.battles.space(planet.index, owner, 'Empire');
        const captive = g.universalRules?.rescue;
        if (captive?.state !== 'captive')
          throw Error(
            'Expected captive: ' +
              JSON.stringify({
                captive,
                nativeHero,
                fallen: !first.units.includes(rec),
                planets: g.planets
                  .filter(p => p.owner === 'Empire')
                  .map(p => [p.name, p.restricted, p.invasionEnabled, g.visibility?.planets?.[p.index]?.discovered])
              })
          );
        const { snapshot, putSave, getSave } = await import('/js/game/savegame.js'),
          id = await putSave(snapshot(game, 'Universal disposable captive'));
        if ((await getSave(id)).galaxy.universalRules.rescue.prison !== captive.prison) throw Error('save did not contain prison');
        sessionStorage.setItem('swr-load', id);
        return { winner: row.winner, survived, rule: g.universalRules.transportLosses, prison: captive.prison, nativeHero, id };
      }, alternate);
      console.log('Battle', result);
      assert.equal(result.winner, 'defender');
      assert.equal(result.survived, alternate ? 1 : 3);
      assert.equal(result.rule, alternate ? 0.75 : null);
      if (alternate) assert.equal(result.nativeHero, true);
      if (alternate) {
        await run.evaluate(() => setTimeout(() => location.reload(), 0));
        await run.waitForFunction(() => window.game?.setup?.restore && game.galaxy?.universalRules?.rescue?.state === 'captive');
        const released = await run.evaluate(async ({ prison, id }) => {
          const g = game.galaxy;
          game.paused = true;
          const { db } = await import('/js/gamedata.js'),
            { ownedTypes } = await import('/js/game/galacticproduction.js'),
            { stepHeroRespawns } = await import('/js/game/galacticherorespawn.js');
          const count = () => ownedTypes(g, g.active).filter(t => t.name === 'Han_Solo_Team').length;
          const before = count();
          if (g.planets.some(p => p.killedHeroes?.some(e => e.type === 'Han_Solo_Team' && e.owner === g.active)))
            throw Error('Captive has a normal respawn timer');
          stepHeroRespawns(game);
          const held = count();
          const p = g.planets.find(p => p.name === prison),
            old = p.owner,
            company = db.type('Rebel_Infantry_Squad'),
            transport = db.type(company.list('Company_Transport_Unit')[0]);
          g.fleets = g.fleets.filter(f => f.planet !== p.index);
          p.station = null;
          p.spaceLevel = 0;
          p.garrison = [];
          p.groundStructures = [];
          p.groundLevel = 0;
          const records = Array.from({ length: 12 }, () => ({ type: transport, carries: company }));
          g.fleets.push({ planet: p.index, owner: g.active, units: records, path: [], dest: -1, leg: null, pos: null });
          const battle = game.battles.invade(p.index, g.active, old, records, true);
          stepHeroRespawns(game);
          stepHeroRespawns(game);
          const after = count();
          const { deleteSave } = await import('/js/game/savegame.js');
          await deleteSave(id);
          return {
            before,
            held,
            after,
            winner: battle?.winner,
            owner: p.owner,
            state: g.universalRules.rescue.state,
            rule: g.universalRules.transportLosses
          };
        }, result);
        console.log('Release', released);
        assert.deepEqual(released, { before: 0, held: 0, after: 1, winner: 'attacker', owner: 'Rebel', state: 'complete', rule: 0.75 });
      }
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
