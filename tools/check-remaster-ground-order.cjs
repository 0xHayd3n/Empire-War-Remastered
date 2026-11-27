// Same mounted scene, poses, shaders, targets and camera. Change ONLY opaque terrain order.
// Verify the relief and coarse draws stay together, in front of decals in the opaque queue,
// and compare final pixels to the previous order (including the reflection and post passes).
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl',
  world = process.env.LOOK_WORLD || 'endor';
assert(['endor', 'yavin', 'hoth', 'tatooine'].includes(world));
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 900, height: 540 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 600));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#' + world + (world === 'endor' ? '-ultra' : '-remaster'));
    const r = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async (_, world) => {
        const wait = () => new Promise(requestAnimationFrame),
          end = performance.now() + 120000;
        while (!(window.game?.remasteredGround && game.world.time > 1 && !game.warming)) {
          if (performance.now() > end) throw Error('No mounted map');
          await wait();
        }
        const g = game,
          R = g.gpuOn ? g.gpu : g.renderer,
          relief = g.ground.getObjectByName('Endor displaced ground'),
          draw = R.render;
        g.modeSuspended = true;
        await wait();
        g.following = null;
        const u = g.world.units.find(u => u.foot && u.side === g.me),
          W = R.domElement.width,
          H = R.domElement.height,
          ctx = R.getContext?.(),
          now = g.last;
        let reference = false,
          checked = 0;
        R.render = function (scene, cam, ...extra) {
          if (scene !== g.scene) return draw.call(R, scene, cam, ...extra);
          const coarse = g.ground.renderOrder,
            fine = relief.renderOrder;
          if (cam === g.camera) {
            if (!(coarse > 0 && coarse < 1 && fine === coarse)) throw Error('Opaque remastered ground not ordered before decals');
            checked++;
          }
          if (reference) g.ground.renderOrder = relief.renderOrder = 0;
          try {
            return draw.call(R, scene, cam, ...extra);
          } finally {
            g.ground.renderOrder = coarse;
            relief.renderOrder = fine;
          }
        };
        function frame() {
          g.warming = true;
          g.modeSuspended = false;
          try {
            g.frame(now);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
        }
        async function shot(old) {
          reference = old;
          const read = g.gpuOn && R.readNext();
          frame();
          if (read) return (await read).data;
          const a = new Uint8Array(W * H * 4);
          ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, a);
          return a;
        }
        const views =
            world === 'endor'
              ? [
                  [1460, 3120, 135],
                  [1880, 3260, 340],
                  [u.x, u.y, 510]
                ]
              : [
                  [u.x, u.y, 160],
                  [u.x + 110, u.y + 40, 510]
                ],
          out = [];
        function diff(a, b) {
          let changed = 0,
            max = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            if (d > 6) changed++;
            max = Math.max(max, d);
          }
          return { changed, max };
        }
        try {
          for (const [x, y, dist] of views) {
            Object.assign(g.view, { x, y, dist, yaw: -1.1, pitch: 1 });
            for (let i = 0; i < 20; i++) {
              frame();
              await wait();
            }
            await R.settle?.();
            let a, b, c, repeated;
            for (let i = 0; i < 40; i++) {
              a = await shot(true);
              b = await shot(false);
              c = await shot(true);
              repeated = diff(a, c);
              if (!repeated.changed) break;
              await wait();
            }
            out.push({ dist, pixels: W * H, tones: new Set(c).size, repeat: repeated.changed, ...diff(a, b) });
          }
        } finally {
          R.render = draw;
        }
        return { backend: g.gpuOn ? 'webgpu' : 'webgl', checked, out };
      }, world);
    console.log(world, r);
    assert.equal(r.backend, gl ? 'webgl' : 'webgpu');
    assert.deepEqual(errors, []);
    assert(r.checked > 0);
    for (const s of r.out) {
      assert(s.tones > 32 && !s.repeat, 'Unstable or empty control');
      assert(s.changed <= s.pixels * 0.0001, 'Draw order changed visible surfaces');
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
