import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { loadWreckPhysics } from '../public/js/game/rapier-runtime.js';
import { VehicleWrecks } from '../public/js/game/vehicle-wrecks.js';
import { SpaceWrecks } from '../public/js/game/space-wrecks.js';
import { Renderer } from '../public/js/game/render.js';
import { buildUnit } from './ragdoll-parking/fixture.mjs';
const R = await loadWreckPhysics();
const unit = (data = {}) => ({ x: 10, y: 8, z: 2, heading: 0, holder: new Group(), type: { name: 'ModdedUnit' }, ...data });
const quiet = () => false;

test('every visible land death has a native path, even without art; no false replacement or hidden-unit disclosure', () => {
  const scene = new Scene(),
    w = new VehicleWrecks(
      R,
      scene,
      () => 0,
      x => x < 0,
      () => true
    );
  try {
    for (const data of [
      { kind: 'DROID' },
      { kind: 'INFANTRY', foot: true },
      { kind: 'STRUCTURE', structure: true },
      { kind: 'VEHICLE', flies: true },
      { kind: 'VEHICLE', inst: { root: new Group() } }
    ]) {
      const u = unit(data);
      assert(w.presentDeath(u));
      assert(u.holder.visible);
      assert(!w.replaced.has(u));
    }
    assert.equal(w.residue.emitted, 5);
    assert.equal(w.live.length, 0);
    assert.equal(w.world.bodies.len(), 5);
    for (const exclude of [
      { x: -1 },
      { inside: true },
      { scriptHidden: true },
      { netHidden: true },
      { cloaked: true },
      { seen: false },
      { x: NaN },
      { holder: { visible: false } }
    ])
      assert(!w.presentDeath(unit(exclude)));
    assert.equal(w.residue.emitted, 5);
    const p = w.residue.pieces[0],
      start = p.obj.position.clone();
    w.step(0);
    assert(p.obj.position.equals(start));
    w.step(1 / 30);
    assert(!p.obj.position.equals(start));
    for (let t = 0; t < 240; t++) w.step(1 / 60);
    assert.equal(w.world.bodies.len(), 0);
    assert.equal(w.world.colliders.len(), 0);
    assert.equal(scene.children.length, 1,'only the unsupported ground vehicle leaves parked scrap');
    assert.equal(w.parkedParts,1);
  } finally {
    w.dispose();
  }
});

test('renamed humanoids get real joints; ambiguous or disconnected anatomy keeps its authored death', () => {
  const w = new VehicleWrecks(
    R,
    new Scene(),
    () => 0,
    quiet,
    () => true
  );
  try {
    for (const mutation of ['valid', 'duplicate', 'disconnected']) {
      const { u, bones, inst } = buildUnit();
      for (const b of bones) {
        const [role, side] = b.name.slice(2).split('_');
        b.name =
          'mixamorig:' +
          ({ L: 'Left', R: 'Right' }[side] || '') +
          ({ Pelvis: 'Hips', Bicep: 'Arm', FArm: 'ForeArm', Thigh: 'UpLeg', Calf: 'Leg' }[role] || role);
      }
      inst.bone = n => bones.find(b => b.name === n);
      if (mutation === 'duplicate') {
        const other = new Group();
        other.name = 'mixamorig:Head';
        bones.push(other);
      }
      if (mutation === 'disconnected') inst.root.add(bones.find(b => b.name === 'mixamorig:LeftHand'));
      assert(w.presentDeath(u));
      if (mutation === 'valid') {
        assert.equal(w.live[0].doll.nodes.length, 10);
        assert.equal(w.world.impulseJoints.len(), 9);
      } else {
        assert(!w.replaced.has(u));
        assert(u.holder.visible);
      }
    }
    assert.equal(w.residue.emitted, 2);
  } finally {
    w.dispose();
  }
});

test('an arbitrary burst reuses the transient slots and does not evict a full-detail casualty', () => {
  const scene = new Scene(),
    w = new VehicleWrecks(
      R,
      scene,
      () => 0,
      quiet,
      () => true
    );
  try {
    const model = buildUnit();
    assert(w.presentDeath(model.u));
    assert.equal(w.live[0].doll.nodes.length, 10);
    assert.equal(w.residue.emitted, 0);
    for (let i = 0; i < 500; i++) assert(w.presentDeath(unit({ kind: 'NewWorkshopCategory' + i, x: i })));
    assert.equal(w.residue.emitted, 500);
    assert.equal(w.residue.pieces.length, 24);
    assert.equal(w.residue.pieces.at(-1).body.translation().x, 499);
    assert.equal(w.world.bodies.len(), 34);
    assert.equal(w.world.impulseJoints.len(), 9);
  } finally {
    w.dispose();
  }
});

test('a recognized humanoid still gets native physics when the full-detail pool is occupied', () => {
  const w = new VehicleWrecks(
    R,
    new Scene(),
    () => 0,
    quiet,
    () => true
  );
  try {
    for (let i = 0; i < 32; i++) {
      const { u } = buildUnit({ x: i * 20 });
      assert(w.presentDeath(u));
      assert(w.replaced.has(u));
    }
    const { u } = buildUnit({ x: 640 });
    assert(w.presentDeath(u));
    assert.equal(w.live.length, 32);
    assert.equal(w.residue.emitted, 1);
    assert(!w.replaced.has(u));
    assert(u.holder.visible);
  } finally {
    w.dispose();
  }
});

test('a full animation-clone pool still releases the visible ship mesh if section slots remain', () => {
  const scene = new Scene(),
    w = new SpaceWrecks(R, scene),
    renderer = { spaceWrecks: w, clones: Array(24), explosion() {} },
    obj = new Group();
  const geo = new BoxGeometry(36, 8, 5),
    mat = new MeshBasicMaterial();
  obj.add(new Mesh(geo, mat));
  const type = { str: () => '', list: () => [], num: (k, d) => (k === 'Death_Persistence_Duration' ? 8 : d), bool: () => false };
  const u = unit({ type, obj, world: { viewerSees: () => true }, visualRadius: 24 });
  try {
    Renderer.prototype.deathClone.call(renderer, u, '', false, 9, 0, 0);
    assert.equal(w.pieces.length, 3);
    assert.equal(w.residue.emitted, 1);
  } finally {
    w.dispose();
    geo.dispose();
    mat.dispose();
  }
});

test('space death receiver emits native debris despite missing meshes, Remove_Upon_Death, or saturated clone and section budgets', () => {
  const scene = new Scene(),
    w = new SpaceWrecks(R, scene),
    renderer = { spaceWrecks: w, clones: [], explosion() {} },
    world = { viewerSees: u => u.seen !== false };
  const type = { str: () => '', list: () => [], num: (k, d) => d, bool: k => k === 'Remove_Upon_Death' };
  const death = (data = {}) => {
    const u = unit({ type, obj: new Group(), world, visualRadius: 24, ...data });
    Renderer.prototype.deathClone.call(renderer, u, '', false, 11, 2, 0);
    return u;
  };
  const geo = new BoxGeometry(),
    mat = new MeshBasicMaterial();
  try {
    const src = new Group();
    src.add(new Mesh(geo, mat));
    for (let i = 0; i < 64; i++) assert.equal(w.spawn(src, { x: 0, y: 0, z: 0 }, 10), 1);
    renderer.clones.length = 24;
    for (let i = 0; i < 100; i++) death({ x: i });
    for (const hidden of [{ seen: false }, { scriptHidden: true }, { hyper: true }, { cloaked: true }, { obj: { visible: false } }])
      death(hidden);
    assert.equal(w.residue.emitted, 100);
    assert.equal(w.residue.pieces.length, 24);
    assert.equal(w.pieces.length, 64);
    assert.equal(w.world.bodies.len(), 88);
    const p = w.residue.pieces.at(-1),
      start = p.obj.position.clone();
    assert(p.body.linvel().x !== 0);
    w.step(1 / 30, { viewFogged: () => true });
    assert(!p.obj.position.equals(start));
    assert(!p.obj.visible);
    w.clear();
    assert.equal(scene.children.length, 0);
    assert.equal(w.world.colliders.len(), 0);
    assert.equal(w.world.bodies.len(), 0);
  } finally {
    w.dispose();
    geo.dispose();
    mat.dispose();
  }
});
