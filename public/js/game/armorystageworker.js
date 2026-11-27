// One selected hull, one private GL context. The page supplies mounted bytes
// (including folder/pack overlays) and the frame clock. No game/simulation loop.
import * as T from '../../vendor/three/build/three.module.js';
const pending = new Map();
let serial = 0,
  renderer,
  surface,
  scene,
  camera,
  inst,
  motion,
  bounds,
  span,
  center,
  billboard;
globalThis.SWR_OVERLAY = {
  read: path =>
    new Promise(resolve => {
      const id = ++serial;
      pending.set(id, resolve);
      self.postMessage({ kind: 'asset', path, id });
    })
};
const homeYaw = -2.14,
  homePitch = 0.32;
const direction = (yaw, pitch) => new T.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
async function open(q) {
  const [{ loadModel, lighting, updateBillboards }, { texturesReady }, { animName, loadALA, AnimState }] = await Promise.all([
    import('../model.js'),
    import('../dds.js'),
    import('../ala.js')
  ]);
  billboard = updateBillboards;
  // A real ship material reads the mounted diffuse/normal/colorization maps.
  // Do not globally change gameplay lighting, reuse a live actor, or invent a material.
  lighting.sunDir.value.set(-0.45, -0.7, 0.75).normalize();
  lighting.ambient.value.setRGB(0.49, 0.53, 0.59);
  lighting.fillDir.value.set(0.9, 0.3, 0.4).normalize();
  lighting.fillColor.value.setRGB(0.42, 0.49, 0.62);
  inst = await loadModel(q.file, { teamColor: new T.Color(q.color), fresh: true });
  if (!inst) throw Error('No mounted space model');
  scene = new T.Scene();
  scene.add(inst.root);
  inst.syncFromBones();
  // Textures and the optional native clip can resolve while the GL context starts.
  const texturesPromise = texturesReady();
  const clipPromise = (async () => {
    let clipName = '';
    for (const kind of ['SPACE_IDLE', 'IDLE']) {
      const file = animName(q.file, kind),
        clip = await loadALA(file).catch(() => null);
      if (!clip || clip.frames < 3 || !Number.isFinite(clip.duration) || !(clip.fps > 0)) continue;
      const state = new AnimState(inst, clip, { loop: true });
      if (!state.bound.some(({ t }) => t.trans || t.rot || t.vis)) continue;
      motion = state;
      motion.step(0);
      clipName = file;
      break;
    }
    return clipName;
  })();
  bounds = new T.Box3();
  const box = new T.Box3();
  let meshes = 0;
  inst.root.traverseVisible(o => {
    if (!o.isMesh || !o.material.visible || !o.geometry.boundingBox) return;
    meshes++;
    if (!o.material.transparent) bounds.union(box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  if (!meshes) throw Error('No visible hull');
  if (bounds.isEmpty()) bounds.copy(inst.drawBox);
  span = bounds.getSize(new T.Vector3()).length();
  if (!(span > 0 && Number.isFinite(span))) throw Error('No visible hull extent');
  center = bounds.getCenter(new T.Vector3());
  surface = new OffscreenCanvas(1, 1);
  renderer = new T.WebGLRenderer({ canvas: surface, alpha: true, antialias: true, powerPreference: 'low-power' });
  surface.addEventListener('webglcontextlost', () => self.postMessage({ kind: 'error' }));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  camera = new T.OrthographicCamera();
  camera.up.set(0, 0, 1);
  camera.near = span * 0.01;
  camera.far = span * 6;
  const [textures, clipName] = await Promise.all([texturesPromise, clipPromise]);
  self.postMessage({
    kind: 'ready',
    clip: clipName,
    meshes,
    textures: textures.filter(t => !t.userData.missing && t.image?.width > 1).length
  });
}
function draw({ id, yaw, pitch, zoom, dt, w, h }) {
  if (surface.width !== w || surface.height !== h) renderer.setSize(w, h, false);
  if (dt > 0) motion?.step(dt);
  const aspect = w / h;
  // Fit to the opening pose only. A turn toward the bow must really foreshorten
  // the ship, not silently zoom it back up to fill a rectangular thumbnail.
  const orient = (az, el) => {
    camera.position.copy(center).addScaledVector(direction(az, el), span * 2.5);
    camera.lookAt(center);
    camera.updateMatrixWorld();
  };
  orient(homeYaw, homePitch);
  const base = bounds.clone().applyMatrix4(camera.matrixWorldInverse).getSize(new T.Vector3());
  const half = (0.55 * Math.max(base.y, base.x / aspect)) / zoom;
  Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
  orient(homeYaw + yaw, homePitch + pitch);
  camera.updateProjectionMatrix();
  if (inst.billboards.length) billboard(inst, camera);
  renderer.render(scene, camera);
  if (!renderer.info.render.triangles) throw Error('No drawable triangles');
  const bitmap = surface.transferToImageBitmap();
  self.postMessage({ kind: 'frame', id, bitmap }, [bitmap]);
}
self.onmessage = async ({ data: q }) => {
  try {
    if (q.kind === 'asset') {
      pending.get(q.id)?.(q.bytes);
      pending.delete(q.id);
    } else if (q.kind === 'open') await open(q);
    else if (q.kind === 'draw') draw(q);
  } catch {
    self.postMessage({ kind: 'error' });
  }
};
