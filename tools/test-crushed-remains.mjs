import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CrushedRemains } from '../public/js/game/crushed-remains.js';
import { LandWorld } from '../public/js/game/land.js';
function fixture(foot = true) {
  const scene = new T.Scene(),
    holder = new T.Group(),
    root = new T.Group(),
    mesh = new T.Mesh(new T.BoxGeometry(4, 5, 14), new T.MeshBasicMaterial());
  mesh.position.z = 7;
  root.add(mesh);
  holder.add(root);
  holder.position.set(30, 15, 22);
  scene.add(holder);
  const u = { x: 30, y: 15, z: 22, foot, holder, inst: { root }, type: { name: 'fixture' } };
  return {
    scene,
    u,
    mesh,
    layer: new CrushedRemains(
      scene,
      () => 22,
      () => false,
      () => true
    )
  };
}
test('foot casualty lies lengthwise; armor keeps its hull outline; live mesh untouched', () => {
  for (const foot of [true, false]) {
    const { scene, u, layer, mesh } = fixture(foot);
    const pos = mesh.geometry.attributes.position.array.slice();
    assert.ok(layer.present(u, 0));
    const r = layer.rows[0].root,
      b = new T.Box3().setFromObject(r),
      s = b.getSize(new T.Vector3());
    assert.ok(b.min.z >= 22 && b.min.z < 22.2);
    assert.ok(s.z < 3 && (foot ? s.x === 14 : s.x === 4));
    assert.ok(r.parent === scene && u.holder.visible);
    assert.deepEqual(mesh.geometry.attributes.position.array, pos);
    layer.step(999);
    assert.equal(layer.rows.length, 1);
    layer.dispose();
    assert.equal(r.parent, null);
    assert.ok(mesh.parent === u.inst.root);
  }
});
test('an initialized but not yet drawn skin gets a private frozen palette', () => {
  const { u, mesh, layer } = fixture();
  const n = mesh.geometry.attributes.position.count;
  mesh.geometry.setAttribute('skinIndex', new T.BufferAttribute(new Uint16Array(n * 4), 4));
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) w[4 * i] = 1;
  mesh.geometry.setAttribute('skinWeight', new T.BufferAttribute(w, 4));
  mesh.material.uniforms = { boneMatrices: { value: null } };
  const skin = { mesh, mats: null };
  u.inst.skins = [skin];
  u.inst.syncSkins = () => {
    skin.mats = new Float32Array(new T.Matrix4().elements);
  };
  assert.ok(layer.present(u, 0));
  const copy = layer.rows[0].root.children[0];
  skin.mats[12] = 950;
  copy.onBeforeRender();
  assert.equal(copy.material.uniforms.boneMatrices.value[12], 0);
});
test('touchdown respects ground height, enemy and authored squash flags, and the save rule', () => {
  const a = { kind: 'VEHICLE', crusher: true, supercrusher: true, x: 100, y: 100, z: 20, side: 0, body: 12 };
  const target = { x: 100, y: 101, z: 20, side: 1, body: 3, squashableBig: true };
  const cases = [
    target,
    { ...target, side: 0 },
    { ...target, z: 80 },
    { ...target, x: 200 },
    { ...target, scriptZ: 70 },
    { ...target, squashableBig: false }
  ];
  const calls = [],
    world = { units: [a, ...cases], ally: (a, b) => a === b, hurt: (...args) => calls.push(args) };
  LandWorld.prototype.crushLanding.call(world, a);
  assert.equal(calls.length, 0);
  world.landingCrushRule = true;
  LandWorld.prototype.crushLanding.call(world, { ...a, flight: {} });
  assert.equal(calls.length, 0);
  LandWorld.prototype.crushLanding.call(world, a);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], target);
  assert.equal(calls[0][3], 'CRUSHED');
  assert.equal(calls[0][6], a);
});
test('publication respects fog, casualty guards, body preference and pooled retention', () => {
  const { u, layer } = fixture(true);
  u.scriptHidden = true;
  assert.equal(layer.present(u, 0), false);
  u.scriptHidden = false;
  layer.fogged = () => true;
  assert.equal(layer.present(u, 0), false);
  layer.fogged = () => false;
  for (let i = 0; i < 100; i++) assert.ok(layer.present(u, 0));
  assert.equal(layer.rows.length, 96);
  layer.fogged = () => true;
  layer.step(0);
  assert.equal(layer.rows[0].root.visible, false);
  layer.keepBodies = () => false;
  layer.step(0);
  assert.equal(layer.rows.length, 96);
  layer.step(13);
  assert.equal(layer.rows.length, 0);
});
