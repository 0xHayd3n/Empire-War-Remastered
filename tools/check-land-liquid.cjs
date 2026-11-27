// Real mounted renderer + sheet materials. A two-axis test texture exposes UV collapse
// on turned liquid layers even on maps where the authored default happens to be zero.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const gl = process.env.LOOK_BACKEND === 'webgl',
    browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 800, height: 460 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Shader Error|GL_INVALID_OPERATION|Error while (?:parsing|validating)/.test(m.text()))
        errors.push(m.text().slice(0, 800));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const report = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async () => {
        const wait = () => new Promise(requestAnimationFrame),
          deadline = performance.now() + 75000;
        while (!window.game?.ground?.userData.endorLandscape?.active || !game.water) {
          if (performance.now() > deadline) throw Error('Endor Ultra not ready');
          await wait();
        }
        const g = game;
        g.modeSuspended = true;
        await wait();
        const T = await import('three'),
          { buildWater } = await import('/js/game/terrain.js'),
          R = g.gpuOn ? g.gpu : g.renderer;
        if (R.isMirror) throw Error('Expected local renderer for pixel readback');
        const wet = g.water.children[0].geometry.attributes.depth.array;
        const sc = new T.Scene(),
          cam = new T.OrthographicCamera(0, 20, 20, 0, 1, 80);
        cam.position.z = 40;
        cam.updateMatrixWorld();
        const group = buildWater({
          size: 2,
          heights: [-1, -1, -1, -1],
          water: { mode: 2, level: 0, textures: ['', '', ''], glint: [0, 0, 0], ripples: [{ tile: 20, turn: 0, speed: 0, heading: 0 }] }
        });
        const m = group.children[0].material,
          U = m.uniforms;
        const tex = (data, w = 1) => {
          const t = new T.DataTexture(data, w, w);
          t.wrapS = t.wrapT = T.RepeatWrapping;
          t.needsUpdate = true;
          return t;
        };
        const grid = [];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) grid.push(x * 16, y * 16, 200, 255);
        const base = tex(Uint8Array.from(grid), 16),
          clear = tex(Uint8Array.of(0, 0, 0, 0));
        U.base.value = base;
        U.crust.value = clear;
        sc.add(group);
        const target = new T.WebGLRenderTarget(16, 16),
          was = R.getRenderTarget();
        try {
          R.setRenderTarget(target);
          const pairs = [];
          for (const angle of [0, Math.PI / 2]) {
            U.flow.value.y = angle;
            const read = async x => {
              const px = new Uint8Array(4);
              await R.readRenderTargetPixelsAsync(target, x, 8, 1, 1, px);
              return [...px];
            };
            const end = performance.now() + 12000;
            for (;;) {
              R.clear();
              R.render(sc, cam);
              R.endFrame?.();
              await R.settle?.();
              await wait();
              const a = await read(4),
                b = await read(12);
              if (a[2] > 128 && b[2] > 128) {
                pairs.push([a.slice(0, 2), b.slice(0, 2)]);
                break;
              }
              if (performance.now() > end) throw Error('Liquid shader did not draw');
            }
          }
          return { backend: g.gpuOn ? 'gpu' : 'gl', dryVertices: wet.reduce((a, z) => a + (z < 0), 0), pairs };
        } finally {
          R.setRenderTarget(was);
          R.releaseTarget?.(target);
          target.dispose();
          base.dispose();
          clear.dispose();
          m.dispose();
          group.children[0].geometry.dispose();
        }
      });
    console.log(JSON.stringify(report));
    assert.deepEqual(errors, []);
    assert.equal(report.backend, gl ? 'gl' : 'gpu');
    assert.equal(report.dryVertices, 0, 'mounted Endor liquid reached dry terrain');
    const [[a, b], [c, d]] = report.pairs;
    assert(b[0] - a[0] > 80 && Math.abs(a[1] - b[1]) < 3, 'unturned UV fixture');
    assert(c[1] - d[1] > 80 && Math.abs(c[0] - d[0]) < 3, 'rotating 90° must exchange the two axes, not flatten the pattern');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
