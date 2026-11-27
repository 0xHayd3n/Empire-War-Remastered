// Actual Instant Battle and normal strategy camera in the mounted Universal window. No archive exports.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os');
const world = process.env.LOOK_WORLD || 'Tatooine',
  id = process.env.LOOK_PROFILE || 'stock',
  gl = process.env.LOOK_BACKEND === 'webgl';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(100000);
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    p.on('pageerror', e => {
      bad.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|Shader Error|INVALID_OPERATION|invalid.*pipeline/i.test(
          m.text()
        ) &&
        bad.length < 4
      ) {
        bad.push(m.text().slice(0, 1500));
        console.error(bad.at(-1));
      }
    });
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      box = s.getByRole('checkbox', { name: 'Ground battlefield lighting', exact: true });
    async function settings() {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    }
    await settings();
    assert(!(await box.isChecked()));
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await box.focus();
    await box.press('Space');
    assert(await box.isChecked());
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.reload();
    await settings();
    assert(await box.isChecked());
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    for (const name of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${name}"]:visible`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill(world.replaceAll('_', ' '));
    const leaf = board.locator(`[data-world="${world}"][data-domain="land"][data-source="${id}"]`).first(),
      file = await leaf.getAttribute('data-file');
    await leaf.click();
    await f.locator(`.op-setup[data-profile="${id}"] .op-go:enabled`).click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const { report, images } = await f.locator('body').evaluate(async (_, gl) => {
      const tick = () => new Promise(requestAnimationFrame),
        deadline = performance.now() + 110000;
      while (!(window.game?.world?.time > 3 && game.ground)) {
        if (performance.now() > deadline) throw Error('No live ground battle');
        await tick();
      }
      const g = game,
        w = g.world,
        R = g.gpuOn ? g.gpu : g.renderer,
        cam = g.camera,
        { gfx } = await import('/js/gfx.js'),
        { lighting } = await import('/js/model.js');
      if (gl === !!g.gpuOn || R.isMirror) throw Error('Wrong backend');
      const fixture = g.setup.mapFile.toUpperCase() === '_MP_LAND_TATOOINE.TED';
      if (fixture) {
        const start = w.units.find(u => u.foot && u.side === g.me && u.holder?.visible);
        if (!start) throw Error('No army for fixture');
        const { db } = await import('/js/gamedata.js');
        await w.finishSite(
          { base: true, side: g.me, x: start.x + 100, y: start.y + 96, rot: [0, 0, 0], scale: 1, options: [] },
          db.type('E_Ground_Barracks'),
          g.me
        );
        await w.spawn('AT_ST_Walker', start.x + 18, start.y + 24, 0, g.me);
        for (let i = 0; i < 100; i++) await tick();
      }
      const W = R.domElement.width,
        H = R.domElement.height,
        units = w.units.filter(u => !u.dead && u.holder?.visible && u.seen !== false),
        mine = units.filter(u => u.side === g.me),
        anchor = mine.find(u => u.structure) || mine[0];
      if (!anchor) throw Error('Empty team');
      Object.assign(g.view, { x: anchor.x + 40, y: anchor.y + 35, dist: 680 });
      g.modeSuspended = true;
      await tick();
      await (await import('/js/dds.js')).texturesReady();
      const now = g.last;
      let mask = '',
        dark = false,
        bound = 0;
      const original = R.render;
      R.render = function (scene, eye) {
        const hidden = [];
        let old;
        if (scene === g.scene && eye === cam) {
          bound = lighting.landGround.value.w;
          if (mask === 'objects') {
            for (const m of scene.children)
              if (m.visible && m.userData.casts) {
                m.visible = false;
                hidden.push(m);
              }
          }
          if (mask === 'terrain') {
            g.ground.visible = false;
            hidden.push(g.ground);
          }
          if (dark) {
            old = lighting.shadowOn.value;
            lighting.shadowOn.value = 0;
            lighting.landGround.value.w = 1;
          }
        }
        try {
          return original.call(this, scene, eye);
        } finally {
          for (const m of hidden) m.visible = true;
          if (old !== undefined) {
            lighting.shadowOn.value = old;
            lighting.landGround.value.w = bound;
          }
        }
      };
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
      async function shot(on) {
        gfx.groundDaylight = on;
        draw();
        await g.gpu?.settle();
        const next = g.gpu?.readNext();
        draw();
        if (next) return (await next).data;
        const ctx = R.getContext(),
          raw = new Uint8Array(W * H * 4),
          out = raw.slice();
        ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        for (let y = 0; y < H; y++) out.set(raw.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
        return out;
      }
      await shot(false);
      await shot(true);
      const old = await shot(false),
        on = await shot(true);
      if (bound !== 2 || !g.groundNear) throw Error('Fine map not bound');
      const dims = [g.cast.size, g.groundNear.target.width],
        footprints = g.shadows?.count;
      dark = true;
      const noShadow = await shot(true);
      dark = false;
      mask = 'objects';
      const noObjects = await shot(true);
      mask = 'terrain';
      const noTerrain = await shot(true);
      mask = '';
      const reset = await shot(false);
      const delta = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      const report = {
        fixture,
        map: g.setup.mapFile,
        backend: gl ? 'webgl' : 'webgpu',
        dims,
        footprints,
        soil: g.ground.userData.soil,
        units: units.length,
        army: {
          infantry: mine.filter(u => u.foot).length,
          vehicles: mine.filter(u => !u.foot && !u.structure).length,
          buildings: mine.filter(u => u.structure).length
        },
        ground: 0,
        objects: 0,
        shade: 0,
        lit: 0,
        black: 0,
        reset: 0,
        times: {}
      };
      for (let i = 0; i < on.length; i += 4) {
        const d = delta(old, on, i),
          ds = noShadow[i] + noShadow[i + 1] + noShadow[i + 2] - on[i] - on[i + 1] - on[i + 2];
        if (delta(old, reset, i) > 12) report.reset++;
        if (d > 9 && delta(on, noTerrain, i) > 36 && delta(on, noObjects, i) < 3) report.ground++;
        if (d > 9 && delta(on, noObjects, i) > 36 && delta(on, noTerrain, i) < 3) report.objects++;
        if (ds > 10) {
          report.shade++;
          if (on[i] + on[i + 1] + on[i + 2] < 9) report.black++;
        }
        if (ds === 0 && delta(on, noTerrain, i) > 45) report.lit++;
      }
      const images = {};
      for (const [name, a] of [
        ['original', old],
        ['daylight', on]
      ]) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(a), W, H), 0, 0);
        images[name] = c.toDataURL('image/jpeg', 0.91).split(',')[1];
      }
      const x = g.view.x;
      for (const key of [false, true, true, false]) {
        gfx.groundDaylight = key;
        draw();
        await g.gpu?.settle();
        let last = await tick();
        const dt = (report.times[key] ||= []);
        for (let i = 0; i < 52; i++) {
          g.view.x = x + (i - 25) * 1.5;
          draw();
          const tm = await tick();
          if (i > 6) dt.push(tm - last);
          last = tm;
        }
      }
      for (const key in report.times) {
        const a = report.times[key].sort((a, b) => a - b);
        report.times[key] = [a[Math.floor(a.length * 0.5)], a[Math.floor(a.length * 0.95)]];
      }
      gfx.groundDaylight = true;
      gfx.shadows = false;
      await shot(true);
      report.noCast = bound === 1 && !g.groundNear;
      return { report, images };
    }, gl);
    const out = path.join(os.tmpdir(), 'universal-ground-daylight', id, world, gl ? 'webgl' : 'webgpu');
    fs.mkdirSync(out, { recursive: true });
    for (const [k, data] of Object.entries(images)) fs.writeFileSync(path.join(out, k + '.jpg'), Buffer.from(data, 'base64'));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report), out);
    assert.equal(report.map.toLowerCase(), file.toLowerCase());
    assert.deepEqual(bad, []);
    assert(
      report.ground > 1000 &&
        report.objects > 150 &&
        report.shade > 200 &&
        report.lit > 1000 &&
        report.black < report.shade * 0.02 &&
        report.noCast
    );
    assert(report.reset < 800);
    assert(report.footprints > 0);
    if (report.fixture) assert(report.army.vehicles > 0 && report.army.buildings > 0 && report.army.infantry > 0);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
