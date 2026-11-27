import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainCraters, CELL } from '../public/js/game/terrain-craters.js';
import * as THREE from 'three';
import { makeMap, heightAtFixture, renderZ, triangles, coarseQuadIndices, quadVertexZ } from './craters/fixture.mjs';

const mid = (q) => q * CELL + CELL / 2;

function setup(size = 25, opts) {
  const m = makeMap(size, opts);
  const c = new TerrainCraters(m.terrain, m.mesh);
  assert.equal(c.ready, true, c.reason);
  // `geo` is the drawn replacement; `coarse` is buildTerrain's ground geometry.
  return { ...m, c, coarse: m.geo, geo: c.geo };
}

/** Largest sub-triangle edge currently drawn for a patch. */
function maxEdge(geo) {
  let e = 0;
  for (const t of triangles(geo)) {
    for (const [a, b] of [
      [0, 3],
      [3, 6],
      [6, 0]
    ]) {
      const dx = t[a] - t[b],
        dy = t[a + 1] - t[b + 1],
        dz = t[a + 2] - t[b + 2];
      e = Math.max(e, Math.hypot(dx, dy, dz));
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
test('small crater wholly inside one triangle becomes real sub-cell geometry', () => {
  const { c, geo, coarse, heights, terrain } = setup();
  const h0 = Float32Array.from(heights);
  // (214,206) sits inside cell quad (10,10), inside its [a,b,d] triangle, and more
  // than r=5 away from every cell edge, so exactly one quad is involved.
  const x = 214,
    y = 206,
    r = 5;
  const rec = c.hit(x, y, r);
  assert.ok(rec, 'hit accepted');
  assert.ok(Math.abs(rec.depth - r * 0.22) < 1e-9);

  // Exactly the one coarse quad the blast disc touches is retired, and its two
  // triangles are degenerate in the coarse index buffer.
  assert.equal(c.stats.publishedQuads, 1, 'one replaced quad');
  assert.equal(c.stats.hiddenQuads, 1);
  const idx = coarseQuadIndices(coarse, 10, 10, 25);
  assert.equal(new Set(idx).size, 1, `coarse quad retired to zero area, got ${idx}`);

  // A real replacement patch is drawn at sub-cell resolution.
  assert.ok(geo.index.count > 0);
  const edge = maxEdge(geo);
  assert.ok(edge <= CELL / 4 + 1e-6, `sub-cell edges, max ${edge}`);
  assert.ok(geo.drawRange.count >= 6 * 4, 'patch has many triangles');

  // Physically a bowl: a floor close to the centre, a lip above the base.
  const base = heightAtFixture(terrain, x, y, true);
  const floor = renderZ(geo, x, y);
  assert.ok(floor !== null, 'surface exists at the centre');
  assert.ok(floor < base - rec.depth * 0.55, `centre depressed ${floor} vs ${base}`);
  let lifted = -Infinity,
    lowest = Infinity;
  for (const t of triangles(geo)) lowest = Math.min(lowest, t[2], t[5], t[8]);
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * Math.PI * 2;
    for (const rr of [0.86, 0.95]) {
      const z = renderZ(geo, x + Math.cos(a) * r * rr, y + Math.sin(a) * r * rr);
      if (z !== null) lifted = Math.max(lifted, z - heightAtFixture(terrain, x + Math.cos(a) * r * rr, y + Math.sin(a) * r * rr, true));
    }
  }
  assert.ok(lowest < base - 0.5, 'floor is below the base surface');
  assert.ok(lifted > 0.02, `raised lip present, max ${lifted}`);
  assert.ok(lifted < 0.6, `lip is modest, max ${lifted}`);

  // The simulation grid is never touched.
  assert.deepEqual(heights, h0, 't.heights unchanged');
});

test('offsetAt reproduces the drawn triangles exactly, and is 0 on untouched ground', () => {
  const { c, geo, terrain } = setup(31);
  c.hit(mid(12), mid(9), 9);
  c.hit(mid(20), mid(20), 26);

  let checked = 0,
    worst = 0;
  const probe = (x, y) => {
    const patch = c.patchAt(x, y);
    const off = c.offsetAt(x, y);
    if (!patch) {
      assert.equal(off, 0, `offset outside every patch must be 0 (${x},${y})`);
      return;
    }
    const drawn = renderZ(geo, x, y);
    assert.ok(drawn !== null, `patch covers its quad (${x},${y})`);
    worst = Math.max(worst, Math.abs(heightAtFixture(terrain, x, y, true) + off - drawn));
    checked++;
  };
  for (const patch of [...c.quads.values()]) {
    const step = CELL / patch.n;
    for (let j = 0; j < patch.n; j++)
      for (let i = 0; i < patch.n; i++) {
        const x = patch.qx * CELL + (i + 0.37) * step,
          y = patch.qy * CELL + (j + 0.61) * step;
        probe(x, y);
        probe(patch.qx * CELL + (i + 0.5) * step, patch.qy * CELL + (j + 0.5) * step);
      }
  }
  // and a sweep of untouched ground far from every crater
  for (let k = 0; k < 400; k++) probe((k % 20) * 30 + 5, ((k / 20) | 0) * 30 + 5);
  assert.ok(checked > 200, `sampled inside patches ${checked} times`);
  assert.ok(worst < 1e-5, `sampler follows the drawn surface, worst ${worst}`);
});

test('patch border is watertight against untouched coarse neighbours', () => {
  const { c, geo, terrain } = setup(25);
  // Deliberately straddles a cell boundary.
  const x = 10 * CELL + 1,
    y = 10 * CELL + 2;
  c.hit(x, y, 9);
  const quads = [...c.quads.values()];
  assert.ok(quads.length >= 2, 'straddling blast replaced several quads');

  // 1. every boundary sub-vertex carries exactly zero crater contribution, which is
  //    what makes the edge coincide with the coarse neighbour's linear edge.
  let border = 0;
  for (const q of quads) {
    const n = q.n,
      step = CELL / n;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        if (i !== 0 && j !== 0 && i !== n && j !== n) continue;
        const px = q.qx * CELL + i * step,
          py = q.qy * CELL + j * step;
        const base = heightAtFixture(terrain, px, py, true);
        // interior boundary points of a patch quad are outside every crater disc
        assert.ok(Math.abs(c.offsetAt(px, py) - (renderZ(geo, px, py) - base)) < 1e-4, 'border sample matches the drawn edge');
        border++;
      }
  }
  assert.ok(border > 20, 'checked border samples');

  // 2. shared vertices between two replaced quads are the same point in space.
  const seen = new Map();
  for (const t of triangles(geo)) {
    for (const k of [0, 3, 6]) {
      const key = `${t[k].toFixed(4)},${t[k + 1].toFixed(4)}`;
      const z = t[k + 2];
      if (seen.has(key)) assert.ok(Math.abs(seen.get(key) - z) < 1e-4, `seam vertex identical at ${key}`);
      else seen.set(key, z);
    }
  }
});

test('overlapping impacts share patches; releasing one restores exactly the survivor', () => {
  const one = setup(25),
    two = setup(25),
    both = setup(25);
  one.c.hit(mid(10), mid(10), 14);
  two.c.hit(mid(10) + 4, mid(10), 14);
  const A = one.c.offsetAt(mid(10), mid(10)),
    B = two.c.offsetAt(mid(10), mid(10));
  assert.ok(A < 0 && B < 0, 'both craters reach the probe point');
  both.c.hit(mid(10), mid(10), 14);
  const quadsAfterFirst = both.c.stats.publishedQuads;
  both.c.hit(mid(10) + 4, mid(10), 14);
  assert.ok(both.c.stats.publishedQuads >= quadsAfterFirst, 'patch quads shared, not duplicated');
  const AB = both.c.offsetAt(mid(10), mid(10));
  assert.ok(AB < A, 'overlap deepens the shared floor');

  const first = both.c.craters[0];
  both.c.release(first);
  assert.equal(both.c.craters.length, 1);
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const x = 8 * CELL + (k % 20) * 6,
      y = 8 * CELL + ((k / 20) | 0) * 6;
    worst = Math.max(worst, Math.abs(both.c.offsetAt(x, y) - two.c.offsetAt(x, y)));
  }
  assert.ok(worst < 1e-5, `survivor profile exact after release, worst ${worst}`);
  both.c.release(both.c.craters[0]);
  assert.equal(both.c.stats.craters, 0);
  assert.equal(both.c.stats.hiddenQuads, 0, 'all coarse quads restored');
  const idx = coarseQuadIndices(both.coarse, 10, 10, 25);
  assert.deepEqual(idx, [0, 1, 2, 3, 4, 5].map((k) => (10 * 24 + 10) * 6 + k), 'coarse index restored');
});

test('more than 24 impacts stay live: no eviction, no lost crater', () => {
  const { c } = setup(61);
  const placed = [];
  for (let k = 0; k < 40; k++) {
    const x = 120 + (k % 8) * 40,
      y = 120 + Math.floor(k / 8) * 40;
    const rec = c.hit(x, y, 5 + (k % 5) * 3.5);
    if (rec) placed.push(rec);
  }
  assert.ok(placed.length >= 36, `placed ${placed.length} of 40`);
  assert.equal(c.stats.craters, placed.length, 'no crater evicted');
  for (const rec of placed) {
    assert.notEqual(c.offsetAt(rec.x, rec.y), 0, `crater ${rec.id} still in the field`);
    assert.equal(c.ownsCell(Math.floor(rec.x / CELL), Math.floor(rec.y / CELL)), true, 'its cells stay owned');
  }
  assert.ok(c.stats.verts <= c.stats.budgetVerts, 'inside the vertex budget');
});

test('budget saturation keeps existing craters and their geometry intact', () => {
  const m = makeMap(41);
  // A floor on the subdivision forces genuine refusals once the budget is full.
  const c = new TerrainCraters(m.terrain, m.mesh, { maxPatchVerts: 900, minSubdiv: 6 });
  assert.equal(c.ready, true, c.reason);
  const first = [];
  for (let k = 0; k < 6; k++) first.push(c.hit(100 + k * 60, 100, 8));
  const keep = first.filter(Boolean);
  assert.ok(keep.length >= 1);
  const before = Float32Array.from(c.geo.attributes.position.array);
  const beforeCount = c.geo.drawRange.count;
  let refused = 0;
  for (let k = 0; k < 40; k++) if (!c.hit(100 + (k % 10) * 60, 300 + Math.floor(k / 10) * 60, 8)) refused++;
  assert.ok(refused > 0, 'some hits refused at saturation');
  assert.equal(c.stats.saturated, true, 'saturation reported');
  // Earlier craters are untouched: same geometry bytes (new quads may append).
  const after = c.geo.attributes.position.array;
  for (let i = 0; i < before.length; i++) assert.equal(after[i], before[i], `vertex ${i} not rewritten by refused hits`);
  assert.ok(c.geo.drawRange.count >= beforeCount);
  for (const rec of keep) assert.equal(c.ownsCell(Math.floor(rec.x / CELL), Math.floor(rec.y / CELL)), true);
  assert.ok(c.stats.verts <= c.stats.budgetVerts, 'still inside budget');
});

test('omitted hole cells are respected, never filled', () => {
  const size = 25;
  const holes = [];
  for (let y = 10; y <= 12; y++) for (let x = 10; x <= 12; x++) holes.push(y * size + x);
  const { c, geo, coarse } = setup(size, { holes });
  assert.equal(c.hit(mid(11), mid(11), 6), null, 'no geometry under the blast');
  assert.equal(c.stats.lastSkip, 'holes');
  assert.equal(c.stats.hiddenQuads, 0, 'nothing retired over a hole');
  assert.equal(coarse.index, null, 'coarse geometry untouched when nothing was published');

  // A blast whose rim reaches real ground deforms only the quads that exist.
  const rec = c.hit(mid(8), mid(11), 26);
  assert.ok(rec);
  for (const q of c.quads.values()) assert.ok(!(q.qx >= 10 && q.qx <= 11 && q.qy >= 10 && q.qy <= 11), `quad ${q.qx},${q.qy} must not be fabricated`);
  // and the hole is still a hole
  const idx = geo.index.array;
  const holeKeys = [10 * 24 + 10, 10 * 24 + 11, 11 * 24 + 10];
  for (const key of holeKeys) assert.equal(c.blockAt[key], -1, 'hole stays absent');
});

test('dispose restores the coarse geometry exactly', () => {
  const { c, coarse, pos, nor, lay, cor, sh, terrain } = setup(25);
  const pos0 = Float32Array.from(pos),
    nor0 = Float32Array.from(nor),
    lay0 = Float32Array.from(lay),
    cor0 = Float32Array.from(cor),
    sh0 = Float32Array.from(sh),
    draw0 = { ...coarse.drawRange },
    index0 = coarse.index;
  c.hit(mid(10), mid(10), 12);
  c.hit(mid(16), mid(8), 5);
  assert.notEqual(coarse.index, null);
  assert.equal(c.dispose(), true);
  assert.equal(coarse.index, null, 'sequential index removed');
  assert.deepEqual({ ...coarse.drawRange }, draw0, 'drawRange restored');
  assert.deepEqual(pos, pos0);
  assert.deepEqual(nor, nor0);
  assert.deepEqual(lay, lay0);
  assert.deepEqual(cor, cor0);
  assert.deepEqual(sh, sh0, 'coarse shade attribute never written');
  assert.equal(c.ready, false);
  assert.equal(c.hit(mid(10), mid(10), 12), null);
  assert.equal(c.offsetAt(mid(10), mid(10)), 0);
  assert.equal(index0, null);
  c.dispose(); // idempotent
  assert.ok(terrain.heights.length > 0);
});

test('concealed hits feed the field but publish nothing until revealed', () => {
  const { c, geo, coarse, terrain } = setup(25);
  const x = mid(12),
    y = mid(12),
    r = 10;
  const shown = c.snapshot();
  const rec = c.hit(x, y, r, { concealed: true });
  assert.ok(rec && rec.concealed);
  // Simulation sees it, rendering does not, ownership does not.
  assert.ok(c.offsetAt(x, y) < -1, 'offsetAt sees the hidden impact');
  assert.equal(c.ownsCell(12, 12), false, 'no owned cell before publication');
  assert.equal(c.ownsCell(12, 12, true), true, 'concealed query answers');
  assert.equal(c.geo.drawRange.count, 3, 'only the warm-up triangle is drawn');
  assert.equal(c.stats.hiddenQuads, 0);
  const bx = Float32Array.from(coarse.attributes.position.array);
  assert.equal(c.reveal(() => false), 0, 'still fogged');
  assert.deepEqual(coarse.attributes.position.array, bx);

  assert.equal(c.reveal((px, py) => px === x && py === y), 1, 'published when visible');
  assert.ok(rec.concealed === false);
  assert.equal(c.ownsCell(12, 12), true);
  const drawn = renderZ(geo, x, y);
  assert.ok(drawn !== null);
  assert.ok(Math.abs(heightAtFixture(terrain, x, y, true) + c.offsetAt(x, y) - drawn) < 1e-5, 'published surface matches the sampler');
  assert.notDeepEqual(c.snapshot().craters, shown.craters);
});

test('snapshot/restore reproduces the field through a fresh instance', () => {
  const a = setup(31);
  a.c.hit(mid(10), mid(10), 12);
  a.c.hit(mid(18), mid(14), 26, { depth: 3.5, scorch: 0.9 });
  a.c.hit(mid(24), mid(8), 5, { concealed: true });
  const snap = a.c.snapshot();
  assert.equal(snap.craters.length, 3);

  const b = setup(31);
  const before = Float32Array.from(b.geo.attributes.position.array);
  const res = b.c.restore(snap);
  assert.equal(res.reason, '');
  assert.equal(res.restored, 3);
  assert.equal(res.concealed, 1);
  assert.equal(b.c.stats.craters, 3);
  assert.equal(b.c.stats.concealedCraters, 1);

  // Same drawn surface as the instance that produced the snapshot.
  const pa = a.geo.attributes.position.array,
    pb = b.geo.attributes.position.array;
  assert.equal(a.c.stats.verts, b.c.stats.verts);
  for (let i = 0; i < b.c.stats.verts * 3; i++) assert.equal(pb[i], pa[i], `restored vertex ${i}`);
  for (let k = 0; k < 400; k++) {
    const x = (k % 20) * 30,
      y = ((k / 20) | 0) * 30;
    assert.ok(Math.abs(a.c.offsetAt(x, y) - b.c.offsetAt(x, y)) < 1e-6);
  }
  assert.equal(b.c.revision >= a.c.revision, true, 'revision carried forward');
  assert.notDeepEqual(before, pb, 'geometry actually rebuilt');
});

test('restore validation rejects bad snapshots without disturbing the live field', () => {
  const { c } = setup(25);
  c.hit(mid(10), mid(10), 12);
  const good = c.snapshot();
  const keep = Float32Array.from(c.geo.attributes.position.array);
  const keepStats = c.stats;
  const cases = [
    [null, /no crater list/],
    [{ craters: [{ x: NaN, y: 1, radius: 5 }] }, /non-finite/],
    [{ craters: [{ x: 1e6, y: 1, radius: 5 }] }, /outside the map/],
    [{ craters: [{ x: 10, y: 10, radius: 500 }] }, /radius out of range/],
    [{ craters: [{ x: 10, y: 10, radius: 5, depth: 1e6 }] }, /depth out of range/],
    [{ quadsW: 999, craters: [] }, /map width/],
    [{ v: 99, craters: [] }, /version/],
    [{ craters: new Array(100001).fill({ x: 1, y: 1, radius: 5 }) }, /too many/]
  ];
  for (const [snap, re] of cases) {
    const res = c.restore(snap);
    assert.equal(res, false, 'refused snapshots return false');
    assert.equal(c.lastRestore.restored, 0);
    assert.match(c.lastRestore.reason, re);
    assert.deepEqual(c.geo.attributes.position.array, keep, 'live geometry untouched');
    assert.equal(c.stats.craters, keepStats.craters);
  }
  // A good snapshot still applies afterwards.
  assert.equal(c.restore(good).restored, 1);
  assert.equal(c.restore({ craters: [{ x: -1, y: 0, radius: 5 }] }), false);
  assert.match(c.lastRestore.reason, /outside the map/);
});

test('revision and onChange fire once per mutation, after the field is consistent', () => {
  const seen = [];
  const m = makeMap(25);
  const c = new TerrainCraters(m.terrain, m.mesh, {
    onChange: (t) => {
      seen.push({
        rev: t.revision,
        reason: t.lastChange.reason,
        floor: t.offsetAt(mid(10), mid(10)),
        drawn: t.geo ? t.geo.drawRange.count : 0,
        owned: t.ownsCell(10, 10)
      });
    }
  });
  const r0 = c.revision;
  const rec = c.hit(mid(10), mid(10), 12);
  assert.equal(c.revision, r0 + 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, 'hit');
  assert.equal(seen[0].rev, c.revision);
  assert.ok(seen[0].floor < -1, 'offsetAt already includes the new crater');
  assert.ok(seen[0].drawn > 6, 'replacement geometry already published');
  assert.equal(seen[0].owned, true, 'ownership already updated');

  c.release(rec);
  assert.equal(c.revision, r0 + 2);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].reason, 'release');
  assert.equal(seen[1].floor, 0);

  const snap = c.snapshot();
  c.hit(mid(14), mid(14), 8);
  const rev = c.revision;
  c.restore(snap);
  assert.ok(c.revision > rev, 'restore bumps revision');
  assert.equal(seen[seen.length - 1].reason, 'restore');

  c.dispose();
  assert.equal(seen[seen.length - 1].reason, 'dispose');
});

test('replacement shade encodes the sentinel contract: 2 + scorch, never the coarse shade', () => {
  const { c, geo, sh } = setup(25);
  const coarseShade = Float32Array.from(sh);
  const rec = c.hit(mid(10), mid(10), 12, { scorch: 1 });
  let S = geo.attributes.shade.array;
  const count = c.stats.verts;
  assert.ok(count > 10);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < count; i++) {
    min = Math.min(min, S[i]);
    max = Math.max(max, S[i]);
  }
  assert.ok(min >= 2 - 1e-6, `sentinel floor ${min}`);
  assert.ok(max <= 3 + 1e-6, `sentinel ceiling ${max}`);
  assert.ok(max > 2.2, `char present on the floor ${max}`);

  const noChar = c.hit(mid(16), mid(16), 8, { scorch: 0 });
  S = geo.attributes.shade.array; // caps may have grown: re-read the attribute
  const base = c.quads.get(16 * c.quadsW + 16);
  assert.ok(noChar && base);
  for (let k = 0; k < (base.n + 1) ** 2; k++) assert.equal(S[base.slot + k], 2, 'scorch 0 -> exactly 2');
  assert.deepEqual(sh, coarseShade, 'coarse shade untouched');
});

test('patch keeps authentic attributes: corner/layers follow the coarse cell, layers track paving', () => {
  const { c, geo, lay, terrain } = setup(25);
  c.hit(mid(10), mid(10), 12);
  const q = c.quads.get(10 * c.quadsW + 10);
  const block = (10 * 24 + 10) * 6;
  const C = geo.attributes.corner.array,
    L = geo.attributes.layers.array;
  let minC = Infinity,
    maxC = -Infinity,
    n = q.n;
  for (let k = 0; k < (n + 1) ** 2; k++) {
    minC = Math.min(minC, C[(q.slot + k) * 2]);
    maxC = Math.max(maxC, C[(q.slot + k) * 2 + 1]);
    for (let j = 0; j < 4; j++) assert.equal(L[(q.slot + k) * 4 + j], lay[block * 4 + j], 'layer slots copied from the coarse quad');
  }
  assert.equal(minC, 0);
  assert.equal(maxC, 1);

  // Runtime painting: the engine rewrites the coarse quad's layers, sync() follows.
  lay[block * 4] = 3;
  terrain.paint.paintRevision++;
  assert.equal(c.sync(), true);
  for (let k = 0; k < (n + 1) ** 2; k++) assert.equal(L[(q.slot + k) * 4], 3, 'paved layer reaches the replacement');
  assert.equal(c.sync(), false, 'no-op when nothing changed');
});

test('normals: unit length, coarse normal on the border, real relief inside', () => {
  const { c, geo, nor } = setup(25);
  c.hit(mid(10), mid(10), 12, { depth: 4 });
  const N = geo.attributes.normal.array;
  const q = c.quads.get(10 * c.quadsW + 10);
  const block = (10 * 24 + 10) * 6;
  const n = q.n;
  let changedInside = 0;
  for (let k = 0; k < (n + 1) ** 2; k++) {
    const v = q.slot + k,
      len = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5, `unit normal ${len}`);
  }
  // corner (0,0) of the patch must carry the coarse baked normal of corner a
  for (let j = 0; j < 3; j++) assert.ok(Math.abs(N[q.slot * 3 + j] - nor[block * 3 + j]) < 1e-5, 'border normal matches coarse');
  const centre = (n >> 1) * (n + 1) + (n >> 1);
  for (let j = 0; j < 3; j++) if (Math.abs(N[(q.slot + centre) * 3 + j] - nor[block * 3 + j]) > 1e-3) changedInside++;
  assert.ok(changedInside > 0, 'floor normals follow the bowl');
  assert.ok(c.quads.size >= 1);
});

test('material is cloned with live uniforms, and never suppressed by the ground relief cut', () => {
  const m = makeMap(25);
  m.material.uniforms.reliefPatch.value.set(1, 1, 3, 3); // coarse mesh is cut here
  const c = new TerrainCraters(m.terrain, m.mesh);
  const child = c.mesh.material;
  assert.ok(child && child.isShaderMaterial);
  assert.equal(child.vertexShader, m.material.vertexShader);
  assert.equal(child.fragmentShader, m.material.fragmentShader);
  assert.notEqual(child, m.material);
  assert.deepEqual(child.uniforms.reliefPatch.value.toArray(), [0, 0, 0, 0], 'replacement is never relief-cut');
  assert.equal(child.uniforms.sunDir, m.material.uniforms.sunDir, 'uniform objects shared, not copied');
  assert.equal(child.uniforms.terrainLayers.value, 0.75, 'uniform getter preserved (not frozen to a number)');
  assert.equal(c.mesh.parent, m.mesh);
  assert.equal(c.mesh.frustumCulled, false);
  assert.equal(c.mesh.renderOrder, m.mesh.renderOrder || 0);

  // Reviewed maps swap ground.material: the child must be re-bound to the new one.
  const swapped = m.material.clone();
  swapped.uniforms = { ...m.material.uniforms, reliefPatch: { value: Object.assign(new (m.material.uniforms.reliefPatch.value.constructor)(), {}) } };
  swapped.defines = { BIOME_RECIPE: 1 };
  m.mesh.material = swapped;
  assert.equal(c.bindMaterial(), true);
  assert.equal(c.mesh.material.defines.BIOME_RECIPE, 1, 'new parent defines carried over');
  assert.equal(c.bindMaterial(), false, 'no-op when already bound');
});

test('ownsCell bounds, patchAt and stats stay consistent', () => {
  const { c } = setup(25);
  assert.equal(c.ownsCell(-1, 0), false);
  assert.equal(c.ownsCell(24, 24), false);
  c.hit(mid(10), mid(10), 5);
  assert.equal(c.ownsCell(10, 10), true);
  assert.equal(c.ownsCell(9, 10), false);
  assert.ok(c.patchAt(mid(10), mid(10)));
  assert.equal(c.patchAt(-5, -5), null);
  const s = c.stats;
  assert.equal(s.hiddenQuads, s.publishedQuads);
  assert.ok(s.verts > 0 && s.indices > 0);
  assert.equal(s.revision, c.revision);
});

test('perf smoke: 40 impacts of r=5..26 on a 100x100 map', () => {
  const m = makeMap(100);
  const c = new TerrainCraters(m.terrain, m.mesh);
  assert.equal(c.ready, true, c.reason);
  const t0 = process.hrtime.bigint();
  let placed = 0;
  for (let k = 0; k < 40; k++) {
    const x = 60 + (k % 8) * 230,
      y = 60 + Math.floor(k / 8) * 230,
      r = 5 + (k % 6) * 4.2;
    if (c.hit(x, y, r)) placed++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const s = c.stats;
  console.log(`    40 hits r5..26 on 100x100: ${ms.toFixed(1)}ms, placed ${placed}, quads ${s.hiddenQuads}, verts ${s.verts}/${s.budgetVerts}, base verts ${s.baseVerts}`);
  assert.equal(placed, 40);
  assert.ok(ms < 4000, `placement stayed interactive: ${ms}ms`);
  assert.ok(s.verts <= s.budgetVerts);
  assert.ok(s.hiddenQuads <= 40 * 16, 'footprint stays local');
  // sampler still cheap: 200k samples
  const t1 = process.hrtime.bigint();
  let acc = 0;
  for (let k = 0; k < 200000; k++) acc += c.offsetAt((k * 13) % 1980, (k * 29) % 1980);
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log(`    200k offsetAt samples: ${ms2.toFixed(1)}ms (${((ms2 * 1000) / 200000).toFixed(2)}us each) sum ${acc.toFixed(1)}`);
  assert.ok(ms2 < 500, `sampler is cheap: ${ms2}ms`);
});

// ---------------------------------------------------------------------------
test('map edges and oversized blasts keep the replacement watertight', () => {
  const { c, geo } = setup(25);
  assert.ok(c.hit(1, 1, 8), 'corner blast accepted');
  assert.ok(c.hit(479, 479, 6), 'last-corner blast accepted');
  assert.ok(c.hit(240, 240, 96), 'map-wide blast accepted');
  const s = c.stats;
  assert.ok(s.verts <= s.budgetVerts, `clamped to the budget (${s.verts}/${s.budgetVerts})`);
  assert.ok(s.hiddenQuads <= s.quadsW * s.quadsH);

  // No NaN, unit normals, patch border always exactly on the coarse surface.
  const P = geo.attributes.position.array,
    N = geo.attributes.normal.array,
    S = geo.attributes.shade.array,
    verts = s.verts;
  for (let i = 0; i < verts; i++) {
    assert.ok(Number.isFinite(P[i * 3]) && Number.isFinite(P[i * 3 + 1]) && Number.isFinite(P[i * 3 + 2]), `vertex ${i} finite`);
    const len = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5, 'unit normal');
    assert.ok(S[i] >= 2 && S[i] <= 3, 'sentinel shade');
  }
  // Every drawn triangle has area (no accidental degenerate leftovers)...
  let zero = 0,
    total = 0;
  for (const t of triangles(geo)) {
    total++;
    const area = Math.abs((t[3] - t[0]) * (t[7] - t[1]) - (t[6] - t[0]) * (t[4] - t[1]));
    if (area < 1e-9) zero++;
  }
  assert.equal(zero, 0, 'no zero-area replacement triangles');
  assert.ok(total > 100);
});

test('many simultaneous craters stay consistent and local', () => {
  const { c, geo } = setup(61);
  let placed = 0;
  for (let k = 0; k < 60; k++) {
    const x = 40 + ((k * 97) % 1120),
      y = 40 + ((k * 211) % 1120);
    if (c.hit(x, y, 5 + ((k * 7) % 22))) placed++;
  }
  const s = c.stats;
  assert.ok(placed > 40, `placed ${placed}`);
  assert.ok(s.hiddenQuads < s.quadsW * s.quadsH * 0.5, 'never tessellates the whole map');
  assert.ok(s.verts <= s.budgetVerts);

  // Structural invariant behind the T-junction fix: edge-adjacent patch quads
  // always share one subdivision.
  let seams = 0;
  for (const q of c.quads.values()) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1]
    ]) {
      const other = c.quads.get((q.qy + dy) * c.quadsW + q.qx + dx);
      if (!other) continue;
      assert.equal(other.n, q.n, `adjacent patch quads must share n (${q.qx},${q.qy})`);
      seams++;
    }
  }
  assert.ok(seams > 10, `checked ${seams} patch seams`);

  // Every patch quad's border still carries a zero field value...
  let samples = 0;
  for (const q of c.quads.values()) {
    const n = q.n,
      step = CELL / n;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        if (i !== 0 && j !== 0 && i !== n && j !== n) continue;
        const px = q.qx * CELL + i * step,
          py = q.qy * CELL + j * step;
        const drawn = renderZ(geo, px, py);
        if (drawn === null) continue;
        // A border sample must equal the coarse neighbour's edge height, which is
        // the coarse-base interpolation of the original corner heights.
        const base = heightAtFixture(c.terrain, px, py, true);
        assert.ok(Math.abs(drawn - (base + c.offsetAt(px, py))) < 1e-4, 'sampler agrees at borders');
        samples++;
      }
  }
  assert.ok(samples > 100);
});

test('coarse ground retirement uploads 6 index entries, never vertex data', () => {
  const { c, coarse, pos, nor, lay } = setup(25);
  const p0 = Float32Array.from(pos),
    n0 = Float32Array.from(nor),
    l0 = Float32Array.from(lay);
  c.hit(mid(10), mid(10), 12);
  assert.ok(coarse.index, 'geometry is converted to a sequential index');
  // Everything except the retired quads is still the sequential identity, so the
  // coarse mesh renders exactly as before; retired quads reference one vertex.
  const arr = coarse.index.array,
    buried = new Set(),
    blocks = [...c.quads.values()].map((q) => q.block);
  for (const b of blocks) for (let k = 0; k < 6; k++) buried.add(b + k);
  let wrong = 0;
  for (let i = 0; i < arr.length; i++) if (!buried.has(i) && arr[i] !== i) wrong++;
  for (const b of blocks) for (let k = 0; k < 6; k++) if (arr[b + k] !== b) wrong++;
  assert.equal(wrong, 0, 'only crater-owned quads are degenerate');
  // Vertex attributes are byte-identical: no terrain re-upload per crater.
  assert.deepEqual(pos, p0);
  assert.deepEqual(nor, n0);
  assert.deepEqual(lay, l0);
  const ranges = coarse.index.updateRanges || [];
  assert.ok(ranges.length >= blocks.length, 'partial index upload ranges recorded');
  for (const r of ranges) assert.ok(r.count === 6, `6 index entries per retirement (got ${r.count})`);
  assert.equal(coarse.index.version > 0, true, 'version bumped so the draw sees it');
});

test('a concealed hit overlapping a published patch still feeds the sampler', () => {
  const { c, geo, terrain } = setup(25);
  c.hit(mid(10), mid(10), 14);
  const before = c.offsetAt(mid(10) + 6, mid(10));
  c.hit(mid(10) + 6, mid(10), 10, { concealed: true });
  const after = c.offsetAt(mid(10) + 6, mid(10));
  assert.ok(after < before - 0.5, `simulation sees the hidden shell: ${before} -> ${after}`);
  // The drawn patch is unchanged until publication (documented in README).
  assert.ok(Number.isFinite(renderZ(geo, mid(10) + 6, mid(10))));
  assert.equal(c.reveal(() => true), 1);
  const drawn = renderZ(geo, mid(10) + 6, mid(10));
  assert.ok(Math.abs(heightAtFixture(terrain, mid(10) + 6, mid(10), true) + c.offsetAt(mid(10) + 6, mid(10)) - drawn) < 1e-4, 'agrees again after reveal');
});

test('snapshot survives JSON and keeps concealed hits across a reload', () => {
  const a = setup(25);
  a.c.hit(mid(10), mid(10), 12, { scorch: 0.4 });
  a.c.hit(mid(20), mid(20), 8, { concealed: true });
  const wire = JSON.parse(JSON.stringify(a.c.snapshot()));
  const b = setup(25);
  const res = b.c.restore(wire);
  assert.notEqual(res, false);
  assert.equal(res.restored, 2);
  assert.equal(res.concealed, 1);
  assert.equal(b.c.ownsCell(20, 20), false, 'concealed stays unseen after reload');
  assert.equal(b.c.ownsCell(20, 20, true), true);
  assert.deepEqual(b.c.snapshot().craters.map((x) => [x.x, x.y, x.radius, x.concealed]), wire.craters.map((x) => [x.x, x.y, x.radius, x.concealed]));
  // and it is still a live crater once revealed
  assert.equal(b.c.reveal(() => true), 1);
  assert.ok(b.c.offsetAt(mid(20), mid(20)) < 0);
});

test('a ground mesh that cannot be retired is refused instead of capped over', () => {
  const m = makeMap(25);
  // A pre-existing, non-sequential index would be corrupted by our degeneracy
  // trick, so the module must refuse rather than draw a patch under a live cap.
  const idx = new Uint32Array(m.geo.attributes.position.count);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx[0] = 5; // not the sequential identity
  m.geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const c = new TerrainCraters(m.terrain, m.mesh);
  assert.equal(c.ready, true, c.reason);
  assert.equal(c.hit(mid(10), mid(10), 12), null, 'refused');
  assert.equal(c.stats.lastSkip, 'unsupported');
  assert.equal(c.stats.hiddenQuads, 0);
  assert.equal(c.stats.craters, 0);
  assert.equal(c.offsetAt(mid(10), mid(10)), 0);
});

test('replacement follows a swapped ground material without an explicit call', () => {
  const m = makeMap(25);
  const c = new TerrainCraters(m.terrain, m.mesh);
  c.hit(mid(10), mid(10), 12);
  const first = c.mesh.material;
  const swapped = new m.material.constructor({
    glslVersion: m.material.glslVersion,
    vertexShader: m.material.vertexShader,
    fragmentShader: m.material.fragmentShader,
    uniforms: { ...m.material.uniforms, reliefPatch: { value: new m.material.uniforms.reliefPatch.value.constructor() } }
  });
  swapped.defines = { BIOME_RECIPE: 1 };
  m.mesh.material = swapped;
  c.hit(mid(14), mid(10), 8); // any field change flushes
  assert.notEqual(c.mesh.material, first, 'child re-bound');
  assert.equal(c.mesh.material.defines.BIOME_RECIPE, 1);
  assert.equal(c.mesh.material.uniforms.reliefPatch.value.x, 0, 'still not relief-cut');
});

test('rectangular TED maps (t.size = max(w,h)) work off-mesh', () => {
  const m = makeMap(1, { width: 9, height: 7 });
  const c = new TerrainCraters(m.terrain, m.mesh);
  assert.equal(c.ready, true, c.reason);
  assert.equal(c.stats.quadsW, 8, 'quads follow the mesh grid, not t.size');
  assert.equal(c.stats.quadsH, 6);
  const rec = c.hit(84, 62, 12);
  assert.ok(rec, 'hit accepted on a rectangular map');
  assert.ok(c.offsetAt(84, 62) < -0.5);
  const drawn = renderZ(c.geo, 84, 62);
  assert.ok(drawn !== null);
  assert.ok(Math.abs(heightAtFixture(m.terrain, 84, 62, true) + c.offsetAt(84, 62) - drawn) < 1e-5);
  assert.equal(c.hit(500, 500, 8), null, 'still bounded by the map');
});

test('a second blast that only adds a member re-draws the shared quads', () => {
  const { c, geo, terrain } = setup(25);
  c.hit(mid(10), mid(10), 14);
  const firstVerts = Float32Array.from(geo.attributes.position.array.subarray(0, c.stats.verts * 3));
  // Same radius -> same sub-cell resolution -> no resubdivision, only new members.
  c.hit(mid(10) + 4, mid(10), 14);
  const q = c.quads.get(10 * c.quadsW + 10);
  assert.ok(q.n > 0);
  const changed = [...geo.attributes.position.array.subarray(q.slot * 3, (q.slot + (q.n + 1) ** 2) * 3)].some((v, i) => v !== firstVerts[q.slot * 3 + i]);
  assert.ok(changed, 'shared quad geometry was rewritten for the new member');
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const x = 10 * CELL + (k % 14) * 1.4,
      y = 10 * CELL + ((k / 14) | 0) * 1.4;
    const drawn = renderZ(geo, x, y);
    if (drawn === null) continue;
    worst = Math.max(worst, Math.abs(heightAtFixture(terrain, x, y, true) + c.offsetAt(x, y) - drawn));
  }
  assert.ok(worst < 1e-4, `drawn patch includes both craters, worst ${worst}`);
});

test('a blast that both appends quads and re-dirties neighbours writes both', () => {
  const { c, geo, terrain } = setup(25);
  c.hit(mid(10) + 14, mid(10), 10); // small patch inside quad (10,10)
  const before = c.stats.hiddenQuads;
  // Bigger radius, offset so it reaches new quads *and* overlaps the first patch.
  c.hit(mid(10) + 18, mid(10) + 2, 20);
  assert.ok(c.stats.hiddenQuads > before, 'the second blast appended quads');
  let worst = 0,
    checked = 0;
  for (const q of c.quads.values()) {
    const step = CELL / q.n;
    for (let j = 0; j <= q.n; j++)
      for (let i = 0; i <= q.n; i++) {
        const x = q.qx * CELL + i * step,
          y = q.qy * CELL + j * step;
        const drawn = renderZ(geo, x, y);
        if (drawn === null) continue;
        worst = Math.max(worst, Math.abs(heightAtFixture(terrain, x, y, true) + c.offsetAt(x, y) - drawn));
        checked++;
      }
  }
  assert.ok(checked > 100);
  assert.ok(worst < 1e-4, `every patch vertex was re-drawn from the union of members, worst ${worst}`);
});
