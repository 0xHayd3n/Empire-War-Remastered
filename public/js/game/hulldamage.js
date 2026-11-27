import * as T from 'three';
import { stockHull } from './destroyer-detail.js';
import { surfacePatch, coldBankGeometry } from './impactpatch.js';
import { impactVertex, impactFragment } from '../impactshader.js';

const fragmentShader = impactFragment(false),
  ENGINE = 'HP_STAR_DESTROYER_ENGINES';
const local = new T.Vector3();
export function supportedHull(u) {
  const m = u?.model && stockHull(u);
  return m?.material.userData.stockDestroyerPaint ? m : null;
}
function visible(u) {
  return !u.dead && !u.hyper && !u.scriptHidden && !u.cloaked && u.obj.visible && u.world.viewerSees(u);
}
export class HullDamage {
  constructor(scene) {
    this.scene = scene;
    this.marks = [];
    this.banks = new Map();
    this.candidates = [];
    this.last = new WeakMap();
  }
  make(geo, kind) {
    const mat = new T.ShaderMaterial({
      vertexShader: impactVertex,
      fragmentShader,
      uniforms: { damageStage: { value: new T.Vector2(kind, 0) } },
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const m = new T.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    m.renderOrder = kind === 1 ? 5 : 1;
    this.scene.add(m);
    return m;
  }
  drop(m, shared = false) {
    m.removeFromParent();
    m.material.dispose();
    if (!shared) m.geometry.dispose();
  }
  remove(i) {
    this.drop(this.marks[i].mesh);
    this.marks.splice(i, 1);
  }
  clear() {
    while (this.marks.length) this.remove(0);
    for (const m of this.banks.values()) this.drop(m, true);
    this.banks.clear();
    this.bankGeo?.dispose();
    this.bankGeo = null;
    this.roster = null;
    this.candidates = [];
    this.last = new WeakMap();
  }
  hit(u, x, y, z, size, shield = false, part = -1) {
    const hull = supportedHull(u);
    if (!hull || !visible(u) || ![x, y, z].every(Number.isFinite)) return false;
    const source = shield ? u.shieldMesh?.children.find(m => m.isMesh) : hull;
    if (!source || (!shield && u.hardpoints[part]?.decal?.visible)) return false;
    const time = u.world.time;
    const recent = this.last.get(u) || [-Infinity, -Infinity],
      k = Number(shield);
    if (time - recent[k] < (shield ? 0.09 : 0.16)) return true;
    recent[k] = time;
    this.last.set(u, recent);
    source.updateWorldMatrix(true, false);
    source.worldToLocal(local.set(x, y, z));
    const radius = shield ? 65 : Math.min(33, Math.max(12, 10 + size * 0.55));
    const data = surfacePatch(source.geometry, local, radius, shield);
    if (!data) return false;
    // Coalesce renewed fire on the same plate; bounded per ship and per battle.
    const own = this.marks.filter(m => m.u === u && m.shield === shield);
    const previous =
      own.find(m => m.center.distanceToSquared(data.center) < (radius * 0.5) ** 2) || (own.length >= (shield ? 2 : 8) ? own[0] : null);
    if (previous) this.remove(this.marks.indexOf(previous));
    if (this.marks.length >= 64) this.remove(0);
    const mesh = this.make(data.geo, k);
    mesh.matrix.copy(source.matrixWorld);
    this.marks.push({ u, source, center: data.center, mesh, part, time, shield });
    return true;
  }
  update(w, on) {
    if (this.roster !== w.units || this.count > w.units.length) {
      this.roster = w.units;
      this.candidates = [];
      this.count = 0;
    }
    while (this.count < w.units.length) {
      const u = w.units[this.count++];
      if (supportedHull(u)) this.candidates.push(u);
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const a = this.marks[i],
        dt = Math.max(0, w.time - a.time);
      if (
        a.u.dead ||
        !a.u.obj.parent ||
        a.u.world !== w ||
        (a.shield && dt >= 0.46) ||
        (!a.shield && a.u.hardpoints[a.part]?.decal?.visible)
      ) {
        this.remove(i);
        continue;
      }
      a.mesh.visible = on && visible(a.u);
      if (!a.mesh.visible) continue;
      a.source.updateWorldMatrix(true, false);
      a.mesh.matrix.copy(a.source.matrixWorld);
      a.mesh.matrixWorldNeedsUpdate = true;
      a.mesh.material.uniforms.damageStage.value.y = dt;
    }
    for (const u of this.candidates) {
      // This mounted model has ONE hardpoint and one particle proxy for all three main bells.
      // Never infer a separate port/starboard failure or cover a mod's own damage replacement.
      const hp = u.hardpoints.find(h => h.kind === 'HARD_POINT_ENGINE' && h.def.name.toUpperCase() === ENGINE);
      if (!on || !hp || hp.alive || hp.decal || !visible(u)) continue;
      const source = supportedHull(u);
      if (!source) continue;
      let m = this.banks.get(u);
      if (!m) {
        m = this.make((this.bankGeo ||= coldBankGeometry()), 2);
        this.banks.set(u, m);
      }
      source.updateWorldMatrix(true, false);
      m.matrix.copy(source.matrixWorld);
      m.matrixWorldNeedsUpdate = true;
    }
    for (const [u, m] of this.banks)
      if (!on || !visible(u) || !u.obj.parent || u.engineAlive() || u.world !== w) {
        this.drop(m, true);
        this.banks.delete(u);
      }
  }
}
