// Same real mounted groundcover placement, comparing a one-cell pan to a cold repaint.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const result = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async () => {
        const wait = () => new Promise(requestAnimationFrame),
          until = performance.now() + 90000;
        while (!window.game?.ground?.userData.endorLandscape?.active) {
          if (performance.now() > until) throw Error('Endor not ready');
          await wait();
        }
        const g = game;
        g.modeSuspended = true;
        await wait();
        const T = await import('three'),
          { prepareGrove } = await import('/js/game/endor-grove.js'),
          { groundFamily } = await import('/js/game/endor-landscape.js');
        let reads = 0;
        const layers = { version: 1 },
          t = {
            ...g.terrain,
            layerIndex: new Proxy(g.terrain.layerIndex, {
              get: (a, k) => {
                reads++;
                return a[k];
              }
            }),
            paint: { geo: { attributes: { layers } } }
          },
          scene = new T.Scene(),
          view = { dist: 135, x: 1460, y: 3120 },
          probe = await prepareGrove({ terrain: t, scene, view, world: g.world }, t.layers.map(groundFamily), undefined, 0),
          cover = g.scene.getObjectByName('Endor map-wide old growth').children[0].material.uniforms.glossMap.value,
          patch = { triangles: 256, surface: (x, y, z) => z + Math.sin(x + y) * 0.5 };
        const arrays = () =>
          scene.children.flatMap(group => group.children.map(o => Array.from(o.instanceMatrix.array.subarray(0, o.count * 16))));
        const draw = () => {
          reads = 0;
          probe.update(true, patch, cover);
          return reads;
        };
        draw();
        let warm = 0,
          cold = 0,
          different = 0;
        for (let i = 0; i < 16; i++) {
          view.x += 10;
          view.y += i % 3 ? 0 : 10;
          warm += draw();
          const a = arrays();
          layers.version++;
          cold += draw();
          if (JSON.stringify(a) !== JSON.stringify(arrays())) different++;
        }
        const counts = arrays().map(a => a.length / 16);
        probe.dispose();
        return { warm, cold, different, instances: counts.reduce((a, b) => a + b, 0) };
      });
    console.log(result);
    assert(result.different === 0 && result.instances > 0);
    assert(result.warm < result.cold * 0.25, 'ordinary pan resamples unchanged planting sites');
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
