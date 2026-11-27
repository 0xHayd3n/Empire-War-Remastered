#!/usr/bin/env node
/**
 * eawr-debris-bench — Rapier vs Jolt step-time benchmark for the
 * Empire War Remastered debris / vehicle-wreck physics workload.
 *
 * Standalone research harness: it edits no checkout and ships nothing.
 *   cd tools/bench-debris
 *   npm ci
 *   npm run bench                        # five rounds, writes results.md + results.json
 *   node bench.mjs --rounds=1 --steps=60 # quick smoke
 *
 * Fairness rules implemented here:
 *  - identical seeded scene for both engines (positions, rotations, half extents,
 *    linear/angular velocities, counts) — verified and printed as an error table;
 *  - same timestep (1/60, the game's STEP), same gravity, friction, restitution,
 *    damping, CCD and sleep policy; friction/restitution equal on both surfaces
 *    so any combine rule agrees;
 *  - only the physics step is timed (Rapier world.step(), Jolt JoltInterface.Step),
 *    so transform readback and rendering are excluded for both;
 *  - warmed samples, median/p95 per run, median across rounds, engine order
 *    alternated per round to spread thermal/GC drift;
 *  - both engines' iteration budgets are reported: "matched" (Jolt lowered to
 *    Rapier's iteration budget) and each engine's shipped defaults.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);

/* ------------------------------------------------------------------ config */

const CFG = {
  dt: 1 / 60, // game: vehicle-wrecks.js STEP = 1/60
  rounds: Number(argv.rounds ?? 3),
  counts: [64, 256],
  seed: 0x5eed1eaf,
  density: 1.0, // Rapier ColliderDesc.cuboid default density
  friction: 0.85, // game wreck collider + ground patch
  restitution: 0.24, // game wreck collider
  angularDamping: 0.45, // game wreck body
  linearDamping: 0.0,
  ccd: true, // game: RigidBodyDesc.setCcdEnabled(true)
  // game land world: new R.World({x:0,y:0,z:-100}) (Z up)
  gravity: { rubble: [0, 0, -100], fleet: [0, 0, 0] },
  terrain: { radius: 200, cell: 20 }, // like groundPatch(): cell 20, ~400x400 patch
  joltConvexRadius: 0.05, // Jolt's own default for boxes; outer extents still match Rapier
};

// Rapier 0.17 defaults: 4 solver iterations, 1 internal PGS iteration,
// 4 additional friction iterations. Jolt defaults: 10 velocity steps,
// 2 position steps. The two defaults are not equivalent, so both are measured.
const VARIANTS = [
  {
    // Jolt dropped to Rapier's iteration budget. Included as a probe only:
    // at 4 velocity + 1 position steps Jolt occasionally extrudes a body
    // through the static trimesh on this scene (see "fell through ground"),
    // so this is not a fair stand-in for Rapier's 4 solver + 4 friction
    // iterations with TGS-soft position correction.
    id: 'jolt-4v1p-probe',
    note: 'Jolt at Rapier iteration budget; under-resolved on this scene (loses 1-2 bodies through the trimesh in some runs)',
    primary: false,
    rapier: { iters: 4, pgs: 1, frictionIters: 4 },
    jolt: { vel: 4, pos: 1 },
    sleep: false,
  },
  {
    // Library defaults: Rapier 4 solver / 1 PGS / 4 friction iterations,
    // Jolt 10 velocity / 2 position steps. This is what each engine runs out
    // of the box, and Jolt's side is the heavier of the two solver budgets,
    // so it is a conservative framing for Jolt.
    id: 'library-defaults',
    primary: true,
    rapier: { iters: 4, pgs: 1, frictionIters: 4 },
    jolt: { vel: 10, pos: 2 },
    sleep: false,
  },
  {
    id: 'defaults+sleep',
    primary: false, // secondary: sleeping changes what is being measured
    rapier: { iters: 4, pgs: 1, frictionIters: 4 },
    jolt: { vel: 10, pos: 2 },
    sleep: true,
  },
  {
    // How much of the gap is continuous collision detection? The game ships
    // wrecks with CCD on. With CCD off at this scene's scale bodies tunnel
    // through the ground in *both* engines, so this variant is only valid for
    // the contact-free zero-g drift workload.
    id: 'noccd-probe',
    note: 'CCD off, otherwise library defaults; only valid for zero-g drift (bodies tunnel through the ground with CCD off in both engines)',
    primary: false,
    rapier: { iters: 4, pgs: 1, frictionIters: 4 },
    jolt: { vel: 10, pos: 2 },
    sleep: false,
    ccd: false,
    scenes: ['zero-g drift'],
  },
];

// Measurement windows. The rubble scene is transient (impact, then rest), so
// it is measured twice: during collapse and after it has settled (sleep off in
// the primary variants, so the pile keeps solving every step).
const SCENARIOS = [
  { id: 'zero-g drift', scene: 'fleet', warmup: Number(argv.warmup ?? 150), measure: Number(argv.steps ?? 250) },
  { id: 'rubble impact', scene: 'rubble', warmup: 12, measure: Number(argv.impactSteps ?? 60) },
  { id: 'rubble at rest', scene: 'rubble', warmup: 240, measure: Number(argv.restSteps ?? 150) },
];

/* ------------------------------------------------------- wasm provenance */

const wasmCalls = { compile: 0, instantiate: 0 };
for (const [name, key] of [
  ['compile', 'compile'],
  ['instantiate', 'instantiate'],
  ['compileStreaming', 'compile'],
  ['instantiateStreaming', 'instantiate'],
]) {
  const orig = WebAssembly[name];
  if (typeof orig !== 'function') continue;
  WebAssembly[name] = (...args) => {
    wasmCalls[key]++;
    return orig(...args);
  };
}

/* ------------------------------------------------------------------ scenes */

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uni = (rng, lo, hi) => lo + (hi - lo) * rng();
const sym = (rng, mag) => (rng() * 2 - 1) * mag;

// Gentle rolling terrain in the same units the game's land world uses.
const terrainZ = (x, y) =>
  2 * Math.sin(x * 0.017) * Math.cos(y * 0.013) + 1.4 * Math.sin((x + y) * 0.0071);

function axisAngleQuat(axis, angle) {
  const s = Math.sin(angle / 2);
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return { x: (axis[0] / n) * s, y: (axis[1] / n) * s, z: (axis[2] / n) * s, w: Math.cos(angle / 2) };
}

function makeGroundMesh() {
  const { radius, cell } = CFG.terrain;
  const n = Math.round((2 * radius) / cell);
  const verts = [];
  const idx = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = -radius + i * cell;
      const y = -radius + j * cell;
      verts.push(x, y, terrainZ(x, y));
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx), n, triangles: idx.length / 3 };
}

/**
 * Seeded scene. Cuboid half extents span the game's wreck range (wrecks clamp
 * to >= 0.4 and wreck pieces reach a few units), with the game's kick
 * velocities (16 horizontal / up to 30 up) and spin, plus angular damping.
 */
function makeScene(kind, n) {
  const rng = mulberry32(CFG.seed + n * 7919 + (kind === 'rubble' ? 1 : 2));
  const boxes = [];
  if (kind === 'rubble') {
    // Two-layer debris field, no initial overlap (cell > 2 * max half extent),
    // spawned just above the terrain and kicked like the game's wreck pieces.
    // A debris field, not a 6-deep stack: deep stacks at the game's 100 u/s^2
    // gravity produce penetration ejects that are not the workload of interest.
    const side = Math.ceil(Math.sqrt(n / 2));
    const spacing = 4.2;
    for (let i = 0; i < n; i++) {
      const cell = Math.floor(i / 2);
      const ix = cell % side;
      const iy = Math.floor(cell / side) % side;
      const layer = i % 2;
      const x = (ix - (side - 1) / 2) * spacing + sym(rng, 0.5);
      const y = (iy - (side - 1) / 2) * spacing + sym(rng, 0.5);
      const half = [uni(rng, 0.4, 1.7), uni(rng, 0.4, 1.7), uni(rng, 0.4, 1.7)];
      const a = uni(rng, 0, Math.PI * 2);
      boxes.push({
        pos: [x, y, terrainZ(x, y) + half[2] + 1.2 + layer * spacing],
        half,
        quat: axisAngleQuat([sym(rng, 1), sym(rng, 1), sym(rng, 1)], uni(rng, 0, Math.PI)),
        linvel: [Math.cos(a) * 16, Math.sin(a) * 16, uni(rng, 8, 30)], // game kick
        angvel: [-Math.sin(a) * 1.8, Math.cos(a) * 1.8, sym(rng, 0.9)],
      });
    }
    return { kind, boxes, gravity: CFG.gravity.rubble, mesh: makeGroundMesh() };
  }
  // Zero-g fleet drift: debris riding in space, no gravity, no ground, kept
  // drifting so it keeps intersecting itself.
  const side = Math.ceil(Math.cbrt(n));
  const spacing = 7.5;
  for (let i = 0; i < n; i++) {
    const ix = i % side;
    const iy = Math.floor(i / side) % side;
    const iz = Math.floor(i / (side * side));
    boxes.push({
      pos: [
        (ix - (side - 1) / 2) * spacing + sym(rng, 1.5),
        (iy - (side - 1) / 2) * spacing + sym(rng, 1.5),
        (iz - (side - 1) / 2) * spacing + sym(rng, 1.5),
      ],
      half: [uni(rng, 0.4, 1.7), uni(rng, 0.4, 1.7), uni(rng, 0.4, 1.7)],
      quat: axisAngleQuat([sym(rng, 1), sym(rng, 1), sym(rng, 1)], uni(rng, 0, Math.PI)),
      linvel: [sym(rng, 9), sym(rng, 9), sym(rng, 9)],
      angvel: [sym(rng, 1.4), sym(rng, 1.4), sym(rng, 1.4)],
    });
  }
  return { kind, boxes, gravity: CFG.gravity.fleet, mesh: null };
}

/* ------------------------------------------------------------- statistics */

function stats(sample) {
  const a = Array.from(sample).sort((x, y) => x - y);
  const at = p => a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
  return {
    median: at(0.5),
    p95: at(0.95),
    mean: a.reduce((s, v) => s + v, 0) / a.length,
    min: a[0],
    max: a[a.length - 1],
  };
}

function timeSteps(stepOnce, warmup, measure) {
  for (let i = 0; i < warmup; i++) stepOnce();
  const out = new Float64Array(measure);
  for (let i = 0; i < measure; i++) {
    const t0 = process.hrtime.bigint();
    stepOnce();
    out[i] = Number(process.hrtime.bigint() - t0) / 1e6;
  }
  return out;
}

/* ------------------------------------------------------------------ rapier */

let RAPIER = null;
let JoltLib = null;

async function initEngines() {
  wasmCalls.compile = 0;
  wasmCalls.instantiate = 0;
  // Same file the game vendors into public/vendor/rapier/rapier.es.js
  // (tools/vendor.mjs copies @dimforge/rapier3d-compat/rapier.es.js).
  RAPIER = await import('@dimforge/rapier3d-compat/rapier.es.js');
  await RAPIER.init();
  const rapierWasm = { ...wasmCalls };

  wasmCalls.compile = 0;
  wasmCalls.instantiate = 0;
  const mod = await import('jolt-physics/wasm-compat');
  JoltLib = await mod.default({});
  const joltWasm = { ...wasmCalls };
  return { rapierWasm, joltWasm };
}

function rapierBuild(scene, variant) {
  const R = RAPIER;
  const world = new R.World({ x: scene.gravity[0], y: scene.gravity[1], z: scene.gravity[2] });
  world.timestep = CFG.dt;
  world.numSolverIterations = variant.rapier.iters;
  world.numInternalPgsIterations = variant.rapier.pgs;
  world.numAdditionalFrictionIterations = variant.rapier.frictionIters;

  if (scene.mesh)
    world.createCollider(
      R.ColliderDesc.trimesh(scene.mesh.verts, scene.mesh.idx)
        .setFriction(CFG.friction)
        .setRestitution(CFG.restitution)
    );

  const bodies = [];
  for (const b of scene.boxes) {
    const rb = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(b.pos[0], b.pos[1], b.pos[2])
        .setRotation(b.quat)
        .setLinvel(b.linvel[0], b.linvel[1], b.linvel[2])
        .setAngvel({ x: b.angvel[0], y: b.angvel[1], z: b.angvel[2] })
        .setLinearDamping(CFG.linearDamping)
        .setAngularDamping(CFG.angularDamping)
        .setCcdEnabled(variant.ccd ?? CFG.ccd)
        .setCanSleep(variant.sleep)
    );
    world.createCollider(
      R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2])
        .setDensity(CFG.density)
        .setFriction(CFG.friction)
        .setRestitution(CFG.restitution),
      rb
    );
    bodies.push(rb);
  }
  return { world, bodies };
}

function rapierProbe(bodies, hasGround) {
  let awake = 0;
  let speed = 0;
  let z = 0;
  let movingFast = 0;
  let belowGround = 0;
  for (const rb of bodies) {
    if (!rb.isSleeping()) awake++;
    const v = rb.linvel();
    const s = Math.hypot(v.x, v.y, v.z);
    speed += s;
    if (s > 0.5) movingFast++;
    const p = rb.translation();
    z += p.z;
    if (p.z < -5) belowGround++;
  }
  return { awake, bodies: bodies.length, meanSpeed: speed / bodies.length, movingFast, meanZ: z / bodies.length, belowGround: hasGround ? belowGround : null };
}

function runRapier(scene, variant, scenario) {
  const { world, bodies } = rapierBuild(scene, variant);
  const sample = timeSteps(() => world.step(), scenario.warmup, scenario.measure);
  const probe = rapierProbe(bodies, !!scene.mesh);
  world.free?.();
  return { sample, probe };
}

/* -------------------------------------------------------------------- jolt */

let JOLT = null;

/**
 * Jolt's wasm build has no JoltInterface destructor (it bump-allocates a fixed
 * block sized by maxBodies/pairs/contacts), so one interface is created with
 * generous limits and reused across runs: bodies are removed between runs.
 * World setup happens outside the timed region for both engines.
 */
function joltSystem() {
  if (JOLT) return JOLT;
  const J = JoltLib;
  const settings = new J.JoltSettings();
  settings.mMaxBodies = 1024;
  settings.mMaxBodyPairs = 16384;
  settings.mMaxContactConstraints = 16384;
  settings.mMaxWorkerThreads = 1; // single-threaded, like Rapier's wasm build
  const bpLayer = new J.BroadPhaseLayerInterfaceTable(1, 1);
  bpLayer.MapObjectToBroadPhaseLayer(0, new J.BroadPhaseLayer(0));
  const pairFilter = new J.ObjectLayerPairFilterTable(1);
  pairFilter.EnableCollision(0, 0);
  settings.mBroadPhaseLayerInterface = bpLayer;
  settings.mObjectLayerPairFilter = pairFilter;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpLayer, 1, pairFilter, 1);
  const jolt = new J.JoltInterface(settings);
  const ps = jolt.GetPhysicsSystem();
  JOLT = { J, jolt, ps, bi: ps.GetBodyInterface() };
  return JOLT;
}

function joltClear({ J, bi, ps }) {
  const ids = new J.BodyIDVector();
  ps.GetBodies(ids);
  const list = [];
  for (let i = 0; i < ids.size(); i++) list.push(ids.at(i));
  for (const id of list) bi.RemoveBody(id);
  for (const id of list) bi.DestroyBody(id);
}

function joltBuild(scene, variant) {
  const system = joltSystem();
  joltClear(system);
  const { J, jolt, ps, bi } = system;
  ps.SetGravity(new J.Vec3(scene.gravity[0], scene.gravity[1], scene.gravity[2]));
  const pset = ps.GetPhysicsSettings();
  pset.mNumVelocitySteps = variant.jolt.vel;
  pset.mNumPositionSteps = variant.jolt.pos;
  pset.mAllowSleeping = variant.sleep;
  ps.SetPhysicsSettings(pset);

  if (scene.mesh) {
    const { verts, idx } = scene.mesh;
    const triangles = new J.TriangleList();
    const v = k => new J.Vec3(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]);
    for (let t = 0; t < idx.length; t += 3)
      triangles.push_back(new J.Triangle(v(idx[t]), v(idx[t + 1]), v(idx[t + 2]), 0));
    const meshSettings = new J.MeshShapeSettings(triangles, new J.PhysicsMaterialList());
    const result = meshSettings.Create();
    if (result.HasError()) throw new Error('Jolt mesh ground failed: ' + result.GetError());
    const ground = new J.BodyCreationSettings(result.Get(), new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, 0);
    ground.mFriction = CFG.friction;
    ground.mRestitution = CFG.restitution;
    bi.CreateAndAddBody(ground, J.EActivation_DontActivate);
  }

  const ids = [];
  for (const b of scene.boxes) {
    // Outer extents match Rapier's cuboid exactly (Jolt keeps the convex
    // radius inside the given half extent); 0.05 is Jolt's box default.
    const shape = new J.BoxShape(new J.Vec3(b.half[0], b.half[1], b.half[2]), CFG.joltConvexRadius);
    shape.SetDensity(CFG.density); // Rapier cuboid density 1 => mass == volume
    const s = new J.BodyCreationSettings(
      shape,
      new J.RVec3(b.pos[0], b.pos[1], b.pos[2]),
      new J.Quat(b.quat.x, b.quat.y, b.quat.z, b.quat.w),
      J.EMotionType_Dynamic,
      0
    );
    s.mFriction = CFG.friction;
    s.mRestitution = CFG.restitution;
    s.mLinearDamping = CFG.linearDamping;
    s.mAngularDamping = CFG.angularDamping;
    s.mAllowSleeping = variant.sleep;
    s.mMotionQuality = (variant.ccd ?? CFG.ccd) ? J.EMotionQuality_LinearCast : J.EMotionQuality_Discrete;
    s.mLinearVelocity = new J.Vec3(b.linvel[0], b.linvel[1], b.linvel[2]);
    s.mAngularVelocity = new J.Vec3(b.angvel[0], b.angvel[1], b.angvel[2]);
    // The BodyID wrapper returned by CreateAndAddBody is reused by the wasm
    // binding, so keep the raw packed id and rebuild a BodyID when reading.
    ids.push(bi.CreateAndAddBody(s, J.EActivation_Activate).GetIndexAndSequenceNumber());
  }
  return { J, jolt, ps, bi, ids };
}

/**
 * Jolt returns wasm-backed value objects, so every component must be read
 * immediately (a later Get* call can reuse the same scratch slot).
 */
function joltProbe({ J, ps, bi, ids }, hasGround) {
  const activeVec = new J.BodyIDVector();
  ps.GetActiveBodies(J.EBodyType_Dynamic, activeVec);
  let speed = 0;
  let z = 0;
  let movingFast = 0;
  let belowGround = 0;
  for (const raw of ids) {
    const v = bi.GetLinearVelocity(new J.BodyID(raw));
    const s = Math.hypot(v.GetX(), v.GetY(), v.GetZ());
    speed += s;
    if (s > 0.5) movingFast++;
    const bz = bi.GetPosition(new J.BodyID(raw)).GetZ();
    z += bz;
    if (bz < -5) belowGround++;
  }
  return {
    awake: activeVec.size(),
    bodies: ps.GetNumBodies(),
    meanSpeed: speed / ids.length,
    movingFast,
    meanZ: z / ids.length,
    belowGround: hasGround ? belowGround : null,
  };
}

function runJolt(scene, variant, scenario) {
  const built = joltBuild(scene, variant);
  const sample = timeSteps(() => built.jolt.Step(CFG.dt, 1), scenario.warmup, scenario.measure);
  return { sample, probe: joltProbe(built, !!scene.mesh) };
}

/* -------------------------------------------------------- start-state check */

/** Confirms both engines received the exact same seeded scene before stepping. */
function verifyStartState(kind, n) {
  const scene = makeScene(kind, n);
  const variant = VARIANTS[0];
  const maxOf = fn => {
    let pos = 0;
    let lin = 0;
    let ang = 0;
    scene.boxes.forEach((b, i) => {
      const got = fn(i);
      pos = Math.max(pos, Math.hypot(got.pos[0] - b.pos[0], got.pos[1] - b.pos[1], got.pos[2] - b.pos[2]));
      lin = Math.max(lin, Math.hypot(got.lin[0] - b.linvel[0], got.lin[1] - b.linvel[1], got.lin[2] - b.linvel[2]));
      ang = Math.max(ang, Math.hypot(got.ang[0] - b.angvel[0], got.ang[1] - b.angvel[1], got.ang[2] - b.angvel[2]));
    });
    return { maxPosErr: +pos.toExponential(2), maxLinvelErr: +lin.toExponential(2), maxAngvelErr: +ang.toExponential(2) };
  };

  const rap = rapierBuild(scene, variant);
  const rapier = maxOf(i => {
    const rb = rap.bodies[i];
    const p = rb.translation();
    const v = rb.linvel();
    const w = rb.angvel();
    return { pos: [p.x, p.y, p.z], lin: [v.x, v.y, v.z], ang: [w.x, w.y, w.z] };
  });
  rap.world.free?.();

  const jol = joltBuild(scene, variant);
  const jolt = maxOf(i => {
    const id = new jol.J.BodyID(jol.ids[i]);
    const p = jol.bi.GetPosition(id);
    const v = jol.bi.GetLinearVelocity(id);
    const w = jol.bi.GetAngularVelocity(id);
    return {
      pos: [p.GetX(), p.GetY(), p.GetZ()],
      lin: [v.GetX(), v.GetY(), v.GetZ()],
      ang: [w.GetX(), w.GetY(), w.GetZ()],
    };
  });
  return { scene: `${kind} x${n}`, rapier, jolt };
}

/* -------------------------------------------------------------------- main */

function envInfo() {
  const cpus = os.cpus();
  return {
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpu: cpus[0]?.model?.trim(),
    cores: cpus.length,
    memoryGB: +(os.totalmem() / 1e9).toFixed(1),
    node: process.version,
    v8: process.versions.v8,
  };
}

function engineVersions() {
  const read = p => {
    try {
      return JSON.parse(fs.readFileSync(path.join(here, 'node_modules', p, 'package.json'), 'utf8')).version;
    } catch {
      return 'unknown';
    }
  };
  return {
    rapier: { pkg: '@dimforge/rapier3d-compat', version: read('@dimforge/rapier3d-compat') },
    jolt: { pkg: 'jolt-physics', version: read('jolt-physics') },
  };
}

async function main() {
  const wasm = await initEngines();
  const versions = engineVersions();
  const env = envInfo();
  const startState = [verifyStartState('rubble', 256), verifyStartState('fleet', 256)];

  const runs = [];
  for (let round = 0; round < CFG.rounds; round++) {
    // Alternate engine order per round so thermal/GC drift is shared.
    const order = round % 2 === 0 ? ['rapier', 'jolt'] : ['jolt', 'rapier'];
    for (const scenario of SCENARIOS)
      for (const n of CFG.counts) {
        const scene = makeScene(scenario.scene, n);
        for (const variant of VARIANTS.filter(v => !v.scenes || v.scenes.includes(scenario.id)))
          for (const engine of order) {
            const { sample, probe } = engine === 'rapier' ? runRapier(scene, variant, scenario) : runJolt(scene, variant, scenario);
            runs.push({ round, scenario: scenario.id, n, variant: variant.id, engine, ...stats(sample), probe });
          }
        process.stderr.write(`round ${round + 1}/${CFG.rounds} ${scenario.id} x${n} done\n`);
      }
  }

  // Median across rounds of each round's median / p95.
  const rows = [];
  for (const scenario of SCENARIOS)
    for (const n of CFG.counts)
      for (const variant of VARIANTS.filter(v => !v.scenes || v.scenes.includes(scenario.id)))
        for (const engine of ['rapier', 'jolt']) {
          const rs = runs.filter(r => r.scenario === scenario.id && r.n === n && r.variant === variant.id && r.engine === engine);
          if (!rs.length) continue;
          const mid = rs[Math.floor(rs.length / 2)];
          rows.push({
            scenario: scenario.id,
            n,
            variant: variant.id,
            primary: variant.primary,
            engine,
            median: stats(rs.map(r => r.median)).median,
            p95: stats(rs.map(r => r.p95)).median,
            mean: stats(rs.map(r => r.mean)).median,
            perRoundMedians: rs.map(r => +r.median.toFixed(3)),
            probe: mid.probe,
          });
        }

  // Robustness: a few Jolt runs lose 1-2 bodies through the ground mesh. They
  // are reported, never dropped from the headline numbers; this records how
  // much the medians would move if they were dropped.
  const med = a => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) / 2)];
  };
  const contaminated = runs.filter(r => r.probe.belowGround);
  let maxShift = 0;
  for (const scenario of SCENARIOS)
    for (const n of CFG.counts)
      for (const variant of VARIANTS) {
        if (!variant.primary) continue;
        for (const engine of ['rapier', 'jolt']) {
          const all = runs.filter(r => r.scenario === scenario.id && r.n === n && r.variant === variant.id && r.engine === engine);
          const clean = all.filter(r => !r.probe.belowGround);
          if (!all.length || !clean.length) continue;
          maxShift = Math.max(maxShift, Math.abs(med(clean.map(r => r.median)) / med(all.map(r => r.median)) - 1));
        }
      }
  const robustness = {
    runs: runs.length,
    contaminatedRuns: contaminated.length,
    byEngine: { rapier: contaminated.filter(r => r.engine === 'rapier').length, jolt: contaminated.filter(r => r.engine === 'jolt').length },
    byVariant: Object.fromEntries([...new Set(runs.map(r => r.variant))].map(v => [v, contaminated.filter(r => r.variant === v).length])),
    maxRelativeShiftIfDropped: +maxShift.toFixed(3),
  };

  const out = { generatedAt: new Date().toISOString(), env, versions, wasm, config: CFG, variants: VARIANTS, scenarios: SCENARIOS.map(({ id, scene, warmup, measure }) => ({ id, scene, warmup, measure })), startState, robustness, rows, runs };
  const jsonPath = path.resolve(here, argv.json ?? 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  const md = renderMarkdown(out);
  fs.writeFileSync(path.resolve(here, 'results.md'), md);
  process.stdout.write(md + '\n');
  process.stderr.write(`\nwrote ${jsonPath} and results.md\n`);
}

/* ------------------------------------------------------------------ output */

function renderMarkdown(out) {
  const { rows, env, versions, wasm, config, startState, scenarios, robustness, variants } = out;
  const L = [];
  const f = v => v.toFixed(3);
  L.push('### Environment');
  L.push('');
  L.push(`- Platform: ${env.platform}; ${env.cpu} (${env.cores} logical cores); ${env.memoryGB} GB RAM`);
  L.push(`- Node ${env.node} (V8 ${env.v8}); single-threaded, no worker threads`);
  L.push(`- Rapier \`${versions.rapier.pkg}\` ${versions.rapier.version}, ES build the game vendors (\`rapier.es.js\`, base64-inlined WASM); WebAssembly instantiate calls at init: ${wasm.rapierWasm.instantiate}`);
  L.push(`- Jolt \`${versions.jolt.pkg}\` ${versions.jolt.version}, \`wasm-compat\` build (base64-inlined WASM); WebAssembly instantiate calls at init: ${wasm.joltWasm.instantiate}`);
  L.push(`- Timestep ${config.dt.toFixed(6)} s (game STEP = 1/60); ${config.rounds} rounds, median of per-round medians/p95s; engine order alternated per round`);
  L.push(
    `- Scene: density ${config.density}, friction ${config.friction} / restitution ${config.restitution} on body *and* ground (equal values so any combine rule agrees), linear damping ${config.linearDamping}, angular damping ${config.angularDamping}, CCD ${config.ccd ? 'on (Rapier CCD / Jolt LinearCast)' : 'off'}, Z-up, land gravity ${config.gravity.rubble.join(',')}, space gravity ${config.gravity.fleet.join(',')}`
  );
  L.push(`- Windows: ${scenarios.map(s => `${s.id} = ${s.warmup} warm-up + ${s.measure} timed steps`).join('; ')}`);
  L.push('');
  L.push('### Headline (median step time, ms; both engines at their library defaults)');
  L.push('');
  L.push('| workload | bodies | Rapier | Jolt | Jolt/Rapier |');
  L.push('| --- | ---: | ---: | ---: | ---: |');
  for (const scenario of scenarios.map(s => s.id))
    for (const n of config.counts) {
      const rap = rows.find(r => r.scenario === scenario && r.n === n && r.variant === 'library-defaults' && r.engine === 'rapier');
      const jol = rows.find(r => r.scenario === scenario && r.n === n && r.variant === 'library-defaults' && r.engine === 'jolt');
      if (!rap || !jol) continue;
      L.push(`| ${scenario} | ${n} | ${f(rap.median)} | ${f(jol.median)} | ${(jol.median / rap.median).toFixed(2)}x |`);
    }
  L.push('');
  L.push('Solver variants measured:');
  L.push('');
  for (const v of variants)
    L.push(
      `- \`${v.id}\` — Rapier ${v.rapier.iters} solver / ${v.rapier.pgs} PGS / ${v.rapier.frictionIters} friction iters; Jolt ${v.jolt.vel} velocity / ${v.jolt.pos} position steps; sleeping ${v.sleep ? 'on' : 'off'}; CCD ${v.ccd === false ? 'off' : 'on'}${v.note ? `. ${v.note}` : ''}`
    );
  L.push('');
  L.push(
    `Robustness: ${robustness.contaminatedRuns} of ${robustness.runs} runs ended with bodies below the ground mesh (Rapier ${robustness.byEngine.rapier}, Jolt ${robustness.byEngine.jolt}; by variant ${JSON.stringify(robustness.byVariant)}). Dropping those runs changes the primary \`library-defaults\` medians by at most ${(robustness.maxRelativeShiftIfDropped * 100).toFixed(1)}%.`
  );
  L.push('');
  L.push('### Seeded start state identical in both engines (max abs error before stepping)');
  L.push('');
  L.push('| scene | engine | max pos err | max linvel err | max angvel err |');
  L.push('| --- | --- | ---: | ---: | ---: |');
  for (const s of startState) {
    L.push(`| ${s.scene} | rapier | ${s.rapier.maxPosErr} | ${s.rapier.maxLinvelErr} | ${s.rapier.maxAngvelErr} |`);
    L.push(`| ${s.scene} | jolt | ${s.jolt.maxPosErr} | ${s.jolt.maxLinvelErr} | ${s.jolt.maxAngvelErr} |`);
  }
  L.push('');
  L.push('### Step time (ms per physics step)');
  L.push('');
  L.push('| workload | bodies | solver config | engine | median | p95 | mean | awake / bodies | moving>0.5 u/s | mean speed | mean z | fell through ground |');
  L.push('| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows)
    L.push(
      `| ${r.scenario} | ${r.n} | ${r.variant}${r.primary ? '' : ' (secondary)'} | ${r.engine} | ${f(r.median)} | ${f(r.p95)} | ${f(r.mean)} | ${r.probe.awake} / ${r.probe.bodies} | ${r.probe.movingFast} | ${r.probe.meanSpeed.toFixed(2)} | ${r.probe.meanZ.toFixed(1)} | ${r.probe.belowGround ?? '—'} |`
    );
  L.push('');
  L.push('### Jolt / Rapier step-time ratio (median, p95)');
  L.push('');
  L.push('| workload | bodies | solver config | median ratio | p95 ratio |');
  L.push('| --- | ---: | --- | ---: | ---: |');
  for (const scenario of scenarios.map(s => s.id))
    for (const n of config.counts)
      for (const variant of [...new Set(rows.map(r => r.variant))]) {
        const rap = rows.find(r => r.scenario === scenario && r.n === n && r.variant === variant && r.engine === 'rapier');
        const jol = rows.find(r => r.scenario === scenario && r.n === n && r.variant === variant && r.engine === 'jolt');
        if (!rap || !jol) continue;
        L.push(`| ${scenario} | ${n} | ${variant} | ${(jol.median / rap.median).toFixed(2)}x | ${(jol.p95 / rap.p95).toFixed(2)}x |`);
      }
  return L.join('\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
