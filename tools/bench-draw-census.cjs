// Injected into a temporary benchmark page only. Classify real draw counter increments,
// not projected object counts: a draw may be skipped or one mesh may have several passes.
function createCensus({ game, model, labels = false }) {
  const dev = game.renderer.renderer,
    im = game.renderer.instances,
    original = dev.renderBufferDirect;
  const mainBuckets = ['unitPools', 'mobileIndividual', 'otherUnitIndividual', 'outsideUnits'];
  const mobileParts = ['shield', 'hardpoint', 'bodyOrOther'];
  const surfaces = ['shield', 'skinnedOpaque', 'skinnedTransparent', 'rigidOpaque', 'rigidTransparent'];
  const eligibility = ['registeredSkin', 'registeredRigid', 'neither'];
  const transparentSources = ['activeFadeTwin', 'additive', 'alpha', 'other'];
  const hist = () => Object.create(null),
    counts = keys => Object.fromEntries(keys.map(k => [k, 0]));
  const frames = [],
    roots = new Map(),
    parts = new Set(),
    shields = new Set(),
    fades = new Map(),
    pools = new Set();
  let frame = null,
    invalid = null,
    restored = false;
  const originalOwn = Object.hasOwn(dev, 'renderBufferDirect'),
    sum = values => Object.values(values).reduce((a, b) => a + b, 0);
  function begin() {
    if (frame) throw Error('Nested main pass');
    roots.clear();
    parts.clear();
    shields.clear();
    fades.clear();
    pools.clear();
    for (const p of im.list) if (p.im) pools.add(p.im);
    // Model parts and pool objects can be replaced or appear during a moving battle.
    for (const u of game.world.units)
      if (u.obj) {
        roots.set(u.obj, u);
        if (u.shieldMesh) shields.add(u.shieldMesh);
        for (const [mesh, , twin] of u.fadeMats || []) fades.set(mesh, twin);
        for (const part of u.parts || []) parts.add(part);
      }
    frame = {
      calls: counts(mainBuckets),
      triangles: counts(mainBuckets),
      parts: counts(mobileParts),
      surfaces: counts(surfaces),
      eligibility: counts(eligibility),
      skinnedTransparentSources: counts(transparentSources),
      signatures: new Map(),
      labels: hist(),
      palettes: new Map(),
      opaqueSkin: counts(['sameRepeated', 'mixedRepeated', 'single', 'unknown']),
      skinnedCalls: 0,
      skinnedDistinct: 0
    };
  }
  dev.renderBufferDirect = function (camera, scene, geo, mat, obj, group) {
    const info = dev.info.render;
    if (!frame || scene !== game.renderer.scene) return original.apply(this, arguments);
    const c = info.calls,
      t = info.triangles;
    const res = original.apply(this, arguments);
    const n = info.calls - c,
      tri = info.triangles - t;
    if (!n && !tri) return res;
    let k = 'outsideUnits',
      part = 'bodyOrOther',
      u;
    if (pools.has(obj)) k = 'unitPools';
    else {
      for (let p = obj; p; p = p.parent) {
        if (shields.has(p)) part = 'shield';
        else if (part !== 'shield' && parts.has(p)) part = 'hardpoint';
        u = roots.get(p);
        if (u) break;
      }
      if (u) k = u.isMobile && u.player?.id >= 0 ? 'mobileIndividual' : 'otherUnitIndividual';
    }
    frame.calls[k] += n;
    frame.triangles[k] += tri;
    if (k === 'mobileIndividual') {
      const skin = !!mat.defines?.SKINNED;
      const surface = mat.userData?.shield ? 'shield' : (skin ? 'skinned' : 'rigid') + (mat.transparent ? 'Transparent' : 'Opaque');
      frame.parts[part] += n;
      frame.surfaces[surface] += n;
      if (surface === 'skinnedTransparent')
        frame.skinnedTransparentSources[
          fades.get(obj) === mat ? 'activeFadeTwin' : mat.userData?.additive ? 'additive' : mat.userData?.alpha ? 'alpha' : 'other'
        ] += n;
      frame.eligibility[model.skinBatchable.has(mat) ? 'registeredSkin' : model.instanceable.has(mat) ? 'registeredRigid' : 'neither'] += n;
      // Identity only, *not* a batchability test (bone palette, uniforms, sort, and side may differ).
      if (skin) {
        frame.skinnedCalls += n;
        const key = [geo.id, mat.id, obj.renderOrder, mat.side, group?.start ?? '-', group?.count ?? '-'].join('/');
        frame.signatures.set(key, (frame.signatures.get(key) || 0) + n);
        if (surface === 'skinnedOpaque') {
          const values = mat.uniforms?.boneMatrices?.value;
          let p = frame.palettes.get(key);
          if (!p) {
            p = { first: values?.slice(), mixed: false, n: 0, unknown: false };
            frame.palettes.set(key, p);
          }
          p.n += n;
          if (!values?.length || !p.first?.length) p.unknown = true;
          else if (!p.mixed) p.mixed = values.length !== p.first.length || values.some((v, i) => !Object.is(v, p.first[i]));
        }
      }
      if (labels) {
        const s = u.type.name + ' / ' + (obj.parent?.name || '(unnamed part)');
        frame.labels[s] = (frame.labels[s] || 0) + n;
      }
    }
    return res;
  };
  return {
    begin,
    end(c, t) {
      if (!frame) return;
      if (
        sum(frame.calls) !== c ||
        sum(frame.triangles) !== t ||
        sum(frame.skinnedTransparentSources) !== frame.surfaces.skinnedTransparent ||
        [frame.parts, frame.surfaces, frame.eligibility].some(h => sum(h) !== frame.calls.mobileIndividual)
      )
        invalid ||= 'Draw census did not reconcile with main-pass calls/triangles';
      for (const p of frame.palettes.values())
        frame.opaqueSkin[p.unknown ? 'unknown' : p.n === 1 ? 'single' : p.mixed ? 'mixedRepeated' : 'sameRepeated'] += p.n;
      if (sum(frame.opaqueSkin) !== frame.surfaces.skinnedOpaque) invalid ||= 'Opaque skin palette counts did not reconcile';
      frame.skinnedDistinct = frame.signatures.size;
      delete frame.signatures;
      delete frame.palettes;
      frames.push(frame);
      frame = null;
    },
    finish(expected) {
      if (invalid || frame || frames.length !== expected || !expected) throw Error(invalid || 'Missing census frames');
      const dist = a => {
        a.sort((x, y) => x - y);
        return { p50: a[Math.ceil(a.length * 0.5) - 1], p95: a[Math.ceil(a.length * 0.95) - 1], total: a.reduce((v, n) => v + n, 0) };
      };
      const summary = (field, keys) => Object.fromEntries(keys.map(k => [k, dist(frames.map(f => f[field][k]))]));
      const result = {
        reconciledFrames: expected,
        calls: summary('calls', mainBuckets),
        triangles: summary('triangles', mainBuckets),
        mobileParts: summary('parts', mobileParts),
        mobileSurfaces: summary('surfaces', surfaces),
        mobileEligibility: summary('eligibility', eligibility),
        mobileSkinTransparency: summary('skinnedTransparentSources', transparentSources),
        opaqueSkinPaletteGroups: summary('opaqueSkin', ['sameRepeated', 'mixedRepeated', 'single', 'unknown']),
        skinnedCalls: dist(frames.map(f => f.skinnedCalls)),
        skinnedDistinctSignatures: dist(frames.map(f => f.skinnedDistinct))
      };
      if (labels) {
        const top = hist();
        for (const f of frames) for (const [k, v] of Object.entries(f.labels)) top[k] = (top[k] || 0) + v;
        result.topLocalMobileParts = Object.entries(top)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);
      }
      return result;
    },
    restore() {
      if (!restored) {
        if (originalOwn) dev.renderBufferDirect = original;
        else delete dev.renderBufferDirect;
        restored = true;
      }
    }
  };
}
module.exports = { createCensus };
