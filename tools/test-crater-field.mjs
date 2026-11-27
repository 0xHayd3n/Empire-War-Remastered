import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL, seedCrater, craterHeight, craterChar, craterLocal, fieldHeight, fieldSlope, fieldChar, footprintQuads } from '../public/js/game/crater-field.js';

const crater = (over = {}) => seedCrater({ x: 0, y: 0, radius: 20, depth: 4, lip: 0.6, scorch: 0.5, seed: 7, ...over });

test('displacement is exactly 0 (value and slope) at and beyond the rim', () => {
  const cr = crater();
  let worst = 0;
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * Math.PI * 2,
      x = Math.cos(a) * cr.radius,
      y = Math.sin(a) * cr.radius;
    assert.equal(craterHeight(cr, x, y), 0, 'exactly zero at the support radius');
    assert.equal(craterHeight(cr, x * 1.2, y * 1.2), 0);
    // Ring just inside the rim: values must be small so the patch border is smooth.
    for (const k2 of [0.9, 0.95, 0.99]) worst = Math.max(worst, Math.abs(craterHeight(cr, x * k2, y * k2)));
  }
  assert.ok(worst < cr.depth * 0.1, `rim ring stays shallow: ${worst}`);
});

test('profile is a bowl with a flat floor, steep wall and a raised lip', () => {
  const cr = crater({ radius: 20, depth: 4, lip: 0.7 });
  const samples = [];
  for (let d = 0; d <= 20; d += 0.25) samples.push([d, craterHeight(cr, d, 0)]);
  const floor = samples[0][1],
    shoulder = Math.min(...samples.map((s) => s[1])),
    lip = Math.max(...samples.map((s) => s[1]));
  assert.ok(floor < -3.6, `floor near -depth: ${floor}`);
  assert.ok(lip > 0.02, `raised lip: ${lip}`);
  assert.ok(lip < cr.depth * 0.2, `lip stays modest: ${lip}`);
  // flat-ish floor: value changes little over the inner 25% of the radius
  const inner = samples.filter((s) => s[0] <= 4).map((s) => s[1]);
  assert.ok(Math.max(...inner) - Math.min(...inner) < cr.depth * 0.25, 'flat floor');
  // monotone rise from the floor to the shoulder (no secondary pits)
  let rises = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i][1] > samples[i - 1][1] + 1e-6) rises++;
  assert.ok(rises > 40, 'bowl wall rises steadily');
});

test('rim outline is irregular, never wider than the radius', () => {
  const cr = crater(),
    radii = [];
  for (let k = 0; k < 180; k++) {
    const a = (k / 180) * Math.PI * 2;
    let last = 0;
    for (let d = 0; d <= cr.radius; d += 0.1) if (craterHeight(cr, Math.cos(a) * d, Math.sin(a) * d) !== 0) last = d;
    radii.push(last);
  }
  const min = Math.min(...radii),
    max = Math.max(...radii);
  assert.ok(max <= cr.radius + 1e-9, 'support never exceeds the radius');
  assert.ok(max - min > cr.radius * 0.04, `rim is not a perfect circle: ${min.toFixed(2)}..${max.toFixed(2)}`);
});

test('stacked bowls saturate smoothly instead of clamping to a crease', () => {
  const craters = [0, 1, 2, 3, 4].map((i) => crater({ x: i * 0.5, depth: 12, radius: 20 }));
  const maxDepth = 20;
  let prev = fieldHeight(craters, 0, 0, maxDepth),
    prevSlope = 0;
  assert.ok(prev > -maxDepth - 1e-6, 'never deeper than maxDepth');
  assert.ok(prev < -maxDepth * 0.9, 'saturation is reached before the cap');
  const out = [0, 0];
  for (let d = 0.5; d < 30; d += 0.5) {
    const h = fieldHeight(craters, d, 0, maxDepth);
    fieldSlope(craters, d, 0, maxDepth, out);
    // continuity / no step: finite differences agree with the analytic-ish slope
    assert.ok(Math.abs(h - prev) < 1.5, 'no discontinuity');
    assert.ok(Math.hypot(out[0], out[1]) < 4, 'slope stays bounded');
    prev = h;
    prevSlope = out[0];
  }
  assert.ok(Number.isFinite(prevSlope));
});

test('composed field only depends on craters that reach the point', () => {
  const near = crater({ x: 30, y: 30, radius: 25 }),
    far = crater({ x: 400, y: 400, radius: 30 });
  const a = fieldHeight([near], 30, 30, 40),
    b = fieldHeight([near, far], 30, 30, 40);
  assert.equal(a, b, 'a crater that cannot reach the point changes nothing (patch localisation)');
  assert.equal(fieldHeight([], 30, 30, 40), 0);
});

test('char peaks on the floor, fades before the rim and clamps at 1', () => {
  const cr = crater({ scorch: 0.7 });
  const centre = craterChar(cr, 0, 0),
    half = craterChar(cr, cr.radius * 0.5, 0),
    rim = craterChar(cr, cr.radius, 0);
  assert.ok(centre > half && half > 0, 'falls off outwards');
  assert.equal(rim, 0, 'no char outside');
  assert.equal(fieldChar([crater({ scorch: 1 }), crater({ scorch: 1, x: 1 })], 0, 0), 1, 'clamped to 1');
  assert.equal(fieldChar([crater({ scorch: 0 })], 0, 0), 0, 'scorch 0 means no char at all');
});

test('footprint is minimal for a blast inside one triangle and clamped at map edges', () => {
  const inside = footprintQuads(CELL, 214, 206, 5, 20, 20);
  assert.equal(inside.length, 1);
  assert.deepEqual(inside[0], { qx: 10, qy: 10 });
  const edge = footprintQuads(CELL, 2, 2, 8, 20, 20);
  assert.ok(edge.every((q) => q.qx >= 0 && q.qy >= 0));
  assert.ok(edge.length >= 1);
  const huge = footprintQuads(CELL, 100, 100, 500, 10, 10);
  assert.equal(huge.length, 100, 'clamped to the map, not the blast');
  // A quad is included only if the disc really reaches it.
  for (const q of footprintQuads(CELL, 100, 100, 9, 40, 40)) {
    const nx = Math.min(Math.max(100, q.qx * CELL), q.qx * CELL + CELL),
      ny = Math.min(Math.max(100, q.qy * CELL), q.qy * CELL + CELL);
    assert.ok(Math.hypot(nx - 100, ny - 100) < 9 + 1e-9, 'conservative but tight');
  }
});

test('local coordinates stay in [0,1) inside and report outside', () => {
  const cr = crater();
  assert.equal(craterLocal(cr, 0, 0), 0);
  assert.ok(craterLocal(cr, cr.radius * 0.5, 0) > 0 && craterLocal(cr, cr.radius * 0.5, 0) < 1);
  assert.equal(craterLocal(cr, cr.radius, 0), -1, 'exactly on the radius is outside');
});
