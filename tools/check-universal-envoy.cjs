// Disposable title-screen launch -> real fleet move -> active report in OPFS -> load & expiry.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8920),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      host.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      host.once('exit', () => no(Error('Test port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(100000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const b = f.locator('.uc-atlas');
    await b.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
    await b.getByRole('button', { name: /Equal Footing/ }).click();
    await b.getByRole('tab', { name: 'Faction', exact: true }).click();
    await b.locator('[data-field="faction"] input[value="Rebel"]').check();
    await b.getByRole('tab', { name: 'Settings', exact: true }).click();
    await b.locator('[data-field="path"] input[value="envoy"]').check();
    await b.locator('.uc-start').click();
    await page.locator('.battle-plate').waitFor();
    await page.locator('.battle-plate').waitFor({ state: 'hidden' });
    const run = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await run.waitForFunction(
      () =>
        window.game?.galaxy?.campaign.name === 'Sandbox_Equal_Footing_Rebel' &&
        game.renderer.domElement.width > 0 &&
        game.galaxy.universalRules?.envoy?.state === 'travel'
    );
    await run.evaluate(() => game.galacticLog.show(0));
    await f.getByRole('button', { name: 'Rendezvous: Bespin', exact: true }).press('Enter');
    assert(
      await run.evaluate(
        () =>
          game.galaxy.planets[game.selected].name === 'Bespin' &&
          !game.galacticLog.opened &&
          game.view.x === game.galaxy.planets[game.selected].pos[0]
      )
    );
    const moved = await run.evaluate(async () => {
      const g = game.galaxy,
        isEnvoy = u => (u.carries || u.type).name === 'Mon_Mothma_Team',
        home = g.planets.find(p => p.name === 'Hoth'),
        from = g.fleets.find(f => f.owner === g.active && f.units.some(isEnvoy)),
        target = g.planets.find(p => p.name === 'Bespin'),
        report = g.planets.find(p => p.name === 'Sullust');
      const { embarkGround } = await import('/js/game/invasion.js'),
        { orderMove } = await import('/js/game/fleets.js');
      const fleet = from || embarkGround(g, home.index, g.active, { records: home.garrison.filter(isEnvoy), fresh: true });
      if (!fleet?.units.some(isEnvoy) || fleet.planet !== home.index) throw Error('No authored envoy at Hoth');
      return { baseline: g.visibility.planets[report.index].mask, ordered: orderMove(g, fleet, target.index, null, null, { human: true }) };
    });
    console.log('Ordered', moved);
    assert(moved.ordered);
    assert(!(moved.baseline & 64));
    const waitMission = async (state, seconds) => {
      for (let i = 0; i < seconds; i++) {
        let now = await run.evaluate(() => {
          if (game.storyDialog?.opened) game.storyDialog.close();
          const g = game.galaxy;
          return {
            time: g.time,
            paused: game.paused,
            busy: game.busy,
            stage: g.universalRules.envoy.state,
            envoy: g.fleets
              .filter(f => f.units.some(u => (u.carries || u.type).name === 'Mon_Mothma_Team'))
              .map(f => [f.planet, f.dest, f.leg?.t]),
            known: g.visibility.planets[g.planets.find(p => p.name === 'Sullust').index].discovered
          };
        });
        if (!(i % 10)) console.log(now);
        if (now.stage === state) return;
        await run.waitForTimeout(1000);
      }
      throw Error('Mission did not reach ' + state);
    };
    await waitMission('report', 80);
    const proof = await run.evaluate(async () => {
      const g = game.galaxy,
        { snapshot, putSave } = await import('/js/game/savegame.js'),
        p = g.planets.find(p => p.name === 'Sullust');
      const snap = snapshot(game, 'Envoy report QA'),
        id = await putSave(snap);
      sessionStorage.setItem('swr-load', id);
      return { id, until: snap.galaxy.universalRules.envoy.until, t: snap.galaxy.time, mask: g.visibility.planets[p.index].mask };
    });
    assert(proof.mask & 64);
    await run.evaluate(() => setTimeout(() => location.reload(), 0));
    await run.waitForFunction(() => window.game?.setup?.restore && game.galaxy?.universalRules?.envoy?.state === 'report');
    const restored = await run.evaluate(async () => {
      const g = game.galaxy,
        p = g.planets.find(p => p.name === 'Sullust');
      return { until: g.universalRules.envoy.until, t: g.time, mask: g.visibility.planets[p.index].mask };
    });
    assert.equal(restored.until, proof.until);
    assert(restored.mask & 64);
    await run.evaluate(() => game.galacticLog.show(0));
    await f.getByRole('button', { name: 'Fleet intelligence: Sullust' }).click();
    await run.evaluate(() => {
      game.setUserPaused(false);
    });
    await waitMission('complete', 140);
    const done = await run.evaluate(async id => {
      const g = game.galaxy,
        p = g.planets.find(p => p.name === 'Sullust');
      await (await import('/js/game/savegame.js')).deleteSave(id);
      return { mask: g.visibility.planets[p.index].mask, t: g.time, selected: g.planets[game.selected]?.name };
    }, proof.id);
    assert(!(done.mask & 64));
    assert(done.t >= proof.until);
    assert.equal(done.selected, 'Sullust');
    assert.deepEqual(errors, []);
    console.log({ moved, proof, restored, done });
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
