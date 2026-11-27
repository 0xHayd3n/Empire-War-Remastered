import { Frustum, Matrix4, Sphere } from 'three';

export function unitRadius(u) {
  return u.obj ? u.visualRadius : (u.inst?.radius || 0) * Math.abs(u.holder?.scale.x || 1);
}
export function visibleSubject(u, world) {
  const root = u.obj || u.holder;
  if (!root?.visible || root.userData.ready === false || !(u.model || u.inst) || u.dead || u.seen === false ||
      u.inside || u.mine || u.scriptHidden || u.cloaked || u.hyper || u.construction || u.haze?.color.w ||
      (u.obj && world.fog && world.viewer && !(u.seenBy & world.viewer.bit))) return false;
  return unitRadius(u) > 0;
}
// Broad phase only: no geometry scan, allocation or sorting per candidate. Select before instancing
// temporarily hides source meshes. Size is independent of DPR, upscaling and render backend.
export class CloseSubject {
  frustum = new Frustum();
  clip = new Matrix4();
  ball = new Sphere();
  pick(world, camera, preferred) {
    this.frustum.setFromProjectionMatrix(this.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const e = camera.matrixWorldInverse.elements, focal = camera.projectionMatrix.elements[5];
    let best = null, score = 0;
    for (const u of world.units) {
      if (!visibleSubject(u, world)) continue;
      const root = u.obj || u.holder, center = this.ball.center.copy(root.position), radius = unitRadius(u);
      if (u.holder) center.z += u.aimZ || 0;
      const depth = -(e[2] * center.x + e[6] * center.y + e[10] * center.z + e[14]);
      const size = focal * radius / Math.max(1, depth);
      if (depth <= 0 || size < (u === this.last ? .24 : .3) || size <= score && u !== preferred) continue;
      this.ball.radius = radius;
      if (!this.frustum.intersectsSphere(this.ball)) continue;
      best = u; score = size;
      if (u === preferred) break;
    }
    return this.last = best;
  }
}
