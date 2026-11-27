import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOTFALL,
  hashFootfall,
  footfallKind,
  footfallProfile,
  freshFootfall,
  planFootfall,
  footfallGroundOk,
  padGroundOk
} from '../public/js/game/footfall.js';
import { seedPad, padLocal, padHeight, padField, padRimRadius } from '../public/js/game/crater-field.js';

// ---------------------------------------------------------------- fixtures
const type = (o = {}) => ({
  name: o.name || 'Test_Type',
  str: (k) => o[k] ?? '',
  bool: (k) => !!o[k],
  num: (k, d) => (Number.isFinite(o[k]) ? o[k] : d)
});
const box = (x = 5, y = 3, z = 10) => ({ min: { x: 0, y: 0, z: 0 }, max: { x, y, z } });
function unit(o = {}) {
  return {
    id: 1,
    kind: 'INFANTRY',
    foot: true,
    holder: { scale: { x: 1 } },
    inst: { box: box() },
    type: type({ MovementClass: 'Infantry' }),
    x: 40,
    y: 40,
    heading: 0,
    v: 0,
    mvx: 0,
    mvy: 0,
    ...o
  };
}
function walker(name = 'AT_ST_Walker', size = 20, o = {}) {
  return unit({
    kind: 'VEHICLE',
    foot: false,
    inst: { box: box(size * 0.5, size * 0.4, size) },
    hitRadius: size * 0.4,
    type: type({ name, MovementClass: 'Walker' }),
    ...o
  });
}

// ---------------------------------------------------------------- eligibility
test('only grounded infantry and walking vehicles make pads', () => {
  assert.equal(footfallKind(unit()), 'infantry');
  assert.equal(footfallKind(walker()), 'walker');
  assert.equal(footfallKind(walker('AT_AT_Walker', 40)), 'walker', 'heavier stock walker');

  const no = [
    ['dead', { dead: true }],
    ['gone', { gone: true }],
    ['structure', { structure: true }],
    ['inside', { inside: true }],
    ['garrisoned', { garrisonSlot: 2 }],
    ['flight', { flies: true }],
    ['flight flag', { flight: true }],
    ['roping', { rope: true }],
    ['cinematic', { cinematicTransport: true }],
    ['hidden', { scriptHidden: true }],
    ['net hidden', { netHidden: true }],
    ['cloaked', { cloaked: true }],
    ['hidden flag', { hidden: true }],
    ['scripted z', { scriptZ: 12 }],
    ['rooted', { rooted: true }],
    ['stunned', { stunUntil: 99 }],
    ['hover lift', { hoverZ: 1.2 }]
  ];
  assert.equal(footfallKind(unit({seen:false})), 'infantry', 'fog only delays publication');
  for (const [name, extra] of no) assert.equal(footfallKind(unit(extra), 50), null, name);

  const vehicle = (movement, extra = {}) =>
    footfallKind(unit({ foot: false, kind: 'VEHICLE', type: type({ MovementClass: movement, ...extra }) }));
  assert.equal(vehicle('Tank'), null, 'tanks leave tracks, not boot pads');
  assert.equal(vehicle('Hover'), null, 'repulsors hover');
  assert.equal(vehicle('Flying'), null, 'fliers never touch the soil');
  assert.equal(vehicle('Walker'), 'walker');
  assert.equal(
    footfallKind(unit({ foot: false, kind: 'VEHICLE', type: type({ MovementClass: '', Walk_Transition: 1, Movement_Animation_Speed: 1 }) })),
    'walker',
    'Workshop walker with only the walk-transition fallback'
  );
  assert.equal(
    footfallKind(unit({ foot: false, kind: 'VEHICLE', type: type({ MovementClass: 'Hover', Walk_Transition: 1, Movement_Animation_Speed: 1 }) })),
    null,
    'the fallback never promotes a hover craft'
  );
});

// ---------------------------------------------------------------- weight/size
test('profile is deterministic and scales depth/width with in-game size', () => {
  const foot = footfallProfile(unit()),
    st = footfallProfile(walker('AT_ST_Walker', 20)),
    at = footfallProfile(walker('AT_AT_Walker', 44));
  for (const [name, p] of [
    ['infantry', foot],
    ['AT-ST', st],
    ['AT-AT', at]
  ]) {
    assert.ok(p, name + ' profile');
    assert.equal(p.kind, name === 'infantry' ? 'infantry' : 'walker');
    assert.ok(p.depth > 0 && p.depth <= FOOTFALL.maxDepth, `${name} shallow depth`);
    assert.ok(p.halfWidth >= FOOTFALL.minHalfWidth && p.halfWidth <= FOOTFALL.maxHalfWidth, `${name} pad width`);
    assert.ok(p.halfLength > p.halfWidth, `${name} pad is elongated`);
    assert.ok(!('scorch' in p), `${name} has no scorch`);
  }
  assert.ok(foot.depth < st.depth && st.depth < at.depth, 'heavier walkers press deeper');
  assert.ok(foot.halfWidth < st.halfWidth && st.halfWidth <= at.halfWidth, 'bigger feet leave bigger pads');
  assert.ok(st.weight < at.weight, 'weight rises with model size');
  assert.deepEqual(footfallProfile(unit()), foot, 'same unit, same profile');
  assert.deepEqual(footfallProfile(walker('AT_ST_Walker', 20)), st);
  assert.notEqual(foot.seed, st.seed);
});

// ---------------------------------------------------------------- stride plan
function runPath(profile, steps, ox = 100, oy = 80, yaw = 0) {
  const st = { x: ox, y: oy, yaw, dist: 0, side: 1, seq: 0, ready: true };
  const pads = [];
  for (let i = 0; i < steps; i++) {
    const x = ox + Math.cos(yaw) * i,
      y = oy + Math.sin(yaw) * i;
    pads.push(...planFootfall(st, x, y, yaw, profile));
  }
  return pads;
}

test('strides come from accepted movement, deterministically and alternately', () => {
  const p = footfallProfile(unit());
  const a = runPath(p, 30),
    b = runPath(p, 30);
  assert.deepEqual(a, b, 'same accepted path, same pads');
  assert.equal(a.length, Math.floor(29 / p.stride), 'one pad per whole stride');
  assert.ok(a.length >= 4);
  const sides = new Set(a.map((q) => q.side));
  assert.deepEqual([...sides].sort(), [-1, 1], 'left/right feet alternate');
  for (let i = 1; i < a.length; i++) {
    assert.equal(a[i].side, -a[i - 1].side, 'strict alternation');
    assert.ok(Math.abs(Math.sin(a[i].yaw)) < 0.08, 'pad faces the accepted path (small toe-out)');
  }
  // Two adjacent opposite-side pads are one stride apart along the path and
  // separated laterally, never stacked.
  const along = Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y);
  assert.ok(along > p.stride * 0.9, `stride spacing ${along}`);
});

test('a stationary unit banks no distance and a teleport starts clean', () => {
  const p = footfallProfile(unit()),
    st = { x: 10, y: 10, yaw: 0, dist: 0, side: 1, seq: 0, ready: true };
  for (let i = 0; i < 1000; i++) assert.deepEqual(planFootfall(st, 10, 10, 0, p), []);
  assert.equal(st.dist, 0);
  assert.deepEqual(planFootfall(st, 200, 200, 1, p), [], 'teleport leaves no line of prints');
  assert.equal(st.x, 200);
  assert.equal(st.seq, 0);
  const after = planFootfall(st, 200 + p.stride * 1.01, 200, 1, p);
  assert.equal(after.length, 1, 'normal strides resume after the teleport');
});

test('a long frame cannot release an unbounded burst of pads', () => {
  const p = footfallProfile(unit()),
    st = { x: 0, y: 0, yaw: 0, dist: 0, side: 1, seq: 0, ready: true };
  const pads = planFootfall(st, 20, 0, 0, p);
  assert.equal(pads.length, FOOTFALL.maxStamps, 'bounded per tick');
  assert.ok(st.dist < p.stride, 'leftover distance is not banked');
  // A real teleport (over FOOTFALL.jump) releases nothing at all.
  assert.deepEqual(planFootfall(st, 200, 0, 0, p), []);
  assert.equal(st.dist, 0);
});

// ---------------------------------------------------------------- ground gates
const terrain = (over = {}) => ({
  size: 20,
  width: 20,
  height: 20,
  heights: new Float32Array(400).fill(10),
  paint: { triAt: new Int32Array(2 * 19 * 19).fill(0) },
  ...over
});
const world = (over = {}) => ({ wet: new Uint8Array(400), ...over });

test('water, authored holes, raised pads and outside the map are refused', () => {
  const t = terrain(),
    w = world(),
    pad = seedPad({ x: 100, y: 100, yaw: 0, halfLength: 1.5, halfWidth: 0.8, depth: 0.12, seed: 3 });
  assert.equal(footfallGroundOk(t, w, 100, 100), true);
  assert.equal(padGroundOk(t, w, pad), true);
  const wet = world();
  wet.wet[Math.round(100 / 20) * 20 + Math.round(100 / 20)] = 1;
  assert.equal(footfallGroundOk(t, wet, 100, 100), false);
  const hole = terrain();
  hole.paint.triAt[2 * (5 * 19 + 5)] = -1;
  assert.equal(footfallGroundOk(hole, w, 100, 100), false);
  const raised = terrain({ padTop: { cell: 20, w: 20, a: new Float32Array(400).fill(20) } });
  assert.equal(footfallGroundOk(raised, w, 100, 100), false);
  assert.equal(footfallGroundOk(t, w, -1, 10), false);
  assert.equal(footfallGroundOk(t, w, 5000, 10), false);
});

// ---------------------------------------------------------------- pad shape
test('a pad is an irregular elongated depression with a C1-zero rim', () => {
  const pad = seedPad({ x: 30, y: -12, yaw: 0.37, halfLength: 1.7, halfWidth: 0.85, depth: 0.2, lip: 0.015, seed: 77 });
  assert.equal(padLocal(pad, pad.x, pad.y), 0);
  assert.ok(Math.abs(padHeight(pad, pad.x, pad.y) + pad.depth) < pad.depth * 0.03, 'centre is the full shallow depression');
  const radii = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2,
      r = padRimRadius(pad, a);
    radii.push(r);
    assert.ok(Math.abs(padHeight(pad, pad.x + Math.cos(a) * r, pad.y + Math.sin(a) * r)) < 1e-9, 'exactly 0 at the rim');
    assert.equal(padHeight(pad, pad.x + Math.cos(a) * (r + 0.15), pad.y + Math.sin(a) * (r + 0.15)), 0, 'exactly 0 outside');
    // No crease into the untouched ground: the last millimetre of wall is flat.
    const near = padHeight(pad, pad.x + Math.cos(a) * (r - 0.01), pad.y + Math.sin(a) * (r - 0.01));
    assert.ok(Math.abs(near) < pad.depth * 0.02, `rim is C1 flat (${near})`);
  }
  const min = Math.min(...radii),
    max = Math.max(...radii);
  assert.ok(max - min > Math.max(pad.halfLength, pad.halfWidth) * 0.08, `rim is not a circle (${min.toFixed(3)}..${max.toFixed(3)})`);
  assert.ok(max <= Math.max(pad.halfLength, pad.halfWidth) + 1e-9, 'support never exceeds half extents');
  // Elongation: farther along the footprint than across it.
  const along = padRimRadius(pad, pad.yaw),
    across = padRimRadius(pad, pad.yaw + Math.PI / 2);
  assert.ok(along > across * 1.4, `elongated pad ${along.toFixed(2)} vs ${across.toFixed(2)}`);
  assert.ok(along < pad.halfLength * 1.001 && across < pad.halfWidth * 1.001);
});

test('overlapping pad fields saturate instead of growing without bound', () => {
  const pads = [0, 0.2, 0.4, 0.6].map((d, i) =>
    seedPad({ x: d, y: 0, yaw: 0, halfLength: 1.5, halfWidth: 0.8, depth: 0.2, seed: 10 + i })
  );
  const maxDepth = 0.25,
    h = padField(pads, 0.3, 0, maxDepth);
  assert.ok(h < 0 && h >= -maxDepth - 1e-9, `saturated field ${h}`);
  assert.equal(padField(pads, 500, 500, maxDepth), 0);
});

test('seeds are deterministic and independent of call order', () => {
  const a = seedPad({ x: 1, y: 2, yaw: 0, halfLength: 1, halfWidth: 0.5, depth: 0.1, seed: 5 }),
    b = seedPad({ x: 9, y: 9, yaw: 1, halfLength: 2, halfWidth: 1, depth: 0.2, seed: 5 });
  assert.equal(a.p1, seedPad({ x: 1, y: 2, yaw: 0, halfLength: 1, halfWidth: 0.5, depth: 0.1, seed: 5 }).p1);
  assert.equal(a.p1, b.p1, 'shape phase depends on the seed, not the position');
  assert.equal(hashFootfall('a'), hashFootfall('a'));
  assert.notEqual(hashFootfall('a'), hashFootfall('b'));
});
