import assert from 'node:assert/strict';
import { groundZones } from '../public/js/game/ground-zones.js';
import { validateDirection } from './remaster/direction.mjs';
import fs from 'node:fs';
const t = { size: 64, paint: {} },
  used = [3, 12, 36, 62],
  r = {
    slots: { 3: { use: 'natural' }, 12: { use: 'natural' }, 36: { use: 'built' }, 62: { use: 'built' } },
    zones: [
      { slot: 36, natural: 12, aprons: [{ model: 'TEMPLE.ALO', anchor: [200, 200], rect: [140, 140, 280, 280] }] },
      { slot: 62, natural: 3, construction: true, aprons: [] }
    ]
  };
const g = groundZones(t, used, r, [{ modelFile: 'Temple.alo', x: 200, y: 200 }]),
  at = (x, y) => y * t.size + x;
assert.equal(g.slotAt(at(10, 10), 2), 2);
assert.equal(g.slotAt(at(7, 7), 2), 1, 'no bleed across edge');
assert.equal(g.slotAt(at(50, 50), 2), 1);
assert.equal(g.slotAt(at(10, 10), 0), 0, 'near a temple is not a reason to pave grass');
assert.equal(g.slotAt(at(50, 50), 3), 0, 'construction texture alone is not a footprint');
t.paint.construction = new Uint8Array(64 ** 2);
t.paint.construction[at(50, 50)] = 63;
assert.equal(g.slotAt(at(50, 50), 3), 3);
assert.equal(g.slotAt(at(49, 50), 3), 0);
assert.throws(() => groundZones(t, used, r, []), /landmark/);
assert.throws(() => groundZones(t, used, { ...r, zones: [] }, []), /Unzoned/);
const d = JSON.parse(
  fs.readFileSync(new URL('./remaster/directions/d96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e.json', import.meta.url))
);
validateDirection({ id: d.job }, d);
assert.throws(() => validateDirection({ id: d.job }, { ...d, views: d.views.slice(0, 4) }), /five/i);
assert.throws(() => validateDirection({ id: d.job }, { ...d, landUse: { ...d.landUse, natural: null } }), /natural/);
console.log(
  'PASS five distinct contextual references, natural defaults, inset aprons, construction authorization and unchanged natural paint'
);
