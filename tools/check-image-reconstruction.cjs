// Mounted Universal, isolated player settings. LOOK_BACKEND=webgl exercises the actual fallback.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl',
  land = process.env.LOOK_DOMAIN === 'land';
const out = path.resolve(process.env.LOOK_SHOTS || 'tools/baselines/image-quality', gl ? 'webgl' : 'webgpu', land ? 'land' : 'space');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(85000);
    p.on('pageerror', e => bad.push(e.message));
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION/i.test(
          m.text()
        )
      )
        bad.push(m.text().slice(0, 1200));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      combo = name => s.getByRole('combobox', { name, exact: true }),
      sharp = s.getByRole('slider', { name: 'Upscale sharpness' });
    async function open() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
    }
    await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    await open();
    assert.equal(await combo('Texture magnification').inputValue(), 'original');
    assert.equal(await combo('Post-process AA').inputValue(), 'auto');
    assert(await sharp.isDisabled());
    await combo('Battle upscaling').selectOption('0.67');
    const method = combo('Upscaling method');
    assert.equal(await method.inputValue(), 'fsr1');
    await method.selectOption('bilinear');
    assert(await sharp.isDisabled());
    await method.selectOption('fsr1');
    await combo('Battle upscaling').selectOption('native');
    assert(await method.isDisabled());
    await combo('Battle upscaling').selectOption('0.9');
    assert(!(await method.isDisabled()));
    await sharp.fill('0.7');
    await combo('Texture magnification').selectOption('cubic');
    await combo('Post-process AA').selectOption('fxaa');
    await p.reload();
    await open();
    assert.equal(await combo('Battle upscaling').inputValue(), '0.9');
    assert.equal(await method.inputValue(), 'fsr1');
    assert.equal(await sharp.inputValue(), '0.7');
    assert.equal(await combo('Post-process AA').inputValue(), 'fxaa');
    assert.equal(await combo('Texture magnification').inputValue(), 'cubic');
    await sharp.focus();
    await p.screenshot({ path: path.join(out, 'settings.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await sharp.scrollIntoViewIfNeeded();
    await sharp.focus();
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.screenshot({ path: path.join(out, 'settings-narrow.png') });
    await p.setViewportSize({ width: 1280, height: 720 });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`.title-menu [data-id="${id}"]`).click();
    const b = f.locator('.op-setup'),
      world = land ? 'Kuat' : 'Abregado_Rae',
      domain = land ? 'land' : 'space';
    await b.getByRole('searchbox').fill(land ? 'Kuat' : 'Abregado Forces of Corruption space');
    await b.locator(`[data-world="${world}"][data-domain="${domain}"][data-source="stock"]`).first().click();
    await b.locator('.op-go').click();
    const body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    await body.evaluate(async () => {
      const start = Date.now();
      while (!(window.game?.world?.time > 2)) {
        if (Date.now() - start > 120000) throw Error('Battle did not start');
        await new Promise(r => setTimeout(r, 100));
      }
    });
    const result = await body.evaluate(
      async (_, { gl, land }) => {
        const g = window.game,
          r = land ? g : g.renderer,
          R = land ? (g.gpuOn ? g.gpu : g.renderer) : r.renderer,
          { gfx } = await import('/js/gfx.js');
        if (gl !== !!R.isWebGLRenderer) throw Error('Wrong backend');
        g.modeSuspended = true;
        // All reference pairs must see the final mounted textures and the same instance
        // matrices, not an archive upload or a staggered worker-to-main rescan.
        await new Promise(requestAnimationFrame);
        await (await import('/js/dds.js')).texturesReady();
        if (!land && r.instances) {
          r.instances.jobs = null;
          for (const v of g.world.units) if (v.obj && !v.dead) r.instances.scan(v);
        }
        const W = R.domElement.width,
          H = R.domElement.height;
        let draw, fx, subject;
        if (land) {
          // Keep the camera on the mapped surface and hold weather, animation, reflection updates and simulation fixed.
          const { setBattleSurface } = await import('/js/model.js'),
            { drawSky, heightAt } = await import('/js/game/terrain.js');
          const cam = g.camera;
          const { x, y } = g.view,
            z = heightAt(g.terrain, x, y);
          cam.position.set(x - 34, y - 38, z + 29);
          cam.lookAt(x, y, z);
          cam.updateMatrixWorld();
          subject = g.setup.mapFile;
          fx = g.extraPost(R);
          draw = () => {
            setBattleSurface(true);
            const active = fx.begin();
            R.clear();
            drawSky(R, g.sky, cam);
            R.clearDepth();
            R.render(g.scene, cam);
            if (active) fx.end(cam);
            R.endFrame?.();
            setBattleSurface(false);
          };
        } else {
          const u = g.world.units
            .filter(u => u.obj?.visible && u.player && !u.isFighter && u.visualRadius > 0)
            .sort((a, b) => b.visualRadius - a.visualRadius)[0];
          subject = u.type.name;
          Object.assign(r.rig, {
            x: u.x,
            y: u.y,
            z: u.z || 0,
            free: true,
            pitch: 0.5,
            yaw: u.heading + Math.PI - 0.92,
            // Inspect the paint at actual magnification (Home One also has a high-res mounted variant).
            dist: Math.max(65, u.visualRadius * .9),
            shake: 0
          });
          r.rig.apply(0);
          r.camera.updateMatrixWorld();
          for (const sky of r.skydomes) sky.root.position.copy(r.camera.position);
          r.post.flare = false;
          fx = r.post;
          draw = () => r.draw(g.world, R, 0);
        }
        async function shot(values, paint=draw) {
          Object.assign(gfx, values);
          paint();
          await R.settle?.();
          const next = R.readNext?.();
          paint();
          if (next) return (await next).data;
          const ctx = R.getContext(),
            tmp = new Uint8Array(W * H * 4),
            px = new Uint8Array(tmp.length);
          ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, tmp);
          for (let y = 0; y < H; y++) px.set(tmp.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
          return px;
        }
        const defaults = {
          aa: true,
          battleScale: 1,
          textureCubic: false,
          postAA: 'off',
          upscaleBlend: 0.85,
          upscaleMethod: 'bicubic',
          nativeSharpen: false
        };
        fx.bloom = true;
        const diff = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) n += a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
          return n;
        };
        await shot(defaults);
        const orig = await shot(defaults),
          cubic = await shot({ textureCubic: true }),
          aa = await shot({ ...defaults, postAA: 'fxaa' });
        // Compare reconstruction kernels using identical input pixels. Scene submission
        // (e.g. a distant turret's subpixel MSAA coverage) isn't part of this comparison.
        await shot({ ...defaults, battleScale: 0.67, upscaleBlend: 0 });
        const reconstruct = () => { fx.reconstruct(fx.targets); R.endFrame?.(); };
        const linear = await shot({}, reconstruct),
          up = await shot({ upscaleBlend: 1 }, reconstruct),
          dims = [fx.targets.scene.width, fx.targets.scene.height],
          samples = fx.targets.scene.samples;
        const bilinear = await shot({ upscaleMethod: 'bilinear' }, reconstruct),
          lanczos = await shot({ upscaleMethod: 'lanczos' }, reconstruct),
          easu = await shot({ upscaleMethod: 'fsr1', upscaleBlend: 0 }, reconstruct),
          noTemp = !fx.targets.easu,
          fsr = await shot({ upscaleBlend: 0.7 }, reconstruct),
          full = [fx.targets.easu?.width, fx.targets.easu?.height],
          again = await shot({ upscaleMethod: 'bicubic', upscaleBlend: 1 }, reconstruct),
          released = !fx.targets.easu;
        await shot({ battleScale: 0.9, upscaleMethod: 'fsr1' });
        const ultraDims = [fx.targets.scene.width, fx.targets.scene.height];
        const sharpened = await shot({ ...defaults, nativeSharpen: true });
        // Check native reference alignment, not just that pixels changed: a reflected or empty image must fail.
        const mae = (img, flip) => {
          let sum = 0;
          for (let y = 0; y < H; y += 2)
            for (let x = 0; x < W; x += 2) {
              const k = 4 * (x + W * y),
                j = 4 * (x + W * (flip ? H - 1 - y : y));
              for (let c = 0; c < 3; c++) sum += Math.abs(orig[k + c] - img[j + c]);
            }
          return sum / (Math.ceil(H / 2) * Math.ceil(W / 2) * 3);
        };
        const alignment = [mae(fsr, false), mae(fsr, true)];
        const reset = await shot(defaults),
          restored = [fx.targets.scene.width, fx.targets.scene.height];
        fx.bloom = fx.heat = false;
        await shot({ aa: false, postAA: 'auto' });
        const autoIdle = !fx.active;
        await shot({ postAA: 'fxaa' });
        const aaOnly = fx.active && fx.targets.scene.samples === 0 && fx.mCombine.uniforms.edges.value === 1;
        const png = px => {
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
          return c.toDataURL().split(',')[1];
        };
        return {
          subject,
          autoIdle,
          aaOnly,
          full,
          ultraDims,
          noTemp,
          released,
          alignment,
          spatial: {
            linearReset: diff(linear, bilinear),
            cubicReset: diff(up, again),
            easu: diff(up, easu),
            rcas: diff(easu, fsr),
            lanczos: diff(up, lanczos),
            nativeRcas: diff(orig, sharpened)
          },
          counts: { texture: diff(orig, cubic), fxaa: diff(orig, aa), reconstruct: diff(linear, up), reset: diff(orig, reset) },
          dims,
          restored,
          out: [W, H],
          samples,
          images: [orig, cubic, aa, linear, up, lanczos, easu, fsr, sharpened].map(png)
        };
      },
      { gl, land }
    );
    ['native', 'texture', 'fxaa', 'bilinear', 'bicubic', 'lanczos', 'easu', 'fsr', 'native-rcas'].forEach((n, i) =>
      fs.writeFileSync(path.join(out, n + '.png'), Buffer.from(result.images[i], 'base64'))
    );
    delete result.images;
    console.log({ gl, land, ...result, bad: bad.slice(0, 4) });
    assert.deepEqual(bad, []);
    assert(result.autoIdle && result.aaOnly);
    assert.deepEqual(result.out, result.restored);
    assert.deepEqual(
      result.dims,
      result.out.map(x => Math.round(x * 0.67))
    );
    assert.equal(result.samples, 4);
    assert(result.noTemp && result.released);
    assert.deepEqual(result.full, result.out);
    assert.deepEqual(
      result.ultraDims,
      result.out.map(x => Math.round(x * 0.9))
    );
    assert(result.alignment[0] < result.alignment[1] * 0.5, 'FSR orientation mismatch');
    for (const k of ['easu', 'rcas', 'lanczos', 'nativeRcas']) assert(result.spatial[k] > 500, k + ' has no effect');
    for (const k of ['linearReset', 'cubicReset']) assert(result.spatial[k] <= (land ? 500 : 0), k + ' did not restore legacy filter');
    for (const k of ['texture', 'fxaa', 'reconstruct']) assert(result.counts[k] > 150, k + ' did not change enough pixels');
    assert(result.counts.reset <= (land ? 500 : 0), 'baseline not restored');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
