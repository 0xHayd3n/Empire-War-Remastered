// A droid with no humanoid bone labels at all: an authored bone hierarchy, a
// skinned surface, and rigid parts parented to bones. Nothing in here names an
// anatomy the ragdoll could recognise, which is the point: the plan has to come
// from the hierarchy and from where the geometry is drawn.
//
// Z is up and the terrain is height(x, y), exactly as in game. Twelve bones, all of
// them carrying surface, so every one of them is a body in the plan.
import * as THREE from 'three';

export const FLOOR = 0.07;

const PARENT = {
  chassis: null,
  column: 'chassis',
  dome: 'column',
  strut_a1: 'chassis',
  strut_a2: 'strut_a1',
  strut_a3: 'strut_a2',
  piston_a1: 'chassis',
  piston_a2: 'piston_a1',
  piston_a3: 'piston_a2',
  piston_b1: 'chassis',
  piston_b2: 'piston_b1',
  piston_b3: 'piston_b2'
};

// Standing pose; root-local == world while the holder sits at the map origin.
const AT = {
  chassis: [0, 0, 1.24],
  column: [0, 0, 1.46],
  dome: [0, 0, 1.7],
  strut_a1: [0.24, 0, 1.34],
  strut_a2: [0.34, 0, 1.1],
  strut_a3: [0.42, 0, 0.86],
  piston_a1: [-0.16, 0, 0.86],
  piston_a2: [-0.17, 0, 0.46],
  piston_a3: [-0.18, 0, 0.08],
  piston_b1: [0.16, 0, 0.86],
  piston_b2: [0.17, 0, 0.46],
  piston_b3: [0.18, 0, 0.08]
};

// Skinned surface: five of the bones carry skin, the rest are rigid parts only.
const SKIN = {
  chassis: { r: 0.17, n: 8 },
  column: { r: 0.1, n: 6 },
  strut_a1: { r: 0.06, n: 5 },
  strut_a2: { r: 0.055, n: 5 },
  strut_a3: { r: 0.05, n: 5 },
  piston_a1: { r: 0.07, n: 5 },
  piston_a2: { r: 0.06, n: 5 },
  piston_a3: { r: 0.055, n: 5 },
  piston_b1: { r: 0.07, n: 5 },
  piston_b2: { r: 0.06, n: 5 },
  piston_b3: { r: 0.055, n: 5 }
};

export function buildDroid({ x = 0, y = 0, heading = 0, mode = 'skin', terrain = 0 } = {}) {
  const holder = new THREE.Object3D();
  const root = new THREE.Group();
  holder.add(root);
  const bones = [],
    byName = new Map();
  for (const [name, parent] of Object.entries(PARENT)) {
    const b = new THREE.Object3D(),
      at = AT[name],
      base = parent ? AT[parent] : [0, 0, 0];
    b.name = name;
    b.position.set(at[0] - base[0], at[1] - base[1], at[2] - base[2]);
    (parent ? byName.get(parent) : root).add(b);
    byName.set(name, b);
    bones.push(b);
  }
  holder.position.set(0, 0, 0);
  root.updateWorldMatrix(true, true);
  for (const b of bones) b.userData.restInv = new THREE.Matrix4().copy(b.matrixWorld).invert();

  const inst = {
    root,
    bones,
    skins: [],
    bone: name => byName.get(name) || null,
    syncSkins,
    flat: null,
    skinMask: null,
    dirty: false
  };
  // Exactly how the game binds a model: palette = root-relative bone transform and
  // the authored inverse bind, read by the GPU in mesh space.
  function syncSkins() {
    const rel = new THREE.Matrix4().copy(root.matrixWorld).invert(),
      out = new THREE.Matrix4();
    for (const s of inst.skins)
      for (let i = 0; i < s.boneMap.length; i++) {
        const b = inst.bones[s.boneMap[i]];
        if (b)
          out
            .multiplyMatrices(rel, b.matrixWorld)
            .multiply(b.userData.restInv)
            .toArray(s.mats, i * 16);
      }
  }

  let mesh = null,
    seam = -1;
  if (mode === 'skin') {
    const rows = [];
    const push = (bone, p, blend) => {
      rows.push({ bone, p, blend });
      return rows.length - 1;
    };
    for (const [bone, { r, n }] of Object.entries(SKIN)) {
      const c = AT[bone];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        push(bone, [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]], null);
      }
      push(bone, [c[0], c[1], c[2] + r * 0.9], null);
      push(bone, [c[0], c[1], c[2] - r * 0.9], null);
    }
    // The only blended vertex: a seam across the elbow, so a blast has a border to
    // clip instead of one skin stretched between two islands.
    seam = push('strut_a2', [0.39, 0, 0.96], { bone: 'strut_a3', weight: 0.5 });

    const names = Object.keys(SKIN),
      slot = new Map(names.map((n, i) => [n, i]));
    const position = new Float32Array(rows.length * 3),
      skinIndex = new Uint16Array(rows.length * 4),
      skinWeight = new Float32Array(rows.length * 4);
    rows.forEach(({ bone, p, blend }, j) => {
      position.set(p, j * 3);
      skinIndex[j * 4] = slot.get(bone);
      skinWeight[j * 4] = 1;
      if (blend) {
        skinIndex[j * 4 + 1] = slot.get(blend.bone);
        skinWeight[j * 4] = 1 - blend.weight;
        skinWeight[j * 4 + 1] = blend.weight;
      }
    });
    const index = [],
      groups = new Map();
    rows.forEach(({ bone }, j) => {
      if (!groups.has(bone)) groups.set(bone, []);
      groups.get(bone).push(j);
    });
    for (const [bone, list] of groups) {
      if (bone === 'strut_a2') list.push(seam);
      for (let k = 1; k + 1 < list.length; k++) index.push(list[0], list[k], list[k + 1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(index);
    geometry.userData.kind = 'skin';
    const material = { visible: true, userData: {}, uniforms: { boneMatrices: { value: null } }, defines: { SKINNED: '' } };
    mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hull';
    root.add(mesh);
    const mats = new Float32Array(16 * names.length),
      identity = new THREE.Matrix4();
    for (let i = 0; i < names.length; i++) identity.toArray(mats, i * 16);
    // A palette entry points into the model's own bone list, not into the skin.
    inst.skins.push({ mesh, mats, boneMap: names.map(n => bones.indexOf(byName.get(n))) });
    syncSkins();
  }

  // Rigid parts, parented to bones: the droid's plates, its cannon and its boots.
  const kit = [];
  const plate = (bone, size, offset, kind) => {
    const g = new THREE.BoxGeometry(...size);
    g.translate(...offset);
    g.userData.kind = kind;
    const m = new THREE.Mesh(g, { visible: true, userData: {} });
    m.name = kind;
    byName.get(bone).add(m);
    kit.push(m);
    return m;
  };
  if (mode === 'skin') {
    plate('chassis', [0.34, 0.3, 0.14], [0, 0, 0.12], 'plate');
    plate('dome', [0.2, 0.2, 0.18], [0, 0, 0], 'dome');
    plate('piston_a3', [0.1, 0.24, 0.1], [0, 0.06, -0.06], 'boot');
    plate('piston_b3', [0.1, 0.24, 0.1], [0, -0.06, -0.06], 'boot');
    plate('strut_a3', [0.1, 0.1, 0.34], [0.04, 0, -0.06], 'cannon');
  } else {
    // Rigid-only: every bone carries a plate, so the whole droid is boxes on bones.
    for (const name of Object.keys(PARENT)) plate(name, [0.16, 0.16, 0.16], [0, 0, 0], 'shell_' + name);
  }

  const u = {
    x,
    y,
    heading,
    foot: true,
    kind: 'INFANTRY',
    type: { name: 'Test_Articulated' },
    holder,
    inst,
    z: terrain
  };
  holder.position.set(x, y, 0);
  return { u, inst, holder, root, bones, mesh, kit, seam, byName };
}

// World positions of every drawn vertex, read the way the GPU draws them: a palette
// entry per influence for a skinned mesh, the mesh matrix for rigid parts. This is
// independent of the clearance code under test.
export function drawnVertices(group) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3(),
    out = new THREE.Vector3(),
    m = new THREE.Matrix4(),
    rows = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    o.onBeforeRender?.();
    const g = o.geometry,
      pos = g.attributes.position,
      pal = o.material.uniforms?.boneMatrices?.value,
      idx = g.index?.array;
    const used = idx ? [...new Set(idx)] : Array.from({ length: pos.count }, (_, i) => i);
    for (const j of used) {
      v.fromBufferAttribute(pos, j);
      if (pal) {
        out.set(0, 0, 0);
        const { skinIndex, skinWeight } = g.attributes;
        for (let k = 0; k < 4; k++) {
          const w = skinWeight.getComponent(j, k);
          if (w) out.addScaledVector(v.clone().applyMatrix4(m.fromArray(pal, 16 * skinIndex.getComponent(j, k))), w);
        }
      } else out.copy(v);
      out.applyMatrix4(o.matrixWorld);
      rows.push({ mesh: g.userData.kind, j, x: out.x, y: out.y, z: out.z });
    }
  });
  return rows;
}

// Every drawn triangle in world space, so a stretched island seam is visible as an
// edge that grew past the authored surface.
export function drawnTriangles(group) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3(),
    out = new THREE.Vector3(),
    m = new THREE.Matrix4(),
    tris = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    o.onBeforeRender?.();
    const g = o.geometry,
      pos = g.attributes.position,
      pal = o.material.uniforms?.boneMatrices?.value,
      idx = g.index?.array;
    const at = j => {
      v.fromBufferAttribute(pos, j);
      if (!pal) return out.copy(v).applyMatrix4(o.matrixWorld).clone();
      const o2 = new THREE.Vector3(),
        { skinIndex, skinWeight } = g.attributes;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(j, k);
        if (w) o2.addScaledVector(v.clone().applyMatrix4(m.fromArray(pal, 16 * skinIndex.getComponent(j, k))), w);
      }
      return o2.applyMatrix4(o.matrixWorld);
    };
    const n = idx ? idx.length : pos.count;
    for (let i = 0; i + 2 < n; i += 3) tris.push([at(idx ? idx[i] : i), at(idx ? idx[i + 1] : i + 1), at(idx ? idx[i + 2] : i + 2)]);
  });
  return tris;
}

export const longestEdge = tris => Math.max(...tris.map(([a, b, c]) => Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a))));

export const flat = () => 0;

// How far the drawn surface sinks below the terrain (positive = clipped).
export const belowGround = (rows, height) => Math.max(...rows.map(p => height(p.x, p.y) - p.z));

// The tightest gap between the drawn surface and the terrain margin.
export const margin = (rows, height) => Math.min(...rows.map(p => p.z - height(p.x, p.y)));
