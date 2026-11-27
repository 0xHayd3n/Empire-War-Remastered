// Run through Universal with a mounted install. Store only private captures in TEMP.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl',
  world = process.env.LOOK_WORLD || 'Endor',
  source = process.env.LOOK_PROFILE || 'stock';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      bad = [];
    page.setDefaultTimeout(90000);
    if (gl) await page.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    page.on('pageerror', e => {
      bad.push(e.message);
      console.error(e.message);
    });
    page.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|Shader Error|INVALID_OPERATION|invalid.*pipeline/i.test(
          m.text()
        ) &&
        bad.length < 5
      ) {
        bad.push(m.text().slice(-1650));
        console.error(bad.at(-1));
      }
    });
    await page.goto('http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      names = ['Aerial perspective', 'Shared battlefield wind', 'Steady surface detail'];
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    await page.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(x => (x.style.backgroundImage = 'none'));
    for (const n of names) {
      const c = s.getByRole('checkbox', { name: n, exact: true });
      assert(!(await c.isChecked()));
      await c.focus();
      await c.press('Space');
    }
    assert(await s.evaluate(x => x.scrollWidth <= x.clientWidth));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload();
    await settings();
    for (const n of names) assert(await s.getByRole('checkbox', { name: n, exact: true }).isChecked());
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const name of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${name}"]:visible`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill(world);
    const leaf = board.locator(`[data-world="${world}"][data-domain="land"][data-source="${source}"]`).first();
    await leaf.click();
    await f.locator(`.op-setup[data-profile="${source}"] .op-go:enabled`).click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const { data, images } = await f.locator('body').evaluate(async (_, gl) => {
      const tick = () => new Promise(requestAnimationFrame);
      let deadline = performance.now() + 90000;
      while (!(window.game?.world?.time > 2)) {
        if (performance.now() > deadline) throw Error('No world');
        await tick();
      }
      const g = game,
        w = g.world,
        R = g.gpuOn ? g.gpu : g.renderer,
        c = g.camera,
        W = R.domElement.width,
        H = R.domElement.height,
        { gfx } = await import('/js/gfx.js'),
        { texturesReady } = await import('/js/dds.js'),
        { loadParticles } = await import('/js/particles.js'),
        { ParticleSim } = await import('/js/particlesim.js'),
        { lighting } = await import('/js/model.js');
      if (R.isMirror || !!g.gpuOn === gl) throw Error('wrong renderer');
      const prev = w.time;
      g.modeSuspended = true;
      await tick();
      await texturesReady();
      const now = g.last,
        anchor = w.units.find(u => u.foot && u.holder?.visible && u.side === g.me);
      Object.assign(g.view, { x: anchor.x + 35, y: anchor.y + 40, dist: 750, pitch: 0.68 });
      const draw = () => {
        g.modeSuspended = false;
        g.warming = true;
        try {
          g.frame(now);
        } finally {
          g.modeSuspended = true;
          g.warming = false;
        }
      };
      const set = (a, b, c) => Object.assign(gfx, { aerialDepth: a, sharedWind: b, steadyDetail: c });
      async function shot() {
        draw();
        await g.gpu?.settle();
        const next = g.gpu?.readNext();
        draw();
        if (next) return (await next).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          out = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) out.set(raw.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
        return out;
      }
      function y(a, i) {
        return a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722;
      }
      function diff(a, b) {
        let changed = 0,
          sum = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.abs(y(a, i) - y(b, i));
          if (d > 3) changed++;
          sum += d;
        }
        return { changed, mean: sum / (a.length / 4) };
      }
      const images = {};
      function image(k, a) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(a), W, H), 0, 0);
        images[k] = c.toDataURL('image/jpeg', 0.9).split(',')[1];
      }
      const data = { W, H, backend: gl ? 'webgl' : 'webgpu', map: g.setup.mapFile, fog: g.map.environment?.fog, leafMeshes: 0, frames: {} };
      g.scene.traverse(o => {
        if (o.material?.defines?.WIND_LEAVES) data.leafMeshes++;
      });
      set(false, false, false);
      await shot();
      let base = await shot();
      image('original', base);
      set(true, false, false);
      let air = await shot();
      data.air = diff(base, air);
      image('air', air);
      set(false, true, false);
      let leaf = await shot();
      data.wind = diff(base, leaf);
      data.flow = [...g.fx.breeze];
      w.time += 2.7;
      let later = await shot();
      set(false, false, false);
      let clear = await shot();
      data.changedClock = diff(base, clear);
      data.gust = diff(leaf, later);
      w.time = prev;
      // Compare an actual mounted system in the particle stepper with exactly the same initial
      // particles. Advance already-emitted sprites, no gameplay unit, ordering or random stream.
      const { db } = await import('/js/gamedata.js');
      data.tracers = {};
      const dust = db.type('AT_AT_FootPuff_Dirt')?.str('Land_Model_Name');
      for (const key of ['p_smoke_small01.alo', dust].filter(Boolean)) {
        const def = await loadParticles(key);
        if (!def) continue;
        const sim = new ParticleSim();
        sim.defs.set(key, def);
        sim.create(1, key, { x: anchor.x, y: anchor.y, z: anchor.z || 0 }, { maxEmit: 0 });
        const sys = sim.systems.get(1),
          e = sys.emitters.find(s => s.breeze && !s.e.objectSpace && !s.e.weather);
        if (!e) continue;
        sys.spawn(e, 0);
        const p = e.parts.at(-1),
          copy = { ...p };
        sys.emitting = false;
        const run = flow => {
          Object.assign(p, copy);
          e.parts = [p];
          sim.breeze = flow;
          sys.stepEmitter(e, 0.1);
          return [p.x, p.y];
        };
        const off = run(null),
          on = run(data.flow);
        data.tracers[key] = [on[0] - off[0], on[1] - off[1]];
      }
      // Quarter-pixel camera shifts at a fixed battle clock. Midpoint departure from linear
      // motion (second difference) scores flicker; coarse spatial contrast guards against blur.
      set(false, false, true);
      const detail = await shot();
      data.detail = diff(base, detail);
      const pan = async on => {
        set(false, false, on);
        let older,
          last,
          energy = 0,
          contrast = 0,
          count = 0;
        for (let j = 0; j <= 8; j++) {
          c.setViewOffset(W, H, j * 0.25, 0, W, H);
          let frame = await shot();
          if (last && older) {
            for (let row = 12; row < H - 12; row += 3)
              for (let x = 12; x < W - 12; x += 3) {
                let i = 4 * (row * W + x);
                energy += Math.abs(y(frame, i) - 2 * y(last, i) + y(older, i));
                contrast += Math.abs(y(frame, i + 32) - y(frame, i - 32));
                count++;
              }
          }
          older = last;
          last = frame;
        }
        c.clearViewOffset();
        return { jitter: energy / count, contrast: contrast / count };
      };
      data.panOff = await pan(false);
      data.panOn = await pan(true);
      set(true, true, true);
      const all = await shot();
      image('combined', all);
      set(false, false, false);
      data.reset = diff(base, await shot());
      const vx = g.view.x;
      for (const on of [false, true, true, false]) {
        set(on, on, on);
        draw();
        await g.gpu?.settle();
        let tm = await tick();
        const arr = (data.frames[on] ||= []);
        for (let j = 0; j < 45; j++) {
          g.view.x = vx + j - 22;
          draw();
          const n = await tick();
          if (j > 6) arr.push(n - tm);
          tm = n;
        }
      }
      for (const k in data.frames) {
        const a = data.frames[k].sort((a, b) => a - b);
        data.frames[k] = [a[Math.floor(a.length * 0.5)], a[Math.floor(a.length * 0.95)]];
      }
      if (data.fog?.on && data.fog.start === 0) {
        // Render a black terrain layer against white air. Keep the painted UV, camera angle,
        // exposure, depth and light fixed when raising BOTH ends of the ray above a ridge.
        const T = await import('three'),
          { airDensity } = await import('/js/battlefield.js'),
          U = g.ground.material.uniforms,
          geo = new T.PlaneGeometry(3000, 3000),
          scene = new T.Scene(),
          cam = new T.PerspectiveCamera(20, 1, 1, 5000),
          rt = new T.WebGLRenderTarget(32, 32),
          slot = 0,
          restore = R.getRenderTarget(),
          z0 = g.ground.userData.lowland,
          tint = lighting.fogTint.value.clone(),
          range = lighting.fogRange.value.clone(),
          d = U.matDiffuse.value[slot].clone(),
          s = U.matSpecular.value[slot].clone();
        geo.setAttribute('corner', new T.BufferAttribute(new Float32Array(8), 2));
        geo.setAttribute('shade', new T.BufferAttribute(new Float32Array(4).fill(1), 1));
        geo.setAttribute('layers', new T.BufferAttribute(new Float32Array(16).fill(slot), 4));
        const plane = new T.Mesh(geo, g.ground.material);
        plane.frustumCulled = false;
        scene.add(plane);
        geo.translate(anchor.x, anchor.y, z0);
        let lastZ = 0;
        async function sample(dist, h) {
          geo.translate(0, 0, h - lastZ);
          lastZ = h;
          cam.up.set(0, 0, 1);
          cam.position.set(anchor.x, anchor.y - dist, z0 + h + dist * 0.12);
          cam.lookAt(anchor.x, anchor.y, z0 + h);
          cam.updateMatrixWorld();
          R.setRenderTarget(rt);
          R.clear();
          R.render(scene, cam);
          R.endFrame?.();
          await g.gpu?.settle();
          R.clear();
          R.render(scene, cam);
          const out = new Uint8Array(4);
          await R.readRenderTargetPixelsAsync(rt, 16, 16, 1, 1, out);
          return y(out, 0);
        }
        try {
          lighting.fogTint.value.setRGB(1, 1, 1);
          lighting.fogRange.value.set(0, 0);
          lighting.fieldLook.value.set(airDensity(data.fog, 0), z0, 0, 0);
          U.matDiffuse.value[slot].setScalar(0);
          U.matSpecular.value[slot].setScalar(0);
          data.column = { near: await sample(75, 0), valley: await sample(950, 0), ridge: await sample(950, 380) };
        } finally {
          U.matDiffuse.value[slot].copy(d);
          U.matSpecular.value[slot].copy(s);
          lighting.fieldLook.value.set(0, 0, 0, 0);
          lighting.fogTint.value.copy(tint);
          lighting.fogRange.value.copy(range);
          R.setRenderTarget(restore);
          R.releaseTarget?.(rt);
          rt.dispose();
          geo.dispose();
        }
      }
      return { data, images };
    }, gl);
    const dest = path.join(os.tmpdir(), 'universal-battlefield', world, data.backend);
    fs.mkdirSync(dest, { recursive: true });
    for (const [k, b] of Object.entries(images)) fs.writeFileSync(path.join(dest, k + '.jpg'), Buffer.from(b, 'base64'));
    fs.writeFileSync(path.join(dest, 'report.json'), JSON.stringify(data, null, 2));
    console.log(JSON.stringify(data));
    assert.deepEqual(bad, []);
    assert(data.reset.changed < 400);
    if (data.fog?.on && data.fog.start < 500) assert(data.air.changed > 10000);
    if (world === 'Kuat') assert(data.air.changed < 400, 'Do not fill an authored clear station foreground with black fog');
    if (data.column) assert(data.column.near < 2 && data.column.valley > data.column.ridge * 2 && data.column.ridge > 2);
    assert(data.detail.changed > 5000);
    assert(data.panOn.jitter < data.panOff.jitter && data.panOn.contrast > data.panOff.contrast * 0.76);
    if (world === 'Endor') {
      assert(data.leafMeshes > 0 && data.wind.changed > 250 && data.gust.changed > 250);
      const traces = Object.values(data.tracers);
      assert(traces.length === 2 && traces.every(d => d[0] * data.flow[0] + d[1] * data.flow[1] > 0));
      assert(Math.hypot(traces[0][0] - traces[1][0], traces[0][1] - traces[1][1]) < 1e-5);
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
