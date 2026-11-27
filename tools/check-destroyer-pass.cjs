// Mounted player-facing check. Outputs stay in TEMP; the optional private reference input is never a game asset.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl', edges=process.env.LOOK_EDGES==='1',
  out = path.join(process.env.LOOK_SHOTS || path.join(os.tmpdir(), 'destroyer-pass'), gl ? 'webgl' : 'webgpu');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }),
      bad = [];
    p.setDefaultTimeout(90000);
    p.on('pageerror', e => {
      console.error('page', e.message);
      bad.push(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION|reflections unavailable/i.test(
          m.text()
        )
      ) {
        console.error(m.text().slice(0, 1200));
        bad.push(m.text().slice(0, 1200));
      }
    });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    if(edges && !gl) await p.addInitScript(()=>{
      // Override only the display capability signal, not WebGPU negotiation or its pixels.
      const native=matchMedia.bind(window),q='(dynamic-range: high)',m=native(q);let high=false;
      Object.defineProperty(m,'matches',{get:()=>high});window.testEdgeHDR=v=>{high=v;m.dispatchEvent(new Event('change'));};
      window.matchMedia=s=>s===q?m:native(s);
    });
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      body = f.locator('body'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      quality = () => s.getByRole('tab', { name: 'Graphics Quality', exact: true }).click(),
      selector = s.getByLabel('Star Destroyer close-ups');
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await quality();
    assert.equal(await selector.inputValue(), 'stock');
    const nearShadow = s.getByRole('checkbox', { name: 'Close-up hull shadows' });
    assert.equal(await nearShadow.isChecked(), false);
    await nearShadow.check();
    const edgeSetting=s.getByRole('checkbox',{name:'Stable flyby edges'});
    if(edges){assert.equal(await edgeSetting.isChecked(),false);await edgeSetting.check();}
    await selector.selectOption('finish');
    await s.getByLabel('Space battle look').selectOption('orbital');
    await p.reload();
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await quality();
    assert.equal(await selector.inputValue(), 'finish');
    assert(await nearShadow.isChecked());
    if(edges)assert(await edgeSetting.isChecked());
    await p.setViewportSize({ width: 390, height: 844 });
    await s.evaluate(e => (e.style.backgroundImage = 'none'));
    await selector.focus();
    await selector.press('Home');
    assert.equal(await selector.inputValue(), 'stock');
    await selector.press('End');
    assert.equal(await selector.inputValue(), 'finish');
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    if(edges){await edgeSetting.scrollIntoViewIfNeeded();await edgeSetting.focus();await edgeSetting.press('Space');assert(!(await edgeSetting.isChecked()));await edgeSetting.press('Space');}
    await p.screenshot({ path: path.join(out, 'narrow.png') });
    await p.setViewportSize({ width: 1920, height: 1080 });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await body.evaluate(async () => {
      const { instantRoster, shipsOf, INSTANT_BUDGET_MAX: budget } = await import('/js/game/instantbattle.js');
      const players = ['Empire', 'Rebel'].map((faction, team) => {
        const rows = instantRoster(faction).filter(r => !r.hero),
          sd = rows.find(r => shipsOf(r.type).some(t => /^(Generic_)?Star_Destroyer$/i.test(t.name))),
          esc = rows.filter(r => r.cls >= 2 && r.cls <= 4);
        return {
          faction,
          team,
          budget,
          army: Array.from({ length: 100 }, (_, i) => (!i && sd ? sd : esc[i % esc.length]).name),
          kind: team ? 'medium' : 'you'
        };
      });
      localStorage.setItem('swr-instant-setup', JSON.stringify({ turn: 0, budget, players }));
    });
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`.title-menu [data-id="${id}"]`).click();
    const b = f.locator('.op-setup');
    await b.getByRole('searchbox').fill('Abregado Rae Forces of Corruption space');
    await b.locator('[data-world="Abregado_Rae"][data-domain="space"][data-source="stock"]').first().click();
    await b.locator('.op-go').click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    await body.evaluate(async () => {
      const t = performance.now();
      while (!(window.game?.world?.time > 5)) {
        if (performance.now() - t > 180000) throw Error('Battle did not start');
        await new Promise(r => setTimeout(r, 100));
      }
      game.menus.main();
    });
    await f.locator('[data-id="IDC_INGAME_OPTIONS"]').click();
    await quality();
    await selector.focus();
    await p.screenshot({ path: path.join(out, 'settings.png') });
    await s.getByRole('button', { name: 'Play Star Destroyer flyby', exact: true }).click();
    await body.evaluate(async () => {
      if (!game.cine.on || !game.cine.sequence) throw Error('Flyby did not start');
      await new Promise(r => setTimeout(r, 350));
    });
    await p.keyboard.press('Escape');
    if(edges){
      const {report,images}=await body.evaluate(require('./flyby-edge-samples.cjs'),gl);
      for(const [key,data] of Object.entries(images))fs.writeFileSync(path.join(out,key+'.png'),Buffer.from(data,'base64'));
      fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
      assert(report.on.edgeMAE<report.off.edgeMAE && report.on.motionMAE<report.off.motionMAE,'Improve moving edges against the independent 6x reference');
      assert(report.bolt.changed>10 && report.fighter.changed>10 && !report.bolt.vacated && !report.fighter.vacated && !report.bolt.removed && !report.fighter.removed,'No trails in vacated pixels');
      assert(!report.reset && !report.fleetDiff && report.fleetDensity===1 && report.upscaleDensity===1 && report.stockDensity===1);
      assert(report.on.contrastRatio>.89 && report.on.contrastRatio<1.15,'Retain real reference edges rather than blurring them away');
      assert(report.stack.changed>100 && report.stack.reset===0 && report.stack.released,'Default effect stack restores native targets and pixels');
      if(!gl)assert(report.hdr?.peak>1 && report.hdr.scene==='rgba16float' && report.hdr.resolved==='rgba16float','Retain extended-range highlight headroom through resolve');
      assert.deepEqual(report.depthSize,report.sceneSize);assert(report.live.enabled>=90 && report.live.sim>0);assert.deepEqual(bad,[]);
      return;
    }
    await body.evaluate(require('./hull-shadow-rays.cjs'));
    const { report, images, reference } = await body.evaluate(
      async (_, args) => {
        const g = game,
          w = g.world,
          r = g.renderer,
          R = r.renderer,
          cam = r.camera,
          gpu = r.gpu,
          { gfx } = await import('/js/gfx.js'),
          { lighting } = await import('/js/model.js'),
          { frameDestroyer, passSubject, passRoute } = await import('/js/game/destroyer-pass.js'),
          { stockHull } = await import('/js/game/destroyer-detail.js');
        if (!!gpu === args.gl || g.cine.on || !g.setup.instant.armies.every(a => a.length === 100))
          throw Error('Wrong battle, camera or backend');
        g.modeSuspended = true;
        // Let the queued game RAF actually observe suspension before restarting it below.
        // WebGL readPixels is synchronous; a chain of resolved promises is not a frame boundary.
        await new Promise(requestAnimationFrame);
        // drawFlare updates a temporal visibility filter even on a zero-dt draw. It is
        // unrelated to hull materials and would contaminate pixel-exact repeat shots.
        const flare = r.post.flare;
        r.post.flare = false;
        await (await import('/js/dds.js')).texturesReady();
        // Settle the final live pose on *all* instance pools once. The normal staggered
        // 1/64 rescan can otherwise update a turret mid-comparison even with a pinned camera.
        const jobs=r.instances?.jobs;
        if (r.instances) {
          // Worker and main-thread matrix multiplies can round a sub-pixel triangle to
          // different MSAA samples. Use one producer for exact stills, restore it for timings.
          r.instances.jobs=null;
          for (const unit of w.units) if (unit.obj && !unit.dead) r.instances.scan(unit);
        }
        const u = passSubject(g);
        if (!u) throw Error('No flagship');
        const W = R.domElement.width,
          H = R.domElement.height,
          report = { width: W, height: H, counts: g.setup.instant.armies.map(a => a.length), close: [], triangles: {}, live: {} },
          images = {};
        function png(px) {
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
          return c.toDataURL().split(',')[1];
        }
        async function shot(mode) {
          gfx.destroyerDetail = mode;
          for (const s of r.skydomes) s.root.position.copy(cam.position);
          r.draw(w, R, 0);
          await r.orbitProbe?.ready;
          await r.destroyerLook?.probe?.ready;
          r.draw(w, R, 0);
          if (gpu) await gpu.settle();
          const next = gpu?.readNext();
          r.draw(w, R, 0);
          if (next) return (await next).data;
          const ctx = R.getContext(),
            a = new Uint8Array(W * H * 4),
            z = a.slice();
          ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, a);
          for (let y = 0; y < H; y++) z.set(a.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
          return z;
        }
        const diff = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
          return n;
        };
        let reference;
        for (const [name, k] of [
          ['bow', 0.04],
          ['aft', 0.92]
        ]) {
          gfx.closeHullShadows = false;
          frameDestroyer(cam, u, k, passRoute(g, u));
          await shot('stock');
          const a = await shot('stock'),
            b = await shot('detail'),
            c = await shot('finish');
          gfx.closeHullShadows = true;
          const near = await shot('finish');
          const sh = r.closeShadow;
          if (!sh?.focus || !r.shadowsOn) throw Error('Missing close-up shadow pass (master Shadows: ' + r.shadowsOn + ')');
          let darker = 0,
            brighter = 0,
            hotCore = 0,
            hotChanged = 0;
          for (let i = 0; i < c.length; i += 4) {
            const delta = near[i] + near[i + 1] + near[i + 2] - c[i] - c[i + 1] - c[i + 2];
            if (delta < -6) darker++;
            if (delta > 6) brighter++;
            if (c[i] > 235 && c[i + 1] > 245 && c[i + 2] > 250) {
              hotCore++;
              if (delta < -6) hotChanged++;
            }
          }
          const focused = sh.focus === u,
            casters = sh.meshes.size;
          const draws = sh.draws;
          r.draw(w, R, 0);
          if (sh.draws !== draws) throw Error('Static hull shadow unnecessarily recaptured');
          const rays = window.inspectHullShadow(sh, u, cam, lighting.sunDir.value, c, near, W, H);
          images[name + '-hull-shadow'] = png(near);
          gfx.closeHullShadows = false;
          const restored=await shot('finish'), shadowReset=diff(c,restored);
          if(shadowReset)images[name+'-restored-finish']=png(restored);
          if(name==='aft') {
            const prev=r.shadowsOn, count=sh.draws;r.shadowsOn=false;
            const withoutMaster=await shot('finish');gfx.closeHullShadows=true;
            report.masterOffDiff=diff(withoutMaster,await shot('finish'));
            if(sh.draws!==count)throw Error('Close pass ran with master Shadows off');
            gfx.closeHullShadows=false;r.shadowsOn=prev;
          }
          const slot = r.destroyerLook.slots.get(u);
          if (!slot || !r.destroyerLook.probe.texture) throw Error('No matched hull or reflection atlas');
          for (const m of slot.children) report.triangles[m.name] = m.geometry.attributes.position.count / 3;
          if (args.ref && !reference) {
            const mesh = (m, name, rough, metal, em) => ({
              name,
              position: Array.from(m.geometry.attributes.position.array),
              index: m.geometry.index ? Array.from(m.geometry.index.array) : null,
              matrix: m.matrixWorld.toArray(),
              color: name === 'glass' ? [0.5, 0.65, 0.8] : name === 'edge' ? [0.12, 0.13, 0.14] : [0.29, 0.3, 0.32],
              roughness: rough,
              metalness: metal,
              emission: em
            });
            const hull = stockHull(u),
              mounted = [];
            u.obj.updateWorldMatrix(true, true);
            u.obj.traverseVisible(m => {
              if (
                m.isMesh &&
                m.geometry?.attributes.position &&
                !m.material?.transparent &&
                m.material?.uniforms?.map &&
                !m.material?.defines?.UNLIT
              )
                mounted.push(mesh(m, m === hull ? 'stock' : 'mounted-fitting', 0.72, 0, 0));
            });
            reference = {
              width: W,
              height: H,
              camera: { matrix: cam.matrixWorld.toArray(), fov: cam.fov },
              sun: { dir: lighting.sunDir.value.toArray(), color: lighting.sunColor.value.toArray() },
              ambient: lighting.ambient.value.toArray(),
              meshes: [
                ...mounted,
                ...slot.children.map(m =>
                  mesh(m, m.name, m.name === 'metal' ? 0.19 : 0.72, m.name === 'metal' ? 0.65 : 0, m.name === 'glass' ? 0.35 : 0)
                )
              ]
            };
          }
          images[name + '-stock'] = png(a);
          images[name + '-detail'] = png(b);
          images[name + '-finish'] = png(c);
          report.close.push({
            name,
            geometry: diff(a, b),
            finish: diff(b, c),
            near: diff(c, near),
            darker,
            brighter,
            hotCore,
            hotChanged,
            shadowReset,
            rays,
            focus: focused,
            casters,
            reset: diff(a, await shot('stock'))
          });
        }
        Object.assign(r.rig, { x: u.x, y: u.y, z: u.z || 0, dist: 6000, pitch: 0.95, free: true, shake: 0 });
        r.rig.apply(0);
        cam.updateMatrixWorld();
        const nearDraws = r.closeShadow.draws;
        gfx.closeHullShadows = true;
        const a = await shot('stock'),
          b = await shot('finish');
        report.wideShadowDraws = r.closeShadow.draws - nearDraws;
        report.wideDiff = diff(a, b);
        report.wideFits = r.destroyerLook.slots.size;
        images.fleet = png(b);
        // Collect actual game RAF intervals, not submission times from repeated frozen draws. ABBA, discard eight frames/window.
        let draws = 0;
        const recorded = R.render;
        R.render = function (scene, ...rest) {
          if (scene === r.scene) draws++;
          return recorded.call(this, scene, ...rest);
        };
        if(r.instances) r.instances.jobs=jobs;
        r.post.flare = flare;
        g.modeSuspended = false;
        g.last = performance.now();
        requestAnimationFrame(g.frame);
        const samples = { stock: [], finish: [] },
          sim = w.time,
          units = w.units.filter(v => v.isMobile && !v.dead && v.player?.id >= 0),
          poses = units.map(v => [v.x, v.y]);
        let maxFits = 0;
        for (const key of ['stock', 'finish', 'finish', 'stock']) {
          gfx.destroyerDetail = key;
          let prev;
          for (let i = 0; i < 48; i++) {
            const now = await new Promise(requestAnimationFrame);
            if (prev && i >= 8) samples[key].push(now - prev);
            prev = now;
            r.rig.yaw += 0.004;
            maxFits = Math.max(maxFits, r.destroyerLook?.slots.size || 0);
          }
        }
        for (const [key, arr] of Object.entries(samples)) {
          arr.sort((a, b) => a - b);
          report.live[key] = { n: arr.length, median: arr[Math.floor(arr.length / 2)], p95: arr[Math.ceil(arr.length * 0.95) - 1] };
        }
        R.render = recorded;
        Object.assign(report.live, {
          draws,
          elapsedSimulation: w.time - sim,
          moving: units.filter((v, i) => Math.hypot(v.x - poses[i][0], v.y - poses[i][1]) > 1).length,
          maxFits
        });
        // Live close-up cost: identical eight-second pass positions in short ABBA windows;
        // movement and turret animations continue, so timing deltas are indicative rather than a replay.
        const previous = r.cameraOverride,
          route = passRoute(g, u),
          passes = { off: [], on: [] };
        let k = 0,
          focused = 0;
        gfx.destroyerDetail = 'finish';
        r.flybySubject = u;
        r.cameraOverride = () => frameDestroyer(cam, u, k, route);
        for (const key of ['off', 'on', 'on', 'off']) {
          gfx.closeHullShadows = key === 'on';
          let last;
          for (let i = 0; i < 48; i++) {
            k = 0.1 + (0.8 * i) / 47;
            const now = await new Promise(requestAnimationFrame);
            if (i >= 8) passes[key].push(now - last);
            last = now;
            if (key === 'on' && r.closeShadow.focus === u) focused++;
          }
        }
        r.cameraOverride = previous;
        r.flybySubject = null;
        report.liveClose = Object.fromEntries(
          Object.entries(passes).map(([key, a]) => {
            a.sort((a, b) => a - b);
            return [key, { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * 0.95) - 1] }];
          })
        );
        report.liveClose.focused = focused;
        return { report, images, reference };
      },
      { gl, ref: !!process.env.PRIVATE_REF }
    );
    for (const [name, img] of Object.entries(images)) fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(img, 'base64'));
    if (reference) fs.writeFileSync(process.env.PRIVATE_REF, JSON.stringify(reference));
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    assert(report.close.every(v => v.geometry > 100 && v.finish > 0 && v.reset === 0));
    assert(
      report.close.every(v => v.darker > 50 && v.shadowReset === 0 && v.focus && v.casters > 2),
      'Bridge casts a reversible detailed shadow on the flyby subject'
    );
    assert(
      report.close.every(
        v => v.rays.clear.n > 50 && Math.abs(v.rays.clear.medianDrop) < 2 && v.rays.blocked.n >= 5 && v.rays.blocked.medianDrop > 4
      ),
      'Sunlit deck keeps its exposure; triangle-occluded deck loses direct sun'
    );
    assert(report.liveClose.focused >= 85, 'Live near-shadow timing must actually follow the flagship');
    assert.equal(report.wideShadowDraws, 0);
    assert.equal(report.masterOffDiff,0);
    assert.equal(report.wideDiff, 0);
    assert.equal(report.wideFits, 0);
    assert(report.live.draws === 192 && report.live.elapsedSimulation > 0 && report.live.moving > 0 && report.live.maxFits === 0);
    assert.deepEqual(bad, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
