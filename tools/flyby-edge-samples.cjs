// Run via LOOK_EDGES=1 node tools/check-destroyer-pass.cjs in the mounted Universal window.
module.exports = async function check(_, gl) {
  const T = await import('three'),
    { gfx } = await import('/js/gfx.js'),
    { texturesReady } = await import('/js/dds.js'),
    { frameDestroyer, passRoute, passSubject } = await import('/js/game/destroyer-pass.js'),
    { stockHull } = await import('/js/game/destroyer-detail.js');
  const g = game,
    w = g.world,
    r = g.renderer,
    R = r.renderer,
    cam = r.camera,
    gpu = r.gpu,
    P = r.post;
  if (!!gpu === gl || !g.setup.instant.armies.every(a => a.length === 100)) throw Error('Wrong renderer or fleet');
  g.modeSuspended = true;
  await new Promise(requestAnimationFrame);
  await texturesReady();
  const u = passSubject(g),
    route = passRoute(g, u),
    hull = stockHull(u),
    W = R.domElement.width,
    H = R.domElement.height;
  const jobs = r.instances?.jobs;
  if (r.instances) {
    r.instances.jobs = null;
    for (const v of w.units) if (v.obj && !v.dead) r.instances.scan(v);
  }
  r.flybySubject = u;
  // Fix lighting and effects for the reference. A cropped 6x render should not use a different
  // FXAA kernel, or have its bright pixels reach six times less far in a bloom pass.
  const effects = [P.flare, P.heat, P.bloom, gfx.postAA];
  P.flare = P.heat = P.bloom = false;
  gfx.postAA = 'off';
  const K = 6,
    cw = W / K,
    ch = H / K,
    frames = 12,
    images = {},
    samples = {},
    report = { width: W, height: H, counts: g.setup.instant.armies.map(a => a.length), frames, referenceScale: K };
  if (!Number.isInteger(cw) || !Number.isInteger(ch) || gfx.closeHullEdges !== true)
    throw Error('Invalid reference size or missing live toggle');
  function place(t) {
    cam.clearViewOffset();
    frameDestroyer(cam, u, 0.86 + t / (8 * 60), route);
  }
  function draw() {
    for (const sky of r.skydomes) sky.root.position.copy(cam.position);
    r.draw(w, R, 0);
  }
  async function shot() {
    draw();
    await r.destroyerLook?.probe?.ready;
    await r.orbitProbe?.ready;
    await gpu?.settle();
    const next = gpu?.readNext();
    draw();
    if (next) return (await next).data;
    const ctx = R.getContext(),
      inverted = new Uint8Array(W * H * 4),
      out = new Uint8Array(inverted.length);
    ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, inverted);
    for (let y = 0; y < H; y++) out.set(inverted.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    return out;
  }
  const diff = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
    return n;
  };
  place(0);
  gfx.closeHullEdges = false;
  await shot();
  const center = hull.localToWorld(new T.Vector3(16, 212, 166)).project(cam),
    x0 = Math.min(W - cw, Math.max(0, Math.round(((1 + center.x) * W) / 2 - cw / 2))),
    y0 = Math.min(H - ch, Math.max(0, Math.round(((1 - center.y) * H) / 2 - ch * 0.52)));
  const crop = (pix, x = x0, y = y0, width = cw, height = ch) => {
    const a = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j++) a.set(pix.subarray(4 * ((y + j) * W + x), 4 * ((y + j) * W + x + width)), 4 * j * width);
    return a;
  };
  function box(pix) {
    const a = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        let R = 0,
          G = 0,
          B = 0;
        for (let j = 0; j < K; j++)
          for (let i = 0; i < K; i++) {
            const at = ((y * K + j) * W + x * K + i) * 4;
            R += pix[at];
            G += pix[at + 1];
            B += pix[at + 2];
          }
        const o = (y * cw + x) * 4;
        a[o] = Math.round(R / (K * K));
        a[o + 1] = Math.round(G / (K * K));
        a[o + 2] = Math.round(B / (K * K));
        a[o + 3] = 255;
      }
    return a;
  }
  function png(a) {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(a), cw, ch), 0, 0);
    return c.toDataURL().split(',')[1];
  }
  // Lock the fleet shadow camera to isolate sampling from changing its fit during a cropped reference draw.
  const shadow = r.updateShadows;
  r.updateShadows = () => {};
  for (const mode of ['off', 'on', 'reference']) {
    gfx.closeHullEdges = mode === 'on';
    samples[mode] = [];
    for (let i = 0; i < frames; i++) {
      place(i);
      if (mode === 'reference') cam.setViewOffset(W, H, x0, y0, cw, ch);
      const pixels = await shot();
      const tile = mode === 'reference' ? box(pixels) : crop(pixels);
      samples[mode].push(tile);
      images[mode + '-' + String(i).padStart(2, '0')] = png(tile);
      if (mode === 'on' && !i) report.sceneSize = [P.targets.scene.width, P.targets.scene.height];
    }
  }
  cam.clearViewOffset();
  place(frames - 1);
  gfx.closeHullEdges = false;
  report.reset = diff(samples.off.at(-1), crop(await shot()));
  // Judge actual changes in luminance, not just a still-image sharpness score. Use the
  // 6x reference to select edge pixels, never either candidate image.
  const lum = (a, n) => a[4 * n] * 0.2126 + a[4 * n + 1] * 0.7152 + a[4 * n + 2] * 0.0722;
  for (const mode of ['off', 'on']) {
    let n = 0,
      error = 0,
      motion = 0,
      contrast = 0,
      refContrast = 0;
    for (let i = 1; i < frames; i++) {
      const ref = samples.reference[i],
        cur = samples[mode][i];
      for (let y = 2; y < ch - 2; y++)
        for (let x = 2; x < cw - 2; x++) {
          const o = y * cw + x;
          const grad = Math.hypot(lum(ref, o + 1) - lum(ref, o - 1), lum(ref, o + cw) - lum(ref, o - cw));
          if (grad < 12) continue;
          const d = lum(cur, o) - lum(ref, o);
          error += Math.abs(d);
          motion += Math.abs(d - (lum(samples[mode][i - 1], o) - lum(samples.reference[i - 1], o)));
          contrast += Math.hypot(lum(cur, o + 1) - lum(cur, o - 1), lum(cur, o + cw) - lum(cur, o - cw));
          refContrast += grad;
          n++;
        }
    }
    report[mode] = { edgeSamples: n, edgeMAE: error / n, motionMAE: motion / n, contrastRatio: contrast / refContrast };
  }
  r.updateShadows = shadow;
  // A bright, fast additive bolt and a mounted escort mesh cross the same screen rectangle.
  // Compare the vacated pixels against the empty scene; holding history would leave a trail.
  gfx.closeHullEdges = true;
  const blank = await shot();
  const placeFixture = mesh => {
    const z = 20,
      span = 2 * z * Math.tan((cam.fov * Math.PI) / 360),
      anchor = new T.Vector3(-0.35, 0.18, 0).unproject(cam).sub(cam.position).normalize();
    mesh.position.copy(cam.position).addScaledVector(anchor, z);
    mesh.quaternion.copy(cam.quaternion);
    mesh.renderOrder = 8;
    mesh.frustumCulled = false;
    mesh.geometry.computeBoundingSphere();
    mesh.scale.setScalar((span * 0.035) / Math.max(0.001, mesh.geometry.boundingSphere.radius));
    r.scene.add(mesh);
    return mesh;
  };
  const strip = new T.Mesh(
    new T.PlaneGeometry(8, 0.6),
    new T.MeshBasicMaterial({ color: 0x66ffdd, blending: T.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false })
  );
  const fighter = w.units.find(v => v.isFighter && v.obj && v.model);
  let fighterMesh;
  fighter?.obj.traverseVisible(m => {
    if (!fighterMesh && m.isMesh && !m.material.transparent && m.geometry?.attributes?.position) fighterMesh = m;
  });
  if (!fighterMesh) throw Error('Missing mounted fighter mesh');
  for (const [name, proxy] of [
    ['bolt', strip],
    ['fighter', new T.Mesh(fighterMesh.geometry, fighterMesh.material)]
  ]) {
    placeFixture(proxy);
    const first = await shot();
    const across = new T.Vector3(2, 0, 0).applyQuaternion(cam.quaternion);
    proxy.position.add(across);
    const moved = await shot();
    r.scene.remove(proxy);
    const clear = await shot();
    let old = 0,
      residue = 0;
    for (let p = 0; p < blank.length; p += 4) {
      const changed = (a, b) => Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]), Math.abs(a[p + 2] - b[p + 2]));
      if (changed(first, blank) > 12) {
        old++;
        if (changed(moved, blank) > 2) residue++;
      }
    }
    report[name] = { changed: old, vacated: residue, removed: diff(blank, clear) };
  }
  strip.geometry.dispose();
  strip.material.dispose();
  gfx.destroyerDetail = 'stock';
  await shot();
  report.stockDensity = P.closeDensity;
  gfx.destroyerDetail = 'finish';
  Object.assign(r.rig, { x: u.x, y: u.y, z: u.z || 0, dist: 6000, pitch: 0.95, free: true, shake: 0 });
  r.rig.apply(0);
  cam.updateMatrixWorld();
  gfx.closeHullEdges = false;
  await shot();
  const wide = await shot();
  gfx.closeHullEdges = true;
  report.fleetDiff = diff(wide, await shot());
  report.fleetDensity = P.closeDensity;
  // Verify the complete post path (including contact depth and reconstruction fallback).
  place(0);
  [P.flare, P.heat, P.bloom, gfx.postAA] = effects;
  P.flare = false;
  const previous = gfx.spacePresentation;
  gfx.closeHullEdges = false;
  const stackBase = await shot();
  gfx.closeHullEdges = true;
  const stackAA = await shot();
  gfx.closeHullEdges = false;
  report.stack = {
    changed: diff(stackBase, stackAA),
    reset: diff(stackBase, await shot()),
    released: !P.targets?.resolved && (!P.targets || P.targets.scene.width === W)
  };
  gfx.closeHullEdges = true;
  if (gpu) {
    const prev = gfx.hdrMode;
    window.testEdgeHDR(true);
    gfx.hdrMode = 'auto';
    draw();
    await gpu.settle();
    draw();
    await gpu.settle();
    const read = gpu.readNext({ extended: true });
    draw();
    const { data } = await read;
    if (!(data instanceof Float32Array)) throw Error('Expected FP16 close-up output');
    let peak = 0;
    for (let i = 0; i < data.length; i += 4) {
      peak = Math.max(peak, data[i], data[i + 1], data[i + 2]);
    }
    report.hdr = { peak, scene: gpu.targets.get(P.targets.scene)?.format, resolved: gpu.targets.get(P.targets.resolved)?.format };
    window.testEdgeHDR(false);
    gfx.hdrMode = prev;
    await shot();
  }
  P.flare = effects[0];
  gfx.spacePresentation = 'inherit';
  const contact = gfx.contactShade;
  gfx.contactShade = 0.65;
  await shot();
  report.depthSize = P.targets.scene.depthTexture ? [P.targets.scene.width, P.targets.scene.height] : null;
  gfx.battleScale = 0.77;
  await shot();
  report.upscaleDensity = P.closeDensity;
  gfx.battleScale = 1;
  gfx.contactShade = contact;
  gfx.spacePresentation = previous;
  if (r.instances) r.instances.jobs = jobs;
  g.modeSuspended = false;
  g.last = performance.now();
  requestAnimationFrame(g.frame);
  const sim = w.time,
    oldCam = r.cameraOverride;
  let k = 0;
  r.cameraOverride = () => frameDestroyer(cam, u, k, route);
  const times = { off: [], on: [] };
  let enabled = 0;
  for (const key of ['off', 'on', 'on', 'off']) {
    gfx.closeHullEdges = key === 'on';
    let last;
    for (let i = 0; i < 48; i++) {
      k = 0.1 + (0.8 * i) / 47;
      const now = await new Promise(requestAnimationFrame);
      if (i >= 8) times[key].push(now - last);
      last = now;
      if (key === 'on' && P.closeDensity > 1) enabled++;
    }
  }
  r.cameraOverride = oldCam;
  r.flybySubject = null;
  report.live = { sim: w.time - sim, enabled };
  for (const [key, a] of Object.entries(times)) {
    a.sort((a, b) => a - b);
    report.live[key] = { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * 0.95) - 1] };
  }
  return { report, images };
};
