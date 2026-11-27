// Stock, mounted Universal. Flip one environment setting on a frozen game camera, then restore its pixels.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const gl = process.env.LOOK_BACKEND === 'webgl',
  domain = process.env.WORLD_CASE || 'land';
const out = path.resolve(process.env.LOOK_SHOTS || 'tools/baselines/worlds', gl ? 'webgl' : 'webgpu');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1100, height: 720 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => bad.push(e.message));
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION/i.test(
          m.text()
        )
      )
        bad.push(m.text().slice(0, 1000));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      body = f.locator('body'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true });
    const settings = async () => {
      await f.getByRole('button', { name: 'System menu' }).click();
      await f.getByRole('button', { name: 'Settings', exact: true }).click();
      await s.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
    };
    const terrain = s.getByRole('slider', { name: 'Terrain layering' }),
      air = s.getByRole('slider', { name: 'Orbital atmosphere' });
    await settings();
    assert.equal(await terrain.inputValue(), '0');
    assert.equal(await air.inputValue(), '0');
    await terrain.fill('0.8');
    await air.fill('0.9');
    await p.reload();
    await settings();
    assert.equal(await terrain.inputValue(), '0.8');
    assert.equal(await air.inputValue(), '0.9');
    assert.equal(await s.getByLabel('Battlefield look').inputValue(), 'original');
    await terrain.focus();
    await p.screenshot({ path: path.join(out, 'settings.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await air.focus();
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    await p.screenshot({ path: path.join(out, 'settings-narrow.png') });
    await p.setViewportSize({ width: 1100, height: 720 });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await f.locator('.title-menu [data-id="TITLE_PLAY"]').click();
    if (domain === 'galaxy') {
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const b = f.locator('.uc-atlas');
      await b
        .getByRole('button', { name: /Equal Footing/ })
        .first()
        .click();
      await b.getByRole('tab', { name: 'Faction', exact: true }).click();
      await b.locator('[data-field="faction"] input[value="Rebel"]').check();
      await b.locator('.uc-start').click();
    } else {
      await f.locator('.title-menu [data-id="IDC_INSTANT_BATTLE_BUTTON"]').click();
      const board = f.locator('.op-setup'),
        world = process.env.LOOK_WORLD || (domain === 'land' ? 'Kuat' : 'Abregado_Rae');
      await board.getByRole('searchbox').fill(world.replaceAll('_', ' '));
      await board.locator(`[data-world="${world}"][data-domain="${domain}"][data-source="stock"]`).first().click();
      await board.locator('.op-go').click();
    }
    await body.evaluate(async (_, domain) => {
      const start = Date.now(),
        ready = () => (domain === 'galaxy' ? window.game?.galaxy && game.planetViews?.some(v => v?.inst) : window.game?.world?.time > 2);
      while (!ready() || !document.querySelector('#loading.hidden')) {
        if (Date.now() - start > 120000) throw Error('World not ready');
        await new Promise(r => setTimeout(r, 100));
      }
    }, domain);
    const result = await body.evaluate(
      async (_, { domain, gl }) => {
        const g = window.game,
          { gfx } = await import('/js/gfx.js'),
          T = await import('three');
        g.modeSuspended = true;
        const r = domain === 'space' ? g.renderer : g,
          R = domain === 'land' ? (g.gpuOn ? g.gpu : g.renderer) : r.renderer;
        if (gl !== !!R.isWebGLRenderer) throw Error('Wrong render backend: ' + R.constructor.name);
        let draw, name, key, surface;
        const cam = r.camera;
        if (domain === 'land') {
          name = g.setup.mapFile;
          key = 'terrainLayers';
          surface = g.ground;
          // Same draws as the live land view, without advancing sim, particle clocks, AI, camera or weather.
          const { drawSky } = await import('/js/game/terrain.js');
          draw = () => {
            R.autoClear = false;
            R.clear();
            drawSky(R, g.sky, cam);
            R.clearDepth();
            R.render(g.scene, cam);
            R.endFrame?.();
          };
        } else if (domain === 'space') {
          name = g.setup.mapFile;
          key = 'planetAir';
          const planets = [];
          for (const scene of [r.scene, r.bgScene])
            scene.traverseVisible(o => {
              if (o.isMesh && o.material.uniforms?.orbitalAir) planets.push(o);
            });
          if (!planets.length)
            throw Error('No planet material; sky meshes: ' + r.skydomes.flatMap(i => i.model.meshes.map(m => m.name)).join(','));
          const mesh = (surface = planets[0]);
          mesh.geometry.computeBoundingSphere();
          const sphere = mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
          cam.lookAt(sphere.center);
          cam.updateMatrixWorld();
          r.post.flare = false;
          draw = () => r.draw(g.world, R, 0);
        } else {
          key = 'planetAir';
          const all = [];
          for (const [i, v] of g.planetViews.entries())
            v?.inst?.root.traverse(o => {
              if (
                o.isMesh &&
                o.visible &&
                o.material.uniforms?.orbitalAir &&
                o.material.uniforms.atmosphere.value.lengthSq() > 0 &&
                !o.material.defines?.PLANET_FIXED
              )
                all.push({ i, o, v });
            });
          if (!all.length) throw Error('No modeled planets');
          const { i, o, v } = all.find(a => /naboo|alderaan|mon.calamari/i.test(g.galaxy.planets[a.i].name)) || all[0];
          name = g.galaxy.planets[i].name;
          surface = o;
          v.inst.root.updateMatrixWorld(true);
          o.geometry.computeBoundingSphere();
          const b = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
          const keyLight = o.material.uniforms.sunDir.value.clone().normalize(),
            side = new T.Vector3().crossVectors(keyLight, new T.Vector3(0, 0, 1)).normalize();
          cam.near = Math.max(0.01, b.radius * 0.01);
          const dir = keyLight.multiplyScalar(0.38).addScaledVector(side, 0.925).normalize();
          cam.position.copy(b.center).addScaledVector(dir, (1.23 * b.radius) / Math.sin((cam.fov * Math.PI) / 360));
          cam.lookAt(b.center);
          cam.updateProjectionMatrix();
          cam.updateMatrixWorld();
          g.cullPlanets();
          g.updateSceneMatrices();
          draw = () => {
            R.autoClear = false;
            R.clear();
            R.render(g.backgroundScene, cam);
            R.clearDepth();
            R.render(g.scene, cam);
            R.endFrame?.();
          };
        }
        const W = R.domElement.width,
          H = R.domElement.height;
        async function shot(value) {
          gfx[key] = value;
          draw();
          await R.settle?.();
          const pending = R.readNext?.();
          draw();
          if (pending) return (await pending).data;
          const ctx = R.getContext(),
            tmp = new Uint8Array(W * H * 4),
            a = new Uint8Array(tmp.length);
          ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, tmp);
          for (let y = 0; y < H; y++) a.set(tmp.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          return a;
        }
        // Allow asynchronous instance pipelines / textures to finish on this view before the baseline.
        await shot(0);
        await shot(1);
        await new Promise(r => setTimeout(r, 280));
        await shot(0);
        const a = await shot(0),
          b = await shot(1),
          c = await shot(0);
        let changed = 0,
          drift = 0,
          visible = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.max(...[0, 1, 2].map(k => Math.abs(a[i + k] - b[i + k])));
          changed += d > 0;
          visible += d >= 4;
          drift += a[i] !== c[i] || a[i + 1] !== c[i + 1] || a[i + 2] !== c[i + 2];
        }
        // A second, isolated draw distinguishes a material rollback from tiny background animation/streaming differences.
        const probe = new T.Scene(),
          mesh = new T.Mesh(surface.geometry, surface.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(surface.matrixWorld);
        mesh.frustumCulled = false;
        probe.add(mesh);
        const { setBattleSurface } = await import('/js/model.js');
        draw = () => {
          setBattleSurface(domain === 'space');
          R.clear();
          R.render(probe, cam);
          R.endFrame?.();
          setBattleSurface(false);
        };
        await shot(0);
        const x = await shot(0),
          y = await shot(1),
          z = await shot(0);
        let probeChanged = 0,
          probeDrift = 0;
        for (let i = 0; i < x.length; i += 4) {
          probeChanged += x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2];
          probeDrift += x[i] !== z[i] || x[i + 1] !== z[i + 1] || x[i + 2] !== z[i + 2];
        }
        const png = px => {
          const el = document.createElement('canvas');
          el.width = W;
          el.height = H;
          el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
          return el.toDataURL().split(',')[1];
        };
        return { name, changed, visible, drift, probeChanged, probeDrift, png: [png(a), png(b)] };
      },
      { domain, gl }
    );
    for (const [i, name] of ['original', 'layered'].entries())
      fs.writeFileSync(path.join(out, domain + '-' + name + '.png'), Buffer.from(result.png[i], 'base64'));
    delete result.png;
    console.log({ domain, gl, ...result, bad: bad.slice(0, 4) });
    assert(result.visible > 1000);
    assert(result.drift < result.visible / 100);
    assert(result.probeChanged > 1000);
    assert.equal(result.probeDrift, 0);
    assert.deepEqual(bad, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
