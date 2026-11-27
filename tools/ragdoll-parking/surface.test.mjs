// Focused checks for the park-time floor fit, in isolation from Rapier and the
// renderer. The adversarial vertex here is interior: it is not a support sample
// in any of the 26 cached directions, yet on a ridge it is the deepest point.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute, Matrix4, Uint16BufferAttribute } from 'three';
import { exactClearance, supportClearance } from '../../public/js/game/ragdoll-surface.js';
import { FLOOR, INTERIOR, ridge } from './fixture.mjs';

const span = () => ({ matrix: new Matrix4() });

function geometry(rows, { index = 'fan' } = {}) {
  const n = rows.length;
  const position = new Float32Array(n * 3),
    skinIndex = new Uint16Array(n * 4),
    skinWeight = new Float32Array(n * 4);
  rows.forEach((p, j) => {
    position.set(p, j * 3);
    skinWeight[j * 4] = 1;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
  const ix = [];
  if (index === 'fan') for (let k = 1; k + 1 < n; k++) ix.push(0, k, k + 1);
  else if (Array.isArray(index)) ix.push(...index);
  g.setIndex(ix);
  return g;
}

function skinned(rows, s, opts) {
  return { mesh: { geometry: geometry(rows, opts), visible: true }, weights: [{ s, bind: new Matrix4() }] };
}

test('an interior vertex below the support samples is caught at park time only', () => {
  const s = span();
  const skirt = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    skirt.push([Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.25]);
  }
  // A pack above and behind the hidden vertex so it is strictly interior.
  const rows = [...skirt, [0, 0.16, 1.35], INTERIOR];
  const c = skinned(rows, s);
  const interior = rows.length - 1;

  // Per-frame path: directional extremes never pick the hidden vertex.
  const live = [0, 0];
  supportClearance(c, ridge, null, live);
  assert.ok(!c.support.some(([, j]) => j === interior), 'interior vertex must not be a support sample');
  const buried = ridge(INTERIOR[0], INTERIOR[1]) + FLOOR - INTERIOR[2];
  assert.ok(live[0] < buried - 0.3, `support lift ${live[0]} must leave the interior vertex buried (${buried})`);

  // Park path: every drawn vertex, so the miss is gone and the fit is exact.
  const parked = [0, 0];
  exactClearance([c], ridge, null, 5, parked);
  assert.ok(Math.abs(parked[0] - buried) < 1e-6, `exact lift ${parked[0]} != ${buried}`);
  assert.equal(parked[1], 0);
  assert.ok(parked[0] > live[0] + 0.3);
});

test('detached and attached islands are corrected independently', () => {
  const body = span(),
    limb = span();
  const torso = skinned(
    [
      [0, 0, 0.1],
      [0.2, 0, 0.1],
      [0, 0.2, 0.1]
    ],
    body
  );
  const calf = skinned(
    [
      [0.6, 0, 0.2],
      [0.8, 0, 0.2],
      [0.6, 0.2, 0.2]
    ],
    limb
  );
  // The detached limb lies on a step a metre above the torso.
  const height = (x, y) => (x > 0.5 ? 1 : 0);
  const moved = [0, 0];
  exactClearance([torso, calf], height, limb, 5, moved);
  const torsoNeed = Math.max(0, FLOOR - 0.1);
  const calfNeed = 1 + FLOOR - 0.2;
  assert.ok(Math.abs(moved[0] - torsoNeed) < 1e-6, `attached island lifted ${moved[0]}, needs ${torsoNeed}`);
  assert.ok(Math.abs(moved[1] - calfNeed) < 1e-6, `detached island lifted ${moved[1]}, needs ${calfNeed}`);
});

test('rigid kit is measured, and the correction stays bounded', () => {
  const s = span();
  // A pack hanging below the bone: nothing in the skinned support set sees it.
  const kit = {
    mesh: {
      geometry: geometry([
        [0, 0, -0.6],
        [0.03, 0, -0.6],
        [0, 0.03, -0.6]
      ]),
      visible: true
    },
    s,
    bind: new Matrix4()
  };
  const need = FLOOR + 0.6;
  const free = [0, 0];
  exactClearance([kit], () => 0, null, 5, free);
  assert.ok(Math.abs(free[0] - need) < 1e-6, `rigid kit lift ${free[0]} != ${need}`);
  const capped = [0, 0];
  exactClearance([kit], () => 0, null, 0.5, capped);
  assert.equal(capped[0], 0.5);
  // Rigid kit on the detached limb only moves that island.
  const limb = span();
  const owned = { ...kit, s: limb };
  const split = [0, 0];
  exactClearance([kit, owned], () => 0, limb, 5, split);
  assert.ok(Math.abs(split[0] - need) < 1e-6 && Math.abs(split[1] - need) < 1e-6);
});

test('bad heights, hidden meshes and unreferenced vertices cannot move the corpse', () => {
  const s = span();
  const deep = skinned(
    [
      [0, 0, -9],
      [0.2, 0, -9],
      [0, 0.2, -9]
    ],
    s
  );
  for (const height of [() => NaN, () => undefined, () => 1e6]) {
    const lift = [0, 0];
    exactClearance([deep], height, null, 0.4, lift);
    assert.ok(
      lift.every(v => Number.isFinite(v) && v >= 0 && v <= 0.4),
      `${height} gave ${lift}`
    );
  }
  const nan = [0, 0];
  // A stray rig whose vertex resolves to no weight slot draws at the origin; that
  // must not become a body-length lift.
  const g = geometry([
    [0, 0, -9],
    [0.2, 0, 0.2],
    [0, 0.2, 0.2]
  ]);
  g.attributes.skinIndex.setX(0, 5);
  const stray = [0, 0];
  exactClearance([{ mesh: { geometry: g, visible: true }, weights: [{ s, bind: new Matrix4() }] }], () => 0, null, 5, stray);
  assert.deepEqual(stray, [0, 0]);
  exactClearance([deep], () => NaN, null, 0.4, nan);
  assert.deepEqual(nan, [0, 0]);

  const hidden = skinned(
    [
      [0, 0, -9],
      [0.2, 0, -9],
      [0, 0.2, -9]
    ],
    s
  );
  hidden.mesh.visible = false;
  const skip = [0, 0];
  exactClearance([hidden], () => 0, null, 5, skip);
  assert.deepEqual(skip, [0, 0]);

  // Only referenced vertices are drawn, so only those can raise the pose.
  const unreferenced = skinned(
    [
      [0, 0, 0.5],
      [0.2, 0, 0.5],
      [0, 0.2, 0.5],
      [0, 0, -9]
    ],
    s,
    { index: [0, 1, 2] }
  );
  const refd = [0, 0];
  exactClearance([unreferenced], () => 0, null, 5, refd);
  assert.equal(refd[0], 0);
});
