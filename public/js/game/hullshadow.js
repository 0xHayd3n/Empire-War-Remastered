// One fitted sun-space map for the close subject's visible opaque geometry. The
// battlefield map continues to cover other units and alpha-cutout parts.
import * as T from 'three';

export const HULL_SHADOW_SIZE = 1024;
const bias = new T.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const center = new T.Vector3(),
  extent = new T.Vector3(),
  bounds = new T.Box3(),
  box = new T.Box3(), skinMatrix = new T.Matrix4();
// Each vertex is a non-negative blend of its bone-transformed positions. Their union's
// axis-aligned box therefore bounds the posed mesh without skinning vertices on the CPU.
const skinBoxes = new WeakMap();
function boneBounds(geometry) {
  if (skinBoxes.has(geometry)) return skinBoxes.get(geometry);
  const {position, skinIndex, skinWeight} = geometry.attributes, list = [], pt = new T.Vector3();
  for (let i=0; i<position.count; i++) {
    pt.fromBufferAttribute(position, i);
    for (let j=0; j<4; j++) if (skinWeight.getComponent(i,j) > 0) {
      const k=skinIndex.getComponent(i,j);
      (list[k] ||= new T.Box3()).expandByPoint(pt);
    }
  }
  skinBoxes.set(geometry,list);
  return list;
}
// Work in the unit's local space. Translation of the ship or the viewing camera
// cannot make the depth grid swim; its orientation follows the map sun, not the eye.
export function fitHullShadow(camera, localBounds, sun, unitWorld, result, params) {
  bounds.copy(localBounds);
  bounds.getCenter(center);
  bounds.getSize(extent);
  const radius = Math.max(1, extent.length() * 0.5),
    distance = radius * 2;
  const inv = new T.Matrix4().copy(unitWorld).invert();
  const localSun = sun.clone().transformDirection(inv);
  camera.up.set(0, Math.abs(localSun.z) > 0.98 ? 1 : 0, Math.abs(localSun.z) > 0.98 ? 0 : 1);
  camera.position.copy(center).addScaledVector(localSun, distance);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  bounds.applyMatrix4(camera.matrixWorldInverse);
  const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) * 1.025;
  const half = span * 0.5,
    pitch = span / HULL_SHADOW_SIZE;
  const snap = (a, b) => Math.round(((a + b) * 0.5) / pitch) * pitch;
  const x = snap(bounds.min.x, bounds.max.x),
    y = snap(bounds.min.y, bounds.max.y);
  camera.left = x - half;
  camera.right = x + half;
  camera.bottom = y - half;
  camera.top = y + half;
  camera.near = Math.max(0.01, -bounds.max.z - pitch * 4);
  camera.far = -bounds.min.z + pitch * 4;
  camera.updateProjectionMatrix();
  result.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(inv);
  params.set(pitch * unitWorld.getMaxScaleOnAxis(), pitch / (camera.far - camera.near), 1 / HULL_SHADOW_SIZE);
}
export class HullShadow {
  constructor() {
    const n = HULL_SHADOW_SIZE,
      t = (this.target = new T.WebGLRenderTarget(n, n, { depthBuffer: true, generateMipmaps: false }));
    t.depthTexture = new T.DepthTexture(n, n, T.UnsignedIntType);
    t.depthTexture.compareFunction = T.LessEqualCompare;
    t.depthTexture.minFilter = t.depthTexture.magFilter = T.LinearFilter;
    t.texture.minFilter = t.texture.magFilter = T.NearestFilter;
    this.camera = new T.OrthographicCamera();
    this.scene = new T.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.depth = new T.MeshBasicMaterial({ colorWrite: false, side: T.DoubleSide });
    this.meshes = new Map();
    this.localBounds = new T.Box3();
    this.focus = null;
    this.draws = 0;
    this.matrix = new T.Matrix4();
    this.params = new T.Vector3();
    this.sun = new T.Vector3();
    this.localSun = new T.Vector3();
    this.inverse = new T.Matrix4();
    this.relative = new T.Matrix4();
    this.invalidate = () => {
      this.valid = false;
    };
    this.renderers = new Set();
  }
  draw(r, u, slot, L, depthMaterial) {
    const root = u.obj || u.holder;
    if (!root?.visible) return false;
    if (!this.renderers.has(r)) {
      this.renderers.add(r);
      r.domElement?.addEventListener?.('webglcontextrestored', this.invalidate);
    }
    root.updateWorldMatrix(true, true);
    const model = u.model || u.inst;
    if (model?.dirty && model.skins?.length) model.syncSkins();
    slot?.updateWorldMatrix(true, true);
    const inv = this.inverse.copy(root.matrixWorld).invert(),
      mat = this.relative,
      old = this.meshes;
    this.localSun.copy(L.sunDir.value).transformDirection(inv);
    let dirty =
      !this.valid ||
      u !== this.focus ||
      r !== this.backend ||
      r.device !== this.device ||
      this.localSun.distanceToSquared(this.sun) > 1e-12;
    for (const proxy of old.values()) proxy.visible = false;
    this.localBounds.makeEmpty();
    const add = m => {
      if (
        !m.isMesh ||
        m.material.visible === false || m.material.transparent || m.material.depthWrite === false || m.material.defines?.ALPHA ||
        !m.material.uniforms?.shadowMap ||
        m.material.defines?.UNLIT ||
        m.material.defines?.NATIVE_MESH_GLOSS_EMISSIVE
      )
        return;
      const skinned = !!m.material.defines?.SKINNED;
      let proxy = old.get(m), palette;
      if (skinned) {
        palette = model?.skins?.find(s => s.mesh === m)?.mats;
        if (!palette || !depthMaterial) return;
      }
      if (!proxy) {
        let material = this.depth;
        if (skinned) {
          const twin = depthMaterial(m.material);
          if (!twin) return;
          // A private palette uniform, not the source material's last submitted instance.
          material = new T.ShaderMaterial({vertexShader:twin.vertexShader, fragmentShader:twin.fragmentShader,
            defines:twin.defines, uniforms:{...twin.uniforms, boneMatrices:{value:palette}}, colorWrite:false, side:T.DoubleSide});
        }
        proxy = new T.Mesh(m.geometry, material);
        proxy.matrixAutoUpdate = false;
        proxy.frustumCulled = false;
        this.scene.add(proxy);
        old.set(m, proxy);
        dirty = true;
      }
      if (proxy.geometry !== m.geometry) dirty = true;
      proxy.geometry = m.geometry;
      proxy.visible = true;
      mat.multiplyMatrices(inv, m.matrixWorld);
      // Compare against the geometry actually rendered, so slow turret drift eventually invalidates.
      if (mat.elements.some((v, i) => Math.abs(v - proxy.matrixWorld.elements[i]) > 1e-5)) {
        proxy.matrixWorld.copy(mat);
        dirty = true;
      }
      if (skinned) {
        let saved = proxy.userData.palette;
        if (!saved || palette.some((x,i) => Math.abs(x-saved[i]) > 1e-5)) {
          if (!saved) saved = proxy.userData.palette = new Float32Array(palette.length);
          saved.set(palette); dirty = true;
        }
        proxy.material.uniforms.boneMatrices.value = saved;
        boneBounds(m.geometry).forEach((b,i) => {
          skinMatrix.fromArray(saved,16*i).premultiply(mat);
          this.localBounds.union(box.copy(b).applyMatrix4(skinMatrix));
        });
      } else {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        this.localBounds.union(box.copy(m.geometry.boundingBox).applyMatrix4(mat));
      }
    };
    root.traverseVisible(add);
    slot?.traverseVisible(add);
    for (const [src, proxy] of old)
      if (!proxy.visible) {
        this.scene.remove(proxy);
        if (proxy.material !== this.depth) proxy.material.dispose();
        old.delete(src);
        dirty = true;
      }
    if (this.localBounds.isEmpty()) return false;
    fitHullShadow(this.camera, this.localBounds, L.sunDir.value, root.matrixWorld, this.matrix, this.params);
    if (dirty) {
      const prev = r.getRenderTarget();
      try {
        r.setRenderTarget(this.target);
        r.clear();
        r.render(this.scene, this.camera);
      } finally {
        r.setRenderTarget(prev);
      }
      this.draws++;
      this.valid = !r.pendingPipelines?.().length && !r.lost && (!u.holder || !r.isWebGLRenderer ||
        [...old.values()].every(p => r.properties.get(p.material).currentProgram?.isReady()));
      this.sun.copy(this.localSun);
      this.backend = r;
      this.device = r.device;
      this.focus = u;
    }
    return true;
  }
  renderScene(r, scene, cam, L) {
    const map = L.hullShadowMap.value,
      p = L.hullShadowParams.value,
      m = L.hullShadowMatrix.value;
    L.hullShadowParams.value = this.params;
    L.hullShadowMatrix.value = this.matrix;
    L.hullShadowMap.value = this.target.depthTexture;
    try {
      r.render(scene, cam);
    } finally {
      L.hullShadowMap.value = map;
      L.hullShadowParams.value = p;
      L.hullShadowMatrix.value = m;
    }
  }
  park() {
    for (const p of this.meshes.values()) if (p.material !== this.depth) p.material.dispose();
    this.meshes.clear();
    this.scene.clear();
    this.focus = null;
    this.valid = false;
  }
  dispose() {
    this.park();
    for (const r of this.renderers) {
      r.domElement?.removeEventListener?.('webglcontextrestored', this.invalidate);
      r.releaseTarget?.(this.target);
    }
    this.renderers.clear();
    this.depth.dispose();
    this.target.depthTexture.dispose();
    this.target.dispose();
  }
}
