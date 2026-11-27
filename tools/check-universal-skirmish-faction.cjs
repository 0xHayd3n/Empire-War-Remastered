// From the stock hub, pick a different pack's faction, then its actual battlefield.
// Requires a ready Thrawn pack. This exercises the team draft across profile navigation.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      board = f.locator('.op-setup');
    await f.locator('[data-id="TITLE_PLAY"]').click({ timeout: 90000 });
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').click();
    await board.locator('[data-planet-group]').first().waitFor({ timeout: 120000 });
    assert(await board.locator('.op-go').isDisabled());
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.getByRole('tab', { name: 'Settings' }).click();
    const credits = board.getByRole('spinbutton', { name: 'Starting credits' }),
      cap = board.getByRole('spinbutton', { name: 'Unit cap' });
    await credits.fill('1234567');
    await cap.fill('12345');
    assert.equal(await board.locator('.op-quantity img').count(), 2);
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.getByRole('button', { name: 'Add ally' }).click();
    await board.getByRole('button', { name: 'Add opponent' }).click();
    await board.getByRole('combobox', { name: 'Opponent 2 difficulty' }).selectOption('hard');
    await board.getByLabel('Ally 1 color').fill('#ff4fd8');
    await board.getByRole('button', { name: /^Ally 1 faction:/ }).click();
    await board.getByRole('searchbox', { name: 'Search faction, commander, era or mod' }).fill('Ardus Kaine');
    const remote = board.locator('[data-faction="Pentastar"][data-source="1125571106"]');
    // The former strategic leader is still searchable; the ring shows the
    // actual foot commander for precisely the same Pentastar roster.
    assert.equal(await remote.getAttribute('data-commander'), 'Jerec');
    await board.locator('.op-command-stage[data-model="JEREC.ALO"][data-ready="true"]').waitFor();
    await remote.click();
    assert(await board.locator('.op-go').isDisabled(), 'a seat choice must not choose a map');
    await board.getByRole('tab', { name: 'Battlefield' }).click();
    await board.getByRole('searchbox', { name: 'Search battlefields' }).fill('Kuat Space');
    const card = board.locator('[data-world="Kuat"][data-domain="space"][data-source="1125571106"]');
    await board.getByRole('tab', { name: 'Settings' }).click();
    await cap.fill('-1');
    await board.getByRole('tab', { name: 'Battlefield' }).click();
    await card.click();
    assert.equal(await board.getAttribute('data-profile'), 'stock');
    assert.equal(await cap.getAttribute('aria-invalid'), 'true');
    assert(await board.getByText('Players & options', { exact: true }).isDisabled());
    await cap.fill('12345');
    await board.getByRole('tab', { name: 'Battlefield' }).click();
    await card.click();
    await f.locator('.op-setup[data-profile="1125571106"] .op-go:enabled').waitFor({ timeout: 120000 });
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.getByRole('button', { name: /Ally 1 faction: Pentastar Alignment/ }).waitFor();
    await board.getByRole('tab', { name: 'Settings' }).click();
    assert.equal(await credits.inputValue(), '1234567');
    assert.equal(await cap.inputValue(), '12345');
    await board.getByRole('tab', { name: 'Teams' }).click();
    assert.equal(await board.getByRole('combobox', { name: 'Opponent 2 difficulty' }).inputValue(), 'hard');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      if (process.env.SHOTS) await page.screenshot({ path: require('node:path').join(process.env.SHOTS, `teams-${width}.png`) });
    }
    await board.locator('.op-go').click();
    const frame = page.frames().find(fr => fr.url().includes('play.html'));
    await frame.waitForFunction(() => window.game?.world?.teams?.[0]?.station && document.querySelector('#loading.hidden'), null, {
      timeout: 150000
    });
    const battle = await frame.evaluate(async () => {
      const { setup: s, world } = window.game;
      const { snapshotNow } = await import('/js/game/savegame.js');
      const saved = await snapshotNow(window.game, 'roster check');
      return {
        credits: s.credits,
        cap: s.popCap,
        capFixed: world.players[0].popCapFixed,
        savedCredits: saved.setup.credits,
        planet: s.planetBattle.id,
        map: s.mapFile,
        teams: s.players.map(p => p.team),
        factions: s.players.map((_, i) => world.players[i].factionName),
        allyRoster: world
          .buildOptions(world.teams[0].station, world.players[2])
          .slice(0, 4)
          .map(t => t.name),
        color: s.players[2].color,
        savedAlly: saved.setup.players[2].skirmishFaction || saved.setup.teamFactions[saved.setup.players[2].team],
        station: world.teams[0].station.type.name,
        affiliation: world.teams[0].station.type.list('Affiliation')
      };
    });
    assert.equal(battle.credits, 1234567);
    assert.equal(battle.savedCredits, 1234567);
    assert.equal(battle.cap, 12345);
    assert.equal(battle.capFixed, 12345);
    assert.equal(battle.planet, 'Kuat');
    assert.match(battle.map, /MOD_SPACE_KUAT/i);
    assert.equal(battle.factions[2], 'Pentastar');
    assert.equal(battle.savedAlly, 'Pentastar');
    assert.equal(battle.color, '#ff4fd8');
    assert.notEqual(battle.factions[0], battle.factions[2]);
    assert(battle.affiliation.includes(battle.factions[0]));
    assert(battle.allyRoster.length > 0);
    assert.deepEqual(battle.teams, [0, 1, 0, 1]);
    console.log('Verified owning mod, faction and four seats in the live battle:', battle);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
