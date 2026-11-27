import * as THREE from 'three';
import { settlePose } from './posecache.js';
import { infantryBone, hasLimbChains, hasNamedRoles } from './infantry-bones.js';
import { articulatedPlan } from './infantry-articulation.js';
import { supportClearance, splitIndex, exactClearance } from './ragdoll-surface.js';

const Y = new THREE.Vector3(0, 1, 0),
  ONE = new THREE.Vector3(1, 1, 1);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
// Rapier's joint limits are impulse limits: a part landing under the whole body slides
// straight through them, and a welded stub can roll. A general joint therefore keeps a
// small backstop below; within this much of it the solver is left alone so a corpse
// lying still can still fall asleep.
const STOP = 0.12;
const m = new THREE.Matrix4(),
  inv = new THREE.Matrix4();
const worldPoint = bone => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

// Ten linked bodies over a named ALO humanoid skin, or an articulated doll over the
// rig's own authored hierarchy for any other skeleton: creatures, droids, arbitrary
// bone labels, rigid parts parented to bones. Both paths share the same drawing,
// parking and clamped stepping below. A rig that names humanoid anatomy but does not
// resolve to a usable one keeps its death animation: its labels say what it meant to
// be, and a re-read of a broken humanoid would put made-up limbs on screen.
export function infantryRagdoll(R, world, u, height, collisionGroups = 0x00020001) {
  const inst = u.inst;
  if (!u.foot || !inst || inst.flat || inst.skinMask) return null;
  const named = hasNamedRoles(inst);
  if (named && !inst.skins?.length) return null;
  // The cached pose may only exist in a draw palette. Realize it once before the
  // death event swaps animations. Never write a physics transform into the unit.
  settlePose(inst);
  u.holder.updateWorldMatrix(true, true);
  inst.syncSkins();
  const plan = named ? humanoidPlan(inst, u) : articulatedPlan(inst);
  if (!plan) return null;
  const length = plan.length,
    spans = plan.spans;
  const nodes = [],
    slots = new Map(),
    copies = [];
  const root = new THREE.Group();
  root.name = 'Infantry ragdoll: ' + u.type.name;
  let separate = null;
  const owned = [],
    lift = [0, 0];
  let frozen = false,
    released = false;
  function releaseBodies() {
    if (released) return;
    released = true;
    for (const s of nodes) world.removeRigidBody(s.body);
  }
  function dispose() {
    root.removeFromParent();
    releaseBodies();
    for (const geo of owned) geo.dispose();
  }
  function part(spec) {
    const start = spec.start,
      end = spec.end,
      size = end.distanceTo(start);
    if (!(size > 0.02 * length && size < length)) throw Error('Unusable infantry bone span');
    const center = start.clone().lerp(end, 0.5),
      r = Math.min(spec.radius * length, size * 0.52);
    const angle = (u.heading || 0) + Math.PI + 0.22,
      kick = length * spec.kick;
    const dir = end.clone().sub(start),
      body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(center.x, center.y, center.z)
          .setLinvel(Math.cos(angle) * kick, Math.sin(angle) * kick, length * 0.07)
          .setAngvel({ x: -Math.sin(angle) * 2.4, y: Math.cos(angle) * 2.4, z: 0.12 })
          .setAngularDamping(1.5)
          .setAdditionalSolverIterations(4)
      );
    const s = {
      name: spec.name,
      body,
      center,
      matrix: new THREE.Matrix4(),
      bind: new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
      detachable: spec.detachable
    };
    nodes.push(s);
    slots.set(spec.bone, s);
    world.createCollider(
      // Initial body axes are world-aligned; rotate the *collider* to the posed bone.
      // Thus both anchors of a hinge start with exactly the same local axis.
      R.ColliderDesc.capsule(Math.max(0.01, size / 2 - r), r)
        .setRotation(new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize()))
        .setFriction(0.85)
        .setRestitution(0.02)
        // Contacts with the ground and other limbs; adjacent spans overlap at
        // their shared pivot and are excluded by the joint below.
        .setCollisionGroups(collisionGroups),
      body
    );
    const base = spec.parent === null ? null : nodes[spec.parent],
      pivot = spec.pivot;
    if (base) {
      const a = pivot.clone().sub(base.center),
        b = pivot.clone().sub(center);
      const joint = world.createImpulseJoint(
        spec.fixed
          ? R.JointData.fixed(a, IDENTITY, b, IDENTITY)
          : spec.axis
            ? R.JointData.revolute(a, b, spec.axis)
            : R.JointData.spherical(a, b),
        base.body,
        body,
        true
      );
      s.joint = joint;
      s.parent = base;
      s.anchorParent = a;
      s.anchorChild = b;
      // Only the general tree is clamped; the tuned humanoid keeps Rapier's own limits.
      s.limit = spec.hinge ? { axis: spec.axis, lo: spec.limits[0], hi: spec.limits[1] } : null;
      s.weld = !!spec.weld;
      joint.setContactsEnabled(false);
      if (spec.limits) joint.setLimits(spec.limits[0], spec.limits[1]);
    }
    return s;
  }
  function owner(b) {
    for (; b; b = b.parent) if (slots.has(b)) return slots.get(b);
    return nodes[0];
  }
  const anchor = new THREE.Vector3(),
    offset = new THREE.Vector3();
  const qa = new THREE.Quaternion(),
    qr = new THREE.Quaternion(),
    qb = new THREE.Vector3();
  // Hold each general joint at its authored pose. The correction is applied to the
  // body itself, so the drawn span, the collider and the joint anchor agree on one
  // pose; only a welded part, or one that has left its authored range, is touched.
  function holdLimits() {
    for (const s of nodes) {
      // A blasted-off part has left its joint: nothing holds it to its old parent.
      if ((!s.limit && !s.weld) || s === separate) continue;
      const lim = s.limit,
        parent = s.parent.rotation;
      qr.copy(parent).invert().multiply(s.rotation);
      if (!lim) {
        // A welded part is authored rigid, so any drift under load is a pose error.
        if (2 * Math.acos(Math.min(1, Math.abs(qr.w))) < STOP) continue;
        s.rotation.copy(parent);
        s.body.setRotation(s.rotation, true);
        s.body.setAngvel(s.parent.body.angvel(), true);
        continue;
      }
      // q and -q are the same orientation. Use the short arc near rest even if
      // the native solver chose opposite quaternion signs for parent and child.
      if (qr.w < 0) qr.set(-qr.x, -qr.y, -qr.z, -qr.w);
      const along = qr.x * lim.axis.x + qr.y * lim.axis.y + qr.z * lim.axis.z,
        angle = 2 * Math.atan2(along, qr.w),
        want = Math.min(lim.hi, Math.max(lim.lo, angle)),
        roll = Math.hypot(qr.x - along * lim.axis.x, qr.y - along * lim.axis.y, qr.z - along * lim.axis.z);
      // Solver noise inside the stop is left alone: a resting corpse must be able to sleep.
      if (Math.abs(want - angle) < STOP && roll < STOP) continue;
      s.rotation.copy(qa.setFromAxisAngle(lim.axis, want).premultiply(parent));
      s.body.setRotation(s.rotation, true);
      // A stop must not keep being fed: drop the spin that pressed into it.
      const world = qb.copy(lim.axis).applyQuaternion(parent),
        spin = offset.copy(s.body.angvel()).sub(s.parent.body.angvel()).dot(world);
      if ((angle > lim.hi && spin > 0) || (angle < lim.lo && spin < 0))
        s.body.setAngvel(offset.copy(s.body.angvel()).addScaledVector(world, -spin), true);
    }
  }
  function beforeStep() {
    // Cosmetic casualties cannot propel themselves. Only a separated piece
    // gets a little upward travel; clamp unexpected contact/separation energy.
    for (const s of nodes) {
      if (s.body.isSleeping()) continue;
      const v = s.body.linvel(),
        max = length * (s === separate ? 2 : 1.8),
        up = length * (s === separate ? 0.65 : 0.2);
      if (v.z > up || Math.hypot(v.x, v.y, v.z) > max) s.body.setLinvel(offset.set(v.x, v.y, Math.min(v.z, up)).clampLength(0, max), false);
      const spin = s.body.angvel();
      if (Math.hypot(spin.x, spin.y, spin.z) > 8) s.body.setAngvel(offset.copy(spin).clampLength(0, 8), false);
    }
  }
  function sync(exact) {
    if (frozen) return;
    for (const s of nodes) {
      s.position.copy(s.body.translation());
      s.rotation.copy(s.body.rotation());
    }
    if (!named) holdLimits();
    for (const s of nodes) {
      // Reconstruct connected translations from the parent pivot and the bone's
      // original offsets. Solver error must never become a stretched skin.
      const draw =
        s.parent && s !== separate
          ? anchor.copy(s.anchorParent).applyMatrix4(s.parent.matrix).sub(offset.copy(s.anchorChild).applyQuaternion(s.rotation))
          : s.position;
      s.matrix.compose(draw, s.rotation, ONE);
    }
    if (height) {
      lift.fill(0);
      // Live contact is a cheap cached-extreme correction, every frame. A pose
      // about to be parked takes the exact whole-skin fit once instead, because
      // nothing will correct it afterwards.
      if (exact) exactClearance(copies, height, separate, length, lift);
      else for (const c of copies) if (c.weights) supportClearance(c, height, separate, lift);
      // Floor contact is a small skin correction, never a launch from one
      // outlying weighted vertex on a ledge or on an unusual Workshop rig. The
      // parked fit may lift one body length, which is still bounded.
      const cap = exact ? length : length * 0.22;
      for (const s of nodes) s.matrix.elements[14] += Math.min(cap, lift[s === separate ? 1 : 0]);
    }
    root.matrix.copy(nodes[0].matrix);
    const toRoot = inv.copy(root.matrix).invert();
    for (const c of copies) {
      if (!c.weights) {
        c.mesh.matrix.multiplyMatrices(toRoot, c.s.matrix).multiply(c.bind);
        continue;
      }
      // Bone matrices live in mesh space, not world space. Each bind matrix
      // includes the original skin pose and the offset to its physical segment.
      c.inverse.multiplyMatrices(root.matrix, c.mesh.matrix).invert();
      for (const { s, bind, at } of c.weights) m.multiplyMatrices(c.inverse, s.matrix).multiply(bind).toArray(c.palette, at);
    }
    root.updateMatrixWorld(true);
  }
  // Freeze the drawn pose against the terrain, then hand the native bodies back.
  // This is the last chance to move the skin: a parked island is never solved or
  // synced again, so its fit has to be exact and its correction is baked in.
  function park() {
    if (frozen) return;
    sync(true);
    frozen = true;
    releaseBodies();
  }
  try {
    for (const spec of spans) part(spec);
    for (const s of nodes) {
      s.position = new THREE.Vector3();
      s.rotation = new THREE.Quaternion();
    }
    root.matrixAutoUpdate = false;
    const skins = new Map((inst.skins || []).map(s => [s.mesh, s]));
    inst.root.traverseVisible(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.material?.visible || o.material?.userData.additive) return;
      const skin = skins.get(o);
      const mesh = new THREE.Mesh(o.geometry, o.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false; // bind-pose bounds are not the fallen skin's bounds
      mesh.renderOrder = o.renderOrder;
      if (skin) {
        const palette = skin.mats.slice(),
          weights = [];
        for (let i = 0; i < skin.boneMap.length && i * 16 < palette.length; i++) {
          const s = owner(inst.bones[skin.boneMap[i]]);
          const bind = s.bind
            .clone()
            .multiply(o.matrixWorld)
            .multiply(m.fromArray(palette, i * 16));
          weights.push({ s, bind, at: i * 16 });
        }
        if (!weights.length) return;
        mesh.matrix.multiplyMatrices(nodes[0].bind, o.matrixWorld);
        mesh.onBeforeRender = () => {
          mesh.material.uniforms.boneMatrices.value = palette;
          mesh.material.uniformsNeedUpdate = true;
        };
        copies.push({ mesh, palette, weights, inverse: new THREE.Matrix4() });
      } else {
        const s = owner(o.parent);
        copies.push({ mesh, s, bind: s.bind.clone().multiply(o.matrixWorld) });
      }
      root.add(mesh);
    });
    // A rig with no skinned surface still draws its rigid parts, one body each.
    if (!copies.length) {
      dispose();
      return null;
    }
    sync();
    return {
      root,
      nodes,
      sync,
      park,
      get parked() {
        return frozen;
      },
      beforeStep,
      dispose,
      owned,
      releaseBodies,
      get detached() {
        return separate?.name;
      },
      blast(x, y, z) {
        if (separate) return false;
        const origin = new THREE.Vector3(x, y, z);
        const choices = nodes
          .filter(s => s.detachable)
          .sort((a, b) => origin.distanceToSquared(a.position) - origin.distanceToSquared(b.position));
        for (const s of choices) {
          const cuts = copies.filter(c => c.weights).map(c => [c, splitIndex(c, s)]);
          // Skin blended across the seam is clipped; a part drawn entirely by its
          // own rigid kit has no seam to clip.
          if (!copies.some(c => !c.weights && c.s === s) && !cuts.some(([, cut]) => cut.detached > 0)) continue;
          for (const [c, cut] of cuts)
            if (cut.changed) {
              const geo = c.mesh.geometry.clone();
              geo.setIndex(cut.kept);
              owned.push(geo);
              c.mesh.geometry = geo;
              c.support = null;
            }
          separate = s;
          world.removeImpulseJoint(s.joint, true);
          const push = s.position
            .clone()
            .sub(origin)
            .setZ(length * 0.45)
            .normalize()
            .multiplyScalar(length * 0.95);
          s.body.setLinvel(push.add(s.body.linvel()), true);
          return true;
        }
        return false;
      }
    };
  } catch (e) {
    dispose();
    throw e;
  }
}

// The tuned stock path: exactly ten bodies over a named, connected humanoid rig.
// Anything the labels cannot place stays with its death animation instead.
function humanoidPlan(inst, u) {
  const lookup = name => infantryBone(inst, name);
  const names = [
    'Pelvis',
    'Head',
    ...['L', 'R'].flatMap(side => ['Bicep', 'FArm', 'Hand', 'Thigh', 'Calf', 'Foot'].map(n => n + '_' + side))
  ];
  const rig = Object.fromEntries(names.map(n => [n, lookup(n)]));
  if (names.some(n => !rig[n]) || new Set(Object.values(rig)).size !== names.length) return null;
  if (names.some(n => rig[n] !== inst.bone?.('B_' + n)) && !hasLimbChains(rig)) return null;

  const p = Object.fromEntries(names.map(n => [n, worldPoint(rig[n])]));
  const length = p.Head.distanceTo(p.Pelvis) + p.Thigh_L.distanceTo(p.Calf_L) + p.Calf_L.distanceTo(p.Foot_L);
  if (!(length > 1 && length < 100)) return null;
  // Some animated/hidden helper bones collapse or are moved off-model. Don't
  // hand an implausible pose to the solver (or skin a casualty across the map).
  const feet = new THREE.Vector3(u.x, u.y, u.holder.position.z);
  if (Object.values(p).some(v => !Number.isFinite(v.lengthSq()) || v.distanceTo(feet) > length * 1.65)) return null;
  const up = p.Head.clone().sub(p.Pelvis).normalize();
  const sideways = p.Thigh_L.clone().sub(p.Thigh_R).normalize();
  const front = new THREE.Vector3().crossVectors(sideways, up).normalize();
  if (sideways.lengthSq() < 0.5 || front.lengthSq() < 0.5) return null;

  const spans = [];
  const add = (name, start, end, radius, parent, axis, limits, kick, detachable) =>
    spans.push({ name, bone: rig[name], start, end, pivot: start, radius, parent, axis, limits, fixed: false, kick, detachable }) - 1;
  add('Pelvis', p.Pelvis, p.Head, 0.108, null, null, null, 0.66, false);
  // Allow a small nod from the captured pose, never free roll or twist.
  add('Head', p.Head, p.Head.clone().addScaledVector(up, length * 0.105), 0.083, 0, sideways, [-0.2, 0.25], 0.74, false);
  function limbJoint(top, joint, tip, fallback) {
    const a = p[joint].clone().sub(p[top]).normalize(),
      b = p[tip].clone().sub(p[joint]).normalize();
    const axis = a.clone().cross(b),
      bend = a.angleTo(b);
    return [axis.lengthSq() > 0.008 ? axis.normalize() : fallback, [-bend - 0.04, Math.max(0.04, 2.4 - bend)]];
  }
  for (const side of ['L', 'R']) {
    const n = role => role + '_' + side;
    const thigh = add(n('Thigh'), p[n('Thigh')], p[n('Calf')], 0.068, 0, null, null, 0.2, false);
    add(n('Calf'), p[n('Calf')], p[n('Foot')], 0.054, thigh, ...limbJoint(n('Thigh'), n('Calf'), n('Foot'), sideways), 0.2, true);
    const arm = add(n('Bicep'), p[n('Bicep')], p[n('FArm')], 0.052, 0, null, null, 0.2, false);
    add(n('FArm'), p[n('FArm')], p[n('Hand')], 0.046, arm, ...limbJoint(n('Bicep'), n('FArm'), n('Hand'), front), 0.2, true);
  }
  return { length, spans };
}
