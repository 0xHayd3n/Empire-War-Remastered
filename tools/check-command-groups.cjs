// Exercise collections on the Universal route. A collection isn't a combined
// army: within the same filter, each step still has its own name, seal and seat.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1250, height: 800 }, reducedMotion: 'reduce' });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    const board = f.locator('[data-universal-screen="skirmish"]');
    await board.getByRole('tab', { name: 'Teams' }).click();
    const seat = board.locator('[data-choose-seat="0"]');
    await seat.click();
    await board.locator('.op-command-stage[data-ready="true"]').waitFor();
    const before = await seat.getAttribute('aria-label');
    const stage = board.locator('.op-command-stage'),
      search = stage.getByRole('searchbox'),
      apply = stage.locator('.op-ring-assign'),
      header = stage.locator('.op-family-current'),
      group = stage.locator('.op-group-link');
    await require('./check-faction-directory.cjs')(page, board, stage);
    await search.fill('Trade Federation');
    const memberSeal = await header.locator('img').getAttribute('src');
    assert.equal(await group.innerText(), 'Separatist coalition');
    await group.click();
    assert.equal(await search.inputValue(), 'Separatist coalition');
    assert.equal(await stage.getAttribute('data-total'), '7');
    assert.equal(await header.locator('img').getAttribute('src'), memberSeal);
    await stage.getByRole('button', { name: 'Next commander', exact: true }).click();
    assert.notEqual(await header.locator('strong').innerText(), 'Trade Federation');
    assert.notEqual(await header.locator('img').getAttribute('src'), memberSeal);
    await group.click();
    assert.equal(await search.inputValue(), 'Trade Federation');
    assert.equal(await apply.getAttribute('data-faction'), 'Trade_Federation');
    const cases = [
      ['Corporate Alliance', 7, 'Separatist coalition'],
      ['Underworld & syndicates', 15, 'Underworld & syndicates'],
      ['Imperial remnants', 13, 'Empire & Imperial offshoots'],
      ['Sith traditions', 3, 'Sith traditions'],
      ['Republic & Rebellion', 10, 'Republic & Rebellion'],
      ['Regional powers', 15, 'Regional powers'],
      ['Unknown Regions powers', 3, 'Unknown Regions powers'],
      ['Invasion forces', 2, 'Invasion forces'],
      ['Local forces & warlords', 7, 'Local forces & warlords']
    ];
    await search.fill('');
    const total = Number(await stage.getAttribute('data-total')),
      all = new Map(), shades = new Set();
    for (const [q, n, g] of cases) {
      await search.fill(q);
      assert.equal(+(await stage.getAttribute('data-total')), n, q);
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        assert.equal(await group.innerText(), g);
        seen.add((await apply.getAttribute('data-source')) + '/' + (await apply.getAttribute('data-faction')));
        const shade = await group.evaluate(el => el.style.getPropertyValue('--roster-shade'));
        assert.match(shade, /^#[a-f0-9]{6}$/);
        assert(!shades.has(shade), 'Two source rosters have the same swatch: ' + shade);
        shades.add(shade);
        await stage.getByRole('button', { name: 'Next commander', exact: true }).click();
      }
      assert.equal(seen.size, n);
      for (const k of seen) {
        assert(!all.has(k), 'Seat appears in two collections: ' + k);
        all.set(k, g);
      }
    }
    assert.equal(all.size, total, 'All installed seats belong to a collection');
    for (const [key, g] of [
      ['1770851727/Hutts', 'Invasion forces'],
      ['1770851727/Pirates', 'Local forces & warlords'],
      ['3387971722/Warlords', 'Local forces & warlords'],
      ['1397421866/Warlords', 'Empire & Imperial offshoots'],
      ['1125571106/Corporate_Sector', 'Regional powers'],
      ['1125571106/Chiss', 'Unknown Regions powers']
    ])
      assert.equal(all.get(key), g, key);
    for (const [q, g] of [
      ['Corporate Sector Authority', 'Regional powers'],
      ['Chiss Ascendancy', 'Unknown Regions powers'],
      ['Independent Forces', 'Local forces & warlords']
    ]) {
      await search.fill(q);
      assert.equal(await group.innerText(), g);
      await group.click();
      assert.equal(await search.inputValue(), g);
      await group.click();
      assert.equal(await search.inputValue(), q);
    }
    await search.fill('Commerce Guild');
    assert.equal(await seat.getAttribute('aria-label'), before);
    await group.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await board.locator('.op-command-stage[data-ready="true"]').waitFor();
    if (process.env.SHOTS)
      await stage.screenshot({ path: require('node:path').join(process.env.SHOTS, 'separatist-coalition-mobile.png') });
    assert.equal(await apply.getAttribute('data-source'), '1976399102');
    assert.equal(await apply.getAttribute('data-faction'), 'Commerce_Guild');
    await apply.click();
    assert.match(await seat.innerText(), /Commerce Guild/);
    assert.equal(await board.getByLabel('You color', {exact:true}).inputValue(), '#78acef');
    await require('./check-command-warlords.cjs')(page, board, seat);
    console.log(
      'Verified all installed commander seats occur exactly once across nine groups, group drill-in/restore, member seals, and exact mobile assignment.'
    );
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
