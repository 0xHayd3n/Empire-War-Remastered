// Offline checks for patch-metrics.mjs. No repo, checkout, mount or browser needed:
// every grid here is synthetic, so these tests prove the metric's contracts (units,
// mask exclusions, determinism) and NOT that any map looks right. Numbers never
// approve art; they only feed the lead's visual review.
import assert from 'node:assert/strict';
import { patchMetrics } from './patch-metrics.mjs';

const grid = (w, h, at) => {
  const out = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = at(x, y);
  return out;
};
const all = (w, h, id) => new Array(w * h).fill(id);
const filled = (n, id) => new Array(n).fill(id);
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const edges4 = (w, h) => (w - 1) * h + w * (h - 1);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- Single-color degeneracy ------------------------------------------------
test('single material: no boundaries, one patch, all share', () => {
  const m = patchMetrics(all(8, 6, 'grass'), 8, 6);
  assert.equal(m.included, 48);
  assert.equal(m.excluded, 0);
  assert.deepEqual(m.adjacency, { edges: edges4(8, 6), boundaries: 0, fraction: 0 });
  assert.equal(m.patches.count, 1);
  assert.equal(m.patches.smallCount, 0);
  assert.equal(m.patches.smallVertices, 0);
  assert.equal(m.patches.smallVertexFraction, 0);
  assert.equal(m.patches.dominantShare, 1);
  assert.equal(m.materials.distinct, 1);
  assert.deepEqual(m.materials.dominant, { id: 'grass', vertices: 48, share: 1 });
  assert.deepEqual(m.materials.histogram, [
    { id: 'grass', vertices: 48, share: 1, patches: 1, smallPatches: 0, smallVertexFraction: 0 },
  ]);
  assert.equal(m.color, null);
});

test('1x1 grid has no edges: fraction is null, not 0', () => {
  const m = patchMetrics(['solo'], 1, 1, { palette: new Map([['solo', [0.5, 0.5, 0.5]]]) });
  assert.equal(m.included, 1);
  assert.deepEqual(m.adjacency, { edges: 0, boundaries: 0, fraction: null });
  assert.equal(m.patches.dominantShare, 1);
  assert.deepEqual(m.color, {
    seamEdges: 0,
    coloredEdges: 0,
    missingPaletteEdges: 0,
    meanContrast: null,
    meanContrastNormalized: null,
    minContrast: 0,
    maxContrast: Math.sqrt(3),
  });
});

// --- Checker vs coherent route ---------------------------------------------
test('vertical two-family route: one straight seam of grid height', () => {
  const w = 32,
    h = 32,
    m = patchMetrics(grid(w, h, x => (x < w / 2 ? 'A' : 'B')), w, h);
  assert.equal(m.adjacency.edges, edges4(w, h));
  assert.equal(m.adjacency.boundaries, h);
  close(m.adjacency.fraction, h / edges4(w, h));
  assert.equal(m.patches.count, 2);
  assert.equal(m.patches.smallCount, 0, 'both halves are 512-vertex patches');
  assert.equal(m.patches.dominantShare, 0.5);
  assert.equal(m.materials.dominant.share, 0.5);
  assert.deepEqual(
    m.materials.histogram.map(r => [r.id, r.patches]),
    [
      ['A', 1],
      ['B', 1],
    ],
  );
});

test('checkerboard saturates adjacency and small-patch metrics', () => {
  const w = 16,
    h = 16,
    m = patchMetrics(grid(w, h, (x, y) => ((x + y) % 2 ? 'sand' : 'rock')), w, h);
  assert.equal(m.adjacency.fraction, 1, 'every eligible edge changes material');
  assert.equal(m.patches.count, w * h);
  assert.equal(m.patches.dominantShare, 1 / (w * h));
  assert.equal(m.patches.smallCount, w * h);
  assert.equal(m.patches.smallVertices, w * h);
  assert.equal(m.patches.smallVertexFraction, 1);
  assert.equal(m.materials.distinct, 2);
  assert.equal(m.materials.dominant.share, 0.5, 'family share is even even when every patch is tiny');
});

test('checker and coherent grids separate on one comparable metric', () => {
  const w = 24,
    h = 24,
    checker = patchMetrics(grid(w, h, (x, y) => ((x + y) % 2 ? 'a' : 'b')), w, h),
    route = patchMetrics(grid(w, h, (x, y) => (y < h / 2 ? 'a' : 'b')), w, h);
  assert.ok(checker.adjacency.fraction > 0.99 && route.adjacency.fraction < 0.03);
  assert.ok(checker.patches.smallVertexFraction > 0.99 && route.patches.smallVertexFraction === 0);
  assert.ok(checker.materials.histogram.every(r => r.smallPatches === r.patches));
});

test('stripe pattern keeps seams but no small patches', () => {
  const w = 12,
    h = 12,
    m = patchMetrics(grid(w, h, (x, y) => (y % 2 ? 'furrow' : 'crest')), w, h);
  assert.equal(m.adjacency.fraction, 0.5, 'only row-to-row edges change material');
  assert.equal(m.patches.count, h, 'one 12-vertex patch per row');
  assert.equal(m.patches.smallCount, 0);
  assert.equal(m.patches.dominantShare, 1 / h);
  assert.equal(m.materials.histogram.length, 2);
});

// --- Mask exclusions --------------------------------------------------------
test('mask excludes one side of a hard seam: boundary fraction becomes 0', () => {
  const w = 10,
    h = 4,
    ids = grid(w, h, x => (x < 5 ? 'jungle' : 'mud')),
    mask = grid(w, h, x => x < 5),
    m = patchMetrics(ids, w, h, { mask });
  assert.equal(m.included, 5 * h);
  assert.equal(m.excluded, 5 * h);
  assert.equal(m.adjacency.edges, 4 * h + 5 * (h - 1), 'only in-mask edges counted');
  assert.equal(m.adjacency.boundaries, 0);
  assert.equal(m.adjacency.fraction, 0);
  assert.equal(m.patches.count, 1);
  assert.equal(m.patches.dominantShare, 1);
  assert.deepEqual(
    m.materials.histogram.map(r => [r.id, r.vertices]),
    [['jungle', 5 * h]],
  );
});

test('mask hole splits a patch instead of bridging it', () => {
  const ids = ['A', 'A', 'A', 'A', 'A'],
    mask = [1, 1, 0, 1, 1],
    m = patchMetrics(ids, 5, 1, { mask });
  assert.equal(m.included, 4);
  assert.deepEqual(m.adjacency, { edges: 2, boundaries: 0, fraction: 0 });
  assert.equal(m.patches.count, 2);
  assert.equal(m.patches.smallCount, 2);
  assert.equal(m.patches.smallVertexFraction, 1);
  assert.equal(m.patches.maxSize, 2);
  assert.equal(m.materials.histogram[0].patches, 2);
});

test('small threshold is <=4 vertices by default and inclusive at the edge', () => {
  // Four separate 4-vertex blobs: each exactly at the boundary of "small".
  const w = 6,
    h = 6,
    ids = grid(w, h, (x, y) => (y % 3 === 2 || x % 3 === 2 ? 'gap' : `blob${(y < 3 ? 0 : 1) + (x < 3 ? 0 : 2)}`));
  const m = patchMetrics(ids, w, h, { smallMax: 4 });
  assert.equal(m.patches.smallCount, 4, 'four 2x2 blobs; the 20-vertex gap cross is not small');
  assert.equal(m.patches.smallVertices, 16);
  const strict = patchMetrics(ids, w, h, { smallMax: 3 });
  assert.equal(strict.patches.smallCount, 0, 'nothing qualifies once 4-vertex blobs fall outside');
  assert.equal(strict.patches.smallVertices, 0);
});

test('empty mask degrades to empty report, not NaN', () => {
  const m = patchMetrics(['a', 'b', 'a', 'b'], 2, 2, { mask: [0, 0, 0, 0], palette: { a: RED, b: BLUE } });
  assert.equal(m.included, 0);
  assert.equal(m.excluded, 4);
  assert.deepEqual(m.adjacency, { edges: 0, boundaries: 0, fraction: null });
  assert.deepEqual(m.patches, { count: 0, smallCount: 0, smallVertices: 0, smallVertexFraction: 0, maxSize: 0, dominantShare: 0 });
  assert.equal(m.materials.distinct, 0);
  assert.equal(m.materials.dominant, null);
  assert.deepEqual(m.materials.histogram, []);
  assert.equal(m.color.meanContrast, null);
  assert.ok(!/NaN/.test(JSON.stringify(m)));
});

test('masked-out vertices are gone from every denominator', () => {
  const w = 8,
    h = 8,
    ids = filled(w * h, 'x'),
    mask = filled(w * h, 1).map((_, i) => i % 2);
  const m = patchMetrics(ids, w, h, { mask });
  assert.equal(m.included, w * h / 2);
  assert.equal(m.materials.histogram[0].share, 1, 'share is over included vertices');
  assert.equal(m.materials.histogram[0].vertices, w * h / 2);
  assert.deepEqual(m.adjacency, { edges: (w / 2) * (h - 1), boundaries: 0, fraction: 0 }, 'no cross-column edge survives');
  assert.equal(m.patches.count, w / 2, 'an alternating mask keeps whole columns and bridges nothing');
  assert.equal(m.patches.maxSize, h, 'vertical runs inside a column stay connected');
  assert.equal(m.patches.smallVertexFraction, 0);
});

// --- Color seams ------------------------------------------------------------
const RED = [1, 0, 0],
  BLUE = [0, 0, 1],
  GREY = [0.5, 0.5, 0.5],
  DARK = [0.25, 0.25, 0.25];

test('checker palette seams reach the diagonal contrast', () => {
  const w = 8,
    h = 8,
    m = patchMetrics(grid(w, h, (x, y) => ((x + y) % 2 ? 'r' : 'b')), w, h, {
      palette: new Map([
        ['r', RED],
        ['b', BLUE],
      ]),
    });
  close(m.color.meanContrast, Math.SQRT2);
  close(m.color.meanContrastNormalized, Math.SQRT2 / Math.sqrt(3));
  assert.equal(m.color.seamEdges, m.adjacency.boundaries);
  assert.equal(m.color.seamEdges, m.color.coloredEdges);
  assert.equal(m.color.missingPaletteEdges, 0);
});

test('coherent route with low-contrast palette stays near zero', () => {
  const w = 16,
    h = 16,
    m = patchMetrics(grid(w, h, x => (x < w / 2 ? 'grey' : 'dark')), w, h, {
      palette: { grey: GREY, dark: DARK },
    });
  close(m.color.meanContrast, Math.sqrt(3 * 0.25 * 0.25));
  assert.equal(m.color.coloredEdges, h);
  assert.ok(m.color.meanContrast < 0.5);
});

test('palette gaps are reported, not silently averaged away', () => {
  const w = 6,
    h = 1,
    ids = ['a', 'b', 'c', 'a', 'b', 'c'],
    m = patchMetrics(ids, w, h, { palette: { a: RED, b: BLUE } });
  assert.equal(m.adjacency.boundaries, 5);
  assert.equal(m.color.coloredEdges, 2, 'the a-b and b-a edges are the only colored pairs');
  assert.equal(m.color.missingPaletteEdges, 3, 'b-c, c-a and b-c edges lack a palette entry');
  close(m.color.meanContrast, Math.SQRT2);
});

test('same-material edges never count as color seams', () => {
  const m = patchMetrics(filled(25, 'lava'), 5, 5, { palette: new Map([['lava', [1, 0.2, 0]]]) });
  assert.equal(m.color.seamEdges, 0);
  assert.equal(m.color.meanContrast, null);
  assert.equal(m.color.missingPaletteEdges, 0);
});

test('palette ids are matched by identity, so 1 and "1" are different families', () => {
  const ids = [1, '1', 1],
    m = patchMetrics(ids, 3, 1, { palette: new Map([[1, RED], ['1', RED]]) });
  assert.equal(m.materials.distinct, 2);
  assert.equal(m.adjacency.boundaries, 2);
  close(m.color.meanContrast, 0, 1e-15);
});

test('array palette is indexed by encoded class (first-seen order)', () => {
  const m = patchMetrics(['a', 'b', 'a', 'b'], 2, 2, { palette: [[0, 0, 0], [1, 1, 1]] });
  assert.equal(m.adjacency.boundaries, 2);
  close(m.color.meanContrast, Math.sqrt(3));
  assert.throws(() => patchMetrics(['a', 'b'], 2, 1, { palette: [[0, 0, 0]] }), /indexed by encoded class/);
});

test('typed-array ids work like plain arrays', () => {
  const typed = new Int32Array([0, 1, 0, 1, 1, 0]);
  const plain = Array.from(typed);
  assert.equal(JSON.stringify(patchMetrics(typed, 3, 2)), JSON.stringify(patchMetrics(plain, 3, 2)));
});

// --- Determinism, invariants, speed ---------------------------------------
test('repeated runs are byte-identical (no traversal-order leakage)', () => {
  const w = 40,
    h = 30,
    ids = grid(w, h, (x, y) => `m${(x * 7 + y * 13 + ((x * y) % 5)) % 6}`);
  const first = patchMetrics(ids, w, h, { palette: null });
  const again = patchMetrics(ids, w, h, { palette: null });
  assert.equal(JSON.stringify(first), JSON.stringify(again));
});

test('invariants hold on a deterministic pseudo-random grid', () => {
  const w = 48,
    h = 48,
    ids = grid(w, h, (x, y) => `m${(x * 31 + y * 17 + x * y) % 5}`);
  const m = patchMetrics(ids, w, h, { palette: { m0: [0, 0, 0], m1: [1, 1, 1], m2: [1, 0, 0], m3: [0, 1, 0], m4: [0, 0, 1] } });
  assert.ok(m.adjacency.fraction >= 0 && m.adjacency.fraction <= 1);
  assert.ok(m.patches.dominantShare > 0 && m.patches.dominantShare <= 1);
  close(m.materials.histogram.reduce((s, r) => s + r.share, 0), 1);
  close(m.materials.histogram.reduce((s, r) => s + r.vertices, 0), m.included);
  assert.equal(m.materials.histogram.reduce((s, r) => s + r.patches, 0), m.patches.count);
  assert.equal(m.materials.histogram.reduce((s, r) => s + r.smallPatches, 0), m.patches.smallCount);
  assert.equal(m.adjacency.boundaries, m.color.seamEdges);
  close(m.color.meanContrast, m.color.meanContrast);
  assert.ok(m.color.meanContrast === null || (m.color.meanContrast >= 0 && m.color.meanContrast <= Math.sqrt(3)));
  assert.ok(m.patches.smallVertices <= m.included);
});

test('512x512 grid stays fast and linear-ish', () => {
  const w = 512,
    h = 512,
    ids = grid(w, h, (x, y) => (x * 3 + y * 5) % 7);
  const start = performance.now();
  const m = patchMetrics(ids, w, h);
  const ms = performance.now() - start;
  assert.equal(m.included, w * h);
  assert.ok(ms < 1500, `512x512 took ${ms.toFixed(1)}ms`);
});

// --- Input validation ------------------------------------------------------
test('invalid inputs are rejected instead of coerced', () => {
  assert.throws(() => patchMetrics([1, 2], 2, 2), /ids length/);
  assert.throws(() => patchMetrics([1], 0, 1), /width and height/);
  assert.throws(() => patchMetrics([1], 1, 1, { mask: [] }), /mask length/);
  assert.throws(() => patchMetrics([1], 1, 1, { smallMax: 0 }), /smallMax/);
  assert.throws(() => patchMetrics([1], 1, 1, { palette: { 1: [255, 0, 0] } }), /normalized/);
  assert.throws(() => patchMetrics([1], 1, 1, { palette: { 1: [0.1, 0.2] } }), /\[r,g,b\]/);
  assert.throws(() => patchMetrics([1, undefined], 2, 1), /undefined material id/);
  assert.throws(() => patchMetrics([1], 1, 1.5), /width and height/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + (error && error.message));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} patch-metric checks passed`);
if (failed) process.exitCode = 1;
