import * as T from 'three';
import { sliceHull } from './hull-sections.js';
import { interiorMaterial } from './fracture-caps.js';

// Some exporters attach several pods or plates to the same parent. When those
// meshes don't touch at all, there's no reason to bisect their textures or copy
// their vertices. Only use a palette's box if it is already the posed bounds.
function separatePods(inputs, limit) {
  if (limit < 2 || inputs.length < 2 || inputs.length > 64 || inputs.some(p => p.palette && !p.mesh.userData.frozenPalette)) return null;
  const chunks = [];
  for (const p of inputs) {
    const geo = p.mesh.geometry;
    geo.boundingBox || geo.computeBoundingBox();
    const box = geo.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld);
    const chunk = { meshes: [p], box: box.clone(), members: [box.clone().expandByScalar(0.02)] };
    for (let i = chunks.length - 1; i >= 0; i--)
      if (chunks[i].members.some(b => b.intersectsBox(box))) {
        const other = chunks.splice(i, 1)[0];
        chunk.meshes.push(...other.meshes);
        chunk.members.push(...other.members);
        chunk.box.union(other.box);
      }
    chunks.push(chunk);
  }
  if (chunks.length < 2) return null;
  const size = p => p.box.getSize(new T.Vector3()).lengthSq();
  chunks.sort((a, b) => size(b) - size(a));
  for (const extra of chunks.splice(limit)) {
    const center = extra.box.getCenter(new T.Vector3());
    const nearest = chunks.reduce((a, b) => (a.box.distanceToPoint(center) < b.box.distanceToPoint(center) ? a : b));
    nearest.meshes.push(...extra.meshes);
    nearest.box.union(extra.box);
  }
  return chunks;
}

// Rigid identical hulls in a squad commonly die on the same frame. Clip once per
// immutable mesh. Templates never enter the scene; each casualty owns its draw
// geometry, orientation, and current livery. Skins/armor cuts are pose-specific.
export class HullCuts {
  cache = new Map();
  cut(inputs, basis, limit) {
    const natural = separatePods(inputs, limit);
    if (natural) return natural;
    const getInterior = () => (this.interior ||= interiorMaterial());
    const item = inputs.length === 1 && inputs[0],
      src = item?.mesh,
      g = src?.geometry;
    if (!src || item.palette || g.attributes.skinIndex || g.userData.battleCut || limit < 3)
      return sliceHull(inputs, basis, limit, getInterior);
    if (!this.cache.has(g)) {
      const parts = sliceHull(inputs, src.matrixWorld, limit, getInterior);
      if (!parts) return null;
      if (this.cache.size >= 6) this.drop(this.cache.keys().next().value);
      const inverse = src.matrixWorld.clone().invert();
      for (const p of parts) for (const { mesh } of p.meshes) mesh.matrixWorld.premultiply(inverse);
      this.cache.set(g, parts);
    }
    const template = this.cache.get(g);
    if (!template) return null;
    return template.map(p => {
      const box = new T.Box3(),
        meshes = p.meshes.map(({ mesh }) => {
          const copy = new T.Mesh(mesh.geometry.clone(), mesh.material === this.interior ? this.interior : src.material);
          copy.matrixWorld.multiplyMatrices(src.matrixWorld, mesh.matrixWorld);
          box.union(copy.geometry.boundingBox.clone().applyMatrix4(copy.matrixWorld));
          return { mesh: copy, generated: true };
        });
      return { box, meshes };
    });
  }
  drop(g) {
    for (const p of this.cache.get(g) || []) for (const { mesh } of p.meshes) mesh.geometry.dispose();
    this.cache.delete(g);
  }
  dispose() {
    for (const g of this.cache.keys()) this.drop(g);
    this.interior?.map.dispose();
    this.interior?.dispose();
  }
}
