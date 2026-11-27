import assert from 'node:assert/strict';
import * as T from 'three';
import { ModelDetail, registerModelPart, splitDetailBatch, detailPoolKey } from '../public/js/game/model-detail.js';
import { skinLocks } from '../public/js/game/land-index-lod.js';
const detail = new ModelDetail(),
  scene = new T.Scene(),
  camera = new T.PerspectiveCamera(55, 1, 1, 10000);
const high = new T.SphereGeometry(1, 24, 12),
  low = new T.SphereGeometry(1, 8, 4);
high.computeBoundingSphere();
const mat = new T.MeshBasicMaterial(),
  a = new T.Mesh(high, mat),
  b = new T.Mesh(high, mat);
registerModelPart(a, low);
registerModelPart(b, low);
scene.add(a, b);
a.position.z = -2;
b.position.z = -200;
scene.updateMatrixWorld();
camera.updateMatrixWorld();
const draw = fn => detail.draw(scene, camera, 720, fn);
draw(() => {
  assert.equal(a.geometry, high);
  assert.equal(b.geometry, low);
});
assert.equal(b.geometry, high);
assert.throws(() =>
  draw(() => {
    throw Error('lost frame');
  })
);
assert.equal(b.geometry, high);
// Separate colour representation never changes caster topology, even when pooled or resized.
const lowWrap = low.clone(),
  tint = new T.InstancedBufferAttribute(new Float32Array(4), 4);
lowWrap.setAttribute('instanceTint', tint);
const im = new T.InstancedMesh(lowWrap, mat, 1);
splitDetailBatch(im, high);
scene.add(im);
assert.equal(im.geometry.index, high.index);
draw(() => {
  assert.equal(im.geometry.index, lowWrap.index);
  assert.equal(im.geometry.attributes.instanceTint, tint);
});
assert.equal(im.geometry.index, high.index);
assert.notEqual(detailPoolKey(low, high), detailPoolKey(low, high.clone()));
assert.notEqual(detailPoolKey(low, high), detailPoolKey(low));
mat.transparent = true;
draw(() => assert.equal(b.geometry, high));
mat.transparent = false;
b.geometry = high.clone();
draw(() => assert.notEqual(b.geometry, low)); // a fitting replaced by a mod
const idx = Uint16Array.from([0, 1, 2, 1, 2, 3]),
  bones = Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]);
assert.deepEqual([...skinLocks(idx, bones, Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))], [0, 1, 1, 1]);
assert.equal(detail.reduced(high), null);
assert(detail.failed); // no Worker in Node: keep drawing high
console.log(
  'PASS per-copy model LOD, colour-only batches, original shadows and exception restoration, animated joint locks and worker fallback'
);
