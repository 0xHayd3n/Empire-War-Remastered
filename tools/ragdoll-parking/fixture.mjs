// A synthetic humanoid: an authored skin (one mesh, per-vertex bone weights) plus
// a piece of rigid kit under one boot. Only the shape matters to the ragdoll: ten
// spans, an articulated chain and a skinned surface that the code may lift.
//
// Z is up and the terrain height field is height(x, y), exactly as in game. The
// bones are parented like an authored rig, which is what puts a boot under its
// calf and a hand under its forearm.
import * as THREE from 'three';

export const FLOOR = 0.07;

// Standing pose, root-local == world (the holder sits at the unit's map position).
export const BONE_POSITIONS = {
  Pelvis: [0, 0, 1.1],
  Head: [0, 0, 1.75],
  Bicep_L: [0.22, 0, 1.45],
  FArm_L: [0.3, 0, 1.15],
  Hand_L: [0.34, 0, 0.9],
  Bicep_R: [-0.22, 0, 1.45],
  FArm_R: [-0.3, 0, 1.15],
  Hand_R: [-0.34, 0, 0.9],
  Thigh_L: [0.16, 0, 0.85],
  Calf_L: [0.17, 0, 0.45],
  Foot_L: [0.18, 0, 0.08],
  Thigh_R: [-0.16, 0, 0.85],
  Calf_R: [-0.17, 0, 0.45],
  Foot_R: [-0.18, 0, 0.08]
};

// Interior to the pelvis island in all 26 support directions: the coat skirt ring
// below it and the pack above it dominate every projection, so the cached support
// samples never see this vertex. Under a ridge it is the deepest drawn point.
export const INTERIOR = [0.02, 0, 0.35];

const PARENT = {
  Head: 'Pelvis',
  Bicep_L: 'Pelvis',
  FArm_L: 'Bicep_L',
  Hand_L: 'FArm_L',
  Bicep_R: 'Pelvis',
  FArm_R: 'Bicep_R',
  Hand_R: 'FArm_R',
  Thigh_L: 'Pelvis',
  Calf_L: 'Thigh_L',
  Foot_L: 'Calf_L',
  Thigh_R: 'Pelvis',
  Calf_R: 'Thigh_R',
  Foot_R: 'Calf_R'
};

function skinVertices() {
  const rows = [];
  const push = (bone, x, y, z, blend) => {
    rows.push({ bone, blend, p: [x, y, z] });
    return rows.length - 1;
  };
  const ring = (bone, c, r, n) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      push(bone, c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]);
    }
  };
  // Torso: a pelvis ring, the coat skirt that reaches past it, a pack behind and
  // the hidden interior vertex between the legs.
  ring('Pelvis', [0, 0, 1.1], 0.1, 8);
  ring('Pelvis', [0, 0, 0.25], 0.15, 8);
  push('Pelvis', 0, 0.16, 1.35);
  push('Pelvis', 0, -0.12, 1.2);
  push('Pelvis', INTERIOR[0], INTERIOR[1], INTERIOR[2]);
  // Head, helmet included.
  ring('Head', [0, 0, 1.75], 0.09, 6);
  push('Head', 0, 0, 1.86);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    ring('Bicep_' + side, [s * 0.22, 0, 1.45], 0.05, 4);
    ring('FArm_' + side, [s * 0.3, 0, 1.15], 0.045, 4);
    ring('Hand_' + side, [s * 0.34, 0, 0.9], 0.04, 4);
    push('Hand_' + side, s * 0.36, 0, 0.88);
    ring('Thigh_' + side, [s * 0.16, 0, 0.85], 0.06, 4);
    ring('Calf_' + side, [s * 0.17, 0, 0.45], 0.05, 4);
    // Boots: the lowest and most forward drawn points.
    for (const dx of [-0.03, 0.03]) {
      push('Foot_' + side, s * 0.18 + dx, -0.1, 0.02);
      push('Foot_' + side, s * 0.18 + dx, 0.04, 0.02);
    }
  }
  // A blended knee seam: the only vertex with two influences, so the split has to
  // treat it as a border vertex instead of stretching it across the gap.
  const seam = push('Thigh_L', 0.165, 0, 0.65, { bone: 'Calf_L', weight: 0.5 });
  return { rows, seam };
}

function kitGeometry(depth) {
  // Local to the left foot bone, so world z = 0.08 - depth +/- 0.03.
  const g = new THREE.BoxGeometry(0.06, 0.36, 0.06);
  g.translate(0, -0.12, -depth);
  return g;
}

export function buildUnit({ x = 0, y = 0, heading = 0, kitDepth = 0.12 } = {}) {
  const holder = new THREE.Object3D();
  holder.position.set(x, y, 0);
  const root = new THREE.Group();
  holder.add(root);
  const names = Object.keys(BONE_POSITIONS);
  const byName = new Map();
  const bones = names.map(n => {
    const b = new THREE.Object3D(),
      parent = PARENT[n] ? byName.get('B_' + PARENT[n]) : root,
      world = BONE_POSITIONS[n],
      base = PARENT[n] ? BONE_POSITIONS[PARENT[n]] : [0, 0, 0];
    b.name = 'B_' + n;
    b.position.set(world[0] - base[0], world[1] - base[1], world[2] - base[2]);
    parent.add(b);
    byName.set(b.name, b);
    return b;
  });
  const slot = new Map(names.map((n, i) => [n, i]));

  const { rows, seam } = skinVertices();
  const position = new Float32Array(rows.length * 3),
    skinIndex = new Uint16Array(rows.length * 4),
    skinWeight = new Float32Array(rows.length * 4);
  rows.forEach(({ bone, blend, p }, j) => {
    position.set(p, j * 3);
    skinIndex[j * 4] = slot.get(bone);
    skinWeight[j * 4] = 1;
    if (blend) {
      skinIndex[j * 4 + 1] = slot.get(blend.bone);
      skinWeight[j * 4] = 1 - blend.weight;
      skinWeight[j * 4 + 1] = blend.weight;
    }
  });
  // One triangle fan per bone group, so every drawn vertex stays referenced and
  // no triangle crosses islands. The blended knee seam closes the calf group, so
  // its triangles are the border the split has to drop.
  const index = [],
    groups = new Map();
  rows.forEach(({ bone }, j) => {
    if (!groups.has(bone)) groups.set(bone, []);
    groups.get(bone).push(j);
  });
  for (const [bone, list] of groups) {
    if (bone === 'Calf_L') list.push(seam);
    for (let k = 1; k + 1 < list.length; k++) index.push(list[0], list[k], list[k + 1]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  geometry.userData.kind = 'skin';

  const material = { visible: true, userData: {}, uniforms: { boneMatrices: { value: null } }, defines: { SKINNED: '' } };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'skin';
  root.add(mesh);

  const mats = new Float32Array(16 * names.length);
  const identity = new THREE.Matrix4();
  for (let i = 0; i < names.length; i++) identity.toArray(mats, i * 16);

  const kit = new THREE.Mesh(kitGeometry(kitDepth), { visible: true, userData: {} });
  kit.name = 'kit';
  kit.geometry.userData.kind = 'kit';
  byName.get('B_Foot_L').add(kit);

  const inst = {
    root,
    bones,
    skins: [{ mesh, mats, boneMap: names.map((_, i) => i) }],
    bone: n => byName.get(n) || null,
    syncSkins() {},
    flat: false,
    skinMask: false,
    dirty: false
  };
  const u = { x, y, heading, foot: true, kind: 'INFANTRY', type: { name: 'Test_Trooper' }, holder, inst };
  const interior = rows.findIndex(r => r.p[0] === INTERIOR[0] && r.p[2] === INTERIOR[2]);
  return { u, inst, holder, root, bones, mesh, kit, seam, interior };
}

export const flat = () => 0;
// A ridge centred under the hidden interior vertex, high enough that the per-frame
// per-island cap could not hide the miss either.
export const ridge = (x, y) => 0.75 * Math.exp(-((x - INTERIOR[0]) ** 2 + y ** 2) / 0.002);
export const gentle = (x, y) => 0.03 * x + 0.02 * y;

// World positions of every drawn vertex, read the way the GPU draws them: a
// palette entry per influence for a skinned mesh, the mesh matrix for rigid kit.
// Independent of the clearance code under test.
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
      // Ragdoll copies are new meshes without a name, so tag the geometry.
      rows.push({ mesh: g.userData.kind, j, x: out.x, y: out.y, z: out.z });
    }
  });
  return rows;
}

// The largest floor correction the drawn skin still needs: 0 means it sits
// exactly on the margin everywhere, positive means part of it is still buried.
export function liftNeeded(rows, height) {
  let worst = -Infinity,
    at = null;
  for (const p of rows) {
    const need = height(p.x, p.y) + FLOOR - p.z;
    if (need > worst) {
      worst = need;
      at = p;
    }
  }
  return { worst, at };
}

// How far the drawn skin sinks below the terrain itself (positive = clipped).
export function belowGround(rows, height) {
  return Math.max(...rows.map(p => height(p.x, p.y) - p.z));
}
