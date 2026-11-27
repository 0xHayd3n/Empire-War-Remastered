// Mounted frozen tactical views: no changes at the border, off restores the image,
// and foreground foliage away from the old central cutaway becomes see-through.
const { chromium } = require('playwright-core'),
  path = require('node:path'),
  os = require('node:os'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'));
(async () => {
  const gl = process.env.LOOK_BACKEND === 'webgl',
    out = path.join(os.tmpdir(), 'canopy-view', gl ? 'gl' : 'gpu');
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
    const body = p.frameLocator('#game').locator('body');
    const backend = await body.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame),
        until = performance.now() + 90000;
      while (!window.game?.ground?.userData.endorLandscape?.active || !game.extraFx?.pr || game.world.time < 1) {
        if (performance.now() > until) throw Error('Endor not ready');
        await wait();
      }
      const g = game,
        R = g.gpuOn ? g.gpu : g.renderer,
        { gfx } = await import('/js/gfx.js');
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const env = g.map.environments.find(e => e.name === 'Noon_Clear');
      await g.applyEnvironment(env);
      g.world.setWeather(env.weather);
      g.forestSky.cover = g.forestSky.wet = g.groundRain.amount = 0;
      R.domElement.dataset.canopyTest = '1';
      const style = document.createElement('style');
      style.textContent = 'body *:not(:has([data-canopy-test])):not([data-canopy-test]){visibility:hidden!important}';
      document.head.append(style);
      const clock = g.last;
      window.canopyShot = async (pose, strength) => {
        Object.assign(g.view, pose);
        gfx.canopyFade = strength;
        for (let i = 0; i < 12; i++) {
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(clock);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
          await wait();
        }
        await R.settle?.();
      };
      return g.gpuOn ? 'gpu' : 'gl';
    });
    assert.equal(backend, gl ? 'gl' : 'gpu');
    for (const [name, pose] of Object.entries({
      forest: { x: 1750, y: 3160, dist: 270, yaw: -1.1, pitch: 1.12 },
      tactical: { x: 1730, y: 3190, dist: 510, yaw: -1.75, pitch: 1.05 }
    })) {
      const shot = async (n, tag) => {
        await body.evaluate((_, [v, k]) => canopyShot(v, k), [pose, n]);
        return PNG.sync.read(await p.screenshot({ path: path.join(out, `${name}-${tag}.png`) }));
      };
      // WebGL may still be compiling terrain after the forest has loaded. A bright
      // cyan background in either ground-only test view is the sky, not a valid control.
      const deadline = Date.now() + 90000;
      for (;;) {
        const im = await shot(0, 'warm');
        let sky = 0,
          total = 0;
        for (let i = 0; i < im.data.length; i += 4 * 109) {
          total++;
          if (im.data[i + 2] > 150 && im.data[i + 2] > im.data[i] + 20) sky++;
        }
        if (sky < total * 0.02) break;
        if (Date.now() > deadline) throw Error('No rendered ground in ' + name);
      }
      const a = await shot(0, 'off'),
        m = await shot(0.4, 'medium'),
        c = await shot(0.8, 'on'),
        r = await shot(0, 'reset');
      const diff = (x, y) => {
        let all = 0,
          outer = 0,
          wide = 0;
        for (let j = 0; j < x.height; j++)
          for (let i = 0; i < x.width; i++) {
            const k = (j * x.width + i) * 4;
            if ([0, 1, 2].some(c => Math.abs(x.data[k + c] - y.data[k + c]) > 3)) {
              const q = (((i + 0.5) * 2) / x.width - 1) ** 2 + (((j + 0.5) * 2) / x.height - 1) ** 2;
              all++;
              if (q > 1.06) outer++;
              if (q > 0.18 && q < 0.7) wide++;
            }
          }
        return { all, outer, wide };
      };
      const report = { medium: diff(a, m), on: diff(a, c), reset: diff(a, r) };
      console.log(backend, name, report, errors);
      assert(report.reset.all < 14, 'frozen view did not settle');
      assert(report.on.wide > 500 && report.on.all > report.medium.all * 1.08 && report.medium.all > 500, 'wide canopy fade is missing');
      assert(report.on.outer < 50, 'frame corners changed');
      if (name === 'tactical') {
        // Put an actual walker on the ground behind the foreground stand near the left
        // shoulder of the view. Compare it to these same frames without the walker.
        const placement = await body.evaluate(async () => {
          const g = game,
            T = await import('three'),
            { heightAt } = await import('/js/game/terrain.js');
          const eye = g.camera.position,
            ray = new T.Vector3(-0.23, 0.34, 0.5).unproject(g.camera).sub(eye).normalize();
          let lo = 0,
            hi = g.view.dist * 2;
          for (let i = 0; i < 22; i++) {
            const d = (lo + hi) / 2;
            if (eye.z + d * ray.z > heightAt(g.terrain, eye.x + d * ray.x, eye.y + d * ray.y)) lo = d;
            else hi = d;
          }
          const x = eye.x + hi * ray.x,
            y = eye.y + hi * ray.y;
          const w = await g.world.spawn('AT_ST_Walker', x, y, 0.45, g.me);
          if (!w) throw Error('No mounted walker');
          await (await import('/js/dds.js')).texturesReady();
          return [x, y];
        });
        let visible, blocked;
        const measure = (x, y) => {
          let n = 0,
            bright = 0;
          for (let j = (x.height * 0.21) | 0; j < x.height * 0.4; j++)
            for (let i = (x.width * 0.31) | 0; i < x.width * 0.46; i++) {
              const k = 4 * (j * x.width + i);
              if ([0, 1, 2].some(c => Math.abs(x.data[k + c] - y.data[k + c]) > 8)) n++;
              // Require bright metal as well, not merely a new dark shadow from an
              // as-yet-uncompiled walker. Few highlights are expected under a crown.
              if ([0, 1, 2].every(c => x.data[k + c] > 68 && x.data[k + c] - y.data[k + c] > 18)) bright++;
            }
          return { n, bright };
        };
        const walkerDeadline = Date.now() + 80000;
        do {
          const wo = await shot(0, 'walker-off'),
            wc = await shot(0.8, 'walker-on');
          blocked = measure(wo, a);
          visible = measure(wc, c);
          if (visible.bright > 24 && visible.n > 300 && visible.n > blocked.n * 1.5) break;
        } while (Date.now() < walkerDeadline);
        console.log('walker', placement, { blocked, visible });
        assert(
          visible.bright > 24 && visible.n > 300 && visible.n > blocked.n * 1.5,
          'more of the walker must be visible through the foreground'
        );
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
