import assert from 'node:assert/strict';
import * as T from 'three';
import { foliageStream, splitPlants } from '../public/js/game/foliage-stream.js';
const plants = Array.from({ length: 300 }, (_, i) => ({ x: i, y: 4, z: 3, s: 1, rot: 0 })),
  near = [],
  far = [];
for (const reach of [250, 100, 0, 500]) {
  near.length = far.length = 0;
  splitPlants(
    plants,
    p => p !== plants[15],
    reach,
    20,
    p => p.x ** 2,
    near,
    far
  );
  assert(near.length <= 20);
  assert.equal(new Set([...near, ...far]).size, 299);
  assert.equal(near.length + far.length, 299);
}
const parent = new T.Group(),
  g = new T.BufferGeometry(),
  m = new T.MeshBasicMaterial(),
  s = foliageStream(parent, g, m, 'fern', 'proxy'),
  z = p => p.z;
s.commit([], z);
assert.equal(parent.children.length, 0);
s.commit(plants.slice(0, 20), z);
let batch = parent.children[0],
  a = batch.instanceMatrix;
assert.equal(batch.count, 20);
assert(a.count <= 25);
assert.deepEqual(a.updateRanges, [{ start: 0, count: 320 }]);
a.clearUpdateRanges();
const v = a.version;
s.commit(plants.slice(0, 20), z);
assert.equal(a.version, v);
assert.deepEqual(a.updateRanges, []);
s.commit(plants, z);
assert.equal(parent.children.length, 1);
assert.equal(s.receipt().peak, 300);
batch = parent.children[0];
a = batch.instanceMatrix;
s.commit(plants.slice(0, 19), z);
assert.equal(batch.count, 19);
assert(a.updateRanges.every(r => r.start + r.count <= 304));
s.commit([], z);
assert.equal(batch.visible, false);
assert.deepEqual(a.updateRanges, []);
s.dispose();
assert.equal(parent.children.length, 0);
m.dispose();
g.dispose();
console.log('PASS detail-cap demotion, one rooted representation, lazy capacity, live prefix, unchanged-camera reuse and disposal');
