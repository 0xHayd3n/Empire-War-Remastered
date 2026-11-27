// Check the all-map default on a real Workshop map; then remove its dome metadata in
// this isolated QA session to exercise the missing-asset and Original rollback paths.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
(async () => {
  const id = process.env.LOOK_PROFILE || '1125571106',
    world = process.env.LOOK_WORLD || 'Dantooine',
    gl = process.env.LOOK_BACKEND === 'webgl';
  const out = path.join(os.tmpdir(), 'universal-immersive-weather', 'coverage');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1152, height: 720 } }),
      errors = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 600));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game');
    for (const k of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${k}"]:visible`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill(world);
    const row = board.locator(`[data-world="${world}"][data-domain="land"][data-source="${id}"]`).first();
    const file = await row.getAttribute('data-file');
    await row.click();
    await f.locator(`.op-setup[data-profile="${id}"] .op-go:enabled`).click();
    const result = await f.locator('body').evaluate(async () => {
      const tick = () => new Promise(requestAnimationFrame);
      const until = performance.now() + 95000;
      while (!(window.game?.world?.time > 1 && game.ground && game.activeSky)) {
        if (performance.now() > until) throw Error('Procedural sky not active');
        await tick();
      }
      const g = game,
        wx = g.world.weather,
        { gfx } = await import('/js/gfx.js');
      g.modeSuspended = true;
      await tick();
      g.following = null;
      Object.assign(g.view, { dist: 115, pitch: 0.16 });
      const env = g.map.environment,
        originally = g.sky;
      const report = {
        file: g.map.file,
        mode: gfx.immersiveWeather,
        profile: (await import('/js/texture-showcase/store.js')).profile,
        backend: g.gpuOn ? 'webgpu' : 'webgl',
        native: env.name,
        skies: Object.keys(env.skyAngles || {}),
        loadedOriginal: !!g.skyEntry.loading
      };
      async function paint() {
        for (let i = 0; i < 6; i++) {
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(g.last);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
          await tick();
        }
        await g.gpu?.settle?.();
      }
      window.verifyOutdoor = async which => {
        const before = JSON.stringify([wx, g.world.time]);
        if (which === 'missing')
          await g.applyEnvironment({ ...env, landSkies: [], skyAngles: {}, name: 'Uncatalogued Workshop environment' });
        if (which === 'original') {
          gfx.immersiveWeather = 'off';
          await g.selectLandSky();
        }
        if (which === 'return') {
          gfx.immersiveWeather = 'all';
          await g.applyEnvironment(env);
        }
        await paint();
        if (before !== JSON.stringify([wx, g.world.time])) throw Error('Sky selection changed forecast');
        return {
          generated: !!g.sky.getObjectByName('Procedural land sky'),
          count: g.sky.children.length,
          cached: g.sky === originally,
          noTexture: !g.activeSky || !Object.values(g.sky.children[0].material.uniforms).some(u => u.value?.isTexture)
        };
      };
      return report;
    });
    assert.equal(result.mode, 'all');
    assert.equal(result.file.toUpperCase(), file.toUpperCase());
    assert.equal(result.profile, id);
    assert.equal(result.loadedOriginal, false);
    assert.equal(result.backend, gl ? 'webgl' : 'webgpu');
    for (const mode of ['native', 'missing', 'original', 'return']) {
      const state = await f.locator('body').evaluate((_, s) => verifyOutdoor(s), mode);
      assert.equal(state.generated, mode !== 'original');
      assert.equal(state.count, mode === 'original' ? 0 : 1);
      assert(state.noTexture);
      if (mode === 'return') assert(state.cached);
      await p.screenshot({ path: path.join(out, `${id}-${result.backend}-${mode}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(result, out);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
