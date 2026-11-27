// Run on the mounted Universal host with an isolated Chrome profile. No game/window settings are changed on the host.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(process.env.HDR_SHOTS || 'tools/baselines/hdr');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (/GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline/i.test(m.text()))
        errors.push(m.text().slice(0, 500));
    });
    // Emulate only the display capability signal, never the adapter, device, canvas or pixels.
    // The browser still has to negotiate the extended canvas and render a frame brighter than SDR white.
    await page.addInitScript(() => {
      const native = window.matchMedia.bind(window);
      const query = '(dynamic-range: high)',
        m = native(query);
      window.testNativeHDR = m.matches;
      let high = m.matches;
      Object.defineProperty(m, 'matches', { get: () => high });
      window.testHDRDisplay = v => {
        high = v;
        m.dispatchEvent(new Event('change'));
      };
      window.matchMedia = s => (s === query ? m : native(s));
    });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      menu = id => f.locator(`.title-menu [data-id="${id}"]`),
      board = f.locator('.op-setup');
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    const s = f.getByRole('dialog', { name: 'Settings', exact: true });
    await s.getByRole('tab', { name: 'HDR', exact: true }).click();
    await s.getByLabel('HDR output').selectOption('auto');
    const native = await s.evaluate(() => testNativeHDR);
    await s.evaluate(() => testHDRDisplay(true));
    await s.locator('.us-hdr-pattern:visible').waitFor();
    await s.getByRole('slider', { name: 'Paper white', exact: true }).focus();
    await page.screenshot({ path: path.join(out, 'settings.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    assert(await s.getByRole('button', { name: 'Back' }).isVisible());
    assert(
      await s.evaluate(
        e => e.scrollWidth <= e.clientWidth && e.querySelector('.us-hdr').scrollWidth <= e.querySelector('.us-hdr').clientWidth
      )
    );
    await page.screenshot({ path: path.join(out, 'settings-narrow.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await s.getByLabel('HDR output').selectOption('off');
    if (process.env.HDR_SCENE_LIGHT) {
      await s.getByRole('tab',{name:'Graphics Quality',exact:true}).click();
      await s.getByRole('checkbox',{name:'Linear battle lighting',exact:true}).check();
    }
    if (process.env.HDR_RECONSTRUCT) {
      await s.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
      await s.getByLabel('Battlefield look').selectOption('ultra');
      await s.getByLabel('Battle upscaling').selectOption('0.67');
      if (process.env.HDR_FSR) await s.getByLabel('Upscaling method').selectOption('fsr1');
      await s.getByLabel('Post-process AA').selectOption('fxaa');
      await s.getByLabel('Texture magnification').selectOption('cubic');
      await s.getByRole('tab', { name: 'Details', exact: true }).click();
      await s.getByLabel('Cinematic lighting', { exact:true }).check();
    }
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await menu('TITLE_PLAY').click();
    await menu('IDC_INSTANT_BATTLE_BUTTON').click();
    await board.getByRole('searchbox').fill('Abregado Forces of Corruption space');
    await board.locator('[data-world="Abregado_Rae"][data-domain="space"][data-source="stock"]').first().click();
    await board.locator('.op-go').click();
    const body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    await body.evaluate(async () => {
      const start = performance.now();
      while (!window.game?.world || !game.renderer?.gpu || game.world.time < 6 || document.querySelector('.battle-plate')) {
        if (performance.now() - start > 150000) throw Error('No live WebGPU battle: ' + window.game?.constructor.name);
        await new Promise(r => setTimeout(r, 100));
      }
    });
    const result = await body.evaluate(async () => {
      const g = window.game,
        r = g.renderer,
        gpu = r.gpu,
        w = g.world,
        { gfx } = await import('/js/gfx.js');
      g.modeSuspended = true; // Freeze the presentation without drawing a pause menu or stepping animations between exposures.
      const ships = w.units.filter(u => u.obj?.visible && u.player && !u.isFighter && u.visualRadius > 0);
      const u = ships.find(u => u.type.name === 'Star_Destroyer') || ships.sort((a, b) => b.visualRadius - a.visualRadius)[0];
      if (!u) throw Error('No visible unit');
      Object.assign(r.rig, {
        x: u.x,
        y: u.y,
        z: u.z || 0,
        free: true,
        pitch: 0.45,
        yaw: (u.heading || 0) + Math.PI - 0.48, // Three-quarter stern: engine highlights and unlit hull in one frame.
        dist: Math.max(180, u.visualRadius * 2.5),
        shake: 0
      });
      r.rig.apply(0);
      r.camera.updateMatrixWorld();
      for (const sky of r.skydomes) sky.root.position.copy(r.camera.position);
      r.post.flare = false; // No time-integrated flare changes between identical exposures.
      async function shot(mode) {
        gfx.hdrMode = mode;
        r.draw(w, gpu, 0);
        await gpu.settle();
        r.draw(w, gpu, 0);
        await gpu.settle();
        const next = gpu.readNext({ extended: true });
        r.draw(w, gpu, 0);
        return next;
      }
      testHDRDisplay(false);
      await shot('auto');
      if (gpu.hdrPass) throw Error('SDR fallback failed');
      const sdr = await shot('off');
      testHDRDisplay(true);
      const hdr = await shot('auto'),
        config = gpu.context.getConfiguration();
      if (!(hdr.data instanceof Float32Array) || config.toneMapping.mode !== 'extended') throw Error('Expected FP16 extended canvas');
      const colors = Object.fromEntries(Object.entries(r.post.targets || {}).map(([k, t]) => [k, gpu.targets.get(t)?.format]));
      let peak = 0,
        above = 0;
      for (let i = 0; i < hdr.data.length; i += 4) {
        const v = Math.max(hdr.data[i], hdr.data[i + 1], hdr.data[i + 2]);
        if (!Number.isFinite(v) || !Number.isFinite(hdr.data[i+3])) throw Error('Non-finite HDR output');
        peak = Math.max(peak, v);
        above += v > 1.001;
      }
      // Pack the displayed sRGB signal, not a gamma/contrast filter applied to an SDR screenshot.
      const b64 = bytes => {
        let s = '';
        for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(s);
      };
      // Dim the same frame using paper white, not the OS or a CSS filter. Near-black should lift with shadow detail.
      gfx.hdrPaper = 100;
      const dim = await shot('auto');
      gfx.hdrShadows = 1;
      const lift = await shot('auto');
      let dimmed = 0,
        lifted = 0;
      for (let i = 0; i < hdr.data.length; i += 4) {
        dimmed += dim.data[i] + 0.002 < hdr.data[i];
        lifted += lift.data[i] > dim.data[i] + 0.002;
      }
      Object.assign(gfx, { hdrPaper: 203, hdrShadows: 0, hdrPeak: 400 });
      const limited = await shot('auto');
      let maxLimited = 0;
      for (let i = 0; i < limited.data.length; i += 4) maxLimited = Math.max(maxLimited, limited.data[i], limited.data[i+1], limited.data[i+2]);
      if (!(dimmed > 100 && lifted > 100 && maxLimited < peak && maxLimited <= 1.055 * (400 / 203) ** (1 / 2.4) - 0.055 + 0.001))
        throw Error('Calibration did not affect rendered pixels');
      gfx.hdrPeak = 1000;
      const again = await shot('off');
      let drift = 0;
      for (let i = 0; i < sdr.data.length; i++) drift = Math.max(drift, Math.abs(again.data[i] - sdr.data[i]));
      return {
        width: sdr.width,
        height: sdr.height,
        world: g.setup.mapFile,
        unit: u.type.name,
        above,
        peak,
        drift,
        colors,
        format: config.format,
        sdr: b64(sdr.data),
        hdr: b64(new Uint8Array(hdr.data.buffer))
      };
    });
    const { sdr, hdr, ...meta } = result;
    fs.writeFileSync(path.join(out, 'sdr.rgba'), Buffer.from(sdr, 'base64'));
    fs.writeFileSync(path.join(out, 'hdr.f32'), Buffer.from(hdr, 'base64'));
    fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ ...meta, nativeDisplayReportsHDR: native }, null, 2));
    console.log(out, { ...meta, nativeDisplayReportsHDR: native }, errors);
    assert.equal(meta.drift, 0, 'switching back restores the same SDR pixels');
    assert(meta.above > 0 && meta.peak > 1, 'actual scene has extended highlights');
    if (process.env.HDR_RECONSTRUCT) {
      assert.equal(meta.colors.upInput, 'rgba16float');
      if (process.env.HDR_FSR) assert.equal(meta.colors.easu, 'rgba16float');
      assert.equal(meta.colors.mid, 'rgba16float');
    }
    assert.equal(meta.colors.scene, 'rgba16float');
    assert.equal(meta.colors.heat, 'rgba8unorm');
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
