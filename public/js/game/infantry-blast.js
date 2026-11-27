import { Quaternion, Vector3 } from 'three';
import { settlePose } from './posecache.js';

const MAX = 36,
  LIFE = 1.15;
const v = new Vector3(),
  q = new Quaternion(),
  parent = new Quaternion(),
  around = new Quaternion();
const rigs = new WeakMap();
function rig(inst) {
  if (rigs.has(inst)) return rigs.get(inst);
  const roles = ['Chest', 'Head', 'Thigh_L', 'Thigh_R', 'Calf_L', 'Calf_R', 'Foot_L', 'Foot_R'];
  const bones = roles.map(n => inst.bone?.('B_' + n));
  const r = bones.every(Boolean) && !inst.flat && !inst.skinMask ? bones : null;
  rigs.set(inst, r);
  return r;
}
function twist(bone, axis, radians) {
  bone.parent.getWorldQuaternion(parent);
  q.setFromAxisAngle(axis, radians);
  bone.quaternion.premultiply(around.copy(parent).invert().multiply(q).multiply(parent));
  bone.updateWorldMatrix(false, false);
}
function footZ(bones) {
  return Math.min(bones[6].getWorldPosition(v).z, bones[7].getWorldPosition(v).z);
}

// A visual reflex, not a second source of damage, orders, muzzle directions or unit positions.
export class InfantryBlast {
  active = new Map();
  posed = [];
  emit(units, x, y, z, radius) {
    if (!(radius > 0) || ![x, y, z, radius].every(Number.isFinite)) return;
    for (const u of units) {
      if (!u.foot || u.dead || u.inside || u.flies || u.scriptHidden || u.netHidden || u.seen === false || !u.holder?.visible || !u.inst)
        continue;
      const dx = u.x - x,
        dy = u.y - y,
        d = Math.hypot(dx, dy, (u.z || 0) + 6 - z);
      if (d >= radius || !rig(u.inst)) continue;
      const strength = Math.sqrt(1 - d / radius),
        old = this.active.get(u);
      if (old && old.age < 0.55 && old.strength >= strength * 0.85) continue;
      if (!old && this.active.size >= MAX) {
        let weakest;
        for (const r of this.active.values()) if (!weakest || r.strength < weakest.strength) weakest = r;
        if (weakest.strength >= strength) continue;
        this.active.delete(weakest.u);
      }
      const a = dx || dy ? Math.atan2(dy, dx) : (u.heading || 0) + Math.PI;
      this.active.set(u, { u, age: (-0.05 * d) / radius, strength, dx: Math.cos(a), dy: Math.sin(a) });
    }
  }
  step(dt) {
    for (const [u, r] of this.active) if (u.dead || u.gone || (r.age += dt) >= LIFE) this.active.delete(u);
  }
  applyOne(u) {
    const r = this.active.get(u);
    if (!r || r.age <= 0 || u.inside || !u.holder.visible || !u.inst) return false;
    const k = r.strength * Math.min(1, r.age / 0.13) * Math.min(1, (LIFE - r.age) / 0.7);
    if (!(k > 0)) return false;
    const inst = u.inst,
      bones = rig(inst),
      h = u.holder;
    if (!bones) return false;
    // Realize the current walk/fire pose first; restore it before any simulation tick.
    settlePose(inst);
    h.updateWorldMatrix(true, true);
    r.saved ||= Array.from({ length: 6 }, () => new Quaternion());
    for (let i = 0; i < 6; i++) r.saved[i].copy(bones[i].quaternion);
    r.z = h.position.z;
    this.posed.push({ r, h, bones, inst });
    const planted = footZ(bones),
      a = u.heading || 0;
    v.set(-Math.sin(a), Math.cos(a), 0);
    for (let i = 2; i < 4; i++) twist(bones[i], v, -0.74 * k);
    for (let i = 4; i < 6; i++) twist(bones[i], v, 1.47 * k);
    twist(bones[0], v, 0.38 * k);
    twist(bones[1], v, 0.16 * k);
    v.set(-r.dy, r.dx, 0);
    twist(bones[0], v, 0.4 * k);
    h.position.z += planted - footZ(bones);
    h.updateWorldMatrix(true, true);
    inst.syncSkins();
    return true;
  }
  apply(exclude) {
    for (const { u } of this.active.values()) if (u !== exclude && !u.dead) this.applyOne(u);
  }
  restore() {
    for (const { r, h, bones, inst } of this.posed) {
      for (let i = 0; i < 6; i++) bones[i].quaternion.copy(r.saved[i]);
      h.position.z = r.z;
      h.updateWorldMatrix(true, true);
      inst.syncSkins();
    }
    this.posed.length = 0;
  }
}
