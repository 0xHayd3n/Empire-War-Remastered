// End-to-end checks on the articulated path with real Rapier and the real wrecks
// layer, no browser. Every measurement of "the drawn skin" is taken the way the GPU
// draws it (palette per influence, mesh matrix for rigid kit), never from colliders.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Vector3 } from 'three';
import { VehicleWrecks } from '../../public/js/game/vehicle-wrecks.js';
import { loadWreckPhysics } from '../../public/js/game/rapier-runtime.js';
import { FLEX } from '../../public/js/game/infantry-articulation.js';
import { buildUnit } from '../ragdoll-parking/fixture.mjs';
import { FLOOR, belowGround, buildDroid, drawnTriangles, drawnVertices, flat, longestEdge, margin } from './fixture-articulated.mjs';

async function setup(height) {
  const R = await loadWreckPhysics();
  const scene = new Scene();
  // keepBodies on: the parked path, not just the timed cleanup.
  return {
    scene,
    layer: new VehicleWrecks(
      R,
      scene,
      height,
      () => false,
      () => true
    )
  };
}

function spawn(layer, unit) {
  assert.equal(layer.presentDeath(unit.u), true, 'the death must be presented');
  assert.equal(layer.replaced.has(unit.u), true, 'the death must be the ragdoll, not residue');
  const wreck = layer.live.find(r => r.u === unit.u);
  assert.ok(wreck?.doll, 'spawn should build a doll');
  return { wreck, d: wreck.doll };
}

const freed = layer => layer.world.bodies.len() + layer.world.colliders.len() + layer.world.impulseJoints.len() === 0;
const drawnBox = rows => {
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of rows) {
    min.min(new Vector3(p.x, p.y, p.z));
    max.max(new Vector3(p.x, p.y, p.z));
  }
  return max.sub(min).length();
};

// Bodies must be authored bones, and a child body must hang off one of its own
// ancestors: the plan may coarsen the hierarchy, never invent a topology.
function assertAuthored(unit, d) {
  const boneOf = name => unit.byName.get(name);
  for (const n of d.nodes) {
    assert.ok(boneOf(n.name), `${n.name} is not an authored bone`);
    if (!n.parent) continue;
    let a = boneOf(n.name).parent;
    while (a && a !== boneOf(n.parent.name)) a = a.parent;
    assert.ok(a, `${n.name} is jointed to ${n.parent.name}, which is not one of its ancestors`);
  }
}

test('an unnamed skinned rig is articulated from its own hierarchy', async () => {
  const { layer } = await setup(flat);
  const unit = buildDroid();
  const { wreck, d } = spawn(layer, unit);

  assert.ok(d.nodes.length >= 2 && d.nodes.length <= 12, `bounded body count, got ${d.nodes.length}`);
  assert.equal(layer.world.impulseJoints.len(), d.nodes.length - 1, 'one joint per parent link');
  assertAuthored(unit, d);
  assert.equal(d.detached, undefined);

  // The whole authored surface is drawn, not a slice of it: the skinned hull plus
  // the five rigid parts parented to bones.
  const source = [];
  unit.root.traverseVisible(o => o.isMesh && source.push(o));
  assert.equal(d.root.children.filter(o => o.isMesh).length, source.length, 'every drawn mesh is carried');
  assert.equal(d.root.children.filter(o => 'SKINNED' in (o.material.defines || {})).length, 1);

  const mesh = d.root.children.find(o => 'SKINNED' in (o.material.defines || {}));
  mesh.onBeforeRender();
  const palette = mesh.material.uniforms.boneMatrices.value,
    initial = palette.slice();
  const before = drawnVertices(d.root);
  assert.ok(before.some(r => r.mesh === 'skin') && before.some(r => r.mesh !== 'skin'), 'skin and rigid kit are drawn');
  const at = d.nodes[0].body.translation();
  layer.step(0);
  assert.equal(d.nodes[0].body.translation().z, at.z, 'a zero step must not move the corpse');

  let worstJoint = 0;
  for (let i = 0; i < 180; i++) {
    layer.step(1 / 60);
    for (const n of d.nodes) if (n.parent) worstJoint = Math.max(worstJoint, n.parent.rotation.angleTo(n.rotation));
  }
  // Every general joint is a limited hinge, or welded: no joint may roll free, so a
  // head stub or a straight piston stays where the author put it. The authored range
  // is FLEX; the clamp only intervenes within its own solver tolerance of it.
  assert.ok(worstJoint <= FLEX + 0.2, `a joint drifted ${worstJoint.toFixed(2)} rad from rest, limit is ${FLEX}`);

  const after = drawnVertices(d.root);
  const fell = at.z - d.nodes[0].body.translation().z;
  assert.ok(fell > 0.25, `the corpse should topple, dropped ${fell.toFixed(2)}`);
  assert.ok(
    drawnBox(after) < drawnBox(before) * 1.5 + 0.5,
    `the skin stayed a body's size: ${drawnBox(before).toFixed(2)} -> ${drawnBox(after).toFixed(2)}`
  );
  assert.ok(belowGround(after, flat) > -0.5, `the live fit is clipped ${belowGround(after, flat).toFixed(2)}`);
  assert.ok(palette.every(Number.isFinite) && palette.some((v, i) => Math.abs(v - initial[i]) > 0.1), 'the skin follows the bodies');
  assert.equal(unit.u.holder.visible, false, 'the authored unit is hidden only once the doll exists');
  assert.deepEqual(unit.u.holder.position.toArray(), [unit.u.x, unit.u.y, 0], 'the unit itself is never written to');

  layer.park(wreck);
  assert.equal(d.parked, true);
  const parked = drawnVertices(d.root);
  assert.ok(belowGround(parked, flat) <= 0, `parked surface is ${belowGround(parked, flat).toFixed(3)} below ground`);
  assert.ok(Math.abs(margin(parked, flat) - FLOOR) < 1e-4, `parked fit ${margin(parked, flat).toFixed(4)} should be ${FLOOR}`);
  assert.ok(freed(layer), 'bodies, joints and the ground patch are released');
  assert.equal(layer.live.length, 0);
  assert.equal(layer.settled.length, 1);
  layer.dispose();
});

test('a rig drawn only by rigid meshes parented to bones is articulated too', async () => {
  const { layer } = await setup(flat);
  const unit = buildDroid({ mode: 'rigid' });
  assert.equal(unit.inst.skins.length, 0, 'no skinned surface at all');
  const { wreck, d } = spawn(layer, unit);
  assert.ok(d.nodes.length >= 2, `got ${d.nodes.length} bodies`);
  assert.equal(layer.world.impulseJoints.len(), d.nodes.length - 1);
  assertAuthored(unit, d);

  const before = drawnVertices(d.root);
  assert.ok(before.length > 0 && before.every(r => r.mesh?.startsWith('shell_')), 'rigid parts only');
  const z0 = d.nodes[0].body.translation().z;
  for (let i = 0; i < 180; i++) layer.step(1 / 60);
  assert.ok(z0 - d.nodes[0].body.translation().z > 0.25, 'the droid should topple');

  // A blast takes a part off. Nothing here is a skin, so nothing can be stretched;
  // the part and its own rigid meshes simply leave.
  const leaf = d.nodes.find(n => n.name === 'strut_a3');
  const at = leaf.position;
  assert.equal(d.blast(at.x, at.y, at.z), true);
  assert.equal(d.detached, 'strut_a3');
  assert.equal(d.owned.length, 0, 'no skin seam to clip');
  for (let i = 0; i < 60; i++) layer.step(1 / 60);
  const away = drawnVertices(d.root);
  assert.ok(away.every(r => Number.isFinite(r.x + r.y + r.z)));

  layer.park(wreck);
  const parked = drawnVertices(d.root);
  assert.ok(belowGround(parked, flat) <= 0, 'rigid parts are fitted at park, not left in the ground');
  assert.ok(freed(layer));
  layer.dispose();
});

test('a blast clips the skinned seam instead of stretching it between islands', async () => {
  const { layer } = await setup(flat);
  const unit = buildDroid();
  const { wreck, d } = spawn(layer, unit);
  for (let i = 0; i < 60; i++) layer.step(1 / 60);
  const before = drawnTriangles(d.root),
    beforeCount = drawnVertices(d.root).length,
    edge = longestEdge(before);
  const at = d.nodes.find(n => n.name === 'strut_a3').position;
  assert.equal(d.blast(at.x, at.y, at.z), true);
  assert.equal(d.detached, 'strut_a3');
  assert.equal(d.owned.length, 1, 'the cross-island seam is clipped into an owned geometry');
  assert.ok(drawnVertices(d.root).length < beforeCount, 'seam triangles are dropped, not stretched');

  for (let i = 0; i < 120; i++) layer.step(1 / 60);
  const after = drawnTriangles(d.root);
  assert.ok(longestEdge(after) < edge * 1.25 + 0.05, `stretched edge ${longestEdge(after).toFixed(2)} from ${edge.toFixed(2)}`);
  // A part that has left its joint tumbles free: nothing still holds it to its old
  // parent's orientation.
  const gone = d.nodes.find(n => n.name === 'strut_a3');
  assert.ok(gone.parent.rotation.angleTo(gone.rotation) > FLEX + 0.2, 'a blasted-off part must not stay welded to its old parent');
  const body = d.nodes[0].body.translation(),
    limb = gone.body.translation();
  assert.ok(Math.hypot(limb.x - body.x, limb.y - body.y, limb.z - body.z) > 0.2, 'the blasts carries the limb away');
  assert.equal(d.blast(at.x, at.y, at.z), false, 'only one part can leave');

  layer.park(wreck);
  assert.ok(belowGround(drawnVertices(d.root), flat) <= 0);
  assert.ok(freed(layer));
  layer.dispose();
});

test('a rig the plan cannot place keeps its authored death and leaves nothing behind', async () => {
  const { layer } = await setup(flat);
  const cases = [
    [
      'two unconnected skeletons',
      () => {
        const unit = buildDroid();
        unit.inst.root.add(unit.byName.get('strut_a3'));
        return unit;
      }
    ],
    [
      'a single bone',
      () => {
        const unit = buildDroid();
        unit.inst.bones = [unit.bones[0]];
        return unit;
      }
    ],
    [
      'a pose that is not a number',
      () => {
        const unit = buildDroid();
        unit.byName.get('piston_b3').position.set(NaN, 0, 0);
        unit.holder.updateWorldMatrix(true, true);
        return unit;
      }
    ]
  ];
  for (const [what, make] of cases) {
    const unit = make();
    assert.equal(layer.presentDeath(unit.u), true, what);
    assert.equal(layer.replaced.has(unit.u), false, `${what} must not be replaced by a partial doll`);
    assert.equal(unit.u.holder.visible, true, `${what} must keep its authored death`);
    assert.equal(layer.live.length, 0, `${what} must not leave a doll behind`);
  }
  for (let i = 0; i < 300; i++) layer.step(1 / 60);
  assert.ok(freed(layer), 'residue cleans itself up');
  assert.equal(layer.scene.children.length, 0);
  layer.dispose();
});

test('hidden geometry cannot supply joints for a visible rigid plate', async () => {
  const unit = buildDroid();
  unit.mesh.visible = false;
  for (const mesh of unit.kit) mesh.visible = mesh.name === 'plate';
  const { layer } = await setup(flat);
  try {
    assert(layer.presentDeath(unit.u));
    assert(!layer.replaced.has(unit.u), 'no joints for an invisible skin');
    assert.equal(layer.residue.emitted, 1);
  } finally {
    layer.dispose();
  }
});

test('a mixed skin-and-rigid rig can lose a leaf drawn only by its rigid shell', async () => {
  const unit = buildDroid();
  const { layer } = await setup(flat);
  try {
    const { d } = spawn(layer, unit);
    const leaf = d.nodes.find(n => n.name === 'dome');
    const at = leaf.position;
    assert(d.blast(at.x, at.y, at.z));
    assert.equal(d.detached, 'dome');
    assert.equal(d.owned.length, 0);
  } finally {
    layer.dispose();
  }
});

test('a rig that names humanoid anatomy keeps the stock path and its guard rails', async () => {
  const stockRun = await setup(flat);
  // The stock ten-body path is unchanged.
  const stock = buildUnit();
  const { d } = spawn(stockRun.layer, stock);
  assert.equal(d.nodes.length, 10);
  assert.equal(stockRun.layer.world.impulseJoints.len(), 9);
  stockRun.layer.park(stockRun.layer.live[0]);
  for (let i = 0; i < 5; i++) stockRun.layer.step(1 / 60);
  stockRun.layer.dispose();

  // A rig whose labels say humanoid but whose anatomy is ambiguous is not re-read as
  // an arbitrary skeleton: it keeps its authored death, exactly as before.
  const broken = buildUnit();
  for (const b of broken.bones) {
    const [role, side] = b.name.slice(2).split('_');
    b.name =
      'mixamorig:' +
      ({ L: 'Left', R: 'Right' }[side] || '') +
      ({ Pelvis: 'Hips', Bicep: 'Arm', FArm: 'ForeArm', Thigh: 'UpLeg', Calf: 'Leg' }[role] || role);
  }
  broken.inst.bone = n => broken.bones.find(b => b.name === n);
  const other = new broken.bones[0].constructor();
  other.name = 'mixamorig:Head';
  broken.inst.bones.push(other);
  const { layer } = await setup(flat);
  assert.equal(layer.presentDeath(broken.u), true);
  assert.equal(layer.replaced.has(broken.u), false);
  assert.equal(broken.u.holder.visible, true);
  assert.equal(layer.live.length, 0);
  layer.dispose();
});
