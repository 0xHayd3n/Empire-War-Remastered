// Same mounted camera route, with the full terrain draw as a reference. Measures
// completed fixed-simulation render batches, not a predicted FPS from triangle counts.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'));
const gl = process.env.LOOK_BACKEND === 'webgl',
  out = path.join(os.tmpdir(), 'ultra-terrain-cost', gl ? 'gl' : 'gpu');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/.test(m.text()))
        errors.push(m.text().slice(0, 800));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const root = p.frameLocator('#game').locator('body');
    const setup = await root.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame),
        end = performance.now() + 90000;
      while (!window.game?.ground?.userData.endorLandscape?.active || !game.extraFx?.pr || game.world.time < 1) {
        if (performance.now() > end) throw Error('Endor not ready');
        await wait();
      }
      const g = game,
        R = g.gpuOn ? g.gpu : g.renderer,
        geo = g.ground.geometry,
        total = geo.drawRange.count;
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const env = g.map.environments.find(e => e.name === 'Noon_Clear');
      await g.applyEnvironment(env);
      g.world.setWeather(env.weather);
      g.forestSky.cover = g.forestSky.wet = g.groundRain.amount = 0;
      R.domElement.dataset.terrainPerf = '1';
      const style = document.createElement('style');
      style.textContent = 'body *:not(:has([data-terrain-perf])):not([data-terrain-perf]){visibility:hidden!important}';
      document.head.append(style);
      let full = false,
        log = null;
      const ctx = R.getContext?.(),
        pixel = new Uint8Array(4),
        clock = g.last;
      const method = g.gpuOn ? 'prepare' : 'renderBufferDirect',
        draw = R[method];
      R[method] = function (...args) {
        const [obj, geom] = g.gpuOn ? args : [args[4], args[2]];
        if (obj !== g.ground || geom !== geo) return draw.apply(this, args);
        const { start, count } = geo.drawRange;
        if (full) geo.setDrawRange(0, total);
        try {
          if (log) log.push({ main: (g.gpuOn ? R.camera : args[0]) === g.camera, n: geo.drawRange.count / 3 });
          return draw.apply(this, args);
        } finally {
          if (full) geo.setDrawRange(start, count);
        }
      };
      const drain = async () => {
        if (g.gpuOn) await R.device.queue.onSubmittedWorkDone();
        else {
          // The live sky probe can have an asynchronous pixel-pack buffer bound.
          const binding = ctx.getParameter(ctx.PIXEL_PACK_BUFFER_BINDING);
          ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null);
          try { ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel); }
          finally { ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, binding); }
        }
      };
      const frame = (v, i) => {
        Object.assign(g.view, v);
        g.view.x += i * 0.83;
        g.view.y += i * 0.31;
        g.modeSuspended = false;
        g.warming = true;
        try {
          g.frame(clock);
        } finally {
          g.modeSuspended = true;
          g.warming = false;
        }
      };
      window.terrainBench = async (v, kind) => {
        if (kind === 'warm') {
          full = false;
          for (let i = 0; i < 30; i++) {
            frame(v, i % 8);
            await wait();
          }
          await R.settle?.();
          await drain();
          return;
        }
        full = kind === 'full';
        if (kind === 'shot' || kind === 'fullShot') {
          full = kind === 'fullShot';
          for (let i = 0; i < 8; i++) {
            frame(v, 0);
            await wait();
          }
          await drain();
          return;
        }
        log = [];
        await drain();
        const t = performance.now();
        for (let i = 0; i < 8; i++) frame(v, i);
        await drain();
        const ms = (performance.now() - t) / 8;
        const calls = log;
        log = null;
        return { ms, calls };
      };
      return { backend: g.gpuOn ? 'gpu' : 'gl', total: total / 3 };
    });
    assert.equal(setup.backend, gl ? 'gl' : 'gpu');
    const stats = [];
    for (const [name, x, y, dist, pitch, yaw] of [
      ['close', 1460, 3120, 135, 1.05, -1.1],
      ['tactical', 1920, 3260, 840, 0.94, -1.72],
      ['overview', 3080, 3100, 5300, 1.18, -1.53]
    ]) {
      const v = { x, y, dist, pitch, yaw },
        run = kind => root.evaluate((_, a) => terrainBench(...a), [v, kind]);
      await run('warm');
      const batches = { full: [], culled: [] },
        calls = {};
      for (const k of ['full', 'culled', 'culled', 'full', 'full', 'culled', 'culled', 'full']) {
        const r = await run(k);
        batches[k].push(r.ms);
        calls[k] = r.calls;
      }
      const diff = (a, b) => {
        let n = 0;
        for (let i = 0; i < a.data.length; i += 4)
          if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++;
        return n;
      };
      let shots;
      const deadline = Date.now() + 75000;
      do {
        shots = [];
        for (const k of ['fullShot', 'shot', 'shot']) {
          await run(k);
          shots.push(PNG.sync.read(await p.screenshot({ path: path.join(out, `${name}-${k}.png`) })));
        }
        // Initial asynchronous pipelines must finish before equality means anything.
        const img = shots[2];
        let textured = 0;
        for (let y = img.height >> 1; y < img.height * 0.85; y += 2)
          for (let x = 10; x < img.width - 10; x += 2) {
            const i = 4 * (y * img.width + x);
            if (Math.abs(img.data[i] - img.data[i + 4]) > 3) textured++;
          }
        if (textured > 160 && diff(shots[1], shots[2]) <= 8 && diff(shots[0], shots[1]) <= 8) break;
        if (Date.now() > deadline)
          throw Error(name + ': reference did not converge; textured=' + textured + ' changed=' + diff(shots[0], shots[1]));
      } while (true);
      const median = a => {
        const s = [...a].sort((a, b) => a - b);
        return +((s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2).toFixed(2);
      };
      const triangles = (mode, main) => {
        const a = calls[mode].filter(d => d.main === main);
        return a.length ? median(a.map(d => d.n)) : null;
      };
      const stat = {
        name,
        reference: triangles('full', true),
        main: triangles('culled', true),
        mirror: triangles('culled', false),
        ms: { full: median(batches.full), culled: median(batches.culled) },
        diff: diff(shots[0], shots[1]),
        repeat: diff(shots[1], shots[2]),
        batches
      };
      stats.push(stat);
      console.log(name, JSON.stringify(stat));
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ setup, stats }, null, 2));
    assert.deepEqual(errors, []);
    assert(stats[0].main < setup.total / 5, 'close camera submits most of the map');
    assert(stats[1].main < setup.total * 0.65, 'tactical camera submits most of the map');
    assert(stats[1].mirror > 0 && stats[1].mirror < setup.total, 'water mirror must select its own partial range');
    assert(
      stats.every(s => s.diff <= 8 && s.repeat <= 8),
      'visible pixels changed when skipping out-of-view terrain'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
