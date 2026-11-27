// Run against the mounted Universal window; never save mounted pixels to the checkout.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION|Planet light unavailable/i.test(
          m.text()
        ) &&
        errors.length < 4
      ) {
        errors.push(m.text().slice(0, 2300));
        console.error(errors.at(-1));
      }
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      field = s.getByRole('combobox', { name: 'Orbital lighting', exact: true });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    assert.equal(await field.inputValue(), 'map');
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await field.focus();
    await field.press('End');
    assert.equal(await field.inputValue(), 'bounce');
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert.equal(await field.inputValue(), 'bounce');
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await require('./mounted-space-roster.cjs')(f);
    const body = f.locator('body');
    await body.evaluate(async () => {
      const start = performance.now(),
        { passSubject } = await import('/js/game/destroyer-pass.js');
      while (!(window.game?.world?.time > 4 && passSubject(game))) {
        if (performance.now() - start > 90000) throw Error('No battle');
        await new Promise(requestAnimationFrame);
      }
      game.menus.main();
    });
    await f.locator('[data-id="IDC_INGAME_OPTIONS"]').click();
    await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    if (!(await s.getByRole('button', { name: 'Pan past the planet', exact: true }).count()))
      throw Error(
        await body.evaluate(async () => {
          const g = game,
            r = g.renderer,
            { passSubject } = await import('/js/game/destroyer-pass.js'),
            { dominantDisk } = await import('/js/game/planetdisk.js');
          return JSON.stringify([
            g.world.time,
            !!r?.bgScene,
            passSubject(g)?.type.name,
            !!dominantDisk(r.scene),
            Array.from(document.querySelectorAll('button'))
              .filter(b => /flyby|pan past/i.test(b.textContent))
              .map(b => b.textContent)
          ]);
        })
      );
    await s.getByRole('button', { name: 'Pan past the planet', exact: true }).click();
    const live = await body.evaluate(async () => {
      const g = game;
      if (!g.cine.on || !g.cine.sequence) throw Error('Pan did not start');
      const start = g.world.time,
        eye = g.renderer.camera.position.clone();
      for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
      return [g.world.time - start, eye.distanceTo(g.renderer.camera.position)];
    });
    await p.keyboard.press('Escape');
    assert(await body.evaluate(() => !game.cine.on));
    const { report, images } = await body.evaluate(async (_, gl) => {
      const tick = () => new Promise(requestAnimationFrame);
      let deadline = performance.now() + 90000;
      while (!(window.game?.world?.time > 4)) {
        if (performance.now() > deadline) throw Error('No battle');
        await tick();
      }
      const g = game,
        w = g.world,
        r = g.renderer,
        R = r.renderer,
        c = r.camera,
        { gfx } = await import('/js/gfx.js'),
        { stockHull } = await import('/js/game/destroyer-detail.js'),
        { lighting } = await import('/js/model.js');
      if (!!r.gpu === gl) throw Error('Wrong renderer');
      g.modeSuspended = true;
      await tick();
      await (await import('/js/dds.js')).texturesReady();
      const u = w.units.find(u => u.player === g.human && u.obj?.visible && stockHull(u)),
        token = r.planetLight;
      await token?.ready;
      if (!token?.rgb?.some(x => x > 0)) throw Error('Missing radiance: ' + JSON.stringify([token?.rgb, !!token?.source]));
      const b = token.source.sphere;
      const sun = lighting.sunDir.value.toArray(),
        W = R.domElement.width,
        H = R.domElement.height;
      c.up.set(0, 0, 1);
      c.fov = 47;
      c.near = 1;
      c.far = 40000;
      c.updateProjectionMatrix();
      r.post.flare = false;
      const route = (await import('/js/game/orbitalpass.js')).orbitalRoute(u, b);
      function camera(t) {
        route(c, 0.5 + t * 0.8);
        for (const sk of r.skydomes) sk.root.position.copy(c.position);
      }
      const draw = () => r.draw(w, R, 0);
      async function shot(mode) {
        gfx.orbitalLighting = mode;
        draw();
        await r.gpu?.settle();
        const next = r.gpu?.readNext();
        draw();
        if (next) return (await next).data;
        const ctx = R.getContext(),
          a = new Uint8Array(W * H * 4),
          out = a.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, a);
        for (let y = 0; y < H; y++) out.set(a.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
        return out;
      }
      const images = {},
        report = { backend: r.gpu ? 'webgpu' : 'webgl', map: g.setup.mapFile, resolution: [W, H], rgb: token.rgb, poses: [], pan: {} };
      function image(key, data) {
        const el = document.createElement('canvas');
        el.width = W;
        el.height = H;
        el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), W, H), 0, 0);
        images[key] = el.toDataURL('image/jpeg', 0.9).split(',')[1];
      }
      for (const t of [-0.6, 0, 0.6]) {
        camera(t);
        const a = await shot('map'),
          b = await shot('air'),
          d = await shot('bounce');
        token.source.mesh.visible = false;
        let noPlanet;
        try {
          noPlanet = await shot('air');
        } finally {
          token.source.mesh.visible = true;
        }
        u.obj.visible = false;
        let noShip;
        try {
          noShip = await shot('air');
        } finally {
          u.obj.visible = true;
        }
        let planet = 0,
          plates = 0,
          lit = 0,
          hullAir = 0,
          gain = 0,
          skyBounce = 0,
          unchanged = 0;
        const delta = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        for (let i = 0; i < a.length; i += 4) {
          const ship = delta(noShip, b, i) > 36 && delta(noPlanet, b, i) === 0,
            pa = delta(a, b, i),
            pd = delta(b, d, i);
          if (!ship && pa > 12) {
            planet++;
            if (pd > 3) skyBounce++;
          }
          if (ship) {
            plates++;
            if (pa > 12) hullAir++;
            if (pd >= 3) {
              lit++;
              gain += d[i] - b[i] + d[i + 1] - b[i + 1] + d[i + 2] - b[i + 2];
            } else unchanged++;
          }
        }
        report.poses.push({ t, planet, plates, lit, gain, hullAir, skyBounce, unchanged });
        if (!t) {
          const reset = await shot('map');
          report.reset = 0;
          for (let i = 0; i < a.length; i += 4) if (delta(reset, a, i) > 3) report.reset++;
          image('map', a);
          image('air', b);
          image('bounce', d);
        }
      }
      for (const mode of ['map', 'air', 'bounce']) {
        gfx.orbitalLighting = mode;
        const dt = [];
        let prev = await tick();
        for (let i = 0; i < 55; i++) {
          camera(i / 54 - 0.5);
          draw();
          const now = await tick();
          if (i > 4) dt.push(now - prev);
          prev = now;
        }
        dt.sort((a, b) => a - b);
        report.pan[mode] = { median: dt[25], p95: dt[47] };
      }
      report.cached = token === r.planetLight;
      report.sunFixed = String(sun) === String(lighting.sunDir.value.toArray());
      report.roster = g.setup.instant.armies.map(x => x.length);
      return { report, images };
    }, gl);
    report.live = live;
    assert(live[0] > 0 && live[1] > 1);
    const dir = path.join(os.tmpdir(), 'universal-orbital-lighting', gl ? 'webgl' : 'webgpu');
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, data] of Object.entries(images)) fs.writeFileSync(path.join(dir, k + '.jpg'), Buffer.from(data, 'base64'));
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), dir);
    assert.deepEqual(errors, []);
    assert(report.cached && report.sunFixed && report.reset < 20);
    assert.deepEqual(report.roster, [100, 100]);
    for (const x of report.poses) {
      assert(x.planet > 1000 && x.plates > 300 && x.lit > 30 && x.gain > 200 && x.unchanged > 100);
      assert(x.skyBounce < x.planet * 0.005 && x.hullAir < x.plates * 0.03);
    }
    assert(report.pan.bounce.p95 < Math.max(40, report.pan.map.p95 * 2));
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
