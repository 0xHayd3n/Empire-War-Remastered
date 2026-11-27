// Isolated profile; actual mounted battle, ordinary World.damage and facing order. No mounted art is exported to the repo.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
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
        errors.length < 5 &&
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION/i.test(
          m.text()
        )
      ) {
        errors.push(m.text().slice(0, 2500));
        console.error(errors.at(-1));
      }
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      box = s.getByRole('checkbox', { name: 'Ship hull damage' });
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
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await require('./mounted-space-roster.cjs')(f);
    const { report, images } = await f.locator('body').evaluate(async (_, gl) => {
      const tick = () => new Promise(requestAnimationFrame),
        t0 = performance.now();
      while (!(window.game?.world?.time > 5)) {
        if (performance.now() - t0 > 180000) throw Error('No battle');
        await tick();
      }
      const g = game,
        w = g.world,
        r = g.renderer,
        R = r.renderer,
        gpu = r.gpu,
        c = r.camera,
        W = R.domElement.width,
        H = R.domElement.height;
      if (!!gpu === gl) throw Error('Wrong backend');
      const T = await import('three'),
        { stockHull } = await import('/js/game/destroyer-detail.js'),
        { gfx } = await import('/js/gfx.js');
      const u = w.units.find(u => u.player === g.human && u.obj?.visible && stockHull(u));
      if (!u) throw Error('No flagship');
      const hull = stockHull(u),
        damage = () => r.hullDamage,
        engine = u.hardpoints.find(h => h.kind === 'HARD_POINT_ENGINE');
      if (!engine) throw Error('No main engine bank');
      const freeze = async () => {
          g.modeSuspended = true;
          await tick();
        },
        resume = () => {
          g.modeSuspended = false;
          g.last = performance.now();
          requestAnimationFrame(g.frame);
        };
      await freeze();
      await (await import('/js/dds.js')).texturesReady();
      r.post.flare = false;
      function camera(zoom) {
        hull.updateWorldMatrix(true, false);
        const at = new T.Vector3(0, 20, 55).applyMatrix4(hull.matrixWorld),
          eye = new T.Vector3(zoom === 'fleet' ? 1100 : 315, zoom === 'fleet' ? 2000 : 790, zoom === 'fleet' ? 1450 : 450).applyMatrix4(
            hull.matrixWorld
          );
        c.position.copy(eye);
        c.up.set(0, 0, 1);
        c.lookAt(at);
        c.fov = 49;
        c.near = 1;
        c.far = 40000;
        c.updateProjectionMatrix();
        c.updateMatrixWorld();
        for (const sk of r.skydomes) sk.root.position.copy(eye);
      }
      function contact(shield) {
        const source = shield ? u.shieldMesh.children[0] : hull;
        source.updateWorldMatrix(true, false);
        const aim = new T.Vector3(92, 202, 73).applyMatrix4(hull.matrixWorld);
        const pick = new T.Raycaster(c.position, aim.sub(c.position).normalize());
        pick.layers.enableAll(); // The actual drawn hull can be in the instance pool's layer.
        const hit = pick.intersectObject(source,false)[0];
        if (!hit) throw Error('Missed the mounted aft surface');
        return hit.point;
      }
      async function shot(on) {
        gfx.hullDamageMarks = on;
        r.draw(w, R, 0);
        if (gpu) await gpu.settle();
        const next = gpu?.readNext();
        r.draw(w, R, 0);
        if (next) return (await next).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          a = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) a.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        return a;
      }
      function png(px) {
        const el = document.createElement('canvas');
        el.width = W;
        el.height = H;
        el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
        return el.toDataURL().split(',')[1];
      }
      function diff(a, b) {
        let n = 0,
          red = 0,
          blue = 0,
          dark = 0;
        for (let i = 0; i < a.length; i += 4) {
          const dr = b[i] - a[i],
            dg = b[i + 1] - a[i + 1],
            db = b[i + 2] - a[i + 2];
          if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 9) {
            n++;
            if (dr > 6 && dr > db) red++;
            if (db > 6 && db > dr) blue++;
            if (dr + dg + db < -9) dark++;
          }
        }
        return { n, red, blue, dark };
      }
      const images = {},
        report = { backend: gl ? 'webgl' : 'webgpu', roster: g.setup.instant.armies.map(a => a.length), cases: {} };
      async function compare(label) {
        const a = await shot(false),
          b = await shot(true);
        report.cases[label] = diff(a, b);
        images[label] = png(b);
      }
      function hit(amount, extra = {}) {
        const p = contact(extra.shields !== false && u.shield > 0);
        w.damage(u, amount, { damageType: 'Damage_Default', x: p.x, y: p.y, z: p.z, ...extra });
      }
      camera('fleet');
      await shot(true);
      const health = u.health,
        shield = u.shield;
      hit(3);
      if (u.health !== health || !(u.shield < shield) || !damage().marks.some(m => m.shield) || damage().marks.some(m => !m.shield))
        throw Error('shield routing failed');
      // Advance only visual/simulation time in this frozen reference; same mesh and pixels in each pair.
      w.time += 0.12;
      await compare('shield');
      w.time += 0.5;
      await compare('shieldExpired');
      hit(50, { shields: false });
      const mark = damage().marks.find(m => !m.shield);
      if (!mark || !(u.health < health)) throw Error('Missing real hull damage');
      await compare('hot');
      const local = mark.center.clone(),
        angle = u.heading;
      g.command({ c: 'face', u: [u.id], h: u.heading + 1.2 });
      const before = w.time;
      resume();
      while (w.time < before + 2) await tick();
      await freeze();
      camera('fleet');
      await compare('coolFleet');
      camera('close');
      await compare('coolClose');
      report.turn = Math.abs(u.heading - angle);
      hull.updateWorldMatrix(true, false);
      report.anchorError = local.clone().applyMatrix4(hull.matrixWorld).distanceTo(mark.center.clone().applyMatrix4(mark.mesh.matrixWorld));
      report.anchored = damage().marks.includes(mark) && mark.center.distanceTo(local) === 0 && report.anchorError < 0.005;
      const hs = u.hardpoints.filter(h => h.kind === 'HARD_POINT_ENGINE');
      report.engineCount = hs.length;
      const other = w.units.find(v => v !== u && v.isMobile && !v.dead && v.player?.id >= 0 && v.engineAlive());
      function nozzleLight(px) {
        let sum = 0,
          n = 0;
        for (const x of [-87.2, -0.04, 87.2]) {
          const s = new T.Vector3(x, 305, 50.6).applyMatrix4(hull.matrixWorld).project(c),
            cx = Math.round(((1 + s.x) * W) / 2),
            cy = Math.round(((1 - s.y) * H) / 2);
          for (let yy = cy - 2; yy <= cy + 2; yy++)
            for (let xx = cx - 2; xx <= cx + 2; xx++) {
              const i = 4 * (xx + yy * W);
              sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
              n++;
            }
        }
        return sum / n;
      }
      camera('fleet');
      report.thrustBefore = nozzleLight(await shot(true));
      const ep = new T.Vector3();
      engine.worldPos(ep);
      w.damage(u, engine.maxHealth * 3, { damageType: 'Damage_Default', hp: engine, shields: false, x: ep.x, y: ep.y, z: ep.z });
      if (engine.alive || u.dead || u.engineAlive() || !other?.engineAlive()) throw Error('wrong bank lost');
      // Isolate the new cold interior from pre-existing scars, smoke and archive particles.
      while (damage().marks.length) damage().remove(0);
      // Let the authored destruction burst and already-emitted exhaust die normally before reading the bank.
      const engineTime = w.time;
      r.cameraOverride = () => camera('fleet');
      for (let i = 0; i < 64; i++) {
        w.time += 0.05;
        r.render(w, 0.05);
        if (i % 8 === 7) await tick();
      }
      r.cameraOverride = null;
      camera('fleet');
      report.thrustAfter = nozzleLight(await shot(true));
      await compare('enginesFleet');
      camera('close');
      await compare('enginesClose');
      report.banks = damage().banks.size;
      u.obj.visible = false;
      await compare('hidden');
      u.obj.visible = true;
      w.time = engineTime;
      camera('fleet');
      const first = w.time;
      resume();
      const samples = { off: [], on: [] };
      for (const key of ['off', 'on', 'on', 'off']) {
        gfx.hullDamageMarks = key === 'on';
        let prev;
        for (let i = 0; i < 36; i++) {
          const t = await tick();
          if (i >= 8) samples[key].push(t - prev);
          prev = t;
          r.rig.yaw += 0.001;
        }
      }
      for (const [k, a] of Object.entries(samples)) {
        a.sort((a, b) => a - b);
        report[k] = { median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(0.95 * a.length) - 1] };
      }
      report.elapsed = w.time - first;
      return { report, images };
    }, gl);
    const dir = path.join(process.env.LOOK_SHOTS || path.join(os.tmpdir(), 'universal-hull-damage'), gl ? 'webgl' : 'webgpu');
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, img] of Object.entries(images)) fs.writeFileSync(path.join(dir, k + '.png'), Buffer.from(img, 'base64'));
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), dir);
    const C = report.cases;
    assert(C.shield.blue > 12 && C.shieldExpired.n < 15);
    assert(C.hot.red > 8 && C.coolFleet.dark > 10 && C.coolClose.dark > 40);
    assert(report.turn > 0.02 && report.anchored);
    assert(report.thrustAfter < report.thrustBefore * 0.6, 'exhaust cores actually went dark');
    assert(C.enginesFleet.n > 15 && C.enginesClose.n > 50 && report.banks === 1 && C.hidden.n < 20);
    assert(report.elapsed > 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
