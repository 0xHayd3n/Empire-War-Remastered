import assert from 'node:assert/strict';
import * as T from 'three';
import { diskRadiance } from '../public/js/planetshine.js';
import { toLinear } from '../public/js/orbitcolor.js';
import { dominantDisk, planetDisk, bindPlanetDisk } from '../public/js/game/planetdisk.js';
import { battlePrefs } from '../public/js/battlerealism.js';
// No background in the reduction, even when clearing a colored attachment at alpha zero.
assert.deepEqual(diskRadiance([255, 255, 255, 0]), [0, 0, 0]);
assert.deepEqual(
  diskRadiance([255, 255, 255, 0, 128, 64, 32, 255]),
  [128, 64, 32].map(v => toLinear(v / 255))
);
const scene = new T.Scene(),
  r = {},
  world = {};
function sphere(radius, z, planet) {
  const mat = new T.MeshBasicMaterial();
  mat.userData.planet = planet;
  const o = new T.Mesh(new T.SphereGeometry(radius, 12, 12), mat);
  o.position.z = z;
  scene.add(o);
  return o;
}
sphere(40, 220, false); // stars or painted props provide no bounce
const view = { scene };
assert.equal(planetDisk(view, r, world), null);
const empty = view.planetLight;
assert.equal(planetDisk(view, r, world), null);
assert.equal(view.planetLight, empty);
assert(!empty.ready);
sphere(12, 240, true);
const winner = sphere(8, -64, true);
sphere(32, 1, true);
sphere(30, 75, true).visible = false;
const source = dominantDisk(scene);
assert.equal(source.mesh, winner);
const L = { planetDisk: { value: new T.Vector4() }, planetRadiance: { value: new T.Vector3() } };
bindPlanetDisk({ source, rgb: [0.1, 0.03, 0.02] }, L);
assert(L.planetDisk.value.z < 0 && Math.abs(L.planetDisk.value.w - 8) < 1e-5);
assert.deepEqual(L.planetRadiance.value.toArray(), [0.1, 0.03, 0.02]);
const prefs = { battleRealism: 'off', orbitalLighting: 'air' };
assert.equal(battlePrefs(prefs).orbitalLighting, 'map');
prefs.battleRealism = 'on';
assert.equal(battlePrefs(prefs).orbitalLighting, 'bounce');
prefs.battleRealism = 'custom';
assert.equal(battlePrefs(prefs).orbitalLighting, 'air');
console.log('Planet-only linear color, disk size and direction, empty map, master modes: ok');
