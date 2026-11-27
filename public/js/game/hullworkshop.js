import { Frustum, Matrix4, ShaderMaterial, Sphere } from 'three';
import { stockHull } from './destroyer-detail.js';
import { bindOrbitProbe, finishProbe } from './orbitprobe.js';

// A draw-time override, not a mutation of the mounted model or its cached team/livery material.
export class HullWorkshop {
  active = new Map();
  variants = new Map();
  candidates = [];
  frustum = new Frustum();
  clip = new Matrix4();
  bounds = new Sphere();
  clear() {
    this.active.clear();
    this.candidates.length = 0;
    this.roster = this.probe = null;
  }
  dispose() {
    this.clear();
    for (const pair of this.variants.values()) for (const m of pair.values()) m.dispose();
    this.variants.clear();
  }
  prepare(view, world, r, mode, stage, lighting) {
    const units = world.units;
    if (this.roster !== units || this.count > units.length) {
      this.roster = units;
      this.count = 0;
      this.candidates.length = 0;
    }
    while (this.count < units.length) {
      const u = units[this.count++];
      if (stockHull(u)) this.candidates.push(u);
    }
    this.active.clear();
    this.probe = null;
    this.frustum.setFromProjectionMatrix(this.clip.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse));
    for (const unit of this.candidates) {
      if (!unit.obj?.visible || unit.dead || unit.scriptHidden || unit.cloaked || unit.hyper || unit.construction || unit.haze?.color.w)
        continue;
      this.bounds.center.set(unit.x, unit.y, unit.z || 0);
      this.bounds.radius = unit.visualRadius * 1.5;
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      const mesh = stockHull(unit),
        src = mesh?.material;
      if (!mesh?.visible || !src?.visible || !src.userData.stockDestroyerPaint) continue;
      if (mode === 'orbit' && !this.probe) {
        if (stage < 3) bindOrbitProbe(view, r, lighting, false);
        this.probe = finishProbe(view, r, stage === 4);
      }
      const atlas = this.probe?.texture;
      let pair = this.variants.get(src);
      if (!pair) this.variants.set(src, (pair = new Map()));
      let mat = pair.get(!!atlas);
      if (!mat) {
        mat = new ShaderMaterial({
          vertexShader: src.vertexShader,
          fragmentShader: src.fragmentShader,
          side: src.side,
          uniforms: { ...src.uniforms },
          defines: { ...src.defines, HULL_FINISH: 1 }
        });
        mat.userData = { ...src.userData };
        if (atlas) {
          mat.defines.HULL_ENV = mat.defines.REFLECT = 1;
          mat.uniforms.skyAtlas = { value: atlas };
        }
        pair.set(!!atlas, mat);
      }
      if (atlas) mat.uniforms.skyAtlas.value = atlas;
      this.active.set(unit, { mesh, src, mat });
    }
    return this.active;
  }
  bindLoose(instances) {
    for (const row of this.active.values()) if (!instances?.taken.has(row.mesh)) row.mesh.material = row.mat;
  }
  restore() {
    for (const { mesh, src, mat } of this.active.values()) if (mesh.material === mat) mesh.material = src;
  }
}
