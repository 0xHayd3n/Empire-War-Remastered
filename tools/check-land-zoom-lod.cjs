// Mounted rAF FPS and actual main scene submissions. REF_DIR is the unmodified JS snapshot.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../public/js'),
  maps = (process.env.LOOK_WORLD || 'endor').split(','),
  ref = process.env.REF_DIR,
  gl = process.env.LOOK_BACKEND === 'webgl';
const frames = +(process.env.BENCH_FRAMES || 240),
  pairs = +(process.env.BENCH_PAIRS || 1),
  reports = [];
const live = new Map();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.js')) live.set(path.relative(root, f).split(path.sep).join('/'), fs.readFileSync(f));
  }
}
walk(root);
const old = new Map(live);
if (ref)
  for (const f of ['game/land-detail.js', 'game/land-index-lod.js', 'game/scenery-lod-worker.js', 'game/scenery-lod.js', 'game/endor-thicket.js', 'game/jungle-canopy.js']) {
    const p = path.join(ref, f);
    if (fs.existsSync(p)) old.set(f, fs.readFileSync(p));
    else old.delete(f);
  }
async function route(_, { map, frames }) {
  const wait = () => new Promise(requestAnimationFrame),
    end = performance.now() + 150000;
  while (!(window.game?.remasteredGround && game.world.time > 0.2 && !game.warming)) {
    if (performance.now() > end) throw Error('Map did not warm');
    await wait();
  }
  const g = game,
    R = g.gpuOn ? g.gpu : g.renderer;
  g.modeSuspended = true;
  await wait();
  g.following = null;
  const env = g.map.environments.find(e => e.name === 'Noon_Clear') || g.map.environment;
  await g.applyEnvironment(env);
  g.world.setWeather(env.weather);
  const u = g.world.units.find(u => u.foot && u.side === g.me),
    [cx, cy] = map === 'endor' ? [1460, 3120] : [Math.round(u.x), Math.round(u.y)],
    submit = R.render,
    raf = window.requestAnimationFrame;
  let clock = g.last,
    tris = 0,
    calls = 0,
    count = 0;
  R.render = function (s, c, ...a) {
    const t = this.info.render.triangles,
      b = this.info.render.calls;
    const r = submit.call(this, s, c, ...a);
    if (c === g.camera && s === g.scene) {
      tris += this.info.render.triangles - (this.info.autoReset ? 0 : t);
      calls += this.info.render.calls - (this.info.autoReset ? 0 : b);
      count++;
    }
    return r;
  };
  function frame(i, dist, pitch) {
    const t = (2 * Math.PI * (i % 120)) / 120;
    Object.assign(g.view, { x: cx + 140 * Math.sin(t), y: cy + 37 * Math.sin(t), dist, pitch, yaw: -1.1 + 0.16 * Math.cos(t) });
    g.modeSuspended = false;
    window.requestAnimationFrame = cb => (cb === g.frame ? 0 : raf.call(window, cb));
    try {
      g.frame((clock += 1000 / 60));
    } finally {
      window.requestAnimationFrame = raf;
      g.modeSuspended = true;
    }
  }
  const views = [];
  for (const [name, dist, pitch] of [
    ['near', 190, 1],
    ['overhead', 2800, 1.27],
    ['horizon', 2800, 0.25]
  ]) {
    for (let i = 0; i < 120; i++) {
      await wait();
      frame(i, dist, pitch);
    }
    await R.settle?.();
    tris = calls = count = 0;
    const dt = [];
    let last = await wait();
    for (let i = 0; i < frames; i++) {
      frame(i, dist, pitch);
      let now = await wait();
      dt.push(now - last);
      last = now;
    }
    const elapsed = dt.reduce((a, b) => a + b, 0);
    const group = g.scene.getObjectByName('Endor map-wide old growth');
    const canopy=[];g.scene.traverse(o=>{if(o.userData.foliage?.role==='canopy')canopy.push(o)});
    const levels = (group?.children || canopy).map(im => ({
        name: im.name,
        n: im.count,
        tris: im.geometry.index.count / 3,
        blend: im.material.transparent
      }));
    views.push({
      name,
      elapsed,
      frames,
      fps: (1000 * frames) / elapsed,
      p95: dt.sort((a, b) => a - b)[Math.ceil(0.95 * frames) - 1],
      tris: Math.round(tris / count),
      calls: Math.round(calls / count),
      levels
    });
  }
  return { views, gpu: !!g.gpuOn, canvas: [R.domElement.width, R.domElement.height], pivot: [cx, cy], units: g.world.units.length };
}
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (let pair = 0; pair < pairs; pair++)
      for (const map of maps)
        for (const build of !ref ? ['current'] : pair % 2 ? ['current', 'reference'] : ['reference', 'current']) {
          const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
          try {
            const modules = build === 'current' ? live : old;
            await ctx.route(
              u => u.pathname.startsWith('/js/') && u.pathname.endsWith('.js'),
              r => r.fulfill({ contentType: 'application/javascript', body: modules.get(new URL(r.request().url()).pathname.slice(4)) })
            );
            await ctx.addInitScript(gl => {
              let s = 99217;
              Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
              if (gl) sessionStorage.setItem('swr-webgpu-dropped', '1');
            }, gl);
            let p = await ctx.newPage(),
              errs = [];
            p.on('pageerror', e => errs.push(e.message));
            p.on('console', m => {
              if (/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)/i.test(m.text()))
                errs.push(m.text().slice(0, 500));
            });
            await p.goto('http://127.0.0.1:8590/#' + map + (map === 'endor' ? '-ultra' : '-remaster'));
            const result = await p.frameLocator('#game').locator('body').evaluate(route, { map, frames });
            assert.deepEqual(errs, []);
            assert.equal(result.gpu, !gl);
            const match = reports.find(r => r.map === map);
            if (match) for (const k of ['units', 'pivot', 'canvas']) assert.deepEqual(match[k], result[k]);
            reports.push({ map, build, pair, ...result });
            if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify(reports, null, 2));
            console.log(map, build, pair + 1, JSON.stringify(result.views.map(({ levels, ...r }) => r)));
            if (['endor','yavin'].includes(map) && build === 'current' && process.env.ASSERT_DISTANT) {
              assert(
                result.views.slice(1).every(v => v.levels.some(r => r.name.endsWith('distant') && r.n > 0)),
                'No distant forest geometry submitted at command zoom'
              );
              assert(
                result.views.every(v => v.levels.every(r => !r.blend)),
                'Introduced translucent forest draws'
              );
            }
          } finally {
            await ctx.close();
          }
        }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
