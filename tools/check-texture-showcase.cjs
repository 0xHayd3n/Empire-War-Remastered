// Drive a private Chrome context through the mounted Universal host. No private art in the code-only download.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const refit = !!process.env.SHOWCASE_REFIT,
  profile = refit ? '1976399102' : process.env.SHOWCASE_PROFILE || 'stock',
  gpu = process.env.SHOWCASE_BACKEND !== 'webgl',
  out = path.resolve('tools/baselines/texture-showcase', refit ? 'venator-refit' : profile, gpu ? 'webgpu' : 'webgl');
async function capture(_, { profile, gpu, refit, hero }) {
  const T = await import('three'),
    { loadModel, lighting } = await import('/js/model.js'),
    dds = await import('/js/dds.js'),
    { fetchBinary } = await import('/js/vfs.js'),
    { entries, active, matchTexture, showcaseBytes } = await import('/js/texture-showcase/store.js'),
    { digest } = await import('/js/texture-showcase/build.js');
  const hashes = {},
    images = {};
  const { recipes, refitID } = await import('/js/texture-showcase/recipes.js'),
    { refitMaterialName, readMaterialFile } = await import('/js/texture-showcase/store.js');
  for (const r of refit ? recipes[refitID] : entries) {
    const p = 'Data/Art/Textures/' + r.file,
      name = refit ? refitMaterialName(r.file, r.file.replace('_NM.', '_CM.'), r.file.replace('_CM.', '_NM.')) : r.file,
      b = await readMaterialFile(name, f => fetchBinary('Data/Art/Textures/' + f, { keep: false })),
      base = await (await fetch('/asset/' + p)).arrayBuffer();
    if ((await digest(base)) !== r.source) throw Error('Changed source: ' + r.file);
    hashes[r.file] = await digest(b);
    if (
      refit &&
      (hashes[r.file] !== (active ? r.output : r.source) || refitMaterialName(r.file, 'OTHER_CM.DDS', r.file) !== r.file || matchTexture(p))
    )
      throw Error('Wrong material pair: ' + r.file);
    if ((hashes[r.file] !== r.source) !== active) throw Error('Wrong overlay: ' + r.file);
    if (active) {
      const other = new Uint8Array([1, 2, 3]).buffer;
      if ((await showcaseBytes(r, other)) !== other || matchTexture('Data/Art/Textures/UXA999_stock__' + r.file))
        throw Error('Foreign source matched');
    }
  }
  if (gpu) {
    const { env } = await import('/js/gpu/env.js');
    env.programSources = (await import('/js/model.js')).programSources;
    env.lighting = lighting;
  }
  const R = gpu ? await (await import('/js/gpu/renderer.js')).GPURenderer.create() : new T.WebGLRenderer({ antialias: false });
  if (!R) throw Error('No GPU renderer');
  const W = hero ? 960 : 512,
    H = hero ? 720 : 384;
  R.setSize(W, H, false);
  const target = new T.WebGLRenderTarget(W, H);
  R.setRenderTarget(target);
  lighting.sunDir.value.set(-0.45, -0.7, 0.75).normalize();
  lighting.ambient.value.setRGB(0.49, 0.53, 0.59);
  lighting.shadowOn.value = 0;
  for (const subject of profile === 'stock' ? ['EV_STARDESTROYER.ALO', 'W_PLANET_NABOO_HIGH.ALO', 'Kuat'] : ['EV_VENATOR.ALO']) {
    const scene = new T.Scene(),
      cam = new T.OrthographicCamera(),
      center = new T.Vector3();
    cam.up.set(0, 0, 1);
    let span;
    if (subject === 'Kuat') {
      const { parseTED } = await import('/js/ted.js'),
        { buildTerrain } = await import('/js/game/terrain.js');
      const t = parseTED(await fetchBinary('Data/Art/Maps/_Land_Planet_Kuat_02.ted')).terrain,
        mesh = await buildTerrain(t);
      scene.add(mesh);
      let at = -1,
        dist = Infinity;
      for (let i = 0; i < t.layerIndex.length; i++) {
        const x = i % t.size,
          y = Math.floor(i / t.size),
          d = Math.hypot(x - t.size / 2, y - t.size / 2);
        if (d < dist && /grassrock00/i.test(t.layers[t.layerIndex[i]]?.texture || '')) {
          at = i;
          dist = d;
        }
      }
      if (at < 0) throw Error('No Kuat layer');
      const cell = mesh.material.uniforms.side.value / (t.size - 1);
      center.set((at % t.size) * cell, Math.floor(at / t.size) * cell, t.heights[at]);
      span = 240;
    } else {
      const inst = await loadModel(subject, { teamColor: new T.Color(0.7, 0.12, 0.04), fresh: true });
      scene.add(inst.root);
      // Gameplay hides the exploded mesh/decal groups on an undamaged ship (game/sim.js).
      if (hero) for (const [name, mesh] of inst.meshByName) if (/BLAST/.test(name)) mesh.visible = false;
      inst.syncFromBones();
      inst.root.updateMatrixWorld(true);
      const b = new T.Box3();
      inst.root.traverseVisible(o => {
        if (o.isMesh && !o.material.transparent && o.material.visible && o.geometry.boundingBox)
          b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      if (b.isEmpty()) b.copy(inst.drawBox);
      b.getCenter(center);
      span = b.getSize(new T.Vector3()).length();
      if (!span) throw Error('Empty model');
    }
    await dds.texturesReady();
    await dds.prepareSceneTextures(scene);
    let k = 0;
    for (const [yaw, zoom] of [
      [-2.14, 0.51],
      [-2.08, 0.27],
      [-2.02, 0.27],
      ...(hero
        ? [
            [-2.08, 0.12],
            [-2.08, 0.12]
          ]
        : [])
    ]) {
      if (hero && k === 4) lighting.sunDir.value.set(0.61, 0.24, 0.41).normalize();
      const half = span * zoom;
      Object.assign(cam, { near: span * 0.001, far: span * 8, left: (-half * W) / H, right: (half * W) / H, top: half, bottom: -half });
      cam.position.copy(center).add(new T.Vector3(Math.cos(yaw) * 2, Math.sin(yaw) * 2, 1.42).multiplyScalar(span));
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      for (let j = 0; j < 3; j++) {
        R.clear();
        R.render(scene, cam);
        R.endFrame?.();
        await R.settle?.();
      }
      const bytes = new Uint8Array(W * H * 4);
      await R.readRenderTargetPixelsAsync(target, 0, 0, W, H, bytes);
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d'),
        im = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) im.data.set(bytes.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      ctx.putImageData(im, 0, 0);
      images[subject + '-' + k++] = cv.toDataURL().split(',')[1];
      if (!bytes.some((v, i) => i % 4 !== 3 && v > 20)) throw Error('Empty rendered ' + subject);
    }
  }
  return { hashes, images };
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => bad.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Error while parsing WGSL|Shader Error|INVALID_OPERATION/.test(m.text())) bad.push(m.text().slice(0, 180));
    });
    p.on('dialog', d => d.accept());
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      body = f.locator('body'),
      tab = f.getByRole('dialog', { name: 'Settings', exact: true });
    if (profile !== 'stock') {
      await f.getByRole('button', { name: 'System menu' }).waitFor();
      await body.evaluate(
        (_, id) =>
          window.parent.postMessage(
            { kind: 'universal-select', id, mode: 'profile-play' },
            document.querySelector('meta[name="swr-universal"]').content
          ),
        profile
      );
      await f.locator('meta[name="swr-pack-revision"][content^="' + profile + ':"]').waitFor({ state: 'attached' });
    }
    const settings = async () => {
      if (profile !== 'stock') await f.locator('.title-menu [data-id="TITLE_BACK"]').click();
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await tab.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
    };
    const toggle = tab.getByRole('checkbox', { name: 'Use enhanced textures' });
    const reopen = async () => {
      await tab.getByRole('button', { name: 'Reopen profile' }).click();
      await tab.waitFor({ state: 'detached' });
      await settings();
    };
    await settings();
    if (refit) await tab.getByLabel('Texture edition').selectOption('1976399102-refit');
    const snap = async (label, verifyRefit = refit) => {
      const result = await body.evaluate(capture, { profile, gpu, refit: verifyRefit, hero: refit });
      console.log(label, result.hashes);
      for (const [s, data] of Object.entries(result.images))
        fs.writeFileSync(path.join(out, label + '-' + s + '.png'), Buffer.from(data, 'base64'));
      return result;
    };
    const original = await snap('original');
    const got = p.waitForEvent('download');
    await tab.getByRole('button', { name: 'Download builder' }).click();
    const dl = await got;
    assert.equal(dl.suggestedFilename(), 'texture-showcase-builder.zip');
    assert.deepEqual(fs.readFileSync(await dl.path()), fs.readFileSync('public/downloads/texture-showcase-builder.zip'));
    await tab.getByRole('button', { name: 'Build local pack' }).click();
    await tab.getByText('Installed. Original textures are in use.').waitFor();
    const saving = p.waitForEvent('download');
    await tab.getByRole('button', { name: 'Save private ZIP' }).click();
    const file = await (await saving).path();
    await tab.getByRole('button', { name: 'Remove pack' }).click();
    await tab.getByText(/Build from your installation/).waitFor();
    await tab
      .locator('input[type=file][accept=".zip"]')
      .setInputFiles({ name: 'private.zip', mimeType: 'application/zip', buffer: fs.readFileSync(file) });
    await tab.getByText('Installed. Original textures are in use.').waitFor();
    await toggle.check();
    await reopen();
    assert(await toggle.isChecked());
    await tab.getByRole('button', { name: 'Save private ZIP' }).focus();
    await p.screenshot({ path: path.join(out, 'settings.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await toggle.focus();
    assert(await tab.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.screenshot({ path: path.join(out, 'narrow.png') });
    await p.setViewportSize({ width: 1100, height: 760 });
    const changed = await snap('enhanced');
    await toggle.uncheck();
    await reopen();
    assert(!(await toggle.isChecked()));
    const reset = await snap('reset');
    assert.deepEqual(reset, original);
    for (const k of Object.keys(original.images)) assert.notEqual(changed.images[k], original.images[k], k);
    if (refit) {
      const choice = tab.getByLabel('Texture edition');
      await choice.selectOption(profile);
      await tab.getByRole('button', { name: 'Build local pack' }).click();
      await tab.getByText('Installed. Original textures are in use.').waitFor();
      await toggle.check();
      await reopen();
      await snap('showcase', false);
      await choice.selectOption('1976399102-refit');
      await toggle.check();
      await reopen();
      assert(await toggle.isChecked());
      assert.deepEqual(await snap('reselected'), changed);
    }
    assert.deepEqual(bad, []);
    console.log('PASS', profile, gpu ? 'webgpu' : 'webgl');
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
