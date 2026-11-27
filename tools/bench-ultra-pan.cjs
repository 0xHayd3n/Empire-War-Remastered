// Live mounted camera pan; compare in separate, clean browser runs, never simultaneously.
// To replay a prior engine version: LOOK_RELIEF_REFERENCE=/absolute/path/to/endor-relief.js
// LOOK_FULL_TERRAIN=1 draws the entire coarse mesh. Neither control changes game files.
const { chromium } = require('playwright-core'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os'),
  assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }),
      errors = [],
      gl = process.env.LOOK_BACKEND === 'webgl',
      full = process.env.LOOK_FULL_TERRAIN === '1',
      ref = process.env.LOOK_RELIEF_REFERENCE;
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/.test(m.text()))
        errors.push(m.text().slice(0, 800));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    // To compare forest changes, put the previous endor-grove.js and
    // endor-thicket.js in this directory. That run also uses the old (off) sightline.
    const forestRef = process.env.LOOK_FOREST_REFERENCE_DIR;
    if (forestRef)
      for (const file of ['endor-grove.js', 'endor-thicket.js'])
        await p.route('**/js/game/' + file, r =>
          r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(forestRef, file), 'utf8') })
        );
    if (ref)
      await p.route('**/js/game/endor-relief.js', r =>
        r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(ref, 'utf8') })
      );
    const yavin = process.env.LOOK_WORLD === 'yavin';
    const sharedRef = process.env.LOOK_SHARED_REFERENCE_DIR;
    if (sharedRef)
      for (const file of ['endor-tiles.js', 'game/endor-relief.js', 'game/land-sky-light.js'])
        await p.route('**/js/' + file, r =>
          r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(sharedRef, path.basename(file)), 'utf8') })
        );
    await p.goto('http://127.0.0.1:8590/#' + (yavin ? 'yavin-remaster' : 'endor-ultra'));
    const root = p.frameLocator('#game').locator('body');
    const report = await root.evaluate(
      async (_, { full, forestRef, yavin }) => {
        const wait = () => new Promise(requestAnimationFrame),
          end = performance.now() + 90000;
        while (
          !window.game?.ground?.userData[yavin ? 'reviewedLandscape' : 'endorLandscape']?.active ||
          !game.extraFx?.pr ||
          game.world.time < 1
        ) {
          if (performance.now() > end) throw Error('Endor not ready');
          await wait();
        }
        const g = game,
          mesh = g.ground,
          R = g.gpuOn ? g.gpu : g.renderer;
        g.modeSuspended = true;
        await wait();
        g.following = null;
        if (forestRef) (await import('/js/gfx.js')).gfx.canopyFade = 0;
        const env = g.map.environments.find(e => e.name === 'Noon_Clear');
        if (env) {
          await g.applyEnvironment(env);
          g.world.setWeather(env.weather);
        }
        g.forestSky.cover = g.forestSky.wet = g.groundRain.amount = 0;
        const pivot = yavin ? g.world.units.find(u => u.foot && u.side === g.me) : { x: 1460, y: 3120 };
        const x0 = pivot.x,
          y0 = pivot.y;
        if (full) {
          mesh.onBeforeRender = () => {};
          mesh.onAfterRender = () => {};
        }
        const patch = mesh.getObjectByName('Endor displaced ground').geometry.attributes.position;
        const raf = window.requestAnimationFrame,
          noRequeue = cb => (cb === g.frame ? 0 : raf.call(window, cb));
        const frame = (ts, x) => {
          Object.assign(g.view, { x: x0 + x * 7, y: y0 + x * 1.3, dist: 135, yaw: -1.1, pitch: 1.05 });
          g.modeSuspended = false;
          window.requestAnimationFrame = noRequeue;
          try {
            g.frame(ts);
          } finally {
            window.requestAnimationFrame = raf;
            g.modeSuspended = true;
          }
        };
        for (let i = 0; i < 150; i++) frame(await wait(), i <= 75 ? i : 150 - i);
        await R.settle?.();
        const tick = [],
          cpu = [],
          rebuild = [],
          w = g.world.time;
        let prev = await wait();
        for (let i = 0; i < 300; i++) {
          const ts = await wait(),
            t = performance.now(),
            before = patch.version;
          frame(ts, 75 - Math.abs((i % 150) - 75));
          const submit = performance.now() - t;
          if (i > 0) {
            tick.push(ts - prev);
            cpu.push(submit);
            if (before !== patch.version) rebuild.push(submit);
          }
          prev = ts;
        }
        const stats = a => {
          a.sort((a, b) => a - b);
          const pick = q => +a[Math.floor(a.length * q)].toFixed(2);
          return { n: a.length, median: pick(0.5), p95: pick(0.95) };
        };
        return {
          map: g.map.file,
          pivot: [x0, y0],
          backend: g.gpuOn ? 'gpu' : 'gl',
          battleSeconds: +(g.world.time - w).toFixed(2),
          interval: stats(tick),
          frameCPU: stats(cpu),
          rebuildFrameCPU: stats(rebuild)
        };
      },
      { full, forestRef: !!forestRef, yavin }
    );
    console.log(JSON.stringify(report));
    assert.equal(report.backend, gl ? 'gl' : 'gpu');
    assert(report.battleSeconds > 0 && report.rebuildFrameCPU.n > 50);
    assert.deepEqual(errors, []);
    const dir = path.join(os.tmpdir(), 'ultra-terrain-cost', report.backend, yavin ? 'yavin' : '');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(
        dir,
        sharedRef ? 'pan-shared-reference.json' : forestRef ? 'pan-forest-reference.json' : ref ? 'pan-reference.json' : 'pan.json'
      ),
      JSON.stringify(report, null, 2)
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
