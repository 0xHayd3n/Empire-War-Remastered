// Inspect and capture the winning map in the real launcher, not a material ball. Bed-only
// frame hides just the two optical sheet passes. No map files or unit state are changed.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl',
  eaw = process.env.LOOK_EDITION === 'eaw',
  baseline = process.env.HABITAT_BEFORE === '1';
const out = path.join(
  os.tmpdir(),
  'endor-floor-habitat',
  (baseline ? 'before' : 'after') + '-' + (eaw ? 'eaw' : 'foc') + '-' + (gl ? 'gl' : 'gpu')
);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
    p.setDefaultTimeout(90000);
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (
        /GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)|Endor full landscape: using original/.test(
          m.text()
        ) &&
        errors.length < 5
      ) {
        errors.push(m.text().slice(0, 2000));
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
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const f = p.frameLocator('#game'),
      body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const report = await body.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame),
        end = performance.now() + 80000;
      while (!(window.game?.ground?.userData.endorLandscape?.active && game.world.time > 0.9 && game.extraFx?.pr)) {
        if (performance.now() > end) throw Error('Battle not ready');
        await wait();
      }
      const g = game,
        t = g.terrain,
        U = g.ground.material.uniforms,
        { families, groundFamily } = await import('/js/game/endor-landscape.js');
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const e = g.map.environments.find(e => e.name === 'Noon_Clear');
      g.map.activeEnvironment = g.map.environments.indexOf(e);
      await g.applyEnvironment(e);
      g.world.setWeather(e.weather);
      g.forestSky.cover = g.forestSky.wet = g.groundRain.amount = 0;
      const level = t.water.level,
        wet = {},
        dry = {},
        wetpts = [];
      const original = Uint8Array.from(t.layerIndex);
      const size = t.size;
      for (let y = 0; y < (t.height ?? size); y++)
        for (let x = 0; x < (t.width ?? size); x++) {
          const i = y * size + x,
            id = groundFamily(t.layers[t.layerIndex[i]]),
            name = families[id],
            z = t.heights[i],
            counts = z < level ? wet : dry;
          counts[name] = (counts[name] || 0) + 1;
          if (z < level && id <= 2) wetpts.push([20 * x, 20 * y, z]);
        }
      const shore = wetpts.sort((a, b) => Math.hypot(a[0] - 1908, a[1] - 3507) - Math.hypot(b[0] - 1908, b[1] - 3507))[0] || [1908, 3507];
      window.habitatDraw = async (c, bed = false) => {
        g.water.children.forEach(m => (m.visible = !bed));
        for (let i = 0; i < 18; i++) {
          Object.assign(g.view, c);
          g.warming = true;
          g.modeSuspended = false;
          try {
            g.frame(g.last);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
          await wait();
        }
        await g.gpu?.settle?.();
        if (original.some((v, i) => v !== t.layerIndex[i])) throw Error('Simulation paint changed');
      };
      const camera = { x: 1460, y: 3120, dist: 130, pitch: 0.34, yaw: -Math.PI / 2 };
      await habitatDraw(camera);
      while (g.skyAtlasState.left && performance.now() < end) await habitatDraw(camera);
      const L = g.ground.userData.endorLandscape;
      return {
        wet,
        dry,
        shore,
        level,
        wetBankOmissions: L.foliage.wetBankOmissions,
        stands: L.stands.total,
        edition: (await import('/js/edition.js')).edition(),
        backend: g.gpuOn ? 'gpu' : 'gl',
        width: g.ground.userData.endorLandscape.width,
        report: g.ground.userData.endorLandscape.floorHabitat || null
      };
    });
    for (const [name, x, y, dist, pitch, yaw, bed] of [
      ['trail', 1900, 4500, 73, 0.24, -Math.PI / 2],
      ['ferns', 1472.37, 3406.28, 80, 0.34, -1.48],
      ['squads', 1460, 3120, 130, 0.34, -Math.PI / 2],
      ['command', 1460, 3120, 910, 1.08, -Math.PI / 2],
      ['shore', report.shore[0], report.shore[1], 160, 0.89, -1.93],
      // A low dry vertex adjoining a submerged cell, rather than a point in the deep bed.
      ['low-bank', 1920, 3260, 62, 0.72, -1.93],
      ['bed-only', report.shore[0], report.shore[1], 160, 0.89, -1.93, true]
    ]) {
      await body.evaluate((_, [c, bed]) => habitatDraw(c, bed), [{ x, y, dist, pitch, yaw }, bed]);
      await p.screenshot({ path: path.join(out, name + '.png') });
    }
    console.log(report, out);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    assert.deepEqual(errors, []);
    assert.equal(report.backend, gl ? 'gl' : 'gpu');
    assert.equal(report.edition, eaw ? 'eaw' : 'foc');
    if (!baseline) {
      assert(report.report?.sedimentVertices > 0, 'No depth-driven lakebed material');
      assert.equal(
        report.report.sedimentVertices,
        Object.values(report.wet).reduce((a, b) => a + b, 0)
      );
      assert(report.report.forestDuff > 100 && report.report.shrubMoss > 100);
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
