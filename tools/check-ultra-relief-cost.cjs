// Optional LOOK_SHARED_REFERENCE_DIR: compare with pre-change endor-relief.js
// and endor-tiles.js in the SAME mounted scene. No installed textures are saved.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const yavin of process.env.LOOK_WORLD ? [process.env.LOOK_WORLD === 'yavin'] : [false, true]) {
      const p = await b.newPage({ viewport: { width: 1280, height: 720 } }),
        dir = process.env.LOOK_SHARED_REFERENCE_DIR,
        errors = [],
        workers = [];
      p.on('pageerror', e => errors.push(e.message));
      p.on('console', m => {
        if (/GPUValidationError|Shader Error|INVALID_OPERATION/.test(m.text())) errors.push(m.text().slice(0, 600));
      });
      p.on('worker', w => workers.push(w.url()));
      const gl = process.env.LOOK_BACKEND === 'webgl';
      if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
      await p.route('**/js/game/endor-relief.js', async r => {
        const resp = await r.fetch(),
          text = await resp.text();
        await r.fulfill({
          response: resp,
          body: text.replace(/(export function reliefPatch\([^)]*\)\s*\{)/, '$1\n window.patchInputs=Array.from(arguments);')
        });
      });
      if (dir) {
        await p.route('**/js/game/reference-relief.js', r =>
          r.fulfill({
            contentType: 'text/javascript',
            body: fs.readFileSync(path.join(dir, 'endor-relief.js'), 'utf8').replace('../endor-tiles.js', '../reference-tiles.js')
          })
        );
        await p.route('**/js/reference-tiles.js', r =>
          r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(dir, 'endor-tiles.js'), 'utf8') })
        );
      }
      await p.goto('http://127.0.0.1:8590/#' + (yavin ? 'yavin-remaster' : 'endor-ultra'));
      const report = await p
        .frameLocator('#game')
        .locator('body')
        .evaluate(
          async (_, opts) => {
            const wait = () => new Promise(requestAnimationFrame),
              until = performance.now() + 100000;
            while (
              !window.patchInputs ||
              !window.game?.ground?.userData[opts.yavin ? 'reviewedLandscape' : 'endorLandscape']?.active ||
              !game.landFinish?.texture
            ) {
              const status = window.game?.ground?.userData[opts.yavin ? 'reviewedLandscape' : 'endorLandscape'];
              if (status?.state === 'unavailable' || performance.now() > until)
                throw Error(
                  'No completed mounted landscape and reflection atlas: ' +
                    JSON.stringify({
                      state: status?.state,
                      reason: status?.reason,
                      patch: !!window.patchInputs,
                      atlas: !!window.game?.landFinish?.texture
                    })
                );
              await wait();
            }
            const g = game;
            g.modeSuspended = true;
            await wait();
            const T = await import('three'),
              [ground, ...args] = window.patchInputs,
              { reliefPatch } = await import('/js/game/endor-relief.js'),
              ref = opts.ref ? (await import('/js/game/reference-relief.js')).reliefPatch : reliefPatch;
            function make(fn) {
              const m = new T.Mesh(ground.geometry, ground.material);
              const p = fn(m, ...args);
              return { p, geo: m.children[0].geometry };
            }
            const old = make(ref),
              next = make(reliefPatch),
              u = opts.yavin ? g.world.units.find(u => u.foot && u.side === g.me) : { x: 1460, y: 3120 };
            const pose = i => ({ x: u.x + i * 20, y: u.y + (i >> 2) * 20, dist: 135 });
            let checks = 0;
            for (let i = 0; i < 48; i++) {
              const v = pose(i % 21);
              old.p.update(v, true);
              next.p.update(v, true);
              if (old.p.heightRange !== next.p.heightRange || old.geo.drawRange.count !== next.geo.drawRange.count)
                throw Error('wrong relief range');
              for (const k of ['position', 'normal', 'layers', 'shade', 'corner', 'index']) {
                const buf = g => (k === 'index' ? g.index.array : g.attributes[k].array),
                  a = buf(old.geo),
                  b = buf(next.geo);
                for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) throw Error('changed ' + k + ' at ' + j);
                checks++;
              }
            }
            const a = [],
              c = [],
              batch = p => {
                const start = performance.now();
                for (let i = 0; i < 42; i++) p.update(pose(i <= 21 ? i : 42 - i), true);
                return (performance.now() - start) / 42;
              };
            for (let k = 0; k < 8; k++) {
              if (k % 2) {
                c.push(batch(next.p));
                a.push(batch(old.p));
              } else {
                a.push(batch(old.p));
                c.push(batch(next.p));
              }
            }
            const med = x => {
              x.sort((a, b) => a - b);
              return +((x[3] + x[4]) / 2).toFixed(3);
            };
            old.p.dispose();
            next.p.dispose();
            return {
              map: g.map.file,
              backend: g.gpuOn ? 'gpu' : 'gl',
              checkedArrays: checks,
              reference: opts.ref,
              msPerMove: [med(a), med(c)],
              atlas: g.landFinish.texture.image.data.length
            };
          },
          { yavin, ref: !!dir }
        );
      console.log(report);
      assert.deepEqual(errors, []);
      assert.equal(report.backend, gl ? 'gl' : 'gpu');
      assert(
        report.atlas === 48 * 48 * 6 * 3 * 4 && workers.some(s => s.endsWith('/land-filter-worker.js')),
        'reflection job not exercised'
      );
      await p.close();
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
