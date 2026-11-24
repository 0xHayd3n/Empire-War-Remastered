// Real mount tickets and native mod orders. Never set a story flag in the test.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8890),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      host.stdout.on('data', b => {
        if (String(b).includes('Universal game:')) ok();
      });
      host.once('exit', () => no(Error('port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (const [profile, row, target, opts, flags, manual] of [
      [
        '1976399102',
        'CloneWars_Small_Republic',
        'Clone_Wars_Small_Era_2_Empire',
        { clonePaint: 2, fleetMark: 1 },
        { CLONE_DEFAULT: 2, FLEET_EMBLEM: 'OPEN_CIRCLE' },
        'Option_Cycle_Clones'
      ],
      [
        '3417277973',
        'Known_Galaxy_Medium_Republic',
        'Known_Galaxy_Medium_Era_2_Empire',
        { saber: 3 },
        { DEFAULT_LIGHTSABER_REVAN: 3 },
        'Option_Cycle_Lightsaber_Revan'
      ]
    ]) {
      const page = await browser.newPage(),
        errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}`);
      const fl = page.frameLocator('#game');
      await fl.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').waitFor({ timeout: 85000 });
      const r = page.frames().find(x => x.parentFrame() === page.mainFrame());
      await fl.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await fl.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const board = fl.locator('.uc-atlas'),
        fall = profile === '1976399102',
        label = fall ? '22 BBY' : '3964 BBY';
      await board.getByRole('button', { name: fall ? 'Clone Wars' : 'Old Republic', exact: true }).click();
      await board.getByRole('tab', { name: 'Time-based', exact: true }).click();
      const year = board.getByRole('slider', { name: 'Starting year' }),
        tick = board.locator(`[data-year="${label}"]`),
        size = await year.boundingBox();
      await year.click({
        position: { x: 8 + (size.width - 16) * (await tick.evaluate(e => parseFloat(e.style.left) / 100)), y: size.height / 2 }
      });
      const leaf = board.locator(`tr[data-profile="${profile}"] [data-family^="${row.replace(/Republic$/, '')}"]`);
      await leaf.waitFor({ state: 'attached' });
      if (!(await leaf.isVisible()))
        await board.locator(`[aria-controls~="${await leaf.locator('xpath=ancestor::tr').getAttribute('id')}"]`).click();
      await leaf.click();
      await board.getByRole('tab', { name: 'Faction', exact: true }).click();
      await board.locator('[data-field="faction"] input[value="Empire"]').check();
      await board.getByRole('tab', { name: 'Settings', exact: true }).click();
      for (const [k, n] of Object.entries(opts)) {
        const field = board.locator(`[data-field="${k}"]`);
        assert.equal(await field.inputValue(), '');
        await field.selectOption(String(n));
      }
      await board.locator('.uc-start').click();
      await r.waitForFunction(target => window.game?.galaxy?.campaign.name === target, target, { timeout: 120000 });
      try {
        await r.waitForFunction(
          flags => {
            if (game.storyDialog?.opened) game.storyDialog.close();
            return Object.entries(flags).every(([k, v]) => game.story?.values.get(k) === v) && !game.galaxy.paint;
          },
          flags,
          { timeout: 95000 }
        );
        const output = await r.evaluate(() => ({
          time: game.galaxy.time,
          flags: [...game.story.values].filter(([k]) => ['CLONE_DEFAULT', 'FLEET_EMBLEM', 'DEFAULT_LIGHTSABER_REVAN'].includes(k)),
          built: game.galaxy.players.find(p => p.faction === game.me).builtCounts
        }));
        console.log(
          target,
          output.flags,
          Object.entries(output.built || {}).filter(([k]) => k.startsWith('Option_Cycle'))
        );
        await r.evaluate(async type => {
          const { queueUnit } = await import('/js/game/galacticproduction.js'),
            { db } = await import('/js/gamedata.js'),
            why = queueUnit(game.galaxy, game.selected, game.me, db.type(type));
          if (why) throw Error(why);
        }, manual);
        await r.waitForFunction(([k, v]) => game.story.values.get(k) === v + 1, Object.entries(flags)[0]);
        assert.deepEqual(errors, []);
        console.log('Later native cycle works');
        await r.evaluate(async fall => {
          const g = game.galaxy,
            p = g.planets.find(
              p =>
                p.owner === g.active &&
                p.selectable &&
                !p.background &&
                p.type.str(fall ? 'Space_Tactical_Map' : 'Land_Tactical_Map').trim()
            ),
            { stageStart } = await import('/js/game/transit.js');
          if (!p) throw Error('no native tactical map');
          game.setUserPaused(true);
          game.battle = { p: p.index, mode: fall ? 'space' : 'land', attacker: 'Rebel', defender: 'Empire' };
          const s = game.battleSetup();
          if (!s.campaign.appearance) throw Error('missing appearance handoff');
          if (fall) {
            s.campaign.attacker.units = [{ gid: 'fixture-a', type: 'Munificent' }];
            s.campaign.defender.units = [{ gid: 'fixture-d', type: 'Venator_Star_Destroyer' }];
            s.campaign.defender.orbital = [];
            s.campaign.defender.station = null;
          } else {
            s.campaign.defender.units = [{ gid: 'g:0', type: 'Revan_Jedi_MW_Team' }];
            s.campaign.defender.structures = [];
          }
          setTimeout(() => stageStart(s), 0);
        }, profile === '1976399102');
        const isFall = profile === '1976399102';
        await r.waitForFunction(
          fall =>
            fall
              ? window.game?.campaignBook && game.scripts?.values?.get('FLEET_EMBLEM') === 'OPEN_CIRCLE'
              : window.game?.landBattle && game.scripts?.host?.values.get('DEFAULT_LIGHTSABER_REVAN') === 4,
          isFall,
          { timeout: 100000 }
        );
        const meshState = fall => {
          const game = window.game,
            e = fall ? game.campaignBook?.entity.get('fixture-d') : game.world.units.find(u => u.type.name === 'Revan_Jedi_MW'),
            inst = e?.inst || e?.model;
          return [...(inst?.meshByName || [])]
            .filter(([k]) => (fall ? /VENATOR_(LEFT|RIGHT)(?:$|_OCA)/.test(k) : /LIGHTSABER_FRONT_(BLUE|PURPLE)/.test(k)))
            .map(([k, n]) => [k, n.visible, n.userData.scriptHid]);
        };
        await r.waitForFunction(meshState, isFall, { timeout: 5000 });
        await r
          .waitForFunction(
            fall => {
              const e = fall ? game.campaignBook?.entity.get('fixture-d') : game.world.units.find(u => u.type.name === 'Revan_Jedi_MW'),
                inst = e?.inst || e?.model;
              return [...(inst?.meshByName || [])].some(
                ([k, n]) => (fall ? k === 'VENATOR_LEFT' : k === 'LIGHTSABER_FRONT_BLUE') && n.userData.scriptHid === true
              );
            },
            isFall,
            { timeout: 22000 }
          )
          .catch(async e => {
            console.log('Mesh evidence', await r.evaluate(meshState, isFall));
            throw e;
          });
        const meshes = await r.evaluate(meshState, isFall);
        assert(meshes.some(([k, , hide]) => (isFall ? k === 'VENATOR_LEFT_OCA' : k === 'LIGHTSABER_FRONT_PURPLE') && hide === false));
        console.log('Rendered model:', meshes);
        assert.deepEqual(errors, []);
      } catch (e) {
        console.error(
          await r.evaluate(() => ({
            time: game.galaxy?.time,
            state: game.galaxy?.paint,
            paused: game.paused,
            selected: game.selected,
            values: [...(game.story?.values || [])].filter(([k]) => /DISPLAY_ON|CLONE_DEFAULT|FLEET_EMBLEM|DEFAULT_LIGHTSABER/.test(k)),
            ui: game.scriptUI?.state('B_SAVE_FIXER')
          }))
        );
        throw e;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
