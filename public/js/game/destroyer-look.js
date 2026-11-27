import * as T from 'three';
import { whiteTexture } from '../dds.js';
import { finishProbe } from './orbitprobe.js';
import { stockHull, shipFittings } from './destroyer-detail.js';

// diffuse multiplier, direct / environment specular, roughness, local emission
const finishes = {
  armor: [null, 0.09, 0.72, 0],
  edge: [0x52545a, 0.075, 0.82, 0],
  trim: [0xa7abad, 0.26, 0.44, 0],
  metal: [0x656973, 0.52, 0.19, 0],
  glass: [0x98b5c7, 0.34, 0.12, 0.35]
};
function surface(src, k, reflect, atlas) {
  const [rgb, spec, rough, em] = finishes[k],
    U = { ...src.uniforms },
    D = { ...src.defines };
  delete D.REFLECT;
  if (k !== 'armor') {
    for (const key of ['LIVERY', 'COLORIZE', 'BUMP', 'GLOSS', 'GLOSSMAP', 'SPECGLOW', 'USE_VCOLOR']) delete D[key];
    U.map = { value: whiteTexture() };
    U.diffuse = { value: new T.Color(rgb).convertLinearToSRGB() };
    U.emissive = { value: U.diffuse.value.clone().multiplyScalar(em) };
  }
  U.specular = { value: new T.Color(spec, spec, spec) };
  U.shininess = { value: rough };
  if (reflect) {
    D.REFLECT = D.FITTING_FINISH = 1;
    U.skyAtlas = { value: atlas };
  }
  return new T.ShaderMaterial({
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    defines: D,
    uniforms: U,
    side: T.DoubleSide
  });
}
export class DestroyerLook {
  constructor(view) {
    this.view = view;
    this.parts = new Map();
    this.materials = new Map();
    this.slots = new Map();
    this.casters = new Map();
    this.frustum = new T.Frustum();
    this.matrix = new T.Matrix4();
    this.sphere = new T.Sphere();
  }
  clear() {
    for (const slot of this.slots.values()) slot.removeFromParent();
    this.slots.clear();
    this.casters.clear();
    this.roster = this.candidates = this.probe = this.lead = null;
  }
  dispose() {
    this.clear();
    for (const p of this.parts.values()) for (const g of Object.values(p)) g.dispose();
    for (const m of this.materials.values()) for (const v of m.values()) v.dispose();
    this.parts.clear();
    this.materials.clear();
  }
  update(world, r, mode, deep) {
    const view = this.view,
      cam = view.camera,
      active = new Set(),
      want = [];
    if (world && ['detail', 'finish'].includes(mode)) {
      const e = cam.matrixWorldInverse.elements;
      this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      // Space World appends on spawn and replaces its array on removal (also on the
      // simulation mirror). Don't test thousands of fighters at every fleet-zoom frame.
      const roster = world.units;
      if (this.roster !== roster || this.rosterCount > roster.length) {
        this.candidates = [];
        this.roster = roster;
        this.rosterCount = 0;
      }
      while (this.rosterCount < roster.length) {
        const u = roster[this.rosterCount++];
        if (stockHull(u)) this.candidates.push(u);
      }
      for (const u of this.candidates) {
        if (
          !u.obj?.visible ||
          u.dead ||
          u.scriptHidden ||
          u.cloaked ||
          u.hyper ||
          u.construction ||
          u.haze?.color.w ||
          !u.model ||
          (world.fog && world.viewer && !(u.seenBy & world.viewer.bit))
        )
          continue;
        const depth = -(e[2] * u.x + e[6] * u.y + e[10] * (u.z || 0) + e[14]);
        // Use viewport fraction, not render resolution: upscaling/HDR must not switch the asset.
        const size = (cam.projectionMatrix.elements[5] * u.visualRadius) / Math.max(1, depth);
        if (depth <= 0 || size < (this.slots.has(u) ? 0.24 : 0.3)) continue;
        const hull = stockHull(u);
        if (!hull || !hull.parent.visible || !hull.visible) continue;
        this.sphere.center.set(u.x, u.y, u.z || 0);
        this.sphere.radius = u.visualRadius * 1.4;
        if (this.frustum.intersectsSphere(this.sphere)) want.push({ u, hull, size });
      }
    }
    want.sort((a, b) => b.size - a.size);
    const focus = want.findIndex(row => row.u === view.flybySubject);
    if (focus > 0) want.unshift(want.splice(focus,1)[0]);
    this.lead = want[0]?.u || null;
    this.casters.clear();
    this.probe = want.length && mode === 'finish' ? finishProbe(view, r, deep) : null;
    for (const { u, hull } of want.slice(0, 4)) {
      active.add(u);
      let slot = this.slots.get(u);
      if (!slot) {
        slot = new T.Group();
        slot.matrixAutoUpdate = false;
        this.slots.set(u, slot);
        view.scene.add(slot);
        let parts = this.parts.get(hull.geometry);
        if (!parts) this.parts.set(hull.geometry, (parts = shipFittings(hull.geometry)));
        for (const [k, g] of Object.entries(parts)) {
          const m = new T.Mesh(g, hull.material);
          m.name = k;
          m.matrixAutoUpdate = false;
          slot.add(m);
        }
      }
      hull.updateWorldMatrix(true, false);
      slot.matrix.copy(hull.matrixWorld);
      slot.updateMatrixWorld(true);
      let variants = this.materials.get(hull.material);
      if (!variants) this.materials.set(hull.material, (variants = new Map()));
      for (const m of slot.children) {
        const tex = this.probe?.texture,
          key = m.name + (tex ? '|env' : '');
        let mat = variants.get(key);
        if (!mat) variants.set(key, (mat = surface(hull.material, m.name, !!tex, tex)));
        if (tex) mat.uniforms.skyAtlas.value = tex;
        m.material = mat;
      }
      if (u.casters) this.casters.set(u, u.casters.concat(slot.children));
    }
    for (const [u, slot] of this.slots)
      if (!active.has(u)) {
        slot.removeFromParent();
        this.slots.delete(u);
      }
  }
}
