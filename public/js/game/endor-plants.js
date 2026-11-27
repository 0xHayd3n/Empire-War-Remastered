// Isolated Endor vegetation replacement.
//
// Everything here is opt-in: prepareEndorPlants(game) inspects the authored
// stock props, builds NEW 3D geometry from Poly Haven CC0 bark/leaf surfaces,
// and hides the stock prop meshes only while the returned set(true) is active.
// No unit, collision, stat or terrain state is touched. The original prop
// groups, their transforms and their batching remain the source of placement,
// orientation and scale.
//
// The material is the game's own model ShaderMaterial (programSources.VERT /
// FRAG), not MeshStandardMaterial, so it runs on the custom WebGPU renderer and
// on the WebGL fallback through the same code path.

import * as THREE from '../../vendor/three/build/three.module.js';
import {dryFootprint} from './endor-habitat.js';

const DEG = Math.PI / 180;
const FACING = Math.PI / 2;
const CELL = 0.5; // 2x2 leaf atlas
const PAD = 8 / 2048;

const VEGETATION = new Map([
  ['W_TREE_EVER_00_HI', { id: 'endor-tree-ever-00', kind: 'tree', stock: 'ever00' }],
  ['W_TREE_EVER_01_HI', { id: 'endor-tree-ever-01', kind: 'tree', stock: 'ever01' }],
  ['W_TREE_EVER_00_CLUSTER', { id: 'endor-tree-cluster-00', kind: 'cluster', stock: 'cluster00' }],
  ['W_TREE_EVER_01_CLUSTER', { id: 'endor-tree-cluster-01', kind: 'cluster', stock: 'cluster01' }],
  ['W_TREE_EVER_CANOPY_B', { id: 'endor-canopy-b', kind: 'canopy', stock: 'canopyB' }],
  ['W_TREE_DEC_CANOPY_A', { id: 'endor-canopy-a', kind: 'canopyLow', stock: 'canopyA' }],
  ['W_TREE_DEC_01_HI', { id: 'endor-tree-broadleaf', kind: 'broadleaf', stock: 'dec01' }],
  ['W_GRNDCVR_A', { id: 'endor-ground-a', kind: 'ground', stock: 'ground' }],
  ['W_GRNDCVR_D', { id: 'endor-ground-d', kind: 'ground', stock: 'ground' }],
  ['W_GRNDCVR_E', { id: 'endor-ground-e', kind: 'ground', stock: 'ground' }],
  ['W_GRNDCVR_F', { id: 'endor-ground-f', kind: 'ground', stock: 'ground' }],
  ['W_GRNDCVR_G', { id: 'endor-ground-g', kind: 'ground', stock: 'ground' }],
  ['W_FERN00', { id: 'endor-fern-00', kind: 'fern', stock: 'fern00' }],
  ['W_FERN01', { id: 'endor-fern-01', kind: 'fern', stock: 'fern01' }],
  ['W_LEAFBUSH00', { id: 'endor-bush-00', kind: 'bush', stock: 'bush00' }],
  ['W_TEMP_CATTAIL', { id: 'endor-cattail', kind: 'cattail', stock: 'cattail' }],
  ['W_TREEREDWOOD_STMP00', { id: 'endor-stump-redwood', kind: 'log', stock: 'stumpRed' }],
  ['W_TREEPINE_STMP00', { id: 'endor-stump-pine', kind: 'stump', stock: 'stumpPine' }]
]);

// Stock model bounds are borrowed only so the new mesh occupies the authored
// footprint. They are measured from the stock .ALO (documented in the folder
// README); no stock geometry, UVs or textures are reused.
const STOCK = {
  ever00: { min: [-30.02, -32.06, -2.89], max: [32.22, 31.18, 85.12] },
  ever01: { min: [-33.15, -34.78, -0.16], max: [33.75, 35.78, 85.12] },
  cluster00: { min: [-96.7, -100.53, -2.89], max: [97.22, 82.35, 85.12] },
  cluster01: { min: [-76.36, -74.35, -0.16], max: [68.52, 66.79, 85.12] },
  canopyB: { min: [-155.9, -153.05, 1.05], max: [190.87, 129.35, 80.76] },
  canopyA: { min: [-151.17, -133.59, -9.81], max: [183.7, 116.18, 28.54] },
  dec01: { min: [-30.87, -28.19, -0.3], max: [29.51, 28, 55.91] },
  ground: { min: [-65.82, -40.47, -0.06], max: [46.62, 34.68, 13.32] },
  fern00: { min: [-14.58, -11.43, -6.97], max: [10.87, 11.51, 11.58] },
  fern01: { min: [-11.46, -11.88, -0.23], max: [12.34, 13.74, 9.7] },
  bush00: { min: [-7.46, -8.66, -1.97], max: [9.25, 7.92, 8.68] },
  cattail: { min: [-26.4, -16.89, 0], max: [24.51, 24.17, 10.53] },
  stumpRed: { min: [-13.37, -3.63, -0.56], max: [9.74, 4.32, 7.65] },
  stumpPine: { min: [-3.23, -2.69, -0.1], max: [3.01, 3.36, 18.75] }
};

const LEAF = {
  fernClump: [0, 0, 0.01, 0.99, 0.01, 0.99],
  nettleClump: [1, 0, 0.01, 0.99, 0.01, 0.99],
  nettleLeaf: [1, 0, 0.35, 0.54, 0.16, 0.38],
  grassClump: [0, 1, 0.01, 0.99, 0.01, 0.99],
  grassBlade: [0, 1, 0.03, 0.12, 0.02, 0.98],
  pineTwig: [1, 1, 0.03, 0.2, 0.02, 0.42]
};

const PALETTE = {
  evergreen: [1.0, 1.0, 0.9],
  evergreenDark: [0.82, 0.92, 0.76],
  broadleaf: [1.0, 1.0, 0.82],
  fern: [0.96, 1.0, 0.86],
  grass: [1.0, 1.0, 0.82],
  bush: [0.92, 1.0, 0.8],
  dry: [1.0, 0.94, 0.76],
  bark: [0.98, 0.98, 0.95]
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const rngBetween = (rng, a, b) => a + (b - a) * rng();
const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

function stockBox(key) {
  const s = STOCK[key];
  const min = new THREE.Vector3().fromArray(s.min),
    max = new THREE.Vector3().fromArray(s.max);
  return { min, max, size: max.clone().sub(min), center: max.clone().add(min).multiplyScalar(0.5) };
}

function cellRect([cx, cy, x0, x1, y0, y1]) {
  const u0 = cx * CELL + PAD,
    v0 = cy * CELL + PAD,
    span = CELL - PAD * 2;
  // v0 is the card base, v1 the tip. The atlas rows run top-to-bottom.
  return {
    u0: u0 + (x1 - x0 > 0 ? x0 : x1) * span,
    u1: u0 + (x1 > x0 ? x1 : x0) * span,
    v0: v0 + (y1 > y0 ? y1 : y0) * span,
    v1: v0 + (y1 > y0 ? y0 : y1) * span
  };
}

const RECTS = Object.fromEntries(Object.entries(LEAF).map(([k, v]) => [k, cellRect(v)]));

class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.tan = [];
    this.bin = [];
    this.col = [];
    this.idx = [];
    this.wood=[];
  }
  v(p, n, uv, t, b, c) {
    this.wood.push(!!this.addingBark);
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.tan.push(t.x, t.y, t.z);
    this.bin.push(b.x, b.y, b.z);
    this.col.push(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);
    return i;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  merge(other, matrix) {
    const base = this.pos.length / 3;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = new THREE.Vector3(),
      n = new THREE.Vector3(),
      t = new THREE.Vector3(),
      b = new THREE.Vector3();
    for (let i = 0; i < other.pos.length / 3; i++) {
      p.fromArray(other.pos, i * 3).applyMatrix4(matrix);
      n.fromArray(other.nrm, i * 3).applyMatrix3(nm).normalize();
      t.fromArray(other.tan, i * 3).applyMatrix3(nm).normalize();
      b.fromArray(other.bin, i * 3).applyMatrix3(nm).normalize();
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
      this.tan.push(t.x, t.y, t.z);
      this.bin.push(b.x, b.y, b.z);
      this.col.push(other.col[i * 4], other.col[i * 4 + 1], other.col[i * 4 + 2], other.col[i * 4 + 3]);
    }
    for(const wood of other.wood)this.wood.push(wood);
    for (const k of other.idx) this.idx.push(k + base);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(this.tan), 3));
    g.setAttribute('binormal', new THREE.BufferAttribute(new Float32Array(this.bin), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 4));
    // Opaque trunks and cutout foliage require distinct materials. Do not alpha-test a trunk with UVs meant for bark.
    const faces=[[],[]];for(let j=0;j<this.idx.length;j+=3){faces[+!!this.wood[this.idx[j]]].push(this.idx[j],this.idx[j+1],this.idx[j+2]);}
    const indices=new Uint32Array(this.idx.length);let off=0;
    faces.forEach((a,i)=>{if(a.length){indices.set(a,off);g.addGroup(off,a.length,i);off+=a.length;}});
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function color(base, rng, amount = 0.12) {
  const k = 1 - amount * rng();
  return [Math.min(1, base[0] * k), Math.min(1, base[1] * k), Math.min(1, base[2] * k), 1];
}

function perpendicular(dir, rng) {
  const a = Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const s = new THREE.Vector3().crossVectors(dir, a).normalize();
  return s.applyAxisAngle(dir, rng() * Math.PI * 2);
}

function addTube(b, points, radii, sides, opts = {}) {
  b.addingBark=true;
  const n = points.length;
  const rng = opts.rng || (() => 0.5);
  const uRepeat = opts.uRepeat ?? 2,
    vScale = opts.vScale ?? 10,
    base = opts.color || [1, 1, 1, 1];
  const lens = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + points[i].distanceTo(points[i - 1]));
  const frames = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.copy(points[1]).sub(points[0]);
    else if (i === n - 1) t.copy(points[n - 1]).sub(points[n - 2]);
    else t.copy(points[i + 1]).sub(points[i - 1]);
    t.normalize();
    let normal;
    if (!prev) {
      const a = Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      normal = new THREE.Vector3().crossVectors(t, a).normalize();
    } else {
      normal = prev.clone().sub(t.clone().multiplyScalar(prev.dot(t))).normalize();
    }
    const binormal = new THREE.Vector3().crossVectors(t, normal).normalize();
    frames.push({ t, normal, binormal });
    prev = normal;
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    const f = frames[i],
      ring = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const d = new THREE.Vector3()
        .addScaledVector(f.normal, Math.cos(a))
        .addScaledVector(f.binormal, Math.sin(a))
        .normalize();
      const p = points[i].clone().addScaledVector(d, radii[i]);
      const uv = [(j / sides) * uRepeat, lens[i] / vScale];
      const tan = new THREE.Vector3()
        .addScaledVector(f.normal, -Math.sin(a))
        .addScaledVector(f.binormal, Math.cos(a))
        .normalize();
      ring.push(b.v(p, d, uv, tan, f.t, color(base, rng, 0.08)));
    }
    rows.push(ring);
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = rows[i][j],
        b1 = rows[i][j + 1],
        c = rows[i + 1][j],
        d = rows[i + 1][j + 1];
      b.quad(a, b1, d, c);
    }
  if (opts.capEnd) {
    const f = frames[n - 1],
      center = points[n - 1].clone().addScaledVector(f.t, radii[n - 1] * 0.15);
    const c = b.v(center, f.t.clone(), [0.5, 0.5], f.normal.clone(), f.binormal.clone(), color(base, rng, 0.05));
    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const d = new THREE.Vector3()
        .addScaledVector(f.normal, Math.cos(a))
        .addScaledVector(f.binormal, Math.sin(a))
        .normalize();
      const p = points[n - 1].clone().addScaledVector(d, radii[n - 1]);
      ring.push(b.v(p, f.t.clone(), [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5], f.normal.clone(), f.binormal.clone(), color(base, rng, 0.05)));
    }
    for (let j = 0; j < sides; j++) b.tri(c, ring[j], ring[j + 1]);
  }
  b.addingBark=false;
}

function addCard(b, opts) {
  const {
    base,
    dir,
    side,
    length,
    width,
    rect,
    segments = 3,
    droop = 0,
    bend = 0,
    twist = 0,
    taper = 0.86,
    wave = 0.08,
    color: col = [1, 1, 1, 1],
    rng = () => 0.5
  } = opts;
  const d = dir.clone().normalize();
  const s0 = side.clone().sub(d.clone().multiplyScalar(side.dot(d))).normalize();
  // Foliage cards need a normal in the upper hemisphere or an overhead sun
  // leaves every horizontal frond with only ambient fill (the stock conifer
  // meshes do not have that problem because their normals point outward/up).
  const normal = new THREE.Vector3().crossVectors(s0, d).normalize();
  if (normal.z < 0) normal.multiplyScalar(-1);
  normal.lerp(new THREE.Vector3(0, 0, 1), 0.58).normalize();
  const rows = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = base.clone().addScaledVector(d, length * t);
    p.z -= droop * t * t;
    p.addScaledVector(s0, bend * Math.sin(Math.PI * t));
    const w = width * (1 - taper * t) * (1 + wave * Math.sin(t * Math.PI * 3));
    const sideAt = s0.clone().applyAxisAngle(d, twist * t).multiplyScalar(Math.max(0.05, w) * 0.5);
    const uv0 = [rect.u0, rect.v0 + (rect.v1 - rect.v0) * t],
      uv1 = [rect.u1, uv0[1]];
    const c = color(col, rng, 0.1);
    rows.push([
      b.v(p.clone().sub(sideAt), normal, uv0, sideAt.clone().normalize(), d, c),
      b.v(p.clone().add(sideAt), normal, uv1, sideAt.clone().normalize(), d, c)
    ]);
  }
  for (let i = 0; i < segments; i++) {
    const a = rows[i][0],
      b1 = rows[i][1],
      c = rows[i + 1][0],
      d1 = rows[i + 1][1];
    b.quad(a, b1, d1, c);
  }
}

function cardAt(b, center, dir, length, width, rect, col, rng, opts = {}) {
  const side = perpendicular(dir, rng).applyAxisAngle(dir, opts.roll || 0);
  addCard(b, {
    base: center.clone().addScaledVector(dir, -(opts.inset || 0)),
    dir,
    side,
    length,
    width,
    rect,
    segments: opts.segments ?? 2,
    droop: opts.droop ?? 0,
    bend: opts.bend ?? 0,
    twist: opts.twist ?? 0,
    taper: opts.taper ?? 0.86,
    wave: opts.wave ?? 0.08,
    color: col,
    rng
  });
}

function treeBuilder(which, seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox(which === 'ever01' ? 'ever01' : which === 'dec01' ? 'dec01' : 'ever00');
  const h = s.size.z;
  const baseZ = s.min.z + 0.4;
  const half = Math.max(s.size.x, s.size.y) * 0.5;
  const broad = which === 'dec01';
  const near = detail === 'near';
  const rBase = broad ? half * 0.09 : half * 0.085;
  const topZ = baseZ + h * (broad ? 0.72 : 0.93);
  const lean = new THREE.Vector3(rngBetween(rng, -1.2, 1.2), rngBetween(rng, -1.2, 1.2), 0);
  const path = [];
  const rings = near ? 7 : 4;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    path.push(
      new THREE.Vector3(
        lean.x * t * t + Math.sin(t * 4 + seed) * half * 0.012,
        lean.y * t * t + Math.cos(t * 3 + seed) * half * 0.012,
        baseZ + (topZ - baseZ) * t
      )
    );
  }
  const radii = path.map((_, i) => {
    const t = i / (path.length - 1);
    return rBase * (1 - 0.88 * t) + 0.32;
  });
  addTube(b, path, radii, near ? 8 : 5, {
    uRepeat: 2.4,
    vScale: 11,
    color: PALETTE.bark,
    rng,
    capEnd: true
  });

  const branches = near ? (broad ? 6 : 5) : broad ? 3 : 2;
  for (let i = 0; i < branches; i++) {
    const t = (broad ? 0.34 : 0.4) + (i / Math.max(1, branches)) * (broad ? 0.34 : 0.42);
    const start = path[Math.min(path.length - 1, Math.round(t * (path.length - 1)))].clone();
    const a = i * 2.39996 + seed * 0.13;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), broad ? 0.28 : 0.42).normalize();
    const len = (broad ? half * 0.55 : half * 0.62) * (1.05 - t * 0.55) + rngBetween(rng, -1, 2);
    const end = start.clone().addScaledVector(dir, len);
    end.z += broad ? 2.5 : 4.5;
    const mid = start.clone().lerp(end, 0.55);
    mid.z += broad ? 1.2 : 2.4;
    const pts = [start, mid, end];
    addTube(b, pts, [rBase * 0.36, rBase * 0.16, 0.14], near ? 5 : 4, {
      uRepeat: 1.5,
      vScale: 9,
      color: PALETTE.bark,
      rng
    });
    if (near) {
      for (let k = 0; k < 2; k++) {
        const d2 = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), rngBetween(rng, -1.1, 1.1));
        d2.z += 0.8;
        const e2 = end.clone().addScaledVector(d2.normalize(), rngBetween(rng, 4, 9));
        e2.z += rngBetween(rng, 1, 4);
        addTube(b, [end, end.clone().lerp(e2, 0.55), e2], [0.14, 0.08, 0.05], 4, {
          uRepeat: 1,
          vScale: 8,
          color: PALETTE.bark,
          rng
        });
      }
    }
  }

  const tiers = near ? (broad ? 6 : 6) : broad ? 3 : 3;
  const fronds = near ? (broad ? 10 : 9) : broad ? 5 : 4;
  const atlas = broad ? 'nettleLeaf' : 'pineTwig';
  const col = broad ? PALETTE.broadleaf : PALETTE.evergreen;
  for (let tier = 0; tier < tiers; tier++) {
    const tt = tier / Math.max(1, tiers - 1);
    const z = baseZ + h * (broad ? 0.38 + tt * 0.58 : 0.5 + tt * 0.46);
    const r = half * (broad ? 0.78 - tt * 0.42 : 0.7 - tt * 0.5);
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + tier * 1.13 + seed * 0.01;
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), broad ? 0.16 : 0.12).normalize();
      const base = new THREE.Vector3(dir.x * r, dir.y * r, z);
      const len = (broad ? 14 : 17) * (0.72 + rng() * 0.55) * (1 - tt * 0.25);
      const w = (broad ? 11 : 10) * (0.78 + rng() * 0.42);
      const c = color(tier > tiers - 2 ? PALETTE.evergreen : col, rng, 0.18);
      cardAt(b, base, dir, len, w, RECTS[atlas], c, rng, {
        segments: near ? 3 : 1,
        droop: broad ? 3.5 : 2.2,
        bend: rngBetween(rng, -1.5, 1.5),
        twist: rngBetween(rng, -0.45, 0.45),
        taper: 0.9,
        wave: 0.12
      });
      if (near) {
        const d2 = dir.clone();
        d2.z += 0.7;
        cardAt(b, base, d2.normalize(), len * 0.78, w * 0.8, RECTS[atlas], color(PALETTE.evergreenDark, rng, 0.16), rng, {
          segments: 2,
          droop: 1.6,
          bend: rngBetween(rng, -1, 1),
          twist: rngBetween(rng, -0.8, 0.8),
          taper: 0.88
        });
        // Broad inner cards fill the gaps between the thin frond cards, so the
        // crown reads as a volume rather than a set of radial twigs.
        const inner = dir.clone().multiplyScalar(0.55);
        inner.z = 1;
        cardAt(b, base.clone().addScaledVector(inner.clone().normalize(), -3), inner.normalize(), len * 0.9, w * 1.25, RECTS.nettleClump, color(PALETTE.evergreenDark, rng, 0.2), rng, {
          segments: 2,
          droop: 2.2,
          bend: rngBetween(rng, -1.5, 1.5),
          twist: rngBetween(rng, -1.2, 1.2),
          taper: 0.82,
          wave: 0.15
        });
      }
    }
  }
  if (near) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + seed * 0.2;
      const dir = new THREE.Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1).normalize();
      cardAt(b, new THREE.Vector3(lean.x, lean.y, topZ - 1), dir, h * 0.12, h * 0.07, RECTS[broad ? 'nettleLeaf' : 'pineTwig'], color(PALETTE.evergreen, rng, 0.15), rng, {
        segments: 2,
        droop: 0.8,
        twist: rngBetween(rng, -0.4, 0.4)
      });
    }
  }
  return b;
}

function clusterBuilder(which, seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox(which === 'cluster01' ? 'cluster01' : 'cluster00');
  const count = detail === 'near' ? 4 : 3;
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + seed * 0.01;
    const rr = Math.min(s.size.x, s.size.y) * (0.16 + rng() * 0.16);
    // treeBuilder's local base is 0.4 above its own stock minimum; every Endor
    // cluster's authored ground origin is that same 0.4 step down.
    const offset = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, -0.4);
    const sc = rngBetween(rng, 0.68, 0.88);
    const m = new THREE.Matrix4().compose(offset, new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
    b.merge(treeBuilder(which === 'cluster01' ? 'ever01' : 'ever00', seed + i * 97, detail), m);
  }
  return b;
}

function canopyBuilder(which, seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox(which === 'canopyA' ? 'canopyA' : 'canopyB');
  const low = which === 'canopyA';
  const clumps = detail === 'near' ? (low ? 12 : 17) : low ? 4 : 6;
  const cards = detail === 'near' ? 9 : 5;
  const z0 = s.min.z + s.size.z * (low ? 0.18 : 0.35);
  const z1 = s.max.z - s.size.z * (low ? 0.1 : 0.18);
  for (let c = 0; c < clumps; c++) {
    const a = c * 2.39996 + seed * 0.013;
    const rr = Math.sqrt(rng()) * 0.4;
    const center = new THREE.Vector3(
      s.center.x + Math.cos(a) * s.size.x * rr,
      s.center.y + Math.sin(a) * s.size.y * rr,
      z0 + (z1 - z0) * (0.15 + 0.85 * rng())
    );
    const radius = Math.min(s.size.x, s.size.y) * (low ? 0.1 : 0.09);
    const atlas = rng() < 0.48 ? 'nettleLeaf' : 'pineTwig';
    for (let i = 0; i < cards; i++) {
      const d = new THREE.Vector3(rngBetween(rng, -1, 1), rngBetween(rng, -1, 1), rngBetween(rng, low ? -0.1 : 0.05, 0.65)).normalize();
      const base = center.clone().addScaledVector(d, -radius * rngBetween(rng, 0.1, 0.6));
      const len = radius * rngBetween(rng, 1.2, 2.2);
      const w = radius * rngBetween(rng, 0.45, 0.8);
      const useAtlas = rng() < 0.72 ? atlas : i % 2 ? 'nettleLeaf' : 'pineTwig';
      cardAt(b, base, d, len, w, RECTS[useAtlas], color(i % 3 ? PALETTE.evergreen : PALETTE.evergreenDark, rng, 0.22), rng, {
        segments: detail === 'near' ? 3 : 1,
        droop: rngBetween(rng, 0, 4),
        bend: rngBetween(rng, -2, 2),
        twist: rngBetween(rng, -0.7, 0.7),
        taper: 0.85,
        wave: 0.1
      });
    }
  }
  return b;
}

function groundBuilder(seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox('ground');
  const clumps = detail === 'near' ? 18 : 6;
  const cards = detail === 'near' ? 5 : 2;
  for (let c = 0; c < clumps; c++) {
    const a = c * 2.39996 + seed * 0.017;
    const rr = Math.sqrt(rng()) * 0.43;
    const center = new THREE.Vector3(
      s.center.x + Math.cos(a) * s.size.x * rr,
      s.center.y + Math.sin(a) * s.size.y * rr,
      s.min.z + 0.15 + rng() * 1.8
    );
    for (let i = 0; i < cards; i++) {
      const d = new THREE.Vector3(Math.cos(a + i * 1.4 + rngBetween(rng, -0.5, 0.5)), Math.sin(a + i * 1.4 + rngBetween(rng, -0.5, 0.5)), rngBetween(rng, 0.45, 1.1)).normalize();
      const atlas = i === 2 ? 'fernClump' : i === 3 ? 'nettleLeaf' : 'grassClump';
      const len = rngBetween(rng, i === 2 ? 7 : 6, i === 2 ? 13 : 11);
      const wid = rngBetween(rng, i === 2 ? 5 : 3.5, i === 2 ? 9 : 7);
      cardAt(b, center, d, len, wid, RECTS[atlas], color(i === 3 ? PALETTE.broadleaf : i === 2 ? PALETTE.fern : PALETTE.grass, rng, 0.2), rng, {
        segments: detail === 'near' ? 2 : 1,
        droop: rngBetween(rng, 0.5, 3.5),
        bend: rngBetween(rng, -1.2, 1.2),
        twist: rngBetween(rng, -0.5, 0.5),
        taper: 0.9,
        wave: 0.12
      });
    }
  }
  return b;
}

function fernBuilder(which, seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox(which === 'fern01' ? 'fern01' : 'fern00');
  const n = detail === 'near' ? 17 : 7;
  const baseZ = Math.max(0, s.min.z + 0.3);
  const above = Math.max(4, s.max.z - baseZ);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + seed * 0.021;
    const d = new THREE.Vector3(Math.cos(a), Math.sin(a), rngBetween(rng, 0.45, 0.95)).normalize();
    const len = rngBetween(rng, above * 0.6, above * 1.05);
    const wid = rngBetween(rng, 4.5, 8);
    cardAt(b, new THREE.Vector3(rngBetween(rng, -1, 1), rngBetween(rng, -1, 1), baseZ), d, len, wid, RECTS.fernClump, color(PALETTE.fern, rng, 0.2), rng, {
      segments: detail === 'near' ? 3 : 1,
      droop: rngBetween(rng, 1.2, 3.8),
      bend: rngBetween(rng, -1.5, 1.5),
      twist: rngBetween(rng, -0.6, 0.6),
      taper: 0.92,
      wave: 0.1
    });
  }
  return b;
}

function bushBuilder(seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox('bush00');
  const layers = detail === 'near' ? 3 : 2;
  const cards = detail === 'near' ? 9 : 4;
  for (let l = 0; l < layers; l++) {
    const z = s.min.z + s.size.z * (0.2 + 0.34 * l);
    const r = Math.min(s.size.x, s.size.y) * (0.38 - 0.09 * l);
    for (let i = 0; i < cards; i++) {
      const a = (i / cards) * Math.PI * 2 + l * 0.8 + seed * 0.01;
      const d = new THREE.Vector3(Math.cos(a), Math.sin(a), rngBetween(rng, 0.2, 0.8)).normalize();
      const base = new THREE.Vector3(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, z);
      cardAt(b, base, d, r * rngBetween(rng, 1.4, 2.2), r * rngBetween(rng, 0.8, 1.4), RECTS[detail === 'near' && i % 2 ? 'nettleLeaf' : 'nettleClump'], color(PALETTE.bush, rng, 0.2), rng, {
        segments: detail === 'near' ? 2 : 1,
        droop: rngBetween(rng, 0.5, 3),
        bend: rngBetween(rng, -1, 1),
        twist: rngBetween(rng, -0.8, 0.8),
        taper: 0.88
      });
    }
  }
  return b;
}

function cattailBuilder(seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox('cattail');
  const n = detail === 'near' ? 30 : 11;
  for (let i = 0; i < n; i++) {
    const x = rngBetween(rng, s.min.x * 0.8, s.max.x * 0.8),
      y = rngBetween(rng, s.min.y * 0.8, s.max.y * 0.8);
    const d = new THREE.Vector3(rngBetween(rng, -0.16, 0.16), rngBetween(rng, -0.16, 0.16), 1).normalize();
    const len = rngBetween(rng, s.size.z * 0.7, s.size.z * 1.08);
    const wid = rngBetween(rng, 1.1, 2.2);
    const dry = rng() < 0.3;
    cardAt(b, new THREE.Vector3(x, y, s.min.z + 0.1), d, len, wid, RECTS.grassBlade, color(dry ? PALETTE.dry : PALETTE.grass, rng, 0.2), rng, {
      segments: detail === 'near' ? 2 : 1,
      droop: rngBetween(rng, 0.2, 1.4),
      bend: rngBetween(rng, -0.7, 0.7),
      twist: rngBetween(rng, -0.25, 0.25),
      taper: 0.95,
      wave: 0.04
    });
  }
  return b;
}

function stumpBuilder(which, seed, detail = 'near') {
  const rng = mulberry32(seed);
  const b = new Builder();
  const s = stockBox(which === 'stumpPine' ? 'stumpPine' : 'stumpRed');
  if (which === 'stumpPine') {
    const h = s.size.z;
    const baseZ = s.min.z + 0.2;
    const pts = [];
    for (let i = 0; i < (detail === 'near' ? 5 : 3); i++) {
      const t = i / ((detail === 'near' ? 5 : 3) - 1);
      pts.push(new THREE.Vector3(Math.sin(t * 3 + seed) * 0.35, Math.cos(t * 2 + seed) * 0.35, baseZ + (h - 0.5) * t));
    }
    addTube(b, pts, [2.65, 2.5, 2.35, 2.2, 2.0].slice(0, pts.length), detail === 'near' ? 9 : 6, {
      uRepeat: 1.8,
      vScale: 6,
      color: PALETTE.bark,
      rng,
      capEnd: true
    });
    const roots = detail === 'near' ? 6 : 3;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + seed * 0.1;
      const start = new THREE.Vector3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, baseZ + 1.8);
      const end = new THREE.Vector3(Math.cos(a) * 4.3, Math.sin(a) * 3.2, baseZ - 0.6);
      addTube(b, [start, start.clone().lerp(end, 0.5), end], [1.1, 0.7, 0.15], 5, {
        uRepeat: 1,
        vScale: 4,
        color: PALETTE.bark,
        rng
      });
    }
  } else {
    const h = s.size.x;
    const pts = [];
    for (let i = 0; i < (detail === 'near' ? 6 : 3); i++) {
      const t = i / ((detail === 'near' ? 6 : 3) - 1);
      pts.push(new THREE.Vector3(s.min.x + 0.6 + (h - 1.2) * t, Math.sin(t * 3 + seed) * 0.45, s.min.z + 3.4 + Math.cos(t * 2 + seed) * 0.2));
    }
    addTube(b, pts, [3.4, 3.55, 3.45, 3.1, 2.9, 2.6].slice(0, pts.length), detail === 'near' ? 10 : 6, {
      uRepeat: 2,
      vScale: 6,
      color: PALETTE.bark,
      rng,
      capEnd: true
    });
    const stubs = detail === 'near' ? 3 : 1;
    for (let i = 0; i < stubs; i++) {
      const t = 0.3 + i * 0.22;
      const start = pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))].clone();
      const end = start.clone().add(new THREE.Vector3(rngBetween(rng, -1, 1), rngBetween(rng, 2, 5), rngBetween(rng, 3, 6)));
      addTube(b, [start, start.clone().lerp(end, 0.5), end], [1.2, 0.7, 0.12], 5, {
        uRepeat: 1,
        vScale: 4,
        color: PALETTE.bark,
        rng
      });
    }
  }
  return b;
}

function buildFor(def, detail) {
  switch (def.kind) {
    case 'tree':
      return treeBuilder(def.stock === 'ever01' ? 'ever01' : 'ever00', seedOf(def.id + detail), detail);
    case 'broadleaf':
      return treeBuilder('dec01', seedOf(def.id + detail), detail);
    case 'cluster':
      return clusterBuilder(def.stock === 'cluster01' ? 'cluster01' : 'cluster00', seedOf(def.id + detail), detail);
    case 'canopy':
    case 'canopyLow':
      return canopyBuilder(def.stock === 'canopyA' ? 'canopyA' : 'canopyB', seedOf(def.id + detail), detail);
    case 'ground':
      return groundBuilder(seedOf(def.id + detail), detail);
    case 'fern':
      return fernBuilder(def.stock === 'fern01' ? 'fern01' : 'fern00', seedOf(def.id + detail), detail);
    case 'bush':
      return bushBuilder(seedOf(def.id + detail), detail);
    case 'cattail':
      return cattailBuilder(seedOf(def.id + detail), detail);
    case 'stump':
    case 'log':
      return stumpBuilder(def.stock === 'stumpPine' ? 'stumpPine' : 'stumpRed', seedOf(def.id + detail), detail);
    default:
      return null;
  }
}

// Near/far split. Trees stay solid much farther out; small ground cover goes
// coarse quickly so a 6 km Endor map does not pay for 4,000 near cards.
const LOD = {
  tree: [340, 4800],
  broadleaf: [320, 4200],
  cluster: [420, 5200],
  canopy: [560, 6000],
  canopyLow: [420, 3600],
  ground: [165, 1300],
  fern: [145, 1100],
  bush: [210, 1900],
  cattail: [170, 1400],
  stump: [190, 1500],
  log: [190, 1500]
};

function isVegetationType(t) {
  return /^(?:Prop_Endor|Prop_Tree_|Prop_GroundCover|Prop_Temperate_)/i.test(t?.name || '') || /^(?:W_Tree_Ever|W_Tree_Dec|W_GrndCvr|W_Fern|W_LeafBush|W_Temp_Cattail|W_TreeRedWood_Stmp|W_TreePine_Stmp)/i.test(modelOf(t));
}

function modelOf(t) {
  try {
    return String(t?.str?.('Land_Model_Name') || '').trim();
  } catch {
    return '';
  }
}

function modelKey(t) {
  return modelOf(t)
    .toUpperCase()
    .replace(/^.*[\\/]/, '')
    .replace(/\.(?:ALO|ALA)$/i, '');
}

function typeName(t) {
  return String(t?.name || '');
}

function transformOf(o, out) {
  const rx = (o.rot?.[0] || 0) * DEG,
    ry = (o.rot?.[1] || 0) * DEG,
    rz = (o.rot?.[2] || 0) * DEG;
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rx, ry, rz, 'ZYX'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), FACING));
  const s = (typeof o.type?.num === 'function' ? o.type.num('Scale_Factor', 1) : 1) * (o.scale || 1);
  out.compose(new THREE.Vector3(o.pos?.[0] || 0, o.pos?.[1] || 0, o.pos?.[2] || 0), q, new THREE.Vector3(s, s, s));
  return out;
}

// Pure geometry builder, exposed for tools/tests. It never touches a game,
// scene, renderer or texture.
export function buildEndorPlantGeometry(id, detail = 'near') {
  const def = [...VEGETATION.values()].find(d => d.id === id);
  if (!def) return null;
  const b = buildFor(def, detail);
  return b ? b.geometry() : null;
}

const noopHandle = (reason, stats) => ({
  set() {
    return false;
  },
  dispose() {},
  stats: Object.assign(stats, { ok: false, reason })
});

export async function prepareEndorPlants(game) {
  const stats = {
    ok: false,
    on: false,
    reason: '',
    backend: '',
    map: '',
    targets: 0,
    replaced: 0,
    hiddenOriginals: 0,
    unmatched: 0,
    drawCalls: 0,
    vertices: 0,
    triangles: 0,
    lod: {},
    classes: [],
    excluded: [],
    assets: ['/art/endor-plants/leaf-atlas.png', '/art/endor-plants/bark.png', '/art/endor-plants/bark-normal.png']
  };
  if (!game || !game.scene || !game.map) return noopHandle('no land game', stats);

  const eye = game.camera || game.renderer?.camera || null;
  stats.backend = game.gpuOn
    ? 'webgpu'
    : game.renderer?.webgpu
      ? 'webgpu-mirror'
      : game.renderer?.isWebGLRenderer
        ? 'webgl'
        : 'webgl';
  stats.map = String(game.map.file || game.map.textId || game.map.planet || '');

  const objects = Array.isArray(game.map.objects) ? game.map.objects : [];
  const targets = [];
  const byClass = new Map();
  for (const o of objects) {
    const key = modelKey(o.type);
    const def = VEGETATION.get(key);
    if (!def) continue;
    const t = {
      def,
      key,
      type: typeName(o.type),
      x: o.pos?.[0] || 0,
      y: o.pos?.[1] || 0,
      z: o.pos?.[2] || 0,
      rot: o.rot || [0, 0, 0],
      scale: o.scale || 1,
      matrix: transformOf(o, new THREE.Matrix4()),
      prop: null,
      hidden: false,
      saved: null,
      box: STOCK[def.stock] || STOCK.ever00
    };
    // Match and hide the original normally so switching off restores it. Wetland reeds
    // and deadwood are not terrestrial grass, and gameplay props never enter this list.
    if(['ground','fern','bush'].includes(def.kind)){
      const b=t.box,r=Math.max(b.max[0]-b.min[0],b.max[1]-b.min[1])*.5*t.matrix.getMaxScaleOnAxis();
      t.wetBank=!dryFootprint(game.terrain,t.x,t.y,r);
    }
    targets.push(t);
    if (!byClass.has(def.id)) byClass.set(def.id, { def, list: [], types: new Set() });
    byClass.get(def.id).list.push(t);
    byClass.get(def.id).types.add(t.type);
  }
  if (!targets.length) return noopHandle('no Endor vegetation in this map', stats);
  stats.targets = targets.length;
  stats.wetBankOmissions=targets.filter(t=>t.wetBank).length;

  // Report stock vegetation we deliberately did not replace (the Ewok spawn
  // house is a gameplay structure, not a plant).
  for (const o of objects) {
    const name = typeName(o.type);
    const key = modelKey(o.type);
    const ework = /Ewok_Spawn_House/i.test(name) || /NB_Ewok_tree/i.test(modelOf(o.type));
    if (!isVegetationType(o.type) && !ework) continue;
    if (!VEGETATION.has(key)) {
      const entry = `${name || '(unnamed)'} | ${modelOf(o.type) || '(no model)'}`;
      if (!stats.excluded.some(e => e.type === entry))
        stats.excluded.push({ type: entry, reason: ework ? 'gameplay structure (Ewok spawn house)' : 'no authored 3D class' });
    }
  }

  let THREE_MODEL, dds, alo;
  try {
    THREE_MODEL = await import('../model.js');
    dds = await import('../dds.js');
    alo = await import('../alo.js').catch(() => null);
  } catch (e) {
    stats.reason = 'renderer helpers unavailable: ' + (e?.message || e);
    return noopHandle(stats.reason, stats);
  }
  if (!THREE_MODEL.programSources?.VERT || !THREE_MODEL.programSources?.FRAG) {
    stats.reason = 'model shader sources unavailable';
    return noopHandle(stats.reason, stats);
  }

  // Match the authored prop entries by the cached ALO data identity. This is
  // exact even when two prop types share a stock model, and it never guesses
  // from a bounding box or a nearby position.
  const dataKeys = new Map();
  if (alo?.loadALO) {
    await Promise.all(
      [...new Set(targets.map(t => t.key))].map(async key => {
        const data = await alo.loadALO(key + '.ALO').catch(() => null);
        if (data) dataKeys.set(data, key);
      })
    );
  }
  const props = Array.isArray(game.props) ? game.props : [];
  const used = new Set();
  for (const p of props) {
    const key = dataKeys.get(p?.inst?.model);
    if (!key) continue;
    const pos = p.grp?.position;
    if (!pos) continue;
    const hit = targets.find(
      t => !t.prop && !used.has(t) && t.key === key && Math.abs(t.x - pos.x) < 0.08 && Math.abs(t.y - pos.y) < 0.08
    );
    if (hit) {
      hit.prop = p;
      used.add(hit);
    }
  }
  stats.unmatched = targets.filter(t => !t.prop).length;

  const baseUrl = new URL('../../art/endor-plants/', import.meta.url);
  const fetchBytes = async name => {
    const r = await fetch(new URL(name, baseUrl).href, { cache: 'force-cache' });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  let textures;
  try {
    const [atlasBytes, barkBytes, normalBytes] = await Promise.all([
      fetchBytes('leaf-atlas.png'),
      fetchBytes('bark.png'),
      fetchBytes('bark-normal.png')
    ]);
    const make = async (bytes, repeat) => {
      if (dds.textureFromBytes) return dds.textureFromBytes(bytes.buffer, repeat);
      const { decodePNG } = await import('../png.js');
      const png = await decodePNG(bytes.buffer);
      if (!png) throw new Error('PNG decoder unavailable');
      const t = new THREE.DataTexture(png.data, png.width, png.height, THREE.RGBAFormat);
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    const [atlas, bark, normal] = await Promise.all([make(atlasBytes, false), make(barkBytes, true), make(normalBytes, true)]);
    if (globalThis.__endorPlantsNoMip) {
      atlas.generateMipmaps = false;
      atlas.minFilter = THREE.LinearFilter;
      atlas.needsUpdate = true;
    }
    textures = { atlas, bark, normal };
  } catch (e) {
    stats.reason = 'textures unavailable: ' + (e?.message || e);
    return noopHandle(stats.reason, stats);
  }
  stats.assets = [
    { file: 'leaf-atlas.png', width: textures.atlas.image?.width || 2048, height: textures.atlas.image?.height || 2048, alpha: true },
    { file: 'bark.png', width: textures.bark.image?.width || 1024, height: textures.bark.image?.height || 1024 },
    { file: 'bark-normal.png', width: textures.normal.image?.width || 1024, height: textures.normal.image?.height || 1024 }
  ];

  const white = dds.whiteTexture ? dds.whiteTexture() : textures.normal;
  const makeMaterial = (map, normalMap, alpha, wind, side) => {
    const U = {
      ...THREE_MODEL.lighting,
      ...THREE_MODEL.boltLights,
      ...THREE_MODEL.blastLights,
      map: { value: map },
      normalMap: { value: normalMap },
      colorization: { value: new THREE.Vector4(1, 1, 1, 1) },
      // A little translucency lift. Without it a dense self-shadowing canopy
      // sits at ambient-only values and reads as a black silhouette.
      emissive: { value: alpha ? new THREE.Color(0.13, 0.17, 0.08) : new THREE.Color(0.025, 0.025, 0.025) },
      diffuse: { value: new THREE.Color(1, 1, 1) },
      specular: { value: new THREE.Color(0.09, 0.09, 0.09) },
      shininess: { value: 8 },
      opacity: { value: 1 },
      tint: { value: new THREE.Vector4(1, 1, 1, -1) },
      alphaRef: { value: 0.44 },
      glow: { value: 1 },
      ghost: { value: 0 },
      dissolve: { value: 0 },
      uvScroll: { value: new THREE.Vector2(0, 0) }
    };
    const defines = globalThis.__endorPlantsNoColor ? {} : { USE_VCOLOR: 1 };
    if (alpha) defines.ALPHA = 1;
    if (wind) defines.WIND_LEAVES = 1;
    if (alpha && globalThis.__endorPlantsUnlit) defines.UNLIT = 1;
    if (normalMap !== white) defines.BUMP = 1;
    const m = new THREE.ShaderMaterial({
      vertexShader: THREE_MODEL.programSources.VERT,
      fragmentShader: THREE_MODEL.programSources.FRAG,
      defines,
      uniforms: U,
      side,
      transparent: false,
      depthWrite: true,
      depthTest: true
    });
    m.userData.depthOk = !alpha;
    m.userData.alpha = !!alpha;
    m.userData.endorPlants = true;
    return m;
  };
  const leafMat = makeMaterial(textures.atlas, white, true, true, THREE.DoubleSide);
  const barkMat = makeMaterial(textures.bark, textures.normal, false, false, THREE.FrontSide);
  barkMat.defines.ENDOR_BARK = 1; // This normal texture's alpha is the donor roughness, not gloss.
  const materials = [leafMat, barkMat];

  const group = new THREE.Group();
  group.name = 'EndorPlants';
  group.matrixAutoUpdate = false;
  group.matrix.identity();
  group.matrixWorld.identity();
  group.matrixWorldNeedsUpdate = false;
  group.userData.casts = true;
  group.userData.endorPlants = { materials, textures };
  group.visible = false;
  game.scene.add(group);

  const batches = [];
  const farView = new THREE.Frustum(), pv = new THREE.Matrix4(), lastPV = new THREE.Matrix4();
  for (const [id, entry] of byClass) {
    const nearB = buildFor(entry.def, 'near'),
      farB = buildFor(entry.def, 'far');
    if (!nearB || !farB) continue;
    const leaf = entry.def.kind === 'stump' || entry.def.kind === 'log' ? false : true;
    const geoNear = nearB.geometry(),
      geoFar = farB.geometry();
    const mat = leaf ? (geoNear.groups.some(g=>g.materialIndex===1)||geoFar.groups.some(g=>g.materialIndex===1)?materials:leafMat) : barkMat;
    const n = entry.list.length;
    geoFar.computeBoundingSphere();
    for (const t of entry.list) t.farBounds = geoFar.boundingSphere.clone().applyMatrix4(t.matrix);
    // Both model backends blend instanceTint.a; their missing-attribute default is opaque black.
    for(const g of [geoNear,geoFar])g.setAttribute('instanceTint',new THREE.InstancedBufferAttribute(new Float32Array(4*n),4));
    const near = new THREE.InstancedMesh(geoNear, mat, n),
      far = new THREE.InstancedMesh(geoFar, mat, n);
    for (const im of [near, far]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.matrixAutoUpdate = false;
      im.matrix.identity();
      im.count = 0;
      im.visible = false;
      im.userData.casts = true;
      group.add(im);
    }
    const [nearDist, cullDist] = LOD[entry.def.kind] || LOD.tree;
    const batch = {
      id,
      def: entry.def,
      list: entry.list,
      types: [...entry.types],
      near,
      far,
      geoNear,
      geoFar,
      nearDist,
      cullDist,
      nearCount: 0,
      farCount: 0,
      nearVerts: geoNear.attributes.position.count,
      farVerts: geoFar.attributes.position.count,
      nearTris: (geoNear.index?.count || 0) / 3,
      farTris: (geoFar.index?.count || 0) / 3,
      leaf
    };
    batches.push(batch);
    stats.classes.push({
      id,
      kind: entry.def.kind,
      types: batch.types,
      model: entry.list[0]?.key || '',
      instances: n,
      nearVertices: batch.nearVerts,
      farVertices: batch.farVerts,
      nearTriangles: batch.nearTris,
      farTriangles: batch.farTris,
      nearInstances: 0,
      farInstances: 0
    });
  }
  if (!batches.length) {
    game.scene.remove(group);
    textures.atlas.dispose();
    textures.bark.dispose();
    textures.normal.dispose();
    return noopHandle('no 3D plant batches built', stats);
  }
  stats.replaced = batches.reduce((n, b) => n + b.list.length, 0);
  stats.ok = true;

  let on = false,
    disposed = false,
    force = true,
    lastEye = new THREE.Vector3(Infinity, Infinity, Infinity);

  const hide = t => {
    if (t.hidden || !t.prop) return;
    t.saved = [];
    t.prop.grp.traverse(o => {
      if (!o.isMesh) return;
      if (o.visible) t.saved.push(o, true);
      o.visible = false;
    });
    t.hidden = true;
    stats.hiddenOriginals++;
  };
  const show = t => {
    if (!t.hidden) return;
    for (let i = 0; i < (t.saved?.length || 0); i += 2) t.saved[i].visible = t.saved[i + 1];
    t.saved = null;
    t.hidden = false;
    stats.hiddenOriginals--;
  };

  const lod = () => {
    const cam = eye || game.camera || null;
    const e = cam?.position || null;
    if (!e) return;
    // Mission scripts can hide a prop while the camera is stationary. Preserve that independent state.
    for(const t of targets){const hidden=!!t.prop?.scriptHidden;if(t.scriptHidden!==hidden){t.scriptHidden=hidden;force=true;}}
    cam.updateMatrixWorld();
    pv.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);
    if (!force && lastPV.equals(pv) && lastEye.distanceToSquared(e) < 64) return;
    farView.setFromProjectionMatrix(pv);
    lastPV.copy(pv);
    force = false;
    lastEye.copy(e);
    let calls = 0,
      verts = 0,
      tris = 0,
      hidden = 0;
    for (const b of batches) {
      const na = b.near.instanceMatrix.array,
        fa = b.far.instanceMatrix.array;
      let ni = 0,
        fi = 0;
      for (const t of b.list) {
        if(t.scriptHidden||t.wetBank)continue;
        const dx = t.x - e.x,
          dy = t.y - e.y,
          dz = t.z + (t.box.max[2] - t.box.min[2]) * 0.5 - e.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Preserve the existing off-camera caster neighbourhood; outside it, a
        // visible tree still gets the inexpensive far silhouette instead of nothing.
        if (d2 > b.cullDist * b.cullDist && !farView.intersectsSphere(t.farBounds)) continue;
        const target = d2 <= b.nearDist * b.nearDist ? na : fa;
        const at = (d2 <= b.nearDist * b.nearDist ? ni++ : fi++) * 16;
        t.matrix.toArray(target, at);
      }
      b.nearCount = ni;
      b.farCount = fi;
      b.near.count = ni;
      b.far.count = fi;
      b.near.visible = on && ni > 0;
      b.far.visible = on && fi > 0;
      b.near.instanceMatrix.clearUpdateRanges?.();
      b.near.instanceMatrix.addUpdateRange(0, ni * 16);
      b.near.instanceMatrix.needsUpdate = true;
      b.far.instanceMatrix.clearUpdateRanges?.();
      b.far.instanceMatrix.addUpdateRange(0, fi * 16);
      b.far.instanceMatrix.needsUpdate = true;
      if (ni) calls++;
      if (fi) calls++;
      verts += ni * b.nearVerts + fi * b.farVerts;
      tris += ni * b.nearTris + fi * b.farTris;
      hidden += b.list.length - ni - fi;
      const row = stats.classes.find(c => c.id === b.id);
      if (row) {
        row.nearInstances = ni;
        row.farInstances = fi;
        row.culledInstances = b.list.length - ni - fi;
      }
    }
    stats.drawCalls = calls;
    stats.vertices = verts;
    stats.triangles = tris;
    stats.culled = hidden;
  };

  const set = next => {
    if (disposed) return false;
    if (!next) {
      if (!on) return false;
      for (const t of targets) show(t);
      for (const b of batches) {
        b.near.visible = false;
        b.far.visible = false;
      }
      group.visible = false;
      on = false;
      stats.on = false;
      return false;
    }
    if (!on) {
      for (const t of targets) hide(t);
      group.visible = true;
      on = true;
      stats.on = true;
      force = true;
    }
    lod();
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    set(false);
    disposed = true;
    game.scene.remove(group);
    for (const b of batches) {
      b.geoNear.dispose();
      b.geoFar.dispose();
      b.near.dispose();
      b.far.dispose();
    }
    for (const m of materials) m.dispose();
    textures.atlas.dispose();
    textures.bark.dispose();
    textures.normal.dispose();
    group.clear();
  };

  stats.lod = Object.fromEntries(batches.map(b => [b.id, { near: b.nearDist, cull: b.cullDist }]));
  group.visible = false;
  return { set, update:()=>{if(on)lod();}, dispose, stats, group, materials, textures, batches };
}
