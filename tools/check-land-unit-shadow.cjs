// Compare only terrain pixels under a real, normally batched AT-ST in mounted Endor.
// Reverse the world-space sun along X; the silhouette must cross the vehicle, not
// stay attached to the camera or darken both sides. No simulation time between A/B.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 800, height: 500 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (validating|parsing WGSL)/i.test(m.text())) errors.push(m.text());
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const report = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async () => {
        const tick = () => new Promise(requestAnimationFrame),
          end = performance.now() + 120000;
        while (!(window.game?.remasteredGround && game.world.time > 0.1)) {
          if (performance.now() > end) throw Error('No active remaster');
          await tick();
        }
        const g = game,
          T = await import('three'),
          { gfx } = await import('/js/gfx.js'),
          { lighting: L } = await import('/js/model.js'),
          { heightAt } = await import('/js/game/terrain.js');
        const x = 1494,
          y = 3405,
          z = heightAt(g.terrain, x, y);
        const squad = await g.world.spawn('AT_ST_Walker', x, y, 0, g.me),
          u = squad?.members[0];
        if (!u?.inst) throw Error('No mounted AT-ST');
        await (await import('/js/dds.js')).texturesReady();
        while (g.warming || u.holder.userData.ready === false) {
          if (performance.now() > end) throw Error('Unit preparation timed out');
          await tick();
        }
        g.modeSuspended = true;
        await tick();
        g.following = null;
        Object.assign(g.view, { x, y, dist: 140, yaw: 0, pitch: 0.85 });
        gfx.shadows = true;
        gfx.shadow = 2;
        const R = g.gpuOn ? g.gpu : g.renderer,
          width = 160,
          half = 73,
          cam = new T.OrthographicCamera(-half, half, half, -half, 1, 1000),
          target = new T.WebGLRenderTarget(width, width),
          draw = R.render,
          frameTime = g.last;
        cam.position.set(x, y, z + 400);
        cam.lookAt(x, y, z);
        cam.updateMatrixWorld();
        let captured = 0,
          showCaster = true;
        const jobs = [];
        if (R.isWebGLRenderer) {
          R.debug.checkShaderErrors = true;
          const compile = R.compileAsync.bind(R);
          R.compileAsync = (...args) => {
            const job = compile(...args);
            jobs.push(job);
            return job;
          };
        }
        const collect = g.batches.collect;
        g.batches.collect = function (...args) {
          u.holder.visible = showCaster;
          return collect.apply(this, args);
        };
        R.render = function (scene, eye) {
          // In dense forest both sides of a walker can already be in a crown's shadow.
          // Isolate its normal draw pools in the light pass, not a stand-in model.
          if (scene === g.scene && (eye === g.cast?.camera || eye === g.groundNear?.cam)) {
            const hidden = [],
              pools = new Set(),
              box = g.batches.box;
            u.holder.traverse(o => {
              if (o._batch?.pool) pools.add(o._batch.pool.im);
            });
            for (const o of scene.children)
              if (o.visible && o !== u.holder && o !== box) {
                o.visible = false;
                hidden.push(o);
              }
            for (const o of box.children)
              if (o.visible && !pools.has(o)) {
                o.visible = false;
                hidden.push(o);
              }
            try {
              return draw.call(R, scene, eye);
            } finally {
              for (const o of hidden) o.visible = true;
            }
          }
          if (scene === g.scene && eye === g.camera) {
            const before = R.getRenderTarget(),
              hidden = [];
            try {
              for (const o of scene.children)
                if (o.visible && o !== g.ground) {
                  o.visible = false;
                  hidden.push(o);
                }
              R.setRenderTarget(target);
              R.clear();
              draw.call(R, scene, cam);
              captured++;
            } finally {
              for (const o of hidden) o.visible = true;
              R.setRenderTarget(before);
            }
          }
          return draw.call(R, scene, eye);
        };
        async function shot(show) {
          showCaster = show;
          const before = captured;
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(frameTime);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
          if (captured === before) throw Error('No tactical colour draw');
          const a = new Uint8Array(width * width * 4);
          await R.readRenderTargetPixelsAsync(target, 0, 0, width, width, a);
          return a;
        }
        try {
          const samples = [];
          for (const sign of [1, -1]) {
            L.sunDir.value.set(0.75 * sign, 0, 0.66).normalize();
            for (let i = 0; i < 10; i++) {
              await shot(true);
              await R.settle?.();
              await tick();
              await Promise.all(jobs.splice(0));
            }
            const lit = await shot(false),
              on = await shot(true),
              again = await shot(false);
            let count = 0,
              total = 0,
              sx = 0,
              unstable = 0;
            for (let i = 0; i < on.length; i += 4) {
              const d = lit[i] + lit[i + 1] + lit[i + 2] - on[i] - on[i + 1] - on[i + 2];
              if (Math.abs(lit[i] - again[i]) + Math.abs(lit[i + 1] - again[i + 1]) + Math.abs(lit[i + 2] - again[i + 2]) > 8) unstable++;
              if (d > 8) {
                count++;
                total += d;
                sx += d * (((((i / 4) % width) + 0.5) / width) * 2 - 1) * half;
              }
            }
            samples.push({ sunX: sign, pixels: count, shadowX: sx / total, unstable, tones: new Set(lit).size });
          }
          return { backend: g.gpuOn ? 'webgpu' : 'webgl', samples };
        } finally {
          R.render = draw;
          g.batches.collect = collect;
          u.holder.visible = true;
          target.dispose();
        }
      });
    console.log(JSON.stringify(report));
    assert.deepEqual(errors, []);
    assert.equal(report.backend, gl ? 'webgl' : 'webgpu');
    for (const s of report.samples)
      assert(s.unstable < 30 && s.pixels > 60 && s.sunX * s.shadowX < -4, 'Missing, unstable, or reversed walker shadow');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
