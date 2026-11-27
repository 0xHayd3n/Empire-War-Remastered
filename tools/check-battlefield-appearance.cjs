// Mounted Universal, isolated preferences. LOOK_BACKEND=webgl tests the actual fallback, not a mocked renderer.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl',
  fleet = process.env.LOOK_FLEET === '1',
  out = path.resolve(process.env.LOOK_SHOTS || 'tools/baselines/appearance', gl ? 'webgl' : 'webgpu');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(75000);
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION/.test(
          m.text()
        )
      )
        bad.push(m.text().slice(0, 700));
    });
    p.on('pageerror', e => bad.push(e.message));
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      look = s.getByLabel('Battlefield look'),
      spaceLook = s.getByLabel('Space battle look'),
      slider = name => s.getByRole('slider', { name, exact: true }),
      open = async () => {
        await f.getByRole('button', { name: 'System menu' }).click();
        await f.getByRole('button', { name: 'Settings', exact: true }).click();
        await s.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
      };
    await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    await open();
    assert.equal(await look.inputValue(), 'original');
    assert.equal(await spaceLook.inputValue(), 'inherit');
    await spaceLook.selectOption('deep-space');
    await look.selectOption('enhanced');
    assert.equal(await slider('Surface relief').inputValue(), '0.8');
    await slider('Environment lighting').press('ArrowLeft');
    assert.equal(await look.inputValue(), 'custom');
    await p.reload();
    await open();
    assert.equal(await look.inputValue(), 'custom');
    assert.equal(await slider('Environment lighting').inputValue(), '0.8');
    assert.equal(await spaceLook.inputValue(), 'deep-space');
    await spaceLook.selectOption('inherit');
    assert.equal(await look.inputValue(), 'custom');
    await look.selectOption('original');
    assert.equal(await slider('Anamorphic glare').inputValue(), '0');
    await look.selectOption('ultra');
    assert.equal(await slider('Contact shading').inputValue(), '0.85');
    await slider('Material highlights').fill('0.55');
    await p.reload();
    await open();
    assert.equal(await look.inputValue(), 'custom');
    assert.equal(await slider('Material highlights').inputValue(), '0.55');
    await look.selectOption('enhanced');
    assert.equal(await slider('Contact shading').inputValue(), '0');
    await look.selectOption('ultra');
    await look.focus();
    await p.screenshot({ path: path.join(out, 'settings.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await spaceLook.focus();
    await spaceLook.press('End');
    assert.equal(await spaceLook.inputValue(), 'deep-space');
    await spaceLook.press('ArrowUp');
    assert.equal(await spaceLook.inputValue(), 'orbital');
    await spaceLook.press('Home');
    assert.equal(await spaceLook.inputValue(), 'inherit');
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.screenshot({ path: path.join(out, 'settings-narrow.png') });
    await p.setViewportSize({ width: 1280, height: 720 });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    if (fleet) await f.locator('body').evaluate(async () => {
      // Use a real instant-battle draft in this disposable profile; the normal board validates and launches it.
      const { instantRoster, shipsOf, INSTANT_BUDGET_MAX: budget } = await import('/js/game/instantbattle.js');
      const players = ['Empire', 'Rebel'].map((faction, team) => {
        const options = instantRoster(faction).filter(r => !r.hero);
        const flagship = options.find(r => shipsOf(r.type).some(t => /^(Generic_)?Star_Destroyer$/i.test(t.name)));
        if (!team && !flagship) throw Error('Missing mounted Imperial Star Destroyer');
        const escorts = options.filter(r => r.cls >= 2 && r.cls <= 4);
        if (!escorts.length) throw Error('No escorts: ' + faction);
        const army = Array.from({ length: 100 }, (_, i) => (i === 0 && flagship ? flagship : escorts[i % escorts.length]).name);
        return { faction, team, budget, army, kind: team ? 'medium' : 'you' };
      });
      localStorage.setItem('swr-instant-setup', JSON.stringify({ turn: 0, budget, players }));
    });
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup');
    const worldId = process.env.LOOK_WORLD || 'Abregado_Rae';
    await board.getByRole('searchbox').fill(worldId.replaceAll('_', ' ') + ' Forces of Corruption space');
    await board.locator(`[data-world="${worldId}"][data-domain="space"][data-source="stock"]`).first().click();
    await board.locator('.op-go').click();
    const body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    await body.evaluate(async () => {
      const t = performance.now();
      while (!window.game?.renderer?.draw || !(game.world?.time > 5)) {
        if (performance.now() - t > 150000) throw Error('battle failed to start');
        await new Promise(r => setTimeout(r, 100));
      }
    });
    if (fleet) {
      // Exercise the actual pause menu, not just preference writes in the capture loop.
      await body.evaluate(() => game.menus.main());
      await f.locator('[data-id="IDC_INGAME_OPTIONS"]').click();
      await s.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
      await spaceLook.selectOption('cinematic');
      await s.getByRole('button', { name: 'Back', exact: true }).click();
      await f.locator('[data-id="IDC_GAME_OPTIONS_RESUME"]').click();
    }
    const { counts, unit, backend, images, renderMs } = await body.evaluate(async (_, { gl, fleet }) => {
      const g = window.game,
        w = g.world,
        r = g.renderer,
        R = r.renderer,
        gpu = r.gpu,
        { gfx } = await import('/js/gfx.js'),
        { originalLook, enhancedLook, ultraLook } = await import('/js/battlelook.js');
      if (gl !== !!R.isWebGLRenderer || !!gpu === gl) throw Error('Wrong backend');
      g.modeSuspended = true;
      const { texturesReady } = await import('/js/dds.js');
      await texturesReady(); // Late archive uploads can otherwise alter a frozen battle between look/AA switches.
      const ships = w.units.filter(u => u.obj?.visible && u.player && !u.isFighter && u.visualRadius > 0),
        flagship = ships.find(u => /^(Generic_)?Star_Destroyer$/i.test(u.type.name)),
        u = flagship || ships.sort((a, b) => b.visualRadius - a.visualRadius)[0];
      if (fleet && (!flagship || gfx.spacePresentation !== 'cinematic' || !g.setup.instant.armies.every(a => a.length === 100)))
        throw Error('Expected the cinematic preset and two mounted 100-ship fleets with a visible Star Destroyer');
      Object.assign(r.rig, {
        x: u.x,
        y: u.y,
        z: u.z || 0,
        free: true,
        pitch: 0.51,
        yaw: u.heading + Math.PI - 0.92,
        dist: Math.max(160, u.visualRadius * 2.4),
        shake: 0
      });
      r.rig.apply(0);
      r.camera.updateMatrixWorld();
      for (const sky of r.skydomes) sky.root.position.copy(r.camera.position);
      r.post.flare = false;
      const W = R.domElement.width,
        H = R.domElement.height;
      async function shot(values) {
        Object.assign(gfx, values);
        r.draw(w, R, 0);
        if (['orbital','deep-space'].includes(gfx.spacePresentation)) await r.orbitProbe.ready;
        if (gpu) await gpu.settle();
        const next = gpu?.readNext();
        r.draw(w, R, 0);
        if (next) return (await next).data;
        const ctx = R.getContext(),
          px = new Uint8Array(W * H * 4),
          out = new Uint8Array(px.length);
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        for (let y = 0; y < H; y++) out.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        return out;
      }
      // Settle the newly pinned camera/instance lists before measuring a reversible change.
      await shot({ ...originalLook, spacePresentation: 'inherit' });
      const original = await shot({ ...originalLook, spacePresentation: 'inherit' }),
        counts = {};
      function diff(a, b) {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) n += a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
        return n;
      }
      for (const [key, v] of Object.entries(ultraLook)) counts[key] = diff(original, await shot({ ...originalLook, [key]: v }));
      const enhanced = await shot(enhancedLook);
      const ultra = await shot(ultraLook);
      counts.enhancedToUltra = diff(enhanced, ultra);
      counts.enhancedReset = diff(enhanced, await shot(enhancedLook));
      counts.all = diff(original, enhanced);
      const cinematic = await shot({ ...originalLook, spacePresentation: 'cinematic' });
      const linear = await shot({spacePresentation:'linear'}), orbital = await shot({spacePresentation:'orbital'});
      const orbitalProbe = r.orbitProbe;
      const deep = await shot({spacePresentation:'deep-space'});
      const deepProbe = r.orbitProbe;
      const energy = p => p.faces.subarray(0,18).reduce((a,b) => a+b,0);
      counts.skyEnergy = [energy(orbitalProbe), energy(deepProbe)];
      counts.deepLayers = r.spaceBackdrop.layers.length;
      counts.deep = diff(orbital, deep);
      counts.orbitalRestored = diff(orbital,await shot({spacePresentation:'orbital'}));
      if (r.orbitProbe !== orbitalProbe) throw Error('Orbital probe recaptured on toggle');
      counts.probeMax = Math.max(...r.orbitProbe.faces.subarray(0,18));
      counts.probeDirection = Array.from(r.orbitProbe.faces.subarray(18,21), x => +x.toFixed(3));
      counts.corrected = diff(cinematic, linear);
      counts.orbital = diff(linear, orbital);
      counts.cinematic = diff(original, cinematic);
      counts.cinematicVsUltra = diff(ultra, cinematic);
      counts.cinematicReset = diff(original, await shot({ spacePresentation: 'inherit' }));
      // Both WebGPU binding variants and the WebGL depth resolve path. Do not silently disable multisampling for AO.
      const aa = gfx.aa;
      gfx.aa = false;
      const single = await shot(enhancedLook);
      counts.singleSampleShade = diff(single, await shot({ ...enhancedLook, contactShade: 0.85 }));
      gfx.aa = aa;
      counts.reset = diff(original, await shot(originalLook));
      const png = px => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, H), 0, 0);
        return c.toDataURL().split(',')[1];
      };
      const images = { original: png(original), enhanced: png(enhanced), ultra: png(ultra), cinematic: png(cinematic), linear: png(linear), orbital: png(orbital), 'deep-space': png(deep) };
      let renderMs;
      if (fleet) {
        Object.assign(r.rig, { dist: 6000, pitch: 0.95 });
        r.rig.apply(0);
        r.camera.updateMatrixWorld();
        for (const sky of r.skydomes) sky.root.position.copy(r.camera.position);
        const wide = await shot({ spacePresentation: 'inherit' });
        const lit = await shot({ spacePresentation: 'cinematic' });
        const paint = await shot({spacePresentation:'linear'}), orbit = await shot({spacePresentation:'orbital'});
        images['fleet-linear'] = png(paint);
        images['fleet-orbital'] = png(orbit);
        const dark = await shot({spacePresentation:'deep-space'});
        if (r.orbitProbe !== deepProbe) throw Error('Deep-space probe recaptured on zoom');
        images['fleet-deep-space'] = png(dark);
        counts.wideDeep = diff(orbit,dark);
        counts.wideCorrected = diff(lit, paint);
        counts.wideOrbital = diff(paint, orbit);
        counts.fleet = diff(wide, lit);
        counts.fleetReset = diff(wide, await shot({ spacePresentation: 'inherit' }));
        images['fleet-original'] = png(wide);
        images['fleet-cinematic'] = png(lit);
        // Paired, GPU-synchronized draws, not live gameplay FPS. Discard four warm-up pairs.
        const samples = { cinematic: [], linear: [], orbital: [], 'deep-space': [] }, modes = Object.keys(samples);
        for (let i = 0; i < 24; i++) for (let j=0; j<modes.length; j++) {
          const key = modes[(j+i)%modes.length];
          gfx.spacePresentation = key;
          const start = performance.now();
          r.draw(w, R, 0);
          if (gpu) await gpu.settle(); else R.getContext().finish();
          if (i >= 4) samples[key].push(performance.now() - start);
        }
        renderMs = Object.fromEntries(Object.entries(samples).map(([key, times]) => {
          times.sort((a, b) => a - b);
          return [key, { median: (times[9] + times[10]) / 2, p95: times[18] }];
        }));
      }
      return { counts, unit: u.type.name, backend: gpu ? 'WebGPU' : 'WebGL', images, renderMs };
    }, { gl, fleet });
    const halfLight = await body.evaluate(require('./orbit-half-light.cjs'));
    console.log({ backend, unit, counts, renderMs, halfLight, bad: bad.slice(0, 3) });
    assert(halfLight[4][0] >= halfLight[3][0] && halfLight[6][0] < halfLight[5][0] && halfLight[6][0] > 0,
      'direct sunlight holds, unlit gray hull darkens without becoming black');
    for (const [i, expected] of [128, 188, 92].entries()) assert(halfLight[i].every(value => Math.abs(value-expected)<=1), 'half-light patch ' + i);
    for (const [name, image] of Object.entries(images)) fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(image, 'base64'));
    if (fleet) {
      assert(counts.wideDeep > 100, 'deep space at fleet zoom');
      assert(counts.wideCorrected > 100 && counts.wideOrbital > 100, 'both new looks affect the fleet view');
      assert(counts.fleet > 100, 'visible difference at strategy zoom');
      assert.equal(counts.fleetReset, 0, 'fleet frame restored');
    }
    assert(counts.deepLayers > 0 && counts.deep > 100 && counts.skyEnergy[1] < counts.skyEnergy[0], 'visible sky exposure also reduces captured sky light');
    assert.equal(counts.orbitalRestored,0,'orbital frame restored after changing sky exposure');
    assert(counts.probeMax > 0 && counts.corrected > 100 && counts.orbital > 100, 'two distinct steps from the mounted map');
    assert.equal(counts.cinematicReset, 0, 'switching off Cinematic restores the previous frame');
    assert(counts.cinematic > 100 && counts.cinematicVsUltra > 100, 'distinct cinematic ship lighting');
    assert.equal(counts.enhancedReset, 0, 'enhanced restored');
    for (const k of [
      'surfaceRelief',
      'environmentLight',
      'lensStreaks',
      'materialFinish',
      'contactShade',
      'singleSampleShade',
      'enhancedToUltra'
    ])
      assert(counts[k] > 100, `No visible effect: ${k}`);
    assert.equal(counts.reset, 0, 'original frame restored');
    assert.deepEqual(bad, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
