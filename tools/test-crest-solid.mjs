// Synthetic art only. A front ray goes through a punched hole, the hub is a
// separate island, and a ray from the side hits a wall (not a double-sided card).
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { crestOutline } from '../public/js/game/crestoutline.js';
import { crestSolid } from '../public/js/game/crestsolid.js';
const width = 40,
  height = 40,
  data = new Uint8ClampedArray(width * height * 4),
  source = { width, height, data };
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const d = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
    if (d < 4 || (d > 10 && d < 16)) data.set([255, 255, 255, 255], 4 * (x + width * y));
  }
const outline = crestOutline(source);
assert.equal(outline.body.length, 3);
const geo = crestSolid(outline),
  mesh = new Mesh(geo, new MeshBasicMaterial());
const hit = (start, dir) => new Raycaster(new Vector3(...start), new Vector3(...dir)).intersectObject(mesh).length;
assert(hit([0, 0, 3], [0, 0, -1]));
assert(hit([0, 0, -3], [0, 0, 1]));
assert(!hit([0.2, 0, 3], [0, 0, -1]));
assert(hit([3, 0, 0], [-1, 0, 0]));
assert.equal(crestOutline(source, { w: 41, h: 40 }), null);
for (let i = 0; i < data.length; i += 4) data.set([220, 200, 170, 255], i);
for (let y = 8; y < 32; y++) for (let x = 17; x < 23; x++) data.set([80, 70, 130, 255], 4 * (x + y * width));
const medallion = crestOutline(source, {}, 'relief');
assert(medallion.relief?.length);
const relief = crestSolid(medallion);
relief.computeBoundingBox();
assert(relief.boundingBox.max.z > geo.boundingBox.max.z);
assert(relief.attributes.signal.array.some(n => n < 0.5));
geo.dispose();
mesh.material.dispose();
relief.dispose();
console.log('Crest mesh: front/back, genuine through-hole, separate hub, edge wall and raised two-tone device OK.');
