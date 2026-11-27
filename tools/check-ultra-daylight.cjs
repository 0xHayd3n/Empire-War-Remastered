// Mounted integration check: actual deployed squads, no staged models or post-process overrides.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl',
  eaw = process.env.LOOK_EDITION === 'eaw',
  audit = process.env.DAY_AUDIT === '1',
  original = process.env.DAY_ORIGINAL === '1',
  out = path.join(
    os.tmpdir(),
    'endor-irradiance',
    (original ? 'original-' : audit ? 'before-' : 'after-') + (eaw ? 'eaw-' : 'foc-') + (gl ? 'gl' : 'gpu')
  );
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    p.setDefaultTimeout(95000);
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (
        /GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)|Endor full landscape: using original/.test(
          m.text()
        ) &&
        errors.length < 6
      ) {
        errors.push(m.text().slice(0, 1100));
        console.error(errors.at(-1));
      }
    });
    await p.addInitScript(
      ({ gl, eaw }) => {
        if (gl) sessionStorage.setItem('swr-webgpu-dropped', '1');
        if (eaw) localStorage.setItem('swr.game', 'eaw');
      },
      { gl, eaw }
    );
    await p.goto('http://127.0.0.1:8590/#endor-' + (original ? 'original' : 'ultra'));
    const f = p.frameLocator('#game'),
      body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const report = await body.evaluate(async (_, original) => {
      const wait = () => new Promise(requestAnimationFrame),
        end = performance.now() + 82000;
      while (
        !window.game?.ground ||
        (!original && (!game.ground.userData.endorLandscape?.active || !game.extraFx?.pr)) ||
        !(game.world.time > 0.8)
      ) {
        if (performance.now() > end) throw Error('Full battle not ready');
        await wait();
      }
      const g = game,
        { lighting: L } = await import('/js/model.js'),
        { gfx } = await import('/js/gfx.js'),
        { skyTarget, SKY_FACE: n } = await import('/js/skyreflect.js'),
        R = g.gpuOn ? g.gpu : g.renderer;
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const env = g.map.environments.find(e => e.name === 'Noon_Clear');
      g.map.activeEnvironment = g.map.environments.indexOf(env);
      await g.applyEnvironment(env);
      g.world.setWeather(env.weather);
      g.groundRain.amount = 0;
      g.forestSky.cover = g.forestSky.wet = 0;
      const result = {
        map: g.map.file,
        sky: env.name,
        edition: (await import('/js/edition.js')).edition(),
        backend: g.gpuOn ? 'gpu' : 'gl',
        profile: (await import('/js/endor-preview.js')).endorPreview,
        landscape: !!g.ground.userData.endorLandscape?.active,
        waterMode: g.terrain.water?.mode,
        lights: env.lights,
        ambient: env.ambient,
        shadow: env.shadow,
        soil: g.ground.userData.soil
      };
      const children = () =>
        g.scene.children
          .filter(s => /Endor/i.test(s.name))
          .map(s => [s.name, s.userData.casts || false, s.children.reduce((n, c) => n + (c.visible ? c.count || 0 : 0), 0)]);
      const render = R.render;
      R.render = function (scene, eye) {
        if (scene === g.scene && eye === g.groundNear?.cam) {
          result.sunPass = children();
        }
        if (scene === g.scene && eye === g.camera) {
          result.draw = {
            surface: L.surfaceLook.value.toArray(),
            stage: L.orbitalKey.value,
            ground: L.landGround.value.toArray(),
            sun: L.sunColor.value.toArray(),
            sky: L.ambient.value.toArray(),
            fill: L.fillColor.value.toArray(),
            probe: L.landProbeOn?.value || 0,
            pitch: g.groundNear?.params.x,
            wide: g.cast?.size,
            groups: children()
          };
        }
        return render.call(this, scene, eye);
      };
      window.drawDay = async (camera, count = 18) => {
        for (let i = 0; i < count; i++) {
          Object.assign(g.view, camera);
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(g.last);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
          if (i % 6 === 0) await g.gpu?.settle?.();
          await wait();
        }
      };
      await drawDay({ x: 1460, y: 3120, dist: 130, pitch: 0.34, yaw: -Math.PI / 2 });
      const timeout = performance.now() + 18000;
      while (!original && performance.now() < timeout && (!g.landFinish?.texture || !g.skyAtlasState || g.skyAtlasState.left)) {
        await drawDay({}, 3);
      }
      await drawDay({}, 5);
      if (skyTarget() && R.readRenderTargetPixelsAsync) {
        const px = new Uint8Array(6 * n * n * 4);
        await R.readRenderTargetPixelsAsync(skyTarget(), 0, 0, 6 * n, n, px);
        result.skyFaces = (await import('/js/orbitcolor.js'))
          .measureOrbitFaces(px, n)
          .slice(0, 18)
          .reduce((a, v) => [...a, +v.toFixed(4)], []);
      }
      result.hasReflection = !!g.landFinish?.texture;
      return result;
    }, original);
    assert.equal(report.map, '_MP_LAND_ENDOR.TED');
    assert.equal(report.waterMode, 1);
    assert.equal(report.profile, original ? 'original' : 'ultra');
    assert.equal(report.landscape, !original);
    assert.equal(report.sky, 'Noon_Clear');
    assert.equal(report.backend, gl ? 'gl' : 'gpu');
    for (const [name, camera] of [
      ['squads', { x: 1460, y: 3120, dist: 130, pitch: 0.34, yaw: -Math.PI / 2 }],
      ['command', { x: 1460, y: 3120, dist: 910, pitch: 1.08, yaw: -Math.PI / 2 }],
      ['trail', { x: 1900, y: 4500, dist: 72, pitch: 0.2 }],
      ['forest', { x: 1472.37, y: 3406.28, dist: 85, pitch: 0.27, yaw: -1.48 }]
    ]) {
      await body.evaluate((_, c) => drawDay(c), camera);
      await p.screenshot({ path: path.join(out, name + '.png') });
    }
    if (process.env.DAY_WATER_AUDIT) {
      const cam = { x: 1460, y: 3120, dist: 910, pitch: 1.08, yaw: -Math.PI / 2 };
      for (const part of ['both', 'under', 'bed', 'reflect']) {
        await body.evaluate(
          async (_, [part, c]) => {
            const g = game;
            g.water.children[0].visible = ['both', 'under'].includes(part);
            g.water.children[1].visible = ['both', 'reflect'].includes(part);
            await drawDay(c);
          },
          [part, cam]
        );
        await p.screenshot({ path: path.join(out, 'lake-' + part + '.png') });
      }
      await body.evaluate(() => game.water.children.forEach(m => (m.visible = true)));
      const { PNG } = require('pngjs'),
        { lakeWindow, darkIsland } = require('./remaster/ground-evidence.cjs');
      const parts = ['both', 'under', 'bed', 'reflect'],
        read = k => PNG.sync.read(fs.readFileSync(path.join(out, 'lake-' + k + '.png'))),
        rect = [950, 45, 390, 317],
        frames = Object.fromEntries(parts.map(k => [k, read(k)]));
      report.lake = lakeWindow(frames.both, frames.bed, rect);
      report.lake.passes = Object.fromEntries(parts.map(k => [k, darkIsland(frames[k], rect, 15)]));
      console.log('Visible lake, sheet versus bed:', report.lake);
    }
    const detail = await body.evaluate(async () => {
      const g = game,
        mesh = g.scene.getObjectByName('Endor forest shadow casters'),
        { lighting: L } = await import('/js/model.js');
      return {
        casterCount: mesh?.children.reduce((a, m) => a + m.count, 0),
        colorHidden: !mesh?.visible,
        reset: L.landProbeOn?.value,
        coeff: g.landFinish?.daylight?.slice(0, 18),
        water: g.terrain.water
      };
    });
    report.detail = detail;
    fs.writeFileSync(path.join(out, 'readings.json'), JSON.stringify({ report, errors }, null, 2));
    console.log(
      report.map,
      report.edition,
      report.backend,
      'probe:',
      report.draw.probe,
      'near pitch:',
      report.draw.pitch,
      'shadow instances:',
      detail.casterCount,
      out
    );
    assert.deepEqual(errors, []);
    if (!original) {
      assert(report.draw.probe > 0, 'Ground daylight did not use the mounted sky');
      assert(detail.casterCount > 0 && detail.colorHidden && detail.reset === 0);
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
