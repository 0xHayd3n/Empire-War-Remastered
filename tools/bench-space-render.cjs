// Run against a trusted local checkout and a game install (see docs/fleet-render.md).
const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const args = process.argv.slice(2),
  value = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const root = path.resolve(value('--root', '.')),
  mod = value('--primary', ''),
  map = value('--map', 'KUAT');
const frames = 48,
  ticks = 240,
  split = args.includes('--passes'),
  live = args.includes('--live'),
  size = /^(\d+)x(\d+)$/.exec(value('--size', split || live ? '1920x1080' : '800x450'));
if (live && (split || args.includes('--fleet-lod'))) throw Error('Use --live separately from frozen render modes');
if (!live && args.includes('--untraced')) throw Error('--untraced is a control for --live');
if (!size || size.slice(1).some(n => +n < 240 || +n > 3840)) throw Error('Expected --size WIDTHxHEIGHT (240..3840)');
if (split && args.includes('--fleet-lod')) throw Error('Run --passes with full detail, without --fleet-lod');

async function measure({ frames, ticks, split }) {
  const g = window.game,
    w = g.world,
    r = g.renderer,
    device = r.renderer,
    gl = device.getContext();
  if (!g.modeSuspended || g.mirror || g.lock) throw Error('Expected the isolated local simulation');
  const { seedSim } = await import('/js/game/simrandom.js');
  seedSim(7091);
  window.resetBenchRandom();
  for (let i = 0; i < ticks; i++) w.update(1 / 30);
  g.remember();
  g.present(1);
  const fleet = w.units.filter(u => !u.dead && u.isMobile && u.player.id >= 0 && u.obj);
  const shots = w.projectiles.length;
  if (fleet.length < 20 || !shots) throw Error(`Insufficient fleet or weapon activity: ${fleet.length} ships / ${shots} shots`);
  // Check factions, unit roster and positions, and projectile pattern across runs (not particle RNG).
  const shape = [
    g.setup.mapFile,
    g.setup.teamFactions,
    fleet.map(u => [u.type.name, u.model?.model?.name || '', u.x.toFixed(2), u.y.toFixed(2)]),
    w.projectiles.map(p => [p.def.name, p.x.toFixed(2), p.y.toFixed(2)])
  ];
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(shape))))]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  const { texturesReady } = await import('/js/dds.js');
  // Pre-roll render-only effects before freezing their batches. No simulation time advances.
  for (let i = 0; i < 12; i++) {
    r.render(w, 1 / 30);
    await new Promise(ok => setTimeout(ok, 20));
  }
  await texturesReady();
  const deadline = performance.now() + 10000;
  while (r.fxParticles.busy) {
    if (performance.now() > deadline) throw Error('Particle worker did not settle');
    await new Promise(ok => setTimeout(ok, 10));
  }
  const lod = { withAlternates: 0, ships: fleet.length };
  for (const u of fleet) {
    const groups = new Set();
    if (
      u.model?.model.meshes.some(m => {
        const match = /^(.*)_LOD\d$/i.exec(m.name);
        if (!match) return false;
        const k = match[1].toUpperCase();
        if (groups.has(k)) return true;
        groups.add(k);
        return false;
      })
    )
      lod.withAlternates++;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const metadata = {
    hash,
    map: g.setup.mapFile,
    factions: g.setup.teamFactions,
    shots,
    lod,
    framesPerMode: frames,
    particles: r.fxParticles.total,
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
  };
  const pose = k => {
    const angle = (2 * Math.PI * k) / frames;
    r.rig.x = 350 * Math.sin(angle);
    r.rig.y = 250 * Math.cos(angle);
    r.rig.dist = 3900 + 900 * Math.cos(angle);
    r.rig.yaw = angle * 0.25;
  };
  if (split) return { ...metadata, ...(await window.measureFleetPasses({ r, w, fleet, frames, pose })) };
  const pilot = new URLSearchParams(location.search).get('fleetlod') === '1';
  const modes = pilot ? ['full', 'fullDetail'] : ['full', 'noHulls', 'noWeapons', 'noParticles'];
  const savedUpdate = r.fxParticles.update,
    savedDraw = r.draw;
  r.fxParticles.update = () => {};
  // Mask only during draw, after normal scene preparation. Hull masking includes their shadow casters.
  let mode = 'full';
  r.draw = function (...args) {
    let objs = [];
    if (mode === 'noHulls') objs = fleet.map(u => u.obj);
    if (mode === 'noWeapons') objs = [r.bolts.mesh, r.pills.mesh, r.kites.mesh, r.tractor?.mesh, ...r.shotModels.pools.map(p => p.im)];
    if (mode === 'noParticles') objs = [r.sprites.mesh, ...[...r.fxParticles.batches.values()].map(b => b.mesh)];
    const shown = objs.filter(o => o?.visible);
    for (const o of shown) o.visible = false;
    if (pilot) r.instances.fleetLod = mode !== 'fullDetail';
    try {
      return savedDraw.apply(this, args);
    } finally {
      if (pilot) r.instances.fleetLod = true;
      for (const o of shown) o.visible = true;
    }
  };
  const pixel = new Uint8Array(4),
    sample = k => {
      pose(k);
      device.info.reset();
      const t = performance.now();
      r.render(w, 0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // Include completion, not just JS submission.
      return { ms: performance.now() - t, calls: device.info.render.calls, tris: device.info.render.triangles };
    };
  const rows = Object.fromEntries(modes.map(m => [m, []]));
  try {
    for (let i = 0; i < 12; i++) {
      mode = modes[i % modes.length];
      sample(i * 4);
    }
    for (let i = 0; i < frames; i++)
      for (let j = 0; j < modes.length; j++) {
        mode = modes[(i + j) % modes.length];
        rows[mode].push(sample(i));
      }
  } finally {
    r.draw = savedDraw;
    r.fxParticles.update = savedUpdate;
  }
  const q = (array, p) => array.slice().sort((a, b) => a - b)[Math.ceil(array.length * p) - 1];
  const results = {};
  for (const [m, a] of Object.entries(rows))
    results[m] = {
      medianMs: q(
        a.map(x => x.ms),
        0.5
      ),
      p95Ms: q(
        a.map(x => x.ms),
        0.95
      ),
      medianCalls: q(
        a.map(x => x.calls),
        0.5
      ),
      medianTriangles: q(
        a.map(x => x.tris),
        0.5
      )
    };
  let switchCheck = 'not applicable';
  const unit = pilot && fleet.find(u => u.instList?.some(e => e.farPool));
  if (unit) {
    // Isolate this unit after timing. Exercise the real collector and verify which pool received it.
    const im = r.instances,
      entry = unit.instList.find(e => e.farPool),
      rad = Math.max(unit.visualRadius, (unit.model.drawRadius || 0) * unit.obj.scale.x);
    const probe = dist => {
      r.camera.position.set(unit.x, unit.y - dist, unit.z || 0);
      r.camera.lookAt(unit.x, unit.y, unit.z || 0);
      r.camera.updateMatrixWorld();
      im.collect([unit], r.camera);
      try {
        return [entry.pool.n, entry.farPool.n];
      } finally {
        im.restore();
      }
    };
    const far = probe(rad * 100),
      near = probe(rad * 4),
      back = probe(rad * 100);
    if (!(far[1] > 0 && near[1] === 0 && near[0] > 0 && back[1] > 0)) throw Error('Authored mesh zoom transition failed');
    switchCheck = 'alternate / original / alternate';
  }
  return { ...metadata, switchCheck, results };
}
(async () => {
  const { readLibrary } = await import(pathToFileURL(path.join(root, 'tools/workshop-library.mjs')).href);
  const l = readLibrary();
  if (!l.game || (mod && !l.items.get(mod))) throw Error('Missing installation or primary Workshop mod');
  const srv = spawn(process.execPath, ['server.mjs', '--port', '0', ...(mod ? ['--mod', l.items.get(mod).folder] : [])], {
    cwd: root,
    env: { ...process.env, SWR_GAME: l.game, SWR_MOD: '', SWR_STATIC: '' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  let browser;
  try {
    const base = await new Promise((ok, no) => {
      srv.once('error', no);
      srv.once('exit', n => no(Error('Server exited ' + n)));
      srv.stdout.on('data', b => {
        const u = /Game server: (http:\/\/127\.0\.0\.1:\d+)\//.exec(String(b));
        if (u) ok(u[1]);
      });
    });
    browser = await chromium.launch({ channel: 'chrome', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
    const viewport = { width: +size[1], height: +size[2] };
    const p = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    if (!live)
      await p.addInitScript(() => {
        let x;
        window.resetBenchRandom = () => (x = 1234);
        window.resetBenchRandom();
        Math.random = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
        let game;
        Object.defineProperty(window, 'game', {
          configurable: true,
          get() {
            return game;
          },
          set(v) {
            game = v;
            if (v?.setup?.benchmark) v.modeSuspended = true;
          }
        });
      });
    const query = new URLSearchParams({ benchmark: '40', map, faction: value('--faction', 'Empire'), enemy: value('--enemy', 'Rebel') });
    await p.goto(
      `${base}/play.html?${query}&webgl${live ? '' : '&nospaceworker&noscripts&nowarm'}${split ? '&nocollectjobs' : ''}${args.includes('--fleet-lod') ? '&fleetlod=1' : ''}`,
      {
        waitUntil: 'domcontentloaded'
      }
    );
    await p
      .waitForFunction(() => !!window.game?.world?.units.length, null, { timeout: 180000 })
      .catch(async e => {
        console.error(await p.evaluate(() => document.querySelector('#loadText')?.textContent?.slice(-300)), errors);
        throw e;
      });
    if (live) {
      const result = await require('./bench-live-space.cjs').profileLive(p, !args.includes('--untraced'));
      assert.deepEqual(result.drawingBuffer, [viewport.width, viewport.height]);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ primary: mod || 'stock', chrome: browser.version(), ...result }));
      return;
    }
    if (split) await p.addScriptTag({ path: path.join(__dirname, 'bench-fleet-passes.js') });
    const result = await p.evaluate(measure, { frames, ticks, split });
    if (split) assert.deepEqual(result.drawingBuffer, [viewport.width, viewport.height]);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ primary: mod || 'stock', fleetLod: args.includes('--fleet-lod'), ...result }));
  } finally {
    await browser?.close();
    srv.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
