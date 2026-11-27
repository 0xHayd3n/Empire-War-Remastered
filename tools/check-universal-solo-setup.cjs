// Drive the actual Universal window. Stock alone is supported; if installed,
// an Awakening story and a Thrawn field must retain their own faction/world.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = process.env.BASE_URL || 'http://127.0.0.1:8590/';
    await page.goto(base);
    const f = page.frameLocator('#game'),
      play = id => f.locator(`.title-menu [data-id="${id}"]`),
      board = f.locator('.op-setup');
    await play('TITLE_PLAY').click({ timeout: 90000 });
    await play('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES').click();
    for (const [id, mode] of [
      ['IDC_NEW_CAMPAIGN_BUTTON', 'story'],
      ['IDC_SKIRMISH_GAMES_BUTTON', 'skirmish'],
      ['IDC_INSTANT_BATTLE_BUTTON', 'instant']
    ]) {
      await play(id).click();
      await board
        .locator(mode === 'story' ? '[data-story]' : '[data-planet-group]')
        .first()
        .waitFor({ timeout: 120000 });
      assert.equal(await board.getAttribute('data-universal-screen'), mode);
      const heading = board.locator('.op-galaxy > .uc-map-heading');
      assert.equal(
        await heading.locator('h1').innerText(),
        { story: 'New Campaign', skirmish: 'Skirmish Battles', instant: 'Instant Battle' }[mode]
      );
      assert.equal(await board.locator('.op-rail h1,.op-head,.op-kicker,.op-foot .uc-map-back').count(), 0);
      if (mode !== 'story') assert.equal(await board.locator('.uc-era-card').count(), 0);
      assert.equal(await board.getByRole('combobox', { name: 'Game profile' }).count(), 0);
      if (mode === 'story') {
        assert(await board.getByRole('group', { name: 'Story era' }).count());
        assert(await board.getByRole('columnheader', { name: 'Planets' }).count());
        assert((await board.getByRole('tab', { name: 'Info' }).getAttribute('aria-selected')) === 'true');
        assert(await board.locator('.op-go').isDisabled());
        const clone = board.locator('[data-era="Clone Wars"]');
        if (await clone.count()) {
          await clone.click();
          assert.equal(await board.locator('[data-story][data-source="stock"]').count(), 0);
          assert(await board.locator('[data-story][aria-pressed="true"]').count());
          await board.getByRole('tab', { name: 'Info' }).click();
          assert(await board.getByText('Starting credits', { exact: true }).isVisible());
          const selectedCount = await board.locator('.op-campaign-table tr:has([aria-pressed="true"]) td:last-child').innerText();
          assert.equal(
            await board
              .locator('.op-brief-facts dt')
              .filter({ hasText: /^Planets$/ })
              .locator('+ dd')
              .innerText(),
            selectedCount
          );
          assert.equal(
            await board
              .locator('.op-description:visible')
              .filter({ hasText: /Planets:\s*\d/i })
              .count(),
            0
          );
          await board.getByRole('tab', { name: 'Faction' }).click();
          await board.locator('[data-era="Galactic Civil War"]').click();
        }
        await board.getByRole('tab', { name: /Faction/ }).click();
        assert.equal(await board.getByRole('radio', { checked: true }).count(), 0);
        const disabled = board.getByRole('radio', { disabled: true });
        assert((await disabled.count()) >= 4, 'Zann story displays the other four authored sides');
        assert.match(await disabled.first().getAttribute('value'), /^unavailable:/);
        assert(await board.getByText('Not selectable in this campaign', { exact: true }).first().isVisible());
        await disabled.first().evaluate(e => e.click());
        assert(await board.locator('.op-go').isDisabled());
        await board.getByRole('radio', { disabled: false }).first().check();
        assert(await board.locator('.op-go').isEnabled());
        const remote = board.locator('[data-story][data-source="1397421866"]').first();
        if (await remote.count()) {
          await remote.click();
          assert(await board.locator('.op-go').isDisabled());
          await board.getByRole('tab', { name: /Faction/ }).click();
          await board.getByRole('radio', { disabled: false }).nth(1).check();
        }
        await board.getByRole('tab', { name: 'Settings' }).click();
        await board.getByRole('radio', { name: 'Hard' }).check();
        assert.equal(await board.locator('.op-description:visible,.op-brief-facts:visible').count(), 0);
        await board.getByRole('tab', { name: 'Faction' }).click();
        assert.equal(await board.getByRole('radio', { checked: true }).count(), 1);
      } else {
        const search = board.getByRole('searchbox');
        {
          const markers = await board
            .locator('.uc-worlds [data-planet]')
            .evaluateAll(ns => ns.map(n => n.textContent.trim().toLocaleLowerCase()));
          assert(await board.locator('.op-go').isDisabled());
          assert.equal(await board.locator('.op-name,.op-selected,.op-field-leaf[aria-pressed="true"]').count(), 0);
          assert(!markers.some(n => /^loading |battleland dummy|^attack here \(|^\[uncharted\]$|^instant action$|^survival$/.test(n)));
          assert(markers.length && new Set(markers).size === markers.length, 'one chart marker per named planet, not per alias/mod/TED');
          const index = board.getByRole('table', { name: 'Planet battlefields' });
          const logicalRows = Number(await index.getAttribute('aria-rowcount'));
          assert((await index.locator('[data-planet-group]').count()) <= 100, 'only nearby rows mounted');
          await index.locator('[data-planet-group]').first().focus();
          await page.keyboard.press('End');
          assert.equal(await index.locator('button:focus').getAttribute('data-index'), String(logicalRows - 2));
          await page.keyboard.press('Home');
          assert.equal(await index.locator('button:focus').getAttribute('data-index'), '0');
          await page.keyboard.press('ArrowDown');
          assert(Number(await index.locator('button:focus').getAttribute('data-index')) > 0);
          const kuat = board.locator('.uc-worlds [data-planet="kuat"]');
          assert.equal(await kuat.count(), 1);
          await kuat.dispatchEvent('click');
          assert.equal(await search.inputValue(), 'Kuat');
          assert.deepEqual(await board.locator('[data-planet-group]').evaluateAll(ns => ns.map(n => n.dataset.planetGroup)), ['kuat']);
          assert(
            (await board.locator('.op-field-leaf[data-domain="land"]').count()) &&
              (await board.locator('.op-field-leaf[data-domain="space"]').count())
          );
          await search.fill('Kua');
          const found = await board.locator('[data-planet-group]').evaluateAll(bs => bs.map(b => b.dataset.planetGroup));
          assert(found.includes('kuat') && found.every(n => n.includes('kua')));
          await search.fill('Kuat');
          assert.deepEqual(await board.locator('[data-planet-group]').evaluateAll(bs => bs.map(b => b.dataset.planetGroup)), ['kuat']);
          assert.deepEqual(await board.locator('.op-domain-label:visible').allTextContents(), ['Land', 'Space']);
        }
        await search.fill('Kuat Forces of Corruption');
        await board.locator('[data-world="Kuat"][data-domain="land"]').click();
        const fieldTitle = board.locator(mode === 'skirmish' ? '.op-battle-summary' : '.op-instant-field');
        await fieldTitle.waitFor();
        assert.match(await fieldTitle.textContent(), /Kuat.*Land/i);
        await board.locator('.op-galaxy[data-routes="0"]').waitFor({ timeout: 45000 });
        assert.equal(await board.getByRole('button', { name: 'Land', exact: true }).count(), 0);
        await board.locator('[data-world="Kuat"][data-domain="space"]').first().click();
        if (mode === 'skirmish') {
          assert(await board.locator('.op-rail').getByRole('searchbox').count());
          await board.getByRole('tab', { name: 'Teams' }).click();
          const teamButton = board.getByRole('button', { name: /^You faction:/ });
          const popup = board.getByRole('region', { name: 'Commander staging' }),
            opponent = board.getByRole('combobox', { name: 'Opponent 1 difficulty' });
          for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            const before = await opponent.boundingBox();
            await teamButton.click();
            const rect = await popup.boundingBox();
            assert(await board.locator('.op-galaxy').isHidden());
            assert(rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.height > 250);
            if (width > 680) assert.deepEqual(await opponent.boundingBox(), before, 'stage replaces chart, not roster');
            await popup.getByRole('searchbox').fill('Galactic Republic');
            await board.locator('.op-command-stage[data-ready="true"]').waitFor({ timeout: 40000 });
            assert.equal(await popup.locator('canvas').count(), 1);
            await page.keyboard.press('ArrowDown');
            if (process.env.SHOTS)
              await page.screenshot({ path: require('node:path').join(process.env.SHOTS, `commander-stage-${width}.png`) });
            await page.keyboard.press('Escape');
            assert.equal(await popup.count(), 0);
            assert(await teamButton.evaluate(b => b === document.activeElement));
          }
          await teamButton.click();
          await board.getByRole('tab', { name: 'Settings' }).click();
          assert.equal(await popup.count(), 0);
          await board.getByRole('tab', { name: 'Teams' }).click();
          await teamButton.click();
          const catalog = popup;
          const beforePick = await teamButton.getAttribute('aria-label');
          await catalog.getByRole('searchbox').fill('Zann Consortium');
          assert.equal(await catalog.locator('[data-source="stock"][data-faction="Empire"]').count(), 0);
          assert.equal(await teamButton.getAttribute('aria-label'), beforePick);
          assert.equal(await catalog.locator('.op-family-current strong').innerText(), 'Zann Consortium');
          await popup.getByRole('searchbox').fill('Palpatine Forces of Corruption');
          assert.equal(await catalog.locator('[data-commander]').count(), 1);
          assert.equal(await catalog.locator('[data-commander]').getAttribute('data-commander'), 'Emperor Palpatine');
          assert.equal(await catalog.locator('.op-stage-still,.op-stage-card,.op-commander-portrait').count(), 0);
          const stockChoice = catalog.locator('[data-source="stock"][data-faction="Empire"]');
          await stockChoice.hover();
          await board.locator('.op-command-stage[data-ready="true"][data-model="EI_PALPATINE.ALO"]').waitFor();
          assert.equal(await board.locator('.op-team-select,.op-faction-picker').count(), 0);
          await stockChoice.click();
          assert(await stockChoice.isVisible(), 'Assign must keep the chosen commander on stage');
          assert(await board.locator('.op-galaxy').isHidden());
          assert(await board.locator('.op-go').isEnabled(), 'a selected battlefield stays ready');
          await board.getByRole('button', { name: 'Add ally' }).click();
          await board.getByRole('button', { name: 'Add opponent' }).click();
          await board.getByRole('combobox', { name: 'Opponent 2 difficulty', exact: true }).selectOption('hard');
          const remove = board.getByRole('button', { name: 'Remove ally 1' });
          assert.equal(await remove.innerText(), '×');
          await remove.click();
          assert.equal(await board.getByRole('button', { name: /^Ally 1 faction:/ }).count(), 0);
          assert.equal(await board.getByRole('combobox', { name: 'Opponent 2 difficulty' }).inputValue(), 'hard');
          await board.getByRole('tab', { name: 'Settings' }).click();
          const cap = board.getByRole('spinbutton', { name: 'Unit cap' }),
            cash = board.getByRole('spinbutton', { name: 'Starting credits' });
          for (const bad of ['', '-1', '1.25', '9007199254740992']) {
            await cap.fill(bad);
            assert(await board.locator('.op-go').isDisabled());
          }
          await cap.fill('0');
          await cash.fill('0');
          assert(await board.locator('.op-go').isEnabled());
          await board.getByText('Players & options', { exact: true }).click();
          await f.locator('[data-id="IDC_CANCEL_BUTTON"]:visible').click();
          await board.getByRole('tab', { name: 'Battlefield' }).click();
        } else {
          await board.getByRole('tab', { name: 'Forces' }).click();
          await board.getByText('Edit fleets', { exact: true }).click();
          await page.keyboard.press('Escape');
          await board.getByRole('tab', { name: 'Battlefield' }).click();
        }
        await search.fill('The Maw Forces of Corruption');
        assert.equal(await board.locator('[data-domain="land"]').count(), 0);
        await search.fill('Kuat');
        {
          const parent = board.locator('[data-planet-group="kuat"]');
          assert.equal(await parent.count(), 1);
          if ((await parent.getAttribute('aria-expanded')) === 'true') await parent.click();
          assert.equal(await board.locator('[data-world="Kuat"]:visible').count(), 0);
          await parent.click();
          assert(await board.locator('[data-world="Kuat"][data-domain="space"]:visible').count());
          assert.equal(await board.getByRole('button', { name: 'Next', exact: true }).count(), 0);
          const options = await board
            .locator('.op-field-children:visible [data-world="Kuat"]')
            .evaluateAll(bs => bs.map(b => [b.dataset.source, b.dataset.file.toUpperCase()].join(':')));
          assert.equal(options.length, new Set(options).size);
          const list = await board.locator('.op-field-index').boundingBox(),
            foot = await board.locator('.op-foot').boundingBox();
          assert(foot.y - list.y - list.height < 24, 'Battlefield list fills the sidebar to the footer');
          const secondary = board.locator('[data-source="1397421866"][data-world="Kuat"][data-file="_Space_Planet_Kuat.ted"]');
          if (await secondary.count()) {
            await secondary.click();
            await f.locator('.op-setup[data-profile="1397421866"] .op-go:enabled').waitFor({ timeout: 120000 });
            assert.equal(await secondary.getAttribute('aria-pressed'), 'true', 'mount retained the exact secondary TED');
          }
        }
        assert.equal(await board.locator('.op-field-tile,.op-atlas-left,.op-paging').count(), 0);
        if (mode === 'instant') {
          await search.fill('Kuat Thrawn Space');
          const other = board.locator('[data-world="Kuat"][data-domain="space"][data-source="1125571106"]');
          if (await other.count()) {
            await other.click();
            await f.locator('.op-setup[data-profile="1125571106"] .op-go:enabled').waitFor({ timeout: 120000 });
            assert.equal(await search.inputValue(), 'Kuat Thrawn Space');
            assert.match(await board.locator('.op-instant-field').textContent(), /Kuat.*Space/i);
          }
          await search.fill('Kuat');
        }
      }
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const nav = await heading.boundingBox(),
          map = await board.locator('.op-galaxy').boundingBox();
        assert(nav.x >= map.x && nav.y >= map.y && nav.x - map.x <= 12 && nav.y - map.y <= 12 && nav.x + nav.width <= map.x + map.width);
        const r = await board.locator('.op-go').boundingBox();
        assert(r && r.x >= 0 && r.x + r.width <= width && r.y + r.height <= page.viewportSize().height + 1);
        if (process.env.SHOTS)
          await page.screenshot({ path: require('node:path').join(process.env.SHOTS, `collated-${mode}-${width}.png`) });
      }
      await board.getByRole('button', { name: 'Back', exact: true }).click();
      await play(id).waitFor({ timeout: 90000 });
    }
    assert.deepEqual(errors, []);
    console.log(
      'Campaign participation, faction crests, numeric rules, shared land/space browser, remount/editor/back and responsive layout OK'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
