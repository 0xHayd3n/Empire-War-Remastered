// Mounted QA only. Time completed work (not just CPU submission). No timer, readback or
// performance recorder is installed in the game. Returns milliseconds, not display FPS.
module.exports = async function measureWeather(_, { limit, samples }) {
  const T = await import('three'),
    { gfx } = await import('/js/gfx.js'),
    g = window.game,
    w = g.world,
    r = g.gpuOn ? g.gpu : g.renderer,
    gpu = g.gpuOn,
    gl = gpu ? null : r.getContext(),
    W = r.domElement.width,
    H = r.domElement.height,
    rt = new T.WebGLRenderTarget(W, H),
    byte = new Uint8Array(4),
    original = r.getRenderTarget(),
    auto = r.autoClear,
    scope = gfx.immersiveWeather,
    state = JSON.stringify([w.time, w.weather]);
  async function barrier(sky) {
    if (gpu) {
      r.endFrame();
      await r.device.queue.onSubmittedWorkDone();
    } else {
      const pbo = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      try {
        if (sky) r.readRenderTargetPixels(rt, 0, 0, 1, 1, byte);
        else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, byte);
      } finally {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      }
    }
  }
  async function one(sky) {
    if (sky) {
      r.setRenderTarget(rt);
      for (let pass = 0; pass < 8; pass++) {
        r.clear();
        r.render(g.sky, g.camera);
      }
    } else {
      g.warming = true;
      g.modeSuspended = false;
      try {
        g.frame(g.last);
      } finally {
        g.modeSuspended = true;
        g.warming = false;
      }
    }
    await barrier(sky);
  }
  function quantiles(x) {
    x.sort((a, b) => a - b);
    const q = p => Number(x[Math.ceil(p * x.length) - 1].toFixed(2));
    return { median: q(0.5), p95: q(0.95) };
  }
  const by = { off: { sky: [], frame: [] }, all: { sky: [], frame: [] } };
  try {
    for (const mode of ['off', 'all', 'all', 'off']) {
      r.setRenderTarget(original);
      await window.paintWeather(mode);
      await barrier(false);
      for (const name of ['frame', 'sky']) {
        const sky = name === 'sky';
        r.setRenderTarget(original);
        await one(sky);
        await r.settle?.();
        await one(sky);
        for (let i = 0; i < samples; i++) {
          const start = performance.now();
          await one(sky);
          by[mode][name].push((performance.now() - start) / (sky ? 8 : 1));
        }
      }
    }
    const result = { pixels: [W, H], samples: 2 * samples };
    for (const mode in by) result[mode] = Object.fromEntries(Object.entries(by[mode]).map(([n, x]) => [n, quantiles(x)]));
    if (state !== JSON.stringify([w.time, w.weather])) throw Error('Cost probe advanced the forecast');
    if (limit && result.all.sky.median > limit) throw Error('Sky budget exceeded: ' + JSON.stringify(result));
    return result;
  } finally {
    r.setRenderTarget(original);
    r.autoClear = auto;
    gfx.immersiveWeather = scope;
    await g.selectLandSky();
    r.releaseTarget?.(rt);
    rt.dispose();
  }
};
