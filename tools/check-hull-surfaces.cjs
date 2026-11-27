// The same two poses of one ordinary turn. Local mounted images stay outside the repo.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const startFleet = require('./mounted-space-roster.cjs'),
  gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const out = path.join(process.env.LOOK_SHOTS || path.join(os.tmpdir(), 'universal-hull-surfaces'), gl ? 'webgl' : 'webgpu');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION|Hull reflections unavailable/i.test(
          m.text()
        ) &&
        errors.length < 8
      ) {
        errors.push(m.text().slice(0, 2400));
        console.error(errors.at(-1));
      }
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      body = f.locator('body'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      select = s.getByLabel('Star Destroyer surfaces');
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    assert.equal(await select.inputValue(), 'stock');
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await select.focus();
    await select.press('End');
    assert.equal(await select.inputValue(), 'orbit');
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert.equal(await select.inputValue(), 'orbit');
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await startFleet(f);
    const { report, images } = await body.evaluate(async (_, gl) => {
      const tick = () => new Promise(requestAnimationFrame),
        start = performance.now();
      while (!(window.game?.world?.time > 5)) {
        if (performance.now() - start > 180000) throw Error('Battle timeout');
        await tick();
      }
      const g = game,
        r = g.renderer,
        w = g.world,
        R = r.renderer,
        gpu = r.gpu,
        c = r.camera,
        W = R.domElement.width,
        H = R.domElement.height;
      const { gfx } = await import('/js/gfx.js'),
        { stockHull } = await import('/js/game/destroyer-detail.js'),
        { frameDestroyer, passRoute } = await import('/js/game/destroyer-pass.js');
      const u = w.units.find(s => s.player === g.human && s.obj?.visible && !s.dead && stockHull(s)),
        hull = u && stockHull(u);
      if (!hull || !!gpu === gl) throw Error('Missing flagship or wrong backend');
      if (!hull.material.userData.stockDestroyerPaint)
        throw Error(
          'Unsupported paint ' + JSON.stringify({ flags: hull.material.defines, source: hull.material.uniforms.map.value?.name })
        );
      const orig = hull.material,
        report = { roster: g.setup.instant.armies.map(a => a.length), backend: gl ? 'webgl' : 'webgpu', views: [], planets: 0 },
        images = {};
      for (const scene of [r.bgScene, r.scene])
        scene.traverseVisible(m => {
          if (m.isMesh && m.material?.uniforms?.orbitalAir) report.planets++;
        });
      const before = u.heading;
      g.command({ c: 'face', u: [u.id], h: u.heading + 1.1 });
      Object.assign(r.rig, { x: u.x, y: u.y, z: u.z || 0, dist: 3200, pitch: 0.94, free: true, shake: 0 });
      const freeze = async () => {
        g.modeSuspended = true;
        await tick();
      };
      const resume = () => {
        g.last = performance.now();
        g.modeSuspended = false;
        requestAnimationFrame(g.frame);
      };
      await freeze();
      await (await import('/js/dds.js')).texturesReady();
      r.post.flare = false;
      const route = passRoute(g, u);
      async function shot(mode) {
        gfx.destroyerSurface = mode;
        for (const s of r.skydomes) s.root.position.copy(c.position);
        r.draw(w, R, 0);
        await r.orbitProbe?.ready;
        await r.hullWorkshop?.probe?.ready;
        r.draw(w, R, 0);
        if (gpu) await gpu.settle();
        const next = gpu?.readNext();
        r.draw(w, R, 0);
        if (hull.material !== orig) throw Error('Leaked hull material');
        if (next) return (await next).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          a = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) a.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        return a;
      }
      function diff(a, b) {
        let n = 0,
          strong = 0,
          sum = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d) n++;
          if (d >= 6) strong++;
          sum += d;
        }
        return { n, strong, sum };
      }
      function png(px) {
        const el = document.createElement('canvas');
        el.width = W;
        el.height = H;
        el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
        return el.toDataURL().split(',')[1];
      }
      for (let pose = 0; pose < 2; pose++) {
        if (pose) {
          gfx.destroyerSurface = 'orbit';
          r.rig.apply(0);
          const begin = w.time;
          resume();
          while (w.time - begin < 2.0) await tick();
          await freeze();
        }
        for (const view of ['fleet', 'close']) {
          if (view === 'fleet') {
            r.rig.apply(0);
            c.updateMatrixWorld();
          } else frameDestroyer(c, u, 0.84, route);
          await shot('stock');
          const stock = await shot('stock'),
            material = await shot('finish'),
            orbital = await shot('orbit');
          const row = r.hullWorkshop.active.get(u);
          if (!row?.mat.defines.HULL_ENV || !r.hullWorkshop.probe?.texture) throw Error('Missing real hull or atlas');
          report.views.push({
            view,
            pose,
            angle: u.heading,
            material: diff(stock, material),
            orbital: diff(material, orbital),
            reset: diff(stock, await shot('stock'))
          });
          if (pose) for (const [k, a] of Object.entries({ stock, material, orbital })) images[view + '-' + k] = png(a);
        }
      }
      report.turn = Math.abs(u.heading - before);
      // No subject, no difference elsewhere in the same battle (and no stale pool instances).
      u.obj.visible = false;
      const absent = await shot('stock');
      report.elsewhere = diff(absent, await shot('orbit'));
      u.obj.visible = true;
      // Live intervals rather than CPU timing of frozen submissions.
      r.rig.apply(0);
      resume();
      const samples = { stock: [], orbit: [] };
      for (const key of ['stock', 'orbit', 'orbit', 'stock']) {
        gfx.destroyerSurface = key;
        let prev;
        for (let i = 0; i < 40; i++) {
          const t = await tick();
          if (i >= 8) samples[key].push(t - prev);
          prev = t;
          r.rig.yaw += 0.001;
        }
      }
      for (const [k, a] of Object.entries(samples)) {
        a.sort((x, y) => x - y);
        report[k] = { median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(0.95 * a.length) - 1] };
      }
      return { report, images };
    }, gl);
    console.log(JSON.stringify(report), out);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const [k, a] of Object.entries(images)) fs.writeFileSync(path.join(out, k + '.png'), Buffer.from(a, 'base64'));
    assert(report.planets > 0 && report.turn > 0.02);
    for (const v of report.views) {
      assert(v.material.strong > 120 && v.orbital.strong > 120, 'visible stages ' + JSON.stringify(v));
      assert(v.reset.strong < 30, 'stock reset');
    }
    assert(report.elsewhere.strong < 30);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
