// A real stage, not just catalog metadata: verify the scoped model is drawn,
// animates in-place, holds its pose under reduced motion, and leaves the exact field alone.
// The directory is one exact roster per profile/faction key; picking one previews
// that member inside its family ring and never assigns a seat.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1366, height: 850 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      board = f.locator('[data-universal-screen="skirmish"]');
    await f.locator('[data-id="TITLE_PLAY"]').click({ timeout: 90000 });
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').click();
    await board.getByRole('searchbox', { name: 'Search battlefields' }).fill('Abregado Forces of Corruption Land');
    await board.locator('[data-world="Abregado_Rae"][data-domain="land"][data-source="stock"]').click();
    await board.locator('.op-go:enabled').waitFor();
    const before = await board.locator('.op-battle-summary').innerText();
    await board.getByRole('tab', { name: 'Teams' }).click();
    const opened = Date.now();
    await board.locator('[data-choose-seat="1"]').click();
    const stage = board.locator('.op-command-stage'),
      ready = board.locator('.op-command-stage[data-ready="true"]');
    await ready.waitFor();
    const firstMs = Date.now() - opened;
    assert(+(await stage.getAttribute('data-total')) >= 5);
    assert.equal(await stage.locator('canvas').count(), 1);
    assert.equal(await stage.locator('.op-stage-still,.op-stage-card,.op-stage-pages').count(), 0);
    const current = await stage.getAttribute('data-index'),
      seatButton = board.locator('[data-choose-seat="1"]'),
      seatCard = board.locator('.op-seat-card[data-seat="1"]'),
      initialSeat = await seatButton.getAttribute('aria-label'),
      initialRoster = await seatCard.getAttribute('data-roster');
    await stage.getByRole('button', { name: 'Next commander', exact: true }).click();
    await stage.getByRole('button', { name: 'Previous commander', exact: true }).click();
    assert.equal(await stage.getAttribute('data-index'), current);
    assert.equal(await seatButton.getAttribute('aria-label'), initialSeat);
    assert.equal(await stage.getByRole('combobox').count(), 0);
    const family = stage.locator('.op-family-current'),
      familyTitle = async () => (await family.locator('strong').innerText()).trim(),
      toggle = stage.locator('.op-faction-toggle'),
      browser = f.locator('.op-faction-browser'),
      searchBox = stage.getByRole('searchbox'),
      assign = stage.locator('.op-ring-assign'),
      identity = async () =>
        [await assign.getAttribute('data-source'), await assign.getAttribute('data-faction')].join('/'),
      familyOf = key => key.slice(key.indexOf('/') + 1);
    // The icon, not the ring, opens the stage-local directory.
    assert.equal(await toggle.locator('.op-directory-icon').count(), 1);
    // Baseline for the same query while the ring is not scoped to a family.
    await searchBox.fill('Galactic Republic');
    const republicTotal = +(await stage.getAttribute('data-total'));
    assert(republicTotal >= 2);
    await searchBox.fill('');
    const currentFamily = await familyTitle();
    // The header names the family and carries exactly one still crest.
    assert.equal(await family.locator('.uc-crest').count(), 1);
    assert.equal(await stage.locator('.op-faction-rail .uc-crest').count(), 1);
    // Expected exact roster keys and the family grouping each key sits in.
    const expected = await stage.evaluate(async () => {
      const { profiles } = await (await import('/js/game/solooperationlibrary.js')).soloLibrary(),
        { commandGroup } = await import('/js/game/commandgroups.js'),
        roster = new Set(),
        sections = new Set();
      for (const p of profiles)
        for (const id of p.skirmishFactions) {
          const c = p.commanders[id],
            group = commandGroup(p.id, id)?.name,
            heading = c.family === 'Warlords' ? c.displayFaction || p.facts[id]?.label || id : c.family;
          roster.add(p.id + '/' + id);
          sections.add(group ? group + '/' + heading : p.id + '/' + id);
        }
      return { roster: [...roster].sort(), sections: [...sections].sort() };
    });
    const rosterButtons = browser.locator('button[data-roster]'),
      openDirectory = async () => {
        if (!(await browser.isVisible())) await toggle.click();
        await browser.waitFor();
        return rosterButtons.evaluateAll(bs => bs.map(b => b.dataset.roster));
      },
      pickRoster = async key => {
        if (!(await browser.isVisible())) await toggle.click();
        await browser.waitFor();
        await browser.locator(`button[data-roster="${key}"]`).click();
        // Picking may dismiss the directory; close it if the design keeps it open.
        if (await browser.isVisible()) await toggle.click();
        await browser.waitFor({ state: 'hidden' });
      };
    const listed = await openDirectory();
    assert.deepEqual([...listed].sort(), expected.roster, 'every exact roster is in the DOM, not one per section');
    assert.equal(new Set(listed).size, listed.length, 'one button per profile/faction key');
    const sections = (await rosterButtons.evaluateAll(bs => bs.map(b => b.dataset.section))).filter(
      (s, i, a) => a.indexOf(s) === i
    );
    assert.deepEqual([...sections].sort(), expected.sections, 'each roster button carries its family grouping key');
    assert(listed.length > sections.length, 'sections group rosters instead of replacing them');
    assert.equal(await rosterButtons.locator('img.op-card-still').count(), listed.length);
    assert((await rosterButtons.locator('img.op-card-still:not([src])').count()) > 0, 'offscreen bodies are not all baked at once');
    const layout = await rosterButtons.evaluateAll(bs => {
      const by = new Map();
      for (const b of bs) {
        const list = by.get(b.dataset.section) || [];
        list.push(b.dataset.roster);
        by.set(b.dataset.section, list);
      }
      return [...by].map(([section, roster]) => ({ section, roster: roster.sort() }));
    });
    // Two exact members in one family ring: each pick previews itself, and the
    // ring stays scoped to that family's roster count.
    const multi = layout.find(s => s.roster.length > 1);
    assert(multi, 'a family groups more than one exact roster');
    await pickRoster(multi.roster[0]);
    assert.equal(await familyTitle(), familyOf(multi.section));
    assert.equal(+(await stage.getAttribute('data-total')), multi.roster.length);
    assert.equal(await identity(), multi.roster[0], 'the exact member is previewed before any turn');
    await pickRoster(multi.roster[1]);
    assert.equal(await familyTitle(), familyOf(multi.section));
    assert.equal(await identity(), multi.roster[1], 'another exact member of the same family ring');
    const original = layout.find(s => familyOf(s.section) === currentFamily);
    assert(original, 'the header family is one directory section');
    const target =
      layout.find(s => s.section !== original.section && !/galactic republic/i.test(s.section)) ||
      layout.find(s => s.section !== original.section);
    assert(target);
    const targetFamily = familyOf(target.section);
    await pickRoster(target.roster[0]);
    assert.equal(await familyTitle(), targetFamily);
    assert.equal(await identity(), target.roster[0], 'the picked roster, not a neighbouring section, is focused');
    assert.equal(await family.locator('.uc-crest').count(), 1);
    assert.equal(await stage.locator('.op-faction-rail .uc-crest').count(), 1);
    assert.deepEqual([...(await openDirectory())].sort(), expected.roster, 'every roster is offered on each opening');
    // Directory picks are previews: the seat and its roster stay untouched.
    assert.equal(await seatButton.getAttribute('aria-label'), initialSeat);
    assert.equal(await seatCard.getAttribute('data-roster'), initialRoster);
    await pickRoster(original.roster[0]);
    assert.equal(await familyTitle(), currentFamily, 'return to the first family');
    assert.equal(await identity(), original.roster[0]);
    await pickRoster(target.roster[0]);
    assert.equal(await familyTitle(), targetFamily);
    await searchBox.fill('Galactic Republic');
    const len = +(await stage.getAttribute('data-total')),
      startIndex = await stage.getAttribute('data-index');
    assert(len >= 2);
    assert.equal(len, republicTotal, 'typing in the main search clears the family scope');
    assert.notEqual(await familyTitle(), targetFamily);
    for (let i = 0; i < len; i++) await stage.getByRole('button', { name: 'Next commander', exact: true }).click();
    assert.equal(await stage.getAttribute('data-index'), startIndex, 'one continuous wrap, no pages');
    await stage.getByRole('searchbox').fill('');
    await stage.getByRole('searchbox').fill('Emperor Palpatine Forces of Corruption');
    const model = stage.locator('canvas');
    await board.locator('.op-command-stage[data-model="EI_PALPATINE.ALO"][data-ready="true"]').waitFor();
    assert(+(await stage.getAttribute('data-bound')) > 4);
    assert(await stage.getAttribute('data-focus-action'));
    await stage.locator('.op-ring-layer.is-on .op-ring-photo.is-ready').waitFor();
    const a = await model.screenshot();
    await page.waitForTimeout(500);
    const c = await model.screenshot();
    assert(!a.equals(c), 'idle frames change');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Wait for the actual held paint (a loaded CPU/GPU can deliver the media
    // event later than a fixed wall-clock delay).
    await board.locator('.op-command-stage[data-ready="true"][data-motion="held"]').waitFor();
    const d = await model.screenshot();
    await page.waitForTimeout(450);
    assert(d.equals(await model.screenshot()), 'reduce motion holds the rendered pose');
    const search = stage.getByRole('searchbox');
    await search.fill('Nute Gunray');
    await board.locator('.op-command-stage[data-model="NUTE_GUNRAY.ALO"][data-ready="true"]').waitFor();
    assert.equal(await assign.getAttribute('data-faction'), 'Trade_Federation');
    await stage.locator('.op-ring-layer.is-on[data-land="naboo"] .op-ring-photo.is-ready').waitFor();
    await search.fill('Wat Tambor');
    await stage.locator('.op-ring-layer.is-on[data-land="mustafar"] .op-ring-photo.is-ready').waitFor();
    await search.fill('Mon Mothma Forces of Corruption');
    await ready.waitFor();
    assert.equal(await assign.getAttribute('data-faction'), 'Rebel');
    console.log('First real focused infantry frame (ms):', firstMs);
    await page.keyboard.press('Escape');
    assert.equal(await board.locator('.op-battle-summary').innerText(), before);
    assert.equal(await board.locator('.op-command-stage canvas').count(), 0);
    assert(await seatButton.evaluate(b => b === document.activeElement));
    await board.getByRole('button', { name: 'Add ally' }).click();
    await board.getByLabel('Ally 1 color').fill('#ff4fd8');
    const origin = board.locator('[data-lift-seat="2"]'),
      targetDrop = board.locator('.op-team-create');
    const start = await origin.boundingBox(),
      end = await targetDrop.boundingBox();
    const session = await page.context().newCDPSession(page);
    const x = start.x + start.width / 2,
      y = start.y + start.height / 2,
      tx = end.x + end.width / 2,
      ty = end.y + end.height / 2;
    for (const [type, pts] of [
      ['touchStart', [{ x, y }]],
      ['touchMove', [{ x: x + 6, y: y + 12 }]],
      ['touchMove', [{ x: tx, y: ty }]],
      ['touchEnd', []]
    ])
      await session.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    assert.equal(await board.locator('[data-seat="2"]').evaluate(r => r.closest('[data-drop-team]').dataset.dropTeam), '2');
    assert.equal(await board.getByLabel('Opponent 2 color').inputValue(), '#ff4fd8');
    assert.equal(await board.locator('[data-seat]').count(), 3);
    assert(await board.locator('.op-go').isDisabled());
    assert.deepEqual(errors, []);
    console.log('Verified exact-roster directory previews, animated model, reduced motion, cancel/focus, exact field and touch-drag to a new team.');
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
