// Run through the mounted stock title, not a physics showcase or a direct play.html launch.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const kind of process.argv.slice(2).length ? process.argv.slice(2) : ['land', 'space', 'fallback']) {
      const land = kind !== 'space',
        fallback = kind === 'fallback';
      const page = await b.newPage({ viewport: { width: 1080, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const errors = [],
        requests = [],
        warnings = [];
      page.setDefaultTimeout(150000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {
        if (m.type() === 'warning') warnings.push(m.text());
      });
      page.on('request', req => {
        if (/rapier\.es\.js|jolt-physics/i.test(req.url())) requests.push(req.url());
      });
      if (fallback) await page.route('**/vendor/rapier/rapier.es.js', route => route.abort('failed'));
      await page.goto('http://127.0.0.1:8590/');
      const f = page.frameLocator('#game'),
        board = f.locator('.op-setup');
      await f.locator('[data-id="TITLE_PLAY"]').click();
      if (await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').isVisible())
        await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').click();
      assert.equal(requests.length, 0, 'no solver in the menu');
      const domain = land ? 'land' : 'space';
      await board.getByRole('searchbox', { name: 'Search battlefields' }).fill('Abregado Forces of Corruption ' + domain);
      await board.locator(`[data-world="Abregado_Rae"][data-domain="${domain}"][data-source="stock"]`).click();
      await board.locator('.op-go').click();
      const frame = page.frames().find(fr => fr.url().includes('play.html'));
      await frame.waitForFunction(
        () => {
          const g = window.game;
          return g?.world?.time > 1.5 && !g.warming && !document.querySelector('.battle-plate') && !g.setup.instant;
        },
        null,
        { timeout: 160000 }
      );
      const result = await frame.evaluate(
        async ({ land, fallback }) => {
          const g = window.game,
            w = g.world;
          g.paused = true;
          if (!land)
            return {
              mode: g.setup.mode,
              engine: g.renderer.spaceWrecks?.R.version(),
              separate: g.renderer.spaceWrecks?.world !== w,
              armor: w.presentArmorHits,
              bases: w.teams.filter(t => t.station).length
            };
          const u = w.units.find(
            u => u.side === g.me && !u.dead && !u.inside && u.foot && u.holder?.visible && u.inst?.root && !w.viewFogged(u.x, u.y)
          );
          if (!u) throw Error('No visible allied infantryman in the stock skirmish');
          const pos = [u.x, u.y, u.z];
          w.hurt(u, 1e9, null);
          const layer = g.vehicleWrecks,
            d = layer?.live.find(r => r.u === u)?.doll;
          const out = {
            mode: g.setup.mode,
            unit: u.type.name,
            dead: u.dead,
            parts: d?.nodes.length || 0,
            stockOnly: !layer,
            engine: layer?.R.version(),
            bases: w.sites.filter(s => s.base && s.structure).length
          };
          if (!fallback) {
            if (!d) throw Error('Authored skin was not handed off to Rapier');
            // Route the exact host-confirmed message through the replica handler. Repeated delivery
            // must not spawn another doll or run campaign accounting on this presentation client.
            const { ShooterNet } = await import('/js/game/shooternet.js');
            const other = w.units.find(
              v => v !== u && v.side === g.me && v.foot && !v.dead && v.holder?.visible && !w.viewFogged(v.x, v.y)
            );
            if (!other) throw Error('No second allied infantryman for replicated death');
            const replica = Object.assign(Object.create(ShooterNet.prototype), {
              game: g,
              world: w,
              byId: new Map([[73, other]]),
              track: new Map()
            });
            const accounting = w.onDeath;
            w.onDeath = () => {
              throw Error('Replica called authoritative death accounting');
            };
            try {
              replica.event(['die', 73, ''], w.time);
              replica.event(['die', 73, ''], w.time);
            } finally {
              w.onDeath = accounting;
            }
            out.replicaDolls = layer.live.filter(r => r.u === other && r.doll).length;
            const hash = g.hashState();
            for (let i = 0; i < 800; i++) layer.step(1 / 60);
            out.hashUnchanged = g.hashState() === hash;
            out.kept = layer.settled.length;
            out.empty = !layer.world.bodies.len() && !layer.world.impulseJoints.len() && !layer.world.colliders.len();
          }
          out.unmoved = pos.every((v, i) => v === [u.x, u.y, u.z][i]);
          return out;
        },
        { land, fallback }
      );
      console.log(kind, result);
      assert.equal(result.mode, domain);
      assert(result.bases >= 2);
      assert(
        requests.length === 1 &&
          new URL(requests[0]).origin === new URL(frame.url()).origin &&
          requests[0].endsWith('/vendor/rapier/rapier.es.js'),
        JSON.stringify(requests)
      );
      if (!fallback) assert.equal(result.engine, '0.17.3');
      if (!land) assert(result.separate && result.armor);
      else {
        assert(result.dead && result.unmoved);
        if (!fallback)
          assert(result.parts === 10 && result.replicaDolls === 1 && result.kept === 2 && result.empty && result.hashUnchanged);
        else assert(result.stockOnly && warnings.some(w => w.includes('Using stock vehicle deaths:')));
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
