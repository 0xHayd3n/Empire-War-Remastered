// Mounted-only visual acceptance. Captures are private to TEMP, never shipped.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl', detail=process.env.LOOK_FILTER==='detail',
  startFleet = require('./mounted-space-roster.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const out = path.join(process.env.LOOK_SHOTS || path.join(os.tmpdir(), detail?'universal-fleet-detail':'universal-fleet-edges'), gl ? 'webgl' : 'webgpu');
  fs.mkdirSync(out, { recursive: true });
  try {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION/i.test(
          m.text()
        )
      ) {
        errors.push(m.text().slice(0, 1000));
        console.error(errors.at(-1));
      }
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      body = f.locator('body'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      box = s.getByRole('checkbox', { name: detail?'Steady surface detail':'Steady fleet edges', exact:true });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    assert(!(await box.isChecked()));
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(x => (x.style.backgroundImage = 'none'));
    await box.focus();
    await box.press('Space');
    assert(await box.isChecked());
    assert(await s.evaluate(x => x.scrollWidth <= x.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert(await box.isChecked());
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await startFleet(f);
    const { report, images } = await body.evaluate(async (_, {gl,detail}) => {
      const pref=detail?'steadyDetail':'fleetCoverage';
      const start = performance.now();
      while (!(window.game?.world?.time > 5)) {
        if (performance.now() - start > 180000) throw Error('No battle');
        await new Promise(r => setTimeout(r, 100));
      }
      const g = game,
        w = g.world,
        r = g.renderer,
        R = r.renderer,
        gpu = r.gpu,
        c = r.camera,
        H = R.domElement.height,
        W = R.domElement.width;
      const { gfx } = await import('/js/gfx.js'),
        { stockHull } = await import('/js/game/destroyer-detail.js'),
        { texturesReady } = await import('/js/dds.js');
      if (!!gpu === gl || !g.setup.instant.armies.every(a => a.length === 100)) throw Error('Wrong fleet or backend');
      const u = w.units.find(s => s.player === g.human && s.obj?.visible && !s.dead && stockHull(s));
      if (!u) throw Error('Missing flagship');
      g.modeSuspended = true;
      await new Promise(requestAnimationFrame);
      await texturesReady();
      Object.assign(r.rig, { x: u.x, y: u.y, z: u.z || 0, dist: 4900, pitch: 0.94, free: true, shake: 0 });
      r.post.flare = false;
      r.render(w, 0);
      if (!detail && r.post.sceneDensity !== (gl ? 1.25 : 1.5)) throw Error('Unexpected ratio: ' + r.post.sceneDensity);
      const center = s => {
        const p = r.project(s.x, s.y, s.z || 0, {});
        return { x: Math.round((p.x * W) / r.width), y: Math.round((p.y * H) / r.height), behind: p.behind };
      };
      const fighters = w.units
        .filter(s => s.isFighter && !s.dead && s.obj?.visible)
        .map(s => ({ s, p: center(s) }))
        .filter(({ p }) => !p.behind && p.x > 20 && p.x < W - 20 && p.y > 20 && p.y < H - 20)
        .slice(0, 30);
      if (fighters.length < 2) throw Error('Too few visible fighters: ' + fighters.length);
      const hull = center(u),
        regions = { hull: [{ ...hull, r: 70 }], fighters: fighters.map(({ p }) => ({ ...p, r: 8 })) };
      const images = {},
        report = { W, H, fighters: fighters.length, projectionSteps: 13, metrics: {}, targets: {}, timing: {} };
      function luma(px, i) {
        return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      }
      function patch(px, ps) {
        const a = [];
        let range = 0;
        for (const p of ps) {
          let lo = 255,
            hi = 0;
          for (let y = p.y - p.r; y <= p.y + p.r; y++)
            for (let x = p.x - p.r; x <= p.x + p.r; x++) {
              const k = luma(px, (y * W + x) * 4);
              a.push(k);
              lo = Math.min(lo, k);
              hi = Math.max(hi, k);
            }
          range += hi - lo;
        }
        return { a, range: range / ps.length };
      }
      function png(px) {
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
        return cv.toDataURL().split(',')[1];
      }
      async function read() {
        const next = gpu?.readNext();
        r.draw(w, R, 0);
        if (next) return (await next).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          out = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) out.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        return out;
      }
      for (const mode of ['off', 'on']) {
        gfx[pref] = mode === 'on';
        r.draw(w, R, 0);
        if (gpu) await gpu.settle();
        const t = r.post.targets;
        report.targets[mode] = {
          scene: [t.scene.width, t.scene.height],
          resolve: t.resolved ? [t.resolved.width, t.resolved.height] : null
        };
        const series = { fighters: [], hull: [] };
        // Slide the projection 0.2 display pixels horizontally and 0.1 vertically per frame. Identical frozen poses, exact correspondence at every depth.
        for (let j = 0; j < report.projectionSteps; j++) {
          c.setViewOffset(W, H, j * 0.2, j * 0.1, W, H);
          const px = await read();
          if (j === 0) images[mode] = png(px);
          for (const [k, ps] of Object.entries(regions)) series[k].push(patch(px, ps));
        }
        const metrics = (report.metrics[mode] = {});
        for (const [name, frames] of Object.entries(series)) {
          let sum = 0,
            n = 0;
          for (let j = 2; j < frames.length; j++)
            for (let i = 0; i < frames[j].a.length; i++) {
              sum += Math.abs(frames[j].a[i] - 2 * frames[j - 1].a[i] + frames[j - 2].a[i]);
              n++;
            }
          metrics[name] = { roughness: sum / n, contrast: frames.reduce((a, f) => a + f.range, 0) / frames.length };
        }
        c.clearViewOffset();
      }
      // A genuine vacated silhouette: capture an empty patch before and immediately after the fighters appear there.
      const show = on => {
        for (const { s } of fighters) s.obj.visible = on;
      };
      show(false);
      await read();
      const empty = patch(await read(), regions.fighters).a;
      show(true);
      const full = patch(await read(), regions.fighters).a;
      show(false);
      const gone = patch(await read(), regions.fighters).a;
      show(true);
      const delta = (a, b) => a.reduce((v, x, i) => v + Math.abs(x - b[i]), 0);
      report.disappearance = { fighterSignal: delta(full, empty), residual: delta(gone, empty) };
      g.modeSuspended = false;
      g.last = performance.now();
      requestAnimationFrame(g.frame);
      const samples = { off: [], on: [] },
        t0 = w.time,
        live = fighters[0].s,
        from = [live.x, live.y];
      if (live.squad?.player === g.human) g.command({ c: 'move', u: [live.squad.id], x: u.x + 800, y: u.y + 400 });
      for (const mode of ['off', 'on', 'on', 'off']) {
        gfx[pref] = mode === 'on';
        let prev;
        for (let i = 0; i < 48; i++) {
          const now = await new Promise(requestAnimationFrame);
          if (i >= 8) samples[mode].push(now - prev);
          prev = now;
          r.rig.yaw += 0.001;
        }
      }
      for (const [key, arr] of Object.entries(samples)) {
        arr.sort((a, b) => a - b);
        report.timing[key] = { n: arr.length, median: arr[Math.floor(arr.length / 2)], p95: arr[Math.ceil(arr.length * 0.95) - 1] };
      }
      report.elapsedSim = w.time - t0;
      report.fighterTravel = Math.hypot(live.x - from[0], live.y - from[1]);
      return { report, images };
    }, {gl,detail});
    for (const [key, img] of Object.entries(images)) fs.writeFileSync(path.join(out, key + '.png'), Buffer.from(img, 'base64'));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), out);
    for (const k of ['hull', 'fighters']) {
      if (!detail || k==='hull') assert(report.metrics.on[k].roughness < report.metrics.off[k].roughness * (detail?1:.95), `${k} needs a smoother pan`);
      assert(report.metrics.on[k].contrast >= report.metrics.off[k].contrast * 0.7, `${k} should remain distinct`);
    }
    assert(
      report.disappearance.fighterSignal > 100 && report.disappearance.residual < report.disappearance.fighterSignal * 0.02,
      'vacated fighter pixels clear immediately'
    );
    assert(report.elapsedSim > 0 && report.fighterTravel > 0);
    assert.deepEqual(report.targets.on.resolve, detail ? null : [report.W, report.H]);
    assert.equal(report.targets.off.resolve, null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
