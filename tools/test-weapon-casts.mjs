// Real-Rapier checks for the weapon-cast authority, through the code the tactical
// sims actually run: land's LandWorld.meshStrike() and space's World.meshStep().
//
// The models here are synthetic because the authored EaW assets are not part of the
// checkout. They are shaped exactly the way alo.js hands a model to collmesh.js
// (bone table, per-mesh collision flag, per-sub geometry) so the triangles reach the
// native query through the same path a real AT-ST or Star Destroyer would.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D } from 'three';
import { collisionBoxOf, collisionOf, meshHit } from '../public/js/game/collmesh.js';
import { BattleWeaponCasts } from '../public/js/game/battle-weapon-casts.js';
import { loadWreckPhysics } from '../public/js/game/rapier-runtime.js';
import { LandWorld } from '../public/js/game/land.js';
import { World } from '../public/js/game/sim.js';

import { sweep, sweepBox } from '../public/js/game/projflight.js';
const R = await loadWreckPhysics();
const casts = new BattleWeaponCasts(R);

test('ordinary shots at rotated gameplay boxes, ellipsoids and padding keep their volumes with no authored triangles', () => {
  for (const fn of [sweep, sweepBox])
    for (const yy of [-3.9, -1, 0, 0.4, 2, 5])
      for (const angle of [0, Math.PI / 6, Math.PI / 2])
        for (const [start, end] of [
          [-6, 6],
          [0, 6],
          [0, 0],
          [-6, -5]
        ]) {
          const args = [start, yy, 0.2, end, yy, 0.2, 0.5, -0.5, 0, angle, 1, 3, 0.4];
          const expected = fn(...args),
            got = fn(...args, casts);
          assert(Math.abs(expected - got) < 0.0001, `${fn.name} ${args}: ${expected} vs ${got}`);
        }
});
const FACE = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
const CORNER = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1]
];

// One authored collision mesh: an axis-aligned box of the given half extents.
function boxMesh(name, [hx, hy, hz], centre = [0, 0, 0], collision = true) {
  const pos = new Float32Array(24);
  CORNER.forEach(([x, y, z], i) => pos.set([centre[0] + x * hx, centre[1] + y * hy, centre[2] + z * hz], i * 3));
  return {
    name,
    collision,
    hidden: false,
    bone: 0,
    bbox: [centre[0] - hx, centre[1] - hy, centre[2] - hz, centre[0] + hx, centre[1] + hy, centre[2] + hz],
    subs: [
      {
        geometry: {
          format: '',
          nVerts: 8,
          indices: Uint16Array.from(FACE),
          vertices: { pos }
        }
      }
    ]
  };
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const model = meshes => ({
  bones: [{ name: 'root', parent: -1, matrix: IDENT }],
  meshes
});
const hullModel = () => model([boxMesh('hull_collision', [1, 1, 1])]);

// A unit whose authored hull is tight but whose authored COLLISIONBOX is coarse: the
// case where land's legacy narrow phase (meshOf -> collisionBoxOf first) is a
// bounding box around a much smaller authored hull.
const boxyModel = () => model([boxMesh('COLLISIONBOX', [1.5, 1.5, 1.5], [0, 0, 0], false), boxMesh('hull_collision', [1, 1, 1])]);

// Heading 0 maps model (X, Y) to world (-Y, X), so a segment at world x = 3 runs
// through model Y = -3.
const SEG_HARDPOINT = [3, 0, 6, 3, 0, -6],
  SEG_HULL = [0, 0, 6, 0, 0, -6];

// Deterministic pseudo-random, so a failure is reproducible.
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

test('the vendored production Rapier answers the hull query', () => {
  const C = collisionOf(hullModel());
  assert.ok(C?.T?.length, 'the authored triangles reach collmesh');
  // Straight through the middle of a unit box from x = -5 to x = +5.
  const t = casts.segment(C, -5, 0, 0, 5, 0, 0);
  assert.ok(Math.abs(t - 0.4) < 1e-4, 'entry face at 40% of the segment, got ' + t);
  assert.equal(R.version(), '0.17.3');
  assert.equal(casts.segment(C, -5, 3, 0, 5, 3, 0), -1, 'a segment that clears the hull is a clean miss');
  assert.equal(casts.segment(C, -5, 3, 0, 5, 3, 0), -1, 'and asking twice gives the same answer');
});

test('the native cast agrees with the collmesh BVH it replaces', () => {
  const C = collisionOf(hullModel());
  const rnd = lcg(0x5eed);
  let hits = 0,
    misses = 0;
  for (let i = 0; i < 400; i++) {
    const [x0, y0, z0] = [(rnd() - 0.5) * 12, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6];
    const [x1, y1, z1] = [(rnd() - 0.5) * 12, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6];
    const want = meshHit(C, x0, y0, z0, x1 - x0, y1 - y0, z1 - z0);
    const got = casts.segment(C, x0, y0, z0, x1, y1, z1);
    if (want < 0) {
      misses++;
      assert.equal(got, -1, `segment ${i} must miss, legacy said ${want}`);
    } else {
      hits++;
      assert.ok(Math.abs(got - want) < 2e-3, `segment ${i} toi ${got} != legacy ${want}`);
    }
  }
  assert.ok(hits > 60 && misses > 60, 'the sample exercises both outcomes');
});

// The decision this supersedes: land's meshOf() picks the authored COLLISIONBOX ahead
// of the authored collision triangles, so a shot that clips the box corner is a hit
// today even though the hull it approximates is nowhere near the shot.
test('a glancing strike the collision box accepts is a miss on the authored hull', () => {
  const m = boxyModel();
  const box = collisionBoxOf(m),
    hull = collisionOf(m);
  assert.ok(box && hull && box !== hull, 'the model authors both a box and triangles');
  const seg = [-10, 1.05, 0, 10, 1.05, 0];
  assert.ok(meshHit(box, -10, 1.05, 0, 20, 0, 0) >= 0, 'the legacy box takes the glancing shot');
  assert.equal(casts.segment(hull, ...seg), -1, 'the authored hull does not');
  assert.ok(casts.segment(hull, -10, 0, 0, 10, 0, 0) >= 0, 'but a shot down the middle still strikes it');
});

test('a shot strikes the nearest hull once, never two', () => {
  const near = collisionOf(model([boxMesh('hull_collision', [1, 1, 1], [0, 0, 0])]));
  const far = collisionOf(model([boxMesh('hull_collision', [1, 1, 1], [4, 0, 0])]));
  const x0 = -10,
    y0 = 0,
    z0 = 0;
  const tn = casts.segment(near, x0, y0, z0, 10, y0, z0);
  const tf = casts.segment(far, x0, y0, z0, 10, y0, z0);
  assert.ok(tn >= 0 && tf >= 0, 'both hulls sit on the line');
  assert.ok(tn < tf, 'first hit is the nearer hull');
  const hx = x0 + 20 * tn;
  assert.equal(casts.segment(far, x0, y0, z0, hx, y0, z0), -1, 'the shot is spent on the first hull');
});

// ---------------------------------------------------------------------------
// Land: the world's own narrow phase, not a reimplementation of it.
function landUnit(m) {
  const holder = new Object3D();
  return {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    structure: false,
    holder,
    inst: { root: holder, model: m, box: null },
    type: { num: () => 1, bool: () => false }
  };
}
const landWorld = () =>
  Object.assign(Object.create(LandWorld.prototype), {
    time: 1,
    fixed: false,
    weaponCasts: undefined
  });

test('land: the authored hull decides the strike, the broadphase stays the box', () => {
  const u = landUnit(boxyModel());
  const w = landWorld();
  assert.ok(w.meshOf(u), 'the unit has collision geometry');
  const collLo = u.collLo,
    collHi = u.collHi,
    collR = u.collR,
    coll = u.coll;
  const glance = [-10, 1.05, 0, 10, 1.05, 0],
    middle = [-10, 0, 0, 10, 0, 0];
  const legacyGlance = w.meshStrike(u, ...glance),
    legacyMiddle = w.meshStrike(u, ...middle);
  assert.ok(legacyGlance >= 0, 'without an authority the collision box takes the glancing shot');
  assert.ok(Math.abs(legacyMiddle - 0.425) < 2e-3, 'and the box surface is the contact point: ' + legacyMiddle);

  w.weaponCasts = casts;
  u.collT = undefined;
  const castGlance = w.meshStrike(u, ...glance),
    castMiddle = w.meshStrike(u, ...middle);
  assert.equal(castGlance, -1, 'with the authority the authored hull rejects the glancing shot');
  assert.ok(Math.abs(castMiddle - 0.45) < 2e-3, 'a real hit now lands on the authored hull: ' + castMiddle);
  assert.deepEqual([u.collLo, u.collHi, u.collR], [collLo, collHi, collR], 'range, deflect and z culling still read the box');
  assert.equal(u.coll, coll, 'meshOf() still caches the box it always did');

  w.weaponCasts = new BattleWeaponCasts(R, { enabled: false });
  u.collT = undefined;
  assert.ok(Math.abs(w.meshStrike(u, ...glance) - legacyGlance) < 1e-6, 'a disabled authority restores the legacy verdict');
  w.weaponCasts = casts;
  u.collT = undefined;
});

test('land: an exporter-flagged COLLISIONBOX cannot swallow a near miss on the smaller actual hull', () => {
  const model = boxyModel();
  model.meshes[0].collision = true;
  const u = landUnit(model),
    w = Object.assign(landWorld(), { weaponCasts: casts });
  w.meshOf(u);
  assert.equal(w.meshStrike(u, -10, 1.25, 0, 10, 1.25, 0), -1);
  assert(w.meshStrike(u, -10, 0, 0, 10, 0, 0) > 0);
});

test('land: collision triangles extending beyond a mod box widen only projectile candidate bounds', () => {
  const u = landUnit(model([boxMesh('COLLISIONBOX', [1, 1, 1], [0, 0, 0], false), boxMesh('wing_collision', [0.5, 0.5, 0.5], [9, 0, 4])]));
  const w = Object.assign(landWorld(), { weaponCasts: casts });
  w.meshOf(u);
  w.hullOf(u);
  assert(u.shotR >= 9.5 && u.shotHi >= 4.5 && u.collR < 2 && u.collHi === 1);
});

test('land: a unit without authored collision geometry is not given one', () => {
  const u = landUnit(model([boxMesh('body', [1, 1, 1], [0, 0, 0], false)]));
  const w = Object.assign(landWorld(), { weaponCasts: casts });
  assert.equal(w.meshOf(u), null, 'no authored triangles; the shot loop uses the existing volume instead');
  assert.equal(w.hullOf(u), null);
  assert.equal(w.strikeHull(null, -10, 0, 0, 10, 0, 0), -1, 'no invented triangle hit');
});

// ---------------------------------------------------------------------------
// Space: meshStep(), hull plus hardpoint meshes, ordering included.
const spaceWorld = () =>
  Object.assign(Object.create(World.prototype), {
    hitPart: null,
    weaponCasts: undefined
  });
// part.inv is the inverse of the hardpoint's own placement, in the unit's local
// frame, laid out column-major the way THREE's Matrix4.elements reports it.
function hardpoint(m, at, name) {
  return {
    hp: { name, alive: true, destroyable: true },
    coll: collisionOf(m),
    inv: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -at[0], -at[1], -at[2], 1],
    r: 1
  };
}
function spaceUnit(m, hpColl = null) {
  return {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    heading: 0,
    pitch: 0,
    roll: 0,
    coll: collisionOf(m),
    collR: 2,
    hpColl
  };
}

test('space: the native cast decides the segment and keeps hardpoint ordering', () => {
  const w = spaceWorld();
  const o = spaceUnit(hullModel(), [hardpoint(model([boxMesh('hp_collision', [0.6, 0.6, 0.6])]), [0, -3, 0], 'turret')]);
  const legacy = w.meshStep(o, ...SEG_HARDPOINT);
  assert.ok(legacy >= 0, 'legacy strikes the hardpoint mesh');
  assert.equal(w.hitPart?.name, 'turret', 'legacy reports the hardpoint part');

  w.weaponCasts = casts;
  w.hitPart = null;
  const cast = w.meshStep(o, ...SEG_HARDPOINT);
  assert.ok(cast >= 0 && Math.abs(cast - legacy) < 2e-3, `native toi ${cast} matches legacy ${legacy}`);
  assert.equal(w.hitPart?.name, 'turret', 'and the same part is reported');

  // A segment that misses the hardpoint but crosses the hull.
  w.hitPart = null;
  const castHull = w.meshStep(o, ...SEG_HULL);
  assert.ok(castHull >= 0 && w.hitPart === null, 'the hull wins when the hardpoint is not in the way');
  w.weaponCasts = undefined;
  w.hitPart = null;
  assert.ok(Math.abs(w.meshStep(o, ...SEG_HULL) - castHull) < 2e-3, 'hull toi is unchanged by the native path');
});

test('space: an unusable authority falls back instead of swallowing hits', () => {
  const o = spaceUnit(hullModel());
  const w = Object.assign(spaceWorld(), {
    weaponCasts: { enabled: true, segment: () => undefined }
  });
  assert.ok(w.meshStep(o, ...SEG_HULL) >= 0, 'undefined from the authority means "legacy decides"');
  const legacy = spaceWorld().meshStep(o, ...SEG_HULL);
  const offCasts = new BattleWeaponCasts(R, { enabled: false });
  const off = Object.assign(spaceWorld(), { weaponCasts: offCasts });
  assert.ok(Math.abs(off.meshStep(o, ...SEG_HULL) - legacy) < 1e-6, 'a disabled authority is never consulted');
  assert.equal(offCasts.stats().queries, 0, 'and it is not even asked');
});

test('one native hull per model, and the authority can be released', () => {
  const C = collisionOf(hullModel());
  casts.segment(C, -5, 0, 0, 5, 0, 0);
  const before = casts.stats().hulls;
  for (let i = 0; i < 50; i++) casts.segment(C, -5, 0, 0, 5, 0, 0);
  assert.equal(casts.stats().hulls, before, 'the model already had a hull, so nothing new was uploaded');
  assert.ok(casts.stats().queries >= 50, 'queries are counted for diagnostics only');
  const scratch = new BattleWeaponCasts(R);
  assert.equal(scratch.enabled, true);
  scratch.segment(collisionOf(hullModel()), -5, 0, 0, 5, 0, 0);
  assert.equal(scratch.stats().hulls, 1, 'a new authority uploads the hull once');
  scratch.dispose();
  assert.equal(scratch.segment(C, -5, 0, 0, 5, 0, 0), undefined, 'a disposed authority answers undefined');
  assert.equal(scratch.enabled, false);
});
