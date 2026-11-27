// Compare the exact same live battle poses on/off. No archive art leaves the local machine.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl';
const out = path.join(process.env.LOOK_SHOTS || path.join(os.tmpdir(), 'universal-fleet-blast'), gl ? 'webgl' : 'webgpu');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
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
      box = s.getByRole('checkbox', { name: 'Explosion light on hulls' });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    assert(await box.isChecked());
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(el => (el.style.backgroundImage = 'none'));
    await box.focus();
    await box.press('Space');
    assert(!(await box.isChecked()));
    assert(await s.evaluate(el => el.scrollWidth <= el.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert(!(await box.isChecked()));
    await box.check();
    await s.getByLabel('Space battle look').selectOption('orbital');
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await require('./mounted-space-roster.cjs')(f);
    const { report, images } = await body.evaluate(async (_, gl) => {
      const start = performance.now();
      while (!(window.game?.world?.time > 5)) {
        if (performance.now() - start > 180000) throw Error('Battle did not start');
        await new Promise(r => setTimeout(r, 100));
      }
      const g = game,
        r = g.renderer,
        w = g.world,
        cam = r.camera,
        R = r.renderer,
        gpu = r.gpu,
        W = R.domElement.width,
        H = R.domElement.height;
      if (!!gpu === gl || !g.setup.instant.armies.every(a => a.length === 100)) throw Error('Wrong renderer or roster');
      const { gfx } = await import('/js/gfx.js'),
        { stockHull } = await import('/js/game/destroyer-detail.js');
      const u = w.units.find(s => s.player === g.human && s.obj?.visible && !s.dead && stockHull(s));
      if (!u) throw Error('No commandable flagship');
      const squad = w.squads.find(s => s.player === g.human && !s.dead && s.fighters.length),
        first = squad?.fighters.find(s => !s.dead);
      const h0 = u.heading,
        f0 = first && [first.x, first.y];
      g.command({ c: 'face', u: [u.id], h: u.heading + 0.9 });
      if (squad) g.command({ c: 'move', u: [squad.id], x: u.x + 450 * Math.cos(u.heading), y: u.y + 450 * Math.sin(u.heading) });
      Object.assign(r.rig, { x: u.x, y: u.y, z: u.z || 0, dist: 3100, pitch: 0.94, free: true, shake: 0 });
      const tick = () => new Promise(requestAnimationFrame);
      for (let i = 0; i < 60; i++) await tick();
      g.modeSuspended = true;
      await tick();
      await (await import('/js/dds.js')).texturesReady();
      r.rig.apply(0);
      cam.updateMatrixWorld();
      r.post.flare = false;
      // Emit one render-only explosion, not damage or a simulation order. Leave its fiery sprites in BOTH images.
      const v = cam.position.clone().set(u.x, u.y, u.z || 0),
        off = cam.position.clone().sub(v).normalize();
      v.addScaledVector(off, u.visualRadius * 0.48);
      v.z += u.visualRadius * 0.18;
      r.explosion(v.x, v.y, v.z, Math.max(55, u.visualRadius * 0.27), false);
      r.render(w, 0);
      const subject = r.project(u.x, u.y, u.z || 0, {}),
        Cx = (subject.x * W) / r.width,
        Cy = (subject.y * H) / r.height;
      const rad = Math.max(24, (u.visualRadius * H) / (cam.position.distanceTo(u.obj.position) * 2 * Math.tan((cam.fov * Math.PI) / 360)));
      const images = {};
      async function pixels(on) {
        gfx.hullBlastLight = on;
        r.draw(w, R, 0);
        await r.orbitProbe?.ready;
        if (gpu) await gpu.settle();
        const pending = gpu?.readNext();
        r.draw(w, R, 0);
        if (pending) return (await pending).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          a = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) a.set(raw.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
        return a;
      }
      function png(px) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
        return c.toDataURL().split(',')[1];
      }
      function difference(a, b) {
        let changed = 0,
          near = 0,
          brighter = 0,
          total = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = b[i] + b[i + 1] + b[i + 2] - a[i] - a[i + 1] - a[i + 2];
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
            changed++;
            if (d > 6) brighter++;
            total += Math.max(0, d);
            if (Math.hypot(((i / 4) % W) - Cx, Math.floor(i / 4 / W) - Cy) < rad * 1.5) near++;
          }
        }
        return { changed, near, brighter, total };
      }
      await pixels(false);
      const before = await pixels(false),
        after = await pixels(true),
        peak = difference(before, after);
      images.before = png(before);
      images.after = png(after);
      const reset = difference(before, await pixels(false));
      gfx.spacePresentation = 'inherit'; // the default path does not use orbital linear-color uniforms
      const inherited = difference(await pixels(false), await pixels(true));
      gfx.spacePresentation = 'orbital';
      r.blastField.advance(r.blastField.events.at(-1).life * 0.55);
      const tail = difference(before, await pixels(true));
      r.blastField.advance(2);
      const expired = difference(before, await pixels(true));
      const report = {
        W,
        H,
        roster: g.setup.instant.armies.map(a => a.length),
        units: w.units.length,
        turn: Math.abs(u.heading - h0),
        fighterTravel: first ? Math.hypot(first.x - f0[0], first.y - f0[1]) : 0,
        peak,
        inherited,
        reset,
        tail,
        expired,
        intervals: {}
      };
      // Live ABBA sample. Emit matching render FX in both modes; frame intervals, not isolated GPU timings.
      g.modeSuspended = false;
      g.last = performance.now();
      requestAnimationFrame(g.frame);
      const samples = { off: [], on: [] };
      const began = w.time;
      for (const key of ['off', 'on', 'on', 'off']) {
        gfx.hullBlastLight = key === 'on';
        let last;
        for (let i = 0; i < 48; i++) {
          if (!(i % 12)) r.explosion(v.x, v.y, v.z, 85, false);
          const now = await tick();
          if (i >= 8) samples[key].push(now - last);
          last = now;
          r.rig.yaw += 0.0015;
        }
      }
      for (const [key, a] of Object.entries(samples)) {
        a.sort((a, b) => a - b);
        report.intervals[key] = { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * 0.95) - 1] };
      }
      report.elapsedSim = w.time - began;
      return { report, images };
    }, gl);
    for (const [k, data] of Object.entries(images)) fs.writeFileSync(path.join(out, k + '.png'), Buffer.from(data, 'base64'));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), out);
    assert([report.peak, report.inherited].every(d => d.brighter > 60 && d.near > 60), 'local hull illumination at strategy zoom');
    assert(
      // A few subpixel edges can change across readbacks in an otherwise frozen fleet (notably WebGL).
      // Require the residual to be both < 1% of the signal and <= 16 pixels in a 1080p frame.
      [report.reset, report.expired].every(d => d.changed <= 16 && d.changed < report.peak.changed * 0.01) &&
        report.tail.total > 0 && report.tail.total < report.peak.total,
      'reversible cooling pulse'
    );
    assert(report.turn > 0.001 && report.fighterTravel > 0 && report.elapsedSim > 0, 'live commands and advancing battle');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
