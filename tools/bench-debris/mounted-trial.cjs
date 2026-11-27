// Runs in the mounted game's frame. Each leg owns fresh bodies, but its actual
// death callback receives the SAME unit/model pose as every other leg.
module.exports = async function run(_, { land, frames, pairs, first, only }) {
  const g = window.game,
    w = g.world,
    r = land ? g : g.renderer,
    base = land ? g.vehicleWrecks : r.spaceWrecks;
  const T = await import('three'),
    raf = () => new Promise(requestAnimationFrame),
    assert = (yes, msg) => {
      if (!yes) throw Error(msg);
    };
  const R = base.R,
    J = only === 'rapier' ? null : window.__bridge.joltBridge(await window.__jolt.default());
  const gpu = await navigator.gpu?.requestAdapter();
  const gpuInfo = gpu?.info;
  const pct = (a, p) => {
    const b = a.slice().sort((a, b) => a - b);
    return +b[Math.min(b.length - 1, Math.ceil(p * b.length) - 1)].toFixed(3);
  };
  const stats = a => (a.length ? { n: a.length, median: pct(a, 0.5), p95: pct(a, 0.95), max: pct(a, 1) } : null);
  const boot = performance.now();
  g.paused = true;
  g.modeSuspended = true;
  await raf();
  const scene = r.scene,
    view = land ? g.view : r.rig;
  const order = only ? [only] : Array.from({ length: pairs }, (_, i) => ((i + Number(first === 'jolt')) % 2 ? ['jolt', 'rapier'] : ['rapier', 'jolt'])).flat();
  // Paired static background isolates the destruction change. A second crossover
  // leaves ordinary game logic, AI and rendering running as a separate sanity check.
  const legs = [...order.map(k => [k, 'controlled']), ...order.map(k => [k, 'live'])].map(([engine, mode]) => {
    const group = new T.Group(),
      lib = engine === 'jolt' ? J : R,
      layer = land ? new base.constructor(lib, group, base.height, base.fogged, () => false) : new base.constructor(lib, group);
    return { engine, mode, group, layer };
  });
  const startSpawn = base.spawn;
  let captured = 0;
  base.spawn = function (...args) {
    if (land && args[0].foot) return startSpawn.apply(this, args);
    let ok = null;
    const u = args[0];
    for (const leg of legs) {
      if (land) u.holder.visible = true;
      const res = leg.layer.spawn(...args);
      if (ok === null) ok = res;
      else assert(ok === res, 'Engines did not capture identical death parts');
    }
    if (land && ok) base.replaced.add(u);
    if (ok) captured++;
    return ok;
  };
  const casualties = [];
  const all = w.units.filter(
    u =>
      !u.dead &&
      !u.hyper &&
      (land
        ? u.kind === 'VEHICLE' && !u.foot && !u.flies && !u.structure && u.holder?.visible && u.side >= 0
        : u.isMobile && !u.isFighter && u.obj?.visible && u.player === g.human && u.model)
  );
  const used = new Map();
  all.sort((a, b) => (land ? b.hitRadius - a.hitRadius : b.visualRadius - a.visualRadius));
  if (land) {
    const typeIdx = new Map(
      all.map(u => {
        const name = u.type.name,
          idx = used.get(name) || 0;
        used.set(name, idx + 1);
        return [u, idx];
      })
    );
    all.sort((a, b) => typeIdx.get(a) - typeIdx.get(b));
  }
  for (const u of all.slice(0, land ? 8 : 10)) {
    const pos = [u.x, u.y, u.z];
    casualties.push({ name: u.type.name, pos });
    if (land) w.hurt(u, 1e8, null);
    else {
      w.kill(u, null);
    }
  }
  if (!land) {
    for (let i = 0; i < 3600 && r.clones.some(c => !c.detached && Number.isFinite(c.limit)); ++i) r.updateClones(1 / 30);
  }
  base.spawn = startSpawn;
  const pieces = ({ layer }) => (land ? layer.live.flatMap(w => w.pieces.map(p => ({ body: p.body, obj: p.root }))) : layer.pieces);
  const n = pieces(legs[0]).length;
  assert(n >= 3, 'No representative debris: ' + JSON.stringify({ captured, casualties, clones: r.clones?.map(c => c.limit) }));
  const Vec = v => new T.Vector3(v.x, v.y, v.z);
  const initial = pieces(legs[0]).map(({ body }) => ({ p: Vec(body.translation()), v: Vec(body.linvel()) }));
  let maxStartError = 0;
  for (const leg of legs) {
    const list = pieces(leg);
    assert(list.length === n, 'Mismatched part count');
    for (let i = 0; i < n; i++)
      maxStartError = Math.max(
        maxStartError,
        Vec(list[i].body.translation()).distanceTo(initial[i].p),
        Vec(list[i].body.linvel()).distanceTo(initial[i].v)
      );
  }
  assert(maxStartError < 0.03, 'Mismatched initial state ' + maxStartError);
  const center = initial.reduce((acc, { p }) => acc.add(p), new T.Vector3()).multiplyScalar(1 / n),
    radius = Math.max(...initial.map(e => center.distanceTo(e.p)));
  Object.assign(view, { x: center.x, y: center.y, dist: Math.max(land ? 380 : 1200, radius * 1.75), pitch: 1.0, free: true, shake: 0 });
  if (!land) view.z = center.z;
  console.log(
    '[debris] ' + JSON.stringify({ captured, n, all: all.length, center, radius, maxStartError, preparationMs: performance.now() - boot })
  );
  // Wake exactly one game frame loop. After this point all draws go through the normal game frame.
  g.last = performance.now();
  g.modeSuspended = false;
  requestAnimationFrame(g.frame);
  let active = null,
    solves = [],
    sync = [],
    steps = 0;
  const originalStep = base.step;
  base.step = function (dt, ...rest) {
    originalStep.call(this, dt, ...rest);
    if (active) {
      const ts = performance.now();
      active.layer.step(1 / 60, land ? undefined : w);
      sync.push(performance.now() - ts);
      steps++;
    }
  };
  const output = [];
  for (const leg of legs) {
    g.paused = leg.mode === 'controlled';
    const list = pieces(leg);
    scene.add(leg.group);
    active = null;
    // Warm shaders/draw submission for the real section meshes, without advancing the experimental world.
    const tick = leg.layer.world.step.bind(leg.layer.world);
    leg.layer.world.step = () => {
      const t = performance.now();
      tick();
      solves.push(performance.now() - t);
    };
    // Prove the main camera actually submits at least one debris mesh, outside timings.
    let submitted = 0;
    const saved = [];
    leg.group.traverse(o => {
      if (o.isMesh) {
        const fn = o.onBeforeRender;
        saved.push([o, fn]);
        o.onBeforeRender = function (...a) {
          if (a[2] === r.camera) submitted++;
          return fn.apply(this, a);
        };
      }
    });
    for (let i = 0; i < 4; i++) await raf();
    for (const [o, fn] of saved) o.onBeforeRender = fn;
    assert(submitted > 0, 'No debris submitted to the main camera');
    for (let i = 0; i < 14; i++) await raf();
    const w0 = w.time,
      s0 = w.units.filter(u => !u.dead).length;
    active = leg;
    solves = [];
    sync = [];
    steps = 0;
    let prev = await raf();
    solves.length = sync.length = 0;
    steps = 0;
    const gaps = [],
      sunk = new Set();
    for (let i = 0; i < frames; i++) {
      const now = await raf();
      gaps.push(now - prev);
      prev = now;
      if (land)
        for (const { obj } of list) {
          const p = obj.position;
          if (p.z - base.height(p.x, p.y) < -1) sunk.add(obj);
        }
    }
    active = null;
    assert(steps === frames, `Expected ${frames} game frames, got ${steps}`);
    const w1 = w.time;
    const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(r.camera.projectionMatrix, r.camera.matrixWorldInverse)
    );
    let onCamera = 0,
      under = 0,
      minCenter = Infinity,
      maxDv = 0,
      maxDriftError = 0,
      minTravel = Infinity,
      tumbled = 0,
      maxSpeed = 0;
    list.forEach(({ body, obj }, i) => {
      const p = Vec(body.translation()),
        q = body.rotation(),
        v = Vec(body.linvel());
      assert([p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w].every(Number.isFinite), 'Nonfinite rigid transform');
      assert(obj.position.distanceTo(p) < 0.03, 'Mesh not following body');
      if (Math.abs(q.w) < 0.99999) tumbled++;
      if (obj.visible && frustum.containsPoint(p)) onCamera++;
      minTravel = Math.min(minTravel, p.distanceTo(initial[i].p));
      maxSpeed = Math.max(maxSpeed, v.length());
      if (land) {
        const clearance = p.z - base.height(p.x, p.y);
        if (clearance < -1) under++;
        minCenter = Math.min(minCenter, clearance);
      } else {
        maxDv = Math.max(maxDv, v.distanceTo(initial[i].v));
        const ideal = initial[i].p.clone().addScaledVector(initial[i].v, (frames + 1) / 60);
        maxDriftError = Math.max(maxDriftError, ideal.distanceTo(p));
      }
    });
    const row = {
      engine: leg.engine,
      mode: leg.mode,
      bodies: n,
      onCamera,
      submittedDuringWarmup: submitted,
      liveUnits: s0,
      gameSeconds: +(w1 - w0).toFixed(2),
      frameMs: stats(gaps),
      solverMs: stats(solves),
      wreckStepAndSyncMs: stats(sync),
      underGround: sunk.size,
      minCenterClearance: land ? +minCenter.toFixed(3) : null,
      maxVelocityChange: land ? null : +maxDv.toFixed(5),
      driftError: land ? null : +maxDriftError.toFixed(4),
      minTravel: +minTravel.toFixed(2),
      maxSpeed: +maxSpeed.toFixed(2),
      tumbled
    };
    output.push(row);
    console.log('[debris] ' + JSON.stringify(row));
    leg.group.removeFromParent();
    leg.layer.dispose();
    assert(leg.group.children.length === 0, 'Meshes not released');
    assert(onCamera > 0, 'Debris outside camera');
    assert(!under && !sunk.size, 'Body centers below rendered terrain');
    assert(tumbled > 0, 'No visible tumble');
    if (!land) assert(maxDv < 0.03 && maxDriftError < 1.6, 'Unexpected space drag or lost steps');
    if (leg.mode === 'live') assert(w1 > w0, 'Live battle did not advance');
  }
  g.paused = true;
  base.step = originalStep;
  return {
    gpu: gpuInfo && [gpuInfo.vendor, gpuInfo.architecture, gpuInfo.description],
    viewport: [innerWidth, innerHeight],
    losses: casualties.map(c => c.name),
    captured,
    bodies: n,
    maxStartError,
    legs: output
  };
};
