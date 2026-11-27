// Record a real mounted fleet, then use the game's replay launcher. No synthetic checksum.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1024, height: 720 } }),
      errors = [];
    p.setDefaultTimeout(150000);
    p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game');
    await f.locator('[data-id="TITLE_PLAY"]').waitFor();
    await require('./mounted-space-roster.cjs')(f, 6);
    const body = f.locator('body');
    const replay = await body.evaluate(async () => {
      const { captureReplay } = await import('/js/game/replay.js');
      const start = performance.now();
      let replay;
      do {
        if (performance.now() - start > 150000) throw Error('No recorded worker checkpoint');
        await new Promise(r => setTimeout(r, 250));
        if (window.game?.world?.time >= 10) replay = await captureReplay(game);
      } while (!replay?.checks?.length);
      if (!game.renderer.spaceWrecks || game.mirror.ramRule !== 1 || replay.setup.ramRule !== 1 || replay.setup.battlePhysicsRule !== 1 || game.mirror.battlePhysicsRule !== 1 || replay.version !== 3) throw Error('Missing ramming rule in worker or saved replay');
      return replay;
    });
    await body.evaluate(async (_, rep) => {
      (await import('/js/game/replay.js')).startReplay(rep);
    }, replay);
    const frame = p.frames().find(fr => fr.url().includes('play.html'));
    await frame.waitForFunction(() => window.game?.setup?.replay && game.paused && game.mirror?.ready && game.world?.time > 1, null, {
      timeout: 180000
    });
    const result = await frame.evaluate(async () => ({
      version: game.renderer.spaceWrecks?.R.version(), ramRule:game.mirror.ramRule, battlePhysicsRule:game.mirror.battlePhysicsRule,
      checks: (await game.mirror.replayLog()).checks,
      finished: game.paused,
      until: game.setup.replay.until
    }));
    assert.equal(result.version, '0.17.3');
    assert.equal(result.ramRule, 1);
    assert.equal(result.battlePhysicsRule, 1);
    assert(result.finished);
    assert.equal(result.until, replay.until);
    assert.deepEqual(result.checks, replay.checks);
    assert.deepEqual(errors, []);
    console.log('Mounted replay with Rapier:', result);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
