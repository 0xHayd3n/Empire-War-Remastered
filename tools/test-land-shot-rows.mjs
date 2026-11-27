import assert from 'node:assert/strict';
import test from 'node:test';
import { LandShotRows } from '../public/js/game/land-shot-rows.js';
const unit = (x, y, r, h = r) => ({ x, y, hitRadius: r, shotBound: h });
function candidates(rows, units, x, y, step) {
  const out = [];
  rows.append(units, x, y, step, out);
  return out;
}

test('a crowded bucket is a conservative broad phase and preserves first-hit order, including tangent and wide hulls', () => {
  const rows = new LandShotRows(),
    units = Array.from({ length: 50 }, (_, i) => unit((i % 8) * 13, Math.floor(i / 8) * 11, 2, i === 29 ? 70 : 3));
  for (let x = -30; x < 140; x += 3)
    for (let y = -16; y < 100; y += 7)
      for (const step of [0, 2, 17, 200]) {
        const expected = units.filter(u => (u.x - x) ** 2 + (u.y - y) ** 2 <= (Math.max(u.hitRadius, u.shotBound) + step) ** 2);
        assert.deepEqual(candidates(rows, units, x, y, step), expected);
      }
  assert.deepEqual(candidates(rows, [unit(10, 0, 8)], 0, 0, 2).length, 1);
});
test('another model cannot inherit a too-small broad phase; another tick or impact can relocate, resize and reorder', () => {
  const rows = new LandShotRows(),
    a = unit(100, 0, 1),
    b = unit(200, 0, 1),
    units = [a, b];
  a.collModel = {};
  a.inst = { model: {} };
  assert.deepEqual(candidates(rows, units, 0, 0, 1), [a]);
  a.collModel = a.inst.model;
  a.x = 0;
  b.shotBound = 210;
  units.reverse();
  rows.reset();
  assert.deepEqual(candidates(rows, units, 0, 0, 1), [b, a]);
  units.push(unit(0, 0, 1));
  assert.deepEqual(candidates(rows, units, 0, 0, 1), units);
});
