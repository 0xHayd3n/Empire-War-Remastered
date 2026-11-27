// End-to-end checks on the real ragdoll and wreck layer with a real Rapier world,
// no browser. Every measurement of "the drawn skin" is taken the way the GPU
// draws it (palette per influence, mesh matrix for rigid kit), never from the
// centres of the colliders.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Vector3 } from 'three';
import { VehicleWrecks } from '../../public/js/game/vehicle-wrecks.js';
import { loadWreckPhysics } from '../../public/js/game/rapier-runtime.js';
import { BONE_POSITIONS, FLOOR, buildUnit, belowGround, drawnVertices, flat, liftNeeded, ridge } from './fixture.mjs';

const LENGTH =
  Math.hypot(BONE_POSITIONS.Head[0] - BONE_POSITIONS.Pelvis[0], 0, BONE_POSITIONS.Head[2] - BONE_POSITIONS.Pelvis[2]) +
  Math.hypot(
    BONE_POSITIONS.Thigh_L[0] - BONE_POSITIONS.Calf_L[0],
    BONE_POSITIONS.Thigh_L[1] - BONE_POSITIONS.Calf_L[1],
    BONE_POSITIONS.Thigh_L[2] - BONE_POSITIONS.Calf_L[2]
  ) +
  Math.hypot(
    BONE_POSITIONS.Calf_L[0] - BONE_POSITIONS.Foot_L[0],
    BONE_POSITIONS.Calf_L[1] - BONE_POSITIONS.Foot_L[1],
    BONE_POSITIONS.Calf_L[2] - BONE_POSITIONS.Foot_L[2]
  );
const CAP = 0.22 * LENGTH;

async function setup(height) {
  const R = await loadWreckPhysics();
  const scene = new Scene();
  // keepBodies on: this is the archive path that used to freeze a clipped pose.
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
  assert.equal(layer.spawn(unit.u), true, 'spawn should build a ragdoll');
  const wreck = layer.live.find(r => r.u === unit.u);
  assert.ok(wreck?.doll, 'spawn should create a doll');
  return { wreck, d: wreck.doll };
}

// A child's pivot must coincide with its parent's: the island has to move as one.
function worstJointGap(d) {
  const a = new Vector3(),
    b = new Vector3();
  let worst = 0;
  for (const s of d.nodes) {
    if (!s.parent || s.name === d.detached) continue;
    a.copy(s.anchorParent).applyMatrix4(s.parent.matrix);
    b.copy(s.anchorChild).applyMatrix4(s.matrix);
    worst = Math.max(worst, a.distanceTo(b));
  }
  return worst;
}

const freed = layer => layer.world.bodies.len() + layer.world.colliders.len() + layer.world.impulseJoints.len() === 0;

test('a parked casualty clears the hidden interior vertex exactly, once', async () => {
  const { layer, scene } = await setup(ridge);
  const unit = buildUnit();
  const { wreck, d } = spawn(layer, unit);
  assert.equal(d.nodes.length, 10);
  assert.equal(d.parked, false);

  // The live pose: the cached support samples never look at this vertex.
  const before = drawnVertices(d.root);
  const hidden = before.find(r => r.mesh === 'skin' && r.j === unit.interior);
  assert.ok(hidden, 'the interior vertex must be drawn');
  const need = ridge(hidden.x, hidden.y) + FLOOR - hidden.z;
  assert.ok(need > 0.35, `the interior vertex should be buried before park, got ${need.toFixed(3)}`);
  assert.ok(belowGround(before, ridge) > 0.2, 'the live pose is visibly clipped');
  assert.ok(Math.abs(liftNeeded(before, ridge).worst - need) < 1e-5, 'the missed interior vertex is the deepest drawn point');

  const z0 = d.nodes.map(s => s.matrix.elements[14]);
  layer.park(wreck);

  assert.equal(d.parked, true);
  const after = drawnVertices(d.root);
  assert.ok(belowGround(after, ridge) <= 0, `parked skin is still ${belowGround(after, ridge).toFixed(3)} below ground`);
  assert.ok(Math.abs(liftNeeded(after, ridge).worst) < 1e-4, 'the parked fit should be tight, not over-lifted');

  const lift = d.nodes[0].matrix.elements[14] - z0[0];
  assert.ok(lift > CAP, `parked lift ${lift.toFixed(3)} must exceed the live per-frame cap ${CAP.toFixed(3)}`);
  assert.ok(
    d.nodes.every((s, i) => Math.abs(s.matrix.elements[14] - z0[i] - lift) < 1e-6),
    'the whole attached island lifts as one rigid translation'
  );
  assert.ok(worstJointGap(d) < 1e-6, 'joint reconstruction must survive the lift');

  // Frozen: no later sync may read the freed bodies or move the archived pose.
  const drawn = after.map(p => [p.x, p.y, p.z]);
  d.sync();
  d.sync();
  assert.deepEqual(
    drawnVertices(d.root).map(p => [p.x, p.y, p.z]),
    drawn
  );

  assert.ok(freed(layer), 'bodies, joints and the ground patch must be released');
  assert.equal(wreck.doll, null);
  assert.equal(layer.live.length, 0);
  assert.equal(layer.settled.length, 1);
  assert.equal(layer.settled[0].root, d.root);
  assert.equal(d.root.parent, scene);
  // The unit itself is never written to.
  assert.equal(unit.u.holder.visible, false);
  assert.deepEqual(unit.u.holder.position.toArray(), [0, 0, 0]);
  layer.dispose();
});

test('a settled casualty is parked clear when the layer parks it by itself', async () => {
  const { layer } = await setup(flat);
  const unit = buildUnit();
  const { d } = spawn(layer, unit);
  for (let i = 0; i < 780 && !layer.settled.length; i++) layer.step(1 / 60);
  assert.equal(layer.settled.length, 1, 'the layer should park the sleeping casualty');
  assert.equal(d.parked, true);
  const after = drawnVertices(d.root);
  assert.ok(belowGround(after, flat) <= 0, `auto-parked skin is still ${belowGround(after, flat).toFixed(3)} below ground`);
  assert.ok(liftNeeded(after, flat).worst <= 1e-4);
  assert.ok(freed(layer));
  assert.equal(layer.live.length, 0);
  assert.equal(d.root.visible, true);
  // No repeated per-frame cost: later steps only toggle fog visibility.
  const frozen = drawnVertices(d.root).map(p => [p.x, p.y, p.z]);
  for (let i = 0; i < 5; i++) layer.step(1 / 60);
  assert.deepEqual(
    drawnVertices(d.root).map(p => [p.x, p.y, p.z]),
    frozen,
    'a parked pose must not be re-synced'
  );
  assert.ok(freed(layer));
  layer.dispose();
});

test('a detached limb and the body it left are fitted independently', async () => {
  // A step in the terrain a metre away, so the two islands cannot want the same lift.
  const stepped = x => (x > 1 ? 0.4 : 0);
  const { layer } = await setup(stepped);
  const unit = buildUnit();
  const { wreck, d } = spawn(layer, unit);
  const calf = d.nodes.find(s => s.name === 'Calf_L').position;
  assert.equal(d.blast(calf.x, calf.y, calf.z), true);
  assert.equal(d.detached, 'Calf_L');
  assert.ok(d.owned.length > 0, 'cross-island seam triangles must be clipped into an owned geometry');
  for (let i = 0; i < 120; i++) layer.step(1 / 60);
  const limb = d.nodes.find(s => s.name === 'Calf_L');
  assert.ok(
    Math.abs(limb.matrix.elements[14] - d.nodes[0].matrix.elements[14]) > 0.1,
    'the blast should carry the limb away from the body'
  );

  // Rest the separated limb on the raised side: it needs a real lift, the body
  // does not, so a correction shared by both would over-raise one of them.
  limb.body.setTranslation({ x: 2, y: 0, z: 0.28 }, true);
  limb.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  limb.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  d.sync();

  const before = drawnVertices(d.root);
  const z0 = d.nodes.map(s => s.matrix.elements[14]);
  layer.park(wreck);
  const after = drawnVertices(d.root);
  assert.equal(after.length, before.length);

  // Group the drawn surface by how far park lifted it: one group per island.
  const groups = new Map();
  before.forEach((p, i) => {
    const delta = Math.round((after[i].z - p.z) * 1e5) / 1e5;
    const g = groups.get(delta) || { delta, rows: [] };
    g.rows.push(i);
    groups.set(delta, g);
  });
  assert.equal(groups.size, 2, `expected one lift per island, got ${[...groups.keys()].join(', ')}`);
  for (const { delta, rows } of groups.values()) {
    const need = Math.max(0, ...rows.map(i => stepped(before[i].x) + FLOOR - before[i].z));
    assert.ok(Math.abs(delta - need) < 1e-4, `island lifted ${delta}, needs ${need}`);
    if (need > 0) {
      // Tight per island: the shallower one was not dragged up by the deeper one.
      const teeth = Math.min(...rows.map(i => after[i].z - stepped(after[i].x)));
      assert.ok(Math.abs(teeth - FLOOR) < 1e-4, `island floor clearance ${teeth.toFixed(4)} should be ${FLOOR}`);
    }
  }
  assert.ok(belowGround(after, stepped) <= 0, 'no drawn island may stay clipped');
  assert.ok(freed(layer));
  layer.dispose();
});

test('rigid kit hanging below the skin is fitted, not left in the ground', async () => {
  const { layer } = await setup(flat);
  const unit = buildUnit({ kitDepth: 0.6 });
  const { wreck, d } = spawn(layer, unit);
  const before = drawnVertices(d.root);
  const kit = before.filter(r => r.mesh === 'kit');
  const need = Math.max(...kit.map(p => flat(p.x, p.y) + FLOOR - p.z));
  assert.ok(need > CAP, `rigid kit needs ${need.toFixed(3)}, beyond the live per-frame cap`);
  assert.ok(
    need >
      liftNeeded(
        before.filter(r => r.mesh === 'skin'),
        flat
      ).worst,
    'kit should be the deepest surface'
  );
  layer.park(wreck);
  const after = drawnVertices(d.root).filter(r => r.mesh === 'kit');
  const teeth = Math.min(...after.map(p => p.z - flat(p.x, p.y)));
  assert.ok(Math.abs(teeth - FLOOR) < 1e-4, `parked kit clearance ${teeth.toFixed(4)} should be ${FLOOR}`);
  layer.dispose();
});
