// A real rock cluster and deployed infantry. Measure *where* contact darkens the final
// frame, not just how many pixels changed. Keep the cast maps identical during masking.
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl',
  out = path.join(os.tmpdir(), 'remastered-shadow-halos', gl ? 'gl' : 'gpu');
function evidence(frames) {
  const { width: w, height: h } = frames.on,
    delta = (a, b, i) =>
      frames[a].data[i] - frames[b].data[i] + frames[a].data[i + 1] - frames[b].data[i + 1] + frames[a].data[i + 2] - frames[b].data[i + 2];
  // Distance in final screen pixels to actual visible geometry, isolated without moving its shadows.
  const dist = new Uint16Array(w * h).fill(255);
  for (let j = 0; j < dist.length; j++) if (Math.abs(delta('bare', 'off', 4 * j)) > 6) dist[j] = 0;
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w - 1; x++) {
      const j = y * w + x;
      dist[j] = Math.min(dist[j], 1 + Math.min(dist[j - 1], dist[j - w], dist[j - w + 1], dist[j - w - 1]));
    }
  for (let y = h - 2; y >= 0; y--)
    for (let x = w - 2; x > 0; x--) {
      const j = y * w + x;
      dist[j] = Math.min(dist[j], 1 + Math.min(dist[j + 1], dist[j + w], dist[j + w - 1], dist[j + w + 1]));
    }
  let remote = 0,
    attached = 0,
    ink = 0,
    cast = 0,
    covered = 0;
  for (let y = (h * 0.25) | 0; y < h * 0.75; y++)
    for (let x = (w * 0.25) | 0; x < w * 0.75; x++) {
      const j = y * w + x,
        i = j * 4,
        d = dist[j];
      if (!d) covered++;
      const loss = delta('off', 'on', i), ref = frames.off.data;
      if (loss > 12) {
        // A small radius alone can still draw a black contour around an otherwise sunlit surface.
        if (loss > 0.45 * (ref[i] + ref[i+1] + ref[i+2])) ink++;
        if (d >= 5) remote++;
        else attached++;
      }
      if (d >= 5 && delta('sunOff', 'off', i) > 18) cast++;
    }
  return { remote, attached, ink, cast, covered };
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1120, height: 720 }, deviceScaleFactor: 1 }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (?:validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 400));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#tatooine-remaster');
    const root = p.frameLocator('#game').locator('body');
    const info = await root.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame),
        until = performance.now() + 180000;
      while (!window.game?.ground?.userData.reviewedLandscape?.active || !game.extraFx?.pr || !(game.world.time > 1)) {
        if (performance.now() > until) throw Error('No active remaster');
        await wait();
      }
      const g = game,
        fx = g.extraFx,
        R = g.gpuOn ? g.gpu : g.renderer,
        { lighting: L } = await import('/js/model.js');
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const troop = g.world.units.find(u => u.foot && u.side === g.me && u.holder?.visible),
        rock = g.props
          .filter(p => /rockclstr/i.test(p.modelFile))
          .sort((a, b) => Math.hypot(a.x - troop.x, a.y - troop.y) - Math.hypot(b.x - troop.x, b.y - troop.y))[0];
      if (!rock) throw Error('No mounted rock cluster');
      const pass = fx.pass,
        render = R.render,
        now = g.last;
      let mode = 'on';
      fx.pass = function (m, target) {
        if (m.defines?.CONTACT_SHADE && mode !== 'on') m.uniforms.contactParams.value.w = 0;
        return pass.call(this, m, target);
      };
      R.render = function (scene, eye) {
        if (scene !== g.scene || eye !== g.camera) return render.call(this, scene, eye);
        const hidden = mode === 'bare' ? scene.children.filter(c => c !== g.ground && c.visible) : [],
          shadow = L.shadowOn.value,
          near = L.landGround.value.w;
        for (const c of hidden) c.visible = false;
        if (mode === 'sunOff') {
          L.shadowOn.value = 0;
          L.landGround.value.w = Math.min(1, near);
        }
        try {
          return render.call(this, scene, eye);
        } finally {
          for (const c of hidden) c.visible = true;
          L.shadowOn.value = shadow;
          L.landGround.value.w = near;
        }
      };
      R.domElement.dataset.halo = '1';
      const style = document.createElement('style');
      style.textContent = 'body *:not(:has([data-halo])):not([data-halo]){visibility:hidden!important}';
      document.head.append(style);
      window.haloShot = async (which, name, n) => {
        mode = name;
        const at = which === 'rock' ? rock : troop;
        Object.assign(g.view, { x: at.x, y: at.y, yaw: -1.5, pitch: 0.86, dist: which === 'rock' ? 350 : 430 });
        for (let i = 0; i < n; i++) {
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(now);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
          await wait();
        }
        await R.settle?.();
      };
      return { gpu: !!g.gpuOn, map: g.map.file, rock: rock.modelFile };
    });
    assert.equal(info.gpu, !gl);
    const stats = {};
    for (const view of ['rock', 'troops']) {
      const frames = {};
      await root.evaluate((_, view) => haloShot(view, 'on', 32), view);
      for (const mode of ['on', 'off', 'bare', 'sunOff']) {
        await root.evaluate((_, args) => haloShot(...args, 3), [view, mode]);
        frames[mode] = PNG.sync.read(await p.screenshot({ path: path.join(out, view + '-' + mode + '.png') }));
      }
      stats[view] = evidence(frames);
    }
    console.log(info, stats, out);
    assert.deepEqual(errors, []);
    for (const [name, s] of Object.entries(stats)) {
      assert(s.covered > 100 && s.attached > 25, `${name}: missing objects or contact shading`);
      assert(s.remote < 25, `${name}: detached copies on the ground (${s.remote} pixels)`);
      assert(s.ink < 25, `${name}: contact shade is drawing black contours (${s.ink} pixels)`);
    }
    assert(stats.troops.cast > 100, 'Directional unit shadows disappeared');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
