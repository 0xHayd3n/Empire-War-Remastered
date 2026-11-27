import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector4 } from 'three';
import { BlastField } from '../public/js/game/blastfield.js';
import { BLAST_SLOTS } from '../public/js/blastlight.js';

const camera = new PerspectiveCamera(60, 1.5, 1, 15000);
camera.position.set(0, 0, 2000);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const f = new BlastField(),
  slots = () => Array.from({ length: BLAST_SLOTS }, () => new Vector4());
const u = { blastCount: { value: 0 }, blastEnergy: { value: slots() }, blastSource: { value: slots() } };
f.emit(0, NaN, 0, 20, false);
f.emit(0, 0, 0, 0, true);
assert.equal(f.events.length, 0);
f.emit(0, 0, 0, 80, false);
f.emit(0, 0, 4000, 20, false); // behind the camera
f.emit(40, 0, 0, 40, false); // fogged
const world = { viewFogged: x => x === 40 };
f.bind(u, world, camera);
assert.equal(u.blastCount.value, 1);
const reach = u.blastSource.value[0].w,
  hot = u.blastEnergy.value[0].clone();
camera.position.z = 3000;
camera.updateMatrixWorld();
f.advance(0);
f.bind(u, world, camera);
assert.equal(u.blastSource.value[0].w, reach);
assert.deepEqual(u.blastEnergy.value[0], hot); // identical frozen frame at a new zoom
f.advance(0.18);
f.bind(u, world, camera);
const cool = u.blastEnergy.value[0];
assert(cool.x > 0 && cool.x < hot.x && cool.z / cool.x < hot.z / hot.x);
f.advance(2);
f.bind(u, world, camera);
assert.equal(u.blastCount.value, 0);
for (let i = 0; i < 60; i++) f.emit(i, 0, 0, 10 + i, true);
assert(f.events.length <= 24);
f.bind(u, {}, camera);
assert.equal(u.blastCount.value, BLAST_SLOTS);
assert.equal(u.blastSource.value[0].x, 59);
console.log('Blast field: pause, cooling, world-space reach, visibility, bounds and selection passed.');
