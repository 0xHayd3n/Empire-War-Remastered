import assert from 'node:assert/strict';
import { daylightFaces } from '../public/js/daylight-probe.js';
const n = 16,
  px = new Uint8Array(6 * n * n * 4),
  env = { ambient: [0, 0, 0], lights: [{ dir: [0, 0, 1], color: [0.7, 0.7, 0.7] }] };
assert.equal(daylightFaces(px, n, env), null, 'an empty atlas cannot black out a battle');
const paint = (face, rgb) => {
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px.set([...rgb, 255], 4 * ((6 * y + face) * n + x));
};
for (let f = 0; f < 6; f++) paint(f, [96, 144, 168]);
const result = daylightFaces(px, n, env);
assert(result[14] > result[13] && result[13] > result[12]);
assert(result[15] === 0);
assert(Math.abs(result[12] / result[0] - 2) < 0.02);
paint(5, [255, 0, 0]);
assert.deepEqual(result, daylightFaces(px, n, env), 'bottom of painted sky must never light undersides');
paint(0, [253, 151, 90]);
const warm = daylightFaces(px, n, env);
assert(warm[0] > warm[3] * 1.5, 'diffuse sky must preserve its bearing');
const two = { ...env, lights: [...env.lights, { color: [0.4, 0, 0], dir: [1, 0, 0] }, { color: [0, 0.4, 0], dir: [-1, 0, 0] }] };
for (let f = 0; f < 6; f++) paint(f, [120, 120, 120]);
const y = daylightFaces(px, n, two);
assert(y[0] > y[1] && y[4] > y[3]);
console.log('Daylight probe: upper hemisphere convolution, direction, separate authored fills, dark-atlas fallback OK');
