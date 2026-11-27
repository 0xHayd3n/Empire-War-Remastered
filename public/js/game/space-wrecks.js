import * as T from 'three';
import { wreckSkin, releaseSkinGeometry } from './wreck-skin.js';
import { DeathFragments } from './death-fragments.js';
import { HullCuts } from './hull-cut-cache.js';

// Detached ALO mesh groups, not individual triangles/material slots. Death animations
// and scripted spin paths own the visual until release. A monolithic hull can be
// sectioned at that point; collision, glow and damage-proxy meshes aren't debris.
const MAX = 64,
  PER_SHIP = 6,
  LIFE = 48,
  STEP = 1 / 60;
export class SpaceWrecks {
  constructor(R, scene) {
    this.R = R;
    this.scene = scene;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = STEP;
    this.pieces = [];
    this.residue = new DeathFragments(R, this.world, scene);
    this.cuts = new HullCuts();
    this.owed = 0;
  }
  spawn(root, velocity, radius, inst = null) {
    if (!root?.visible || this.pieces.length >= MAX || !this.world) return 0;
    root.updateWorldMatrix(true, true);
    const groups = new Map(),
      center = new T.Vector3();
    root.getWorldPosition(center);
    const skins = new Map(inst?.skins?.map(s => [s.mesh, s]));
    function group(key, m) {
      const g = m.geometry;
      g.boundingBox || g.computeBoundingBox();
      const box = g.boundingBox.clone().applyMatrix4(m.matrixWorld);
      if (box.isEmpty() || !Number.isFinite(box.min.lengthSq() + box.max.lengthSq())) return;
      let row = groups.get(key);
      if (!row) groups.set(key, (row = { meshes: [], box: new T.Box3() }));
      row.meshes.push(m);
      row.box.union(box);
    }
    root.traverseVisible(m => {
      const g = m.geometry;
      if (
        !m.isMesh ||
        !g?.attributes.position ||
        m.material?.transparent ||
        !m.material?.visible ||
        /shield|collision|shadow|muzzle|engineglow/i.test(m.parent?.name || '')
      )
        return;
      if (!g.attributes.skinIndex) group(m.parent, m);
      else for (const chunk of wreckSkin(m, skins.get(m))) group(chunk, chunk);
    });
    let rows = [...groups.values()].sort((a, b) => b.box.getSize(new T.Vector3()).lengthSq() - a.box.getSize(new T.Vector3()).lengthSq());
    if (!rows.length) return 0;
    const limit = Math.min(PER_SHIP, MAX - this.pieces.length);
    if (rows.length === 1 && limit > 1) {
      const source = rows[0].meshes;
      const cut = this.cuts.cut(
        source.map(mesh => ({ mesh, palette: mesh.userData.frozenPalette })),
        root.matrixWorld,
        limit
      );
      if (cut) {
        const retained = new Set(cut.flatMap(p => p.meshes.map(({ mesh }) => mesh)));
        for (const m of source) if (m.userData.frozenPalette && !retained.has(m)) releaseSkinGeometry(m.geometry);
        rows = cut.map(({ box, meshes }) => ({
          box,
          meshes: meshes.map(({ mesh, palette, generated }) => {
            if (generated) {
              mesh.userData.fractured = true;
              mesh.userData.frozenPalette = palette;
            }
            return mesh;
          })
        }));
      }
    }
    for (const row of rows.splice(limit)) {
      rows[0].meshes.push(...row.meshes);
      rows[0].box.union(row.box);
    }
    const R = this.R;
    for (const [i, row] of rows.entries()) {
      const at = row.box.getCenter(new T.Vector3()),
        half = row.box.getSize(new T.Vector3()).multiplyScalar(0.5),
        dir = at.clone().sub(center);
      if (dir.lengthSq() < 0.01) dir.set(Math.cos(i * 2.4), Math.sin(i * 2.4), 0.25);
      dir.normalize().multiplyScalar((i ? 1 : 0.25) * Math.max(2, Math.min(38, radius * 0.11)));
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(at.x, at.y, at.z)
          .setLinvel(velocity.x + dir.x, velocity.y + dir.y, velocity.z + dir.z)
          .setAngvel({ x: 0.045 * ((i % 3) - 1), y: 0.04 * (1 + (i % 2)), z: 0.035 * (i % 2 ? -1 : 1) })
          .setCanSleep(false)
      );
      // Broad hull boxes overlap at birth. Keep sibling debris from launching one another or hitting live units.
      this.world.createCollider(
        R.ColliderDesc.cuboid(Math.max(0.1, half.x), Math.max(0.1, half.y), Math.max(0.1, half.z)).setCollisionGroups(0),
        body
      );
      const obj = new T.Group(),
        owned = [];
      obj.position.copy(at);
      const rel = new T.Matrix4().makeTranslation(-at.x, -at.y, -at.z);
      for (const m of row.meshes) {
        const g = m.geometry.userData.battleCut ? m.geometry.clone() : m.geometry;
        if (g !== m.geometry || m.userData.fractured) owned.push(g);
        const mesh = new T.Mesh(g, m.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(rel, m.matrixWorld);
        if (m.userData.frozenPalette) {
          const palette = m.userData.frozenPalette;
          mesh.userData.frozenSkin = !m.userData.fractured; // only authored index views borrow shared attributes
          mesh.onBeforeRender = () => {
            mesh.material.uniforms.boneMatrices.value = palette;
            mesh.material.uniformsNeedUpdate = true;
          };
        }
        obj.add(mesh);
      }
      this.scene.add(obj);
      this.pieces.push({ obj, body, owned, age: 0 });
    }
    return rows.length;
  }
  step(dt, world) {
    if ((!this.pieces.length && !this.residue.pieces.length) || !(dt > 0)) return;
    this.owed += Math.min(dt, 0.1);
    while (this.owed >= STEP) {
      this.world.step();
      this.owed -= STEP;
    }
    this.residue.sync(dt, world && ((x, y) => world.viewFogged(x, y)));
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      if (p.age > LIFE) {
        this.remove(i);
        continue;
      }
      p.obj.position.copy(p.body.translation());
      p.obj.quaternion.copy(p.body.rotation());
      if (world) p.obj.visible = !world.viewFogged(p.obj.position.x, p.obj.position.y);
    }
  }
  remove(i) {
    const [p] = this.pieces.splice(i, 1);
    p.obj.removeFromParent();
    for (const m of p.obj.children) if (m.userData.frozenSkin) releaseSkinGeometry(m.geometry);
    p.owned.forEach(g => g.dispose());
    this.world.removeRigidBody(p.body);
  }
  clear() {
    while (this.pieces.length) this.remove(this.pieces.length - 1);
    this.residue.clear();
    this.owed = 0;
  }
  dispose() {
    this.clear();
    this.residue.dispose();
    this.cuts.dispose();
    this.world.free();
    this.world = null;
  }
}
