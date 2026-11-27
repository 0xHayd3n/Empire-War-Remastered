// Offline: exact authoring decisions, donor/foliage provenance, shader binding budget and habitat exclusions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { yavinRecipe as r } from '../public/js/yavin-recipe.js';
import { families } from '../public/js/gpu/programs.js';
import { habitat } from '../public/js/game/endor-grove.js';
const art = new URL('../public/art/', import.meta.url),
  hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(r.edition, 'foc');
assert.equal(r.path, 'DATA/ART/MAPS/_MP_LAND_YAVIN.TED');
assert.match(r.ted, /^[a-f0-9]{64}$/);
assert.deepEqual(
  Object.entries(r.slots)
    .filter(([, v]) => !v.family)
    .map(([i]) => +i),
  []
);
assert.equal(Object.keys(r.slots).length, 18);
for (const s of Object.values(r.slots)) {
  for (const k of ['diffuse', 'bump']) assert.match(s[k], /^[a-f0-9]{64}$/);
  if (s.family) assert(r.donors.some(d => d.id === s.family));
}
for (const d of r.donors)
  for (const k of ['color', 'surface'])
    assert.equal(hash(fs.readFileSync(new URL(`${d.pack || 'endor-terrain'}/${d.id}-${k}.dds`, art))), d[k + 'Hash']);
assert.deepEqual(r.grove.kinds, ['fern']);
assert.equal(r.slots[22].family, 'fallen-leaves');
assert.equal(r.slots[31].family, 'forest-earth');
for (const [name, pin] of Object.entries(r.canopy.files)) assert.equal(hash(fs.readFileSync(new URL('yavin-jungle/' + name, art))), pin);
assert.equal(
  Object.values(r.canopy.targets).reduce((n, t) => n + t.count, 0),
  1680
);
assert(!Object.keys(r.canopy.targets).some(k => /TEMPLE|RUINS|BUILDING|TOWER/.test(k)));
for (const file of Object.keys(r.canopy.targets)) assert.match(r.canopy.sources['Data/Art/Models/' + file], /^[a-f0-9]{64}$/);
for (const [n, h] of Object.entries(r.grove.files)) assert.equal(hash(fs.readFileSync(new URL('endor-grove/' + n, art))), h);
for(const [n,h] of Object.entries(r.farCover.files))assert.equal(hash(fs.readFileSync(new URL('yavin-groundcover/'+n,art))),h);
const farCatalog=JSON.parse(fs.readFileSync(new URL('yavin-groundcover/models.json',art)));assert.equal(farCatalog.models.length,4);for(const m of farCatalog.models){assert(m.triangles<=12);assert.equal(m.source.sha256,hash(fs.readFileSync(new URL(m.source.pack+'/'+m.source.file,art))));}
const base = families.find(f => f.name === 'terrain'),
  mixed = families.find(f => f.name === 'reviewed-terrain');
assert.equal(base.layout.length, mixed.layout.length);
assert.equal(base.layout.find(e => e.binding === 9).texture.viewDimension, '2d');
assert.equal(mixed.layout.find(e => e.binding === 9).texture.viewDimension, '2d-array');
assert(!Object.values(r.slots).some(s => s.retainColor));
assert.equal(r.policy, 'polyhaven-2k');
assert.equal(r.slots[37].family, 'apron-grit');
assert.equal(r.donors.find(d => d.id === r.slots[36].family).regular, true);
assert.deepEqual(Object.keys(r.slots).map(Number), [0, 2, 3, 5, 9, 10, 12, 14, 22, 23, 31, 35, 36, 37, 58, 59, 62, 63]);
const lock = JSON.parse(fs.readFileSync(new URL('yavin-ground/sources.json', art)));
for (const row of r.donors) {
  const src = lock[row.asset];
  assert.equal(src.page, `https://polyhaven.com/a/${row.asset}`);
  for (const k of ['color', 'height', 'normal', 'roughness'])
    assert.match(src.inputs[k].url, /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/Textures\/(jpg|png)\/2k\//);
}
const { auditDonors } = await import('./remaster/surface-audit.mjs');
console.log('Production relief registration:', auditDonors(r.donors));
const t = { size: 3, heights: new Float32Array(9), layerIndex: new Uint8Array(9) };
assert(habitat(t, [1], 10, 10));
for (const id of [-1, 3, 4, 5, 6, 7]) assert.equal(habitat(t, [id], 10, 10), null);
console.log(
  'PASS Yavin: every painted/dynamic draw slot fully mapped to native 2K Poly Haven PBR; aligned paving, pinned canopy, unchanged sampler count'
);
