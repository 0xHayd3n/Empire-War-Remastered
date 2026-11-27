import * as T from 'three';
import { diskRadiance } from '../planetshine.js';

// One dominant physical disk, seen from the battlefield origin, not a screen-space average.
// Never use the camera-locked background or fleet: a painted planet has no position or scale.
export function dominantDisk(scene) {
  let best = null,
    area = 0;
  scene.traverseVisible(m => {
    if (!m.isMesh || !m.material?.userData?.planet || !m.material.visible) return;
    m.updateWorldMatrix(true, false);
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const b = m.geometry.boundingSphere.clone().applyMatrix4(m.matrixWorld),
      d = b.center.length();
    if (!(d > b.radius && b.radius > 0)) return;
    const a = b.radius / d;
    if (a > area) {
      area = a;
      best = { mesh: m, sphere: b };
    }
  });
  return best;
}
async function measure(view, r, token) {
  const { mesh, sphere } = token.source;
  await mesh.material.userData.ready;
  if (view.planetLight !== token) return;
  const size = 40,
    dist = sphere.center.length(),
    angle = Math.asin(sphere.radius / dist);
  const cam = new T.PerspectiveCamera(
    Math.min(178, 2 * angle * 1.04 * T.MathUtils.RAD2DEG),
    1,
    Math.max(0.01, (dist - sphere.radius) * 0.5),
    dist + sphere.radius * 1.1
  );
  if (Math.abs(sphere.center.z) < 0.9 * dist) cam.up.set(0, 0, 1);
  cam.lookAt(sphere.center);
  cam.updateMatrixWorld();
  const scene = new T.Scene(),
    src = mesh.material;
  // Borrow the mounted textures and lighting; never clone textures or mutate a live material.
  const mat = new T.ShaderMaterial({
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    defines: { ...src.defines },
    side: src.side,
    uniforms: { ...src.uniforms, planetColumn: { value: 1 }, orbitalAir: { value: 0 } }
  });
  const disk = new T.Mesh(mesh.geometry, mat);
  disk.matrixAutoUpdate = false;
  disk.matrix.copy(mesh.matrixWorld);
  scene.add(disk);
  const target = new T.WebGLRenderTarget(size, size, { generateMipmaps: false });
  const draw = () => {
    const prev = r.getRenderTarget(),
      color = r.getClearColor(new T.Color()),
      alpha = r.getClearAlpha(),
      auto = r.autoClear;
    try {
      r.setRenderTarget(target);
      r.setClearColor(0, 0);
      r.autoClear = false;
      r.clear();
      r.render(scene, cam);
    } finally {
      r.setRenderTarget(prev);
      r.setClearColor(color, alpha);
      r.autoClear = auto;
    }
  };
  try {
    draw();
    if (r.pendingPipelines?.().length) {
      r.endFrame();
      await r.settle();
      if (view.planetLight !== token) return;
      draw();
    }
    const px = new Uint8Array(size * size * 4);
    await r.readRenderTargetPixelsAsync(target, 0, 0, size, size, px);
    if (view.planetLight === token) token.rgb = diskRadiance(px);
  } finally {
    mat.dispose();
    target.dispose();
  }
}
export function planetDisk(view, r, world) {
  let t = view.planetLight;
  if (t?.r !== r || t.world !== world) {
    t = view.planetLight = { r, world, source: dominantDisk(view.scene) };
    if (t.source) t.ready = measure(view, r, t).catch(error => console.warn('Planet light unavailable; retaining map lighting.', error));
  }
  return t.rgb?.some(x => x > 0) ? t : null;
}
export function bindPlanetDisk(t, lighting) {
  const { center, radius } = t.source.sphere;
  lighting.planetDisk.value.set(center.x, center.y, center.z, radius);
  lighting.planetRadiance.value.fromArray(t.rgb);
}
