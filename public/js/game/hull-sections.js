import * as T from 'three';
import { cutCap } from './fracture-caps.js';

// Only used when the model supplied ONE rigid section. Slice its actual exterior
// and UVs in the captured pose. Never slice a live/shared BufferGeometry. Author-
// separated sections, transparent effects and gameplay collision are not inputs.
const MAX_TRIANGLES = 6000,
  MAX_SUBMESHES = 24;
const identity = new Float32Array(24 * 16);
for (let i = 0; i < 24; i++) new T.Matrix4().toArray(identity, 16 * i);
const directions = new Set(['normal', 'tangent', 'binormal']);

function prepare({ mesh, palette }, inverse, bounds) {
  const g = mesh.geometry,
    pos = g.attributes.position,
    index = g.index;
  const start = Math.max(0, g.drawRange.start),
    end = Math.min(index?.count ?? pos.count, start + g.drawRange.count);
  const into = new T.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld),
    skinned = g.attributes.skinIndex;
  if (skinned && (!palette || !g.attributes.skinWeight)) return null;
  const entries = [['position', pos], ...Object.entries(g.attributes).filter(([name]) => name !== 'position')];
  let stride = 0;
  const attrs = entries.map(([name, src]) => {
    const off = stride;
    stride += src.itemSize;
    return { name, src, off, size: src.itemSize };
  });
  if (
    pos.itemSize !== 3 ||
    attrs.some(a => a.size > 4 || a.size < 1 || a.src.count !== pos.count || (directions.has(a.name) && a.size < 3))
  )
    return null;
  const points = new Map(),
    triangles = [],
    mat = new T.Matrix4(),
    posed = new T.Matrix4(),
    normalMatrix = new T.Matrix3().getNormalMatrix(into),
    v = new T.Vector3();
  for (let i = start; i + 2 < end; i += 3) {
    const tri = [];
    for (let k = i; k < i + 3; k++) {
      const j = index ? index.getX(k) : k;
      let p = points.get(j);
      if (!p) {
        if (!Number.isInteger(j) || j < 0 || j >= pos.count) return null;
        let transform = into;
        if (skinned) {
          mat.elements.fill(0);
          let sum = 0;
          for (let q = 0; q < 4; q++) {
            const w = g.attributes.skinWeight.getComponent(j, q);
            if (!w) continue;
            const off = skinned.getComponent(j, q) * 16;
            if (off < 0 || off + 16 > palette.length) return null;
            for (let n = 0; n < 16; n++) mat.elements[n] += w * palette[off + n];
            sum += w;
          }
          if (!Number.isFinite(sum) || Math.abs(1 - sum) > 0.015) return null;
          mat.elements[15] = 1;
          transform = posed.multiplyMatrices(into, mat);
          normalMatrix.getNormalMatrix(transform);
        }
        p = new Float32Array(stride);
        for (const { name, src, off, size } of attrs) {
          if (name === 'skinIndex') continue;
          if (name === 'skinWeight') {
            p[off] = 1;
            continue;
          }
          if (name === 'position' || directions.has(name)) {
            v.fromBufferAttribute(src, j);
            if (name === 'position') {
              v.applyMatrix4(transform);
              if (!Number.isFinite(v.lengthSq())) return null;
              bounds.expandByPoint(v);
            } else if (name === 'normal') v.applyNormalMatrix(normalMatrix);
            else v.transformDirection(transform);
            v.toArray(p, off);
            if (size === 4) p[off + 3] = src.getW(j);
          } else for (let n = 0; n < size; n++) p[off + n] = src.getComponent(j, n);
        }
        points.set(j, p);
      }
      tri.push(p);
    }
    triangles.push(tri);
  }
  return { attrs, triangles, material: mesh.material, skinned };
}

function split(poly, at, dist, edges) {
  const lo = [],
    hi = [],
    seam = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      dp = dist(p) - at,
      dq = dist(q) - at;
    if (dp <= 0) lo.push(p);
    if (dp >= 0) hi.push(p);
    if (dp === 0) seam.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const f = dp / (dp - dq),
        r = new Float32Array(p.length);
      for (let j = 0; j < r.length; j++) r[j] = p[j] + f * (q[j] - p[j]);
      lo.push(r);
      hi.push(r);
      seam.push(r);
    }
  }
  if (seam.length === 2) edges.push(seam);
  return [lo, hi];
}
function geometry(faces, attrs) {
  const g = new T.BufferGeometry(),
    byPoint = new Map(),
    vs = [],
    idx = [];
  for (const poly of faces)
    for (let j = 1; j + 1 < poly.length; j++)
      for (const p of [poly[0], poly[j], poly[j + 1]]) {
        if (!byPoint.has(p)) {
          byPoint.set(p, vs.length);
          vs.push(p);
        }
        idx.push(byPoint.get(p));
      }
  for (const { name, size, off } of attrs) {
    const data = new Float32Array(vs.length * size);
    for (let j = 0; j < vs.length; j++) for (let k = 0; k < size; k++) data[j * size + k] = vs[j][off + k];
    g.setAttribute(name, new T.BufferAttribute(data, size));
  }
  g.setIndex(idx);
  return g;
}

export function sliceHull(inputs, basis, limit, getInterior) {
  if (limit < 2 || !inputs.length || inputs.length > MAX_SUBMESHES) return null;
  let count = 0;
  for (const { mesh } of inputs) {
    const g = mesh.geometry;
    if (Array.isArray(mesh.material) || Object.keys(g.morphAttributes).length) return null;
    count += Math.min(g.index?.count ?? g.attributes.position.count, g.drawRange.count);
  }
  if (count < 12 || count > 3 * MAX_TRIANGLES) return null;
  // An orthonormal common hull frame keeps a rotated ship's cuts local to the
  // ship while preserving scales of sub-meshes and the captured skin palette.
  const frame = new T.Matrix4().extractRotation(basis).copyPosition(basis),
    inv = frame.clone().invert();
  const bounds = new T.Box3(),
    data = [];
  for (const input of inputs) {
    const src = prepare(input, inv, bounds);
    if (!src) return null;
    data.push(src);
  }
  const ext = bounds.getSize(new T.Vector3()),
    longest = Math.max(ext.x, ext.y, ext.z);
  if (!(longest >= 5 && Number.isFinite(longest))) return null;
  const normal = (
    ext.x === longest ? new T.Vector3(1, 0.17, -0.11) : ext.y === longest ? new T.Vector3(-0.11, 1, 0.17) : new T.Vector3(0.17, -0.11, 1)
  ).normalize();
  const dist = p => p[0] * normal.x + p[1] * normal.y + p[2] * normal.z;
  let min = Infinity,
    max = -Infinity;
  for (const { triangles } of data)
    for (const tri of triangles)
      for (const p of tri) {
        const d = dist(p);
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
  const cuts = (limit >= 3 ? [0.33, 0.69] : [0.51]).map(f => min + (max - min) * f),
    edges = cuts.map(() => []);
  const parts = Array.from({ length: cuts.length + 1 }, () => ({ box: new T.Box3(), meshes: [] }));
  function add(i, g, material, palette) {
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new T.Mesh(g, material);
    mesh.matrixWorld.copy(frame);
    parts[i].meshes.push({ mesh, palette, generated: true });
    parts[i].box.union(g.boundingBox.clone().applyMatrix4(frame));
  }
  for (const src of data) {
    const faces = parts.map(() => []);
    for (const tri of src.triangles) {
      let rest = tri;
      for (let i = 0; i < cuts.length && rest.length >= 3; i++) {
        const cut = cuts[i];
        if (rest.every(p => dist(p) >= cut)) continue;
        if (rest.every(p => dist(p) <= cut)) {
          faces[i].push(rest);
          rest = [];
          break;
        }
        const [lo, hi] = split(rest, cut, dist, edges[i]);
        if (lo.length >= 3) faces[i].push(lo);
        rest = hi;
      }
      if (rest.length >= 3) faces[cuts.length].push(rest);
    }
    for (let i = 0; i < parts.length; i++)
      if (faces[i].length) add(i, geometry(faces[i], src.attrs), src.material, src.skinned ? identity : null);
  }
  if (parts.some(p => !p.meshes.length)) {
    for (const p of parts) for (const { mesh } of p.meshes) mesh.geometry.dispose();
    return null;
  }
  for (let i = 0; i < cuts.length; i++) {
    const cap = cutCap(edges[i], normal, longest);
    if (cap) {
      add(i, cap, getInterior());
      add(i + 1, cap.clone(), getInterior());
    }
  }
  return parts;
}
