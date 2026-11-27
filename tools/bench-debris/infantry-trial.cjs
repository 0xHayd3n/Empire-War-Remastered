module.exports = async function run(_, { perf, first, only, n, live, nativeBudget }) {
  const raf = () => new Promise(requestAnimationFrame),
    deadline = performance.now() + 90000;
  while (!window.game?.vehicleWrecks || !game.ui || game.warming) {
    if (performance.now() > deadline) throw Error('No mounted land battle');
    await raf();
  }
  const T = await import('three'),
    g = game,
    w = g.world,
    base = g.vehicleWrecks;
  const R = base.R,
    J = only === 'rapier' ? null : window.__bridge.joltBridge(await window.__jolt.default(),{nativeBudget});
  g.paused = false;
  while (w.time < 0.65) await raf();
  g.paused = true;
  g.modeSuspended = true;
  await raf();
  const assert = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  const sides = ['Stormtrooper', 'Rebel_Trooper'].map(name =>
    w.units.filter(u => u.type.name === name && u.kind === 'INFANTRY' && !u.dead && u.foot && u.holder.visible)
  );
  const chosen = [];
  while (chosen.length < n && sides.some(s => s.length)) {
    for (const s of sides) if (s.length && chosen.length < n) chosen.push(s.shift());
  }
  assert(chosen.length === n, `Found ${chosen.length}/${n} compatible active infantry`);
  const engines = only
    ? [only]
    : perf
      ? [first, first === 'jolt' ? 'rapier' : 'jolt', first === 'jolt' ? 'rapier' : 'jolt', first]
      : [first, first === 'jolt' ? 'rapier' : 'jolt'];
  const legs = engines.map(engine => {
    const group = new T.Group(),
      state = { keep: true },
      layer = new base.constructor(engine === 'rapier' ? R : J, group, base.height, base.fogged, () => state.keep);
    return { engine, group, state, layer, spawnMs: [] };
  });
  const native = layer => {
    const z = layer.world;
    return {
      bodies: z.numBodies ? z.numBodies() : z.bodies.len(),
      colliders: z.numColliders ? z.numColliders() : z.colliders.len(),
      joints: z.numJoints ? z.numJoints() : z.impulseJoints.len()
    };
  };
  const anchor = { x: chosen[0].x, y: chosen[0].y },
    spawn = base.spawn;
  // Feed the very same animated death pose to the real ragdoll builder on every leg.
  base.spawn = function (u) {
    if (!chosen.includes(u)) return spawn.call(this, u);
    for (const l of legs) {
      u.holder.visible = true;
      const start = performance.now();
      if (!l.layer.spawn(u)) throw Error('No ' + l.engine + ' ragdoll: ' + u.type.name);
      l.spawnMs.push(performance.now() - start);
    }
    this.replaced.add(u);
    return true;
  };
  try {
    for (const [i, u] of chosen.entries()) {
      // An overlapping pile plus two intact casualties outside the blast. In the heavy
      // case, interleave squads in a small visible grid. No extra collision geometry.
      const [dx, dy] = perf ? [((i % 6) - 2) * 6, (Math.floor(i / 6) - 1) * 6] : i < 2 ? [22 + i * 13, 0] : [0, 0];
      u.x = anchor.x + dx;
      u.y = anchor.y + dy;
      u.z = base.height(u.x, u.y);
      u.holder.position.set(u.x, u.y, u.z);
      u.holder.updateWorldMatrix(true, true);
      w.hurt(u, 1e8, null);
    }
  } finally {
    base.spawn = spawn;
  }
  const vec = v => new T.Vector3(v.x, v.y, v.z),
    lists = legs.map(l => l.layer.live.map(r => r.doll));
  assert(
    lists.every(ls => ls.length === n && ls.every(d => d.nodes.length === 10)),
    'Incomplete ragdoll captures'
  );
  const ref = lists[0].flatMap(d => d.nodes.map(s => [vec(s.body.translation()), vec(s.body.linvel()), s.rotation.clone()]));
  let maxStartError = 0;
  for (const ls of lists) {
    let i = 0;
    for (const d of ls)
      for (const s of d.nodes) {
        const [p, v, q] = ref[i++];
        maxStartError = Math.max(
          maxStartError,
          vec(s.body.translation()).distanceTo(p),
          vec(s.body.linvel()).distanceTo(v),
          q.angleTo(s.rotation)
        );
      }
  }
  assert(maxStartError < 0.002, 'Unmatched start state: ' + maxStartError);
  const still = chosen.map(u => [u.x, u.y, u.z]);
  Object.assign(g.view, { x: anchor.x, y: anchor.y, dist: perf ? 230 : 150, pitch: 1.05 });
  const V = new T.Vector3(),
    P = new T.Vector3(),
    B = new T.Vector3(),
    M = new T.Matrix4(),
    A = new T.Vector3(),
    C = new T.Vector3();
  function skin(d) {
    let floor = Infinity,
      edge = 0,
      vertices = 0,
      allFinite = true;
    for (const mesh of d.root.children) {
      if (!mesh.material.defines?.SKINNED || !mesh.visible) continue;
      mesh.onBeforeRender();
      const pal = mesh.material.uniforms.boneMatrices.value,
        { position: pos, skinWeight: sw, skinIndex: si } = mesh.geometry.attributes,
        I = mesh.geometry.index?.array,
        used = I ? new Set(I) : Array.from({ length: pos.count }, (_, i) => i),
        vs = new Float32Array(pos.count * 3);
      for (const i of used) {
        V.fromBufferAttribute(pos, i);
        P.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const weight = sw.getComponent(i, k);
          if (weight) P.addScaledVector(B.copy(V).applyMatrix4(M.fromArray(pal, 16 * si.getComponent(i, k))), weight);
        }
        P.applyMatrix4(mesh.matrixWorld);
        P.toArray(vs, 3 * i);
        vertices++;
        allFinite &&= Number.isFinite(P.lengthSq());
        floor = Math.min(floor, P.z - base.height(P.x, P.y));
      }
      for (let j = 0; j < (I?.length || pos.count); j += 3) {
        A.fromArray(vs, 3 * (I ? I[j] : j));
        B.fromArray(vs, 3 * (I ? I[j + 1] : j + 1));
        C.fromArray(vs, 3 * (I ? I[j + 2] : j + 2));
        edge = Math.max(edge, A.distanceTo(B), A.distanceTo(C), B.distanceTo(C));
      }
    }
    return { floor, edge, vertices, allFinite };
  }
  const snap = m => Array.from(m.elements),
    pct = (xs, q) => xs.slice().sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1],
    stats = xs => ({ n: xs.length, median: +pct(xs, 0.5).toFixed(3), p95: +pct(xs, 0.95).toFixed(3) });
  const out = [];
  for (const [lidx, l] of legs.entries()) {
    const { layer, engine, group, state } = l,
      ds = lists[lidx],
      failures = [],
      check = (ok, msg) => {
        if (!ok) failures.push(msg);
      };
    g.scene.add(group);
    const before = native(layer);
    check(before.joints === 9 * n, 'Nine native joints per casualty');
    let maxGap = 0,
      maxRise = 0,
      maxNeck = 0,
      maxEdge = 0,
      lowest = Infinity,
      blastJoints,
      minFall = Infinity,
      everMoved = false,
      maxDetachedTravel = 0,
      invalid = false,
      parked = 0;
    const startingFloor=ds.map(d=>skin(d).floor);
    const handed = ds.map(d => d.root.matrix.clone()),
      fall = ds.map(() => 0);
    const sample = (i, full) => {
      for (const [k, d] of ds.entries()) {
        const s = d.nodes[0];
        everMoved ||= !s.matrix.equals(handed[k]);
        maxRise = Math.max(maxRise, s.position.z - s.center.z);
        fall[k] = Math.max(fall[k], s.center.z - s.position.z);
        maxNeck = Math.max(maxNeck, s.rotation.angleTo(d.nodes[1].rotation));
        for (const h of d.nodes)
          if (h.parent) {
            A.copy(h.anchorChild).applyQuaternion(h.rotation).add(h.position);
            B.copy(h.anchorParent).applyQuaternion(h.parent.rotation).add(h.parent.position);
            if (h.name === d.detached) maxDetachedTravel = Math.max(maxDetachedTravel, A.distanceTo(B));
            else maxGap = Math.max(maxGap, A.distanceTo(B));
          }
        if (full) {
          const sk = skin(d);
          maxEdge = Math.max(maxEdge, sk.edge);
          lowest = Math.min(lowest, sk.floor);
          invalid ||= !sk.allFinite || !sk.vertices;
        }
      }
    };
    function inject(i, stress) {
      if (i === 6) {
        layer.blast(anchor.x - 3, anchor.y + 2, base.height(anchor.x, anchor.y) + 5, perf ? 100 : 20);
        blastJoints = native(layer).joints;
      }
      if (stress && i === 24) {
        const d = ds[n - 1];
        d.nodes[0].body.setLinvel({ x: 0, y: 0, z: 240 }, true);
        d.nodes[2].body.setLinvel({ x: 900, y: 0, z: 180 }, true);
      }
    }
    let timing = null;
    if (!perf) {
      for (let i = 0; i < 180; i++) {
        inject(i, true);
        layer.step(1 / 60);
        sample(i, true);
      }
    } else {
      // No vertex walks or JS pose inspection in any timed frame. The same frame loop
      // and same fixed active-window step; simulation paused in the matched case.
      g.paused = !live;
      g.modeSuspended = false;
      g.last = performance.now();
      requestAnimationFrame(g.frame);
      let submitted = 0;
      const hooks = [];
      group.traverse(o => {
        if (o.isMesh) {
          const old = o.onBeforeRender;
          hooks.push([o, old]);
          o.onBeforeRender = function (...xs) {
            if (xs[2] === g.camera) submitted++;
            return old.apply(this, xs);
          };
        }
      });
      for (let i = 0; i < 5; i++) await raf();
      for (const [o, old] of hooks) o.onBeforeRender = old;
      check(submitted > 0, 'Main camera must render casualty skins');
      for (let i = 0; i < 13; i++) await raf();
      const elapsed = [],
        solver = [],
        gaps = [];
      let steps = 0;
      const prevStep = base.step,
        nativeStep = layer.world.step.bind(layer.world),
        w0 = w.time;
      layer.world.step = function () {
        const t = performance.now();
        nativeStep();
        solver.push(performance.now() - t);
      };
      base.step = function (dt) {
        prevStep.call(this, dt);
        inject(steps, false);
        const t = performance.now();
        layer.step(1 / 60);
        elapsed.push(performance.now() - t);
        steps++;
      };
      let prev = await raf();
      for (let i = 0; i < 120; i++) {
        const now = await raf();
        gaps.push(now - prev);
        prev = now;
      }
      base.step = prevStep;
      layer.world.step = nativeStep;
      g.modeSuspended = true;
      g.paused = true;
      await raf();
      check(steps === 121 && solver.length === 121, 'One measured solve per presented frame');
      check(!live || w.time > w0, 'Live game advanced');
      timing = {
        frameMs: stats(gaps),
        ragdollMs: stats(elapsed.slice(1)),
        solverMs: stats(solver.slice(1)),
        submitted,
        gameSeconds: +(w.time - w0).toFixed(3),
        units: w.units.filter(u => !u.dead).length
      };
      sample(steps, true);
    }
    const detached = ds.filter(d => d.detached).length;
    check(detached > 0 && blastJoints === 9 * n - detached, 'Blast removes exactly one native joint per separated limb');
    check(everMoved, 'Skin pose changed');
    check(!invalid && maxEdge < 17, 'Visible geometry finite; no long triangle');
    // The established clearance gate is on settled, visible skins, not collider centers.
    const postFall = ds.map(d => skin(d).floor);
    check(
      postFall.every(v => v > -0.2 && v < 0.7),
      'Post-fall skin rests on terrain (−0.2 .. 0.7)'
    );
    if (!perf) {
      minFall = Math.min(...fall);
      check(minFall > 2, 'Every torso fell');
      check(maxNeck < 0.6, 'Neck rotation <0.6 rad');
      check(maxGap < 0.45, 'Attached socket gap <0.45');
      check(maxRise < 3, 'Torso rise <3');
      check(maxDetachedTravel > 0.5, 'Detached limb moves independently');
    }
    // Let the ordinary sleep/park or 12 s timeout run. Independently check native
    // resources, parked geometry, toggle-off clearing, and unchanged authoritative deaths.
    for (let i = 0; i < 735 && layer.live.length; i++) layer.step(1 / 60);
    parked = layer.settled.length;
    const free = native(layer);
    check(
      !layer.live.length && parked === n && Object.values(free).every(x => x === 0),
      'Parking releases all native resources and keeps all bodies'
    );
    const poses = ds.map(d => snap(d.root.matrix)),
      parkedFloor = ds.map(d => skin(d).floor);
    layer.step(0.1);
    check(
      ds.every((d, i) => d.root.parent === group && d.root.matrix.elements.every((v, j) => v === poses[i][j])),
      'Parked poses persist'
    );
    check(
      parkedFloor.every(v => v > -0.2 && v < 0.7),
      'Parked skins grounded'
    );
    state.keep = false;
    layer.step(0);
    check(!group.children.length && !layer.settled.length, 'Persistence off clears visuals');
    check(
      chosen.every((u, i) => u.dead && [u.x, u.y, u.z].every((x, j) => x === still[i][j])),
      'Cosmetic physics never moves authoritative unit'
    );
    group.removeFromParent();
    layer.dispose();
    const f = x => (Number.isFinite(x) ? +x.toFixed(4) : null);
    const row = {
      engine,
      n,
      start: before,
      spawnMs: stats(l.spawnMs),
      afterBlastJoints: blastJoints,
      detached,
      peakSocketGap: f(maxGap),
      peakNeckDeg: f((maxNeck * 180) / Math.PI),
      peakTorsoRise: f(maxRise),
      maxTriangle: f(maxEdge),
      lowestSampledSkin: f(lowest),
      minPostFallClearance: f(Math.min(...postFall)),
      maxPostFallClearance: f(Math.max(...postFall)),
      minStartingClearance:f(Math.min(...startingFloor)),
      parkedSkinRange:[f(Math.min(...parkedFloor)),f(Math.max(...parkedFloor))],
      parkedBelowTolerance:parkedFloor.flatMap((z,i)=>z<=-.2?[{i,type:chosen[i].type.name,z:f(z)}]:[]),
      minFall: f(minFall),
      maxDetachedTravel: f(maxDetachedTravel),
      parked,
      afterParking: free,
      timing,
      failures
    };
    out.push(row);
    console.log('[infantry] ' + JSON.stringify(row));
  }
  const gpu = await navigator.gpu?.requestAdapter();
  return {
    suite: perf ? (live ? 'live' : 'controlled') : 'quality',
    units: chosen.reduce((o, u) => ((o[u.type.name] = (o[u.type.name] || 0) + 1), o), {}),
    host: w.units.length,
    map: g.setup.mapFile,
    gpu: gpu?.info?.architecture,
    backend: g.gpuOn ? 'webgpu' : 'webgl',
    maxStartError,
    legs: out
  };
};
