import * as T from 'three';

// A copy-on-write cut in the real render triangles. Never mutate collision ALOs,
// textures, shared instances, or skeletal skin weights. Unsupported rigs keep stock FX.
const tri = new T.Triangle(),
  near = new T.Vector3(),
  coords = new T.Vector3(),
  axis = new T.Vector3(),
  bit = new T.Vector3();
const planes = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
function face(g, i) {
  const p = g.attributes.position,
    I = g.index?.array;
  tri.a.fromBufferAttribute(p, I ? I[i] : i);
  tri.b.fromBufferAttribute(p, I ? I[i + 1] : i + 1);
  tri.c.fromBufferAttribute(p, I ? I[i + 2] : i + 2);
  return tri;
}
function count(g) {
  return g.index?.count ?? g.attributes.position.count;
}
function eligible(o) {
  const g = o.geometry;
  return (
    o.isMesh &&
    !o.isInstancedMesh &&
    !o.material?.transparent &&
    o.material?.visible &&
    g?.attributes.position &&
    !g.attributes.skinIndex &&
    !g.groups.length &&
    !Object.keys(g.morphAttributes).length &&
    count(g) <= 90000 &&
    !/shield|shadow|blast|girder|collision|muzzle/i.test(o.parent?.name || '')
  );
}
function split(poly, measure, keep) {
  let inside = [],
    outside = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = measure(a),
      db = measure(b);
    (da <= 0 ? inside : outside).push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db),
        p = a.map((v, j) => v + (b[j] - v) * t);
      inside.push(p);
      outside.push(p);
    }
  }
  if (outside.length >= 3) keep(outside);
  return inside;
}
function cut(g, center, normal, r, breach) {
  axis.set(0, 0, 1);
  if (Math.abs(normal.z) > 0.85) axis.set(1, 0, 0);
  axis.cross(normal).normalize();
  bit.crossVectors(normal, axis);
  const attr = Object.entries(g.attributes);
  if (attr.some(([, a]) => a.isInterleavedBufferAttribute || a.normalized || a.itemSize > 4)) return null;
  const out = attr.map(([, a]) => Array.from(a.array)),
    idx = [],
    I = g.index?.array,
    p = g.attributes.position,
    hole = 0.39;
  let changed = false,
    ids;
  const emit = (poly, wall = false) => {
    if (poly.length < 3) return;
    let wallNormal;
    if (wall) {
      const [cx, cy] = poly.reduce(([x, y], v) => [x + v[3], y + v[4]], [0, 0]);
      const plane = planes.reduce((a, b) => (cx * a[0] + cy * a[1] > cx * b[0] + cy * b[1] ? a : b));
      const slope = 0.32 / (1 - hole);
      wallNormal = normal
        .clone()
        .addScaledVector(axis, -plane[0] * slope)
        .addScaledVector(bit, -plane[1] * slope)
        .normalize();
    }
    const first = out[0].length / attr[0][1].itemSize;
    for (const v of poly) {
      const dist = Math.max(...planes.map(([x, y]) => x * v[3] + y * v[4])),
        depth = Math.min(1, Math.max(0, (1 - dist) / (1 - hole))) * r * 0.32;
      for (let j = 0; j < attr.length; j++) {
        const [key, a] = attr[j];
        for (let k = 0; k < a.itemSize; k++) {
          let n = 0;
          for (let h = 0; h < 3; h++) n += a.getComponent(ids[h], k) * v[h];
          out[j].push(
            key === 'position' ? n - depth * normal.getComponent(k) : key === 'normal' && wallNormal ? wallNormal.getComponent(k) : n
          );
        }
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(first, first + k, first + k + 1);
  };
  const ring = (poly, limit, emitOutside) => {
    for (const [x, y] of planes) {
      poly = split(poly, v => x * v[3] + y * v[4] - limit, emitOutside);
      if (poly.length < 3) return [];
    }
    return poly;
  };
  for (let i = 0, n = count(g); i < n; i += 3) {
    ids = [I ? I[i] : i, I ? I[i + 1] : i + 1, I ? I[i + 2] : i + 2];
    face(g, i);
    if (tri.closestPointToPoint(center, near).distanceToSquared(center) > r * r * 1.3 || Math.abs(near.sub(center).dot(normal)) > r*.25 || tri.getNormal(near).dot(normal) < 0.65) {
      idx.push(...ids);
      continue;
    }
    const poly = ids.map((id, j) => {
      coords.fromBufferAttribute(p, id).sub(center);
      return [+(j === 0), +(j === 1), +(j === 2), coords.dot(axis) / r, coords.dot(bit) / r];
    });
    const outside = [],
      rim = ring(poly, 1, s => outside.push(s));
    if (rim.length < 3) {
      idx.push(...ids);
      continue;
    }
    changed = true;
    outside.forEach(poly => emit(poly));
    const inner = ring(rim, hole, poly => emit(poly, true));
    if (!breach) emit(inner);
  }
  if (!changed) return null;
  const next = new T.BufferGeometry();
  attr.forEach(([key, a], j) => next.setAttribute(key, new T.BufferAttribute(new a.array.constructor(out[j]), a.itemSize)));
  next.setIndex(idx);
  next.battleSource = g.battleSource || g;
  // Keep the authored surface normals outside the cut (UV seams and bevels matter).
  next.computeBoundingBox();
  next.computeBoundingSphere();
  next.userData.battleCut = true;
  return next;
}
export class ArmorDamage {
  rows = new Map();
  last = new WeakMap();
  hit(u, root, x, y, z, radius, breach, time) {
    if (
      !root?.visible ||
      u.dead ||
      ![x, y, z, radius, time].every(Number.isFinite) ||
      radius <= 0 ||
      time - (this.last.get(u) ?? -Infinity) < 0.32
    )
      return false;
    if (time - (this.globalTime ?? -Infinity) < 0.075) return false;
    this.globalTime = time;
    this.last.set(u, time);
    root.updateWorldMatrix(true, true);
    const point = new T.Vector3(x, y, z),
      local = new T.Vector3(),
      center = new T.Vector3(),
      normal = new T.Vector3();
    let obj = null,
      worldDist = Infinity,
      scale = 1;
    const candidates = [];
    root.traverseVisible(o => {
      if (!eligible(o)) return;
      const g = o.geometry;
      g.boundingBox || g.computeBoundingBox();
      local.copy(point);
      o.worldToLocal(local);
      const k = o.matrixWorld.getMaxScaleOnAxis();
      if (k > 0) candidates.push([g.boundingBox.distanceToPoint(local) * k, o, k, local.clone()]);
    });
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [min, o, k, at] of candidates.slice(0, 6)) {
      if (min > worldDist) break;
      const g = o.geometry;
      for (let i = 0, n = count(g); i < n; i += 3) {
        face(g, i).closestPointToPoint(at, near);
        const d = near.distanceTo(at) * k;
        if (d < worldDist) {
          worldDist = d;
          center.copy(near);
          tri.getNormal(normal);
          obj = o;
          scale = k;
        }
      }
    }
    if (!obj || worldDist > radius * 5 || normal.lengthSq() < 0.5) return false;
    let row = this.rows.get(obj);
    if (row && row.current !== obj.geometry) { this.drop(obj); row = null; }
    if (row?.hits >= 5) return false;
    const newGeo = cut(obj.geometry, center, normal, radius / scale, breach);
    if (!newGeo) return false;
    if (!row) {
      if (this.rows.size >= 24) this.drop(this.rows.keys().next().value);
      row = { u, original: obj.geometry, hits: 0 };
      this.rows.set(obj, row);
    } else obj.geometry.dispose();
    obj.geometry = row.current = newGeo;
    row.hits++;
    row.breaches = (row.breaches || 0) + Number(breach);
    return true;
  }
  drop(o) {
    const row = this.rows.get(o);
    if (!row) return;
    if (o.geometry === row.current) o.geometry = row.original;
    row.current.dispose();
    this.rows.delete(o);
  }
  update() {
    for (const [o, row] of this.rows) if (row.u.dead || row.u.gone) this.drop(o);
  }
  clear() {
    for (const o of this.rows.keys()) this.drop(o);
    this.last = new WeakMap();
    this.globalTime = -Infinity;
  }
}
