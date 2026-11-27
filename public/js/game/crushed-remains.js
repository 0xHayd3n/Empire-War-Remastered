import * as T from 'three';
import { placeCached } from './posecache.js';

// A crush is a different final pose, not a blast followed by a second corpse.
// Keep borrowed draw geometry/materials and a frozen skin palette. Never squash
// the live holder: it still belongs to game logic and may become an obstacle.
const MAX_REMAINS = 96,
  MAX_MESHES = 64,
  MAX_INDICES = 98000;
const v = new T.Vector3(),
  tmp = new T.Vector3(),
  p = new T.Vector3();
function capture(u, heading, height) {
  if (!u.inst?.root || !u.holder || !Number.isFinite(u.x + u.y + heading)) return null;
  if (!u.inst.pc || !placeCached(u)) {
    u.holder.updateWorldMatrix(true, true);
    if (u.inst.dirty || u.inst.skins?.some(s => !s.mats)) u.inst.syncSkins?.();
  }
  const root = new T.Group(),
    box = new T.Box3(),
    skins = new Map((u.inst.skins || []).map(s => [s.mesh, s.mats]));
  const rotate = new T.Matrix4().makeRotationAxis(new T.Vector3(-Math.sin(heading), Math.cos(heading), 0), u.foot ? Math.PI / 2 : 0);
  const local = rotate.multiply(new T.Matrix4().makeTranslation(-u.x, -u.y, -u.z));
  let indices = 0,
    bad = false;
  u.inst.root.traverseVisible(src => {
    if (!src.isMesh || src.isInstancedMesh || src.material?.visible === false || !src.geometry?.attributes.position) return;
    if (Array.isArray(src.material) || (src.material.transparent && !src.material.depthWrite)) return;
    const g = src.geometry,
      { position, skinIndex, skinWeight } = g.attributes,
      index = g.index;
    const start = g.drawRange.start,
      end = Math.min(index?.count ?? position.count, start + g.drawRange.count);
    if (end <= start) return;
    if (bad || (indices += end - start) > MAX_INDICES || root.children.length >= MAX_MESHES) {
      bad = true;
      return;
    }
    const mesh = new T.Mesh(g, src.material),
      into = mesh.matrix.multiplyMatrices(local, src.matrixWorld),
      palette = skins.get(src)?.slice();
    const bones = palette && Array.from({ length: palette.length / 16 }, (_, i) => new T.Matrix4().fromArray(palette, 16 * i));
    if (skinIndex && (!bones || !skinWeight)) {
      bad = true;
      return;
    }
    const seen = new Uint8Array(position.count);
    for (let i = start; i < end; i++) {
      const j = index ? index.getX(i) : i;
      if (seen[j]) continue;
      seen[j] = 1;
      v.fromBufferAttribute(position, j);
      p.copy(v);
      if (skinIndex) {
        p.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = skinWeight.getComponent(j, k);
          if (!w) continue;
          const m = bones[skinIndex.getComponent(j, k)];
          if (!m) {
            bad = true;
            return;
          }
          p.addScaledVector(tmp.copy(v).applyMatrix4(m), w);
        }
      }
      box.expandByPoint(p.applyMatrix4(into));
    }
    mesh.matrixAutoUpdate = false;
    // The source renderer's skin shader reads this before each draw, on both backends.
    if (palette && src.material.uniforms?.boneMatrices)
      mesh.onBeforeRender = () => {
        mesh.material.uniforms.boneMatrices.value = palette;
        mesh.material.uniformsNeedUpdate = true;
      };
    mesh.frustumCulled = false;
    root.add(mesh);
  });
  const size = box.getSize(new T.Vector3());
  if (bad || box.isEmpty() || !(size.length() > 0 && size.length() < 700)) return null;
  const c = box.getCenter(new T.Vector3()),
    x = u.x,
    y = u.y,
    z = height(x, y),
    r = Math.max(1, Math.min(15, Math.max(size.x, size.y) * 0.4));
  const dx = (height(x + r, y) - height(x - r, y)) / (2 * r),
    dy = (height(x, y + r) - height(x, y - r)) / (2 * r);
  if (!Number.isFinite(z + dx + dy)) return null;
  const press = u.foot ? 0.22 : 0.18;
  // Lay foot soldiers along travel; retain a vehicle's hull outline. Flatten
  // normal to the local ground plane instead of leaving an upright paper doll.
  root.matrixAutoUpdate = false;
  root.matrix.set(1, 0, 0, x - c.x, 0, 1, 0, y - c.y, dx, dy, press, z + 0.12 - dx * c.x - dy * c.y - press * box.min.z, 0, 0, 0, 1);
  root.name = 'Crushed: ' + (u.type?.name || u.kind);
  return { root, x, y, z, foot: !!u.foot };
}
export class CrushedRemains {
  constructor(scene, height, fogged, keepBodies) {
    Object.assign(this, { scene, height, fogged, keepBodies });
    this.rows = [];
  }
  present(u, heading) {
    if (
      u.structure ||
      u.flies ||
      u.flight ||
      u.inside ||
      u.scriptHidden ||
      u.netHidden ||
      u.cloaked ||
      u.seen === false ||
      !u.holder?.visible ||
      this.fogged(u.x, u.y)
    )
      return false;
    const row = capture(u, heading, this.height);
    if (!row) return false;
    row.age = 0;
    this.scene.add(row.root);
    row.root.updateMatrixWorld(true);
    this.rows.push(row);
    if (this.rows.length > MAX_REMAINS) this.rows.shift().root.removeFromParent();
    return true;
  }
  step(dt) {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.foot && !this.keepBodies() && (r.age += Math.max(0, dt)) > 12) {
        r.root.removeFromParent();
        this.rows.splice(i, 1);
        continue;
      }
      r.root.visible = !this.fogged(r.x, r.y);
      if (r.root.visible) {
        const z = this.height(r.x, r.y);
        if (Number.isFinite(z) && z !== r.z) {
          r.root.matrix.elements[14] += z - r.z;
          r.z = z;
          r.root.matrixWorldNeedsUpdate = true;
        }
      }
    }
  }
  dispose() {
    for (const r of this.rows) r.root.removeFromParent();
    this.rows.length = 0;
  }
}
