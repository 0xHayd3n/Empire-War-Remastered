// Can sky really show through an interior land cell? Change ONLY the backdrop behind
// the main terrain draw. A colour change in the frozen image means uncovered samples.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'));
const gl = process.env.LOOK_BACKEND === 'webgl',
  aa = process.env.LOOK_AA !== 'off',
  out = path.join(os.tmpdir(), 'land-sky-cracks', (gl ? 'gl' : 'gpu') + (aa ? '' : '-no-aa'));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (?:validating|parsing WGSL)/.test(m.text()))
        errors.push(m.text().slice(0, 800));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const root = p.frameLocator('#game').locator('body');
    const backend = await root.evaluate(async (_, aa) => {
      const T = await import('three'),
        wait = () => new Promise(requestAnimationFrame),
        end = performance.now() + 80000;
      while (!window.game?.ground?.userData.endorLandscape?.active || !game.extraFx?.pr || game.world.time < 1) {
        if (performance.now() > end) throw Error('Endor not ready');
        await wait();
      }
      const g = game,
        R = g.gpuOn ? g.gpu : g.renderer,
        U = g.ground.material.uniforms,
        ground = g.ground,
        patch = ground.getObjectByName('Endor displaced ground');
      g.modeSuspended = true;
      await wait();
      g.following = null;
      (await import('/js/gfx.js')).gfx.aa = aa;
      const env = g.map.environments.find(e => e.name === 'Noon_Clear');
      await g.applyEnvironment(env);
      g.world.setWeather(env.weather);
      g.forestSky.cover = g.forestSky.wet = g.groundRain.amount = 0;
      const style = document.createElement('style');
      R.domElement.dataset.crackCheck = '1';
      style.textContent = 'body *:not(:has([data-crack-check])):not([data-crack-check]){visibility:hidden!important}';
      document.head.append(style);
      let bg = 0,
        mode = 'patch';
      const saved = new T.Color(),
        render = R.render,
        update = ground.userData.landscape;
      ground.userData.landscape = function (...args) {
        const result = update.apply(this, args);
        if (mode === 'coarse') {
          U.reliefPatch.value.set(0, 0, 0, 0);
          patch.visible = false;
        }
        if (mode === 'hole') patch.visible = false;
        return result;
      };
      R.render = function (s, e) {
        if (s !== g.scene || e !== g.camera || mode === 'player') return render.call(this, s, e);
        const hidden = s.children.filter(o => o !== ground && o.visible);
        for (const o of hidden) o.visible = false;
        const alpha = R.getClearAlpha();
        R.getClearColor(saved);
        R.setClearColor(bg, 1);
        R.clear();
        R.setClearColor(saved, alpha);
        try {
          return render.call(this, s, e);
        } finally {
          for (const o of hidden) o.visible = true;
        }
      };
      const time = g.last;
      window.crackShot = async (v, k, c) => {
        bg = c;
        mode = k;
        Object.assign(g.view, v);
        for (let i = 0; i < 6; i++) {
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(time);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
          await wait();
        }
        await R.settle?.();
        return { bounds: U.reliefPatch.value.toArray(), visible: patch.visible, samples: g.extraFx.targets.scene.samples };
      };
      return g.gpuOn ? 'gpu' : 'gl';
    }, aa);
    assert.equal(backend, gl ? 'gl' : 'gpu');
    const views = [
      { x: 1466, y: 3127, dist: 190, pitch: 1.12, yaw: -1.12 },
      { x: 1924, y: 3265, dist: 178, pitch: 0.98, yaw: -1.77 },
      { x: 3441, y: 1686, dist: 171, pitch: 1.08, yaw: 0.3 }
    ];
    const counts = [];
    for (const [idx, v] of views.entries()) {
      const shot = async (m, c, tag) => {
        const end = Date.now() + 85000;
        while (true) {
          const state = await root.evaluate((_, args) => crackShot(...args), [v, m, c]);
          const data = await p.screenshot({ path: path.join(out, `${idx}-${m}-${tag}.png`) }),
            img = PNG.sync.read(data);
          if (gl && m !== 'player' && c === 0) {
            const x = m === 'hole' ? 50 : img.width / 2;
            let visible = 0;
            for (let y = 40; y < img.height - 40; y += 4) visible += img.data[4 * (y * img.width + x)] > 8;
            if (visible < 12 && Date.now() < end) continue;
          }
          return { img, state };
        }
      };
      await shot('player', 0, 'scene');
      const diff = (a, b) => {
        let n = 0;
        for (let i = 0; i < a.data.length; i += 4) if (b.data[i + 1] - a.data[i + 1] > 4) n++;
        return n;
      };
      const stats = {};
      for (const m of ['coarse', 'hole', 'patch']) {
        const a = await shot(m, 0, 'black'),
          b = await shot(m, 0x00ff70, 'green'),
          repeat = await shot(m, 0x00ff70, 'repeat');
        stats[m] = diff(a.img, b.img);
        stats[m + 'Repeat'] = diff(b.img, repeat.img) + diff(repeat.img, b.img);
        if (m === 'patch') {
          assert(b.state.visible && b.state.bounds[2] > b.state.bounds[0]);
          stats.samples = b.state.samples;
        }
      }
      counts.push(stats);
    }
    console.log(backend, counts, out);
    assert.deepEqual(errors, []);
    for (const s of counts) {
      assert.equal(s.samples > 1, aa);
      assert(s.hole > 20000, 'positive control must expose sky');
      assert(s.coarse === 0 && s.patchRepeat === 0, 'unstable frame or no solid-ground control');
      assert(s.patch === 0, 'sky visible through the close terrain');
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
