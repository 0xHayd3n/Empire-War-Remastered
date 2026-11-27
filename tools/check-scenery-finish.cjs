// An actual mounted rock cluster, lit in the live land colour pass. Isolate its pixels so
// camera motion on the terrain cannot be mistaken for a highlight on the rock.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const gl = process.env.LOOK_BACKEND === 'webgl',
    b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1024, height: 640 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (/Shader Error|GPUValidationError|INVALID_OPERATION|Error while (validating|parsing WGSL)/i.test(m.text()))
        errors.push(m.text().slice(0, 500));
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    await p.goto('http://127.0.0.1:8590/#tatooine-remaster');
    const r = await p
      .frameLocator('#game')
      .locator('body')
      .evaluate(async () => {
        const tick = () => new Promise(requestAnimationFrame),
          end = performance.now() + 170000;
        while (!window.game?.scenery?.active || !(game.world.time > 1) || game.warming) {
          if (performance.now() > end) throw Error('No active remaster');
          await tick();
        }
        const g = game,
          T = await import('three'),
          { lighting: L, buildModel } = await import('/js/model.js'),
          { LandScenery } = await import('/js/game/scenery-lod.js'),
          { gfx } = await import('/js/gfx.js');
        await (await import('/js/dds.js')).texturesReady();
        g.modeSuspended = true;
        await tick();
        const R = g.gpuOn ? g.gpu : g.renderer,
          real = R.render,
          scene = new T.Scene(),
          size = 192,
          rt = new T.WebGLRenderTarget(size, size),
          eye = g.camera.clone(),
          now = g.last;
        const prop = g.props.find(p => /rockclstr03/i.test(p.modelFile)),
          part = g.scenery.rows.get(prop.grp).parts.find(p => p.material.defines?.NATURAL_STONE);
        const mesh = new T.Mesh(part.high, part.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.mesh.matrixWorld);
        scene.add(mesh);
        const sphere = new T.Box3().setFromObject(mesh).getBoundingSphere(new T.Sphere());
        const flags = {
          rock: !!part.material.defines.NATURAL_STONE,
          legacy: !!part.original.defines.MAP_FINISH,
          crate: g.scenery.rows.get(g.props.find(p => /crate/i.test(p.modelFile)).grp).parts.every(p => p.original === p.material)
        };
        // New placements with no recognised model/type name and no XML override:
        // the actual mounted material has to carry the finish through registration.
        const registry = new LandScenery(),
          additions = [];
        for (const [file, flag] of [
          [/rockclstr03/i, 'NATURAL_STONE'],
          [/tree_tat00/i, 'NATURAL_PLANT'],
          [/crate/i, '']
        ]) {
          const source = g.props.find(p => file.test(p.modelFile)),
            inst = buildModel(source.inst.model, { fresh: true });
          const grp = new T.Group();
          grp.add(inst.root);
          additions.push({ grp, inst, mapType: 'Prop_17', modelFile: 'item.alo' });
          registry.register(additions, true);
          const parts = registry.rows.get(grp).parts;
          flags['anonymous_' + (flag || 'crate')] = flag
            ? parts.some(p => p.mesh.material.defines?.[flag])
            : parts.every(p => p.mesh.material === p.original);
        }
        registry.dispose();
        let mode = 'dry',
          yaw = 0,
          passes = 0;
        R.render = function (s, c) {
          if (s === g.scene && c === g.camera) {
            const target = R.getRenderTarget(),
              spec = L.sunSpecular.value.clone(),
              wet = L.sceneryWet.value,
              env = L.receiverMode.value.z;
            try {
              const flat = mode.endsWith('Off');
              mesh.material = mode.startsWith('legacy') ? part.original : part.material;
              if (flat) {
                L.sunSpecular.value.setRGB(0, 0, 0);
                L.receiverMode.value.z = 0;
              }
              L.sceneryWet.value = mode === 'wet' ? 1 : 0;
              eye.aspect = 1;
              eye.position
                .copy(sphere.center)
                .addScaledVector(new T.Vector3(Math.cos(yaw), Math.sin(yaw), 0.4).normalize(), sphere.radius * 2.25);
              eye.lookAt(sphere.center);
              eye.updateProjectionMatrix();
              eye.updateMatrixWorld();
              R.setRenderTarget(rt);
              R.clear();
              real.call(R, scene, eye);
              passes++;
            } finally {
              R.setRenderTarget(target);
              L.sunSpecular.value.copy(spec);
              L.receiverMode.value.z = env;
              L.sceneryWet.value = wet;
            }
          }
          return real.call(R, s, c);
        };
        async function step() {
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(now);
          } finally {
            g.modeSuspended = true;
            g.warming = false;
          }
          await tick();
        }
        async function shot(m) {
          mode = m;
          const n = passes;
          await step();
          if (passes === n) throw Error('No main colour draw');
          await R.settle?.();
          const a = new Uint8Array(size * size * 4);
          await R.readRenderTargetPixelsAsync(rt, 0, 0, size, size, a);
          return a;
        }
        function delta(a, b) {
          let changed = 0,
            energy = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            energy += d;
            if (d > 6) changed++;
          }
          return { changed, energy };
        }
        const coverage = a => a.reduce((n, v, i) => n + (i % 4 === 0 && Math.abs(v - a[0]) > 8), 0);
        // Compiling in the main context does not mean the GL mirror has drawn this target.
        // Wait for stable, populated *same-input* frames, never for the A/B to pass.
        async function stable(m) {
          let prev = await shot(m),
            repeats = 0;
          for (let i = 0; i < 60; i++) {
            const next = await shot(m);
            repeats = coverage(next) > 1000 && delta(prev, next).changed < 4 ? repeats + 1 : 0;
            if (repeats >= 3) return next;
            prev = next;
          }
          throw Error('No stable rock coverage in ' + m);
        }
        try {
          for (const m of [part.original, part.material]) {
            mesh.material = m;
            await R.compileAsync?.(scene, eye, scene);
          }
          const angles = [];
          for (yaw of [-1.1, 1.2]) {
            const dry = await stable('dry'),
              off = await shot('dryOff'),
              wet = await shot('wet'),
              legacy = await stable('legacy'),
              legacyOff = await shot('legacyOff');
            angles.push({
              dry: delta(dry, off),
              wet: delta(dry, wet),
              legacy: delta(legacy, legacyOff),
              coverage: coverage(dry)
            });
          }
          R.render = real;
          gfx.tatooineLandscape = false;
          await step();
          flags.restored = part.mesh.material === part.original && part.mesh.geometry === part.high && !g.scenery.active;
          gfx.tatooineLandscape = true;
          await step();
          flags.reenabled = part.mesh.material === part.material && g.scenery.active;
          return {
            gpu: !!g.gpuOn,
            file: prop.modelFile,
            source: [part.original.defines, part.original.uniforms.specular.value.toArray()],
            flags,
            angles
          };
        } finally {
          R.render = real;
          rt.dispose();
        }
      });
    console.log(JSON.stringify(r));
    assert.deepEqual(errors, []);
    assert.equal(r.gpu, !gl);
    assert(Object.values(r.flags).every(Boolean), 'Wrong scenery scope or failed original restoration');
    for (const a of r.angles) {
      assert(a.coverage > 1000, 'Missing rock cluster');
      assert(a.legacy.energy > 2000, 'No legacy highlight to compare');
      assert(a.dry.energy < a.legacy.energy * 0.18, 'Dry rock still reflects like polished material');
      assert(a.wet.changed > 300, 'No weather response');
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
