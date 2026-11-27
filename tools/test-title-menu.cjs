// Real Chrome, isolated browser storage and the installed stock game. No player saves are touched.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
// Any opaque warm colour in a computed paint is enough for the gold Play entry.
const warm = str =>
  [...str.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g)].some(m => {
    const [r, g, b] = m.slice(1, 4).map(Number),
      a = m[4] === undefined ? 1 : Number(m[4]);
    return a > 0.4 && r >= 170 && g >= 120 && b < r && r - b >= 45;
  });
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8760),
    server = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'inherit']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', s => {
        if (s.includes('Universal game:')) ok();
      });
      server.once('exit', code => no(Error('Server exited: ' + code)));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(40000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    const f = page.frameLocator('#game'),
      menu = f.locator('.title-menu'),
      section = () => menu.getAttribute('data-section'),
      ctl = id => f.locator(`[data-id="${id}"]:visible`).first(),
      rail = menu.locator('.home-rail'),
      play = f.locator('.title-menu [data-id="TITLE_PLAY"]'),
      modeBack = () => f.locator('.title-menu .mode-heading .mode-back:visible').first(),
      panel = f.locator('.title-menu [role="tabpanel"]:visible'),
      tab = id => f.locator(`.title-menu [role="tab"][data-id="${id}"]`),
      singleTab = tab('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES'),
      multiTab = tab('IDC_MAIN_MENU_MULTIPLAYER'),
      selected = entry => entry.getAttribute('aria-selected'),
      soloIds = [
        'IDC_CUSTOM_CAMPAIGN_BUTTON',
        'IDC_NEW_CAMPAIGN_BUTTON',
        'IDC_SKIRMISH_GAMES_BUTTON',
        'IDC_INSTANT_BATTLE_BUTTON',
        'IDC_MAIN_MENU_TUTORIAL',
        'IDC_LOAD_GAME_MAIN'
      ],
      loadIds = ['load-conquest', 'load-story', 'load-skirmish', 'load-instant', 'load-tutorial'];
    await play.waitFor();
    // Play, the bell and the cog live on one centred Home dock; nothing else owns the top bar.
    const dock = () =>
      menu.evaluate(m => {
        const r = id => m.querySelector(`[data-id="${id}"]`).getBoundingClientRect(),
          p = r('TITLE_PLAY'),
          b = r('bell'),
          c = r('cog');
        return {
          centre: Math.abs(p.left + p.width / 2 - innerWidth / 2),
          top: p.top,
          bellGap: p.left - b.right,
          cogGap: c.left - p.right,
          edge: Math.min(b.left, innerWidth - c.right),
          flanked: b.left < p.left && p.right < c.right
        };
      });
    // A section owns its header: a large centred heading preceded by one icon-only Back.
    const header = async (label, id = label.toLowerCase()) => {
      assert.equal(await section(), id);
      await f.locator('.title-menu .mode-heading h1').waitFor();
      assert.equal((await f.locator('.title-menu .mode-heading h1').textContent()).trim(), label);
      const box = await f.locator('.title-menu .mode-heading:visible').evaluate(el => {
        const h1 = el.querySelector('h1'),
          btn = h1.previousElementSibling,
          hs = getComputedStyle(h1),
          es = getComputedStyle(el),
          hb = h1.getBoundingClientRect();
        return {
          previous: !!btn && btn.classList.contains('mode-back'),
          backInset: Math.abs(btn.getBoundingClientRect().left - el.getBoundingClientRect().left),
          text: btn ? btn.textContent.trim() : 'x',
          name: btn ? (btn.getAttribute('aria-label') || btn.title || '').trim() : '',
          icon: !!btn?.querySelector('svg, img'),
          size: parseFloat(hs.fontSize),
          offCentre: Math.abs(hb.left + hb.width / 2 - innerWidth / 2),
          bg: es.backgroundColor,
          image: es.backgroundImage,
          shadow: es.boxShadow,
          line: es.borderBottomWidth
        };
      });
      assert(box.previous && box.backInset <= 6, label + ' puts Back at the left edge, independent of the centered heading');
      assert.equal(box.text, '', label + ' Back is icon-only');
      assert(box.icon, label + ' Back draws an icon');
      assert.equal(box.name, 'Back', label + ' Back is named Back');
      assert.equal(
        await f.locator('.title-menu .mode-heading:visible').getByRole('button', { name: 'Back', exact: true }).count(),
        1,
        label + ' Back has the accessible name Back'
      );
      assert(box.size >= 30, label + ' heading is large (' + box.size + 'px)');
      assert(box.offCentre <= 8, label + ' heading is centred (' + box.offCentre.toFixed(1) + 'px off)');
      assert.equal(box.bg, 'rgba(0, 0, 0, 0)', label + ' heading paints no shared backing');
      assert.equal(box.image, 'none', label + ' heading paints no shared backing');
      assert.equal(box.shadow, 'none', label + ' heading casts no shared backing');
      assert.equal(box.line, '0px', label + ' heading draws no shared line');
    };
    // Sections hide the Home dock, so Back is the only route out of them.
    const goHome = async () => {
      for (let i = 0; i < 4 && (await section()) !== 'home'; i++) await modeBack().click();
      await f.locator('.title-menu[data-section="home"]').waitFor();
    };
    assert.equal(await section(), 'home');
    assert.equal(await f.locator('.title-menu [data-id="TITLE_HOME"]').count(), 0, 'Home is not a destination of its own');
    assert.equal(await f.locator('.title-menu [data-id="TITLE_PLAY"]').count(), 1, 'exactly one Play entry');
    assert.equal((await play.textContent()).trim(), 'Play');
    const paint = await play.evaluate(el => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor, s.backgroundImage, s.borderBottomColor].join(' ');
    });
    assert(warm(paint), 'the Play entry is gold: ' + paint);
    const backing = await rail.evaluate(el => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, image: s.backgroundImage, shadow: s.boxShadow };
    });
    assert.equal(backing.bg, 'rgba(0, 0, 0, 0)', '.home-rail has a transparent backing');
    assert.equal(backing.image, 'none', '.home-rail paints no backing');
    assert.equal(backing.shadow, 'none', '.home-rail strikes no backing line');
    const bar = await dock();
    assert(bar.centre <= 5, 'Play is centred on the Home dock (' + bar.centre.toFixed(1) + 'px off)');
    assert(bar.top <= 5, 'Play is anchored to the top');
    assert(bar.flanked, 'Play is flanked by notifications on its left and settings on its right');
    assert(bar.bellGap >= -24 && bar.bellGap <= 6, 'the bell is attached to Play (' + bar.bellGap.toFixed(1) + 'px)');
    assert(bar.cogGap >= -24 && bar.cogGap <= 6, 'the cog follows the bell (' + bar.cogGap.toFixed(1) + 'px)');
    assert(bar.edge >= 120, 'the tools ride beside Play, not at the viewport edge (' + bar.edge.toFixed(1) + 'px inset)');
    await f.locator('.home-destinations [data-id="TITLE_CUSTOMIZE"]').waitFor();
    for (const id of ['bell', 'cog', 'TITLE_WORKSHOP', 'TITLE_CUSTOMIZE']) assert(await ctl(id).isVisible(), id + ' belongs to Home');
    assert.equal(await ctl('TITLE_WORKSHOP').evaluate(b => b.closest('nav') === null && b.closest('.home-destinations') !== null), true);
    assert.equal(await ctl('TITLE_CUSTOMIZE').evaluate(b => b.closest('nav') === null && b.closest('.home-destinations') !== null), true);
    await f.getByText('No Galactic Conquest checkpoint yet.').waitFor();
    assert(await ctl('CONTINUE').isDisabled());
    await ctl('BROWSE_MODES').click();
    await singleTab.waitFor();
    // Play owns its own header and two tabs; Home chrome and its tiles stay behind.
    await header('Play');
    assert(await modeBack().evaluate(b => document.activeElement === b), 'a top section starts focused on Back');
    assert.equal(await rail.isVisible(), false);
    assert.equal(await f.locator('.title-menu [data-id="TITLE_HOME"]').count(), 0);
    assert.equal(await ctl('bell').count(), 0);
    assert.equal(await ctl('cog').count(), 0);
    assert.equal(await ctl('TITLE_WORKSHOP').count(), 0);
    assert.equal(await f.locator('.title-menu [role="tablist"]').count(), 1, 'Play exposes one tab list');
    assert.equal(await singleTab.getAttribute('role'), 'tab');
    assert.equal(await multiTab.getAttribute('role'), 'tab');
    assert.equal(await selected(singleTab), 'true', 'Single Player is selected first');
    assert.equal(await selected(multiTab), 'false');
    assert.equal(await panel.count(), 1, 'exactly one Play panel is live');
    // The whole solo list, load actions included, is visible without opening a submenu.
    for (const id of soloIds) assert(await ctl(id).isVisible(), id + ' is listed immediately');
    for (const id of loadIds) assert(await ctl(id).isVisible(), id + ' load action is listed immediately');
    assert.equal(await ctl('CONTINUE').count(), 0);
    // Roving arrows, Home and End move and select in one keystroke.
    await singleTab.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await selected(multiTab), 'true', 'ArrowRight selects Multiplayer');
    assert(await multiTab.evaluate(b => document.activeElement === b), 'ArrowRight focuses Multiplayer');
    assert(await ctl('PLAY_MATCHMAKING').isVisible(), 'Multiplayer offers matchmaking');
    assert(await ctl('PLAY_CUSTOM').isVisible(), 'Multiplayer offers custom games');
    for (const id of ['IDC_MULTIPLAYER_INTERNET_BUTTON', 'IDC_MULTIPLAYER_LAN_BUTTON', 'IDC_MAIN_OPTIONS_NETWORK'])
      assert.equal(await ctl(id).count(), 0, 'the Multiplayer panel offers Play routes, not tickets');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await selected(singleTab), 'true', 'ArrowLeft selects Single Player');
    assert(await singleTab.evaluate(b => document.activeElement === b), 'ArrowLeft focuses Single Player');
    assert(await ctl('IDC_CUSTOM_CAMPAIGN_BUTTON').isVisible(), 'the solo list follows the active tab');
    await page.keyboard.press('End');
    assert.equal(await selected(multiTab), 'true', 'End selects the last tab');
    assert(await multiTab.evaluate(b => document.activeElement === b), 'End focuses the last tab');
    await page.keyboard.press('Home');
    assert.equal(await selected(singleTab), 'true', 'Home selects the first tab');
    assert(await singleTab.evaluate(b => document.activeElement === b), 'Home focuses the first tab');
    if (process.env.SWR_PLAY_SCREENSHOT) await page.screenshot({ path: process.env.SWR_PLAY_SCREENSHOT });
    await page.keyboard.press('Escape');
    assert.equal(await section(), 'home');
    assert(await ctl('BROWSE_MODES').evaluate(b => document.activeElement === b), 'Escape returns focus to the entry that opened Play');
    assert.equal(await menu.evaluate(() => !!window.game?.world || !!document.querySelector('#view canvas')), false);
    const drawer = menu.locator('.title-drawer'), closeSidebar = drawer.getByRole('button', { name: 'Close sidebar' });
    // Use real pointer coordinates: clicking a dock control behind a drawer neither dismisses nor replaces it.
    const dockClick = async id => {
      const b = await ctl(id).boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    for (const [owner, other, heading] of [['bell', 'cog', 'Social feed'], ['cog', 'bell', 'System menu']]) {
      await ctl(owner).click();
      await drawer.getByRole('heading', { name: heading }).waitFor();
      await dockClick(other);
      assert(await drawer.evaluate(d => d.matches(':modal')));
      assert(await drawer.getByRole('heading', { name: heading }).isVisible());
      assert.equal(await ctl(other).getAttribute('aria-expanded'), 'false');
      if (owner === 'bell') await page.keyboard.press('Escape');
      else await closeSidebar.click();
      await drawer.waitFor({ state: 'hidden' });
      assert(await ctl(owner).evaluate(b => b === document.activeElement));
    }
    await ctl('cog').click();
    assert.deepEqual(await f.locator('.drawer-items button').allTextContents(), ['Settings', 'Credits', 'Exit Game']);
    await ctl('IDC_OPTIONS').click();
    const settings = f.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('slider', { name: 'Gamma' }).waitFor();
    assert.deepEqual(await settings.getByRole('tablist', { name: 'Settings categories' }).getByRole('tab').allTextContents(), ['Video', 'Audio', 'Controls', 'Gameplay', 'Social', 'Accessibility']);
    assert.equal(await settings.getByRole('button', { name: 'Back', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'detached' });
    assert(await ctl('cog').evaluate(b => b === document.activeElement));
    await ctl('cog').click();
    await ctl('IDC_MENU_CREDITS').click();
    await f.locator('canvas:visible').first().waitFor();
    await page.keyboard.press('Escape');
    await play.waitFor();
    await play.click();
    await singleTab.waitFor();
    assert(await modeBack().evaluate(b => document.activeElement === b));
    assert.equal(await selected(singleTab), 'true');
    await ctl('IDC_MAIN_MENU_TUTORIAL').click();
    await ctl('IDC_CANCEL_BUTTON').click();
    await ctl('load-conquest').click();
    await f.getByRole('button', { name: 'Continue', exact: true }).click();
    await f.getByText('No matching single-player saves in this era.').waitFor();
    await f.getByRole('button', { name: 'Back', exact: true }).click();
    await f.getByRole('button', { name: 'Back', exact: true }).last().click();
    await ctl('IDC_LOAD_GAME_MAIN').click();
    await f.locator('[data-universal-screen="eras"]').getByRole('button', { name: 'Back' }).click();
    if (process.env.SWR_TITLE_SCREENSHOT) await page.screenshot({ path: process.env.SWR_TITLE_SCREENSHOT });
    // Metadata fixtures exercise the real OPFS list path: newest battle, story and multiplayer rows must not win Continue.
    await menu.evaluate(async () => {
      const { putSave } = await import('/js/game/savegame.js');
      let n = 0;
      for (const [id, family, mp] of [
        ['Older conquest', 'conquest'],
        ['Latest conquest', 'conquest'],
        ['Story', 'story'],
        ['Skirmish', 'skirmish'],
        ['Online', 'conquest', true]
      ])
        await putSave(
          {
            name: id,
            saved: new Date(1700000000000 + ++n * 1000).toISOString(),
            summary: { family },
            ...(mp ? { multiplayer: { type: 'campaign' } } : {})
          },
          'fixture' + n
        );
    });
    await goHome();
    await f.getByText('Latest conquest', { exact: true }).waitFor();
    assert.equal(await ctl('CONTINUE').isDisabled(), false);
    await ctl('CHOOSE_CAMPAIGN').click();
    await f.locator('.checkpoint-rows strong').first().waitFor();
    assert.deepEqual(await f.locator('.checkpoint-rows strong').allTextContents(), ['Latest conquest', 'Older conquest']);
    await page.keyboard.press('Escape');
    if (process.env.SWR_HOME_SCREENSHOT) await page.screenshot({ path: process.env.SWR_HOME_SCREENSHOT });
    // Workshop and Customize are Home destinations reached as tiles; each brings its own centred header.
    await ctl('TITLE_WORKSHOP').click();
    await f.locator('.title-menu[data-section="workshop"]').waitFor();
    await header('Workshop');
    assert(await modeBack().evaluate(b => document.activeElement === b), 'a destination opens focused on Back');
    assert.equal(await rail.isVisible(), false);
    assert.equal(await ctl('cog').count(), 0);
    await modeBack().click();
    assert.equal(await section(), 'home');
    assert(await ctl('TITLE_WORKSHOP').evaluate(b => document.activeElement === b), 'Back returns focus to the Workshop tile');
    await ctl('TITLE_CUSTOMIZE').click();
    await f.locator('.title-menu[data-section="customize"]').waitFor();
    await f.locator('#armyPainter[open]').waitFor();
    assert.equal(await f.locator('#ap-title').textContent(), 'Army Painter');
    await f.locator('#ap-back').click();
    await f.locator('.title-menu[data-section="home"]').waitFor();
    assert(await ctl('TITLE_CUSTOMIZE').evaluate(b => document.activeElement === b), 'Back returns focus to the Customize tile');
    await play.click();
    await singleTab.waitFor();
    await ctl('load-conquest').click();
    await f.getByRole('button', { name: 'Continue', exact: true }).click();
    await f.getByRole('button', { name: 'Latest conquest', exact: true }).waitFor();
    assert.deepEqual(await f.locator('.era-panel[open] .era-choices button').allTextContents(), ['Latest conquest', 'Older conquest']);
    await f.getByRole('button', { name: 'Back', exact: true }).click();
    await f.locator('[data-universal-screen="eras"]').getByRole('button', { name: 'Back' }).click();
    await page.setViewportSize({ width: 375, height: 667 });
    await goHome();
    assert.equal(await section(), 'home');
    assert(await menu.evaluate(m => m.scrollWidth <= innerWidth));
    const phone = await dock();
    assert(phone.centre <= 5 && phone.top <= 5 && phone.flanked && phone.edge >= 0, 'the split dock fits and Play stays centred on a phone');
    for (const id of ['TITLE_PLAY', 'bell', 'cog']) assert(await ctl(id).isVisible(), id + ' stays reachable on a phone');
    await play.click();
    await singleTab.waitFor();
    assert(await menu.evaluate(m => m.scrollWidth <= innerWidth));
    await multiTab.click();
    assert.equal(await selected(multiTab), 'true');
    assert(await ctl('PLAY_MATCHMAKING').isVisible());
    assert(await ctl('PLAY_CUSTOM').isVisible());
    // Matchmaking keeps its immersive takeover and the bottom Back.
    await ctl('PLAY_MATCHMAKING').click();
    assert.equal(await section(), 'multi');
    assert.notEqual(await menu.getAttribute('data-immersive'), null, 'matchmaking is immersive');
    assert(await ctl('FLIGHT_BACK').isVisible(), 'immersive matchmaking keeps the bottom Back');
    assert.equal(await ctl('bell').count(), 0);
    assert.equal(await ctl('cog').count(), 0);
    assert.equal(await f.locator('.mode-tile:visible').count(), 0, 'the lobby shows no manual tiles');
    assert.equal(await f.locator('.title-menu .mode-heading .mode-back:visible').count(), 0, 'immersive matchmaking drops the section header');
    // FLIGHT_CUSTOM still opens the manual choice, and IDC_OK_MAIN returns to the lobby.
    await ctl('FLIGHT_CUSTOM').click();
    await ctl('IDC_MULTIPLAYER_LAN_BUTTON').waitFor();
    assert.equal(await f.locator('.mode-tile:visible').count(), 3, 'the manual choice offers room routes');
    assert(await ctl('IDC_MULTIPLAYER_INTERNET_BUTTON').isVisible());
    assert(await ctl('IDC_MAIN_OPTIONS_NETWORK').isDisabled());
    await ctl('IDC_OK_MAIN').click();
    assert.equal(await section(), 'multi');
    assert.notEqual(await menu.getAttribute('data-immersive'), null, 'IDC_OK_MAIN returns to the immersive lobby');
    assert.equal(await f.locator('.title-menu .mode-heading .mode-back:visible').count(), 0);
    await ctl('FLIGHT_BACK').click();
    assert.equal(await section(), 'play');
    assert.equal(await selected(multiTab), 'true', 'Back from matchmaking restores the Multiplayer tab');
    assert(await ctl('PLAY_MATCHMAKING').evaluate(b => document.activeElement === b), 'Back restores the Matchmaking entry');
    // Custom games is its own screen; Back restores the Multiplayer tab and its entry.
    await page.setViewportSize({ width: 1440, height: 900 });
    await ctl('PLAY_CUSTOM').click();
    assert.equal(await section(), 'custom');
    await ctl('IDC_MULTIPLAYER_LAN_BUTTON').waitFor();
    assert(await ctl('IDC_MULTIPLAYER_INTERNET_BUTTON').isVisible());
    assert(await ctl('IDC_MAIN_OPTIONS_NETWORK').isDisabled());
    if (process.env.SWR_MULTI_SCREENSHOT) await page.screenshot({ path: process.env.SWR_MULTI_SCREENSHOT });
    await modeBack().click();
    assert.equal(await section(), 'play');
    assert.equal(await selected(multiTab), 'true');
    assert(await ctl('PLAY_CUSTOM').evaluate(b => document.activeElement === b), 'Back restores the Custom games entry');
    // Leaving a native manual room returns straight to custom games, not Home or the lobby.
    await ctl('PLAY_CUSTOM').click();
    await ctl('IDC_MULTIPLAYER_LAN_BUTTON').click();
    await ctl('IDC_LAN_CANCEL_BUTTON').click();
    await f.locator('.title-menu[data-section="custom"]').waitFor();
    assert(await ctl('IDC_MULTIPLAYER_LAN_BUTTON').isVisible(), 'leaving a native room returns the custom screen');
    assert(await ctl('IDC_MULTIPLAYER_INTERNET_BUTTON').isVisible());
    await modeBack().click();
    assert.equal(await section(), 'play');
    assert.equal(await selected(multiTab), 'true', 'Back from custom games restores the Multiplayer tab');
    assert(await ctl('PLAY_CUSTOM').evaluate(b => document.activeElement === b));
    // Back from Play on either tab returns Home and restores the entry that opened it.
    await modeBack().click();
    assert.equal(await section(), 'home');
    assert(await ctl('TITLE_PLAY').evaluate(b => document.activeElement === b), 'Back from Play restores the opener');
    await play.click();
    await singleTab.waitFor();
    assert.equal(await selected(singleTab), 'true', 'Play opens on Single Player');
    await modeBack().click();
    assert.equal(await section(), 'home');
    assert(await ctl('TITLE_PLAY').evaluate(b => document.activeElement === b), 'Back from the other tab returns Home');
    await ctl('cog').click();
    await Promise.all([
      page.waitForEvent('framenavigated', frame => frame.url().endsWith('/play.html')),
      ctl('IDC_MAIN_MENU_EXIT2').click()
    ]);
    await f.locator('.title-menu[data-section="home"]').waitFor();
    assert.equal(await section(), 'home');
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Home dock without a Home entry, centred gold Play with attached bell/cog, section headers with icon Back, Play tabs with solo list and matchmaking/custom routes, immersive Back, direct custom screen, focused returns, drawers, mobile navigation, filtered saves and latest eligible conquest.'
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
