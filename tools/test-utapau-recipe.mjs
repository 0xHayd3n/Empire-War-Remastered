import assert from 'node:assert/strict';
import { utapauRecipe as r } from '../public/js/utapau-recipe.js';
import { composeGround } from '../public/js/game/ground-composition.js';
import { groundZones } from '../public/js/game/ground-zones.js';

assert.equal(r.edition, 'foc');
assert.equal(r.path, 'DATA/ART/MAPS/_MP_LAND_UTAPAU.TED');
const used = Object.keys(r.slots).map(Number);
assert.equal(used.length, 28);
assert(!used.includes(63), 'The sinkhole must not acquire a surface');
assert(!r.donors.some(d => d.asset === 'sandy_gravel_02'), 'Rejected banded sand');
assert.deepEqual(r.zones.map(z => [z.slot, z.aprons.length, z.construction]), [[54, 6, false], [62, 6, true]]);
const size = 64, width = 61, height = 58, count = size * size;
const t = {size, width, height, layerIndex: new Uint8Array(count), heights: new Float32Array(count), paint: {}};
const props = r.zones[0].aprons.map(a => ({modelFile:a.model, x:a.anchor[0], y:a.anchor[1]}));
const zones = groundZones(t, used, r, props);
assert(!zones.authorized(10, used.indexOf(62)), 'Paint outside a documented deck is not paving');
t.paint.construction = new Uint8Array(count); t.paint.construction[10] = 63;
assert(zones.authorized(10, used.indexOf(62)), 'Live concrete must still be permitted');
assert(!zones.authorized(10, used.indexOf(54)));
const f = composeGround(t, used, r.composition, null, [], zones);
const slots = r.composition.channels.map(i => used.indexOf(i));
for(let y=0; y<height; y++) for(let x=0; x<width; x++) {
  const o=8*y*width+4*x, q=slots.map((_,i)=>f.bytes[o+(i<4?i:4*width+i-4)]);
  assert.equal(q.reduce((a,b)=>a+b,0),255);
  assert.equal(f.slotAt(y*size+x,used.indexOf(0)),slots[q.indexOf(Math.max(...q))]);
}
console.log('PASS Utapau: open aperture, bounded decks, construction permission, and draw/relief agreement after weight quantization');
