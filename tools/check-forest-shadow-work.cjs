// Mounted Endor, frozen battle: change only the sun. The sky and both depth cameras
// must turn together without repainting habitat or rebuilding the forest floor.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 800, height: 500 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (validating|parsing WGSL)/i.test(m.text())) errors.push(m.text());
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const result = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async () => {
        const tick = () => new Promise(requestAnimationFrame),
          deadline = performance.now() + 120000;
        while (!(window.game?.ground?.userData.endorLandscape?.active && game.world?.time > 0.1)) {
          if (performance.now() > deadline) throw Error('Endor remaster did not activate');
          await tick();
        }
        const g = game,
          T = await import('three'),
          { gfx } = await import('/js/gfx.js');
        g.modeSuspended = true;
        await tick();
        const U = g.ground.material.uniforms,
          canopy = U.canopyMap.value,
          sun = U.sunDir.value;
        const sky = g.sky.getObjectByName('Procedural land sky');
        if (!sky || sky.material.uniforms.sunDir.value !== sun) throw Error('Sky and terrain have different suns');
        Object.assign(g.view, { x: 1460, y: 3120, dist: 115 });
        gfx.shadows = true;
        gfx.shadow = 1;
        const baseline = canopy.version,
          direction = new T.Vector3();
        const samples = [];
        for (const [x, y, z] of [
          [1, 0, 0.16],
          [-0.4, 1, 0.7],
          [0.1, -1, 1]
        ]) {
          sun.set(x, y, z).normalize();
          const t = performance.now();
          g.ground.userData.landscape(g);
          const landscapeMs = +(performance.now() - t).toFixed(2);
          g.castShadows(true);
          const agreement = [g.cast.camera, g.groundNear.cam].map(cam => -cam.getWorldDirection(direction).dot(sun));
          samples.push({ agreement, landscapeMs, canopyInvalidations: canopy.version - baseline });
          await tick();
        }
        // Rotating around one focus changes the colour cutaway, not the sun-view instances.
        const proxies = g.scene.getObjectByName('Endor forest shadow casters').children;
        const versions = proxies.map(o => o.instanceMatrix.version);
        const active = proxies.reduce((n, o) => n + o.count, 0);
        g.camera.position.x += 32;
        g.ground.userData.landscape(g);
        const rewritten = proxies.filter((o, i) => o.instanceMatrix.version !== versions[i]).length;
        gfx.shadows = false;
        g.view.x += 96;
        g.ground.userData.landscape(g);
        const off = proxies.reduce((n, o) => n + o.count, 0);
        gfx.shadows = true;
        g.ground.userData.landscape(g);
        const restored = proxies.reduce((n, o) => n + o.count, 0);
        return { backend: g.gpuOn ? 'webgpu' : 'webgl', samples, active, rewritten, off, restored };
      });
    console.log(JSON.stringify(result));
    assert.deepEqual(errors, []);
    assert.equal(result.backend, gl ? 'webgl' : 'webgpu');
    assert(
      result.samples.every(s => s.agreement.every(d => d > 0.99999)),
      'Depth cameras must face away from the sky sun'
    );
    assert(
      result.samples.every(s => s.canopyInvalidations === 0),
      'Changing the sun rebuilt the 512² forest habitat texture'
    );
    assert(result.active > 0 && result.restored > 0, 'Expected a populated forest before and after Shadows off');
    assert.equal(result.rewritten, 0, 'Camera orbit repacked unchanged sun-view forest instances');
    assert.equal(result.off, 0, 'Still maintaining forest casters with Shadows off');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
