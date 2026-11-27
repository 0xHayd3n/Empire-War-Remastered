import assert from 'node:assert/strict';
import { measureOrbitFaces, toLinear } from '../public/js/orbitcolor.js';
import { spaceBattleLook, spacePresentation } from '../public/js/battlelook.js';
const size = 8, bytes = new Uint8Array(6*size*size*4);
assert(measureOrbitFaces(bytes,size).every(v => v === 0));
bytes.fill(128);
let p = measureOrbitFaces(bytes,size);
assert(p.subarray(0,18).every(v => Math.abs(v-toLinear(128/255)) < 1e-6));
assert(p.subarray(21).every(v => v < 1e-6), 'uniform sky invents no localized sun');
bytes.fill(0);
// The sixth face is world -Z. A blue patch there must not act like a blue overhead light.
for(let j=2;j<4;j++) for(let i=4;i<6;i++) bytes[4*(j*6*size+5*size+i)+2]=255;
p=measureOrbitFaces(bytes,size);
assert(p[17]>0 && p[14]===0 && p[20]<0 && p[23]>0.95 && p[21]===0);
const unknown={spacePresentation:'obsolete',surfaceRelief:0.2};
assert.equal(spacePresentation(unknown),'inherit'); assert.equal(spaceBattleLook(unknown),unknown);
for (const [i, key] of ['cinematic','linear','orbital','deep-space'].entries()) assert.equal(spaceBattleLook({spacePresentation:key}).orbitStage,i+1);
console.log('Sky color, signed directions, preset fallback passed');
