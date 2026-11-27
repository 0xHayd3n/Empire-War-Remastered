// Scene-owned LOD for mounted ALO models. Selection only changes the colour draw;
// simulation, picking, shadow/reflection passes and other instances retain the source.
// Model loading also runs in simulation workers, which do not have the page's import map.
import * as T from '../../vendor/three/build/three.module.js';
import { projectedDiameter, landDetailLevel } from './land-detail.js';

const parts = new WeakMap(),
  at = new T.Vector3();
export function registerModelPart(mesh, authored) {
  if (mesh.geometry.index?.count >= 144 || authored) parts.set(mesh, { high: mesh.geometry, authored, level: 0 });
}

export class GeometryLevels {
  levels = new Map();
  queue = [];
  reduced(high) {
    if (this.levels.has(high)) return this.levels.get(high);
    this.levels.set(high, null);
    const pos = high.attributes.position;
    if (
      this.failed ||
      !high.index ||
      high.index.count < 144 ||
      high.groups.length ||
      Object.keys(high.morphAttributes).length ||
      pos?.itemSize !== 3 ||
      pos.isInterleavedBufferAttribute ||
      !(pos.array instanceof Float32Array) ||
      high.drawRange.start !== 0 ||
      high.drawRange.count < high.index.count
    )
      return null;
    this.queue.push(high);
    this.pump();
    return null;
  }
  pump() {
    if (this.busy || !this.queue.length || this.failed) return;
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./scenery-lod-worker.js', import.meta.url), { type: 'module' });
        this.worker.onerror = () => this.stopWorker();
        this.worker.onmessage = ({ data }) => {
          const high = this.busy;
          if (!high) return;
          this.busy = null;
          this.levels.set(
            high,
            data.map(index => {
              if (!index) return null;
              const g = new T.BufferGeometry();
              for (const [k, a] of Object.entries(high.attributes)) g.setAttribute(k, a);
              g.setIndex(new T.BufferAttribute(index, 1));
              g.boundingSphere = high.boundingSphere;
              g.boundingBox = high.boundingBox;
              return g;
            })
          );
          this.pump();
        };
      }
      const g = (this.busy = this.queue.shift()),
        a = g.attributes;
      this.worker.postMessage({
        index: g.index.array,
        position: a.position.array,
        scenery: !!this.scenery,
        uv: a.uv?.itemSize === 2 && a.uv.array instanceof Float32Array ? a.uv.array : null,
        skinIndex: a.skinIndex?.array,
        skinWeight: a.skinWeight?.array
      });
    } catch {
      this.stopWorker();
    }
  }
  stopWorker() {
    this.worker?.terminate();
    this.worker = this.busy = null;
    this.queue.length = 0;
    this.failed = true;
  }
  dispose() {
    this.stopWorker();
    for (const levels of this.levels.values())
      for (const geo of levels || [])
        if (geo) {
          for (const k of Object.keys(geo.attributes)) geo.deleteAttribute(k);
          geo.dispose();
        }
    this.levels.clear();
  }
}

export class ModelDetail extends GeometryLevels {
  changed = [];
  // No geometry changes until the reduced batch is ready. A late worker or
  // unsupported mod therefore gives higher detail, not a hole in the scene.
  pick(mesh, camera, height, pixels) {
    const p = parts.get(mesh),
      high = mesh.geometry;
    if (!p || high !== p.high || mesh.material.transparent || mesh.material.depthWrite === false || mesh.modelDetailManaged) return high;
    if (pixels === undefined) {
      const sphere = high.boundingSphere,
        matrix = mesh.matrixWorld;
      if (!sphere) return high;
      at.copy(sphere.center).applyMatrix4(matrix).applyMatrix4(camera.matrixWorldInverse);
      pixels = projectedDiameter(
        sphere.radius * matrix.getMaxScaleOnAxis(),
        -at.z,
        height,
        camera.projectionMatrix.elements[5],
        !camera.isOrthographicCamera
      );
    }
    // Smaller cuts than vegetation: a hull, joint or recognisable building needs
    // its authored outline longer. Separate approach/recede thresholds prevent chatter.
    const lvl = (p.level = landDetailLevel(pixels, p.level, 64, 22));
    if (!lvl) return high;
    if (p.authored) return lvl === 2 ? p.authored : high;
    const levels = this.reduced(high),
      medium = levels?.[0] || high,
      far = levels?.[1];
    return lvl === 2 && far && far.index.count < medium.index.count ? far : medium;
  }
  // Instanced batches have already been partitioned by selected geometry. Outside
  // this scope they bind their full-detail wrapper, including their original tint.
  draw(scene, camera, height, fn) {
    const changed = this.changed;
    try {
      scene.traverseVisible(o => {
        if (!o.isMesh || !camera.layers.test(o.layers)) return;
        const g = o.detailColor || (!o.isInstancedMesh && this.pick(o, camera, height));
        if (g && g !== o.geometry) {
          changed.push(o, o.geometry);
          o.geometry = g;
        }
      });
      return fn();
    } finally {
      for (let i = 0; i < changed.length; i += 2) changed[i].geometry = changed[i + 1];
      changed.length = 0;
    }
  }
}

// Keep separate wrappers; replacing an index on an uploaded geometry would leave
// stale VAOs on WebGL. The instance buffer, skin rows and tint keep their order.
const splitKeys = new WeakMap();
export function detailPoolKey(low, high) {
  if (!high) return low;
  let keys = splitKeys.get(high);
  if (!keys) splitKeys.set(high, (keys = new WeakMap()));
  let key = keys.get(low);
  if (!key) keys.set(low, (key = {}));
  return key;
}
export function splitDetailBatch(im, high) {
  const color = im.geometry;
  im.detailColor = color;
  const g = new T.BufferGeometry();
  for (const [k, a] of Object.entries(high.attributes)) g.setAttribute(k, a);
  g.setAttribute('instanceTint', color.attributes.instanceTint);
  g.setIndex(high.index);
  g.boundingBox = high.boundingBox;
  g.boundingSphere = high.boundingSphere;
  im.geometry = g;
}
export function releaseDetailColor(im) {
  const g = im.detailColor;
  if (!g) return;
  for (const k of Object.keys(g.attributes)) g.deleteAttribute(k);
  g.setIndex(null);
  g.dispose();
  im.detailColor = null;
}
