// A visible sky is correct above an oblique skyline. Test for backdrop *below* the
// skyline, not for a globally sky-free image. Keep the real HUD on for every capture.
const path = require('node:path');
module.exports = async (body, page, out, PNG) => {
  const { rimViews } = await import('./outskirts.mjs');
  // Let the launch message expire normally; its CSS fades on wall time even in a
  // frozen battle and would contaminate whole-skyline A/Bs. Do not hide the HUD.
  await body.locator('#messages > *').first().waitFor({ state: 'detached', timeout: 30000 });
  const base = await body.evaluate(async () => {
    const g = game,
      R = g.gpuOn ? g.gpu : g.renderer,
      T = await import('three'),
      original = R.render,
      color = new T.Color(),
      ring = g.scene.getObjectByName('Reviewed outskirts');
    if (!ring?.visible) throw Error('No active scenic perimeter');
    const lo = g.map.playMin.slice(0, 2),
      hi = g.map.playMax.slice(0, 2),
      steps = g.cam.steps,
      maximum = steps.at(-1)[0],
      cam = g.camera;
    const bounds = () => JSON.stringify([g.map.playMin, g.map.playMax, g.cam.steps, cam.far]);
    const initial = bounds();
    // The actual backdrop is drawn before the main scene. Clear it in just this pass:
    // black/green differences reveal uncovered pixels regardless of sky/fog colour.
    let backdrop = null,
      without = false,
      short = false;
    const terrain = ring.getObjectByName('Exterior terrain'),
      geo = terrain.geometry;
    R.render = function (s, eye) {
      if (s !== g.scene || eye !== cam) return original.call(this, s, eye);
      const visible = ring.visible;
      try {
        if (short) geo.setDrawRange(0, terrain.userData.withoutLastStrip);
        if (without) ring.visible = false;
        if (backdrop !== null) {
          const a = R.getClearAlpha();
          R.getClearColor(color);
          R.setClearColor(backdrop, 1);
          R.clear();
          R.setClearColor(color, a);
        }
        return original.call(this, s, eye);
      } finally {
        ring.visible = visible;
        if (short) geo.setDrawRange(0, Infinity);
      }
    };
    window.rimRestore = () => {
      R.render = original;
    };
    window.rimShot = async ({ c, bg, hide, trim, on = true }) => {
      backdrop = bg;
      without = hide;
      short = trim;
      await yavinDraw({ c, on, warmFrames: 3 });
      if (
        initial !== bounds() ||
        Math.abs(c[0] - g.view.x) > 0.01 ||
        Math.abs(c[1] - g.view.y) > 0.01 ||
        Math.abs(c[2] - g.view.dist) > 0.01
      )
        throw Error('Scenery changed the camera limits');
    };
    return {
      lo,
      hi,
      maximum,
      minPitch: (steps[0][1] * Math.PI) / 180,
      maxPitch: g.viewTilt(maximum),
      receipt: g.ground.userData.reviewedLandscape.outskirts
    };
  });
  const audit = {
    ...base.receipt,
    maximum: base.maximum,
    pivot: [...base.lo, ...base.hi],
    samples: [],
    skyline: [],
    boundsUnchanged: false
  };
  function diff(a, b, band, background) {
    let exposed = 0,
      tested = 0;
    const W = a.width,
      H = a.height;
    // Maximum zoom is near plan view. At the oblique camera reserve the top part of the
    // shot for the real sky; the central lower strip looks into nearby ground on this board.
    for (let y = Math.ceil(H * (band === 'maximum' ? 0.11 : 0.5)); y < H * 0.66; y++)
      for (let x = Math.ceil(W * 0.08); x < W * 0.92; x++) {
        const i = (y * W + x) * 4;
        tested++;
        if (
          background
            ? b.data[i + 1] - a.data[i + 1] > 24
            : Math.abs(b.data[i] - a.data[i]) + Math.abs(b.data[i + 1] - a.data[i + 1]) + Math.abs(b.data[i + 2] - a.data[i + 2]) > 12
        )
          exposed++;
      }
    return { exposed, tested };
  }
  try {
    for (const [j, view] of rimViews.entries()) {
      const dx = [0, 1, 1, 1, 0, -1, -1, -1][j],
        dy = [1, 1, 0, -1, -1, -1, 0, 1][j],
        axis = (i, s) => (s < 0 ? base.lo[i] : s > 0 ? base.hi[i] : (base.lo[i] + base.hi[i]) / 2);
      for (const band of ['maximum', 'oblique']) {
        const dist = band === 'maximum' ? base.maximum : 310,
          c = [axis(0, dx), axis(1, dy), dist, band === 'maximum' ? base.maxPitch : base.minPitch, Math.atan2(-dy, -dx)],
          stem = 'outskirts-' + view + '-' + band;
        async function shot(bg = null, { hide = false, on = true, trim = false, file } = {}) {
          await body.evaluate((_, a) => rimShot(a), { c, bg, hide, trim, on });
          return PNG.sync.read(await page.screenshot(file ? { path: path.join(out, file + '.png') } : {}));
        }
        const control = view === 'nw' && band === 'maximum';
        let prior, original;
        if (control) {
          original = await shot(null, { on: false, file: stem + '-original' });
          await shot(null, { hide: true, file: stem + '-previous' });
          prior = diff(await shot(0, { hide: true }), await shot(0x00ff60, { hide: true }), band, true).exposed;
        }
        const s = diff(await shot(0), await shot(0x00ff60), band, true);
        await shot(null, { file: stem });
        audit.samples.push({ view, band, dist, c: [...c], ...s });
        if (band === 'oblique') {
          // Try the command camera at minimum orbit pitch as well. Removing the entire
          // last strip must not change its skyline, even if sky and fog colours match.
          c[2] = base.maximum;
          c[3] = base.minPitch;
          const full = await shot(0x00ff60),
            cut = await shot(0x00ff60, { trim: true });
          let changed = 0;
          for (let y = 0; y < full.height * 0.68; y++)
            for (let x = 0; x < full.width; x++) {
              const i = (y * full.width + x) * 4;
              if (Math.abs(full.data[i + 1] - cut.data[i + 1]) > 20) changed++;
            }
          if (changed > 8) {
            const fs = require('node:fs');
            for (const [label, png] of [
              ['full', full],
              ['cut', cut]
            ])
              fs.writeFileSync(path.join(out, `skyline-${view}-${label}.png`), PNG.sync.write(png));
            console.warn('Visible outer strip:', view, changed);
          }
          audit.skyline.push({ view, changed });
        }
        if (control) {
          audit.control = { before: prior, after: s.exposed };
          audit.rollback = { changed: diff(original, await shot(null, { on: false, file: stem + '-restored' }), band, false).exposed };
        }
      }
    }
    audit.boundsUnchanged = true;
    return audit;
  } finally {
    await body.evaluate(() => {
      rimRestore();
      delete window.rimShot;
      delete window.rimRestore;
    });
  }
};
