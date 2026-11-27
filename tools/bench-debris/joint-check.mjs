/**
 * joint-check — Node acceptance test for the joint/capsule extension of jolt-bridge.mjs.
 *
 * Runs against the real pinned jolt-physics 1.1.2 wasm build. Every check states what Rapier
 * would do, so a failure means the seam is not behaviour-compatible:
 *   A  capsule collider orientation + body frame/centre (rotated and offset capsules)
 *   B  setAdditionalSolverIterations → Jolt absolute solver-step override (body + constraint)
 *   C  native Point and Hinge constraints hold their anchors
 *   D  hinge angular limits bound right-handed rotation about the joint axis
 *   E  joint contacts really are suppressed for the connected pair only (native
 *      PhysicsSystem::WereBodiesInContact, not inferred from positions), and detaching a joint
 *      re-enables that pair
 *   F  setLinvel/setAngvel/isSleeping honour Rapier's wakeUp flag
 *   G  a capsule chain dropped on offset ground stays attached and does not sink
 *   H  detach/removal/free release constraints and bodies: counts return to 0 across worlds
 *   I  capacity guards fail loudly instead of silently disabling the wrong pairs
 *
 * Usage: node joint-check.mjs        (exit code 0 = all checks passed)
 */
import assert from 'node:assert/strict';
import init from 'jolt-physics/wasm-compat';
import { joltBridge } from './jolt-bridge.mjs';

const J = await init();
const R = joltBridge(J);
const results = [];
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn() || '';
    results.push(['PASS', name, detail]);
  } catch (e) {
    failed++;
    results.push(['FAIL', name, e.message]);
  }
}

const near = (actual, expected, tol, what) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${what}: got ${actual.toFixed(4)}, expected ${expected.toFixed(4)} ± ${tol}`
  );
const true_ = (value, what) => assert.ok(value, what);

/* ---------------------------------------------------------------- helpers */

const quatRotate = (q, v) => {
  // v' = q * v * q^-1 (unit quaternion)
  const { x, y, z, w } = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
};

const worldPoint = (body, local) => {
  const p = body.translation(),
    q = body.rotation();
  const r = quatRotate(q, local);
  return [p.x + r[0], p.y + r[1], p.z + r[2]];
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Flat trimesh ground at z = z0, as the game builds its translated patches. */
function ground(world, z0 = 0, size = 200, groups = 0x00010002) {
  return world.createCollider(
    R.ColliderDesc.trimesh(
      new Float32Array([-size, -size, 0, size, -size, 0, size, size, 0, -size, size, 0]),
      new Uint32Array([0, 1, 2, 0, 2, 3])
    )
      .setTranslation(0, 0, z0)
      .setFriction(0.85)
      .setRestitution(0.02)
      .setCollisionGroups(groups)
  );
}

const capsule = (world, body, halfHeight, radius, rotation, translation, groups = 0x00020001) => {
  const desc = R.ColliderDesc.capsule(halfHeight, radius)
    .setFriction(0.85)
    .setRestitution(0.02)
    .setCollisionGroups(groups);
  if (rotation) desc.setRotation(rotation);
  if (translation) desc.setTranslation(...translation);
  return world.createCollider(desc, body);
};

const contact = (world, a, b) => world._ps.WereBodiesInContact(a.id, b.id);

/* A — capsule orientation and body frame/centre --------------------------- */

check('A capsule collider rotation orients the capsule and keeps the body frame at its centre', () => {
  const world = new R.World({ x: 0, y: 0, z: -100 });
  world.createCollider(
    R.ColliderDesc.trimesh(
      new Float32Array([-200, -200, 0, 200, -200, 0, 200, 200, 0, -200, 200, 0]),
      new Uint32Array([0, 1, 2, 0, 2, 3])
    )
      .setFriction(0.85)
      .setRestitution(0.02)
      .setCollisionGroups(0x00010002)
  );
  // World is Z-up. Rotating the collider 90 deg about Z turns the capsule's local +Y axis
  // into world -X, i.e. the capsule lies flat and its lowest point is one *radius* down.
  const qz90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 4).setCcdEnabled(true));
  capsule(world, body, 1, 0.3, qz90);
  for (let i = 0; i < 300; i++) world.step();
  const z = body.translation().z;
  near(z, 0.3, 0.02, 'lying capsule rest height (body origin == capsule centre, radius 0.3)');
  const r = body.rotation();
  assert.ok(Math.hypot(r.x, r.y, r.z, r.w) > 0.99, 'rotation readback is a unit quaternion');
  world.free();
  return `body z=${z.toFixed(3)} (upright capsule would rest at 1.3)`;
});

check('A offset capsule keeps Rapier collider->body frame semantics and converts joint anchors', () => {
  const world = new R.World({ x: 0, y: 0, z: -100 });
  const qz90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  const offset = [0, 0, 0.5]; // collider centre is 0.5 above the body origin, in body space
  const doll = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 30));
  capsule(world, doll, 1, 0.3, qz90, offset);
  const com = doll._centerOfMassInBodySpace();
  near(com[2], 0.5, 1e-6, 'centre of mass offset in body space');

  // A fixed handle hinged exactly at the capsule centre: body-space anchor (0,0,0.5).
  const handle = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0, 30));
  // Rapier anchor convention: anchor1 is on body1 (the handle), anchor2 on body2 (the doll).
  // Both point at the capsule centre, the pivot the hinge must hold.
  const joint = world.createImpulseJoint(R.JointData.revolute([0, 0, 0.5], [0, 0, 0.5], [1, 0, 0]), handle, doll, true);
  joint.setContactsEnabled(false);
  for (let i = 0; i < 240; i++) world.step();
  const centre = worldPoint(doll, [0, 0, 0.5]);
  const pivot = worldPoint(handle, [0, 0, 0.5]);
  near(dist(centre, pivot), 0, 0.02, 'hinge pivot == capsule centre (anchor COM conversion)');
  world.free();
  return `capsule centre to pivot=${dist(centre, pivot).toFixed(4)}`;
});

/* B — additional solver iterations --------------------------------------- */

check('B setAdditionalSolverIterations maps to Jolt absolute solver-step overrides', () => {
  const world = new R.World({ x: 0, y: 0, z: -10 });
  const plain = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 10));
  capsule(world, plain, 0.5, 0.25);
  const extra = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(0, 2, 10).setAdditionalSolverIterations(4)
  );
  capsule(world, extra, 0.5, 0.25);
  const joint = world.createImpulseJoint(
    R.JointData.spherical([0, -0.5, 0], [0, 0.5, 0]),
    plain,
    extra,
    true
  );
  const steps = world._solverSteps();
  const mp = world._ps.GetBodyLockInterfaceNoLock().TryGetBody(extra.id).GetMotionProperties();
  const bodyV = mp.GetNumVelocityStepsOverride(),
    bodyP = mp.GetNumPositionStepsOverride();
  const jointV = joint.constraint.GetNumVelocityStepsOverride(),
    jointP = joint.constraint.GetNumPositionStepsOverride();
  assert.equal(bodyV, steps.velocity + 4, 'body velocity-step override = default + 4');
  assert.equal(bodyP, steps.position + 4, 'body position-step override = default + 4');
  assert.equal(jointV, steps.velocity + 4, 'joint velocity-step override = default + 4');
  assert.equal(jointP, steps.position + 4, 'joint position-step override = default + 4');
  const plainMp = world._ps.GetBodyLockInterfaceNoLock().TryGetBody(plain.id).GetMotionProperties();
  assert.equal(plainMp.GetNumVelocityStepsOverride(), 0, 'unset body keeps Jolt default (0 = inherit)');
  world.free();
  return `defaults ${steps.velocity}v/${steps.position}p -> ${bodyV}v/${bodyP}p`;
});

/* C — native point and hinge constraints --------------------------------- */

check('C point constraint holds its anchors while both bodies stay free to rotate', () => {
  const world = new R.World({ x: 0, y: 0, z: 0 }); // no gravity: only the joint acts
  const top = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 20).setCanSleep(false));
  capsule(world, top, 0.4, 0.2);
  const bottom = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(0, 0, 19.2)
      .setCanSleep(false)
      .setAngvel({ x: 4, y: 0, z: 0 })
      .setLinvel(3, 0, 0)
  );
  capsule(world, bottom, 0.4, 0.2);
  const anchorTop = [0, 0, -0.4],
    anchorBottom = [0, 0, 0.4];
  world.createImpulseJoint(R.JointData.spherical(anchorTop, anchorBottom), top, bottom, true);
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    world.step();
    worst = Math.max(worst, dist(worldPoint(top, anchorTop), worldPoint(bottom, anchorBottom)));
  }
  assert.ok(worst < 0.05, `spherical anchor separation stayed ${worst.toFixed(4)} (< 0.05)`);
  // Free rotation: a point joint must not lock relative rotation.
  const a = top.rotation(),
    b = bottom.rotation();
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  true_(dot < 0.999, `bodies rotated relative to each other (|q1.q2| = ${dot.toFixed(6)})`);
  world.free();
  return `max anchor error ${worst.toFixed(5)}, |q1.q2|=${dot.toFixed(4)}`;
});

check('C hinge apex stays coincident across 300 steps', () => {
  const world = new R.World({ x: 0, y: 0, z: -100 });
  const trunk = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 20).setCanSleep(false));
  capsule(world, trunk, 0.5, 0.24);
  const limb = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(0, 0.9, 20).setCanSleep(false).setAngvel({ x: 5, y: 0, z: 0 })
  );
  capsule(world, limb, 0.4, 0.18);
  const a = [0, 0.5, 0],
    b = [0, -0.4, 0];
  const joint = world.createImpulseJoint(R.JointData.revolute(a, b, [1, 0, 0]), trunk, limb, true);
  joint.setLimits(-0.6, 0.6);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    world.step();
    worst = Math.max(worst, dist(worldPoint(trunk, a), worldPoint(limb, b)));
  }
  assert.ok(worst < 0.05, `hinge anchor separation stayed ${worst.toFixed(4)} (< 0.05)`);
  const angle = joint.angle();
  assert.ok(Number.isFinite(angle), 'hinge angle readback is finite');
  world.free();
  return `max anchor error ${worst.toFixed(5)}, final angle ${angle.toFixed(3)}`;
});

/* D — hinge limits ------------------------------------------------------- */

check('D hinge limits bound right-handed rotation about the joint axis', () => {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  // Fixed post, dynamic limb hanging 1 below it, hinge axis +X: not touching, so only the
  // joint acts and the limit is the only thing that can stop the spin.
  const post = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 20, 0));
  capsule(world, post, 0.3, 0.15);
  const limb = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(0, 18.2, 0).setCanSleep(false).setAngularDamping(0)
  );
  capsule(world, limb, 0.75, 0.2);
  const joint = world.createImpulseJoint(R.JointData.revolute([0, -0.3, 0], [0, 0.75, 0], [1, 0, 0]), post, limb, true);
  joint.setLimits(-0.2, 0.25);
  assert.equal(joint.hinge.GetLimitsMin().toFixed(4), '-0.2000', 'native limit min installed');
  assert.equal(joint.hinge.GetLimitsMax().toFixed(4), '0.2500', 'native limit max installed');

  const peak = { lo: 0, hi: 0 };
  limb.setAngvel({ x: 9, y: 0, z: 0 }, true);
  for (let i = 0; i < 150; i++) {
    world.step();
    const a = joint.angle();
    peak.hi = Math.max(peak.hi, a);
    peak.lo = Math.min(peak.lo, a);
  }
  // Settled window (last 30 steps) must be inside the limits.
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < 30; i++) {
    world.step();
    lo = Math.min(lo, joint.angle());
    hi = Math.max(hi, joint.angle());
  }
  assert.ok(hi <= 0.25 + 0.02, `positive saturation ${hi.toFixed(4)} inside max 0.25`);
  assert.ok(peak.hi <= 0.25 + 0.08, `transient peak ${peak.hi.toFixed(4)} within solver overshoot`);

  limb.setAngvel({ x: -9, y: 0, z: 0 }, true);
  for (let i = 0; i < 150; i++) world.step();
  lo = Infinity;
  for (let i = 0; i < 30; i++) {
    world.step();
    lo = Math.min(lo, joint.angle());
  }
  assert.ok(lo >= -0.2 - 0.02, `negative saturation ${lo.toFixed(4)} inside min -0.2`);
  world.free();
  return `peak +${peak.hi.toFixed(3)} / settled [${lo.toFixed(3)}, ${hi.toFixed(3)}] against [-0.2, 0.25]`;
});

/* E — contact suppression and detach ------------------------------------ */

check('E joint contacts are suppressed for the connected pair only, and detach restores them', () => {
  const world = new R.World({ x: 0, y: 0, z: 0 }); // no gravity, no ground: only pair contacts act
  // Same collision group within one doll (memberships == filter), as infantry-ragdoll.js builds
  // with its isolated per-doll group: limbs collide with each other unless a joint excludes it.
  const DOLL = 0x00020002;
  const part = (x, halfHeight, radius) => {
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0, 30).setCanSleep(false));
    capsule(world, body, halfHeight, radius, null, null, DOLL);
    return body;
  };
  // Three overlapping capsules with *consistent* pivots (Rapier anchor convention), like an
  // adjacent limb pair (torso/thigh) plus a limb that is linked but not adjacent (thigh/calf).
  const torso = part(0, 0.5, 0.3);
  const thigh = part(0.4, 0.4, 0.25);
  const calf = part(0.75, 0.4, 0.25);

  const hip = world.createImpulseJoint(R.JointData.spherical([0.2, 0, 0], [-0.2, 0, 0]), torso, thigh, true);
  world.createImpulseJoint(R.JointData.spherical([0.175, 0, 0], [-0.175, 0, 0]), thigh, calf, true);
  hip.setContactsEnabled(false);

  for (let i = 0; i < 5; i++) world.step();
  assert.equal(contact(world, torso, thigh), false, 'connected pair (torso/thigh) has no contacts');
  assert.equal(contact(world, thigh, calf), true, 'linked-but-not-adjacent pair still collides');
  assert.equal(contact(world, torso, calf), false, 'non-overlapping pair reports no contact (filter is not global)');

  // Detach: the pair must collide again the moment the joint is gone.
  world.removeImpulseJoint(hip, true);
  for (let i = 0; i < 5; i++) world.step();
  assert.equal(contact(world, torso, thigh), true, 'detached pair collides again');
  assert.equal(world.numJoints(), 1, 'one joint remains after the detach');

  // Control: an identical pair whose contacts were never disabled does collide.
  const left = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(-4, 0, 30).setCanSleep(false));
  capsule(world, left, 0.5, 0.3, null, null, DOLL);
  const right = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(-3.6, 0, 30).setCanSleep(false));
  capsule(world, right, 0.4, 0.25, null, null, DOLL);
  world.createImpulseJoint(R.JointData.spherical([0.2, 0, 0], [-0.2, 0, 0]), left, right, true);
  for (let i = 0; i < 5; i++) world.step();
  assert.equal(contact(world, left, right), true, 'control pair with contacts enabled collides');
  world.free();
  return 'suppressed -> 0 contacts, non-adjacent/linked and detached pairs -> contacts present';
});

/* F — velocities and sleeping ------------------------------------------- */

check('F setLinvel/setAngvel write through, wakeUp=false does not wake, isSleeping works', () => {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 25));
  capsule(world, body, 0.5, 0.25);
  for (let i = 0; i < 120; i++) world.step();
  assert.equal(body.isSleeping(), true, 'still body falls asleep');

  body.setLinvel({ x: 2, y: 0, z: 0 }, false);
  const before = body.translation().x;
  for (let i = 0; i < 10; i++) world.step();
  near(body.translation().x, before, 1e-6, 'sleeping body did not move after setLinvel(..., false)');
  assert.equal(body.isSleeping(), true, 'still asleep after setLinvel(..., false)');

  body.setLinvel({ x: 2, y: 0, z: 0 }, true);
  assert.equal(body.isSleeping(), false, 'setLinvel(..., true) wakes the body');
  const v = body.linvel();
  near(v.x, 2, 1e-4, 'linvel readback after setLinvel');
  for (let i = 0; i < 10; i++) world.step();
  assert.ok(body.translation().x > before, 'awake body moved with the written velocity');

  body.setAngvel({ x: 0, y: 0, z: 4 }, true);
  const w = body.angvel();
  near(w.z, 4, 1e-4, 'angvel readback after setAngvel');
  world.free();
  return `linvel ${v.x.toFixed(3)}, angvel ${w.z.toFixed(3)}`;
});

/* G — the actual scenario: a capsule chain on offset ground -------------- */

check('G connected capsules dropped on offset ground stay attached and do not sink', () => {
  const world = new R.World({ x: 0, y: 0, z: -100 }, { velocitySteps: 10, positionSteps: 2 });
  // The game's translated ground patch (Z-up, top face at z = 40), wreck collision groups.
  world.createCollider(
    R.ColliderDesc.trimesh(
      new Float32Array([-60, -60, 0, 60, -60, 0, 60, 60, 0, -60, 60, 0]),
      new Uint32Array([0, 1, 2, 0, 2, 3])
    )
      .setTranslation(800, 1500, 40)
      .setFriction(0.85)
      .setRestitution(0.02)
      .setCollisionGroups(0x00010002)
  );

  // Ten capsules in infantryRagdoll's shape: torso, head, two arms, two legs, hinged with the
  // same kind of limits, plus spherical hips/shoulders. Every authored pivot is shared, so the
  // doll starts at rest instead of being yanked by inconsistent anchors.
  // [name, x, centreZ, halfHeight, radius, parent, anchorOnParent, anchorOnChild, axis, limits]
  const spec = [
    ['Pelvis', 0, 43.0, 0.5, 0.24, null],
    ['Head', 0, 43.85, 0.3, 0.16, 'Pelvis', [0, 0.5, 0], [0, -0.35, 0], [1, 0, 0], [-0.2, 0.25]],
    ['Thigh_L', 0.28, 42.15, 0.5, 0.18, 'Pelvis', [0.28, -0.35, 0], [0, 0.5, 0], null, null],
    ['Calf_L', 0.28, 41.25, 0.4, 0.15, 'Thigh_L', [0, -0.5, 0], [0, 0.4, 0], [1, 0, 0], [-0.2, 0.6]],
    ['Thigh_R', -0.28, 42.15, 0.5, 0.18, 'Pelvis', [-0.28, -0.35, 0], [0, 0.5, 0], null, null],
    ['Calf_R', -0.28, 41.25, 0.4, 0.15, 'Thigh_R', [0, -0.5, 0], [0, 0.4, 0], [1, 0, 0], [-0.2, 0.6]],
    ['Bicep_L', 0.6, 42.6, 0.4, 0.14, 'Pelvis', [0.6, 0, 0], [0, 0.4, 0], null, null],
    ['FArm_L', 0.6, 41.85, 0.3, 0.12, 'Bicep_L', [0, -0.4, 0], [0, 0.35, 0], [1, 0, 0], [-0.2, 0.8]],
    ['Bicep_R', -0.6, 42.6, 0.4, 0.14, 'Pelvis', [-0.6, 0, 0], [0, 0.4, 0], null, null],
    ['FArm_R', -0.6, 41.85, 0.3, 0.12, 'Bicep_R', [0, -0.4, 0], [0, 0.35, 0], [1, 0, 0], [-0.2, 0.8]]
  ];
  const nodes = new Map(),
    joints = [];
  for (const [name, x, z, halfHeight, radius, parentName, a1, a2, axis, limits] of spec) {
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(800 + x, 1500, z)
        .setAngularDamping(1.5)
        .setAdditionalSolverIterations(4)
    );
    capsule(world, body, halfHeight, radius);
    nodes.set(name, { body, halfHeight, radius });
    if (parentName) {
      const parent = nodes.get(parentName).body;
      const data = axis ? R.JointData.revolute(a1, a2, axis) : R.JointData.spherical(a1, a2);
      const joint = world.createImpulseJoint(data, parent, body, true);
      joint.setContactsEnabled(false);
      if (limits) joint.setLimits(limits[0], limits[1]);
      joints.push({ joint, parent, child: body, a1, a2, name });
    }
  }
  assert.equal(world.numJoints(), 9, 'nine joints created');

  let worstAnchor = 0;
  for (let i = 0; i < 600; i++) {
    world.step();
    if (i > 60 && i % 10 === 0)
      for (const j of joints)
        worstAnchor = Math.max(worstAnchor, dist(worldPoint(j.parent, j.a1), worldPoint(j.child, j.a2)));
  }
  const heights = [...nodes.values()].map(({ body }) => body.translation().z);
  const lowest = Math.min(...heights);
  let meanSpeed = 0;
  for (const { body } of nodes.values()) {
    const v = body.linvel();
    meanSpeed += Math.hypot(v.x, v.y, v.z);
  }
  meanSpeed /= nodes.size;
  assert.ok(lowest > 39, `no capsule sank through the offset ground (lowest centre ${lowest.toFixed(2)})`);
  assert.ok(worstAnchor < 0.08, `hinge anchors held (worst ${worstAnchor.toFixed(4)})`);
  assert.ok(meanSpeed < 3, `chain is not exploding (mean speed ${meanSpeed.toFixed(3)})`);
  assert.equal(world.numBodies(), 11, '10 capsules + ground');
  assert.equal(world.numJoints(), 9, 'all nine joints still live');
  world.free();
  return `lowest centre ${lowest.toFixed(2)}, worst anchor ${worstAnchor.toFixed(4)}, mean speed ${meanSpeed.toFixed(3)}`;
});

/* H — detach / removal / release across worlds -------------------------- */

check('H detach, body removal and free release constraints and bodies (counts 0 across worlds)', () => {
  const counts = [];
  for (let round = 0; round < 6; round++) {
    const world = new R.World({ x: 0, y: 0, z: -100 });
    ground(world, 0);
    const bodies = [];
    const jointed = [];
    for (let i = 0; i < 8; i++) {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(i * 0.7, 0, 5 + i));
      capsule(world, body, 0.3, 0.15);
      bodies.push(body);
    }
    for (let i = 1; i < bodies.length; i++) {
      const j = world.createImpulseJoint(
        R.JointData.revolute([0, -0.3, 0], [0, 0.3, 0], [1, 0, 0]),
        bodies[i - 1],
        bodies[i],
        true
      );
      j.setContactsEnabled(false);
      jointed.push(j);
    }
    for (let i = 0; i < 30; i++) world.step();
    assert.equal(world.numJoints(), 7, 'seven joints live during the run');

    if (round % 2 === 0) {
      // Rapier detach path used by infantry-ragdoll.js blast().
      world.removeImpulseJoint(jointed[3], true);
      assert.equal(world.numJoints(), 6, 'joint count drops on removeImpulseJoint');
      // Rapier: removing a body drops its attached joints.
      world.removeRigidBody(bodies[1]);
      assert.equal(world.numJoints(), 4, 'removing a body dropped both of its joints');
    } else {
      for (const j of jointed) world.removeImpulseJoint(j, false);
      assert.equal(world.numJoints(), 0, 'all joints removed');
    }
    // Free with live joints left on purpose: constraints must go before their bodies.
    counts.push({ bodies: world.numBodies(), joints: world.numJoints() });
    world.free();
  }
  const last = counts[counts.length - 1];
  assert.equal(last.joints, 0, 'final world has no joints');
  assert.equal(counts[1].bodies, 9, 'second world (no removals) had 8 capsules + ground');
  assert.equal(counts[0].bodies, 8, 'first world lost one body before free');
  return `round body/joint counts ${counts.map(c => `${c.bodies}/${c.joints}`).join(' ')} (all freed)`;
});

/* I — capacity guards --------------------------------------------------- */

check('I capacity guards fail loudly instead of disabling the wrong pairs', () => {
  const world = new R.World({ x: 0, y: 0, z: 0 }, { jointGroups: 4 });
  const bodies = [];
  for (let i = 0; i < 4; i++) {
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(i * 3, 0, 0));
    capsule(world, body, 0.4, 0.2);
    bodies.push(body);
  }
  const joints = [];
  for (let i = 1; i < 4; i++)
    joints.push(world.createImpulseJoint(R.JointData.spherical([0, 0.4, 0], [0, -0.4, 0]), bodies[i - 1], bodies[i], true));
  joints[0].setContactsEnabled(false);
  joints[1].setContactsEnabled(false);
  assert.throws(() => joints[2].setContactsEnabled(false), /no free joint collision groups/, 'exhausted table throws');
  world.free();

  // Object layers are still capped at 32 (31 usable + the inert layer).
  const layers = new R.World({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 31; i++) {
    const value = (0x00030000 | ((i + 1) << 2)) >>> 0;
    const body = layers.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(i, 0, 0));
    layers.createCollider(R.ColliderDesc.cuboid(0.2, 0.2, 0.2).setCollisionGroups((value << 16) | value), body);
  }
  const body = layers.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(50, 0, 0));
  assert.throws(
    () => layers.createCollider(R.ColliderDesc.cuboid(0.2, 0.2, 0.2).setCollisionGroups(0xdeadbeef), body),
    /distinct collisionGroups/,
    'more than 31 object layers throws'
  );
  layers.free();
  return 'jointGroups and 32-layer ceilings throw with clear messages';
});

/* ------------------------------------------------------------------ report */

for (const [status, name, detail] of results) console.log(`${status}  ${name}\n      ${detail}`);
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) {
  console.error(`${failed} FAILED`);
  process.exit(1);
}
console.log('All joint/capsule checks passed against jolt-physics 1.1.2 wasm.');
