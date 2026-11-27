// Mounted Universal only. All captured pixels stay in TEMP. No simulation damage or archive writes.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  os = require('node:os'),
  fs = require('node:fs');
const gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
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
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_(OPERATION|FRAMEBUFFER_OPERATION)|webgpu .* error/i.test(
          m.text()
        ) &&
        errors.length < 4
      ) {
        errors.push(m.text().slice(0, 2400));
        console.error(errors.at(-1));
      }
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      body = f.locator('body'),
      box = s.getByRole('checkbox', { name: 'Linear battle lighting', exact: true });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    assert(!(await box.isChecked()));
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await box.focus();
    await box.press('Space');
    assert(await box.isChecked());
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert(await box.isChecked());
    await s.getByRole('combobox', { name: 'Orbital lighting', exact: true }).selectOption('bounce');
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await require('./mounted-space-roster.cjs')(f);
    await body.evaluate(async () => {
      const { passSubject } = await import('/js/game/destroyer-pass.js'),
        t = performance.now();
      while (!(window.game?.world?.time > 5 && passSubject(game))) {
        if (performance.now() - t > 90000) throw Error('No flagship');
        await new Promise(requestAnimationFrame);
      }
      game.menus.main();
    });
    await f.locator('[data-id="IDC_INGAME_OPTIONS"]').click();
    await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    await s.getByRole('button', { name: 'Preview explosion lighting' }).click();
    const { report, images } = await body.evaluate(async (_, gl) => {
      const t = () => new Promise(requestAnimationFrame),
        g = game,
        w = g.world,
        r = g.renderer,
        R = r.renderer,
        post = r.post,
        c = r.camera,
        T = await import('three'),
        { gfx } = await import('/js/gfx.js'),
        { orbitalRoute } = await import('/js/game/orbitalpass.js'),
        { stockHull } = await import('/js/game/destroyer-detail.js');
      if (gl === !!r.gpu || !g.cine.sequence) throw Error('Wrong backend or preview');
      const unit = r.flybySubject,
        hull = stockHull(unit);
      const began = w.time;
      let start = performance.now();
      while (!r.blastField?.events.length) {
        if (performance.now() - start > 30000 || !g.cine.on) throw Error('Preview flash missing');
        await t();
      }
      g.modeSuspended = true;
      await t();
      await r.planetLight?.ready;
      await (await import('/js/dds.js')).texturesReady();
      const life = r.blastField.events.at(-1),
        clock = w.time,
        eye = c.position.clone();
      g.cine.stop();
      r.post.flare = false;
      if (r.instances) {
        r.instances.jobs = null;
        for (const u of w.units) if (u.obj && !u.dead) r.instances.scan(u);
      }
      const hud = [...document.querySelectorAll('#hud #topbar, #hud #minimap, #hud #cmdbar, #sidebar, .classic-command-bar')].find(
        e => e.checkVisibility({ visibilityProperty: true }) && e.getBoundingClientRect().height > 0
      );
      if (!hud)
        throw Error(
          'No visible HUD sample: ' +
            [...document.querySelectorAll('canvas,button')]
              .filter(e => e.checkVisibility() && e.getBoundingClientRect().width)
              .slice(0, 24)
              .map(e => e.id || e.className || e.tagName)
              .join(',')
        );
      function hudState() {
        const b = hud.getBoundingClientRect(),
          style = getComputedStyle(hud);
        return [b.width, b.height, style.visibility, style.color, hud.textContent];
      }
      const hudBefore = hudState();
      const route = orbitalRoute(unit, r.planetLight.source.sphere),
        W = R.domElement.width,
        H = R.domElement.height;
      function camera(k) {
        route(c, k);
        for (const sk of r.skydomes) sk.root.position.copy(c.position);
      }
      camera(0.46);
      const report = {
          backend: gl ? 'webgl' : 'webgpu',
          resolution: [W, H],
          roster: g.setup.instant.armies.map(a => a.length),
          poses: [],
          pan: {},
          previewSim: clock - began
        },
        images = {};
      function jpeg(key, px) {
        const el = document.createElement('canvas');
        el.width = W;
        el.height = H;
        el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
        images[key] = el.toDataURL('image/jpeg', 0.9).split(',')[1];
      }
      async function shot(on) {
        gfx.sceneLight = on;
        r.draw(w, R, 0);
        await r.gpu?.settle();
        const next = r.gpu?.readNext();
        r.draw(w, R, 0);
        if (post.incident !== on) throw Error('Lighting path unavailable');
        if (next) return (await next).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          a = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) a.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        return a;
      }
      // Two known additive samples through the same real output adapter and blend hardware as the fleet.
      async function patch() {
        const texture = new T.DataTexture(new Uint8Array([204, 128, 0, 255]), 1, 1);
        texture.needsUpdate = true;
        const target = new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType, depthBuffer: false });
        target.texture.userData.incidentScene = true;
        const m = post.mBlur.clone();
        m.uniforms.map.value = texture;
        m.uniforms.offset.value.set(0, 0);
        m.transparent = true;
        m.blending = T.CustomBlending;
        m.blendSrc = m.blendDst = T.OneFactor;
        const prev = R.getRenderTarget(),
          col = R.getClearColor(new T.Color()),
          alpha = R.getClearAlpha();
        try {
          const draw = () => {
            R.setRenderTarget(target);
            R.setClearColor(0, 0);
            R.clear();
            post.pass(m, target);
            post.pass(m, target);
            R.endFrame?.();
          };
          draw();
          await r.gpu?.settle();
          draw();
          const h = new Uint16Array(4);
          await R.readRenderTargetPixelsAsync(target, 3, 3, 1, 1, h);
          return Array.from(h, T.DataUtils.fromHalfFloat);
        } finally {
          R.setRenderTarget(prev);
          R.setClearColor(col, alpha);
          post.dropTarget(target);
          texture.dispose();
          m.dispose();
        }
      }
      report.add = await patch();
      function diff(a, b, i) {
        return Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      function lum(a, i) {
        return 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
      }
      for (const k of [0.21, 0.46, 0.71]) {
        camera(k);
        const old = await shot(false),
          on = await shot(true),
          reset = await shot(false);
        if (k === 0.46) {
          jpeg('original', old);
          jpeg('linear', on);
        }
        const sphere = r.planetLight.source.mesh;
        gfx.hullBlastLight = false;
        const noLight = await shot(true);
        gfx.hullBlastLight = true;
        unit.obj.visible = false;
        const noShip = await shot(true);
        unit.obj.visible = true;
        sphere.visible = false;
        const noPlanet = await shot(true);
        sphere.visible = true;
        let recovered = 0,
          front = 0,
          back = 0,
          planet = 0,
          nightShift = 0,
          night = 0,
          paint = 0,
          paintOK = 0,
          brightFace = 0;
        for (let i = 0; i < on.length; i += 4) {
          const mask = diff(on, noShip, i) > 35 && diff(on, noPlanet, i) < 2;
          if (mask) {
            if (Math.min(old[i], old[i + 1], old[i + 2]) >= 248 && Math.min(on[i], on[i + 1], on[i + 2]) < 230) recovered++;
            const d = lum(on, i) - lum(noLight, i);
            if (d > 2) {
              front++;
              brightFace += d;
            }
            if (Math.abs(d) < 0.5) back++;
            const sat = Math.max(...old.subarray(i, i + 3)) - Math.min(...old.subarray(i, i + 3));
            if (sat > 18 && old[i + 1] > old[i] * 1.1 && old[i + 1] > old[i + 2] * 1.1) {
              paint++;
              if (on[i + 1] > on[i] && on[i + 1] > on[i + 2]) paintOK++;
            }
          }
          if (diff(on, noPlanet, i) > 32 && diff(on, noShip, i) < 2) {
            planet++;
            if (lum(on, i) < 75) {
              night++;
              nightShift += Math.abs(lum(on, i) - lum(noLight, i));
            }
          }
        }
        let core = 0;
        for (const x of [-87.2, -0.04, 87.2]) {
          const p = new T.Vector3(x, 305, 50.6).applyMatrix4(hull.matrixWorld).project(c),
            cx = Math.round(((1 + p.x) * W) / 2),
            cy = Math.round(((1 - p.y) * H) / 2);
          let best = 0;
          for (let j = -3; j <= 3; j++) for (let h = -3; h <= 3; h++) best = Math.max(best, lum(on, 4 * ((cy + j) * W + cx + h)));
          core += best / 3;
        }
        report.poses.push({
          k,
          recovered,
          front,
          back,
          planet,
          night,
          nightShift: nightShift / Math.max(1, night),
          paint,
          paintOK,
          core,
          brightFace
        });
        let changed = 0;
        for (let i = 0; i < on.length; i += 4) if (diff(old, reset, i) > 6) changed++;
        report.poses.at(-1).reset = changed;
      }
      report.hudIntact =
        hudBefore[0] > 0 && hudBefore[1] > 0 && hudBefore[2] !== 'hidden' && JSON.stringify(hudBefore) === JSON.stringify(hudState());
      report.frozen = w.time === clock && r.blastField.events.includes(life);
      // Fixed path with identical FX, warm before each mode, no screenshot readbacks inside timing windows.
      for (const on of [false, true, true, false]) {
        gfx.sceneLight = on;
        const a = (report.pan[on] ||= []);
        let prev = await t();
        for (let i = 0; i < 50; i++) {
          camera(0.16 + i * 0.012);
          r.draw(w, R, 0);
          const now = await t();
          if (i >= 8) a.push(now - prev);
          prev = now;
        }
        await r.gpu?.settle();
      }
      for (const k in report.pan) {
        const a = report.pan[k].sort((a, b) => a - b);
        report.pan[k] = { median: a[42], p95: a[79] };
      }
      return { report, images };
    }, gl);
    const dir = path.join(os.tmpdir(), 'universal-scene-light', gl ? 'webgl' : 'webgpu');
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, b] of Object.entries(images)) fs.writeFileSync(path.join(dir, k + '.jpg'), Buffer.from(b, 'base64'));
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), dir);
    assert.deepEqual(errors, []);
    assert(report.previewSim > 0 && report.frozen && report.hudIntact);
    assert.deepEqual(report.roster, [100, 100]);
    assert(Math.abs(report.add[0] - 1.20765) < 0.01 && Math.abs(report.add[1] - 0.43172) < 0.01 && report.add[2] === 0);
    for (const x of report.poses) {
      assert(
        x.front > 100 &&
          x.back > 100 &&
          x.night > 100 &&
          x.nightShift < 0.1 &&
          x.recovered > 50 &&
          x.planet > 500 &&
          x.reset < 0.0001 * report.resolution[0] * report.resolution[1] &&
          x.core > 140 &&
          x.paint > 20 &&
          x.paintOK > x.paint * 0.8
      );
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
