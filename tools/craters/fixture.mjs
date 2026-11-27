// Faithful node fixture of public/js/game/terrain.js `buildTerrain`:
// non-indexed BufferGeometry, 6 vertices per quad ([a,b,d] then [a,d,c]),
// position (x*CELL, y*CELL, h[i]), normals baked from the height grid exactly as
// the real builder does, per-quad `layers`, per-vertex `corner`/`shade`,
// drawRange limited to emitted vertices, hole cells omitted when ALL four corners
// are bare, and t.paint = {slot, triAt, paintRevision, geo}.
import * as THREE from 'three';
import { CELL } from '../../public/js/game/crater-field.js';

export function makeMap(size = 25, { holes = [], width, height, z = (x, y) => 6 + Math.sin(x * 0.4) * 1.5 + Math.cos(y * 0.3) * 1.1 } = {}) {
  // t.size is max(width,height) for rectangular TEDs, exactly like parseTED.
  const W = width || size,
    H = height || size,
    n = Math.max(W, H);
  const heights = new Float32Array(n * n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * n + x] = z(x, y);

  // Same bake as buildTerrain, including the clamped perimeter.
  const normals = new Float32Array(n * n * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const l = heights[y * n + Math.max(0, x - 1)],
        r = heights[y * n + Math.min(W - 1, x + 1)],
        d = heights[Math.max(0, y - 1) * n + x],
        u = heights[Math.min(H - 1, y + 1) * n + x];
      const nx = (l - r) / (CELL * (x > 0 && x < W - 1 ? 2 : 1)),
        ny = (d - u) / (CELL * (y > 0 && y < H - 1 ? 2 : 1)),
        len = Math.hypot(nx, ny, 1),
        o = (y * n + x) * 3;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = 1 / len;
    }

  const holeSet = new Set(holes),
    shade = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) shade[i] = 0.55 + 0.4 * Math.abs(Math.sin(i * 0.7)); // 0..1 shelter
  const layersOf = (x, y) => [0, 0, 0, 0].map((_, k) => (Math.abs(Math.sin((x + 1) * 1.7 + (y + 1) * 0.9 + k * 3.1)) > 0.86 ? 1 : 0));

  const quads = [];
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const a = y * n + x,
        b = a + 1,
        c = a + n,
        d = c + 1;
      if ([a, b, c, d].every((i) => holeSet.has(i))) continue;
      quads.push({ x, y, a, b, c, d, L: layersOf(x, y) });
    }

  const tris = (W - 1) * (H - 1) * 2,
    pos = new Float32Array(tris * 9),
    nor = new Float32Array(tris * 9),
    lay = new Float32Array(tris * 12),
    cor = new Float32Array(tris * 6),
    sh = new Float32Array(tris * 3),
    triAt = new Int32Array(tris).fill(-1);
  let v = 0;
  const put = (q, ids) => {
    ids.forEach((i) => {
      const x = i % n,
        y = (i / n) | 0,
        o = v * 3;
      pos[o] = x * CELL;
      pos[o + 1] = y * CELL;
      pos[o + 2] = heights[i];
      nor[o] = normals[i * 3];
      nor[o + 1] = normals[i * 3 + 1];
      nor[o + 2] = normals[i * 3 + 2];
      lay.set(q.L, v * 4);
      cor[v * 2] = x - q.x;
      cor[v * 2 + 1] = y - q.y;
      sh[v] = Math.min(1, shade[i] / 1);
      v++;
    });
  };
  for (const q of quads) {
    const at = (q.y * (W - 1) + q.x) * 2;
    triAt[at] = v;
    put(q, [q.a, q.b, q.d]);
    triAt[at + 1] = v;
    put(q, [q.a, q.d, q.c]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setDrawRange(0, v);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('layers', new THREE.BufferAttribute(lay, 4));
  geo.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('shade', new THREE.BufferAttribute(sh, 1));
  geo.computeBoundingSphere();

  const uniform = (value) => ({ value });
  const uniforms = {
    texU: uniform([]),
    texV: uniform([]),
    bump: uniform(null),
    cloudAt: uniform(new THREE.Vector3(0, 0, 500)),
    sunDir: uniform(new THREE.Vector3(0.3, 0.4, 0.86)),
    reliefPatch: uniform(new THREE.Vector4()),
    terrainContactMask: uniform(0),
    // Dynamic getter, exactly like the real material: a naive {...uniforms} copy
    // would freeze it as a number, so the child must preserve descriptors.
    terrainLayers: Object.defineProperty({}, 'value', { get: () => 0.75, enumerable: true, configurable: true })
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader:
      'in vec4 layers; in vec2 corner; in float shade; uniform vec4 reliefPatch; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'out vec4 outColor; void main(){ outColor = vec4(1.0); }',
    uniforms,
    defines: {}
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  const terrain = { size: n, width: W, height: H, heights, layerIndex: new Uint8Array(n * n), layers: [] };
  terrain.paint = { slot: new Map(), triAt, geo, paintRevision: 0 };

  return { terrain, mesh, geo, pos, nor, lay, cor, sh, heights, shade, quads, triAt, W, H, n, material };
}

// The visual/gameplay sampler from terrain.js (kept in sync by hand: 4 heights,
// two triangles [a,b,d] / [a,d,c]).
export function heightAtFixture(t, x, y, renderedTriangles = false) {
  const n = t.size,
    gx = Math.min((t.width ?? n) - 1.001, Math.max(0, x / CELL)),
    gy = Math.min((t.height ?? n) - 1.001, Math.max(0, y / CELL)),
    ix = gx | 0,
    iy = gy | 0,
    fx = gx - ix,
    fy = gy - iy,
    h = t.heights,
    a = h[iy * n + ix],
    b = h[iy * n + ix + 1],
    c = h[(iy + 1) * n + ix],
    d = h[(iy + 1) * n + ix + 1];
  return renderedTriangles
    ? fx >= fy
      ? a + fx * (b - a) + fy * (d - b)
      : a + fy * (c - a) + fx * (d - c)
    : (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Barycentric surface height of the drawn replacement triangles at (x,y). */
export function renderZ(geo, x, y) {
  const idx = geo.index.array,
    P = geo.attributes.position.array,
    dr = geo.drawRange;
  for (let t = dr.start; t < dr.start + dr.count; t += 3) {
    const i0 = idx[t] * 3,
      i1 = idx[t + 1] * 3,
      i2 = idx[t + 2] * 3;
    const x0 = P[i0],
      y0 = P[i0 + 1],
      x1 = P[i1],
      y1 = P[i1 + 1],
      x2 = P[i2],
      y2 = P[i2 + 1];
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(det) < 1e-12) continue; // degenerate (retired) triangle
    const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det,
      l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det,
      l2 = 1 - l0 - l1;
    if (l0 >= -1e-9 && l1 >= -1e-9 && l2 >= -1e-9) return l0 * P[i0 + 2] + l1 * P[i1 + 2] + l2 * P[i2 + 2];
  }
  return null;
}

/** Every drawn triangle of the replacement geometry, as world-space vertices. */
export function triangles(geo) {
  const idx = geo.index.array,
    P = geo.attributes.position.array,
    dr = geo.drawRange,
    out = [];
  for (let t = dr.start; t < dr.start + dr.count; t += 3) {
    const a = idx[t] * 3,
      b = idx[t + 1] * 3,
      c = idx[t + 2] * 3;
    out.push([P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]);
  }
  return out;
}

/** Index entries of the coarse quad block that owns world cell (cx,cy). */
export function coarseQuadIndices(geo, cx, cy, size) {
  const quadsW = size - 1;
  return geo.index ? Array.from(geo.index.array.subarray((cy * quadsW + cx) * 6, (cy * quadsW + cx) * 6 + 6)) : null;
}

export function quadVertexZ(geo, cx, cy, size) {
  const quadsW = size - 1,
    b = (cy * quadsW + cx) * 6,
    P = geo.attributes.position.array;
  return [0, 1, 2, 3, 4, 5].map((k) => P[(b + k) * 3 + 2]);
}
