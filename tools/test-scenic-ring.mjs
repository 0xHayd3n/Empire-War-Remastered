// Offline checks for the exterior scenic ring. Pure Node: no browser, no assets,
// no checkout writes. Run with: node test-scenic-ring.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CELL } from '../public/js/game/terrain-cell.js';
import { buildScenicRing, SCENIC_RING_DEFAULTS } from '../public/js/game/scenic-ring.js';

// ---------------------------------------------------------------- fixtures
function fixture({ width = 20, height = 20, z: hf = () => 0, holes = [] } = {}) {
  const size = Math.max(width, height),
    t = {
      size,
      width,
      height,
      heights: new Float32Array(size * size),
      layerIndex: new Uint8Array(size * size),
      shade: new Uint8Array(size * size).fill(254),
      layers: [{ texture: 'ground.dds' }, { texture: 'pit.dds', hole: true }],
      water: { mode: 0 }
    };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      t.heights[y * size + x] = hf(x, y);
      t.layerIndex[y * size + x] = 0;
    }
  for (const [x, y] of holes) t.layerIndex[y * size + x] = 1;
  return t;
}

// terrain.js heightAt, restricted to the authored cells (padTop is not ring business).
const referenceHeight = (t, x, y) => {
  const n = t.size,
    width = t.width,
    height = t.height,
    gx = Math.min(width - 1.001, Math.max(0, x / CELL)),
    gy = Math.min(height - 1.001, Math.max(0, y / CELL)),
    ix = gx | 0,
    iy = gy | 0,
    fx = gx - ix,
    fy = gy - iy,
    h = t.heights,
    h00 = h[iy * n + ix],
    h10 = h[iy * n + ix + 1],
    h01 = h[(iy + 1) * n + ix],
    h11 = h[(iy + 1) * n + ix + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
};

const near = (a, b, eps, what) => assert(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b} (eps ${eps})`);

// ---------------------------------------------------------------- helpers
function rimOf(t) {
  // Authored rim in the generator's loop order: sides interior-first, then the corner.
  const size = t.size,
    nx = t.width - 1,
    ny = t.height - 1,
    at = (cx, cy) => t.heights[cy * size + cx],
    out = [];
  for (let m = 1; m < nx; m++) out.push([m, 0, at(m, 0)]);
  out.push([nx, 0, at(nx, 0)]);
  for (let m = 1; m < ny; m++) out.push([nx, m, at(nx, m)]);
  out.push([nx, ny, at(nx, ny)]);
  for (let m = 1; m < nx; m++) out.push([nx - m, ny, at(nx - m, ny)]);
  out.push([0, ny, at(0, ny)]);
  for (let m = 1; m < ny; m++) out.push([0, ny - m, at(0, ny - m)]);
  out.push([0, 0, at(0, 0)]);
  return out;
}

function edgeCensus(ring) {
  const { index, triangleCount, vertexCount } = ring,
    counts = new Map(),
    tri = [];
  for (let f = 0; f < triangleCount; f++) {
    const a = index[f * 3],
      b = index[f * 3 + 1],
      c = index[f * 3 + 2];
    assert(a !== b && b !== c && a !== c, `triangle ${f} repeats a vertex`);
    assert(a < vertexCount && b < vertexCount && c < vertexCount, `triangle ${f} index out of range`);
    tri.push([a, b, c]);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a]
    ]) {
      const key = u < v ? u * vertexCount + v : v * vertexCount + u;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let boundary = 0,
    multi = 0;
  for (const [key, uses] of counts) {
    const u = Math.floor(key / vertexCount),
      v = key - u * vertexCount;
    if (uses === 1) {
      boundary++;
      const a = ring.ring[u],
        b = ring.ring[v],
        last = ring.rings.length - 1;
      assert((a === 0 && b === 0) || (a === last && b === last), `loose edge between ring ${a} and ${b}`);
    } else if (uses === 2) multi++;
    else assert.fail(`edge used ${uses} times`);
  }
  return { boundary, interior: multi, edges: counts.size, tri };
}

function minTriangleArea(ring) {
  let min = Infinity;
  for (let f = 0; f < ring.triangleCount; f++) {
    const ia = ring.index[f * 3],
      ib = ring.index[f * 3 + 1],
      ic = ring.index[f * 3 + 2],
      ax = ring.positions[ia * 3],
      ay = ring.positions[ia * 3 + 1],
      bx = ring.positions[ib * 3],
      by = ring.positions[ib * 3 + 1],
      cx = ring.positions[ic * 3],
      cy = ring.positions[ic * 3 + 1],
      area = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    assert(area > 0, `triangle ${f} is degenerate or flipped (${area})`);
    if (area < min) min = area;
  }
  return min;
}

function insideCovered(ring, points) {
  const { positions, index, triangleCount } = ring,
    box = [];
  for (let f = 0; f < triangleCount; f++) {
    const ia = index[f * 3],
      ib = index[f * 3 + 1],
      ic = index[f * 3 + 2];
    box.push({
      f,
      x0: Math.min(positions[ia * 3], positions[ib * 3], positions[ic * 3]),
      x1: Math.max(positions[ia * 3], positions[ib * 3], positions[ic * 3]),
      y0: Math.min(positions[ia * 3 + 1], positions[ib * 3 + 1], positions[ic * 3 + 1]),
      y1: Math.max(positions[ia * 3 + 1], positions[ib * 3 + 1], positions[ic * 3 + 1])
    });
  }
  let hits = 0;
  for (const [px, py] of points) {
    for (const b of box) {
      if (px < b.x0 || px > b.x1 || py < b.y0 || py > b.y1) continue;
      const ia = index[b.f * 3],
        ib = index[b.f * 3 + 1],
        ic = index[b.f * 3 + 2],
        ax = positions[ia * 3],
        ay = positions[ia * 3 + 1],
        bx = positions[ib * 3],
        by = positions[ib * 3 + 1],
        cx = positions[ic * 3],
        cy = positions[ic * 3 + 1],
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy),
        l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d,
        l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d,
        l3 = 1 - l1 - l2;
      if (l1 > 1e-9 && l2 > 1e-9 && l3 > 1e-9) hits++;
    }
  }
  return hits;
}

// Plan-view coverage: every point of the generated annulus must be covered by exactly
// one triangle. Points on a triangle edge are skipped as ambiguous.
function planCoverage(ring, W, H, spacing) {
  const { positions, index, triangleCount } = ring,
    cell = 256,
    buckets = new Map(),
    tri = [];
  for (let f = 0; f < triangleCount; f++) {
    const ia = index[f * 3],
      ib = index[f * 3 + 1],
      ic = index[f * 3 + 2],
      ax = positions[ia * 3],
      ay = positions[ia * 3 + 1],
      bx = positions[ib * 3],
      by = positions[ib * 3 + 1],
      cx = positions[ic * 3],
      cy = positions[ic * 3 + 1],
      t = {
        ax,
        ay,
        bx,
        by,
        cx,
        cy,
        x0: Math.min(ax, bx, cx),
        x1: Math.max(ax, bx, cx),
        y0: Math.min(ay, by, cy),
        y1: Math.max(ay, by, cy)
      };
    tri.push(t);
    for (let gx = Math.floor(t.x0 / cell); gx <= Math.floor(t.x1 / cell); gx++)
      for (let gy = Math.floor(t.y0 / cell); gy <= Math.floor(t.y1 / cell); gy++) {
        const key = gx * 100003 + gy,
          list = buckets.get(key);
        if (list) list.push(f);
        else buckets.set(key, [f]);
      }
  }
  let probes = 0,
    holes = 0,
    overlaps = 0;
  const b = ring.bounds,
    outer = ring.rings[ring.rings.length - 1],
    tol = Math.max(1, (outer.spacing * outer.spacing) / (8 * outer.depth)) + 1;
  for (let x = b.min[0]; x <= b.max[0]; x += spacing)
    for (let y = b.min[1]; y <= b.max[1]; y += spacing) {
      if (x >= 0 && x <= W && y >= 0 && y <= H) continue;
      const d = Math.hypot(x - Math.min(Math.max(x, 0), W), y - Math.min(Math.max(y, 0), H));
      // The horizon loop is a polygon inscribed in the offset contour: skip the sagitta
      // band between its chords and the ideal arc, which is geometry, not a hole.
      if (d > ring.reach - tol) continue;
      const list = buckets.get(Math.floor(x / cell) * 100003 + Math.floor(y / cell));
      if (!list) {
        holes++;
        continue;
      }
      let cover = 0,
        ambiguous = false;
      for (const f of list) {
        const t = tri[f];
        if (x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1) continue;
        const d = (t.by - t.cy) * (t.ax - t.cx) + (t.cx - t.bx) * (t.ay - t.cy),
          l1 = ((t.by - t.cy) * (x - t.cx) + (t.cx - t.bx) * (y - t.cy)) / d,
          l2 = ((t.cy - t.ay) * (x - t.cx) + (t.ax - t.cx) * (y - t.cy)) / d,
          l3 = 1 - l1 - l2;
        if (l1 > -1e-9 && l2 > -1e-9 && l3 > -1e-9) {
          if (Math.min(l1, l2, l3) < 1e-9) ambiguous = true;
          else cover++;
        }
      }
      if (ambiguous) continue;
      probes++;
      if (cover === 0) holes++;
      else if (cover > 1) overlaps++;
    }
  return { probes, holes, overlaps };
}

const report = [];
const note = line => {
  report.push(line);
  console.log('  ' + line);
};

// ---------------------------------------------------------------- CELL
assert.equal(CELL, 20, 'terrain-cell CELL');


// ---------------------------------------------------------------- build basics
console.log('scenic ring');
const base = fixture({ width: 20, height: 20, z: (x, y) => (x * 8 + y * 3 - 40) / 8 }),
  before = { heights: Array.from(base.heights), layerIndex: Array.from(base.layerIndex), shade: Array.from(base.shade) },
  ring = buildScenicRing(base, { maxTriangles: 32000 });
assert.equal(ring.ok, true, JSON.stringify(ring));
assert(ring.positions instanceof Float32Array && (ring.index instanceof Uint16Array || ring.index instanceof Uint32Array));
assert.equal(ring.positions.length, ring.vertexCount * 3);
assert.equal(ring.index.length, ring.triangleCount * 3);
assert.equal(ring.indexCount, ring.triangleCount * 3);
assert.equal(ring.cell, 20);
for (const v of ring.positions) assert(Number.isFinite(v), 'position is finite');
for (const v of ring.normals) assert(Number.isFinite(v) && Math.abs(v) <= 1.0001, 'normal is finite and unit-ish');
assert.deepEqual(
  { heights: Array.from(base.heights), layerIndex: Array.from(base.layerIndex), shade: Array.from(base.shade) },
  before,
  'input TED is untouched'
);

// determinism
const again = buildScenicRing(base, { maxTriangles: 32000 });
assert.equal(again.seed, ring.seed);
assert.deepEqual(Buffer.from(again.positions.buffer), Buffer.from(ring.positions.buffer), 'positions are deterministic');
assert.deepEqual(Buffer.from(again.index.buffer), Buffer.from(ring.index.buffer), 'index is deterministic');
assert.deepEqual(
  Buffer.from(buildScenicRing(base, { maxTriangles: 32000, seed: 99 }).positions.buffer).equals(Buffer.from(ring.positions.buffer)),
  false,
  'a different seed changes the relief'
);
note(`deterministic: ${ring.vertexCount} verts, ${ring.triangleCount} tris, ${ring.rings.length} rings`);

// ---------------------------------------------------------------- rim seam
const rim = rimOf(base),
  W = (base.width - 1) * CELL,
  H = (base.height - 1) * CELL;
assert.equal(ring.rimCount, rim.length, 'rim count is 2*(w+h-2)');
for (let i = 0; i < rim.length; i++) {
  const [cx, cy, z] = rim[i],
    x = ring.positions[i * 3],
    y = ring.positions[i * 3 + 1],
    gz = ring.positions[i * 3 + 2];
  near(x, cx * CELL, 1e-4, `rim vertex ${i} x`);
  near(y, cy * CELL, 1e-4, `rim vertex ${i} y`);
  near(gz, z, 1e-5, `rim vertex ${i} z`);
  assert.equal(ring.ring[i], 0, 'rim vertices belong to ring 0');
  assert.equal(ring.depth[i], 0, 'rim vertices sit at distance 0');
}
// exact corners, once each, and a closed CCW loop
for (const [cx, cy] of [
  [0, 0],
  [base.width - 1, 0],
  [base.width - 1, base.height - 1],
  [0, base.height - 1]
]) {
  const hits = [];
  for (let i = 0; i < ring.rimCount; i++) if (ring.positions[i * 3] === cx * CELL && ring.positions[i * 3 + 1] === cy * CELL) hits.push(i);
  assert.equal(hits.length, 1, `corner ${cx},${cy} appears once`);
}
let area = 0;
for (let i = 0; i < ring.rimCount; i++) {
  const j = (i + 1) % ring.rimCount;
  area += ring.positions[i * 3] * ring.positions[j * 3 + 1] - ring.positions[j * 3] * ring.positions[i * 3 + 1];
}
near(area / 2, W * H, 1e-2, 'rim loop is the authored rectangle, wound CCW');
note(`rim seam: ${ring.rimCount} authored vertices at 20 units, 4 corners once, area ${(area / 2).toFixed(0)} = ${W}x${H}`);

// ---------------------------------------------------------------- watertight
const census = edgeCensus(ring),
  outerCount = ring.rings[ring.rings.length - 1].vertices;
assert.equal(census.boundary, ring.rimCount + outerCount, 'only the seam and the horizon are open');
assert.equal(census.edges, ring.vertexCount + ring.triangleCount, 'annulus Euler: E = V + F');
assert(minTriangleArea(ring) > 1, 'no sliver triangles');
note(`watertight: ${census.boundary} boundary edges (rim ${ring.rimCount} + horizon ${outerCount}), ${census.interior} shared edges`);

// ---------------------------------------------------------------- exterior only
for (let v = 0; v < ring.vertexCount; v++) {
  const x = ring.positions[v * 3],
    y = ring.positions[v * 3 + 1],
    level = ring.ring[v],
    d = Math.hypot(x - Math.min(Math.max(x, 0), W), y - Math.min(Math.max(y, 0), H));
  if (level === 0) near(d, 0, 1e-4, `rim vertex ${v} sits on the map edge`);
  else {
    assert(d > 0, `ring vertex ${v} outside the map`);
    near(d, ring.rings[level].depth, 2e-3, `ring vertex ${v} sits on its own offset`);
    near(ring.depth[v], d, 2e-3, 'depth attribute matches the built position');
  }
}
const interior = [];
for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) interior.push([W * (0.06 + (0.88 * i) / 6), H * (0.06 + (0.88 * j) / 6)]);
assert.equal(insideCovered(ring, interior), 0, 'no generated triangle covers the authored field');
note(`exterior only: ${ring.vertexCount - ring.rimCount} generated vertices outside, 0/49 interior probes covered`);

// ---------------------------------------------------------------- bounds / reach
const last = ring.rings[ring.rings.length - 1].depth;
assert(last >= SCENIC_RING_DEFAULTS.reach, 'default reach is met');
assert(ring.reach >= SCENIC_RING_DEFAULTS.reach, 'reported reach is met');
near(ring.bounds.min[0], -last, 2e-3, 'min x reaches the last offset');
near(ring.bounds.min[1], -last, 2e-3, 'min y reaches the last offset');
near(ring.bounds.max[0], W + last, 2e-3, 'max x reaches the last offset');
near(ring.bounds.max[1], H + last, 2e-3, 'max y reaches the last offset');
assert(ring.bounds.min[2] < ring.bounds.max[2], 'ring has relief');
note(
  `bounds x[${ring.bounds.min[0].toFixed(0)},${ring.bounds.max[0].toFixed(0)}] y[${ring.bounds.min[1].toFixed(0)},${ring.bounds.max[1].toFixed(0)}] z[${ring.bounds.min[2].toFixed(0)},${ring.bounds.max[2].toFixed(0)}]`
);

// ---------------------------------------------------------------- coarsening + budget
const sizes = [
  [2, 2],
  [3, 5],
  [7, 5],
  [20, 20],
  [33, 17],
  [48, 48],
  [96, 64]
];
const reportLines = [];
for (const [width, height] of sizes) {
  const t = fixture({ width, height, z: (x, y) => ((x * 13 + y * 7) % 29) - 9 }),
    r = buildScenicRing(t);
  assert.equal(r.ok, true, `${width}x${height} builds`);
  assert(r.triangleCount <= r.maxTriangles, `${width}x${height} stays inside ${r.maxTriangles} triangles`);
  assert(r.triangleCount <= SCENIC_RING_DEFAULTS.maxTriangles);
  assert(r.reach >= SCENIC_RING_DEFAULTS.reach);
  assert.equal(
    r.vertexCount,
    r.rings.reduce((s, x) => s + x.vertices, 0),
    'vertex accounting'
  );
  const expected = r.rings.reduce((s, x, i) => (i ? s + r.rings[i - 1].vertices + x.vertices : s), 0);
  assert.equal(r.triangleCount, expected, `${width}x${height} triangle accounting`);
  for (let i = 1; i < r.rings.length; i++) assert(r.rings[i].spacing >= r.rings[i - 1].spacing, 'spacing coarsens outward');
  assert(r.rings[r.rings.length - 1].spacing > r.rings[0].spacing, 'horizon is coarser than the rim');
  const c = edgeCensus(r);
  assert.equal(c.boundary, r.rimCount + r.rings[r.rings.length - 1].vertices, `${width}x${height} watertight`);
  assert(minTriangleArea(r) > 0.5, `${width}x${height} no slivers`);
  reportLines.push(`${width}x${height}: rim ${r.rimCount}, rings ${r.rings.length}, verts ${r.vertexCount}, tris ${r.triangleCount}`);
}
note('budget matrix (remesh stays inside ' + SCENIC_RING_DEFAULTS.maxTriangles + '):');
for (const line of reportLines) console.log('    ' + line);

// a tight budget must coarsen rather than overshoot
const tight = buildScenicRing(base, { maxTriangles: 900 });
assert.equal(tight.ok, true);
assert(tight.triangleCount <= 900, `${tight.triangleCount} <= 900`);
assert(tight.reach >= SCENIC_RING_DEFAULTS.reach, 'coarsening keeps the horizon');
assert.equal(edgeCensus(tight).boundary, tight.rimCount + tight.rings[tight.rings.length - 1].vertices, 'tight ring is watertight');
const impossible = buildScenicRing(base, { maxTriangles: 40 });
assert.equal(impossible.ok, false);
assert.equal(impossible.reason, 'budget');
note(`budget: 900 -> ${tight.triangleCount} tris in ${tight.rings.length} rings; 40 -> refused (${impossible.message})`);

// ---------------------------------------------------------------- refusals
const holed = fixture({ width: 12, height: 12, holes: [[0, 5]] }),
  holedRing = buildScenicRing(holed);
assert.equal(holedRing.ok, false);
assert.equal(holedRing.reason, 'hole-rim');
assert(Array.isArray(holedRing.cells) && holedRing.cells.includes(5 * 12));
const innerHole = fixture({ width: 12, height: 12, holes: [[5, 5]] });
assert.equal(buildScenicRing(innerHole).ok, true, 'an interior hole is not a rim hole');
assert.equal(buildScenicRing({}).ok, false);
assert.equal(buildScenicRing(fixture({ width: 2, height: 2 })).ok, true, 'a 2x2 map still builds');
note('refusals: hole rim refused, interior hole allowed, missing grid refused');

// ---------------------------------------------------------------- no holes in the new ring
for (const [width, height] of [
  [20, 20],
  [33, 17]
]) {
  const t = fixture({ width, height, z: (x, y) => ((x * 5 + y * 11) % 17) - 8 }),
    r = buildScenicRing(t),
    cov = planCoverage(r, (width - 1) * CELL, (height - 1) * CELL, 90);
  assert.equal(cov.holes, 0, `${width}x${height}: ${cov.holes}/${cov.probes} annulus probes uncovered`);
  assert.equal(cov.overlaps, 0, `${width}x${height}: ${cov.overlaps}/${cov.probes} annulus probes double-covered`);
  report.push(`${width}x${height} plan view: ${cov.probes} probes, 0 holes, 0 overlaps`);
  note(`${width}x${height}: plan view ${cov.probes} probes, 0 holes, 0 overlaps`);
}
for (let v = 0; v < ring.vertexCount; v++) assert(ring.normals[v * 3 + 2] > 0, `vertex ${v} normal faces up`);

// ---------------------------------------------------------------- relief modes
const flat = buildScenicRing(base, { relief: 'flat' }),
  low = buildScenicRing(base, { relief: 'low' }),
  hills = buildScenicRing(base, { relief: 'foothills' });
const spread = r => {
  let lo = Infinity,
    hi = -Infinity;
  for (let v = 0; v < r.vertexCount; v++) {
    const d = Math.abs(r.positions[v * 3 + 2] - r.rimHeight[v]);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return hi;
};
for (let v = 0; v < flat.vertexCount; v++) {
  near(flat.positions[v * 3 + 2], flat.rimHeight[v], 0, 'flat relief follows the authored rim exactly');
  assert.equal(flat.positions[v * 3 + 2], flat.rimHeight[v]);
}
assert.equal(flat.relief, 'flat');
assert(spread(hills) > 40, `foothills rise (${spread(hills).toFixed(1)})`);
assert(spread(low) > 5 && spread(low) < spread(hills) / 2, `low relief is lower (${spread(low).toFixed(1)})`);
note(`relief offsets: flat 0, low ${spread(low).toFixed(1)}, foothills ${spread(hills).toFixed(1)}`);

// near the seam the ring must not jump off the authored edge
let seamGap = 0;
for (let i = 0; i < hills.vertexCount; i++)
  if (hills.ring[i] === 1) seamGap = Math.max(seamGap, Math.abs(hills.positions[i * 3 + 2] - hills.rimHeight[i]));
assert(seamGap < hills.amplitude * 0.1, `first ring stays close to the authored edge (${seamGap.toFixed(2)})`);

// undulating, not one smooth wall: every outward ray must both rise and fall
const centre = [W / 2, H / 2];
let wobbly = 0;
const rays = 12;
for (let i = 0; i < rays; i++) {
  const angle = (i / rays) * Math.PI * 2,
    profile = [];
  for (let d = 0; d <= hills.reach; d += 40) {
    const x = centre[0] + Math.cos(angle) * (Math.max(W, H) / 2 + d),
      y = centre[1] + Math.sin(angle) * (Math.max(W, H) / 2 + d),
      s = hills.sample(x, y);
    profile.push(s.height);
  }
  let drops = 0;
  for (let k = 1; k < profile.length - 1; k++) if (profile[k] < profile[k - 1] - 0.5) drops++;
  if (drops > 0) wobbly++;
}
assert(wobbly >= rays / 2, `foothills undulate and saddle (${wobbly}/${rays} rays fall back)`);
note(`shape: ${wobbly}/${rays} outward rays rise then fall; not a rectangular wall`);

// ---------------------------------------------------------------- sampling API
let sampled = 0;
for (let v = 0; v < hills.vertexCount; v += 7) {
  const x = hills.positions[v * 3],
    y = hills.positions[v * 3 + 1],
    s = hills.sample(x, y);
  near(s.height, hills.positions[v * 3 + 2], 0.05, `sample at vertex ${v}`);
  near(s.distance, hills.depth[v], 1e-3, `sample distance at vertex ${v}`);
  assert.equal(s.edgeId, hills.edgeId[v], `sample edge id at vertex ${v}`);
  assert(s.edgeId >= 0 && s.edgeId < hills.rimCount);
  assert.equal(s.inside, hills.ring[v] === 0);
  sampled++;
}
for (let i = 0; i < 9; i++)
  for (let j = 0; j < 9; j++) {
    const x = (W * (i + 0.5)) / 9,
      y = (H * (j + 0.5)) / 9,
      s = hills.sample(x, y);
    assert.equal(s.inside, true);
    near(s.height, referenceHeight(base, x, y), 1e-3, 'interior sample matches terrain.js heightAt');
  }
const far = hills.sample(W + hills.reach + 500, H + hills.reach + 500);
assert.equal(far.inside, false);
assert(Number.isFinite(far.height));
assert(far.ring >= 0);
note(`sampling: ${sampled} mesh anchors agree, interior matches heightAt, far point ${far.height.toFixed(1)}`);

// ---------------------------------------------------------------- purity
const source = readFileSync(new URL('../public/js/game/scenic-ring.js', import.meta.url), 'utf8');
const imports = source.match(/^import .*$/gm) || [];
assert.deepEqual(imports, ["import { CELL } from './terrain-cell.js';"], 'only the cell constant is imported');
for (const banned of ['Math.random', 'new Date', 'performance.', 'document.', 'window.', 'globalThis', 'fetch(', 'structuredClone'])
  assert(!source.includes(banned), `no ${banned} in the generator`);
note('purity: no three import, no clock, no randomness, no globals, no input writes');

console.log(`\n${report.length} groups checked; scenic ring geometry passed`);
