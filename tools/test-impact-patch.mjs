import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { surfacePatch, coldBankGeometry } from '../public/js/game/impactpatch.js';
import { battlePrefs } from '../public/js/battlerealism.js';
// Two parallel plates, a back-facing shell, and a neighboring island beyond the stamp.
const g = new BufferGeometry().setAttribute(
  'position',
  new Float32BufferAttribute(
    [-6, -6, 0, 6, -6, 0, 0, 6, 0, -6, -6, -2, 0, 6, -2, 6, -6, -2, -6, -6, -4, 6, -6, -4, 0, 6, -4, 20, 0, 0, 24, 0, 0, 22, 5, 0],
    3
  )
);
const p = surfacePatch(g, new Vector3(1, 1, 1), 3);
assert(p.center.distanceTo(new Vector3(1, 1, 0)) < 1e-6);
assert.equal(p.geo.attributes.position.count, 3);
assert.equal(p.geo.attributes.uv.count, 3);
const bank = coldBankGeometry();
assert.equal(bank.attributes.position.count, 3 * 40 * 3);
for (let i = 0; i < bank.attributes.position.count; i++) assert(Math.abs(bank.attributes.position.getY(i) - 304.6) < 1e-4);
const prefs = { hullDamageMarks: true, battleRealism: 'off' };
assert.equal(battlePrefs(prefs).hullDamageMarks, false);
prefs.battleRealism = 'on';
assert.equal(battlePrefs(prefs).hullDamageMarks, true);
assert(prefs.hullDamageMarks);
console.log('Impact geometry: local contact, one facing plate, three bank interiors and master settings passed.');
