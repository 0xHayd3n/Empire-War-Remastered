// Isolated creator session inside the normal Universal title window. No direct play URL,
// setup injection, arbitrary asset URLs, staged units, source edits, or persistent game settings.
const fs = require('node:fs'),
  path = require('node:path');
async function capture(job, { world, backend, trial, focus = null, inventory = false }, home) {
  const { chromium } = require('playwright-core'),
    { PNG } = require('pngjs');
  const profile = job.identity.order[0] || 'stock';
  if (job.identity.order.length > 1)
    throw Error('Workshop order: use the exact Workshop desk route and manual capture gate; not a single-era capture');
  const folder = path.join(home, 'evidence', job.id, backend, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  const report = { job: job.id, backend, trial, focus, state: 'blocked', views: {}, errors: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => {
      if (
        /GPUValidationError|Shader Error|INVALID_OPERATION|Error while (validating|parsing WGSL)/i.test(m.text()) &&
        report.errors.length < 20
      )
        report.errors.push(m.text().slice(0, 1000));
    });
    await page.addInitScript(
      ({ gl, eaw }) => {
        if (gl) sessionStorage.setItem('swr-webgpu-dropped', '1');
        if (eaw) localStorage.setItem('swr.game', 'eaw');
      },
      { gl: backend === 'webgl', eaw: job.scope.edition === 'eaw' }
    );
    await page.goto('http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      board = f.locator('.op-setup');
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${id}"]:visible`).click();
    const search = board.getByRole('searchbox');
    await search.fill(
      world ||
        [
          job.planet || job.file.replace(/\.ted$/i, ''),
          profile === 'stock' ? 'Forces of Corruption' : job.scope.name.match(/^[\p{L}\d]+/u)?.[0] || '',
          'land'
        ]
          .join(' ')
          .replaceAll('_', ' ')
    );
    // Encode every filename code point in a quoted CSS value; wait on the exact row so a
    // slower catalog render or virtual list refresh cannot accidentally select a neighbor.
    const escaped = Array.from(job.file, c => '\\' + c.codePointAt(0).toString(16) + ' ').join('');
    const leaf = board.locator(`[data-domain="land"][data-source="${profile}"][data-file="${escaped}" i]`).first();
    try {
      await leaf.waitFor({ state: 'visible', timeout: 14000 });
    } catch {
      throw Error(
        'Exact TED not visible on Instant Battle board. Try --world, or use its real mission/collection route; no alternate map captured.'
      );
    }
    await leaf.click();
    await f.locator(`.op-setup[data-profile="${profile}"] .op-go:enabled`).click();
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const body = f.locator('body');
    const data = await body.evaluate(
      async (_, p) => {
        const { job, profile, backend, trial } = p,
          wait = () => new Promise(requestAnimationFrame),
          deadline = performance.now() + 90000;
        while (!(window.game?.world?.time > 1 && game.ground && !document.querySelector('.battle-plate'))) {
          if (performance.now() > deadline) throw Error('No live land game');
          await wait();
        }
        const g = game,
          w = g.world,
          t = g.terrain,
          tex = await import('/js/dds.js'),
          { mapSourceDigest } = await import('/js/ted.js'),
          { fetchBinary, pageOverlay } = await import('/js/vfs.js'),
          { edition } = await import('/js/edition.js'),
          { digest } = await import('/js/texture-showcase/recipes.js'),
          store = await import('/js/texture-showcase/store.js');
        const eq = (ok, msg) => {
            if (!ok) throw Error(msg);
          },
          actual = g.map.sourcePath.replaceAll('/', '\\').toUpperCase();
        eq(
          edition() === job.identity.edition && store.profile === profile && !store.active && !(await pageOverlay()),
          'Wrong edition/profile or browser overlay'
        );
        eq(actual === job.identity.path && (await mapSourceDigest(g.map)) === job.identity.ted, 'Changed or shadowed TED');
        eq((g.gpuOn ? 'webgpu' : 'webgl') === backend && !g.renderer.isMirror, 'Wrong renderer');
        if (!g.gpuOn) {
          const R = g.renderer,
            gl = R.getContext();
          let prog = R.properties.get(g.ground.material).currentProgram;
          while (!prog?.isReady() && performance.now() < deadline) {
            await wait();
            prog = R.properties.get(g.ground.material).currentProgram;
          }
          eq(
            prog && gl.getProgramParameter(prog.program, gl.LINK_STATUS),
            'Ground program not ready: ' + (prog ? gl.getProgramInfoLog(prog.program) : 'missing')
          );
        }
        const U = g.ground.material.uniforms;
        eq(!U.fullTerrain.value && !U.forestSlot.value, 'Start from original materials');
        g.modeSuspended = true;
        await wait();
        g.following = null;
        await tex.texturesReady();
        const signatures = new Map();
        const source = async n => {
          if (!n) return null;
          if (!signatures.has(n)) {
            const b = await fetchBinary('Data/Art/Textures/' + (/\.[a-z0-9]{2,4}$/i.test(n) ? n : n + '.dds'), { keep: false });
            signatures.set(n, b ? await digest(b) : null);
          }
          return signatures.get(n);
        };
        for (const [i] of t.paint.slot) {
          const s = job.slots[i],
            L = t.layers[i],
            sig = job.identity.slots.find(row => row[0] === i);
          eq(s && sig && (await source(L.texture)) === sig[2] && (await source(L.bump)) === sig[4], 'Changed winning art: ' + L.texture);
        }
        const { decodeDXT } = await import('/js/ddsdecode.js'),
          T3 = await import('/vendor/three/build/three.module.js');
        const slots = [...t.paint.slot.keys()];
        let sheet = document.createElement('canvas');
        sheet.width = 640;
        sheet.height = 112 * Math.ceil(slots.length / 5);
        const ctx = sheet.getContext('2d'),
          missing = [];
        ctx.fillStyle = '#252525';
        ctx.fillRect(0, 0, sheet.width, sheet.height);
        for (let j = 0; j < slots.length; j++) {
          const i = slots[j],
            s = job.slots[i],
            x = (j % 5) * 128,
            y = Math.floor(j / 5) * 112;
          try {
            const d = await tex.loadDDS(s.texture.name),
              m = d.mipmaps.find(m => m.width <= 256 && m.height <= 256) || d.mipmaps.at(-1),
              kind = { [T3.RGBA_S3TC_DXT1_Format]: 1, [T3.RGBA_S3TC_DXT3_Format]: 3, [T3.RGBA_S3TC_DXT5_Format]: 5 }[d.format];
            if (d.compressed && !kind) throw Error();
            const rgba = kind ? decodeDXT(m.data, m.width, m.height, kind) : m.data.slice();
            for (let k = 3; k < rgba.length; k += 4) rgba[k] = 255;
            const c = document.createElement('canvas');
            c.width = m.width;
            c.height = m.height;
            c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), m.width, m.height), 0, 0);
            ctx.drawImage(c, x, y, 128, 82);
          } catch {
            missing.push(i);
          }
          ctx.fillStyle = 'white';
          ctx.font = '11px sans-serif';
          ctx.fillText(`${i}: ${s.texture?.name || 'missing'}`, x, y + 94, 126);
          ctx.fillText(`${s.vertices} vertices · ${s.submerged} wet`, x, y + 106, 126);
        }
        const a = w.units.find(u => u.side === g.me && !u.dead && u.holder?.visible && !u.structure);
        eq(a, 'No visible deployed army');
        const cameras = {
          squad: { x: a.x, y: a.y, dist: 140, pitch: 0.38, yaw: -1.5 },
          command: { x: a.x, y: a.y, dist: 780, pitch: 1.02, yaw: -1.5 }
        };
        const slot =
          trial?.slot ?? p.focus ?? job.slots.filter(s => s.vertices && !s.hole).sort((a, b) => b.vertices - a.vertices)[0]?.index;
        let best = -Infinity,
          wetBest = Infinity,
          at = null,
          wet = null;
        for (let j = 1; j < t.height - 1; j++)
          for (let i = 1; i < t.width - 1; i++) {
            const n = j * t.size + i,
              d = Math.hypot(i * 20 - a.x, j * 20 - a.y);
            if (t.water?.mode === 1 && t.heights[n] < t.water.level && d < wetBest) {
              wetBest = d;
              wet = [20 * i, 20 * j];
            }
            if (t.layerIndex[n] !== slot) continue;
            const k = [1, -1, t.size, -t.size].filter(z => t.layerIndex[n + z] === slot).length - d / 12000;
            if (k > best) {
              best = k;
              at = [i * 20, j * 20];
            }
          }
        eq(at, 'No painted occurrence of target');
        cameras.surface = { x: at[0], y: at[1], dist: 100, pitch: 0.7, yaw: -1.4 };
        if (wet) cameras.shore = { x: wet[0], y: wet[1], dist: 150, pitch: 0.8, yaw: -1.4 };
        const H = async a => digest(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)),
          guard = async () => ({
            paint: await H(t.layerIndex),
            heights: await H(t.heights),
            passability: t.passability && (await H(t.passability)),
            time: w.time,
            weather: [w.weather?.name, w.weather?.i, w.weather?.left],
            units: w.units.length
          });
        const initial = await guard();
        let toggle = () => {},
          donorPin = null;
        if (trial) {
          const s = job.slots[slot],
            index = t.paint.slot.get(slot);
          eq(
            index !== undefined && s.texture?.hash && (!s.bump || s.bump.hash) && !s.hole && !missing.includes(slot),
            'Unknown/undecodable source slot'
          );
          eq(!g.ground.userData.endorLandscape, 'Use the dedicated Endor harness for the reference scene');
          const R = g.gpuOn ? g.gpu : g.renderer;
          eq(R.device?.features.has('texture-compression-bc') || R.extensions?.has('WEBGL_compressed_texture_s3tc'), 'BC3 unavailable');
          const T = await import('/vendor/three/build/three.module.js'),
            rows = [
              ...(await (await fetch('/art/endor-terrain/materials.json')).json()),
              await (await fetch('/art/endor-terrain/paving.json')).json()
            ],
            row = rows.find(r => r.id === trial.donor);
          eq(row, 'Unknown donor');
          donorPin = row;
          const pair = [];
          for (const k of ['color', 'surface']) {
            const r = await fetch(`/art/endor-terrain/${trial.donor}-${k}.dds`);
            eq(r.ok, 'Missing donor');
            const bytes = await r.arrayBuffer();
            eq((await digest(bytes)) === row[k + 'Hash'], 'Changed donor');
            const d = tex.parseDDS(bytes);
            eq(
              d.format === T.RGBA_S3TC_DXT5_Format && d.width === 2048 && d.height === 2048 && d.mipmaps.length === 12,
              'Damaged donor chain'
            );
            const m = new T.CompressedTexture(d.mipmaps, d.width, d.height, d.format);
            m.wrapS = m.wrapT = T.RepeatWrapping;
            m.minFilter = T.LinearMipmapLinearFilter;
            m.magFilter = T.LinearFilter;
            m.needsUpdate = true;
            pair.push(m);
          }
          const us = U.texU.value[index],
            vs = U.texV.value[index],
            u = us.clone(),
            v = vs.clone(),
            prev = [U.soilColor.value, U.soilSurface.value, U.forestSlot.value];
          toggle = on => {
            us.copy(u);
            vs.copy(v);
            if (on) {
              const f = (t.layers[slot].tile || 215) / (70 * row.tileMeters);
              for (const c of ['x', 'y', 'z']) {
                us[c] *= f;
                vs[c] *= f;
              }
            }
            [U.soilColor.value, U.soilSurface.value, U.forestSlot.value] = on ? [...pair, index + 1] : prev;
          };
        }
        const now = g.last;
        window.remasterDraw = async (c, on) => {
          toggle(on);
          Object.assign(g.view, c);
          for (let i = 0; i < 14; i++) {
            g.warming = true;
            g.modeSuspended = false;
            try {
              g.frame(now);
            } finally {
              g.warming = false;
              g.modeSuspended = true;
            }
            await wait();
          }
          await g.gpu?.settle?.();
        };
        window.remasterGuard = async () => JSON.stringify(initial) === JSON.stringify(await guard());
        return {
          cameras,
          initial,
          donorPin,
          activeSlots: slots,
          unreadable: missing,
          environment: g.map.environment?.name,
          revision: document.querySelector('meta[name="swr-pack-revision"]')?.content || 'stock',
          sheet: sheet.toDataURL('image/png').split(',')[1]
        };
      },
      { job, profile, backend, trial, focus }
    );
    fs.writeFileSync(path.join(folder, 'painted-sources.png'), Buffer.from(data.sheet, 'base64'));
    delete data.sheet;
    Object.assign(report, data);
    if (inventory) report.inventory = await body.evaluate(require('./scout-inventory.cjs').scoutInventory);
    let changed = false;
    for (const [view, c] of Object.entries(data.cameras)) {
      const states = trial ? ['original', 'trial', 'restored'] : ['original'];
      let before;
      for (const state of states) {
        await body.evaluate((_, [c, on]) => remasterDraw(c, on), [c, state === 'trial']);
        const bytes = await page.screenshot({ path: path.join(folder, view + '-' + state + '.png') }),
          im = PNG.sync.read(bytes);
        if (!before) before = im;
        let count = 0;
        for (let y = (im.height * 0.14) | 0; y < im.height * 0.66; y++)
          for (let x = (im.width * 0.12) | 0; x < im.width * 0.88; x++) {
            const p = 4 * (y * im.width + x);
            if (
              Math.abs(im.data[p] - before.data[p]) +
                Math.abs(im.data[p + 1] - before.data[p + 1]) +
                Math.abs(im.data[p + 2] - before.data[p + 2]) >
              12
            )
              count++;
          }
        (report.views[view] ||= {})[state] = count;
        if (state === 'trial' && view === 'surface' && count > 32) changed = true;
        if (state === 'restored' && count > 32) throw Error('Rollback capture differs at ' + view + ': ' + count + ' pixels');
      }
    }
    if (trial && !changed) throw Error('No visible difference at the target surface');
    if (!(await body.evaluate(() => remasterGuard()))) throw Error('Simulation guard changed');
    if (report.errors.length) throw Error(report.errors[0]);
    report.state = trial ? 'trial-needs-visual-review' : 'baseline-only';
  } catch (e) {
    report.reason = e.message;
    throw e;
  } finally {
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    console.log(report.state, folder);
  }
  return folder;
}
exports.capture = capture;
