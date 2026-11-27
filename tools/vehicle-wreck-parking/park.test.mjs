// Focused, no-browser checks for persistent reactive land vehicle wreckage.
// The layer runs with the real Rapier WASM world, real THREE meshes and a flat
// height field. Nothing here mounts the game or touches gameplay state.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene } from 'three';
import { VehicleWrecks, VEHICLE_WRECK_LIMITS } from '../../public/js/game/vehicle-wrecks.js';
import { loadWreckPhysics } from '../../public/js/game/rapier-runtime.js';
import { buildMover, buildVehicle, disposeCount, snapshot } from './fixture.mjs';

const R = await loadWreckPhysics();

function setup({ keep = false, fogged = () => false } = {}) {
  const scene = new Scene();
  return {
    scene,
    layer: new VehicleWrecks(
      R,
      scene,
      () => 0,
      fogged,
      () => keep
    )
  };
}

function spawn(layer, data = {}) {
  const v = buildVehicle(data);
  assert.equal(layer.spawn(v.u), true, 'the fixture vehicle must claim a detailed wreck');
  const wreck = layer.live.find(r => r.u === v.u);
  assert.ok(wreck?.pieces.length, 'the wreck must own at least one piece');
  return { v, wreck };
}

// Step the cosmetic layer (no movers) until the wreck has been archived.
function parkByPhysics(layer, wreck, frames = 1500) {
  for (let i = 0; i < frames && layer.live.includes(wreck); i++) layer.step(1 / 60);
  assert.equal(layer.live.includes(wreck), false, 'the wreck should be released from the live pool');
  return layer.parked.find(rec => rec.pieces.some(p => p.root.name.includes('WreckFixtureTank')));
}

const empty = layer => layer.world.bodies.len() + layer.world.colliders.len() + layer.world.impulseJoints.len() === 0;

test('archived wreck pieces keep the exact solved meshes, pose and paint after the timer', async () => {
  const { layer, scene } = setup();
  const { v, wreck } = spawn(layer);
  const roots = wreck.pieces.map(p => p.root);
  const renderables = wreck.pieces.map(({ root }) => root.children.map(m => ({ geo: m.geometry, mat: m.material, name: m.name })));

  // Track the last pose the layer actually drew, including the park frame.
  const sync = layer.syncPieces.bind(layer);
  let drawn = null;
  layer.syncPieces = w => {
    sync(w);
    if (w === wreck) drawn = roots.map(snapshot);
  };

  const rec = parkByPhysics(layer, wreck);
  assert.ok(rec, 'the vehicle should be archived, not destroyed');
  assert.equal(layer.live.length, 0);
  assert.deepEqual(roots.map(snapshot), drawn, 'parking must not move, rebuild or re-pose a released piece');
  assert.equal(rec.pieces.length, roots.length);
  assert.ok(
    rec.pieces.every(p => p.body === null),
    'every archived piece must have let go of its native body'
  );
  assert.ok(empty(layer), 'no bodies, joints or colliders may linger for an archived wreck');
  assert.equal(scene.children.length, roots.length, 'the same piece roots stay in the scene');
  assert.equal(layer.replaced.has(v.u), true, 'the authored death proxy stays suppressed');
  assert.equal(v.u.holder.visible, false, 'the authored unit still must not be drawn');

  // Same renderables reached the scene, one mesh per fixture group.
  roots.forEach((root, i) => {
    assert.equal(root.children.length, renderables[i].length);
    root.children.forEach((mesh, j) => {
      assert.equal(mesh.geometry, renderables[i][j].geo);
      assert.equal(mesh.material, renderables[i][j].mat);
      assert.equal(mesh.name, renderables[i][j].name);
    });
  });

  // A parked pose is never re-synced or re-solved by later frames.
  const frozen = roots.map(snapshot);
  for (let i = 0; i < 240; i++) layer.step(1 / 60);
  assert.deepEqual(roots.map(snapshot), frozen);
  assert.ok(empty(layer));
  assert.equal(layer.parked.length, 1);
  layer.dispose();
});

test('fog governs archived pieces individually, exactly like a live wreck', async () => {
  let fogged = false;
  const { layer } = setup({ fogged: () => fogged });
  const { wreck } = spawn(layer);
  const roots = wreck.pieces.map(p => p.root);
  parkByPhysics(layer, wreck);

  fogged = true;
  layer.step(0);
  assert.ok(
    roots.every(r => r.visible === false),
    'a fogged archived piece must not be drawn'
  );
  fogged = false;
  layer.step(0);
  assert.ok(roots.every(r => r.visible === true));
  layer.dispose();
});

test('a visible travelling hull wakes one contacted piece, shoves it and re-parks it', async () => {
  const { layer, scene } = setup();
  const { v, wreck } = spawn(layer);
  const rec = parkByPhysics(layer, wreck);
  const roots = rec.pieces.map(p => p.root);
  const posed = roots.map(snapshot);
  const piece = rec.pieces[0];
  const target = buildMover({ x: piece.x - 32, y: piece.y });
  // A write by the wreck layer would throw: movers are read-only presentation input.
  const mover = new Proxy(target, {
    set() {
      throw Error('parked wreckage must never write to a mover');
    },
    defineProperty() {
      throw Error('parked wreckage must never write to a mover');
    },
    deleteProperty() {
      throw Error('parked wreckage must never write to a mover');
    }
  });

  layer.update(1 / 60, [mover]);
  assert.equal(layer.awake.length, 0, 'a first sighting is only a baseline');
  let woke = false;
  for (let i = 0; i < 40 && !woke; i++) {
    target.x += 2;
    layer.update(1 / 60, [mover]);
    woke = layer.awake.length > 0;
  }
  assert.ok(woke, 'real travel into contact should wake the piece');
  assert.equal(rec.awake > 0, true);
  assert.ok(
    rec.pieces.some(p => p.body),
    'the woken piece must get a render-only body'
  );
  assert.ok(layer.world.colliders.len() > 0, 'the woken piece needs ground contact');
  assert.ok(scene.children.length === roots.length, 'waking must not add or replace renderables');

  // Repark: no movers, and either sleep or the bounded wake lifetime ends it.
  let frames = 0;
  while (layer.awake.length && frames < 600) {
    layer.update(1 / 60, []);
    frames++;
  }
  assert.equal(layer.awake.length, 0, 'the shove must settle back into the archive');
  assert.ok(empty(layer), 'a re-parked wreck must release its bodies and ground patch again');
  assert.equal(layer.parked.length, 1);
  assert.equal(layer.parked[0], rec, 'the re-settled hull is still the same archived record');
  const after = roots.map(snapshot);
  const moved = after.some((row, i) => row.position.some((x, k) => Math.abs(x - posed[i].position[k]) > 1e-3));
  assert.ok(moved, 'the shove must actually move the contacted piece');
  assert.equal(v.u.holder.visible, false);
  layer.dispose();
});

test('paused, teleporting, flying, fogged and unseen movers never wake wreckage', async () => {
  const cases = [
    ['paused', {}, { pause: true }],
    ['teleport', {}, { jump: 300 }],
    ['flying', { flies: true }],
    ['hovering', { hoverZ: 5 }],
    ['riding a transport', { inside: true }],
    ['scripted elevation', { scriptZ: 30 }],
    ['unseen', { seen: false }],
    ['hidden holder', { holder: Object.freeze({ visible: false }) }],
    ['dead', { dead: true }],
    ['too far to touch', {}, { far: true }],
    ['travelling away', {}, { away: true }],
    ['fogged', {}, { fog: true }]
  ];
  for (const [name, extra, motion = {}] of cases) {
    let fogged = false;
    const { layer } = setup({ fogged: () => fogged });
    const { wreck } = spawn(layer);
    const rec = parkByPhysics(layer, wreck);
    const piece = rec.pieces[0];
    const target = buildMover({
      x: piece.x + (motion.far ? 400 : motion.away ? 6 : -32),
      y: piece.y,
      ...extra
    });
    if (motion.fog) fogged = true;
    layer.update(1 / 60, [target]);
    if (motion.pause) layer.update(0, [target]); // recorded while frozen, still not travel
    target.x += motion.jump ? motion.jump : 2;
    layer.update(motion.pause ? 0 : 1 / 60, [target]);
    assert.equal(layer.awake.length, 0, `${name} must not wake parked wreckage`);
    assert.ok(
      rec.pieces.every(p => p.body === null),
      `${name} must not create piece bodies`
    );
    assert.ok(empty(layer), `${name} must not leave physics behind`);
    layer.dispose();
  }
});

test('only sustained travel toward a piece can shove it; a spawn or pass-by cannot', async () => {
  const { layer } = setup();
  const { wreck } = spawn(layer);
  const rec = parkByPhysics(layer, wreck);
  const piece = rec.pieces[0];
  // The first 20 world units of continuous travel are a spawn/teleport guard, so
  // this mover is already inside the old contact radius but has no history yet.
  const mover = buildMover({ x: piece.x, y: piece.y - 12 });
  for (let i = 0; i < 14; i++) {
    mover.y += 2;
    layer.update(1 / 60, [mover]);
  }
  assert.equal(layer.awake.length, 0, 'a mover without real travel history cannot shove');
  for (let i = 0; i < 14; i++) {
    mover.y += 2;
    layer.update(1 / 60, [mover]);
  }
  assert.equal(layer.awake.length, 0, 'travel away from the piece cannot shove');
  // Turn back: real travel now exists and the next contact is toward the piece.
  let woke = false;
  for (let i = 0; i < 60 && !woke; i++) {
    mover.y -= 2;
    layer.update(1 / 60, [mover]);
    woke = layer.awake.length > 0;
  }
  assert.ok(woke, 'real travel toward a contacted piece must still shove it');
  for (let i = 0; i < 600 && layer.awake.length; i++) layer.update(1 / 60, []);
  assert.ok(empty(layer));
  layer.dispose();
});

test('the archive is bounded and recycles its oldest record first', async () => {
  const { layer, scene } = setup();
  const all = [];
  const count = VEHICLE_WRECK_LIMITS.MAX_PARKED + 5;
  let blocked = null;
  for (let i = 0; i < count; i++) {
    const { v, wreck } = spawn(layer, { x: i * 200, parts: 6 });
    // The map's own path-blocking death clone: the layer may only restore its
    // authored corpse once the detailed wreck is finally recycled.
    if (i === 0) {
      v.u.deathClone = { bool: key => key === 'Death_Clone_Is_Obstacle' };
      blocked = v.u;
    }
    assert.equal(layer.parkVehicle(wreck), true);
    all.push(layer.parked.at(-1));
  }
  assert.equal(layer.parked.length, VEHICLE_WRECK_LIMITS.MAX_PARKED);
  assert.ok(layer.parkedParts <= VEHICLE_WRECK_LIMITS.MAX_PARKED_PARTS);
  assert.equal(
    layer.parkedParts,
    layer.parked.reduce((n, rec) => n + rec.pieces.length, 0),
    'the piece counter must agree with the archive'
  );
  const dropped = all.slice(0, count - layer.parked.length);
  assert.ok(dropped.length >= 5);
  for (const rec of dropped)
    assert.ok(
      rec.pieces.every(p => p.root.parent === null),
      'oldest pieces leave the scene'
    );
  for (const rec of layer.parked) assert.ok(rec.pieces.every(p => p.root.parent === scene));
  assert.equal(layer.parked.at(-1), all.at(-1), 'the newest wreck is kept');
  assert.equal(scene.children.length, layer.parkedParts);
  assert.ok(empty(layer));
  assert.equal(layer.replaced.has(blocked), false, 'a recycled path-blocking wreck restores its authored obstacle');
  layer.dispose();
});

test('dispose releases archived renderables, meshes and the physics world', async () => {
  const { layer, scene } = setup();
  const { wreck } = spawn(layer, { single: true });
  assert.ok(wreck.owned?.length, 'a single hull should own its cut geometry');
  const disposed = disposeCount([...wreck.owned, ...(wreck.skinViews || [])]);
  parkByPhysics(layer, wreck);
  assert.equal(layer.parked.length, 1);
  assert.ok(wreck.owned === null, 'ownership moved into the archive');
  layer.dispose();
  assert.ok(disposed(), 'owned and skin-view geometry must be disposed');
  assert.equal(scene.children.length, 0);
  assert.equal(layer.parked.length, 0);
  assert.equal(layer.world, null);
});

test('hidden casualties are never disclosed; an unclaimed death leaves no wreckage', async () => {
  const { layer } = setup();
  const v = buildVehicle();
  for (const hidden of [
    { seen: false },
    { holder: { visible: false } },
    { inside: true },
    { scriptHidden: true },
    { netHidden: true },
    { cloaked: true }
  ]) {
    const u = { ...v.u, ...hidden };
    assert.equal(layer.presentDeath(u), false);
  }
  assert.equal(layer.residue.emitted, 0);
  assert.equal(layer.replaced.has(v.u), false);

  // A visible but artless vehicle keeps its additive fallback and is not archived.
  const artless = buildVehicle();
  artless.root.clear();
  assert.equal(layer.presentDeath(artless.u), true);
  assert.equal(layer.residue.emitted, 1);
  assert.equal(layer.parked.length, 0);
  layer.dispose();
});

test('step(dt, units) drives the same conservative shove as update(dt, units)', async () => {
  const { layer } = setup();
  const { wreck } = spawn(layer);
  const rec = parkByPhysics(layer, wreck);
  const piece = rec.pieces[0];
  const mover = buildMover({ x: piece.x - 32, y: piece.y });
  layer.step(1 / 60, [mover]);
  assert.equal(layer.awake.length, 0, 'a first sighting is only a baseline');
  let woke = false;
  for (let i = 0; i < 40 && !woke; i++) {
    mover.x += 2;
    layer.step(1 / 60, [mover]);
    woke = layer.awake.length > 0;
  }
  assert.ok(woke, 'step(dt, units) must accept the local mover list');
  for (let i = 0; i < 600 && layer.awake.length; i++) layer.step(1 / 60, []);
  assert.ok(empty(layer));
  layer.dispose();
});

test('step(dt) remains the no-units entry point for the local battle loop', async () => {
  const { layer } = setup();
  const { wreck } = spawn(layer);
  assert.equal(typeof layer.update, 'function');
  const z0 = wreck.pieces.map(p => p.body.translation().z);
  layer.step(0);
  assert.deepEqual(
    wreck.pieces.map(p => p.body.translation().z),
    z0,
    'a zero step must not move a piece'
  );
  for (let i = 0; i < 10; i++) layer.step(1 / 60);
  assert.ok(wreck.pieces.some((p, i) => p.body.translation().z !== z0[i] || p.root.position.z !== z0[i]));
  layer.dispose();
});
