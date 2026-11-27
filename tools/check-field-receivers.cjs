// Mounted launcher only. Each option is isolated in a fixed 1080p frame; private captures never leave TEMP.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl',
  fleet = process.env.LOOK_DOMAIN === 'space',
  world = process.env.LOOK_WORLD || 'Endor',
  id = process.env.LOOK_PROFILE || 'stock';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(100000);
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    p.on('pageerror', e => {
      bad.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|Shader Error|INVALID_OPERATION|webgpu pipeline|invalid.*pipeline/i.test(
          m.text()
        ) &&
        bad.length < 5
      ) {
        bad.push(m.text().slice(0, 2000));
        console.error(bad.at(-1));
      }
    });
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    const names = [
      'Cloud shadows on units',
      'Sunlit smoke and dust',
      'Material reflections',
      'Canopy light and shade',
      'Water depth and reflection',
      'Local ground bounce'
    ];
    await settings();
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(x => (x.style.backgroundImage = 'none'));
    for (const label of names) {
      const c = s.getByRole('checkbox', { name: label, exact: true });
      assert(!(await c.isChecked()));
      await c.focus();
      await c.press('Space');
    }
    assert(await s.evaluate(x => x.scrollWidth <= x.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    for (const label of names) assert(await s.getByRole('checkbox', { name: label, exact: true }).isChecked());
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    if (fleet) await require('./mounted-space-roster.cjs')(f);
    else {
      for (const name of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${name}"]:visible`).click();
      const board = f.locator('.op-setup');
      await board.getByRole('searchbox').fill(world);
      await board.locator(`[data-world="${world}"][data-domain="land"][data-source="${id}"]`).first().click();
      await f.locator(`.op-setup[data-profile="${id}"] .op-go:enabled`).click();
      await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    }
    const { report, imgs } = await f.locator('body').evaluate(
      async (_, args) => {
        const { gl, fleet } = args,
          tick = () => new Promise(requestAnimationFrame);
        while (!(window.game?.world?.time > 4)) await tick();
        const g = game,
          w = g.world,
          r = g.renderer,
          R = fleet ? r.renderer : g.gpuOn ? g.gpu : r,
          gpu = fleet ? r.gpu : g.gpuOn && g.gpu,
          cam = fleet ? r.camera : g.camera,
          { gfx } = await import('/js/gfx.js'),
          { receiverSettings } = await import('/js/fieldreceivers.js'),
          { lighting } = await import('/js/model.js'),
          { texturesReady } = await import('/js/dds.js');
        if (!!gpu === gl || R.isMirror) throw Error('Wrong backend');
        if (gl) R.debug.checkShaderErrors = true;
        const keys = receiverSettings.map(a => a[0]),
          set = key => {
            for (const k of keys) gfx[k] = key === true || key === k;
          };
        set(false);
        const W = R.domElement.width,
          H = R.domElement.height,
          report = { map: g.setup.mapFile, W, H, backend: gl ? 'webgl' : 'webgpu', effects: {}, timing: {} },
          imgs = {};
        let anchor;
        if (!fleet) {
          anchor = w.units.find(u => u.foot && u.holder?.visible && u.side === g.me);
          const { db } = await import('/js/gamedata.js');
          await w.spawn('AT_ST_Walker', anchor.x + 32, anchor.y + 55, 0, g.me);
          await w.finishSite(
            { base: true, side: g.me, x: anchor.x + 95, y: anchor.y + 104, rot: [0, 0, 0], scale: 1, options: [] },
            db.type('E_Ground_Barracks'),
            g.me
          );
          Object.assign(g.view, { x: anchor.x + 36, y: anchor.y + 39, dist: 590, pitch: 0.71 });
          for (let i = 0; i < 25; i++) await tick();
        } else {
          anchor = w.units.find(u => !u.isFighter && u.player === g.human && !u.dead && u.obj?.visible && u.visualRadius > 150);
          if (!anchor) throw Error('No capital');
          // A mounted intro may own the camera while sim time has already started. Take the
          // normal command rig for these matched bearings instead of measuring the same intro pose.
          r.cameraOverride = null;
          Object.assign(r.rig, { x: anchor.x, y: anchor.y, z: anchor.z || 0, dist: 3750, pitch: 0.94, free: true, shake: 0 });
          r.post.flare = false;
          r.render(w, 0);
        }
        g.modeSuspended = true;
        await tick();
        await texturesReady();
        const now = g.last;
        const draw = () => {
          if (fleet) return r.draw(w, R, 0);
          g.warming = true;
          g.modeSuspended = false;
          try {
            g.frame(now);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
        };
        async function shot() {
          draw();
          await gpu?.settle?.();
          const pending = gpu?.readNext?.();
          draw();
          if (pending) return (await pending).data;
          const ctx = R.getContext(),
            raw = new Uint8Array(W * H * 4),
            out = raw.slice();
          ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
          for (let y = 0; y < H; y++) out.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          return out;
        }
        const lum = (a, i) => a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722;
        function diff(a, b) {
          let n = 0,
            sum = 0,
            up = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = lum(b, i) - lum(a, i);
            sum += Math.abs(d);
            if (Math.abs(d) > 2) n++;
            if (d > 2) up++;
          }
          return { n, up, sum: Math.round(sum) };
        }
        function image(k, a) {
          const cv = document.createElement('canvas');
          cv.width = W;
          cv.height = H;
          cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(a), W, H), 0, 0);
          imgs[k] = cv.toDataURL('image/jpeg', 0.89).split(',')[1];
        }
        set('mapReflections');
        for (let i = 0; i < 150; i++) {
          draw();
          await tick();
          if (fleet ? r.orbitProbes?.slots.some(x => x?.finish && x.texture) : g.landFinish?.texture) break;
          if (!fleet && g.skyAtlasState?.left > 0) g.skyAtlasState.wait = 0;
        }
        report.atlas = !!(fleet ? r.orbitProbes?.slots.some(x => x?.finish && x.texture) : g.landFinish?.texture);
        set(false);
        if (!fleet) {
          const key = 'p_smoke_small01.alo';
          await (await import('/js/particles.js')).loadParticles(key);
          g.fx.burst(key, anchor.x + 28, anchor.y + 22, (anchor.z || 0) + 22, 2.3, 3);
          for (let i = 0; i < 20; i++) {
            g.fx.update(0.06);
            await tick();
          }
          while (g.fx.busy || g.fx.owedDt > 0) {
            if (!g.fx.busy) g.fx.update(0);
            await tick();
          }
          // No old worker frame or late-loaded particle atlas can land halfway through a pixel comparison.
          await texturesReady();
          g.fx.update = () => {};
          for (let i = 0; i < 6; i++) {
            draw();
            await tick();
          }
          report.smoke = [...g.fx.batches.values()].reduce(
            (n, b) => n + [...b.slot.array.slice(0, b.count)].filter(v => v === -2).length,
            0
          );
        }
        let terrain = true,
          leafHidden = false,
          shadowDraws = 0,
          mapped = 0;
        const render = R.render;
        R.render = function (scene, eye) {
          let old = g.ground?.visible;
          if (!fleet && scene === g.scene && eye === cam && !terrain) g.ground.visible = false;
          const hidden = [];
          if (!fleet && (eye === g.cast?.camera || eye === g.groundNear?.cam) && lighting.receiverMode.value.y)
            scene.traverseVisible(o => {
              if (o.material?.defines?.LEAF_CASTER) {
                shadowDraws++;
                if (leafHidden) {
                  hidden.push(o);
                  o.visible = false;
                }
              }
            });
          if (lighting.receiverMode.value.z && eye === cam)
            scene.traverseVisible(o => {
              if (o.material?.defines?.MAP_FINISH) mapped++;
            });
          try {
            return render.call(this, scene, eye);
          } finally {
            for (const o of hidden) o.visible = true;
            if (!fleet) g.ground.visible = old;
          }
        };
        await shot();
        await shot();
        const base = await shot();
        report.noise = diff(base, await shot());
        image('original', base);
        for (const k of fleet ? ['mapReflections'] : keys) {
          set(k);
          if (k === 'leafLight' && gl)
            for (let i = 0; i < 8; i++) {
              draw();
              await tick();
            }
          const on = await shot();
          report.effects[k] = diff(base, on);
          if (!fleet && k === 'cloudReceivers') {
            terrain = false;
            const cloudy = await shot(),
              shift = g.ground.material.uniforms.cloudAt.value,
              dx = shift.z * 0.35;
            shift.x += dx;
            report.cloudTravel = diff(cloudy, await shot());
            shift.x -= dx;
            set(false);
            report.cloudObjects = diff(await shot(), cloudy);
            terrain = true;
          }
          if (k === 'litPuffs' && !fleet) {
            const { BlastField } = await import('/js/game/blastfield.js');
            g.blastField = new BlastField();
            g.blastField.emit(anchor.x + 20000, anchor.y + 20000, 200, 220, false);
            report.distantFlash = diff(on, await shot());
            g.blastField.advance(2);
            g.blastField.emit(anchor.x + 28, anchor.y + 22, (anchor.z || 0) + 24, 220, false);
            const flash = await shot();
            report.flash = diff(on, flash);
            g.blastField.advance(2);
            report.flashGone = diff(on, await shot());
          }
          if (!fleet && k === 'leafLight') {
            const shadows = gfx.shadows;
            leafHidden = true;
            g.cast.frame = 0;
            report.casterOnly = diff(on, await shot());
            leafHidden = false;
            g.cast.frame = 0;
            gfx.shadows = false;
            const lit = await shot();
            set(false);
            report.backlight = diff(await shot(), lit);
            gfx.shadows = shadows;
          }
          set(false);
          await shot();
        }
        report.shadowDraws = shadowDraws;
        report.mapped = mapped;
        set(true);
        const all = await shot();
        image('all', all);
        report.combined = diff(base, all);
        set(false);
        report.reset = diff(base, await shot());
        R.render = render;
        if (fleet) {
          const yaw = r.rig.yaw;
          r.rig.yaw += 0.45;
          r.render(w, 0);
          const second = await shot();
          report.bearingTravel = diff(base, second);
          set('mapReflections');
          report.secondBearing = diff(second, await shot());
          r.rig.yaw = yaw;
          r.render(w, 0);
          set(false);
        }
        if (!fleet && args.world === 'Endor') {
          // Diagnostics use the real water draw and receivers, then restore the mounted map. Keep the
          // shore coverage fixed and omit the additive sheet to measure *transmission*, not a moved edge.
          set('waterOptics');
          const [under, over] = g.water.children,
            att = under.geometry.attributes.depth,
            original = att.array.slice(),
            shore = under.material.uniforms.shore.value,
            sy = shore.y,
            visible = over.visible;
          try {
            shore.y = 1;
            over.visible = false;
            att.array.fill(1);
            att.needsUpdate = true;
            const shallow = await shot();
            att.array.fill(80);
            att.needsUpdate = true;
            report.bedDepth = diff(shallow, await shot());
          } finally {
            att.array.set(original);
            att.needsUpdate = true;
            shore.y = sy;
            over.visible = visible;
          }
          const pitch = g.view.pitch;
          report.shoreViews = [];
          for (const p of [0.53, 1.04]) {
            g.view.pitch = p;
            set(false);
            const old = await shot();
            set('waterOptics');
            report.shoreViews.push(diff(old, await shot()));
          }
          g.view.pitch = pitch;
          // Keep the objects and camera still and change only the paint-grid texels sampled by them.
          set('localSoil');
          await shot();
          const grid = g.terrain.paint.soilGrid,
            tex = grid.tex,
            bytes = tex.image.data,
            kept = bytes.slice(),
            terrainVisible = g.ground.visible;
          try {
            g.ground.visible = false;
            const x = Math.floor(anchor.x * grid.scale * tex.image.width),
              y = Math.floor(anchor.y * grid.scale * tex.image.height);
            const paint = (r, g, b) => {
              for (let yy = Math.max(0, y - 3); yy <= Math.min(tex.image.height - 1, y + 3); yy++)
                for (let xx = Math.max(0, x - 3); xx <= Math.min(tex.image.width - 1, x + 3); xx++)
                  bytes.set([r, g, b, 255], 4 * (yy * tex.image.width + xx));
              tex.needsUpdate = true;
            };
            paint(135, 66, 42);
            const a = await shot();
            paint(35, 82, 111);
            const b = await shot();
            report.localPaint = diff(a, b);
            report.localPaint.cooler = 0;
            for (let i = 0; i < a.length; i += 4) if (a[i] - b[i] > 2 && b[i + 2] - a[i + 2] > 2) report.localPaint.cooler++;
          } finally {
            bytes.set(kept);
            tex.needsUpdate = true;
            g.ground.visible = terrainVisible;
          }
          set(false);
          gfx.battleRealism = 'on';
          await shot();
          await shot();
          gfx.battleRealism = 'off';
          await shot();
          gfx.battleRealism = 'custom';
          set(false);
        }
        for (const on of [false, true, true, false]) {
          set(on);
          draw();
          await gpu?.settle?.();
          let last = await tick();
          const a = (report.timing[on] ||= []);
          const start = fleet ? r.rig.x : g.view.x;
          for (let i = 0; i < 38; i++) {
            if (fleet) {
              r.rig.x = start + i * 0.7;
              r.render(w, 0);
            } else {
              g.view.x = start + i * 0.7;
              draw();
            }
            const t = await tick();
            if (i > 8) a.push(t - last);
            last = t;
          }
          if (fleet) r.rig.x = start;
          else g.view.x = start;
        }
        for (const k in report.timing) {
          const a = report.timing[k].sort((x, y) => x - y);
          report.timing[k] = [a[Math.floor(a.length * 0.5)], a[Math.floor(a.length * 0.95)]];
        }
        // Resume the real battle loop: this series includes simulation, visibility and worker traffic.
        if (!fleet) delete g.fx.update;
        g.last = performance.now();
        g.modeSuspended = false;
        requestAnimationFrame(g.frame);
        report.live = {};
        for (const on of [false, true]) {
          set(on);
          const a = [];
          let t = await tick(),
            begin = w.time;
          for (let i = 0; i < 70; i++) {
            const t2 = await tick();
            if (i > 15) a.push(t2 - t);
            t = t2;
          }
          a.sort((x, y) => x - y);
          report.live[on] = { median: a[Math.floor(a.length * 0.5)], p95: a[Math.floor(a.length * 0.95)], battleSeconds: w.time - begin };
        }
        return { report, imgs };
      },
      { gl, fleet, world }
    );
    const dir = path.join(os.tmpdir(), 'universal-field-receivers', fleet ? 'fleet' : world, gl ? 'webgl' : 'webgpu');
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(imgs)) fs.writeFileSync(path.join(dir, k + '.jpg'), Buffer.from(v, 'base64'));
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), dir);
    assert.deepEqual(bad, []);
    assert(report.atlas && report.mapped > 0 && report.effects.mapReflections.n > 15);
    assert(report.reset.n < Math.max(500, 2 * report.noise.n));
    assert(Object.values(report.live).every(a => a.battleSeconds > 0));
    if (fleet) assert(report.secondBearing.n > 15 && report.bearingTravel.n > 1000);
    if (!fleet && world === 'Kuat')
      assert(report.cloudObjects.n < 30 && report.effects.leafLight.n < 300 && report.effects.waterOptics.n < 300);
    if (!fleet && world === 'Endor') {
      for (const k in report.effects) assert(report.effects[k].n > 10, k);
      assert(
        report.cloudObjects.n > 30 &&
          report.cloudTravel.n > 30 &&
          report.shadowDraws > 0 &&
          report.casterOnly.n > 30 &&
          report.backlight.n > 10
      );
      assert(report.smoke > 0 && report.flash.n > 10 && report.flashGone.n < 300 && report.distantFlash.n < 300);
      assert(
        report.localPaint.cooler > 100 &&
          report.bedDepth.n > 100 &&
          report.bedDepth.up < report.bedDepth.n / 2 &&
          report.shoreViews.every(d => d.n > 100)
      );
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
