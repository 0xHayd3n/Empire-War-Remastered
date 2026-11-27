// Real colour receivers in the western deployment meadow, with the herb draw unchanged.
// Isolate the old footprint by changing ONLY grass caster materials during the two sun passes.
const { chromium } = require('playwright-core'),
  { PNG } = require('pngjs'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl',
  out = process.env.LOOK_OUT;
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 740 } }),
      errors = [];
    if (out) fs.mkdirSync(out, { recursive: true });
    await page.addInitScript(() => {
      let s = 76119;
      Math.random = () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296;
    });
    if (gl) await page.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (validating|parsing WGSL)/i.test(m.text())) errors.push(m.text());
    });
    await page.goto('http://127.0.0.1:8590/#naboo-remaster');
    const body = page.frameLocator('#game').locator('body');
    const receipt = await body.evaluate(async () => {
      const tick = () => new Promise(requestAnimationFrame),
        end = performance.now() + 120000;
      while (!(window.game?.remasteredGround && game.world.time > 1 && game.batches)) {
        if (performance.now() > end) throw Error('Naboo not ready');
        await tick();
      }
      const g = game;
      g.modeSuspended = true;
      await tick();
      const { gfx } = await import('/js/gfx.js'),
        { leafShadowMaterial } = await import('/js/model.js');
      const skins = new Set(),
        trees = new Set();
      for (const p of g.props)
        if (/GRNDCVR|TREE_/i.test(p.modelFile))
          p.grp.traverse(m => {
            if (m.isMesh) (/GRNDCVR/i.test(p.modelFile) ? skins : trees).add(m.material.uniforms?.map?.value);
          });
      let state = 'current';
      const cast = g.castShadows;
      g.castShadows = function (...args) {
        const hidden = [],
          swaps = new Map();
        if (state === 'off')
          for (const o of g.scene.children) {
            if (o.visible && o.userData.casts) {
              hidden.push(o);
              o.visible = false;
            }
          }
        if (state === 'legacy' || state === 'without')
          g.scene.traverseVisible(m => {
            const mat = m.material;
            if (!skins.has(mat?.uniforms?.map?.value)) return;
            if (state === 'without') {
              m.visible = false;
              hidden.push(m);
              return;
            }
            const d = leafShadowMaterial(mat);
            // Emulate the old hard cut for this caster only. Change the source's
            // state, not the uniform object GL cached at link time. Both the old
            // and new shadow *twins* already write depth, independent of the source.
            if (d && !swaps.has(mat)) {
              swaps.set(mat, mat.depthWrite);
              mat.depthWrite = true;
            }
          });
        try {
          return cast.apply(this, args);
        } finally {
          for (const m of hidden) m.visible = true;
          for (const [mat, v] of swaps) mat.depthWrite = v;
        }
      };
      Object.assign(g.view, { x: 1395, y: 3627, dist: 470, pitch: 0.96, yaw: -1.5 });
      window.nabooFrame = async (name, sky) => {
        const e = g.map.environments.find(e => e.name === sky);
        if (g.map.environment !== e) await g.applyEnvironment(e);
        state = name;
        gfx.shadows = true;
        for (let i = 0; i < 16; i++) {
          g.warming = true;
          g.modeSuspended = false;
          try {
            g.frame(g.last);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
          await tick();
        }
        await g.gpu?.settle?.();
      };
      return { gpu: !!g.gpuOn, herbs: skins.size, trees: trees.size };
    });
    assert.equal(receipt.gpu, !gl);
    assert(receipt.herbs && receipt.trees);
    for (const sky of ['Noon_Clear', 'Sunrise_Clear']) {
      await body.evaluate((_, sky) => window.nabooFrame('current', sky), sky);
      const frames = {};
      for (const mode of ['legacy', 'without', 'current', 'off']) {
        await body.evaluate((_, args) => window.nabooFrame(...args), [mode, sky]);
        frames[mode] = PNG.sync.read(await page.screenshot(out ? { path: path.join(out, `${sky}-${mode}.png`) } : {}));
      }
      let legacy = 0,
        current = 0,
        remaining = 0,
        other = 0,
        total = 0;
      for (let y = 45; y < 560; y++)
        for (let x = 45; x < 1230; x++) {
          const i = (y * 1280 + x) * 4,
            luma = k => {
              const a = frames[k].data;
              return 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
            };
          const uncast = luma('without'),
            old = uncast - luma('legacy'),
            now = uncast - luma('current');
          if (old > 15) {
            legacy += old;
            current += Math.max(0, now);
            if (now > 10) remaining++;
            total++;
          }
          // Controls outside the legacy herb footprint still darken when the
          // other casters return (the sun, post and visible meshes never change).
          else if (Math.abs(old) < 3 && luma('off') - uncast > 15 && luma('off') - luma('current') > 15) other++;
        }
      const ratio = current / legacy;
      console.log(
        sky,
        JSON.stringify({
          backend: gl ? 'webgl' : 'webgpu',
          legacyPixels: total,
          retainedPixels: remaining,
          relativeDarkening: ratio,
          otherShadowPixels: other
        })
      );
      assert(total > 800, 'Not looking at the legacy striped meadow');
      assert(ratio < 0.65, 'Faint plant texels still cast nearly solid strips');
      assert(remaining > 100 && ratio > 0.015, 'Groundcover lost its entire shadow');
      assert(other > 500, 'Non-grass shadows did not survive');
    }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
