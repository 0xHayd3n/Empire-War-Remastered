// Exterior scenic ring: a renderer-only terrain annulus that continues a rectangular
// TED past its authored rim. Pure geometry, no Three.js, no textures, no map data
// beyond the TED grid it is handed, and no writes back into that grid.
//
// Shape: the inner loop is the authored 20-unit rim, vertex for vertex and height for
// height, so the ring shares the map's exact edge rather than approximating it or
// overlapping it. Four rectangular sides and four quarter-circle corner arcs carry it
// outward; each further ring is coarser, so the horizon costs a bounded triangle
// budget. Heights ease from the authored rim into layered foothills with saddles.
import { CELL } from './terrain-cell.js';

export const SCENIC_RING_DEFAULTS = Object.freeze({
  reach: 5200, // minimum outward distance from the authored rim, in world units
  maxTriangles: 32000, // hard triangle budget for this ring
  relief: 'foothills', // 'foothills' | 'low' | 'flat'
  amplitude: 0, // overrides the relief preset, in world units
  ease: 240, // distance over which the rim eases into generated relief
  backSlope: 0, // optional fall behind a reviewed skyline, in multiples of amplitude
  grow: 2600, // distance at which relief reaches full amplitude
  lift: 1.6, // extra far-rim rise, as a multiple of amplitude
  seed: 0, // 0 folds in a fingerprint of the authored rim heights
  spacingScale: 1, // >=1 coarsens every ring; coarsened further to fit the budget
  maxSpacing: 2048 // upper bound on one ring segment, in world units
});

const RELIEF_AMPLITUDE = Object.freeze({ foothills: 90, benches: 100, low: 24, flat: 0 }),
  HARD_TRIANGLES = 1 << 21,
  MAX_RINGS = 96,
  GROWTH = 1.6;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (lo, hi, v) => {
  const t = clamp((v - lo) / (hi - lo || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const refuse = (reason, message, extra) => ({ ok: false, reason, message, ...extra });

function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    v = fy * fy * fy * (fy * (fy * 6 - 15) + 10),
    a = hash2(ix, iy, seed),
    b = hash2(ix + 1, iy, seed),
    c = hash2(ix, iy + 1, seed),
    d = hash2(ix + 1, iy + 1, seed),
    lo = a + (b - a) * u,
    hi = c + (d - c) * u;
  return lo + (hi - lo) * v;
}

function fbm(x, y, octaves, seed) {
  let sum = 0,
    amp = 1,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 17.13;
    y = y * 2.03 - 9.71;
  }
  return sum / norm;
}

// Crest lines instead of rolling hills: 1-|noise| squared, weighted so later octaves
// only sharpen ground the previous ones already raised.
function ridged(x, y, octaves, seed) {
  let sum = 0,
    amp = 1,
    norm = 0,
    weight = 1;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x, y, seed + o * 787),
      crest = 1 - Math.abs(2 * n - 1),
      c = crest * crest;
    sum += amp * c * weight;
    weight = clamp(c * 1.7, 0.25, 1);
    norm += amp;
    amp *= 0.5;
    x = x * 2.07 - 5.31;
    y = y * 2.07 + 12.77;
  }
  return sum / norm;
}

// One ring in world units beyond the authored rim. Returned height is an offset from
// the eased rim height, so a flat or low ring stays flush with the map it extends.
function reliefAt(settings, x, y, d) {
  const { amplitude, seed, ease, grow, lift, backSlope, reach } = settings;
  if (!amplitude || d <= 0) return 0;
  const enter = smoothstep(0, ease, d);
  if (enter <= 0) return 0;
  const swell = (fbm(x * 0.00085, y * 0.00085, 3, seed) - 0.5) * 2,
    roll = (fbm(x * 0.0027, y * 0.0027, 3, seed + 811) - 0.5) * 2,
    crest = (ridged(x * 0.0016, y * 0.0016, 3, seed + 1601) - 0.45) * 2,
    // A slow pass mask closes crest lines into saddles instead of one continuous wall.
    pass = smoothstep(0.4, 0.7, fbm(x * 0.00058, y * 0.00058, 2, seed + 2407)),
    growBy = 0.55 + 0.45 * Math.min(1, d / grow),
    // The far rim rises to hide the ring's own edge, but through the same pass mask, so
    // the skyline has saddles instead of one continuous crest.
    rise = lift * smoothstep(reach * 0.3, reach, d) * (0.3 + 0.7 * pass);
  // Eroded tableland: broad tops broken by lower passes and a second, less
  // frequent resistant bed. No fabricated hive spires outside the authored board.
  const profile=settings.benches ? .10*swell+.10*roll+.47*smoothstep(-.12,.16,swell+.17*roll)+.24*smoothstep(.22,.38,swell+.24*crest)-.19 : swell*.52+roll*.2+crest*pass*.55;
  return amplitude * (enter * growBy * profile + rise - backSlope * smoothstep(reach * .55, reach * .92, d));
}

function countLoop(d, spacing, W, H) {
  let count = 0;
  for (const len of [W, H, W, H]) count += Math.max(1, Math.round(len / spacing));
  const arc = (Math.PI * d) / 2;
  return count + 4 * Math.max(2, 2 * Math.round(arc / (2 * spacing)));
}

// Ring offsets double their gap every two rings: fine at the rim, cheap at the horizon.
function planRings(rimCount, W, H, reach, gap0, maxSpacing, maxGap) {
  const rings = [];
  let d = 0,
    gap = gap0;
  for (let k = 0; d < reach && rings.length < MAX_RINGS; k++) {
    d += gap;
    const spacing = Math.min(gap, maxSpacing);
    rings.push({ depth: d, gap, spacing, count: countLoop(d, spacing, W, H) });
    if (k % 2 === 1) gap = Math.min(gap * 2, maxGap);
  }
  let triangles = rimCount + rings[0].count;
  for (let k = 1; k < rings.length; k++) triangles += rings[k - 1].count + rings[k].count;
  return { rings, triangles };
}

/**
 * Build the exterior annulus around the authored TED.
 *
 * @param {object} t Parsed TED (`size`, `width`, `height`, `heights`, `layerIndex`, `layers`).
 * @param {object} [policy] See SCENIC_RING_DEFAULTS.
 * @returns {{ok:true,positions:Float32Array,index:Uint16Array|Uint32Array,...
 *   |ok:false,reason:string,message:string}}
 */
export function buildScenicRing(t, policy) {
  const p = { ...SCENIC_RING_DEFAULTS, ...(policy || {}) },
    n = Math.trunc(t?.size ?? 0),
    width = Math.trunc(t?.width ?? n),
    height = Math.trunc(t?.height ?? n);
  if (!t?.heights || !n || width < 2 || height < 2) return refuse('invalid-terrain', 'needs a parsed TED grid of at least 2x2 cells');
  const stride = Math.max(n, width, height);
  if (t.heights.length < stride * stride) return refuse('invalid-terrain', 'height grid is smaller than its stride');

  // Exterior-only: a hole layer on the authored rim marks an opening this ring cannot
  // seal. Refuse rather than fill it.
  const bare = (x, y) => !!t.layers?.[t.layerIndex?.[y * stride + x]]?.hole,
    holes = [];
  for (let x = 0; x < width; x++) {
    if (bare(x, 0)) holes.push(x);
    if (bare(x, height - 1)) holes.push((height - 1) * stride + x);
  }
  for (let y = 1; y < height - 1; y++) {
    if (bare(0, y)) holes.push(y * stride);
    if (bare(width - 1, y)) holes.push(y * stride + width - 1);
  }
  if (holes.length)
    return refuse('hole-rim', 'authored rim has hole cells; an exterior ring would fill them', { cells: holes.slice(0, 64) });

  const W = (width - 1) * CELL,
    H = (height - 1) * CELL,
    nx = width - 1,
    ny = height - 1,
    rimCount = 2 * (nx + ny);
  const heightAtCell = (cx, cy) => t.heights[cy * stride + cx];

  // Authored rim in walk order from the (0,0) corner: the seam the ring must match.
  const rimAt = s => {
    if (s <= W) return [s, 0, s / CELL, 0];
    if (s <= W + H) return [W, s - W, nx, (s - W) / CELL];
    if (s <= 2 * W + H) return [W - (s - W - H), H, nx - (s - W - H) / CELL, ny];
    return [0, H - (s - 2 * W - H), 0, ny - (s - 2 * W - H) / CELL];
  };
  const rimZ = new Float64Array(rimCount);
  for (let i = 0; i < rimCount; i++) {
    const at = rimAt(i * CELL);
    rimZ[i] = heightAtCell(Math.round(at[2]), Math.round(at[3]));
  }

  // A map-specific but deterministic seed, so two maps do not share one skyline.
  let finger = 2166136261 >>> 0;
  for (let i = 0; i < rimCount; i++) finger = Math.imul(finger ^ (Math.round(rimZ[i] * 8) | 0), 16777619);
  finger = (finger ^ Math.imul(width, 73856093) ^ Math.imul(height, 19349663)) | 0;
  const seed = (Math.trunc(p.seed) | 0) ^ finger;

  const preset = RELIEF_AMPLITUDE[p.relief] ?? RELIEF_AMPLITUDE.foothills,
    amplitude = p.amplitude > 0 ? Number(p.amplitude) : preset,
    reach = Math.max(CELL * 2, Number(p.reach) || 0),
    budget = Math.max(0, Math.min(HARD_TRIANGLES, Math.trunc(p.maxTriangles))),
    maxSpacing = Math.max(CELL, Number(p.maxSpacing) || 0),
    baseScale = Math.max(1, Number.isFinite(+p.spacingScale) ? +p.spacingScale : 1),
    settings = {
      benches:p.relief==='benches',
      amplitude,
      seed,
      ease: Math.max(0, Number(p.ease) || 0),
      grow: Math.max(1, Number(p.grow) || 0),
      lift: Math.max(0, Number(p.lift) || 0),
      backSlope: Math.max(0, Number(p.backSlope) || 0),
      reach
    };

  // Authored 20-unit rim loop. Corners carry u=1/8,3/8,5/8,7/8 (the corner-arc slots),
  // so every outward ring fans its arc from exactly that authored corner.
  const rimLoop = () => {
    const X = new Float64Array(rimCount),
      Y = new Float64Array(rimCount),
      U = new Float64Array(rimCount),
      Z = new Float64Array(rimCount),
      rimZOf = (cx, cy) => heightAtCell(cx, cy);
    let v = 0;
    const push = (x, y, u, z) => {
      X[v] = x;
      Y[v] = y;
      U[v] = u;
      Z[v] = z;
      v++;
    };
    for (let m = 1; m < nx; m++) push(m * CELL, 0, m / nx / 8, rimZOf(m, 0));
    push(W, 0, 1 / 8, rimZOf(nx, 0));
    for (let m = 1; m < ny; m++) push(W, m * CELL, (2 + m / ny) / 8, rimZOf(nx, m));
    push(W, H, 3 / 8, rimZOf(nx, ny));
    for (let m = 1; m < nx; m++) push(W - m * CELL, H, (4 + m / nx) / 8, rimZOf(nx - m, ny));
    push(0, H, 5 / 8, rimZOf(0, ny));
    for (let m = 1; m < ny; m++) push(0, H - m * CELL, (6 + m / ny) / 8, rimZOf(0, ny - m));
    push(0, 0, 7 / 8, rimZOf(0, 0));
    return { X, Y, U, Z, n: rimCount };
  };

  // One outward ring: four rigid sides plus four quarter arcs of radius d. Feature i of
  // eight owns u=(i..i+1)/8, which aligns rings corner to corner and side to side.
  const offsetLoop = (d, spacing) => {
    const starts = [
        [0, -d],
        [W + d, 0],
        [W, H + d],
        [-d, H]
      ],
      dirs = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1]
      ],
      lens = [W, H, W, H],
      corners = [
        [W, 0],
        [W, H],
        [0, H],
        [0, 0]
      ],
      angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI],
      sides = lens.map(len => Math.max(1, Math.round(len / spacing))),
      arcLen = (Math.PI * d) / 2,
      arcs = corners.map(() => Math.max(2, 2 * Math.round(arcLen / (2 * spacing))));
    const count = sides.reduce((a, b) => a + b, 0) + arcs.reduce((a, b) => a + b, 0),
      X = new Float64Array(count),
      Y = new Float64Array(count),
      U = new Float64Array(count);
    let v = 0;
    const push = (x, y, u) => {
      X[v] = x;
      Y[v] = y;
      U[v] = u;
      v++;
    };
    for (let f = 0; f < 4; f++) {
      const [sx, sy] = starts[f],
        [dx, dy] = dirs[f],
        len = lens[f],
        segments = sides[f];
      for (let m = 0; m < segments; m++) {
        const t = m / segments;
        push(sx + dx * len * t, sy + dy * len * t, (2 * f + t) / 8);
      }
      const [cx, cy] = corners[f],
        start = angles[f],
        steps = arcs[f];
      for (let m = 0; m < steps; m++) {
        const t = m / steps,
          angle = start + (t * Math.PI) / 2;
        push(cx + Math.cos(angle) * d, cy + Math.sin(angle) * d, (2 * f + 1 + t) / 8);
      }
    }
    return { X, Y, U, n: count, depth: d };
  };

  let plan = null,
    level = 0,
    scale = baseScale;
  for (level = 0; level < 12; level++) {
    plan = planRings(rimCount, W, H, reach, CELL * scale * GROWTH ** level, maxSpacing, Math.max(2*CELL,Number(p.maxGap)||Infinity));
    if (plan.triangles <= budget) break;
  }
  if (!plan || !plan.rings.length || plan.triangles > budget)
    return refuse('budget', `an exact ${CELL}-unit rim seam plus its first strip needs ${rimCount * 2} triangles`, {
      needed: rimCount * 2,
      maxTriangles: budget
    });

  const loops = [rimLoop()];
  for (const ring of plan.rings) loops.push(offsetLoop(ring.depth, ring.spacing));

  const vertexCount = loops.reduce((sum, loop) => sum + loop.n, 0),
    triangleCount = plan.triangles,
    positions = new Float32Array(vertexCount * 3),
    normals = new Float32Array(vertexCount * 3),
    ringId = new Uint16Array(vertexCount),
    depth = new Float32Array(vertexCount),
    edgeId = new Uint32Array(vertexCount),
    rimHeight = new Float32Array(vertexCount),
    index = vertexCount > 65535 ? new Uint32Array(triangleCount * 3) : new Uint16Array(triangleCount * 3);

  // Rim base height and nearest authored boundary id for any outside point.
  const probe = (x, y) => {
    const qx = clamp(x, 0, W),
      qy = clamp(y, 0, H),
      dx = x - qx,
      dy = y - qy,
      dist = Math.hypot(dx, dy),
      s = qy <= 0 ? qx : qx >= W ? W + qy : qy >= H ? W + H + (W - qx) : 2 * W + H + (H - qy),
      k = s / CELL,
      i = Math.floor(k) % rimCount,
      f = k - Math.floor(k);
    return {
      dist,
      base: rimZ[i] * (1 - f) + rimZ[(i + 1) % rimCount] * f,
      edge: Math.round(k) % rimCount
    };
  };

  let offset = 0;
  const firstVertex = [];
  loops.forEach((loop, level) => {
    const base = offset;
    firstVertex.push(base);
    const outside = level > 0;
    for (let i = 0; i < loop.n; i++) {
      const x = loop.X[i],
        y = loop.Y[i],
        seat = outside ? probe(x, y) : null,
        z = outside ? seat.base + reliefAt(settings, x, y, seat.dist) : loop.Z[i],
        o = (base + i) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      rimHeight[base + i] = outside ? seat.base : z;
      depth[base + i] = outside ? seat.dist : 0;
      edgeId[base + i] = outside ? seat.edge : probe(x, y).edge;
      ringId[base + i] = level;
    }
    offset += loop.n;
  });

  // Two loops of differing resolution are stitched by advancing whichever one is behind
  // in its own feature parameter, one triangle per step: no holes, no T-junctions, and
  // every ring vertex is used exactly once by each neighbouring strip.
  let write = 0;
  const emit = (a, b, c) => {
    index[write++] = a;
    index[write++] = b;
    index[write++] = c;
  };
  for (let level = 1; level < loops.length; level++) {
    const a = loops[level - 1],
      b = loops[level],
      abase = firstVertex[level - 1],
      bbase = firstVertex[level];
    let i = 0,
      j = 0;
    while (i < a.n || j < b.n) {
      const na = i < a.n ? (i + 1 < a.n ? a.U[i + 1] : Infinity) : Infinity,
        nb = j < b.n ? (j + 1 < b.n ? b.U[j + 1] : Infinity) : Infinity;
      if (i >= a.n || (j < b.n && nb < na)) {
        emit(abase + (i % a.n), bbase + (j % b.n), bbase + ((j + 1) % b.n));
        j++;
      } else {
        emit(abase + (i % a.n), bbase + (j % b.n), abase + ((i + 1) % a.n));
        i++;
      }
    }
  }

  // Vertex normals from the built triangles, in +Z-bearing winding order.
  for (let f = 0; f < triangleCount; f++) {
    const ia = index[f * 3],
      ib = index[f * 3 + 1],
      ic = index[f * 3 + 2],
      ax = positions[ia * 3],
      ay = positions[ia * 3 + 1],
      az = positions[ia * 3 + 2],
      bx = positions[ib * 3],
      by = positions[ib * 3 + 1],
      bz = positions[ib * 3 + 2],
      cx = positions[ic * 3],
      cy = positions[ic * 3 + 1],
      cz = positions[ic * 3 + 2],
      ux = bx - ax,
      uy = by - ay,
      uz = bz - az,
      vx = cx - ax,
      vy = cy - ay,
      vz = cz - az,
      nxv = uy * vz - uz * vy,
      nyv = uz * vx - ux * vz,
      nzv = ux * vy - uy * vx;
    for (const v of [ia, ib, ic]) {
      normals[v * 3] += nxv;
      normals[v * 3 + 1] += nyv;
      normals[v * 3 + 2] += nzv;
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const o = v * 3,
      len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]);
    if (len > 1e-9) {
      normals[o] /= len;
      normals[o + 1] /= len;
      normals[o + 2] /= len;
    } else {
      normals[o] = 0;
      normals[o + 1] = 0;
      normals[o + 2] = 1;
    }
  }

  // Authored interior height, matching terrain.js heightAt over the authored cells.
  const authoredHeight = (x, y) => {
    const gx = Math.min(width - 1.001, Math.max(0, x / CELL)),
      gy = Math.min(height - 1.001, Math.max(0, y / CELL)),
      ix = gx | 0,
      iy = gy | 0,
      fx = gx - ix,
      fy = gy - iy;
    return (
      (heightAtCell(ix, iy) * (1 - fx) + heightAtCell(ix + 1, iy) * fx) * (1 - fy) +
      (heightAtCell(ix, iy + 1) * (1 - fx) + heightAtCell(ix + 1, iy + 1) * fx) * fy
    );
  };

  // rings[0] is the authored seam; ring ids in the vertex attributes index this list.
  const rings = [
    { depth: 0, spacing: CELL, vertices: rimCount, firstVertex: firstVertex[0], rim: true },
    ...plan.rings.map((ring, i) => ({
      depth: ring.depth,
      spacing: ring.spacing,
      vertices: loops[i + 1].n,
      firstVertex: firstVertex[i + 1]
    }))
  ];
  const nearestRing = d => {
    let best = 0,
      gap = Infinity;
    for (let i = 0; i < rings.length; i++) {
      const g = Math.abs(rings[i].depth - d);
      if (g < gap) {
        gap = g;
        best = i;
      }
    }
    return best;
  };
  const sample = (x, y) => {
    const seat = probe(x, y),
      inside = seat.dist === 0;
    return {
      x,
      y,
      inside,
      height: inside ? authoredHeight(x, y) : seat.base + reliefAt(settings, x, y, seat.dist),
      distance: seat.dist,
      edgeId: seat.edge,
      ring: inside ? -1 : nearestRing(seat.dist)
    };
  };

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3],
      y = positions[v * 3 + 1],
      z = positions[v * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    ok: true,
    positions,
    index,
    normals,
    ring: ringId,
    depth,
    edgeId,
    rimHeight,
    vertexCount,
    triangleCount,
    indexCount: triangleCount * 3,
    rimCount,
    cell: CELL,
    extent: { width: W, height: H },
    reach: rings[rings.length - 1].depth,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    rings,
    relief: p.amplitude > 0 ? 'custom' : p.relief in RELIEF_AMPLITUDE ? p.relief : 'foothills',
    amplitude,
    seed,
    maxTriangles: budget,
    coarsening: level,
    firstGap: CELL * scale * GROWTH ** level,
    sample
  };
}
