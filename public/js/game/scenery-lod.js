import * as T from 'three';
import { fleetLodMeshes, sceneryMaterial } from '../model.js';
import { GeometryLevels } from './model-detail.js';
import { sceneryRole } from '../scenery-surface.js';
import { landDetailLevel, projectedDiameter } from './land-detail.js';

const at = new T.Vector3();
// Diameter on screen, not distance from the command cursor. The two bands overlap
// to avoid switching repeatedly while the camera hovers at a boundary.
export const sceneryLevel = landDetailLevel;
export class LandScenery extends GeometryLevels {
  rows = new Map();
  scenery = true;
  active = false;
  register(props, on) {
    const toggle = on !== this.active;
    if (!toggle && (!on || (this.list === props && this.count === props?.length))) return;
    this.active = on;
    this.list = props;
    this.count = props?.length;
    if (on)
      for (const p of props || []) {
        if (this.rows.has(p.grp)) continue;
        const role = sceneryRole(p.mapType, p.modelFile, p.surfaceHint),
          parts = [];
        const authored = fleetLodMeshes(p.inst);
        p.grp.traverse(mesh => {
          if (!mesh.isMesh || mesh.isInstancedMesh || mesh.material?.defines?.SKINNED || Array.isArray(mesh.material)) return;
          parts.push({
            mesh,
            high: mesh.geometry,
            original: mesh.material,
            material: sceneryMaterial(mesh.material, role),
            authored: authored.get(mesh)
          });
        });
        const sphere = p.inst.drawBox.getBoundingSphere(new T.Sphere());
        this.rows.set(p.grp, { sphere, parts, level: 0 });
        if (!toggle) for (const part of parts) { part.mesh.material = part.material; part.mesh.modelDetailManaged = true; }
      }
    if (!toggle) return; // Appending a prop must not reset the current LOD of its neighbours.
    for (const row of this.rows.values()) {
      row.level = 0;
      for (const p of row.parts) {
        p.mesh.modelDetailManaged = on;
        p.mesh.geometry = p.high;
        p.mesh.material = on ? p.material : p.original;
      }
    }
  }
  select(holder, camera, height) {
    const row = this.rows.get(holder);
    if (!row || !this.active || !row.parts.length) return;
    const radius = row.sphere.radius * holder.matrixWorld.getMaxScaleOnAxis();
    at.copy(row.sphere.center).applyMatrix4(holder.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    row.level = this.detailEnabled === false ? 0 : sceneryLevel(projectedDiameter(radius, -at.z, height, camera.projectionMatrix.elements[5], !camera.isOrthographicCamera), row.level);
    for (const p of row.parts) {
      if (!p.mesh.visible) continue;
      const levels = row.level && !p.authored ? this.reduced(p.high) : null;
      const medium = p.authored || levels?.[0] || p.high;
      const distant = levels?.[1];
      p.mesh.geometry =
        row.level === 0 ? p.high : row.level === 2 && distant && distant.index.count < medium.index.count ? distant : medium;
    }
  }
  dispose() {
    this.register(null, false);
    super.dispose();
    this.rows.clear();
  }
}
