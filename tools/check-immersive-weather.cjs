// Select a mounted environment/scenario, let its clock reach each real phase, then freeze
// only for matched off/on draws. No phase edits or substitutions for the weather emitter.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl';
const out = path.join(os.tmpdir(), 'universal-immersive-weather', gl ? 'webgl' : 'webgpu');
const places = {
  Endor: ['#endor-showers', 'Noon_Rain', ['clear', 'rain']],
  Tatooine: ['#tatooine-remaster', 'Noon_Sandstorm', ['clear', 'sandstorm']],
  Yavin: ['#yavin-remaster', 'Sunrise_Rain', ['clear', 'rain']],
  'Hoth-night': ['', 'Nighttime_Snow', ['snow', 'clear']],
  Hoth: ['', 'Noon_Snow', ['snow']],
  Polus: ['', 'Noon_Snow', ['snow']],
  Shola: ['', 'Noon_Ash', ['ash']]
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const world of (process.env.LOOK_WORLDS || Object.keys(places).join(',')).split(',')) {
      const [link, env, phases] = places[world],
        remaster = !!link;
      const page = await b.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' }),
        errors = [];
      page.setDefaultTimeout(100000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {
        if (/GPUValidationError|Error while (?:parsing WGSL|validating)|Shader Error|INVALID_OPERATION|webgpu pipeline/i.test(m.text()))
          errors.push(m.text().slice(0, 1000));
      });
      if (gl) await page.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
      await page.goto('http://127.0.0.1:8590/' + link);
      const f = page.frameLocator('#game'),
        body = f.locator('body');
      if (!link) {
        await f.locator('.title-menu [data-id="TITLE_PLAY"]').click();
        await f.locator('.title-menu [data-id="IDC_INSTANT_BATTLE_BUTTON"]').click();
        const planet = world.split('-')[0],
          board = f.locator('.op-setup');
        await board.getByRole('searchbox').fill(planet);
        await board.locator(`[data-world="${planet}"][data-domain="land"][data-source="stock"]`).first().click();
        await board.locator('.op-go').click();
      }
      const backend = await body.evaluate(
        async (_, { env, remaster }) => {
          const wait = () => new Promise(requestAnimationFrame),
            until = performance.now() + 100000;
          while (
            !(
              window.game?.world?.time > 0.05 &&
              (!remaster || game.ground.userData.endorLandscape?.active || game.ground.userData.reviewedLandscape?.active)
            )
          ) {
            if (performance.now() > until) throw Error('Landscape not ready');
            await wait();
          }
          const g = game,
            w = g.world,
            envData = g.map.environments.find(e => e.name === env);
          if (!envData) throw Error('Expected ' + env + ' on ' + g.map.file);
          g.modeSuspended = true;
          await wait();
          g.following = null;
          await g.applyEnvironment(envData);
          w.setWeather(envData.weather);
          const { lighting } = await import('/js/model.js'),
            { gfx } = await import('/js/gfx.js'),
            { unitDetail } = await import('/js/game/desyncreport.js');
          const { texturesReady } = await import('/js/dds.js');
          await texturesReady();
          // Low oblique camera; soldiers, horizon and their incident light share the same exposure.
          Object.assign(g.view, { dist: 110, pitch: 0.14 });
          if (g.map.file === '_MP_LAND_ENDOR.TED') Object.assign(g.view, { x: 1460, y: 3120, yaw: -Math.PI / 2 });
          const state = () => JSON.stringify([w.time, w.weather, unitDetail(w)]),
            light = () => JSON.stringify([lighting.sunColor.value, lighting.fillColor.value, lighting.ambient.value]);
          window.chooseWeather = async name => {
            const phase = w.weather.phases.filter(p => p.name === name).sort((a, b) => b.strength - a.strength)[0];
            if (!phase) throw Error('Phase unavailable: ' + name);
            const end = performance.now() + 150000;
            g.speed = 8;
            g.modeSuspended = false;
            try {
              g.frame(performance.now());
              // Give drops/flakes from the preceding phase time to leave the camera.
              while (
                w.weather.name !== name ||
                w.weather.level !== phase.strength ||
                w.weather.out ||
                w.weather.phases[w.weather.i].seconds - w.weather.left < 2.5
              ) {
                if (performance.now() > end) throw Error('Forecast never reached ' + name + ' on ' + g.map.file);
                await wait();
              }
            } finally {
              g.modeSuspended = true;
              g.speed = 1;
            }
            await wait();
          };
          window.paintWeather = async scope => {
            gfx.immersiveWeather = scope;
            await g.selectLandSky();
            const sim = state(),
              initial = light();
            let during;
            g.sameFrame = () => {
              during = {
                light: light(),
                sky: g.activeSky ? g.immersiveWeather.uniforms.wxZenith.value.toArray() : [0, 0, 0, 0],
                dust: g.immersiveWeather.dustAir.value.w,
                generated: !!g.sky.getObjectByName('Procedural land sky')
              };
            };
            try {
              for (let i = 0; i < 8; i++) {
                g.modeSuspended = false;
                g.warming = true;
                try {
                  g.frame(g.last);
                } finally {
                  g.modeSuspended = true;
                  g.warming = false;
                }
                await wait();
              }
              await g.gpu?.settle?.();
            } finally {
              g.sameFrame = null;
            }
            if (state() !== sim || light() !== initial || g.immersiveWeather.dustAir.value.w !== 0)
              throw Error('Forecast, units or draw-scoped lighting changed');
            return during;
          };
          return g.gpuOn ? 'webgpu' : 'webgl';
        },
        { env, remaster }
      );
      assert.equal(backend, gl ? 'webgl' : 'webgpu');
      for (const phase of phases) {
        await body.evaluate((_, name) => chooseWeather(name), phase);
        const draw = mode => body.evaluate((_, v) => paintWeather(v), mode);
        const base = await draw('off'),
          off = await page.screenshot({ path: path.join(out, `${world}-${phase}-stock.png`) });
        const on = await draw('all'),
          visible = await page.screenshot({ path: path.join(out, `${world}-${phase}.png`) });
        assert(!base.generated && on.generated);
        if (world === 'Hoth-night' && phase === 'clear') {
          assert(on.sky[3] > 0 && on.sky[2] < 0.15); // Generated starlight, not noon light.
          assert.equal(on.light, base.light);
        } else {
          assert(on.sky[3] > 0.5, `${world}: missing sky`);
          assert.notEqual(on.light, base.light);
          assert(!off.equals(visible));
        }
        assert.equal(on.dust, phase === 'sandstorm' ? 1 : 0);
        if (process.env.LOOK_FORMATIONS === '1')
          console.log('Formation readback', world, phase, await body.evaluate(require('./sky-formation-readback.cjs')));
        if (process.env.LOOK_COST === '1')
          console.log(
            'Weather cost (ms)',
            world,
            phase,
            backend,
            JSON.stringify(
              await body.evaluate(require('./weather-frame-cost.cjs'), { limit: Number(process.env.LOOK_SKY_MS) || 0, samples: 16 })
            )
          );
        const restored = await draw(remaster ? 'off' : 'remasters');
        assert.equal(restored.dust, 0);
        assert.equal(restored.generated, false);
        assert.equal(restored.sky[3], 0);
        assert.equal(restored.light, base.light);
        console.log(world, phase, backend, on.sky);
      }
      if (world === 'Endor') {
        await body.evaluate(() => game.menus.toggle());
        await f.locator('[data-id="IDC_INGAME_OPTIONS"]:visible').click();
        const s = f.getByRole('dialog', { name: 'Settings', exact: true });
        await s.getByRole('tab', { name: 'Graphics Quality' }).click();
        const select = s.getByRole('combobox', { name: 'Immersive weather' });
        await select.selectOption('remasters');
        await page.setViewportSize({ width: 390, height: 844 });
        await select.focus();
        await select.press('End');
        await select.press('Enter');
        assert.equal(await body.evaluate(async () => (await import('/js/gfx.js')).gfx.immersiveWeather), 'off');
        assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
        await page.screenshot({ path: path.join(out, 'settings-narrow.png') });
      }
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await b.close();
  }
  console.log(out);
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
