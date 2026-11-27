// Use a mounted AT-ST, its skinned materials and the live land pass. Freeze the unit, sun,
// sky and camera. With diffuse ground bounce off, ONLY a specular ground receiver can
// carry a change of the ground swatch onto the model. No private assets are exported.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const gl = process.env.LOOK_BACKEND === 'webgl',
    b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 900, height: 540 } }),
      bad = [];
    page.on('pageerror', e => bad.push(e.message));
    page.on('console', m => {
      if (/GPUValidationError|Shader Error|GL_INVALID_OPERATION|Error while (?:validating|parsing)/.test(m.text()))
        bad.push(m.text().slice(0, 700));
    });
    if (gl) await page.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await page.goto('http://127.0.0.1:8590/#endor-ultra');
    const report = await page
      .frameLocator('#game')
      .locator('body')
      .evaluate(async (_, infantry) => {
        const wait = () => new Promise(requestAnimationFrame),
          end = performance.now() + 75000;
        while (!window.game?.ground?.userData.endorLandscape?.active || !game.landFinish?.texture || !game.terrain.paint.soilGrid) {
          if (performance.now() > end) throw Error('Land environment did not warm');
          await wait();
        }
        const g = game,
          w = g.world,
          a = w.units.find(u => u.foot && u.side === g.me && u.holder?.visible),
          { gfx } = await import('/js/gfx.js'),
          T = await import('three');
        await w.spawn('AT_ST_Walker', a.x + 24, a.y + 23, 1, g.me);
        const walker = infantry ? a : w.units.find(u => u.type.name === 'AT_ST_Walker' && u.side === g.me && u.holder);
        if (!walker) throw Error('Mounted walker missing');
        await (await import('/js/dds.js')).texturesReady();
        for (let i = 0; i < 14; i++) await wait();
        while (g.warming && performance.now() < end) await wait();
        g.modeSuspended = true;
        await wait();
        // Position after live warm-up: its camera restore can otherwise replace the
        // intended close-up with the default command zoom before the matched draws.
        g.following = null;
        Object.assign(g.view, { x: walker.x, y: walker.y, dist: infantry ? 44 : 120, pitch: 0.55, yaw: -1.3 });
        const now = g.last,
          R = g.gpuOn ? g.gpu : g.renderer,
          W = 384,
          H = 224,
          target = new T.WebGLRenderTarget(W, H),
          real = R.render,
          grid = g.terrain.paint.soilGrid,
          original = grid.tex;
        const swatch = (rgb, offset = 0) => {
          const { width, height, data } = original.image,
            bytes = data.slice();
          const x = (walker.x + offset) * grid.scale * width,
            y = walker.y * grid.scale * height,
            reach = 180 * grid.scale * width;
          for (let j = 0; j < height; j++)
            for (let i = 0; i < width; i++) if (Math.hypot(i + 0.5 - x, j + 0.5 - y) < reach) bytes.set(rgb, 4 * (j * width + i));
          const tex = new T.DataTexture(bytes, width, height);
          tex.magFilter = tex.minFilter = T.LinearFilter;
          tex.needsUpdate = true;
          return tex;
        };
        const warm = swatch([210, 115, 40]),
          cool = swatch([40, 90, 200]),
          far = swatch([40, 90, 200], 680),
          hidden = [];
        let passes = 0,
          mapped = 0;
        walker.holder.traverse(o => {
          if (o.material?.defines?.MAP_FINISH) mapped++;
        });
        R.render = function (scene, eye) {
          if (scene === g.scene && eye === g.camera) {
            const old = R.getRenderTarget();
            try {
              const box = g.batches?.box,
                pools = new Set();
              walker.holder.traverse(o => {
                if (o._batch?.pool) pools.add(o._batch.pool.im);
              });
              for (const c of scene.children)
                if (c !== walker.holder && c !== box && c.visible) {
                  hidden.push(c);
                  c.visible = false;
                }
              for (const c of box?.children || [])
                if (!pools.has(c) && c.visible) {
                  hidden.push(c);
                  c.visible = false;
                }
              R.setRenderTarget(target);
              R.clear();
              real.call(R, scene, eye);
              passes++;
            } finally {
              for (const c of hidden) c.visible = true;
              hidden.length = 0;
              R.setRenderTarget(old);
            }
          }
          return real.call(R, scene, eye);
        };
        const capture = async (tex, on) => {
          grid.tex = tex;
          gfx.mapReflections = on;
          const start = passes;
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(now);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
          if (passes === start) throw Error('No main pass');
          await R.settle?.();
          const bytes = new Uint8Array(W * H * 4);
          await R.readRenderTargetPixelsAsync(target, 0, 0, W, H, bytes);
          return bytes;
        };
        function difference(a, b) {
          let changed = 0,
            cooler = 0;
          for (let i = 0; i < a.length; i += 4) {
            const red = a[i] - b[i],
              blue = b[i + 2] - a[i + 2];
            if (Math.max(Math.abs(red), Math.abs(blue)) > 2) changed++;
            if (red > 2 && blue > 2) cooler++;
          }
          return { changed, cooler };
        }
        try {
          gfx.localSoil = false;
          // Wait for the real skinned draw, not a fixed number of frames: the pipeline
          // may become ready after the capture target is first used on this backend.
          let coverage = 0;
          for (let i = 0; i < 100; i++) {
            const frame = await capture(original, true);
            coverage = 0;
            for (let j = 0; j < frame.length; j += 4)
              if (Math.abs(frame[j] - frame[0]) + Math.abs(frame[j + 1] - frame[1]) + Math.abs(frame[j + 2] - frame[2]) > 8) coverage++;
            if (i >= 3 && coverage > 150 && g.landFinish?.texture) break;
            await wait();
          }
          if (coverage <= 150 || !g.landFinish?.texture) throw Error('No stable unit and filtered sky in probe');
          // Target creation and receiver toggles may warm separate GPU pipelines.
          // Require an unchanged same-input draw before each A/B, plus the A/B/A
          // repeat check below. Do not retry based on the measured A/B difference.
          const settle = async on => {
            let prev=await capture(warm,on),stable=0;
            for(let i=0;i<60;i++){
              await wait();const same=await capture(warm,on);
              stable=difference(prev,same).changed<8?stable+1:0;
              if(stable>=4)return same;prev=same;
            }
            throw Error('Reflection control did not settle');
          };
          const off = difference(await settle(false), await capture(cool, false)),
            a = await settle(true),
            b = await capture(cool, true),
            again = await capture(warm, true);
          const distant = difference(await capture(original, true), await capture(far, true));
          return {
            backend: g.gpuOn ? 'gpu' : 'gl',
            unit: walker.type.name,
            mapped,
            coverage,
            off,
            on: difference(a, b),
            repeat: difference(a, again),
            distant
          };
        } finally {
          grid.tex = original;
          R.render = real;
          R.releaseTarget?.(target);
          target.dispose();
          warm.dispose();
          cool.dispose();
          far.dispose();
        }
      }, process.env.LOOK_UNIT === 'infantry');
    console.log(JSON.stringify(report));
    assert.deepEqual(bad, []);
    assert.equal(report.backend, gl ? 'gl' : 'gpu');
    assert(report.mapped > 0);
    assert(
      report.off.changed < 8 && report.repeat.changed < 8 && report.distant.changed < 8,
      'unmatched controls or distant ground leaking into reflection'
    );
    assert(report.on.cooler > 100, 'reflective unit did not pick up its ground environment');
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
