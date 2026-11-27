// Use the real Universal UI with locally mounted Endor. All game pixels stay in TEMP.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const boot = !!process.env.LANDSCAPE_BOOT;
const gl = process.env.LOOK_BACKEND === 'webgl',
  eaw = process.env.LOOK_EDITION === 'eaw',
  fail = !!process.env.LANDSCAPE_FAIL,
  mip = Number(process.env.LANDSCAPE_MIP || 0);
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' }),
      bad = [],
      reads = [];
    p.setDefaultTimeout(100000);
    p.on('pageerror', e => {
      bad.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Shader Error|INVALID_OPERATION|webgpu (?:pipeline|texture)|Error while (?:validating|parsing WGSL)|Endor full landscape:/.test(
          m.text()
        )
      ) {
        bad.push(m.text().slice(0, 1500));
        console.error(bad.at(-1));
      }
    });
    p.on('request', r => {
      if (/\/art\/endor-(?:terrain|plants|grove)\//.test(r.url())) reads.push(r.url().split('/').pop());
    });
    if (fail)
      await p.route('**/endor-terrain/materials.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    if (eaw) await p.addInitScript(() => localStorage.setItem('swr.game', 'eaw'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      c = s.getByRole('checkbox', { name: 'Endor full landscape', exact: true });
    const settings = async () => {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    };
    await settings();
    assert(!(await c.isChecked()));
    await p.setViewportSize({ width: 390, height: 844 });
    await c.focus();
    await c.press('Space');
    assert(await c.isChecked());
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.setViewportSize({ width: 1600, height: 900 });
    await p.reload();
    await settings();
    assert(await c.isChecked());
    if (!boot) await c.uncheck();
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${id}"]:visible`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Endor');
    await board.locator('[data-world="Endor"][data-domain="land"][data-source="stock"]').first().click();
    await f.locator('.op-setup[data-profile="stock"] .op-go:enabled').click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const body = f.locator('body');
    await body.evaluate(async () => {
      while (!(window.game?.world?.time > 1 && game.ground)) await new Promise(requestAnimationFrame);
    });
    if (!boot) assert.equal(reads.length, 0);
    const report = await body.evaluate(
      async (_, params) => {
        const g = game,
          w = g.world,
          t = g.terrain,
          gd = g.ground,
          stat = gd.userData.endorLandscape,
          U = gd.material.uniforms,
          R = g.gpuOn ? g.gpu : g.renderer,
          gpu = g.gpuOn && g.gpu,
          wait = () => new Promise(requestAnimationFrame),
          { gfx } = await import('/js/gfx.js');
        if (!!gpu === params.gl || !stat) throw Error('Unexpected backend or map');
        const stock = [U.map.value, U.bump.value],
          beforeLayer = t.layerIndex.slice(),
          mapName = g.map.file;
        if (params.boot) {
          while (stat.state !== 'ready' && stat.state !== 'unavailable') await wait();
          if (!stat.active) throw Error('Boot opt-in failed: ' + stat.reason);
          return { boot: true, edition: (await import('/js/edition.js')).edition(), width: stat.width, targets: stat.foliage.targets };
        }
        gfx.texMip = params.mip;
        gfx.endorLandscape = true;
        let start = performance.now();
        while (!stat.active && stat.state !== 'unavailable') {
          if (performance.now() - start > 80000) throw Error('Landscape timed out: ' + JSON.stringify(stat));
          await wait();
        }
        if (params.fail) {
          if (stat.state !== 'unavailable' || stock[0] !== U.map.value || U.fullTerrain.value) throw Error('Corrupt source not atomic');
          return { fallback: true, reason: stat.reason };
        }
        if (!stat.active) throw Error('Landscape failed: ' + JSON.stringify(stat));
        const data = {
          backend: params.gl ? 'WebGL' : 'WebGPU',
          edition: (await import('/js/edition.js')).edition(),
          map: mapName,
          loadMs: Math.round(performance.now() - start),
          status: JSON.parse(JSON.stringify(stat)),
          views: {},
          timing: {}
        };
        if (stat.slots !== stat.assigned || !U.fullTerrain.value || stock[0] === U.map.value || stock[1] === U.bump.value)
          throw Error('Incomplete atlas replacement');
        const { groundFamily } = await import('/js/game/endor-landscape.js');
        const expected = [...t.paint.slot].map(([layer, slot]) => [groundFamily(t.layers[layer]), U.texU.value[slot].w]);
        if (expected.some(([a, b]) => a !== b || a < 0)) throw Error('Bad layer identity');
        data.arrays = [U.map.value, U.bump.value].map(tex => ({
          width: tex.image.width,
          depth: tex.image.depth,
          bytes: tex.mipmaps.reduce((a, m) => a + m.data.length, 0)
        }));
        if (params.mip) return data;
        const unit = w.units.find(u => u.side === g.me && u.foot && u.holder?.visible),
          trees = g.props.filter(p => /W_Tree_Ever_0[01]_HI/i.test(p.modelFile));
        // Forest margin: favor a tree with an open, painted foreground. Keep a walker for scale in both modes.
        const score = p =>
          Math.hypot(p.x - unit.x, p.y - unit.y) * 0.12 -
          Math.min(100, ...trees.filter(o => o !== p).map(o => Math.hypot(o.x - p.x - 12, o.y - p.y + 48)));
        const tree = trees.map(o => [score(o), o]).sort((a, b) => a[0] - b[0])[0][1],
          x = tree.x + 19,
          y = tree.y - 48;
        const walker = await w.spawn('AT_ST_Walker', x + 20, y + 4, 1.5, g.me);
        if (!walker) throw Error('Missing walker');
        await (await import('/js/dds.js')).texturesReady();
        for (let j = 0; j < 30; j++) await wait();
        g.modeSuspended = true;
        await wait();
        const now = g.last;
        const draw = () => {
          g.warming = true;
          g.modeSuspended = false;
          try {
            g.frame(now);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
        };
        const restore = async on => {
          gfx.endorLandscape = on;
          for (let i = 0; i < 6; i++) {
            draw();
            await wait();
          }
          if (stat.active !== on) throw Error('State failed to switch');
        };
        const W = R.domElement.width,
          H = R.domElement.height;
        async function shot() {
          draw();
          await gpu?.settle?.();
          const promise = gpu?.readNext?.();
          draw();
          if (promise) return (await promise).data;
          const ctx = R.getContext(),
            raw = new Uint8Array(W * H * 4),
            pix = raw.slice();
          ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
          for (let i = 0; i < H; i++) pix.set(raw.subarray((H - 1 - i) * W * 4, (H - i) * W * 4), i * W * 4);
          return pix;
        }
        function diff(a, b) {
          let pixels = 0;
          for (let i = 0; i < a.length; i += 4)
            if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 8) pixels++;
          return pixels;
        }
        function png(a) {
          const cv = document.createElement('canvas');
          cv.width = W;
          cv.height = H;
          const pix = new Uint8ClampedArray(a);
          for (let i = 3; i < pix.length; i += 4) pix[i] = 255;
          cv.getContext('2d').putImageData(new ImageData(pix, W, H), 0, 0);
          return cv.toDataURL().split(',')[1];
        }
        window.landscapeCapture = {};
        const families = t.layers.map(groundFamily),
          side = (t.size - 1) * 20;
        // Find real trail centres in opposite quarters with trees flanking both sides; no staged planting.
        function trail(tx, ty) {
          let best = null,
            score = -Infinity;
          const pick = (i, j) => families[t.layerIndex[j * t.size + i]],
            green = f => f >= 0 && f < 3;
          for (let j = 5; j < t.size - 5; j++)
            for (let i = 5; i < t.size - 5; i++) {
              if (pick(i, j) !== 3 || (t.water?.mode && t.heights[j * t.size + i] < t.water.level + 4)) continue;
              for (const [dx, dy] of [
                [0, 1],
                [1, 0],
                [1, 1],
                [-1, 1]
              ]) {
                if (pick(i - dx, j - dy) !== 3 || pick(i + dx, j + dy) !== 3) continue;
                let q = +green(pick(i + 2 * dy, j - 2 * dx)) + +green(pick(i - 2 * dy, j + 2 * dx));
                if (q !== 2) continue;
                q -= Math.hypot(i / t.size - tx, j / t.size - ty);
                if (q <= score) continue;
                score = q;
                best = [20 * i, 20 * j, 72, 0.2, Math.atan2(-dy, -dx)];
              }
            }
          return best || [tx * side, ty * side, 95, 0.3, -1.48];
        }
        for (const [name, cx, cy, dist, pitch, yaw = -1.48] of [
          ['ground', x - 2, y + 5, 50, 0.24],
          ['clearing', x + 8, y + 6, 163, 0.5],
          ['command', x, y - 12, 495, 0.9],
          ['north-trail', ...trail(0.22, 0.78)],
          ['south-trail', ...trail(0.76, 0.25)]
        ]) {
          Object.assign(g.view, { x: cx, y: cy, dist, pitch, yaw });
          await restore(true);
          for (let j = 0; j < 30; j++) {
            draw();
            await wait();
          }
          await restore(false);
          // A newly exposed stock camera can queue instance pipelines a few per frame. Warm BOTH
          // states before freezing the reference; otherwise first-load silhouettes count as rollback errors.
          for (let j = 0; j < 45; j++) {
            draw();
            await wait();
          }
          await gpu?.settle?.();
          const a = await shot();
          await restore(true);
          const z = await shot();
          data.views[name] = {
            changed: diff(a, z),
            triangles: stat.reliefTriangles,
            heightRange: stat.heightRange,
            grove: { ...stat.grove },
            stands: { ...stat.stands.drawn },
            coordinates: [cx, cy, dist]
          };
          if (name === 'clearing') {
            U.fullTerrain.value = 1;
            const linear = await shot();
            U.fullTerrain.value = 2;
            data.views[name].blendDelta = diff(z, linear);
          }
          await restore(false);
          const c = await shot();
          data.views[name].reset = diff(a, c);
          window.landscapeCapture[name + '-stock'] = png(a);
          window.landscapeCapture[name + '-full'] = png(z);
        }
        for (const on of [false, true]) {
          await restore(on);
          let last = await wait();
          const a = [];
          for (let j = 0; j < 80; j++) {
            g.view.x = x + j * 0.3;
            draw();
            const cur = await wait();
            if (j >= 16) a.push(cur - last);
            last = cur;
          }
          g.view.x = x;
          a.sort((a, b) => a - b);
          data.timing[on ? 'full' : 'stock'] = [a[32], a[60]].map(v => +v.toFixed(2));
        }
        await restore(false);
        if (beforeLayer.some((v, k) => v !== t.layerIndex[k]) || stock[0] !== U.map.value || stock[1] !== U.bump.value)
          throw Error('Changed map paint or failed restoration');
        // Resume the real loop: prop culling and script visibility must survive ordinary updates too.
        const clock = w.time;
        g.modeSuspended = false;
        g.frame(performance.now());
        data.live = {};
        for (const on of [false, true]) {
          gfx.endorLandscape = on;
          for (let j = 0; j < 16; j++) await wait();
          const a = [];
          let prev = await wait();
          for (let j = 0; j < 64; j++) {
            const time = await wait();
            a.push(time - prev);
            prev = time;
          }
          if (stat.active !== on) throw Error('Live toggle failed');
          a.sort((a, b) => a - b);
          data.live[on ? 'full' : 'stock'] = [a[32], a[60]].map(v => +v.toFixed(2));
        }
        if (w.time <= clock) throw Error('Simulation did not advance');
        gfx.endorLandscape = false;
        return data;
      },
      { gl, fail, mip, boot }
    );
    if (fail) {
      assert(report.fallback);
      console.log(report);
      return;
    }
    assert.equal(report.edition, eaw ? 'eaw' : 'foc');
    if (boot) {
      assert(report.targets > 0);
      assert.deepEqual(bad, []);
      console.log('PASS opt-in before battle', report);
      return;
    }
    if (mip) {
      assert(report.arrays.every(a => a.width === 2048 >> mip && a.depth === 8));
      assert.deepEqual(bad, []);
      console.log('PASS texture tier', report.arrays);
      return;
    }
    const out = path.join(os.tmpdir(), 'universal-endor-landscape', (eaw ? 'eaw-' : 'foc-') + (gl ? 'webgl' : 'webgpu'));
    fs.mkdirSync(out, { recursive: true });
    for (const name of await body.evaluate(() => Object.keys(window.landscapeCapture)))
      fs.writeFileSync(
        path.join(out, name + '.png'),
        Buffer.from(await body.evaluate((_, k) => window.landscapeCapture[k], name), 'base64')
      );
    report.errors = bad;
    report.files = reads;
    console.log(out, JSON.stringify(report));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    assert.deepEqual(bad, []);
    for (const v of Object.values(report.views)) {
      assert(v.changed > 20000);
      assert(v.reset < Math.max(1000, v.changed * 0.04));
    }
    assert(report.views.ground.triangles > 0 && report.views.ground.heightRange > 0.03);
    assert.equal(report.views.command.triangles, 0);
    assert(report.views.clearing.blendDelta > 50);
    assert(report.status.stands.quadrants.every(k => k > 0));
    for (const name of ['north-trail', 'south-trail'])
      assert(report.views[name].stands.trunk > 100 && report.views[name].stands.bracken > 100);
    assert(report.views.ground.grove.grass + report.views.ground.grove.meadow > 0);
    assert.equal(report.views.command.grove.grass + report.views.command.grove.meadow, 0);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
