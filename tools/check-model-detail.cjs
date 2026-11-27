// Mounted colour submission and paired rAF timings. No alternate server or synthetic mesh.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
const which = process.env.LOD_ROUTE || 'land',
  mod = process.env.LOD_PACK || 'stock',
  gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
      errors = [];
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.stack);
    });
    p.on('console', m => {
      if (m.type() === 'error') console.error(m.text());
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 200));
    });
    const f = p.frameLocator('#game');
    await p.goto('http://127.0.0.1:8590/' + (which === 'land' && mod === 'stock' ? '#tatooine-original' : ''));
    p.setDefaultTimeout(150000);
    if (which === 'space' && mod === 'stock') {
      await f.locator('.title-menu [data-id="TITLE_PLAY"]:visible').waitFor();
      await require('./mounted-space-roster.cjs')(f);
    } else if (which === 'space' || mod !== 'stock') {
      for (const name of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${name}"]:visible`).click();
      const board = f.locator('.op-setup');
      await board.getByRole('searchbox').fill('Abregado Rae');
      await board.locator(`[data-world="Abregado_Rae"][data-domain="${which}"][data-source="${mod}"]`).first().click();
      await f.locator(`.op-setup[data-profile="${mod}"] .op-go:enabled`).click();
    }
    const result = await f.locator('body').evaluate(
      async (_, { which, frames }) => {
        const tick = () => new Promise(requestAnimationFrame),
          start = performance.now();
        while (!(window.game?.world?.time > (which === 'space' ? 12 : 2))) {
          if (document.body.innerText.includes('Failed to start:') || performance.now() - start > 100000)
            throw Error('No battle: ' + document.body.innerText.slice(-700));
          await tick();
        }
        const g = game,
          w = g.world,
          land = which === 'land',
          r = land ? g : g.renderer,
          R = land ? (g.gpuOn ? g.gpu : g.renderer) : r.renderer,
          { gfx } = await import('/js/gfx.js'),
          T = await import('three');
        if (!gfx.modelLod) throw Error('LOD not default');
        g.modeSuspended = true;
        await tick();
        const u = land
          ? w.units.find(u => u.side === g.me && u.holder?.visible) || w.units[0]
          : w.units.find(u => u.obj?.visible && !u.hyper && !u.dead && u.player === g.human);
        const view = land ? g.view : r.rig;
        Object.assign(view, { x: u.x, y: u.y, z: u.z || 0, dist: land ? 2800 : 4900, pitch: 1, free: true, shake: 0 });
        const draw = () => {
          if (!land) return r.render(w, 0);
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(g.last);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
        };
        let stats,
          measuring = false;
        const old = R.render;
        R.render = function (scene, cam, ...rest) {
          if (measuring && scene === r.scene && cam === r.camera) {
            let saved = 0,
              count = 0,
              skins = 0;
            scene.traverseVisible(o => {
              if (!o.detailColor || o.geometry !== o.detailColor || !o.count) return;
              const high = (land ? g.batches : r.instances).list.find(b => b.im === o)?.high;
              if (high) {
                saved += ((high.index.count - o.geometry.index.count) * o.count) / 3;
                count += o.count;
                if (high.attributes.skinIndex) skins += o.count;
              }
            });
            stats = { saved, count, skins };
          }
          return old.call(this, scene, cam, ...rest);
        };
        if (!land && r.modelDetail) {
          const picked = r.modelDetail.pick;
          const meta = {};
          r.modelDetail.pick = function (m, c, h, px) {
            const low = picked.call(this, m, c, h, px);
            if (measuring) {
              const k = px === undefined ? 'direct' : 'pool';
              meta[k] = (meta[k] || 0) + 1;
              if (low !== m.geometry) meta[k + 'Low'] = (meta[k + 'Low'] || 0) + 1;
              if (Number.isFinite(px)) meta.min = Math.min(meta.min ?? Infinity, px);
            }
            return low;
          };
          r.modelDetail.testMeta = meta;
        }
        const legs = [];
        for (const enabled of [true, false, false, true]) {
          gfx.modelLod = enabled;
          for (let i = 0; i < 90; i++) {
            draw();
            await tick();
            if (i >= 20 && !r.modelDetail?.busy) break;
          }
          measuring = true;
          draw();
          measuring = false;
          const list = [];
          let last = await tick();
          for (let i = 0; i < frames; i++) {
            draw();
            const now = await tick();
            list.push(now - last);
            last = now;
          }
          legs.push({
            enabled,
            ...stats,
            fps: (frames * 1000) / list.reduce((a, b) => a + b),
            p95: list.sort((a, b) => a - b)[Math.ceil(frames * 0.95) - 1]
          });
        }
        // Check one actual mounted asset at close, distant, and close again using the same live scene selector.
        const { loadModel } = await import('/js/model.js');
        const model = await loadModel(land ? 'EV_AT-ST.ALO' : 'EV_STARDESTROYER.ALO');
        let zoom = null;
        if (model) {
          const scene = new T.Scene(),
            cam = new T.PerspectiveCamera(55, 1, 1, 1e6);
          scene.add(model.root);
          scene.updateMatrixWorld();
          const mesh = [];
          model.root.traverseVisible(o => {
            if (o.isMesh && !o.material.transparent) mesh.push(o);
          });
          const at = d => {
            cam.position.set(0, -d, 0);
            cam.lookAt(0, 0, 0);
            cam.updateMatrixWorld();
            return r.modelDetail.draw(scene, cam, 720, () => mesh.reduce((s, m) => s + m.geometry.index.count / 3, 0));
          };
          at(100000);
          while (r.modelDetail.busy) await tick();
          zoom = [at(1), at(100000), at(1)];
        }
        return {
          meta: r.modelDetail.testMeta,
          batches: r.instances?.list.length,
          drawn: r.instances?.drawn,
          hyper: w.units.filter(u => u.hyper).length,
          units: w.units.length,
          route: which,
          backend: land ? (g.gpuOn ? 'webgpu' : 'webgl') : r.gpu ? 'webgpu' : 'webgl',
          pack: location.origin,
          legs,
          zoom
        };
      },
      { which, frames: +(process.env.BENCH_FRAMES || 100) }
    );
    console.log(JSON.stringify(result));
    assert.deepEqual(errors, []);
    assert.equal(result.backend, gl ? 'webgl' : 'webgpu');
    assert(result.legs.filter(l => l.enabled).every(l => l.saved > 0));
    assert(result.legs.filter(l => !l.enabled).every(l => l.saved === 0));
    if (result.zoom) assert(result.zoom[1] < result.zoom[0] && result.zoom[0] === result.zoom[2]);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
