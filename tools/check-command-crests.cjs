// Inspect every focused insignia in the real Universal stage. A doubled image
// plane or a shiny rectangular slab is not a three-dimensional faction seal.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1120, height: 740 } });
    await page.addInitScript({ content: 'window.checkFacePixels = ' + require('./check-command-face-pixels.cjs').toString() });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    const board = f.locator('[data-universal-screen="skirmish"]');
    await board.evaluate(async () => {
      const { CommandRing } = await import('/js/game/commandring.js'),
        set = CommandRing.prototype.set;
      CommandRing.prototype.set = function (...args) {
        window.testSeals = this;
        CommandRing.prototype.set = set;
        return set.apply(this, args);
      };
    });
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.locator('[data-choose-seat="0"]').click();
    const stage = board.locator('.op-command-stage[data-ready="true"]');
    await stage.waitFor();
    const result = await stage.evaluate(async el => {
      const r = window.testSeals,
        { WebGLRenderTarget, OrthographicCamera, Scene, Mesh } = await import('three'),
        target = new WebGLRenderTarget(140, 140, { samples: 0 }),
        cam = new OrthographicCamera(-0.61, 0.61, 0.61, -0.61, 0.1, 10);
      cam.position.z = 4;
      const scene = new Scene(),
        W = 140,
        H = 163,
        sheet = document.createElement('canvas');
      sheet.width = W * 8;
      sheet.height = H * Math.ceil(r.rows.length / 8);
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#17212b';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      // Sample the actual reference face and projector mask as rasterized by
      // this browser. A logo merely loading does not prove its carrier is gone.
      const { referenceSvg } = await import('/js/game/crestrefs.js');
      for (const [key, points] of [
        [
          'banking',
          [
            [0.5, 0.5, 1, 1],
            [0.5, 0.12, 1, 1],
            [0.12, 0.5, 1, 1],
            [0.88, 0.5, 1, 1],
            [0.5, 0.88, 1, 1],
            [0.7455, 0.5, 0, 0],
            [0.2, 0.2, 0, 0]
          ]
        ],
        [
          'techno',
          [
            [0.1, 0.28, 1, 0],
            [0.501, 0.43, 1, 0],
            [0.17, 0.45, 1, 1],
            [0.46, 0.42, 1, 1],
            [0.21, 0.75, 1, 1],
            [0.5, 0.84, 1, 1],
            [0.02, 0.02, 0, 0]
          ]
        ]
      ])
        for (const mask of [false, true]) {
          const im = new Image();
          im.src = 'data:image/svg+xml,' + encodeURIComponent(referenceSvg(key, mask));
          await im.decode();
          const cv = document.createElement('canvas');
          cv.width = cv.height = 1024;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(im, 0, 0);
          for (const [x, y, flat, solid] of points) {
            const a = cx.getImageData(Math.floor(1024 * x), Math.floor(1024 * y), 1, 1).data[3];
            if (a > 127 !== !!(mask ? solid : flat)) throw Error(`${key} ${mask ? 'mask' : 'face'} coverage at ${x},${y}: ${a}`);
          }
        }
      const out = [];
      let float = 0,
        turn = 0;
      for (let i = 0; i < r.rows.length; i++) {
        const h = r.hologram.mesh,
          row = r.focus,
          end = performance.now() + 10000;
        const crest = el.querySelector('.op-family-current .uc-crest'),
          art = row.p.skirmishEmblems?.[row.id];
        // One header family, one crest: the directory replaced the three-step rail.
        if (el.querySelectorAll('.op-family-current .uc-crest').length !== 1)
          throw Error(row.key + ' must show exactly one header crest');
        if (el.querySelectorAll('.op-faction-rail .uc-crest').length !== 1)
          throw Error(row.key + ' rail must hold the single header crest');
        if (el.querySelector('.op-family-current strong')?.textContent !== row.heading)
          throw Error(row.key + ' header must name ' + row.heading);
        if (getComputedStyle(crest).visibility !== 'visible' || crest.getAnimations().length)
          throw Error(row.key + ' rail must be visible and still');
        if (art) {
          await crest.decode();
          if (crest.getAttribute('src') !== art.hd || crest.naturalWidth < 1024) throw Error(row.key + ' not a decoded HD remaster');
        } else if (crest.dataset.crestKind !== 'standard') throw Error(row.key + ' borrowed an emblem');
        while (h.userData.seat !== row.key && performance.now() < end) await new Promise(requestAnimationFrame);
        const part = h.children[0];
        if (!part || h.userData.seat !== row.key) throw Error(row.key + ' absent');
        const tint = '#' + part.material.uniforms.tint.value.getHexString(),
          gradient = el.querySelector('.op-ring-layer.is-on').style.getPropertyValue('--command-color');
        const expectedFaction = row.p.facts[row.id].color;
        await window.checkFacePixels(el, row.key, expectedFaction);
        if (tint !== expectedFaction.toLowerCase() || gradient.trim().toLowerCase() !== expectedFaction.toLowerCase())
          throw Error(`${row.key} wrong projector ink or faction gradient: ${tint} / ${gradient}`);
        const g = part.geometry;
        g.computeBoundingBox();
        const z = g.boundingBox.max.z - g.boundingBox.min.z,
          normal = g.attributes.normal.array;
        let sides = 0;
        for (let k = 2; k < normal.length; k += 3) if (Math.abs(normal[k]) < 0.15) sides++;
        const specimen = new Mesh(g, part.material);
        scene.add(specimen);
        const gl = r.gl,
          old = gl.getRenderTarget();
        gl.setRenderTarget(target);
        function sample(angle) {
          specimen.rotation.y = angle;
          gl.setRenderTarget(null);
          gl.setRenderTarget(target);
          gl.render(scene, cam);
          const px = new Uint8Array(140 * 140 * 4);
          gl.readRenderTargetPixels(target, 0, 0, 140, 140, px);
          let on = 0,
            left = 140,
            right = 0;
          for (let k = 3; k < px.length; k += 4)
            if (px[k] > 40) {
              on++;
              const x = ((k - 3) / 4) % 140;
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          return { px, on, width: right - left + 1 };
        }
        const front = sample(0.34),
          edge = sample(Math.PI / 2);
        gl.setRenderTarget(old);
        specimen.removeFromParent();
        const img = ctx.createImageData(140, 140);
        for (let y = 0; y < 140; y++) img.data.set(front.px.subarray((139 - y) * 560, (140 - y) * 560), y * 560);
        const x = (i % 8) * W,
          y = Math.floor(i / 8) * H,
          cell = document.createElement('canvas');
        cell.width = cell.height = 140;
        cell.getContext('2d').putImageData(img, 0, 0);
        ctx.drawImage(cell, x + 50, y + 42, 88, 88);
        if (art) ctx.drawImage(crest, x + 1, y + 1, 85, 85);
        ctx.fillStyle = '#ecf0f0';
        ctx.font = '11px sans-serif';
        ctx.fillText(row.c.name, x + 2, y + 148, 136);
        ctx.fillText(row.family, x + 2, y + 161, 136);
        out.push({ key: row.key, z, sides, front: front.on, edge: edge.on, widthRatio: edge.width / front.width });
        if (!i) {
          const az = h.rotation.z;
          let lo = h.position.z,
            hi = lo;
          const end = performance.now() + 4000;
          while (performance.now() < end && (hi - lo < 0.0015 || Math.abs(h.rotation.z - az) < 0.04)) {
            await new Promise(requestAnimationFrame);
            lo = Math.min(lo, h.position.z);
            hi = Math.max(hi, h.position.z);
          }
          float = hi - lo;
          turn = Math.abs(h.rotation.z - az);
        }
        el.querySelector('.op-ring-next').click();
      }
      target.dispose();
      return { out, float, turn, png: sheet.toDataURL().split(',')[1] };
    });
    const bad = result.out.filter(q => q.z < 0.06 || q.sides < 9 || q.front < 70 || q.edge < 36 || q.widthRatio > 0.8);
    if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, 'solid-seals.png'), Buffer.from(result.png, 'base64'));
    console.log('Solid crest checks:', { tested: result.out.length, bad, hover: result.float, turn: result.turn });
    assert(result.out.length > 0 && new Set(result.out.map(q => q.key)).size === result.out.length, 'traversed distinct installed choices');
    assert(!bad.length && result.float > 0.001 && result.turn > 0.01);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await board.locator('.op-command-stage[data-motion="held"]').waitFor();
    const pose = () =>
      board.evaluate(() => {
        const m = testSeals.hologram.mesh;
        return [m.rotation.z, m.position.z];
      });
    const held = await pose();
    await page.waitForTimeout(250);
    assert.deepEqual(await pose(), held);
    const rail = board.locator('.op-faction-rail .uc-crest');
    assert.equal(await rail.count(), 1, 'the rail holds only the current family crest');
    // The header is static artwork, not another viewport. It survives GPU loss.
    const railPixels = () =>
      rail.evaluateAll(els =>
        els.map(
          el =>
            getComputedStyle(el).visibility === 'visible' &&
            !el.getAnimations().length &&
            el.getBoundingClientRect().bottom <= testSeals.gl.domElement.getBoundingClientRect().top &&
            (el.tagName !== 'IMG' || el.naturalWidth >= 1024)
        )
      );
    assert.deepEqual(await railPixels(), [true]);
    if (process.env.SHOTS) await stage.screenshot({ path: path.join(process.env.SHOTS, 'solid-emblems-carousel.png') });
    await stage.evaluate(() => {
      const ext = window.testSeals.gl.getContext().getExtension('WEBGL_lose_context');
      window.restoreCrests = () => ext.restoreContext();
      ext.loseContext();
    });
    await board.getByText(/Graphics interrupted/).waitFor();
    assert.deepEqual(await railPixels(), [true]);
    await board.evaluate(() => window.restoreCrests());
    await stage.waitFor();
    assert.deepEqual(await railPixels(), [true]);
    const search = stage.getByRole('searchbox');
    await search.fill('Independent Forces');
    const standard = stage.locator('.op-family-current [data-standard="open-orbit"]');
    await standard.waitFor();
    assert.match(await standard.locator('title').textContent(), /Universal neutral standard/);
    if (process.env.SHOTS) await stage.screenshot({ path: path.join(process.env.SHOTS, 'independent-standard.png') });
    // A missing HD rendition reconstructs the same seat's stencil and cutouts.
    await search.fill('');
    await stage.evaluate(() => {
      const row = testSeals.rows.find(r => r.c.name === 'Kayn Somos');
      row.p.skirmishEmblems[row.id].hd = '/api/universal/emblems/test-missing.svg';
    });
    await search.fill('Kayn Somos');
    const fallback = stage.locator('.op-family-current img[src^="data:image/svg+xml"]');
    await fallback.waitFor();
    await stage.evaluate(el=>window.checkFacePixels(el,testSeals.focus.key,testSeals.focus.p.facts[testSeals.focus.id].color));
    console.log('Static HD rail, faction-matched projection, context restoration, neutral standard and same-pack image fallback verified.');
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
