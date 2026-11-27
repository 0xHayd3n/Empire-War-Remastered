// Live integration check for public/js/game/endor-plants.js.
//
//   LOOK_BACKEND=webgl node tools/check-endor-plants.cjs
//   LOOK_BACKEND=webgpu node tools/check-endor-plants.cjs
//
// It loads the current Universal checkout at http://127.0.0.1:8590/ and routes
// only the new module and new art files from this worktree. The original
// checkout is never modified. Screenshots and JSON evidence stay outside the
// repository under $ENDOR_PLANTS_EVIDENCE or <tmpdir>/endor-plants-evidence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'public/js/game/endor-plants.js');
const ART = path.join(ROOT, 'public/art/endor-plants');
const OUT = process.env.ENDOR_PLANTS_EVIDENCE || path.join(os.tmpdir(), 'endor-plants-evidence');
const URL_GAME = process.env.ENDOR_PLANTS_URL || 'http://127.0.0.1:8590/';
const BACKEND = (process.env.LOOK_BACKEND || 'webgpu').toLowerCase();
const PW = process.env.PLAYWRIGHT_CORE || 'C:/Coding/Ebez/node_modules/playwright-core';
const { chromium } = require(PW);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pixels(buf) {
  const { decodePNG } = await import('../public/js/png.js');
  const png = await decodePNG(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  if (!png) throw new Error('screenshot not decodable');
  return png;
}
async function diff(a, b) {
  const A = await pixels(a),
    B = await pixels(b);
  if (A.width !== B.width || A.height !== B.height) return { pixels: A.width * A.height, mean: 255 };
  let sum = 0;
  for (let i = 0; i < A.data.length; i += 4)
    sum += Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
  return { pixels: A.width * A.height, width: A.width, height: A.height, mean: sum / (A.width * A.height * 3) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.setDefaultTimeout(120000);
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
      const text = m.text();
      if (/GPUValidationError|Error while validating|Error while parsing WGSL|Shader Error|INVALID_OPERATION|WebGL: INVALID/i.test(text))
        errors.push('console: ' + text.slice(0, 500));
    });
    await page.route('**/js/game/endor-plants.js', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(MODULE) })
    );
    await page.route('**/art/endor-plants/*', route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const file = path.join(ART, name);
      if (!/^[a-z0-9.-]+$/i.test(name) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(file) });
    });
    if (BACKEND !== 'webgpu') await page.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));

    await page.goto(URL_GAME);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="TITLE_PLAY"]:visible').click();
    await f.locator('[data-id="IDC_INSTANT_BATTLE_BUTTON"]:visible').click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Endor');
    await board.locator('[data-world="Endor"][data-domain="land"][data-source="stock"]').first().click();
    await f.locator('.op-setup[data-profile="stock"] .op-go:enabled').click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });

    const body = f.locator('body');
    const flags = {
      unlit: !!process.env.ENDOR_TEST_UNLIT,
      nocolor: !!process.env.ENDOR_TEST_NOCOLOR,
      nomip: !!process.env.ENDOR_TEST_NOMIP,
      debugMat: !!process.env.ENDOR_TEST_DEBUG_MAT,
      debugGeom: process.env.ENDOR_TEST_DEBUG_GEOM || ''
    };
    const setup = await body.evaluate(async flags => {
      Object.assign(window, {
        __endorPlantsUnlit: flags.unlit ? 1 : 0,
        __endorPlantsNoColor: flags.nocolor ? 1 : 0,
        __endorPlantsNoMip: flags.nomip ? 1 : 0,
        __ENDOR_TEST_DEBUG_MAT: flags.debugMat,
        __ENDOR_TEST_DEBUG_GEOM: flags.debugGeom
      });
      const wait = () => new Promise(requestAnimationFrame);
      const deadline = performance.now() + 120000;
      while (!(window.game?.world?.time > 0.6 && game.ground)) {
        if (performance.now() > deadline) throw new Error('No Endor battle');
        await wait();
      }
      const g = game;
      // Put the camera on a dense authored evergreen patch.
      const trees = g.map.objects.filter(o => /^W_Tree_Ever_(00|01)_HI/i.test(o.type?.str('Land_Model_Name') || ''));
      const base = trees[Math.floor(trees.length / 2)] || g.map.objects[0];
      g.view.x = base.pos[0];
      g.view.y = base.pos[1];
      g.view.dist = 245;
      g.view.pitch = 52 * Math.PI / 180;
      for (let i = 0; i < 24; i++) await wait();
      const THREE = await import('three');
      const cam = g.camera;
      const proj = new THREE.Vector3(base.pos[0], base.pos[1], 20).project(cam);
      const cameraAtSetup = { pos: cam.position.toArray(), view: { ...g.view }, target: base.pos.slice(), screen: [proj.x, proj.y, proj.z] };
      if (globalThis.__ENDOR_TEST_UNLIT) window.__endorPlantsUnlit = 1;
      if (globalThis.__ENDOR_TEST_NOCOLOR) window.__endorPlantsNoColor = 1;
      if (globalThis.__ENDOR_TEST_DEBUG_MAT) window.__ENDOR_TEST_DEBUG_MAT = 1;
      if (globalThis.__ENDOR_TEST_NOMIP) window.__endorPlantsNoMip = 1;
      if (globalThis.__ENDOR_TEST_DEBUG_GEOM) window.__ENDOR_TEST_DEBUG_GEOM = globalThis.__ENDOR_TEST_DEBUG_GEOM;
      const mod = await import('/js/game/endor-plants.js');
      const handle = await mod.prepareEndorPlants(g);
      window.__endorPlants = handle;
      return {
        backend: handle.stats.backend,
        gpuOn: !!g.gpuOn,
        renderer: g.renderer?.constructor?.name || '',
        stats: JSON.parse(JSON.stringify(handle.stats)),
        targetTree: base.pos.slice(),
        camera: cameraAtSetup
      };
    }, flags);

    if (process.env.ENDOR_TEST_TEXTURE) {
      const tex = await body.evaluate(async () => {
        const THREE = await import('three');
        const h = window.__endorPlants;
        const cam = game.camera;
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        const m = globalThis.__ENDOR_TEST_DEBUG_MAT
          ? h.materials[0]
          : new THREE.MeshBasicMaterial({ map: h.textures.atlas, side: THREE.DoubleSide, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), m);
        const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
        if (globalThis.__ENDOR_TEST_DEBUG_GEOM) {
          mesh.geometry.dispose();
          mesh.geometry = new THREE.PlaneGeometry(40, 40);
          mesh.position.copy(cam.position).addScaledVector(dir, 60).addScaledVector(right, 55).add(new THREE.Vector3(0, 0, 20));
        } else mesh.position.copy(cam.position).addScaledVector(dir, 70);
        mesh.lookAt(cam.position);
        mesh.frustumCulled = false;
        mesh.renderOrder = 999;
        if (!globalThis.__ENDOR_TEST_DEBUG_GEOM) game.scene.add(mesh);
        window.__endorDebugMesh = mesh;
        if (globalThis.__ENDOR_TEST_DEBUG_GEOM) {
          const dm = globalThis.__ENDOR_TEST_DEBUG_GEOM === 'basic'
            ? new THREE.MeshBasicMaterial({ map: h.textures.atlas, side: THREE.DoubleSide, transparent: true, depthWrite: false })
            : h.materials[0];
          const part = h.batches[0].parts.find(x => x.kind === 'leaf') || h.batches[0].parts[0];
          const gm = new THREE.Mesh(part.geoNear, dm);
          gm.position.set(game.view.x, game.view.y, 80);
          gm.scale.setScalar(1.5);
          gm.frustumCulled = false;
          gm.renderOrder = 998;
          game.scene.add(gm);
          window.__endorDebugGeom = gm;
        }
        return { pos: mesh.position.toArray(), dir: dir.toArray() };
      });
      await sleep(500);
      await page.screenshot({ path: path.join(OUT, `endor-plants-${BACKEND}-texture.png`) });
      console.log('debug texture plane', tex);
    }

    // First visible frame with the new material. WebGPU compiles pipelines
    // asynchronously on first sight, so give it a few real frames.
    await body.evaluate(() => window.__endorPlants.set(true));
    await sleep(1400);
    await body.evaluate(() => new Promise(requestAnimationFrame));
    await sleep(300);
    const shotOn = await page.screenshot({ path: path.join(OUT, `endor-plants-${BACKEND}-on.png`) });

    const on = await body.evaluate(() => {
      const h = window.__endorPlants,
        g = game;
      const stats = JSON.parse(JSON.stringify(h.stats));
      const ims = h.group.children.filter(o => o.isInstancedMesh);
      const visible = ims.filter(o => o.visible && o.count > 0);
      const keys = new Set(h.stats.classes.map(c => c.model.toUpperCase()));
      const modelKey = o => String(o.type?.str?.('Land_Model_Name') || '').toUpperCase().replace(/^.*[\\/]/, '').replace(/\.(?:ALO|ALA)$/, '');
      const positions = (g.map.objects || []).filter(o => keys.has(modelKey(o))).map(o => o.pos);
      let targetProps = 0,
        hiddenMeshes = 0,
        visibleMeshes = 0;
      for (const p of g.props || []) {
        if (!p.inst?.model) continue;
        // Match only props at an authored replacement position; this excludes
        // crates, rocks and markers that may sit beside a tree.
        const at = positions.some(a => Math.abs((a?.[0] || 0) - p.grp.position.x) < 0.08 && Math.abs((a?.[1] || 0) - p.grp.position.y) < 0.08);
        if (!at) continue;
        targetProps++;
        p.grp.traverse(o => {
          if (!o.isMesh) return;
          if (o.visible) visibleMeshes++;
          else hiddenMeshes++;
        });
      }
      window.__endorOrig = { targetProps, hiddenMeshes, visibleMeshes };
      const dbgMat = h.materials?.[0];
      const dbgImg = dbgMat?.uniforms?.map?.value?.image;
      let sample = null;
      if (dbgImg?.data) {
        for (let i = 0; i < dbgImg.data.length; i += 4) {
          if (dbgImg.data[i + 3] > 240 && dbgImg.data[i] + dbgImg.data[i + 1] + dbgImg.data[i + 2] > 0) {
            sample = [dbgImg.data[i], dbgImg.data[i + 1], dbgImg.data[i + 2], dbgImg.data[i + 3]];
            break;
          }
        }
      }
      const dbgGeo = ims.find(o => o.isInstancedMesh)?.geometry;
      return {
        debug: dbgMat ? {
          defines: { ...dbgMat.defines },
          image: dbgImg ? [dbgImg.width, dbgImg.height, dbgImg.data?.length] : null,
          sample,
          colorAttr: dbgGeo ? Array.from(dbgGeo.attributes.color.array.slice(0, 12)) : null,
          diffuse: dbgMat.uniforms.diffuse.value.toArray(),
          tint: dbgMat.uniforms.tint.value.toArray(),
          ambient: dbgMat.uniforms.ambient?.value?.toArray?.(),
          sun: dbgMat.uniforms.sunColor?.value?.toArray?.(),
          alphaRef: dbgMat.uniforms.alphaRef.value
        } : null,
        stats,
        group: {
          inScene: h.group.parent === g.scene,
          visible: h.group.visible,
          children: ims.length,
          visibleBatches: visible.length,
          counts: visible.map(o => o.count),
          geometries: visible.map(o => ({
            vertices: o.geometry.attributes.position.count,
            triangles: (o.geometry.index?.count || 0) / 3,
            zExtent:
              o.geometry.boundingBox.max.z - o.geometry.boundingBox.min.z
          }))
        },
        originals: { targetProps, hiddenMeshes, visibleMeshes },
        scene: { sceneChildren: g.scene.children.length, batchedPools: g.batches?.list?.length || 0 },
        camera: { pos: g.camera.position.toArray(), target: window.__endorTarget }
      };
    });

    assert.equal(setup.gpuOn, BACKEND === 'webgpu', `renderer is ${setup.gpuOn ? 'webgpu' : 'webgl'}, wanted ${BACKEND}`);
    assert.equal(on.stats.on, true, 'set(true) did not report on');
    assert.equal(on.stats.ok, true, 'prepare did not succeed: ' + on.stats.reason);
    assert(on.stats.targets > 100, 'too few authored Endor vegetation targets: ' + on.stats.targets);
    assert(on.stats.replaced === on.stats.targets, 'not every target got a replacement');
    assert(on.stats.hiddenOriginals > 100, 'stock props were not hidden: ' + on.stats.hiddenOriginals);
    assert(on.stats.drawCalls > 0 && on.group.visibleBatches > 0, 'no plant batches are visible');
    assert(on.stats.triangles > 10000, 'the replacement is too sparse: ' + on.stats.triangles);
    assert(on.group.inScene && on.group.visible, 'plant group is not in the scene');
    assert.equal(
      on.group.children,
      on.stats.classes.reduce((n, c) => n + (c.parts?.length || 0) * 2, 0),
      'expected one near+far mesh per bark/leaf part'
    );
    assert(on.group.geometries.every(g => g.vertices > 12 && g.triangles > 4 && g.zExtent > 0.5), 'a visible LOD is not genuinely 3D');
    assert(on.originals.hiddenMeshes > 0, 'no original prop mesh is hidden');
    assert.equal(on.originals.visibleMeshes, 0, 'an original target mesh is still visible');
    assert.deepEqual(errors, [], 'renderer errors: ' + errors.join('\n'));

    const off = await body.evaluate(async () => {
      const h = window.__endorPlants;
      h.set(false);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const visible = h.group.children.filter(o => o.isInstancedMesh && o.visible && o.count).length;
      let hidden = 0,
        shown = 0;
      for (const p of game.props || []) p.grp.traverse(o => { if (o.isMesh) { if (o.visible) shown++; else hidden++; } });
      return { stats: JSON.parse(JSON.stringify(h.stats)), groupVisible: h.group.visible, visible, hiddenMeshes: hidden, visibleMeshes: shown };
    });
    await sleep(500);
    const shotOff = await page.screenshot({ path: path.join(OUT, `endor-plants-${BACKEND}-off.png`) });
    assert.equal(off.stats.on, false, 'set(false) did not report off');
    assert.equal(off.groupVisible, false, 'plant group stayed visible after set(false)');
    assert.equal(off.visible, 0, 'plant batch stayed visible after set(false)');
    assert.equal(off.stats.hiddenOriginals, 0, 'originals were not restored');
    assert(off.visibleMeshes > 0, 'no original prop mesh came back after set(false)');
    const imageDiff = await diff(shotOn, shotOff);
    assert(imageDiff.mean > 0.4, 'on/off screenshots are effectively identical (mean ' + imageDiff.mean + ')');

    // Toggle back on and confirm it is still a reversible, synchronous switch.
    const again = await body.evaluate(() => {
      const h = window.__endorPlants;
      h.set(true);
      return { on: h.stats.on, hidden: h.stats.hiddenOriginals, visible: h.group.children.filter(o => o.isInstancedMesh && o.visible && o.count).length };
    });
    assert.equal(again.on, true);
    assert(again.hidden > 100);
    assert(again.visible > 0);

    const evidence = {
      pass: true,
      backend: BACKEND,
      url: URL_GAME,
      module: MODULE,
      art: ART,
      setup,
      on,
      off: { stats: off.stats, groupVisible: off.groupVisible, visibleBatches: off.visible, hiddenMeshes: off.hiddenMeshes },
      again,
      imageDiff,
      screenshots: {
        on: path.join(OUT, `endor-plants-${BACKEND}-on.png`),
        off: path.join(OUT, `endor-plants-${BACKEND}-off.png`)
      },
      errors
    };
    fs.writeFileSync(path.join(OUT, `endor-plants-${BACKEND}.json`), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ pass: true, backend: BACKEND, stats: on.stats, originals: on.originals, group: on.group, imageDiff, screenshots: evidence.screenshots }, null, 1));
    console.log(`PASS: ${BACKEND} Endor plants replaced in the live battle; evidence in ${OUT}`);
  } catch (e) {
    const evidence = { pass: false, backend: BACKEND, errors, message: e?.stack || String(e) };
    try {
      fs.writeFileSync(path.join(OUT, `endor-plants-${BACKEND}-failed.json`), JSON.stringify(evidence, null, 2));
    } catch {}
    console.error(e);
    console.error('evidence:', OUT);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
