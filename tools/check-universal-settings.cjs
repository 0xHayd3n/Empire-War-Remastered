// Run against the mounted Universal window. A fresh Chrome context keeps the player's preferences untouched.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      cog = f.getByRole('button', { name: 'System menu' }),
      open = async () => {
        await cog.click();
        await f.getByRole('button', { name: 'Settings', exact: true }).click();
        await s.getByRole('tab', { name: 'Video', exact: true }).waitFor();
      },
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      tab = label => s.getByRole('tab', { name: label, exact: true }),
      slider = name => s.getByRole('slider', { name, exact: true });
    await open();
    const top = s.getByRole('tablist', { name: 'Settings categories' });
    const categories = ['Video', 'Audio', 'Controls', 'Gameplay', 'Social', 'Accessibility'];
    assert.deepEqual(await top.getByRole('tab').allTextContents(), categories);
    assert.deepEqual(await s.getByRole('tablist', { name: 'Video categories' }).getByRole('tab').allTextContents(), [
      'General',
      'Graphics Quality',
      'HDR',
      'Details'
    ]);
    const back = s.getByRole('button', { name: 'Back', exact: true });
    async function checkShell() {
      assert.equal(await s.getByRole('heading', { name: 'Settings', exact: true }).count(), 0);
      const frame = await s.boundingBox(),
        nav = await top.boundingBox(),
        btn = await back.boundingBox(),
        pane = await s.locator('.us-panel:visible').boundingBox();
      assert(
        nav.y - frame.y < 2 && pane.x === frame.x && Math.abs(pane.x + pane.width - frame.x - frame.width) < 1,
        'top tabs and edge-to-edge scrollport'
      );
      assert(
        frame.y + frame.height - btn.y - btn.height < 18 && frame.x + frame.width - btn.x - btn.width < 32,
        'Back stays at bottom right'
      );
    }
    await checkShell();
    assert(await tab('Video').evaluate(e => document.activeElement === e));
    await tab('Video').press('ArrowRight');
    await slider('Master volume').fill('0.36');
    await slider('Music').fill('0.28');
    await s.getByLabel('Movie soundtrack relative to music').selectOption('0.5');
    await s.getByLabel('Unit response level').selectOption('0.25');
    await s.getByRole('checkbox', { name: 'Interface sounds' }).uncheck();
    await s.getByRole('checkbox', { name: 'Lower effects during spoken dialogue' }).uncheck();
    await s.getByRole('checkbox', { name: 'Ambient chatter' }).uncheck();
    assert.equal(await s.evaluate(() => game.audio.voiceChannels.ambient), false);
    await s.getByRole('combobox', { name: 'Audio output' }).selectOption('speakers');
    assert.deepEqual(await s.evaluate(() => [game.audio.masterVolume, game.audio.musicVolume, game.audio.headphones]), [0.36, 0.28, false]);
    if (process.env.SWR_SETTINGS_SHOT) await page.screenshot({ path: process.env.SWR_SETTINGS_SHOT });
    await tab('Audio').press('ArrowLeft');
    assert.equal(await tab('Video').getAttribute('aria-selected'), 'true');
    await slider('Field of view').fill('85');
    await tab('General').press('ArrowDown');
    await s.getByRole('combobox', { name: 'Anti-aliasing' }).selectOption('1.5');
    await tab('HDR').click();
    const hdr = s.getByLabel('HDR output');
    assert.equal(await hdr.inputValue(), 'off');
    assert(await slider('Paper white').isDisabled());
    await hdr.selectOption('auto');
    await slider('Peak brightness').fill('1400');
    await slider('Paper white').fill('180');
    await slider('Shadow detail').fill('0.25');
    assert.equal(await s.evaluate(() => JSON.parse(localStorage.getItem('swr-gfx')).hdrPeak), 1400);
    if (!await s.evaluate(() => matchMedia('(dynamic-range: high)').matches)) await s.getByText(/does not report an HDR display/).waitFor();
    await tab('Details').click();
    await slider('Shadow distance').fill('4.5');
    await slider('Bloom intensity').fill('1.25');
    await s.getByLabel('Boost saturation').uncheck();
    await s.getByLabel('Preview on opening').selectOption('portrait');
    const lod = s.getByRole('checkbox', { name: 'Distance detail for models' });
    assert(await lod.isChecked());
    await lod.uncheck();
    assert.deepEqual(
      await s.evaluate(async () => {
        const { gfx } = await import('/js/gfx.js');
        return [gfx.bloomGain, gfx.modelLod];
      }),
      [1.25, false]
    );
    assert.equal(await s.evaluate(() => JSON.parse(localStorage.getItem('swr-gfx')).shadowRange), 4.5);
    await tab('Gameplay').click();
    const lanes = name => s.getByRole('tablist', { name: `${name} categories` });
    assert.deepEqual(await lanes('Gameplay').getByRole('tab').allTextContents(), ['General', 'HUD', 'Replays and Spectate']);
    await s.getByLabel('Periodic campaign checkpoint').selectOption('1');
    await s.getByLabel('Save before entering a tactical battle').uncheck();
    await s.getByText('Battle setup defaults', { exact: true }).click();
    const sk = s.getByRole('group', { name: 'Solo skirmish' }),
      instant = s.getByRole('group', { name: 'Space Instant Battle' });
    await sk.getByLabel('Starting credits').fill('7600');
    await sk.getByLabel('Unit cap').fill('47');
    await sk.getByLabel('Fog of war').uncheck();
    await sk.getByLabel('Pre-built bases').uncheck();
    await instant.getByLabel('Fog of war').check();
    await instant.getByLabel('Budget for new fleets').fill('22500');
    await s.getByLabel('Starting difficulty').selectOption('hard');
    await s.getByText('New Galactic Conquest defaults', { exact: true }).click();
    const rules = s.getByRole('group', { name: 'Rules from installed games and mods' });
    await rules.waitFor();
    const opening = s.getByRole('combobox', { name: 'Campaign opening', exact: true });
    await opening.waitFor();
    const stockOpening = await opening
      .locator('option')
      .evaluateAll(list => list.find(o => o.textContent.startsWith('Forces of Corruption ·'))?.value);
    assert.notEqual(stockOpening, undefined);
    await opening.selectOption(stockOpening);
    await s.getByLabel('Offer mercenary contracts').check();
    await s.getByRole('combobox',{name:'Opening credits',exact:true}).selectOption('8000');
    const payment = rules.getByRole('combobox', { name: 'Your production payments' });
    let modTerms = false;
    if (await payment.count()) {
      await payment.selectOption('true');
      modTerms = true;
      assert.equal(await s.evaluate(async () => (await import('/js/game/campaignpreferences.js')).campaignPreferences().payAsYouGo), true);
    }
    await tab('General').press('ArrowRight');
    await s.getByLabel('Planet income', { exact: true }).check();
    await s.getByLabel('Tactical advisor hints').uncheck();
    assert.equal(await s.evaluate(() => game.advisor?.enabled ?? localStorage.getItem('swr.hints') !== '0'), false);
    await s.getByLabel('Unit and planet marker size').selectOption('1.5');
    await s.getByLabel('Planet name and income text size').selectOption('1.25');
    await s.getByLabel('Trade route line width').selectOption('1.5');
    await s.getByLabel('Fleet movement lines').selectOption('mine');
    await s.getByLabel('Animate traffic on trade routes').uncheck();
    await s.getByRole('checkbox', { name: 'Local radar', exact: true }).uncheck();
    await s.getByRole('combobox', { name: 'Crosshair' }).selectOption('dot');
    await s.getByRole('checkbox', { name: 'Show capture progress bars' }).waitFor();
    await tab('HUD').press('ArrowRight');
    await s.getByLabel('Playback speed for new replays').selectOption('4');
    await s.getByLabel('Show team power balance').uncheck();
    await s.getByLabel('Battle log filter').selectOption('production');
    await s.getByLabel('First battle report graph').selectOption('Income');
    await s.getByRole('checkbox', { name: /Record space skirmishes/ }).uncheck();
    await s.getByRole('checkbox', { name: /followed team’s fog of war/ }).check();
    assert.equal(await s.evaluate(async () => (await import('/js/game/spectatorpreferences.js')).spectatorTeamVision()), true);
    assert.deepEqual(
      await s.evaluate(async () => {
        const { observerDisplay } = await import('/js/game/spectatorpreferences.js');
        const { SpectatorView } = await import('/js/game/spectator.js');
        const prefs = observerDisplay(),
          nodes = Object.fromEntries(['logBox', 'balance', 'clockEl'].map(k => [k, document.createElement('div')]));
        SpectatorView.prototype.applyDisplay.call(nodes, prefs);
        return [nodes.balance.style.display, nodes.logBox.style.display, prefs.filter, prefs.graph];
      }),
      ['none', '', 'production', 'Income']
    );
    await tab('Replays and Spectate').press('Home');
    const bf = s.getByRole('checkbox', { name: 'Battlefront mode (land battles)' });
    assert(await slider('Soldiers per side').isHidden());
    await bf.check();
    await slider('Soldiers per side').fill('85');
    assert.equal(await s.evaluate(() => window.shooterCap), 85);
    await tab('Controls').click();
    assert.deepEqual(await s.getByRole('tablist', { name: 'Controls categories' }).getByRole('tab').allTextContents(), [
      'General',
      'Interface',
      'Communication',
      'Spectate',
      'Replay'
    ]);
    const map = s.locator('.us-keymap'),
      inspection = s.locator('.us-inspection');
    await s.getByLabel('Hold for right-click').selectOption('250');
    await s.getByLabel('Two-finger rotation').selectOption('0');
    await s.getByLabel('Tactical wheel zoom speed').selectOption('2');
    await s.getByLabel('Reverse strategy camera wheel').check();
    await s.getByLabel('Gamepad stick response').selectOption('linear');
    await slider('Gamepad stick dead zone').fill('0.25');
    assert.deepEqual(await s.evaluate(async()=>{
      const {UI}=await import('/js/game/ui.js');let notches;
      UI.prototype.zoom.call({game:{},mouse:{x:0,y:0}, r:{rig:{wheel:n=>notches=n,apply(){}},pickGround:()=>null,camera:{updateMatrixWorld(){}}}},100);
      const {padAxis,loadShooterConfig}=await import('/js/game/shooterpreferences.js');
      return [notches,padAxis(.25,loadShooterConfig()),padAxis(.625,loadShooterConfig())];
    }),[-2,0,.5]);
    await slider('Mouse sensitivity').fill('1.5');
    const scroll = s.locator('.us-panel:visible');
    await scroll.evaluate(e => (e.scrollTop = 0));
    const pos = await scroll.boundingBox();
    await page.mouse.move(pos.x + pos.width - 30, pos.y + 70);
    await page.mouse.wheel(0, 600);
    await scroll.evaluate(async e => {
      for (let i = 0; i < 60 && e.scrollTop === 0; i++) await new Promise(r => setTimeout(r, 16));
    });
    assert(await scroll.evaluate(e => e.scrollTop > 0));
    await checkShell();
    await scroll.evaluate(e => (e.scrollTop = 0));
    assert.equal(await map.locator('[data-code]').count(), 104);
    assert.equal(await map.locator('[data-code]').evaluateAll(keys => new Set(keys.map(k => k.dataset.code)).size), 104);
    const cap = code => map.locator(`[data-code="${code}"]`);
    const right = await cap('ArrowRight').boundingBox(),
      zero = await cap('Numpad0').boundingBox(),
      num = await cap('Numpad1').boundingBox(),
      enter = await cap('NumpadEnter').boundingBox();
    assert(
      zero.x > right.x && enter.height > num.height * 1.8 && zero.width > num.width * 1.8,
      'The number pad is beside the navigation cluster, with full-size Enter and zero'
    );
    await cap('ArrowRight').press('ArrowRight');
    assert(await cap('Numpad0').evaluate(e => e === document.activeElement));
    await cap('Numpad9').click();
    await inspection.getByRole('button', { name: 'Assign command…' }).click();
    await inspection.getByLabel('Command to bind').selectOption('GUARD');
    await inspection.getByRole('button', { name: 'Edit binding' }).click();
    await s.locator('dialog[open]').getByRole('button', { name: 'Add', exact: true }).click();
    assert.deepEqual(await s.evaluate(async () => (await import('/js/game/keybinds.js')).keysOf('GUARD')), ['KeyG', 'Numpad9']);
    await map.locator('[data-code="KeyC"]').click();
    assert.match(await inspection.textContent(), /Spectate/);
    assert.match(await inspection.textContent(), /Battlefront/);
    await s.getByRole('button', { name: 'Test keys' }).click();
    await page.keyboard.down('KeyX');
    assert(await map.locator('[data-code="KeyX"][data-held]').count());
    assert.match(await inspection.textContent(), /Stop/i);
    await page.keyboard.up('KeyX');
    await page.keyboard.press('Escape');
    await s.getByRole('button', { name: 'Test keys' }).waitFor();
    if (process.env.SWR_CONTROLS_SHOT) await page.screenshot({ path: process.env.SWR_CONTROLS_SHOT });
    const key = s.getByRole('button', { name: /^Pause:/i }),
      editor = s.locator('dialog[open]');
    await key.click();
    await page.keyboard.press('Control+J');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    assert.deepEqual(await s.evaluate(async () => (await import('/js/game/keybinds.js')).keysOf('PAUSE')), ['KeyP', 'Pause', 'Ctrl+KeyJ']);
    await key.click();
    await page.keyboard.press('Escape');
    assert(await editor.isHidden());
    assert(await s.isVisible());
    await key.click();
    await page.keyboard.press('x');
    await editor.getByRole('button', { name: 'Set', exact: true }).click();
    await editor.getByRole('button', { name: 'Reassign' }).click();
    assert.equal(await s.evaluate(async () => (await import('/js/game/keybinds.js')).keysOf('STOP').includes('KeyX')), false);
    await map.locator('[data-code="KeyX"]').click();
    assert.match(await inspection.textContent(), /Pause/i);
    await tab('Spectate').click();
    await s.getByRole('button', { name: /^Next team:/ }).click();
    await page.keyboard.press('j');
    await editor.getByRole('button', { name: 'Set', exact: true }).click();
    assert.deepEqual(await s.evaluate(async () => (await import('/js/game/keybinds.js')).keysOf('WATCH_NEXT')), ['KeyJ']);
    // Feed the same key codes to the game's spectator handler; Tab is no longer Next,
    // Shift+Tab still means Previous, and the strategy Holocron binding was not stolen.
    assert.deepEqual(
      await s.evaluate(async () => {
        const { SpectatorView } = await import('/js/game/spectator.js');
        const { keysOf } = await import('/js/game/keybinds.js');
        const seen = [],
          view = { game: {}, teams: [{}, {}], tracked: 1, track: i => seen.push(i) };
        for (const [code, shiftKey] of [
          ['KeyJ', false],
          ['Tab', false],
          ['Tab', true]
        ])
          SpectatorView.prototype.key.call(view, new KeyboardEvent('keydown', { code, shiftKey }));
        return [seen, keysOf('MISSION_HOLOCRON')];
      }),
      [[2, 0], ['Tab']]
    );
    await tab('Replay').click();
    assert.equal(await s.getByLabel('Playback speed for new replays').inputValue(),'4');
    await s.getByRole('checkbox', { name: /Record space skirmishes/ }).uncheck();
    assert.equal(await s.evaluate(() => window.recordBattles), false);
    await tab('Gameplay').click();
    await tab('HUD').click();
    await s.getByRole('checkbox', { name: 'Show capture progress bars' }).check();
    assert.equal(await s.evaluate(() => window.showCaptureBars), true);
    await tab('Accessibility').click();
    assert.deepEqual(await lanes('Accessibility').getByRole('tab').allTextContents(), [
      'General',
      'Subtitles',
      'Colourblindness',
      'Text-to-speech'
    ]);
    await s.getByRole('combobox', { name: 'Game language', exact: true }).waitFor();
    await s.getByLabel('Land weather lightning brightness').selectOption('0');
    await s.getByLabel('Orbital bombardment lighting').selectOption('0.25');
    await s.getByLabel('Advisor message display time').selectOption('2');
    await s.getByLabel('Time between space battle hints').selectOption('4');
    await s.getByLabel('Battle message duration').selectOption('1.5');
    assert.equal(await s.evaluate(async()=>{const {battleMessage}=await import('/js/game/battlemessages.js'), box=document.createElement('div');battleMessage(box,'Message timer check');return parseFloat(box.firstChild.firstChild.style.animationDuration)*(box.firstChild.firstChild.style.animationDuration.endsWith('ms')?1:1000);}),9000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await s.getByLabel('Always reduce menu and preview animations').check();
    assert(await s.evaluate(() => document.documentElement.classList.contains('reduce-menu-motion')));
    await s.getByRole('combobox', { name: 'Tooltip wait time' }).selectOption('0.5');
    assert(
      await s.evaluate(async () => {
        const { TooltipGate } = await import('/js/game/tooltipgate.js'),
          { db } = await import('/js/gamedata.js');
        return new TooltipGate({ delayTooltips: false }, {}).delay === 0.5 * db.constants.num('Encyclopedia_Delay', 750);
      })
    );
    await tab('General').press('ArrowRight');
    await s.getByLabel('Movie caption size').selectOption('1.5');
    await s.getByLabel('Caption position').selectOption('top');
    await s.getByLabel('Caption background').selectOption('black');
    await s.getByLabel('Caption text colour').selectOption('yellow');
    assert(await s.evaluate(async()=>{
      const {TacticalMovies}=await import('/js/game/tacticalmovies.js');
      const movie={canvas:document.createElement('canvas'),movie:{all:t=>t==='Caption_Frame'?[{text:'SETTINGS_TEST 15'}]:[]}};
      TacticalMovies.prototype.captions.call(movie,0,15);
      const {el}=movie.caption, sample=document.querySelector('.us-caption-preview span'), actual=el.querySelector('span');
      const rect=el.getBoundingClientRect(), ok=actual.textContent.length>0 && actual.style.color===sample.style.color && actual.style.backgroundColor===sample.style.backgroundColor && rect.top>0 && rect.bottom<innerHeight/2;
      TacticalMovies.prototype.captions.call(movie,15,200);
      return ok && !el.isConnected;
    }));
    await s.getByRole('checkbox', { name: 'Movie subtitles' }).uncheck();
    assert.equal(await s.evaluate(() => localStorage.getItem('swr-subtitles')), '0');
    await tab('Subtitles').press('ArrowRight');
    await s.getByLabel('Distinguish contacts by shape').check();
    await s.getByRole('checkbox', { name: 'Colourblind-safe Battlefront markers' }).check();
    assert.deepEqual(await s.evaluate(() => JSON.parse(localStorage.getItem('swr-shooter-settings'))), {
      fov: 85,
      crosshair: 'dot',
      radarVisible: false,
      sens: 1.5,
      colorblind: true,
      padDead: 0.25,
      padCurve: 'linear'
    });
    await tab('Colourblindness').press('ArrowRight');
    await s.getByLabel('Announce incoming tactical messages').check();
    assert.equal(await f.locator('#messages').getAttribute('aria-live'), 'polite');
    // Record what gets sent to speech synthesis without depending on an audio device in CI.
    if (await s.evaluate(() => !!window.speechSynthesis && !!window.SpeechSynthesisUtterance)) {
      await s.evaluate(() => {
        window.speechLog = [];
        window.speechSynthesis.speak = u => speechLog.push([u.text, u.rate]);
      });
      await s.getByRole('checkbox', { name: 'Read focused settings aloud' }).check();
      await slider('Speech rate').fill('1.5');
      await s.getByRole('button', { name: 'Preview voice' }).click();
      await tab('Audio').focus();
      await f.locator('body').evaluate(async () => {
        for (let i = 0; i < 60 && !speechLog.some(r => r[0] === 'Audio'); i++) await new Promise(ok => setTimeout(ok, 20));
      });
      const log = await s.evaluate(() => speechLog);
      assert(log.some(([text, rate]) => text.includes('narration voice') && rate === 1.5));
      assert(log.some(([text]) => text === 'Audio'));
      await s.getByRole('checkbox', { name: 'Read focused settings aloud' }).uncheck();
    } else await s.getByText(/Text-to-speech is unavailable/).waitFor();
    await tab('Social').click();
    await s.getByLabel('Playlist category').selectOption('ranked');
    await s.getByLabel('Matchmaking ruleset').selectOption('beachhead');
    await s.getByRole('button', { name: 'Configure matchmaking network' }).click();
    const net = s.getByRole('dialog', { name: 'Network configuration' });
    await net.getByLabel('Commander callsign').fill('Settings Test');
    await net.getByLabel('Matchmaking network').selectOption('local');
    await net.getByRole('button', { name: 'Apply network' }).click();
    await s.getByText('Relay settings', { exact: true }).click();
    await s.getByRole('textbox', { name: 'Relay URL' }).waitFor();
    await back.click();
    assert(await cog.evaluate(e => document.activeElement === e));
    await page.reload();
    await open();
    assert.equal(await tab('Video').getAttribute('aria-selected'), 'true');
    assert.equal(await f.locator('#messages').getAttribute('aria-live'), 'polite');
    await tab('HDR').click();
    assert.equal(await hdr.inputValue(), 'auto');
    assert.equal(await slider('Paper white').inputValue(), '180');
    await s.getByRole('button', {name:'Reset calibration'}).click();
    assert.equal(await slider('Peak brightness').inputValue(), '1000');
    assert.equal(await slider('Shadow detail').inputValue(), '0');
    await tab('Audio').click();
    assert.equal(await slider('Master volume').inputValue(), '0.36');
    assert.equal(await s.getByRole('checkbox', { name: 'Ambient chatter' }).isChecked(), false);
    await tab('Gameplay').click();
    await tab('Replays and Spectate').click();
    assert.equal(await s.getByLabel('Playback speed for new replays').inputValue(),'4');
    assert(await s.getByRole('checkbox', { name: /followed team’s fog of war/ }).isChecked());
    await tab('Accessibility').click();
    await tab('Colourblindness').click();
    assert(await s.getByRole('checkbox', { name: /Colourblind-safe Battlefront/ }).isChecked());
    await tab('Controls').click();
    await cap('Numpad9').click();
    assert.match(await inspection.textContent(), /Guard/);
    assert.equal(await s.getByLabel('Hold for right-click').inputValue(), '250');
    assert.equal(await s.getByLabel('Two-finger rotation').inputValue(), '0');
    await tab('Audio').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkShell();
    if (process.env.SWR_SETTINGS_NARROW_SHOT) await page.screenshot({ path: process.env.SWR_SETTINGS_NARROW_SHOT });
    await s.evaluate(e => {
      e.style.backgroundImage = 'none';
    });
    for (const label of categories) {
      await tab(label).click();
      assert.equal(await s.locator('.us-panel:not([hidden])').count(), 1);
      if (label === 'Gameplay') {
        await tab('HUD').click();
        await s.getByLabel('Trade route line width').focus();
        assert.equal(await s.getByLabel('Trade route line width').inputValue(), '1.5');
        if (process.env.SWR_ROUTES_NARROW_SHOT) await page.screenshot({path:process.env.SWR_ROUTES_NARROW_SHOT});
      }
      if (label === 'Controls') {
        assert(await map.locator('.us-board').evaluate(e => e.scrollWidth > e.clientWidth));
        await map.locator('[data-code="NumpadAdd"]').click();
        assert.match(await inspection.textContent(), /Increase Game Speed/i);
        if (process.env.SWR_CONTROLS_NARROW_SHOT) await page.screenshot({ path: process.env.SWR_CONTROLS_NARROW_SHOT });
      }
      assert(
        await s.evaluate(
          e =>
            e.scrollWidth <= e.clientWidth &&
            [...e.querySelectorAll('[role=tabpanel]:not([hidden])')].every(p => p.scrollWidth <= p.clientWidth)
        ),
        label + ' fits at phone width'
      );
    }
    await back.click();
    await page.setViewportSize({ width: 1366, height: 768 });
    await f.locator('[data-id="TITLE_CUSTOMIZE"]').click();
    await f.getByRole('button', { name: 'Fleet registry', exact: true }).click();
    assert.equal(await f.getByLabel('Preview mode', { exact: true }).inputValue(), 'portrait');
    await f.locator('.title-menu .mode-heading .mode-back:visible').first().click();
    await f.locator('[data-id="TITLE_PLAY"]').click();
    await f.locator('[data-id="IDC_MAIN_MENU_MULTIPLAYER"]').click();
    await f.locator('[data-id="PLAY_MATCHMAKING"]').click();
    assert.match(await f.locator('[data-id="FLIGHT_PLAYLIST"]').textContent(), /Ranked · Beachhead/);
    assert.match(await f.locator('[data-id="FLIGHT_NETWORK"]').textContent(), /Local relay/);
    await f.locator('[data-id="FLIGHT_BACK"]').click();
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').filter({ hasNotText: 'Instant Battle' }).click();
    const staged = f.locator('[data-universal-screen="skirmish"]');
    await staged.getByRole('tab', { name: 'Settings' }).click();
    assert.equal(await staged.getByLabel('Starting credits').inputValue(), '7600');
    assert.equal(await staged.getByLabel('Unit cap', { exact: true }).inputValue(), '47');
    assert.equal(await staged.getByLabel('Fog of war').isChecked(), false);
    assert.equal(await staged.getByLabel('Pre-built bases').isChecked(), false);
    await staged.getByRole('button', { name: 'Back', exact: true }).click();
    await f.locator('[data-id="IDC_INSTANT_BATTLE_BUTTON"]').click();
    const fleet = f.locator('[data-universal-screen="instant"]');
    await fleet.getByRole('tab', { name: 'Forces', exact: true }).click();
    await fleet.getByRole('button', { name: 'Edit fleets' }).click();
    assert.equal(await fleet.locator('.ib-budget input').inputValue(), '22500');
    await fleet.getByRole('button', { name: 'Fog of War: On', exact: true }).waitFor();
    await fleet.locator('.ib-editor').getByRole('button', { name: 'Battlefield', exact: true }).click();
    await fleet.getByRole('button', { name: 'Back', exact: true }).click();
    await f.locator('.title-menu .mode-heading .mode-back:visible').first().click();
    await f.locator('.title-menu [data-id="TITLE_WORKSHOP"]').click();
    await f.locator('.title-menu[data-section="workshop"]').waitFor();
    await f.getByText('Mounted content', { exact: true }).click();
    await f.getByText(/Forces of Corruption, no mods/).waitFor();
    if (modTerms) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await f.locator('.title-menu .mode-heading .mode-back:visible').first().click();
      for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_CUSTOM_CAMPAIGN_BUTTON'])
        await f.locator(`[data-id="${id}"]`).click();
      const board = f.locator('.uc-atlas');
      await board.getByRole('button', { name: /Equal Footing/ }).click();
      await board.getByRole('tab', { name: 'Faction', exact: true }).click();
      await board.locator('[data-field="faction"] input[value="Rebel"]').check();
      await board.getByRole('tablist', { name: 'Campaign setup' }).getByRole('tab', { name: 'Settings' }).click();
      assert.equal(await board.locator('[data-field="difficulty"] input:checked').inputValue(), 'hard');
      assert.equal(await board.locator('select[data-field="mercenaries"]').inputValue(), 'offer');
      assert.equal(await board.locator('select[data-field="credits"]').inputValue(),'8000');
      const terms = board.locator('select[data-field="payment"]');
      assert.equal(await terms.inputValue(), 'alternate', 'Remake installments carried into new stock campaign setup');
      await board.getByRole('button', { name: 'Reset settings' }).click();
      assert.equal(await terms.inputValue(), '', 'Reset restores authored campaign defaults');
      assert.equal(await board.locator('select[data-field="credits"]').inputValue(),'');
      assert.equal(await board.evaluate(async()=>(await import('/js/game/startingconditions.js')).conditionPrefs().credits),8000);
      assert.equal(await board.locator('[data-field="difficulty"] input:checked').inputValue(), 'medium');
      assert.equal(await board.locator('select[data-field="mercenaries"]').inputValue(), '');
      assert.equal(
        await board.evaluate(async () => (await import('/js/game/campaignpreferences.js')).campaignPreferences().payAsYouGo),
        true
      );
      if (process.env.SWR_TEST_SETTINGS_PAUSE) {
        await terms.selectOption('alternate');
        await board.locator('select[data-field="credits"]').selectOption('8000');
        await board.locator('.uc-start').click();
        await page.locator('.battle-plate').waitFor({ state: 'hidden', timeout: 120000 });
        const runtime = page.frames().find(x => x.parentFrame() === page.mainFrame());
        await runtime.waitForFunction(() => !!window.game?.story && window.game?.galaxy?.universalRules?.payAsYouGo === true, null, {
          timeout: 120000
        });
        const body = f.locator('body');
        // Equal Footing opens the campaign briefing before it accepts the pause shortcut.
        if (await runtime.evaluate(() => game.storyDialog?.opened)) {
          await body.press('Escape');
          await runtime.waitForFunction(() => !game.storyDialog?.opened);
        }
        await body.press('Escape');
        const options = f.locator('[data-id="IDC_INGAME_OPTIONS"]:visible');
        await options.click();
        await s.waitFor();
        await checkShell();
        await tab('Gameplay').click();
        await tab('HUD').click();
        assert.equal(await s.evaluate(()=>game.setup.campaignSettings.credits),8000);
        const routes = () => s.evaluate(() => {
          game.updateRoutes(0, 0);
          return game.routes.map(r => [r.quad.group.width[r.quad.base], r.sa]);
        });
        const before = await routes();
        assert(before.some(([w]) => w > 0) && before.every(([, a]) => a === 0));
        await s.getByRole('button', {name:'Restore route defaults'}).click();
        const after = await routes();
        assert(after.every(([w], i) => Math.abs(before[i][0] - 1.5 * w) < 0.001));
        assert.equal(await s.getByLabel('Fleet movement lines').inputValue(), 'visible');
        assert(await s.getByLabel('Animate traffic on trade routes').isChecked());
        const marker=()=>s.evaluate(()=>{game.radar.refresh();return game.radar.blips.find(b=>b.known && b.width>0).width;});
        const larger=await marker();await s.getByLabel('Unit and planet marker size').selectOption('1');
        assert.equal(larger,(await marker())*1.5);
        await s.getByLabel('Show camera footprint').uncheck();
        assert(await s.evaluate(()=>{game.radar.drawFrame();return game.radar.outline.hidden && game.radar.canvas.hidden;}));
        assert(await s.getByLabel('Planet income', { exact: true }).isChecked());
        await s.getByLabel('Planet income', { exact: true }).uncheck();
        assert.deepEqual(
          await s.evaluate(() => [game.filters, game.galaxy.displayFilters, localStorage.getItem('swr-new-galaxy-overlays')]),
          [0, 0, '1']
        );
        assert.equal(await f.locator('[data-control="b_filters0"]').getAttribute('aria-pressed'), 'false');
        await back.click();
        await options.waitFor();
        const original = await runtime.evaluate(async () => {
          const { getSave } = await import('/js/game/savegame.js');
          if (await getSave('conquest-cycle')) throw Error('Unexpected checkpoint before the next fiscal cycle');
          // Let the game itself pay out and advance the cycle on the next unpaused tick.
          game.galaxy.fiscal.next = game.galaxy.time + 0.5;
          return (await getSave('conquest-opening')).saved;
        });
        await f.locator('[data-id="IDC_GAME_OPTIONS_RESUME"]:visible').click();
        const saved = await runtime.evaluate(async () => {
          const { getSave, listSaves, validate } = await import('/js/game/savegame.js');
          for (let i = 0; i < 120; i++) {
            const snap = await getSave('conquest-cycle');
            if (snap && (await listSaves()).some(s => s.id === 'conquest-cycle' && s.family === 'conquest'))
              return [snap.summary.cycle, snap.galaxy.fiscal.cycle + 1, !!validate(snap), (await getSave('conquest-opening')).saved,true];
            await new Promise(ok => setTimeout(ok, 250));
          }
          throw Error('No cycle checkpoint: ' + JSON.stringify({ paused:game.paused, busy:game.busy, noSave:game.noSave, cycle:game.galaxy.fiscal, family:game.setup.menuFamily,held:game.held,open:game.menus.open,story:game.storyDialog?.opened }));
        });
        assert(saved[0] >= 2, 'First periodic checkpoint followed a fiscal payout');
        assert.deepEqual(saved.slice(1), [saved[0], false, original, true]);
        console.log('PASS: active campaign kept installment rule, returned from pause, and wrote a separate valid fiscal-cycle checkpoint.');
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: mounted Settings tabs, live audio/video/tweaks, keyboard reassignment, persistence, Workshop and narrow layout.');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
