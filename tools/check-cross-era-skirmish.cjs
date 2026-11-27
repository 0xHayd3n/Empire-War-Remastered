// Real cross-era match: two away factions on a third profile's authored TED.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['land', 'space', 'worker']) {
      const p = await b.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' }),
        f = p.frameLocator('#game'),
        board = f.locator('.op-setup');
      p.on('pageerror', e => console.error('page:', e.message));
      p.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource|Blocked autofocusing/.test(m.text())) console.error(m.text().slice(0, 500));
      });
      await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
      for(const id of ['TITLE_PLAY','IDC_MAIN_MENU_SINGLE_PLAYER_GAMES','IDC_SKIRMISH_GAMES_BUTTON'])
        await f.locator(`[data-id="${id}"]`).click({timeout:90000});
      await board.locator('[data-planet-group]').first().waitFor({ timeout: 120000 });
      await board
        .getByRole('searchbox', { name: 'Search battlefields' })
        .fill(mode === 'worker' ? 'Kuat Forces of Corruption' : 'Abregado');
      const leaf = board
        .locator(
          mode === 'worker'
            ? '[data-source="stock"][data-file="_MP_SPACE_KUAT.TED"]'
            : `[data-world="Abregado_Rae"][data-domain="${mode}"][data-source="stock"]`
        )
        .first();
      await leaf.waitFor();
      const file = await leaf.getAttribute('data-file');
      await leaf.click();
      await board.getByRole('tab', { name: 'Teams' }).click();
      if (mode === 'land') {
        await board.locator('[data-choose-seat="1"]').click();
        await board.locator('.op-command-stage input').fill('Fenn Shysa Fall');
        await board.locator('[data-source="1976399102"][data-faction="Mandalorians"]').click();
        assert(await board.locator('.op-go').isDisabled(), 'Space-only detachment must not be substituted on land');
        assert.match(await board.locator('.op-status').textContent(), /no available land detachment/);
      }
      for (const [i, id, fac] of [
        [0, '3417277973', 'Rebel'],
        [1, '1976399102', 'Trade_Federation']
      ]) {
        await board.locator(`[data-choose-seat="${i}"]`).click();
        await board.locator('.op-command-stage input').fill(i === 0 ? 'Darth Revan' : 'Nute Gunray');
        await board.locator(`[data-source="${id}"][data-faction="${fac}"]`).click();
      }
      assert(await board.locator('.op-go').isEnabled());
      assert.equal(await board.getAttribute('data-profile'), 'stock');
      await board.locator('.op-go').click();
      const fr = p.frames().find(fr => fr.url().includes('play.html'));
      await fr.waitForFunction(() => window.game?.world?.time > 0 && document.querySelector('#loading.hidden'), null, { timeout: 120000 });
      if (mode === 'space') await fr.waitForFunction(() => window.game.world.players[1].everBought?.size > 0, null, { timeout: 45000 });
      const live = await fr.evaluate(async () => {
        const g = window.game,
          w = g.world,
          { snapshotNow } = await import('/js/game/savegame.js'),
          s = await snapshotNow(g, 'Cross-era check'),
          result = [];
        for (let i = 0; i < 2; i++) {
          let list, units, buildable;
          if (g.landBattle) {
            const bases = w.units.filter(u => u.structure && u.side === i);
            list = bases.flatMap(u => w.productionFor(u, i));
            units = w.units.filter(u => !u.structure && u.side === i && !u.dead);
            buildable = list.some(t => bases.some(u => !w.cantBuy(u, t, i) && !w.buy(u, t, i)));
          } else {
            const p = w.players[i],
              builder = w.teams[i].station;
            list = w.buildOptions(builder, p);
            units = w.units.filter(u => u.player === p && !u.dead && !u.isStation);
            // The bot may already have spent its credits on this very roster.
            buildable =
              (!p.human && list.some(t => p.everBought?.get(t) > 0)) ||
              list.some(t => !w.cantBuild(builder, t, p) && !w.startBuild(builder, t, p));
          }
          result.push({
            names: units
              .map(u => u.type.sourceUnit)
              .filter(Boolean)
              .slice(0, 5),
            offers: list
              .map(t => t.sourceUnit)
              .filter(Boolean)
              .slice(0, 5),
            buildable,
            armed: units.some(u => u.weapon || u.weapons?.length || u.hardpoints?.some(h => h.isWeapon)),
            models: units
              .filter(u => u.inst?.model || u.model?.model)
              .map(u => u.type.str(g.landBattle ? 'Land_Model_Name' : 'Space_Model_Name'))
              .filter(s => s.startsWith('UXA'))
              .slice(0, 1)
          });
        }
        const { factionColor } = await import('/js/gamedata.js');
        return { file: g.setup.mapFile, refs: s.setup.skirmishRosters.map(r => [r.profile, r.faction]), result,
          native: factionColor('Rebel'), guest: g.setup.teamFactions.map(factionColor), paint: s.setup.players.map(p=>p.color),
          rendered: (g.landBattle?w.colors:w.players.map(p=>p.color)).slice(0,2).map(c=>'#'+c.getHexString()) };
      });
      console.log(mode, JSON.stringify(live));
      assert.equal(live.file, file);
      assert.equal(live.native,'#ee5056','stock Rebel is crimson even with two guest seats');
      for(const shades of [live.guest,live.paint,live.rendered]) assert.deepEqual(shades,['#9d69d8','#4977af']);
      assert.deepEqual(live.refs, [
        ['3417277973', 'Rebel'],
        ['1976399102', 'Trade_Federation']
      ]);
      assert(live.result.every(s => s.names.length && s.offers.length && s.buildable && s.armed && s.models.length));
      if (mode === 'space') {
        const id = await fr.evaluate(async () => {
          const { putSave, snapshotNow } = await import('/js/game/savegame.js');
          return putSave(await snapshotNow(window.game, 'Cross-era restore'));
        });
        await fr.evaluate(async id => (await import('/js/game/transit.js')).loadSaved(id), id);
        await fr.waitForFunction(
          () =>
            window.game?.setup?.restore?.name === 'Cross-era restore' &&
            window.game.world?.units.some(u => u.type?.sourceUnit) &&
            document.querySelector('#loading.hidden'),
          null,
          { timeout: 120000 }
        );
        assert.deepEqual(await fr.evaluate(()=>window.game.world.players.slice(0,2).map(p=>'#'+p.color.getHexString())),live.paint);
        console.log('Bot bought units independently; saved authored battlefield, shades and donor units restored.');
      }
      if (mode === 'worker') assert(await fr.evaluate(() => !!window.game.mirror), 'stock MP map must run the authoritative worker');
      await p.close();
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
