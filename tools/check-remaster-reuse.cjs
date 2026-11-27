// Frozen terrain program and sky pass A/B, in the very same mounted scene.
// Only reference shader sources are loaded from the isolated reference module namespace;
// objects, textures, uniforms, post processing, pose and simulation time never change.
const { chromium } = require('playwright-core'),
  fs = require('fs'),
  path = require('path'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl';
const os = require('node:os'),
  cp = require('node:child_process');
const current = path.resolve(__dirname, '../public/js'),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'remaster-pixel-reference-'));
const files = ['forestfloor.js', 'game/endor-relief.js', 'game/landgame.js', 'gpu/renderer.js'];
for (const f of files) {
  const dest = path.join(tmp, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(path.join(current, f), 'utf8').split(String.fromCharCode(13)).join(''));
}
cp.execFileSync('git', ['apply', path.resolve(__dirname, 'fixtures/pre-remaster-reuse.patch')], { cwd: tmp });
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const map of (process.env.LOOK_WORLD || 'endor,yavin,hoth,tatooine').split(',')) {
      let p = await b.newPage({ viewport: { width: 1280, height: 720 } }),
        errs = [];
      p.on('pageerror', e => errs.push(e.message));
      p.on('console', m => {
        if (/GPUValidationError|Shader Error|Error while (?:validating|parsing WGSL)|^webgpu .+ \d+:\d+/.test(m.text()))
          errs.push(m.text().slice(0, 500));
      });
      if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
      await p.route('**/__ref/js/**', rt => {
        let rel = new URL(rt.request().url()).pathname.split('/__ref/js/')[1];
        if (rel.includes('..')) throw Error('invalid');
        let s = fs.readFileSync(path.join(files.includes(rel) ? tmp : current, rel), 'utf8');
        if (rel === 'game/terrain.js') s += '\nexport {terrainFragment};';
        return rt.fulfill({ body: s, contentType: 'text/javascript' });
      });
      await p.route('**/__ref/vendor/**', rt => rt.continue({ url: rt.request().url().replace('/__ref/', '/') }));
      await p.goto('http://127.0.0.1:8590/#' + map + (map === 'endor' ? '-ultra' : '-remaster'));
      const out = await p
        .frameLocator('#game')
        .locator('body')
        .evaluate(
          async (_, opts) => {
            const wait = () => new Promise(requestAnimationFrame),
              end = performance.now() + 120000;
            while (!(window.game?.remasteredGround && game.world.time > 1 && !game.warming && game.cast?.wideMatrix)) {
              if (performance.now() > end) throw Error('not ready');
              await wait();
            }
            const g = game,
              R = g.gpuOn ? g.gpu : g.renderer;
            g.modeSuspended = true;
            await wait();
            g.following = null;
            const unit = g.world.units.find(u => u.foot && u.side === g.me);
            const [x, y] = opts.map === 'endor' ? [1460, 3120] : [unit.x, unit.y];
            await g.applyEnvironment(g.map.environments.find(e => e.name === 'Noon_Clear') || g.map.environment);
            const oldFamilies = g.gpuOn ? (await import('/__ref/js/gpu/programs.js')).families : null,
              oldFrag = g.gpuOn ? null : (await import('/__ref/js/game/terrain.js')).terrainFragment;
            let old = false,
              count = 0,
              fused = 0;
            const fuse = g.gpuOn && R.renderWithBackdrop?.bind(R);
            const states = new WeakMap(),
              mats = new Map();
            g.scene.traverse(o => {
              for (const m of [o.material].flat()) {
                if (m?.uniforms?.texU) {
                  mats.set(m, m.fragmentShader);
                }
              }
            });
            if (g.gpuOn) {
              const pipeline = R.pipeline;
              R.pipeline = function (S, m, ...args) {
                if (old && mats.has(m)) {
                  count++;
                  if (!states.has(S)) {
                    const fam = oldFamilies.find(f => f.name === S.fam.name);
                    states.set(S, { ...S, variants: new Map(), fam: { ...fam, key: (...a) => fam.key(...a) + '|ref' } });
                  }
                  S = states.get(S);
                }
                return pipeline.call(this, S, m, ...args);
              };
            }
            const W = R.domElement.width,
              H = R.domElement.height,
              ctx = R.getContext?.(),
              clock = g.last;
            function set(v) {
              old = v;
              if (fuse)
                R.renderWithBackdrop = v
                  ? null
                  : (...a) => {
                      fused++;
                      return fuse(...a);
                    };
              if (!g.gpuOn)
                for (const [m, s] of mats) {
                  const frag = v ? oldFrag(!!m.defines?.BIOME_RECIPE) : s;
                  if (m.fragmentShader !== frag) {
                    m.fragmentShader = frag;
                    m.needsUpdate = true;
                    count++;
                  }
                }
            }
            function frame(i, dist = 190) {
              const t = i / 120,
                pan = t < 0.5 ? Math.sin(2 * Math.PI * t) : 0,
                orbit = t >= 0.5 ? Math.sin(4 * Math.PI * t) : 0;
              Object.assign(g.view, { x: x + 170 * pan, y: y + 55 * pan, dist, yaw: -1.1 + orbit * 0.7, pitch: dist === 750 ? 0.38 : 1 });
              g.warming = true;
              g.modeSuspended = false;
              try {
                g.frame(clock);
              } finally {
                g.warming = false;
                g.modeSuspended = true;
              }
            }
            const drain = () => (g.gpuOn ? R.device.queue.onSubmittedWorkDone() : ctx.finish());
            for (const v of [true, false]) {
              set(v);
              for (let i = 0; i < 90; i++) {
                frame(i);
                await wait();
              }
              await R.settle?.();
              await drain();
            }
            async function shot(v, i, d) {
              set(v);
              let read = g.gpuOn && R.readNext();
              frame(i, d);
              if (read) return (await read).data;
              const pixels = new Uint8Array(W * H * 4);
              ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels);
              return pixels;
            }
            function diff(a, b) {
              let changed = 0,
                max = 0,
                nonzero = 0;
              for (let i = 0; i < a.length; i += 4) {
                let d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
                if (d) nonzero++;
                if (d > 6) changed++;
                max = Math.max(max, d);
              }
              return { changed, max, nonzero };
            }
            let pixels = [];
            for (const [i, d] of [
              [0, 135],
              [67, 190],
              [34, 510],
              [10, 750]
            ]) {
              for (let k = 0; k < 25; k++) {
                frame(i, d);
                await wait();
              }
              let result;
              for (let k = 0; k < 12; k++) {
                let a = await shot(true, i, d),
                  b = await shot(false, i, d),
                  c = await shot(true, i, d);
                let rep = diff(a, c);
                result = { i, d, repeat: rep.changed, tones: new Set(c).size, ...diff(a, b) };
                if (!rep.nonzero) break;
                await wait();
              }
              pixels.push(result);
            }
            let times = [];
            if (opts.timing) {
              for (let v of [true, false, false, true, true, false, false, true]) {
                set(v);
                await drain();
                let start = performance.now();
                for (let i = 0; i < 120; i++) {
                  frame(i);
                  if (i % 6 === 5) await drain();
                }
                times.push({ old: v, ms: (performance.now() - start) / 120 });
              }
            }
            return { pixels, times, backend: g.gpuOn ? 'webgpu' : 'webgl', count, fused, total: W * H, mats: mats.size };
          },
          { map, timing: process.env.COMPARE_BATCHES === '1' }
        );
      console.log(JSON.stringify({ map, ...out, errs }));
      assert.deepEqual(errs, []);
      assert.equal(out.backend, gl ? 'webgl' : 'webgpu');
      assert(out.count > 0 && out.mats >= 2);
      for (let s of out.pixels) assert(s.tones > 32 && !s.repeat && s.changed <= out.total * 0.0001, 'Frame differs from reference');
      await p.close();
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
