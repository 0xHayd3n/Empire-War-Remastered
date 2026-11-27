// Optional mounted check: serve the game with npm start, then run this with Chrome and playwright-core.
// Set SHOTS to an existing temporary directory for local visual review (never commit mounted artwork).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const base = process.env.BASE_URL || 'http://127.0.0.1:8377';
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    const p = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const errors = [];
    p.on('pageerror', error => errors.push(String(error)));
    const btn = name => p.getByRole('button', { name, exact: true });
    const shot = async name => {
      if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
    };
    await p.goto(base + '/briefings.html');
    const art = {};
    for (const [card, scene] of [
      ['conquest', 'chart'],
      ['staging', 'fleet']
    ]) {
      await p.getByLabel('Loading screen').selectOption(card);
      await p.locator(`#splash[data-scene="${card}"]`).waitFor();
      art[scene] = await p.locator('#splash').evaluate(el => getComputedStyle(el, '::before').backgroundImage);
      for (const width of [390, 1440]) {
        await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await shot(`reference-${scene}-${width}`);
      }
    }
    const checkNarrow = async (name, scene, go) => {
      const menu = p.locator('.op-setup:visible');
      assert.ok((await menu.evaluate(el => getComputedStyle(el).backgroundImage)).includes(art[scene]));
      await p.setViewportSize({ width: 390, height: 844 });
      await shot(name + '-narrow');
      await menu.evaluate(el => el.style.setProperty('--op-art', 'none'));
      const bounds = await btn(go).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844, 'action fits without art');
      await btn('Back').focus();
      await p.keyboard.press('Tab');
      assert.ok(await btn(go).evaluate(el => el === document.activeElement && el.matches(':focus-visible')));
      assert.equal(await menu.evaluate(el => el.getAnimations().length), 0);
      await menu.evaluate(el => el.style.removeProperty('--op-art'));
      await p.setViewportSize({ width: 1440, height: 900 });
    };
    await p.route('**/js/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    for (const game of ['eaw', 'foc']) {
      await p.goto(base + '/play.html');
      await p.evaluate(g => localStorage.setItem('swr.game', g), game);
      await p.reload();
      await p.evaluate(async () => {
        const { hideSplash } = await import('/js/splash.js');
        hideSplash();
        const { db, loadGameData, skirmishFactions } = await import('/js/gamedata.js');
        await loadGameData();
        const { skirmishMaps } = await import('/js/ted.js');
        const { space: maps, land: landMaps, custom: customMaps } = await skirmishMaps();
        const { dynamicMaps } = await import('/js/game/dynamicmap.js');
        const { openLobby } = await import('/js/game/lobby.js');
        const { openInstantBattle } = await import('/js/game/instantmenu.js');
        const { openMainCampaignMenu } = await import('/js/game/storycampaignmenu.js');
        const args = { start: s => (window.started = s), cancel: () => (window.back = true) };
        const factions = skirmishFactions();
        const init = {
          credits: 6000,
          popCap: 0,
          fog: true,
          mapFile: maps[0],
          teamFactions: factions.slice(0, 2),
          players: [
            { human: true, team: 0, auto: true },
            { difficulty: 'medium', team: 1, auto: true }
          ]
        };
        window.story = () => openMainCampaignMenu(args);
        window.skirmish = () => openLobby({ maps: [...maps, ...dynamicMaps()], landMaps, customMaps, factions, init, ...args });
        window.instant = () => openInstantBattle({ maps: [...maps, ...dynamicMaps()], factions, ...args });
        window.fac = factions;
        await window.story();
        await document.fonts.ready;
      });
      const rows = p.locator('.op-choice');
      assert.equal(await rows.count(), game === 'eaw' ? 2 : 1);
      await rows.last().focus();
      await p.keyboard.press('Enter');
      await p.getByLabel('Difficulty').selectOption('hard');
      assert((await p.locator('.op-planet').count()) > 0, 'mounted campaign territory');
      await shot('story-' + game);
      await checkNarrow('story-' + game, 'chart', 'Start campaign');
      await btn('Original setup').click();
      await p.locator('.dlg-veil:visible [data-id="IDC_CANCEL_BUTTON"]').click();
      assert.equal(await p.getByLabel('Difficulty').inputValue(), 'hard');
      await btn('Start campaign').click();
      const story = await p.evaluate(() => started);
      assert.equal(story.difficulty, 'hard');
      assert.match(story.campaign, game === 'eaw' ? /Empire$/i : /Underworld$/i);
      if (game !== 'foc') continue;
      await p.evaluate(() => skirmish());
      await p.locator('.op-map-preview canvas').waitFor();
      await shot('skirmish');
      await p.getByLabel('Battle type').selectOption('land');
      await rows.last().click();
      const faction = await p.evaluate(() => fac[1]);
      await p.getByLabel('Team 1 · You').selectOption(faction);
      const map = await p.locator('.op-name').innerText();
      await btn('Players & options').click();
      const staging = p.locator('.dlg-veil:visible');
      assert.match(
        await staging.locator('[data-id="IDC_STAGING_MAP_LIST"] .sel').innerText(),
        new RegExp(map.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      );
      await staging.locator('[data-id="IDC_CANCEL_BUTTON"]').click();
      assert.equal(await p.locator('.op-name').innerText(), map);
      await checkNarrow('skirmish', 'fleet', 'Start battle');
      await btn('Start battle').click();
      const skirmish = await p.evaluate(() => started);
      assert.equal(skirmish.mode, 'land');
      assert.equal(skirmish.teamFactions[0], faction);
      assert(skirmish.preBuilt);
      await p.evaluate(() => window.skirmish());
      assert.equal(await p.locator('.op-name').innerText(), map, 'skirmish restores the draft');
      await p.keyboard.press('Escape');
      assert.equal(await p.locator('.op-setup').count(), 0);
      await p.evaluate(() => instant());
      await checkNarrow('instant', 'fleet', 'Start battle');
      await shot('instant');
      await btn('Edit fleets').click();
      await btn('Battlefield').click();
      await btn('Start battle').click();
      const instant = await p.evaluate(() => started);
      assert.equal(instant.type, 'instant');
      assert(instant.instant.armies.every(army => army.length));
      assert.equal(await p.locator('.op-setup').count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log('Mounted setup: EaW and FoC story launches, restored editors, land/faction draft and Instant Battle fleets OK');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
