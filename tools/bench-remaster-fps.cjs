// Matched, sequential A/B in the mounted Universal window. The bundled reference
// patch is applied to a temporary copy only; REF_DIR can supply a different snapshot.
const { chromium } = require('playwright-core');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const shadingWork = ['model.js', 'gpu/programs.js', 'landlight.js', 'game/terrain.js', 'game/endor-relief.js'];
const reuseWork = ['forestfloor.js', 'game/endor-relief.js', 'gpu/renderer.js', 'game/landgame.js'];
const reuse = process.env.BENCH_BASE === 'reuse',
  shading = process.env.BENCH_BASE === 'shading';
const files = reuse
  ? reuseWork
  : shading
    ? [...new Set([...shadingWork, ...reuseWork])]
    : [
        ...new Set([
          'model.js',
          'gpu/programs.js',
          'game/terrain.js',
          'game/landgame.js',
          'game/endor-thicket.js',
          'game/endor-cover.js',
          'woodland-light.js',
          'endor-weather.js',
          ...shadingWork,
          ...reuseWork
        ])
      ];
const maps = ['endor', 'yavin', 'hoth', 'tatooine'];
const gl = process.env.LOOK_BACKEND === 'webgl';
const rounds = Number(process.env.BENCH_PAIRS || 4),
  frames = Number(process.env.BENCH_FRAMES || 240),
  warm = Number(process.env.BENCH_WARM || 120);
assert(Number.isInteger(rounds) && rounds >= 2 && [frames, warm].every(n => Number.isInteger(n) && n > 0));
const selection = process.env.BENCH_MAP ? [process.env.BENCH_MAP] : maps;
assert(selection.every(m => maps.includes(m)));
const variants = {},
  hashes = {};
const current = path.resolve(__dirname, '../public/js');
// A neighbouring edit must not turn a later leg into a third build. Snapshot all
// runtime JS once, not only the modules whose bytes differ between A and B.
const shared = new Map();
function snapshot(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) snapshot(f);
    else if (e.name.endsWith('.js')) shared.set(path.relative(current, f).split(path.sep).join('/'), fs.readFileSync(f));
  }
}
snapshot(current);
const scratch = process.env.REF_DIR ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-reference-'));
try {
  const load = (name, root) => {
    variants[name] = {};
    hashes[name] = {};
    for (const f of files) {
      const bytes = fs.readFileSync(path.join(root, f));
      variants[name][f] = bytes;
      hashes[name][f] = crypto.createHash('sha256').update(bytes).digest('hex');
    }
  };
  load('after', current);
  if (scratch) {
    for (const f of files) {
      const dest = path.join(scratch, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fs.readFileSync(path.join(current, f), 'utf8').replace(/\r\n/g, '\n'));
    }
    const restore = patch =>
      require('node:child_process').execFileSync('git', ['apply', path.join(__dirname, 'fixtures', patch)], { cwd: scratch });
    restore('pre-remaster-reuse.patch');
    if (!reuse) {
      load('after', scratch);
      restore('pre-remaster-shading-work.patch');
      if (!shading) {
        // Both historical legs need the same pre-landmark forest population.
        restore('pre-remaster-landmarks.patch');
        load('after', scratch);
        restore('pre-land-shadow-fps.patch');
      }
    }
  }
  load('before', process.env.REF_DIR || scratch);
} finally {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
}
const out = process.env.BENCH_OUT || path.join(os.tmpdir(), 'remaster-fps-' + Date.now() + '.json');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const pivots = {},
    reports = [],
    record = { chrome: b.version(), viewport: [1280, 720], frames, warm, rounds, backend: gl ? 'webgl' : 'webgpu', hashes, reports };
  async function run(map, version, pair) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    try {
      await ctx.addInitScript(gl => {
        let seed = 99173;
        Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
        if (gl) sessionStorage.setItem('swr-webgpu-dropped', '1');
      }, gl);
      const hit = new Set();
      await ctx.route(url => url.pathname.startsWith('/js/') && url.pathname.endsWith('.js'), route => {
        const f = decodeURIComponent(new URL(route.request().url()).pathname.slice(4));
        const body = variants[version][f] || shared.get(f);
        if (!body) throw Error('Module absent from snapshot: ' + f);
        hit.add(f);
        return route.fulfill({ contentType: 'application/javascript', body });
      });
      const p = await ctx.newPage(),
        errors = [];
      p.on('pageerror', e => errors.push(e.message));
      p.on('console', m => {
        if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/i.test(m.text()))
          errors.push(m.text().slice(0, 700));
      });
      await p.goto('http://127.0.0.1:8590/#' + map + (map === 'endor' ? '-ultra' : '-remaster'));
      const stats = await p
        .frameLocator('#game')
        .locator('body')
        .evaluate(
          async (_, { map, frames, warm, pivot }) => {
            const wait = () => new Promise(requestAnimationFrame),
              deadline = performance.now() + 120000;
            while (!(window.game?.remasteredGround && game.world?.time > 0.1 && !game.warming && game.cast?.wideMatrix)) {
              if (performance.now() > deadline) throw Error('Remaster did not warm: ' + map);
              await wait();
            }
            const g = game,
              R = g.gpuOn ? g.gpu : g.renderer,
              { gfx } = await import('/js/gfx.js');
            g.modeSuspended = true;
            await wait();
            g.following = null;
            const u = g.world.units.find(u => u.foot && u.side === g.me) || g.view;
            const [cx, cy] = pivot || (map === 'endor' ? [1460, 3120] : [Math.round(u.x), Math.round(u.y)]);
            const env = g.map.environments.find(e => e.name === 'Noon_Clear') || g.map.environment;
            await g.applyEnvironment(env);
            g.world.setWeather(env.weather);
            // Same forward/back pan past the starting army, followed by a fixed-focus orbit.
            // Pass a fixed simulation clock so slower hardware does not do extra AI steps per route.
            const raf = window.requestAnimationFrame,
              norequeue = cb => (cb === g.frame ? 0 : raf.call(window, cb));
            let clock = g.last;
            function frame(i, n) {
              let t = i / n,
                pan = t < 0.5 ? Math.sin(2 * Math.PI * t) : 0,
                orbit = t >= 0.5 ? Math.sin(4 * Math.PI * t) : 0;
              Object.assign(g.view, { x: cx + 170 * pan, y: cy + 55 * pan, dist: 190, yaw: -1.1 + orbit * 0.7, pitch: 1 });
              g.modeSuspended = false;
              window.requestAnimationFrame = norequeue;
              try {
                g.frame((clock += 1000 / 60));
              } finally {
                window.requestAnimationFrame = raf;
                g.modeSuspended = true;
              }
            }
            for (let i = 0; i < warm; i++) {
              await wait();
              frame(i % 120, 120);
            }
            await R.settle?.();
            await g.gpu?.device.queue.onSubmittedWorkDone();
            const dt = [],
              sim = g.world.time,
              units = g.world.units.length;
            let last = await wait();
            for (let i = 0; i < frames; i++) {
              frame(i % 240, 240);
              const now = await wait();
              dt.push(now - last);
              last = now;
            }
            const elapsed = dt.reduce((a, b) => a + b, 0),
              sorted = dt.slice().sort((a, b) => a - b);
            const dev = g.gpuOn ? g.gpu.device.adapterInfo : null,
              ctx = g.renderer.getContext?.(),
              ext = ctx?.getExtension('WEBGL_debug_renderer_info');
            return {
              mapFile: g.setup.mapFile,
              backend: g.gpuOn ? 'webgpu' : 'webgl',
              gpu: dev?.description || (ext && ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
              adapter: dev ? { vendor: dev.vendor, architecture: dev.architecture, isFallback: dev.isFallbackAdapter } : null,
              pivot: [cx, cy],
              env: env.name,
              units,
              battleSeconds: g.world.time - sim,
              active: g.remasteredGround,
              canvas: [R.domElement.width, R.domElement.height],
              shadowSize: g.cast.size,
              nearSize: g.groundNear?.target.width || 0,
              shadows: gfx.shadows,
              quality: gfx.battleRealism,
              elapsed,
              dt,
              fps: (frames * 1000) / elapsed,
              p95ms: sorted[Math.ceil(frames * 0.95) - 1]
            };
          },
          { map, frames, warm, pivot: pivots[map] }
        );
      assert.deepEqual(errors, []);
      assert.equal(stats.backend, gl ? 'webgl' : 'webgpu');
      assert(stats.active && stats.shadows && stats.battleSeconds > 0 && stats.units > 0);
      assert(stats.mapFile.toLowerCase().includes(map));
      for (const f of files)
        if (map === 'endor' || !['game/endor-thicket.js', 'game/endor-cover.js'].includes(f)) assert(hit.has(f), 'Missing A/B module ' + f);
      pivots[map] ||= stats.pivot;
      const matched = reports.find(s => s.map === map);
      if (matched)
        for (const k of ['mapFile', 'backend', 'gpu', 'units', 'pivot', 'env', 'canvas', 'shadowSize', 'nearSize', 'quality'])
          assert.deepEqual(stats[k], matched[k], 'Mismatched ' + k + ' on ' + map);
      reports.push({ map, version, pair, ...stats });
      fs.writeFileSync(out, JSON.stringify(record));
      console.log(
        `${pair + 1} ${map} ${version}: ${stats.fps.toFixed(2)} fps, p95 ${stats.p95ms.toFixed(1)} ms, ${stats.units} units, ${stats.gpu}`
      );
    } finally {
      await ctx.close();
    }
  }
  try {
    console.log('Raw results: ' + out);
    for (let n = 0; n < rounds; n++)
      for (const m of n % 2 ? [...selection].reverse() : selection) {
        const reverse = (maps.indexOf(m) + n) % 2;
        for (const v of reverse ? ['after', 'before'] : ['before', 'after']) await run(m, v, n);
      }
    const tally = rs => (rs.length * frames * 1000) / rs.reduce((s, r) => s + r.elapsed, 0);
    record.summary = {};
    for (const m of [...selection, 'overall']) {
      const rs = reports.filter(r => m === 'overall' || r.map === m),
        fps = v => tally(rs.filter(r => r.version === v));
      const before = fps('before'),
        after = fps('after'),
        paired = [];
      for (let n = 0; n < rounds; n++) {
        const p = rs.filter(r => r.pair === n);
        paired.push(100 * (tally(p.filter(r => r.version === 'after')) / tally(p.filter(r => r.version === 'before')) - 1));
      }
      record.summary[m] = { before, after, change: 100 * (after / before - 1), paired };
    }
    fs.writeFileSync(out, JSON.stringify(record));
    console.table(record.summary);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
