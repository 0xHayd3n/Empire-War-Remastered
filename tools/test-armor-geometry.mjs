import assert from 'node:assert/strict';
import * as T from 'three';
import { ArmorDamage } from '../public/js/game/armor-geometry.js';
// One laser crosses two enormous triangles (no convenient existing vertex to move).
const shared = new T.PlaneGeometry(100, 100);
shared.clearGroups();
const root = new T.Group(),
  mesh = new T.Mesh(shared, new T.MeshBasicMaterial()),
  twin = new T.Mesh(shared, mesh.material);
root.position.set(123, 456, 75);
root.rotation.z = 0.7;
root.add(mesh);
root.updateMatrixWorld(true);
const armor = new ArmorDamage(),
  u = {};
const at = new T.Vector3(8, -3, 0).applyMatrix4(mesh.matrixWorld);
function depth(dx) {
  const p = at.clone().add(new T.Vector3(dx, 0, 20)),
    ray = new T.Raycaster(p, new T.Vector3(0, 0, -1));
  return ray.intersectObject(mesh, false)[0]?.point.z;
}
assert.equal(depth(0), 75);
assert(armor.hit(u, root, at.x, at.y, at.z, 5, false, 0));
assert(depth(0) < 74);
assert.equal(depth(12), 75);
assert.equal(twin.geometry, shared);
assert.equal(shared.attributes.position.count, 4);
armor.clear();
assert.equal(mesh.geometry, shared);
assert(armor.hit(u, root, at.x, at.y, at.z, 5, true, 1));
assert.equal(depth(0), undefined);
assert.equal(depth(12), 75);
assert.notEqual(mesh.geometry, shared);
u.dead = true;
armor.update();
assert.equal(mesh.geometry, shared);
assert.equal(depth(0), 75);
console.log('Localized dent, open hole, intact surrounding plate, instance isolation and cleanup passed.');
