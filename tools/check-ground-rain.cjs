// Always enter through mounted Universal. Matched scene captures stay in TEMP, not the repo.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os');
const world = process.env.LOOK_WORLD || 'Endor',
  id = process.env.LOOK_PROFILE || 'stock',
  gl = process.env.LOOK_BACKEND === 'webgl';
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
        /GPUValidationError|Error while parsing WGSL|Error while validating|Shader Error|INVALID_OPERATION|invalid.*pipeline/i.test(
          m.text()
        ) &&
        bad.length < 3
      ) {
        bad.push(m.text().slice(0, 1300));
        console.error(bad.at(-1));
      }
    });
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      box = s.getByRole('checkbox', { name: 'Rain on terrain', exact: true });
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
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const name of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${name}"]:visible`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill(world);
    const leaf = board.locator(`[data-world="${world}"][data-domain="land"][data-source="${id}"]`).first(),
      file = await leaf.getAttribute('data-file');
    await leaf.click();
    await f.locator(`.op-setup[data-profile="${id}"] .op-go:enabled`).click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const { report, images } = await f.locator('body').evaluate(
      async (_, args) => {
        const tick = () => new Promise(requestAnimationFrame),
          start = performance.now();
        while (!(window.game?.world?.time > 2 && game.groundRain)) {
          if (performance.now() - start > 100000) throw Error('No ground world');
          await tick();
        }
        const g = game,
          w = g.world,
          R = g.gpuOn ? g.gpu : g.renderer,
          W = R.domElement.width,
          H = R.domElement.height,
          { gfx } = await import('/js/gfx.js'),
          U = g.ground.material.uniforms,
          T = await import('three');
        if (R.isMirror || !!g.gpuOn === args.gl) throw Error('Wrong backend');
        gfx.rainSurfaces = true;
        const rain = g.map.environments?.find(
          e => e.weather && w.tables.scenarios.get(e.weather.toUpperCase())?.phases.some(p => p.name === 'rain')
        );
        const report = {
            map: g.setup.mapFile,
            backend: args.gl ? 'webgl' : 'webgpu',
            scenario: rain?.weather || null,
            initial: w.weather.name,
            samples: {},
            pan: {}
          },
          images = {};
        const control = args.world === 'Tatooine';
        if (!control) {
          w.setWeather(rain?.weather || 'RAIN_CONSTANT');
          const ph = w.weather.phases.findIndex(p => p.name === 'rain' && p.strength === 1);
          if (ph < 0) throw Error('No mounted liquid phase');
          w.weather.i = ph;
          w.weather.out = false;
          w.weatherPhase(w.weather.phases[ph]);
          const before = g.groundRain.amount;
          for (let j = 0; j < 18; j++) await tick();
          report.live = g.groundRain.amount - before;
        }
        const anchor = w.units.find(u => u.foot && u.holder?.visible && u.side === g.me);
        if (!anchor) throw Error('No army');
        Object.assign(g.view, { x: anchor.x + 35, y: anchor.y + 40, dist: 580 });
        g.modeSuspended = true;
        await tick();
        await (await import('/js/dds.js')).texturesReady();
        const now = g.last,
          clock = w.time;
        const draw = () => {
          g.warming = true;
          g.modeSuspended = false;
          try {
            g.frame(now);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
        };
        async function shot(on = true) {
          gfx.rainSurfaces = on;
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
        const l = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
        function diff(a, b) {
          let n = 0,
            dark = 0,
            bright = 0,
            loss = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = l(a, i) - l(b, i);
            if (Math.abs(d) > 3) {
              n++;
              if (d > 0) {
                dark++;
                loss += d;
              } else bright++;
            }
          }
          return { n, dark, bright, loss };
        }
        function image(k, data) {
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), W, H), 0, 0);
          images[k] = c.toDataURL('image/jpeg', 0.9).split(',')[1];
        }
        // Keep camera, units and lighting fixed. Run archive particles only between phase captures;
        // freeze their positions for each on/off pair. Use the actual emitter, not a screen overlay.
        const phWet = w.weather.phases.find(p => p.name === 'rain' && p.strength === 1),
          phClear = w.weather.phases.find(p => p.name === 'clear') || { name: 'clear', strength: 0, seconds: 90 };
        async function phase(ph) {
          w.weather.out = false;
          w.weatherPhase(ph);
          draw();
          for (let i = 0; i < 32; i++) {
            g.fx.update(0.09);
            await tick();
          }
          draw();
          await tick();
        }
        if (!control) await phase(phClear);
        await shot(false);
        const original = await shot(false);
        g.groundRain.amount = 0;
        const dry = await shot();
        report.samples.dry = diff(original, dry);
        image('dry', dry);
        if (control) {
          g.groundRain.update(w.weather, 60);
          report.amount = g.groundRain.amount;
          report.samples.control = diff(original, await shot());
          return { report, images };
        }
        await phase(phWet);
        report.emitting = !!g.wxFx;
        const rainBase = await shot(false);
        g.groundRain.update(w.weather, 37);
        const wet = await shot();
        report.wet = U.groundWet.value;
        report.samples.rain = diff(rainBase, wet);
        image('rain', wet);
        const audioCount = {
            play() {
              this.n++;
            },
            n: 0
          },
          dec = g.decals,
          { groundKind } = await import('/js/game/landdecals.js'),
          kind = groundKind(w, anchor.x, anchor.y);
        let pick;
        for (const [a, list] of w.tables.animEvents) {
          const event = list.find(ev => {
            const kinds = w.tables.surface.get((ev.surface || '').toUpperCase()),
              e = kinds?.get(kind) || kinds?.get('default');
            return /footpuff_(dirt|grass|default)/i.test(e?.particle || '') && e.decal && ev.t < 2;
          });
          if (event) {
            pick = { a, event };
            break;
          }
        }
        if (pick) {
          const counts = {},
            stamp = dec.stamp;
          try {
            for (const k of [0, report.wet]) {
              let bursts = 0,
                marks = 0;
              audioCount.n = 0;
              dec.stamp = () => marks++;
              dec.groundWet = k;
              const one = { x: anchor.x, y: anchor.y, heading: 0, foot: false, inst: { bone: () => null } };
              for (let j = 0; j < 48; j++) {
                const end = pick.event.t;
                one.anim = { anim: { name: pick.a }, time: end };
                one.evAnim = one.anim;
                one.evT = end - 0.00001;
                dec.events(one, w.tables, audioCount, (_p, _x, _y, emit) => {
                  if (emit) bursts++;
                });
              }
              counts[k ? 'wet' : 'dry'] = { bursts, marks, sounds: audioCount.n };
            }
            report.steps = counts;
          } finally {
            dec.stamp = stamp;
          }
        }
        await phase(phClear);
        report.stopped = !g.wxFx;
        g.groundRain.update(w.weather, 8);
        const clearBaseline = await shot(false),
          after = await shot();
        report.after = U.groundWet.value;
        image('after', after);
        report.samples.after = diff(clearBaseline, after);
        report.samples.off = diff(clearBaseline, await shot(false));
        // Pan with and without the retained film, same warm simulation/poses, no readbacks in the sample.
        const baseX = g.view.x;
        for (const on of [false, true, true, false]) {
          gfx.rainSurfaces = on;
          draw();
          await g.gpu?.settle();
          let prev = await tick();
          const dt = (report.pan[on] ||= []);
          for (let i = 0; i < 42; i++) {
            g.view.x = baseX + (i - 20);
            draw();
            const tm = await tick();
            if (i > 5) dt.push(tm - prev);
            prev = tm;
          }
        }
        for (const key in report.pan) {
          const a = report.pan[key].sort((a, b) => a - b);
          report.pan[key] = [a[Math.floor(a.length * 0.5)], a[Math.floor(a.length * 0.95)]];
        }
        g.view.x = baseX;
        g.groundRain.update(w.weather, 75);
        report.samples.dried = diff(clearBaseline, await shot());
        report.dried = U.groundWet.value;
        report.clockFixed = clock === w.time;
        // A material coupon in the actual terrain shader isolates the grazing-angle term from
        // map geometry and rain sprites. No distributed test art. Fill the view with one mounted layer.
        const target = new T.WebGLRenderTarget(32, 32),
          scene = new T.Scene(),
          cam = new T.PerspectiveCamera(20, 1, 1, 4000),
          geo = new T.PlaneGeometry(1200, 1200),
          m = g.ground.material;
        geo.setAttribute('corner', new T.BufferAttribute(new Float32Array(8), 2));
        geo.setAttribute('shade', new T.BufferAttribute(new Float32Array(4).fill(1), 1));
        const at = new T.Vector3(30, 15, 2000),
          quad = new T.Mesh(geo, m);
        geo.translate(...at.toArray());
        const layers = new T.BufferAttribute(new Float32Array(16), 4);
        geo.setAttribute('layers', layers);
        scene.add(quad);
        const current = R.getRenderTarget(),
          map = g.terrain.paint.slot;
        const pixel = async (slot, tilt, wet, film) => {
          layers.array.fill(slot);
          layers.needsUpdate = true;
          U.groundWet.value = wet;
          const coeff = U.texV.value[slot],
            old = coeff.w;
          coeff.w = film ?? old;
          cam.position.copy(at).add(new T.Vector3(0, -100, tilt ? 20 : 800));
          cam.up.set(0, 0, 1);
          cam.lookAt(at);
          cam.updateMatrixWorld();
          R.setRenderTarget(target);
          try {
            R.clear();
            R.render(scene, cam);
            R.endFrame?.();
            await g.gpu?.settle();
            R.clear();
            R.render(scene, cam);
            const out = new Uint8Array(4);
            await R.readRenderTargetPixelsAsync(target, 16, 16, 1, 1, out);
            return l(out, 0);
          } finally {
            coeff.w = old;
          }
        };
        try {
          const slot = [...map.values()].sort((a, b) => U.texV.value[b].w - U.texV.value[a].w)[0];
          if (args.id !== 'stock') {
            // Keep the mounted art, but remove all classification hints as on an unfamiliar mod.
            const { wetSurface } = await import('/js/groundrain.js');
            const u = U.texU.value[slot],
              v = U.texV.value[slot],
              before = [u.w, v.w];
            try {
              [u.w, v.w] = wetSurface({ texture: 'unknown_702', kind: 0 });
              report.fallback = {
                dry: await pixel(slot, true, 0),
                wet: await pixel(slot, true, 1),
                noSheen: await pixel(slot, true, 1, 0)
              };
            } finally {
              [u.w, v.w] = before;
            }
          }
          report.coupon = {
            film: U.texV.value[slot].w,
            upright: (await pixel(slot, false, 1)) - (await pixel(slot, false, 1, 0)),
            grazing: (await pixel(slot, true, 1)) - (await pixel(slot, true, 1, 0))
          };
        } finally {
          R.setRenderTarget(current);
          R.releaseTarget?.(target);
          target.dispose();
          geo.dispose();
        }
        return { report, images };
      },
      { world, id, gl }
    );
    const dir = path.join(os.tmpdir(), 'universal-ground-rain', id, world, gl ? 'webgl' : 'webgpu');
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(images)) fs.writeFileSync(path.join(dir, k + '.jpg'), Buffer.from(v, 'base64'));
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), dir);
    assert.equal(report.map.toLowerCase(), file.toLowerCase());
    assert.deepEqual(bad, []);
    assert(report.samples.dry.n < 400);
    if (world === 'Tatooine') {
      assert.equal(report.amount, 0);
      assert(report.samples.control.n < 400);
    } else {
      assert(
        report.live > 0 &&
          report.emitting &&
          report.stopped &&
          report.clockFixed &&
          report.wet > report.after &&
          report.after > 0.1 &&
          report.dried === 0
      );
      assert(
        report.samples.rain.dark > 2000 && report.samples.after.loss < report.samples.rain.loss * 0.98 && report.samples.after.dark > 1000
      );
      assert(report.samples.off.n < 400 && report.samples.dried.n < 400);
      if (id !== 'stock') {
        const { dry, wet, noSheen } = report.fallback;
        assert(wet < dry && wet > dry * 0.76 && Math.abs(wet - noSheen) < 4);
      }
      if (world === 'Endor') {
        assert(
          report.steps?.dry.bursts >= 48 &&
            report.steps.wet.bursts < report.steps.dry.bursts * 0.7 &&
            report.steps.dry.marks === report.steps.wet.marks &&
            report.steps.dry.sounds === report.steps.wet.sounds
        );
        assert(report.coupon.grazing > report.coupon.upright + 1);
      }
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
