// The summary and starts in a real three-team battle must agree; selecting a
// two-team TED may block Start, but must never merge teams or switch the map.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      board = f.locator('.op-setup'),
      tabs = name => board.getByRole('tab', { name, exact: true });
    await f.locator('[data-id="TITLE_PLAY"]').click({ timeout: 90000 });
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').click();
    await board.locator('[data-planet-group]').first().waitFor({ timeout: 120000 });
    assert(await board.locator('.op-go').isDisabled());
    const map = board.locator('.uc-map');
    await map.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await board.locator('.op-planet-names[data-labels]:not([data-labels="0"])').waitFor();
    const search = board.getByRole('searchbox', { name: 'Search battlefields' });
    await search.fill('Kuat Forces of Corruption');
    await board.locator('[data-file="_MP_SPACE_KUAT.TED"]').click();
    const summary = board.locator('.op-battle-summary');
    await summary.locator('canvas').waitFor();
    assert.equal(await summary.locator('.op-person').count(), 2);
    await tabs('Teams').click();
    await board.getByRole('button', { name: 'Add ally' }).click();
    await board.getByLabel('Ally 1 color').fill('#fb812e');
    await board.getByRole('combobox', { name: 'Ally 1 difficulty' }).selectOption('hard');
    await board.locator('[data-seat="2"]').dragTo(board.locator('.op-team-create'));
    assert.equal(await board.locator('[data-seat]').count(), 3);
    assert(await board.locator('.op-go').isDisabled());
    assert.equal(await summary.locator('.op-icon-team').count(), 3);
    assert.match(await summary.innerText(), /Shipyards of Kuat/i);
    await tabs('Battlefield').click();
    await board.locator('[data-world="Kuat"][data-domain="land"][data-source="stock"]').first().click();
    await summary.getByText(/Kuat · Land/).waitFor();
    assert(await board.locator('.op-go').isDisabled());
    await tabs('Teams').click();
    assert.equal(await board.locator('[data-seat="2"]').evaluate(row => row.closest('[data-drop-team]').dataset.dropTeam), '2');
    await board.getByRole('button', { name: 'Move Opponent 2', exact: true }).press('Enter');
    await board.getByRole('button', { name: 'Move here · Team 1', exact: true }).press('Enter');
    assert.equal(await board.getByLabel('Ally 1 color').inputValue(), '#fb812e');
    assert(await board.locator('.op-go').isEnabled());
    assert.equal(await board.getByRole('combobox', { name: 'Ally 1 difficulty' }).inputValue(), 'hard');
    await board.locator('[data-seat="2"]').dragTo(board.locator('.op-team-create'));
    await tabs('Battlefield').click();
    await board.getByRole('button', { name: 'Choose generated space map' }).click();
    await summary.locator('canvas').waitFor();
    assert.equal(await summary.locator('.op-icon-team').count(), 3);
    await board.locator('.op-go').click();
    const fr = page.frames().find(fr => fr.url().includes('play.html'));
    await fr.waitForFunction(() => window.game?.world?.time > 0 && !!document.querySelector('#loading.hidden'), null, { timeout: 150000 });
    const live = await fr.evaluate(() => {
      const { world: w, setup: s } = window.game;
      return {
        file: s.mapFile,
        teams: s.players.map(x => x.team),
        color: s.players[2].color,
        stations: w.teams.map(t => !!t.station),
        units: w.players.map(p => w.units.filter(u => u.player === p && !u.dead).length)
      };
    });
    assert.match(live.file, /^@dynamic\//);
    assert.deepEqual(live.teams, [0, 1, 2]);
    assert.equal(live.color, '#fb812e');
    assert.deepEqual(live.stations, [true, true, true]);
    assert(live.units.every(n => n > 0));
    console.log('Skirmish footer, zoom names, exact-map guard, moved seats and live three-team start:', live);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
