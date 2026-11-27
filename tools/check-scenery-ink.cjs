// Mounted Tatooine: broad, nearly mist-coloured rock faces must not acquire ink
// outlines just because the contact pass sees a change of depth. A/B/A on exactly
// the same camera and sim time. Keep native sharpening and the two sun maps on.
const { chromium } = require('playwright-core'),
  { PNG } = require('pngjs');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl',
  out = path.join(os.tmpdir(), 'scenery-ink', gl ? 'gl' : 'gpu');
function measure(a, b, area) {
  let strong = 0,
    weak = 0;
  const [x0, y0, x1, y1] = area;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = 4 * (x + y * a.width),
        loss = (b.data[i] - a.data[i] + b.data[i + 1] - a.data[i + 1] + b.data[i + 2] - a.data[i + 2]) / 3;
      if (loss > 8) strong++;
      if (loss > 2) weak++;
    }
  return { strong, weak };
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1344, height: 680 }, deviceScaleFactor: 1 }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/shader error|validationerror|INVALID_OPERATION|Error while (validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 400));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#tatooine-remaster');
    const body = p.frameLocator('#game').locator('body');
    const info = await body.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame),
        limit = performance.now() + 170000;
      while (!window.game?.scenery?.active || !game.extraFx?.pr || !(game.world.time > 1) || game.warming) {
        if (performance.now() > limit) throw Error('Remastered battle not ready');
        await wait();
      }
      const g = game,
        fx = g.extraFx,
        R = g.gpuOn ? g.gpu : g.renderer;
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const now = g.last,
        pass = fx.pass;
      let mode = 'on',
        combines = 0;
      fx.pass = function (mat, t) {
        if (mat.defines?.CONTACT_SHADE) {
          if (mode === 'off') mat.uniforms.contactParams.value.w = 0;
          else if (mat.uniforms.contactParams.value.w > 0) combines++;
          if (mode === 'legacy') mat.uniforms.terrainContactMask.value = 1;
        }
        return pass.call(this, mat, t);
      };
      R.domElement.dataset.inkCheck = '1';
      const css = document.createElement('style');
      css.textContent = 'body *:not(:has([data-ink-check])):not([data-ink-check]){visibility:hidden!important}';
      document.head.append(css);
      window.inkShot = async (which, n) => {
        mode = which;
        Object.assign(g.view, { x: 1390, y: 1440, yaw: 2.9, pitch: 0.24, dist: 365 });
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
        return combines;
      };
      return { gpu: !!g.gpuOn, map: g.map.file };
    });
    assert.equal(info.gpu, !gl);
    const frames = {};
    for (const [key, n] of [
      ['on', 32],
      ['off', 4],
      ['legacy', 4],
      ['again', 4]
    ]) {
      const count = await body.evaluate((_, args) => inkShot(...args), [key, n]);
      assert(count > 0, 'No active contact pass');
      frames[key] = PNG.sync.read(await p.screenshot({ path: path.join(out, key + '.png') }));
    }
    // Same mounted ledges, not arbitrary full-screen deltas. Exclude the lower
    // part of the near formation where it actually meets the hillside.
    const zones = { near: [12, 256, 207, 325], far: [495, 242, 828, 304] },
      report = {};
    for (const [k, z] of Object.entries(zones)) report[k] = measure(frames.on, frames.off, z);
    console.log(info, report, out);
    assert.deepEqual(errors, []);
    for (const [k, z] of Object.entries(zones)) {
      assert(measure(frames.legacy, frames.off, z).strong > 50, 'Legacy depth-edge control did not find ' + k + ' ledge');
      assert(measure(frames.on, frames.again, z).strong < 15, 'Unstable ' + k + ' capture');
      assert(report[k].strong < 20, `${k}: ${report[k].strong} ink pixels from screen-space depth`);
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
