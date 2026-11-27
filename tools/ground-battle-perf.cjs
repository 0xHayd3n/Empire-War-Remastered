// Portable stock solo performance probe. Use headed Chrome on the machine being
// measured, with Universal mounted. Timings are not a hardware certification.
// npm run bench:ground-battle -- --out=ground-perf.json [--contrast]
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const os = require('node:os'),
  fs = require('node:fs'),
  path = require('node:path');
const arg = (name, fallback) => process.argv.find(s => s.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = new URL(arg('url', 'http://127.0.0.1:8590/'));
if (base.pathname !== '/') throw Error('Use the outer Universal mount at /');
base.hash = 'ground-offensive';
const seconds = Number(arg('seconds', 15)),
  throttle = Number(arg('throttle', 4));
if (!(seconds >= 1 && seconds <= 300 && throttle >= 1 && throttle <= 20)) throw Error('Expected --seconds=1..300 and --throttle=1..20');
const out = path.resolve(arg('out', 'ground-perf.json'));
const headless = arg('headless', '0') === '1';
const summary = values => {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b),
    pct = p => +s[Math.ceil(s.length * p) - 1].toFixed(3);
  return { n: s.length, p50: pct(0.5), p95: pct(0.95), max: pct(1) };
};
async function measure(rate) {
  // Each launch creates its own temporary browser profile, discarded on close.
  const b = await chromium.launch({ channel: arg('channel', 'chrome'), headless });
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage(),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(base.href, { waitUntil: 'domcontentloaded' });
    const shell = p.frameLocator('#game');
    await shell.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 180000 });
    const frame = await (await p.locator('#game').elementHandle()).contentFrame();
    await frame.waitForFunction(() => window.game?.world?.weaponCasts?.enabled && game.vehicleWrecks && game.ui && !game.warming, null, {
      timeout: 120000
    });
    if (rate !== 1) {
      // A cross-origin iframe may own a separate renderer process. Attach the
      // slowdown to that target, not merely to its launcher page.
      let cdp;
      try {
        cdp = await ctx.newCDPSession(frame);
      } catch (e) {
        if (!/part of the parent|does not have a separate CDP session/i.test(e.message)) throw e;
        cdp = await ctx.newCDPSession(p);
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    }
    await p.bringToFront();
    const metadata = await frame.evaluate(() => {
      const g = game,
        w = g.world;
      if (!g.paused || g.speed !== 1 || g.setup.mode !== 'land' || g.setup.net || w.battlePhysicsRule !== 1)
        throw Error('Expected paused solo ground opening at normal speed');
      const r = g.gpuOn ? g.gpu : g.renderer,
        gl = r.getContext?.(),
        dbg = gl?.getExtension?.('WEBGL_debug_renderer_info');
      const canvas = r.domElement ?? r.canvas,
        info = r.device?.adapterInfo;
      return {
        backend: g.gpuOn || r.webgpu ? 'WebGPU' : gl ? 'WebGL' : 'unknown',
        webglRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        adapter: info
          ? {
              vendor: info.vendor,
              architecture: info.architecture,
              description: info.description,
              isFallback: info.isFallbackAdapter ?? null
            }
          : null,
        viewport: [innerWidth, innerHeight],
        canvas: canvas ? [canvas.width, canvas.height] : null,
        dpr: devicePixelRatio,
        physicsRule: w.battlePhysicsRule,
        map: g.setup.mapFile,
        visible: !document.hidden,
        chrome: navigator.userAgent
      };
    });
    await frame.evaluate(target => {
      const g = game,
        w = g.world,
        start = w.time,
        update = w.update,
        death = w.onDeath;
      const metrics = {
        calls: [],
        frames: [],
        frameCpu: [],
        deaths: {},
        start,
        aliveAtStart: w.units.filter(u => !u.dead).length,
        hidden: false,
        finished: false
      };
      window.__groundPerf = metrics;
      let sum = 0,
        prev = null;
      w.update = function (dt) {
        const begin = performance.now();
        try {
          return update.call(this, dt);
        } finally {
          const elapsed = performance.now() - begin;
          if (!g.paused && dt > 0) {
            metrics.calls.push(elapsed);
            sum += elapsed;
          }
        }
      };
      w.onDeath = function (u, ...rest) {
        metrics.deaths[u.side] = (metrics.deaths[u.side] || 0) + 1;
        return death?.call(this, u, ...rest);
      };
      const tick = now => {
        if (w.time > start && !g.paused) {
          if (prev === null) {
            metrics.firstSim = w.time;
            metrics.firstWall = now;
          } else {
            metrics.frames.push(now - prev);
            metrics.frameCpu.push(sum);
          }
          prev = now;
          sum = 0;
          metrics.hidden ||= document.hidden;
          if (w.time - start >= target) {
            metrics.end = w.time;
            metrics.lastWall = now;
            metrics.aliveAtEnd = w.units.filter(u => !u.dead).length;
            w.update = update;
            w.onDeath = death;
            metrics.finished = true;
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, seconds);
    await shell
      .locator('canvas')
      .first()
      .evaluate(c => c.ownerDocument.defaultView.focus());
    await p.keyboard.press('p');
    await frame.waitForFunction(() => !game.paused, null, { timeout: 5000 });
    await frame.waitForFunction(() => window.__groundPerf.finished, null, { polling: 300, timeout: Math.max(90000, seconds * 10000) });
    const m = await frame.evaluate(() => window.__groundPerf);
    if (!m.calls.length || !m.frames.length || !metadata.visible || m.hidden || errors.length)
      throw Error('Invalid sample: no updates, hidden document, or page error: ' + errors.join('; '));
    const elapsed = (m.lastWall - m.firstWall) / 1000,
      sim = m.end - m.firstSim;
    return {
      chromeVersion: b.version(),
      cpuThrottle: rate,
      metadata,
      simSeconds: +sim.toFixed(3),
      wallSeconds: +elapsed.toFixed(3),
      frameIntervalMs: summary(m.frames),
      worldUpdateMs: summary(m.calls),
      updateMsPerFrame: summary(m.frameCpu),
      firstTime: m.start,
      lastTime: m.end,
      alive: [m.aliveAtStart, m.aliveAtEnd],
      deathEventsBySide: m.deaths,
      errors
    };
  } finally {
    await b.close();
  }
}
(async () => {
  const report = {
    schema: 'ewr-ground-battle-perf/1',
    machine: {
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      ramGiB: Math.round(os.totalmem() / 2 ** 30),
      os: os.platform(),
      release: os.release()
    },
    headless,
    url: base.href,
    seconds,
    runs: []
  };
  for (const rate of process.argv.includes('--contrast') && throttle > 1 ? [1, throttle] : [1]) {
    const run = await measure(rate);
    report.runs.push(run);
    console.log(
      `${rate}x: ${run.simSeconds}s sim / ${run.wallSeconds}s wall; RAF p50/p95 ${run.frameIntervalMs.p50}/${run.frameIntervalMs.p95} ms; update p50/p95 ${run.worldUpdateMs.p50}/${run.worldUpdateMs.p95} ms`
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(out);
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
