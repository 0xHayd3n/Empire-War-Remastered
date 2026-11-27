// Mounted Universal only. Pinned test WASM is loaded into this disposable browser page,
// never installed in the runtime, Workshop playset, or player's profile.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const opts = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split('=')));
const land = opts.scene === 'land',
  profile = land ? 'stock' : opts.profile || '1125571106',
  count = +(opts.count || 64);
assert(Number.isInteger(count) && count >= 10 && count <= 100);
assert(['rapier', 'jolt', undefined].includes(opts.only));
const frames = +(opts.frames || 240),
  pairs = +(opts.pairs || 2);
assert(Number.isInteger(frames) && frames >= 30 && frames <= 480);
assert(Number.isInteger(pairs) && pairs >= 1 && pairs <= 3);
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(100000);
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (m.text().startsWith('[debris]')) console.log(m.text());
      if (/GPUValidationError|THREE.WebGLProgram: Shader Error/.test(m.text())) errors.push(m.text().slice(0, 220));
    });
    const f = p.frameLocator('#game'),
      body = f.locator('body');
    await p.goto('http://127.0.0.1:8590/' + (land ? '#ground-offensive' : ''));
    if (!land) {
      const title = f.locator('.title-menu [data-id="TITLE_PLAY"]:visible');
      await title.waitFor();
      if (profile !== 'stock') {
        await title.click();
        await f.locator('.title-menu [data-id="IDC_INSTANT_BATTLE_BUTTON"]:visible').click();
        const setup = f.locator('.op-setup');
        await setup.getByRole('searchbox').fill('Abregado Rae');
        await setup.locator(`[data-world="Abregado_Rae"][data-domain="space"][data-source="${profile}"]`).first().click();
        await f.locator(`.op-setup[data-profile="${profile}"] .op-go:enabled`).waitFor();
      }
      const roster = await body.evaluate(async (_, count) => {
        const { instantRoster, INSTANT_BUDGET_MAX: budget } = await import('/js/game/instantbattle.js');
        const players = ['Empire', 'Rebel'].map((faction, team) => {
          const rows = instantRoster(faction).filter(r => !r.hero);
          const capital = rows.filter(r => r.cls >= 5).sort((a, b) => a.cost - b.cost),
            esc = rows.filter(r => r.cls >= 2 && r.cls <= 4).sort((a, b) => a.cost - b.cost),
            fighters = rows.filter(r => r.cls <= 1);
          if (!capital.length || !esc.length) throw Error('No capital/escort roster for ' + faction);
          const leads =
            capital.find(r => /IMPERIAL_I_STAR_DESTROYER|^(?:GENERIC_)?STAR_DESTROYER$|MC80_HOME_ONE_TYPE/i.test(r.name)) || capital[0];
          const army = Array.from({ length: count }, (_, i) =>
            i < 10 ? leads.name : (i % 5 === 0 && fighters.length ? fighters[0] : esc[i % Math.min(esc.length, 4)]).name
          );
          return { faction, team, budget, kind: team ? 'medium' : 'you', army };
        });
        localStorage.setItem('swr-instant-setup', JSON.stringify({ turn: 0, budget, players }));
        return players.map(p => [p.faction, p.army[0], p.army.length]);
      }, count);
      console.log('draft', profile, roster);
      if (profile !== 'stock') {
        const next = p.waitForEvent('framenavigated', {
          predicate: fr => fr.parentFrame() === p.mainFrame() && fr.url().includes('field-draft='),
          timeout: 30000
        });
        await body.evaluate(async (_, id) => {
          const draft = JSON.parse(localStorage.getItem('swr-instant-setup')),
            { packArmy } = await import('/js/game/instantforces.js');
          draft.kind = 'instant';
          for (const p of draft.players) {
            p.counts = packArmy(p.army.sort());
            delete p.army;
          }
          parent.postMessage(
            { kind: 'universal-field', id, mode: 'instant', world: 'Abregado_Rae', domain: 'space', query: 'Abregado Rae', draft },
            '*'
          );
        }, profile);
        // Wait for the new draft mount, not the still-visible old setup board.
        await next;
      } else {
        await title.click();
        await f.locator('.title-menu [data-id="IDC_INSTANT_BATTLE_BUTTON"]:visible').click();
      }
      const board = f.locator(`.op-setup[data-profile="${profile}"]`);
      await board.getByRole('searchbox').fill('Abregado Rae');
      await board.locator(`[data-world="Abregado_Rae"][data-domain="space"][data-source="${profile}"]`).first().click();
      await board.locator('.op-go:enabled').click();
    }
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const meta = await body.evaluate(async (_, land) => {
      const t = performance.now();
      while (
        !(land ? window.game?.vehicleWrecks && game.ui && !game.warming : window.game?.renderer?.spaceWrecks && game.world.time >= 6)
      ) {
        if (document.body.innerText.includes('Your fleet has no ships yet') || performance.now() - t > 150000)
          throw Error('Battle not ready: ' + document.body.innerText.slice(-220));
        await new Promise(r => setTimeout(r, 50));
      }
      const g = game,
        w = g.world;
      if (land) {
        g.paused = false;
        while (w.time < 1.3) await new Promise(requestAnimationFrame);
      }
      g.paused = true;
      return {
        profile: document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0] || 'stock',
        map: g.setup.mapFile,
        roster: g.setup.instant?.armies?.map(a => a.length),
        units: w.units.length,
        backend: land ? (g.gpuOn ? 'webgpu' : 'webgl') : g.renderer.gpu ? 'webgpu' : 'webgl',
        types: [...new Set(w.units.filter(u => (land ? u.kind === 'VEHICLE' : u.isMobile && !u.isFighter)).map(u => u.type.name))].slice(
          0,
          25
        )
      };
    }, land);
    console.log('mounted', meta);
    assert.equal(meta.profile, profile);
    if (opts.probe === '1') return;
    const inject = async (name, file) =>
      body.evaluate(
        async (_, v) => {
          const u = URL.createObjectURL(new Blob([v.src], { type: 'text/javascript' }));
          try {
            window[v.name] = await import(u);
          } finally {
            URL.revokeObjectURL(u);
          }
        },
        { name, src: fs.readFileSync(file, 'utf8') }
      );
    if (opts.only !== 'rapier') {
      await inject('__jolt', require.resolve('jolt-physics/wasm-compat'));
      await inject('__bridge', path.join(__dirname, 'jolt-bridge.mjs'));
    }
    const result = await body.evaluate(require('./mounted-trial.cjs'), { land, frames, pairs, first:opts.first || 'rapier', only: opts.only || null });
    const report = { meta: { ...meta, chrome: b.version(), cpu: require('node:os').cpus()[0].model }, result, errors };
    console.log(JSON.stringify(report, null, 2));
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
