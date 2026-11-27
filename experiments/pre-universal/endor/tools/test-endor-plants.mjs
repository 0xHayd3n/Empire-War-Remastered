// Fast, dependency-free geometry/asset check for the Endor plant replacement.
// Browser integration is checked separately with tools/check-endor-plants.cjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildEndorPlantParts, prepareEndorPlants } from '../public/js/game/endor-plants.js';
import { decodePNG } from '../public/js/png.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, '..', 'public', 'art', 'endor-plants');
const IDs = [
  'endor-tree-ever-00',
  'endor-tree-ever-01',
  'endor-tree-cluster-00',
  'endor-tree-cluster-01',
  'endor-canopy-b',
  'endor-canopy-a',
  'endor-tree-broadleaf',
  'endor-ground-a',
  'endor-ground-d',
  'endor-ground-e',
  'endor-ground-f',
  'endor-ground-g',
  'endor-fern-00',
  'endor-fern-01',
  'endor-bush-00',
  'endor-cattail',
  'endor-stump-redwood',
  'endor-stump-pine'
];

function checkGeometry(g, id, detail) {
  assert(g, `${id}/${detail}: missing geometry`);
  for (const name of ['position', 'normal', 'uv', 'tangent', 'binormal', 'color'])
    assert(g.attributes[name], `${id}/${detail}: missing ${name}`);
  assert(g.index, `${id}/${detail}: no index`);
  assert(g.attributes.position.count > 12, `${id}/${detail}: too few vertices`);
  const pos = g.attributes.position.array;
  assert.equal(pos.length % 3, 0);
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      assert(Number.isFinite(pos[i + k]), `${id}/${detail}: non-finite position`);
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  }
  for (const name of ['normal', 'tangent', 'binormal']) {
    const a = g.attributes[name].array;
    for (let i = 0; i < a.length; i += 3) {
      const len = Math.hypot(a[i], a[i + 1], a[i + 2]);
      assert(len > 0.9 && len < 1.1, `${id}/${detail}: ${name} not unit length (${len})`);
    }
  }
  for (const v of g.attributes.color.array) assert(v >= 0 && v <= 1.0001, `${id}/${detail}: colour out of range`);
  const bbox = max.map((v, k) => v - min[k]);
  assert(bbox[2] > 0.25, `${id}/${detail}: geometry is flat (z extent ${bbox[2]})`);
  assert(g.index.count / 3 > 4, `${id}/${detail}: too few triangles`);
  return {
    id,
    detail,
    vertices: g.attributes.position.count,
    triangles: g.index.count / 3,
    bbox: bbox.map(v => +v.toFixed(2)),
    min: min.map(v => +v.toFixed(2)),
    max: max.map(v => +v.toFixed(2))
  };
}

const rows = [];
for (const id of IDs) {
  const nearParts = buildEndorPlantParts(id, 'near');
  const farParts = buildEndorPlantParts(id, 'far');
  assert(nearParts && farParts, `${id}: missing geometry`);
  const near = [], far = [];
  for (const kind of ['bark', 'leaf']) {
    if (nearParts[kind]) near.push(checkGeometry(nearParts[kind], id, `${kind}/near`));
    if (farParts[kind]) far.push(checkGeometry(farParts[kind], id, `${kind}/far`));
  }
  assert(near.length > 0 && near.length === far.length, `${id}: bark/leaf part mismatch`);
  for (let i = 0; i < near.length; i++) {
    assert(near[i].vertices > far[i].vertices, `${id}/${near[i].kind}: far LOD is not cheaper (${near[i].vertices} <= ${far[i].vertices})`);
    assert(near[i].triangles > far[i].triangles, `${id}/${near[i].kind}: far LOD has no triangle reduction`);
  }
  rows.push({ id, near, far });
}

// A bounded geometry budget. These are per-class shared geometries; instance
// counts multiply at draw time, not in memory.
const nearVerts = rows.reduce((n, r) => n + r.near.reduce((k, p) => k + p.vertices, 0), 0);
const farVerts = rows.reduce((n, r) => n + r.far.reduce((k, p) => k + p.vertices, 0), 0);
assert(nearVerts < 22000, `near geometry budget too high: ${nearVerts}`);
assert(farVerts < 9000, `far geometry budget too high: ${farVerts}`);

// Assets: real 2x2 atlas with four usable cutouts, bark albedo and OpenGL normal.
const files = ['leaf-atlas.png', 'bark.png', 'bark-normal.png'];
for (const name of files) {
  const file = path.join(ART, name);
  const bytes = fs.readFileSync(file);
  const png = await decodePNG(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  assert(png, `${name}: not decodable by the project PNG path`);
  assert.equal(png.width, png.height);
  assert(png.width >= 1024, `${name}: lower than 1K`);
  assert(png.data.length === png.width * png.height * 4);
  if (name === 'leaf-atlas.png') {
    assert.equal(png.width, 2048);
    for (const [cx, cy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]) {
      let opaque = 0,
        clear = 0,
        sum = 0;
      for (let y = 0; y < 1024; y++)
        for (let x = 0; x < 1024; x++) {
          const a = png.data[((cy * 1024 + y) * 2048 + cx * 1024 + x) * 4 + 3];
          sum += a;
          if (a > 32) opaque++;
          else if (a < 16) clear++;
        }
      assert(opaque > 20_000, `cell ${cx},${cy}: too little plant silhouette`);
      assert(clear > 20_000, `cell ${cx},${cy}: no alpha cutout`);
      assert(sum / (1024 * 1024) > 10, `cell ${cx},${cy}: nearly empty alpha`);
    }
  }
}

// The no-game path is a safe no-op, not a throw.
const none = await prepareEndorPlants(null);
assert.equal(none.stats.ok, false);
assert.equal(none.set(true), false);
none.dispose();

const hashes = Object.fromEntries(files.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(ART, name))).digest('hex')]));
console.log(
  JSON.stringify(
    {
      pass: true,
      classes: rows.length,
      nearVertices: nearVerts,
      farVertices: farVerts,
      nearTriangles: rows.reduce((n, r) => n + r.near.reduce((k, p) => k + p.triangles, 0), 0),
      farTriangles: rows.reduce((n, r) => n + r.far.reduce((k, p) => k + p.triangles, 0), 0),
      hashes,
      rows
    },
    null,
    1
  )
);
console.log('PASS: 18 authored classes, 3D branches/fronds, near+far LOD, 2x2 cutout atlas, safe no-game path');
