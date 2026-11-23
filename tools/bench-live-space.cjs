// Live RAF/worker profile. DevTools payloads stay in memory; only aggregate counters leave this process.
const assert = require('node:assert/strict');
const q = (a, p) =>
  a.length
    ? +a
        .slice()
        .sort((x, y) => x - y)
        [Math.ceil(a.length * p) - 1].toFixed(3)
    : null;
const dist = a => ({ p50: q(a, 0.5), p95: q(a, 0.95) });

async function observe(traced) {
  const g = window.game,
    r = g.renderer,
    dev = r.renderer,
    gl = dev.getContext(),
    im = r.instances;
  if (!g.mirror?.ready || !g.mirror.worker || !dev.isWebGLRenderer || g.modeSuspended || g.paused || g.lock || !im || !g.diag)
    throw Error('Not a live worker-driven WebGL battle');
  if (g.world.time > 8) throw Error('Missed start of live window');
  const workers = () => ({
    simulation: g.mirror.ready && !!g.mirror.worker,
    helpers: g.mirror.jobWorkers.length,
    collection: im.jobs?.workers.length || 0,
    isolated: crossOriginIsolated
  });
  const fleet = () => g.world.units.filter(u => !u.dead && u.isMobile && u.player.id >= 0 && u.obj);
  const snap = () => ({
    time: +g.world.time.toFixed(3),
    records: g.mirror.stats.records,
    eventsFailed: g.mirror.stats.failed,
    ships: fleet().length,
    shots: g.world.projectiles.length,
    workers: workers(),
    gpuFrames: g.diag.gpuFrames || 0,
    gpuTotal: g.diag.gpuTotal || 0
  });
  const mark = id => {
    if (traced) {
      performance.mark(id);
      performance.clearMarks(id);
    }
  };
  const oldRender = r.render,
    oldMain = dev.render,
    oldCollect = im.collect;
  const rows = [];
  let row, start, points, timer, done, fail;
  const finished = new Promise((ok, no) => {
    done = ok;
    fail = no;
  });
  try {
    dev.render = function (scene, ...args) {
      if (scene !== r.scene || !row) return oldMain.call(this, scene, ...args);
      const c = dev.info.render.calls,
        tr = dev.info.render.triangles;
      mark('fleetStart' + rows.length);
      const t = performance.now();
      try {
        return oldMain.call(this, scene, ...args);
      } finally {
        row.mainMs = performance.now() - t;
        mark('fleetEnd' + rows.length);
        row.calls = dev.info.render.calls - c;
        row.tris = dev.info.render.triangles - tr;
      }
    };
    im.collect = function (...args) {
      const t = performance.now();
      try {
        return oldCollect.apply(this, args);
      } finally {
        if (row) {
          row.collectMs = performance.now() - t;
          row.jobs = im.jobs?.count || 0;
        }
      }
    };
    r.render = function (...args) {
      const s = g.world.time,
        phase = 2 * Math.PI * Math.max(0, Math.min(1, (s - 8) / 6));
      r.rig.x = 350 * Math.sin(phase);
      r.rig.y = 250 * Math.cos(phase);
      r.rig.dist = 3900 + 900 * Math.cos(phase);
      r.rig.yaw = 0.25 * phase;
      if (s >= 14) {
        done();
        return oldRender.apply(this, args);
      }
      if (s < 8) return oldRender.apply(this, args);
      if (!start) {
        start = snap();
        points = new Map(fleet().map(u => [u, [u.x, u.y]]));
      }
      row = { raf: g.last };
      try {
        return oldRender.apply(this, args);
      } finally {
        rows.push(row);
        row = null;
      }
    };
    timer = setTimeout(() => fail(Error('Live simulation did not advance through window')), 90000);
    await finished;
    const end = snap(),
      moved = fleet().filter(u => points?.has(u) && Math.hypot(u.x - points.get(u)[0], u.y - points.get(u)[1]) > 1).length;
    if (
      !start ||
      rows.length < 15 ||
      end.time - start.time < 5 ||
      end.records <= start.records ||
      !moved ||
      !start.workers.isolated ||
      !(end.workers.simulation && start.workers.collection > 0 && end.workers.collection === start.workers.collection) ||
      !rows.some(a => a.jobs > 0) ||
      end.eventsFailed !== start.eventsFailed ||
      !rows.every(a => a.calls > 0 && a.tris > 0 && a.collectMs >= 0)
    )
      throw Error(
        'Missing motion, clean mirror advance, or main-scene draws: ' + JSON.stringify({ start, end, moved, frames: rows.length })
      );
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      map: g.setup.mapFile,
      factions: g.setup.teamFactions,
      start,
      end,
      moved,
      rows,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
    };
  } finally {
    clearTimeout(timer);
    dev.render = oldMain;
    im.collect = oldCollect;
    r.render = oldRender;
  }
}

async function profileLive(page, traced) {
  await page.waitForFunction(() => window.game?.mirror?.ready && window.game.world.time >= 4 && window.game.renderer.instances, null, {
    timeout: 180000
  });
  const session = await page.context().newCDPSession(page);
  const events = [];
  let cp,
    lost = false;
  if (traced) {
    session.on('Tracing.dataCollected', ({ value }) => {
      for (const { pid, tid, ts, tts, ph, cat, name, dur } of value)
        if (
          (cat?.includes('gpu') && ph === 'X' && commandWait.test(name)) ||
          (cat?.includes('blink.user_timing') && /^fleet(Start|End)\d+$/.test(name))
        )
          events.push({ pid, tid, ts, tts, ph, name, dur });
    });
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 500 });
    await session.send('Profiler.start');
    await session.send('Tracing.start', { categories: '-*,blink.user_timing,gpu', transferMode: 'ReportEvents' });
  }
  let data;
  try {
    data = await page.evaluate(observe, traced);
  } finally {
    if (traced) {
      const end = new Promise(ok => session.once('Tracing.tracingComplete', ok));
      await session.send('Tracing.end');
      cp = (await session.send('Profiler.stop')).profile;
      lost = !!(await end).dataLossOccurred;
    }
    await session.detach();
  }
  const { rows, start, end, ...meta } = data;
  const trace = traced ? reduceTrace(events, cp, rows.length, lost) : null;
  const gpuFrames = end.gpuFrames - start.gpuFrames,
    gpuMs = gpuFrames ? +((end.gpuTotal - start.gpuTotal) / gpuFrames).toFixed(3) : null;
  for (const s of [start, end]) {
    delete s.gpuTotal;
    delete s.gpuFrames;
  }
  return {
    ...meta,
    traced,
    frames: rows.length,
    start,
    end,
    gpuFrameMeanMs: gpuMs,
    gpuFrameSamples: gpuFrames,
    mainSubmitMs: dist(rows.map(x => x.mainMs)),
    collectionMs: dist(rows.map(x => x.collectMs)),
    collectionJobs: dist(rows.map(x => x.jobs)),
    mainCalls: dist(rows.map(x => x.calls)),
    mainTriangles: dist(rows.map(x => x.tris)),
    rafIntervalMs: dist(rows.slice(1).map((x, i) => x.raf - rows[i].raf)),
    trace
  };
}
// Explicit synchronous command-buffer waits, NOT all Flush/OrderingBarrier calls.
const commandWait =
  /^(?:CommandBufferHelper::WaitForAvailableEntries\d*|CommandBufferProxyImpl::WaitFor(?:GetOffset|Token)(?:InRange)?|ImplementationBase::WaitForCmd)$/;
function reduceTrace(events, cp, n, lost) {
  assert.ok(!lost, 'Chrome lost trace data');
  const starts = events.filter(e => /^fleetStart\d+$/.test(e.name)).sort((a, b) => a.ts - b.ts);
  const ends = new Map(events.filter(e => /^fleetEnd\d+$/.test(e.name)).map(e => [e.name.slice(8), e]));
  assert.equal(starts.length, n, 'Missing trace markers');
  const spans = starts.map((e, i) => {
    const f = ends.get('' + i);
    assert.ok(f && e.name === 'fleetStart' + i && e.pid === f.pid && e.tid === f.tid && f.ts >= e.ts);
    return { s: e.ts, e: f.ts, cpu: e.tts != null && f.tts != null ? (f.tts - e.tts) / 1000 : null };
  });
  assert.ok(n > 0 && cp.startTime <= spans[0].s && cp.endTime >= spans[n - 1].e, 'Profiler/trace clocks do not bracket measured draws');
  assert.equal(ends.size, n);
  const intervals = events
    .filter(e => e.pid === starts[0].pid && e.tid === starts[0].tid && e.ph === 'X' && e.dur > 0 && commandWait.test(e.name))
    .sort((a, b) => a.ts - b.ts);
  // Union nested helper/proxy waits so their overlap is never counted twice.
  const merged = [];
  for (const v of intervals) {
    const last = merged.at(-1),
      end = v.ts + v.dur;
    if (last && last.e >= v.ts) last.e = Math.max(last.e, end);
    else merged.push({ s: v.ts, e: end });
  }
  let cursor = 0;
  for (const [i, span] of spans.entries()) {
    assert.ok(i === 0 || spans[i - 1].e <= span.s);
    while (cursor < merged.length && merged[cursor].e <= span.s) cursor++;
    let us = 0;
    for (let j = cursor; j < merged.length && merged[j].s < span.e; j++)
      us += Math.min(span.e, merged[j].e) - Math.max(span.s, merged[j].s);
    span.wait = us / 1000;
  }
  const nodes = new Map(cp.nodes.map(n => [n.id, n]));
  const buckets = {};
  let ts = cp.startTime,
    i = 0;
  for (let k = 0; k < cp.samples.length; k++) {
    ts += cp.timeDeltas[k];
    while (i < spans.length && ts > spans[i].e) i++;
    if (i === spans.length) break;
    if (ts < spans[i].s) continue;
    const f = nodes.get(cp.samples[k])?.callFrame,
      name = f?.functionName || '';
    const b = /^\(.*\)$/.test(name)
      ? 'runtime'
      : /^(draw|buffer|tex|uniform|vertexAttrib|bind|useProgram|blend|enable|disable)/i.test(name) && !f.url
        ? 'webgl'
        : /projectObject|sortObjects|push|frustum|intersects/i.test(name)
          ? 'traverseSort'
          : /upload|updateBuffer|setValue|setUniform|setProgram|bindTextures/i.test(name)
            ? 'uploadState'
            : f?.url?.includes('three')
              ? 'otherThree'
              : 'other';
    buckets[b] = (buckets[b] || 0) + 1;
  }
  const cpu = spans.filter(s => s.cpu != null);
  return {
    markedFrames: n,
    elapsedMs: dist(spans.map(s => (s.e - s.s) / 1000)),
    threadCpuSamples: cpu.length,
    threadCpuMs: dist(cpu.map(s => s.cpu)),
    offCpuMs: dist(cpu.map(s => (s.e - s.s) / 1000 - s.cpu)),
    commandWaitMs: dist(spans.map(s => s.wait)),
    framesWithCommandWait: spans.filter(s => s.wait > 0).length,
    leafSamples: buckets
  };
}
module.exports = { profileLive, reduceTrace };
