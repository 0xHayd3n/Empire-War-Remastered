// Runs inside a paused, mounted battle. Same phase, direction, seed, palette and cloud
// scroll. Change ONLY the presentation clock used to choose formations; never write w.time.
module.exports = async function formationReadback() {
  const T = await import('three'),
    g = window.game,
    w = g.world,
    r = g.gpuOn ? g.gpu : g.renderer,
    library = g.immersiveWeather,
    U = library.uniforms,
    ctx = g.skyEntry.context,
    before = JSON.stringify([w.time, w.weather]),
    W = 144,
    H = 96,
    rt = new T.WebGLRenderTarget(W, H),
    eye = new T.PerspectiveCamera(82, W / H, 1, 1500),
    previous = r.getRenderTarget(),
    keep = r.autoClear;
  eye.up.set(0, 0, 1);
  eye.position.copy(g.sky.children[0].position);
  eye.lookAt(eye.position.clone().add(new T.Vector3(-0.32, 1, 0.32)));
  eye.updateMatrixWorld(true);
  async function pixels(t) {
    library.sample(ctx, w.weather, t);
    r.setRenderTarget(rt);
    r.clear();
    r.render(g.sky, eye);
    if (r.pendingPipelines?.().length) {
      r.endFrame();
      await r.settle();
      r.clear();
      r.render(g.sky, eye);
    }
    const bytes = new Uint8Array(W * H * 4);
    await r.readRenderTargetPixelsAsync(rt, 0, 0, W, H, bytes);
    return bytes;
  }
  const signature = () => [...U.wxFormation.value.toArray(), ...U.wxPhenomena.value.toArray()];
  try {
    r.autoClear = false;
    const first = await pixels(w.time),
      palette = U.wxZenith.value.toArray().join(),
      start = signature();
    let gap = 0,
      next = w.time;
    for (let j = 1; j <= 20; j++) {
      const t = w.time + j * 23;
      library.sample(ctx, w.weather, t);
      const delta = signature().reduce((n, x, i) => n + (x - start[i]) ** 2, 0);
      if (delta > gap) {
        gap = delta;
        next = t;
      }
    }
    const second = await pixels(next);
    if (U.wxZenith.value.toArray().join() !== palette) throw Error('Formation control changed sky colour');
    const restored = await pixels(w.time);
    let changed = 0,
      drift = 0;
    for (let i = 0; i < first.length; i += 4) {
      if (Math.max(...[0, 1, 2].map(k => Math.abs(first[i + k] - second[i + k]))) >= 2) changed++;
      if (first[i] !== restored[i] || first[i + 1] !== restored[i + 1] || first[i + 2] !== restored[i + 2]) drift++;
    }
    if (drift || changed < W * H * 0.005 || JSON.stringify([w.time, w.weather]) !== before)
      throw Error('Formation readback failed ' + JSON.stringify({ drift, changed, gap }));
    return { changed, total: W * H, restored: true };
  } finally {
    library.sample(ctx, w.weather, w.time);
    r.setRenderTarget(previous);
    r.autoClear = keep;
    r.releaseTarget?.(rt);
    rt.dispose();
  }
};
