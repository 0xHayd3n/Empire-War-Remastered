// Native title -> Universal chooser -> actual campaign on disposable ports. No user saves.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8850),
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Disposable port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const starts = [];
    for (const run of ['stock', 'loader', 'direct']) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(90000);
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const board = f.locator('.uc-atlas'),
        tab = (list, name) => board.getByRole('tablist', { name: list }).getByRole('tab', { name, exact: true });
      await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
      if (run !== 'stock') {
        await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
        await tab('Start type', 'Scenario-based').click();
        if (run === 'direct') {
          await tab('Scenario type', 'Sandbox').click();
          const group = board.locator('.uc-size-group[data-size-group*="Custom Galactic Conquest"]');
          await group.click();
          const layouts = board.locator('.uc-size-child .uc-map-choice[data-family^="Sandbox_Custom_"]:visible');
          assert.equal(await layouts.count(), 5);
          await layouts.filter({ hasText: 'Small Galaxy map' }).click();
        } else {
          await tab('Scenario type', 'Miscellaneous').click();
          await board.locator('.uc-map-choice[data-family="Sandbox_CustomLoader_CIS"]').click();
        }
        await tab('Campaign setup', 'Faction').click();
        await board.locator('[data-field="faction"] input[value="Empire"]').check();
      }
      await tab('Campaign setup', 'Settings').click();
      const pay = board.locator('select[data-field="payment"]');
      if (run === 'loader') assert(!(await pay.isVisible()));
      else {
        assert.equal(await pay.inputValue(), '');
        assert.match(await pay.locator('option:checked').textContent(), /Upfront/);
      }
      if (run === 'stock') {
        assert.match(await pay.locator('option[value="alternate"]').textContent(), /Installments.*Remake/i);
        await pay.selectOption('alternate');
      }
      await board.locator('[data-field="difficulty"] input[value="hard"]').check();
      const target = await board.getAttribute('data-campaign');
      if (run === 'direct') assert.equal(target, 'Sandbox_Custom_Small_Empire');
      await board.locator('.uc-start').click();
      const plate = page.locator('.battle-plate');
      await plate.waitFor();
      await plate.waitFor({ state: 'hidden' });
      const runtime = () => page.frames().find(x => x.parentFrame() === page.mainFrame());
      let game = runtime();
      await game.waitForFunction(
        n => window.game?.galaxy?.campaign.name === n && !!window.game?.story && window.game?.renderer?.domElement?.width > 0,
        target
      );
      if (run === 'stock') {
        const result = await game.evaluate(async () => {
          const { galaxy: g, data } = window.game,
            { startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('/js/game/galaxy.js'),
            prod = await import('/js/game/galacticproduction.js');
          const live = g.universalRules?.payAsYouGo;
          const fresh = () => startingGalaxy(data, g.campaign),
            next = fresh();
          // Work on an in-memory snapshot, never the user's OPFS or a running queue.
          const world = fresh();
          applyGalaxy(world, snapshotGalaxy(g));
          const owner = world.active,
            player = world.players.find(x => x.faction === owner);
          let p, t;
          outer: for (const planet of world.planets)
            if (planet.owner === owner)
              for (const kind of ['ground', 'space'])
                for (const unit of prod.availableUnits(world, planet.index, owner, kind))
                  if (
                    !prod.productionBlock(world, planet.index, owner, unit) &&
                    prod.productionTime(world, planet, owner, unit) > 1 &&
                    prod.productionCost(world, planet, owner, unit) > 1
                  ) {
                    p = planet;
                    t = unit;
                    break outer;
                  }
          if (!p) throw Error('Stock campaign needs a buildable unit');
          const cost = prod.productionCost(world, p, owner, t),
            budget = cost / 2;
          player.credits = budget;
          const error = prod.queueUnit(world, p.index, owner, t);
          if (error) throw Error(error);
          const [kind, q] = Object.entries(p.production)
            .map(([k, l]) => [k, l.find(x => x.type === t)])
            .find(([, q]) => q);
          const deferred = player.credits === budget;
          prod.stepProduction(world, q.total / 4);
          const paid = q.paid,
            left = q.left;
          prod.stepProduction(world, q.total * 0.6);
          const stalled = q.left === left && q.paid === paid;
          const copy = fresh();
          applyGalaxy(copy, JSON.parse(JSON.stringify(snapshotGalaxy(world))));
          const item = copy.planets[p.index].production[kind].find(x => x.type === t),
            restored = item.left === left && item.paid === paid && item.payg && copy.universalRules?.payAsYouGo === true;
          prod.cancelProduction(copy, p.index, owner, item);
          const refunded = copy.players.find(x => x.faction === owner).credits;
          return {
            live,
            deferred,
            stalled,
            restored,
            quarter: Math.abs(paid - cost / 4) < 1e-5,
            refund: Math.abs(refunded - budget) < 0.01,
            next: prod.payAsYouGo(next, owner),
            ai: prod.payAsYouGo(copy, 'not the active human'),
            unit: t.name
          };
        });
        console.log(run, target, result);
        assert.deepEqual(
          { ...result, unit: null },
          { live: true, deferred: true, stalled: true, restored: true, quarter: true, refund: true, next: false, ai: false, unit: null }
        );
      } else {
        if (run === 'loader') {
          await game.waitForFunction(
            () =>
              window.game?.neutralizePopup?.handlers && game.neutralizePopup.rows.some(r => r.type.name.toUpperCase() === 'CUSTOM_GC_SMALL')
          );
          await game.evaluate(() => {
            const popup = game.neutralizePopup;
            const i = popup.rows.findIndex(r => r.type.name.toUpperCase() === 'CUSTOM_GC_SMALL');
            [...popup.handlers.values()][i]();
          });
          await f.locator('body').waitFor();
          await game.waitForFunction(
            () => window.game?.galaxy?.campaign.name === 'Sandbox_Custom_Small_Empire' && !!window.game?.story,
            null,
            { timeout: 110000 }
          );
        }
        // The opening briefing pauses the simulation. Dismiss the actual dialog,
        // just like the player; do not force the clock or fire any story event.
        await game.waitForFunction(() => game.storyDialog?.opened || game.neutralizePopup?.opened);
        await game.evaluate(() => {
          if (game.storyDialog?.opened) game.storyDialog.close();
        });
        await game
          .waitForFunction(
            () =>
              window.game?.neutralizePopup?.opened &&
              game.neutralizePopup.rows?.length &&
              !game.neutralizePopup.rows.some(r => r.type.name.toUpperCase() === 'CUSTOM_GC_SMALL'),
            null,
            { timeout: 65000 }
          )
          .catch(async e => {
            console.error(
              run,
              await game.evaluate(() => ({
                time: game.galaxy.time,
                paused: game.paused,
                locked: game.controlsLocked,
                user: game.userPaused,
                reasons: [...game.uiPauseReasons],
                count: game.galacticPauseCount,
                pop: game.neutralizePopup?.constructor.name,
                globals: [...game.story.values].filter(([k]) => /POPUP_ACTIVE|CURRENT_ERA/.test(k)),
                report: game.story.report(),
                popup: game.neutralizePopup?.rows?.map(r => r.type.name),
                text: document.body.innerText.slice(-1300)
              }))
            );
            throw e;
          });
        const actual = await game.evaluate(() => ({
          target: game.galaxy.campaign.name,
          player: game.galaxy.active,
          difficulty: game.setup.difficulty,
          era: game.story.values.get('CURRENT_ERA'),
          owners: game.galaxy.planets.filter(p => !p.background).map(p => [p.name, p.owner]),
          prompt: game.neutralizePopup.rows.map(r => r.type.name),
          override: !!game.galaxy.universalRules,
          rendered: game.renderer.domElement.width > 0
        }));
        assert.equal(actual.difficulty, 'hard');
        assert.equal(actual.player, 'Empire');
        assert.equal(actual.owners.length, 90);
        assert(!actual.override);
        assert(actual.rendered);
        starts.push(actual);
        console.log(run, actual.target, actual.era, actual.prompt);
      }
      await page.close();
    }
    assert.deepEqual(starts[0], starts[1]);
    console.log('PASS: installments, partial save/refund, default isolation, and native/direct Fall Small launch parity.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
