// Sample the real land shadow and receiver passes through an active mounted map remaster. Use an
// isolated sloping patch, a boot-height solid and a leaf card with one transparent half;
// compare the same receiver pixels lit/shadowed rather than relying on absolute map colours.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const gl = process.env.LOOK_BACKEND === 'webgl';
const world = (process.env.LOOK_WORLD || 'endor').toLowerCase();
assert(['endor', 'hoth', 'tatooine', 'yavin'].includes(world));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 800, height: 500 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 500));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#' + world + (world === 'endor' ? '-ultra' : '-remaster'));
    const body = p.frameLocator('#game').locator('body');
    const results = await body.evaluate(
      async (_, { gl, world }) => {
        const tick = () => new Promise(requestAnimationFrame),
          until = performance.now() + (gl ? 180000 : 85000);
        while (!(window.game?.remasteredGround && game.world?.time > 0.1)) {
          const data = window.game?.ground?.userData,
            status = data?.endorLandscape || data?.reviewedLandscape;
          if (status?.state === 'unavailable' || performance.now() > until)
            throw Error(`No active remaster: ${status?.state} ${status?.reason || ''}`);
          await tick();
        }
        // The recipe activates during the frame; wait for transient overlays to follow it.
        await tick();
        await tick();
        if (game.shadows?.count) throw Error('Floating planar contact overlays still active');
        const g = game,
          R = g.gpuOn ? g.gpu : g.renderer;
        if (!!g.gpuOn === gl || R.isMirror) throw Error('Unexpected backend');
        g.modeSuspended = true;
        await tick();
        const links = [];
        if (gl) {
          R.debug.checkShaderErrors = true;
          const compile = R.compileAsync.bind(R);
          R.compileAsync = (...args) => {
            const linking = compile(...args);
            links.push(linking);
            return linking;
          };
        }
        const T = await import('three'),
          { lighting: L } = await import('/js/model.js'),
          { groveMaterial } = await import('/js/game/endor-grove.js'),
          { gfx } = await import('/js/gfx.js');
        const scene = new T.Scene(),
          receivers = new T.Scene(),
          cx = 1024,
          cy = 1024,
          slope = 0.18;
        const tex = bytes => {
          const t = new T.DataTexture(Uint8Array.from(bytes), bytes.length / 4, 1);
          t.needsUpdate = true;
          return t;
        };
        const white = tex([220, 220, 220, 255]),
          normal = tex([128, 128, 255, 255]),
          solid = groveMaterial(white, normal, false);
        // A coverage of 0.38 survives this foliage material's authored cutoff (0.34).
        // It must survive in the depth pass too, not just perfectly opaque leaves.
        const leaf = groveMaterial(tex([255, 255, 255, 97, 255, 255, 255, 0]), normal, true);
        leaf.defines.WIND_LEAVES = 1;
        leaf.depthWrite = false;
        function withBasis(geo) {
          const n = geo.attributes.position.count;
          for (const [name, v] of [
            ['tangent', [1, 0, 0]],
            ['binormal', [0, 1, 0]]
          ])
            geo.setAttribute(name, new T.Float32BufferAttribute(Array(n).fill(v).flat(), 3));
          return geo;
        }
        // Endor replacement trees batch bark and leaf submeshes in one instanced draw object.
        const cardGeo = withBasis(new T.PlaneGeometry(32, 12, 2, 1));
        cardGeo.addGroup(0, 6, 0);
        cardGeo.addGroup(6, 6, 1);
        const uv = cardGeo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2);
        cardGeo.setAttribute('instanceTint', new T.InstancedBufferAttribute(new Float32Array(4), 4));
        const boot = new T.Mesh(withBasis(new T.BoxGeometry(8, 8, 8)), solid),
          card = new T.InstancedMesh(cardGeo, [leaf, solid], 1);
        boot.position.set(cx, cy - 10, 4);
        card.position.set(cx + 24, cy + 10, 10 + 16 * slope);
        for (const o of [boot, card]) {
          o.userData.casts = true;
          scene.add(o);
        }
        const geo = withBasis(new T.PlaneGeometry(64, 64)),
          pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          pos.setXYZ(i, cx + x, cy + pos.getY(i), slope * x);
        }
        geo.computeVertexNormals();
        for (const [a, w] of [
          ['layers', 4],
          ['corner', 2],
          ['shade', 1]
        ])
          geo.setAttribute(a, new T.Float32BufferAttribute(new Float32Array(pos.count * w).fill(a === 'shade' ? 1 : 0), w));
        const ground = new T.Mesh(geo, g.ground.material);
        receivers.add(ground);
        const camera = new T.OrthographicCamera(-32, 32, 32, -32, 0.1, 200);
        camera.position.set(cx, cy, 100);
        camera.lookAt(cx, cy, 0);
        camera.updateMatrixWorld();
        // Use the play camera for map fitting, the overhead camera only for reading known world points.
        const view = new T.PerspectiveCamera(40, 1.6, 1, 2000);
        view.up.set(0, 0, 1);
        view.position.set(cx, cy - 300, 400);
        view.lookAt(cx, cy, 0);
        view.updateMatrixWorld();
        const gamePass = Object.assign(Object.create(Object.getPrototypeOf(g)), {
          scene,
          ground: g.ground,
          camera: view,
          renderer: g.renderer,
          gpu: g.gpu,
          gpuOn: g.gpuOn,
          fit() {},
          view: { x: cx, y: cy, dist: 500 },
          terrain: { size: 2, heights: [0, 0, 0, 0] },
          noShadow: g.noShadow
        });
        const W = 128,
          rt = new T.WebGLRenderTarget(W, W),
          U = ground.material.uniforms;
        L.fieldWind.value.set(0, 0, 0, 0);
        L.receiverMode.value.set(0, 0, 0, 0);
        L.fieldLook.value.set(0, 0, 0, 0);
        L.sunDir.value.set(0.6, 0, 0.8);
        L.sunColor.value.setRGB(0.9, 0.9, 0.9);
        L.fogRange.value.set(0, 0);
        L.ambient.value.setRGB(0.15, 0.15, 0.15);
        L.fillColor.value.setRGB(0, 0, 0);
        L.fillColor2.value.setRGB(0, 0, 0);
        U.clouds.value = white;
        U.fog.value = white;
        U.reliefPatch.value.set(0, 0, 0, 0);
        L.forestWeather.value.set(0, 0, 0, 0);
        L.landStyle.value.set(0, 0, 0, 0);
        gfx.shadows = true;
        gfx.shadow = 2;
        gfx.shadowRange = 8;
        const shot = async () => {
          R.setRenderTarget(rt);
          R.clear();
          R.render(receivers, camera);
          const a = new Uint8Array(W * W * 4);
          if (gl) R.readRenderTargetPixels(rt, 0, 0, W, W, a);
          else await R.readRenderTargetPixelsAsync(rt, 0, 0, W, W, a);
          R.setRenderTarget(null);
          return a;
        };
        const refresh = fine => {
          L.hullShadowParams.value.x = 0;
          L.hullShadowMap.value = g.noShadow;
          L.landGround.value.w = fine ? 1 : 0;
          gamePass.castShadows(fine);
        };
        const diff = (ref, im, x, y) => {
          const i = 4 * (Math.floor((y + 32) * 2) * W + Math.floor((x + 32) * 2));
          return Math.round((ref[i] - im[i] + ref[i + 1] - im[i + 1] + ref[i + 2] - im[i + 2]) / 3);
        };
        const out = [],
          face = new T.Mesh(geo, solid);
        face.userData.casts = true;
        scene.add(face);
        for (const fine of [false, true]) {
          L.sunDir.value.set(0.6, 0, 0.8);
          boot.visible = card.visible = true;
          face.visible = false;
          boot.position.y = cy - 10;
          L.receiverMode.value.y = +fine;
          // Settle any asynchronous material pipelines before testing a single moving frame.
          for (let i = 0; i < 8; i++) {
            refresh(fine);
            await shot();
            await R.settle?.();
            await tick();
            await Promise.all(links.splice(0));
          }
          for (const [receiver, mat] of [
            ['terrain', g.ground.material],
            ['model', solid]
          ]) {
            ground.material = mat;
            boot.position.y = cy - 10;
            if (gl) await R.compileAsync(receivers, camera);
            for (let i = 0; i < 4; i++) {
              refresh(fine);
              await shot();
              await R.settle?.();
            }
            const on = await shot();
            // A caster blocks the key, not the ambient sky. Keep the cast pass on
            // and move only the caster while rendering with zero solar radiance.
            const solar = L.sunColor.value.clone(), spec = L.sunSpecular.value.clone();
            L.sunColor.value.setRGB(0,0,0); L.sunSpecular.value.setRGB(0,0,0);
            const ambientOnly = await shot();
            boot.visible = false;
            refresh(fine);
            const ambientDelta = diff(await shot(), ambientOnly, -4, -10);
            L.sunColor.value.copy(solar); L.sunSpecular.value.copy(spec);
            boot.visible = true;
            gamePass.view.x += 0.001;
            view.position.x += 0.001;
            view.updateMatrixWorld();
            refresh(fine);
            const pan = await shot();
            gamePass.view.x -= 0.001;
            view.position.x -= 0.001;
            view.updateMatrixWorld();
            const steady = [
              [-4, -10],
              [3, 10],
              [12, 10],
              [23, 10]
            ].every(([x, y]) => Math.abs(diff(on, pan, x, y)) <= 1);
            L.shadowOn.value = 0;
            L.hullShadowParams.value.x = 0;
            L.landGround.value.w = fine ? 1 : 0;
            const lit = await shot();
            // Moving across the surface should move both ends of the footprint on this frame.
            let motion = true;
            for (let i = 0; i < 4; i++) {
              const prev = boot.position.y - cy,
                next = prev === -10 ? -22 : -10;
              boot.position.y = cy + next;
              refresh(fine);
              const moved = await shot();
              motion &&= diff(lit, moved, -4, next) > 3 && Math.abs(diff(lit, moved, -4, prev)) <= 2;
            }
            // At a low authored sun, a boot of height 8 projects ~28.5 units uphill.
            L.sunDir.value.set(-0.995, 0, 0.1).normalize();
            refresh(fine);
            const low = await shot();
            gfx.shadows = false;
            refresh(fine);
            if (L.shadowOn.value || gamePass.groundNear) throw Error('Shadows off still binds a cast map');
            const clear = await shot();
            gfx.shadows = true;
            boot.visible = card.visible = false;
            face.visible = true;
            refresh(fine);
            const self = await shot();
            let acne = 0;
            for (let y = -18; y <= 18; y++) for (let x = -18; x <= 18; x++) acne = Math.max(acne, diff(clear, self, x, y));
            out.push({
              fine,
              receiver,
              solid: diff(lit, on, -4, -10),
              leaf: diff(lit, on, 3, 10),
              hole: diff(lit, on, 12, 10),
              bark: diff(lit, on, 23, 10),
              motion,
              steady,
              ambientDelta,
              lowSun: diff(clear, low, 24, -10),
              acne
            });
            L.sunDir.value.set(0.6, 0, 0.8);
            boot.visible = card.visible = true;
            face.visible = false;
          }
        }
        // Switch the actual attached recipe off and back on without changing the map.
        const option = world + 'Landscape';
        gfx[option] = false;
        g.ground.userData.landscape(g);
        refresh(true);
        if (gamePass.remasteredGround || L.landGround.value.w !== 2) throw Error('Original shadow mode not restored');
        gfx[option] = true;
        g.ground.userData.landscape(g);
        refresh(true);
        if (!gamePass.remasteredGround || L.landGround.value.w !== 3) throw Error('Remastered shadow mode not restored');
        return out;
      },
      { gl, world }
    );
    console.log(world, gl ? 'WebGL' : 'WebGPU');
    console.table(results);
    assert.deepEqual(errors, []);
    for (const r of results) {
      assert(
        r.solid > 3 && r.leaf > 3 && Math.abs(r.hole) <= 2 && r.bark > 3 && r.motion && r.steady && Math.abs(r.ambientDelta) <= 2 && r.lowSun > 3 && r.acne <= 2,
        `Misplaced or missing footprint: ${JSON.stringify(r)}`
      );
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
