// Injected by the local benchmark only; never loaded by the game. No simulation updates here.
window.measureFleetPasses = async function ({ r, w, fleet, frames, pose }) {
  const { lighting } = await import('/js/model.js');
  const { shadowReach } = await import('/js/gfx.js');
  const dev = r.renderer,
    gl = dev.getContext(),
    im = r.instances,
    sh = r.shadows;
  if (!dev.isWebGLRenderer || !r.shadowsOn || !sh || !im || im.jobs || im.fleetLod || gl.isContextLost())
    throw Error('Expected warmed WebGL shadows, full detail, and main-thread collection');
  const check = (ok, why) => {
    if (!ok) throw Error(why);
  };
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [],
    gpu = { shadow: [], main: [] };
  const off = [],
    hidden = [],
    pixel = new Uint8Array(4);
  const wrap = (o, key, fn) => {
    const own = Object.hasOwn(o, key),
      old = o[key];
    o[key] = fn(old);
    off.push(() => {
      if (own) o[key] = old;
      else delete o[key];
    });
  };
  const queries = !!ext && !gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY);
  let mode,
    row,
    probeGpu,
    active,
    disjoint = false,
    poseKey;
  function gpuBegin(key) {
    if (!probeGpu || !queries) return;
    check(!active, 'Nested timing query');
    active = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    pending.push({ key, q: active });
  }
  function gpuEnd() {
    if (!active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    active = null;
  }
  function restoreVisibility() {
    for (const obj of hidden) obj.visible = true;
    hidden.length = 0;
  }
  const auto = dev.info.autoReset,
    shake = r.rig.shake;
  const stats = dev.info.render;
  // All six possible orders: each control is first/last equally often.
  const modes = ['full', 'reuseMap', 'noMobileColor'];
  const orders = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
    [0, 2, 1],
    [1, 0, 2]
  ];
  const rows = Object.fromEntries(modes.map(m => [m, []]));
  const casterWork = units =>
    units.reduce(
      (t, u) => {
        if (!u.dead && u.obj?.visible && u.casters)
          for (const m of u.casters) {
            t.meshes++;
            t.triangles += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
          }
        return t;
      },
      { meshes: 0, triangles: 0 }
    );
  const casters = { mobile: casterWork(fleet), all: casterWork(w.units) };
  try {
    dev.info.autoReset = false;
    r.rig.shake = 0;
    wrap(r.fxParticles, 'update', () => () => {});
    wrap(
      r,
      'updateShadows',
      old =>
        function (...args) {
          if (mode === 'reuseMap') return;
          const t = performance.now();
          old.apply(this, args);
          row.shadowCpuMs = performance.now() - t;
        }
    );
    wrap(
      dev,
      'setRenderTarget',
      old =>
        function (target, ...args) {
          if (target === sh.target) gpuBegin('shadow');
          else if (this.getRenderTarget() === sh.target) gpuEnd();
          return old.call(this, target, ...args);
        }
    );
    wrap(
      im,
      'collect',
      old =>
        function (...args) {
          if (mode === 'noMobileColor')
            for (const u of fleet)
              if (u.obj.visible) {
                u.obj.visible = false;
                hidden.push(u.obj);
              }
          const t = performance.now();
          old.apply(this, args);
          row.collectMs = performance.now() - t;
        }
    );
    wrap(
      im,
      'restore',
      old =>
        function (...args) {
          try {
            return old.apply(this, args);
          } finally {
            restoreVisibility();
          }
        }
    );
    wrap(
      dev,
      'render',
      old =>
        function (scene, ...args) {
          const key = scene === r.scene ? 'main' : scene === sh.scene ? 'shadow' : null;
          if (!key) return old.call(this, scene, ...args);
          const c = stats.calls,
            tr = stats.triangles;
          if (key === 'main') gpuBegin(key);
          const t = performance.now();
          try {
            return old.call(this, scene, ...args);
          } finally {
            row[key + 'SubmitMs'] = performance.now() - t;
            if (key === 'main') gpuEnd();
            row[key + 'Calls'] = stats.calls - c;
            row[key + 'Triangles'] = stats.triangles - tr;
            row[key + 'Passes']++;
          }
        }
    );
    function sample(m, probe = false) {
      mode = m;
      probeGpu = probe;
      row = { shadowCpuMs: 0, shadowSubmitMs: 0, shadowCalls: 0, shadowTriangles: 0, shadowPasses: 0, mainPasses: 0 };
      dev.info.reset();
      const t = performance.now();
      r.render(w, 0);
      row.jsMs = performance.now() - t;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      row.wallMs = performance.now() - t;
      row.calls = stats.calls;
      row.triangles = stats.triangles;
      check(row.mainPasses === 1 && row.shadowPasses === +(m !== 'reuseMap') && row.collectMs >= 0, 'Unexpected pass sequence');
      check(
        !hidden.length && lighting.shadowOn.value === 1 && lighting.shadowMap.value === sh.target.depthTexture,
        'Receiver or visibility changed'
      );
      return row;
    }
    function key() {
      return [...r.camera.matrixWorld.elements, ...lighting.shadowMatrix.value.elements].join(',');
    }
    for (let i = 0; i < 12; i++) {
      pose(i * 4);
      sample('full');
      sample(modes[i % 3]);
    }
    if (queries) gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (let i = 0; i < frames; i++) {
      pose(i);
      const prime = sample('full', true); // Exact map for THIS pose, outside the three timed arms.
      poseKey = key();
      for (const j of orders[i % 6]) {
        const m = modes[j],
          a = sample(m);
        check(key() === poseKey, 'View or shadow matrix changed at a frozen pose');
        if (m !== 'reuseMap')
          check(a.shadowCalls === prime.shadowCalls && a.shadowTriangles === prime.shadowTriangles, 'Color mask affected shadows');
        if (m === 'noMobileColor') check(a.mainTriangles < prime.mainTriangles, 'Mobile color mask removed no geometry');
        else check(a.mainCalls === prime.mainCalls && a.mainTriangles === prime.mainTriangles, 'Main geometry changed when reusing a map');
        rows[m].push(a);
      }
    }
    if (queries) {
      const until = performance.now() + 3000;
      while (pending.some(({ q }) => !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) && performance.now() < until)
        await new Promise(ok => setTimeout(ok, 10));
      disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint)
        for (const { q, key } of pending)
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu[key].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    }
    check(!gl.isContextLost(), 'WebGL context lost');
    const dist = nums => {
      const a = nums.slice().sort((x, y) => x - y);
      const q = p => +a[Math.ceil(a.length * p) - 1].toFixed(3);
      return a.length ? { p50: q(0.5), p95: q(0.95) } : null;
    };
    const summary = Object.fromEntries(
      modes.map(m => [
        m,
        Object.fromEntries(
          Object.keys(rows[m][0])
            .filter(k => !k.endsWith('Passes'))
            .map(k => [k, dist(rows[m].map(x => x[k]))])
        )
      ])
    );
    const paired = (control, fn) => dist(rows.full.map((a, i) => fn(a) - fn(rows[control][i])));
    return {
      shadowSize: sh.size,
      shadowReach: shadowReach(),
      casters,
      collectWorkers: 0,
      summary,
      paired: {
        shadowWallMs: paired('reuseMap', a => a.wallMs),
        mobileWallMs: paired('noMobileColor', a => a.wallMs),
        mobileCollectMs: paired('noMobileColor', a => a.collectMs),
        mobileMainSubmitMs: paired('noMobileColor', a => a.mainSubmitMs),
        mobileCollectAndSubmitMs: paired('noMobileColor', a => a.collectMs + a.mainSubmitMs)
      },
      gpuElapsedMs: {
        available: queries,
        disjoint,
        shadowSamples: gpu.shadow.length,
        mainSamples: gpu.main.length,
        shadow: dist(gpu.shadow),
        main: dist(gpu.main)
      }
    };
  } finally {
    gpuEnd();
    for (const { q } of pending) gl.deleteQuery(q);
    restoreVisibility();
    while (off.length) off.pop()();
    dev.info.autoReset = auto;
    r.rig.shake = shake;
  }
};
