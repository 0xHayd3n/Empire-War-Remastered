// An eligible root has exactly one representation. A detail budget can demote a root,
// never remove its last representation. Allocate from observed demand, not world population.
import * as T from 'three';
export function foliageStream(parent, geometry, material, role, lod) {
  let mesh,
    sites = [],
    peak = 0;
  const matrix = new T.Object3D();
  function commit(rows, ground) {
    const n = rows.length;
    if (n > (mesh?.instanceMatrix.count ?? 0)) {
      const cap = Math.max(n, Math.min(Math.ceil(n * 1.25), Math.ceil(n / 64) * 64));
      if (mesh) {
        mesh.removeFromParent();
        mesh.dispose();
        geometry.dispose();
      } // Release old VAO/tint buffers before resizing.
      geometry.setAttribute('instanceTint', new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      mesh = new T.InstancedMesh(geometry, material, cap);
      mesh.name = `${role} · ${lod}`;
      mesh.userData.foliage = { role, lod };
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      parent.add(mesh);
      sites = [];
    }
    if (!mesh) return;
    const a = mesh.instanceMatrix;
    let first = n,
      last = -1;
    for (let i = 0; i < n; i++) {
      const p = rows[i],
        z = ground(p);
      if (sites[i] === p && a.array[i * 16 + 14] === Math.fround(z)) continue;
      matrix.position.set(p.x, p.y, z);
      matrix.rotation.z = p.rot;
      matrix.scale.set(p.s, p.s, p.s * (p.stretch ?? 1));
      matrix.updateMatrix();
      mesh.setMatrixAt(i, matrix.matrix);
      sites[i] = p;
      first = Math.min(i, first);
      last = i;
    }
    // Ranges may still be pending when a pass was skipped. Republish the used prefix,
    // not stale ranges (or an empty upload) after a shrink/grow.
    if (last >= first) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 16);
      a.needsUpdate = true;
    } else if (a.updateRanges.some(r => r.start + r.count > n * 16)) {
      a.clearUpdateRanges();
      if (n) a.addUpdateRange(0, n * 16);
    }
    sites.length = n;
    mesh.visible = n > 0;
    mesh.count = n;
    peak = Math.max(peak, n);
  }
  return {
    commit,
    dispose() {
      mesh?.removeFromParent();
      mesh?.dispose();
    },
    receipt() {
      return { role, lod, active: mesh?.count || 0, capacity: mesh?.instanceMatrix.count || 0, peak };
    }
  };
}
export function plantChunks(rows) {
  const map = new Map(),
    side = 160;
  for (const p of rows) {
    const k = `${Math.floor(p.x / side)},${Math.floor(p.y / side)}`;
    let c = map.get(k);
    if (!c) {
      c = { bounds: new T.Box3(), roots: [] };
      map.set(k, c);
    }
    c.roots.push(p);
    c.bounds.expandByPoint(new T.Vector3(p.x, p.y, p.z));
  }
  // Conservative apron for the crown and nearby offscreen sun casters; dry Yavin has no mirror pass.
  for (const c of map.values()) c.bounds.expandByScalar(240);
  return [...map.values()];
}
export function splitPlants(roots, visible, nearLimit, cap, rank, near, far) {
  const detail = [];
  for (const p of roots) {
    if (!visible(p)) continue;
    const d = rank(p);
    if (d < nearLimit * nearLimit) detail.push([p, d]);
    else far.push(p);
  }
  detail.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < detail.length; i++) (i < cap ? near : far).push(detail[i][0]);
}
