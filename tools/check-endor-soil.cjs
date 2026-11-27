// Requires Chrome, playwright-core, and the running mounted Universal library. Private PNGs stay in TEMP.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl',
  eaw = process.env.LOOK_EDITION === 'eaw',
  out = path.join(os.tmpdir(), 'universal-endor-earth-4k', (eaw ? 'eaw-' : '') + (gl ? 'webgl' : 'webgpu'));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(100000);
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Shader Error|Error while (validating|parsing WGSL)|INVALID_OPERATION|webgpu pipeline|webgpu texture|Endor scanned earth:/.test(
          m.text()
        )
      ) {
        errors.push(m.text().slice(0, 500));
        console.error(errors.at(-1));
      }
    });
    const broken = process.env.SOIL_FALLBACK === '1';
    if (broken)
      await p.route('**/forest-ground-04/*.dds', r =>
        r.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'damaged fixture' })
      );
    let requests = 0;
    p.on('request', r => {
      if (/\/art\/forest-ground-04\/.+\.dds$/i.test(r.url())) requests++;
    });
    if (eaw) await p.addInitScript(() => localStorage.setItem('swr.game', 'eaw'));
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      label = s.getByRole('checkbox', { name: 'Endor scanned earth', exact: true });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    fs.mkdirSync(out, { recursive: true });
    await settings();
    assert(!(await label.isChecked()));
    await label.scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(out, 'settings.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await label.focus();
    await label.press('Space');
    assert(await label.isChecked());
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.screenshot({ path: path.join(out, 'narrow.png') });
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert(await label.isChecked());
    await label.uncheck();
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${id}"]:visible`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Endor');
    await board.locator('[data-world="Endor"][data-domain="land"][data-source="stock"]').first().click();
    await f.locator('.op-setup[data-profile="stock"] .op-go:enabled').click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const body = f.locator('body');
    await body.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame);
      while (!(window.game?.world?.time > 1 && game.ground)) await wait();
    });
    assert.equal(requests, 0);
    if (broken) {
      const warning = p.waitForEvent('console', { predicate: m => m.text().includes('Endor scanned earth: using original dirt.') });
      await body.evaluate(async () => {
        (await import('/js/gfx.js')).gfx.endorForestFloor = true;
      });
      await warning;
      assert(
        await body.evaluate(async () => {
          const t = game.world.time;
          for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
          const u = game.ground.material.uniforms;
          return game.world.time > t && !u.forestSlot.value && !u.soilColor.value && !u.soilSurface.value;
        })
      );
      assert(errors.every(e => e.includes('Endor scanned earth: using original dirt.')));
      console.log('PASS corrupted donor: live battle advancing on stock dirt, neither map bound');
      return;
    }
    const mip = Number(process.env.SOIL_MIP || 0);
    if (mip === 1 || mip === 2) {
      const actual = await body.evaluate(async (_, k) => {
        const { gfx } = await import('/js/gfx.js');
        gfx.texMip = k;
        gfx.endorForestFloor = true;
        const g = game,
          u = g.ground.material.uniforms,
          start = performance.now();
        while (!u.forestSlot.value) {
          if (performance.now() - start > 30000) throw Error('Reduced tier unavailable');
          await new Promise(requestAnimationFrame);
        }
        return [u.soilColor.value, u.soilSurface.value].map(t => [t.image.width, t.mipmaps.length]);
      }, mip);
      assert.deepEqual(actual, Array(2).fill([4096 >> mip, 13 - mip]));
      assert.equal(requests, 2);
      assert.deepEqual(errors, []);
      console.log('PASS reduced texture tier', actual);
      return;
    }
    const result = await body.evaluate(async (_, gl) => {
      const wait = () => new Promise(requestAnimationFrame),
        g = game,
        w = g.world,
        R = g.gpuOn ? g.gpu : g.renderer,
        gpu = g.gpuOn && g.gpu;
      if (gl === !!gpu || R.isMirror) throw Error('Wrong backend');
      const { gfx } = await import('/js/gfx.js'),
        { texturesReady } = await import('/js/dds.js'),
        U = g.ground.material.uniforms,
        t = g.terrain;
      const target = [...t.paint.slot.keys()].find(i => t.layers[i].texture.toUpperCase() === 'W_SMOOTHDIRT00.TGA'),
        root = w.units.find(u => u.foot && u.holder?.visible && u.side === g.me);
      // Aim inside a painted clearing, not at an arbitrary forest screenshot. Prefer a connected patch with a visible unit for scale.
      let pos,
        score = -Infinity;
      for (let iy = 5; iy < t.height - 5; iy++)
        for (let ix = 5; ix < t.width - 5; ix++) {
          if (t.layerIndex[iy * t.size + ix] !== target) continue;
          let n = 0;
          for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (t.layerIndex[(iy + y) * t.size + ix + x] === target) n++;
          const x = 20 * ix,
            y = 20 * iy,
            c = n - Math.hypot(root.x - x, root.y - y) * 0.025;
          if (c > score) {
            score = c;
            pos = { x, y };
          }
        }
      if (!pos) throw Error('No painted layer');
      const { x, y } = pos;
      const walker = await w.spawn('AT_ST_Walker', x + 8, y + 6, 1.5, g.me),
        inf = await w.spawn('Stormtrooper', x - 7, y + 3, 1.5, g.me);
      if (!walker || !inf) throw Error('No reference units');
      await texturesReady();
      for (let i = 0; i < 35; i++) await wait();
      g.modeSuspended = true;
      await wait();
      const now = g.last,
        W = R.domElement.width,
        H = R.domElement.height;
      const report = {
        backend: gl ? 'WebGL' : 'WebGPU',
        edition: (await import('/js/edition.js')).edition(),
        map: g.map.file,
        layer: t.layers[target].texture,
        view: [W, H],
        pos,
        atlasBytes: [U.map, U.bump].map(u => u.value.mipmaps.reduce((s, m) => s + m.data.length, 0)),
        atlasDepth: [U.map.value.image.depth, U.bump.value.image.depth],
        views: {},
        pan: {}
      };
      const draw = () => {
        g.modeSuspended = false;
        g.warming = true;
        try {
          g.frame(now);
        } finally {
          g.warming = false;
          g.modeSuspended = true;
        }
      };
      async function set(on) {
        gfx.endorForestFloor = on;
        let start = performance.now();
        while (true) {
          draw();
          if (!!U.forestSlot.value === on) break;
          if (performance.now() - start > 30000) throw Error('No material transition: ' + [g.map.file, target, U.forestSlot.value]);
          await wait();
        }
        await gpu?.settle?.();
      }
      async function shot() {
        for (let i = 0; i < 3; i++) {
          draw();
          await gpu?.settle?.();
        }
        const pending = gpu?.readNext?.();
        draw();
        if (pending) return (await pending).data;
        const ctx = R.getContext(),
          buf = new Uint8Array(W * H * 4),
          flipped = new Uint8Array(buf.length);
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
        for (let i = 0; i < H; i++) flipped.set(buf.subarray((H - 1 - i) * W * 4, (H - i) * W * 4), i * W * 4);
        return flipped;
      }
      function diff(a, b) {
        let visible = 0,
          sum = 0;
        for (let i = 0; i < a.length; i += 4) {
          const v = Math.abs((a[i] - b[i]) * 0.2126 + (a[i + 1] - b[i + 1]) * 0.7152 + (a[i + 2] - b[i + 2]) * 0.0722);
          if (v > 2) visible++;
          sum += v;
        }
        return { pixelsOver2: visible, meanLumaDelta: +(sum / (W * H)).toFixed(3) };
      }
      const imgs = {};
      function save(k, a) {
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        let pixels = new Uint8ClampedArray(a);
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
        cv.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);
        imgs[k] = cv.toDataURL().split(',')[1];
      }
      // Resolve lazy programs, shadow casters and the optional texture before measuring reversible draws.
      const u = walker.members[0];
      if (!u?.holder.visible) throw Error('Walker not visible');
      await set(true);
      await set(false);
      const maps = [U.soilColor.value, U.soilSurface.value];
      report.maps = maps.map(t => ({
        width: t.image.width,
        mips: t.mipmaps.length,
        bytes: t.mipmaps.reduce((a, m) => a + m.data.length, 0)
      }));
      if (report.maps.some(m => m.width !== 4096 || m.mips !== 13)) throw Error('4K source not bound: ' + JSON.stringify(report.maps));
      if (gpu && maps.some(t => gpu.textures.get(t)?.tex?.width !== 4096)) throw Error('WebGPU did not upload native 4K');
      const pivot = { x: u.x, y: u.y - 8 };
      report.walker = [u.x, u.y, u.z];
      for (const [key, dist, pitch] of [
        ['inspection', 23, 0.66],
        ['close', 132, 0.65],
        ['command', 410, 0.88]
      ]) {
        Object.assign(g.view, { x: pivot.x - (key === 'inspection' ? 19 : 0), y: pivot.y, dist, pitch, yaw: -1.48 });
        for (let j = 0; j < 35; j++) {
          draw();
          await wait();
        }
        await set(false);
        const a = await shot();
        await set(true);
        const b = await shot();
        if (key === 'inspection') {
          // Same maps, camera and shading. Drop only the top three mips to emulate a 512px cap.
          const T = await import('three');
          const low = maps.map(t => {
            const m = t.mipmaps.slice(3),
              r = new T.CompressedTexture(m, 512, 512, t.format);
            for (const k of ['wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy', 'colorSpace']) r[k] = t[k];
            r.needsUpdate = true;
            return r;
          });
          [U.soilColor.value, U.soilSurface.value] = low;
          const small = await shot();
          report.nativeVs512 = diff(b, small);
          [U.soilColor.value, U.soilSurface.value] = maps;
          low.forEach(t => t.dispose());
        }
        await set(false);
        const c = await shot();
        save(key + '-stock', a);
        save(key + '-scan', b);
        report.views[key] = { change: diff(a, b), reset: diff(a, c) };
      }
      // A close control over a contiguous patch of the exact green layer the old pilot modified.
      const grass = t.layers.findIndex(l => l.texture?.toUpperCase() === 'W_TEMPGRND08.TGA');
      let patch = null,
        best = Infinity;
      for (let y = 4; y < t.height - 4; y++)
        for (let x = 4; x < t.width - 4; x++) {
          if (Math.hypot(x * 20 - pivot.x, y * 20 - pivot.y) >= best) continue;
          let ok = true;
          for (let j = -2; j <= 2 && ok; j++)
            for (let k = -2; k <= 2; k++)
              if (t.layerIndex[(y + j) * t.size + x + k] !== grass) {
                ok = false;
                break;
              }
          if (ok) {
            patch = { x: x * 20, y: y * 20 };
            best = Math.hypot(patch.x - pivot.x, patch.y - pivot.y);
          }
        }
      if (!patch) throw Error('No grass control');
      Object.assign(g.view, { ...patch, dist: 22, pitch: 1.35 });
      for (let j = 0; j < 35; j++) {
        draw();
        await wait();
      }
      await set(false);
      const grassA = await shot();
      await set(true);
      report.grassControl = diff(grassA, await shot());
      Object.assign(g.view, { ...pivot, dist: 410, pitch: 0.88, yaw: -1.48 });
      const samples = [[], []];
      for (const on of [false, true, true, false]) {
        await set(on);
        for (let i = 0; i < 20; i++) {
          draw();
          await wait();
        }
        let prev = await wait();
        for (let i = 0; i < 60; i++) {
          g.view.x = pivot.x + i * 0.32;
          draw();
          const v = await wait();
          samples[+on].push(v - prev);
          prev = v;
        }
        g.view.x = pivot.x;
      }
      for (const on of [false, true]) {
        const s = samples[+on].sort((a, b) => a - b);
        report.pan[on ? 'scan' : 'stock'] = {
          n: s.length,
          median: +s[s.length >> 1].toFixed(2),
          p95: +s[Math.ceil(s.length * 0.95) - 1].toFixed(2)
        };
      }
      return { report, imgs };
    }, gl);
    for (const [name, png] of Object.entries(result.imgs)) fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
    result.report.requests = requests;
    result.report.errors = errors;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(result.report, null, 2));
    console.log(out, JSON.stringify(result.report));
    assert.equal(result.report.edition, eaw ? 'eaw' : 'foc');
    assert.equal(requests, 2);
    assert(result.report.nativeVs512.pixelsOver2 > 1000, 'Native 4K detail did not survive sampling');
    assert(result.report.grassControl.pixelsOver2 < 100, 'Former grass layer must retain stock appearance');
    assert.deepEqual(errors, []);
    for (const v of Object.values(result.report.views)) {
      assert(v.change.pixelsOver2 > 1000);
      assert(v.reset.pixelsOver2 < Math.max(500, v.change.pixelsOver2 * 0.03));
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
