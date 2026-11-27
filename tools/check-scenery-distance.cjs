// Mounted retained props, not synthetic placeholders. A shallow camera sees past its
// tactical focus radius. Verify the actual submitted instance rows rather than grp.visible.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1120, height: 720 } }),
      errors = [];
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/Shader Error|GPUValidationError|INVALID_OPERATION|Error while (validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 400));
    });
    await p.goto('http://127.0.0.1:8590/#tatooine-remaster');
    const result = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async () => {
        const tick = () => new Promise(requestAnimationFrame),
          deadline = performance.now() + 170000;
        while (!window.game?.ground?.userData.reviewedLandscape?.active || !(game.world.time > 1)) {
          if (performance.now() > deadline) throw Error('No active remaster');
          await tick();
        }
        const g = game,
          T = await import('three'),
          { viewTest } = await import('/js/game/landinstances.js');
        g.modeSuspended = true;
        await tick();
        const groups = Object.fromEntries(
          Object.entries({ rock: /rockclstr03/i, tree: /tree_tat00_cluster/i, cliff: /rockform01/i }).map(([k, re]) => [
            k,
            g.props.find(p => re.test(p.modelFile))
          ])
        );
        const result = { gpu: !!g.gpuOn, actors: {}, offscreen: {} };
        for (const [role, prop] of Object.entries(groups)) {
          const h = prop.grp,
            cam = g.camera,
            center = new T.Box3().setFromObject(h).getCenter(new T.Vector3()),
            rows = [];
          const meshes = [];
          h.traverse(o => {
            if (o.isMesh) meshes.push(o);
          });
          const draw = (distance, away = false) => {
            cam.position.copy(center).add(new T.Vector3(0, -distance, distance * 0.08));
            cam.lookAt(away ? cam.position.clone().add(new T.Vector3(0, -1, 0)) : center);
            cam.updateMatrixWorld();
            const see = viewTest(cam),
              reach = 420,
              look = { x: center.x, y: cam.position.y + 50, r: reach, see };
            const B = g.batches;
            B.collect([], look, [[prop]], cam.position, [h]);
            let triangles = 0,
              submits = 0;
            for (const m of meshes) {
              const b = m._batch?.pool,
                im = b?.im,
                mat = m.matrixWorld.elements.map(Math.fround);
              const n = (im?.visible && im.count) || 0;
              let batch = false;
              if (n && m._taken)
                for (let i = 0; i < n; i++) {
                  if (mat.every((v, j) => v === im.instanceMatrix.array[i * 16 + j])) {
                    batch = true;
                    break;
                  }
                }
              let visible = m.layers.test(cam.layers);
              for (let o = m; o && visible; o = o.parent) visible = o.visible;
              if (batch || visible) {
                const geo = batch ? im.geometry : m.geometry;
                triangles += (geo.index?.count || geo.attributes.position.count) / 3;
                submits++;
              }
            }
            B.restore();
            return { distance, triangles, submits, level: g.scenery.rows.get(h)?.level };
          };
          for (const d of [110, 850, 2600, 110]) {
            // Warm asynchronously allocated batches before measuring the chosen detail level.
            for (let i = 0; i < 120; i++) {
              draw(d);
              await tick();
              if (i >= 3 && !g.scenery.busy && !g.scenery.queue.length) break;
            }
            rows.push(draw(d));
          }
          result.actors[role] = rows;
          result.offscreen[role] = draw(2600, true).submits;
        }
        return result;
      });
    console.log('Submitted:', JSON.stringify(result));
    assert.equal(result.gpu, !gl);
    assert.deepEqual(errors, []);
    for (const [role, rows] of Object.entries(result.actors)) {
      assert(
        rows.every(s => s.submits > 0),
        role + ' disappeared at a distance'
      );
      assert.equal(rows[3].triangles, rows[0].triangles);
    }
    for (const role of ['rock', 'tree']) {
      const r = result.actors[role];
      assert(r[2].triangles < r[1].triangles && r[1].triangles < r[0].triangles, role + ' did not simplify');
    }
    assert(
      Object.values(result.offscreen).every(n => n === 0),
      'Drawing behind the camera'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
